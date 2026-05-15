(function($) {

    $.FlexRenderer.ShaderLayerRegistry.register(class Threshold extends $.FlexRenderer.ShaderLayer {

        static type() {
            return "threshold";
        }

        static name() {
            return "Threshold";
        }

        static description() {
            return "Global threshold preview with OpenCV-like threshold modes.";
        }

        static docs() {
            return {
                summary: "Global threshold shader for a single scalar input channel.",
                description: "Implements five threshold modes analogous to binary, binary inverse, truncation, to-zero, and to-zero inverse. Binary modes can optionally be colorized with foreground and background colors.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "Single scalar channel / derived scalar field"
                }],
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
                    },
                    { name: "colorize_binary", ui: "bool", valueType: "bool", default: true },
                    { name: "fg_color", ui: "color", valueType: "vec3", default: "#ffffff" },
                    { name: "bg_color", ui: "color", valueType: "vec3", default: "#000000" }
                ]
            };
        }

        static sources() {
            return [{
                acceptsChannelCount: (n) => n === 1,
                description: "Single scalar channel / derived scalar field"
            }];
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

                max_value: {  // eslint-disable-line camelcase
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
                },

                colorize_binary: {  // eslint-disable-line camelcase
                    default: {
                        type: "bool",
                        default: true,
                        title: "Colorize binary"
                    },
                    accepts: (type) => type === "bool"
                },

                fg_color: {  // eslint-disable-line camelcase
                    default: {
                        type: "color",
                        default: "#ffffff",
                        title: "Foreground"
                    },
                    accepts: (type) => type === "vec3"
                },

                bg_color: {  // eslint-disable-line camelcase
                    default: {
                        type: "color",
                        default: "#000000",
                        title: "Background"
                    },
                    accepts: (type) => type === "vec3"
                }
            };
        }

        getFragmentShaderExecution() {
            const ch = this.getDefaultChannelBase();

            return `
    if (${ch} < 0 || ${ch} >= osd_channel_count(0)) {
        return vec4(0.0);
    }

    float src = ${this.sampleChannel("v_texture_coords")};
    float thr = ${this.threshold.sample()};
    float maxv = ${this.max_value.sample()};
    int mode = int(${this.version.sample()});

    float outv;

    if (mode == 0) {               // THRESH_BINARY
        outv = src > thr ? maxv : 0.0;
    } else if (mode == 1) {        // THRESH_BINARY_INV
        outv = src > thr ? 0.0 : maxv;
    } else if (mode == 2) {        // THRESH_TRUNC
        outv = min(src, thr);
    } else if (mode == 3) {        // THRESH_TOZERO
        outv = src > thr ? src : 0.0;
    } else {                       // THRESH_TOZERO_INV
        outv = src > thr ? 0.0 : src;
    }

    // binary modes can be shown as fg/bg instead of grayscale
    if (${this.colorize_binary.sample()} && (mode == 0 || mode == 1)) {
        float m = maxv > 0.0 ? clamp(outv / maxv, 0.0, 1.0) : 0.0;
        vec3 color = mix(${this.bg_color.sample()}, ${this.fg_color.sample()}, m);
        return vec4(color, ${this.opacity.sample()});
    }

    return vec4(vec3(outv), ${this.opacity.sample()});
`;
        }
    });

})(OpenSeadragon);
