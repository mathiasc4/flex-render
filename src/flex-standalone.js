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

    const FLEX_DEFAULT_LOAD_TIMEOUT_MS = 10000;
    const FLEX_DEFAULT_POLL_INTERVAL_MS = 50;

    /**
     * One-shot wake-up latch fed by tile traffic, so a full-load wait reacts to an arriving tile
     * instead of sleeping out its poll interval.
     *
     * 'tile-loaded' / 'tile-load-failed' are VIEWER level events and detached mirrors share the live
     * viewer, so without `mine` this also fires for every tile the USER's navigation loads. That is
     * not harmless: each wake costs a pump (update(true) over every image, i.e. a full
     * _updateLevelsForViewport), and it makes live traffic look like this pass's progress. Both
     * events carry `tiledImage`, so the filter is exact. Bursts coalesce into a single wake.
     *
     * `count()` is this pass's own arrival counter, loaded and failed alike. It is what the progress
     * fingerprint uses instead of the ImageLoader counters: those are shared with the live viewer, so
     * a browsing user held them permanently non-zero and the stall exit could never fire.
     *
     * The handler is synchronous and returns undefined, so it cannot stall raiseEventAwaiting;
     * never await event.promise here.
     *
     * @param {OpenSeadragon.Viewer} host
     * @param {Set<OpenSeadragon.TiledImage>} [mine] only count traffic of these images
     * @private
     */
    function createTileTrafficLatch(host, mine) {
        let pending = false;
        let wake = null;
        let seen = 0;

        function onTraffic(event) {
            if (mine && !mine.has(event && event.tiledImage)) {
                return; // the user's own tiles: not this pass's progress
            }
            seen++;
            pending = true;
            const resolve = wake;
            wake = null;
            if (resolve) {
                resolve();
            }
        }

        host.addHandler('tile-loaded', onTraffic);
        host.addHandler('tile-load-failed', onTraffic);

        return {
            count() {
                return seen;
            },
            consumePending() {
                const value = pending;
                pending = false;
                return value;
            },
            onWake(handler) {
                wake = handler;
            },
            clearWake() {
                wake = null;
            },
            dispose() {
                host.removeHandler('tile-loaded', onTraffic);
                host.removeHandler('tile-load-failed', onTraffic);
                const resolve = wake;
                wake = null;
                if (resolve) {
                    resolve();
                }
            }
        };
    }

    /**
     * Resolve on whichever comes first: tile traffic, the next animation frame, or `ms`.
     *
     * rAF alone is not enough for an off-screen pass: it is throttled to zero while the document is
     * hidden, and an extract triggered from a background tab would then never drive
     * TiledImage.update() and would spend its whole timeout doing nothing.
     * @private
     */
    function waitTick(ms, latch) {
        if (latch && latch.consumePending()) {
            return $.Promise.resolve();
        }

        return new $.Promise(resolve => {
            let settled = false;
            let timer = null;

            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (latch) {
                    latch.clearWake();
                }
                resolve();
            };

            timer = setTimeout(finish, ms);
            if (latch) {
                latch.onWake(finish);
            }
            requestAnimationFrame(finish);
        });
    }

    /**
     * Instantaneous completeness of a live World. Public API only; an item too old to expose the
     * flag reports incomplete, because an unknown completeness must degrade closed.
     * @private
     */
    function isWorldFullyLoaded(world) {
        const count = world && world.getItemCount ? world.getItemCount() : 0;
        if (!count) {
            return false;
        }
        for (let i = 0; i < count; i++) {
            const item = world.getItemAt(i);
            if (!item || typeof item.getFullyLoaded !== "function" || !item.getFullyLoaded()) {
                return false;
            }
        }
        return true;
    }

    /**
     * Wait for a LIVE viewer to finish loading the view it is already showing.
     *
     * Purely event driven: the live viewer runs its own update loop, so its tiled images refresh
     * their 'fully loaded' flag every frame without us touching them. Never call update() on a live
     * image from here - it belongs to the on-screen viewport, not to this pass.
     *
     * @returns {Promise<{fullyLoaded: boolean, timedOut: boolean}>}
     * @private
     */
    function waitForLiveViewerFullLoad(host, timeoutMs) {
        const world = host && host.world;
        if (isWorldFullyLoaded(world)) {
            return $.Promise.resolve({ fullyLoaded: true, timedOut: false });
        }
        if (!world || !world.getItemCount || !world.getItemCount()) {
            return $.Promise.resolve({ fullyLoaded: false, timedOut: false });
        }

        return new $.Promise(resolve => {
            const items = [];
            let timer = null;
            let settled = false;

            const finish = (timedOut) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                for (const item of items) {
                    item.removeHandler('fully-loaded-change', onChange);
                }
                resolve({ fullyLoaded: isWorldFullyLoaded(world), timedOut: timedOut });
            };

            function onChange() {
                if (isWorldFullyLoaded(world)) {
                    finish(false);
                }
            }

            for (let i = 0; i < world.getItemCount(); i++) {
                const item = world.getItemAt(i);
                if (item && typeof item.addHandler === "function") {
                    items.push(item);
                    item.addHandler('fully-loaded-change', onChange);
                }
            }

            timer = setTimeout(() => finish(true), timeoutMs);
            // The flag may have flipped between the first check and subscribing.
            onChange();
        });
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
            width = renderer.getRenderDimensions().width,
            height = renderer.getRenderDimensions().height,
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
        // No htmlHandler and no DOM of its own, so this drawer must not bind controls
        // to `document.getElementById(shaderId + "_" + control)`. A host passing
        // `interactive: true` in its drawer options would otherwise have those ids
        // resolve to ANOTHER renderer's live controls -- the standalone drawer would
        // rewrite their values and leak a change listener into a throwaway shader.
        options.interactive = false;
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

        /**
         * Collect the tiles this pass will draw.
         *
         * Without `waitFullLoad` this keeps the historical best-effort behaviour: return as soon as
         * anything is drawable, retrying a few frames only when nothing is at all. That is right for
         * a caller that will get another frame.
         *
         * With `waitFullLoad` the pass keeps driving `tiledImage.update(true)` - the only thing that
         * BOTH dispatches the missing tiles AND refreshes getFullyLoaded(); a detached mirror is in
         * nobody's update loop, so waiting on the 'fully-loaded-change' event alone would deadlock -
         * until every image reports fully loaded, the deadline passes, or no further progress is
         * possible.
         *
         * @param {Array<OpenSeadragon.TiledImage>} tiledImages
         * @param {object|OpenSeadragon.FlexDrawer} [view]
         * @param {OpenSeadragon.Point|{x:number,y:number}} [size]
         * @param {object} [options]
         * @param {boolean} [options.waitFullLoad=false] wait for completeness instead of first tile
         * @param {Array<OpenSeadragon.TiledImage>} [options.waitImages] wait on these images only,
         *      defaulting to `tiledImages`. All of `tiledImages` are still DRAWN and still pumped;
         *      this narrows what completeness MEANS for the pass. A caller rendering only the
         *      background passes the reference image, so an unrelated overlay that can never load
         *      does not make every render report incomplete forever.
         * @param {number} [options.loadTimeoutMs=10000] hard upper bound of that wait
         * @param {number} [options.stallTimeoutMs] give up this much earlier when nothing is moving;
         *      defaults to min(1500, loadTimeoutMs / 2)
         * @param {number} [options.pollIntervalMs=50] upper bound between two update() pumps
         * @returns {Promise<{tiles: Array, fullyLoaded: boolean, timedOut: boolean, stalled: boolean}>}
         * @private
         */
        drawer._collectReadyTiles = async function(tiledImages, view, size, options = {}) {
            if (!tiledImages || !tiledImages.length) {
                return { tiles: [], fullyLoaded: false, timedOut: false, stalled: false };
            }

            await this._syncViewerViewport(view, size);

            const opts = options || {};

            // All of tiledImages are drawn and pumped; only the WAIT narrows. An image outside this
            // set may legitimately never load (a hidden or errored overlay) and must not hold the
            // pass hostage or brand its result incomplete. Only a pumped image can ever complete, so
            // an entry outside tiledImages would be a guaranteed timeout - drop those.
            let waitSet = tiledImages;
            if (Array.isArray(opts.waitImages) && opts.waitImages.length) {
                const requested = opts.waitImages.filter(ti => tiledImages.indexOf(ti) !== -1);
                if (requested.length) {
                    waitSet = requested;
                } else {
                    $.console.warn('waitImages holds no image this pass draws, waiting on all of them!');
                }
            }

            // An image too old to report its load state must not be waited on (we would spin to the
            // timeout every single pass) and must not be reported complete either.
            const canReportLoad = waitSet.every(ti => typeof ti.getFullyLoaded === "function");
            const waitFullLoad = !!opts.waitFullLoad && canReportLoad;

            const timeoutMs = Number.isFinite(opts.loadTimeoutMs) ?
                Math.max(0, opts.loadTimeoutMs) : FLEX_DEFAULT_LOAD_TIMEOUT_MS;
            const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) ?
                Math.max(1, opts.pollIntervalMs) : FLEX_DEFAULT_POLL_INTERVAL_MS;
            let stallTimeoutMs = Number.isFinite(opts.stallTimeoutMs) ?
                Math.max(0, opts.stallTimeoutMs) : Math.min(1500, timeoutMs / 2);

            // A failed tile is dropped from every per-image counter (tile.exists = false), so a retry
            // sleeping out tileRetryDelay is invisible to us and would read as a stall. These are
            // viewer configuration values, not live shared state, so this couples us to nothing.
            if (viewer.tileRetryMax > 0) {
                stallTimeoutMs = Math.max(stallTimeoutMs, (viewer.tileRetryDelay || 0) + pollIntervalMs);
            }

            const pump = () => {
                for (const tiledImage of tiledImages) {
                    tiledImage.update(true);
                }
            };

            const allLoaded = () => canReportLoad && waitSet.every(ti => ti.getFullyLoaded());

            const collect = () => tiledImages.map(ti => ti.getTilesToDraw()).flat();

            // Progress fingerprint over the wait set. MUST be sampled straight after update():
            // getTilesToDraw() runs _updateTilesInViewport(), which zeroes _tilesLoading without
            // recounting it, so a later read always reads 0.
            //
            // `arrivals` is this pass's own tile traffic (latch.count()). The ImageLoader counters
            // that used to sit here are shared with the live viewer, so a browsing user held them
            // non-zero and the stall exit could never fire.
            const sampleProgress = (arrivals) => {
                let loading = 0;
                let drawable = 0;
                let loaded = 0;
                for (const tiledImage of waitSet) {
                    loading += tiledImage._tilesLoading || 0;
                    const perLevel = tiledImage._tilesToDraw || [];
                    for (const level of perLevel) {
                        if (Array.isArray(level)) {
                            drawable += level.length;
                        } else if (level) {
                            drawable++;
                        }
                    }
                    if (typeof tiledImage.getFullyLoaded === "function" && tiledImage.getFullyLoaded()) {
                        loaded++;
                    }
                }
                return {
                    loading: loading,
                    key: loading + "/" + drawable + "/" + loaded + "/" + arrivals
                };
            };

            pump();

            if (!waitFullLoad) {
                let tiles = collect();
                for (let attempt = 0; !tiles.length && attempt < 3; attempt++) {
                    await waitTick(pollIntervalMs);
                    pump();
                    tiles = collect();
                }
                return { tiles: tiles, fullyLoaded: allLoaded(), timedOut: false, stalled: false };
            }

            const started = $.now();
            const deadline = started + timeoutMs;
            let lastProgressAt = started;
            let timedOut = false;
            let stalled = false;

            // Created before the first sample: its arrival counter IS the progress signal.
            const latch = createTileTrafficLatch(viewer, new Set(waitSet));
            let progress = sampleProgress(latch.count());
            try {
                while (!allLoaded()) {
                    const now = $.now();

                    if (now >= deadline) {
                        timedOut = true;
                        break;
                    }

                    // Nothing of OURS is loading and no tile of ours has arrived for stallTimeoutMs.
                    // Every tile still missing is one that can never arrive: a failed load sets
                    // tile.exists = false, after which _updateLevel drops it from both the draw list
                    // and the load candidates, so getFullyLoaded() can never flip. Stop instead of
                    // burning the rest of the timeout on a slide whose tiles 404.
                    //
                    // _updateLevelsForViewport dispatches its batch after it counts _tilesLoading, so
                    // a fresh batch is invisible for exactly one iteration - pollIntervalMs against a
                    // stall threshold an order of magnitude larger, and the moment any of those tiles
                    // lands the latch counter moves.
                    if (progress.loading === 0 && (now - lastProgressAt) >= stallTimeoutMs) {
                        stalled = true;
                        break;
                    }

                    await waitTick(Math.min(pollIntervalMs, Math.max(1, deadline - now)), latch);

                    pump();

                    const next = sampleProgress(latch.count());
                    if (next.key !== progress.key) {
                        lastProgressAt = $.now();
                    }
                    progress = next;
                }
            } finally {
                latch.dispose();
            }

            return {
                tiles: collect(),
                fullyLoaded: allLoaded(),
                timedOut: timedOut,
                stalled: stalled
            };
        };

        /**
         * Draws the viewer with the given configuration.
         * @param {Array<OpenSeadragon.TiledImage>} tiledImages
         * @param {Object.<string, ShaderLayerConfig>} [configuration]
         * @param {object|OpenSeadragon.FlexDrawer} [view] draw desired viewport (full pass) or re-use last frame
         *    - The viewport to draw, see {@link OpenSeadragon.FlexDrawer#draw}
         *    - Or, the reference to the drawer to draw the same viewport as the previous one. By default, the
         *      reference to the standalone drawer is used - which is probably not desired!
         * @param {OpenSeadragon.Point|{x:number,y:number}} [size] - The size of the viewer. Inherited from viewOrReference if not provided,
         *      required if viewport description is provided to the viewOrReference argument.
         * @param {object} [options] off-screen pass options
         * @param {boolean} [options.waitFullLoad=false] do not settle for the tiles that happen to be
         *      resident: wait until every waited image reports getFullyLoaded()
         * @param {Array<OpenSeadragon.TiledImage>} [options.waitImages] wait on these images only,
         *      defaulting to all of `tiledImages`; every image is drawn either way
         * @param {number} [options.loadTimeoutMs=10000] upper bound of that wait
         * @param {number} [options.stallTimeoutMs] early exit when no progress is possible
         * @param {number} [options.pollIntervalMs=50] upper bound between two update() pumps
         * @param {object} [options.status] OUT parameter, filled before the returned promise settles:
         *      {fullyLoaded, timedOut, stalled, waited}. Completeness is per call by construction -
         *      the caller owns the object, so two passes cannot read each other's flag.
         * @returns {Promise<CanvasRenderingContext2D>}
         */
        drawer.drawWithConfiguration = (async function (tiledImages, configuration = undefined,
                                                       view = undefined, size = undefined,
                                                       options = undefined) {
            let tiles;
            let tasks;
            let viewportBindings = null;

            const opts = options || {};
            const status = opts.status || {};
            status.fullyLoaded = false;
            status.timedOut = false;
            status.stalled = false;
            status.waited = false;

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

            // The lock is taken BEFORE the tiled images are rebound. With waitFullLoad the collect
            // phase can hold the rebinding for seconds instead of ~50ms, and two overlapping passes
            // would then have the second one snapshot the STANDALONE viewport as the 'original' and
            // restore the mirrors to it permanently. Single-flight the whole pass.
            await lock();
            try {
                if (fullDrawPass) {
                    viewportBindings = drawer._bindTiledImagesToViewport(tiledImages);
                    try {
                        const ready = await drawer._collectReadyTiles(tiledImages, view, size, opts);
                        tiles = ready.tiles;
                        status.fullyLoaded = ready.fullyLoaded;
                        status.timedOut = ready.timedOut;
                        status.stalled = ready.stalled;
                        status.waited = !!opts.waitFullLoad;
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

                if (configuration) {
                    await drawer.overrideConfigureAll(configuration, undefined, { immediate: true });
                }

                // todo: tiledImages.length is not reliable! we can have TI that produces more layers in the color part!

                if (fullDrawPass) {
                    // Awaited, not returned: `return promise` inside try/finally lets the finally
                    // (and with it unlock()) run before the chain settles, which would release the
                    // mutex while the mirrors are still bound to the standalone viewport.
                    return await Promise.all(tasks).then(() => {
                        // Sum of packs across all TIs:
                        const colorLayers = drawer._computeOffscreenLayerCount();
                        const stencilLayers = tiledImages.length;

                        this.renderer.setDimensions(0, 0, size.x, size.y, colorLayers, stencilLayers);
                        this.draw(tiledImages, view);

                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = size.x;
                        canvas.height = size.y;
                        // Composite onto the renderer's own backdrop before copying.
                        // A caller asking this drawer for a picture of the scene wants
                        // what the viewport shows, and a translucent layer only reads
                        // correctly over the colour it blends toward on screen.
                        // Without this the result depends on the GL context mode --
                        // a private context leaves the presentation canvas opaque,
                        // a shared one clears the final target to [0,0,0,0] -- and the
                        // transparent variant then picks up whatever the host happens
                        // to place the image on.
                        const [br, bg, bb, ba] = this.renderer.presentationClearColor;
                        if (ba > 0) {
                            ctx.fillStyle = `rgba(${Math.round(br * 255)}, ${Math.round(bg * 255)}, ` +
                                `${Math.round(bb * 255)}, ${ba})`;
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }
                        ctx.drawImage(this.renderer.getPresentationCanvas(), 0, 0);
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

                // This branch does not draw the tiled images it was handed: it re-uses the LIVE
                // drawer's first-pass texture. Its completeness is therefore the completeness of the
                // live world, not of the mirrors - the mirrors were never bound to this viewport for
                // this pass, and their flags still describe whatever view they were last driven to.
                const liveHost = (view && view.viewer) || viewer;

                if (opts.waitFullLoad) {
                    status.waited = true;
                    const liveTimeout = Number.isFinite(opts.loadTimeoutMs) ?
                        Math.max(0, opts.loadTimeoutMs) : FLEX_DEFAULT_LOAD_TIMEOUT_MS;
                    // Event driven: the live viewer drives its own update loop, so its images refresh
                    // their flag on every frame. Do NOT call update() on them from here.
                    const waited = await waitForLiveViewerFullLoad(liveHost, liveTimeout);
                    status.timedOut = waited.timedOut;
                    // The tiles that just arrived only reach the first-pass texture on the live
                    // drawer's next frame; the texture is stolen by reference below.
                    if (typeof liveHost.forceRedraw === "function") {
                        liveHost.forceRedraw();
                    }
                    await waitTick(FLEX_DEFAULT_POLL_INTERVAL_MS);
                }

                status.fullyLoaded = isWorldFullyLoaded(liveHost.world);

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

                const sources = this._collectSecondPassPayload({
                    zoom: this.viewport.getZoom(true)
                });

                if (!sources.length) {
                    this.viewer.forceRedraw();
                }

                this.renderer.renderSecondPass(sources);
                this.renderer.gl.finish();

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = size.x;
                canvas.height = size.y;
                ctx.drawImage(this.renderer.getPresentationCanvas(), 0, 0);
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
                    width: opts.width || this.renderer.getRenderDimensions().width,
                    height: opts.height || this.renderer.getRenderDimensions().height,
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
         *
         * "second-pass" returns { data, fullyLoaded, timedOut, stalled }. Completeness is per call:
         * a one-shot extract has no next frame, so "what happened to be resident" is the entire
         * result and the caller must be able to tell that apart from "what is there". The other two
         * modes return their payload bare - neither has a notion of per-pass tile completeness.
         *
         * Note that fullyLoaded only covers tiles the tiled image still considers loadable: a tile
         * that failed permanently is dropped from the computation, so a source with missing tiles
         * can report fullyLoaded with holes. A caller that must degrade closed should trust only
         * `fullyLoaded && !stalled`.
         *
         * @param {object} [opts]
         * @param {boolean} [opts.waitFullLoad=false] wait for every waited image to report
         *      getFullyLoaded() instead of drawing whatever tiles are resident
         * @param {Array<OpenSeadragon.TiledImage>} [opts.waitImages] narrow what completeness means:
         *      wait on these images only, defaulting to every image drawn. All images are still
         *      drawn either way - this only keeps an overlay that can never load from branding every
         *      render incomplete.
         * @param {number} [opts.loadTimeoutMs=10000] upper bound of that wait
         * @param {number} [opts.stallTimeoutMs] early exit once no progress is possible
         * @param {number} [opts.pollIntervalMs=50]
         */
        drawer.extract = async function({
            mode = "second-pass",
            tiledImages = viewer.world ? viewer.world.getItemCount ? [...Array(viewer.world.getItemCount()).keys()].map(i => viewer.world.getItemAt(i)) : [] : [],
            configuration = undefined,
            view = undefined,
            size = undefined,
            result = "imageData",

            // completeness
            waitFullLoad = false,
            waitImages = undefined,
            loadTimeoutMs = undefined,
            stallTimeoutMs = undefined,
            pollIntervalMs = undefined,

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

            // Owned by this call, so concurrent passes cannot read each other's completeness.
            const status = {};
            const ctx = await this.drawWithConfiguration(
                tiledImages,
                configuration,
                view,
                size,
                {
                    waitFullLoad,
                    waitImages,
                    loadTimeoutMs,
                    stallTimeoutMs,
                    pollIntervalMs,
                    status
                }
            );
            return {
                data: this._readCanvasResult(ctx, result),
                fullyLoaded: status.fullyLoaded === true,
                timedOut: status.timedOut === true,
                stalled: status.stalled === true
            };
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
        precision = "auto",
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
            precision,
            canvasOptions
        });
        runtime.renderer.setDataBlendingEnabled(true);
        runtime.renderer.setDimensions(0, 0, width, height, 1, 1);
        runtime.canvas = runtime.renderer.getPresentationCanvas();
        runtime._inputState = {
            key: null,
            count: 0,
            width,
            height,
            // 8-bit unorm data by default; a gpuTextureSet input can flip this
            normalized: true,
            usePackIndex: false
        };

        installExtractionApi(runtime, runtime.renderer, function(result = "imageData") {
            return this._readCurrentCanvas(this.renderer.getPresentationCanvas(), result);
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
                if (this._inputState.usePackIndex) {
                    // Came from prepareGpuTextureTile(...), so the backend tracks it
                    this.renderer.releasePreparedTileResource(this._inputState.colorTexture);
                } else {
                    gl.deleteTexture(this._inputState.colorTexture);
                }
            }

            this._inputState.colorTexture = null;
            this._inputState.usePackIndex = false;
            this._inputState.normalized = true;
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

            const normalized = this._inputState.normalized !== false;
            // A prepared gpuTextureSet is one texture array whose layers are packs, so each
            // synthetic source must select its own pack. Rasterized image inputs keep pack 0.
            const perLayerPackIndex = !!this._inputState.usePackIndex;

            const source = [];
            for (let i = 0; i < this._inputState.count; i++) {
                source.push({
                    tiles: [{
                        transformMatrix: fullScreenMatrix,
                        dataIndex: i,
                        stencilIndex: i,
                        texture: this._inputState.colorTexture,
                        position: fullUv,
                        normalized: normalized,
                        tile: null
                    }],
                    vectors: [],
                    polygons: [],
                    dataIndex: i,
                    stencilIndex: i,
                    packIndex: perLayerPackIndex ? i : 0,
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
            this.renderer.renderFirstPass(source);
            return this.renderer.__firstPassResult;
        };

        /**
         * Upload a packed GPU texture-set (the shape prepareGpuTextureTile(...) accepts) as the
         * standalone input. This is the only input path that can carry non-8-bit data — the
         * rasterizing path below goes through a 2D canvas and is unorm8 by construction.
         */
        runtime._setGpuTextureSetInput = async function(textureSet) {
            const result = await this.renderer.prepareGpuTextureTile({
                data: textureSet,
                textureOptions: { imageSmoothingEnabled: false }
            });

            if (!result || !result.ok) {
                const reason = (result && result.reason) || "unknown";
                throw new Error(`Standalone GPU texture-set input could not be prepared: ${reason}`);
            }

            this._clearInputTextures();

            this._inputState.colorTexture = result.texture;
            this._inputState.count = result.packCount || result.textureDepth || 1;
            this._inputState.width = result.width;
            this._inputState.height = result.height;
            this._inputState.normalized = result.normalized !== false;
            this._inputState.usePackIndex = true;
            this._inputState.key = `${result.width}x${result.height}:${this._inputState.count}:gpu`;

            // This runtime has no drawer and no world, so it plays the drawer's part in the
            // `precision: "auto"` negotiation itself. Before setDimensions, so a resolution
            // change reallocates the offscreen arrays once rather than twice.
            this.renderer.setDataCarriesHighPrecision(!this._inputState.normalized);

            this.renderer.setDimensions(0, 0, result.width, result.height,
                this._inputState.count, this._inputState.count);
        };

        runtime.setInputs = async function(inputs, options = {}) {
            const sourceList = Array.isArray(inputs) ? inputs.filter(Boolean) : (inputs ? [inputs] : []);

            if (sourceList.length === 1 && sourceList[0] && typeof sourceList[0] === "object" &&
                Array.isArray(sourceList[0].packs)) {
                await this._setGpuTextureSetInput(sourceList[0]);
                return;
            }

            // Everything below rasterizes through a 2D canvas, so it is unorm8 by construction —
            // state it, so a runtime reused after a float input releases the upgrade.
            this.renderer.setDataCarriesHighPrecision(false);

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
            this._inputState.normalized = true;
            this._inputState.usePackIndex = false;
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
            this.renderer.registerProgram(null, this.renderer.backend.secondPassProgramKey);
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

        // _options is accepted only so both standalone facades share an arity; this renderer draws
        // from raw inputs, it has no tiled images and therefore no load state to wait for.
        runtime.drawWithConfiguration = async function(inputs = undefined, configuration = undefined,
                                                      _view = undefined, size = undefined,
                                                      _options = undefined) {
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
                // Same backdrop the on-screen renderer uses, for the same reason.
                const [br, bg, bb, ba] = this.renderer.presentationClearColor;
                gl.clearColor(br, bg, bb, ba);
                gl.clear(gl.COLOR_BUFFER_BIT);

                this._renderFirstPass();

                const renderArray = this._buildRenderArray();
                if (!renderArray.length) {
                    throw new Error("Standalone renderer has no configured shader layers.");
                }

                this.renderer.renderSecondPass(renderArray);
                this.renderer.gl.finish();

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const presentationCanvas = this.renderer.getPresentationCanvas();
                canvas.width = presentationCanvas.width;
                canvas.height = presentationCanvas.height;
                ctx.drawImage(presentationCanvas, 0, 0);
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
                    width: opts.width || this.renderer.getRenderDimensions().width,
                    height: opts.height || this.renderer.getRenderDimensions().height,
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
