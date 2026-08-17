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
     *
     * Sampled values are put through an input window (`window_low`/`window_high`)
     * before being tinted. A decoder normalizes against the range a file *declares*,
     * which is the only thing it can honestly do -- so a channel whose samples occupy
     * a fraction of that range (12-bit data in a 16-bit container with no
     * SMaxSampleValue, a low-signal fluorescence channel, a float channel whose
     * interesting band is a slice of its total) arrives correct and unreadable. The
     * window is where that is recovered: it is a display transform, it stays live, and
     * it does not touch the data. Defaults `0`/`1` are the identity, so every existing
     * configuration renders exactly as before.
     */
    $.FlexRenderer.ShaderLayerRegistry.register(class SingleChannel extends $.FlexRenderer.ShaderLayer {

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
                description: "Samples one selected scalar channel, maps the input window onto [0,1], and multiplies the result by a configurable RGB color. Alpha is the windowed value, or 1.0 when `opaque` is set.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "Multi-channel TIFF/GeoTIFF (scalar channels)"
                }],
                controls: [
                    { name: "use_channel0", default: "r", description: "Single-channel swizzle used for sampling." },
                    { name: "color", ui: "color", valueType: "vec3", default: "#ff0000" },
                    { name: "window_low", ui: "range_input", valueType: "float", default: 0, min: -1, max: 1, step: 0.001, description: "Input value mapped to black. Raise it to lift a channel that uses only part of its declared range." },
                    { name: "window_high", ui: "range_input", valueType: "float", default: 1, min: -1, max: 1, step: 0.001, description: "Input value mapped to full intensity. Setting it below window_low inverts the channel." },
                    { name: "opaque", ui: "bool", valueType: "bool", default: false, description: "Output fully opaque alpha instead of the windowed value. Set it for a single grayscale layer with nothing beneath it; leave it off when several channels blend additively." },
                    { name: "threshold", ui: "range", valueType: "float", default: 0, min: 0, max: 1, step: 0.005, description: "Windowed values below this threshold are clamped to zero." }
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

                // Color for this channel. Red rather than magenta: an unconfigured
                // layer is most often seen over the default white canvas backdrop,
                // where magenta reads as an error state rather than as data.
                color: {
                    default: {
                        type: "color",
                        default: "#ff0000",
                        title: "Color"
                    },
                    accepts: (type) => type === "vec3"
                },

                // Input window, in the decoder's normalized units. The range spans
                // [-1,1] rather than [0,1] because signed sample formats normalize to
                // [-1,1]; for the ordinary unsigned case the negative half is simply
                // unused. Setting window_high below window_low inverts the channel,
                // which is what a WhiteIsZero plane wants.
                window_low: {  // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        default: 0,
                        min: -1,
                        max: 1,
                        step: 0.001,
                        title: "Window low"
                    },
                    accepts: (type) => type === "float"
                },

                window_high: {  // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        default: 1,
                        min: -1,
                        max: 1,
                        step: 0.001,
                        title: "Window high"
                    },
                    accepts: (type) => type === "float"
                },

                // Alpha semantics. `false` (default) is the historical output --
                // alpha = the windowed value -- which is what additive blending of
                // several tinted channels in a `group` needs. A LONE scalar layer
                // wants the opposite: the presentation canvas is cleared opaque
                // (white by default), so a low value blends toward the backdrop and
                // a white-tinted 12-bit slide renders as a blank frame. Opt in rather
                // than switch the default: every existing configuration must render
                // byte-identically.
                opaque: {
                    default: {
                        type: "bool",
                        default: false,
                        title: "Opaque"
                    },
                    accepts: (type) => type === "bool"
                },

                // Windowed values below this threshold are clamped to zero
                threshold: {
                    default: {
                        type: "range",
                        default: 0,
                        min: 0,
                        max: 1,
                        step: 0.005,
                        title: "Threshold"
                    },
                    accepts: (type) => type === "float"
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

    // Input window -> [0,1]. A degenerate span would divide by zero and paint the
    // whole layer; a negative one is a deliberate inversion and is left alone.
    float wlo = ${this.window_low.sample()};
    float wspan = ${this.window_high.sample()} - wlo;
    fv = clamp((fv - wlo) / (abs(wspan) < 1e-6 ? 1e-6 : wspan), 0.0, 1.0);

    if (fv < ${this.threshold.sample()}) {
        fv = 0.0;
    }
    vec3 col = fv * (${colorExpr});
    return vec4(col, ${this.opaque.sample()} ? 1.0 : fv);
`;
        }
    });

})(OpenSeadragon);
