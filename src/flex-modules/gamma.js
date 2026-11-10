(function ($) {

    $.FlexRenderer.ShaderModuleRegistry.register(
        class GammaModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "gamma";
            }

            static name() {
                return "Gamma";
            }

            static description() {
                return "Applies a gamma curve, rgb^(1/gamma), to a color. Alpha is kept. Identity at gamma 1.";
            }

            static inputs() {
                return {
                    color: {
                        type: "vec4",
                        required: true,
                        description: "RGBA color to apply a gamma filter to."
                    },
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "RGBA color produced."
                    },
                    adjusted: {
                        type: ["vec4"],
                        description: "Legacy alias of 'color'."
                    },
                };
            }

            getInputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        required: true,
                        description: "RGBA color to apply a gamma filter to."
                    },
                };
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "RGBA color produced."
                    },
                    adjusted: {
                        type: "vec4",
                        description: "Legacy alias of 'color'."
                    },
                };
            }

            static get defaultControls() {
                return {
                    gamma: {
                        default: {
                            type: "range",
                            default: 1,
                            min: 0.1,
                            max: 10,
                            step: 0.05,
                            title: "Gamma",
                        },
                        accepts: (type) => type === "float"
                    },
                };
            }

            compile(context) {
                const color = context.input("color");
                const output = context.output("color", "vec4");
                // De-normalized: the range control uploads (v-min)/(max-min). The domain floor
                // (0.1) keeps the division away from zero.
                const gamma = this.sampleValue("gamma");

                return {
                    statements: `
    vec4 ${output} = vec4(pow(max((${color}).rgb, vec3(0.0)), vec3(1.0 / max(${gamma}, 1e-4))), (${color}).a);
`,
                    outputs: {
                        color: {
                            type: "vec4",
                            expr: output,
                        },
                        adjusted: {
                            type: "vec4",
                            expr: output,
                        },
                    },
                };
            }
        }
    );

})(OpenSeadragon);
