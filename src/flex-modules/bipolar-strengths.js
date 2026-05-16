(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class BipolarStrengthsModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "bipolar-strengths";
            }

            static name() {
                return "Bipolar strengths";
            }

            static description() {
                return "Splits a centered scalar around 0.5 into thresholded low-side and high-side alpha strengths.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Centered scalar value where 0.5 is neutral."
                    }
                };
            }

            static outputs() {
                return {
                    lowAlpha: {
                        type: ["float"],
                        description: "Alpha contribution for values below 0.5."
                    },
                    highAlpha: {
                        type: ["float"],
                        description: "Alpha contribution for values above 0.5."
                    },
                    alpha: {
                        type: ["float"],
                        description: "Combined alpha contribution."
                    },
                    side: {
                        type: ["float"],
                        description: "-1.0 for visible low-side values, 1.0 for visible high-side values, 0.0 otherwise."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Compute diverging heatmap strengths.",
                    description: "Values below 0.5 and above 0.5 are converted to distance-from-midpoint strengths. The owning layer's scalar filter chain is applied to the derived strength before thresholding.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Centered scalar value." }
                    ],
                    outputs: [
                        { name: "lowAlpha", type: "float", description: "Thresholded low-side alpha." },
                        { name: "highAlpha", type: "float", description: "Thresholded high-side alpha." },
                        { name: "alpha", type: "float", description: "max(lowAlpha, highAlpha)." },
                        { name: "side", type: "float", description: "Visible side indicator." }
                    ],
                    controls: [
                        { name: "threshold", ui: "range_input", valueType: "float", default: 1, min: 1, max: 100, step: 1 }
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
                    }
                };
            }

            getInputDefinitions() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Centered scalar value where 0.5 is neutral."
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    lowAlpha: {
                        type: "float",
                        description: "Alpha contribution for values below 0.5."
                    },
                    highAlpha: {
                        type: "float",
                        description: "Alpha contribution for values above 0.5."
                    },
                    alpha: {
                        type: "float",
                        description: "Combined alpha contribution."
                    },
                    side: {
                        type: "float",
                        description: "-1.0 for visible low-side values, 1.0 for visible high-side values, 0.0 otherwise."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const lowAlpha = context.output("lowAlpha", "float");
                const highAlpha = context.output("highAlpha", "float");
                const alpha = context.output("alpha", "float");
                const side = context.output("side", "float");
                const rawLow = `(1.0 - (${value}) * 2.0)`;
                const rawHigh = `(((${value}) - 0.5) * 2.0)`;
                const filteredLow = this.owner && typeof this.owner.filter === "function" ?
                    this.owner.filter(rawLow) : rawLow;
                const filteredHigh = this.owner && typeof this.owner.filter === "function" ?
                    this.owner.filter(rawHigh) : rawHigh;
                const strength = `${alpha}_strength`;
                const threshold = this.control("threshold").sample(strength, "float");

                return {
                    statements: `
float ${lowAlpha} = 0.0;
float ${highAlpha} = 0.0;
float ${strength} = 0.0;
if (abs((${value}) - 0.5) > 0.000001) {
    if ((${value}) < 0.5) {
        ${strength} = ${filteredLow};
        ${lowAlpha} = ${strength} > ${threshold} ? ${strength} : 0.0;
    } else {
        ${strength} = ${filteredHigh};
        ${highAlpha} = ${strength} > ${threshold} ? ${strength} : 0.0;
    }
}
float ${alpha} = max(${lowAlpha}, ${highAlpha});
float ${side} = ${highAlpha} > 0.0 ? 1.0 : (${lowAlpha} > 0.0 ? -1.0 : 0.0);
`,
                    outputs: {
                        lowAlpha: { type: "float", expr: lowAlpha },
                        highAlpha: { type: "float", expr: highAlpha },
                        alpha: { type: "float", expr: alpha },
                        side: { type: "float", expr: side }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
