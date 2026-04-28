(function($) {
/**
 * Identity shader
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                required: "rgba"
            }
        };
    }

    static type() {
        return "identity";
    }

    static name() {
        return "Identity";
    }

    static description() {
        return "shows the data AS-IS";
    }

    static intent() {
        return "Pass the source through with optional channel swizzle. Pick to render the raw image.";
    }

    static expects() {
        return { dataKind: "rgb", channels: "any" };
    }

    static exampleParams() {
        return {};
    }

    static docs() {
        return {
            summary: "Identity shader for four-channel input.",
            description: "Samples the input texture directly and returns the sampled RGBA value unchanged.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [4],
                description: "4d texture to render AS-IS"
            }],
            controls: [
                { name: "use_channel0", required: "rgba", description: "Required RGBA swizzle for direct passthrough sampling." }
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 4,
            description: "4d texture to render AS-IS"
        }];
    }

    getFragmentShaderExecution() {
        return `
    return ${this.sampleChannel("v_texture_coords")};`;
    }
});
})(OpenSeadragon);
