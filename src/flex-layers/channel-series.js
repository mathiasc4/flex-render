(function($) {

    $.FlexRenderer.ShaderMediator.registerLayer(
        class extends $.FlexRenderer.ShaderLayer {
            static type() {
                return "channel-series";
            }

            static name() {
                return "Channel Series";
            }

            static description() {
                return "Wrap one shader and move its source channel base through a runtime control.";
            }

            static docs() {
                return {
                    summary: "Wrapper shader that hosts one delegated shader and drives its channel base with a runtime control.",
                    description: "Uses source metadata from ShaderLayer.getSourceInfo(sourceIndex) to size a channel-offset control. The delegated shader is instantiated once, and its use_channel_baseN value for the selected source is overridden by a GLSL expression backed by the wrapper control, so offset changes do not require program rebuilds.",
                    kind: "shader",
                    inputs: [{
                        index: 0,
                        acceptedChannelCounts: null,
                        description: "Source whose logical channels are browsed through the delegated shader."
                    }],
                    customParams: [
                        {
                            name: "channelRenderer",
                            default: "single_channel",
                            description: "Shader type to instantiate internally."
                        },
                        {
                            name: "channelRendererConfig",
                            description: "Optional ShaderConfig fragment merged into the delegated child shader."
                        },
                        {
                            name: "sourceIndex",
                            default: 0,
                            description: "Which source slot should receive the runtime channel-base override."
                        }
                    ],
                    controls: [
                        {
                            name: "channel_offset",
                            ui: "range_input",
                            valueType: "float",
                            description: "Logical channel base offset fed into the delegated shader at draw time."
                        }
                    ],
                    notes: [
                        "Only the metadata-ready refresh rebuilds the wrapper so the control range can be updated.",
                        "Moving channel_offset afterwards only updates uniforms and does not rebuild the program."
                    ]
                };
            }

            static sources() {
                return [{
                    acceptsChannelCount: () => true,
                    description: "Source whose logical channels are browsed through the delegated shader."
                }];
            }

            static get customParams() {
                return {
                    channelRenderer: {
                        usage: "Shader type used internally for rendering the currently selected logical channel.",
                        type: "string",
                        default: "single_channel"
                    },
                    channelRendererConfig: {
                        type: "json",
                        usage: "Optional ShaderConfig fragment merged into the delegated child shader. Put delegated shader params here."
                    },
                    sourceIndex: {
                        usage: "Source slot whose use_channel_baseN should be overridden by the runtime channel offset control.",
                        type: "number",
                        default: 0
                    }
                };
            }

            static get defaultControls() {
                return {
                    channel_offset: { // eslint-disable-line camelcase
                        default: {
                            type: "range_input",
                            title: "Channel: ",
                            default: 0,
                            min: 0,
                            max: 0,
                            step: 1
                        },
                        accepts: type => type === "float"
                    }
                };
            }

            _readIntConfig(name, fallback, minimum = null) {
                const config = this.getConfig ? (this.getConfig() || {}) : (this.__shaderConfig || {});
                const raw = config[name];
                const parsed = Number.parseInt(raw, 10);
                let value = Number.isFinite(parsed) ? parsed : fallback;
                if (minimum != null && value < minimum) { // eslint-disable-line eqeqeq
                    value = minimum;
                }
                return value;
            }

            _getDelegateSettings() {
                const config = this.getConfig ? (this.getConfig() || {}) : (this.__shaderConfig || {});
                const delegateConfig = $.extend(true, {}, config.channelRendererConfig || {});
                const delegateType = delegateConfig.type || config.channelRenderer || "single_channel";

                if (delegateType === this.constructor.type()) {
                    throw new Error("channel-series cannot recursively render itself.");
                }
                if (!$.FlexRenderer.ShaderMediator.getClass(delegateType)) {
                    throw new Error(`channel-series: unknown child shader type '${delegateType}'.`);
                }

                return {
                    delegateType,
                    delegateConfig,
                    sourceIndex: this._readIntConfig("sourceIndex", 0, 0)
                };
            }

            _getDelegatedChannelPattern(settings = this._getDelegateSettings()) {
                const params = settings.delegateConfig.params || {};
                const controlName = `use_channel${settings.sourceIndex}`;
                const predefined = $.FlexRenderer.ShaderMediator.getClass(settings.delegateType).defaultControls[controlName];

                let pattern = params[controlName];
                if (pattern == null && predefined) { // eslint-disable-line eqeqeq
                    pattern = predefined.required != null ? predefined.required : predefined.default; // eslint-disable-line eqeqeq
                }
                if (typeof pattern !== "string" || !pattern) {
                    return "r";
                }

                const inlineBase = pattern.match(/^(\d+):(.*)$/);
                if (inlineBase) {
                    pattern = inlineBase[2];
                }
                return pattern || "r";
            }

            _getDelegatedChannelWidth(settings = this._getDelegateSettings()) {
                const pattern = this._getDelegatedChannelPattern(settings);
                return /^[rgba]{1,4}$/.test(pattern) ? pattern.length : 1;
            }

            _getMaxChannelOffset(settings = this._getDelegateSettings()) {
                const sourceInfo = this.getSourceInfo(settings.sourceIndex);
                const channelCount = Number.parseInt(sourceInfo.channelCount, 10);
                if (!Number.isFinite(channelCount) || channelCount < 1) {
                    return 0;
                }
                return Math.max(0, channelCount - this._getDelegatedChannelWidth(settings));
            }

            getControlDefinitions() {
                const defs = $.extend(true, {}, this.constructor.defaultControls);
                defs.channel_offset.default.max = this._getMaxChannelOffset();
                return defs;
            }

            _buildDelegateShaderConfig(settings) {
                const config = this.getConfig ? (this.getConfig() || {}) : (this.__shaderConfig || {});
                return $.extend(true, {
                    id: `${this.id}_delegate`,
                    name: config.name || settings.delegateType,
                    type: settings.delegateType,
                    visible: 1,
                    fixed: false,
                    tiledImages: (config.tiledImages || []).slice(),
                    params: {},
                    cache: {}
                }, settings.delegateConfig, {
                    id: `${this.id}_delegate`,
                    type: settings.delegateType,
                    tiledImages: Array.isArray(settings.delegateConfig.tiledImages) ?
                        settings.delegateConfig.tiledImages.slice() :
                        ((config.tiledImages || []).slice())
                });
            }

            _buildRuntimeBaseExpression(settings) {
                const uniformExpr = this.channel_offset.sample();
                const maxOffset = this._getMaxChannelOffset(settings);
                const maxExpr = $.FlexRenderer.ShaderLayer.toShaderFloatString(maxOffset, 0, 1);
                const encodedExpr = `clamp(${uniformExpr}, 0.0, 1.0) * ${maxExpr}`;
                return `int(round(clamp(${encodedExpr}, 0.0, ${maxExpr})))`;
            }

            construct() {
                super.construct();

                const settings = this._getDelegateSettings();
                const delegateConfig = this._buildDelegateShaderConfig(settings);
                const DelegateShader = $.FlexRenderer.ShaderMediator.getClass(settings.delegateType);

                this._delegateShader = new DelegateShader(`${this.id}_delegate`, {
                    shaderConfig: delegateConfig,
                    webglContext: this.webglContext,
                    params: delegateConfig.params,
                    interactive: this._interactive,
                    invalidate: this.invalidate,
                    rebuild: this._rebuild,
                    refresh: this._refresh,
                    refetch: this._refetch
                });
                this._delegateShader.construct();

                const originalGetDefaultChannelBase = this._delegateShader.getDefaultChannelBase.bind(this._delegateShader);
                this._delegateShader.getDefaultChannelBase = sourceIndex => {
                    if (sourceIndex !== settings.sourceIndex) {
                        return originalGetDefaultChannelBase(sourceIndex);
                    }
                    return this._buildRuntimeBaseExpression(settings);
                };

                this._delegateShader.removeControl("opacity");
            }

            init() {
                super.init();
                this._delegateShader.init();
            }

            destroy() {
                if (this._delegateShader) {
                    this._delegateShader.destroy();
                    this._delegateShader = null;
                }
            }

            glLoaded(program, gl) {
                super.glLoaded(program, gl);
                this._delegateShader.glLoaded(program, gl);
            }

            glDrawing(program, gl) {
                super.glDrawing(program, gl);
                this._delegateShader.glDrawing(program, gl);
            }

            getFragmentShaderDefinition() {
                return `
${super.getFragmentShaderDefinition()}
${this._delegateShader.getFragmentShaderDefinition()}`;
            }

            getFragmentShaderExecution() {
                return this._delegateShader.getFragmentShaderExecution();
            }

            htmlControls(wrapper = null, classes = "", css = "") {
                return `
${super.htmlControls(wrapper, classes, css)}
${this._delegateShader.htmlControls(wrapper, classes, css)}`;
            }
        }
    );

})(OpenSeadragon);
