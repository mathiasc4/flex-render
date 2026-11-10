(function ($) {

    $.FlexRenderer.ShaderModuleRegistry.register(
        class InvertModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "invert";
            }

            static name() {
                return "Invert";
            }

            static description() {
                return "Inverts RGB and keeps alpha: mix(rgb, 1 - rgb, amount). The default amount 1 is a full " +
                    "inversion; amount 0 is the identity.";
            }

            static inputs() {
                return {
                    color: {
                        type: "vec4",
                        required: true,
                        description: "RGBA color to be inverted."
                    },
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "RGBA color produced by inverting the input."
                    },
                    inverted: {
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
                        description: "RGBA color to be inverted."
                    },
                };
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "RGBA color produced by inverting the input."
                    },
                    inverted: {
                        type: "vec4",
                        description: "Legacy alias of 'color'."
                    },
                };
            }

            static get defaultControls() {
                return {
                    amount: {
                        default: {
                            type: "range",
                            default: 1,
                            min: 0,
                            max: 1,
                            step: 0.01,
                            title: "Invert",
                        },
                        accepts: (type) => type === "float"
                    },
                };
            }

            compile(context) {
                const color = context.input("color");
                const output = context.output("color", "vec4");
                const amount = this.sampleValue("amount");

                return {
                    statements: `
    vec4 ${output} = vec4(mix((${color}).rgb, vec3(1.0) - (${color}).rgb, ${amount}), (${color}).a);
`,
                    outputs: {
                        color: {
                            type: "vec4",
                            expr: output,
                        },
                        inverted: {
                            type: "vec4",
                            expr: output,
                        },
                    },
                };
            }
        }
    );

})(OpenSeadragon);
