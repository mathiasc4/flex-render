(function($) {
/**
 * Bi-colors shader
 * data reference must contain one index to the data to render using bipolar heatmap strategy
 *
 * supported parameters:
 *  colorHigh - color to fill-in areas with high values (-->255), url encoded '#ffffff' format or digits only 'ffffff', default "#ff0000"
 *  colorLow - color to fill-in areas with low values (-->0), url encoded '#ffffff' format or digits only 'ffffff', default "#7cfc00"
 *  ctrlColor - whether to allow color modification, true or false, default true
 *  ctrlThreshold - whether to allow threshold modification, true or false, default true
 *  ctrlOpacity - whether to allow opacity modification, true or false, default true
 *
 * this shader considers insignificant values to be around the middle (0.5), and significant are low or high values,
 * the value itself is encoded in opacity (close to 1 if too low or too high), user can define two colors, for low and high values respectively
 */

$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "bipolar-heatmap";
    }

    static name() {
        return "Bi-polar Heatmap";
    }

    static description() {
        return "values are of two categories, smallest considered in the middle";
    }

    static intent() {
        return "Render diverging scalar data with separate colors above and below the midpoint (0.5). Pick for signed/centered values.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        return { colorHigh: "#ff1000", colorLow: "#01ff00", threshold: 1 };
    }

    static docs() {
        return {
            summary: "Diverging heatmap shader for a single scalar input channel.",
            description: "Treats values around 0.5 as insignificant and maps values below and above 0.5 to separate colors. Opacity is derived from the distance from the midpoint after filtering and threshold comparison.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [1],
                description: "1D diverging data encoded in opacity"
            }],
            controls: [
                { name: "colorHigh", ui: "color", valueType: "vec3", default: "#ff1000" },
                { name: "colorLow", ui: "color", valueType: "vec3", default: "#01ff00" },
                { name: "threshold", ui: "range_input", valueType: "float", default: 1, min: 1, max: 100, step: 1 }
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "1D diverging data encoded in opacity"
        }];
    }

    static get defaultControls() {
        return {
            colorHigh: {
                default: {type: "color", default: "#ff1000", title: "Color High: "},
                accepts: (type, instance) => type === "vec3",
            },
            colorLow: {
                default: {type: "color", default: "#01ff00", title: "Color Low: "},
                accepts: (type, instance) => type === "vec3"
            },
            threshold: {
                default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
                accepts: (type, instance) => type === "float"
            },
        };
    }

    getFragmentShaderExecution() {
        return `
    float chan = ${this.sampleChannel('v_texture_coords', 0, true)};
    if (!close(chan, .5)) {
        if (chan < .5) {
            chan = ${this.filter(`1.0 - chan * 2.0`)};
            if (chan > ${this.threshold.sample('chan', 'float')}) {
               return vec4(${this.colorLow.sample('chan', 'float')}, chan);
            }
            return vec4(.0);
        }

        chan = ${this.filter(`(chan - 0.5) * 2.0`)};
        if (chan > ${this.threshold.sample('chan', 'float')}) {
            return vec4(${this.colorHigh.sample('chan', 'float')}, chan);
        }
        return vec4(.0);
    }
`;
    }
});

})(OpenSeadragon);
