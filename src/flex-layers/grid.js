(function($) {
/**
 * Grid shader.
 *
 * Declares one data reference that the configurator auto-binds (via
 * tiledImages: [0]) so the grid lives in that image's source-pixel space and
 * pans/zooms with it. The reference texture is not sampled — it is used
 * purely as a coordinate anchor: the drawer's _collectShaderUniforms fills
 * `pixelSize` (screen-px per image-px) from the bound tiledImage. If no
 * binding exists, `pixelSize` defaults to 1 and the grid degrades gracefully
 * into screen-pixel space.
 *
 * Cell sizes are in image pixels; line width is in screen pixels (so lines
 * stay readable regardless of zoom).
 *
 * Optional adaptive_lod toggle holds on-screen cell size in [1×, 2×) of the
 * configured size by snapping cellX/cellY to powers of two — merge when the
 * cell would drop below ½ original; subdivide when it would exceed 2×.
 */
$.FlexRenderer.ShaderLayerRegistry.register(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "grid";
    }

    static name() {
        return "Grid";
    }

    static description() {
        return "Render a configurable grid overlay anchored to a reference image.";
    }

    static intent() {
        return "Overlay an alignment / scale grid. Pick to add image-anchored guidelines.";
    }

    static expects() {
        return { dataKind: "any", channels: 0 };
    }

    static exampleParams() {
        /* eslint-disable camelcase */
        return { color: "#ffffff", cell_x: 256, cell_y: 256, line_width: 1, adaptive_lod: false };
        /* eslint-enable camelcase */
    }

    static docs() {
        return {
            summary: "Configurable grid overlay anchored to a reference image (texture not sampled).",
            description: "Draws an axis-aligned grid in image-source pixel coordinates. Declares one data reference used purely as a coordinate anchor — the configurator auto-binds it so the grid pans/zooms with the image. Cell sizes are in image pixels; line width is in screen pixels so lines stay readable. With no binding, the grid degrades to screen-pixel space (pixelSize = 1).",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: "any",
                description: "Reference image — used only as a coordinate anchor (not sampled)."
            }],
            controls: [
                { name: "color", ui: "color", valueType: "vec3", default: "#ffffff" },
                { name: "cell_x", ui: "range_input", valueType: "float", default: 256, min: 1, max: 8192, step: 1 },
                { name: "cell_y", ui: "range_input", valueType: "float", default: 256, min: 1, max: 8192, step: 1 },
                { name: "line_width", ui: "range_input", valueType: "float", default: 1, min: 0.5, max: 10, step: 0.5 },
                { name: "adaptive_lod", ui: "bool", valueType: "bool", default: false }
            ],
            notes: [
                "The reference texture is bound for coordinate anchoring only; pixels are never sampled.",
                "With no binding, the grid renders in screen pixels (pixelSize = 1).",
                "adaptive_lod snaps cell size to powers of two so the on-screen cell stays in [1×, 2×) of the configured size."
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: () => true,
            description: "Reference image — used only as a coordinate anchor (not sampled)."
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                default: "rgba",
                accepts: (type, instance) => true,
            },
            color: {
                default: {type: "color", default: "#ff0000", title: "Color: "},
                accepts: (type, instance) => type === "vec3"
            },
            cell_x: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 256, min: 1, max: 8192, step: 1, title: "Cell width (image px): "},
                accepts: (type, instance) => type === "float"
            },
            cell_y: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 256, min: 1, max: 8192, step: 1, title: "Cell height (image px): "},
                accepts: (type, instance) => type === "float"
            },
            line_width: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 1, min: 0.5, max: 10, step: 0.5, title: "Line width (screen px): "},
                accepts: (type, instance) => type === "float"
            },
            adaptive_lod: {  // eslint-disable-line camelcase
                default: {type: "bool", default: true, title: "Adaptive LOD: "},
                accepts: (type, instance) => type === "bool"
            }
        };
    }

    getFragmentShaderExecution() {
        // SimpleUIControl normalizes range/number values to [0, 1] before upload, so the
        // GLSL uniform is a fraction of the configured min..max range. Denormalize via
        // mix(min, max, sample) — same pattern as iconmap_decodeCellSize.
        // pixelSize is OSD's image-zoom (screen-px per image-px); convert via divide.
        const f = (n) => $.FlexRenderer.ShaderLayer.toShaderFloatString(n, 0, 5);
        const cx = this.cell_x.params;
        const cy = this.cell_y.params;
        const lw = this.line_width.params;
        return `
    float cellX = max(mix(${f(cx.min)}, ${f(cx.max)}, ${this.cell_x.sample()}), 1.0);
    float cellY = max(mix(${f(cy.min)}, ${f(cy.max)}, ${this.cell_y.sample()}), 1.0);
    float scale = max(pixelSize, 1e-6);

    // Symmetric LOD: snap cell size to a power of two so on-screen cell stays
    // in [1×, 2×) of the configured size. pixelSize<0.5 → merge; pixelSize≥2 → subdivide.
    if (${this.adaptive_lod.sample()}) {
        float lodMult = exp2(-floor(log2(scale)));
        cellX *= lodMult;
        cellY *= lodMult;
    }

    vec2 imgCoord = (gl_FragCoord.xy - imageOriginPx) / scale;

    float modX = mod(imgCoord.x, cellX);
    float modY = mod(imgCoord.y, cellY);
    float dx = min(modX, cellX - modX);
    float dy = min(modY, cellY - modY);

    // Convert image-pixel distances to screen pixels for a stable line width.
    float minDistScreen = min(dx, dy) * scale;

    float halfWidth = mix(${f(lw.min)}, ${f(lw.max)}, ${this.line_width.sample()}) * 0.5;
    float feather = max(fwidth(minDistScreen), 1e-4);
    float onLine = 1.0 - smoothstep(halfWidth - feather, halfWidth + feather, minDistScreen);

    return vec4(${this.color.sample()}, onLine);
`;
    }
});
})(OpenSeadragon);
