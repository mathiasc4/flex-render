(function($) {

class WebGL2 extends $.FlexRenderer.WebGLImplementation {
    /**
     * Create a WebGL 2.0 rendering implementation.
     * @param {OpenSeadragon.FlexRenderer} renderer
     * @param {WebGL2RenderingContext} gl
     */
    constructor(renderer, gl) {
        // sets this.renderer, this.gl, this.webGLVersion
        super(renderer, gl, "2.0");

        $.console.info("WebGl 2.0 renderer.");

        this._preparedTileResources = new Set();
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

    /**
     * RGBA16F is not color-renderable in WebGL2 core — it needs one of the color-buffer
     * extensions. Probed once and cached; getExtension() is not free.
     *
     * Half-float (not 32-bit float) is the target on purpose: RGBA16F is filterable in WebGL2
     * core and blendable wherever it is color-renderable, while RGBA32F would additionally
     * require OES_texture_float_linear and EXT_float_blend.
     *
     * @return {boolean}
     */
    get supportsHighPrecisionTargets() {
        if (this._hpTargets === undefined) {
            this._hpTargets = !!(this.gl.getExtension('EXT_color_buffer_half_float') ||
                                 this.gl.getExtension('EXT_color_buffer_float'));
        }
        return this._hpTargets;
    }

    /**
     * Resolved precision of the first-pass color target.
     * @return {"unorm8"|"float16"}
     */
    get colorTargetPrecision() {
        return this.renderer.getColorTargetPrecision();
    }

    /**
     * Storage format for the first-pass color target.
     * @return {GLenum}
     */
    get colorTargetInternalFormat() {
        return this.colorTargetPrecision === "float16" ? this.gl.RGBA16F : this.gl.RGBA8;
    }

    /**
     * GLSL precision qualifier matching the first-pass color target.
     *
     * Kept at mediump for RGBA8 so mobile GPUs do not regress; promoted to highp only when the
     * target actually carries values a mediump float/sampler would destroy.
     *
     * @return {"mediump"|"highp"}
     */
    get colorTargetGlslPrecision() {
        return this.colorTargetPrecision === "float16" ? "highp" : "mediump";
    }

    init() {
        const gl = this.gl;

        // Resolved before any program is registered below, so the budget check in
        // registerProgram() has a limit to compare against from the very first build.
        this.maxFragmentUniformVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);

        // Test hook: reproduce a 256-vector (or the 224-vector GLES3 minimum) phone on a desktop
        // GPU that reports 1024+, which is why this class of failure went unnoticed for so long.
        const override = this.renderer.__uniformVectorBudgetOverride;
        if (Number.isInteger(override) && override > 0) {
            this.maxFragmentUniformVectors = override;
        }
        $.console.log(`FlexWebGL2: MAX_FRAGMENT_UNIFORM_VECTORS=${this.maxFragmentUniformVectors}, ` +
            `MAX_TEXTURE_IMAGE_UNITS=${gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)}`);

        this.firstAtlas = new $.FlexRenderer.WebGL20.TextureAtlas2DArray(this.gl);
        this.secondAtlas = new $.FlexRenderer.WebGL20.TextureAtlas2DArray(this.gl);
        this._namedColorTargets = {};
        this._presentationTransferScratch = {
            canvas: null,
            ctx: null,
            pixels: null,
            flippedPixels: null,
            imageData: null
        };

        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.FirstPassProgram(this, this.gl, this.firstAtlas), "firstPass");
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.SecondPassProgram(this, this.gl, this.secondAtlas), "secondPass");
        this.renderer.registerProgram(new $.FlexRenderer.WebGL20.InspectorCompositorProgram(this, this.gl, this.secondAtlas), "inspectorCompositor");
    }

    getVersion() {
        return "2.0";
    }

    /**
     * Expose GLSL code for texture sampling.
     * @param {number} index source index
     * @param {string} vec2coords GLSL expression for the texture coordinates
     * @param {number|string} [packIndex=0] pack to sample within the source
     * @returns {string} glsl code for texture sampling
     */
    sampleTexture(index, vec2coords, packIndex = 0) {
        return `osd_texture(${index}, ${packIndex}, ${vec2coords})`;
    }

    getTextureSize(index) {
        return `osd_texture_size(${index})`;
    }

    /**
     * Return the backend-owned GLSL function name used to compute one ShaderLayer.
     *
     * This keeps generated layer execution functions namespaced to FlexRenderer
     * while still preserving the stable shader uid suffix.
     *
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer} shaderLayer
     * @returns {string}
     */
    getShaderLayerComputeName(shaderLayer) {
        return `fr_compute_${shaderLayer.uid}`;
    }

    /**
     * Return the backend-owned GLSL function name used to compute a ShaderLayer stack.
     *
     * Root stacks use a stable root name. Group stacks use the group layer uid,
     * so nested stack functions remain deterministic without WebGL20 special-casing
     * the group shader type.
     *
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer|null} [ownerShader=null]
     * @returns {string}
     */
    getShaderLayerStackComputeName(ownerShader = null) {
        return ownerShader ? `fr_compute_${ownerShader.uid}_stack` : "fr_compute_root_stack";
    }

    /**
     * Emit a safe placeholder compute function for a disabled or failed ShaderLayer.
     *
     * Disabled layers are still represented by a valid compute function, but stack
     * execution skips them. This prevents missing-function failures if future
     * composition code accidentally references a disabled layer.
     *
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer} shaderLayer
     * @param {string} reason
     * @returns {string}
     */
    getShaderLayerPlaceholderDefinition(shaderLayer, reason) {
        return `
// ${shaderLayer.uid} - ${reason}
vec4 ${this.getShaderLayerComputeName(shaderLayer)}() {
    return vec4(0.0);
}
`;
    }

    /**
     * Emit the GLSL definitions needed to compute one ShaderLayer.
     *
     * Invisible, "none", and error layers intentionally receive placeholder
     * functions rather than full shader bodies. Their execution remains a no-op
     * in stack composition.
     *
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer} shaderLayer
     * @returns {string}
     */
    getShaderLayerComputeDefinition(shaderLayer) {
        let shaderConfig = null;

        try {
            shaderConfig = shaderLayer.getConfig();
        } catch (e) {
            $.console.error(`Failed to read shader config for '${shaderLayer.id}'. Emitting placeholder.`, e);
            return this.getShaderLayerPlaceholderDefinition(shaderLayer, "Config read failed placeholder");
        }

        if (!shaderConfig || shaderConfig.type === "none" || shaderConfig.error || !shaderConfig.visible) {
            return this.getShaderLayerPlaceholderDefinition(
                shaderLayer,
                "Disabled, hidden, or error placeholder"
            );
        }

        try {
            return `
// ${shaderLayer.uid} - Definition
${shaderLayer.getFragmentShaderDefinition()}

// ${shaderLayer.uid} - Custom blending function for a given shader
${shaderLayer.getCustomBlendFunction(shaderLayer.uid + "_blend_func")}

// ${shaderLayer.uid} - Shader code execution
vec4 ${this.getShaderLayerComputeName(shaderLayer)}() {
${shaderLayer.getFragmentShaderExecution()}
}
`;
        } catch (e) {
            $.console.error(`Failed to assemble shader '${shaderLayer.id}' (${shaderConfig.type}). Emitting placeholder.`, e);
            shaderConfig.error = true;
            return this.getShaderLayerPlaceholderDefinition(shaderLayer, "Assembly error placeholder");
        }
    }

    /**
     * Emit the stencil-pass setup code for a ShaderLayer.
     *
     * Layers without tiled-image sources are treated as always passing stencil.
     *
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer} shaderLayer
     * @returns {string}
     */
    getShaderLayerStencilPassCode(shaderLayer) {
        const shaderConfig = shaderLayer.getConfig();
        const hasSources = Array.isArray(shaderConfig.tiledImages) && shaderConfig.tiledImages.length > 0;

        if (!hasSources) {
            return "    stencilPasses = true;";
        }

        return `    stencilPasses = osd_stencil_texture(${shaderLayer.__renderSlot}, 0, v_texture_coords).r > 0.995;`;
    }

    /**
     * Emit GLSL definitions for a complete ShaderLayer stack, including:
     * - one compute function for each child layer;
     * - one named stack compute function returning the composed vec4.
     *
     * @param {Object<string, OpenSeadragon.FlexRenderer.ShaderLayer>} shaderMap
     * @param {string[]} keyOrder
     * @param {Object} [options={}]
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer|null} [options.ownerShader=null]
     * @param {string} [options.stackName] explicit GLSL stack function name
     * @param {string} [options.initialColor="vec4(0.0)"] initial stack color expression
     * @param {boolean} [options.useInspectorAlpha=false] apply root inspector alpha to layer opacity
     * @returns {string}
     */
    getShaderLayerStackDefinition(shaderMap, keyOrder, options = {}) {
        let definition = "";

        for (const shaderLayerId of keyOrder || []) {
            const shaderLayer = shaderMap && shaderMap[shaderLayerId];
            if (!shaderLayer) {
                continue;
            }

            definition += this.getShaderLayerComputeDefinition(shaderLayer);
        }

        const stackName = options.stackName || this.getShaderLayerStackComputeName(options.ownerShader || null);

        definition += `
// ${stackName} - ShaderLayer stack composition
vec4 ${stackName}() {
${this._getShaderLayerStackFunctionBody(shaderMap, keyOrder, options)}
}
`;

        return definition;
    }

    /**
     * Return the GLSL expression that invokes a generated ShaderLayer stack.
     *
     * The stack body itself is emitted by getShaderLayerStackDefinition(...).
     *
     * @param {Object<string, OpenSeadragon.FlexRenderer.ShaderLayer>} shaderMap
     * @param {string[]} keyOrder
     * @param {Object} [options={}]
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer|null} [options.ownerShader=null]
     * @param {string} [options.stackName] explicit GLSL stack function name
     * @returns {string}
     */
    getShaderLayerStackExecution(shaderMap, keyOrder, options = {}) {
        const stackName = options.stackName || this.getShaderLayerStackComputeName(options.ownerShader || null);
        return `${stackName}()`;
    }

    /**
     * Convenience wrapper returning both stack definition source and the stack call expression.
     *
     * @param {Object<string, OpenSeadragon.FlexRenderer.ShaderLayer>} shaderMap
     * @param {string[]} keyOrder
     * @param {Object} [options={}]
     * @returns {{definition: string, execution: string}}
     */
    composeShaderLayerStack(shaderMap, keyOrder, options = {}) {
        return {
            definition: this.getShaderLayerStackDefinition(shaderMap, keyOrder, options),
            execution: this.getShaderLayerStackExecution(shaderMap, keyOrder, options)
        };
    }

    /**
     * Emit the body of a named returning ShaderLayer stack function.
     *
     * This is the single source of truth for WebGL2 GLSL stack composition:
     * hidden layers are no-ops, hidden non-clip layers break the clip target,
     * and visible clip layers only affect the nearest visible non-clip target.
     *
     * @private
     * @param {Object<string, OpenSeadragon.FlexRenderer.ShaderLayer>} shaderMap
     * @param {string[]} keyOrder
     * @param {Object} [options={}]
     * @param {string} [options.initialColor="vec4(0.0)"]
     * @param {boolean} [options.useInspectorAlpha=false]
     * @returns {string}
     */
    _getShaderLayerStackFunctionBody(shaderMap, keyOrder, options = {}) {
        const initialColor = options.initialColor || "vec4(0.0)";
        const useInspectorAlpha = options.useInspectorAlpha === true;

        let execution = `
    vec4 intermediate_color = ${initialColor};
    vec4 overall_color = intermediate_color;
    vec4 clip_color = vec4(.0);
    vec4 attrs;
`;

        let remainingBlendShader = null;
        let clipTargetAvailable = false;

        const getRemainingBlending = () => {
            if (!remainingBlendShader) {
                return "";
            }

            return `
${this.getShaderLayerStencilPassCode(remainingBlendShader)}
    overall_color = ${remainingBlendShader.mode === "show" ? "blend_source_over" : remainingBlendShader.uid + "_blend_func"}(intermediate_color, overall_color);
`;
        };

        for (const shaderLayerId of keyOrder || []) {
            const shaderLayer = shaderMap && shaderMap[shaderLayerId];
            if (!shaderLayer) {
                continue;
            }

            const executionSnapshot = execution;
            const remainingBlendSnapshot = remainingBlendShader;
            const clipTargetAvailableSnapshot = clipTargetAvailable;

            let shaderLayerConfig = null;
            let isClipLayer = false;

            try {
                shaderLayerConfig = shaderLayer.getConfig();
                isClipLayer = shaderLayer._mode === "clip";

                const slot = shaderLayer.__renderSlot;
                const opacityModifierBase = shaderLayer.opacity ? `opacity * ${shaderLayer.opacity.sample()}` : "opacity";
                const opacityModifier = useInspectorAlpha ?
                    `(${opacityModifierBase}) * inspector_layer_alpha(${slot})` :
                    opacityModifierBase;

                execution += `\n    // ${shaderLayer.uid}\n`;

                if (!shaderLayerConfig || shaderLayerConfig.type === "none" || shaderLayerConfig.error || !shaderLayerConfig.visible) {
                    if (!isClipLayer) {
                        // A hidden non-clip layer breaks the clip chain. Clip layers above it
                        // must not accidentally modify the previous visible non-clip layer.
                        clipTargetAvailable = false;
                    }

                    execution += `
    // ${shaderLayer.uid} - Disabled (type none, error, or visible = false)
    // Intentionally skipped. Disabled layers do not emit blending,
    // clipping, or composition-boundary code.
`;

                    continue;
                }

                if (isClipLayer && !clipTargetAvailable) {
                    execution += `
    // ${shaderLayer.uid} - Clip skipped because there is no visible non-clip layer to clip.
`;

                    continue;
                }

                execution += `
    instance_id = ${slot};
${this.getShaderLayerStencilPassCode(shaderLayer)}
    attrs = u_shaderVariables[${slot}];
    opacity = attrs.x;
    pixelSize = attrs.y;
    imageOriginPx = attrs.zw;
    zoom = u_zoom;
    devicePixelScale = u_devicePixelScale;
`;

                if (!isClipLayer) {
                    execution += `${getRemainingBlending()}
    // ${shaderLayer.uid} - blending
    intermediate_color = ${this.getShaderLayerComputeName(shaderLayer)}();
    intermediate_color.a = intermediate_color.a * ${opacityModifier};
`;

                    remainingBlendShader = shaderLayer;
                    clipTargetAvailable = true;
                } else {
                    execution += `
    // ${shaderLayer.uid} - clipping
    clip_color = ${this.getShaderLayerComputeName(shaderLayer)}();
    clip_color.a = clip_color.a * ${opacityModifier};
    intermediate_color = ${shaderLayer.uid}_blend_func(clip_color, intermediate_color);
`;
                }
            } catch (e) {
                $.console.error(
                    `Failed to assemble shader '${shaderLayer.id}' (${shaderLayerConfig ? shaderLayerConfig.type : "unknown"}). Hiding layer.`,
                    e
                );

                if (shaderLayerConfig) {
                    shaderLayerConfig.error = true;
                }

                execution = executionSnapshot;
                remainingBlendShader = remainingBlendSnapshot;
                clipTargetAvailable = clipTargetAvailableSnapshot;

                if (!isClipLayer) {
                    // Treat a failed non-clip layer like a hidden non-clip layer.
                    // Following clip layers must not retarget the previous visible layer.
                    clipTargetAvailable = false;
                }

                execution += `
    // ${shaderLayer.uid} - Disabled after assembly error
    // Intentionally skipped. Failed layers do not emit blending,
    // clipping, or composition-boundary code.
`;
            }
        }

        if (remainingBlendShader) {
            execution += getRemainingBlending();
        }

        execution += `
    return overall_color;
`;

        return execution;
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
        if (this._preparedTileResources) {
            for (const resource of Array.from(this._preparedTileResources)) {
                this.releasePreparedTileResource(resource);
            }

            this._preparedTileResources.clear();
        }

        if (this._namedColorTargets) {
            for (const key of Object.keys(this._namedColorTargets)) {
                this._destroyColorTarget(this._namedColorTargets[key]);
            }

            this._namedColorTargets = {};
        }

        this.firstAtlas.destroy();
        this.secondAtlas.destroy();

        // clean all texture units; adapted from https://stackoverflow.com/a/23606581/1214731
        const numTextureUnits = this.gl.getParameter(this.gl.MAX_TEXTURE_IMAGE_UNITS);

        for (let unit = 0; unit < numTextureUnits; ++unit) {
            this.gl.activeTexture(this.gl.TEXTURE0 + unit);
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
            this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, null);
        }

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
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

        // Make the single color attachment explicitly drawable. This matters for
        // shared-context final targets because the second pass renders into this FBO,
        // not into the WebGL default framebuffer.
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

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
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Ensure a renderer-owned color target.
     *
     * @param {object | null} target
     * @param {number} width
     * @param {number} height
     * @param {object} [options={}]
     * @returns {object}
     */
    ensureColorTarget(target, width, height, options = {}) {
        return this._ensureColorTarget(target, width, height, options);
    }

    /**
     * Clear a renderer-owned color target.
     *
     * @param {object} target
     * @param {number[]} [rgba=[0, 0, 0, 0]]
     * @returns {void}
     */
    clearColorTarget(target, rgba = [0, 0, 0, 0]) {
        this._clearColorTarget(target, rgba);
    }

    /**
     * Destroy a renderer-owned color target.
     *
     * @param {object|null} target
     * @returns {void}
     */
    destroyColorTarget(target) {
        this._destroyColorTarget(target);
    }

    /**
     * Copy a color target into a renderer-local presentation canvas.
     *
     * Shared-context presentation uses readPixels because the WebGL default
     * framebuffer is not a reliable intermediate transfer target across browsers
     * and context configurations.
     *
     * @param {object} target
     * @param {HTMLCanvasElement} canvas
     * @returns {string} Transfer mode used.
     */
    presentColorTargetToCanvas(target, canvas) {
        if (!target || !target.framebuffer || !canvas) {
            return "none";
        }

        return this._readColorTargetToCanvas(target, canvas);
    }

    /**
     * Copy a color target into a presentation canvas through readPixels.
     *
     * @private
     * @param {object} target
     * @param {HTMLCanvasElement} canvas
     * @returns {string} Always "read-pixels".
     */
    _readColorTargetToCanvas(target, canvas) {
        const gl = this.gl;
        const targetWidth = target.width || 0;
        const targetHeight = target.height || 0;
        const canvasWidth = canvas.width || 0;
        const canvasHeight = canvas.height || 0;
        const width = Math.min(targetWidth, canvasWidth);
        const height = Math.min(targetHeight, canvasHeight);
        const scratch = this._presentationTransferScratch;

        if (!width || !height) {
            return "read-pixels";
        }

        const length = width * height * 4;
        const rowLength = width * 4;

        if (!scratch.pixels || scratch.pixels.length !== length) {
            scratch.pixels = new Uint8Array(length);
        }

        if (!scratch.flippedPixels || scratch.flippedPixels.length !== length) {
            scratch.flippedPixels = new Uint8ClampedArray(length);
        }

        const context = canvas.getContext("2d");

        if (!context) {
            return "read-pixels";
        }

        if (canvasWidth !== targetWidth || canvasHeight !== targetHeight) {
            context.clearRect(0, 0, canvasWidth, canvasHeight);
        }

        if (!scratch.imageData || scratch.imageData.width !== width || scratch.imageData.height !== height) {
            scratch.imageData = context.createImageData(width, height);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, scratch.pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        for (let y = 0; y < height; y++) {
            const srcStart = (height - 1 - y) * rowLength;
            const dstStart = y * rowLength;
            scratch.flippedPixels.set(
                scratch.pixels.subarray(srcStart, srcStart + rowLength),
                dstStart
            );
        }

        scratch.imageData.data.set(scratch.flippedPixels);
        context.putImageData(scratch.imageData, 0, 0);

        return "read-pixels";
    }

    /**
     * Reference implementation of the backend offscreen second-pass contract.
     * This renders the normal second pass exactly as it would appear on screen,
     * but into a reusable color target.
     */
    renderSecondPassToTexture(renderArray, options = {}) {
        const dimensions = this.renderer.getRenderDimensions();
        const width = options.width || dimensions.width || this.gl.drawingBufferWidth;
        const height = options.height || dimensions.height || this.gl.drawingBufferHeight;
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
        const dimensions = this.renderer.getRenderDimensions();
        const width = dimensions.width || this.gl.drawingBufferWidth;
        const height = dimensions.height || this.gl.drawingBufferHeight;

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

            'soft-mask': `
return vec4(bg.rgb, bg.a * fg.a);`,

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

    /**
     * Prepare bitmap-like tile data as a WebGL2 texture array resource.
     *
     * @param {PrepareBitmapTileOptions} options - Bitmap tile preparation options.
     * @returns {Promise<PreparedRasterTileResult>} Preparation result.
     */
    async prepareBitmapTile(options = {}) {
        const gl = this.gl;
        const source = this._normalizeBitmapTileSource(options.data);
        const textureOptions = options.textureOptions || {};

        if (!source) {
            return this._makePreparedTileFailure(
                "unsupported-data",
                new TypeError("Bitmap tile preparation requires bitmap-like source data.")
            );
        }

        let bitmap = null;
        let ownsBitmap = false;

        try {
            if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
                bitmap = source;
            } else {
                bitmap = await createImageBitmap(source);
                ownsBitmap = true;
            }
        } catch (error) {
            return this._makePreparedTileFailure(
                this._classifyTilePreparationError(error, "invalid-data"),
                error
            );
        }

        const width = (bitmap && Number(bitmap.width)) || 0;
        const height = (bitmap && Number(bitmap.height)) || 0;

        if (!width || !height) {
            if (ownsBitmap && bitmap && typeof bitmap.close === "function") {
                bitmap.close();
            }

            return this._makePreparedTileFailure(
                "invalid-data",
                new Error("Bitmap tile preparation produced empty or invalid dimensions.")
            );
        }

        let texture = null;
        // This runs after `await createImageBitmap(...)`, so nothing of ours is bound and the
        // TEXTURE_2D_ARRAY binding on the active unit belongs to whatever drew last -- another
        // renderer entirely, under a shared context. Put it back rather than nulling it.
        const previousArrayBinding = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);

        try {
            texture = gl.createTexture();

            if (!texture) {
                throw new Error("WebGL2 failed to create a bitmap tile texture.");
            }

            this._clearWebGLErrors();

            gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, 1);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);

            const filter = textureOptions.imageSmoothingEnabled ? gl.LINEAR : gl.NEAREST;

            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            this._throwIfWebGLError("Bitmap tile texture upload");

            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

            this._preparedTileResources.add(texture);

            return {
                ok: true,
                resource: texture,
                texture: texture,
                width: width,
                height: height,
                textureDepth: 1,
                packCount: 1,
                channelCount: 4,
                // Bitmaps are always 8-bit unorm: the first pass keeps the [0,1] clamp for them.
                normalized: true
            };
        } catch (error) {
            if (texture) {
                gl.deleteTexture(texture);
            }

            return this._makePreparedTileFailure(
                this._classifyTilePreparationError(error, "webgl-upload-failed"),
                error
            );
        } finally {
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, previousArrayBinding);

            if (ownsBitmap && bitmap && typeof bitmap.close === "function") {
                bitmap.close();
            }
        }
    }

    /**
     * Resolve a GPU texture-set pack format name to its WebGL2 upload parameters.
     *
     * The narrow formats exist to stop a single-channel quantitative layer paying for three
     * channels of zeroes: a cached R16F tile is a quarter of the RGBA16F one. Note this shrinks
     * the *tile* cache only -- the first-pass colour target keeps a full RGBA layer per pack
     * regardless (see colorTargetInternalFormat).
     *
     * All three half-float entries report `normalized: false` so they drive the colour-target
     * upgrade the same way; a narrow pack's values need to survive pass 1 just as much.
     *
     * No capability gate: R16F/RG16F are core WebGL2 sized internal formats and are filterable
     * in core. They would need EXT_color_buffer_half_float only to be rendered *into*, which
     * never happens -- they are sampled by the first pass and nothing else.
     *
     * @param {string} name - Pack format name.
     * @returns {?{internalFormat: GLenum, format: GLenum, type: GLenum, normalized: boolean,
     *             componentsPerPack: number, unpackAlignment: number, views: Function[]}}
     *          Upload parameters, or null when the name is not supported.
     * @private
     */
    _getGpuTexturePackFormat(name) {
        const gl = this.gl;

        switch (name) {
            case "RGBA8":
                return {
                    internalFormat: gl.RGBA8,
                    format: gl.RGBA,
                    type: gl.UNSIGNED_BYTE,
                    normalized: true,
                    componentsPerPack: 4,
                    unpackAlignment: 4,
                    views: [Uint8Array, Uint8ClampedArray]
                };

            case "RGBA16F":
                return {
                    internalFormat: gl.RGBA16F,
                    format: gl.RGBA,
                    type: gl.HALF_FLOAT,
                    normalized: false,
                    componentsPerPack: 4,
                    unpackAlignment: 4,
                    views: [Uint16Array]
                };

            case "RG16F":
                return {
                    internalFormat: gl.RG16F,
                    format: gl.RG,
                    type: gl.HALF_FLOAT,
                    normalized: false,
                    componentsPerPack: 2,
                    unpackAlignment: 4,
                    views: [Uint16Array]
                };

            case "R16F":
                return {
                    internalFormat: gl.R16F,
                    format: gl.RED,
                    type: gl.HALF_FLOAT,
                    normalized: false,
                    componentsPerPack: 1,
                    // A one-component 16-bit row is width*2 bytes, which is 2 mod 4 for odd
                    // widths. Under the default UNPACK_ALIGNMENT of 4 the driver would assume a
                    // padded row stride, demand a larger buffer than we pass, and raise
                    // INVALID_OPERATION -- on edge tiles only, so it would ship unnoticed.
                    unpackAlignment: 2,
                    views: [Uint16Array]
                };

            default:
                return null;
        }
    }

    /**
     * Prepare packed GPU texture-set tile data as a WebGL2 texture array resource.
     *
     * @param {PrepareGpuTextureTileOptions} options - GPU texture-set preparation options.
     * @returns {Promise<PreparedRasterTileResult>} Preparation result.
     */
    async prepareGpuTextureTile(options = {}) {
        const gl = this.gl;
        const gpu = options.data;
        const textureOptions = options.textureOptions || {};

        if (!gpu || typeof gpu !== "object") {
            return this._makePreparedTileFailure(
                "unsupported-data",
                new TypeError("GPU texture tile preparation requires a texture-set object.")
            );
        }

        const width = Number(gpu.width) || 0;
        const height = Number(gpu.height) || 0;
        const packs = Array.isArray(gpu.packs) ? gpu.packs : [];

        if (!width || !height) {
            return this._makePreparedTileFailure(
                "invalid-data",
                new Error("GPU texture tile preparation requires positive width and height.")
            );
        }

        if (!packs.length) {
            return this._makePreparedTileFailure(
                "unsupported-data",
                new Error("GPU texture tile preparation requires at least one texture pack.")
            );
        }

        const firstFormatName = (packs[0] && packs[0].format) || "RGBA8";
        const formatInfo = this._getGpuTexturePackFormat(firstFormatName);

        if (!formatInfo) {
            return this._makePreparedTileFailure(
                "unsupported-data",
                new Error(`Unsupported GPU texture pack format '${firstFormatName}'.`)
            );
        }

        const expectedLength = width * height * formatInfo.componentsPerPack;

        for (let layer = 0; layer < packs.length; layer++) {
            const pack = packs[layer];
            const packFormatName = (pack && pack.format) || firstFormatName;

            if (!pack || !pack.data) {
                return this._makePreparedTileFailure(
                    "invalid-data",
                    new Error(`GPU texture pack ${layer} is missing pixel data.`)
                );
            }

            if (packFormatName !== firstFormatName) {
                return this._makePreparedTileFailure(
                    "unsupported-data",
                    new Error("Mixed GPU texture pack formats are not supported.")
                );
            }

            if (!ArrayBuffer.isView(pack.data)) {
                return this._makePreparedTileFailure(
                    "unsupported-data",
                    new TypeError(`GPU texture pack ${layer} data must be a typed array.`)
                );
            }

            // WebGL2 pairs each pixel type with specific view types; a Float32Array handed to a
            // HALF_FLOAT upload fails deep inside texSubImage3D with a bare INVALID_OPERATION.
            // Now that four formats with three component counts exist, name the mismatch here.
            if (!formatInfo.views.some(View => pack.data instanceof View)) {
                return this._makePreparedTileFailure(
                    "unsupported-data",
                    new TypeError(`GPU texture pack ${layer} data must be one of ` +
                        `${formatInfo.views.map(v => v.name).join(", ")} for format '${firstFormatName}'.`)
                );
            }

            if (pack.data.length !== expectedLength) {
                return this._makePreparedTileFailure(
                    "invalid-data",
                    new Error(`GPU texture pack ${layer} has ${pack.data.length} elements, ` +
                        `expected ${expectedLength} (${width}x${height}x${formatInfo.componentsPerPack} ` +
                        `for format '${firstFormatName}').`)
                );
            }
        }

        // No precision diagnostic here on purpose. Tile preparation knows the format but not
        // whether anything could have used it -- the renderer decides that, and warns there
        // with the actual reason (master switch off, a vetoing layer, or a missing extension).
        // `formatInfo.normalized` is reported back to the drawer, which is what drives that
        // decision; see FlexDrawer#_updatePackMetadata.

        const packCount = packs.length;
        const componentsPerPack = formatInfo.componentsPerPack;
        const channelCount = Number(gpu.channelCount) || packCount * componentsPerPack;
        let texture = null;
        // Same reasoning as prepareBitmapTile: this is downstream of an await, so the binding we
        // are about to overwrite is somebody else's.
        const previousArrayBinding = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);

        try {
            texture = gl.createTexture();

            if (!texture) {
                throw new Error("WebGL2 failed to create a GPU texture-set tile texture.");
            }

            this._clearWebGLErrors();

            gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, formatInfo.internalFormat, width, height, packCount);

            if (formatInfo.unpackAlignment !== 4) {
                gl.pixelStorei(gl.UNPACK_ALIGNMENT, formatInfo.unpackAlignment);
            }

            for (let layer = 0; layer < packCount; layer++) {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, formatInfo.format, formatInfo.type, packs[layer].data);
            }

            const filter = textureOptions.imageSmoothingEnabled ? gl.LINEAR : gl.NEAREST;

            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            this._throwIfWebGLError("GPU texture-set tile upload");

            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

            this._preparedTileResources.add(texture);

            return {
                ok: true,
                resource: texture,
                texture: texture,
                width: width,
                height: height,
                textureDepth: packCount,
                packCount: packCount,
                channelCount: channelCount,
                componentsPerPack: componentsPerPack,
                // Float packs must not be clamped to [0,1] by the first-pass copy.
                normalized: formatInfo.normalized
            };
        } catch (error) {
            if (texture) {
                gl.deleteTexture(texture);
            }

            return this._makePreparedTileFailure(
                this._classifyTilePreparationError(error, "webgl-upload-failed"),
                error
            );
        } finally {
            // UNPACK_ALIGNMENT is context-global state, and every other upload path -- the
            // atlas, the bitmap path, the self-test array -- owns its textures independently
            // and assumes the default of 4. Leaving it at 2 would corrupt whichever uploads
            // next, so restore unconditionally, including after a failed upload.
            if (formatInfo.unpackAlignment !== 4) {
                gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
            }
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, previousArrayBinding);
        }
    }

    /**
     * Prepare vector mesh tile data as WebGL2 buffer resources.
     *
     * @param {PrepareVectorTileOptions} options - Vector tile preparation options.
     * @returns {Promise<PreparedVectorTileResult>} Preparation result.
     */
    async prepareVectorTile(options = {}) {
        const data = options.data;

        if (!data || typeof data !== "object") {
            return this._makePreparedTileFailure(
                "unsupported-data",
                new TypeError("Vector tile preparation requires a vector mesh object.")
            );
        }

        const vectors = {};

        try {
            const hasNativeLines = data.linePrimitives && data.linePrimitives.length;
            const hasMeshLines = !hasNativeLines && data.lines && data.lines.length;

            if (data.fills && data.fills.length) {
                vectors.fills = this._prepareVectorTileBatch(data.fills);
            }

            if (hasMeshLines) {
                vectors.lines = this._prepareVectorTileBatch(data.lines);
            }

            if (hasNativeLines) {
                const linePrimitiveGroups = new Map();

                for (const mesh of data.linePrimitives) {
                    const lineWidth = Number.isFinite(mesh.lineWidth) && mesh.lineWidth > 0
                        ? mesh.lineWidth
                        : 1;
                    const key = String(lineWidth);

                    if (!linePrimitiveGroups.has(key)) {
                        linePrimitiveGroups.set(key, []);
                    }

                    linePrimitiveGroups.get(key).push(mesh);
                }

                vectors.linePrimitives = Array.from(linePrimitiveGroups.values()).map((meshes) => {
                    return this._prepareVectorTileBatch(meshes);
                });
            }

            if (data.points && data.points.length) {
                vectors.points = this._prepareVectorTileBatch(data.points);
            }

            if (!this._isPreparedVectorTileResource(vectors)) {
                // Empty-but-valid vector tile: nothing was uploaded. Don't
                // track or emit an empty {} resource, otherwise release would
                // mis-route it to the raster branch and call deleteTexture({}).
                return {
                    ok: true,
                    resource: null,
                    vectors: null
                };
            }

            this._preparedTileResources.add(vectors);

            return {
                ok: true,
                resource: vectors,
                vectors: vectors
            };
        } catch (error) {
            this._releasePreparedVectorTileResource(vectors);

            return this._makePreparedTileFailure(
                "webgl-upload-failed",
                error
            );
        }
    }

    _prepareVectorTileBatch(meshes) {
        const gl = this.gl;

        if (!Array.isArray(meshes) || !meshes.length) {
            throw new TypeError("Vector tile batch requires at least one mesh.");
        }

        // TODO consider drain errors, though overhead in time critical loop
        //  for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++) { /* clear */ }

        let vCount = 0;
        let iCount = 0;

        for (const mesh of meshes) {
            if (!mesh || !mesh.vertices || !mesh.indices) {
                throw new TypeError("Vector mesh requires vertices and indices.");
            }

            vCount += mesh.vertices.length / 4;
            iCount += mesh.indices.length;
        }

        // Per-tile aggregate size. All meshes of one kind are merged into a single buffer
        // set, so this is what a coarse tile (many patches) pushes at the GPU. Logged under
        // render diagnostics to pin oversized-buffer blanks.
        const renderer = this.context && this.context.renderer;
        if (renderer && typeof renderer.getRenderDiagnostics === "function" && renderer.getRenderDiagnostics()) {
            $.console.warn(`FlexWebGL2: vector batch vertices=${vCount} indices=${iCount} meshes=${meshes.length}`);
        }

        const positions = new Float32Array(vCount * 4);
        const parameters = new Float32Array(vCount * 4);
        const indices = new Uint32Array(iCount);

        let vOfs = 0;
        let iOfs = 0;
        let baseVertex = 0;

        for (const mesh of meshes) {
            positions.set(mesh.vertices, vOfs * 4);

            const rgba = mesh.color ? mesh.color : [0, 0, 0, 1];
            const r = Math.max(0.0, Math.min(1.0, rgba[0]));
            const g = Math.max(0.0, Math.min(1.0, rgba[1]));
            const b = Math.max(0.0, Math.min(1.0, rgba[2]));
            const a = Math.max(0.0, Math.min(1.0, rgba[3]));

            for (let k = 0; k < mesh.vertices.length / 4; k++) {
                const pOfs = (vOfs + k) * 4;
                parameters[pOfs + 0] = r;
                parameters[pOfs + 1] = g;
                parameters[pOfs + 2] = b;
                parameters[pOfs + 3] = a;
            }

            if (mesh.parameters) {
                parameters.set(mesh.parameters, vOfs * 4);
            }

            for (let k = 0; k < mesh.indices.length; k++) {
                indices[iOfs + k] = baseVertex + mesh.indices[k];
            }

            vOfs += mesh.vertices.length / 4;
            iOfs += mesh.indices.length;
            baseVertex += mesh.vertices.length / 4;
        }

        const batch = {
            vboPos: null,
            vboParam: null,
            ibo: null,
            count: indices.length,
            lineWidth: 1
        };

        try {
            batch.vboPos = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

            batch.vboParam = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
            gl.bufferData(gl.ARRAY_BUFFER, parameters, gl.STATIC_DRAW);

            batch.ibo = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

            // A too-large aggregate buffer raises GL_OUT_OF_MEMORY, which WebGL does NOT
            // surface as a JS exception. Without this check the batch would be returned with
            // a valid count but a bad/empty GPU buffer, and drawElementsInstanced would draw
            // nothing — a silent blank tile. Turn that into a thrown failure so the tile is
            // reported (prepareVectorTile -> "webgl-upload-failed") instead of blanking.
            this._throwIfWebGLError("Vector tile buffer upload");

            const firstMesh = meshes[0] || {};
            batch.lineWidth = Number.isFinite(firstMesh.lineWidth) && firstMesh.lineWidth > 0
                ? firstMesh.lineWidth
                : 1;

            return batch;
        } catch (error) {
            // Surface the size that failed regardless of the diagnostics flag — this is the
            // signal that a tile aggregated more than the driver could upload in one buffer.
            $.console.warn(
                `FlexWebGL2: vector batch upload failed (vertices=${vCount} indices=${iCount} meshes=${meshes.length}): ${error && error.message}`
            );
            this._releasePreparedVectorTileBatch(batch);
            throw error;
        } finally {
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        }
    }

    _isPreparedVectorTileResource(resource) {
        return !!(
            resource &&
            typeof resource === "object" &&
            (
                resource.fills ||
                resource.lines ||
                resource.linePrimitives ||
                resource.points
            )
        );
    }

    _releasePreparedVectorTileResource(resource) {
        if (!resource || typeof resource !== "object") {
            return;
        }

        if (resource.fills) {
            this._releasePreparedVectorTileBatch(resource.fills);
            resource.fills = null;
        }

        if (resource.lines) {
            this._releasePreparedVectorTileBatch(resource.lines);
            resource.lines = null;
        }

        if (Array.isArray(resource.linePrimitives)) {
            for (const lineBatch of resource.linePrimitives) {
                this._releasePreparedVectorTileBatch(lineBatch);
            }
            resource.linePrimitives = null;
        }

        if (resource.points) {
            this._releasePreparedVectorTileBatch(resource.points);
            resource.points = null;
        }
    }

    _releasePreparedVectorTileBatch(batch) {
        if (!batch) {
            return;
        }

        const gl = this.gl;

        if (batch.vboPos) {
            gl.deleteBuffer(batch.vboPos);
            batch.vboPos = null;
        }

        if (batch.vboParam) {
            gl.deleteBuffer(batch.vboParam);
            batch.vboParam = null;
        }

        if (batch.ibo) {
            gl.deleteBuffer(batch.ibo);
            batch.ibo = null;
        }

        batch.count = 0;
    }

    /**
     * Release a WebGL2 prepared tile resource.
     *
     * @param {*} resource - Backend-owned resource returned by a preparation method.
     * @returns {void}
     */
    releasePreparedTileResource(resource) {
        if (!resource) {
            return;
        }

        if (this._isPreparedVectorTileResource(resource)) {
            this._releasePreparedVectorTileResource(resource);

            if (this._preparedTileResources) {
                this._preparedTileResources.delete(resource);
            }

            return;
        }

        const texture = resource && resource.texture ? resource.texture : resource;

        if (!texture) {
            return;
        }

        // Only real textures may be freed; a non-texture object slipping into
        // this branch (e.g. a stray vector resource) would throw a TypeError.
        if (texture instanceof WebGLTexture) {
            this.gl.deleteTexture(texture);
        }

        if (this._preparedTileResources) {
            this._preparedTileResources.delete(texture);
        }

        if (resource && resource.texture) {
            resource.texture = null;
        }
    }

    _normalizeBitmapTileSource(data) {
        if (!data) {
            return null;
        }

        if (typeof CanvasRenderingContext2D !== "undefined" && data instanceof CanvasRenderingContext2D) {
            return data.canvas || null;
        }

        return data;
    }

    _makePreparedTileFailure(reason, error) {
        return {
            ok: false,
            reason: reason,
            error: error
        };
    }

    _classifyTilePreparationError(error, fallbackReason) {
        if (this._isTaintOrSecurityError(error)) {
            return "tainted-data";
        }

        return fallbackReason;
    }

    _isTaintOrSecurityError(error) {
        if (!error) {
            return false;
        }

        const name = error.name ? String(error.name) : "";
        const code = Number(error.code);
        const message = error.message ? String(error.message) : String(error);

        if (name === "SecurityError") {
            return true;
        }

        // DOMException.SECURITY_ERR is historically 18. Some browsers still expose
        // numeric codes, though modern code should prefer .name.
        if (code === 18) {
            return true;
        }

        // Firefox/internal DOM security names may appear in some browser errors.
        if (name === "NS_ERROR_DOM_SECURITY_ERR") {
            return true;
        }

        return /tainted canvas|origin-clean|cross-origin|cross origin|cors/i.test(message);
    }

    _clearWebGLErrors() {
        // gl.getError() forces a synchronous CPU<->GPU sync; skip in the hot
        // tile-prep path unless WebGL debugging is explicitly enabled.
        if (!this.renderer.debug) {
            return;
        }

        const gl = this.gl;

        // cap the amount of errors to avoid an infinite loop
        for (let i = 0; i < 16; i++) {
            if (gl.getError() === gl.NO_ERROR) {
                return;
            }
        }
    }

    _throwIfWebGLError(operation) {
        // gl.getError() forces a synchronous CPU<->GPU sync; skip in the hot
        // tile-prep path unless WebGL debugging is explicitly enabled.
        if (!this.renderer.debug) {
            return;
        }

        const gl = this.gl;
        const errors = [];

        // cap the amount of errors to avoid an infinite loop
        for (let i = 0; i < 16; i++) {
            const error = gl.getError();

            if (error === gl.NO_ERROR) {
                break;
            }

            errors.push(error);
        }

        if (!errors.length) {
            return;
        }

        const message = errors.map(error => this._formatWebGLError(error)).join(", ");

        const uploadError = new Error(`${operation} failed with WebGL error(s): ${message}`);
        uploadError.webglErrors = errors;
        throw uploadError;
    }

    _formatWebGLError(error) {
        const gl = this.gl;

        if (error === gl.INVALID_ENUM) {
            return "INVALID_ENUM";
        }
        if (error === gl.INVALID_VALUE) {
            return "INVALID_VALUE";
        }
        if (error === gl.INVALID_OPERATION) {
            return "INVALID_OPERATION";
        }
        if (error === gl.INVALID_FRAMEBUFFER_OPERATION) {
            return "INVALID_FRAMEBUFFER_OPERATION";
        }
        if (error === gl.OUT_OF_MEMORY) {
            return "OUT_OF_MEMORY";
        }
        if (error === gl.CONTEXT_LOST_WEBGL) {
            return "CONTEXT_LOST_WEBGL";
        }

        return `0x${error.toString(16)}`;
    }
}

$.FlexRenderer.WebGL20 = WebGL2;


$.FlexRenderer.WebGL20.SecondPassProgram = class extends $.FlexRenderer.WGLProgram {
    constructor(context, gl, atlas) {
        super(context, gl, atlas);
        this._maxTextures = Math.min(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), 32) - 1; // subtracting 1 to allow texture atlas to be bound; TODO: only bind texture atlas when it is needed

        // Per-instance uniform arrays are sized to what the current layer set actually needs.
        // Every element of a GLSL ES array costs a full uniform vector, so a fixed upper bound
        // (this used to be a hardcoded 64 for all four arrays) spends the entire
        // MAX_FRAGMENT_UNIFORM_VECTORS budget of a 256-vector mobile GPU before a single shader
        // layer is added. Recomputed in build(); see _ensureUniformSlots for the growth path.
        //
        // The floor is 4 rather than 1: GLSL ES 3.00 forbids a zero-length array, and a little
        // slack absorbs one or two added layers without forcing a relink. 16 vectors is noise
        // against the budget this change frees up.
        this.UNIFORM_ARRAY_FLOOR = 4;
        this._uInstanceSlots = this.UNIFORM_ARRAY_FLOOR;   // u_instanceOffsets, u_shaderVariables (per shader layer)
        this._uTexIndexSlots = this.UNIFORM_ARRAY_FLOOR;   // u_instanceTextureIndexes (total tiledImages across layers)
        this._uTiInfoSlots = this.UNIFORM_ARRAY_FLOOR;     // u_tiInfo (per tiled image)
        this._relinkScheduled = false;

        // Whether this program has ever presented a frame. Used only to pick a log level: array
        // growth before the first frame is the initial build discovering how big the world is,
        // which is not an anomaly; growth afterwards means the scene outgrew a linked program and
        // is worth saying out loud. Deliberately never reset -- a relink reuses this same instance
        // (registerProgram() only swaps webGLProgram), and "ever drawn" is the question being asked.
        //
        // In shared-context mode one program instance can serve several renderers, so renderer A's
        // first frame marks it drawn and renderer B's *initial* growth then logs at warn. That errs
        // toward the noisier level and can never hide a real stale-frame warning, so it is left
        // alone; keying per renderer is not possible while setDimensions() carries no renderer id.
        this._hasDrawn = false;

        this._bgColor = 'vec4(.0)';
    }

    // PRIVATE FUNCTIONS

    /**
     * Get vertex shader's glsl code.
     * @returns {string} vertex shader's glsl code
     */
    _getVertexShaderSource() {
        // Must match _getFragmentShaderSource(): mismatched precision on the shared
        // varying is a link error on some drivers.
        const vertexShaderSource = `#version 300 es
precision mediump int;
precision ${this.context.colorTargetGlslPrecision} float;

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
        // u_inputTextures is the first-pass color target. Sampling an RGBA16F array through a
        // mediump sampler2DArray re-clamps to ~±16384 with a ~10-bit mantissa, so promoting only
        // the first pass would give a float target that this pass then mangles.
        const targetPrecision = this.context.colorTargetGlslPrecision;

        // final_color is declared unconditionally below, so main() must assign it unconditionally
        // too: a declared-but-unwritten `out` makes every draw a GL_INVALID_OPERATION ("Active
        // draw buffers with missing fragment shader outputs") and the canvas stays blank, with
        // nothing in the pipeline reporting a fault. build() can legitimately hand us an empty
        // body (no layers in the render order), and that case is the limit of the non-empty one,
        // which seeds composition from _bgColor -- so it clears to the same colour. Guarding here
        // rather than in build() keeps the invariant true for every caller, present and future.
        const mainBody = (execution && execution.trim()) ? execution : `    final_color = ${this._bgColor};`;

        const fragmentShaderSource = `#version 300 es
precision mediump int;
precision ${targetPrecision} float;
precision ${targetPrecision} sampler2DArray;


// UNIFORMS

// Stores shader index -> pointer to u_instanceTextureIndexes
uniform int u_instanceOffsets[${this._uInstanceSlots}];

// Stores texture indexes for each shader, beginning at index obtained from u_instanceOffsets
uniform int u_instanceTextureIndexes[${this._uTexIndexSlots}];

// Carries shader global attributes (opacity, pixelSize, imageOriginPx.xy)
uniform vec4 u_shaderVariables[${this._uInstanceSlots}];

// Viewport zoom — identical across all shaders this frame, so kept as a scalar
// instead of duplicating per slot in u_shaderVariables.
uniform float u_zoom;

// Framebuffer px per CSS px (devicePixelRatio, as realised by the canvas).
// Frame-global like u_zoom, for the same reason.
//
// Per-axis, and not for symmetry: the framebuffer dimensions are rounded to whole
// pixels independently, so 1634x1586 CSS at DPR 1.2 becomes 1961x1903 and the two
// scales differ (1.20012 vs 1.19987). imageOriginPx.x is built with the x scale and
// imageOriginPx.y with the y scale, so a scalar here would divide an sy-built
// numerator by an sx-built denominator. Both components are exactly 1 at DPR 1.
//
// COORDINATE UNITS: gl_FragCoord.xy and imageOriginPx are framebuffer px, but
// pixelSize is CSS px per image px. Multiply to bridge them:
//     framebuffer px per image px == pixelSize * devicePixelScale
// Controls documented in "screen px" mean CSS px and must be multiplied by
// devicePixelScale before being compared against framebuffer distances.
uniform vec2 u_devicePixelScale;

// For each tiled image, we store (base texture offset, pack count, channel count,
// components per pack).
uniform ivec4 u_tiInfo[${this._uTiInfoSlots}];

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

// Packed renderer-owned interaction state.
//
// u_interactionPointer:
//   xy = pointerPositionPx
//   zw = lastClickPositionPx
//
// u_interactionDragStartCurrent:
//   xy = dragStartPositionPx
//   zw = dragCurrentPositionPx
//
// u_interactionDragEnd:
//   xy = dragEndPositionPx
//   zw = reserved
//
// u_interactionState:
//   x = enabled ? 1 : 0
//   y = pointerInside ? 1 : 0
//   z = activeButtons
//   w = lastClickButtons
//
// u_interactionDragState:
//   x = dragActive ? 1 : 0
//   y = dragButtons
//   z = clickSerial
//   w = dragSerial
//
// Button fields use the browser MouseEvent.buttons / PointerEvent.buttons bitmask:
//   0  = no button active
//   1  = primary button, usually left mouse button
//   2  = secondary button, usually right mouse button
//   4  = auxiliary button, usually middle mouse button
//   8  = fourth button, usually browser back
//   16 = fifth button, usually browser forward
//
// Multiple pressed buttons are represented by bitwise OR, e.g.
//   3 = primary | secondary
//   5 = primary | auxiliary
//
// Test button state in GLSL through:
//   fr_interaction_button_active(buttonMask)

uniform vec4 u_interactionPointer;
uniform vec4 u_interactionDragStartCurrent;
uniform vec4 u_interactionDragEnd;
uniform ivec4 u_interactionState;
uniform ivec4 u_interactionDragState;


// INPUT VARIABLES


// INPUT VARIABLES

in vec2 v_texture_coords;


// OUTPUT VARIABLES

// Declared here, therefore written unconditionally in main() -- see the mainBody guard above.
layout(location=0) out vec4 final_color;


// GLOBAL VARIABLES

int instance_id;
bool stencilPasses;
float opacity;
float pixelSize;
float zoom;
vec2 devicePixelScale;
vec2 imageOriginPx;


// FUNCTION DEFINITIONS

int osd_pack_count(int sourceIndex) {
    int offset = u_instanceOffsets[instance_id];
    int worldIndex = u_instanceTextureIndexes[offset + sourceIndex];
    return u_tiInfo[worldIndex].y;
}

// Components carried by one texture-array layer: 4 for RGBA8/RGBA16F, 2 for RG16F, 1 for R16F.
// Zero means the drawer has not reported it yet, in which case the old 4-per-pack semantics
// are exactly right -- every format that existed before this was RGBA.
int osd_components_per_pack(int sourceIndex) {
    int offset = u_instanceOffsets[instance_id];
    int worldIndex = u_instanceTextureIndexes[offset + sourceIndex];
    int cpp = u_tiInfo[worldIndex].w;
    if (cpp <= 0) {
        return 4;
    }
    return clamp(cpp, 1, 4);
}

int osd_channel_count(int sourceIndex) {
    int offset = u_instanceOffsets[instance_id];
    int worldIndex = u_instanceTextureIndexes[offset + sourceIndex];
    ivec4 info = u_tiInfo[worldIndex];
    if (info.z <= 0) {
        return info.y * osd_components_per_pack(sourceIndex);
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
    // Out of range reads zero rather than the last pack's data: osd_texture clamps packIndex,
    // so without this an over-range channel silently returns a real -- and wrong -- value.
    if (channelIndex < 0 || channelIndex >= osd_channel_count(sourceIndex)) {
        return 0.0;
    }
    // Division, not >>2 / &3: a future 3-component format would not be a power of two.
    int cpp = osd_components_per_pack(sourceIndex);
    int pack = channelIndex / cpp;
    int comp = channelIndex - pack * cpp;
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

bool fr_interaction_enabled() {
    return u_interactionState.x != 0;
}

bool fr_interaction_pointer_inside() {
    return u_interactionState.y != 0;
}

vec2 fr_interaction_pointer_position_px() {
    return u_interactionPointer.xy;
}

int fr_interaction_active_buttons() {
    return u_interactionState.z;
}

bool fr_interaction_button_active(int buttonMask) {
    return (fr_interaction_active_buttons() & buttonMask) != 0;
}

vec2 fr_interaction_last_click_position_px() {
    return u_interactionPointer.zw;
}

int fr_interaction_last_click_buttons() {
    return u_interactionState.w;
}

int fr_interaction_click_serial() {
    return u_interactionDragState.z;
}

bool fr_interaction_drag_active() {
    return u_interactionDragState.x != 0;
}

vec2 fr_interaction_drag_start_position_px() {
    return u_interactionDragStartCurrent.xy;
}

vec2 fr_interaction_drag_current_position_px() {
    return u_interactionDragStartCurrent.zw;
}

vec2 fr_interaction_drag_end_position_px() {
    return u_interactionDragEnd.xy;
}

int fr_interaction_drag_buttons() {
    return u_interactionDragState.y;
}

int fr_interaction_drag_serial() {
    return u_interactionDragState.w;
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
${mainBody}
}`;

        return fragmentShaderSource;
    }

    /**
     * Size the per-instance uniform arrays to the current layer set.
     *
     * GLSL ES gives every array element its own uniform vector, so these four arrays are the
     * single largest consumer of the fragment uniform budget. Sizing them to demand instead of a
     * fixed upper bound is what keeps the program linkable on GPUs reporting the GLES3 minimum of
     * 224 MAX_FRAGMENT_UNIFORM_VECTORS.
     *
     * @param {Array} flatShaders flattened shader layers, one per render slot
     * @return {boolean} true if any size changed (the program must be recompiled)
     */
    _ensureUniformSlots(flatShaders) {
        let texIndexCount = 0;
        for (const shader of flatShaders) {
            const config = typeof shader.getConfig === "function" ? shader.getConfig() : null;
            const tiledImages = config && config.tiledImages;
            texIndexCount += (tiledImages && tiledImages.length) || 0;
        }

        // Sized off the FLAT layer count, not keyOrder.length: nested groups flatten to more
        // render slots than there are top-level keys, and undersizing here would silently
        // truncate u_shaderVariables for every child layer.
        const floor = this.UNIFORM_ARRAY_FLOOR;
        const instanceSlots = Math.max(floor, flatShaders.length);
        const texIndexSlots = Math.max(floor, texIndexCount);
        const tiInfoSlots = Math.max(floor, this._tiledImageCount || 0);

        const changed = instanceSlots !== this._uInstanceSlots ||
            texIndexSlots !== this._uTexIndexSlots ||
            tiInfoSlots !== this._uTiInfoSlots;

        this._uInstanceSlots = instanceSlots;
        this._uTexIndexSlots = texIndexSlots;
        this._uTiInfoSlots = tiInfoSlots;
        return changed;
    }

    build(shaderMap, keyOrder) {
        if (!keyOrder || !keyOrder.length) {
            // Todo prevent unimportant first init build call
            // The empty body is turned into a background write by _getFragmentShaderSource, so
            // this still links a program that is legal to draw with.
            this._ensureUniformSlots([]);
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
        this._ensureUniformSlots(flatShaders);

        const stackSource = this.context.composeShaderLayerStack(shaderMap, keyOrder, {
            ownerShader: null,
            initialColor: this._bgColor,
            useInspectorAlpha: true
        });

        const execution = `final_color = ${stackSource.execution};`;

        this.vertexShader = this._getVertexShaderSource();
        this.fragmentShader = this._getFragmentShaderSource(
            stackSource.definition,
            execution,
            "",
            $.FlexRenderer.ShaderLayer.__globalIncludes
        );
    }

    /**
     * Re-query every uniform location against the currently assigned WebGLProgram and record
     * which program they belong to.
     *
     * Split out of created() because created() also allocates the VAO: use() must be able to
     * repair its locations without leaking a vertex array per draw.
     */
    _resolveLocations() {
        const gl = this.gl;
        const program = this.webGLProgram;

        // Shader element indexes match element id (instance id) to position in the texture array
        this._instanceOffsets = gl.getUniformLocation(program, "u_instanceOffsets[0]");
        this._instanceTextureIndexes = gl.getUniformLocation(program, "u_instanceTextureIndexes[0]");
        this._shaderVariables = gl.getUniformLocation(program, "u_shaderVariables");
        this._zoomLoc = gl.getUniformLocation(program, "u_zoom");
        this._devicePixelScaleLoc = gl.getUniformLocation(program, "u_devicePixelScale");

        this._texturesLocation = gl.getUniformLocation(program, "u_inputTextures");
        this._stencilLocation = gl.getUniformLocation(program, "u_stencilTextures");

        this._tiInfoLoc = gl.getUniformLocation(program, "u_tiInfo");
        this._inspectorALocation = gl.getUniformLocation(program, "u_inspectorA");
        this._inspectorBLocation = gl.getUniformLocation(program, "u_inspectorB");

        this._interactionPointerLocation = gl.getUniformLocation(program, "u_interactionPointer");
        this._interactionDragStartCurrentLocation = gl.getUniformLocation(program, "u_interactionDragStartCurrent");
        this._interactionDragEndLocation = gl.getUniformLocation(program, "u_interactionDragEnd");
        this._interactionStateLocation = gl.getUniformLocation(program, "u_interactionState");
        this._interactionDragStateLocation = gl.getUniformLocation(program, "u_interactionDragState");

        this._locationProgram = program;
    }

    /**
     * Create program.
     * @param width
     * @param height
     */
    created(width, height) {
        this._resolveLocations();
        this.vao = this.gl.createVertexArray();

        // TODO: is this refreshing logic necessary? if enableing this, delete the above refresh, not needed, will be done at use(...)
        //  this._uploadedPackInfoVersion = -1;
    }

    /**
     * Load program. No arguments.
     */
    load(renderArray) {
        const gl = this.gl;
        const renderer = this.context && this.context.renderer;

        // Every registered shader, not just the ones in this render array. `requiresLoad` is a
        // single program-wide flag, so whichever array happens to run first discharges it for
        // everyone -- and a partial array (renderVisualizationToTexture with an explicit
        // shaderMap, an offscreen region pass) would otherwise leave the shaders it omitted
        // holding uniform locations from the program registerProgram() just deleted.
        const shaders = renderer && typeof renderer.getFlatShaderLayers === "function" ?
            renderer.getFlatShaderLayers() :
            renderArray.map(renderInfo => renderInfo.shader);

        for (const shader of shaders) {
            shader.glLoaded(this.webGLProgram, gl);
        }
        this.atlas.load(this.webGLProgram);
        this._uploadTiledImageInfo();
    }

    /**
     * Use program. Arbitrary arguments.
     */
    use(renderOutput, renderArray, options = undefined) {
        const gl = this.gl;
        const framebuffer = options && options.framebuffer !== undefined ? options.framebuffer : null;

        // Every uniform upload below goes through a cached location, and a location belongs to
        // the program it was resolved against. CURRENT_PROGRAM is context-global in shared-context
        // mode and `created()` is the only place these get re-queried, so verify both here rather
        // than trusting the caller -- the same guard ShaderLayer.glDrawing and TextureAtlas.bind
        // already apply to theirs.
        this.context.renderer._bindGLProgram(this.webGLProgram);
        if (this._locationProgram !== this.webGLProgram) {
            this._resolveLocations();
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        // Set unconditionally: a program owns the draw-buffer state of whatever it binds, and this
        // renderer can share one GL context with other drawers (xOpat runs OSD's own single-output
        // drawer alongside it), so nothing may be assumed about what the previous pass left behind.
        // The two cases genuinely differ -- for the default framebuffer the only legal entries are
        // BACK and NONE, and COLOR_ATTACHMENT0 there is an INVALID_OPERATION.
        gl.drawBuffers(framebuffer ? [gl.COLOR_ATTACHMENT0] : [gl.BACK]);

        if (options && options.width && options.height) {
            gl.viewport(0, 0, options.width, options.height);
        }

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

            const origin = renderInfo.imageOriginPx || [0, 0];
            shaderVariables.push(renderInfo.opacity, renderInfo.pixelSize, origin[0], origin[1]);

            instanceOffsets.push(instanceTextureIndexes.length);
            instanceTextureIndexes.push(...renderInfo.shader.getConfig().tiledImages);
        }

        // todo _instanceOffsets and _instanceTextureIndexes are possibly static per program lifetime, so we could do this once at load()
        // Guard against empty arrays — WebGL2 raises INVALID_VALUE on uniform1iv with a zero-length array.
        // This happens for shaders with no tiledImages (e.g. the grid shader); leaving the GLSL fixed-size
        // uniform arrays at their defaults is fine since those shaders don't read these uniforms.
        //
        // The upper clamp matters just as much now that the arrays are sized to demand rather than
        // to a fixed 64: renderArray can be longer than the layer set this program was compiled
        // for, and overrunning a declared array length is INVALID_OPERATION. Clamping keeps the
        // frame stale instead of erroring, and the scheduled relink widens the arrays for the next
        // one.
        if (instanceOffsets.length > this._uInstanceSlots ||
            instanceTextureIndexes.length > this._uTexIndexSlots) {
            this._scheduleRelink(
                `arrays hold (${this._uInstanceSlots}, ${this._uTexIndexSlots}), frame needs ` +
                `(${instanceOffsets.length}, ${instanceTextureIndexes.length})`);
            instanceOffsets.length = Math.min(instanceOffsets.length, this._uInstanceSlots);
            instanceTextureIndexes.length = Math.min(instanceTextureIndexes.length, this._uTexIndexSlots);
            shaderVariables.length = Math.min(shaderVariables.length, this._uInstanceSlots * 4);
        }

        if (instanceOffsets.length > 0) {
            gl.uniform1iv(this._instanceOffsets, instanceOffsets);
        }
        if (instanceTextureIndexes.length > 0) {
            gl.uniform1iv(this._instanceTextureIndexes, instanceTextureIndexes);
        }
        // todo changes dynamically, but could be stored per tiled image instead of per-shader layer
        // Guarded for the same reason as the two above: uniform4fv with an empty array is INVALID_VALUE.
        if (shaderVariables.length > 0) {
            gl.uniform4fv(this._shaderVariables, shaderVariables);
        }
        gl.uniform1f(this._zoomLoc, renderArray.length > 0 ? renderArray[0].zoom : 1);
        // Frame-global like zoom: every layer draws into the same canvas, so slot 0 speaks
        // for all of them. Missing on the standalone/self-test paths, which have no viewport
        // and therefore render at 1:1. A bare number is accepted as an isotropic scale.
        const dps = renderArray.length > 0 ? renderArray[0].devicePixelScale : undefined;
        gl.uniform2f(this._devicePixelScaleLoc,
            (Array.isArray(dps) ? dps[0] : dps) || 1,
            (Array.isArray(dps) ? dps[1] : dps) || 1);

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

        // TODO: Possibly send inspector and interaction data only on an actual change.

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

        const interactionState = this.context.renderer.getInteractionState();

        gl.uniform4f(
            this._interactionPointerLocation,
            interactionState.pointerPositionPx.x,
            interactionState.pointerPositionPx.y,
            interactionState.lastClickPositionPx.x,
            interactionState.lastClickPositionPx.y
        );

        gl.uniform4f(
            this._interactionDragStartCurrentLocation,
            interactionState.dragStartPositionPx.x,
            interactionState.dragStartPositionPx.y,
            interactionState.dragCurrentPositionPx.x,
            interactionState.dragCurrentPositionPx.y
        );

        gl.uniform4f(
            this._interactionDragEndLocation,
            interactionState.dragEndPositionPx.x,
            interactionState.dragEndPositionPx.y,
            0,
            0
        );

        gl.uniform4i(
            this._interactionStateLocation,
            interactionState.enabled ? 1 : 0,
            interactionState.pointerInside ? 1 : 0,
            interactionState.activeButtons,
            interactionState.lastClickButtons
        );

        gl.uniform4i(
            this._interactionDragStateLocation,
            interactionState.dragActive ? 1 : 0,
            interactionState.dragButtons,
            interactionState.clickSerial,
            interactionState.dragSerial
        );

        this.atlas.bind(gl.TEXTURE2, 2, this.webGLProgram);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this._hasDrawn = true;

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
        const componentsPerPack = packInfo.componentsPerPack || [];

        // u_tiInfo is declared with exactly _uTiInfoSlots entries. setDimensions() can raise
        // _tiledImageCount after the program was compiled; uploading more than the declared
        // length is an INVALID_VALUE, so clamp here and let the rebuild triggered by
        // setDimensions() widen the array.
        const maxTI = Math.min(this._tiledImageCount || 0, this._uTiInfoSlots);
        const tiInfo = new Int32Array(maxTI * 4);

        for (let i = 0; i < maxTI; i++) {
            const base = (typeof baseLayer[i] === "number") ? baseLayer[i] : i;
            const pc = (typeof packCount[i] === "number") ? packCount[i] : 1;
            const cpp = (typeof componentsPerPack[i] === "number") ? componentsPerPack[i] : 4;

            tiInfo[i * 4 + 0] = base;
            tiInfo[i * 4 + 1] = pc;
            tiInfo[i * 4 + 2] = (typeof channelCount[i] === "number") ? channelCount[i] : pc * cpp;
            tiInfo[i * 4 + 3] = cpp;
        }

        if (maxTI > 0) {
            this.gl.uniform4iv(this._tiInfoLoc, tiInfo);
        }
    }

    /**
     * Destroy program. No arguments.
     */
    destroy() {
        this.gl.deleteVertexArray(this.vao);
    }

    /**
     * Relink the second pass because a uniform array is too short for what the scene now needs.
     *
     * Deferred to a microtask on purpose: registerProgram() deletes and recreates the
     * WebGLProgram and changes CURRENT_PROGRAM, which must not happen underneath an in-flight
     * draw or from inside setDimensions(). Until it runs, use() clamps its uploads, so the
     * intervening frames are stale rather than broken.
     *
     * @param {string} reason human-readable cause, logged once per relink
     * @param {"warn"|"debug"} [level="warn"] how loudly to report it. "debug" is for growth that is
     *   part of ordinary startup rather than a symptom; see setDimensions(). Note the early return
     *   below coalesces causes, so a "debug" cause arriving first in a microtask window suppresses
     *   the message for a "warn" cause behind it -- the relink still happens, only the level is lost.
     */
    _scheduleRelink(reason, level = "warn") {
        if (this._relinkScheduled) {
            return;
        }
        this._relinkScheduled = true;
        // Keep the receiver: $.console is window.console where available, and calling through the
        // object avoids depending on the native methods being detachable.
        if (level === "debug") {
            $.console.debug(`FlexWebGL2 second pass: relinking, ${reason}.`);
        } else {
            $.console.warn(`FlexWebGL2 second pass: relinking, ${reason}.`);
        }

        const renderer = this.context && this.context.renderer;
        const key = this.context && this.context.secondPassProgramKey;
        Promise.resolve().then(() => {
            this._relinkScheduled = false;
            if (renderer && key !== undefined) {
                try {
                    renderer.registerProgram(null, key);
                } catch (e) {
                    // Nobody is awaiting this microtask, so an escaping throw is an unhandled
                    // rejection. Widening the arrays is exactly the change that can exceed the
                    // fragment uniform budget; on failure the previously linked program stays
                    // bound and use()'s clamping keeps frames stale rather than broken.
                    $.console.error(`FlexWebGL2 second pass: relink failed, the previous program ` +
                        `is kept and uniform arrays stay clamped.`, e);
                }
            }
        });
    }

    // TODO we might want to fire only for active program and do others when really encesarry or with some delay, best at some common implementation level
    setDimensions(x, y, width, height, levels, tiledImageCount) {
        this._dataLayerCount = levels;
        // u_tiInfo is sized to the tiled-image count known at compile time. This is the one size
        // that can grow behind the program's back — adding a tiled image does not otherwise
        // rebuild the shader the way adding a layer does.
        //
        // Filling the world with tiled images is what opening a visualization *is*, so growth
        // before this program has presented a frame is the initial build learning the world size,
        // not a symptom -- and at warn it reached the host's user-visible log next to real problems.
        // After the first frame the same growth means a linked program was outgrown mid-session,
        // which is worth reporting.
        const grew = (tiledImageCount || 0) > this._uTiInfoSlots;
        this._tiledImageCount = tiledImageCount;
        if (grew) {
            this._scheduleRelink(
                `u_tiInfo holds ${this._uTiInfoSlots}, world now has ${tiledImageCount} tiled images`,
                this._hasDrawn ? "warn" : "debug");
        }
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
// Written unconditionally by main() below. A declared output that some branch leaves unassigned
// makes every draw a GL_INVALID_OPERATION, so keep any future main() total in final_color.
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

    /**
     * See SecondPassProgram._resolveLocations: split out so use() can repair its locations
     * without allocating another VAO.
     */
    _resolveLocations() {
        const gl = this.gl;
        const program = this.webGLProgram;
        this._fullTextureLoc = gl.getUniformLocation(program, 'u_fullTexture');
        this._viewportSizeLoc = gl.getUniformLocation(program, 'u_viewportSize');
        this._lensCenterLoc = gl.getUniformLocation(program, 'u_lensCenterPx');
        this._radiusLoc = gl.getUniformLocation(program, 'u_radiusPx');
        this._featherLoc = gl.getUniformLocation(program, 'u_featherPx');
        this._lensZoomLoc = gl.getUniformLocation(program, 'u_lensZoom');
        this._modeLoc = gl.getUniformLocation(program, 'u_mode');
        this._enabledLoc = gl.getUniformLocation(program, 'u_enabled');

        this._locationProgram = program;
    }

    created(width, height) {
        this._width = width;
        this._height = height;
        this._resolveLocations();
        this.vao = this.gl.createVertexArray();
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

        // Same reasoning as SecondPassProgram.use(): cached locations are only valid for the
        // program they were resolved against, and CURRENT_PROGRAM is context-global.
        this.context.renderer._bindGLProgram(this.webGLProgram);
        if (this._locationProgram !== this.webGLProgram) {
            this._resolveLocations();
        }

        const framebuffer = options.framebuffer === undefined ? null : options.framebuffer;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        // Same reasoning as SecondPassProgram.use(): own the draw-buffer state of what you bind
        // rather than inheriting whatever the previous pass left, and BACK is the only legal entry
        // for the default framebuffer.
        gl.drawBuffers(framebuffer ? [gl.COLOR_ATTACHMENT0] : [gl.BACK]);
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
        // Sampling and writing RGBA16F through mediump would re-clamp to ~±16384 with a ~10-bit
        // mantissa, silently undoing the float target. Stays mediump for RGBA8.
        const targetPrecision = this.context.colorTargetGlslPrecision;

        // Vertex stage matches the fragment stage: mismatched precision on the shared
        // varyings is a link error on some drivers.
        this.vertexShader = `#version 300 es
precision mediump int;
precision ${targetPrecision} float;

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
    if (u_renderClippingParams.x > 0.5 && u_renderClippingParams.y > 0.0) {  // true for vector rendering
        v_texture_coords = vec2((a_payload0.x - a_payload1.x) / a_payload1.z, (a_payload0.y - a_payload1.y) / a_payload1.w);
    } else {
        int vid = gl_VertexID & 3;
        v_texture_coords = (vid == 0) ? a_payload0.xy :
            (vid == 1) ? a_payload0.zw :
                (vid == 2) ? a_payload1.xy : a_payload1.zw;
    }

    mat3 matrix = (u_renderClippingParams.x > 0.5 && u_renderClippingParams.y > 0.0) ? u_geomMatrix : a_transform_matrix;  // true for vector rendering

    vec3 space_2d = (u_renderClippingParams.x > 0.5) ? matrix * vec3(a_payload0.xy, 1.0) : matrix * viewport[gl_VertexID];  // true for vector and clip rendering

    v_vecDepth = a_payload0.z;
    v_textureId = int(a_payload0.w);
    v_vecColor = a_payload1;

    gl_Position = vec4(space_2d.xy, 1.0, space_2d.z);
    instance_id = gl_InstanceID;
}
`;

        this.fragmentShader = `#version 300 es
precision mediump int;
precision ${targetPrecision} float;
precision ${targetPrecision} sampler2D;
precision ${targetPrecision} sampler2DArray;

uniform vec2 u_renderClippingParams;

flat in int instance_id;
in vec2 v_texture_coords;
in float v_vecDepth;
flat in int v_textureId;
in vec4 v_vecColor;

uniform sampler2DArray u_textures[${this._maxTextures}];
uniform int u_tileLayer;

// 1.0 while copying unorm-sourced tiles, 0.0 for float-sourced tiles.
// An RGBA8 target clamped pass-1 output implicitly; RGBA16F does not. Keeping the clamp for
// unorm sources preserves the old [0,1] contract for them, so an 8-bit background mixed with a
// float layer behaves exactly as before, while float data passes through untouched.
uniform float u_clampColorOutput;

${this.atlas.getFragmentShaderDefinition()}

// Every branch of main() below assigns both of these, including the pure-clipping path that has
// color writes masked off. Keep it that way: a declared output left unassigned on some path makes
// the draw a GL_INVALID_OPERATION ("Active draw buffers with missing fragment shader outputs").
layout(location=0) out vec4 outputColor;
layout(location=1) out vec4 outputStencil;

float fr_segment_distance(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float denom = max(dot(ba, ba), 0.000001);
    float h = clamp(dot(pa, ba) / denom, 0.0, 1.0);
    return length(pa - ba * h);
}

bool fr_diagnostic_pixel(vec2 p) {
    const float border = 0.035;
    const float lineWidth = 0.022;

    bool borderPixel = p.x <= border || p.x >= 1.0 - border || p.y <= border || p.y >= 1.0 - border;

    vec2 top = vec2(0.5, 0.76);
    vec2 left = vec2(0.28, 0.31);
    vec2 right = vec2(0.72, 0.31);

    float triangleDistance = min(
        fr_segment_distance(p, top, left),
        min(
            fr_segment_distance(p, left, right),
            fr_segment_distance(p, right, top)
        )
    );

    bool trianglePixel = triangleDistance <= lineWidth;
    bool exclamationBar = abs(p.x - 0.5) <= 0.018 && p.y >= 0.43 && p.y <= 0.61;
    bool exclamationDot = distance(p, vec2(0.5, 0.36)) <= 0.026;

    return borderPixel || trianglePixel || exclamationBar || exclamationDot;
}

void main() {
    if (u_renderClippingParams.x < 0.5 && u_renderClippingParams.y == 0.0) {  // true for raster rendering
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

        if (u_clampColorOutput > 0.5) {
            outputColor = clamp(outputColor, 0.0, 1.0);
        }

        outputStencil = vec4(1.0);
        gl_FragDepth = gl_FragCoord.z;
    } else if (u_renderClippingParams.x > 0.5 && u_renderClippingParams.y > 0.0) {  // true for vector rendering
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
    } else if (u_renderClippingParams.x < 0.5 && u_renderClippingParams.y < 0.0) {  // true for diagnostic rendering mode
        vec2 diagnosticCoords = clamp(v_texture_coords, vec2(0.0), vec2(1.0));
        diagnosticCoords.y = 1.0 - diagnosticCoords.y;

        if (!fr_diagnostic_pixel(diagnosticCoords)) {
            discard;
        }

        outputColor = vec4(1.0, 0.74, 0.05, 1.0);
        outputStencil = vec4(1.0);
        gl_FragDepth = gl_FragCoord.z;
    } else {
        // Pure clipping path. Color writes are disabled during this draw,
        // but keep outputs defined to avoid undefined MRT behavior if the
        // path is reused incorrectly later.
        outputColor = vec4(0.0);
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
        this._clampColorOutputLoc = gl.getUniformLocation(program, "u_clampColorOutput");

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
        this._nativeLineWidthRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) || [1, 1];

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

        this._locationProgram = program;
    }

    /**
     * Load program. No arguments.
     */
    load() {
        this.gl.uniform1iv(this._inputTexturesLoc, this._textureIndexes);
        // Legacy-compatible default; overridden per raster batch in use(...)
        this.gl.uniform1f(this._clampColorOutputLoc, 1.0);

        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

        this.atlas.load(this.webGLProgram);
    }

    /**
     * Use program. Arbitrary arguments.
     */
    use(renderOutput, sourceArray, options) {
        const gl = this.gl;

        // Same reasoning as SecondPassProgram.use(). created() also re-establishes the VAO
        // attribute state, which is bound to the program's attribute locations, so the repair has
        // to go through it rather than through a locations-only helper.
        this.context.renderer._bindGLProgram(this.webGLProgram);
        if (this._locationProgram !== this.webGLProgram) {
            this.created(0, 0);
        }

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

        let diagnosticRegionCount = 0;

        for (const renderInfo of sourceArray) {
            const rasterTiles = renderInfo.tiles;

            const attachments = [];

            const targetColorLayer   = renderInfo.dataIndex;
            const targetStencilLayer = renderInfo.stencilIndex;

            // Defensive: attaching a layer index >= the allocated array depth makes the
            // framebuffer incomplete, which fails every clear/draw in this pass — not just
            // this source. The drawer grows the arrays before rendering so this should never
            // trigger; if it ever does, skip the offending source rather than blanking all.
            if (targetColorLayer >= this._dataLayerCount || targetStencilLayer >= this._tiledImageCount) {
                if (!this._layerOverflowWarned) {
                    $.console.warn(`FlexWebGL2: first-pass layer out of range (color ${targetColorLayer}/${this._dataLayerCount}, stencil ${targetStencilLayer}/${this._tiledImageCount}); skipping source.`);
                    this._layerOverflowWarned = true;
                }
                continue;
            }

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

            this.atlas.bind(gl.TEXTURE0 + this._maxTextures, this._maxTextures, this.webGLProgram); // TODO: find out if this could be run only once at setup

            // First, clip polygons if any required
            if (renderInfo.polygons.length) {
                gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);

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
                    const maxBatchSize = Math.min(this._maxTextures, tileCount - currentIndex);

                    // The [0,1] clamp is a per-draw uniform, so a batch must be homogeneous in
                    // source kind. Tiles of one source always are, so this normally never splits.
                    const batchNormalized = rasterTiles[currentIndex].normalized !== false;
                    let batchSize = 1;
                    while (batchSize < maxBatchSize &&
                        (rasterTiles[currentIndex + batchSize].normalized !== false) === batchNormalized) {
                        batchSize++;
                    }

                    gl.uniform1f(this._clampColorOutputLoc, batchNormalized ? 1.0 : 0.0);

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

                    const linePrimitiveBatches = vectorTile.linePrimitives;
                    if (linePrimitiveBatches && linePrimitiveBatches.length) {
                        for (const lineBatch of linePrimitiveBatches) {
                            if (!vectorTile.fills && !vectorTile.lines) {
                                gl.uniformMatrix3fv(this._geomSingleMatrix, false, lineBatch.matrix);
                            }

                            const lineWidth = Number.isFinite(lineBatch.lineWidth) && lineBatch.lineWidth > 0
                                ? lineBatch.lineWidth
                                : 1;
                            const minLineWidth = this._nativeLineWidthRange[0] || 1;
                            const maxLineWidth = this._nativeLineWidthRange[1] || 1;

                            gl.lineWidth(Math.max(minLineWidth, Math.min(maxLineWidth, lineWidth)));

                            // Bind positions. payload0 is vec4(x, y, depth, textureId).
                            gl.bindBuffer(gl.ARRAY_BUFFER, lineBatch.vboPos);
                            gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                            // Bind per-vertex colors.
                            gl.bindBuffer(gl.ARRAY_BUFFER, lineBatch.vboParam);
                            gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

                            // Bind indices and draw native line segments.
                            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineBatch.ibo);
                            gl.drawElementsInstanced(gl.LINES, lineBatch.count, gl.UNSIGNED_INT, 0, 1);
                        }

                        gl.lineWidth(1);
                    }

                    batch = vectorTile.points;
                    if (batch) {
                        if (!vectorTile.fills && !vectorTile.lines && !(vectorTile.linePrimitives && vectorTile.linePrimitives.length)) {
                            gl.uniformMatrix3fv(this._geomSingleMatrix, false, batch.matrix);
                        }

                        // Bind positions. payload0 is vec4(x, y, depth, textureId).
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboPos);
                        gl.vertexAttribPointer(this._positionsBuffer, 4, gl.FLOAT, false, 0, 0);

                        // Bind per-vertex colors (normalized u8 → float 0..1).
                        // For colored point meshes: vec4(r, g, b, a).
                        // For icon point meshes: vec4(xStart, yStart, width, height).
                        gl.bindBuffer(gl.ARRAY_BUFFER, batch.vboParam);
                        gl.vertexAttribPointer(this._colorAttrib, 4, gl.FLOAT, false, 0, 0);

                        // Bind indices and draw one instance.
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.ibo);
                        gl.drawElementsInstanced(gl.TRIANGLES, batch.count, gl.UNSIGNED_INT, 0, 1);
                    }
                }

                gl.uniform2f(this._renderClipping, 0, 0);
            }

            const diagnostics = renderInfo.diagnostics;
            if (this.context.renderer.getRenderDiagnostics() && Array.isArray(diagnostics) && diagnostics.length) {
                const gl = this.gl;

                let currentIndex = 0;

                gl.disable(gl.BLEND);
                gl.uniform2f(this._renderClipping, 0, -1);
                gl.bindVertexArray(this.firstPassVao);

                while (currentIndex < diagnostics.length) {
                    const batchSize = Math.min(this._maxTextures, diagnostics.length - currentIndex);

                    for (let i = 0; i < batchSize; i++) {
                        const diagnostic = diagnostics[currentIndex + i];

                        this._tempMatrixData.set(diagnostic.transformMatrix, i * 9);
                        this._tempTexCoords.set(diagnostic.position, i * 8);
                    }

                    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordsBuffer);
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._tempTexCoords.subarray(0, batchSize * 8));

                    gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer);
                    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._tempMatrixData.subarray(0, batchSize * 9));

                    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batchSize);
                    currentIndex += batchSize;
                }

                gl.uniform2f(this._renderClipping, 0, 0);

                diagnosticRegionCount += diagnostics.length;

                isBlend = false;
            }
        }

        if (this.context.renderer.debug && diagnosticRegionCount > 0) {
            $.console.warn(`[flex-renderer] first-pass diagnostics: ${diagnosticRegionCount} invalid region(s)`);
        }

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);

        // blending by default ON
        if (!isBlend) {
            gl.enable(gl.BLEND);
        }

        gl.bindVertexArray(null);

        // This pass draws to two attachments and used to exit leaving both selected and
        // offScreenBuffer still bound. In a shared context the next drawer to run is then one
        // single-output fragment shader away from "Active draw buffers with missing fragment shader
        // outputs" through no fault of its own. Reset while offScreenBuffer is still bound --
        // drawBuffers applies to the currently bound framebuffer -- then hand back the default one.
        // Nothing reads the leftover binding: __firstPassResult carries textures, and every
        // consumer (SecondPassProgram.use, _createColorTarget, _clearColorTarget) binds its own.
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

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
        this._createOffscreenTexture("colorTextureA", width, height, dataLayerCount, this.gl.LINEAR,
            this.context.colorTargetInternalFormat);
        // this._createOffscreenTexture("colorTextureB", width, height, dataLayerCount, this.gl.LINEAR);

        // Coverage mask only (the shader writes vec4(1.0)/vec4(0.0)) — no precision needed, and
        // keeping it RGBA8 halves the memory added by a high-precision color target.
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

    _createOffscreenTexture(name, width, height, layerCount, filter, internalFormat = undefined) {
        const gl = this.gl;
        const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);

        layerCount = Math.max(layerCount, 1);

        let texRef = this[name];
        if (texRef) {
            gl.deleteTexture(texRef);
        }

        this[name] = texRef = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, texRef);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internalFormat || gl.RGBA8, width, height, layerCount);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.activeTexture(previousActiveTexture);
    }
};

})(OpenSeadragon);
