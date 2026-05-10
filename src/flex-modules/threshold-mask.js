(function($) {
    $.FlexRenderer.ShaderModuleMediator.registerModule(
        class ThresholdMaskModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "threshold-mask";
            }

            static name() {
                return "Threshold mask";
            }

            static description() {
                return "Converts a scalar value into a binary float mask.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value compared against the threshold control."
                    }
                };
            }

            static outputs() {
                return {
                    mask: {
                        type: "float",
                        description: "Binary mask value: 1.0 when value is greater than or equal to the threshold, otherwise 0.0."
                    }
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
                    }
                };
            }

            static docs() {
                return {
                    summary: "Binary threshold module.",
                    description: "Returns 1.0 when value >= threshold, otherwise 0.0.",
                    kind: "shader-module",
                    inputs: [
                        {
                            name: "value",
                            type: "float",
                            required: true,
                            description: "Scalar value compared against the threshold control."
                        }
                    ],
                    outputs: [
                        {
                            name: "mask",
                            type: "float",
                            description: "Binary mask value: 1.0 when value is greater than or equal to the threshold, otherwise 0.0."
                        }
                    ],
                    controls: [
                        { name: "threshold", ui: "range", valueType: "float", default: 0.5 }
                    ]
                };
            }

            compile(context) {
                const value = context.input("value");
                const out = context.output("mask", "float");
                const threshold = this.control("threshold").sample();

                return {
                    statements: `
float ${out} = ${value} >= ${threshold} ? 1.0 : 0.0;
`,
                    outputs: {
                        mask: { type: "float", expr: out }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
