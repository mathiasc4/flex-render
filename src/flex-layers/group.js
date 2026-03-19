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

            createShaderLayer(id, config) {
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
                    tiledImages: [0],
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
                        webglContext: this.webglContext,
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
                this.shaderLayers = {};

                const shaderLayerConfigs = this.__shaderConfig["shaders"] || {};

                for (let id in shaderLayerConfigs) {
                    let config = shaderLayerConfigs[id];
                    $.console.log("Creating shader layer", id, config);
                    this.shaderLayers[id] = this.createShaderLayer(id, config);
                }

                this.shaderLayerOrder = this.__shaderConfig["order"] || Object.keys(shaderLayerConfigs);
            }

            static sources() {
                return [];
            }

            static get defaultControls() {
                return {};
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
                console.log(this.shaderLayers);
                console.log(this.shaderLayerOrder);
                let definition = "";

                for (let id of this.shaderLayerOrder) {
                    let shaderLayer = this.shaderLayers[id];

                    definition += this.constructShaderLayerCode(shaderLayer);
                }

                return definition;
            }

            getFragmentShaderExecution() {
                let execution = "";

                const shaderMap = this.shaderLayers;
                const keyOrder = this.shaderLayerOrder;

                let remainingBlenForShaderID = '';
                const getRemainingBlending = () => { //todo next blend argument
                    if (remainingBlenForShaderID) {
                        const i = keyOrder.indexOf(remainingBlenForShaderID);
                        const shader = shaderMap[remainingBlenForShaderID];
                        // Set stencilPasses again: we are going to blend deferred data
                        return `
    stencilPasses = osd_stencil_texture(${i}, 0, v_texture_coords).r > 0.995;
    overall_color = ${shader.mode === "show" ? "blend_source_over" : shader.uid + "_blend_func"}(intermediate_color, overall_color);
`;
                    }
                    return '';
                };

                let i = 0;
                for (; i < keyOrder.length; i++) {
                    const previousShaderID = keyOrder[i];
                    const previousShaderLayer = shaderMap[previousShaderID];
                    const shaderConf = previousShaderLayer.getConfig();

                    const opacityModifier = previousShaderLayer.opacity ? `opacity * ${previousShaderLayer.opacity.sample()}` : 'opacity';
                    if (shaderConf.type === "none" || shaderConf.error || !shaderConf.visible) {
                        //prevents the layer from being accounted for in the rendering (error or not visible)

                        // For explanation of this logics see main shader part below
                        if (previousShaderLayer._mode !== "clip") {
                            execution += `${getRemainingBlending()}
// ${previousShaderLayer.constructor.type()} - Disabled (error or visible = false)
intermediate_color = vec4(.0);`;
                            remainingBlenForShaderID = previousShaderID;
                        } else {
                            execution += `
// ${previousShaderLayer.constructor.type()} - Disabled with Clipmask (error or visible = false)
intermediate_color = ${previousShaderLayer.uid}_blend_func(vec4(.0), intermediate_color);`;
                        }
                        continue;
                    }

                    execution += `
    instance_id = ${i};
    stencilPasses = osd_stencil_texture(${i}, 0, v_texture_coords).r > 0.995;
    vec3 attrs_${i} = u_shaderVariables[${i}];
    opacity = attrs_${i}.x;
    pixelSize = attrs_${i}.y;
    zoom = attrs_${i}.z;`;

                    // To understand the code below: show & mask are basically same modes: they blend atop
                    // of existing data. 'Show' just uses built-in alpha blending.
                    // However, clip blends on the previous output only (and it can chain!).

                    if (previousShaderLayer._mode !== "clip") {
                        execution += `${getRemainingBlending()}
// ${previousShaderLayer.constructor.type()} - Blending
intermediate_color = ${previousShaderLayer.uid}_execution();
intermediate_color.a = intermediate_color.a * ${opacityModifier};`;

                        remainingBlenForShaderID = previousShaderID;
                    } else {
                        execution += `
// ${previousShaderLayer.constructor.type()} - Clipping
clip_color = ${previousShaderLayer.uid}_execution();
clip_color.a = clip_color.a * ${opacityModifier};
intermediate_color = ${previousShaderLayer.uid}_blend_func(clip_color, intermediate_color);`;
                    }
                } // end of for cycle

                if (remainingBlenForShaderID) {
                    execution += getRemainingBlending();
                }

                return execution;
            }
        }
    );

})(OpenSeadragon);
