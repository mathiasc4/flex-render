(function($) {
/**
 * Patternmap shader
 *
 * Same data/color contract as the heatmap shader (scalar channel tinted with a
 * single configurable color, value mapped to opacity, gated by a scalar
 * threshold with optional invert), but the colored fragment is only emitted
 * where a configurable pattern is opaque. The gaps let the underlying slide
 * and other overlay layers show through. Stack several patternmap layers with
 * different spacing / rotation / offset to keep multiple classes legible at
 * once.
 *
 * Pattern coordinates live in screen-pixel space, anchored to the bound
 * tiledImage's origin: the pattern pans with the slide as you drag, but its
 * on-screen period and line thickness are independent of zoom — same density
 * regardless of how far you zoom in.
 *
 * Niche controls (offset_x, offset_y, rotation) are non-interactive by default
 * — they're mainly for de-conflicting stacked patternmap layers. Flip them to
 * interactive=true in the layer config when alignment actually matters.
 */
$.FlexRenderer.ShaderLayerRegistry.register(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "patternmap";
    }

    static name() {
        return "PatternMap";
    }

    static description() {
        return "Heatmap rendered through a sparse pattern (grid / diagonal / crosshatch / dots) so the underlying slide remains visible. Color/threshold/inverse behave like the heatmap shader; pattern spacing and line width are in CSS pixels and stay constant under zoom and devicePixelRatio. Offset and rotation exist to phase-shift stacked overlays and are non-interactive by default.";
    }

    static intent() {
        return "Tint a single scalar channel and render it as a sparse pattern instead of a solid fill. Pick when overlays must let the underlying slide or other class layers show through, with pattern density that stays constant across zoom levels.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        /* eslint-disable camelcase */
        return {
            color: "#fff700",
            threshold: 1,
            inverse: false,
            pattern_type: 0,
            spacing: 16,
            line_width: 1.5
        };
        /* eslint-enable camelcase */
    }

    static docs() {
        return {
            summary: "Patternmap shader for one scalar channel — heatmap rendered as a sparse, zoom-stable pattern.",
            description: "Samples a scalar value, tints it with a single configurable color, uses the value as opacity and gates the fragment with a scalar threshold (with optional invert) — same contract as the heatmap shader. The colored fragment is only emitted where the configured pattern (grid / diagonal / crosshatch / dots) is opaque, so the underlying slide and other overlays remain visible. Pattern coordinates are in screen pixels but anchored to the bound tiledImage's origin: spacing and line width stay constant across zoom levels, while the pattern still pans with the slide.",
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
                { name: "inverse", ui: "bool", valueType: "bool", default: false },
                {
                    name: "pattern_type",
                    ui: "select",
                    valueType: "int",
                    default: 0,
                    options: [
                        { value: 0, label: "Grid" },
                        { value: 1, label: "Diagonal" },
                        { value: 2, label: "Crosshatch" },
                        { value: 3, label: "Dots" }
                    ]
                },
                { name: "spacing", ui: "range_input", valueType: "float", default: 16, min: 4, max: 128, step: 1 },
                { name: "line_width", ui: "range_input", valueType: "float", default: 1.5, min: 0.5, max: 10, step: 0.5 },
                { name: "offset_x", ui: "range_input", valueType: "float", default: 0, min: -128, max: 128, step: 1, interactive: false },
                { name: "offset_y", ui: "range_input", valueType: "float", default: 0, min: -128, max: 128, step: 1, interactive: false },
                { name: "rotation", ui: "range", valueType: "float", default: 0, min: 0, max: 360, step: 1, interactive: false }
            ],
            notes: [
                "Spacing, line width and dot radius are all in screen pixels and stay constant across zoom levels.",
                "The pattern pans with the bound tiledImage but doesn't scale with it.",
                "Dot radius is line_width × 2 so dots stay visible at default line widths.",
                "offset_x, offset_y and rotation are non-interactive by default — they exist mainly to phase-shift stacked patternmap layers."
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
            },
            pattern_type: {  // eslint-disable-line camelcase
                default: {
                    type: "select",
                    default: 0,
                    title: "Pattern: ",
                    options: [
                        { value: 0, label: "Grid" },
                        { value: 1, label: "Diagonal" },
                        { value: 2, label: "Crosshatch" },
                        { value: 3, label: "Dots" }
                    ]
                },
                accepts: (type, instance) => type === "int"
            },
            spacing: {
                default: {type: "range_input", default: 16, min: 4, max: 128, step: 1, title: "Spacing (screen px): "},
                accepts: (type, instance) => type === "float"
            },
            line_width: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 1.5, min: 0.5, max: 10, step: 0.5, title: "Line width (screen px): "},
                accepts: (type, instance) => type === "float"
            },
            // Phase offsets / rotation are mainly used to de-conflict stacked
            // patternmap layers. interactive=false keeps the panel tidy by default;
            // flip to true in the layer config when alignment actually matters.
            offset_x: {  // eslint-disable-line camelcase
                default: {type: "range_input", interactive: false, default: 0, min: -128, max: 128, step: 1, title: "Offset X (screen px): "},
                accepts: (type, instance) => type === "float"
            },
            offset_y: {  // eslint-disable-line camelcase
                default: {type: "range_input", interactive: false, default: 0, min: -128, max: 128, step: 1, title: "Offset Y (screen px): "},
                accepts: (type, instance) => type === "float"
            },
            rotation: {
                default: {type: "range", interactive: false, default: 0, min: 0, max: 360, step: 1, title: "Rotation (deg): "},
                accepts: (type, instance) => type === "float"
            }
        };
    }

    getFragmentShaderDefinition() {
        const uid = this.uid;
        return `
${super.getFragmentShaderDefinition()}

// Pattern alpha at fragment for patternmap_${uid}.
//   kind     - 0 grid, 1 diagonal, 2 crosshatch, 3 dots
//   coord    - rotated/offset coordinate in screen pixels
//   spacing  - pattern period in framebuffer pixels (caller converts from CSS px)
//   halfW    - half line width / dot half-thickness in screen pixels
// All distances are in screen pixels, so smoothstep feather is just fwidth()
// (~1 fragment) — gives a stable single-pixel-wide AA edge regardless of zoom.
float patternmap_alpha_${uid}(int kind, vec2 coord, float spacing, float halfW) {
    if (kind == 0) {
        vec2 m = mod(coord, spacing);
        vec2 d = min(m, spacing - m);
        float dist = min(d.x, d.y);
        float feather = max(fwidth(dist), 1e-4);
        return 1.0 - smoothstep(halfW - feather, halfW + feather, dist);
    } else if (kind == 1) {
        float u = (coord.x + coord.y) * 0.70710678;
        float m = mod(u, spacing);
        float dist = min(m, spacing - m);
        float feather = max(fwidth(dist), 1e-4);
        return 1.0 - smoothstep(halfW - feather, halfW + feather, dist);
    } else if (kind == 2) {
        float u = (coord.x + coord.y) * 0.70710678;
        float v = (coord.x - coord.y) * 0.70710678;
        float mu = mod(u, spacing);
        float mv = mod(v, spacing);
        float du = min(mu, spacing - mu);
        float dv = min(mv, spacing - mv);
        float fu = max(fwidth(du), 1e-4);
        float fv = max(fwidth(dv), 1e-4);
        float a1 = 1.0 - smoothstep(halfW - fu, halfW + fu, du);
        float a2 = 1.0 - smoothstep(halfW - fv, halfW + fv, dv);
        return max(a1, a2);
    } else {
        // Dots: distance to nearest grid intersection; radius scaled up from
        // halfW so dots are clearly visible at default line widths.
        vec2 m = mod(coord, spacing) - spacing * 0.5;
        float dist = length(m);
        float radius = halfW * 2.0;
        float feather = max(fwidth(dist), 1e-4);
        return 1.0 - smoothstep(radius - feather, radius + feather, dist);
    }
}`;
    }

    getFragmentShaderExecution() {
        const f = (n) => $.FlexRenderer.ShaderLayer.toShaderFloatString(n, 0, 5);
        const sp = this.spacing.params;
        const lw = this.line_width.params;
        const ox = this.offset_x.params;
        const oy = this.offset_y.params;
        const rt = this.rotation.params;
        const uid = this.uid;
        return `
    float chan = ${this.sampleChannel('v_texture_coords')};
    bool shows = chan >= ${this.threshold.sample('chan', 'float')};
    if (${this.inverse.sample()}) {
        if (!shows) {
            shows = true;
            chan = 1.0;
        } else {
            chan = 1.0 - chan;
        }
    }
    if (!shows) {
        return vec4(.0);
    }

    // spacing / line_width / offsets are configured in CSS px, but the coordinates
    // below are framebuffer px, so lift them through devicePixelScale — otherwise the
    // pattern renders 1/devicePixelRatio-sized on any HiDPI display.
    // The pattern rotates, so spacing and line width must be single numbers: they take
    // the x scale, the two components differing only by per-axis framebuffer rounding.
    // The offsets are a plain translation and take their own axis.
    vec2 dps = max(devicePixelScale, vec2(1e-6));
    float spacing = max(mix(${f(sp.min)}, ${f(sp.max)}, ${this.spacing.sample()}), 1.0) * dps.x;
    float halfWidth = mix(${f(lw.min)}, ${f(lw.max)}, ${this.line_width.sample()}) * 0.5 * dps.x;
    float offsetX = mix(${f(ox.min)}, ${f(ox.max)}, ${this.offset_x.sample()}) * dps.x;
    float offsetY = mix(${f(oy.min)}, ${f(oy.max)}, ${this.offset_y.sample()}) * dps.y;
    float angle = mix(${f(rt.min)}, ${f(rt.max)}, ${this.rotation.sample()}) * 0.017453292519943295;

    // Framebuffer-pixel coords anchored to the bound tiledImage origin. Subtracting
    // imageOriginPx keeps the pattern panning with the slide; we do *not*
    // divide by pixelSize, so spacing/line width stay constant under zoom.
    vec2 coord = (gl_FragCoord.xy - imageOriginPx) - vec2(offsetX, offsetY);
    float cs = cos(angle);
    float sn = sin(angle);
    vec2 rotated = vec2(cs * coord.x - sn * coord.y,
                        sn * coord.x + cs * coord.y);

    float patAlpha = patternmap_alpha_${uid}(${this.pattern_type.sample()}, rotated, spacing, halfWidth);
    return vec4(${this.color.sample('chan', 'float')}, chan * patAlpha);
`;
    }
});
})(OpenSeadragon);
