(function($) {
    $.FlexRenderer.ShaderMediator.registerLayer(
        class ModularShaderLayer extends $.FlexRenderer.ShaderLayer {
            static type() {
                return "modular";
            }

            static name() {
                return "Modular";
            }

            static description() {
                return "Builds a ShaderLayer output from a typed DAG of ShaderModules.";
            }

            static intent() {
                return "Use a graph of reusable shader modules to build a custom visualization.";
            }

            static expects() {
                return { dataKind: "any", channels: "any" };
            }

            static docs() {
                return {
                    summary: "DAG-based modular shader layer",
                    description: "Compiles a graph of typed ShaderModules into one ShaderLayer function body. The final graph output must be vec4.",
                    kind: "shader",
                    inputs: [{
                        index: 0,
                        acceptedChannelCounts: "any",
                        description: "Sources consumed by graph sample nodes."
                    }],
                    config: {
                        "params.graph": "Module graph with nodes, typed edges, and one vec4 output port."
                    },
                    notes: [
                        "Graph nodes are compiled during shader/program rebuild, not during drawing.",
                        "Module controls are flattened into ShaderLayer controls using deterministic names.",
                        "Existing non-modular ShaderLayer configs remain valid."
                    ]
                };
            }

            static exampleParams() {
                return {
                    graph: {
                        version: 1,
                        nodes: {
                            src: {
                                type: "sample-channel",
                                params: {
                                    sourceIndex: 0,
                                    channel: "r"
                                }
                            },
                            threshold: {
                                type: "threshold-mask",
                                inputs: {
                                    value: "src.value"
                                },
                                params: {
                                    threshold: 0.5
                                }
                            },
                            colorize: {
                                type: "colorize",
                                inputs: {
                                    value: "src.value",
                                    alpha: "threshold.mask"
                                },
                                params: {
                                    color: "#00ffff"
                                }
                            }
                        },
                        output: "colorize.color"
                    }
                };
            }

            static sources() {
                return [];
            }

            static get defaultControls() {
                return {
                    opacity: false
                };
            }

            construct() {
                this._moduleGraph = new $.FlexRenderer.ShaderModuleGraph(
                    this,
                    this._readGraphConfig()
                ).prepare();

                const resetOptions = $.extend(
                    true,
                    {},
                    this._customControls,
                    this._moduleGraph.getBuiltInParams()
                );

                this.resetChannel(resetOptions, false, false);
                this.resetMode(this._customControls, false, false);
                this.resetFilters(this._customControls, false, false);
                this._buildControls();
            }

            getControlDefinitions() {
                return $.extend(
                    true,
                    {},
                    this.constructor.defaultControls,
                    this._moduleGraph ? this._moduleGraph.getControlDefinitions() : {}
                );
            }

            getControlParams(controlName) {
                const graphValue = this._moduleGraph ?
                    this._moduleGraph.getControlParams(controlName) : undefined;

                return graphValue !== undefined ?
                    graphValue : super.getControlParams(controlName);
            }

            getSourceDefinitions() {
                return this._moduleGraph ? this._moduleGraph.getSourceDefinitions() : [];
            }

            getFragmentShaderDefinition() {
                return [
                    super.getFragmentShaderDefinition(),
                    this._moduleGraph.getFragmentShaderDefinition()
                ].filter(Boolean).join("\n");
            }

            getFragmentShaderExecution() {
                return this._moduleGraph.getFragmentShaderExecution();
            }

            _readGraphConfig() {
                const config = this.getConfig ? this.getConfig() : this.__shaderConfig;
                const params = (config && config.params) || {};
                return params.graph || {};
            }
        }
    );
})(OpenSeadragon);
