(function($) {
    $.FlexRenderer.ShaderModuleMediator.registerModule(
        class SampleChannelModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "sample-channel";
            }

            static name() {
                return "Sample channel";
            }

            static description() {
                return "Samples one scalar channel from a configured shader source.";
            }

            static outputs() {
                return {
                    value: { type: "float" }
                };
            }

            static docs() {
                return {
                    summary: "Scalar source sampler.",
                    description: "Samples one configured source slot through ShaderLayer.sampleChannel(...).",
                    kind: "shader-module",
                    outputs: [{ name: "value", type: "float" }],
                    params: [
                        { name: "sourceIndex", type: "number", default: 0 },
                        { name: "channel", type: "string", default: "r" },
                        { name: "baseChannel", type: "number", default: 0 }
                    ]
                };
            }

            getSourceIndex() {
                const value = Number(this.params.sourceIndex);
                return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
            }

            getControlDefinitions() {
                const sourceIndex = this.getSourceIndex();
                const defs = {};

                defs[`use_channel${sourceIndex}`] = {
                    default: this.params.channel || "r"
                };

                defs[`use_channel_base${sourceIndex}`] = {
                    default: this.params.baseChannel || 0
                };

                return defs;
            }

            getControlParam(localName) {
                const sourceIndex = this.getSourceIndex();

                if (localName === `use_channel${sourceIndex}`) {
                    return this.params.channel;
                }

                if (localName === `use_channel_base${sourceIndex}`) {
                    return this.params.baseChannel;
                }

                return super.getControlParam(localName);
            }

            getSourceRequirements() {
                return [{
                    index: this.getSourceIndex(),
                    acceptsChannelCount: (n) => n === 1,
                    description: "Scalar source sampled by sample-channel module."
                }];
            }

            compile(context) {
                const out = context.output("value", "float");
                const sourceIndex = this.getSourceIndex();

                return {
                    statements: `
float ${out} = ${this.owner.sampleChannel("v_texture_coords", sourceIndex)};
`,
                    outputs: {
                        value: { type: "float", expr: out }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
