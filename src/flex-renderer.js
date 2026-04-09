(function($) {
    /**
     * @typedef {Object} ShaderConfig
     * @property {String} shaderConfig.id
     * @property {String} shaderConfig.name
     * @property {String} shaderConfig.type         equal to ShaderLayer.type(), e.g. "identity"
     * @property {Number} shaderConfig.visible      1 = use for rendering, 0 = do not use for rendering
     * @property {Boolean} shaderConfig.fixed
     * @property {Object} shaderConfig.params          settings for the ShaderLayer
     * @property {OpenSeadragon.TiledImage[]|number[]} tiledImages images that provide the data
     * @property {Object} shaderConfig._controls       storage for the ShaderLayer's controls
     * @property {Object} shaderConfig.cache          cache object used by the ShaderLayer's controls
     */

    /**
     * @typedef {Object} FPRenderPackageItem
     * @property {WebGLTexture[]} texture           [TEXTURE_2D]
     * @property {Float32Array} textureCoords
     * @property {Float32Array} transformMatrix
     * //todo provide also opacity per tile?
     */

    /**
     * @typedef {Object} FPRenderPackage
     * @property {FPRenderPackageItem} tiles
     * @property {Number[][]} stencilPolygons
     */

    /**
     * @typedef {Object} SPRenderPackage
     * @property {Number} zoom
     * @property {Number} pixelsize
     * @property {Number} opacity
     * @property {ShaderLayer} shader
     * @property {Uint8Array|undefined} iccLut  TODO also support error rendering by passing some icon texture & rendering where nothing was rendered but should be (-> use mask, but how we force tiles to come to render if they are failed?  )
     */

    /**
     * @typedef HTMLControlsHandler
     * Function that attaches HTML controls for ShaderLayer's controls to DOM.
     * @type function
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer} [shaderLayer]
     * @param {ShaderConfig} [shaderConfig]
     * @returns {String}
     */

    /**
     * @typedef {Object} RenderOutput
     * @property {Number} textureDepth
     * @property {Number} stencilDepth
     */

    /**
     * WebGL Renderer for OpenSeadragon.
     *
     * Renders in two passes:
     *  1st pass joins tiles and creates masks where we should draw
     *  2nd pass draws the actual data using shaders
     *
     * @property {RegExp} idPattern
     * @property {Object} BLEND_MODE
     *
     * @class OpenSeadragon.FlexRenderer
     * @classdesc class that manages ShaderLayers, their controls, and WebGLContext to allow rendering using WebGL
     * @memberof OpenSeadragon
     */
    $.FlexRenderer = class extends $.EventSource {

        /**
         * @param {Object} incomingOptions
         *
         * @param {String} incomingOptions.uniqueId
         *
         * @param {String} incomingOptions.webGLPreferredVersion    prefered WebGL version, "1.0" or "2.0"
         *
         * @param {Function} incomingOptions.redrawCallback          function called when user input changed; triggers re-render of the viewport
         * @param {Function} incomingOptions.refetchCallback        function called when underlying data changed; triggers re-initialization of the whole WebGLDrawer
         * @param {Boolean} incomingOptions.debug                   debug mode on/off
         * @param {Boolean} incomingOptions.interactive             if true (default), the layers are configured for interactive changes (not applied by default)
         * @param {HTMLControlsHandler} incomingOptions.htmlHandler function that ensures individual ShaderLayer's controls' HTML is properly present at DOM
         * @param {function} incomingOptions.htmlReset              callback called when a program is reset - html needs to be cleaned
         * @param {string|undefined} incomingOptions.backgroundColor #RGB or #RGBA hex, default undefined - transparent
         *
         * @param {Object} incomingOptions.canvasOptions
         * @param {Boolean} incomingOptions.canvasOptions.alpha
         * @param {Boolean} incomingOptions.canvasOptions.premultipliedAlpha
         * @param {Boolean} incomingOptions.canvasOptions.stencil
         *
         *
         * @constructor
         * @memberof FlexRenderer
         */
        constructor(incomingOptions) {
            super();

            if (!this.constructor.idPattern.test(incomingOptions.uniqueId)) {
                throw new Error("$.FlexRenderer::constructor: invalid ID! Id can contain only letters, numbers and underscore. ID: " + incomingOptions.uniqueId);
            }
            this.uniqueId = incomingOptions.uniqueId;

            this.webGLPreferredVersion = incomingOptions.webGLPreferredVersion;

            this.redrawCallback = incomingOptions.redrawCallback;
            this.refetchCallback = incomingOptions.refetchCallback;
            this.debug = incomingOptions.debug;
            this.interactive = incomingOptions.interactive === undefined ?
                !!incomingOptions.htmlHandler : !!incomingOptions.interactive;
            this.htmlHandler = this.interactive ? incomingOptions.htmlHandler : null;
            this._background = incomingOptions.backgroundColor || '#00000000';

            if (this.htmlHandler) {
                if (!incomingOptions.htmlReset) {
                    throw Error("$.FlexRenderer::constructor: htmlReset callback is required when htmlHandler is set!");
                }
                this.htmlReset = incomingOptions.htmlReset;
            } else {
                this.htmlReset = () => {};
            }

            this.running = false;
            this._program = null;            // WebGLProgram
            this._shaders = {};
            this._shadersOrder = null;
            this._programImplementations = {};
            this.__firstPassResult = null;

            this.canvasContextOptions = incomingOptions.canvasOptions;
            const canvas = document.createElement("canvas");
            const WebGLImplementation = this.constructor.determineContext(this.webGLPreferredVersion);
            const webGLRenderingContext = $.FlexRenderer.WebGLImplementation.createWebglContext(canvas, this.webGLPreferredVersion, this.canvasContextOptions);
            if (webGLRenderingContext) {
                this.gl = webGLRenderingContext;                                            // WebGLRenderingContext|WebGL2RenderingContext
                this.webglContext = new WebGLImplementation(this, webGLRenderingContext);   // $.FlexRenderer.WebGLImplementation
                this.canvas = canvas;

                // Should be last call of the constructor to make sure everything is initialized
                this.webglContext.init();
            } else {
                throw new Error("$.FlexRenderer::constructor: Could not create WebGLRenderingContext!");
            }
        }

        /**
         * Search through all FlexRenderer properties to find one that extends WebGLImplementation and it's getVersion() method returns <version> input parameter.
         * @param {String} version WebGL version, "1.0" or "2.0"
         * @returns {WebGLImplementation}
         *
         * @instance
         * @memberof FlexRenderer
         */
        static determineContext(version) {
            const namespace = $.FlexRenderer;
            for (let property in namespace) {
                const context = namespace[ property ],
                    proto = context && context.prototype;
                if (proto && proto instanceof namespace.WebGLImplementation &&
                    $.isFunction( proto.getVersion ) && proto.getVersion.call( context ) === version) {
                        return context;
                }
            }

            throw new Error("$.FlexRenderer::determineContext: Could not find WebGLImplementation with version " + version);
        }

        /**
         * Get Currently used WebGL version
         * @return {String|*}
         */
        get webglVersion() {
            return this.webglContext.webGLVersion;
        }

        /**
         * Set viewport dimensions.
         * @param {Number} x
         * @param {Number} y
         * @param {Number} width
         * @param {Number} height
         * @param {Number} levels number of layers that are rendered, kind of 'depth' parameter, an integer
         *
         * @instance
         * @memberof FlexRenderer
         */
        setDimensions(x, y, width, height, levels, tiledImageCount) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(x, y, width, height);
            this.webglContext.setDimensions(x, y, width, height, levels, tiledImageCount);
        }

        /**
         * Set viewer background color, supports #RGBA or #RGB syntax. Note that setting the value
         * does not do anything until you recompile the shaders and should be done as early as possible,
         * at best using the constructor options.
         * @param (background)
         */
        setBackground(background) {
            this._background = background || '#00000000';
        }

        /**
         * Whether the FlexRenderer creates HTML elements in the DOM for ShaderLayers' controls.
         * @return {Boolean}
         *
         * @instance
         * @memberof FlexRenderer
         */
        supportsHtmlControls() {
            return typeof this.htmlHandler === "function";
        }

        /**
         * Call to first-pass draw using WebGLProgram.
         * @param {FPRenderPackage[]} source
         * @return {RenderOutput}
         * @instance
         * @memberof FlexRenderer
         */
        firstPassProcessData(source) {
            const program = this._programImplementations[this.webglContext.firstPassProgramKey];

            if (this.useProgram(program, "first-pass")) {
                program.load();
            }

            const result = program.use(this.__firstPassResult, source, undefined);

            if (this.debug) {
                this._showOffscreenMatrix(result, {scale: 0.5, pad: 8});
            }

            this.__firstPassResult = result;
            return result;
        }

        /**
         * Call to second-pass draw
         * @param {SPRenderPackage[]} renderArray
         * @param {RenderOptions|undefined} options
         * @return {RenderOutput}
         */
        secondPassProcessData(renderArray, options = undefined) {
            const program = this._programImplementations[this.webglContext.secondPassProgramKey];

            if (this.useProgram(program, "second-pass")) {
                program.load(renderArray);
            }

            return program.use(this.__firstPassResult, renderArray, options);
        }

        /**
         * Create and load the new WebGLProgram based on ShaderLayers and their controls.
         * @param {OpenSeadragon.FlexRenderer.Program} program
         * @param {String} [key] optional ID for the program to use
         * @return {String} ID for the program it was registered with
         *
         * @instance
         * @protected
         * @memberof FlexRenderer
         */
        registerProgram(program, key = undefined) {
            key = key || String(Date.now());

            if (!program) {
                program = this._programImplementations[key];
            }
            // TODO consider deleting only if succesfully compiled to avoid critical errors
            if (this._programImplementations[key]) {
                this.deleteProgram(key);
            }

            const webglProgram = this.gl.createProgram();
            program._webGLProgram = webglProgram;
            program._justCreated = true;

            // TODO inner control type udpates are not checked here
            for (let shaderId in this._shaders) {
                const shader = this._shaders[shaderId];
                const config = shader.getConfig();
                // Check explicitly type of the config, if updated, recreate shader
                if (shader.constructor.type() !== config.type) {
                    this.createShaderLayer(shaderId, config, false);
                }
            }
            // Needs reference early
            this._programImplementations[key] = program;
            this.webglContext.setBackground(this._background);

            program.build(this._shaders, this.getShaderLayerOrder());
            // Used also to re-compile, set requiresLoad to true
            program.requiresLoad = true;

            const errMsg = program.getValidateErrorMessage();
            if (errMsg) {
                this.gl.deleteProgram(webglProgram);
                program._webGLProgram = null;
                this._programImplementations[key] = null;
                throw new Error(errMsg);
            }

            if ($.FlexRenderer.WebGLImplementation._compileProgram(
                webglProgram, this.gl, program, $.console.error, this.debug
            )) {
                this.gl.useProgram(webglProgram);
                program.created(this.canvas.width, this.canvas.height);
                return key;
            }
            // else todo consider some cleanup
            return undefined;
        }

        /**
         * Switch program
         * @param {OpenSeadragon.FlexRenderer.Program|string} program instance or program key to use
         * @param {string} name "first-pass" or "second-pass"
         * @return {boolean} false if update is not necessary, true if update was necessary -- updates
         * are initialization steps taken once after program is first loaded (after compilation)
         * or when explicitly re-requested
         */
        useProgram(program, name) {
            if (!(program instanceof $.FlexRenderer.Program)) {
                program = this.getProgram(program);
            }

            if (this._program) {
                const reused = !program._justCreated;
                if (this.running && this._program === program && reused) {
                    return false;
                }
                if (reused) {
                    program._justCreated = false;
                }
                this._program.unload();
            }

            this._program = program;
            this.gl.useProgram(program.webGLProgram);

            const needsUpdate = this._program.requiresLoad;
            this._program.requiresLoad = false;
            if (needsUpdate) {
                /**
                 * todo better docs
                 * Fired after program has been switched to (initially or when changed).
                 * The event happens BEFORE JS logics executes within ShaderLayers.
                 * @event program-used
                 */
                this.raiseEvent('program-used', {
                    name: name,
                    program: program,
                    shaderLayers: this._shaders,
                });

                // initialize ShaderLayer's controls:
                //      - set their values to default,
                //      - if interactive register event handlers to their corresponding DOM elements created in the previous step

                //todo a bit dirty.. consider events / consider doing within webgl context
                if (name === "second-pass") {
                    // generate HTML elements for ShaderLayer's controls and put them into the DOM
                    if (this.htmlHandler) {
                        this.htmlReset();

                        for (const shaderId of this.getShaderLayerOrder()) {
                            const shaderLayer = this._shaders[shaderId];
                            const shaderConfig = shaderLayer.__shaderConfig;
                            this.htmlHandler(
                                shaderLayer,
                                shaderConfig
                            );
                        }

                        this.raiseEvent('html-controls-created', {
                            name: name,
                            program: program,
                            shaderLayers: this._shaders,
                        });
                    }

                    for (const shaderId in this._shaders) {
                        this._shaders[shaderId].init();
                    }
                }
            }

            if (!this.running) {
                this.running = true;
            }
            return needsUpdate;
        }

        /**
         *
         * @param {string} programKey
         * @return {OpenSeadragon.FlexRenderer.Program}
         */
        getProgram(programKey) {
            return this._programImplementations[programKey];
        }

        /**
         *
         * @param {string} key program key to delete
         */
        deleteProgram(key) {
            const implementation = this._programImplementations[key];
            if (!implementation) {
                return;
            }
            implementation.unload();
            implementation.destroy();
            this.gl.deleteProgram(implementation._webGLProgram);
            this.__firstPassResult = null;
            this._programImplementations[key] = null;
        }

        /**
         * Create and initialize new ShaderLayer instantion and its controls.
         * @param id
         * @param {ShaderConfig} shaderConfig object bound to a concrete ShaderLayer instance
         * @param {boolean} [copyConfig=false] if true, deep copy of the config is used to avoid modification of the parameter
         * @returns {ShaderLayer} instance of the created shaderLayer
         *
         * @instance
         * @memberof FlexRenderer
         */
        createShaderLayer(id, shaderConfig, copyConfig = false) {
            id = $.FlexRenderer.sanitizeKey(id);

            const Shader = $.FlexRenderer.ShaderMediator.getClass(shaderConfig.type);
            if (!Shader) {
                throw new Error(`$.FlexRenderer::createShaderLayer: Unknown shader type '${shaderConfig.type}'!`);
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
            if (copyConfig) {
                // Deep copy to avoid modification propagation
                shaderConfig = $.extend(true, defaultConfig, shaderConfig);
            } else {
                // Ensure we keep references where possible -> this will make shader object within drawers (e.g. navigator VS main)
                for (let propName in defaultConfig) {
                    if (shaderConfig[propName] === undefined) {
                        shaderConfig[propName] = defaultConfig[propName];
                    }
                }
            }

            if (this._shaders[id]) {
                this.removeShader(id);
            }

            // TODO a bit dirty approach, make the program key usable from outside
            const shader = new Shader(id, {
                shaderConfig: shaderConfig,
                webglContext: this.webglContext,
                params: shaderConfig.params,
                interactive: this.interactive,

                // callback to re-render the viewport
                invalidate: this.redrawCallback,
                // callback to rebuild the WebGL program
                rebuild: () => {
                    this.registerProgram(null, this.webglContext.secondPassProgramKey);
                },
                // callback to reinitialize the drawer; NOT USED
                refetch: this.refetchCallback
            });

            shader.construct();
            this._shaders[id] = shader;
            return shader;
        }

        getAllShaders() {
            return this._shaders;
        }

        getShaderLayer(id) {
            id = $.FlexRenderer.sanitizeKey(id);
            return this._shaders[id];
        }

        getShaderLayerConfig(id) {
            const shader = this.getShaderLayer(id);
            if (shader) {
                return shader.getConfig();
            }
            return undefined;
        }

        /**
         *
         * @param order
         */
        setShaderLayerOrder(order) {
            if (!order) {
                this._shadersOrder = null;
            }
            this._shadersOrder = order.map($.FlexRenderer.sanitizeKey);
        }

        /**
         *
         * Retrieve the order
         * @return {*}
         */
        getShaderLayerOrder() {
            return this._shadersOrder || Object.keys(this._shaders);
        }

        /**
         * Remove ShaderLayer instantion and its controls.
         * @param {string} id shader id
         *
         * @instance
         * @memberof FlexRenderer
         */
        removeShader(id) {
            id = $.FlexRenderer.sanitizeKey(id);
            const shader = this._shaders[id];
            if (!shader) {
                return;
            }
            shader.destroy();
            delete this._shaders[id];
        }

        /**
         * Clear all shaders
         */
        deleteShaders() {
            for (let sId in this._shaders) {
                this.removeShader(sId);
            }
        }

        /**
         * @param {Boolean} enabled if true enable alpha blending, otherwise disable blending
         *
         * @instance
         * @memberof FlexRenderer
         */
        setDataBlendingEnabled(enabled) {
            if (enabled) {
                this.gl.enable(this.gl.BLEND);

                // standard alpha blending
                this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            } else {
                this.gl.disable(this.gl.BLEND);
            }
        }

        /**
         * Build a stable JSON-safe snapshot of the current visualization state.
         * Includes shader order and full shader configs, including params and cache.
         * Runtime/private fields are filtered out using FlexRenderer.jsonReplacer.
         *
         * @returns {{
         *   order: string[],
         *   shaders: Object<string, ShaderConfig>
         * }}
         */
        getVisualizationSnapshot() {
            const snapshot = {
                order: this.getShaderLayerOrder().slice(),
                shaders: {}
            };

            for (const [shaderId, shader] of Object.entries(this.getAllShaders())) {
                snapshot.shaders[shaderId] = JSON.parse(
                    JSON.stringify(shader.getConfig(), $.FlexRenderer.jsonReplacer)
                );
            }

            return snapshot;
        }

        /**
         * Alias that makes intent explicit when used by application code.
         * @returns {{order: string[], shaders: Object<string, ShaderConfig>}}
         */
        exportVisualization() {
            return this.getVisualizationSnapshot();
        }

        /**
         * Notify observers that visualization state changed.
         * This is the canonical event to listen to.
         *
         * @param {object} payload
         */
        notifyVisualizationChanged(payload = {}) {
            this.raiseEvent('visualization-change', $.extend(true, {
                snapshot: this.getVisualizationSnapshot()
            }, payload));
        }

        destroy() {
            this.htmlReset();
            this.deleteShaders();
            for (let pId in this._programImplementations) {
                this.deleteProgram(pId);
            }
            this.webglContext.destroy();
            this._programImplementations = {};
        }

        static sanitizeKey(key) {
            if (!$.FlexRenderer.idPattern.test(key)) {
                key = key.replace(/[^0-9a-zA-Z_]/g, '');
                key = key.replace(/_+/g, '_');
                key = key.replace(/^_+/, '');

                if (!key) {
                    throw new Error("Invalid key: sanitization removed all parts!");
                }
            }
            return key;
        }

        static _buildSelfTestColorData(width, height, rgba) {
            const out = new Uint8Array(width * height * 4);
            for (let i = 0; i < width * height; i++) {
                const offset = i * 4;
                out[offset] = rgba[0];
                out[offset + 1] = rgba[1];
                out[offset + 2] = rgba[2];
                out[offset + 3] = rgba[3];
            }
            return out;
        }

        static _createSelfTestTextureArray(gl, width, height, depth, pixels, internalFormat = null) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internalFormat || gl.RGBA8, width, height, depth);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, width, height, depth, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
            return texture;
        }

        static runSelfTest({
            width = 2,
            height = 2,
            tolerance = 8,
            webGLPreferredVersion = "2.0",
            debug = false,
        } = {}) {
            let renderer = null;
            let colorTexture = null;
            let stencilTexture = null;
            const testedAt = Date.now();
            const expected = [67, 255, 100, 255];

            try {
                // TODO! instantiated test could be later used to run rendering itself, i.e. drawer.supports() consumes the instance
                renderer = new $.FlexRenderer({
                    uniqueId: "selftest_renderer",
                    webGLPreferredVersion,
                    redrawCallback: () => {},
                    refetchCallback: () => {},
                    debug: !!debug,
                    interactive: false,
                    backgroundColor: '#00000000',
                    canvasOptions: {
                        stencil: true
                    }
                });

                const shaderId = 'selftest_layer';
                renderer.createShaderLayer(shaderId, {
                    id: shaderId,
                    name: 'Self test',
                    type: 'identity',
                    visible: 1,
                    fixed: false,
                    tiledImages: [0],
                    params: {},
                    cache: {}
                }, true);
                renderer.setShaderLayerOrder([shaderId]);
                renderer.setDimensions(0, 0, width, height, 1, 1);
                renderer.registerProgram(null, renderer.webglContext.secondPassProgramKey);

                const gl = renderer.gl;
                const colorPixels = $.FlexRenderer._buildSelfTestColorData(width, height, expected);
                const stencilPixels = $.FlexRenderer._buildSelfTestColorData(width, height, [255, 0, 0, 255]);
                colorTexture = $.FlexRenderer._createSelfTestTextureArray(gl, width, height, 1, colorPixels);
                stencilTexture = $.FlexRenderer._createSelfTestTextureArray(gl, width, height, 1, stencilPixels);

                renderer.__firstPassResult = {
                    texture: colorTexture,
                    stencil: stencilTexture,
                    textureDepth: 1,
                    stencilDepth: 1,
                };

                renderer.secondPassProcessData([{
                    zoom: 1,
                    pixelSize: 1,
                    opacity: 1,
                    shader: renderer.getShaderLayer(shaderId),
                }]);
                gl.finish();
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                const pixels = new Uint8Array(width * height * 4);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                for (let i = 0; i < width * height; i++) {
                    const offset = i * 4;
                    for (let c = 0; c < 4; c++) {
                        if (Math.abs(pixels[offset + c] - expected[c]) > tolerance) {
                            throw new Error(
                                `Renderer self-test pixel mismatch at index ${i}: expected [${expected.join(', ')}], got [${Array.from(pixels.slice(offset, offset + 4)).join(', ')}].`
                            );
                        }
                    }
                }

                return {
                    ok: true,
                    testedAt,
                    width,
                    height,
                    tolerance,
                    webGLPreferredVersion,
                    webglVersion: renderer.webglVersion,
                };
            } catch (error) {
                return {
                    ok: false,
                    testedAt,
                    width,
                    height,
                    tolerance,
                    webGLPreferredVersion,
                    error: error && error.message ? error.message : String(error),
                };
            } finally {
                if (renderer && renderer.gl) {
                    const gl = renderer.gl;
                    if (colorTexture) {
                        gl.deleteTexture(colorTexture);
                    }
                    if (stencilTexture) {
                        gl.deleteTexture(stencilTexture);
                    }
                }
                if (renderer) {
                    try {
                        renderer.destroy();
                    } catch (e) {
                        $.console.warn('FlexRenderer self-test cleanup failed.', e);
                    }
                }
            }
        }

        static ensureRuntimeSupport(options = {}) {
            const useCache = options.force !== true;
            if (useCache && $.FlexRenderer.__runtimeSupportCache) {
                const cached = $.FlexRenderer.__runtimeSupportCache;
                if (!cached.ok && options.throwOnFailure !== false) {
                    throw new Error(cached.error || 'FlexRenderer runtime support test failed.');
                }
                return cached;
            }

            const result = $.FlexRenderer.runSelfTest(options);
            $.FlexRenderer.__runtimeSupportCache = result;
            if (!result.ok && options.throwOnFailure !== false) {
                throw new Error(result.error || 'FlexRenderer runtime support test failed.');
            }
            return result;
        }

        // Todo below are debug and other utilities hardcoded for WebGL2. In case of other engines support, these methods
        //  must be adjusted or moved to appropriate interfaces

        /**
         * Convenience: copy your RenderOutput {texture, stencil} to desination.
         * Returns { texture: WebGLTexture, stencil: WebGLTexture } in the destination context.
         *
         * @param {OpenSeadragon.FlexRenderer} dst
         * @param {RenderOutput} [renderOutput]  first pass output to copy, defaults to latest internal state
         * @param {Object} [opts]  options
         * @return {RenderOutput}
         */
        copyRenderOutputToContext(
            dst,
            renderOutput = undefined,
            {
                level = 0,
                format = null,
                type = null,
                internalFormatGuess = null,
            } = {}
        ) {
            renderOutput = renderOutput || this.__firstPassResult;
            const out = {};
            if (!renderOutput) {
                dst.__firstPassResult = out;
                return out;
            }

            const sameContext = dst.gl === this.gl;

            if (renderOutput.texture) {
                // Reuse existing dst texture only if we know it's from the same context.
                const prevDstTex =
                    sameContext && dst.__firstPassResult && dst.__firstPassResult.texture ?
                        dst.__firstPassResult.texture : null;

                out.texture = this._copyTexture2DArrayBetweenContexts({
                    srcGL: this.gl,
                    dstGL: dst.gl,
                    srcTex: renderOutput.texture,
                    dstTex: prevDstTex,
                    textureLayerCount: renderOutput.textureDepth,
                    level,
                    format,
                    type,
                    internalFormatGuess,
                });
            }

            if (renderOutput.stencil) {
                const prevDstStencil =
                    sameContext && dst.__firstPassResult && dst.__firstPassResult.stencil ?
                        dst.__firstPassResult.stencil : null;

                out.stencil = this._copyTexture2DArrayBetweenContexts({
                    srcGL: this.gl,
                    dstGL: dst.gl,
                    srcTex: renderOutput.stencil,
                    dstTex: prevDstStencil,
                    textureLayerCount: renderOutput.stencilDepth,
                    level,
                    format,
                    type,
                    internalFormatGuess,
                });
            }

            out.textureDepth = renderOutput.textureDepth || 0;
            out.stencilDepth = renderOutput.stencilDepth || 0;
            dst.__firstPassResult = out;
            return out;
        }

        /**
         * Copy a TEXTURE_2D_ARRAY from one WebGL2 context to another.
         *
         * - If srcGL === dstGL: GPU-only copy via framebuffer + copyTexSubImage3D.
         * - If srcGL !== dstGL: readPixels -> texSubImage3D CPU round-trip.
         *
         * Creates the destination texture if not provided.
         *
         * @param {Object} opts
         * @param {WebGL2RenderingContext} opts.srcGL
         * @param {WebGL2RenderingContext} opts.dstGL
         * @param {WebGLTexture} opts.srcTex           - source TEXTURE_2D_ARRAY
         * @param {WebGLTexture?} [opts.dstTex]        - destination TEXTURE_2D_ARRAY (created if omitted)
         * @param {number} opts.textureLayerCount      - number of array layers
         * @param {number} [opts.level=0]              - mip level to copy
         * @param {number} [opts.width]                - texture width; falls back to canvas/drawingBuffer if omitted
         * @param {number} [opts.height]               - texture height; falls back to canvas/drawingBuffer if omitted
         * @param {GLenum} [opts.format=srcGL.RGBA]    - pixel format for read/upload
         * @param {GLenum} [opts.type=srcGL.UNSIGNED_BYTE]  - pixel type for read/upload
         * @param {GLenum} [opts.internalFormatGuess]  - sized internal format for dst allocation
         * @returns {WebGLTexture} dstTex
         */
        _copyTexture2DArrayBetweenContexts({
                                               srcGL,
                                               dstGL,
                                               srcTex,
                                               dstTex = null,
                                               textureLayerCount,
                                               level = 0,
                                               width = null,
                                               height = null,
                                               format = null,
                                               type = null,
                                               internalFormatGuess = null,
                                           }) {
            // Feature-detect WebGL2 instead of relying on instanceof
            const isGL2 = srcGL && typeof srcGL.texStorage3D === "function";
            const isDstGL2 = dstGL && typeof dstGL.texStorage3D === "function";
            if (!isGL2 || !isDstGL2) {
                throw new Error("WebGL2 contexts required (texture arrays + tex(Sub)Image3D).");
            }

            const sameContext = srcGL === dstGL;

            // ---------- Determine texture dimensions ----------
            srcGL.bindTexture(srcGL.TEXTURE_2D_ARRAY, srcTex);

            if (format === null) {
                format = srcGL.RGBA;
            }
            if (type === null) {
                type = srcGL.UNSIGNED_BYTE;
            }

            // Use provided width/height, or fall back to drawingBuffer/canvas
            if (!width || !height) {
                // try drawingBufferSize first (more correct for FBOs)
                width =
                    width ||
                    srcGL.drawingBufferWidth ||
                    (this.canvas && this.canvas.width) ||
                    0;
                height =
                    height ||
                    srcGL.drawingBufferHeight ||
                    (this.canvas && this.canvas.height) ||
                    0;
            }

            const depth = textureLayerCount | 0;

            if (!width || !height || !depth) {
                throw new Error(
                    "Source texture has no width/height/layers (missing width/height/textureLayerCount)."
                );
            }

            // ---------- Create + allocate destination texture if needed ----------
            if (!dstTex) {
                dstTex = dstGL.createTexture();
            }
            dstGL.bindTexture(dstGL.TEXTURE_2D_ARRAY, dstTex);

            if (!internalFormatGuess) {
                if (type === srcGL.FLOAT) {
                    internalFormatGuess = dstGL.RGBA32F; // requires appropriate extensions
                } else {
                    internalFormatGuess = dstGL.RGBA8;
                }
            }

            dstGL.texParameteri(dstGL.TEXTURE_2D_ARRAY, dstGL.TEXTURE_MIN_FILTER, dstGL.NEAREST);
            dstGL.texParameteri(dstGL.TEXTURE_2D_ARRAY, dstGL.TEXTURE_MAG_FILTER, dstGL.NEAREST);
            dstGL.texParameteri(dstGL.TEXTURE_2D_ARRAY, dstGL.TEXTURE_WRAP_S, dstGL.CLAMP_TO_EDGE);
            dstGL.texParameteri(dstGL.TEXTURE_2D_ARRAY, dstGL.TEXTURE_WRAP_T, dstGL.CLAMP_TO_EDGE);

            dstGL.texStorage3D(
                dstGL.TEXTURE_2D_ARRAY,
                1, // levels
                internalFormatGuess,
                width,
                height,
                depth
            );

            // ---------- Copy per-layer ----------
            const fb = srcGL.createFramebuffer();
            srcGL.bindFramebuffer(srcGL.FRAMEBUFFER, fb);

            if (sameContext) {
                // GPU-only path
                for (let z = 0; z < depth; z++) {
                    srcGL.framebufferTextureLayer(
                        srcGL.FRAMEBUFFER,
                        srcGL.COLOR_ATTACHMENT0,
                        srcTex,
                        level,
                        z
                    );
                    const status = srcGL.checkFramebufferStatus(srcGL.FRAMEBUFFER);
                    if (status !== srcGL.FRAMEBUFFER_COMPLETE) {
                        srcGL.bindFramebuffer(srcGL.FRAMEBUFFER, null);
                        srcGL.deleteFramebuffer(fb);
                        throw new Error(
                            `Framebuffer incomplete for source layer ${z}: 0x${status.toString(16)}`
                        );
                    }

                    srcGL.copyTexSubImage3D(
                        srcGL.TEXTURE_2D_ARRAY,
                        level,
                        0, 0, z,    // dst x,y,z
                        0, 0,       // src x,y
                        width,
                        height
                    );
                }
            } else {
                // Cross-context path: CPU readPixels -> texSubImage3D
                const bytesPerChannel = type === srcGL.FLOAT ? 4 : 1;
                const layerByteLen = width * height * 4 * bytesPerChannel;
                const layerBuf =
                    type === srcGL.FLOAT ?
                        new Float32Array(layerByteLen / 4) : new Uint8Array(layerByteLen);

                for (let z = 0; z < depth; z++) {
                    srcGL.framebufferTextureLayer(
                        srcGL.FRAMEBUFFER,
                        srcGL.COLOR_ATTACHMENT0,
                        srcTex,
                        level,
                        z
                    );
                    const status = srcGL.checkFramebufferStatus(srcGL.FRAMEBUFFER);
                    if (status !== srcGL.FRAMEBUFFER_COMPLETE) {
                        srcGL.bindFramebuffer(srcGL.FRAMEBUFFER, null);
                        srcGL.deleteFramebuffer(fb);
                        throw new Error(
                            `Framebuffer incomplete for source layer ${z}: 0x${status.toString(16)}`
                        );
                    }

                    srcGL.readPixels(0, 0, width, height, format, type, layerBuf);
                    dstGL.texSubImage3D(
                        dstGL.TEXTURE_2D_ARRAY,
                        level,
                        0, 0, z,
                        width,
                        height,
                        1,
                        format,
                        type,
                        layerBuf
                    );
                }
            }

            srcGL.bindFramebuffer(srcGL.FRAMEBUFFER, null);
            srcGL.deleteFramebuffer(fb);

            return dstTex;
        }

        _showOffscreenMatrix(renderOutput, {
            scale = 1,
            pad = 8,
            drawLabels = true,
            background = '#111'
        } = {}) {
            const colorLayers = renderOutput.textureDepth;
            const stencilLayers = renderOutput.stencilDepth;

            const cols = 2;
            const rows = colorLayers;
            const width = Math.floor(this.canvas.width);
            const height = Math.floor(this.canvas.height);
            const cellW = Math.floor(width * scale);
            const cellH = Math.floor(height * scale);
            const totalW = pad + cols * (cellW + pad);
            const totalH = pad + rows * (cellH + pad) + (drawLabels ? 18 : 0);

            const dbg = this._openDebugWindowFromUserGesture(totalW, totalH, 'Offscreen Layers (Texture | Stencil)');
            if (!dbg) {
                console.warn('Could not open debug window');
                return;
            }

            const gl = this.gl;
            const isGL2 = (gl instanceof WebGL2RenderingContext) || this.webGLVersion === "2.0";

            const ctx = dbg.__debugCtx;
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, totalW, totalH);
            ctx.imageSmoothingEnabled = false;

            // Optional headers
            if (drawLabels) {
                ctx.fillStyle = '#ddd';
                ctx.font = '12px system-ui';
                ctx.textBaseline = 'top';
                const yLbl = 2;
                const x0 = pad;
                const x1 = pad + (cellW + pad);
                ctx.fillText('Texture', x0, yLbl);
                ctx.fillText('Stencil', x1, yLbl);
            }

            // Prepare a tiny staging canvas so we can draw the pixels into 2D easily
            // and then scale when drawing to the popup.
            if (!this._debugStage) {
                this._debugStage = document.createElement('canvas');
            }
            const stage = this._debugStage;
            stage.width = width;
            stage.height = height;
            const stageCtx = stage.getContext('2d', { willReadFrequently: true });

            // One reusable buffer & ImageData to avoid reallocation per tile
            let pixels = this._readbackBuffer;
            if (!pixels || pixels.length !== width * height * 4) {
                pixels = this._readbackBuffer = new Uint8ClampedArray(width * height * 4);
            }
            if (!this._imageData || this._imageData.width !== width || this._imageData.height !== height) {
                this._imageData = new ImageData(width, height);
            }
            const imageData = this._imageData;

            // Ensure we have a framebuffer to attach sources to
            if (!this._extractionFB) {
                this._extractionFB = gl.createFramebuffer();
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._extractionFB);

            // Small helpers to attach a layer/texture
            const attachLayer = (texArray, layerIndex) => {
                // WebGL2 texture array
                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texArray, 0, layerIndex);
            };

            // Iterate rows: each row = {texture i, stencil i}
            for (let i = 0; i < colorLayers; i++) {
                // ---- texture ----
                if (isGL2 && renderOutput.texture /* texture array */) {
                    attachLayer(renderOutput.texture, i);
                } else {
                    console.error('No valid texture binding for "texture" at index', i);
                    continue;
                }

                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    console.error('Framebuffer incomplete for texture layer', i);
                    continue;
                }
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                imageData.data.set(pixels);
                stageCtx.putImageData(imageData, 0, 0);
                const colTex = 0;
                const xTex = pad + colTex * (cellW + pad);
                const yBase = (drawLabels ? 18 : 0);
                const yRow = yBase + pad + i * (cellH + pad);
                ctx.drawImage(stage, 0, 0, width, height, xTex, yRow, cellW, cellH);

                // ---- stencil ----
                if (isGL2 && renderOutput.stencil /* texture array */ && stencilLayers > 0) {
                    const stencilLayer = Math.min(i, stencilLayers - 1);
                    attachLayer(renderOutput.stencil, stencilLayer);
                } else {
                    console.error('No valid texture binding for "stencil" at index', i);
                    continue;
                }

                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    console.error('Framebuffer incomplete for stencil layer', i);
                    continue;
                }
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                imageData.data.set(pixels);
                stageCtx.putImageData(imageData, 0, 0);
                const colSt = 1;
                const xSt = pad + colSt * (cellW + pad);
                ctx.drawImage(stage, 0, 0, width, height, xSt, yRow, cellW, cellH);

                // optional row label
                if (drawLabels) {
                    ctx.fillStyle = '#aaa';
                    ctx.font = '12px system-ui';
                    ctx.textBaseline = 'top';
                    ctx.fillText(`#${i}`, pad, yRow - 14);
                }
            }

            // tidy
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        _openDebugWindowFromUserGesture(width, height, title = 'Debug Output') {
            const debug = this.__debugWindow;
            if (debug && !debug.closed) {
                return this.__debugWindow;
            }

            const features = `width=${width},height=${height}`;
            let w = window.open('', 'osd-debug-grid', features);
            if (!w) {
                // Popup blocked even within gesture (some environments)
                // Create a visible fallback button that opens it on another gesture.
                const fallback = document.createElement('button');
                fallback.textContent = 'Open debug window';
                fallback.style.cssText = 'position:fixed;top: 50;left:50;inset:auto 12px 12px auto;z-index:99999';
                fallback.onclick = () => {
                    const w2 = window.open('', 'osd-debug-grid', features);
                    if (w2) {
                        this._initDebugWindow(w2, title, width, height);
                        fallback.remove();
                    } else {
                        // If it still fails, there’s nothing we can do without the user changing settings
                        alert('Please allow pop-ups for this site and click the button again.');
                    }
                };
                document.body.appendChild(fallback);
                return null;
            }

            this._initDebugWindow(w, title, width, height);
            this.__debugWindow = w;
            return w;
        }

        _initDebugWindow(w, title, width, height) {
            if (w.__debugCtx) {
                return;
            }

            w.document.title = title;
            const style = w.document.createElement('style');
            style.textContent = `
    html,body{margin:0;background:#111;color:#ddd;font:12px/1.4 system-ui}
    .head{position:fixed;inset:0 0 auto 0;background:#222;padding:6px 10px}
    canvas{display:block;margin-top:28px}
  `;
            w.document.head.appendChild(style);

            const head = w.document.createElement('div');
            head.className = 'head';
            head.textContent = title;
            w.document.body.appendChild(head);

            const cnv = w.document.createElement('canvas');
            cnv.width = width;
            cnv.height = height;
            w.document.body.appendChild(cnv);
            w.__debugCtx = cnv.getContext('2d');
        }
    };


    // STATIC PROPERTIES
    /**
     * ID pattern allowed for FlexRenderer. ID's are used in GLSL to distinguish uniquely between individual ShaderLayer's generated code parts
     * @property
     * @type {RegExp}
     * @memberof FlexRenderer
     */
    $.FlexRenderer.idPattern = /^(?!_)(?:(?!__)[0-9a-zA-Z_])*$/;
    $.FlexRenderer.__runtimeSupportCache = null;

    $.FlexRenderer.BLEND_MODE = [
        'mask',
        'source-over',
        'source-in',
        'source-out',
        'source-atop',
        'destination-over',
        'destination-in',
        'destination-out',
        'destination-atop',
        'lighten',
        'darken',
        'copy',
        'xor',
        'multiply',
        'screen',
        'overlay',
        'color-dodge',
        'color-burn',
        'hard-light',
        'soft-light',
        'difference',
        'exclusion',
        'hue',
        'saturation',
        'color',
        'luminosity',
    ];

    $.FlexRenderer.jsonReplacer = function (key, value) {
        return key.startsWith("_") || ["eventSource"].includes(key) ? undefined : value;
    };

    /**
     * Generic computational program interface
     * @type {{new(*): $.FlexRenderer.Program, context: *, _requiresLoad: boolean, prototype: Program}}
     */
    $.FlexRenderer.Program = class {
        constructor(context) {
            this.context = context;
            this._requiresLoad = true;
        }

        /**
         *
         * @param shaderMap
         * @param shaderKeys
         */
        build(shaderMap, shaderKeys) {
            throw new Error("$.FlexRenderer.Program::build: Not implemented!");
        }

        /**
         * Retrieve program error message
         * @return {string|undefined} error message of the current state or undefined if OK
         */
        getValidateErrorMessage() {
            return undefined;
        }

        /**
         * Set whether the program requires load.
         * @type {boolean}
         */
        set requiresLoad(value) {
            if (this._requiresLoad !== value) {
                this._requiresLoad = value;

                // Consider this event..
                // if (value) {
                //     this.context.raiseEvent('program-requires-load', {
                //         program: this,
                //         requiresLoad: value
                //     });
                // }
            }
        }

        /**
         * Whether the program requires load.
         * @return {boolean}
         */
        get requiresLoad() {
            return this._requiresLoad;
        }

        /**
         * Create program.
         * @param width
         * @param height
         */
        created(width, height) {}

        /**
         * Load program. Arbitrary arguments.
         * Called ONCE per shader lifetime. Should not be called twice
         * unless requested by requireLoad() -- you should not set values
         * that are lost when webgl program is changed.
         */
        load() {}

        /**
         * Use program. Arbitrary arguments.
         */
        use() {}

        /**
         * Unload program. No arguments.
         */
        unload() {}

        /**
         * Destroy program. No arguments.
         */
        destroy() {}
    };

    /**
     * Blank layer that takes almost no memory and current renderer skips it.
     * @type {OpenSeadragon.BlankTileSource}
     */
    $.BlankTileSource = class extends $.TileSource {
        supports(data, url) {
            return (data && data.type === "_blank") || (url && url.type === "_blank");
        }
        configure(options, dataUrl, postData) {
            return $.extend(options, {
                width: 512,
                height: 512,
                _tileWidth: 512,
                _tileHeight: 512,
                tileSize: 512,
                tileOverlap: 0,
                minLevel: 0,
                maxLevel: 0,
                dimensions: new $.Point(512, 512),
            });
        }
        downloadTileStart(context) {
            return context.finish("_blank", undefined, "undefined");
        }
        getMetadata() {
            return this;
        }
        getTileUrl(level, x, y) {
            return "_blank";
        }
    };

})(OpenSeadragon);
