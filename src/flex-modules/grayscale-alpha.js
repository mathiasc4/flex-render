(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class GrayscaleAlphaModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "grayscale-alpha";
            }

            static name() {
                return "Grayscale alpha";
            }

            static description() {
                return "Builds a grayscale vec4 from a scalar value with optional alpha and opacity controls.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value used for RGB."
                    },
                    alpha: {
                        type: "float",
                        required: false,
                        description: "Base alpha. If omitted, alpha is 1.0."
                    }
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "RGBA grayscale color."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Render a scalar as grayscale.",
                    description: "Useful as the final display module for scalar transforms such as Sobel edge strength.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar RGB value." },
                        { name: "alpha", type: "float", required: false, description: "Base alpha; defaults to 1.0." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "RGBA grayscale color." }
                    ],
                    controls: [
                        { name: "opacity", ui: "range", valueType: "float", default: 1, min: 0, max: 1, step: 0.1 }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    opacity: {
                        default: {
                            type: "range",
                            default: 1,
                            min: 0,
                            max: 1,
                            step: 0.1,
                            title: "Opacity"
                        },
                        accepts: (type) => type === "float"
                    }
                };
            }

            getInputDefinitions() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value used for RGB."
                    },
                    alpha: {
                        type: "float",
                        required: false,
                        description: "Base alpha. If omitted, alpha is 1.0."
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "RGBA grayscale color."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const alpha = context.input("alpha", "1.0");
                const out = context.output("color", "vec4");
                const opacity = this.control("opacity").sample();

                return {
                    statements: `
vec4 ${out} = vec4(vec3(${value}), (${alpha}) * (${opacity}));
`,
                    outputs: {
                        color: { type: "vec4", expr: out }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
