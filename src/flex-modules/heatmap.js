(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class HeatmapModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "heatmap";
            }

            static name() {
                return "Heatmap";
            }

            static description() {
                return "Encode data values as opacity.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Data value to be encoded."
                    },
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "RGBA color produced as vec4(color * value, alpha)."
                    }
                };
            }

            static get defaultControls() {
                return {
                    color: {
                        default: {
                            type: "color",
                            default: "#00ffff",
                            title: "Color"
                        },
                        accepts: (type) => type === "vec3"
                    },
                    threshold: {
                        default: {
                            type: "range_input",
                            default: 1,
                            min: 1,
                            max: 100,
                            step: 1,
                            title: "Threshold",
                        },
                        accepts: (type) => type === "float"
                    },
                    inverse: {
                        default: {
                            type: "bool",
                            default: false,
                            title: "Invert",
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
                        description: "Data value to be encoded."
                    },
                };
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "RGBA color produced as vec4(color, value)."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const output = context.output("color", "vec4");
                const color = this.control("color").sample(value, "float");
                const threshold = this.control("threshold").sample(value, "float");
                const inverse = this.control("inverse").sample(value, "bool");

                return {
                    statements: `
bool shows = ${value} >= ${threshold};

if (${inverse}) {
    if (!shows) {
        shows = true;
        ${value} = 1.0;
    } else {
        ${value} = 1.0 - ${value};
    }
}

vec4 ${output};

if (shows) {
    ${output} = vec4(${color}, ${value});
} else {
    ${output} = vec4(0.0);
}
`,
                    outputs: {
                        color: { type: "vec4", expr: output }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
