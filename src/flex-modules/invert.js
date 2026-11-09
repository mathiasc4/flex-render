(function ($) {

    $.FlexRenderer.ShaderModuleRegistry.register(
        class HeatmapModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "invert";
            }

            static name() {
                return "Invert";
            }

            static description() {
                return "Inverts RGB and keeps alpha.";
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
                    inverted: {
                        type: ["vec4"],
                        description: "RGBA color produced by inverting the input."
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
                    inverted: {
                        type: "vec4",
                        description: "RGBA color produced by inverting the input."
                    },
                };
            }

            compile(context) {
                const color = context.input("color");
                const output = context.output("inverted", "vec4");

                return {
                    statements: `
    vec4 color = ${color};
    vec4 ${output} = vec4(1.0 - color.rbg, color.a);
`,
                    outputs: {
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
