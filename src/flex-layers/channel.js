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
                        title: "Channel color"
                    },
                    accepts: (type) => type === "vec3"
                }
            };
        }

        getFragmentShaderExecution() {
            const ch = this.getDefaultChannelBase();

            // Controls as GLSL expressions
            const enabledExpr = this.enabled.sample();
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
