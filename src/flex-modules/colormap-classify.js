(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class ColormapClassifyModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "colormap-classify";
            }

            static name() {
                return "Colormap classify";
            }

            static description() {
                return "Maps a scalar through a colormap-like vec3 control and an advanced-slider mask.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to map and mask."
                    }
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "RGBA colormap output."
                    },
                    mask: {
                        type: ["float"],
                        description: "Visibility mask sampled from the threshold control."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Discrete colormap classification.",
                    description: "Samples a scalar through a colormap/custom_colormap/color control and uses an advanced slider threshold as an alpha mask. This module intentionally omits the legacy layer's connect lifecycle hook; set colormap steps and threshold breaks consistently in params.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar value." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "RGBA mapped color." },
                        { name: "mask", type: "float", description: "Threshold mask." }
                    ],
                    controls: [
                        { name: "color", ui: "colormap|custom_colormap|color", valueType: "vec3", default: { default: "Viridis", steps: 3, mode: "sequential", continuous: false } },
                        { name: "threshold", ui: "advanced_slider", valueType: "float", default: { default: [0.25, 0.75], mask: [1, 0, 1] } }
                    ],
                    notes: [
                        "For class maps, keep color.steps equal to threshold.breaks.length + 1."
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
                    },
                    threshold: {
                        default: {
                            type: "advanced_slider",
                            default: [0.25, 0.75],
                            mask: [1, 0, 1],
                            title: "Breaks",
                            pips: {
                                mode: "positions",
                                values: [0, 35, 50, 75, 90, 100],
                                density: 4
                            }
                        },
                        accepts: (type) => type === "float",
                        required: { type: "advanced_slider", inverted: false }
                    }
                };
            }

            getInputDefinitions() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to map and mask."
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "RGBA colormap output."
                    },
                    mask: {
                        type: "float",
                        description: "Visibility mask sampled from the threshold control."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const out = context.output("color", "vec4");
                const mask = context.output("mask", "float");
                const color = this.control("color").sample(value, "float");
                const threshold = this.control("threshold").sample(value, "float");

                return {
                    statements: `
float ${mask} = step(0.05, ${threshold});
vec4 ${out} = vec4(${color}, ${mask});
`,
                    outputs: {
                        color: { type: "vec4", expr: out },
                        mask: { type: "float", expr: mask }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
