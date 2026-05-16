(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class ThresholdAlphaGateModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "threshold-alpha-gate";
            }

            static name() {
                return "Threshold alpha gate";
            }

            static description() {
                return "Converts a scalar value into heatmap-style alpha using a threshold and optional inverse mode.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to test and convert to alpha."
                    }
                };
            }

            static outputs() {
                return {
                    alpha: {
                        type: ["float"],
                        description: "Alpha value after threshold gating."
                    },
                    visible: {
                        type: ["bool"],
                        description: "True when the value contributes visible output."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Heatmap alpha thresholding.",
                    description: "Matches the legacy heatmap visibility rule: values above threshold are shown with alpha equal to the value. In inverse mode, values below the threshold become fully opaque and values above threshold use inverted alpha.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar value to gate." }
                    ],
                    outputs: [
                        { name: "alpha", type: "float", description: "Gated alpha." },
                        { name: "visible", type: "bool", description: "Visibility predicate." }
                    ],
                    controls: [
                        { name: "threshold", ui: "range_input", valueType: "float", default: 1, min: 1, max: 100, step: 1 },
                        { name: "inverse", ui: "bool", valueType: "bool", default: false }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    threshold: {
                        default: {
                            type: "range_input",
                            default: 1,
                            min: 1,
                            max: 100,
                            step: 1,
                            title: "Threshold"
                        },
                        accepts: (type) => type === "float"
                    },
                    inverse: {
                        default: {
                            type: "bool",
                            default: false,
                            title: "Invert"
                        },
                        accepts: (type) => type === "bool"
                    }
                };
            }

            getInputDefinitions() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to test and convert to alpha."
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    alpha: {
                        type: "float",
                        description: "Alpha value after threshold gating."
                    },
                    visible: {
                        type: "bool",
                        description: "True when the value contributes visible output."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const alpha = context.output("alpha", "float");
                const visible = context.output("visible", "bool");
                const work = `${alpha}_value`;
                const threshold = this.control("threshold").sample(work, "float");
                const inverse = this.control("inverse").sample();

                return {
                    statements: `
float ${work} = ${value};
bool ${visible} = ${work} >= ${threshold};
if (${inverse}) {
    if (!${visible}) {
        ${visible} = true;
        ${work} = 1.0;
    } else {
        ${work} = 1.0 - ${work};
    }
}
float ${alpha} = ${visible} ? ${work} : 0.0;
`,
                    outputs: {
                        alpha: { type: "float", expr: alpha },
                        visible: { type: "bool", expr: visible }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
