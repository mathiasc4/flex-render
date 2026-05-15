(function($) {
    /**
     * Return the number of breaks in an advanced-slider-like control config.
     *
     * @private
     * @param {*} value - Candidate control config.
     * @returns {number} Break count.
     */
    function readBreakCount(value) {
        if (Array.isArray(value)) {
            return value.length;
        }

        if (value && typeof value === "object") {
            if (Array.isArray(value.breaks)) {
                return value.breaks.length;
            }

            if (Array.isArray(value.default)) {
                return value.default.length;
            }
        }

        return 2;
    }

    /**
     * Return a default advanced slider control definition.
     *
     * @private
     * @param {boolean} maskOnly - Whether the slider should emit only its mask result.
     * @returns {object} Advanced slider control definition.
     */
    function advancedSliderDefault(maskOnly) {
        return {
            type: "advanced_slider",
            default: [0.25, 0.75],
            mask: [1, 1, 1],
            maskOnly,
            title: "Breaks",
            pips: {
                mode: "positions",
                values: [0, 25, 50, 75, 100],
                density: 4
            }
        };
    }

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that evaluates an advanced-slider control as a mask.
         */
        class AdvancedSliderMaskModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "advanced-slider-mask";
            }

            static name() {
                return "Advanced slider mask";
            }

            static description() {
                return "Evaluates an advanced slider control and returns its visibility mask.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value evaluated by the advanced slider."
                    }
                };
            }

            static outputs() {
                return {
                    mask: {
                        type: ["float"],
                        description: "Visibility mask returned by the advanced slider."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Advanced-slider visibility mask.",
                    description: "Uses an advanced_slider control in maskOnly mode and returns its sampled visibility value.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar value evaluated by the slider." }
                    ],
                    outputs: [
                        { name: "mask", type: "float", description: "Visibility mask returned by the slider." }
                    ],
                    controls: [
                        {
                            name: "threshold",
                            ui: "advanced_slider",
                            valueType: "float",
                            default: { default: [0.25, 0.75], mask: [1, 1, 1], maskOnly: true }
                        }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    threshold: {
                        default: advancedSliderDefault(true),
                        accepts: (type) => type === "float",
                        required: {
                            type: "advanced_slider",
                            inverted: false
                        }
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    mask: {
                        type: "float",
                        description: "Visibility mask returned by the advanced slider."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const mask = context.output("mask", "float");
                const threshold = this.control("threshold").sample(value, "float");

                return {
                    statements: `float ${mask} = ${threshold};`,
                    outputs: {
                        mask: { type: "float", expr: mask }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that classifies a scalar with an advanced-slider control.
         */
        class ClassifyBreaksModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "classify-breaks";
            }

            static name() {
                return "Classify breaks";
            }

            static description() {
                return "Classifies a scalar value by advanced-slider breaks and exposes class ratio, class index, and visibility mask.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to classify."
                    }
                };
            }

            static outputs() {
                return {
                    classRatio: {
                        type: ["float"],
                        description: "Normalized class position returned by the advanced slider."
                    },
                    classIndex: {
                        type: ["int"],
                        description: "Zero-based class index recovered from classRatio and the compile-time break count."
                    },
                    mask: {
                        type: ["float"],
                        description: "Visibility mask from the advanced slider mask array."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Classify scalar by breakpoints.",
                    description: "Uses one advanced_slider control with maskOnly=false. classRatio follows the slider's positional-ratio behavior, classIndex recovers the integer interval, and mask reads the slider mask branch.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar value to classify." }
                    ],
                    outputs: [
                        { name: "classRatio", type: "float", description: "Normalized class position." },
                        { name: "classIndex", type: "int", description: "Zero-based class index." },
                        { name: "mask", type: "float", description: "Visibility mask from the slider mask array." }
                    ],
                    controls: [
                        {
                            name: "threshold",
                            ui: "advanced_slider",
                            valueType: "float",
                            default: { default: [0.25, 0.75], mask: [1, 1, 1], maskOnly: false }
                        }
                    ],
                    notes: [
                        "If the number of breaks changes at runtime, rebuild the modular shader so classIndex uses the new break count."
                    ]
                };
            }

            static get defaultControls() {
                return {
                    threshold: {
                        default: advancedSliderDefault(false),
                        accepts: (type) => type === "float",
                        required: {
                            type: "advanced_slider",
                            inverted: false
                        }
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    classRatio: {
                        type: "float",
                        description: "Normalized class position returned by the advanced slider."
                    },
                    classIndex: {
                        type: "int",
                        description: "Zero-based class index recovered from classRatio and the compile-time break count."
                    },
                    mask: {
                        type: "float",
                        description: "Visibility mask from the advanced slider mask array."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const ratio = context.output("classRatio", "float");
                const index = context.output("classIndex", "int");
                const mask = context.output("mask", "float");
                const threshold = this.control("threshold");
                const sampledRatio = threshold.sample(value, "float");
                const variableName = threshold.webGLVariableName;
                const breakCount = readBreakCount(this.getControlParam("threshold"));
                const maxIndex = Math.max(0, breakCount);
                const indexStatement = breakCount === 0 ?
                    `int ${index} = 0;` :
                    `int ${index} = int(clamp(floor(${ratio} * float(${breakCount}) + 0.5), 0.0, float(${maxIndex})));`;

                return {
                    statements: `
float ${ratio} = ${sampledRatio};
float ${mask} = sample_advanced_slider(${value}, ${variableName}_breaks, ${variableName}_mask, true, ${variableName}_min);
${indexStatement}
`,
                    outputs: {
                        classRatio: { type: "float", expr: ratio },
                        classIndex: { type: "int", expr: index },
                        mask: { type: "float", expr: mask }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that converts an integer class index to a normalized class ratio.
         */
        class ClassRatioFromIndexModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "class-ratio-from-index";
            }

            static name() {
                return "Class ratio from index";
            }

            static description() {
                return "Converts a zero-based class index to a normalized class ratio using params.classCount.";
            }

            static inputs() {
                return {
                    classIndex: {
                        type: "int",
                        required: true,
                        description: "Zero-based class index."
                    }
                };
            }

            static outputs() {
                return {
                    ratio: {
                        type: ["float"],
                        description: "Normalized class ratio."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Class index to ratio.",
                    description: "Converts classIndex to classIndex / max(classCount - 1, 1). This is useful when a downstream colormap control expects a normalized scalar instead of an integer index.",
                    kind: "shader-module",
                    params: {
                        classCount: "Positive integer class count. Defaults to 3."
                    },
                    inputs: [
                        { name: "classIndex", type: "int", required: true, description: "Zero-based class index." }
                    ],
                    outputs: [
                        { name: "ratio", type: "float", description: "Normalized class ratio." }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    ratio: {
                        type: "float",
                        description: "Normalized class ratio."
                    }
                };
            }

            compile(context) {
                const raw = Number.parseInt(this.params.classCount, 10);
                const classCount = Number.isInteger(raw) && raw > 0 ? raw : 3;
                const denominator = Math.max(1, classCount - 1);
                const classIndex = context.input("classIndex");
                const ratio = context.output("ratio", "float");

                return {
                    statements: `float ${ratio} = float(clamp(${classIndex}, 0, ${classCount - 1})) / float(${denominator});`,
                    outputs: {
                        ratio: { type: "float", expr: ratio }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that maps a scalar through a colormap or color control.
         */
        class ColormapColorizeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "colormap-colorize";
            }

            static name() {
                return "Colormap colorize";
            }

            static description() {
                return "Maps a scalar through a colormap/color control and returns vec4(color, alpha).";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value passed to the colormap control."
                    },
                    alpha: {
                        type: "float",
                        required: false,
                        description: "Optional output alpha. Defaults to 1.0."
                    }
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "Colormap RGBA color."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Scalar colormap mapping.",
                    description: "Samples a colormap/color control with the input value and returns vec4(mappedColor, alpha).",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar value passed to the colormap." },
                        { name: "alpha", type: "float", required: false, description: "Optional output alpha. Defaults to 1.0." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "Colormap RGBA color." }
                    ],
                    controls: [
                        {
                            name: "color",
                            ui: "colormap",
                            valueType: "vec3",
                            default: { default: "Viridis", steps: 3, mode: "sequential", continuous: false }
                        }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    color: {
                        default: {
                            type: "colormap",
                            steps: 3,
                            default: "Viridis",
                            mode: "sequential",
                            title: "Colormap",
                            continuous: false
                        },
                        accepts: (type) => type === "vec3"
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "Colormap RGBA color."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const alpha = context.input("alpha", "1.0");
                const out = context.output("color", "vec4");
                const rgb = this.control("color").sample(value, "float");

                return {
                    statements: `vec4 ${out} = vec4(${rgb}, ${alpha});`,
                    outputs: {
                        color: { type: "vec4", expr: out }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
