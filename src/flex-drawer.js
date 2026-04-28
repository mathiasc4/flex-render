(function( $ ){
    const OpenSeadragon = $;

    /**
     * @typedef {Object} TiledImageInfo
     * @property {Number} TiledImageInfo.id
     * @property {Number[]} TiledImageInfo.shaderOrder
     * @property {Object} TiledImageInfo.shaders
     * @property {Object} TiledImageInfo.drawers
     */

    /**
     * @property {Number} idGenerator unique ID getter
     *
     * @class OpenSeadragon.FlexDrawer
     * @classdesc implementation of WebGL renderer for an {@link OpenSeadragon.Viewer}
     */
    OpenSeadragon.FlexDrawer = class extends OpenSeadragon.DrawerBase {
        /**
         * @param {Object} options options for this Drawer
         * @param {OpenSeadragon.Viewer} options.viewer the Viewer that owns this Drawer
         * @param {OpenSeadragon.Viewport} options.viewport reference to Viewer viewport
         * @param {HTMLElement} options.element parent element
         * @param {[String]} options.debugGridColor see debugGridColor in {@link OpenSeadragon.Options} for details
         * @param {Object} options.options optional
         *
         * @constructor
         * @memberof OpenSeadragon.FlexDrawer
         */
        constructor(options){
            super(options);

            this._destroyed = false;
            this._imageSmoothingEnabled = false; // will be updated by setImageSmoothingEnabled
            this._configuredExternally = false;
            this._managedShaderSourceSlots = new Map();
            this._managedShaderSourceNextIndex = null;
            // We have 'undefined' extra format for blank tiles
            this._supportedFormats = ["rasterBlob", "context2d", "image", "vector-mesh", "gpuTextureSet", "undefined"];
            this.rebuildCounter = 0;

            this._suspendRenderingDepth = 0;
            this._pendingRebuildRequest = null;
            this._drawReady = false;

            // reject listening for the tile-drawing and tile-drawn events, which this drawer does not fire
            this.viewer.rejectEventHandler("tile-drawn", "The WebGLDrawer does not raise the tile-drawn event");
            this.viewer.rejectEventHandler("tile-drawing", "The WebGLDrawer does not raise the tile-drawing event");
            this.viewer.world.addHandler("remove-item", (e) => {
                const tiledImage = e.item;
                if (tiledImage && tiledImage.__flexManagedShaderSourceSlotKey) {
                    const slot = this._managedShaderSourceSlots.get(tiledImage.__flexManagedShaderSourceSlotKey);
                    if (slot && slot.item === tiledImage) {
                        slot.item = null;
                    }
                }
                // if managed internally on the instance (regardless of renderer state), handle removal
                if (tiledImage.__shaderConfig) {
                    this.renderer.removeShader(tiledImage.__shaderConfig.id);
                    delete tiledImage.__shaderConfig;
                    if (tiledImage.__wglCompositeHandler) {
                        tiledImage.removeHandler('composite-operation-change', tiledImage.__wglCompositeHandler);
                    }
                }
                // if now managed externally, just request rebuild, also updates order
                if (!this._configuredExternally) {
                    // Update keys
                    this._requestRebuild();
                }
            });
        } // end of constructor

        /**
         * Drawer type.
         * @returns {String}
         */
        getType() {
            return 'flex-renderer';
        }

        getSupportedDataFormats() {
            return this._supportedFormats;
        }

        getRequiredDataFormats() {
            return this._supportedFormats;
        }

        get defaultOptions() {
            return {
                usePrivateCache: true,
                preloadCache: true,
                copyShaderConfig: false,
                handleNavigator: true,
                shaderSourceResolver: null,
                // hex bg color, by default transparent
                backgroundColor: undefined
            };
        }

        /**
         * Override the default configuration: the renderer will use given shaders,
         * supplied with data from collection of TiledImages, to render.
         * TiledImages are treated only as data sources, the rendering outcome is fully in controls of the shader specs.
         * @param {Object.<string, ShaderConfig>} shaders map of id -> shader config value
         * @param {Array<string>} [shaderOrder=undefined] custom order of shader ids to render.
         * @param {Object} [options]
         * @param {Boolean} [options.immediate=false] if true, run the rebuild synchronously
         *      (program registration + dimensions update) instead of deferring via setTimeout.
         *      Required when the caller intends to draw immediately after configuring.
         * @return {OpenSeadragon.Promise} promise resolved when the renderer gets rebuilt
         */
        overrideConfigureAll(shaders, shaderOrder = undefined, options = {}) {
            // todo reset also when reordering tiled images!
            // or we could change order only

            if (this.options.handleNavigator && this.viewer.navigator) {
                this.viewer.navigator.drawer.overrideConfigureAll(shaders, shaderOrder, options);
            }

            const willBeConfigured = !!shaders;
            if (!willBeConfigured) {
                if (this._configuredExternally) {
                    this._configuredExternally = false;
                    // If we changed render style, recompile everything
                    this.renderer.deleteShaders();
                    return $.Promise.all(this.viewer.world._items.map(item => this.tiledImageCreated(item).id));
                }
                return $.Promise.resolve();
            }

            // If custom rendering used, use arbitrary external configuration
            this._configuredExternally = true;
            this.renderer.deleteShaders();

            const requestedOrder = shaderOrder || Object.keys(shaders);
            const createdOrder = [];

            for (const shaderId of requestedOrder) {
                const shader = this.renderer.createShaderLayer(shaderId, shaders[shaderId], true);
                if (shader) {
                    createdOrder.push(shaderId);
                }
            }
            this.renderer.setShaderLayerOrder(createdOrder);

            shaderOrder = shaderOrder || Object.keys(shaders);
            this.renderer.setShaderLayerOrder(shaderOrder);

            this.renderer.notifyVisualizationChanged({
                reason: "external-config",
                external: true
            });

            return this._requestRebuild(0, false, false, !!(options && options.immediate));
        }

        /**
         * Retrieve shader config by its key. Shader IDs are known only
         * when overrideConfigureAll() called
         * @param key
         * @return {ShaderConfig|*|undefined}
         */
        getOverriddenShaderConfig(key) {
            const shaderLayer = this.renderer.getAllShaders()[key];
            return shaderLayer ? shaderLayer.getConfig() : undefined;
        }

        /**
         * If shaders are managed internally, tiled image can be configured a single custom
         * shader if desired. This shader is ignored if overrideConfigureAll({...}) used.
         * @param {OpenSeadragon.TiledImage} tiledImage
         * @param {ShaderConfig} shader
         * @return {ShaderConfig} shader config used, a copy if options.copyShaderConfig is true, otherwise a modified argument
         */
        configureTiledImage(tiledImage, shader) {
            if (this.options.copyShaderConfig) {
                shader = $.extend(true, {}, shader);
            }

            shader.id = shader.id || (tiledImage.__shaderConfig && tiledImage.__shaderConfig.id) || this.constructor.idGenerator;
            tiledImage.__shaderConfig = shader;

            // if already configured, request re-configuration
            if (tiledImage.__wglCompositeHandler) {
                this.tiledImageCreated(tiledImage);
            }

            if (this.options.handleNavigator && this.viewer.navigator) {
                const nav = this.viewer.navigator;
                let tiledImageNavigator = null;
                for (let i = 0; i < nav.world.getItemCount(); i++) {
                    if (nav.world.getItemAt(i).source === tiledImage.source) {
                        tiledImageNavigator = nav.world.getItemAt(i);
                        break;
                    }
                }

                if (tiledImageNavigator) {
                    this.viewer.navigator.drawer.configureTiledImage(tiledImageNavigator, shader);
                } else {
                    $.console.warn("Could not find corresponding tiled image for the navigator!");
                }
            }

            this.renderer.notifyVisualizationChanged({
                reason: "configure-tiled-image",
                shaderId: shader.id
            });

            return shader;
        }

        /**
         * Register TiledImage into the system.
         * @param {OpenSeadragon.TiledImage} tiledImage
         * @return {OpenSeadragon.Promise} promise resolved when the renderer gets rebuilt
         */
        tiledImageCreated(tiledImage) {
            // Always attempt to clean up
            if (tiledImage.__wglCompositeHandler) {
                tiledImage.removeHandler('composite-operation-change', tiledImage.__wglCompositeHandler);
            }

            if (tiledImage.__flexManagedShaderSourceSlotKey) {
                return this._requestRebuild();
            }

            // If we configure externally the renderer, simply bypass
            if (this._configuredExternally) {
                // __shaderConfig reference is kept only when managed internally, can keep custom shader config for particular tiled image
                delete tiledImage.__shaderConfig;
                return this._requestRebuild();
            }

            let config = tiledImage.__shaderConfig;
            if (!config) {
                config = tiledImage.__shaderConfig = {
                    name: "Identity shader",
                    type: "identity",
                    visible: 1,
                    fixed: false,
                    params: {},
                    cache: {},
                };
            }

            if (!config.id) {
                // potentially problematic, relies on the fact that navigator is always initialized second
                // shared ID are required for controls, which have only 1 present HTML but potentially two listeners
                if (this._isNavigatorDrawer) {
                    const parent = this.viewer.viewer;
                    for (let i = 0; i < parent.world.getItemCount(); i++) {
                        const tiledImageParent = parent.world.getItemAt(i);
                        if (tiledImageParent.source === tiledImage.source) {
                            config.id = tiledImageParent.__shaderConfig.id;
                            break;
                        }
                    }
                }
                if (!config.id) {
                    // generate a unique ID for the shader
                    config.id = this.constructor.idGenerator;
                }
            }

            const shaderId = config.id;

            // When this._configuredExternally == false, the index is always self index, deduced dynamically
            const property = Object.getOwnPropertyDescriptor(config, 'tiledImages');
            if (!property || property.configurable) {
                delete config.tiledImages;

                // todo make custom renderer pass tiledImages as array of tiled images -> will deduce easily
                Object.defineProperty(config, "tiledImages", {
                    get: () => [this.viewer.world.getIndexOfItem(tiledImage)]
                });
            } // else already set as a getter


            if (!config.params.use_blend && tiledImage.compositeOperation) {
                // eslint-disable-next-line camelcase
                config.params.use_mode = 'blend';
                // eslint-disable-next-line camelcase
                config.params.use_blend = tiledImage.compositeOperation;
            }

            tiledImage.__wglCompositeHandler = e => {
                const shader = this.renderer.getShaderLayer(shaderId);
                const config = shader.getConfig();
                const operation = tiledImage.compositeOperation;
                if (operation) {
                    // eslint-disable-next-line camelcase
                    config.params.use_blend = operation;
                    // eslint-disable-next-line camelcase
                    config.params.use_mode = 'blend';
                } else {
                    // eslint-disable-next-line camelcase
                    delete config.params.use_blend;
                    // eslint-disable-next-line camelcase
                    config.params.use_mode = 'show';
                }
                shader.resetMode(config.params, true);
                this._requestRebuild(0);
            };

            tiledImage.addHandler('composite-operation-change', tiledImage.__wglCompositeHandler);

            // copy config only applied when passed externally
            this.renderer.createShaderLayer(shaderId, config, false);
            return this._requestRebuild();
        }

        /**
         * Rebuild current shaders to reflect updated configurations.
         * @return {Promise}
         */
        rebuild() {
            if (this.options.handleNavigator) {
                this.viewer.navigator.drawer.rebuild();
            }
            return this._requestRebuild();
        }

        _applyShaderConfigMutationRequest(request = {}, syncNavigator = true) {
            const {
                shaderId,
                mutation,
                refreshShader = true,
                rebuildProgram = true,
                rebuildDrawer = true,
                resetItems = true,
                reason = "shader-config-mutation"
            } = request;

            if (!shaderId) {
                return $.Promise.resolve();
            }

            const shader = this.renderer.getShaderLayer(shaderId);
            if (!shader) {
                return $.Promise.resolve();
            }

            const config = shader.getConfig();
            if (typeof mutation === "function") {
                mutation(config, shader);
            } else if (mutation && typeof mutation === "object") {
                Object.assign(config, mutation);
            }

            if (refreshShader) {
                this.renderer.refreshShaderLayer(shaderId, { rebuildProgram });
            } else if (rebuildProgram) {
                this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
            }

            this.renderer.notifyVisualizationChanged({
                reason,
                shaderId,
                shaderType: shader.constructor.type()
            });

            if (
                syncNavigator &&
                !request.drawerLocalWorldIndex &&
                this.options.handleNavigator &&
                this.viewer.navigator &&
                this.viewer.navigator.drawer
            ) {
                this.viewer.navigator.drawer._applyShaderConfigMutationRequest(request, false);
            }

            if (resetItems && this.viewer.world && typeof this.viewer.world.resetItems === "function") {
                this.viewer.world.resetItems();
            }

            if (rebuildDrawer) {
                return this._requestRebuild(0, true);
            }
            this.viewer.forceRedraw();
            return $.Promise.resolve();
        }

        _handleRefetchRequest(request = undefined) {
            if (!request) {
                return this.viewer.world.resetItems();
            }

            if (request.kind === "shader-source-request") {
                return this._handleShaderSourceRequest(request);
            }

            if (request.kind === "shader-config-mutation") {
                return this._applyShaderConfigMutationRequest(request);
            }

            return this.viewer.world.resetItems();
        }

        _getManagedShaderSourceSlotKey(request = {}) {
            return `${request.shaderId || "shader"}:${Number.parseInt(request.sourceIndex, 10) || 0}`;
        }

        _allocateManagedShaderSourceWorldIndex() {
            const worldCount = this.viewer && this.viewer.world ? this.viewer.world.getItemCount() : 0;
            if (!Number.isInteger(this._managedShaderSourceNextIndex)) {
                this._managedShaderSourceNextIndex = worldCount;
            } else {
                this._managedShaderSourceNextIndex = Math.max(this._managedShaderSourceNextIndex, worldCount);
            }
            return this._managedShaderSourceNextIndex++;
        }

        _isManagedShaderSourceDescriptor(entry) {
            return !!(entry && typeof entry === "object" && (
                entry.tileSource !== undefined ||
                entry.source !== undefined ||
                entry.open !== undefined ||
                entry.openOptions !== undefined
            ));
        }

        _normalizeManagedShaderSourceDescriptor(entry = {}) {
            const descriptor = $.extend(true, {}, entry);
            const openOptions = $.extend(true, {},
                descriptor.openOptions || descriptor.open || {}
            );
            const tileSource = descriptor.tileSource !== undefined ? descriptor.tileSource : descriptor.source;

            delete descriptor.openOptions;
            delete descriptor.open;
            delete descriptor.tileSource;
            delete descriptor.source;

            return {
                tileSource,
                openOptions,
                meta: descriptor
            };
        }

        _openManagedShaderSourceAtSlot(slot, descriptor, request = {}) {
            const normalized = this._normalizeManagedShaderSourceDescriptor(descriptor);
            if (normalized.tileSource === undefined) {
                return $.Promise.reject(new Error("Managed shader source descriptor requires tileSource or source."));
            }

            const shader = request.shaderId ? this.renderer.getShaderLayer(request.shaderId) : null;
            const sourceIndex = Number.parseInt(request.sourceIndex, 10) || 0;
            const referenceItem = shader && typeof shader.getSourceTiledImage === "function"
                ? shader.getSourceTiledImage(sourceIndex)
                : null;

            const openOptions = $.extend(true, {
                opacity: 0,
                preload: false,
                preserveViewport: true
            }, normalized.openOptions || {}, {
                tileSource: normalized.tileSource
            });

            delete openOptions.index;
            delete openOptions.replace;

            if (referenceItem) {
                const bounds = referenceItem.getBoundsNoRotate(true);

                if (openOptions.x === undefined && openOptions.y === undefined && !openOptions.position) {
                    openOptions.x = bounds.x;
                    openOptions.y = bounds.y;
                }

                if (openOptions.width === undefined && openOptions.height === undefined) {
                    openOptions.width = bounds.width;
                }

                if (openOptions.clip === undefined && referenceItem.getClip) {
                    const clip = referenceItem.getClip();
                    if (clip) {
                        openOptions.clip = clip;
                    }
                }

                if (openOptions.rotation === undefined && typeof referenceItem.getRotation === "function") {
                    openOptions.rotation = referenceItem.getRotation();
                }

                if (openOptions.flipped === undefined && typeof referenceItem.getFlip === "function") {
                    openOptions.flipped = referenceItem.getFlip();
                }
            }

            return new $.Promise((resolve, reject) => {
                const success = openOptions.success;
                const error = openOptions.error;

                openOptions.success = (event) => {
                    const item = event && event.item ? event.item : null;
                    const worldIndex = item && this.viewer.world
                        ? this.viewer.world.getIndexOfItem(item)
                        : -1;

                    if (item) {
                        item.__flexManagedShaderSourceSlotKey = slot.key;
                        slot.item = item;
                        slot.worldIndex = worldIndex;
                    }

                    if (typeof success === "function") {
                        success(event);
                    }

                    resolve({
                        worldIndex,
                        tiledImage: item
                    });
                };

                openOptions.error = (event) => {
                    if (typeof error === "function") {
                        error(event);
                    }
                    reject(new Error(event && event.message ? event.message : "Failed to open managed shader source."));
                };

                this.viewer.addTiledImage(openOptions);
            });
        }

        realizeShaderSourceDescriptor(request = {}, descriptor = undefined) {
            const entry = descriptor === undefined ? request.entry : descriptor;
            if (!this._isManagedShaderSourceDescriptor(entry)) {
                return $.Promise.resolve(null);
            }

            const slotKey = this._getManagedShaderSourceSlotKey(request);
            let slot = this._managedShaderSourceSlots.get(slotKey);
            if (!slot) {
                slot = {
                    key: slotKey,
                    worldIndex: this._allocateManagedShaderSourceWorldIndex(),
                    item: null
                };
                this._managedShaderSourceSlots.set(slotKey, slot);
            }

            return this._openManagedShaderSourceAtSlot(slot, entry, request).then(result => ({
                worldIndex: result.worldIndex,
                refreshShader: false,
                rebuildProgram: false,
                rebuildDrawer: true,
                resetItems: false,
                drawerLocalWorldIndex: true
            }));
        }

        _resolveSourceRequestResult(request, result) {
            if (result === undefined || result === null || result === false) {
                return null;
            }

            if (Number.isInteger(result)) {
                return {
                    mutation: (config) => {
                        const tiledImages = Array.isArray(config.tiledImages) ? config.tiledImages.slice() : [];
                        tiledImages[request.sourceIndex || 0] = result;
                        config.tiledImages = tiledImages;
                    }
                };
            }

            if (Array.isArray(result)) {
                return {
                    mutation: (config) => {
                        config.tiledImages = result.slice();
                    }
                };
            }

            if (typeof result === "object") {
                if (Array.isArray(result.tiledImages)) {
                    return {
                        ...result,
                        mutation: result.mutation || ((config) => {
                            config.tiledImages = result.tiledImages.slice();
                        })
                    };
                }
                if (Number.isInteger(result.worldIndex)) {
                    return {
                        ...result,
                        mutation: result.mutation || ((config) => {
                            const tiledImages = Array.isArray(config.tiledImages) ? config.tiledImages.slice() : [];
                            tiledImages[request.sourceIndex || 0] = result.worldIndex;
                            config.tiledImages = tiledImages;
                        })
                    };
                }
                if (typeof result.mutation === "function") {
                    return result;
                }
            }

            return null;
        }

        _handleShaderSourceRequest(request = {}) {
            const shader = request.shaderId ? this.renderer.getShaderLayer(request.shaderId) : null;
            if (!shader) {
                return $.Promise.resolve();
            }

            const directWorldIndex = Number.parseInt(request.entry, 10);
            if (Number.isFinite(directWorldIndex) && String(directWorldIndex) === String(request.entry).trim()) {
                return this._applyShaderConfigMutationRequest({
                    ...request,
                    kind: "shader-config-mutation",
                    mutation: (config) => {
                        const tiledImages = Array.isArray(config.tiledImages) ? config.tiledImages.slice() : [];
                        tiledImages[request.sourceIndex || 0] = directWorldIndex;
                        config.tiledImages = tiledImages;
                    },
                    reason: request.reason || "shader-source-request",
                    refreshShader: request.refreshShader !== false,
                    rebuildProgram: request.rebuildProgram !== false,
                    rebuildDrawer: request.rebuildDrawer !== false,
                    resetItems: request.resetItems !== false
                });
            }

            if (this._isManagedShaderSourceDescriptor(request.entry)) {
                return this.realizeShaderSourceDescriptor(request).then(resolved => {
                    if (!resolved) {
                        return $.Promise.resolve();
                    }
                    const mutationSpec = this._resolveSourceRequestResult(request, resolved);
                    if (!mutationSpec) {
                        return $.Promise.resolve();
                    }
                    return this._applyShaderConfigMutationRequest({
                        ...request,
                        ...resolved,
                        ...mutationSpec,
                        kind: "shader-config-mutation",
                        reason: request.reason || resolved.reason || "shader-source-request"
                    });
                });
            }

            const resolver = this.options.shaderSourceResolver;
            if (typeof resolver !== "function") {
                $.console.warn("Shader source request received but no drawer.options.shaderSourceResolver is configured.", request);
                return $.Promise.resolve();
            }

            const outcome = resolver({
                request,
                drawer: this,
                viewer: this.viewer,
                renderer: this.renderer,
                shader,
                shaderConfig: shader.getConfig()
            });

            return $.Promise.resolve(outcome).then(result => {
                if (this._isManagedShaderSourceDescriptor(result)) {
                    return this.realizeShaderSourceDescriptor(request, result).then(realized =>
                        realized ? (() => {
                            const mutationSpec = this._resolveSourceRequestResult(request, realized);
                            if (!mutationSpec) {
                                return $.Promise.resolve();
                            }
                            return this._applyShaderConfigMutationRequest({
                                ...request,
                                ...realized,
                                ...mutationSpec,
                                kind: "shader-config-mutation",
                                reason: request.reason || realized.reason || "shader-source-request"
                            });
                        })() : $.Promise.resolve()
                    );
                }

                const resolved = this._resolveSourceRequestResult(request, result);
                if (!resolved) {
                    return $.Promise.resolve();
                }

                return this._applyShaderConfigMutationRequest({
                    ...request,
                    ...resolved,
                    kind: "shader-config-mutation",
                    reason: request.reason || resolved.reason || "shader-source-request",
                    refreshShader: resolved.refreshShader !== false,
                    rebuildProgram: resolved.rebuildProgram !== false,
                    rebuildDrawer: resolved.rebuildDrawer !== false,
                    resetItems: resolved.resetItems !== false
                });
            });
        }

        /**
         * This methods can suspend viewer animation, for example when
         * you are still in the process of modifying the viewer state
         * and the viewer is forced to re-render unfinished configuration(s).
         * @param reason
         */
        suspendRendering(reason = "manual") {
            this._suspendRenderingDepth++;
            this._drawReady = false;
            if (this._rebuildHandle) {
                clearTimeout(this._rebuildHandle);
                this._rebuildHandle = null;
            }
        }

        resumeRendering(reason = "manual") {
            if (this._suspendRenderingDepth > 0) {
                this._suspendRenderingDepth--;
            }
            if (this._suspendRenderingDepth > 0) {
                return;
            }

            const pending = this._pendingRebuildRequest;
            this._pendingRebuildRequest = null;

            if (pending) {
                this._requestRebuild(pending.timeout, pending.force, true);
            } else {
                this._refreshDrawReadyState();
                this.viewer.forceRedraw();
            }
        }

        _isRenderingSuspended() {
            return this._suspendRenderingDepth > 0;
        }

        _refreshDrawReadyState() {
            const canvas = this.canvas;
            this._drawReady = !this._isRenderingSuspended() &&
                !!canvas &&
                canvas.width > 0 &&
                canvas.height > 0 &&
                !this._hasInvalidBuildState();
            return this._drawReady;
        }


        /**
         * Clean up the FlexDrawer, removing all resources.
         */
        destroy() {
            if (this._destroyed) {
                return;
            }
            const gl = this._gl;

            // clean all texture units; adapted from https://stackoverflow.com/a/23606581/1214731
            var numTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
            for (let unit = 0; unit < numTextureUnits; ++unit) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, null);

                if (this.webGLVersion === "2.0") {
                    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
                }
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);


            // this._renderingCanvas = null;
            let ext = gl.getExtension('WEBGL_lose_context');
            if (ext) {
                ext.loseContext();
            }
            // set our webgl context reference to null to enable garbage collection
            this._gl = null;

            // unbind our event listeners from the viewer
            this.viewer.removeHandler("resize", this._resizeHandler);

            if (!this.options.offScreen) {
                this.container.removeChild(this.canvas);
                if (this.viewer.drawer === this){
                    this.viewer.drawer = null;
                }
            }

            this.renderer.destroy();
            this.renderer = null;

            // set our destroyed flag to true
            this._destroyed = true;
        }

        // todo documment
        getPackCount(ti) {
            const world = this.viewer.world;
            if (!world) {
                return 1;
            }

            let tiledImage = ti;
            if (typeof ti === "number") {
                tiledImage = world.getItemAt(ti);
            }
            if (!tiledImage) {
                return 1;
            }

            return tiledImage.__flexPackCount || 1;
        }

        getChannelCount(ti) {
            const world = this.viewer.world;
            if (!world) {
                return 4;
            }

            let tiledImage = ti;
            if (typeof ti === "number") {
                tiledImage = world.getItemAt(ti);
            }
            if (!tiledImage) {
                return 4;
            }

            // fall back to packCount * 4, preserving old semantics
            if (typeof tiledImage.__flexChannelCount === "number") {
                return tiledImage.__flexChannelCount;
            }
            const pc = tiledImage.__flexPackCount || 1;
            return pc * 4;
        }

        _hasInvalidBuildState() {
            return this._requestBuildStamp > this._buildStamp;
        }

        _requestRebuild(timeout = 30, force = false, bypassSuspend = false, immediate = false) {
            this._requestBuildStamp = Date.now();
            this._drawReady = false;

            if (!bypassSuspend && this._isRenderingSuspended()) {
                const pending = this._pendingRebuildRequest || { timeout, force };
                pending.timeout = Math.min(pending.timeout, timeout);
                pending.force = pending.force || force;
                this._pendingRebuildRequest = pending;
                return $.Promise.resolve();
            }

            if (this._rebuildHandle) {
                if (!force && !immediate) {
                    return $.Promise.resolve();
                }
                clearTimeout(this._rebuildHandle);
                this._rebuildHandle = null;
            }

            const runRebuild = () => {
                if (this._isRenderingSuspended()) {
                    this._pendingRebuildRequest = { timeout: 0, force: true };
                    this._rebuildHandle = null;
                    this._drawReady = false;
                    return;
                }

                if (!this._configuredExternally) {
                    this.renderer.setShaderLayerOrder(this.viewer.world._items.map(item => item.__shaderConfig.id));
                }

                this._buildStamp = Date.now();
                this.renderer.setDimensions(
                    0,
                    0,
                    this.canvas.width,
                    this.canvas.height,
                    this._computeOffscreenLayerCount(),
                    this.viewer.world.getItemCount()
                );
                this._updatePackLayout();
                this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
                this.rebuildCounter++;
                this._rebuildHandle = null;
                this._refreshDrawReadyState();

                if (!immediate) {
                    setTimeout(() => {
                        if (!this._isRenderingSuspended()) {
                            this.viewer.forceRedraw();
                        }
                    });
                }
            };

            if (immediate) {
                runRebuild();
            } else {
                this._rebuildHandle = setTimeout(runRebuild, timeout);
            }

            return $.Promise.resolve();
        }

        /**
         * Initial setup of all three canvases used (output, rendering) and their contexts (2d, 2d, webgl)
         */
        _setupCanvases() {
            // this._outputCanvas = this.canvas; //canvas on screen
            // this._outputContext = this._outputCanvas.getContext('2d');

            // this._renderingCanvas = this.renderer.canvas; //canvas for webgl

            // this._renderingCanvas.width = this._outputCanvas.width;
            // this._renderingCanvas.height = this._outputCanvas.height;

            this._resizeHandler = () => {
                // if(this._outputCanvas !== this.viewer.drawer.canvas) {
                //     this._outputCanvas.style.width = this.viewer.drawer.canvas.clientWidth + 'px';
                //     this._outputCanvas.style.height = this.viewer.drawer.canvas.clientHeight + 'px';
                // }

                let viewportSize = this._calculateCanvasSize();
                if (this.debug) {
                    console.info('Resize event, newWidth, newHeight:', viewportSize.x, viewportSize.y);
                }

                // if( this._outputCanvas.width !== viewportSize.x ||
                //     this._outputCanvas.height !== viewportSize.y ) {
                //     this._outputCanvas.width = viewportSize.x;
                //     this._outputCanvas.height = viewportSize.y;
                // }

                // todo necessary?
                // this._renderingCanvas.style.width = this._outputCanvas.clientWidth + 'px';
                // this._renderingCanvas.style.height = this._outputCanvas.clientHeight + 'px';
                // this._renderingCanvas.width = this._outputCanvas.width;
                // this._renderingCanvas.height = this._outputCanvas.height;

                //todo batched?
                this.renderer.setDimensions(0, 0, viewportSize.x, viewportSize.y, this._computeOffscreenLayerCount(), this.viewer.world.getItemCount());
                this._size = viewportSize;
                this._refreshDrawReadyState();
            };
            this.viewer.addHandler("resize", this._resizeHandler);
        }

        _resolveRenderView(view = undefined) {
            if (view) {
                return view;
            }

            const bounds = this.viewport.getBoundsNoRotateWithMargins(true);
            return {
                bounds: bounds,
                center: new OpenSeadragon.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
                rotation: this.viewport.getRotation(true) * Math.PI / 180,
                zoom: this.viewport.getZoom(true)
            };
        }

        /**
         * Build the current second-pass uniform payload for a set of shaders.
         * The returned array is backend-neutral input for `renderer.secondPassProcessData(...)`
         * and `renderer.renderSecondPassToTexture(...)`.
         * @param {Object} [view=undefined]
         * @param {Object.<string, ShaderLayer>} [shaderMap=this.renderer.getAllShaders()]
         * @param {string[]} [shaderOrder=this.renderer.getShaderLayerOrder()]
         * @return {SPRenderPackage[]}
         */
        getCurrentShaderRenderArray(view = undefined, shaderMap = undefined, shaderOrder = undefined) {
            view = this._resolveRenderView(view);
            shaderMap = shaderMap || this.renderer.getAllShaders();
            shaderOrder = shaderOrder || this.renderer.getShaderLayerOrder();
            return this._collectShaderUniforms(shaderMap, shaderOrder, view);
        }

        /**
         * Render the current visualization into an offscreen target using the active backend's
         * `renderSecondPassToTexture(...)` implementation.
         *
         * This is the public drawer-level convenience wrapper for callers that want a texture
         * result but do not want to assemble the second-pass render array themselves.
         *
         * @param {Object} [options]
         * @return {Object}
         */
        renderVisualizationToTexture(options = {}) {
            const view = this._resolveRenderView(options.view);
            const shaderMap = options.shaderMap || this.renderer.getAllShaders();
            const shaderOrder = options.shaderOrder || this.renderer.getShaderLayerOrder();
            const renderArray = this._collectShaderUniforms(shaderMap, shaderOrder, view);
            return this.renderer.renderSecondPassToTexture(renderArray, options);
        }

        /**
         * Drawer-level convenience API for updating the renderer-owned inspector state.
         *
         * The drawer does not implement inspector rendering itself and does not synchronize
         * inspector state to the navigator. Backend implementations must consume the state
         * through `renderer.getInspectorState()`.
         *
         * @param {Partial<InspectorState>|undefined} state
         * @return {InspectorState}
         */
        setInspectorState(state) {
            return this.renderer.setInspectorState(state, {
                reason: "drawer-set-inspector-state"
            });
        }

        /**
         * Reset inspector state through the renderer-owned API.
         *
         * @return {InspectorState}
         */
        clearInspectorState() {
            return this.setInspectorState(undefined);
        }

        // DRAWING METHODS
        /**
         * Draw using FlexRenderer.
         * @param {[TiledImage]} tiledImages array of TiledImage objects to draw
         * @param {Object} [view=undefined] custom view position if desired
         * @param view.bounds {OpenSeadragon.Rect} bounds of the viewport
         * @param view.center {OpenSeadragon.Point} center of the viewport
         * @param view.rotation {Number} rotation of the viewport
         * @param view.zoom {Number} zoom of the viewport
         */
        draw(tiledImages, view = undefined) {
            if (!this._drawReady && !this._refreshDrawReadyState()) {
                this.viewer.forceRedraw();
                return;
            }

            const bounds = this.viewport.getBoundsNoRotateWithMargins(true);
            view = view || {
                bounds: bounds,
                center: new OpenSeadragon.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
                rotation: this.viewport.getRotation(true) * Math.PI / 180,
                zoom: this.viewport.getZoom(true)
            };

            // TODO consider sending data and computing on GPU
            // calculate view matrix for viewer
            let flipMultiplier = this.viewport.flipped ? -1 : 1;
            let posMatrix = $.Mat3.makeTranslation(-view.center.x, -view.center.y);
            let scaleMatrix = $.Mat3.makeScaling(2 / view.bounds.width * flipMultiplier, -2 / view.bounds.height);
            let rotMatrix = $.Mat3.makeRotation(-view.rotation);
            let viewMatrix = scaleMatrix.multiply(rotMatrix).multiply(posMatrix);

            this._ensurePackLayout();

            if (this._drawTwoPassFirst(tiledImages, view, viewMatrix)) {
                this._drawTwoPassSecond(view);
            }
        } // end of function

        /**
         * During the first-pass draw all tiles' data sources into the corresponding off-screen textures using identity rendering,
         * excluding any image-processing operations or any rendering customizations.
         * @param {OpenSeadragon.TiledImage[]} tiledImages array of TiledImage objects to draw
         * @param {Object} viewport has bounds, center, rotation, zoom
         * @param {OpenSeadragon.Mat3} viewMatrix
         */
        _drawTwoPassFirst(tiledImages, viewport, viewMatrix) {
            // FIRST PASS (render things as they are into the corresponding off-screen textures)
            const TI_PAYLOAD = [];

            for (let tiledImageIndex = 0; tiledImageIndex < tiledImages.length; tiledImageIndex++) {
                const tiledImage = tiledImages[tiledImageIndex];
                const payload = [];
                const vecPayload = [];

                const tilesToDraw = tiledImage.getTilesToDraw();

                // rendering in 4 overlapping groups of non-overlapping tiles so the depth value stays relatively small
                // TODO: move the tile ordering elsewhere to reduce amount of time spent recomputing it - possibly to TiledImage
                tilesToDraw.sort(
                    (entryA, entryB) => {
                        let levelA = entryA.tile.level;
                        let levelOrderA = 2 * (entryA.tile.y % 2) + (entryA.tile.x % 2);

                        let levelB = entryB.tile.level;
                        let levelOrderB = 2 * (entryB.tile.y % 2) + (entryB.tile.x % 2);

                        if (levelA === levelB) {
                            return levelOrderB - levelOrderA;
                        }

                        return levelB - levelA;
                    }
                );

                let overallMatrix = viewMatrix;
                let imageRotation = tiledImage.getRotation(true);
                // if needed, handle the tiledImage being rotated

                // todo consider in-place multiplication, this creates insane amout of arrays
                if (imageRotation % 360 !== 0) {
                    let imageRotationMatrix = $.Mat3.makeRotation(-imageRotation * Math.PI / 180);
                    let imageCenter = tiledImage.getBoundsNoRotate(true).getCenter();
                    let t1 = $.Mat3.makeTranslation(imageCenter.x, imageCenter.y);
                    let t2 = $.Mat3.makeTranslation(-imageCenter.x, -imageCenter.y);

                    // update the view matrix to account for this image's rotation
                    let localMatrix = t1.multiply(imageRotationMatrix).multiply(t2);
                    overallMatrix = viewMatrix.multiply(localMatrix);
                }

                if (tiledImage.getOpacity() > 0 && tilesToDraw.length > 0) {
                    // TODO support placeholder?
                    // if (tiledImage.placeholderFillStyle && tiledImage._hasOpaqueTile === false) {
                    //     this._drawPlaceholder(tiledImage);
                    // }

                    for (let tileIndex = 0; tileIndex < tilesToDraw.length; ++tileIndex) {
                        const tile = tilesToDraw[tileIndex].tile;

                        const tileInfo = this.getDataToDraw(tile);
                        if (!tileInfo) {
                            //TODO consider drawing some error if the tile is in erroneous state
                            continue;
                        }

                        const transformMatrix = this._updateTileMatrix(tileInfo, tile, tiledImage, overallMatrix);

                        if (tileInfo.texture) {
                            payload.push({
                                transformMatrix,
                                dataIndex: tiledImage.__flexBaseLayer || tiledImageIndex, // color layer index
                                stencilIndex: tiledImageIndex,
                                texture: tileInfo.texture,
                                position: tileInfo.position,
                                tile: tile
                            });
                        } else if (tileInfo.vectors) {
                            // Flatten fill + line meshes into a simple draw list

                            if (tileInfo.vectors.fills) {
                                tileInfo.vectors.fills.matrix = transformMatrix;
                            }
                            if (tileInfo.vectors.lines) {
                                tileInfo.vectors.lines.matrix = transformMatrix;
                            }
                            if (tileInfo.vectors.points) {
                                tileInfo.vectors.points.matrix = transformMatrix;
                            }
                            if (tileInfo.vectors.icons) {
                                tileInfo.vectors.icons.matrix = transformMatrix;
                            }

                            vecPayload.push(tileInfo.vectors);
                        }
                    }
                }

                let polygons;

                //TODO: osd could cache this.getBoundsNoRotate(current) which might be fired many times in rendering (possibly also other parts)
                if (tiledImage._croppingPolygons) {
                    polygons = tiledImage._croppingPolygons.map(polygon => polygon.flatMap(coord => {
                        let point = tiledImage.imageToViewportCoordinates(coord.x, coord.y, true);
                        return [point.x, point.y];
                    }));
                } else {
                    polygons = [];
                }

                if (tiledImage._clip) {
                    const polygon = [
                        {x: tiledImage._clip.x, y: tiledImage._clip.y},
                        {x: tiledImage._clip.x + tiledImage._clip.width, y: tiledImage._clip.y},
                        {x: tiledImage._clip.x + tiledImage._clip.width, y: tiledImage._clip.y + tiledImage._clip.height},
                        {x: tiledImage._clip.x, y: tiledImage._clip.y + tiledImage._clip.height},
                    ];
                    polygons.push(polygon.flatMap(coord => {
                        let point = tiledImage.imageToViewportCoordinates(coord.x, coord.y, true);
                        return [point.x, point.y];
                    }));
                }

                const packCount = tiledImage.__flexPackCount || 1;
                const baseLayer =
                    (typeof tiledImage.__flexBaseLayer === "number") ? tiledImage.__flexBaseLayer : tiledImageIndex;

                for (let packIndex = 0; packIndex < packCount; packIndex++) {
                    TI_PAYLOAD.push({
                        tiles: payload,
                        vectors: vecPayload,
                        polygons: polygons,
                        dataIndex: baseLayer + packIndex,
                        stencilIndex: tiledImageIndex,
                        packIndex: packIndex,
                        _temp: overallMatrix, // todo dirty
                    });
                }
            }

            // todo flatten render data

            this.renderer.gl.clearColor(1.0, 1.0, 1.0, 1.0);
            this.renderer.gl.clear(this.renderer.gl.COLOR_BUFFER_BIT); // This ensures that areas that are not drawn into do not show old data

            this.renderer.firstPassProcessData(TI_PAYLOAD);
            return true;
        }

        /**
         * Collects shader layer variables (opacity, pixelSize, zoom) into one flat array,
         * group shader layers are followed by their child layers in the order specified by the group
         * @param shaders
         * @param shaderOrder
         * @param viewport
         * @returns {*[]}
         * @private
         */
        _collectShaderUniforms(shaders, shaderOrder, viewport) {
            const sources = [];
            const flatShaders = this.renderer.getFlatShaderLayers(shaders, shaderOrder);

            for (const shader of flatShaders) {
                const config = shader.getConfig();
                const hasSources = Array.isArray(config.tiledImages) && config.tiledImages.length > 0;
                const tiledImage = hasSources ? this.viewer.world.getItemAt(config.tiledImages[0]) : null;

                sources.push({
                    zoom: viewport.zoom,
                    pixelSize: tiledImage ? this._tiledImageViewportToImageZoom(tiledImage, viewport.zoom) : 1,
                    opacity: tiledImage ? tiledImage.getOpacity() : 1,
                    shader: shader,
                });
            }

            return sources;
        }

        /**
         * During the second-pass draw from the off-screen textures into the rendering canvas,
         * applying the image-processing operations and rendering customizations.
         * @param {Object} viewport has bounds, center, rotation, zoom
         */
        _drawTwoPassSecond(viewport) {
            const sources = this._collectShaderUniforms(this.renderer.getAllShaders(), this.renderer.getShaderLayerOrder(), viewport);

            if (!sources.length) {
                this.viewer.forceRedraw();
                return false;
            }

            this.renderer.secondPassProcessData(sources);
            this.renderer.gl.finish();
            return true;
        }

        _getTileRenderMeta(tile, tiledImage) {
            let result = tile._renderStruct;
            if (result) {
                return result;
            }

            // Overlap fraction of tile if set
            let overlap = tiledImage.source.tileOverlap;
            if (overlap > 0) {
                let nativeWidth = tile.sourceBounds.width; // in pixels
                let nativeHeight = tile.sourceBounds.height; // in pixels
                let overlapWidth  = (tile.x === 0 ? 0 : overlap) + (tile.isRightMost ? 0 : overlap); // in pixels
                let overlapHeight = (tile.y === 0 ? 0 : overlap) + (tile.isBottomMost ? 0 : overlap); // in pixels
                let widthOverlapFraction = overlap / (nativeWidth + overlapWidth); // as a fraction of image including overlap
                let heightOverlapFraction = overlap / (nativeHeight + overlapHeight); // as a fraction of image including overlap
                tile._renderStruct = result = {
                    overlapX: widthOverlapFraction,
                    overlapY: heightOverlapFraction
                };
            } else {
                tile._renderStruct = result = {
                    overlapX: 0,
                    overlapY: 0
                };
            }

            return result;
        }

        /**
         * Get transform matrix that will be applied to tile.
         */
        _updateTileMatrix(tileInfo, tile, tiledImage, viewMatrix){
            let tileMeta = this._getTileRenderMeta(tile, tiledImage);
            let xOffset = tile.positionedBounds.width * tileMeta.overlapX;
            let yOffset = tile.positionedBounds.height * tileMeta.overlapY;

            let x = tile.positionedBounds.x + (tile.x === 0 ? 0 : xOffset);
            let y = tile.positionedBounds.y + (tile.y === 0 ? 0 : yOffset);
            let right = tile.positionedBounds.x + tile.positionedBounds.width - (tile.isRightMost ? 0 : xOffset);
            let bottom = tile.positionedBounds.y + tile.positionedBounds.height - (tile.isBottomMost ? 0 : yOffset);

            const model = new $.Mat3([
                right - x, 0, 0, // sx = width
                0, bottom - y, 0, // sy = height
                x, y, 1
            ]);

            if (tile.flipped) {
                // For documentation:
                // // - flips the tile so that we see it's back
                // const flipLeftAroundTileOrigin = $.Mat3.makeScaling(-1, 1);
                // //  tile's geometry stays the same so when looking at it's back we gotta reverse the logic we would normally use
                // const moveRightAfterScaling = $.Mat3.makeTranslation(-1, 0);
                // matrix = matrix.multiply(flipLeftAroundTileOrigin).multiply(moveRightAfterScaling);

                //Optimized:
                model.scaleAndTranslateSelf(-1, 1, 1, 0);
            }

            model.scaleAndTranslateOtherSetSelf(viewMatrix);
            return model.values;
        }

        /**
         * Get pixel size value.
         */
        _tiledImageViewportToImageZoom(tiledImage, viewportZoom) {
            var ratio = tiledImage._scaleSpring.current.value *
                tiledImage.viewport._containerInnerSize.x /
                tiledImage.source.dimensions.x;
            return ratio * viewportZoom;
        }

        //todo: this could be called only on change of TI, not each frame!
        _updatePackLayout() {
            const world = this.viewer.world;
            const itemCount = world.getItemCount();

            let baseLayer = [];
            let packCount = [];
            let total = 0;

            for (let i = 0; i < itemCount; i++) {
                const ti = world.getItemAt(i);
                const pc = ti && ti.__flexPackCount ? ti.__flexPackCount : 1;
                baseLayer[i] = total;
                packCount[i] = pc;
                total += pc;
                ti.__flexBaseLayer = baseLayer[i];
            }

            if (!this.renderer.__flexPackInfo) {
                this.renderer.__flexPackInfo = { packCount: [], channelCount: [] };
            }
            this.renderer.__flexPackInfo.layout = {
                baseLayer: baseLayer,
                packCount: packCount,
                totalLayers: total
            };

            // TODO: is this refreshing logic necessary?
            //  this.renderer.__flexPackInfo.version =
            //     (this.renderer.__flexPackInfo.version || 0) + 1;
        }

        /**
         * @returns {Boolean} true
         */
        canRotate() {
            return true;
        }

        /**
         * @returns {Boolean} true if canvas and webgl are supported
         */
        static isSupported(options = {}) {
            const rendererClass = $.FlexRenderer;
            if (rendererClass && typeof rendererClass.ensureRuntimeSupport === "function") {
                try {
                    return !!rendererClass.ensureRuntimeSupport({
                        webGLPreferredVersion: options.webGLPreferredVersion || "2.0",
                        force: options.force === true,
                        throwOnFailure: false,
                        debug: !!options.debug,
                    }).ok;
                } catch (e) {
                    return false;
                }
            }

            let canvasElement = document.createElement('canvas');
            let webglContext = $.isFunction(canvasElement.getContext) &&
                canvasElement.getContext('webgl');
            let ext = webglContext && webglContext.getExtension('WEBGL_lose_context');
            if (ext) {
                ext.loseContext();
            }
            return !!(webglContext);
        }

        /**
         * Creates an HTML element into which will be drawn.
         * @private
         * @returns {HTMLCanvasElement} the canvas to draw into
         */
        _createDrawingElement() {
            // Navigator has viewer parent reference
            // todo: what about reference strip??
            this._isNavigatorDrawer = !!this.viewer.viewer;
            if (this._isNavigatorDrawer) {
                this.options.debug = false;
                this.options.handleNavigator = false;
            }

            // todo better handling, build-in ID does not comply to syntax... :/
            this._id = this.constructor.idGenerator;

            // SETUP FlexRenderer
            const rendererOptions = $.extend(
                // Default
                {
                    debug: false,
                    webGLPreferredVersion: "2.0",
                },
                // User-defined
                this.options,
                // Required
                {
                    redrawCallback: () => this.viewer.forceRedraw(),
                    refetchCallback: (request) => this._handleRefetchRequest(request),
                    uniqueId: "osd_" + this._id,
                    // TODO: problem when navigator renders first
                    // Navigator must not have the handler since it would attempt to define the controls twice
                    htmlHandler: this._isNavigatorDrawer ? null : this.options.htmlHandler,
                    // However, navigator must have interactive same as parent renderer to bind events to the controls
                    interactive: this._isNavigatorDrawer ? false : !!this.options.htmlHandler,
                    canvasOptions: {
                        stencil: true
                    }
                });
            this.renderer = new $.FlexRenderer(rendererOptions);

            this.renderer.setDataBlendingEnabled(true); // enable alpha blending
            this.webGLVersion = this.renderer.webglVersion;
            this.debug = rendererOptions.debug;

            const canvas = this.renderer.canvas;
            let viewportSize = this._calculateCanvasSize();

            // SETUP CANVASES
            this._gl = this.renderer.gl;
            this._setupCanvases();

            canvas.width = viewportSize.x;
            canvas.height = viewportSize.y;
            this._refreshDrawReadyState();
            return canvas;
        }


        /**
         * Sets whether image smoothing is enabled or disabled.
         * @param {Boolean} enabled if true, uses gl.LINEAR as the TEXTURE_MIN_FILTER and TEXTURE_MAX_FILTER, otherwise gl.NEAREST
         */
        setImageSmoothingEnabled(enabled){
            if( this._imageSmoothingEnabled !== enabled ){
                this._imageSmoothingEnabled = enabled;
                this.setInternalCacheNeedsRefresh();
                this.viewer.requestInvalidate(false);
            }
        }

        internalCacheCreate(cache, tile) {
            const tiledImage = tile.tiledImage;
            const normalized = this._normalizeCacheData(cache);

            return this.createTileInfoFromSource({
                data: normalized.data,
                type: normalized.type,
                tile,
                tiledImage
            }).catch(e => {
                $.console.error(`Unsupported data type! ${normalized.data}`, e);
            });
        }

        async createTileInfoFromSource({ data, type, tile, tiledImage }) {
            const gl = this._gl;

            if (type === "undefined") {
                return null;
            }

            if (type === "vector-mesh" || (data && (data.fills || data.lines || data.points))) {
                return this._buildVectorTileInfo(data, gl);
            }

            const isGpuTextureSet = data &&
                typeof data.getType === "function" &&
                data.getType() === "gpuTextureSet";

            if (isGpuTextureSet) {
                const tileInfo = this._buildGpuTextureTileInfo(data, tile, tiledImage, gl);

                if (this._packLayoutDirty) {
                    // TODO: is this refreshing logic necessary?
                    //  this._refreshPackLayoutNow();
                    this._packLayoutDirty = false;
                    this._requestRebuild();
                }

                return tileInfo;
            }

            return this._buildBitmapTileInfo(data, tile, tiledImage, gl);
        }

        // _refreshPackLayoutNow() {
        //     this._updatePackLayout();
        //     this._packLayoutDirty = false;
        // }

        /**
         * Compute normalized tile texture coordinates (UVs) in source image space,
         * including overlap trimming. Works for both normal images and gpuTextureSet.
         */
        _computeTilePosition(tile, tiledImage, dataWidth, dataHeight) {
            let sourceWidthFraction, sourceHeightFraction;

            if (tile.sourceBounds) {
                sourceWidthFraction = Math.min(tile.sourceBounds.width, dataWidth) / dataWidth;
                sourceHeightFraction = Math.min(tile.sourceBounds.height, dataHeight) / dataHeight;
            } else {
                sourceWidthFraction = 1;
                sourceHeightFraction = 1;
            }

            const overlap = tiledImage.source.tileOverlap;
            if (overlap > 0) {
                // calculate the normalized position of the rect to actually draw
                // discarding overlap.
                const tileMeta = this._getTileRenderMeta(tile, tiledImage);

                const left   = (tile.x === 0 ? 0 : tileMeta.overlapX) * sourceWidthFraction;
                const top    = (tile.y === 0 ? 0 : tileMeta.overlapY) * sourceHeightFraction;
                const right  = (tile.isRightMost ? 1 : 1 - tileMeta.overlapX) * sourceWidthFraction;
                const bottom = (tile.isBottomMost ? 1 : 1 - tileMeta.overlapY) * sourceHeightFraction;

                return new Float32Array([
                    left, bottom,
                    left, top,
                    right, bottom,
                    right, top
                ]);
            } else {
                return new Float32Array([
                    0, sourceHeightFraction,
                    0, 0,
                    sourceWidthFraction, sourceHeightFraction,
                    sourceWidthFraction, 0
                ]);
            }
        }

        _ensurePackLayout() {
            if (this._packLayoutDirty) {
                this._updatePackLayout();
                this._packLayoutDirty = false;
            }
        }

        _computeOffscreenLayerCount() {
            const world = this.viewer.world;
            const items = world._items || [];
            let total = 0;

            for (let i = 0; i < items.length; i++) {
                const ti = items[i];
                const packCount = ti && ti.__flexPackCount ? ti.__flexPackCount : 1;
                total += packCount;
            }

            return Math.max(total, 1);
        }

        internalCacheFree(data) {
            if (!data) {
                return;
            }
            if (data.texture) {
                this._gl.deleteTexture(data.texture);
                data.texture = null;
            }
            if (data.vectors) {
                const gl = this._gl;
                if (data.vectors.fills) {
                    gl.deleteBuffer(data.vectors.fills.vboPos);
                    gl.deleteBuffer(data.vectors.fills.vboCol);
                    gl.deleteBuffer(data.vectors.fills.ibo);
                }
                if (data.vectors.lines) {
                    gl.deleteBuffer(data.vectors.lines.vboPos);
                    gl.deleteBuffer(data.vectors.lines.vboCol);
                    gl.deleteBuffer(data.vectors.lines.ibo);
                }
                if (data.vectors.points) {
                    gl.deleteBuffer(data.vectors.points.vboPos);
                    gl.deleteBuffer(data.vectors.points.vboCol);
                    gl.deleteBuffer(data.vectors.points.ibo);
                }
                if (data.vectors.icons) {
                    gl.deleteBuffer(data.vectors.icons.vboPos);
                    gl.deleteBuffer(data.vectors.icons.vboCol);
                    gl.deleteBuffer(data.vectors.icons.ibo);
                }
                data.vectors = null;
            }
        }

        // inside OpenSeadragon.FlexDrawer

        _normalizeCacheData(cache) {
            if (!cache || cache.type === "undefined") {
                return { type: "undefined", data: null };
            }

            let data = cache.data;
            if (data instanceof CanvasRenderingContext2D) {
                data = data.canvas;
            }

            return {
                type: cache.type,
                data
            };
        }

        _updatePackMetadata(tiledImage, packCount, channelCount) {
            if (!tiledImage) {
                return;
            }

            const metadataWasReady = !!tiledImage.__flexMetadataReady;
            let metadataChanged = !metadataWasReady;

            if (tiledImage.__flexPackCount !== packCount) {
                tiledImage.__flexPackCount = packCount;
                this._packLayoutDirty = true;
                metadataChanged = true;
            }
            if (tiledImage.__flexChannelCount !== channelCount) {
                tiledImage.__flexChannelCount = channelCount;
                this._packLayoutDirty = true;
                metadataChanged = true;
            }
            tiledImage.__flexMetadataReady = true;

            if (this.renderer && !this.renderer.__flexPackInfo) {
                this.renderer.__flexPackInfo = {
                    packCount: [],
                    channelCount: [],
                };
            }

            if (this.renderer && this.renderer.__flexPackInfo && this.viewer.world) {
                const tiIndex = this.viewer.world.getIndexOfItem(tiledImage);
                if (tiIndex >= 0) {
                    this.renderer.__flexPackInfo.packCount[tiIndex] = packCount;
                    this.renderer.__flexPackInfo.channelCount[tiIndex] = channelCount;
                }
            }

            if (metadataChanged) {
                this._refreshShadersForTiledImage(tiledImage);
            }
        }

        _refreshShadersForTiledImage(tiledImage) {
            if (!this.renderer || !this.viewer || !this.viewer.world || !tiledImage) {
                return;
            }

            const tiIndex = this.viewer.world.getIndexOfItem(tiledImage);
            if (tiIndex < 0) {
                return;
            }

            const idsToRefresh = [];
            this.renderer.forEachShaderLayer(undefined, undefined, shader => {
                const config = shader.getConfig();
                if (config && Array.isArray(config.tiledImages) && config.tiledImages.includes(tiIndex)) {
                    idsToRefresh.push(shader.id);
                }
            });

            if (!idsToRefresh.length) {
                return;
            }

            for (const shaderId of idsToRefresh) {
                this.renderer.refreshShaderLayer(shaderId, { rebuildProgram: false });
            }

            this._requestRebuild(0, true);
        }

        _buildVectorTileInfo(data, gl) {
            const tileInfo = {
                position: null,
                texture: null,
                vectors: {}
            };

            const buildBatch = (meshes) => {
                let vCount = 0,
                    iCount = 0;
                for (const m of meshes) {
                    vCount += (m.vertices.length / 4);
                    iCount += m.indices.length;
                }

                const positions = new Float32Array(vCount * 4);
                const parameters = new Float32Array(vCount * 4);
                const indices = new Uint32Array(iCount);

                let vOfs = 0,
                    iOfs = 0,
                    baseVertex = 0;

                for (const m of meshes) {
                    positions.set(m.vertices, vOfs * 4);

                    // fill color per-vertex (constant per feature)
                    const rgba = m.color ? m.color : [0, 0, 0, 1];
                    const r = Math.max(0.0, Math.min(1.0, rgba[0]));
                    const g = Math.max(0.0, Math.min(1.0, rgba[1]));
                    const b = Math.max(0.0, Math.min(1.0, rgba[2]));
                    const a = Math.max(0.0, Math.min(1.0, rgba[3]));
                    for (let k = 0; k < (m.vertices.length / 4); k++) {
                        const pOfs = (vOfs + k) * 4;
                        parameters[pOfs + 0] = r;
                        parameters[pOfs + 1] = g;
                        parameters[pOfs + 2] = b;
                        parameters[pOfs + 3] = a;
                    }

                    // if parameters are specified from mesh
                    if (m.parameters) {
                        parameters.set(m.parameters, vOfs * 4);
                    }

                    // rebase indices
                    for (let k = 0; k < m.indices.length; k++) {
                        indices[iOfs + k] = baseVertex + m.indices[k];
                    }

                    vOfs += (m.vertices.length / 4);
                    iOfs += m.indices.length;
                    baseVertex += (m.vertices.length / 4);
                }

                // Upload once
                const vboPos = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
                gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

                const vboParam = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, vboParam);
                gl.bufferData(gl.ARRAY_BUFFER, parameters, gl.STATIC_DRAW);

                const ibo = gl.createBuffer();
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

                return { vboPos, vboParam, ibo, count: indices.length };
            };

            if (data.fills && data.fills.length) {
                tileInfo.vectors.fills = buildBatch(data.fills);
            }
            if (data.lines && data.lines.length) {
                tileInfo.vectors.lines = buildBatch(data.lines);
            }
            if (data.points && data.points.length) {
                tileInfo.vectors.points = buildBatch(data.points);
            }
            if (data.icons && data.icons.length) {
                tileInfo.vectors.icons = buildBatch(data.icons);
            }

            return tileInfo;
        }

        _buildGpuTextureTileInfo(gpu, tile, tiledImage, gl) {
            const width = gpu.width;
            const height = gpu.height;
            const packs = gpu.packs || [];
            const packCount = packs.length || 1;
            const channelCount = gpu.channelCount || packCount * 4;

            this._updatePackMetadata(tiledImage, packCount, channelCount);

            const tileInfo = {
                position: this._computeTilePosition(tile, tiledImage, width, height),
                texture: null,
                vectors: undefined,
            };

            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);

            const firstFmt = (packs[0] && packs[0].format) || "RGBA8";
            const internalFormat = (firstFmt === "RGBA16F") ? gl.RGBA16F : gl.RGBA8;
            const format = gl.RGBA;
            const type = (firstFmt === "RGBA16F") ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, internalFormat, width, height, packCount);

            for (let layer = 0; layer < packCount; layer++) {
                const pack = packs[layer];
                if (!pack) {
                    continue;
                }

                gl.texSubImage3D(
                    gl.TEXTURE_2D_ARRAY,
                    0,
                    0, 0, layer,
                    width, height, 1,
                    format,
                    type,
                    pack.data
                );
            }

            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            tileInfo.texture = texture;
            return tileInfo;
        }

        async _buildBitmapTileInfo(data, tile, tiledImage, gl) {
            // if (!tiledImage.isTainted()) {
            // todo tained data handle
            // if((data instanceof CanvasRenderingContext2D) && $.isCanvasTainted(data.canvas)){
            //     tiledImage.setTainted(true);
            //     $.console.warn('WebGL cannot be used to draw this TiledImage because it has tainted data. Does crossOriginPolicy need to be set?');
            //     this._raiseDrawerErrorEvent(tiledImage, 'Tainted data cannot be used by the WebGLDrawer. Falling back to CanvasDrawer for this TiledImage.');
            //     this.setInternalCacheNeedsRefresh();
            // } else {

            const bitmap = await createImageBitmap(data);

            const width = bitmap.width;
            const height = bitmap.height;

            this._updatePackMetadata(tiledImage, 1, 4);

            const tileInfo = {
                position: this._computeTilePosition(tile, tiledImage, width, height),
                texture: null,
                vectors: undefined,
            };

            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);

            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, width, height, 1);
            gl.texSubImage3D(
                gl.TEXTURE_2D_ARRAY,
                0,
                0, 0, 0,
                width, height, 1,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                bitmap
            );

            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            tileInfo.texture = tex;
            return tileInfo;
        }

        _setClip(){
            // no-op: called, handled during rendering from tiledImage data
        }
    };

    OpenSeadragon.FlexDrawer._idGenerator = 0;
    Object.defineProperty(OpenSeadragon.FlexDrawer, 'idGenerator', {
        get: function() {
            return this._idGenerator++;
        }
    });
}( OpenSeadragon ));
