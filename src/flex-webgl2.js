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

    init() {
        const textureAtlas = this.atlas = new $.FlexRenderer.WebGL20.TextureAtlas2DArray(this.gl);
        //todo consider passing reference to this
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.FirstPassProgram(this, this.gl, textureAtlas), "firstPass");
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.SecondPassProgram(this, this.gl, textureAtlas), "secondPass");
    }

    getVersion() {
        return "2.0";
    }

    /**
     * Expose GLSL code for texture sampling.
     * @returns {string} glsl code for texture sampling
     */
    sampleTexture(index, vec2coords) {
        return `osd_texture(${index}, ${vec2coords})`;
    }

    getTextureSize(index) {
        return `osd_texture_size(${index})`;
    }

    setDimensions(x, y, width, height, levels) {
        this.renderer.getProgram(this.firstPassProgramKey).setDimensions(x, y, width, height, levels);
        this.renderer.getProgram(this.secondPassProgramKey).setDimensions(x, y, width, height, levels);
        //todo consider some elimination of too many calls
    }

    destroy() {
        this.atlas.destroy();
    }

    getBlendingFunction(name) {
        return {
            mask: `
if (close(fg.a, 0.0))  return vec4(.0);
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
vec3 rgb = mix(2.0 * fg.rgb * bg.rgb, 1.0 - 2.0 * (1.0 - fg.rgb) * (1.0 - bg.rgb), step(0.5, fg.rgb));
return blendAlpha(fg, bg, rgb);`,

            'soft-light': `
if (!stencilPasses) return bg;
vec3 rgb = (bg.rgb < 0.5)
    ? (2.0 * fg.rgb * bg.rgb + fg.rgb * fg.rgb * (1.0 - 2.0 * bg.rgb))
    : (sqrt(fg.rgb) * (2.0 * bg.rgb - 1.0) + 2.0 * fg.rgb * (1.0 - bg.rgb));
return blendAlpha(fg, bg, clamp(rgb, 0.0, 1.0));`,

            difference: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, abs(bg.rgb - fg.rgb));`,

            exclusion: `
if (!stencilPasses) return bg;
return blendAlpha(fg, bg, bg.rgb + fg.rgb - 2.0 * bg.rgb * fg.rgb);`,
        }[name];
    }
};


$.FlexRenderer.WebGL20.SecondPassProgram = class extends $.FlexRenderer.WGLProgram {
    constructor(context, gl, atlas) {
        super(context, gl, atlas);
        this._maxTextures = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 32);
        //todo this might be limiting in some wild cases... make it configurable..? or consider 1d texture
        this.textureMappingsUniformSize = 64;
    }

    build(shaderMap, keyOrder) {
        if (!keyOrder.length) {
            // Todo prevent unimportant first init build call
            this.vertexShader = this._getVertexShaderSource();
            this.fragmentShader = this._getFragmentShaderSource('', '',
                '', $.FlexRenderer.ShaderLayer.__globalIncludes);
            return;
        }
        let definition = '',
            execution = `
vec4 intermediate_color = vec4(.0);
vec4 clip_color = vec4(.0);
`,
            customBlendFunctions = '';

        const addShaderDefinition = shader => {
            definition += `
// ${shader.constructor.type()} - Definition
${shader.getFragmentShaderDefinition()}
// ${shader.constructor.type()} - Custom blending function for a given shader
${shader.getCustomBlendFunction(shader.uid + "_blend_func")}
// ${shader.constructor.type()} - Shader code execution
vec4 ${shader.uid}_execution() {
${shader.getFragmentShaderExecution()}
}
`;
        };

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

            addShaderDefinition(previousShaderLayer);
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

        this.vertexShader = this._getVertexShaderSource();
        this.fragmentShader = this._getFragmentShaderSource(definition, execution,
            customBlendFunctions, $.FlexRenderer.ShaderLayer.__globalIncludes);
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

        this.vao = gl.createVertexArray();
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
    }

    /**
     * Use program. Arbitrary arguments.
     */
    use(renderOutput, renderArray, options) {
        //todo flatten render array :/
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, options ? options.framebuffer : null);
        gl.bindVertexArray(this.vao);

        const shaderVariables = [];
        const instanceOffsets = [];
        const instanceTextureIndexes = [];
        for (const renderInfo of renderArray) {
            renderInfo.shader.glDrawing(this.webGLProgram, gl);

            shaderVariables.push(renderInfo.opacity, renderInfo.pixelSize, renderInfo.zoom);

            instanceOffsets.push(instanceTextureIndexes.length);
            instanceTextureIndexes.push(...renderInfo.shader.getConfig().tiledImages);
        }

        gl.uniform1iv(this._instanceOffsets, instanceOffsets);
        gl.uniform1iv(this._instanceTextureIndexes, instanceTextureIndexes);
        gl.uniform3fv(this._shaderVariables, shaderVariables);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, renderOutput.texture);
        gl.uniform1i(this._texturesLocation, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, renderOutput.stencil);
        gl.uniform1i(this._stencilLocation, 1);

        this.atlas.bind(gl.TEXTURE2);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);

        return renderOutput;
    }

    /**
     * Destroy program. No arguments.
     */
    destroy() {
        this.gl.deleteVertexArray(this.vao);
    }

    // TODO we might want to fire only for active program and do others when really encesarry or with some delay, best at some common implementation level
    setDimensions(x, y, width, height, levels) {
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
     * @param {string} globalScopeCode ShaderLayers' glsl code shared between the their instantions
     * @returns {string} fragment shader's glsl code
     */
    _getFragmentShaderSource(definition, execution, globalScopeCode) {
        const fragmentShaderSource = `#version 300 es
precision mediump int;
precision mediump float;
precision mediump sampler2DArray;

uniform int u_instanceTextureIndexes[${this.textureMappingsUniformSize}];
uniform int u_instanceOffsets[${this.textureMappingsUniformSize}];
uniform vec3 u_shaderVariables[${this.textureMappingsUniformSize}];

in vec2 v_texture_coords;

bool stencilPasses;
int instance_id;
float opacity;
float pixelSize;
float zoom;

uniform sampler2DArray u_inputTextures;
uniform sampler2DArray u_stencilTextures;

vec4 osd_texture(int index, vec2 coords) {
    int offset = u_instanceOffsets[instance_id];
    index = u_instanceTextureIndexes[offset + index];
    return texture(u_inputTextures, vec3(coords, float(index)));
}

vec4 osd_stencil_texture(int instance, int index, vec2 coords) {
    int offset = u_instanceOffsets[instance];
    index = u_instanceTextureIndexes[offset + index];
    return texture(u_stencilTextures, vec3(coords, float(index)));
}

ivec2 osd_texture_size(int index) {
    int offset = u_instanceOffsets[instance_id];
    index = u_instanceTextureIndexes[offset + index];
    return textureSize(u_inputTextures, index).xy;
}

${this.atlas.getFragmentShaderDefinition()}

// UTILITY function
bool close(float value, float target) {
    return abs(target - value) < 0.001;
}

// BLEND attributes
out vec4 overall_color;
vec4 blendAlpha(vec4 fg, vec4 bg, vec3 rgb) {
    float a = fg.a + bg.a * (1.0 - fg.a);
    return vec4(rgb, a);
}
vec4 blend_source_over(vec4 fg, vec4 bg) {
    if (!stencilPasses) return bg;
    vec4 pre_fg = vec4(fg.rgb * fg.a, fg.a);
    return pre_fg + bg * (1.0 - pre_fg.a);
}

// GLOBAL SCOPE CODE:
${Object.keys(globalScopeCode).length !== 0 ? Object.values(globalScopeCode).join("\n") : '\n    // No global scope code here...'}

// DEFINITIONS OF SHADERLAYERS:
${definition !== '' ? definition : '\n    // No shaderLayer here to define...'}

void main() {
    ${execution}
}`;

        return fragmentShaderSource;
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
        this._maxTextures = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 32);
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
layout(location = 4) in vec4 a_payload0; // first 4 texture coords or positions
layout(location = 5) in vec4 a_payload1; // second 4 texture coords or colors

uniform vec2 u_renderClippingParams;
uniform mat3 u_geomMatrix;

out vec2 v_texture_coords;
flat out int instance_id;
out vec4 v_vecColor;

const vec3 viewport[4] = vec3[4] (
    vec3(0.0, 1.0, 1.0),
    vec3(0.0, 0.0, 1.0),
    vec3(1.0, 1.0, 1.0),
    vec3(1.0, 0.0, 1.0)
);

void main() {
    int vid = gl_VertexID & 3;
    v_texture_coords = (vid == 0) ? a_payload0.xy :
        (vid == 1) ? a_payload0.zw :
             (vid == 2) ? a_payload1.xy : a_payload1.zw;

    mat3 matrix = u_renderClippingParams.y > 0.5 ? u_geomMatrix : a_transform_matrix;

    vec3 space_2d = u_renderClippingParams.x > 0.5 ?
        matrix * vec3(a_payload0.xy, 1.0) :
        matrix * viewport[gl_VertexID];

    v_vecColor = a_payload1;

    gl_Position = vec4(space_2d.xy, 1.0, space_2d.z);
    instance_id = gl_InstanceID;
}
`;
        this.fragmentShader = `#version 300 es
precision mediump int;
precision mediump float;
precision mediump sampler2D;

uniform vec2 u_renderClippingParams;

flat in int instance_id;
in vec2 v_texture_coords;
in vec4 v_vecColor;
uniform sampler2D u_textures[${this._maxTextures}];

layout(location=0) out vec4 outputColor;
layout(location=1) out float outputStencil;

void main() {
    if (u_renderClippingParams.x < 0.5) {
        // Iterate over tiles - textures for each tile (a texture array)
        for (int i = 0; i < ${this._maxTextures}; i++) {
            // Iterate over data in each tile if the index matches our tile
            if (i == instance_id) {
                 switch (i) {
    ${this.printN(x => `case ${x}: outputColor = texture(u_textures[${x}], v_texture_coords); break;`,
                this._maxTextures, "                ")}
                 }
                 break;
            }
        }

        outputStencil = 1.0;
    } else if (u_renderClippingParams.y > 0.5) {
        // Vector geometry draw path (per-vertex color)
        outputColor = v_vecColor;
        outputStencil = 1.0;
    } else {
        // Pure clipping path: write only to stencil (color target value is undefined)
        outputStencil = 0.0;
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
    }

    /**
     * Use program. Arbitrary arguments.
     */
    use(renderOutput, sourceArray, options) {
        const gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.offScreenBuffer);

        gl.enable(gl.STENCIL_TEST);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.stencilClipBuffer);

        // this.fpTexture = this.fpTexture === this.colorTextureA ? this.colorTextureB : this.colorTextureA;
        // this.fpTextureClip = this.fpTextureClip === this.stencilTextureA ? this.stencilTextureB : this.stencilTextureA;
        this.fpTexture = this.colorTextureA;
        this.fpTextureClip = this.stencilTextureA;

        this._renderOffset = 0;

        // Allocate reusable buffers once
        if (!this._tempMatrixData) {
            this._tempMatrixData = new Float32Array(this._maxTextures * 9);
            this._tempTexCoords = new Float32Array(this._maxTextures * 8);
        }

        let wasClipping = true; // force first init (~ as if was clipping was true)

        for (const renderInfo of sourceArray) {
            const rasterTiles = renderInfo.tiles;

            const attachments = [];

            // for (let i = 0; i < 1; i++) {
                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                    this.fpTexture, 0, this._renderOffset);
                attachments.push(gl.COLOR_ATTACHMENT0);

                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + 1,
                    this.fpTextureClip, 0, this._renderOffset);
                attachments.push(gl.COLOR_ATTACHMENT0 + 1);
            //}

            gl.drawBuffers(attachments);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

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
                // Then draw join tiles
                gl.bindVertexArray(this.firstPassVao);
                let currentIndex = 0;
                while (currentIndex < tileCount) {
                    const batchSize = Math.min(this._maxTextures, tileCount - currentIndex);

                    for (let i = 0; i < batchSize; i++) {
                        const tile = rasterTiles[currentIndex + i];

                        gl.activeTexture(gl.TEXTURE0 + i);
                        gl.bindTexture(gl.TEXTURE_2D, tile.texture);

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
                        gl.vertexAttribPointer(this._positionsBuffer, 2, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboCol);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.UNSIGNED_BYTE, true, 0, 0);

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
                        gl.vertexAttribPointer(this._positionsBuffer, 2, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboCol);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.UNSIGNED_BYTE, true, 0, 0);

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
                        gl.vertexAttribPointer(this._positionsBuffer, 2, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1)
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboCol);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.UNSIGNED_BYTE, true, 0, 0);

                        // Bind indices and draw one instance
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }
                }
                gl.uniform2f(this._renderClipping, 0, 0);
            }

            this._renderOffset++;
        }

        gl.disable(gl.STENCIL_TEST);
        gl.bindVertexArray(null);

        if (!renderOutput) {
            renderOutput = {};
        }
        renderOutput.texture = this.fpTexture;
        renderOutput.stencil = this.fpTextureClip;

        return renderOutput;
    }

    unload() {
    }

    setDimensions(x, y, width, height, dataLayerCount) {
        // Double swapping required else collisions
        this._createOffscreenTexture("colorTextureA", width, height, dataLayerCount, this.gl.LINEAR);
        // this._createOffscreenTexture("colorTextureB", width, height, dataLayerCount, this.gl.LINEAR);

        this._createOffscreenTexture("stencilTextureA", width, height, dataLayerCount, this.gl.LINEAR);
        // this._createOffscreenTexture("stencilTextureB", width, height, dataLayerCount, this.gl.LINEAR);

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
    }
};

// todo: support no-atlas mode (dont bind anything if not used at all)
$.FlexRenderer.WebGL20.TextureAtlas2DArray = class extends $.FlexRenderer.TextureAtlas {

    constructor(gl, opts) {
        super(gl, opts);
        this.version = 1;
        this._atlasUploadedVersion = -1;

        /** @type {{ id:number, source:any, w:number, h:number, layer:number, x:number, y:number }[]} */
        this._entries = [];
        this._pendingUploads = [];

        /** @type {{ shelves: { y:number, h:number, x:number }[], nextY:number }[]} */
        this._layerState = [];

        // Per-id uniforms for the shader
        this._scale = new Float32Array(this.maxIds * 2);   // sx, sy
        this._offset = new Float32Array(this.maxIds * 2);  // ox, oy
        this._layer = new Int32Array(this.maxIds);         // layer index
        this._createTexture(this.layerWidth, this.layerHeight, this.layers);
    }


    /**
     * Add an image. Returns a stable atlasId.
     * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|ImageData|Uint8Array} source
     * @param {number} [w]
     * @param {number} [h]
     * @returns {number}
     */
    addImage(source, w, h) {
        const width = (typeof w === 'number') ? w :
            (source && (source.width || source.naturalWidth || (source.canvas && source.canvas.width) || source.w));
        const height = (typeof h === 'number') ? h :
            (source && (source.height || source.naturalHeight || (source.canvas && source.canvas.height) || source.h));

        if (!width || !height) {
            throw new Error('TextureAtlas2DArray.addImage: width or height missing');
        }

        const place = this._ensureCapacityFor(width, height);

        const id = this._entries.length;

        // uniforms for shader (can be uploaded later; we just fill CPU buffers now)
        this._layer[id] = place.layer;
        this._scale[id * 2 + 0] = width / this.layerWidth;
        this._scale[id * 2 + 1] = height / this.layerHeight;
        this._offset[id * 2 + 0] = (place.x + this.padding) / this.layerWidth;
        this._offset[id * 2 + 1] = (place.y + this.padding) / this.layerHeight;

        // remember for re-pack / re-upload
        this._entries.push({
            id: id,
            source: source,
            w: width,
            h: height,
            layer: place.layer,
            x: place.x,
            y: place.y
        });

        // enqueue GPU upload (performed later in load()/commitUploads())
        this._pendingUploads.push({
            source: source,
            w: width,
            h: height,
            layer: place.layer,
            x: place.x,
            y: place.y
        });

        if (id + 1 > this.maxIds) {
            throw new Error('TextureAtlas2DArray: exceeded maxIds capacity');
        }

        this.version++;
        return id;
    }

    /**
     * Texture atlas works as a single texture unit. Bind the atlas before using it at desired texture unit.
     * @param textureUnit
     */
    bind(textureUnit) {
        const gl = this.gl;

        // textureUnit is the numeric unit index (0..N-1)
        gl.activeTexture(textureUnit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);

        // only push uniform arrays when changed (fast and harmless during draw)
        if (this._atlasUploadedVersion !== this.version) {
            gl.uniform2fv(this._atlasScaleLoc, this._scale);
            gl.uniform2fv(this._atlasOffsetLoc, this._offset);
            gl.uniform1iv(this._atlasLayerLoc, this._layer);
            this._atlasUploadedVersion = this.version;
        }
    }

    /**
     * Get WebGL Atlas shader code. This code must define the following function:
     * vec4 osd_atlas_texture(int, vec2)
     * which selects texture ID (1st arg) and returns the color at the uv position (2nd arg)
     *
     * @return {string}
     */
    getFragmentShaderDefinition() {
        return `
uniform sampler2DArray u_atlasTex;
uniform vec2  u_atlasScale[${this.maxIds}];
uniform vec2  u_atlasOffset[${this.maxIds}];
uniform int   u_atlasLayer[${this.maxIds}];

vec4 osd_atlas_texture(int atlasId, vec2 uv) {
    vec2 st = uv * u_atlasScale[atlasId] + u_atlasOffset[atlasId];
    float layer = float(u_atlasLayer[atlasId]);
    return texture(u_atlasTex, vec3(st, layer));
}
`;
    }

    /**
     * Load the current atlas uniform locations.
     * @param {WebGLProgram} program
     */
    load(program) {
        const gl = this.gl;

        // fetch uniform locations (existing behavior)
        this._atlasTexLoc    = gl.getUniformLocation(program, "u_atlasTex");
        this._atlasScaleLoc  = gl.getUniformLocation(program, "u_atlasScale[0]");
        this._atlasOffsetLoc = gl.getUniformLocation(program, "u_atlasOffset[0]");
        this._atlasLayerLoc  = gl.getUniformLocation(program, "u_atlasLayer[0]");

        // commit all staged texSubImage3D uploads in a single pass
        this._commitUploads();

        // (optional) you can also pre-upload the uniform arrays here once right after commit
        if (this._atlasUploadedVersion !== this.version) {
            gl.uniform2fv(this._atlasScaleLoc, this._scale);
            gl.uniform2fv(this._atlasOffsetLoc, this._offset);
            gl.uniform1iv(this._atlasLayerLoc, this._layer);
            this._atlasUploadedVersion = this.version;
        }
    }

    /**
     * Destroy the atlas.
     */
    destroy() {
        const gl = this.gl;

        if (this.texture) {
            gl.deleteTexture(this.texture);
            this.texture = null;
        }

        this._entries.length = 0;
        this._layerState.length = 0;
    }

    _commitUploads() {
        if (!this.texture) {
            // allocate storage if not created yet
            this._createTexture(this.layerWidth, this.layerHeight, this.layers);
        }

        if (!this._pendingUploads.length) {
            return;
        }

        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);

        for (const u of this._pendingUploads) {
            const x = u.x + this.padding;
            const y = u.y + this.padding;

            if (u.source instanceof ImageBitmap ||
                (typeof HTMLImageElement !== 'undefined' && u.source instanceof HTMLImageElement) ||
                (typeof HTMLCanvasElement !== 'undefined' && u.source instanceof HTMLCanvasElement)) {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, u.layer, u.w, u.h, 1, this.format, this.type, u.source);
            } else if (u.source && u.source.data && typeof u.source.width === 'number' && typeof u.source.height === 'number') {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, u.layer, u.w, u.h, 1, this.format, this.type, u.source.data);
            } else if (u.source && (u.source instanceof Uint8Array || u.source instanceof Uint8ClampedArray)) {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, u.layer, u.w, u.h, 1, this.format, this.type, u.source);
            } else {
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
                throw new Error('Unsupported image source for atlas');
            }
        }

        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

        // all uploads done; clear queue
        this._pendingUploads.length = 0;
    }

    _createTexture(w, h, depth) {
        const gl = this.gl;

        if (this.texture) {
            gl.deleteTexture(this.texture);
            this.texture = null;
        }

        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, this.internalFormat, w, h, Math.max(depth, 1));
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

        this.layerWidth = w;
        this.layerHeight = h;
        this.layers = depth;

        // reset packer state sized to current depth
        this._layerState = [];
        for (let i = 0; i < depth; i++) {
            this._layerState.push({ shelves: [], nextY: 0 });
        }
    }

    _ensureCapacityFor(width, height) {
        // try current layers first
        for (let li = 0; li < this.layers; li++) {
            const pos = this._tryPlaceRect(li, width + this.padding * 2, height + this.padding * 2);
            if (pos) {
                return { layer: li, x: pos.x, y: pos.y, willRealloc: false };
            }
        }

        // if rectangle is bigger than layer extent, grow extent (power of 2)
        let newW = this.layerWidth;
        let newH = this.layerHeight;
        if (width + this.padding * 2 > newW || height + this.padding * 2 > newH) {
            while (newW < width + this.padding * 2) {
                newW *= 2;
            }
            while (newH < height + this.padding * 2) {
                newH *= 2;
            }
            // reallocate texture with same layer count but bigger extent
            this._resizeAndReupload(newW, newH, this.layers);
        }

        // try again after extent growth
        for (let li = 0; li < this.layers; li++) {
            const pos2 = this._tryPlaceRect(li, width + this.padding * 2, height + this.padding * 2);
            if (pos2) {
                return { layer: li, x: pos2.x, y: pos2.y, willRealloc: false };
            }
        }

        // still not fitting due to fragmentation / filled layers: add one or more layers
        let newLayers = Math.max(this.layers * 2, this.layers + 1);
        this._resizeAndReupload(this.layerWidth, this.layerHeight, newLayers);

        // after adding layers there will be empty layers to place into
        const li = this._firstEmptyLayer();
        const pos3 = this._tryPlaceRect(li, width + this.padding * 2, height + this.padding * 2);
        return { layer: li, x: pos3.x, y: pos3.y, willRealloc: false };
    }

    _firstEmptyLayer() {
        for (let i = 0; i < this.layers; i++) {
            const st = this._layerState[i];
            if ((st.nextY === 0) && st.shelves.length === 0) {
                return i;
            }
        }
        return 0;
    }

    _resizeAndReupload(newW, newH, newLayers) {
        // keep old entries and repack from scratch
        const oldEntries = this._entries.slice();

        this._createTexture(newW, newH, newLayers);

        // clear packing and pending upload queues
        this._entries.length = 0;
        this._pendingUploads.length = 0;

        // re-place each entry; update uniforms; enqueue for upload
        for (const ent of oldEntries) {
            const pos = this._ensureCapacityFor(ent.w, ent.h);
            ent.layer = pos.layer;
            ent.x = pos.x;
            ent.y = pos.y;

            const id = ent.id;

            this._layer[id] = ent.layer;
            this._scale[id * 2 + 0] = ent.w / this.layerWidth;
            this._scale[id * 2 + 1] = ent.h / this.layerHeight;
            this._offset[id * 2 + 0] = (ent.x + this.padding) / this.layerWidth;
            this._offset[id * 2 + 1] = (ent.y + this.padding) / this.layerHeight;

            this._entries.push(ent);
            this._pendingUploads.push({
                source: ent.source,
                w: ent.w,
                h: ent.h,
                layer: ent.layer,
                x: ent.x,
                y: ent.y
            });
        }

        // mark uniforms changed; actual GPU uploads will occur in load()/commitUploads()
        this.version++;
    }

    _tryPlaceRect(layerIndex, w, h) {
        const W = this.layerWidth;
        const H = this.layerHeight;
        const st = this._layerState[layerIndex];

        // try existing shelves
        for (const shelf of st.shelves) {
            if (h <= shelf.h && shelf.x + w <= W) {
                const x = shelf.x;
                const y = shelf.y;
                shelf.x += w;
                return { x: x, y: y };
            }

        }

        // start a new shelf
        if (st.nextY + h <= H) {
            const y = st.nextY;
            st.shelves.push({ y: y, h: h, x: w });
            st.nextY += h;
            return { x: 0, y: y };
        }

        return null;
    }

    _uploadSource(source, w, h, layer, x, y) {
        const gl = this.gl;

        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);

        if (source instanceof ImageBitmap ||
            (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) ||
            (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement)) {
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, w, h, 1, this.format, this.type, source);
        } else if (source && source.data && typeof source.width === 'number' && typeof source.height === 'number') {
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, w, h, 1, this.format, this.type, source.data);
        } else if (source && (source instanceof Uint8Array || source instanceof Uint8ClampedArray)) {
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, w, h, 1, this.format, this.type, source);
        } else {
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
            throw new Error('Unsupported image source for atlas');
        }

        // optional: no mipmaps for now (icon UI)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    }
};

})(OpenSeadragon);
