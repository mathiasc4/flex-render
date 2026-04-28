(function($) {
/**
 * Threshold edge shader with derivative-aware smoothing.
 *
 * Operates only through the public sample(...) contract of the threshold control.
 * A plain range behaves like a single threshold, while advanced controls can provide
 * more complex sampled behavior without this shader caring about their internals.
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "edge";
    }

    static name() {
        return "Edge";
    }

    static description() {
        return "highlights threshold boundaries with separate inner and outer styling";
    }

    static docs() {
        return {
            summary: "Derivative-aware threshold edge shader for one scalar input channel.",
            description: "Detects threshold-boundary crossings over a local neighborhood by evaluating a signed field derived from value - threshold.sample(value). Keeps adjustable edge thickness, works with any float threshold control, and renders lower-side and higher-side boundaries with separate colors.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [1],
                description: "1D scalar data to detect threshold edges on"
            }],
            controls: [
                { name: "use_channel0", default: "r" },
                {
                    name: "threshold",
                    ui: "range_input",
                    valueType: "float",
                    default: 50,
                    min: 1,
                    max: 100,
                    step: 1,
                    description: "Any float-producing threshold control. Advanced sliders are supported through their sample() behavior."
                },
                { name: "outer_color", ui: "color", valueType: "vec3", default: "#fff700" },
                { name: "inner_color", ui: "color", valueType: "vec3", default: "#b2a800" },
                { name: "edgeThickness", ui: "range", valueType: "float", default: 1, min: 0.5, max: 3, step: 0.1 }
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "1D scalar data to detect threshold edges on"
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: { // eslint-disable-line camelcase
                default: "r"
            },
            threshold: {
                default: { type: "range_input", default: 50, min: 1, max: 100, step: 1, title: "Threshold: " },
                accepts: (type) => type === "float",
            },
            outer_color: { // eslint-disable-line camelcase
                default: { type: "color", default: "#fff700", title: "Outer color: " },
                accepts: (type) => type === "vec3"
            },
            inner_color: { // eslint-disable-line camelcase
                default: { type: "color", default: "#b2a800", title: "Inner color: " },
                accepts: (type) => type === "vec3"
            },
            edgeThickness: {
                default: { type: "range", default: 1, min: 0.5, max: 3, step: 0.1, title: "Edge thickness: " },
                accepts: (type) => type === "float"
            },
        };
    }

    getFragmentShaderDefinition() {
        const uid = this.uid;

        return `
${super.getFragmentShaderDefinition()}

float edge_softness_${uid}(float centerScore, float neighborhoodMin, float neighborhoodMax) {
    float localSpan = max(neighborhoodMax - neighborhoodMin, 0.0);
    float derivSpan = abs(dFdx(centerScore)) + abs(dFdy(centerScore));
    return max(0.01, max(localSpan * 0.35, derivSpan * 2.0));
}

float edge_crossing_${uid}(float neighborhoodMin, float neighborhoodMax, float softness) {
    float low = smoothstep(-softness, 0.0, neighborhoodMax);
    float high = 1.0 - smoothstep(0.0, softness, neighborhoodMin);
    return clamp(low * high, 0.0, 1.0);
}`;
    }

    getFragmentShaderExecution() {
        const uid = this.uid;

        return `
    float mid = ${this.sampleChannel("v_texture_coords")};
    if (mid < 1e-6) return vec4(.0);

    float dist = ${this.edgeThickness.sample("mid", "float")} * sqrt(zoom) * 0.005 + 0.008;
    float midScore = mid - (${this.threshold.sample("mid", "float")});

    float u = ${this.sampleChannel("vec2(v_texture_coords.x - dist, v_texture_coords.y)")};
    float b = ${this.sampleChannel("vec2(v_texture_coords.x + dist, v_texture_coords.y)")};
    float l = ${this.sampleChannel("vec2(v_texture_coords.x, v_texture_coords.y - dist)")};
    float r = ${this.sampleChannel("vec2(v_texture_coords.x, v_texture_coords.y + dist)")};
    float ul = ${this.sampleChannel("vec2(v_texture_coords.x - dist, v_texture_coords.y - dist)")};
    float ur = ${this.sampleChannel("vec2(v_texture_coords.x - dist, v_texture_coords.y + dist)")};
    float bl = ${this.sampleChannel("vec2(v_texture_coords.x + dist, v_texture_coords.y - dist)")};
    float br = ${this.sampleChannel("vec2(v_texture_coords.x + dist, v_texture_coords.y + dist)")};

    float uScore = u - (${this.threshold.sample("u", "float")});
    float bScore = b - (${this.threshold.sample("b", "float")});
    float lScore = l - (${this.threshold.sample("l", "float")});
    float rScore = r - (${this.threshold.sample("r", "float")});
    float ulScore = ul - (${this.threshold.sample("ul", "float")});
    float urScore = ur - (${this.threshold.sample("ur", "float")});
    float blScore = bl - (${this.threshold.sample("bl", "float")});
    float brScore = br - (${this.threshold.sample("br", "float")});

    float neighborhoodMin = min(midScore, min(min(min(uScore, bScore), min(lScore, rScore)), min(min(ulScore, urScore), min(blScore, brScore))));
    float neighborhoodMax = max(midScore, max(max(max(uScore, bScore), max(lScore, rScore)), max(max(ulScore, urScore), max(blScore, brScore))));
    float softness = edge_softness_${uid}(midScore, neighborhoodMin, neighborhoodMax);
    float crossing = edge_crossing_${uid}(neighborhoodMin, neighborhoodMax, softness);
    float outerAlpha = midScore < 0.0 ? crossing : 0.0;
    float innerAlpha = midScore >= 0.0 ? crossing : 0.0;

    float edgeAlpha = max(outerAlpha, innerAlpha);
    if (edgeAlpha <= 0.01) {
        return vec4(0.0);
    }

    vec3 edgeColor = outerAlpha >= innerAlpha ? ${this.outer_color.sample()} : ${this.inner_color.sample()};
    return vec4(edgeColor, edgeAlpha);
`;
    }
});
})(OpenSeadragon);
