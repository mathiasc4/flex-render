(function ($) {

    $.FlexRenderer.ShaderModuleRegistry.register(
        class HeatmapModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "gamma";
            }

            static name() {
                return "Gamma";
            }

            static description() {
                return "Applies a gamma filter to a color.";
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
                    adjusted: {
                        type: ["vec4"],
                        description: "RGBA color produced."
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
                    adjusted: {
                        type: "vec4",
                        description: "RGBA color produced."
                    },
                };
            }

            static get defaultControls() {
                return {
                    gamma: {
                        default: {
                            type: "range_input",
                            default: 1,
                            min: 0,
                            max: 10,
                            step: 0.1,
                            title: "Gamma",
                        },
                        accepts: (type) => type === "float"
                    },
                };
            }

            compile(context) {
                const color = context.input("color");
                const output = context.output("inverted", "vec4");

                const gamma = this.control("gamma").sample();

                return {
                    statements: `
    vec4 color = ${color};
    vec4 ${output} = vec4(pow(color.rgb, vec3(1.0 / ${gamma})), color.a);
`,
                    outputs: {
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
