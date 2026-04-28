(function($) {

$.FlexRenderer.WebGL20 = class extends $.FlexRenderer.WebGLImplementation {
    /**
     * Create a WebGL 2.0 rendering implementation.
     * @param {OpenSeadragon.FlexRenderer} renderer
     * @param {WebGL2RenderingContext} gl
     */
    constructor(renderer, gl) {
        // sets this.renderer, this.gl, this.webGLVersion
        super(renderer, gl, "2.0");
        $.console.info("WebGl 2.0 renderer.");
    }

    get firstPassProgramKey() {
        return "firstPass";
    }

    get secondPassProgramKey() {
        return "secondPass";
    }

    get inspectorCompositorProgramKey() {
        return "inspectorCompositor";
    }

    init() {
        this.firstAtlas = new $.FlexRenderer.WebGL20.TextureAtlas2DArray(this.gl);

        // TODO: make icons dynamic

        const countryIcon = new Image();
        countryIcon.src = "/icons/place/country-icon.png";
        countryIcon.onload = () => {
            this.firstAtlas.addImage(countryIcon);
        };

        const cityIcon = new Image();
        cityIcon.src = "/icons/place/city-icon.png";
        cityIcon.onload = () => {
            this.firstAtlas.addImage(cityIcon);
        };

        const villageIcon = new Image();
        villageIcon.src = "/icons/place/village-icon.png";
        villageIcon.onload = () => {
            this.firstAtlas.addImage(villageIcon);
        };

        this.secondAtlas = new $.FlexRenderer.WebGL20.TextureAtlas2DArray(this.gl);
        this._namedColorTargets = {};

        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.FirstPassProgram(this, this.gl, this.firstAtlas), "firstPass");
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.SecondPassProgram(this, this.gl, this.secondAtlas), "secondPass");
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.InspectorCompositorProgram(this, this.gl, this.secondAtlas), "inspectorCompositor");
    }

    getVersion() {
        return "2.0";
    }

    /**
     * Expose GLSL code for texture sampling.
     * @returns {string} glsl code for texture sampling
     */
    sampleTexture(index, vec2coords) {
        // todo make pack index configurable and use this instead of hardcoding functions inside shaderlayer sampleChannel(...)
        return `osd_texture(${index}, 0, ${vec2coords})`;
    }

    getTextureSize(index) {
        return `osd_texture_size(${index})`;
    }

    setDimensions(x, y, width, height, levels, tiledImageCount) {
        this.renderer.getProgram(this.firstPassProgramKey).setDimensions(x, y, width, height, levels, tiledImageCount);
        this.renderer.getProgram(this.secondPassProgramKey).setDimensions(x, y, width, height, levels, tiledImageCount);
        const compositor = this.renderer.getProgram(this.inspectorCompositorProgramKey);
        if (compositor) {
            compositor.setDimensions(x, y, width, height, levels, tiledImageCount);
        }
        //todo consider some elimination of too many calls
    }

    setBackground(background) {
        // todo this is not very nice, we need to call setBg before programs are compiled in a generic way, so
        //  we hit a case where first program is compiled and this setter called, while second program is not available
        const program = this.renderer.getProgram(this.secondPassProgramKey);
        if (!program) {
            return;
        }
        let hex = background.replace(/^#/, "").trim();
        if (hex.length === 6) {
            hex += "FF";
        }
        if (hex.length !== 8) {
            throw new Error("Hex must be RRGGBB or RRGGBBAA");
        }
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        const a = parseInt(hex.slice(6, 8), 16) / 255;
        this.renderer.getProgram(this.secondPassProgramKey)._bgColor = `vec4(${r.toFixed(6)}, ${g.toFixed(6)}, ${b.toFixed(6)}, ${a.toFixed(6)})`;
    }

    destroy() {
        if (this._namedColorTargets) {
            for (const key of Object.keys(this._namedColorTargets)) {
                this._destroyColorTarget(this._namedColorTargets[key]);
            }
            this._namedColorTargets = {};
        }
        this.firstAtlas.destroy();
        this.secondAtlas.destroy();
    }

    _createColorTarget(width, height, options = {}) {
        const gl = this.gl;
        const target = {
            key: options.key,
            width: width,
            height: height,
            ownsTexture: true,
            ownsFramebuffer: true,
        };
        const filter = options.filter || gl.LINEAR;
        target.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        target.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            this._destroyColorTarget(target);
            throw new Error(`FlexRenderer color target is incomplete: 0x${status.toString(16)}`);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return target;
    }

    _destroyColorTarget(target) {
        if (!target) {
            return;
        }
        const gl = this.gl;
        if (target.ownsFramebuffer && target.framebuffer) {
            gl.deleteFramebuffer(target.framebuffer);
            target.framebuffer = null;
        }
        if (target.ownsTexture && target.texture) {
            gl.deleteTexture(target.texture);
            target.texture = null;
        }
    }

    _ensureColorTarget(targetOrKey, width, height, options = {}) {
        let target = typeof targetOrKey === 'string' ? this._namedColorTargets[targetOrKey] : targetOrKey;
        const key = typeof targetOrKey === 'string' ? targetOrKey : (target && target.key);

        if (!target || target.width !== width || target.height !== height || !target.texture || !target.framebuffer) {
            if (target) {
                this._destroyColorTarget(target);
            }
            target = this._createColorTarget(width, height, {
                ...options,
                key: key,
            });
            if (key) {
                this._namedColorTargets[key] = target;
            }
        }

        return target;
    }

    _clearColorTarget(target, rgba = [0, 0, 0, 0]) {
        if (!target || !target.framebuffer) {
            return;
        }
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Reference implementation of the backend offscreen second-pass contract.
     * This renders the normal second pass exactly as it would appear on screen,
     * but into a reusable color target.
     */
    renderSecondPassToTexture(renderArray, options = {}) {
        const width = options.width || this.renderer.canvas.width || this.gl.drawingBufferWidth;
        const height = options.height || this.renderer.canvas.height || this.gl.drawingBufferHeight;
        const target = options.target ?
            this._ensureColorTarget(options.target, width, height, options) :
            this._ensureColorTarget(options.targetKey || '__second_pass_texture', width, height, options);

        if (!renderArray || !renderArray.length) {
            this._clearColorTarget(target, options.clearColor || [0, 0, 0, 0]);
            return target;
        }

        const program = this.renderer.getProgram(this.secondPassProgramKey);
        if (this.renderer.useProgram(program, 'second-pass')) {
            program.load(renderArray);
        }
        program.use(this.renderer.__firstPassResult, renderArray, {
            framebuffer: target.framebuffer
        });
        return target;
    }

    /**
     * Reference implementation of the phase-1 inspector compositor contract.
     * Only `lens-zoom` is routed here by the outer renderer. Reveal/A-B behavior
     * stays inside the normal second-pass shader.
     */
    processSecondPassWithInspector(renderArray, options = undefined) {
        const width = this.renderer.canvas.width || this.gl.drawingBufferWidth;
        const height = this.renderer.canvas.height || this.gl.drawingBufferHeight;

        const fullTarget = this._ensureColorTarget("__inspector_full", width, height, { filter: this.gl.LINEAR });

        this.renderSecondPassToTexture(renderArray, {
            target: fullTarget,
            width,
            height
        });

        const compositor = this.renderer.getProgram(this.inspectorCompositorProgramKey);
        if (this.renderer.useProgram(compositor, "inspector-compositor")) {
            compositor.load();
        }

        return compositor.use(undefined, undefined, {
            framebuffer: options ? options.framebuffer : null,
            inspectorState: this.renderer.getInspectorState(),
            fullTarget: fullTarget
        });
    }

    getBlendingFunction(name) {
        const h = `
float blendLum(vec3 c){return dot(c,vec3(.3,.59,.11));}
float blendSat(vec3 c){return max(max(c.r,c.g),c.b)-min(min(c.r,c.g),c.b);}
vec3 clipColor(vec3 c){
    float l=blendLum(c),n=min(min(c.r,c.g),c.b),x=max(max(c.r,c.g),c.b);
    if(n<0.) c=l+((c-l)*l)/(l-n);
    if(x>1.) c=l+((c-l)*(1.-l))/(x-l);
    return c;
}
vec3 setLum(vec3 c,float l){return clipColor(c+vec3(l-blendLum(c)));}
vec3 setSat(vec3 c,float s){
    float mn=min(min(c.r,c.g),c.b),mx=max(max(c.r,c.g),c.b);
    if(mx<=mn) return vec3(0.);
    if(c.r<=c.g&&c.g<=c.b) return vec3(0.,((c.g-mn)*s)/(mx-mn),s);
    if(c.r<=c.b&&c.b<=c.g) return vec3(0.,s,((c.b-mn)*s)/(mx-mn));
    if(c.g<=c.r&&c.r<=c.b) return vec3(((c.r-mn)*s)/(mx-mn),0.,s);
    if(c.g<=c.b&&c.b<=c.r) return vec3(s,0.,((c.b-mn)*s)/(mx-mn));
    if(c.b<=c.r&&c.r<=c.g) return vec3(((c.r-mn)*s)/(mx-mn),s,0.);
    return vec3(s,((c.g-mn)*s)/(mx-mn),0.);
}`;

        return {
            mask: `
if (close(fg.a, 0.0)) return vec4(.0);
return bg;`,

            'source-over': `
if (!stencilPasses) return bg;
vec4 pre_fg = vec4(fg.rgb * fg.a, fg.a);
return pre_fg + bg * (1.0 - pre_fg.a);`,

            'source-in': `
if (!stencilPasses) return bg;
return vec4(fg.rgb * bg.a, fg.a * bg.a);`,

            'source-out': `
if (!stencilPasses) return bg;
return vec4(fg.rgb * (1.0 - bg.a), fg.a * (1.0 - bg.a));`,

            'source-atop': `
if (!stencilPasses) return bg;
vec3 rgb = fg.rgb * bg.a + bg.rgb * (1.0 - fg.a);
float a = fg.a * bg.a + bg.a * (1.0 - fg.a);
return vec4(rgb, a);`,

            'destination-over': `
if (!stencilPasses) return bg;
vec4 pre_bg = vec4(bg.rgb * bg.a, bg.a);
return pre_bg + fg * (1.0 - pre_bg.a);`,

            'destination-in': `
if (!stencilPasses) return bg;
return vec4(bg.rgb * fg.a, fg.a * bg.a);`,

            'destination-out': `
if (!stencilPasses) return bg;
return vec4(bg.rgb * (1.0 - fg.a), bg.a * (1.0 - fg.a));`,

            'destination-atop': `
if (!stencilPasses) return bg;
vec3 rgb = bg.rgb * fg.a + fg.rgb * (1.0 - bg.a);
float a = bg.a * fg.a + fg.a * (1.0 - bg.a);
return vec4(rgb, a);`,

            lighten: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, max(fg.rgb, bg.rgb));`,

            darken: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, min(fg.rgb, bg.rgb));`,

            copy: `
if (!stencilPasses) return bg;
return fg;`,

            xor: `
if (!stencilPasses) return bg;
vec3 rgb = fg.rgb * (1.0 - bg.a) + bg.rgb * (1.0 - fg.a);
float a = fg.a + bg.a - 2.0 * fg.a * bg.a;
return vec4(rgb, a);`,

            multiply: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, fg.rgb * bg.rgb);`,

            screen: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, 1.0 - (1.0 - fg.rgb) * (1.0 - bg.rgb));`,

            overlay: `
if (!stencilPasses) return bg;
vec3 rgb = mix(2.0 * fg.rgb * bg.rgb, 1.0 - 2.0 * (1.0 - fg.rgb) * (1.0 - bg.rgb), step(0.5, bg.rgb));
return blendAlpha(fg, bg, rgb);`,

            'color-dodge': `
if (!stencilPasses) return bg;
vec3 rgb = bg.rgb / (1.0 - fg.rgb + 1e-5);
return blendAlpha(fg, bg, min(rgb, 1.0));`,

            'color-burn': `
if (!stencilPasses) return bg;
vec3 rgb = 1.0 - ((1.0 - bg.rgb) / (fg.rgb + 1e-5));
return blendAlpha(fg, bg, clamp(rgb, 0.0, 1.0));`,

            'hard-light': `
if (!stencilPasses) return bg;
vec3 rgb = mix(2.0 * fg.rgb * bg.rgb, 1.0 - 2.0 * (1.0 - fg.rgb) * (1.0 - bg.rgb), step(vec3(0.5), fg.rgb));
return blendAlpha(fg, bg, clamp(rgb, 0.0, 1.0));`,

            'soft-light': `
if (!stencilPasses) return bg;
vec3 d1=((16.0*bg.rgb-12.0)*bg.rgb+4.0)*bg.rgb,d2=sqrt(bg.rgb),D=mix(d1,d2,step(vec3(.25),bg.rgb));
vec3 rgb=mix(bg.rgb-(1.0-2.0*fg.rgb)*bg.rgb*(1.0-bg.rgb),bg.rgb+(2.0*fg.rgb-1.0)*(D-bg.rgb),step(vec3(.5),fg.rgb));
return blendAlpha(fg, bg, clamp(rgb, 0.0, 1.0));`,

            difference: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, abs(bg.rgb - fg.rgb));`,

            exclusion: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, bg.rgb + fg.rgb - 2.0 * bg.rgb * fg.rgb);`,

            hue: `
${h}
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, clamp(setLum(setSat(fg.rgb, blendSat(bg.rgb)), blendLum(bg.rgb)), 0.0, 1.0));`,

            saturation: `
${h}
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, clamp(setLum(setSat(bg.rgb, blendSat(fg.rgb)), blendLum(bg.rgb)), 0.0, 1.0));`,

            color: `
${h}
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, clamp(setLum(fg.rgb, blendLum(bg.rgb)), 0.0, 1.0));`,

            luminosity: `
${h}
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, clamp(setLum(bg.rgb, blendLum(fg.rgb)), 0.0, 1.0));`,
        }[name];
    }
};


$.FlexRenderer.WebGL20.SecondPassProgram = class extends $.FlexRenderer.WGLProgram {
    constructor(context, gl, atlas) {
        super(context, gl, atlas);
        this._maxTextures = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 32) - 1; // subtracting 1 to allow texture atlas to be bound; TODO: only bind texture atlas when it is needed
        //todo this might be limiting in some wild cases... make it configurable..? or consider 1d texture
        this.textureMappingsUniformSize = 64;
        this._bgColor = 'vec4(.0)';
    }

    // PRIVATE FUNCTIONS

    /**
     * Get vertex shader's glsl code.
     * @returns {string} vertex shader's glsl code
     */
    _getVertexShaderSource() {
        const vertexShaderSource = `#version 300 es
precision mediump int;
precision mediump float;

out vec2 v_texture_coords;

const vec3 viewport[4] = vec3[4] (
    vec3(-1.0, 1.0, 1.0),
    vec3(-1.0, -1.0, 1.0),
    vec3(1.0, 1.0, 1.0),
    vec3(1.0, -1.0, 1.0)
);

void main() {
    v_texture_coords = vec2(viewport[gl_VertexID]) / 2.0 + 0.5;
    gl_Position = vec4(viewport[gl_VertexID], 1.0);
}
`;

        return vertexShaderSource;
    }

    /**
     * Get fragment shader's glsl code.
     * @param {string} definition ShaderLayers' glsl code placed outside the main function
     * @param {string} execution ShaderLayers' glsl code placed inside the main function
     * @param {string} customBlendFunctions ShaderLayers' GLSL code for custom blend functions
     * @param {Object} globalScopeCode ShaderLayers' glsl code shared between the their instantions
     * @returns {string} fragment shader's glsl code
     */
    _getFragmentShaderSource(definition, execution, customBlendFunctions, globalScopeCode) {
        const fragmentShaderSource = `#version 300 es
precision mediump int;
precision mediump float;
precision mediump sampler2DArray;


// UNIFORMS

// Stores shader index -> pointer to u_instanceTextureIndexes
uniform int u_instanceOffsets[${this.textureMappingsUniformSize}];

// Stores texture indexes for each shader, beginning at index obtained from u_instanceOffsets
uniform int u_instanceTextureIndexes[${this.textureMappingsUniformSize}];

// Carries shader global attributes (opacity, pixelSize, zoom)
uniform vec3 u_shaderVariables[${this.textureMappingsUniformSize}];

// For each tiled image, we store (base texture offset, pack count, channel count)
uniform ivec3 u_tiInfo[${this.textureMappingsUniformSize}];

uniform sampler2DArray u_inputTextures;
uniform sampler2DArray u_stencilTextures;

//  u_inspectorA = [
//     centerPx.x,
//     centerPx.y,
//     radiusPx,
//     featherPx
//   ];
//
//   u_inspectorB = [
//     enabled ? 1 : 0,
//     modeInt,
//     shaderSplitIndex,
//     lensZoom
//   ];
//
//   Mode mapping:
//   - 0 disabled
//   - 1 reveal-inside
//   - 2 reveal-outside
//   - 3 lens-zoom
uniform vec4 u_inspectorA;
uniform vec4 u_inspectorB;


// INPUT VARIABLES

in vec2 v_texture_coords;


// OUTPUT VARIABLES

layout(location=0) out vec4 final_color;


// GLOBAL VARIABLES

int instance_id;
bool stencilPasses;
float opacity;
float pixelSize;
float zoom;


// FUNCTION DEFINITIONS

int osd_pack_count(int sourceIndex) {
    int offset = u_instanceOffsets[instance_id];
    int worldIndex = u_instanceTextureIndexes[offset + sourceIndex];
    return u_tiInfo[worldIndex].y;
}

int osd_channel_count(int sourceIndex) {
    int offset = u_instanceOffsets[instance_id];
    int worldIndex = u_instanceTextureIndexes[offset + sourceIndex];
    ivec3 info = u_tiInfo[worldIndex];
    if (info.z <= 0) {
        return info.y * 4;
    }
    return info.z;
}

vec4 osd_texture(int sourceIndex, int packIndex, vec2 coords) {
    int offset = u_instanceOffsets[instance_id];
    int worldIndex = u_instanceTextureIndexes[offset + sourceIndex];
    int base = u_tiInfo[worldIndex].x;
    int pc = u_tiInfo[worldIndex].y;
    packIndex = clamp(packIndex, 0, pc - 1);
    return texture(u_inputTextures, vec3(coords, float(base + packIndex)));
}

float osd_channel(int sourceIndex, int channelIndex, vec2 coords) {
    int pack = channelIndex >> 2;
    int comp = channelIndex & 3;
    vec4 v = osd_texture(sourceIndex, pack, coords);
         if (comp == 0) return v.r;
    else if (comp == 1) return v.g;
    else if (comp == 2) return v.b;
    else                return v.a;
}

vec4 osd_stencil_texture(int instance, int sourceIndex, vec2 coords) {
    int offset = u_instanceOffsets[instance];
    int index = u_instanceTextureIndexes[offset + sourceIndex];
    return texture(u_stencilTextures, vec3(coords, float(index)));
}

// todo index unused, but we might want to keep it (other rendering engines might need it on the API level, not necessarily here in GLSL)
ivec2 osd_texture_size(int sourceIndex) {
    return textureSize(u_inputTextures, 0).xy;
}

${this.atlas.getFragmentShaderDefinition()}

// UTILITY FUNCTION
bool close(float value, float target) {
    return abs(target - value) < 0.001;
}

bool inspector_enabled() {
    return u_inspectorB.x > 0.5;
}

int inspector_mode() {
    return int(round(u_inspectorB.y));
}

int inspector_shader_split_index() {
    return int(round(u_inspectorB.z));
}

float inspector_lens_zoom() {
    return max(u_inspectorB.w, 1.0);
}

float inspector_mask(vec2 fragPx) {
    float feather = max(u_inspectorA.w, 0.0001);
    float distPx = distance(fragPx, u_inspectorA.xy);
    float inner = max(u_inspectorA.z - feather, 0.0);
    float outer = max(u_inspectorA.z + feather, feather);
    return 1.0 - smoothstep(inner, outer, distPx);
}

float inspector_layer_alpha(int shaderSlot) {
    if (!inspector_enabled()) {
        return 1.0;
    }

    int mode = inspector_mode();
    if (mode != 1 && mode != 2) {
        return 1.0;
    }

    if (shaderSlot < inspector_shader_split_index()) {
        return 1.0;
    }

    float mask = inspector_mask(gl_FragCoord.xy);
    return mode == 1 ? mask : (1.0 - mask);
}


// BLEND FUNCTIONS

vec4 blendAlpha(vec4 fg, vec4 bg, vec3 rgb) {
    float a = fg.a + bg.a * (1.0 - fg.a);
    return vec4(rgb, a);
}

vec4 blend_source_over(vec4 fg, vec4 bg) {
    if (!stencilPasses) return bg;
    vec4 pre_fg = vec4(fg.rgb * fg.a, fg.a);
    return pre_fg + bg * (1.0 - pre_fg.a);
}

// CUSTOM BLEND FUNCTIONS

${customBlendFunctions ? customBlendFunctions : "    // No custom blend functions here..."}


// GLOBAL SCOPE SHADER LAYER CODE

${Object.keys(globalScopeCode).length !== 0 ? Object.values(globalScopeCode).join("\n") : "    // No global scope shader layer code here..."}


// SHADER LAYERS DEFINITIONS

${definition !== "" ? definition : "    // No shader layer definitions here..."}


// MAIN FUNCTION

void main() {
${execution}
}`;

        return fragmentShaderSource;
    }

    build(shaderMap, keyOrder) {
        if (!keyOrder.length) {
            // Todo prevent unimportant first init build call
            this.vertexShader = this._getVertexShaderSource();
            this.fragmentShader = this._getFragmentShaderSource("", "", "", $.FlexRenderer.ShaderLayer.__globalIncludes);
            return;
        }

        const renderer = this.context && this.context.renderer;
        if (!renderer || typeof renderer.getFlatShaderLayers !== "function") {
            throw new Error(
                "$.FlexRenderer.WebGL20.SecondPassProgram::build: renderer.getFlatShaderLayers() is not available."
            );
        }

        const flatShaders = renderer.getFlatShaderLayers(shaderMap, keyOrder);
        for (let slot = 0; slot < flatShaders.length; slot++) {
            flatShaders[slot].__renderSlot = slot;
        }

        let definition = "";
        let execution = `
    vec4 intermediate_color = ${this._bgColor};
    vec4 overall_color = intermediate_color;
    vec4 clip_color = vec4(.0);

    vec3 attrs;
`;
        let customBlendFunctions = "";

        const addShaderDefinition = shader => {
            definition += `
// ${shader.uid} - Definition
${shader.getFragmentShaderDefinition()}

// ${shader.uid} - Custom blending function for a given shader
${shader.getCustomBlendFunction(shader.uid + "_blend_func")}

// ${shader.uid} - Shader code execution
vec4 ${shader.uid}_execution() {
${shader.getFragmentShaderExecution()}
}
`;
        };

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
    overall_color = ${remainingBlendShader.mode === "show" ? "blend_source_over" : remainingBlendShader.uid + "_blend_func"}(intermediate_color, overall_color);
`;
        };

        for (const shaderLayerId of keyOrder) {
            const shaderLayer = shaderMap[shaderLayerId];
            const shaderLayerConfig = shaderLayer.getConfig();
            const slot = shaderLayer.__renderSlot;
            const opacityModifierBase = shaderLayer.opacity ? `opacity * ${shaderLayer.opacity.sample()}` : "opacity";
            const opacityModifier = `(${opacityModifierBase}) * inspector_layer_alpha(${slot})`;

            execution += `\n    // ${shaderLayer.uid}\n`;

            if (shaderLayerConfig.type === "none" || shaderLayerConfig.error || !shaderLayerConfig.visible) {
                if (shaderLayer._mode !== "clip") {
                    execution += `${getRemainingBlending()}
    // ${shaderLayer.uid} - Disabled (error or visible = false)
    intermediate_color = vec4(0.0);
`;
                    remainingBlendShader = shaderLayer;
                } else {
                    execution += `
    // ${shaderLayer.uid} - Disabled with Clipmask (error or visible = false)
    intermediate_color = ${shaderLayer.uid}_blend_func(vec4(0.0), intermediate_color);
`;
                }

                continue;
            }

            addShaderDefinition(shaderLayer);

            execution += `
    instance_id = ${slot};
${getStencilPassCode(shaderLayer)}
    attrs = u_shaderVariables[${slot}];
    opacity = attrs.x;
    pixelSize = attrs.y;
    zoom = attrs.z;
`;

            if (shaderLayer._mode !== "clip") {
                execution += `${getRemainingBlending()}
    // ${shaderLayer.uid} - blending
    intermediate_color = ${shaderLayer.uid}_execution();
    intermediate_color.a = intermediate_color.a * ${opacityModifier};
`;
                remainingBlendShader = shaderLayer;
            } else {
                execution += `
    // ${shaderLayer.uid} - clipping
    clip_color = ${shaderLayer.uid}_execution();
    clip_color.a = clip_color.a * ${opacityModifier};
    intermediate_color = ${shaderLayer.uid}_blend_func(clip_color, intermediate_color);
`;
            }
        }

        if (remainingBlendShader) {
            execution += getRemainingBlending();
        }

        execution += "\n    final_color = overall_color;\n";

        this.vertexShader = this._getVertexShaderSource();
        this.fragmentShader = this._getFragmentShaderSource(
            definition,
            execution,
            customBlendFunctions,
            $.FlexRenderer.ShaderLayer.__globalIncludes
        );
    }

    /**
     * Create program.
     * @param width
     * @param height
     */
    created(width, height) {
        const gl = this.gl;
        const program = this.webGLProgram;

        // Shader element indexes match element id (instance id) to position in the texture array
        this._instanceOffsets = gl.getUniformLocation(program, "u_instanceOffsets[0]");
        this._instanceTextureIndexes = gl.getUniformLocation(program, "u_instanceTextureIndexes[0]");
        this._shaderVariables = gl.getUniformLocation(program, "u_shaderVariables");

        this._texturesLocation = gl.getUniformLocation(program, "u_inputTextures");
        this._stencilLocation = gl.getUniformLocation(program, "u_stencilTextures");

        this._tiInfoLoc = gl.getUniformLocation(program, "u_tiInfo");
        this._inspectorALocation = gl.getUniformLocation(program, "u_inspectorA");
        this._inspectorBLocation = gl.getUniformLocation(program, "u_inspectorB");
        this.vao = gl.createVertexArray();

        // TODO: is this refreshing logic necessary? if enableing this, delete the above refresh, not needed, will be done at use(...)
        //  this._uploadedPackInfoVersion = -1;
    }

    /**
     * Load program. No arguments.
     */
    load(renderArray) {
        const gl = this.gl;
        // ShaderLayers' controls
        for (const renderInfo of renderArray) {
            renderInfo.shader.glLoaded(this.webGLProgram, gl);
        }
        this.atlas.load(this.webGLProgram);
        this._uploadTiledImageInfo();
    }

    /**
     * Use program. Arbitrary arguments.
     */
    use(renderOutput, renderArray, options) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, options ? options.framebuffer : null);
        gl.bindVertexArray(this.vao);

        // TODO: is refreshing necessary here?
        // Second-pass source layout can change without recompiling the program.
        // Refresh texture metadata uniforms every draw so helper wrappers around
        // osd_texture()/osd_channel() see the same layout as inline sampling.
        // this._uploadTiledImageInfo();

        const shaderVariables = [];
        const instanceOffsets = [];
        const instanceTextureIndexes = [];

        for (const renderInfo of renderArray) {
            renderInfo.shader.glDrawing(this.webGLProgram, gl);

            shaderVariables.push(renderInfo.opacity, renderInfo.pixelSize, renderInfo.zoom);

            instanceOffsets.push(instanceTextureIndexes.length);
            instanceTextureIndexes.push(...renderInfo.shader.getConfig().tiledImages);
        }

        // todo _instanceOffsets and _instanceTextureIndexes are possibly static per program lifetime, so we could do this once at load()
        gl.uniform1iv(this._instanceOffsets, instanceOffsets);
        gl.uniform1iv(this._instanceTextureIndexes, instanceTextureIndexes);
        // todo changes dynamically, but could be stored per tiled image instead of per-shader layer
        gl.uniform3fv(this._shaderVariables, shaderVariables);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, renderOutput.texture);
        gl.uniform1i(this._texturesLocation, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, renderOutput.stencil);
        gl.uniform1i(this._stencilLocation, 1);

        const inspectorState = this.context.renderer.getInspectorState();
        const inspectorMode = {
            "reveal-inside": 1,
            "reveal-outside": 2,
            "lens-zoom": 3
        }[inspectorState.mode] || 0;

        gl.uniform4f(
            this._inspectorALocation,
            inspectorState.centerPx.x,
            inspectorState.centerPx.y,
            inspectorState.radiusPx,
            inspectorState.featherPx
        );

        gl.uniform4f(
            this._inspectorBLocation,
            inspectorState.enabled ? 1 : 0,
            inspectorMode,
            inspectorState.shaderSplitIndex,
            inspectorState.lensZoom
        );

        this.atlas.bind(gl.TEXTURE2, 2);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Unbinding textures removes feedback loop when we write to it in the first pass
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.bindVertexArray(null);

        return renderOutput;
    }

    _uploadTiledImageInfo() {
        const renderer = this.context.renderer;
        const packInfo = renderer.__flexPackInfo || {};
        const layout = packInfo.layout || {};
        const baseLayer = layout.baseLayer || [];
        const packCount = layout.packCount || [];
        const channelCount = packInfo.channelCount || [];

        const maxTI = this._tiledImageCount;
        const tiInfo = new Int32Array(maxTI * 3);

        for (let i = 0; i < maxTI; i++) {
            const base = (typeof baseLayer[i] === "number") ? baseLayer[i] : i;
            const pc = (typeof packCount[i] === "number") ? packCount[i] : 1;

            tiInfo[i * 3 + 0] = base;
            tiInfo[i * 3 + 1] = pc;
            tiInfo[i * 3 + 2] = (typeof channelCount[i] === "number") ? channelCount[i] : pc * 4;
        }

        this.gl.uniform3iv(this._tiInfoLoc, tiInfo);
    }

    /**
     * Destroy program. No arguments.
     */
    destroy() {
        this.gl.deleteVertexArray(this.vao);
    }

    // TODO we might want to fire only for active program and do others when really encesarry or with some delay, best at some common implementation level
    setDimensions(x, y, width, height, levels, tiledImageCount) {
        this._dataLayerCount = levels;
        this._tiledImageCount = tiledImageCount;
    }
};

$.FlexRenderer.WebGL20.InspectorCompositorProgram = class extends $.FlexRenderer.WGLProgram {
    constructor(context, gl, atlas) {
        super(context, gl, atlas);
        this._width = 1;
        this._height = 1;
    }

    _getVertexShaderSource() {
        return `#version 300 es
precision mediump float;

out vec2 v_texture_coords;

const vec2 viewport[4] = vec2[4](
    vec2(-1.0,  1.0),
    vec2(-1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2( 1.0, -1.0)
);

void main() {
    vec2 clip = viewport[gl_VertexID];
    v_texture_coords = clip * 0.5 + 0.5;
    gl_Position = vec4(clip, 0.0, 1.0);
}
`;
    }

    _getFragmentShaderSource() {
        return `#version 300 es
precision mediump float;
precision mediump int;
precision mediump sampler2D;

uniform sampler2D u_fullTexture;
uniform vec2 u_viewportSize;
uniform vec2 u_lensCenterPx;
uniform float u_radiusPx;
uniform float u_featherPx;
uniform float u_lensZoom;
uniform int u_mode;
uniform int u_enabled;

in vec2 v_texture_coords;
layout(location=0) out vec4 final_color;

float inspector_mask(vec2 fragPx) {
  float feather = max(u_featherPx, 0.0001);
  float distPx = distance(fragPx, u_lensCenterPx);
  float inner = max(u_radiusPx - feather, 0.0);
  float outer = max(u_radiusPx + feather, feather);
  return 1.0 - smoothstep(inner, outer, distPx);
}

vec2 inspector_lens_uv(vec2 uv) {
  vec2 viewportSize = max(u_viewportSize, vec2(1.0));
  vec2 centerUv = u_lensCenterPx / viewportSize;
  float zoom = max(u_lensZoom, 1.0);
  return clamp(centerUv + (uv - centerUv) / zoom, vec2(0.0), vec2(1.0));
}

void main() {
  vec4 fullColor = texture(u_fullTexture, v_texture_coords);
  vec4 result = fullColor;

  if (u_enabled == 1 && u_mode == 3) {
      float mask = inspector_mask(gl_FragCoord.xy);
      vec4 lensColor = texture(u_fullTexture, inspector_lens_uv(v_texture_coords));
      result = mix(fullColor, lensColor, mask);
  }

  final_color = result;
}
`;
    }

    build() {
        this.vertexShader = this._getVertexShaderSource();
        this.fragmentShader = this._getFragmentShaderSource();
    }

    created(width, height) {
        const gl = this.gl;
        const program = this.webGLProgram;
        this._width = width;
        this._height = height;
        this._fullTextureLoc = gl.getUniformLocation(program, 'u_fullTexture');
        this._viewportSizeLoc = gl.getUniformLocation(program, 'u_viewportSize');
        this._lensCenterLoc = gl.getUniformLocation(program, 'u_lensCenterPx');
        this._radiusLoc = gl.getUniformLocation(program, 'u_radiusPx');
        this._featherLoc = gl.getUniformLocation(program, 'u_featherPx');
        this._lensZoomLoc = gl.getUniformLocation(program, 'u_lensZoom');
        this._modeLoc = gl.getUniformLocation(program, 'u_mode');
        this._enabledLoc = gl.getUniformLocation(program, 'u_enabled');
        this.vao = gl.createVertexArray();
    }

    load() {
    }

    _modeToInt(mode) {
        return {
            'reveal-inside': 1,
            'reveal-outside': 2,
            'lens-zoom': 3,
        }[mode] || 0;
    }

    use(renderOutput, renderArray, options = {}) {
        const gl = this.gl;
        const fullTarget = options.fullTarget;
        const inspectorState = options.inspectorState || {};

        if (!fullTarget || !fullTarget.texture) {
            throw new Error('Inspector compositor requires a full color target.');
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, options.framebuffer === undefined ? null : options.framebuffer);
        gl.bindVertexArray(this.vao);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fullTarget.texture);
        gl.uniform1i(this._fullTextureLoc, 0);

        gl.uniform2f(this._viewportSizeLoc, this._width, this._height);
        gl.uniform2f(this._lensCenterLoc, inspectorState.centerPx ? inspectorState.centerPx.x || 0 : 0, inspectorState.centerPx ? inspectorState.centerPx.y || 0 : 0);
        gl.uniform1f(this._radiusLoc, inspectorState.radiusPx || 0);
        gl.uniform1f(this._featherLoc, inspectorState.featherPx || 0);
        gl.uniform1f(this._lensZoomLoc, inspectorState.lensZoom || 1);
        gl.uniform1i(this._modeLoc, this._modeToInt(inspectorState.mode));
        gl.uniform1i(this._enabledLoc, inspectorState.enabled ? 1 : 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindVertexArray(null);

        return {
            texture: fullTarget.texture,
        };
    }

    destroy() {
        this.gl.deleteVertexArray(this.vao);
    }

    setDimensions(x, y, width, height) {
        this._width = width;
        this._height = height;
    }
};


$.FlexRenderer.WebGL20.FirstPassProgram = class extends $.FlexRenderer.WGLProgram {

    /**
     *
     * @param {OpenSeadragon.FlexRenderer} context
     * @param {WebGL2RenderingContext} gl
     * @param {OpenSeadragon.FlexRenderer.TextureAtlas} atlas
     */
    constructor(context, gl, atlas) {
        super(context, gl, atlas);
        this._maxTextures = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 32) - 1; // subtracting 1 to allow texture atlas to be bound; TODO: only bind texture atlas when it is needed
        this._textureIndexes = [...Array(this._maxTextures).keys()];
        // Todo: RN we support only MAX_COLOR_ATTACHMENTS in the texture array, which varies beetween devices
        //   make the first pass shader run multiple times if the number does not suffice
        // this._maxAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS);
    }

    build(shaderMap, shaderKeys) {
        this.vertexShader = `#version 300 es
precision mediump int;
precision mediump float;

layout(location = 0) in mat3 a_transform_matrix;
// Generic payload args. Used for texture positions, vector positions and colors.
layout(location = 4) in vec4 a_payload0; // first 4 raster texture coords or vector positions and atlas texture ID (x, y, z, textureId)
layout(location = 5) in vec4 a_payload1; // second 4 raster texture coords or vector colors or icon parameters (x, y, width, height)

uniform vec2 u_renderClippingParams;
uniform mat3 u_geomMatrix;

flat out int instance_id;
out vec2 v_texture_coords;
out float v_vecDepth;
flat out int v_textureId;
out vec4 v_vecColor;

const vec3 viewport[4] = vec3[4] (
    vec3(0.0, 1.0, 1.0),
    vec3(0.0, 0.0, 1.0),
    vec3(1.0, 1.0, 1.0),
    vec3(1.0, 0.0, 1.0)
);

void main() {
    if (u_renderClippingParams.y > 0.5) {
        v_texture_coords = vec2((a_payload0.x - a_payload1.x) / a_payload1.z, (a_payload0.y - a_payload1.y) / a_payload1.w);
    } else {
        int vid = gl_VertexID & 3;
        v_texture_coords = (vid == 0) ? a_payload0.xy :
            (vid == 1) ? a_payload0.zw :
                (vid == 2) ? a_payload1.xy : a_payload1.zw;
    }

    mat3 matrix = u_renderClippingParams.y > 0.5 ? u_geomMatrix : a_transform_matrix;

    vec3 space_2d = u_renderClippingParams.x > 0.5 ?
        matrix * vec3(a_payload0.xy, 1.0) :
        matrix * viewport[gl_VertexID];

    v_vecDepth = a_payload0.z;
    v_textureId = int(a_payload0.w);
    v_vecColor = a_payload1;

    gl_Position = vec4(space_2d.xy, 1.0, space_2d.z);
    instance_id = gl_InstanceID;
}
`;
        this.fragmentShader = `#version 300 es
precision mediump int;
precision mediump float;
precision mediump sampler2D;
precision mediump sampler2DArray;

uniform vec2 u_renderClippingParams;

flat in int instance_id;
in vec2 v_texture_coords;
in float v_vecDepth;
flat in int v_textureId;
in vec4 v_vecColor;

uniform sampler2DArray u_textures[${this._maxTextures}];
uniform int u_tileLayer;

${this.atlas.getFragmentShaderDefinition()}

layout(location=0) out vec4 outputColor;
layout(location=1) out vec4 outputStencil;

void main() {
    if (u_renderClippingParams.x < 0.5) {
        for (int i = 0; i < ${this._maxTextures}; i++) {
            if (i == instance_id) {
                 switch (i) {
    ${ this.printN(x =>
                    `case ${x}: outputColor = texture(u_textures[${x}], vec3(v_texture_coords, float(u_tileLayer))); break;`,
                this._maxTextures, "                ")}
                 }
                 break;
            }
        }

        outputStencil = vec4(1.0);
        gl_FragDepth = gl_FragCoord.z;
    } else if (u_renderClippingParams.y > 0.5) {
        // Vector geometry draw path (per-vertex color)

        vec4 stencil = vec4(1.0);
        float depth = v_vecDepth / 255.0; // 2 ^ 8 - 1; 6 bits for z and 2 bits for y and x; assuming the maximal zoom level of tiles to be 64 (no other implementations seem to go past 25 so this should be plenty)

        if (v_textureId < 0) {
            outputColor = v_vecColor;
        } else {
            vec4 texColor = osd_atlas_texture(v_textureId, v_texture_coords); // required for icon rendering, needs texture atlas to be bound; TODO: use osd_atlas_texture only when texture atlas is bound
            outputColor = texColor;

            if (texColor.a < 1.0) {
                stencil = vec4(0.0);
                depth = 0.0;
            }
        }

        outputStencil = stencil;
        gl_FragDepth = depth;
    } else {
        // Pure clipping path: write only to stencil (color target value is undefined)
        outputStencil = vec4(0.0);
        gl_FragDepth = 0.0;
    }
}
`;
    }

    created(width, height) {
        const gl = this.gl;
        const program = this.webGLProgram;

        // Texture creation happens on setDimensions, called later

        let vao = this.firstPassVao;
        if (!vao) {
            this.offScreenBuffer = gl.createFramebuffer();

            this.firstPassVao = vao = gl.createVertexArray();
            this.matrixBuffer = gl.createBuffer();
            this.texCoordsBuffer = gl.createBuffer();

            this.matrixBufferClip = gl.createBuffer();
            this.firstPassVaoClip = gl.createVertexArray();
            this.positionsBufferClip = gl.createBuffer();

            this.firstPassVaoGeom = gl.createVertexArray();
            this.positionsBufferGeom = gl.createBuffer();
        }

        // Texture locations are 0->N uniform indexes, we do not load the data here yet as vao does not store them
        this._inputTexturesLoc = gl.getUniformLocation(program, "u_textures");
        this._renderClipping = gl.getUniformLocation(program, "u_renderClippingParams");
        this._tileLayerLoc = gl.getUniformLocation(program, "u_tileLayer");

        // Alias names to avoid confusion
        this._positionsBuffer = gl.getAttribLocation(program, "a_payload0");
        this._colorAttrib = gl.getAttribLocation(program, "a_payload1");
        this._payload1 = gl.getAttribLocation(program, "a_payload1");
        this._payload0 = gl.getAttribLocation(program, "a_payload0");

        /*
         * Rendering Geometry. Colors are issued per vertex, set up during actual draw calls (changes
         * properties, has custom buffers). Positions are issued per vertex, also changes per draw call
         * (custom buffers preloaded at initialization).
         */
        gl.bindVertexArray(this.firstPassVaoGeom);
        // Colors for geometry, set up actually during drawing as each tile delivers its own buffer
        gl.enableVertexAttribArray(this._colorAttrib);
        gl.vertexAttribPointer(this._colorAttrib, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        // a_positions (dynamic buffer, we may re-bind/retarget per primitive)
        gl.enableVertexAttribArray(this._positionsBuffer);
        gl.vertexAttribPointer(this._positionsBuffer, 2, gl.FLOAT, false, 0, 0);
        this._geomSingleMatrix = gl.getUniformLocation(program, "u_geomMatrix");

        /*
         * Rendering vector tiles. Positions of tiles are always rectangular (stretched and moved by the matrix),
         * not computed but read on-vertex-shader. Texture coords might be customized (e.g. overlap), and
         * need to be explicitly set to each vertex. Need 2x vec4 to read 8 values for 4 vertices.
         * NOTE! Divisor 0 not usable, since it reads from the beginning of a buffer for all instances.
         */
        gl.bindVertexArray(vao);
        // Texture coords are vec2 * 4 coords for the textures, needs to be passed since textures can have offset
        const maxTexCoordBytes = this._maxTextures * 8 * Float32Array.BYTES_PER_ELEMENT;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, maxTexCoordBytes, gl.DYNAMIC_DRAW);
        const stride = 8 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(this._payload0);
        gl.vertexAttribPointer(this._payload0, 4, gl.FLOAT, false, stride, 0);
        gl.vertexAttribDivisor(this._payload0, 1);
        gl.enableVertexAttribArray(this._payload1);
        gl.vertexAttribPointer(this._payload1, 4, gl.FLOAT, false, stride, 4 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribDivisor(this._payload1, 1);

        // Matrices position tiles, 3*3 matrix per tile sent as 3 attributes in
        // Share the same per-instance transform setup as the raster VAO
        this._matrixBuffer = gl.getAttribLocation(program, "a_transform_matrix");
        const matLoc = this._matrixBuffer;
        const maxMatrixBytes = this._maxTextures * 9 * Float32Array.BYTES_PER_ELEMENT;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer);
        gl.enableVertexAttribArray(matLoc);
        gl.enableVertexAttribArray(matLoc + 1);
        gl.enableVertexAttribArray(matLoc + 2);
        gl.vertexAttribPointer(matLoc, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 0);
        gl.vertexAttribPointer(matLoc + 1, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 3 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribPointer(matLoc + 2, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 6 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribDivisor(matLoc, 1);
        gl.vertexAttribDivisor(matLoc + 1, 1);
        gl.vertexAttribDivisor(matLoc + 2, 1);
        // We call bufferData once, then we just call subData
        gl.bufferData(gl.ARRAY_BUFFER, maxMatrixBytes, gl.STREAM_DRAW);


        /*
         * Rendering clipping. This prevents data to show outside the clipping areas. Only positions are needed.
         */
        vao = this.firstPassVaoClip;
        gl.bindVertexArray(vao);
        // We use only one of the two vec4 payload arguments, the other remains uninitialized here.
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionsBufferClip);
        gl.enableVertexAttribArray(this._positionsBuffer);
        gl.vertexAttribPointer(this._positionsBuffer, 2, gl.FLOAT, false, 0, 0);
        // We use static matrix
        gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBufferClip);
        gl.enableVertexAttribArray(matLoc);
        gl.enableVertexAttribArray(matLoc + 1);
        gl.enableVertexAttribArray(matLoc + 2);
        gl.vertexAttribPointer(matLoc, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 0);
        gl.vertexAttribPointer(matLoc + 1, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 3 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribPointer(matLoc + 2, 3, gl.FLOAT, false, 9 * Float32Array.BYTES_PER_ELEMENT, 6 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribDivisor(matLoc, 1);
        gl.vertexAttribDivisor(matLoc + 1, 1);
        gl.vertexAttribDivisor(matLoc + 2, 1);
        gl.bufferData(gl.ARRAY_BUFFER, maxMatrixBytes, gl.STREAM_DRAW);

        // Good practice
        gl.bindVertexArray(null);
    }

    /**
     * Load program. No arguments.
     */
    load() {
        this.gl.uniform1iv(this._inputTexturesLoc, this._textureIndexes);

        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

        this.atlas.load(this.webGLProgram);
    }

    /**
     * Use program. Arbitrary arguments.
     */
    use(renderOutput, sourceArray, options) {
        const gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.offScreenBuffer);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.stencilClipBuffer);

        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.GEQUAL);
        gl.clearDepth(0.0);

        gl.enable(gl.STENCIL_TEST);

        let isBlend = true;

        // this.fpTexture = this.fpTexture === this.colorTextureA ? this.colorTextureB : this.colorTextureA;
        // this.fpTextureClip = this.fpTextureClip === this.stencilTextureA ? this.stencilTextureB : this.stencilTextureA;
        this.fpTexture = this.colorTextureA;
        this.fpTextureClip = this.stencilTextureA;

        // Allocate reusable buffers once
        if (!this._tempMatrixData) {
            this._tempMatrixData = new Float32Array(this._maxTextures * 9);
            this._tempTexCoords = new Float32Array(this._maxTextures * 8);
        }

        let wasClipping = true; // force first init (~ as if was clipping was true)

        for (const renderInfo of sourceArray) {
            const rasterTiles = renderInfo.tiles;

            const attachments = [];

            const targetColorLayer   = renderInfo.dataIndex;
            const targetStencilLayer = renderInfo.stencilIndex;

            // for (let i = 0; i < 1; i++) {

            // color
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                this.colorTextureA, 0, targetColorLayer);
            attachments.push(gl.COLOR_ATTACHMENT0);

            // stencil
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1,
                this.stencilTextureA, 0, targetStencilLayer);
            attachments.push(gl.COLOR_ATTACHMENT0 + 1);

            //}

            gl.drawBuffers(attachments);

            const packIndex = (typeof renderInfo.packIndex === "number") ? renderInfo.packIndex : 0;
            gl.uniform1i(this._tileLayerLoc, packIndex);

            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

            this.atlas.bind(gl.TEXTURE0 + this._maxTextures, this._maxTextures); // TODO: find out if this could be run only once at setup

            // First, clip polygons if any required
            if (renderInfo.polygons.length) {
                gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);

                // Note: second param unused for now...
                gl.uniform2f(this._renderClipping, 1, 0);
                gl.bindVertexArray(this.firstPassVaoClip);

                gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBufferClip);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(renderInfo._temp.values));

                for (const polygon of renderInfo.polygons) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionsBufferClip);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(polygon), gl.STATIC_DRAW);
                    gl.drawArrays(gl.TRIANGLE_FAN, 0, polygon.length / 2);
                }

                gl.stencilFunc(gl.EQUAL, renderInfo.polygons.length, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
                // Note: second param unused for now...
                gl.uniform2f(this._renderClipping, 0, 0);
                wasClipping = true;

            } else if (wasClipping) {
                gl.uniform2f(this._renderClipping, 0, 0);
                gl.stencilFunc(gl.EQUAL, 0, 0xFF);
                wasClipping = false;
            }

            const tileCount = rasterTiles.length;
            if (tileCount) {
                // Tiles MUST NOT blend - alpha channel can carry data just like another channel payload
                if (isBlend) {
                    gl.disable(gl.BLEND);
                    isBlend = false;
                }
                isBlend = false;
                // Then draw join tiles
                gl.bindVertexArray(this.firstPassVao);
                let currentIndex = 0;
                while (currentIndex < tileCount) {
                    const batchSize = Math.min(this._maxTextures, tileCount - currentIndex);

                    for (let i = 0; i < batchSize; i++) {
                        const tile = rasterTiles[currentIndex + i];

                        gl.activeTexture(gl.TEXTURE0 + i);
                        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tile.texture);

                        this._tempMatrixData.set(tile.transformMatrix, i * 9);
                        this._tempTexCoords.set(tile.position, i * 8);
                    }

                    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordsBuffer);
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._tempTexCoords.subarray(0, batchSize * 8));

                    gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer);
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._tempMatrixData.subarray(0, batchSize * 9));

                    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batchSize);
                    currentIndex += batchSize;
                }
            }

            const vectors = renderInfo.vectors;
            if (vectors && vectors.length) {
                // Vectors MUST blend, as they can overlap within single layer
                if (!isBlend) {
                    gl.enable(gl.BLEND);
                    isBlend = true;
                }
                // Signal geometry branch in shader
                gl.uniform2f(this._renderClipping, 1, 1);
                gl.bindVertexArray(this.firstPassVaoGeom);

                for (let vectorTile of vectors) {
                    let batch = vectorTile.fills;
                    if (batch) {
                        // Upload per-tile transform matrix (we draw exactly 1 instance)
                        gl.uniformMatrix3fv(this._geomSingleMatrix, false, batch.matrix);

                        // Bind positions
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
                        gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }

                    batch = vectorTile.lines;
                    if (batch) {
                        if (!vectorTile.fills) {
                            gl.uniformMatrix3fv(this._geomSingleMatrix, false, batch.matrix);
                        }

                        // Bind positions
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
                        gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }

                    batch = vectorTile.points;
                    if (batch) {
                        if (!vectorTile.fills && !vectorTile.lines) {
                            gl.uniformMatrix3fv(this._geomSingleMatrix, false, batch.matrix);
                        }

                        // Bind positions
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
                        gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }

                    // TODO: find out if we can somehow combine points and icons
                    batch = vectorTile.icons;
                    if (batch) {
                        if (!vectorTile.fills && !vectorTile.lines && !vectorTile.points) {
                            gl.uniformMatrix3fv(this._geomSingleMatrix, false, batch.matrix);
                        }

                        // Bind positions
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
                        gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex icon parameters
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }
                }

                gl.uniform2f(this._renderClipping, 0, 0);
            }
        }

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);

        // blending by default ON
        if (!isBlend) {
            gl.enable(gl.BLEND);
        }

        gl.bindVertexArray(null);

        if (!renderOutput) {
            renderOutput = {};
        }
        renderOutput.texture = this.fpTexture;
        renderOutput.stencil = this.fpTextureClip;
        renderOutput.textureDepth = this._dataLayerCount;
        renderOutput.stencilDepth = this._tiledImageCount;

        return renderOutput;
    }

    unload() {
    }

    setDimensions(x, y, width, height, dataLayerCount, tiledImageCount) {
        if (!width || !height || !dataLayerCount || !tiledImageCount) {
            // Defer — GL resources will be reallocated when real dimensions arrive.
            return;
        }

        // Double swapping required else collisions
        this._createOffscreenTexture("colorTextureA", width, height, dataLayerCount, this.gl.LINEAR);
        // this._createOffscreenTexture("colorTextureB", width, height, dataLayerCount, this.gl.LINEAR);

        this._createOffscreenTexture("stencilTextureA", width, height, tiledImageCount, this.gl.LINEAR);
        // this._createOffscreenTexture("stencilTextureB", width, height, dataLayerCount, this.gl.LINEAR);

        this._dataLayerCount = dataLayerCount;
        this._tiledImageCount = tiledImageCount;

        const gl  = this.gl;

        if (this.stencilClipBuffer) {
            gl.deleteRenderbuffer(this.stencilClipBuffer);
        }
        this.stencilClipBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.stencilClipBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
    }


    /**
     * Destroy program. No arguments.
     */
    destroy() {
        // todo calls here might be frequent due to initialization... try to optimize, e.g. soft delete
        const gl = this.gl;
        gl.deleteFramebuffer(this.offScreenBuffer);
        this.offScreenBuffer = null;
        gl.deleteTexture(this.colorTextureA);
        this.colorTextureA = null;
        gl.deleteTexture(this.stencilTextureA);
        this.stencilTextureA = null;
        // gl.deleteTexture(this.colorTextureB);
        // this.colorTextureB = null;
        // gl.deleteTexture(this.stencilTextureB);
        // this.stencilTextureB = null;

        gl.deleteVertexArray(this.firstPassVaoGeom);
        gl.deleteBuffer(this.positionsBufferGeom);
        this.firstPassVaoGeom = null;
        this.positionsBufferGeom = null;
        this.matrixBufferGeom = null;

        this.stencilClipBuffer = null;

        gl.deleteVertexArray(this.firstPassVao);
        gl.deleteBuffer(this.matrixBuffer);
        gl.deleteBuffer(this.texCoordsBuffer);
        this.matrixBuffer = null;
        this.firstPassVao = null;
        this.texCoordsBuffer = null;

        this.firstPassVaoClip = gl.createVertexArray();
        gl.deleteVertexArray(this.firstPassVaoClip);
        // gl.deleteBuffer(this.positionsBuffer);
        // this.positionsBuffer = null;
        gl.deleteBuffer(this.matrixBufferClip);
        this.matrixBufferClip = null;
        gl.deleteBuffer(this.positionsBufferClip);
        this.positionsBufferClip = null;
    }

    _createOffscreenTexture(name, width, height, layerCount, filter) {
        const gl = this.gl;
        const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);

        layerCount = Math.max(layerCount, 1);

        let texRef = this[name];
        if (texRef) {
            gl.deleteTexture(texRef);
        }

        this[name] = texRef = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, texRef);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, layerCount);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.activeTexture(previousActiveTexture);
    }
};

})(OpenSeadragon);
