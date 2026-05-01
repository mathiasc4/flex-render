(function($) {
/**
 * Colormap shader
 * data reference must contain one index to the data to render using colormap strategy
 *
 * expected parameters:
 *  index - unique number in the compiled shader
 * supported parameters:
 *  color - can be a ColorMap, number of steps = x
 *  threshold - must be an AdvancedSlider, default values array (pipes) = x-1, mask array size = x, incorrect
 *      values are changed to reflect the color steps
 *  connect - a boolean switch to enable/disable advanced slider mapping to break values, enabled for type==="colormap" only
 *
 * colors shader will read underlying data (red component) and output
 * to canvas defined color with opacity based on the data
 * (0.0 => transparent, 1.0 => opaque)
 * supports thresholding - outputs color on areas above certain value
 * mapping html input slider 0-100 to .0-1.0
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "colormap";
    }

    static name() {
        return "ColorMap";
    }

    static description() {
        return "Number of color classes is always threshold.breaks.length + 1. To set classes explicitly, use color = { type: \"custom_colormap\", default: [...colors], steps: N } (palette length N wins) OR color = \" { type: \"colormap\", default: \"PaletteName\", steps: N } (steps wins). The connect flag (default true) syncs step boundaries to break positions.";
    }

    static intent() {
        return "Map a scalar value through a discrete color palette. Pick for class maps with explicit thresholds.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        return {
            color: { type: "colormap", default: "Blues", steps: 3, mode: "singlehue" },
            threshold: { type: "advanced_slider", breaks: [0.33, 0.66] },
            connect: true
        };
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
            summary: "Colormap shader for one scalar channel.",
            description: "Samples a scalar value, maps it through a colormap control, and uses an advanced slider control as the visibility mask. The optional connect control synchronizes colormap step boundaries with slider breaks when a colormap control is active.",
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
                    default: {
                        default: "Viridis",
                        steps: 3,
                        mode: "sequential",
                        continuous: false
                    }
                },
                {
                    name: "threshold",
                    ui: "advanced_slider",
                    valueType: "float",
                    default: {
                        default: [0.25, 0.75],
                        mask: [1, 0, 1]
                    },
                    required: {
                        type: "advanced_slider",
                        inverted: false
                    }
                },
                { name: "connect", ui: "bool", valueType: "bool", default: true }
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
        if (this.color.getName() !== "colormap") {
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
            }
        };
    }

    getFragmentShaderExecution() {
        return `
    float chan = ${this.sampleChannel('v_texture_coords')};
    return vec4(${this.color.sample('chan', 'float')}, step(0.05, ${this.threshold.sample('chan', 'float')}));
`;
    }

    init() {
        this.opacity.init();

        const Configurator = $.FlexRenderer.ShaderConfigurator;
        const isColormap = typeof this.color.setSteps === "function";

        // Read breaks through the same canonical accessor the coupling validator uses,
        // so validation cannot disagree with runtime coercion. Live drag updates pass
        // their fresh values into syncColor() directly via the 'breaks' callback.
        const breaksOf = (override) => {
            if (Array.isArray(override)) {
                return override.map(v => Number.parseFloat(v)).filter(v => Number.isFinite(v));
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
                    `[colormap] color step count ${current} coerced to ${expected} ` +
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

        syncColor();

        this.color.init();
    }
});
})(OpenSeadragon);
