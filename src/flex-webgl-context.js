(function($) {
    /**
     * @interface OpenSeadragon.FlexRenderer.WebGLImplementation
     * Interface for the WebGL rendering implementation which can run on various GLSL versions.
     */
    $.FlexRenderer.WebGLImplementation = class {
        /**
         * Create a WebGL rendering implementation.
         * @param {FlexRenderer} renderer owner of this implementation
         * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
         * @param {String} webGLVersion "1.0" or "2.0"
         */
        constructor(renderer, gl, webGLVersion) {
            //todo renderer name is misleading, rename
            this.renderer = renderer;
            this.gl = gl;
            this.webGLVersion = webGLVersion;
        }

        /**
         * Static WebGLRenderingContext creation (to avoid class instantiation in case of missing support).
         * @param {HTMLCanvasElement} canvas
         * @param {string} webGLVersion
         * @param {Object} contextAttributes desired options used for the canvas webgl context creation
         * @return {WebGLRenderingContext|WebGL2RenderingContext}
         */
        static createWebglContext(canvas, webGLVersion, contextAttributes) {
            // indicates that the canvas contains an alpha buffer
            contextAttributes.alpha = true;
            // indicates that the page compositor will assume the drawing buffer contains colors with pre-multiplied alpha
            contextAttributes.premultipliedAlpha = true;
            contextAttributes.preserveDrawingBuffer = true;

            if (webGLVersion === "1.0") {
                return canvas.getContext('webgl', contextAttributes);
            } else {
                return canvas.getContext('webgl2', contextAttributes);
            }
        }

        get firstPassProgramKey() {
            throw("$.FlexRenderer.WebGLImplementation::firstPassProgram must be implemented!");
        }

        get secondPassProgramKey() {
            throw("$.FlexRenderer.WebGLImplementation::secondPassProgram must be implemented!");
        }

        /**
         * Init phase
         */
        init() {

        }

        /**
         * Attach shaders and link WebGLProgram, catch errors.
         * @param {WebGLProgram} program
         * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
         * @param {OpenSeadragon.FlexRenderer.WGLProgram} options build options
         * @param {function} onError
         * @param {boolean} debug
         * @return {boolean} true if program was built successfully
         */
        static _compileProgram(program, gl, options, onError, debug = false) {
            /* Napriklad gl.getProgramParameter(program, gl.LINK_STATUS) pre kind = "Program", status = "LINK", value = program */
            function ok(kind, status, value, sh) {
                if (!gl['get' + kind + 'Parameter'](value, gl[status + '_STATUS'])) {
                    $.console.error((sh || 'LINK') + ':\n' + gl['get' + kind + 'InfoLog'](value));
                    return false;
                }
                return true;
            }

            /* Attach shader to the WebGLProgram, return true if valid. */
            function useShader(gl, program, data, type) {
                let shader = gl.createShader(gl[type]);
                gl.shaderSource(shader, data);
                gl.compileShader(shader);
                gl.attachShader(program, shader);
                program[type] = shader;
                return ok('Shader', 'COMPILE', shader, type);
            }

            function numberLines(str) {
                // from https://stackoverflow.com/questions/49714971/how-to-add-line-numbers-to-beginning-of-each-line-in-string-in-javascript
                return str.split('\n').map((line, index) => `${index + 1} ${line}`).join('\n');
            }

            // Attaching shaders to WebGLProgram failed
            if (!useShader(gl, program, options.vertexShader, 'VERTEX_SHADER') ||
                !useShader(gl, program, options.fragmentShader, 'FRAGMENT_SHADER')) {
                onError("Unable to correctly build WebGL shaders.",
                    "Attaching of shaders to WebGLProgram failed. For more information, see logs in the $.console.");
                $.console.warn("VERTEX SHADER\n", numberLines( options.vertexShader ));
                $.console.warn("FRAGMENT SHADER\n", numberLines( options.fragmentShader ));
                return false;
            } else { // Shaders attached
                gl.linkProgram(program);
                if (!ok('Program', 'LINK', program)) {
                    onError("Unable to correctly build WebGL program.",
                        "Linking of WebGLProgram failed. For more information, see logs in the $.console.");
                    $.console.warn("VERTEX SHADER\n", numberLines( options.vertexShader ));
                    $.console.warn("FRAGMENT SHADER\n", numberLines( options.fragmentShader ));
                    return false;
                } else if (debug) {
                    $.console.info("VERTEX SHADER\n", numberLines( options.vertexShader ));
                    $.console.info("FRAGMENT SHADER\n", numberLines( options.fragmentShader ));
                }
                return true;
            }
        }

        /**
         * Get WebGL version of the implementation.
         * @return {String} "1.0" or "2.0"
         */
        getVersion() {
            return undefined;
        }

        sampleTexture() {
            throw("$.FlexRenderer.WebGLImplementation::sampleTexture() must be implemented!");
        }

        sampleTextureAtlas() {
            throw("$.FlexRenderer.WebGLImplementation::sampleTextureAtlas() must be implemented!");
        }

        getTextureSize() {
            throw("$.FlexRenderer.WebGLImplementation::getTextureSize() must be implemented!");
        }

        getShaderLayerGLSLIndex() {
            throw("$.FlexRenderer.WebGLImplementation::getShaderLayerGLSLIndex() must be implemented!");
        }

        createProgram() {
            throw("$.FlexRenderer.WebGLImplementation::createProgram() must be implemented!");
        }

        loadProgram() {
            throw("$.FlexRenderer.WebGLImplementation::loadProgram() must be implemented!");
        }

        useProgram() {
            throw("$.FlexRenderer.WebGLImplementation::useProgram() must be implemented!");
        }

        /**
         * Set viewport dimensions. Parent context already applied correct viewport settings to the
         * OpenGL engine. These values are already configured, but the webgl context can react to them.
         * @param {Number} x
         * @param {Number} y
         * @param {Number} width
         * @param {Number} height
         * @param {Number} levels number of layers that are rendered, kind of 'depth' parameter, an integer
         *
         * @instance
         * @memberof FlexRenderer
         */
        setDimensions(x, y, width, height, levels) {
            //no-op
        }

        destroy() {
        }

        /**
         * Get supported render modes by the renderer. First should be the default.
         * Keywords with *mask* are deprecated.
         * @return {string[]}
         */
        get supportedUseModes() {
            return ["show", "blend", "clip", "mask", "clip_mask"];
        }

        /**
         * Return sampling GLSL code (no function definition allowed) that implements blending passed by name
         * available are vec4 arguments 'fg' and 'bg'
         * e.g.:
         *   return vec4(fg.rgb * bg.a, fg.a);
         * @param {string} name one of OpenSeadragon.FlexRenderer.BLEND_MODE
         * @return {string}
         */
        getBlendingFunction(name) {
            throw("$.FlexRenderer.WebGLImplementation::blendingFunction must be implemented!");
        }
    };

    /**
     * @typedef {object} RenderOptions
     * @property {GLint|null} [framebuffer=null]
     *
     * todo: needs to differentiate first and second pass... might need to define interface for both individually
     */

    /**
     * WebGL Program instance
     * @class OpenSeadragon.FlexRenderer.WGLProgram
     */
    $.FlexRenderer.WGLProgram = class extends $.FlexRenderer.Program {

        /**
         *
         * @param context
         * @param gl {WebGLRenderingContext|WebGL2RenderingContext} Rendering program.
         * @param atlas {OpenSeadragon.FlexRenderer.TextureAtlas} Shared texture atlas.
         */
        constructor(context, gl, atlas) {
            super(context);
            /**
             *
             * @type {WebGLRenderingContext}
             */
            this.gl = gl;
            /**
             * @type {$.FlexRenderer.TextureAtlas}
             */
            this.atlas = atlas;
            this._webGLProgram = null;
            /**
             *
             * @type {string}
             */
            this.fragmentShader = "";
            /**
             *
             * @type {string}
             */
            this.vertexShader = "";
        }

        get webGLProgram() {
            if (!this._webGLProgram) {
                throw Error("Program accessed without registration - did you call this.renderer.registerProgram()?");
            }
            return this._webGLProgram;
        }

        /**
         *
         * @param shaderMap
         * @param shaderKeys
         */
        build(shaderMap, shaderKeys) {
        }

        /**
         * Create program.
         * @param width
         * @param height
         */
        created(width, height) {
        }

        /**
         * Retrieve program error message
         * @return {string|undefined} error message of the current state or undefined if OK
         */
        getValidateErrorMessage() {
            if (!this.vertexShader || !this.fragmentShader) {
                return "Program does not define vertexShader or fragmentShader shader property!";
            }
            return undefined;
        }

        /**
         * Load program. Arbitrary arguments.
         * Called ONCE per shader lifetime. Should not be called twice
         * unless requested by this.requireLoad=true call -- you should not set values
         * that are lost when webgl program is changed.
         */
        load() {
        }

        /**
         * Use program. Arbitrary arguments.
         * @param {RenderOutput} renderOutput the object passed between first and second pass
         * @param {FPRenderPackage[]|SPRenderPackage[]} renderArray
         * @param {RenderOptions|undefined} options used for now only for second pass, to specify which FBO to render to
         */
        use(renderOutput, renderArray, options) {
        }

        unload() {

        }

        /**
         * Destroy program. No arguments.
         */
        destroy() {
        }

// TODO we might want to fire only for active program and do others when really encesarry or with some delay, best at some common implementation level
        setDimensions(x, y, width, height, levels) {

        }

        /**
         * Iterate GLSL code
         */
        printN(fn, number, padding = "") {
            const output = new Array(number);
            for (let i = 0; i < number; i++) {
                output[i] = padding + fn(i);
            }
            return output.join('\n');
        }
    };

    /**
     * Texture atlas for WebGL. Shaders should be offered addImage(...) interface that returns atlas ID to
     * use in turn to access the desired image on-gpu.
     * @type {{gl: WebGL2RenderingContext, layerWidth: number|number, layerHeight: number|number, layers: number|number, padding: number|number, maxIds: number|number, internalFormat: number|0x8058, format: number|0x1908, type: number|0x1401, texture: null, new(WebGL2RenderingContext, {layerWidth?: number, layerHeight?: number, layers?: number, padding?: number, maxIds?: number, internalFormat?: number, format?: number, type?: number}=): $.FlexRenderer.TextureAtlas, prototype: TextureAtlas}}
     */
    $.FlexRenderer.TextureAtlas = class {
        /**
         * Construct the atlas, optionally using custom parameters. The atlas is
         * supposed to use layers (2d array or 3d texture) to allow growth once hitting
         * the max texture 2D dimension.
         * @param {WebGL2RenderingContext} gl
         * @param {{
         *   layerWidth?: number,
         *   layerHeight?: number,
         *   layers?: number,
         *   padding?: number,
         *   maxIds?: number,
         *   internalFormat?: number,
         *   format?: number,
         *   type?: number
         * }} [opts]
         */
        constructor(gl, opts) {
            this.gl = gl;

            this.layerWidth = (opts && opts.layerWidth) ? opts.layerWidth : 512;
            this.layerHeight = (opts && opts.layerHeight) ? opts.layerHeight : 512;
            this.layers = (opts && typeof opts.layers === 'number') ? opts.layers : 1;
            this.padding = (opts && typeof opts.padding === 'number') ? opts.padding : 1;
            this.maxIds = (opts && typeof opts.maxIds === 'number') ? opts.maxIds : 256;

            this.internalFormat = (opts && opts.internalFormat) ? opts.internalFormat : gl.RGBA8;
            this.format = (opts && opts.format) ? opts.format : gl.RGBA;
            this.type = (opts && opts.type) ? opts.type : gl.UNSIGNED_BYTE;

            this.texture = null;
        }

        /**
         * Add an image. Returns a stable textureId.
         * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|ImageData|Uint8Array} source
         * @param {{
         *   width?: number,
         *   height?: number,
         * }} [opts]
         * @returns {number}
         */
        addImage(source, opts) {
            throw new Error('TextureAtlas2DArray.addImage: not implemented');
        }

        /**
         * Texture atlas works as a single texture unit. Bind the atlas before using it at desired texture unit.
         * @param textureUnit
         */
        bind(textureUnit) {}

        /**
         * Get WebGL Atlas shader code. This code must define the following function:
         * vec4 osd_atlas_texture(int, vec2)
         * which selects texture ID (1st arg) and returns the color at the uv position (2nd arg)
         *
         * @return {string}
         */
        getFragmentShaderDefinition() {
            throw new Error('TextureAtlas2DArray.getFragmentShaderDefinition: not implemented');
        }

        /**
         * Load the current atlas uniform locations.
         * @param {WebGLProgram} program
         */
        load(program) {
        }

        /**
         * Destroy the atlas.
         */
        destroy() {
        }
    };

    $.FlexRenderer.WebGL10 = class extends $.FlexRenderer.WebGLImplementation {
        // todo implement support
    };

})(OpenSeadragon);
