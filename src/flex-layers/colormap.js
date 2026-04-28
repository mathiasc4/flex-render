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
        return "data values encoded in color scale. The color control's `steps` (and `custom_colormap` array length) is coerced to `threshold.breaks.length + 1`. When both are set, `custom_colormap.default.length` wins for the `custom_colormap` type, otherwise `color.steps` wins. The `connect` flag (default true) additionally synchronizes step boundaries with break positions.";
    }

    static intent() {
        return "Map a scalar value through a discrete color palette. Pick for class maps with explicit thresholds.";
    }

    static expects() {
        return { dataKind: "scalar", channels: 1, requiresThreshold: true };
    }

    static exampleParams() {
        return {
            color: { type: "colormap", default: "Viridis", steps: 3, mode: "sequential" },
            threshold: { breaks: [0.33, 0.66] },
            connect: true
        };
    }

    static controlCouplings() {
        return [{
            name: "colormap_class_count",
            summary: "Color class count must equal threshold.breaks.length + 1. Resize palette and breaks together.",
            controls: ["color", "threshold"],
            validate: (layer) => {
                const params = (layer && layer.params) || {};
                const breaks = params.threshold && (
                    Array.isArray(params.threshold.breaks) ? params.threshold.breaks
                        : Array.isArray(params.threshold.default) ? params.threshold.default
                            : null
                );
                const breaksCount = breaks ? breaks.length : 0;
                const colorSteps = $.FlexRenderer.ShaderConfigurator
                    .resolveEffectiveColorSteps(params.color);
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

        const isColormap = typeof this.color.setSteps === "function";
        const breaksOf = () => Array.isArray(this.threshold.raw) ? this.threshold.raw : [];
        const currentColorSteps = () =>
            $.FlexRenderer.ShaderConfigurator.resolveEffectiveColorSteps(this.color.params);

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

        const syncColor = () => {
            if (!isColormap) {
                return;
            }
            const breaks = breaksOf();
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

            this.threshold.on('breaks', function() {
                syncColor();
            }, true);
        }
        this.threshold.init();

        syncColor();

        this.color.init();
    }
});
})(OpenSeadragon);
