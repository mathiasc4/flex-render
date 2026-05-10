(function($) {
    /**
     * Return the supplied value when it is a finite number, otherwise a fallback.
     *
     * @private
     * @param {*} value - Candidate numeric value.
     * @param {number} fallback - Value used when candidate is not finite.
     * @returns {number} Finite numeric value.
     */
    function finiteNumber(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    /**
     * Read a positive integer module parameter.
     *
     * @private
     * @param {ShaderModule} module - Module instance.
     * @param {string} name - Parameter name.
     * @param {number} fallback - Default value used when the parameter is absent.
     * @returns {number} Positive integer value.
     * @throws {Error} Thrown when the parameter is present but invalid.
     */
    function readPositiveIntegerParam(module, name, fallback) {
        const raw = module.params[name];

        if (raw === undefined || raw === null) { // eslint-disable-line eqeqeq
            return fallback;
        }

        const value = Number.parseInt(raw, 10);
        if (!Number.isInteger(value) || value < 1 || String(value) !== String(raw).trim()) {
            throw new Error(`${module.constructor.name}: params.${name} must be a positive integer.`);
        }

        return value;
    }

    /**
     * Analyze a positive integer module parameter without throwing.
     *
     * @private
     * @param {ShaderModuleAnalysisContext} context - Module analysis context.
     * @param {ShaderModule} module - Module instance.
     * @param {string} name - Parameter name.
     * @param {number} fallback - Default value used when the parameter is absent.
     * @returns {{ok: boolean, value: number}} Analysis result.
     */
    function analyzePositiveIntegerParam(context, module, name, fallback) {
        const raw = module.params[name];

        if (raw === undefined || raw === null) { // eslint-disable-line eqeqeq
            return {
                ok: true,
                value: fallback
            };
        }

        const value = Number.parseInt(raw, 10);
        if (!Number.isInteger(value) || value < 1 || String(value) !== String(raw).trim()) {
            context.error({
                code: "invalid-positive-integer-param",
                message: `${module.constructor.name}: params.${name} must be a positive integer.`,
                path: context.paramPath(name),
                details: {
                    paramName: name,
                    value: raw
                }
            });

            return {
                ok: false,
                value: fallback
            };
        }

        return {
            ok: true,
            value
        };
    }

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that inverts a float mask.
         */
        class MaskNotModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "mask-not";
            }

            static name() {
                return "Mask not";
            }

            static description() {
                return "Inverts a normalized float mask.";
            }

            static inputs() {
                return {
                    mask: {
                        type: "float",
                        required: true,
                        description: "Mask value to invert. Values are clamped to [0, 1]."
                    }
                };
            }

            static outputs() {
                return {
                    mask: {
                        type: ["float"],
                        description: "Inverted mask value."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Invert a float mask.",
                    description: "Returns 1.0 - clamp(mask, 0.0, 1.0).",
                    kind: "shader-module",
                    inputs: [
                        {
                            name: "mask",
                            type: "float",
                            required: true,
                            description: "Mask value to invert."
                        }
                    ],
                    outputs: [
                        {
                            name: "mask",
                            type: "float",
                            description: "Inverted mask value."
                        }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    mask: {
                        type: "float",
                        description: "Inverted mask value."
                    }
                };
            }

            compile(context) {
                const mask = context.input("mask");
                const out = context.output("mask", "float");

                return {
                    statements: `float ${out} = 1.0 - clamp(${mask}, 0.0, 1.0);`,
                    outputs: {
                        mask: { type: "float", expr: out }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that multiplies two float masks.
         */
        class MaskMultiplyModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "mask-multiply";
            }

            static name() {
                return "Mask multiply";
            }

            static description() {
                return "Combines two masks by multiplying their clamped values.";
            }

            static inputs() {
                return {
                    a: {
                        type: "float",
                        required: true,
                        description: "First mask."
                    },
                    b: {
                        type: "float",
                        required: true,
                        description: "Second mask."
                    }
                };
            }

            static outputs() {
                return {
                    mask: {
                        type: ["float"],
                        description: "Combined mask value."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Multiply two float masks.",
                    description: "Returns clamp(a, 0.0, 1.0) * clamp(b, 0.0, 1.0).",
                    kind: "shader-module",
                    inputs: [
                        { name: "a", type: "float", required: true, description: "First mask." },
                        { name: "b", type: "float", required: true, description: "Second mask." }
                    ],
                    outputs: [
                        { name: "mask", type: "float", description: "Combined mask value." }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    mask: {
                        type: "float",
                        description: "Combined mask value."
                    }
                };
            }

            compile(context) {
                const a = context.input("a");
                const b = context.input("b");
                const out = context.output("mask", "float");

                return {
                    statements: `float ${out} = clamp(${a}, 0.0, 1.0) * clamp(${b}, 0.0, 1.0);`,
                    outputs: {
                        mask: { type: "float", expr: out }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that selects between two float inputs using a mask.
         */
        class SelectFloatModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "select-float";
            }

            static name() {
                return "Select float";
            }

            static description() {
                return "Selects or blends between two float values using a mask.";
            }

            static inputs() {
                return {
                    mask: {
                        type: "float",
                        required: true,
                        description: "Selection mask. Values are clamped to [0, 1]."
                    },
                    falseValue: {
                        type: "float",
                        required: true,
                        description: "Value used when mask is 0.0."
                    },
                    trueValue: {
                        type: "float",
                        required: true,
                        description: "Value used when mask is 1.0."
                    }
                };
            }

            static outputs() {
                return {
                    value: {
                        type: ["float"],
                        description: "Selected float value."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Select between two float values.",
                    description: "Returns mix(falseValue, trueValue, clamp(mask, 0.0, 1.0)). This can express conditional scalar operations without creating layer-specific modules.",
                    kind: "shader-module",
                    inputs: [
                        { name: "mask", type: "float", required: true, description: "Selection mask." },
                        { name: "falseValue", type: "float", required: true, description: "Value used when mask is 0.0." },
                        { name: "trueValue", type: "float", required: true, description: "Value used when mask is 1.0." }
                    ],
                    outputs: [
                        { name: "value", type: "float", description: "Selected float value." }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    value: {
                        type: "float",
                        description: "Selected float value."
                    }
                };
            }

            compile(context) {
                const mask = context.input("mask");
                const falseValue = context.input("falseValue");
                const trueValue = context.input("trueValue");
                const out = context.output("value", "float");

                return {
                    statements: `float ${out} = mix(${falseValue}, ${trueValue}, clamp(${mask}, 0.0, 1.0));`,
                    outputs: {
                        value: { type: "float", expr: out }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that applies one OpenCV-like threshold mode to a scalar value.
         */
        class ThresholdModeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "threshold-mode";
            }

            static name() {
                return "Threshold mode";
            }

            static description() {
                return "Applies binary, binary inverse, truncation, to-zero, or to-zero inverse thresholding.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to threshold."
                    }
                };
            }

            static outputs() {
                return {
                    value: {
                        type: ["float"],
                        description: "Thresholded scalar value."
                    },
                    mask: {
                        type: ["float"],
                        description: "Binary visibility mask derived from the thresholded value."
                    }
                };
            }

            static docs() {
                return {
                    summary: "OpenCV-like scalar threshold mode.",
                    description: "Applies binary, binary inverse, truncation, to-zero, or to-zero inverse thresholding. The output value matches the selected mode; mask is 1.0 when the output value is non-zero.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar value to threshold." }
                    ],
                    outputs: [
                        { name: "value", type: "float", description: "Thresholded scalar value." },
                        { name: "mask", type: "float", description: "Binary visibility mask derived from the thresholded value." }
                    ],
                    controls: [
                        { name: "threshold", ui: "range", valueType: "float", default: 0.5, min: 0, max: 1, step: 0.005 },
                        { name: "max_value", ui: "range", valueType: "float", default: 1, min: 0, max: 1, step: 0.005 },
                        { name: "mode", ui: "select", valueType: "int", default: 0 }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    threshold: {
                        default: {
                            type: "range",
                            default: 0.5,
                            min: 0,
                            max: 1,
                            step: 0.005,
                            title: "Threshold"
                        },
                        accepts: (type) => type === "float"
                    },
                    max_value: { // eslint-disable-line camelcase
                        default: {
                            type: "range",
                            default: 1.0,
                            min: 0,
                            max: 1,
                            step: 0.005,
                            title: "Max value"
                        },
                        accepts: (type) => type === "float"
                    },
                    mode: {
                        default: {
                            type: "select",
                            default: 0,
                            title: "Mode",
                            options: [
                                { value: 0, label: "Binary" },
                                { value: 1, label: "Binary inv" },
                                { value: 2, label: "Trunc" },
                                { value: 3, label: "To zero" },
                                { value: 4, label: "To zero inv" }
                            ]
                        },
                        accepts: (type) => type === "int"
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    value: {
                        type: "float",
                        description: "Thresholded scalar value."
                    },
                    mask: {
                        type: "float",
                        description: "Binary visibility mask derived from the thresholded value."
                    }
                };
            }

            compile(context) {
                const src = context.input("value");
                const value = context.output("value", "float");
                const mask = context.output("mask", "float");
                const threshold = this.control("threshold").sample();
                const maxValue = this.control("max_value").sample();
                const mode = this.control("mode").sample();

                return {
                    statements: `
float ${value};
int ${this.uid}_mode = int(${mode});
if (${this.uid}_mode == 0) {
    ${value} = ${src} > ${threshold} ? ${maxValue} : 0.0;
} else if (${this.uid}_mode == 1) {
    ${value} = ${src} > ${threshold} ? 0.0 : ${maxValue};
} else if (${this.uid}_mode == 2) {
    ${value} = min(${src}, ${threshold});
} else if (${this.uid}_mode == 3) {
    ${value} = ${src} > ${threshold} ? ${src} : 0.0;
} else {
    ${value} = ${src} > ${threshold} ? 0.0 : ${src};
}
float ${mask} = step(1e-6, abs(${value}));
`,
                    outputs: {
                        value: { type: "float", expr: value },
                        mask: { type: "float", expr: mask }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that maps a binary mask to foreground and background colors.
         */
        class BinaryPaletteModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "binary-palette";
            }

            static name() {
                return "Binary palette";
            }

            static description() {
                return "Converts a mask into a foreground/background RGBA color.";
            }

            static inputs() {
                return {
                    mask: {
                        type: "float",
                        required: true,
                        description: "Binary or normalized mask selecting the foreground color."
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
                        description: "RGBA foreground/background color."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Foreground/background color mapping.",
                    description: "Maps a normalized mask to mix(bg_color, fg_color, mask) and uses an optional alpha input for the output alpha.",
                    kind: "shader-module",
                    inputs: [
                        { name: "mask", type: "float", required: true, description: "Mask selecting foreground color." },
                        { name: "alpha", type: "float", required: false, description: "Optional output alpha. Defaults to 1.0." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "RGBA foreground/background color." }
                    ],
                    controls: [
                        { name: "fg_color", ui: "color", valueType: "vec3", default: "#ffffff" },
                        { name: "bg_color", ui: "color", valueType: "vec3", default: "#000000" }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    fg_color: { // eslint-disable-line camelcase
                        default: {
                            type: "color",
                            default: "#ffffff",
                            title: "Foreground"
                        },
                        accepts: (type) => type === "vec3"
                    },
                    bg_color: { // eslint-disable-line camelcase
                        default: {
                            type: "color",
                            default: "#000000",
                            title: "Background"
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
                        description: "RGBA foreground/background color."
                    }
                };
            }

            compile(context) {
                const mask = context.input("mask");
                const alpha = context.input("alpha", "1.0");
                const color = context.output("color", "vec4");
                const fg = this.control("fg_color").sample();
                const bg = this.control("bg_color").sample();

                return {
                    statements: `vec4 ${color} = vec4(mix(${bg}, ${fg}, clamp(${mask}, 0.0, 1.0)), ${alpha});`,
                    outputs: {
                        color: { type: "vec4", expr: color }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that maps a scalar to grayscale RGBA output.
         */
        class GrayscaleColorizeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "grayscale-colorize";
            }

            static name() {
                return "Grayscale colorize";
            }

            static description() {
                return "Converts a scalar value into a grayscale vec4 color.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar grayscale intensity."
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
                        description: "Grayscale RGBA color."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Scalar to grayscale color.",
                    description: "Returns vec4(vec3(value), alpha). Alpha defaults to 1.0.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar grayscale intensity." },
                        { name: "alpha", type: "float", required: false, description: "Optional output alpha. Defaults to 1.0." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "Grayscale RGBA color." }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "Grayscale RGBA color."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const alpha = context.input("alpha", "1.0");
                const out = context.output("color", "vec4");

                return {
                    statements: `vec4 ${out} = vec4(vec3(${value}), ${alpha});`,
                    outputs: {
                        color: { type: "vec4", expr: out }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that measures distance and side relative to a midpoint.
         */
        class MidpointDistanceModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "midpoint-distance";
            }

            static name() {
                return "Midpoint distance";
            }

            static description() {
                return "Computes signed side and normalized distance from a configurable midpoint.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to compare against the midpoint."
                    }
                };
            }

            static outputs() {
                return {
                    magnitude: {
                        type: ["float"],
                        description: "Distance from the midpoint, scaled so an endpoint has magnitude near 1.0."
                    },
                    sign: {
                        type: ["float"],
                        description: "-1.0 below midpoint, 1.0 above midpoint, 0.0 at midpoint."
                    },
                    lowMask: {
                        type: ["float"],
                        description: "1.0 when value is below midpoint."
                    },
                    highMask: {
                        type: ["float"],
                        description: "1.0 when value is above midpoint."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Distance from midpoint.",
                    description: "Computes a reusable centered-scalar representation for diverging heatmaps and difference maps.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar value to compare against midpoint." }
                    ],
                    outputs: [
                        { name: "magnitude", type: "float", description: "Scaled distance from midpoint." },
                        { name: "sign", type: "float", description: "-1.0 below midpoint, 1.0 above midpoint, 0.0 at midpoint." },
                        { name: "lowMask", type: "float", description: "Mask for values below midpoint." },
                        { name: "highMask", type: "float", description: "Mask for values above midpoint." }
                    ],
                    controls: [
                        { name: "midpoint", ui: "range", valueType: "float", default: 0.5, min: 0, max: 1, step: 0.005 }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    midpoint: {
                        default: {
                            type: "range",
                            default: 0.5,
                            min: 0,
                            max: 1,
                            step: 0.005,
                            title: "Midpoint"
                        },
                        accepts: (type) => type === "float"
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    magnitude: {
                        type: "float",
                        description: "Distance from the midpoint, scaled so an endpoint has magnitude near 1.0."
                    },
                    sign: {
                        type: "float",
                        description: "-1.0 below midpoint, 1.0 above midpoint, 0.0 at midpoint."
                    },
                    lowMask: {
                        type: "float",
                        description: "1.0 when value is below midpoint."
                    },
                    highMask: {
                        type: "float",
                        description: "1.0 when value is above midpoint."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const magnitude = context.output("magnitude", "float");
                const sign = context.output("sign", "float");
                const lowMask = context.output("lowMask", "float");
                const highMask = context.output("highMask", "float");
                const midpoint = this.control("midpoint").sample();

                return {
                    statements: `
float ${this.uid}_delta = ${value} - ${midpoint};
float ${this.uid}_scale = max(max(${midpoint}, 1.0 - ${midpoint}), 1e-6);
float ${magnitude} = abs(${this.uid}_delta) / ${this.uid}_scale;
float ${sign} = sign(${this.uid}_delta);
float ${lowMask} = 1.0 - step(0.0, ${this.uid}_delta);
float ${highMask} = step(0.0, ${this.uid}_delta) * step(1e-6, abs(${this.uid}_delta));
`,
                    outputs: {
                        magnitude: { type: "float", expr: magnitude },
                        sign: { type: "float", expr: sign },
                        lowMask: { type: "float", expr: lowMask },
                        highMask: { type: "float", expr: highMask }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that colors centered scalar magnitude with low and high colors.
         */
        class DivergingColorizeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "diverging-colorize";
            }

            static name() {
                return "Diverging colorize";
            }

            static description() {
                return "Colorizes a centered scalar magnitude using separate low and high colors.";
            }

            static inputs() {
                return {
                    magnitude: {
                        type: "float",
                        required: true,
                        description: "Distance from the midpoint used as intensity and alpha."
                    },
                    sign: {
                        type: "float",
                        required: true,
                        description: "Centered side. Negative values use colorLow, positive values use colorHigh."
                    },
                    mask: {
                        type: "float",
                        required: false,
                        description: "Optional visibility mask. Defaults to 1.0."
                    }
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "Diverging RGBA color."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Diverging scalar colorization.",
                    description: "Maps magnitude and sign to colorLow/colorHigh with alpha = clamp(magnitude * mask, 0.0, 1.0).",
                    kind: "shader-module",
                    inputs: [
                        { name: "magnitude", type: "float", required: true, description: "Distance from midpoint." },
                        { name: "sign", type: "float", required: true, description: "Centered side." },
                        { name: "mask", type: "float", required: false, description: "Optional visibility mask." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "Diverging RGBA color." }
                    ],
                    controls: [
                        { name: "colorHigh", ui: "color", valueType: "vec3", default: "#ff1000" },
                        { name: "colorLow", ui: "color", valueType: "vec3", default: "#01ff00" }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    colorHigh: {
                        default: {
                            type: "color",
                            default: "#ff1000",
                            title: "Color high"
                        },
                        accepts: (type) => type === "vec3"
                    },
                    colorLow: {
                        default: {
                            type: "color",
                            default: "#01ff00",
                            title: "Color low"
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
                        description: "Diverging RGBA color."
                    }
                };
            }

            compile(context) {
                const magnitude = context.input("magnitude");
                const sign = context.input("sign");
                const mask = context.input("mask", "1.0");
                const out = context.output("color", "vec4");
                const high = this.control("colorHigh").sample(magnitude, "float");
                const low = this.control("colorLow").sample(magnitude, "float");

                return {
                    statements: `
float ${this.uid}_alpha = clamp(${magnitude} * ${mask}, 0.0, 1.0);
vec3 ${this.uid}_rgb = mix(${low}, ${high}, step(0.0, ${sign}));
vec4 ${out} = vec4(${this.uid}_rgb, ${this.uid}_alpha);
`,
                    outputs: {
                        color: { type: "vec4", expr: out }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that converts a class index to a normalized class ratio.
         */
        class ClassIndexToRatioModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "class-index-to-ratio";
            }

            static name() {
                return "Class index to ratio";
            }

            static description() {
                return "Converts an integer class index to a normalized ratio in [0, 1].";
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
                    summary: "Class index to normalized ratio.",
                    description: "Converts an integer class index to index / max(classCount - 1, 1). params.classCount controls the denominator and defaults to 2.",
                    kind: "shader-module",
                    params: {
                        classCount: "Positive integer class count. Defaults to 2."
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

            analyze(context) {
                analyzePositiveIntegerParam(context, this, "classCount", 2);
                return super.analyze(context);
            }

            compile(context) {
                const classIndex = context.input("classIndex");
                const classCount = readPositiveIntegerParam(this, "classCount", 2);
                const ratio = context.output("ratio", "float");
                const maxIndex = Math.max(1, classCount - 1);

                return {
                    statements: `float ${ratio} = float(clamp(${classIndex}, 0, ${classCount - 1})) / float(${maxIndex});`,
                    outputs: {
                        ratio: { type: "float", expr: ratio }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that emits a numeric float constant.
         */
        class FloatConstantModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "float-constant";
            }

            static name() {
                return "Float constant";
            }

            static description() {
                return "Emits a compile-time float literal from params.value.";
            }

            static outputs() {
                return {
                    value: {
                        type: ["float"],
                        description: "Float literal value."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Float constant.",
                    description: "Emits a float literal from params.value. Useful for select-float branches and fixed alpha values.",
                    kind: "shader-module",
                    params: {
                        value: "Number emitted as a GLSL float literal. Defaults to 0.0."
                    },
                    outputs: [
                        { name: "value", type: "float", description: "Float literal value." }
                    ]
                };
            }

            getOutputDefinitions() {
                return {
                    value: {
                        type: "float",
                        description: "Float literal value."
                    }
                };
            }

            compile(context) {
                const raw = finiteNumber(this.params.value, 0);
                const value = context.output("value", "float");

                return {
                    statements: `float ${value} = ${Number(raw).toFixed(8)};`,
                    outputs: {
                        value: { type: "float", expr: value }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Compatibility alias for select-float using a conditional naming convention.
         */
        class ConditionalFloatModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "conditional-float";
            }

            static name() {
                return "Conditional float";
            }

            static description() {
                return "Selects or blends between two float values using a mask.";
            }

            static inputs() {
                return {
                    condition: {
                        type: "float",
                        required: true,
                        description: "Selection condition. Values are clamped to [0, 1]."
                    },
                    falseValue: {
                        type: "float",
                        required: true,
                        description: "Value used when condition is 0.0."
                    },
                    trueValue: {
                        type: "float",
                        required: true,
                        description: "Value used when condition is 1.0."
                    }
                };
            }

            static outputs() {
                return {
                    value: {
                        type: ["float"],
                        description: "Selected float value."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Conditional float selection.",
                    description: "Returns mix(falseValue, trueValue, clamp(condition, 0.0, 1.0)). This is an alias-style generalization of heatmap inverse value handling.",
                    kind: "shader-module",
                    inputs: [
                        { name: "condition", type: "float", required: true, description: "Selection condition." },
                        { name: "falseValue", type: "float", required: true, description: "Value used when condition is 0.0." },
                        { name: "trueValue", type: "float", required: true, description: "Value used when condition is 1.0." }
                    ],
                    outputs: [
                        { name: "value", type: "float", description: "Selected float value." }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    value: {
                        type: "float",
                        description: "Selected float value."
                    }
                };
            }

            compile(context) {
                const condition = context.input("condition");
                const falseValue = context.input("falseValue");
                const trueValue = context.input("trueValue");
                const out = context.output("value", "float");

                return {
                    statements: `float ${out} = mix(${falseValue}, ${trueValue}, clamp(${condition}, 0.0, 1.0));`,
                    outputs: {
                        value: { type: "float", expr: out }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Compatibility alias for binary-palette using colorize terminology.
         */
        class BinaryColorizeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "binary-colorize";
            }

            static name() {
                return "Binary colorize";
            }

            static description() {
                return "Converts a mask into a foreground/background RGBA color.";
            }

            static inputs() {
                return {
                    mask: {
                        type: "float",
                        required: true,
                        description: "Binary or normalized mask selecting the foreground color."
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
                        description: "RGBA foreground/background color."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Binary foreground/background colorization.",
                    description: "Alias-style module for binary-palette. Maps a normalized mask to mix(bg_color, fg_color, mask).",
                    kind: "shader-module",
                    inputs: [
                        { name: "mask", type: "float", required: true, description: "Mask selecting foreground color." },
                        { name: "alpha", type: "float", required: false, description: "Optional output alpha. Defaults to 1.0." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "RGBA foreground/background color." }
                    ],
                    controls: [
                        { name: "fg_color", ui: "color", valueType: "vec3", default: "#ffffff" },
                        { name: "bg_color", ui: "color", valueType: "vec3", default: "#000000" }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    fg_color: { // eslint-disable-line camelcase
                        default: {
                            type: "color",
                            default: "#ffffff",
                            title: "Foreground"
                        },
                        accepts: (type) => type === "vec3"
                    },
                    bg_color: { // eslint-disable-line camelcase
                        default: {
                            type: "color",
                            default: "#000000",
                            title: "Background"
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
                        description: "RGBA foreground/background color."
                    }
                };
            }

            compile(context) {
                const mask = context.input("mask");
                const alpha = context.input("alpha", "1.0");
                const color = context.output("color", "vec4");
                const fg = this.control("fg_color").sample();
                const bg = this.control("bg_color").sample();

                return {
                    statements: `vec4 ${color} = vec4(mix(${bg}, ${fg}, clamp(${mask}, 0.0, 1.0)), ${alpha});`,
                    outputs: {
                        color: { type: "vec4", expr: color }
                    }
                };
            }
        }
    );

})(OpenSeadragon);
