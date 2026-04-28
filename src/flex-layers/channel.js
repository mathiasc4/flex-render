(function($) {

    /**
     * Single-channel fluorescence shader.
     *
     * Processes ONE logical channel from a multi-channel source.
     * You can stack multiple instances of this shader with different configs.
     *
     * Channel selection is standardized:
     *  - Swizzle pattern comes from use_channel0 (e.g. "r", "g", "rgba").
     *  - Base channel index comes from:
     *      1) use_channel_base0 in shader config, or inline "N:pattern"
     *         in use_channel0 (e.g. "7:r"), via ShaderLayer.resetChannel,
     *      2) fallback: config.channelIndex (legacy),
     *      3) fallback: 0.
     */
    $.FlexRenderer.ShaderMediator.registerLayer(class SingleChannel extends $.FlexRenderer.ShaderLayer {

        static type() {
            return "single_channel";
        }

        static name() {
            return "Single channel";
        }

        static description() {
            return "Render one selected TIFF channel with a custom color.";
        }

        static intent() {
            return "Extract one channel from a multi-channel raster and tint it. Pick when the source has multiple channels and you want exactly one of them rendered.";
        }

        static expects() {
            return { dataKind: "multi-channel", channels: "any" };
        }

        static exampleParams() {
            return { use_channel_base0: 0, color: "#ffffff" };  // eslint-disable-line camelcase
        }

        static docs() {
            return {
                summary: "Single-channel shader that colors one logical scalar channel.",
                description: "Samples one selected scalar channel and multiplies that scalar value by a configurable RGB color. Alpha is set to the sampled scalar value.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "Multi-channel TIFF/GeoTIFF (scalar channels)"
                }],
                controls: [
                    { name: "use_channel0", default: "r", description: "Single-channel swizzle used for sampling." },
                    { name: "color", ui: "color", valueType: "vec3", default: "#ff00ff" }
                ]
            };
        }

        // One source: multi-channel TIFF/GeoTIFF scalar channels
        static sources() {
            return [{
                // We treat each channel as a scalar; use_channel0 must be length 1.
                acceptsChannelCount: (n) => n === 1,
                description: "Multi-channel TIFF/GeoTIFF (scalar channels)"
            }];
        }

        static get defaultControls() {
            return {
                // We want a single scalar per sample: "r"
                use_channel0: {  // eslint-disable-line camelcase
                    default: "r"
                },

                // Color for this channel
                color: {
                    default: {
                        type: "color",
                        default: "#ff00ff",
                        title: "Color"
                    },
                    accepts: (type) => type === "vec3"
                }
            };
        }

        getFragmentShaderExecution() {
            const ch = this.getDefaultChannelBase();

            // Controls as GLSL expressions
            const colorExpr   = this.color.sample("1.0", "float");

            // todo avoid calling osd_* methods, use API calls e,g, $(this.channelCount(optionalIndex))
            return `
    if (${ch} < 0 || ${ch} >= osd_channel_count(0)) {
        return vec4(0.0);
    }

    float fv = ${this.sampleChannel("v_texture_coords")};
    vec3 col = fv * (${colorExpr});
    return vec4(col, fv);
`;
        }
    });

})(OpenSeadragon);
