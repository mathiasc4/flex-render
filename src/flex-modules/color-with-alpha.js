(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class ColorWithAlphaModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "color-with-alpha";
            }

            static name() {
                return "Color with alpha";
            }

            static description() {
                return "Builds a vec4 from a vec3 color control sampled by a scalar value and a scalar alpha input.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value used when sampling color controls such as colormaps."
                    },
                    alpha: {
                        type: "float",
                        required: false,
                        description: "Output opacity. If omitted, value is used."
                    }
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "RGBA color built as vec4(sampledColor, alpha)."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Tint a scalar with an explicit alpha.",
                    description: "Unlike colorize, this module does not multiply the RGB color by the scalar value. The scalar is only passed to controls that need it, such as colormap controls.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar color-sampling value." },
                        { name: "alpha", type: "float", required: false, description: "Output opacity; defaults to value." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "RGBA color." }
                    ],
                    controls: [
                        { name: "color", ui: "color|colormap|custom_colormap", valueType: "vec3", default: "#fff700" }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    color: {
                        default: {
                            type: "color",
                            default: "#fff700",
                            title: "Color"
                        },
                        accepts: (type) => type === "vec3"
                    }
                };
            }

            getInputDefinitions() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value used when sampling color controls such as colormaps."
                    },
                    alpha: {
                        type: "float",
                        required: false,
                        description: "Output opacity. If omitted, value is used."
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "RGBA color built as vec4(sampledColor, alpha)."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const alpha = context.input("alpha", value);
                const out = context.output("color", "vec4");
                const color = this.control("color").sample(value, "float");

                return {
                    statements: `
vec4 ${out} = vec4(${color}, ${alpha});
`,
                    outputs: {
                        color: { type: "vec4", expr: out }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
