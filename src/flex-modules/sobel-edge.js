(function($) {
    function readNonNegativeIntegerParam(module, name, defaultValue) {
        const raw = module.params[name];

        if (raw === undefined || raw === null) { // eslint-disable-line eqeqeq
            return defaultValue;
        }

        const value = Number.parseInt(raw, 10);
        if (!Number.isInteger(value) || value < 0 || String(value) !== String(raw).trim()) {
            throw new Error(`${module.constructor.name}: params.${name} must be a non-negative integer.`);
        }

        return value;
    }

    function readRgbChannelIndexesParam(module) {
        const raw = module.params.channelIndexes === undefined ? [0, 1, 2] : module.params.channelIndexes;

        if (!Array.isArray(raw) || raw.length !== 3) {
            throw new Error(`${module.constructor.name}: params.channelIndexes must be an array with exactly three non-negative integers.`);
        }

        return raw.map((entry, index) => {
            const value = Number.parseInt(entry, 10);
            if (!Number.isInteger(value) || value < 0 || String(value) !== String(entry).trim()) {
                throw new Error(`${module.constructor.name}: params.channelIndexes[${index}] must be a non-negative integer.`);
            }
            return value;
        });
    }

    function uniqueSortedChannelIndexes(channelIndexes) {
        return Array.from(new Set(channelIndexes)).sort((a, b) => a - b);
    }

    function getRequiredChannelCount(channelIndexes) {
        return channelIndexes.length ? Math.max(...channelIndexes) + 1 : 0;
    }

    function analyzeNonNegativeIntegerParam(context, module, name, defaultValue) {
        const raw = module.params[name];

        if (raw === undefined || raw === null) { // eslint-disable-line eqeqeq
            return { ok: true, value: defaultValue };
        }

        const value = Number.parseInt(raw, 10);
        if (!Number.isInteger(value) || value < 0 || String(value) !== String(raw).trim()) {
            context.error({
                code: "invalid-module-param",
                message: `${module.constructor.name}: params.${name} must be a non-negative integer.`,
                path: context.paramPath(name),
                details: { actual: raw }
            });
            return { ok: false, value: defaultValue };
        }

        return { ok: true, value };
    }

    function analyzeRgbChannelIndexesParam(context, module) {
        const raw = module.params.channelIndexes === undefined ? [0, 1, 2] : module.params.channelIndexes;

        if (!Array.isArray(raw) || raw.length !== 3) {
            context.error({
                code: "invalid-module-param",
                message: `${module.constructor.name}: params.channelIndexes must be an array with exactly three non-negative integers.`,
                path: context.paramPath("channelIndexes"),
                details: { actual: raw }
            });
            return { ok: false, value: [0, 1, 2] };
        }

        let ok = true;
        const values = raw.map((entry, index) => {
            const value = Number.parseInt(entry, 10);
            if (!Number.isInteger(value) || value < 0 || String(value) !== String(entry).trim()) {
                ok = false;
                context.error({
                    code: "invalid-module-param",
                    message: `${module.constructor.name}: params.channelIndexes[${index}] must be a non-negative integer.`,
                    path: context.paramPath("channelIndexes", index),
                    details: { actual: entry }
                });
                return 0;
            }
            return value;
        });

        return { ok, value: values };
    }

    $.FlexRenderer.ShaderModuleRegistry.register(
        class SobelEdgeModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "sobel-edge";
            }

            static name() {
                return "Sobel edge";
            }

            static description() {
                return "Samples a 3x3 RGB neighborhood from one source slot and outputs Sobel edge strength.";
            }

            static sourceChannelParams() {
                return {
                    channelIndexes: {
                        mode: "list",
                        title: "RGB channel indexes",
                        description: "Exactly three zero-based logical source channels sampled as RGB.",
                        minLength: 3,
                        maxLength: 3
                    }
                };
            }

            static outputs() {
                return {
                    edge: {
                        type: ["float"],
                        description: "Sobel edge strength."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Sobel edge strength.",
                    description: "Samples a 3x3 neighborhood, applies Sobel X and Y kernels independently to RGB data, and outputs scalar edge strength.",
                    kind: "shader-module",
                    params: {
                        sourceIndex: "Numeric source slot index. Defaults to 0.",
                        channelIndexes: "Exactly three source channel indexes sampled as RGB. Defaults to [0, 1, 2]."
                    },
                    outputs: [
                        { name: "edge", type: "float", description: "Sobel edge strength." }
                    ]
                };
            }

            getSourceRequirements() {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const sampledChannels = uniqueSortedChannelIndexes(readRgbChannelIndexesParam(this));
                const requiredChannelCount = getRequiredChannelCount(sampledChannels);

                return [{
                    index: sourceIndex,
                    sampledChannels,
                    requiredChannelCount,
                    acceptsChannelCount: () => true,
                    description: `Source ${sourceIndex} sampled as RGB channels ${sampledChannels.join(", ")}. Requires at least ${requiredChannelCount} channels.`
                }];
            }

            getOutputDefinitions() {
                return {
                    edge: {
                        type: "float",
                        description: "Sobel edge strength."
                    }
                };
            }

            analyze(context) {
                const sourceIndexResult = analyzeNonNegativeIntegerParam(context, this, "sourceIndex", 0);
                const channelIndexesResult = analyzeRgbChannelIndexesParam(context, this);
                const sampledChannels = uniqueSortedChannelIndexes(channelIndexesResult.value);
                const requiredChannelCount = getRequiredChannelCount(sampledChannels);

                return {
                    inputDefinitions: this.getInputDefinitions(),
                    outputDefinitions: this.getOutputDefinitions(),
                    controlDefinitions: this.getControlDefinitions(),
                    sourceRequirements: sourceIndexResult.ok && channelIndexesResult.ok ? [{
                        index: sourceIndexResult.value,
                        sampledChannels,
                        requiredChannelCount,
                        acceptsChannelCount: () => true,
                        description: `Source ${sourceIndexResult.value} sampled as RGB channels ${sampledChannels.join(", ")}. Requires at least ${requiredChannelCount} channels.`
                    }] : []
                };
            }

            compile(context) {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channelIndexes = readRgbChannelIndexesParam(this);
                const edge = context.output("edge", "float");
                const textureSize = this.owner.getTextureSize(sourceIndex);
                const texelSize = `${edge}_texelSize`;
                const idx = `${edge}_idx`;
                const sumX = `${edge}_sumX`;
                const sumY = `${edge}_sumY`;
                const sample = context.sampleSourceChannels(
                    sourceIndex,
                    channelIndexes,
                    `v_texture_coords + vec2(float(x), float(y)) * ${texelSize}`,
                    { raw: true }
                );

                return {
                    statements: `
float ${edge}_kernelX[9] = float[9](-1.0,  0.0,  1.0,
                                    -2.0,  0.0,  2.0,
                                    -1.0,  0.0,  1.0);
float ${edge}_kernelY[9] = float[9](-1.0, -2.0, -1.0,
                                     0.0,  0.0,  0.0,
                                     1.0,  2.0,  1.0);
vec3 ${sumX} = vec3(0.0);
vec3 ${sumY} = vec3(0.0);
vec2 ${texelSize} = vec2(1.0) / vec2(float(${textureSize}.x), float(${textureSize}.y));
int ${idx} = 0;
for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
        vec3 ${edge}_sampleColor = ${sample};
        ${sumX} += ${edge}_sampleColor * ${edge}_kernelX[${idx}];
        ${sumY} += ${edge}_sampleColor * ${edge}_kernelY[${idx}];
        ${idx}++;
    }
}
float ${edge} = length(${sumX}) + length(${sumY});
`,
                    outputs: {
                        edge: { type: "float", expr: edge }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
