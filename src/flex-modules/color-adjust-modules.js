(function ($) {

    /**
     * Color adjustment modules: pure `vec4 color -> vec4 color` transforms usable both as
     * modular-graph nodes and as ShaderLayer pipeline nodes (params.pipeline.pre / post).
     *
     * The color modules (levels, brightness-contrast, saturation, hue-rotate,
     * color-temperature) are identities at their default control values, so a pipeline node
     * may stay in the chain without any visual effect. exposure and logscale are not: they are
     * the migration targets of the legacy use_exposure / use_logscale filters and have no
     * identity value. Alpha is always passed through.
     * Float controls are read with ShaderModule#sampleValue(), which undoes the
     * (v-min)/(max-min) normalization the range control applies to its uniform.
     */

    const COLOR_INPUT = {
        color: {
            type: "vec4",
            required: true,
            description: "RGBA color to adjust."
        }
    };

    const COLOR_OUTPUT = {
        color: {
            type: "vec4",
            description: "Adjusted RGBA color; alpha is kept."
        }
    };

    const rangeControl = (title, defaultValue, min, max, step) => ({
        default: {
            type: "range",
            default: defaultValue,
            min,
            max,
            step,
            title
        },
        accepts: (type) => type === "float"
    });

    /**
     * Register one vec4 -> vec4 color module.
     *
     * @param {object} spec
     * @param {string} spec.type
     * @param {string} spec.name
     * @param {string} spec.description
     * @param {object} spec.controls defaultControls map
     * @param {boolean} [spec.identity=true] whether the module is an identity at its defaults
     * @param {function(string, Object<string,string>, $.FlexRenderer.ShaderModule): string} spec.rgb
     *   returns a GLSL vec3 expression computing the new rgb from the input expression and
     *   de-normalized control expressions
     */
    function registerColorModule(spec) {
        const controls = spec.controls;

        $.FlexRenderer.ShaderModuleRegistry.register(class extends $.FlexRenderer.ShaderModule {
            static type() {
                return spec.type;
            }

            static name() {
                return spec.name;
            }

            static description() {
                return spec.description;
            }

            static docs() {
                return {
                    summary: spec.description,
                    kind: "shader-module",
                    notes: [
                        spec.identity === false ?
                            "Not an identity at any value: migration target of a legacy use_* filter." :
                            "Identity at default control values.",
                        "Usable as a ShaderLayer pipeline node (params.pipeline.pre / post)."
                    ]
                };
            }

            static inputs() {
                return $.extend(true, {}, COLOR_INPUT);
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: COLOR_OUTPUT.color.description
                    }
                };
            }

            getInputDefinitions() {
                return $.extend(true, {}, COLOR_INPUT);
            }

            getOutputDefinitions() {
                return $.extend(true, {}, COLOR_OUTPUT);
            }

            static get defaultControls() {
                return $.extend(true, {}, controls);
            }

            compile(context) {
                const color = context.input("color");
                const output = context.output("color", "vec4");
                const values = {};
                for (const name of Object.keys(controls)) {
                    values[name] = this.sampleValue(name);
                }
                const rgb = spec.rgb(`(${color}).rgb`, values, this);

                return {
                    statements: `
    vec4 ${output} = vec4(${rgb}, (${color}).a);
`,
                    outputs: {
                        color: {
                            type: "vec4",
                            expr: output
                        }
                    }
                };
            }
        });
    }

    // Rec. 709 luma
    const LUMA = "vec3(0.2126, 0.7152, 0.0722)";

    registerColorModule({
        type: "levels",
        name: "Levels",
        description: "Input levels: maps [black, white] to [0, 1], then applies gamma (rgb^(1/gamma)).",
        controls: {
            black: rangeControl("Black point", 0, 0, 1, 0.01),
            white: rangeControl("White point", 1, 0, 1, 0.01),
            gamma: rangeControl("Gamma", 1, 0.1, 5, 0.05)
        },
        rgb: (c, v) =>
            `pow(max((${c} - vec3(${v.black})) / max(${v.white} - ${v.black}, 1e-5), vec3(0.0)), ` +
            `vec3(1.0 / max(${v.gamma}, 1e-4)))`
    });

    registerColorModule({
        type: "brightness-contrast",
        name: "Brightness / Contrast",
        description: "Contrast scales around mid-grey by (1 + contrast), then brightness is added.",
        controls: {
            brightness: rangeControl("Brightness", 0, -1, 1, 0.01),
            contrast: rangeControl("Contrast", 0, -1, 1, 0.01)
        },
        rgb: (c, v) => `((${c} - vec3(0.5)) * (1.0 + ${v.contrast}) + vec3(0.5) + vec3(${v.brightness}))`
    });

    registerColorModule({
        type: "saturation",
        name: "Saturation",
        description: "Mixes between Rec. 709 luma (0) and the original color (1); values above 1 oversaturate.",
        controls: {
            saturation: rangeControl("Saturation", 1, 0, 3, 0.01)
        },
        rgb: (c, v) => `mix(vec3(dot(${c}, ${LUMA})), ${c}, ${v.saturation})`
    });

    registerColorModule({
        type: "hue-rotate",
        name: "Hue rotate",
        description: "Rotates hue around the grey axis by the given angle in degrees.",
        controls: {
            hue: rangeControl("Hue", 0, -180, 180, 1)
        },
        // Rodrigues rotation around k = normalize(1,1,1)
        rgb: (c, v) => {
            const angle = `radians(${v.hue})`;
            return `(${c} * cos(${angle}) + cross(vec3(0.57735027), ${c}) * sin(${angle}) + ` +
                `vec3(0.57735027) * dot(vec3(0.57735027), ${c}) * (1.0 - cos(${angle})))`;
        }
    });

    registerColorModule({
        type: "color-temperature",
        name: "White balance",
        description: "Temperature warms (+, more red, less blue) or cools (-); tint shifts towards magenta (+) or green (-).",
        controls: {
            temperature: rangeControl("Temperature", 0, -1, 1, 0.01),
            tint: rangeControl("Tint", 0, -1, 1, 0.01)
        },
        rgb: (c, v) =>
            `(${c} * vec3(1.0 + 0.3 * ${v.temperature}, 1.0 - 0.3 * ${v.tint}, 1.0 - 0.3 * ${v.temperature}))`
    });

    // The next two back the legacy use_exposure / use_logscale filters, which ShaderLayer
    // migrates to pre-pipeline nodes. No value makes them an identity, matching the filters
    // they replace (which only ever ran with an explicit, authored value).

    registerColorModule({
        type: "exposure",
        name: "Exposure",
        description: "Exposure curve 1 - exp(-rgb * exposure) (legacy use_exposure filter).",
        identity: false,
        controls: {
            exposure: rangeControl("Exposure", 1, 0, 100, 0.1)
        },
        rgb: (c, v) => `(vec3(1.0) - exp(-(${c}) * ${v.exposure}))`
    });

    registerColorModule({
        type: "logscale",
        name: "Logarithmic scale",
        description: "Logarithmic rescale (log(s + rgb) - log(s)) / (log(s + 1) - log(s)) (legacy use_logscale filter).",
        identity: false,
        controls: {
            scale: rangeControl("Log scale", 1, 0.001, 100, 0.001)
        },
        rgb: (c, v) => {
            const s = `max(${v.scale}, 1e-6)`;
            return `((log(vec3(${s}) + ${c}) - vec3(log(${s}))) / (log(${s} + 1.0) - log(${s})))`;
        }
    });

})(OpenSeadragon);
