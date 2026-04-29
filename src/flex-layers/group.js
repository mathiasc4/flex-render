(function($) {

    /**
     * A shader layer grouping multiple shader layers and combining them into one output
     */
    $.FlexRenderer.ShaderMediator.registerLayer(
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

                const ShaderLayer = $.FlexRenderer.ShaderMediator.getClass(config.type);
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

            constructShaderLayerCode(shaderLayer) {
                return `
// ${shaderLayer.constructor.type()} - definitions
${shaderLayer.getFragmentShaderDefinition()}
// ${shaderLayer.constructor.type()} - blending function
${shaderLayer.getCustomBlendFunction(shaderLayer.uid + "_blend_func")}
// ${shaderLayer.constructor.type()} - final function definition
vec4 compute_${shaderLayer.uid}() {
    ${shaderLayer.getFragmentShaderExecution()}
}
`;
            }

            getFragmentShaderDefinition() {
                let definition = super.getFragmentShaderDefinition() + "\n";

                for (let id of this.shaderLayerOrder) {
                    let shaderLayer = this.shaderLayers[id];

                    definition += this.constructShaderLayerCode(shaderLayer);
                }

                return definition;
            }

            // TODO: move the grouping logic into WebGLImplementation
            getFragmentShaderExecution() {
                let execution = "vec4 new_color = vec4(0.0);\nvec4 combined_color = vec4(0.0);\nvec4 clip_color = vec4(0.0);";

                const shaderMap = this.shaderLayers;
                const keyOrder = this.shaderLayerOrder;

                const getStencilPassCode = shader => {
                    const shaderConfig = shader.getConfig();
                    const hasSources = Array.isArray(shaderConfig.tiledImages) && shaderConfig.tiledImages.length > 0;

                    if (!hasSources) {
                        return "    stencilPasses = true;";
                    }

                    return `    stencilPasses = osd_stencil_texture(${shader.__renderSlot}, 0, v_texture_coords).r > 0.995;`;
                };

                let remainingBlendShader = null;
                const getRemainingBlending = () => {
                    if (!remainingBlendShader) {
                        return "";
                    }

                    return `
${getStencilPassCode(remainingBlendShader)}
    combined_color = ${remainingBlendShader.mode === "show" ? "blend_source_over" : remainingBlendShader.uid + "_blend_func"}(new_color, combined_color);
`;
                };

                for (const shaderId of keyOrder) {
                    const shaderLayer = shaderMap[shaderId];
                    const shaderConf = shaderLayer.getConfig();
                    const slot = shaderLayer.__renderSlot;
                    const opacityModifier = shaderLayer.opacity ? `opacity * ${shaderLayer.opacity.sample()}` : "opacity";

                    if (shaderConf.type === "none" || shaderConf.error || !shaderConf.visible) {
                        if (shaderLayer._mode !== "clip") {
                            execution += `${getRemainingBlending()}
// ${shaderLayer.constructor.type()} - Disabled (error or visible = false)
new_color = vec4(0.0);`;
                            remainingBlendShader = shaderLayer;
                        } else {
                            execution += `
// ${shaderLayer.constructor.type()} - Disabled with Clipmask (error or visible = false)
new_color = ${shaderLayer.uid}_blend_func(vec4(0.0), new_color);`;
                        }

                        continue;
                    }

                    execution += `
    instance_id = ${slot};
${getStencilPassCode(shaderLayer)}
    vec3 attrs_${slot} = u_shaderVariables[${slot}];
    opacity = attrs_${slot}.x;
    pixelSize = attrs_${slot}.y;
    zoom = attrs_${slot}.z;`;

                    if (shaderLayer._mode !== "clip") {
                        execution += `${getRemainingBlending()}
// ${shaderLayer.constructor.type()} - Blending
new_color = compute_${shaderLayer.uid}();
new_color.a = new_color.a * ${opacityModifier};`;

                        remainingBlendShader = shaderLayer;
                    } else {
                        execution += `
// ${shaderLayer.constructor.type()} - Clipping
clip_color = compute_${shaderLayer.uid}();
clip_color.a = clip_color.a * ${opacityModifier};
new_color = ${shaderLayer.uid}_blend_func(clip_color, new_color);`;
                    }
                }

                if (remainingBlendShader) {
                    execution += getRemainingBlending();
                }

                execution += "\nreturn combined_color;";

                return execution;
            }
        }
    );

})(OpenSeadragon);
