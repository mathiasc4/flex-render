(function($) {
    $.FlexRenderer.ShaderModuleMediator.registerModule(
        class ColorizeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "colorize";
            }

            static name() {
                return "Colorize";
            }

            static description() {
                return "Converts a scalar value and alpha inputs into a vec4 color.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar intensity used to scale the selected color."
                    },
                    alpha: {
                        type: "float",
                        required: false,
                        description: "Optional opacity value. If omitted, the scalar value input is also used as alpha."
                    }
                };
            }

            static outputs() {
                return {
                    color: {
                        type: "vec4",
                        description: "RGBA color produced as vec4(color * value, alpha)."
                    }
                };
            }

            static get defaultControls() {
                return {
                    color: {
                        default: {
                            type: "color",
                            default: "#00ffff",
                            title: "Color"
                        },
                        accepts: (type) => type === "vec3"
                    }
                };
            }

            static docs() {
                return {
                    summary: "Scalar colorization module.",
                    description: "Builds vec4(color * value, alpha). If alpha is not connected, value is also used as alpha.",
                    kind: "shader-module",
                    inputs: [
                        {
                            name: "value",
                            type: "float",
                            required: true,
                            description: "Scalar intensity used to scale the selected color."
                        },
                        {
                            name: "alpha",
                            type: "float",
                            required: false,
                            description: "Optional opacity value. If omitted, the scalar value input is also used as alpha."
                        }
                    ],
                    outputs: [
                        {
                            name: "color",
                            type: "vec4",
                            description: "RGBA color produced as vec4(color * value, alpha)."
                        }
                    ],
                    controls: [
                        { name: "color", ui: "color", valueType: "vec3", default: "#00ffff" }
                    ]
                };
            }

            compile(context) {
                const value = context.input("value");
                const alpha = context.input("alpha", value);
                const out = context.output("color", "vec4");
                const color = this.control("color").sample(value, "float");

                return {
                    statements: `
vec4 ${out} = vec4((${color}) * ${value}, ${alpha});
`,
                    outputs: {
                        color: { type: "vec4", expr: out }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
