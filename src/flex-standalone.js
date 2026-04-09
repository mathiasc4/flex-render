(function($) {

    $.makeStandaloneFlexDrawer = function(viewer) {
        const Drawer = OpenSeadragon.FlexDrawer;

        const options = $.extend(true, {}, viewer.drawerOptions[Drawer.prototype.getType()]);
        options.debug = false;
        options.htmlReset = undefined;
        options.htmlHandler = undefined;
        // avoid modification on navigator
        options.handleNavigator = false;
        options.offScreen = true;

        const drawer = new Drawer({
            viewer:             viewer,
            viewport:           viewer.viewport,
            element:            viewer.drawer.container,
            debugGridColor:     viewer.debugGridColor,
            options:            options
        });

        let locked = false;
        const waiters = [];
        const lock = async() => {
            if (!locked) {
                locked = true;
                return;
            }
            await new $.Promise(resolve => waiters.push(resolve));
        };
        const unlock = () => {
            const next = waiters.shift();
            if (next) {
                next();
            } else {
                locked = false;
            }
        };

        /**
         * Draws the viewer with the given configuration.
         * @param {Array<OpenSeadragon.TiledImage>} tiledImages
         * @param {Object.<string, ShaderConfig>} [configuration]
         * @param {object|OpenSeadragon.FlexDrawer} [view] draw desired viewport (full pass) or re-use last frame
         *    - The viewport to draw, see {@link OpenSeadragon.FlexDrawer#draw}
         *    - Or, the reference to the drawer to draw the same viewport as the previous one. By default, the
         *      reference to the standalone drawer is used - which is probably not desired!
         * @param {OpenSeadragon.Point|{x:number,y:number}} [size] - The size of the viewer. Inherited from viewOrReference if not provided,
         *      required if viewport description is provided to the viewOrReference argument.
         * @returns {Promise<CanvasRenderingContext2D>}
         */
        drawer.drawWithConfiguration = (async function (tiledImages, configuration = undefined, view = undefined, size = undefined) {
            let tiles;
            let tasks;

            let fullDrawPass = true;
            if (!view || view instanceof OpenSeadragon.FlexDrawer) {
                fullDrawPass = false;
                if (!view) {
                    view = viewer.drawer;
                }

                if (!size) {
                    size = {x: view.canvas.width, y: view.canvas.height};
                }
            } else if (!size) {
                size = {x: drawer.canvas.width, y: drawer.canvas.height};
                $.console.warn('size is required when drawing a viewport!');
            }

            if (fullDrawPass) {
                tiles = tiledImages.map(ti => ti.getTilesToDraw()).flat();
                tasks = tiles.map(t => t.tile.getCache().prepareForRendering(drawer));
            }

            await lock();
            try {
                if (configuration) {
                    await drawer.overrideConfigureAll(configuration);
                }

                // todo: tiledImages.length is not reliable! we can have TI that produces more layers in the color part!

                if (fullDrawPass) {
                    return Promise.all(tasks).then(() => {
                        // Sum of packs across all TIs:
                        const colorLayers = drawer._computeOffscreenLayerCount();
                        const stencilLayers = tiledImages.length;

                        this.renderer.setDimensions(0, 0, size.x, size.y, colorLayers, stencilLayers);
                        this.draw(tiledImages, view);

                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = size.x;
                        canvas.height = size.y;
                        ctx.drawImage(this.renderer.canvas, 0, 0);
                        return ctx;
                    }).catch(e => {
                        console.error(e);
                        throw e;
                    }).finally(() => {
                        // free data
                        const dId = drawer.getId();
                        tiles.forEach(t => t.tile.getCache().destroyInternalCache(dId));
                    });
                }

                let colorLayers   = tiledImages.length;
                let stencilLayers = tiledImages.length;

                if (view.renderer.__firstPassResult) {
                    const srcFP = view.renderer.__firstPassResult;
                    if (typeof srcFP.textureDepth === "number") {
                        colorLayers = srcFP.textureDepth;
                    }
                    if (typeof srcFP.stencilDepth === "number") {
                        stencilLayers = srcFP.stencilDepth;
                    }
                }

                // Steal FP initialized textures if we differ in reference (different webgl context) or we have no state
                if (view !== drawer || !this.renderer.__firstPassResult) {
                    // todo dirty, hide the __firstPassResult structure within the program logics
                    const program = view.renderer.getProgram('firstPass');
                    colorLayers = drawer._computeOffscreenLayerCount();
                    this.renderer.__firstPassResult = {
                        texture: program.colorTextureA,
                        stencil: program.stencilTextureA,
                        textureDepth: colorLayers,
                        stencilDepth: stencilLayers,
                    };
                }

                this.renderer.setDimensions(0, 0, size.x, size.y, colorLayers, stencilLayers);

                // Instead of re-rendering, we steal last state of the renderer and re-render second pass only.
                view.renderer.copyRenderOutputToContext(this.renderer);
                // ! must be called after copy, otherwise we would access wrong context
                if (this.debug) {
                    const fp = this.renderer.__firstPassResult;
                    this.renderer._showOffscreenMatrix(fp, {scale: 0.5, pad: 8});
                }

                this._drawTwoPassSecond({
                    zoom: this.viewport.getZoom(true)
                });

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = size.x;
                canvas.height = size.y;
                ctx.drawImage(this.renderer.canvas, 0, 0);
                return ctx;
            } finally {
                unlock();
            }
        }).bind(drawer);

        // ---------------------------------------------------------------------
        // Extraction API
        // ---------------------------------------------------------------------

        drawer._extractScratch = {
            canvas: null,
            ctx: null,
            framebuffer: null,
            imageData: null,
            u8: null,
        };

        drawer._ensureExtract2D = function(width, height) {
            const scratch = this._extractScratch;
            if (!scratch.canvas) {
                scratch.canvas = document.createElement('canvas');
                scratch.ctx = scratch.canvas.getContext('2d', { willReadFrequently: true });
            }
            if (scratch.canvas.width !== width) {
                scratch.canvas.width = width;
            }
            if (scratch.canvas.height !== height) {
                scratch.canvas.height = height;
            }
            return scratch.ctx;
        };

        drawer._ensureExtractImageData = function(width, height) {
            const scratch = this._extractScratch;
            if (!scratch.imageData || scratch.imageData.width !== width || scratch.imageData.height !== height) {
                scratch.imageData = new ImageData(width, height);
            }
            return scratch.imageData;
        };

        drawer._ensureExtractBuffer = function(width, height, type = "uint8") {
            const scratch = this._extractScratch;
            const len = width * height * 4;

            if (type === "float32") {
                if (!(scratch.f32 instanceof Float32Array) || scratch.f32.length !== len) {
                    scratch.f32 = new Float32Array(len);
                }
                return scratch.f32;
            }

            if (!(scratch.u8 instanceof Uint8Array) || scratch.u8.length !== len) {
                scratch.u8 = new Uint8Array(len);
            }
            return scratch.u8;
        };

        drawer._readCanvasResult = function(ctx, result = "imageData") {
            const canvas = ctx.canvas;

            switch (result) {
                case "ctx":
                    return ctx;
                case "canvas":
                    return canvas;
                case "imageData":
                    return ctx.getImageData(0, 0, canvas.width, canvas.height);
                case "uint8": {
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    return new Uint8Array(imageData.data.buffer.slice(0));
                }
                default:
                    throw new Error(`Unsupported extract result "${result}"`);
            }
        };

        drawer._readCurrentCanvas = function(sourceCanvas, result = "imageData") {
            const ctx = this._ensureExtract2D(sourceCanvas.width, sourceCanvas.height);
            ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
            ctx.drawImage(sourceCanvas, 0, 0);
            return this._readCanvasResult(ctx, result);
        };

        drawer._getExtractionFramebuffer = function() {
            const gl = this.renderer.gl;
            const scratch = this._extractScratch;
            if (!scratch.framebuffer) {
                scratch.framebuffer = gl.createFramebuffer();
            }
            return scratch.framebuffer;
        };

        drawer._readTextureArrayLayer = function(texArray, layerIndex, {
            width = this.renderer.canvas.width,
            height = this.renderer.canvas.height,
            level = 0,
            format = null,
            type = null,
            result = "imageData",
        } = {}) {
            const gl = this.renderer.gl;

            format = format || gl.RGBA;
            type = type || gl.UNSIGNED_BYTE;

            const fb = this._getExtractionFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texArray, level, layerIndex);

            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                throw new Error(`Extraction framebuffer incomplete: 0x${status.toString(16)}`);
            }

            const pixels = this._ensureExtractBuffer(width, height, type === gl.FLOAT ? "float32" : "uint8");
            gl.readPixels(0, 0, width, height, format, type, pixels);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            if (result === "uint8" || result === "float32") {
                return pixels.slice(0);
            }

            const imageData = this._ensureExtractImageData(width, height);
            imageData.data.set(type === gl.FLOAT ? new Uint8ClampedArray(pixels.buffer) : pixels);
            if (result === "imageData") {
                return new ImageData(new Uint8ClampedArray(imageData.data), width, height);
            }

            const ctx = this._ensureExtract2D(width, height);
            ctx.putImageData(imageData, 0, 0);
            if (result === "canvas") {
                return ctx.canvas;
            }
            if (result === "ctx") {
                return ctx;
            }

            throw new Error(`Unsupported extract result "${result}"`);
        };

        /**
         * Copy the currently visible viewer canvas exactly as displayed.
         * Good for "what user sees now", not for layer isolation.
         */
        drawer.extractCurrentViewport = async function({
                                                           result = "imageData"
                                                       } = {}) {
            return this._readCurrentCanvas(viewer.drawer.canvas, result);
        };

        /**
         * Extract a single first-pass layer directly from the standalone renderer state.
         *
         * @param {"texture"|"stencil"} kind
         * @param {number} layerIndex
         * @param {object} [opts]
         */
        drawer.extractFirstPassLayer = async function(kind, layerIndex, opts = {}) {
            await lock();
            try {
                const fp = this.renderer.__firstPassResult;
                if (!fp) {
                    throw new Error("No first-pass result available in standalone renderer.");
                }

                const tex = kind === "stencil" ? fp.stencil : fp.texture;
                const depth = kind === "stencil" ? fp.stencilDepth : fp.textureDepth;

                if (!tex) {
                    throw new Error(`No ${kind} texture available.`);
                }
                if (layerIndex < 0 || layerIndex >= depth) {
                    throw new Error(`Invalid ${kind} layer index ${layerIndex}; depth=${depth}`);
                }

                return this._readTextureArrayLayer(tex, layerIndex, {
                    width: opts.width || this.renderer.canvas.width,
                    height: opts.height || this.renderer.canvas.height,
                    level: opts.level || 0,
                    format: opts.format,
                    type: opts.type,
                    result: opts.result || "imageData",
                });
            } finally {
                unlock();
            }
        };

        /**
         * Main extraction facade.
         *
         * mode:
         *  - "viewport-copy": copy current viewer canvas exactly
         *  - "second-pass": isolated rerender via standalone and return result
         *  - "first-pass-layer": direct readback from first-pass texture/stencil layer
         */
        drawer.extract = async function({
            mode = "second-pass",
            tiledImages = viewer.world ? viewer.world.getItemCount ? [...Array(viewer.world.getItemCount()).keys()].map(i => viewer.world.getItemAt(i)) : [] : [],
            configuration = undefined,
            view = undefined,
            size = undefined,
            result = "imageData",

            // first-pass specific
            kind = "texture",
            layerIndex = 0,
            level = 0,
            format = undefined,
            type = undefined,
        } = {}) {
            if (mode === "viewport-copy") {
                return this.extractCurrentViewport({ result });
            }

            if (mode === "first-pass-layer") {
                return this.extractFirstPassLayer(kind, layerIndex, {
                    width: size && size.x,
                    height: size && size.y,
                    level,
                    format,
                    type,
                    result,
                });
            }

            const ctx = await this.drawWithConfiguration(
                tiledImages,
                configuration,
                view,
                size
            );
            return this._readCanvasResult(ctx, result);
        };

        return drawer;
    };

}(OpenSeadragon));
