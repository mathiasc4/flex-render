(function($) {
    /**
     * Read a non-negative integer module parameter.
     *
     * @private
     * @param {ShaderModule} module - Module instance.
     * @param {string} name - Parameter name.
     * @param {number} fallback - Default value used when parameter is absent.
     * @returns {number} Non-negative integer value.
     * @throws {Error} Thrown when the parameter is present but invalid.
     */
    function readNonNegativeIntegerParam(module, name, fallback) {
        const raw = module.params[name];

        if (raw === undefined || raw === null) { // eslint-disable-line eqeqeq
            return fallback;
        }

        const value = Number.parseInt(raw, 10);
        if (!Number.isInteger(value) || value < 0 || String(value) !== String(raw).trim()) {
            throw new Error(`${module.constructor.name}: params.${name} must be a non-negative integer.`);
        }

        return value;
    }

    /**
     * Read a positive integer module parameter.
     *
     * @private
     * @param {ShaderModule} module - Module instance.
     * @param {string} name - Parameter name.
     * @param {number} fallback - Default value used when parameter is absent.
     * @returns {number} Positive integer value.
     * @throws {Error} Thrown when the parameter is present but invalid.
     */
    function readPositiveIntegerParam(module, name, fallback) {
        const raw = module.params[name];

        if (raw === undefined || raw === null) { // eslint-disable-line eqeqeq
            return fallback;
        }

        const value = Number.parseInt(raw, 10);
        if (!Number.isInteger(value) || value < 1 || String(value) !== String(raw).trim()) {
            throw new Error(`${module.constructor.name}: params.${name} must be a positive integer.`);
        }

        return value;
    }

    /**
     * Read one to four channel indexes from params.channelIndexes.
     *
     * @private
     * @param {ShaderModule} module - Module instance.
     * @returns {number[]} Channel indexes.
     * @throws {Error} Thrown when params.channelIndexes is invalid.
     */
    function readChannelIndexesParam(module) {
        const raw = module.params.channelIndexes;

        if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) {
            throw new Error(`${module.constructor.name}: params.channelIndexes must be an array with one to four non-negative integers.`);
        }

        return raw.map((entry, index) => {
            const value = Number.parseInt(entry, 10);
            if (!Number.isInteger(value) || value < 0 || String(value) !== String(entry).trim()) {
                throw new Error(`${module.constructor.name}: params.channelIndexes[${index}] must be a non-negative integer.`);
            }
            return value;
        });
    }

    /**
     * Return sorted unique channel indexes.
     *
     * @private
     * @param {number[]} channels - Channel indexes.
     * @returns {number[]} Sorted unique channel indexes.
     */
    function uniqueSortedChannels(channels) {
        return Array.from(new Set(channels)).sort((a, b) => a - b);
    }

    /**
     * Return the source channel count required by a channel index list.
     *
     * @private
     * @param {number[]} channels - Channel indexes.
     * @returns {number} Required source channel count.
     */
    function requiredChannelCount(channels) {
        return channels.length ? Math.max(...channels) + 1 : 0;
    }

    /**
     * Analyze a non-negative integer module parameter without throwing.
     *
     * @private
     * @param {ShaderModuleAnalysisContext} context - Module analysis context.
     * @param {ShaderModule} module - Module instance.
     * @param {string} name - Parameter name.
     * @param {number} fallback - Default value used when parameter is absent.
     * @returns {{ok: boolean, value: number}} Analysis result.
     */
    function analyzeNonNegativeIntegerParam(context, module, name, fallback) {
        const raw = module.params[name];

        if (raw === undefined || raw === null) { // eslint-disable-line eqeqeq
            return {
                ok: true,
                value: fallback
            };
        }

        const value = Number.parseInt(raw, 10);
        if (!Number.isInteger(value) || value < 0 || String(value) !== String(raw).trim()) {
            context.error({
                code: "invalid-integer-param",
                message: `${module.constructor.name}: params.${name} must be a non-negative integer.`,
                path: context.paramPath(name),
                details: {
                    paramName: name,
                    value: raw
                }
            });

            return {
                ok: false,
                value: fallback
            };
        }

        return {
            ok: true,
            value
        };
    }

    /**
     * Analyze a positive integer module parameter without throwing.
     *
     * @private
     * @param {ShaderModuleAnalysisContext} context - Module analysis context.
     * @param {ShaderModule} module - Module instance.
     * @param {string} name - Parameter name.
     * @param {number} fallback - Default value used when parameter is absent.
     * @returns {{ok: boolean, value: number}} Analysis result.
     */
    function analyzePositiveIntegerParam(context, module, name, fallback) {
        const raw = module.params[name];

        if (raw === undefined || raw === null) { // eslint-disable-line eqeqeq
            return {
                ok: true,
                value: fallback
            };
        }

        const value = Number.parseInt(raw, 10);
        if (!Number.isInteger(value) || value < 1 || String(value) !== String(raw).trim()) {
            context.error({
                code: "invalid-positive-integer-param",
                message: `${module.constructor.name}: params.${name} must be a positive integer.`,
                path: context.paramPath(name),
                details: {
                    paramName: name,
                    value: raw
                }
            });

            return {
                ok: false,
                value: fallback
            };
        }

        return {
            ok: true,
            value
        };
    }

    /**
     * Analyze params.channelIndexes without throwing.
     *
     * @private
     * @param {ShaderModuleAnalysisContext} context - Module analysis context.
     * @param {ShaderModule} module - Module instance.
     * @returns {{ok: boolean, value: number[]}} Analysis result.
     */
    function analyzeChannelIndexesParam(context, module) {
        const raw = module.params.channelIndexes;

        if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) {
            context.error({
                code: "invalid-channel-indexes-param",
                message: `${module.constructor.name}: params.channelIndexes must be an array with one to four non-negative integers.`,
                path: context.paramPath("channelIndexes"),
                details: {
                    value: raw
                }
            });

            return {
                ok: false,
                value: [0]
            };
        }

        const values = [];
        let ok = true;

        raw.forEach((entry, index) => {
            const value = Number.parseInt(entry, 10);
            if (!Number.isInteger(value) || value < 0 || String(value) !== String(entry).trim()) {
                ok = false;
                context.error({
                    code: "invalid-channel-index-param",
                    message: `${module.constructor.name}: params.channelIndexes[${index}] must be a non-negative integer.`,
                    path: context.paramPath("channelIndexes", index),
                    details: {
                        index,
                        value: entry
                    }
                });
                return;
            }

            values.push(value);
        });

        return {
            ok,
            value: values.length ? values : [0]
        };
    }

    /**
     * Return output names for a fixed 3x3 neighborhood.
     *
     * @private
     * @returns {string[]} Output names ordered row-major from upper-left to lower-right.
     */
    function neighborhood3x3Names() {
        return [
            "upperLeft",
            "up",
            "upperRight",
            "left",
            "center",
            "right",
            "lowerLeft",
            "down",
            "lowerRight"
        ];
    }

    /**
     * Return output descriptors for a 3x3 neighborhood with a concrete value type.
     *
     * @private
     * @param {string} type - Concrete GLSL value type.
     * @returns {Object<string, ShaderModulePortDescriptor>} Output definitions.
     */
    function neighborhood3x3Definitions(type) {
        const out = {};
        for (const name of neighborhood3x3Names()) {
            out[name] = {
                type,
                description: `Sample at the ${name} position of the 3x3 neighborhood.`
            };
        }
        return out;
    }

    /**
     * Return source requirements for modules that sample one source slot and channel list.
     *
     * @private
     * @param {number} sourceIndex - Source slot index.
     * @param {number[]} channels - Sampled channel indexes.
     * @param {string} description - Requirement description.
     * @returns {ShaderModuleSourceRequirement[]} Source requirements.
     */
    function sourceRequirement(sourceIndex, channels, description) {
        const sampledChannels = uniqueSortedChannels(channels);
        const count = requiredChannelCount(sampledChannels);

        return [{
            index: sourceIndex,
            sampledChannels,
            requiredChannelCount: count,
            acceptsChannelCount: () => true,
            description
        }];
    }

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Source module that samples a configurable 3x3 neighborhood.
         */
        class SampleNeighborhood3x3Module extends $.FlexRenderer.ShaderModule {
            static type() {
                return "sample-neighborhood-3x3";
            }

            static name() {
                return "Sample neighborhood 3x3";
            }

            static description() {
                return "Samples a 3x3 source neighborhood and outputs each sample separately.";
            }

            static sourceChannelParams() {
                return {
                    channelIndexes: {
                        mode: "list",
                        title: "Neighborhood channel indexes",
                        description: "Zero-based logical source channels sampled at each 3x3 neighborhood position.",
                        minLength: 1,
                        maxLength: 4
                    }
                };
            }

            static outputs() {
                const out = {};
                for (const name of neighborhood3x3Names()) {
                    out[name] = {
                        type: ["float", "vec2", "vec3", "vec4"],
                        description: `Sample at the ${name} position of the 3x3 neighborhood.`
                    };
                }
                return out;
            }

            static docs() {
                return {
                    summary: "Sample a 3x3 source neighborhood.",
                    description: "Samples one to four logical source channels at the nine texel offsets around v_texture_coords. The concrete output type is determined by params.channelIndexes.length.",
                    kind: "shader-module",
                    params: {
                        sourceIndex: "Numeric source slot index. Defaults to 0.",
                        channelIndexes: "Array of one to four numeric flattened channel indexes."
                    },
                    outputs: neighborhood3x3Names().map(name => ({
                        name,
                        type: "float | vec2 | vec3 | vec4",
                        description: `Sample at the ${name} position.`
                    }))
                };
            }

            getSourceRequirements() {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channels = readChannelIndexesParam(this);
                return sourceRequirement(
                    sourceIndex,
                    channels,
                    `Source ${sourceIndex} sampled as a 3x3 neighborhood.`
                );
            }

            getOutputDefinitions() {
                const count = readChannelIndexesParam(this).length;
                const type = count === 1 ? "float" : `vec${count}`;
                return neighborhood3x3Definitions(type);
            }

            analyze(context) {
                const sourceIndexResult = analyzeNonNegativeIntegerParam(context, this, "sourceIndex", 0);
                const channelsResult = analyzeChannelIndexesParam(context, this);
                const count = channelsResult.value.length;
                const type = count === 1 ? "float" : `vec${count}`;

                return {
                    inputDefinitions: {},
                    outputDefinitions: neighborhood3x3Definitions(type),
                    controlDefinitions: this.getControlDefinitions(),
                    sourceRequirements: sourceIndexResult.ok && channelsResult.ok ? sourceRequirement(
                        sourceIndexResult.value,
                        channelsResult.value,
                        `Source ${sourceIndexResult.value} sampled as a 3x3 neighborhood.`
                    ) : []
                };
            }

            compile(context) {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channels = readChannelIndexesParam(this);
                const type = this.getOutputDefinitions().center.type;
                const texelSize = `${this.uid}_texel_size`;
                const offsets = [
                    ["upperLeft", -1, -1],
                    ["up", 0, -1],
                    ["upperRight", 1, -1],
                    ["left", -1, 0],
                    ["center", 0, 0],
                    ["right", 1, 0],
                    ["lowerLeft", -1, 1],
                    ["down", 0, 1],
                    ["lowerRight", 1, 1]
                ];
                const statements = [`vec2 ${texelSize} = vec2(1.0) / vec2(float(${this.owner.getTextureSize()}.x), float(${this.owner.getTextureSize()}.y));`];
                const outputs = {};

                for (const [name, x, y] of offsets) {
                    const out = context.output(name, type);
                    const coords = `v_texture_coords + vec2(${x}.0, ${y}.0) * ${texelSize}`;
                    statements.push(`${type} ${out} = ${context.sampleSourceChannels(sourceIndex, channels, coords)};`);
                    outputs[name] = {
                        type,
                        expr: out
                    };
                }

                return {
                    statements: statements.join("\n"),
                    outputs
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Source module that computes a local weighted statistic for one scalar source channel.
         */
        class LocalWindowStatisticModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "local-window-statistic";
            }

            static name() {
                return "Local window statistic";
            }

            static description() {
                return "Computes a mean or Gaussian-weighted local mean over a square scalar neighborhood.";
            }

            static sourceChannelParams() {
                return {
                    channelIndex: {
                        mode: "single",
                        title: "Window channel index",
                        description: "Zero-based logical source channel used for local window sampling."
                    }
                };
            }

            static outputs() {
                return {
                    statistic: {
                        type: ["float"],
                        description: "Local mean or Gaussian-weighted local mean."
                    },
                    center: {
                        type: ["float"],
                        description: "Center sample value."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Local scalar window statistic.",
                    description: "Samples one scalar source channel over a square window and returns the center value plus a local mean. This supports adaptive thresholding and local contrast modules.",
                    kind: "shader-module",
                    params: {
                        sourceIndex: "Numeric source slot index. Defaults to 0.",
                        channelIndex: "Numeric flattened channel index. Defaults to 0.",
                        maxRadius: "Positive integer compile-time maximum radius. Defaults to 5."
                    },
                    outputs: [
                        { name: "statistic", type: "float", description: "Local mean or Gaussian-weighted local mean." },
                        { name: "center", type: "float", description: "Center sample value." }
                    ],
                    controls: [
                        { name: "block_size", ui: "range_input", valueType: "float", default: 5, min: 3, max: 11, step: 2 },
                        { name: "gaussian", ui: "bool", valueType: "bool", default: false }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    block_size: { // eslint-disable-line camelcase
                        default: {
                            type: "range_input",
                            default: 5,
                            min: 3,
                            max: 11,
                            step: 2,
                            title: "Block size"
                        },
                        accepts: (type) => type === "float"
                    },
                    gaussian: {
                        default: {
                            type: "bool",
                            default: false,
                            title: "Gaussian"
                        },
                        accepts: (type) => type === "bool"
                    }
                };
            }

            getSourceRequirements() {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channelIndex = readNonNegativeIntegerParam(this, "channelIndex", 0);
                return sourceRequirement(
                    sourceIndex,
                    [channelIndex],
                    `Source ${sourceIndex} sampled channel ${channelIndex} for a local scalar window.`
                );
            }

            getOutputDefinitions() {
                return {
                    statistic: {
                        type: "float",
                        description: "Local mean or Gaussian-weighted local mean."
                    },
                    center: {
                        type: "float",
                        description: "Center sample value."
                    }
                };
            }

            analyze(context) {
                const sourceIndexResult = analyzeNonNegativeIntegerParam(context, this, "sourceIndex", 0);
                const channelIndexResult = analyzeNonNegativeIntegerParam(context, this, "channelIndex", 0);
                analyzePositiveIntegerParam(context, this, "maxRadius", 5);

                return {
                    inputDefinitions: {},
                    outputDefinitions: this.getOutputDefinitions(),
                    controlDefinitions: this.getControlDefinitions(),
                    sourceRequirements: sourceIndexResult.ok && channelIndexResult.ok ? sourceRequirement(
                        sourceIndexResult.value,
                        [channelIndexResult.value],
                        `Source ${sourceIndexResult.value} sampled channel ${channelIndexResult.value} for a local scalar window.`
                    ) : []
                };
            }

            getFragmentShaderDefinition() {
                return `
float local_window_weight_${this.uid}(float dx, float dy, float radius, bool gaussianMode) {
    if (!gaussianMode) {
        return 1.0;
    }

    float sigma = max(radius * 0.5, 0.8);
    float rr = dx * dx + dy * dy;
    return exp(-rr / (2.0 * sigma * sigma));
}`;
            }

            compile(context) {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channelIndex = readNonNegativeIntegerParam(this, "channelIndex", 0);
                const maxRadius = readPositiveIntegerParam(this, "maxRadius", 5);
                const center = context.output("center", "float");
                const statistic = context.output("statistic", "float");
                const texelSize = `${this.uid}_texel_size`;
                const blockSize = `${this.uid}_block_size`;
                const radius = `${this.uid}_radius`;
                const sum = `${this.uid}_sum`;
                const weightSum = `${this.uid}_weight_sum`;
                const gaussian = this.control("gaussian").sample();
                const blockSizeControl = this.control("block_size").sample();

                return {
                    statements: `
vec2 ${texelSize} = vec2(1.0) / vec2(float(${this.owner.getTextureSize()}.x), float(${this.owner.getTextureSize()}.y));
float ${blockSize} = ${blockSizeControl};
float ${radius} = floor(${blockSize} * 0.5);
float ${center} = ${context.sampleSourceChannel(sourceIndex, channelIndex)};
float ${sum} = 0.0;
float ${weightSum} = 0.0;
for (int ${this.uid}_iy = -${maxRadius}; ${this.uid}_iy <= ${maxRadius}; ${this.uid}_iy++) {
    for (int ${this.uid}_ix = -${maxRadius}; ${this.uid}_ix <= ${maxRadius}; ${this.uid}_ix++) {
        float ${this.uid}_fx = float(${this.uid}_ix);
        float ${this.uid}_fy = float(${this.uid}_iy);
        if (abs(${this.uid}_fx) <= ${radius} && abs(${this.uid}_fy) <= ${radius}) {
            vec2 ${this.uid}_uv = v_texture_coords + vec2(${this.uid}_fx, ${this.uid}_fy) * ${texelSize};
            float ${this.uid}_w = local_window_weight_${this.uid}(${this.uid}_fx, ${this.uid}_fy, ${radius}, ${gaussian});
            ${sum} += ${context.sampleSourceChannel(sourceIndex, channelIndex, `${this.uid}_uv`)} * ${this.uid}_w;
            ${weightSum} += ${this.uid}_w;
        }
    }
}
float ${statistic} = ${sum} / max(${weightSum}, 1e-6);
`,
                    outputs: {
                        statistic: { type: "float", expr: statistic },
                        center: { type: "float", expr: center }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that thresholds a value against a local statistic minus C.
         */
        class LocalThresholdMaskModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "local-threshold-mask";
            }

            static name() {
                return "Local threshold mask";
            }

            static description() {
                return "Compares a center value against localStatistic - C and returns a binary mask.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Center scalar value."
                    },
                    statistic: {
                        type: "float",
                        required: true,
                        description: "Local statistic used as threshold base."
                    }
                };
            }

            static outputs() {
                return {
                    mask: {
                        type: ["float"],
                        description: "Binary local threshold mask."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Local adaptive threshold mask.",
                    description: "Returns value >= statistic - c_value, optionally inverted.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Center scalar value." },
                        { name: "statistic", type: "float", required: true, description: "Local statistic used as threshold base." }
                    ],
                    outputs: [
                        { name: "mask", type: "float", description: "Binary local threshold mask." }
                    ],
                    controls: [
                        { name: "c_value", ui: "range_input", valueType: "float", default: 0.03, min: -0.5, max: 0.5, step: 0.001 },
                        { name: "invert", ui: "bool", valueType: "bool", default: false }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    c_value: { // eslint-disable-line camelcase
                        default: {
                            type: "range_input",
                            default: 0.03,
                            min: -0.5,
                            max: 0.5,
                            step: 0.001,
                            title: "C"
                        },
                        accepts: (type) => type === "float"
                    },
                    invert: {
                        default: {
                            type: "bool",
                            default: false,
                            title: "Invert"
                        },
                        accepts: (type) => type === "bool"
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    mask: {
                        type: "float",
                        description: "Binary local threshold mask."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const statistic = context.input("statistic");
                const mask = context.output("mask", "float");
                const cValue = this.control("c_value").sample();
                const invert = this.control("invert").sample();

                return {
                    statements: `
float ${this.uid}_base_mask = ${value} >= (${statistic} - ${cValue}) ? 1.0 : 0.0;
float ${mask} = ${invert} ? 1.0 - ${this.uid}_base_mask : ${this.uid}_base_mask;
`,
                    outputs: {
                        mask: { type: "float", expr: mask }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that computes Sobel X/Y gradients from a vec3 3x3 neighborhood.
         */
        class SobelGradientModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "sobel-gradient";
            }

            static name() {
                return "Sobel gradient";
            }

            static description() {
                return "Computes RGB Sobel X and Y gradients from a vec3 3x3 neighborhood.";
            }

            static inputs() {
                const inputs = {};
                for (const name of neighborhood3x3Names()) {
                    inputs[name] = {
                        type: "vec3",
                        required: true,
                        description: `vec3 sample at the ${name} position.`
                    };
                }
                return inputs;
            }

            static outputs() {
                return {
                    gx: {
                        type: ["vec3"],
                        description: "Sobel X gradient."
                    },
                    gy: {
                        type: ["vec3"],
                        description: "Sobel Y gradient."
                    }
                };
            }

            static docs() {
                return {
                    summary: "RGB Sobel gradients.",
                    description: "Consumes the nine vec3 outputs from sample-neighborhood-3x3 and computes Sobel X/Y gradients.",
                    kind: "shader-module",
                    inputs: neighborhood3x3Names().map(name => ({
                        name,
                        type: "vec3",
                        required: true,
                        description: `vec3 sample at the ${name} position.`
                    })),
                    outputs: [
                        { name: "gx", type: "vec3", description: "Sobel X gradient." },
                        { name: "gy", type: "vec3", description: "Sobel Y gradient." }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    gx: {
                        type: "vec3",
                        description: "Sobel X gradient."
                    },
                    gy: {
                        type: "vec3",
                        description: "Sobel Y gradient."
                    }
                };
            }

            compile(context) {
                const ul = context.input("upperLeft");
                const up = context.input("up");
                const ur = context.input("upperRight");
                const left = context.input("left");
                const right = context.input("right");
                const ll = context.input("lowerLeft");
                const down = context.input("down"); // eslint-disable-line no-unused-vars
                const lr = context.input("lowerRight");
                const gx = context.output("gx", "vec3");
                const gy = context.output("gy", "vec3");

                return {
                    statements: `
vec3 ${gx} = -${ul} + ${ur} - 2.0 * ${left} + 2.0 * ${right} - ${ll} + ${lr};
vec3 ${gy} = -${ul} - 2.0 * ${up} - ${ur} + ${ll} + 2.0 * ${down} + ${lr};
`,
                    outputs: {
                        gx: { type: "vec3", expr: gx },
                        gy: { type: "vec3", expr: gy }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that converts vector gradients to scalar magnitude.
         */
        class GradientMagnitudeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "gradient-magnitude";
            }

            static name() {
                return "Gradient magnitude";
            }

            static description() {
                return "Computes scalar edge strength from vec3 X and Y gradients.";
            }

            static inputs() {
                return {
                    gx: {
                        type: "vec3",
                        required: true,
                        description: "X gradient vector."
                    },
                    gy: {
                        type: "vec3",
                        required: true,
                        description: "Y gradient vector."
                    }
                };
            }

            static outputs() {
                return {
                    magnitude: {
                        type: ["float"],
                        description: "Scalar gradient magnitude."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Gradient magnitude.",
                    description: "Returns length(gx) + length(gy), matching the current Sobel shader behavior.",
                    kind: "shader-module",
                    inputs: [
                        { name: "gx", type: "vec3", required: true, description: "X gradient vector." },
                        { name: "gy", type: "vec3", required: true, description: "Y gradient vector." }
                    ],
                    outputs: [
                        { name: "magnitude", type: "float", description: "Scalar gradient magnitude." }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    magnitude: {
                        type: "float",
                        description: "Scalar gradient magnitude."
                    }
                };
            }

            compile(context) {
                const gx = context.input("gx");
                const gy = context.input("gy");
                const magnitude = context.output("magnitude", "float");

                return {
                    statements: `float ${magnitude} = length(${gx}) + length(${gy});`,
                    outputs: {
                        magnitude: { type: "float", expr: magnitude }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that computes a zoom-scaled sampling distance.
         */
        class ZoomScaledDistanceModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "zoom-scaled-distance";
            }

            static name() {
                return "Zoom-scaled distance";
            }

            static description() {
                return "Computes a sampling distance scaled by sqrt(zoom).";
            }

            static outputs() {
                return {
                    distance: {
                        type: ["float"],
                        description: "Distance value for local sampling."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Zoom-scaled distance.",
                    description: "Computes edge_thickness * sqrt(zoom) * zoom_scale + base_distance. This generalizes the current edge shader sampling distance.",
                    kind: "shader-module",
                    outputs: [
                        { name: "distance", type: "float", description: "Distance value for local sampling." }
                    ],
                    controls: [
                        { name: "edge_thickness", ui: "range", valueType: "float", default: 1, min: 0.5, max: 3, step: 0.1 },
                        { name: "zoom_scale", ui: "range", valueType: "float", default: 0.005, min: 0, max: 0.05, step: 0.0005 },
                        { name: "base_distance", ui: "range", valueType: "float", default: 0.008, min: 0, max: 0.05, step: 0.0005 }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    edge_thickness: { // eslint-disable-line camelcase
                        default: {
                            type: "range",
                            default: 1,
                            min: 0.5,
                            max: 3,
                            step: 0.1,
                            title: "Edge thickness"
                        },
                        accepts: (type) => type === "float"
                    },
                    zoom_scale: { // eslint-disable-line camelcase
                        default: {
                            type: "range",
                            default: 0.005,
                            min: 0,
                            max: 0.05,
                            step: 0.0005,
                            title: "Zoom scale"
                        },
                        accepts: (type) => type === "float"
                    },
                    base_distance: { // eslint-disable-line camelcase
                        default: {
                            type: "range",
                            default: 0.008,
                            min: 0,
                            max: 0.05,
                            step: 0.0005,
                            title: "Base distance"
                        },
                        accepts: (type) => type === "float"
                    }
                };
            }

            getOutputDefinitions() {
                return {
                    distance: {
                        type: "float",
                        description: "Distance value for local sampling."
                    }
                };
            }

            compile(context) {
                const out = context.output("distance", "float");
                const thickness = this.control("edge_thickness").sample();
                const zoomScale = this.control("zoom_scale").sample();
                const baseDistance = this.control("base_distance").sample();

                return {
                    statements: `float ${out} = ${thickness} * sqrt(zoom) * ${zoomScale} + ${baseDistance};`,
                    outputs: {
                        distance: { type: "float", expr: out }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Source module that samples scalar center and eight neighbors at a dynamic distance.
         */
        class CrossNeighborhoodSampleModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "cross-neighborhood-sample";
            }

            static name() {
                return "Cross neighborhood sample";
            }

            static description() {
                return "Samples a scalar center, cardinal neighbors, and diagonal neighbors at a supplied UV distance.";
            }

            static inputs() {
                return {
                    distance: {
                        type: "float",
                        required: false,
                        description: "UV sampling distance. Defaults to 0.01 when not connected."
                    }
                };
            }

            static sourceChannelParams() {
                return {
                    channelIndex: {
                        mode: "single",
                        title: "Neighborhood channel index",
                        description: "Zero-based logical source channel sampled for the dynamic scalar neighborhood."
                    }
                };
            }

            static outputs() {
                const out = {};
                for (const name of neighborhood3x3Names()) {
                    out[name] = {
                        type: ["float"],
                        description: `Scalar sample at the ${name} position.`
                    };
                }
                return out;
            }

            static docs() {
                return {
                    summary: "Dynamic scalar neighborhood sampling.",
                    description: "Samples one scalar source channel at center and eight surrounding points using an input UV distance. This is useful for threshold-boundary and contour modules.",
                    kind: "shader-module",
                    params: {
                        sourceIndex: "Numeric source slot index. Defaults to 0.",
                        channelIndex: "Numeric flattened channel index. Defaults to 0."
                    },
                    inputs: [
                        { name: "distance", type: "float", required: false, description: "UV sampling distance. Defaults to 0.01." }
                    ],
                    outputs: neighborhood3x3Names().map(name => ({
                        name,
                        type: "float",
                        description: `Scalar sample at the ${name} position.`
                    }))
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getSourceRequirements() {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channelIndex = readNonNegativeIntegerParam(this, "channelIndex", 0);
                return sourceRequirement(
                    sourceIndex,
                    [channelIndex],
                    `Source ${sourceIndex} sampled channel ${channelIndex} for dynamic scalar neighborhood.`
                );
            }

            getOutputDefinitions() {
                return neighborhood3x3Definitions("float");
            }

            analyze(context) {
                const sourceIndexResult = analyzeNonNegativeIntegerParam(context, this, "sourceIndex", 0);
                const channelIndexResult = analyzeNonNegativeIntegerParam(context, this, "channelIndex", 0);

                return {
                    inputDefinitions: this.getInputDefinitions(),
                    outputDefinitions: this.getOutputDefinitions(),
                    controlDefinitions: this.getControlDefinitions(),
                    sourceRequirements: sourceIndexResult.ok && channelIndexResult.ok ? sourceRequirement(
                        sourceIndexResult.value,
                        [channelIndexResult.value],
                        `Source ${sourceIndexResult.value} sampled channel ${channelIndexResult.value} for dynamic scalar neighborhood.`
                    ) : []
                };
            }

            compile(context) {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channelIndex = readNonNegativeIntegerParam(this, "channelIndex", 0);
                const distance = context.input("distance", "0.01");
                const offsets = [
                    ["upperLeft", `vec2(v_texture_coords.x - ${distance}, v_texture_coords.y - ${distance})`],
                    ["up", `vec2(v_texture_coords.x, v_texture_coords.y - ${distance})`],
                    ["upperRight", `vec2(v_texture_coords.x + ${distance}, v_texture_coords.y - ${distance})`],
                    ["left", `vec2(v_texture_coords.x - ${distance}, v_texture_coords.y)`],
                    ["center", "v_texture_coords"],
                    ["right", `vec2(v_texture_coords.x + ${distance}, v_texture_coords.y)`],
                    ["lowerLeft", `vec2(v_texture_coords.x - ${distance}, v_texture_coords.y + ${distance})`],
                    ["down", `vec2(v_texture_coords.x, v_texture_coords.y + ${distance})`],
                    ["lowerRight", `vec2(v_texture_coords.x + ${distance}, v_texture_coords.y + ${distance})`]
                ];
                const statements = [];
                const outputs = {};

                for (const [name, coords] of offsets) {
                    const out = context.output(name, "float");
                    statements.push(`float ${out} = ${context.sampleSourceChannel(sourceIndex, channelIndex, coords)};`);
                    outputs[name] = {
                        type: "float",
                        expr: out
                    };
                }

                return {
                    statements: statements.join("\n"),
                    outputs
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that converts scalar neighborhood samples to threshold score extrema.
         */
        class ThresholdNeighborhoodScoreModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "threshold-neighborhood-score";
            }

            static name() {
                return "Threshold neighborhood score";
            }

            static description() {
                return "Computes value - threshold(value) over a scalar neighborhood and returns center, minimum, and maximum scores.";
            }

            static inputs() {
                const inputs = {};
                for (const name of neighborhood3x3Names()) {
                    inputs[name] = {
                        type: "float",
                        required: true,
                        description: `Scalar sample at the ${name} position.`
                    };
                }
                return inputs;
            }

            static outputs() {
                return {
                    centerScore: {
                        type: ["float"],
                        description: "Threshold score for the center sample."
                    },
                    minScore: {
                        type: ["float"],
                        description: "Minimum threshold score in the neighborhood."
                    },
                    maxScore: {
                        type: ["float"],
                        description: "Maximum threshold score in the neighborhood."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Threshold score neighborhood.",
                    description: "Computes sample - threshold.sample(sample) for each neighborhood value. The extrema indicate whether a threshold crossing passes through the neighborhood.",
                    kind: "shader-module",
                    inputs: neighborhood3x3Names().map(name => ({
                        name,
                        type: "float",
                        required: true,
                        description: `Scalar sample at the ${name} position.`
                    })),
                    outputs: [
                        { name: "centerScore", type: "float", description: "Threshold score for center sample." },
                        { name: "minScore", type: "float", description: "Minimum threshold score." },
                        { name: "maxScore", type: "float", description: "Maximum threshold score." }
                    ],
                    controls: [
                        { name: "threshold", ui: "range_input", valueType: "float", default: 50, min: 1, max: 100, step: 1 }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    threshold: {
                        default: {
                            type: "range_input",
                            default: 50,
                            min: 1,
                            max: 100,
                            step: 1,
                            title: "Threshold"
                        },
                        accepts: (type) => type === "float"
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    centerScore: {
                        type: "float",
                        description: "Threshold score for the center sample."
                    },
                    minScore: {
                        type: "float",
                        description: "Minimum threshold score in the neighborhood."
                    },
                    maxScore: {
                        type: "float",
                        description: "Maximum threshold score in the neighborhood."
                    }
                };
            }

            compile(context) {
                const scoreNames = neighborhood3x3Names().map(name => `${this.uid}_${name}_score`);
                const statements = [];
                const threshold = this.control("threshold");
                neighborhood3x3Names().forEach((name, index) => {
                    const value = context.input(name);
                    statements.push(`float ${scoreNames[index]} = ${value} - (${threshold.sample(value, "float")});`);
                });

                const centerScore = context.output("centerScore", "float");
                const minScore = context.output("minScore", "float");
                const maxScore = context.output("maxScore", "float");
                const minExpr = scoreNames.reduce((expr, name) => `min(${expr}, ${name})`);
                const maxExpr = scoreNames.reduce((expr, name) => `max(${expr}, ${name})`);

                statements.push(`float ${centerScore} = ${scoreNames[4]};`);
                statements.push(`float ${minScore} = ${minExpr};`);
                statements.push(`float ${maxScore} = ${maxExpr};`);

                return {
                    statements: statements.join("\n"),
                    outputs: {
                        centerScore: { type: "float", expr: centerScore },
                        minScore: { type: "float", expr: minScore },
                        maxScore: { type: "float", expr: maxScore }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that computes threshold-crossing edge alpha and side masks.
         */
        class EdgeCrossingModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "edge-crossing";
            }

            static name() {
                return "Edge crossing";
            }

            static description() {
                return "Computes derivative-aware alpha for a threshold crossing across a local neighborhood.";
            }

            static inputs() {
                return {
                    centerScore: {
                        type: "float",
                        required: true,
                        description: "Threshold score at the center point."
                    },
                    minScore: {
                        type: "float",
                        required: true,
                        description: "Minimum threshold score in the neighborhood."
                    },
                    maxScore: {
                        type: "float",
                        required: true,
                        description: "Maximum threshold score in the neighborhood."
                    }
                };
            }

            static outputs() {
                return {
                    alpha: {
                        type: ["float"],
                        description: "Edge alpha."
                    },
                    lowerAlpha: {
                        type: ["float"],
                        description: "Edge alpha on the lower side of the threshold."
                    },
                    upperAlpha: {
                        type: ["float"],
                        description: "Edge alpha on the upper side of the threshold."
                    },
                    side: {
                        type: ["float"],
                        description: "0.0 on the lower side, 1.0 on the upper side."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Derivative-aware edge crossing.",
                    description: "Uses min/max threshold scores plus dFdx/dFdy center derivatives to produce antialiased threshold-boundary alpha and side-specific alpha masks.",
                    kind: "shader-module",
                    inputs: [
                        { name: "centerScore", type: "float", required: true, description: "Threshold score at center." },
                        { name: "minScore", type: "float", required: true, description: "Minimum neighborhood score." },
                        { name: "maxScore", type: "float", required: true, description: "Maximum neighborhood score." }
                    ],
                    outputs: [
                        { name: "alpha", type: "float", description: "Edge alpha." },
                        { name: "lowerAlpha", type: "float", description: "Lower-side edge alpha." },
                        { name: "upperAlpha", type: "float", description: "Upper-side edge alpha." },
                        { name: "side", type: "float", description: "0.0 lower side, 1.0 upper side." }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    alpha: {
                        type: "float",
                        description: "Edge alpha."
                    },
                    lowerAlpha: {
                        type: "float",
                        description: "Edge alpha on the lower side of the threshold."
                    },
                    upperAlpha: {
                        type: "float",
                        description: "Edge alpha on the upper side of the threshold."
                    },
                    side: {
                        type: "float",
                        description: "0.0 on the lower side, 1.0 on the upper side."
                    }
                };
            }

            compile(context) {
                const centerScore = context.input("centerScore");
                const minScore = context.input("minScore");
                const maxScore = context.input("maxScore");
                const alpha = context.output("alpha", "float");
                const lowerAlpha = context.output("lowerAlpha", "float");
                const upperAlpha = context.output("upperAlpha", "float");
                const side = context.output("side", "float");

                return {
                    statements: `
float ${this.uid}_span = max(${maxScore} - ${minScore}, 0.0);
float ${this.uid}_deriv = abs(dFdx(${centerScore})) + abs(dFdy(${centerScore}));
float ${this.uid}_softness = max(0.01, max(${this.uid}_span * 0.35, ${this.uid}_deriv * 2.0));
float ${this.uid}_low = smoothstep(-${this.uid}_softness, 0.0, ${maxScore});
float ${this.uid}_high = 1.0 - smoothstep(0.0, ${this.uid}_softness, ${minScore});
float ${alpha} = clamp(${this.uid}_low * ${this.uid}_high, 0.0, 1.0);
float ${side} = step(0.0, ${centerScore});
float ${lowerAlpha} = ${alpha} * (1.0 - ${side});
float ${upperAlpha} = ${alpha} * ${side};
`,
                    outputs: {
                        alpha: { type: "float", expr: alpha },
                        lowerAlpha: { type: "float", expr: lowerAlpha },
                        upperAlpha: { type: "float", expr: upperAlpha },
                        side: { type: "float", expr: side }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that colorizes lower and upper edge alpha separately.
         */
        class TwoSidedEdgeColorizeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "two-sided-edge-colorize";
            }

            static name() {
                return "Two-sided edge colorize";
            }

            static description() {
                return "Combines lower-side and upper-side edge alpha values with separate colors.";
            }

            static inputs() {
                return {
                    lowerAlpha: {
                        type: "float",
                        required: true,
                        description: "Alpha for the lower side of the edge."
                    },
                    upperAlpha: {
                        type: "float",
                        required: true,
                        description: "Alpha for the upper side of the edge."
                    }
                };
            }

            static outputs() {
                return {
                    color: {
                        type: ["vec4"],
                        description: "Two-sided edge RGBA color."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Two-sided edge colorization.",
                    description: "Maps lowerAlpha to inner_color and upperAlpha to outer_color. The final alpha is max(lowerAlpha, upperAlpha).",
                    kind: "shader-module",
                    inputs: [
                        { name: "lowerAlpha", type: "float", required: true, description: "Alpha for lower-side edge." },
                        { name: "upperAlpha", type: "float", required: true, description: "Alpha for upper-side edge." }
                    ],
                    outputs: [
                        { name: "color", type: "vec4", description: "Two-sided edge RGBA color." }
                    ],
                    controls: [
                        { name: "inner_color", ui: "color", valueType: "vec3", default: "#b2a800" },
                        { name: "outer_color", ui: "color", valueType: "vec3", default: "#fff700" }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    inner_color: { // eslint-disable-line camelcase
                        default: {
                            type: "color",
                            default: "#b2a800",
                            title: "Inner color"
                        },
                        accepts: (type) => type === "vec3"
                    },
                    outer_color: { // eslint-disable-line camelcase
                        default: {
                            type: "color",
                            default: "#fff700",
                            title: "Outer color"
                        },
                        accepts: (type) => type === "vec3"
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    color: {
                        type: "vec4",
                        description: "Two-sided edge RGBA color."
                    }
                };
            }

            compile(context) {
                const lowerAlpha = context.input("lowerAlpha");
                const upperAlpha = context.input("upperAlpha");
                const color = context.output("color", "vec4");
                const inner = this.control("inner_color").sample();
                const outer = this.control("outer_color").sample();

                return {
                    statements: `
float ${this.uid}_alpha = max(${lowerAlpha}, ${upperAlpha});
vec3 ${this.uid}_rgb = ${inner} * ${lowerAlpha} + ${outer} * ${upperAlpha};
vec4 ${color} = ${this.uid}_alpha > 0.0 ? vec4(${this.uid}_rgb / ${this.uid}_alpha, ${this.uid}_alpha) : vec4(0.0);
`,
                    outputs: {
                        color: { type: "vec4", expr: color }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that computes value minus a sampled threshold control.
         */
        class ThresholdScoreModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "threshold-score";
            }

            static name() {
                return "Threshold score";
            }

            static description() {
                return "Computes a signed threshold score from one scalar value.";
            }

            static inputs() {
                return {
                    value: {
                        type: "float",
                        required: true,
                        description: "Scalar value to compare to the threshold control."
                    }
                };
            }

            static outputs() {
                return {
                    score: {
                        type: ["float"],
                        description: "Signed score value - threshold.sample(value)."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Single-value threshold score.",
                    description: "Computes value - threshold.sample(value). Positive scores are above the threshold, negative scores are below it.",
                    kind: "shader-module",
                    inputs: [
                        { name: "value", type: "float", required: true, description: "Scalar value to compare." }
                    ],
                    outputs: [
                        { name: "score", type: "float", description: "Signed threshold score." }
                    ],
                    controls: [
                        { name: "threshold", ui: "range_input", valueType: "float", default: 50, min: 1, max: 100, step: 1 }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    threshold: {
                        default: {
                            type: "range_input",
                            default: 50,
                            min: 1,
                            max: 100,
                            step: 1,
                            title: "Threshold"
                        },
                        accepts: (type) => type === "float"
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    score: {
                        type: "float",
                        description: "Signed score value - threshold.sample(value)."
                    }
                };
            }

            compile(context) {
                const value = context.input("value");
                const score = context.output("score", "float");
                const threshold = this.control("threshold").sample(value, "float");

                return {
                    statements: `float ${score} = ${value} - (${threshold});`,
                    outputs: {
                        score: { type: "float", expr: score }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that computes Gaussian or uniform window weight.
         */
        class GaussianWindowWeightModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "gaussian-window-weight";
            }

            static name() {
                return "Gaussian window weight";
            }

            static description() {
                return "Computes a Gaussian or uniform sampling weight from dx, dy, and radius.";
            }

            static inputs() {
                return {
                    dx: {
                        type: "float",
                        required: true,
                        description: "X offset from the center sample."
                    },
                    dy: {
                        type: "float",
                        required: true,
                        description: "Y offset from the center sample."
                    },
                    radius: {
                        type: "float",
                        required: true,
                        description: "Window radius."
                    }
                };
            }

            static outputs() {
                return {
                    weight: {
                        type: ["float"],
                        description: "Gaussian or uniform window weight."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Gaussian or uniform window weight.",
                    description: "Computes exp(-(dx² + dy²) / (2σ²)) where σ = max(radius * 0.5, 0.8). If gaussian is disabled, returns 1.0.",
                    kind: "shader-module",
                    inputs: [
                        { name: "dx", type: "float", required: true, description: "X offset." },
                        { name: "dy", type: "float", required: true, description: "Y offset." },
                        { name: "radius", type: "float", required: true, description: "Window radius." }
                    ],
                    outputs: [
                        { name: "weight", type: "float", description: "Gaussian or uniform window weight." }
                    ],
                    controls: [
                        { name: "gaussian", ui: "bool", valueType: "bool", default: true }
                    ]
                };
            }

            static get defaultControls() {
                return {
                    gaussian: {
                        default: {
                            type: "bool",
                            default: true,
                            title: "Gaussian"
                        },
                        accepts: (type) => type === "bool"
                    }
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    weight: {
                        type: "float",
                        description: "Gaussian or uniform window weight."
                    }
                };
            }

            compile(context) {
                const dx = context.input("dx");
                const dy = context.input("dy");
                const radius = context.input("radius");
                const weight = context.output("weight", "float");
                const gaussian = this.control("gaussian").sample();

                return {
                    statements: `
float ${this.uid}_sigma = max(${radius} * 0.5, 0.8);
float ${this.uid}_rr = ${dx} * ${dx} + ${dy} * ${dy};
float ${weight} = ${gaussian} ? exp(-${this.uid}_rr / (2.0 * ${this.uid}_sigma * ${this.uid}_sigma)) : 1.0;
`,
                    outputs: {
                        weight: { type: "float", expr: weight }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Module that splits edge alpha by the threshold side.
         */
        class EdgeSideAlphaModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "edge-side-alpha";
            }

            static name() {
                return "Edge side alpha";
            }

            static description() {
                return "Splits one edge alpha value into lower-side and upper-side alpha values.";
            }

            static inputs() {
                return {
                    alpha: {
                        type: "float",
                        required: true,
                        description: "Edge alpha to split."
                    },
                    side: {
                        type: "float",
                        required: true,
                        description: "0.0 lower side, 1.0 upper side."
                    }
                };
            }

            static outputs() {
                return {
                    lowerAlpha: {
                        type: ["float"],
                        description: "Alpha assigned to the lower side."
                    },
                    upperAlpha: {
                        type: ["float"],
                        description: "Alpha assigned to the upper side."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Split edge alpha by side.",
                    description: "Computes lowerAlpha = alpha * (1 - side) and upperAlpha = alpha * side.",
                    kind: "shader-module",
                    inputs: [
                        { name: "alpha", type: "float", required: true, description: "Edge alpha to split." },
                        { name: "side", type: "float", required: true, description: "0.0 lower side, 1.0 upper side." }
                    ],
                    outputs: [
                        { name: "lowerAlpha", type: "float", description: "Alpha assigned to lower side." },
                        { name: "upperAlpha", type: "float", description: "Alpha assigned to upper side." }
                    ]
                };
            }

            getInputDefinitions() {
                return this.constructor.inputs();
            }

            getOutputDefinitions() {
                return {
                    lowerAlpha: {
                        type: "float",
                        description: "Alpha assigned to the lower side."
                    },
                    upperAlpha: {
                        type: "float",
                        description: "Alpha assigned to the upper side."
                    }
                };
            }

            compile(context) {
                const alpha = context.input("alpha");
                const side = context.input("side");
                const lowerAlpha = context.output("lowerAlpha", "float");
                const upperAlpha = context.output("upperAlpha", "float");

                return {
                    statements: `
float ${this.uid}_side = clamp(${side}, 0.0, 1.0);
float ${lowerAlpha} = ${alpha} * (1.0 - ${this.uid}_side);
float ${upperAlpha} = ${alpha} * ${this.uid}_side;
`,
                    outputs: {
                        lowerAlpha: { type: "float", expr: lowerAlpha },
                        upperAlpha: { type: "float", expr: upperAlpha }
                    }
                };
            }
        }
    );

})(OpenSeadragon);
