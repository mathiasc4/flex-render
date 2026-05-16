(function($) {
    $.FlexRenderer.ShaderModuleRegistry.register(
        class OpenCvThresholdModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "opencv-threshold";
            }

            static name() {
                return "OpenCV threshold";
            }

            static description() {
                return "Applies OpenCV-like global threshold modes to a scalar value.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar source value."
                    }
                };
            }

            static outputs() {
                return {
                    value: {
                        type: ["float"],
                        description: "Thresholded scalar value."
                    },
                    mode: {
                        type: ["int"],
                        description: "Selected threshold mode."
                    },
                    maxValue: {
                        type: ["float"],
                        description: "Configured maximum output value."
                    },
                    binaryMode: {
                        type: ["bool"],
                        description: "True for Binary and Binary inverse modes."
                    }
                };
            }

            static docs() {
                return {
                    summary: "OpenCV-style threshold transform.",
                    description: "Implements Binary, Binary inverse, Trunc, To zero, and To zero inverse modes.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar source value." }
                    ],
                    outputs: [
                        { name: "value", type: "float", description: "Thresholded scalar value." },
                        { name: "mode", type: "int", description: "Selected mode index." },
                        { name: "maxValue", type: "float", description: "Maximum value control." },
                        { name: "binaryMode", type: "bool", description: "Whether the selected mode is binary." }
                    ],
                    controls: [
                        { name: "threshold", ui: "range", valueType: "float", default: 0.5, min: 0, max: 1, step: 0.005 },
                        { name: "max_value", ui: "range", valueType: "float", default: 1, min: 0, max: 1, step: 0.005 },
                        {
                            name: "version",
                            ui: "select",
                            valueType: "int",
                            default: 0,
                            options: [
                                { value: 0, label: "Binary" },
                                { value: 1, label: "Binary inv" },
                                { value: 2, label: "Trunc" },
                                { value: 3, label: "To zero" },
                                { value: 4, label: "To zero inv" }
                            ]
                        }
                    ]
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
                    },
                    max_value: { // eslint-disable-line camelcase
                        default: {
                            type: "range",
                            default: 1.0,
                            min: 0,
                            max: 1,
                            step: 0.005,
                            title: "Max value"
                        },
                        accepts: (type) => type === "float"
                    },
                    version: {
                        default: {
                            type: "select",
                            default: 0,
                            title: "Mode",
                            options: [
                                { value: 0, label: "Binary" },
                                { value: 1, label: "Binary inv" },
                                { value: 2, label: "Trunc" },
                                { value: 3, label: "To zero" },
                                { value: 4, label: "To zero inv" }
                            ]
                        },
                        accepts: (type) => type === "int"
                    }
                };
            }

            getInputDefinitions() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar source value."
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    value: {
                        type: "float",
                        description: "Thresholded scalar value."
                    },
                    mode: {
                        type: "int",
                        description: "Selected threshold mode."
                    },
                    maxValue: {
                        type: "float",
                        description: "Configured maximum output value."
                    },
                    binaryMode: {
                        type: "bool",
                        description: "True for Binary and Binary inverse modes."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const out = context.output("value", "float");
                const mode = context.output("mode", "int");
                const maxValue = context.output("maxValue", "float");
                const binaryMode = context.output("binaryMode", "bool");
                const threshold = this.control("threshold").sample();
                const maxValueControl = this.control("max_value").sample();
                const modeControl = this.control("version").sample();

                return {
                    statements: `
float ${out}_src = ${value};
float ${out}_thr = ${threshold};
float ${maxValue} = ${maxValueControl};
int ${mode} = int(${modeControl});
float ${out};
if (${mode} == 0) {
    ${out} = ${out}_src > ${out}_thr ? ${maxValue} : 0.0;
} else if (${mode} == 1) {
    ${out} = ${out}_src > ${out}_thr ? 0.0 : ${maxValue};
} else if (${mode} == 2) {
    ${out} = min(${out}_src, ${out}_thr);
} else if (${mode} == 3) {
    ${out} = ${out}_src > ${out}_thr ? ${out}_src : 0.0;
} else {
    ${out} = ${out}_src > ${out}_thr ? 0.0 : ${out}_src;
}
bool ${binaryMode} = (${mode} == 0 || ${mode} == 1);
`,
                    outputs: {
                        value: { type: "float", expr: out },
                        mode: { type: "int", expr: mode },
                        maxValue: { type: "float", expr: maxValue },
                        binaryMode: { type: "bool", expr: binaryMode }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
