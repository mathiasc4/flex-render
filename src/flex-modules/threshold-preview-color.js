(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class ThresholdPreviewColorModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "threshold-preview-color";
            }

            static name() {
                return "Threshold preview color";
            }

            static description() {
                return "Displays a thresholded scalar as grayscale or as binary foreground/background colors.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Thresholded scalar value to display."
                    },
                    mode: {
                        type: "int",
                        required: false,
                        description: "Threshold mode. Binary modes 0 and 1 can be colorized."
                    },
                    maxValue: {
                        type: "float",
                        required: false,
                        description: "Maximum threshold value used to normalize binary colorization."
                    },
                    binaryMode: {
                        type: "bool",
                        required: false,
                        description: "Explicit binary-mode flag. If omitted, mode 0 or 1 is treated as binary."
                    }
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "RGBA threshold preview color."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Colorize threshold output.",
                    description: "For binary modes, optionally maps the thresholded value to foreground/background colors. Otherwise returns grayscale with opacity.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Thresholded scalar value." },
                        { name: "mode", type: "int", required: false, description: "Threshold mode index." },
                        { name: "maxValue", type: "float", required: false, description: "Maximum value for binary normalization." },
                        { name: "binaryMode", type: "bool", required: false, description: "Binary mode flag." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "RGBA color." }
                    ],
                    controls: [
                        { name: "colorize_binary", ui: "bool", valueType: "bool", default: true },
                        { name: "fg_color", ui: "color", valueType: "vec3", default: "#ffffff" },
                        { name: "bg_color", ui: "color", valueType: "vec3", default: "#000000" },
                        { name: "opacity", ui: "range", valueType: "float", default: 1, min: 0, max: 1, step: 0.1 }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    colorize_binary: { // eslint-disable-line camelcase
                        default: {
                            type: "bool",
                            default: true,
                            title: "Colorize binary"
                        },
                        accepts: (type) => type === "bool"
                    },
                    fg_color: { // eslint-disable-line camelcase
                        default: {
                            type: "color",
                            default: "#ffffff",
                            title: "Foreground"
                        },
                        accepts: (type) => type === "vec3"
                    },
                    bg_color: { // eslint-disable-line camelcase
                        default: {
                            type: "color",
                            default: "#000000",
                            title: "Background"
                        },
                        accepts: (type) => type === "vec3"
                    },
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
                        description: "Thresholded scalar value to display."
                    },
                    mode: {
                        type: "int",
                        required: false,
                        description: "Threshold mode. Binary modes 0 and 1 can be colorized."
                    },
                    maxValue: {
                        type: "float",
                        required: false,
                        description: "Maximum threshold value used to normalize binary colorization."
                    },
                    binaryMode: {
                        type: "bool",
                        required: false,
                        description: "Explicit binary-mode flag. If omitted, mode 0 or 1 is treated as binary."
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "RGBA threshold preview color."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const mode = context.input("mode", "-1");
                const maxValue = context.input("maxValue", "1.0");
                const binaryMode = context.input("binaryMode", `((${mode}) == 0 || (${mode}) == 1)`);
                const out = context.output("color", "vec4");
                const opacity = this.control("opacity").sample();
                const colorizeBinary = this.control("colorize_binary").sample();
                const fgColor = this.control("fg_color").sample();
                const bgColor = this.control("bg_color").sample();
                const mixValue = `${out}_mix`;
                const binaryColor = `${out}_binary`;

                return {
                    statements: `
vec4 ${out};
if (${colorizeBinary} && ${binaryMode}) {
    float ${mixValue} = (${maxValue}) > 0.0 ? clamp((${value}) / (${maxValue}), 0.0, 1.0) : 0.0;
    vec3 ${binaryColor} = mix(${bgColor}, ${fgColor}, ${mixValue});
    ${out} = vec4(${binaryColor}, ${opacity});
} else {
    ${out} = vec4(vec3(${value}), ${opacity});
}
`,
                    outputs: {
                        color: { type: "vec4", expr: out }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
