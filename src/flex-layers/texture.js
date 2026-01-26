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
            {
                acceptsChannelCount: (x) => x === 4,
                description: "texture colors",
            },
        ];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                default: "rgba",
            },
            use_channel1: {  // eslint-disable-line camelcase
                default: "rgba",
            },
            addTexture: {
                default: { type: "image" },
                accepts: (type, instance) => type === "int",
            },
        };
    }

    getFragmentShaderExecution() {
        return `
vec4 chan0 = ${this.sampleChannel('v_texture_coords', 0)};
vec4 chan1;

int textureId = ${this.addTexture.sample()};

if (textureId < 0) {
    chan1 = vec4(1.0);
} else {
    chan1 = ${this.sampleAtlasChannel('textureId', 'v_texture_coords', 1)};
}

return blendAlpha(chan0, chan1, min(chan0.rgb, chan1.rgb));
`;
    }
});

})(OpenSeadragon);
