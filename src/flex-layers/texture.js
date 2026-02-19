(function($) {
/**
 * Shader that uses a texture via a texture atlas
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {
    static type() {
        return "texture";
    }

    static name() {
        return "Texture";
    }

    static description() {
        return "use a texture via texture atlas";
    }

    static sources() {
        return [
            {
                acceptsChannelCount: (x) => x === 4,
                description: "first pass colors",
            },
        ];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                default: "rgba",
            },
            texture: {
                default: { type: "image" },
                accepts: (type, instance) => type === "vec4",
            },
        };
    }

    getFragmentShaderExecution() {
        return `
vec4 chan = ${this.sampleChannel('v_texture_coords', 0)};
vec4 tex = ${this.texture.sample('v_texture_coords * 2.0', 'vec2')};

return blendAlpha(chan, tex, min(chan.rgb, tex.rgb));
`;
    }
});

})(OpenSeadragon);
