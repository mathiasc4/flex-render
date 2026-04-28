(function($) {
    /**
 * Edges shader
 * data reference must contain one index to the data to render using edges strategy
 *
 * $_GET/$_POST expected parameters:
 *  index - unique number in the compiled shader
 * $_GET/$_POST supported parameters:
 *  color - for more details, see @WebGLModule.UIControls color UI type
 *  edgeThickness - for more details, see @WebGLModule.UIControls number UI type
 *  threshold - for more details, see @WebGLModule.UIControls number UI type
 *  opacity - for more details, see @WebGLModule.UIControls number UI type
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "edge_isoline";
    }

    static name() {
        return "Edges";
    }

    static description() {
        return "highlights edges at threshold values";
    }

    static intent() {
        return "Trace iso-contour edges where a scalar field crosses a threshold. Pick to outline level sets without filling regions.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        return { color: "#fff700", threshold: 50, edgeThickness: 1 };
    }

    static docs() {
        return {
            summary: "Edge-highlighting shader for one scalar input channel.",
            description: "Detects threshold crossings in the four cardinal directions around each sample and renders edge and inner-edge colors based on neighborhood comparisons.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [1],
                description: "1D data to detect edges on threshold value"
            }],
            controls: [
                { name: "color", ui: "color", valueType: "vec3", default: "#fff700" },
                { name: "threshold", ui: "range_input", valueType: "float", default: 50, min: 1, max: 100, step: 1 },
                { name: "edgeThickness", ui: "range", valueType: "float", default: 1, min: 0.5, max: 3, step: 0.1 }
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "1D data to detect edges on threshold value"
        }];
    }

    static get defaultControls() {
        return {
            color: {
                default: {type: "color", default: "#fff700", title: "Color: "},
                accepts: (type, instance) => type === "vec3"
            },
            threshold: {
                default: {type: "range_input", default: 50, min: 1, max: 100, step: 1, title: "Threshold: "},
                accepts: (type, instance) => type === "float"
            },
            edgeThickness: {
                default: {type: "range", default: 1, min: 0.5, max: 3, step: 0.1, title: "Edge thickness: "},
                accepts: (type, instance) => type === "float"
            },
        };
    }

    getFragmentShaderDefinition() {
        //here we override so we should call super method to include our uniforms
        return `
${super.getFragmentShaderDefinition()}

float edge_threshold_${this.uid}() {
    return ${this.threshold.sample("0.0", "float")};
}

float edge_softness_${this.uid}(float centerValue, float neighborhoodMin, float neighborhoodMax) {
    float localSpan = max(neighborhoodMax - neighborhoodMin, 0.0);
    float derivSpan = abs(dFdx(centerValue)) + abs(dFdy(centerValue));
    return max(0.01, max(localSpan * 0.35, derivSpan * 2.0));
}

float edge_crossing_${this.uid}(float thresholdValue, float neighborhoodMin, float neighborhoodMax, float softness) {
    float low = smoothstep(thresholdValue - softness, thresholdValue, neighborhoodMax);
    float high = 1.0 - smoothstep(thresholdValue, thresholdValue + softness, neighborhoodMin);
    return clamp(low * high, 0.0, 1.0);
}`;
    }

    getFragmentShaderExecution() {
        return `
    float mid = ${this.sampleChannel('v_texture_coords')};
    if (mid < 1e-6) return vec4(.0);
    float dist = ${this.edgeThickness.sample('mid', 'float')} * sqrt(zoom) * 0.005 + 0.008;
    float thresholdValue = edge_threshold_${this.uid}();

    float u = ${this.sampleChannel('vec2(v_texture_coords.x - dist, v_texture_coords.y)')};
    float b = ${this.sampleChannel('vec2(v_texture_coords.x + dist, v_texture_coords.y)')};
    float l = ${this.sampleChannel('vec2(v_texture_coords.x, v_texture_coords.y - dist)')};
    float r = ${this.sampleChannel('vec2(v_texture_coords.x, v_texture_coords.y + dist)')};
    float ul = ${this.sampleChannel('vec2(v_texture_coords.x - dist, v_texture_coords.y - dist)')};
    float ur = ${this.sampleChannel('vec2(v_texture_coords.x - dist, v_texture_coords.y + dist)')};
    float bl = ${this.sampleChannel('vec2(v_texture_coords.x + dist, v_texture_coords.y - dist)')};
    float br = ${this.sampleChannel('vec2(v_texture_coords.x + dist, v_texture_coords.y + dist)')};

    float nearMin = min(min(min(u, b), min(l, r)), min(min(ul, ur), min(bl, br)));
    float nearMax = max(max(max(u, b), max(l, r)), max(max(ul, ur), max(bl, br)));
    float outerSoftness = edge_softness_${this.uid}(mid, nearMin, nearMax);
    float outerEdge = edge_crossing_${this.uid}(thresholdValue, min(nearMin, mid), max(nearMax, mid), outerSoftness);

    if (outerEdge > 0.01) {
        return vec4(${this.color.sample()}, outerEdge);
    }

    float innerDist = 2.5 * dist;
    float u2 = ${this.sampleChannel('vec2(v_texture_coords.x - innerDist, v_texture_coords.y)')};
    float b2 = ${this.sampleChannel('vec2(v_texture_coords.x + innerDist, v_texture_coords.y)')};
    float l2 = ${this.sampleChannel('vec2(v_texture_coords.x, v_texture_coords.y - innerDist)')};
    float r2 = ${this.sampleChannel('vec2(v_texture_coords.x, v_texture_coords.y + innerDist)')};
    float ul2 = ${this.sampleChannel('vec2(v_texture_coords.x - innerDist, v_texture_coords.y - innerDist)')};
    float ur2 = ${this.sampleChannel('vec2(v_texture_coords.x - innerDist, v_texture_coords.y + innerDist)')};
    float bl2 = ${this.sampleChannel('vec2(v_texture_coords.x + innerDist, v_texture_coords.y - innerDist)')};
    float br2 = ${this.sampleChannel('vec2(v_texture_coords.x + innerDist, v_texture_coords.y + innerDist)')};

    float farMin = min(min(min(u2, b2), min(l2, r2)), min(min(ul2, ur2), min(bl2, br2)));
    float farMax = max(max(max(u2, b2), max(l2, r2)), max(max(ul2, ur2), max(bl2, br2)));
    float innerSoftness = edge_softness_${this.uid}(mid, farMin, farMax);
    float innerEdge = edge_crossing_${this.uid}(thresholdValue, min(farMin, mid), max(farMax, mid), innerSoftness);

    if (mid >= thresholdValue && innerEdge > 0.01) {
        return vec4(${this.color.sample()} * 0.7, innerEdge * 0.7); //inner border
    }
    return vec4(.0);
`;
    }
});
})(OpenSeadragon);
