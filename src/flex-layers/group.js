(function($) {

    /**
     * A shader layer grouping multiple shader layers and combining them into one output
     */
    $.FlexRenderer.ShaderLayerRegistry.register(
        class extends $.FlexRenderer.ShaderLayer {
            static type() {
                return "group";
            }

            static name() {
                return "Group";
            }

            static description() {
                return "Group shader layers.";
            }

            static docs() {
                return {
                    summary: "Composite shader that evaluates child shader layers in group order.",
                    description: "Instantiates nested shader configurations from the group's shaders map, evaluates them in the configured order, and combines their outputs using each child shader's blend or clip mode.",
                    kind: "shader",
                    inputs: [],
                    config: {
                        shaders: "Map of child shader id to child ShaderConfig.",
                        order: "Optional ordered list of child shader ids."
                    },
                    notes: [
                        "The group shader itself does not declare renderer-native controls.",
                        "Child shaders are initialized, loaded, drawn, and destroyed through the group."
                    ]
                };
            }

            static sources() {
                return [];
            }

            static get defaultControls() {
                return {};
            }

            createShaderLayer(id, config) {
                id = $.FlexRenderer.sanitizeKey(id);

                const ShaderLayer = $.FlexRenderer.ShaderLayerRegistry.get(config.type);
                if (!ShaderLayer) {
                    throw new Error(`Unknown shader layer type '${config.type}'`);
                }

                const defaultConfig = {
                    id: id,
                    name: "Layer",
                    type: "identity",
                    visible: 1,
                    fixed: false,
                    tiledImages: [],
                    params: {},
                    cache: {},
                };

                for (let propName in defaultConfig) {
                    if (config[propName] === undefined) {
                        config[propName] = defaultConfig[propName];
                    }
                }

                const shaderLayer = new ShaderLayer(
                    id,
                    {
                        shaderConfig: config,
                        backend: this.backend,
                        params: config.params,
                        interactive: this._interactive,

                        invalidate: this.invalidate,
                        rebuild: this._rebuild,
                        refetch: this._refetch,
                    }
                );

                shaderLayer.construct();

                return shaderLayer;
            }

            construct() {
                super.construct();

                this.shaderLayers = {};

                const shaderLayerConfigs = this.__shaderConfig["shaders"] || {};

                for (let id in shaderLayerConfigs) {
                    let config = shaderLayerConfigs[id];
                    $.console.log("Creating shader layer", id, config);
                    this.shaderLayers[id] = this.createShaderLayer(id, config);
                }

                this.shaderLayerOrder = this.__shaderConfig["order"] || Object.keys(shaderLayerConfigs);
            }

            init() {
                super.init();

                for (let id of this.shaderLayerOrder) {
                    this.shaderLayers[id].init();
                }
            }

            destroy() {
                if (this.shaderLayers) {
                    for (let id in this.shaderLayers) {
                        if (this.shaderLayers[id]) {
                            this.shaderLayers[id].destroy();
                        }
                    }
                }

                this.shaderLayers = {};
                this.shaderLayerOrder = [];
            }

            glLoaded(program, gl) {
                super.glLoaded(program, gl);

                for (let id of this.shaderLayerOrder) {
                    this.shaderLayers[id].glLoaded(program, gl);
                }
            }

            glDrawing(program, gl) {
                super.glDrawing(program, gl);

                for (let id of this.shaderLayerOrder) {
                    this.shaderLayers[id].glDrawing(program, gl);
                }
            }

            getFragmentShaderDefinition() {
                return super.getFragmentShaderDefinition() + "\n" +
                    this.backend.getShaderLayerStackDefinition(this.shaderLayers, this.shaderLayerOrder, {
                        ownerShader: this,
                        initialColor: "vec4(0.0)",
                        useInspectorAlpha: false
                    });
            }

            getFragmentShaderExecution() {
                return `return ${this.backend.getShaderLayerStackExecution(this.shaderLayers, this.shaderLayerOrder, {
                    ownerShader: this
                })};`;
            }
        }
    );

})(OpenSeadragon);
