(function($) {
    /**
     * Read a non-negative integer module parameter.
     *
     * @private
     * @param {ShaderModule} module - Module instance.
     * @param {string} name - Parameter name.
     * @param {number} defaultValue - Default value used when the parameter is absent.
     * @returns {number} Non-negative integer value.
     * @throws {Error} Thrown when the parameter is present but invalid.
     */
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

    /**
     * Read a one-to-four-element numeric channel index array.
     *
     * @private
     * @param {ShaderModule} module - Module instance.
     * @returns {number[]} Channel index list.
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
     * @param {number[]} channelIndexes - Channel indexes to normalize.
     * @returns {number[]} Sorted unique channel indexes.
     */
    function uniqueSortedChannelIndexes(channelIndexes) {
        return Array.from(new Set(channelIndexes)).sort((a, b) => a - b);
    }

    /**
     * Return the minimum source channel count needed to sample the given channels.
     *
     * Channel indexes are zero-based, so channel 7 requires at least 8 channels.
     *
     * @private
     * @param {number[]} channelIndexes - Channel indexes read by a module.
     * @returns {number} Required channel count.
     */
    function getRequiredChannelCount(channelIndexes) {
        return channelIndexes.length ? Math.max(...channelIndexes) + 1 : 0;
    }

    /**
     * Format sampled channel indexes for diagnostics.
     *
     * @private
     * @param {number[]} channelIndexes - Channel indexes to format.
     * @returns {string} Human-readable channel list.
     */
    function formatChannelList(channelIndexes) {
        return channelIndexes.join(", ");
    }

    /**
     * Analyze a non-negative integer module parameter without throwing.
     *
     * @private
     * @param {ShaderModuleAnalysisContext} context - Module analysis context.
     * @param {ShaderModule} module - Module instance.
     * @param {string} name - Parameter name.
     * @param {number} defaultValue - Default value used when the parameter is absent.
     * @returns {{ok: boolean, value: number}} Analysis result.
     */
    function analyzeNonNegativeIntegerParam(context, module, name, defaultValue) {
        const raw = module.params[name];

        if (raw === undefined || raw === null) { // eslint-disable-line eqeqeq
            return {
                ok: true,
                value: defaultValue
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
                value: defaultValue
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

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Source module that samples one numeric channel from one source slot.
         */
        class SampleSourceChannelModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "sample-source-channel";
            }

            static name() {
                return "Sample Source Channel";
            }

            static description() {
                return "Samples one numeric channel from one source slot.";
            }

            static sourceChannelParams() {
                return {
                    channelIndex: {
                        mode: "single",
                        title: "Channel index",
                        description: "Zero-based logical source channel sampled by this module."
                    }
                };
            }

            static outputs() {
                return {
                    value: {
                        type: ["float"],
                        description: "Float value sampled from the configured source and logical channel index."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Sample one source channel",
                    description: "Samples one logical channel from a source by numeric source and channel index.",
                    params: {
                        sourceIndex: "Numeric source slot index. Defaults to 0.",
                        channelIndex: "Numeric flattened channel index. Defaults to 0."
                    },
                    outputs: {
                        value: "Float value sampled from the configured source and logical channel index."
                    }
                };
            }

            getSourceRequirements() {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channelIndex = readNonNegativeIntegerParam(this, "channelIndex", 0);
                const sampledChannels = [channelIndex];
                const requiredChannelCount = getRequiredChannelCount(sampledChannels);

                return [{
                    index: sourceIndex,
                    sampledChannels,
                    requiredChannelCount,
                    acceptsChannelCount: () => true,
                    description: `Source ${sourceIndex} sampled channel ${channelIndex}. Requires at least ${requiredChannelCount} channels.`
                }];
            }

            getOutputDefinitions() {
                return {
                    value: {
                        type: "float",
                        description: "Float value sampled from the configured source and logical channel index."
                    }
                };
            }

            analyze(context) {
                const sourceIndexResult = analyzeNonNegativeIntegerParam(context, this, "sourceIndex", 0);
                const channelIndexResult = analyzeNonNegativeIntegerParam(context, this, "channelIndex", 0);
                const sampledChannels = [channelIndexResult.value];
                const requiredChannelCount = getRequiredChannelCount(sampledChannels);

                return {
                    inputDefinitions: {},
                    outputDefinitions: this.getOutputDefinitions(),
                    controlDefinitions: this.getControlDefinitions(),
                    sourceRequirements: sourceIndexResult.ok && channelIndexResult.ok ? [{
                        index: sourceIndexResult.value,
                        sampledChannels,
                        requiredChannelCount,
                        acceptsChannelCount: () => true,
                        description: `Source ${sourceIndexResult.value} sampled channel ${channelIndexResult.value}. Requires at least ${requiredChannelCount} channels.`
                    }] : []
                };
            }

            compile(context) {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channelIndex = readNonNegativeIntegerParam(this, "channelIndex", 0);
                const value = context.output("value", "float");

                return {
                    statements: `float ${value} = ${context.sampleSourceChannel(sourceIndex, channelIndex)};`,
                    outputs: {
                        value: {
                            type: "float",
                            expr: value
                        }
                    }
                };
            }
        }
    );

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Source module that samples one to four numeric channels from one source slot.
         */
        class SampleSourceChannelsModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "sample-source-channels";
            }

            static name() {
                return "Sample Source Channels";
            }

            static description() {
                return "Samples one to four numeric channels from one source slot and returns float, vec2, vec3, or vec4.";
            }

            static sourceChannelParams() {
                return {
                    channelIndexes: {
                        mode: "list",
                        title: "Channel indexes",
                        description: "Zero-based logical source channels sampled by this module.",
                        minLength: 1,
                        maxLength: 4
                    }
                };
            }

            static outputs() {
                return {
                    value: {
                        type: ["float", "vec2", "vec3", "vec4"],
                        description: "Sampled source value assembled from one to four configured channel indexes. The concrete output type is float, vec2, vec3, or vec4 depending on params.channelIndexes.length."
                    }
                };
            }

            static docs() {
                return {
                    summary: "Sample multiple source channels",
                    description: "Samples one to four logical channels from a source by numeric source and channel indexes.",
                    params: {
                        sourceIndex: "Numeric source slot index. Defaults to 0.",
                        channelIndexes: "Array of one to four numeric flattened channel indexes."
                    },
                    outputs: {
                        value: "Sampled source value. The output type is float, vec2, vec3, or vec4 depending on params.channelIndexes.length."
                    }
                };
            }

            getSourceRequirements() {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const sampledChannels = uniqueSortedChannelIndexes(readChannelIndexesParam(this));
                const requiredChannelCount = getRequiredChannelCount(sampledChannels);

                return [{
                    index: sourceIndex,
                    sampledChannels,
                    requiredChannelCount,
                    acceptsChannelCount: () => true,
                    description: `Source ${sourceIndex} sampled channels ${formatChannelList(sampledChannels)}. Requires at least ${requiredChannelCount} channels.`
                }];
            }

            getOutputDefinitions() {
                const count = readChannelIndexesParam(this).length;

                return {
                    value: {
                        type: count === 1 ? "float" : `vec${count}`,
                        description: "Sampled source value assembled from the configured channel indexes."
                    }
                };
            }

            analyze(context) {
                const sourceIndexResult = analyzeNonNegativeIntegerParam(context, this, "sourceIndex", 0);
                const channelIndexesResult = analyzeChannelIndexesParam(context, this);
                const channelIndexes = channelIndexesResult.value;
                const sampledChannels = uniqueSortedChannelIndexes(channelIndexes);
                const requiredChannelCount = getRequiredChannelCount(sampledChannels);
                const outputType = channelIndexes.length === 1 ? "float" : `vec${channelIndexes.length}`;

                return {
                    inputDefinitions: {},
                    outputDefinitions: {
                        value: {
                            type: outputType,
                            description: "Sampled source value assembled from the configured channel indexes."
                        }
                    },
                    controlDefinitions: this.getControlDefinitions(),
                    sourceRequirements: sourceIndexResult.ok && channelIndexesResult.ok ? [{
                        index: sourceIndexResult.value,
                        sampledChannels,
                        requiredChannelCount,
                        acceptsChannelCount: () => true,
                        description: `Source ${sourceIndexResult.value} sampled channels ${formatChannelList(sampledChannels)}. Requires at least ${requiredChannelCount} channels.`
                    }] : []
                };
            }

            compile(context) {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channelIndexes = readChannelIndexesParam(this);
                const type = this.getOutputDefinitions().value.type;
                const value = context.output("value", type);

                return {
                    statements: `${type} ${value} = ${context.sampleSourceChannels(sourceIndex, channelIndexes)};`,
                    outputs: {
                        value: {
                            type,
                            expr: value
                        }
                    }
                };
            }
        }
    );
})(OpenSeadragon);
