(function($) {

    function createLock() {
        let locked = false;
        const waiters = [];

        return {
            async lock() {
                if (!locked) {
                    locked = true;
                    return;
                }
                await new $.Promise(resolve => waiters.push(resolve));
            },
            unlock() {
                const next = waiters.shift();
                if (next) {
                    next();
                } else {
                    locked = false;
                }
            }
        };
    }

    function installExtractionApi(target, renderer, readCurrentCanvas) {
        target._extractScratch = {
            canvas: null,
            ctx: null,
            framebuffer: null,
            imageData: null,
            u8: null,
            f32: null,
        };

        target._ensureExtract2D = function(width, height) {
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

        target._ensureExtractImageData = function(width, height) {
            const scratch = this._extractScratch;
            if (!scratch.imageData || scratch.imageData.width !== width || scratch.imageData.height !== height) {
                scratch.imageData = new ImageData(width, height);
            }
            return scratch.imageData;
        };

        target._ensureExtractBuffer = function(width, height, type = "uint8") {
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

        target._readCanvasResult = function(ctx, result = "imageData") {
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

        target._readCurrentCanvas = function(sourceCanvas, result = "imageData") {
            const ctx = this._ensureExtract2D(sourceCanvas.width, sourceCanvas.height);
            ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
            ctx.drawImage(sourceCanvas, 0, 0);
            return this._readCanvasResult(ctx, result);
        };

        target._getExtractionFramebuffer = function() {
            const gl = renderer.gl;
            const scratch = this._extractScratch;
            if (!scratch.framebuffer) {
                scratch.framebuffer = gl.createFramebuffer();
            }
            return scratch.framebuffer;
        };

        target._readTextureArrayLayer = function(texArray, layerIndex, {
            width = renderer.canvas.width,
            height = renderer.canvas.height,
            level = 0,
            format = null,
            type = null,
            result = "imageData",
        } = {}) {
            const gl = renderer.gl;

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

        target.extractCurrentViewport = async function({
            result = "imageData"
        } = {}) {
            return readCurrentCanvas.call(this, result);
        };
    }

    async function rasterizeStandaloneSource(source) {
        if (!source) {
            throw new Error("Invalid standalone input source.");
        }

        if (typeof source === "string") {
            source = await new Promise((resolve, reject) => {
                const image = document.createElement("img");
                image.decoding = "async";
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error(`Failed to load standalone input source '${source}'.`));
                image.src = source;
            });
        } else if (source && typeof source === "object" && typeof source.src === "string" &&
            !(typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement)) {
            return rasterizeStandaloneSource(source.src);
        }

        if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
            if (!source.complete || source.naturalWidth <= 0 || source.naturalHeight <= 0) {
                await new Promise((resolve, reject) => {
                    source.addEventListener("load", resolve, { once: true });
                    source.addEventListener("error", () => reject(new Error("Failed to load standalone image input.")), { once: true });
                });
            }

            const width = source.naturalWidth || source.width;
            const height = source.naturalHeight || source.height;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(source, 0, 0, width, height);
            return {
                width,
                height,
                pixels: ctx.getImageData(0, 0, width, height).data
            };
        }

        if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
            const ctx = source.getContext("2d", { willReadFrequently: true });
            return {
                width: source.width,
                height: source.height,
                pixels: ctx.getImageData(0, 0, source.width, source.height).data
            };
        }

        if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
            const canvas = document.createElement("canvas");
            canvas.width = source.width;
            canvas.height = source.height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(source, 0, 0);
            return {
                width: source.width,
                height: source.height,
                pixels: ctx.getImageData(0, 0, source.width, source.height).data
            };
        }

        if (typeof ImageData !== "undefined" && source instanceof ImageData) {
            return {
                width: source.width,
                height: source.height,
                pixels: source.data
            };
        }

        throw new Error("Unsupported standalone input source.");
    }

    function createStandaloneViewportHost(viewer) {
        return {
            navigator: null,
            world: viewer.world,
            drawer: {
                canRotate: function() {
                    return !!(viewer.drawer && typeof viewer.drawer.canRotate === "function" && viewer.drawer.canRotate());
                }
            },
            forceRedraw: function() {},
            raiseEvent: function() {},
        };
    }

    function setStandaloneViewportRotation(viewport, viewer, degrees) {
        if (typeof degrees !== "number") {
            return;
        }

        if (viewport.degreesSpring) {
            viewport.degreesSpring.resetTo(degrees);
        }
        if (viewport._oldDegrees !== undefined) {
            viewport._oldDegrees = degrees;
        }

        viewport._setContentBounds(viewer.world.getHomeBounds(), viewer.world.getContentFactor());
    }

    function syncStandaloneViewportState(viewport, viewer, view, size) {
        viewport._setContentBounds(viewer.world.getHomeBounds(), viewer.world.getContentFactor());

        if (size && typeof size.x === "number" && typeof size.y === "number") {
            viewport.resize(new $.Point(size.x, size.y), true);
        }

        if (view && view.bounds) {
            viewport.fitBounds(view.bounds, true);
        } else if (view) {
            if (typeof view.zoom === "number") {
                viewport.zoomTo(view.zoom, null, true);
            }
            if (view.center) {
                viewport.panTo(view.center, true);
            }
        } else {
            viewport.fitBounds(viewer.viewport.getBoundsNoRotate(true), true);
        }

        if (view && typeof view.rotation === "number") {
            setStandaloneViewportRotation(viewport, viewer, view.rotation * 180 / Math.PI);
        } else {
            setStandaloneViewportRotation(viewport, viewer, viewer.viewport.getRotation(true));
        }

        if (view && typeof view.flipped === "boolean") {
            viewport.setFlip(view.flipped);
        } else {
            viewport.setFlip(viewer.viewport.getFlip());
        }

        viewport.applyConstraints(true);
    }

    $.makeStandaloneFlexDrawer = function(viewer) {
        const Drawer = OpenSeadragon.FlexDrawer;
        const viewportHost = createStandaloneViewportHost(viewer);
        const standaloneViewport = new $.Viewport({
            containerSize: viewer.viewport.getContainerSize(),
            springStiffness: viewer.springStiffness,
            animationTime: viewer.animationTime,
            minZoomImageRatio: viewer.minZoomImageRatio,
            maxZoomPixelRatio: viewer.maxZoomPixelRatio,
            visibilityRatio: viewer.visibilityRatio,
            wrapHorizontal: viewer.wrapHorizontal,
            wrapVertical: viewer.wrapVertical,
            defaultZoomLevel: viewer.defaultZoomLevel,
            minZoomLevel: viewer.minZoomLevel,
            maxZoomLevel: viewer.maxZoomLevel,
            viewer: viewportHost,
            degrees: viewer.viewport.getRotation(true),
            flipped: viewer.viewport.getFlip(),
            overlayPreserveContentDirection: viewer.overlayPreserveContentDirection,
            navigatorRotate: viewer.navigatorRotate,
            homeFillsViewer: viewer.homeFillsViewer,
            margins: viewer.viewportMargins,
            silenceMultiImageWarnings: viewer.silenceMultiImageWarnings
        });
        viewportHost.viewport = standaloneViewport;
        syncStandaloneViewportState(standaloneViewport, viewer);

        const options = $.extend(true, {}, viewer.drawerOptions[Drawer.prototype.getType()]);
        options.debug = false;
        options.htmlReset = undefined;
        options.htmlHandler = undefined;
        // avoid modification on navigator
        options.handleNavigator = false;
        options.offScreen = true;

        const drawer = new Drawer({
            viewer:             viewer,
            viewport:           standaloneViewport,
            element:            viewer.drawer.container,
            debugGridColor:     viewer.debugGridColor,
            options:            options
        });

        const mutex = createLock();
        const lock = () => mutex.lock();
        const unlock = () => mutex.unlock();

        drawer._bindTiledImagesToViewport = function(tiledImages) {
            const bindings = tiledImages.map(tiledImage => ({
                tiledImage,
                viewport: tiledImage.viewport
            }));
            for (const binding of bindings) {
                binding.tiledImage.viewport = this.viewport;
            }
            return bindings;
        };

        drawer._restoreTiledImageViewports = function(bindings) {
            if (!bindings) {
                return;
            }
            for (const binding of bindings) {
                binding.tiledImage.viewport = binding.viewport;
            }
        };

        drawer._syncViewerViewport = async function(view, size) {
            if (!view || view instanceof OpenSeadragon.FlexDrawer) {
                return;
            }

            const viewport = this.viewport;
            if (!viewport) {
                return;
            }

            syncStandaloneViewportState(viewport, viewer, view, size);

            await new $.Promise(resolve => requestAnimationFrame(() => resolve()));
        };

        drawer._collectReadyTiles = async function(tiledImages, view, size) {
            await this._syncViewerViewport(view, size);

            for (const tiledImage of tiledImages) {
                tiledImage.update(true);
            }

            let tiles = tiledImages.map(ti => ti.getTilesToDraw()).flat();
            if (tiles.length) {
                return tiles;
            }

            for (let attempt = 0; attempt < 3; attempt++) {
                await new $.Promise(resolve => requestAnimationFrame(() => resolve()));
                for (const tiledImage of tiledImages) {
                    tiledImage.update(true);
                }
                tiles = tiledImages.map(ti => ti.getTilesToDraw()).flat();
                if (tiles.length) {
                    return tiles;
                }
            }

            return [];
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
            let viewportBindings = null;

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
                viewportBindings = drawer._bindTiledImagesToViewport(tiledImages);
                try {
                    tiles = await drawer._collectReadyTiles(tiledImages, view, size);
                    if (!tiles.length) {
                        throw new Error("Standalone extraction found no tiles to draw for the requested view.");
                    }
                    tasks = tiles.map(t => t.tile.getCache().prepareForRendering(drawer));
                } catch (e) {
                    drawer._restoreTiledImageViewports(viewportBindings);
                    viewportBindings = null;
                    throw e;
                }
            }

            await lock();
            try {
                if (configuration) {
                    await drawer.overrideConfigureAll(configuration, undefined, { immediate: true });
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
                        drawer._restoreTiledImageViewports(viewportBindings);
                        viewportBindings = null;
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
                if (viewportBindings) {
                    drawer._restoreTiledImageViewports(viewportBindings);
                }
                unlock();
            }
        }).bind(drawer);

        // ---------------------------------------------------------------------
        // Extraction API
        // ---------------------------------------------------------------------

        installExtractionApi(drawer, drawer.renderer, function(result = "imageData") {
            return this._readCurrentCanvas(viewer.drawer.canvas, result);
        });

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

    $.makeStandaloneFlexRenderer = function({
        uniqueId = `standalone_renderer_${Date.now()}`,
        width = 256,
        height = 256,
        webGLPreferredVersion = "2.0",
        backgroundColor = "#00000000",
        debug = false,
        interactive = false,
        canvasOptions = { stencil: true }
    } = {}) {
        const runtime = {};
        const mutex = createLock();
        const lock = () => mutex.lock();
        const unlock = () => mutex.unlock();

        runtime.renderer = new $.FlexRenderer({
            uniqueId: $.FlexRenderer.sanitizeKey(uniqueId),
            webGLPreferredVersion,
            redrawCallback: () => {},
            refetchCallback: () => {},
            debug: !!debug,
            interactive: !!interactive,
            backgroundColor,
            canvasOptions
        });
        runtime.renderer.setDataBlendingEnabled(true);
        runtime.renderer.setDimensions(0, 0, width, height, 1, 1);
        runtime.canvas = runtime.renderer.canvas;
        runtime._inputState = {
            key: null,
            count: 0,
            width,
            height
        };

        installExtractionApi(runtime, runtime.renderer, function(result = "imageData") {
            return this._readCurrentCanvas(this.renderer.canvas, result);
        });

        runtime.setSize = function(nextWidth, nextHeight) {
            const safeWidth = Math.max(1, Math.round(Number(nextWidth) || 1));
            const safeHeight = Math.max(1, Math.round(Number(nextHeight) || 1));
            this._inputState.width = safeWidth;
            this._inputState.height = safeHeight;
            const depth = Math.max(this._inputState.count || 1, 1);
            this.renderer.setDimensions(0, 0, safeWidth, safeHeight, depth, depth);
        };

        runtime._clearInputTextures = function() {
            const gl = this.renderer.gl;
            if (this._inputState.colorTexture) {
                gl.deleteTexture(this._inputState.colorTexture);
            }

            this._inputState.colorTexture = null;
            this.renderer.__firstPassResult = null;
        };

        runtime._buildSyntheticFirstPassSource = function() {
            if (!this._inputState.colorTexture || !this._inputState.count) {
                return [];
            }

            const fullScreenMatrix = new Float32Array([
                2, 0, 0,
                0, 2, 0,
                -1, -1, 1
            ]);
            const fullUv = new Float32Array([
                0, 0,
                0, 1,
                1, 0,
                1, 1
            ]);

            const source = [];
            for (let i = 0; i < this._inputState.count; i++) {
                source.push({
                    tiles: [{
                        transformMatrix: fullScreenMatrix,
                        dataIndex: i,
                        stencilIndex: i,
                        texture: this._inputState.colorTexture,
                        position: fullUv,
                        tile: null
                    }],
                    vectors: [],
                    polygons: [],
                    dataIndex: i,
                    stencilIndex: i,
                    packIndex: 0,
                    _temp: { values: fullScreenMatrix }
                });
            }

            return source;
        };

        runtime._renderFirstPass = function() {
            if (!this._inputState.colorTexture || !this._inputState.count) {
                throw new Error("Standalone renderer has no input textures. Call setInputs(...) first.");
            }

            this.renderer.__flexPackInfo = {
                layout: {
                    baseLayer: Array.from({ length: this._inputState.count }, (_, i) => i),
                    packCount: Array.from({ length: this._inputState.count }, () => 1),
                    totalLayers: this._inputState.count
                },
                channelCount: Array.from({ length: this._inputState.count }, () => 4)
            };

            this.renderer.setDimensions(
                0,
                0,
                this._inputState.width,
                this._inputState.height,
                this._inputState.count,
                this._inputState.count
            );

            const source = this._buildSyntheticFirstPassSource();
            this.renderer.firstPassProcessData(source);
            return this.renderer.__firstPassResult;
        };

        runtime.setInputs = async function(inputs, options = {}) {
            const sourceList = Array.isArray(inputs) ? inputs.filter(Boolean) : (inputs ? [inputs] : []);
            const rasterized = await Promise.all(sourceList.map(source => rasterizeStandaloneSource(source)));
            if (!rasterized.length) {
                this._clearInputTextures();
                this._inputState.count = 0;
                this.renderer.__flexPackInfo = {
                    layout: { baseLayer: [], packCount: [], totalLayers: 0 },
                    channelCount: []
                };
                this.setSize(options.width || this._inputState.width, options.height || this._inputState.height);
                return;
            }

            const targetWidth = Math.max(1, Math.round(Number(options.width) || rasterized[0].width || this._inputState.width || 1));
            const targetHeight = Math.max(1, Math.round(Number(options.height) || rasterized[0].height || this._inputState.height || 1));
            const layerCount = rasterized.length;
            const colorPixels = new Uint8Array(targetWidth * targetHeight * 4 * layerCount);

            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });

            rasterized.forEach((entry, layerIndex) => {
                ctx.clearRect(0, 0, targetWidth, targetHeight);
                const imageData = new ImageData(new Uint8ClampedArray(entry.pixels), entry.width, entry.height);
                if (entry.width === targetWidth && entry.height === targetHeight) {
                    ctx.putImageData(imageData, 0, 0);
                } else {
                    const tmp = document.createElement("canvas");
                    tmp.width = entry.width;
                    tmp.height = entry.height;
                    tmp.getContext("2d", { willReadFrequently: true }).putImageData(imageData, 0, 0);
                    ctx.drawImage(tmp, 0, 0, targetWidth, targetHeight);
                }

                const rgbaPixels = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
                colorPixels.set(rgbaPixels, layerIndex * targetWidth * targetHeight * 4);
            });

            this._clearInputTextures();

            const gl = this.renderer.gl;
            this._inputState.colorTexture = $.FlexRenderer._createSelfTestTextureArray(gl, targetWidth, targetHeight, layerCount, colorPixels);
            this._inputState.count = layerCount;
            this._inputState.width = targetWidth;
            this._inputState.height = targetHeight;
            this._inputState.key = `${targetWidth}x${targetHeight}:${layerCount}`;

            this.renderer.setDimensions(0, 0, targetWidth, targetHeight, layerCount, layerCount);
        };

        runtime.overrideConfigureAll = async function(shaders, shaderOrder = undefined) {
            this.renderer.deleteShaders();
            this.renderer.__firstPassResult = null;
            if (!shaders) {
                this.renderer.setShaderLayerOrder([]);
                return;
            }

            const normalized = $.FlexRenderer.normalizeShaderMap(
                $.extend(true, {}, shaders),
                { source: "standalone-runtime" }
            ) || {};

            for (const shaderId in normalized) {
                this.renderer.createShaderLayer(shaderId, normalized[shaderId], false);
            }

            this.renderer.setShaderLayerOrder(shaderOrder || Object.keys(normalized));
            this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
        };

        runtime.getOverriddenShaderConfig = function(key) {
            const shaderLayer = this.renderer.getAllShaders()[key];
            return shaderLayer ? shaderLayer.getConfig() : undefined;
        };

        runtime._buildRenderArray = function({
            zoom = 1,
            pixelSize = 1,
            opacity = 1
        } = {}) {
            const renderArray = [];
            for (const shader of this.renderer.getFlatShaderLayers(this.renderer.getAllShaders(), this.renderer.getShaderLayerOrder())) {
                renderArray.push({
                    zoom,
                    pixelSize,
                    opacity,
                    shader
                });
            }
            return renderArray;
        };

        runtime.drawWithConfiguration = async function(inputs = undefined, configuration = undefined, _view = undefined, size = undefined) {
            await lock();
            try {
                if (inputs !== undefined) {
                    await this.setInputs(inputs, size ? {
                        width: size.width || size.x,
                        height: size.height || size.y
                    } : {});
                } else if (size && typeof size.x === "number" && typeof size.y === "number") {
                    this.setSize(size.x, size.y);
                }

                if (configuration) {
                    await this.overrideConfigureAll(configuration);
                }

                const gl = this.renderer.gl;
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.clearColor(1.0, 1.0, 1.0, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                this._renderFirstPass();

                const renderArray = this._buildRenderArray();
                if (!renderArray.length) {
                    throw new Error("Standalone renderer has no configured shader layers.");
                }

                this.renderer.secondPassProcessData(renderArray);
                this.renderer.gl.finish();

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = this.renderer.canvas.width;
                canvas.height = this.renderer.canvas.height;
                ctx.drawImage(this.renderer.canvas, 0, 0);
                return ctx;
            } finally {
                unlock();
            }
        };

        runtime.extractFirstPassLayer = async function(kind, layerIndex, opts = {}) {
            await lock();
            try {
                const fp = this.renderer.__firstPassResult || this._renderFirstPass();
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

        runtime.extract = async function({
            mode = "second-pass",
            inputs = undefined,
            sources = undefined,
            configuration = undefined,
            size = undefined,
            result = "imageData",
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
                sources !== undefined ? sources : inputs,
                configuration,
                undefined,
                size
            );
            return this._readCanvasResult(ctx, result);
        };

        runtime.destroy = function() {
            if (this._extractScratch && this._extractScratch.framebuffer) {
                this.renderer.gl.deleteFramebuffer(this._extractScratch.framebuffer);
                this._extractScratch.framebuffer = null;
            }
            this._clearInputTextures();
            this.renderer.destroy();
        };

        return runtime;
    };

}(OpenSeadragon));
