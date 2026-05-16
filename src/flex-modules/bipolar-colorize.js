(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class BipolarColorizeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "bipolar-colorize";
            }

            static name() {
                return "Bipolar colorize";
            }

            static description() {
                return "Converts low-side and high-side scalar alpha strengths into a two-color diverging vec4 output.";
            }

            static inputs() {
                return {
                    lowAlpha: {
                        type: "float",
                        required: true,
                        description: "Alpha contribution for the low color."
                    },
                    highAlpha: {
                        type: "float",
                        required: true,
                        description: "Alpha contribution for the high color."
                    }
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "RGBA diverging heatmap color."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Render low/high diverging strengths.",
                    description: "Uses colorLow when lowAlpha is visible and colorHigh when highAlpha is visible. Alpha is max(lowAlpha, highAlpha).",
                    kind: "shader-module",
                    inputs: [
                        { name: "lowAlpha", type: "float", required: true, description: "Low-side alpha." },
                        { name: "highAlpha", type: "float", required: true, description: "High-side alpha." }
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
                            title: "Color High"
                        },
                        accepts: (type) => type === "vec3"
                    },
                    colorLow: {
                        default: {
                            type: "color",
                            default: "#01ff00",
                            title: "Color Low"
                        },
                        accepts: (type) => type === "vec3"
                    }
                };
            }

            getInputDefinitions() {
                return {
                    lowAlpha: {
                        type: "float",
                        required: true,
                        description: "Alpha contribution for the low color."
                    },
                    highAlpha: {
                        type: "float",
                        required: true,
                        description: "Alpha contribution for the high color."
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "RGBA diverging heatmap color."
                    }
                };
            }

            compile(context) {
                const lowAlpha = context.input("lowAlpha");
                const highAlpha = context.input("highAlpha");
                const out = context.output("color", "vec4");
                const alpha = `${out}_alpha`;
                const color = `${out}_rgb`;
                const colorHigh = this.control("colorHigh").sample(highAlpha, "float");
                const colorLow = this.control("colorLow").sample(lowAlpha, "float");

                return {
                    statements: `
float ${alpha} = max(${lowAlpha}, ${highAlpha});
vec3 ${color} = ${highAlpha} > ${lowAlpha} ? ${colorHigh} : ${colorLow};
vec4 ${out} = ${alpha} > 0.0 ? vec4(${color}, ${alpha}) : vec4(0.0);
`,
                    outputs: {
                        color: { type: "vec4", expr: out }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
