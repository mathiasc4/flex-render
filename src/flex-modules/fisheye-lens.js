(function ($) {

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

        if (raw === undefined || raw === null) {
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

    $.FlexRenderer.ShaderModuleRegistry.register(
        /**
         * Interactive fisheye lens sampling.
         *
         * Samples one source through a screen-space fisheye lens.
         * The lens is active while the configured mouse button is held down or,
         * with `buttonMask: -1`, whenever the pointer is inside and uses
         * FlexRenderer interaction uniforms as its input state.
         */
        class FisheyeLensSampleModule extends $.FlexRenderer.ShaderModule {
            static type() {
                return "fisheye-lens-sample";
            }

            static name() {
                return "Fisheye Lens Sample";
            }

            static description() {
                return "Samples one to four numeric channels from one source slot through a screen-space fisheye lens and returns float, vec2, vec3, or vec4.";
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
                    summary: "Sample source channels through a screen-space fisheye lens",
                    description: "Samples one to four logical channels from a source through a screen-space fisheye lens by numeric source and channel indexes.",
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
                    description: `Source ${sourceIndex} sampled channels ${sampledChannels.join(" ")}. Requires at least ${requiredChannelCount} channels.`
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

            static get defaultControls() {
                return {
                    radiusPx: {
                        default: {
                            type: "range_input",
                            default: 160,
                            min: 20,
                            max: 800,
                            step: 1,
                            title: "Radius px"
                        },
                        accepts: (type, instance) => type === "float"
                    },
                    zoom: {
                        default: {
                            type: "range_input",
                            default: 3,
                            min: 1,
                            max: 8,
                            step: 0.1,
                            title: "Zoom"
                        },
                        accepts: (type, instance) => type === "float"
                    },
                    featherPx: {
                        default: {
                            type: "range_input",
                            default: 40,
                            min: 0,
                            max: 250,
                            step: 1,
                            title: "Feather px"
                        },
                        accepts: (type, instance) => type === "float"
                    },
                    falloffPower: {
                        default: {
                            type: "range_input",
                            default: 1.5,
                            min: 0.25,
                            max: 5,
                            step: 0.05,
                            title: "Falloff"
                        },
                        accepts: (type, instance) => type === "float"
                    },
                    buttonMask: {
                        default: {
                            type: "select",
                            default: 2,
                            title: "Button",
                            options: [
                                // Negative sentinel: 0 already means "any button, but some button".
                                { value: -1, label: "None (hover)" },
                                { value: 0, label: "Any" },
                                { value: 1, label: "Primary" },
                                { value: 2, label: "Secondary" },
                                { value: 4, label: "Auxiliary" }
                            ]
                        },
                        accepts: (type, instance) => type === "int"
                    },
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
                        description: `Source ${sourceIndexResult.value} sampled channels ${sampledChannels}. Requires at least ${requiredChannelCount} channels.`
                    }] : []
                };
            }

            getFragmentShaderDefinition() {
                return `
float ${this.uid}_range_value(float normalizedValue, float minValue, float maxValue) {
    return mix(minValue, maxValue, clamp(normalizedValue, 0.0, 1.0));
}

vec2 ${this.uid}_fisheye_uv(
    vec2 sourceUv,
    vec2 pointPx,
    vec2 centerPx,
    vec2 textureSizePx,
    float radiusPx,
    float zoomAmount,
    float featherPx,
    float falloffPower
) {
    float radius = max(radiusPx, 1.0);
    float zoomSafe = max(zoomAmount, 1.0);
    float falloffSafe = max(falloffPower, 0.01);
    float feather = clamp(featherPx, 0.0, radius);

    vec2 deltaPx = pointPx - centerPx;
    float distancePx = length(deltaPx);

    if (distancePx >= radius || zoomSafe <= 1.0001) {
        return sourceUv;
    }

    float normalizedDistance = clamp(distancePx / radius, 0.0, 1.0);

    // At the center, sample roughly 1 / zoomAmount as far from the center.
    // At the edge, return to normal sampling so the lens remains continuous.
    float localZoom = mix(zoomSafe, 1.0, pow(normalizedDistance, falloffSafe));
    vec2 warpedPointPx = centerPx + (deltaPx / localZoom);

    if (feather > 0.001) {
        float edgeBlend = smoothstep(max(0.0, radius - feather), radius, distancePx);
        warpedPointPx = mix(warpedPointPx, pointPx, edgeBlend);
    }

    vec2 safeTextureSize = max(textureSizePx, vec2(1.0));
    vec2 uvOffset = (warpedPointPx - pointPx) / safeTextureSize;

    return clamp(sourceUv + uvOffset, vec2(0.0), vec2(1.0));
}

float ${this.uid}_ring(
    vec2 pointPx,
    vec2 centerPx,
    float radiusPx,
    float thicknessPx,
    float featherPx
) {
    float d = abs(length(pointPx - centerPx) - radiusPx);
    return 1.0 - smoothstep(thicknessPx, thicknessPx + featherPx, d);
}
`;
            }

            compile(context) {
                const sourceIndex = readNonNegativeIntegerParam(this, "sourceIndex", 0);
                const channelIndexes = readChannelIndexesParam(this);
                const type = this.getOutputDefinitions().value.type;
                const value = context.output("value", type);

                const sourceDimensions = context.getSourceDimensions(sourceIndex);

                const radiusPx = this.control("radiusPx").sample();
                const zoomAmount = this.control("zoom").sample();
                const featherPx = this.control("featherPx").sample();
                const falloffPower = this.control("falloffPower").sample();

                const buttonMask = this.control("buttonMask").sample();

                const statements = `
    vec2 pointPx = gl_FragCoord.xy;
    vec2 sourceUv = v_texture_coords;

    float radiusPx = ${this.uid}_range_value(${radiusPx}, 20.0, 800.0);
    float zoomAmount = ${this.uid}_range_value(${zoomAmount}, 1.0, 8.0);
    float featherPx = ${this.uid}_range_value(${featherPx}, 0.0, 250.0);
    float falloffPower = ${this.uid}_range_value(${falloffPower}, 0.25, 5.0);

    int activeButtons = fr_interaction_active_buttons();
    int requiredButtonMask = ${buttonMask};

    ${type} ${value};

    // 0 = any button, but some button. -1 = hover, no button required at all.
    bool buttonMatches = requiredButtonMask < 0 ?
        true :
        (requiredButtonMask == 0 ?
            activeButtons != 0 :
            ((activeButtons & requiredButtonMask) != 0));

    bool lensActive =
        fr_interaction_enabled() &&
        fr_interaction_pointer_inside() &&
        buttonMatches;

    if (lensActive) {
        vec2 textureSizePx = vec2(
            float(${sourceDimensions}.x),
            float(${sourceDimensions}.y)
        );

        vec2 centerPx = fr_interaction_pointer_position_px();

        vec2 fisheyeUv = ${this.uid}_fisheye_uv(
            sourceUv,
            pointPx,
            centerPx,
            textureSizePx,
            radiusPx,
            zoomAmount,
            featherPx,
            falloffPower
        );

        ${value} = ${context.sampleSourceChannels(sourceIndex, channelIndexes, "fisheyeUv")};
    } else {
        ${value} = ${context.sampleSourceChannels(sourceIndex, channelIndexes)};
    }
`;

                return {
                    statements: statements,
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
