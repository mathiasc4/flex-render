(function($) {
/**
 * Grid heatmap shader.
 *
 * A colormap variant that renders the scalar field as a grid of squares whose
 * interior fades out with zoom so the underlying tissue stays visible. The
 * actual data colour is kept fully opaque on a constant-thickness band hugging
 * every cell boundary, which preserves the perceived heatmap colour.
 *
 * Screen-size driven opacity:
 *   - A cell whose on-screen size is <= solid_px is filled solid (fully opaque);
 *     there is no room to show tissue anyway.
 *   - Above that, an opaque boundary frame of constant *screen* thickness
 *     (boundary_px) stays put regardless of zoom, while the inner fill alpha
 *     decays as the cell grows on screen (innerAlpha = solid_px / cellScreenPx),
 *     so zooming in reveals more of the tissue under each cell.
 *
 * Like the grid layer, geometry is anchored to the bound tiledImage through the
 * drawer-provided `pixelSize` (screen-px per image-px) and `imageOriginPx`
 * uniforms, so the grid pans/zooms with the slide. With no binding pixelSize
 * defaults to 1 and the grid degrades into screen-pixel space.
 *
 * Colour/threshold/connect behave exactly like the colormap layer.
 *
 * expected parameters:
 *  index - unique number in the compiled shader
 * supported parameters:
 *  color - can be a ColorMap, number of steps = x
 *  threshold - must be an AdvancedSlider, default values array (pipes) = x-1,
 *      mask array size = x; incorrect values are changed to reflect color steps
 *  connect - boolean switch enabling advanced-slider mapping to break values
 *  cell - square cell size in image pixels
 *  offset_x / offset_y - grid origin shift in image pixels
 *  solid_px - on-screen cell size (screen px) at/below which a cell is filled
 *      solid; also scales the inner-fill fade (innerAlpha = solid_px / cellPx)
 *  boundary_px - opaque boundary frame thickness in screen px, constant w.r.t. zoom
 *  adaptive_lod - snap cell size to powers of two to bound the on-screen cell
 */
$.FlexRenderer.ShaderLayerRegistry.register(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "gridheatmap";
    }

    static name() {
        return "Grid Heatmap";
    }

    static description() {
        return "Colormap rendered as a grid of squares whose interiors fade out with zoom so the underlying tissue shows through; the actual data colour is kept fully opaque on a constant-screen-thickness band around each cell boundary. Cells smaller than solid_px on screen are filled solid; larger cells keep an opaque boundary (boundary_px screen px) while the inner alpha decays as solid_px / cellScreenPx. Colour/threshold/connect behave like the colormap layer.";
    }

    static intent() {
        return "Map a scalar through a discrete palette while keeping the tissue visible. Pick over colormap when the user must see through the overlay; boundaries preserve the colour perception.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        /* eslint-disable camelcase */
        return {
            color: { type: "colormap", default: "Blues", steps: 3, mode: "singlehue" },
            threshold: { type: "advanced_slider", breaks: [0.33, 0.66] },
            connect: true,
            cell: 64,
            solid_px: 15,
            boundary_px: 2
        };
        /* eslint-enable camelcase */
    }

    static controlCouplings() {
        return [{
            name: "colormap_class_count",
            summary: "Color class count must equal threshold.breaks.length + 1. Resize palette and breaks together.",
            corrective: "Set params.color.steps = params.threshold.breaks.length + 1 (or pass threshold.breaks of length color.steps - 1).",
            controls: ["color", "threshold"],
            validate: (layer) => {
                const params = (layer && layer.params) || {};
                const Configurator = $.FlexRenderer.ShaderConfigurator;
                const breaksCount = Configurator.resolveEffectiveBreaks(params.threshold).length;
                const colorSteps = Configurator.resolveEffectiveColorSteps(params.color);
                const expectedSteps = breaksCount + 1;
                return colorSteps === expectedSteps
                    ? { ok: true }
                    : {
                        ok: false,
                        expected: { "color.steps": expectedSteps },
                        actual: {
                            "color.steps": colorSteps,
                            "threshold.breaks.length": breaksCount
                        }
                    };
            }
        }];
    }

    static docs() {
        return {
            summary: "Grid-of-squares colormap whose interiors fade with zoom so tissue shows through.",
            description: "Samples a scalar value and maps it through a colormap control exactly like the colormap layer, then drives the output alpha from on-screen cell size. A cell smaller than solid_px on screen is filled solid; a larger cell keeps an opaque boundary frame of constant screen thickness (boundary_px) while the inner fill alpha decays as solid_px / cellScreenPx, so zooming in reveals more tissue. Geometry is anchored to the bound tiledImage via the drawer-provided pixelSize/imageOriginPx uniforms.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [1],
                description: "1D data mapped to color map"
            }],
            controls: [
                {
                    name: "color",
                    ui: "colormap",
                    valueType: "vec3",
                    default: { default: "Viridis", steps: 3, mode: "sequential", continuous: false }
                },
                {
                    name: "threshold",
                    ui: "advanced_slider",
                    valueType: "float",
                    default: { default: [0.25, 0.75], mask: [1, 0, 1] },
                    required: { type: "advanced_slider", inverted: false }
                },
                { name: "connect", ui: "bool", valueType: "bool", default: true },
                { name: "cell", ui: "range_input", valueType: "float", default: 64, min: 1, max: 8192, step: 1 },
                { name: "offset_x", ui: "range_input", valueType: "float", default: 0, min: -8192, max: 8192, step: 1 },
                { name: "offset_y", ui: "range_input", valueType: "float", default: 0, min: -8192, max: 8192, step: 1 },
                { name: "solid_px", ui: "range_input", valueType: "float", default: 15, min: 2, max: 200, step: 1 },
                { name: "boundary_px", ui: "range_input", valueType: "float", default: 2, min: 0.5, max: 20, step: 0.5 },
                { name: "adaptive_lod", ui: "bool", valueType: "bool", default: false }
            ],
            notes: [
                "Boundaries keep the actual data colour at full opacity; the interior fades with zoom.",
                "solid_px is an on-screen size in screen pixels; at/below it the whole cell is opaque, above it innerAlpha = solid_px / cellScreenPx.",
                "boundary_px is the opaque frame thickness in screen pixels and stays constant under zoom.",
                "With no binding the grid renders in screen pixels (pixelSize = 1).",
                "adaptive_lod snaps cell size to powers of two so the on-screen cell stays in [1x, 2x) of the configured size."
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 1,
            description: "1D data mapped to color map"
        }];
    }

    construct(options, dataReferences) {
        super.construct(options, dataReferences);
        //delete unused controls if applicable after initialization
        // Any ColorMap-family control (including custom_colormap) exposes setSteps and
        // can therefore honour `connect`. Matching the name string excluded subclasses.
        if (typeof this.color.setSteps !== "function") {
            this.removeControl("connect");
        }
    }

    static get defaultControls() {
        return {
            color: {
                default: {
                    type: "colormap",
                    steps: 3, //number of categories
                    default: "Viridis",
                    mode: "sequential",
                    title: "Colormap",
                    continuous: false,
                },
                accepts: (type, instance) => type === "vec3"
            },
            threshold: {
                default: {
                    type: "advanced_slider",
                    default: [0.25, 0.75], //breaks/separators, e.g. one less than bin count
                    mask: [1, 0, 1],  //same number of steps as color
                    title: "Breaks",
                    pips: {
                        mode: 'positions',
                        values: [0, 35, 50, 75, 90, 100],
                        density: 4
                    }
                },
                accepts: (type, instance) => type === "float",
                required: {type: "advanced_slider", inverted: false}
            },
            connect: {
                default: {type: "bool", interactive: true, title: "Connect breaks: ", default: true},
                accepts: (type, instance) => type === "bool"
            },
            cell: {
                default: {type: "range_input", default: 64, min: 1, max: 8192, step: 1, title: "Cell size (image px): "},
                accepts: (type, instance) => type === "float"
            },
            offset_x: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 0, min: -8192, max: 8192, step: 1, title: "Offset X (image px): "},
                accepts: (type, instance) => type === "float"
            },
            offset_y: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 0, min: -8192, max: 8192, step: 1, title: "Offset Y (image px): "},
                accepts: (type, instance) => type === "float"
            },
            solid_px: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 15, min: 2, max: 200, step: 1, title: "Solid until (screen px): "},
                accepts: (type, instance) => type === "float"
            },
            boundary_px: {  // eslint-disable-line camelcase
                default: {type: "range_input", default: 2, min: 0.5, max: 20, step: 0.5, title: "Boundary thickness (screen px): "},
                accepts: (type, instance) => type === "float"
            },
            adaptive_lod: {  // eslint-disable-line camelcase
                default: {type: "bool", default: false, title: "Adaptive LOD: "},
                accepts: (type, instance) => type === "bool"
            }
        };
    }

    getFragmentShaderExecution() {
        // SimpleUIControl normalizes range/number values to [0, 1] before upload, so the
        // GLSL uniform is a fraction of the configured min..max range. Denormalize via
        // mix(min, max, sample) — same pattern as the grid layer.
        const f = (n) => $.FlexRenderer.ShaderLayer.toShaderFloatString(n, 0, 5);
        const c  = this.cell.params;
        const ox = this.offset_x.params;
        const oy = this.offset_y.params;
        const sp = this.solid_px.params;
        const bp = this.boundary_px.params;
        return `
    // --- sample data and map through the colormap (same as the colormap layer) ---
    float chan = ${this.sampleChannel('v_texture_coords')};
    vec3 cellColor = ${this.color.sample('chan', 'float')};
    float dataAlpha = step(0.05, ${this.threshold.sample('chan', 'float')});

    // --- grid geometry in image-pixel space (same anchoring as the grid layer) ---
    float cell = max(mix(${f(c.min)}, ${f(c.max)}, ${this.cell.sample()}), 1.0);
    float offsetX = mix(${f(ox.min)}, ${f(ox.max)}, ${this.offset_x.sample()});
    float offsetY = mix(${f(oy.min)}, ${f(oy.max)}, ${this.offset_y.sample()});
    float scale = max(pixelSize, 1e-6); // screen-px per image-px

    // Optional symmetric LOD: snap cell size to a power of two so the on-screen
    // cell stays in [1x, 2x) of the configured size.
    if (${this.adaptive_lod.sample()}) {
        float lodMult = exp2(-floor(log2(scale)));
        cell *= lodMult;
    }

    vec2 imgCoord = (gl_FragCoord.xy - imageOriginPx) / scale - vec2(offsetX, offsetY);
    float modX = mod(imgCoord.x, cell);
    float modY = mod(imgCoord.y, cell);
    float dx = min(modX, cell - modX);
    float dy = min(modY, cell - modY);

    // Distance to the nearest cell boundary, expressed in screen pixels.
    float edgeDistScreen = min(dx, dy) * scale;
    float cellScreen = cell * scale; // on-screen cell size in px

    // Inner fill opacity: 1.0 while the cell is at most solid_px on screen, then
    // decaying as the cell grows so zooming in fades the interior and reveals tissue.
    // Continuous at the threshold because solid_px / solid_px == 1.
    float solidPx = max(mix(${f(sp.min)}, ${f(sp.max)}, ${this.solid_px.sample()}), 1e-6);
    float innerAlpha = clamp(solidPx / max(cellScreen, 1e-6), 0.0, 1.0);

    // Opaque boundary frame of constant *screen* thickness, independent of zoom.
    float boundaryPx = max(mix(${f(bp.min)}, ${f(bp.max)}, ${this.boundary_px.sample()}), 0.0);
    float feather = max(fwidth(edgeDistScreen), 1e-4);
    float boundaryMask = 1.0 - smoothstep(boundaryPx - feather, boundaryPx + feather, edgeDistScreen);

    // Boundary stays at full alpha; interior uses the fading innerAlpha.
    float fillAlpha = mix(innerAlpha, 1.0, boundaryMask);

    return vec4(cellColor, dataAlpha * fillAlpha);
`;
    }

    init() {
        this.opacity.init();

        const Configurator = $.FlexRenderer.ShaderConfigurator;
        const isColormap = typeof this.color.setSteps === "function";

        // Read breaks through the same canonical accessor the coupling validator uses,
        // so validation cannot disagree with runtime coercion. Live drag updates pass
        // their fresh values into syncColor() directly via the 'breaks' callback;
        // other call sites (e.g. the connect toggle) get them from the slider's live
        // state, which `params.breaks` lags behind once the user has dragged.
        const breaksOf = (override) => {
            if (Array.isArray(override)) {
                return override.map(v => Number.parseFloat(v)).filter(v => Number.isFinite(v));
            }
            if (this.threshold && Array.isArray(this.threshold.raw)) {
                const live = this.threshold.raw
                    .map(v => Number.parseFloat(v))
                    .filter(v => Number.isFinite(v) && v >= 0 && v <= 1);
                if (live.length > 0) {
                    return live;
                }
            }
            return Configurator.resolveEffectiveBreaks(this.threshold && this.threshold.params);
        };
        const currentColorSteps = () =>
            Configurator.resolveEffectiveColorSteps(this.color.params);

        const warnIfMismatched = (expected) => {
            if (this._coercionWarned) {
                return;
            }
            const current = currentColorSteps();
            if (current !== expected) {
                this._coercionWarned = true;
                console.warn(
                    `[gridheatmap] color step count ${current} coerced to ${expected} ` +
                    `to satisfy threshold.breaks.length + 1`
                );
            }
        };

        const syncColor = (liveBreaks) => {
            if (!isColormap) {
                return;
            }
            const breaks = breaksOf(liveBreaks);
            const expected = breaks.length + 1;
            warnIfMismatched(expected);
            if (this.connect && this.connect.raw) {
                this.color.setSteps([0, ...breaks, 1]);
            } else {
                this.color.setSteps(expected);
            }
            if (typeof this.color.updateColormapUI === "function") {
                this.color.updateColormapUI();
            }
        };

        this.color.init();

        if (this.connect) {
            this.connect.on('default', function() {
                syncColor();
            }, true);
            this.connect.init();

            this.threshold.on('breaks', function(_rawValue, encodedValue) {
                syncColor(encodedValue);
            }, true);
        }
        this.threshold.init();

        this.cell.init();
        this.offset_x.init();
        this.offset_y.init();
        this.solid_px.init();
        this.boundary_px.init();
        this.adaptive_lod.init();

        syncColor();
    }
});
})(OpenSeadragon);
