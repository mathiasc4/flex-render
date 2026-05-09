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

    $.FlexRenderer.ShaderModuleMediator.registerModule(
        /**
         * Source module that samples one numeric channel from one source slot.
         */
        class SampleChannelModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "sample-source-channel";
            }

            static name() {
                return "Sample Source Channel";
            }

            static description() {
                return "Samples one numeric channel from one source slot.";
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
                        value: "float sampled from osd_channel(sourceIndex, channelIndex, v_texture_coords)."
                    }
                };
            }

            static outputs() {
                return {
                    value: {
                        type: "float",
                        description: "Sampled source channel value."
                    }
                };
            }

            getSourceRequirements() {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);

                return [{
                    index: sourceIndex,
                    acceptsChannelCount: () => true,
                    description: `Source ${sourceIndex} sampled by numeric channel index.`
                }];
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

            static docs() {
                return {
                    summary: "Sample multiple source channels",
                    description: "Samples one to four logical channels from a source by numeric source and channel indexes.",
                    params: {
                        sourceIndex: "Numeric source slot index. Defaults to 0.",
                        channelIndexes: "Array of one to four numeric flattened channel indexes."
                    },
                    outputs: {
                        value: "float, vec2, vec3, or vec4 depending on channelIndexes.length."
                    }
                };
            }

            getOutputDefinitions() {
                const count = readChannelIndexesParam(this).length;

                return {
                    value: {
                        type: count === 1 ? "float" : `vec${count}`,
                        description: "Sampled source channel value."
                    }
                };
            }

            getSourceRequirements() {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);

                return [{
                    index: sourceIndex,
                    acceptsChannelCount: () => true,
                    description: `Source ${sourceIndex} sampled by numeric channel indexes.`
                }];
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
