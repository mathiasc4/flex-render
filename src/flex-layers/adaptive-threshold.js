(function($) {

    $.FlexRenderer.ShaderLayerRegistry.register(class AdaptiveThreshold extends $.FlexRenderer.ShaderLayer {
        static type() {
            return "adaptive_threshold";
        }

        static name() {
            return "Adaptive threshold";
        }

        static description() {
            return "Local adaptive thresholding with mean or Gaussian-weighted neighborhood.";
        }

        static docs() {
            return {
                summary: "Adaptive threshold shader for a single scalar input channel.",
                description: "Computes a local statistic over a square neighborhood and compares the center sample against localStat - C. The neighborhood may be uniformly weighted or approximately Gaussian weighted.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "Single scalar channel / derived scalar field"
                }],
                controls: [
                    { name: "block_size", ui: "range_input", valueType: "float", default: 5, min: 3, max: 11, step: 2 },
                    { name: "c_value", ui: "range_input", valueType: "float", default: 0.03, min: -0.5, max: 0.5, step: 0.001 },
                    { name: "gaussian", ui: "bool", valueType: "bool", default: false },
                    { name: "invert", ui: "bool", valueType: "bool", default: false },
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
                // OpenCV-like block size, odd only
                block_size: {  // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        default: 5,
                        min: 3,
                        max: 11,
                        step: 2,
                        title: "Block size"
                    },
                    accepts: (type) => type === "float"
                },

                // Subtracted from local statistic: threshold = local - C
                c_value: {  // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        default: 0.03,
                        min: -0.5,
                        max: 0.5,
                        step: 0.001,
                        title: "C"
                    },
                    accepts: (type) => type === "float"
                },

                // false = mean, true = gaussian-weighted
                gaussian: {  // eslint-disable-line camelcase
                    default: {
                        type: "bool",
                        default: false,
                        title: "Gaussian"
                    },
                    accepts: (type) => type === "bool"
                },

                // false = BINARY, true = BINARY_INV
                invert: {  // eslint-disable-line camelcase
                    default: {
                        type: "bool",
                        default: false,
                        title: "Invert"
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

        getFragmentShaderDefinition() {
            const fnWeight = `adaptive_threshold_weight_${this.uid}`;
            return `
${super.getFragmentShaderDefinition()}

float ${fnWeight}(in float dx, in float dy, in float radius, in bool gaussianMode) {
    if (!gaussianMode) {
        return 1.0;
    }

    // Approximate Gaussian window from radius.
    float sigma = max(radius * 0.5, 0.8);
    float rr = dx * dx + dy * dy;
    return exp(-rr / (2.0 * sigma * sigma));
}
`;
        }

        getFragmentShaderExecution() {
            const ch = this.getDefaultChannelBase();
            const fnWeight = `adaptive_threshold_weight_${this.uid}`;

            // Your preferred form
            const texelSizeExpr =
                `vec2(1.0) / vec2(float(${this.getTextureSize()}.x), float(${this.getTextureSize()}.y))`;

            // Fixed compile-time bound; runtime block_size chooses active neighborhood inside it.
            // block_size max = 11 -> radius max = 5
            const MAX_RADIUS = 5;

            const sampleAt = (uvExpr) => this.sampleChannel(uvExpr);

            return `
    if (${ch} < 0 || ${ch} >= osd_channel_count(0)) {
        return vec4(0.0);
    }

    vec2 texelSize = ${texelSizeExpr};

    float blockSize = ${this.block_size.sample()};
    float radius = floor(blockSize * 0.5);
    float center = ${sampleAt("v_texture_coords")};

    float sum = 0.0;
    float wsum = 0.0;

    for (int iy = -${MAX_RADIUS}; iy <= ${MAX_RADIUS}; iy++) {
        for (int ix = -${MAX_RADIUS}; ix <= ${MAX_RADIUS}; ix++) {
            float dx = float(ix);
            float dy = float(iy);

            if (abs(dx) <= radius && abs(dy) <= radius) {
                vec2 uv = v_texture_coords + vec2(dx, dy) * texelSize;
                float s = ${sampleAt("uv")};
                float w = ${fnWeight}(dx, dy, radius, ${this.gaussian.sample()});

                sum += s * w;
                wsum += w;
            }
        }
    }

    float localStat = (wsum > 0.0) ? (sum / wsum) : center;
    float thresholdValue = localStat - ${this.c_value.sample()};
    float mask = step(thresholdValue, center);

    if (${this.invert.sample()}) {
        mask = 1.0 - mask;
    }

    vec3 color = mix(
        ${this.bg_color.sample()},
        ${this.fg_color.sample()},
        mask
    );

    return vec4(color, ${this.opacity.sample()});
`;
        }
    });

})(OpenSeadragon);
