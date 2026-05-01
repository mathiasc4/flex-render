(function($) {
/**
 * Grid shader.
 *
 * Renders a configurable grid overlay. Takes no texture data — `sources()` is `[]`.
 *
 * Coordinate space: image-source pixels. The grid follows OSD pan/zoom so cells
 * grow on screen as the user zooms in. To anchor the grid to a specific image,
 * pass a single tiledImage index in shaderConfig.tiledImages — the drawer's
 * _collectShaderUniforms then fills `pixelSize` with that image's image-zoom
 * (screen-px per image-px). With no tiledImages, `pixelSize` defaults to 1 and
 * the grid degrades gracefully into screen-pixel space.
 *
 * Cell sizes are in image pixels; line width is in screen pixels (so lines
 * stay readable regardless of zoom).
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "grid";
    }

    static name() {
        return "Grid";
    }

    static description() {
        return "Render a configurable grid overlay (no data input).";
    }

    static intent() {
        return "Overlay an alignment / scale grid. Pick to add image-anchored guidelines.";
    }

    static expects() {
        return { dataKind: "none", channels: 0 };
    }

    static exampleParams() {
        /* eslint-disable camelcase */
        return { color: "#ffffff", cell_x: 256, cell_y: 256, line_width: 1 };
        /* eslint-enable camelcase */
    }

    static docs() {
        return {
            summary: "Configurable grid overlay; no texture sampling.",
            description: "Draws an axis-aligned grid in image-source pixel coordinates. Cell sizes are in image pixels and follow OSD pan/zoom. Line width is in screen pixels so lines stay readable. Optionally pass a single tiledImage index in tiledImages to anchor coordinates to that image; otherwise the grid lives in screen pixels.",
            kind: "shader",
            inputs: [],
            controls: [
                { name: "color", ui: "color", valueType: "vec3", default: "#ffffff" },
                { name: "cell_x", ui: "range_input", valueType: "float", default: 256, min: 1, max: 8192, step: 1 },
                { name: "cell_y", ui: "range_input", valueType: "float", default: 256, min: 1, max: 8192, step: 1 },
                { name: "line_width", ui: "range_input", valueType: "float", default: 1, min: 0.5, max: 10, step: 0.5 }
            ],
            notes: [
                "tiledImages may contain at most one entry; it is used as a coordinate reference, not a data source.",
                "With empty tiledImages, the grid is in screen pixels (pixelSize = 1)."
            ]
        };
    }

    static sources() {
        return [];
    }

    static get defaultControls() {
        return {
            color: {
                default: {type: "color", default: "#ffffff", title: "Color: "},
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
    vec2 imgCoord = gl_FragCoord.xy / scale;

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
