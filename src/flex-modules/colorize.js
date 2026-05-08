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
                return "Converts scalar value and alpha inputs into a vec4 color.";
            }

            static inputs() {
                return {
                    value: { type: "float", required: true },
                    alpha: { type: "float", required: false }
                };
            }

            static outputs() {
                return {
                    color: { type: "vec4" }
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

            static docs() {
                return {
                    summary: "Scalar colorization module.",
                    description: "Builds vec4(color * value, alpha). If alpha is not connected, value is also used as alpha.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float" },
                        { name: "alpha", type: "float", required: false }
                    ],
                    outputs: [{ name: "color", type: "vec4" }],
                    controls: [
                        { name: "color", ui: "color", valueType: "vec3", default: "#fff700" }
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
