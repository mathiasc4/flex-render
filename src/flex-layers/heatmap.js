(function($) {
/**
 * Heatmap Shader
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "heatmap";
    }

    static name() {
        return "Heatmap";
    }

    static description() {
        return "encode data values in opacity";
    }

    static intent() {
        return "Tint a single scalar channel and gate it with a threshold. Pick to highlight \"above/below value\" regions.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        return { color: "#fff700", threshold: 50, inverse: false };
    }

    static docs() {
        return {
            summary: "Heatmap shader for one scalar channel.",
            description: "Uses the sampled scalar value as alpha and colors visible pixels with a configurable RGB control once the sampled value passes the threshold. In inverted mode, values below the threshold are shown with full alpha while values above the threshold are inverted.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [1],
                description: "The value to map to opacity"
            }],
            controls: [
                { name: "use_channel0", default: "r" },
                { name: "color", ui: "color", valueType: "vec3", default: "#fff700" },
                { name: "threshold", ui: "range_input", valueType: "float", default: 1, min: 1, max: 100, step: 1 },
                { name: "inverse", ui: "bool", valueType: "bool", default: false }
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "The value to map to opacity"
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                default: "r"
            },
            color: {
                default: {type: "color", default: "#fff700", title: "Color: "},
                accepts: (type, instance) => type === "vec3",
            },
            threshold: {
                default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
                accepts: (type, instance) => type === "float"
            },
            inverse: {
                default: {type: "bool", default: false, title: "Invert: "},
                accepts: (type, instance) => type === "bool"
            }
        };
    }

    getFragmentShaderExecution() {
        return `
float chan = ${this.sampleChannel('v_texture_coords')};
bool shows = chan >= ${this.threshold.sample('chan', 'float')};
if (${this.inverse.sample()}) {
    if (!shows) {
        shows = true;
        chan = 1.0;
    } else chan = 1.0 - chan;
}
if (shows) return vec4(${this.color.sample('chan', 'float')}, chan);
return vec4(.0);
`;
    }
});

})(OpenSeadragon);
