(function($) {
    $.FlexRenderer.ShaderLayerRegistry.register(
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
                    description: "Compiles a graph of typed ShaderModules into a callable GLSL function. The base modular layer uses the function call as its ShaderLayer output.",
                    kind: "shader",
                    inputs: [{
                        index: 0,
                        acceptedChannelCounts: "any",
                        description: "Sources consumed by graph sample nodes."
                    }],
                    config: {
                        "params.graph": "Module graph with nodes, typed edges, and one non-void output port."
                    },
                    notes: [
                        "Graph nodes are compiled during shader/program rebuild, not during drawing.",
                        "Module controls are flattened into ShaderLayer controls using deterministic names.",
                        "The module graph is emitted as a named GLSL function in the ShaderLayer definition block.",
                        "getFragmentShaderExecution() can call executeModuleGraph() to reference the graph result.",
                        "Existing non-modular ShaderLayer configs remain valid."
                    ]
                };
            }

            static exampleParams() {
                return {
                    graph: {
                        nodes: {
                            src: {
                                type: "sample-source-channel",
                                params: {
                                    sourceIndex: 0,
                                    channelIndex: 0
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

            static get customParams() {
                return {
                    graph: {
                        type: "shader-module-graph",
                        usage: "Module graph with nodes, typed edges, and one non-void output port."
                    },
                    __previewOutputType: {
                        type: "string",
                        usage: "Internal module-output preview adapter type. Used only by renderer-generated preview configs."
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
                this._moduleGraph = $.FlexRenderer.ShaderModuleGraphBuilder.build(
                    this,
                    this._readGraphConfig()
                );

                const resetOptions = $.extend(
                    true,
                    {},
                    this._params,
                    this._moduleGraph.getBuiltInParams()
                );

                this.resetChannel(resetOptions, false, false);
                this.resetMode(this._params, false, false);
                this.resetFilters(this._params, false, false);
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

            /**
             * Return a GLSL call expression for the compiled module graph function.
             *
             * @returns {string} GLSL function call expression.
             */
            executeModuleGraph() {
                return this._moduleGraph.getFunctionCall();
            }

            getFragmentShaderExecution() {
                const expr = this.executeModuleGraph();
                const previewOutputType = this._params && this._params.__previewOutputType;
                const prefix = `${this.uid}_preview`;

                if (!previewOutputType) {
                    return `return ${expr};`;
                }

                switch (previewOutputType) {
                    case "bool":
                        return `
float ${prefix}_v = ${expr} ? 1.0 : 0.0;
return vec4(vec3(${prefix}_v), 1.0);
`;

                    case "int":
                        return `
int ${prefix}_i = ${expr};
float ${prefix}_h = fract(sin(float(abs(${prefix}_i)) * 12.9898) * 43758.5453);
return vec4(fract(${prefix}_h + 0.00), fract(${prefix}_h + 0.37), fract(${prefix}_h + 0.71), 1.0);
`;

                    case "uint":
                        return `
uint ${prefix}_u = ${expr};
float ${prefix}_h = fract(sin(float(${prefix}_u % 4096u) * 12.9898) * 43758.5453);
return vec4(fract(${prefix}_h + 0.00), fract(${prefix}_h + 0.37), fract(${prefix}_h + 0.71), 1.0);
`;

                    case "float":
                        return `
float ${prefix}_v = clamp(${expr}, 0.0, 1.0);
vec3 ${prefix}_c = clamp(vec3(
    1.5 * ${prefix}_v - 0.5,
    1.5 - abs(2.0 * ${prefix}_v - 1.0),
    1.0 - 1.5 * ${prefix}_v
), 0.0, 1.0);
return vec4(${prefix}_c, 1.0);
`;

                    case "vec2":
                        return `
vec2 ${prefix}_v = ${expr};
float ${prefix}_m = clamp(length(${prefix}_v), 0.0, 1.0);
float ${prefix}_a = atan(${prefix}_v.y, ${prefix}_v.x);
vec3 ${prefix}_dir = 0.5 + 0.5 * cos(${prefix}_a + vec3(0.0, 2.0943951, 4.1887902));
return vec4(${prefix}_dir * max(${prefix}_m, 0.15), 1.0);
`;

                    case "vec3":
                        return `
vec3 ${prefix}_v = clamp(${expr}, 0.0, 1.0);
return vec4(${prefix}_v, 1.0);
`;

                    case "vec4":
                        return `
return clamp(${expr}, 0.0, 1.0);
`;

                    default:
                        return `
return vec4(1.0, 0.0, 1.0, 1.0);
`;
                }
            }

            _readGraphConfig() {
                const config = this.getConfig ? this.getConfig() : this.__shaderConfig;
                const params = (config && config.params) || {};
                return params.graph || {};
            }
        }
    );
})(OpenSeadragon);
