(function( $ ){
    /**
     * @typedef {Object} TiledImageInfo
     * @property {Number} TiledImageInfo.id
     * @property {Number[]} TiledImageInfo.shaderOrder
     * @property {Object} TiledImageInfo.shaders
     * @property {Object} TiledImageInfo.drawers
     */

    /**
     * One vector mesh.
     *
     * @typedef {object} VectorMesh
     * @property {Float32Array} vertices - Packed vertices as vec4(x, y, depth, textureId).
     * @property {Uint32Array} indices - Indices into the vertex array.
     * @property {number[]} [color] - Constant RGBA color used when parameters are absent.
     * @property {Float32Array} [parameters] - Per-vertex payload. For icons: vec4(xStart, yStart, width, height).
     * @property {number} [lineWidth=1] - Native line width in pixels. Used only for `linePrimitives`.
     */

    /**
     * Tessellated vector payload for one tile.
     *
     * Icons are represented as point meshes. A point mesh is rendered as an icon
     * when its vertex textureId component is >= 0 and its `parameters` array
     * contains per-vertex atlas placement data.
     *
     * @typedef {object} VectorMeshTile
     * @property {VectorMesh[]} [fills] - Polygon fill triangle meshes.
     * @property {VectorMesh[]} [lines] - Stroke triangle meshes rendered with gl.TRIANGLES. Mutually exclusive with linePrimitives.
     * @property {VectorMesh[]} [linePrimitives] - Native line segment meshes rendered with gl.LINES. Mutually exclusive with lines.
     * @property {VectorMesh[]} [points] - Point marker and icon quad meshes.
     */

    /**
     * @property {Number} idGenerator unique ID getter
     *
     * @class OpenSeadragon.FlexDrawer
     * @classdesc implementation of WebGL renderer for an {@link OpenSeadragon.Viewer}
     */
    class FlexDrawer extends OpenSeadragon.DrawerBase {
        /**
         * @param {Object} options options for this Drawer
         * @param {OpenSeadragon.Viewer} options.viewer the Viewer that owns this Drawer
         * @param {OpenSeadragon.Viewport} options.viewport reference to Viewer viewport
         * @param {HTMLElement} options.element parent element
         * @param {[String]} options.debugGridColor see debugGridColor in {@link OpenSeadragon.Options} for details
         * @param {Object} options.options optional
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

            this._interactionOptions = this._normalizeInteractionOptions(this.options.interaction);
            this._interactionEnabled = false;
            this._interactionListeners = null;
            this._interactionDragActive = false;
            this._interactionMouseNavCaptured = false;
            this._interactionPreviousMouseNavEnabled = null;
            this._interactionGestureSettingsCaptured = false;
            this._interactionPreviousGestureSettings = null;

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
                interaction: false,
                // hex bg color, by default transparent
                backgroundColor: undefined
            };
        }

        /**
         * Override the default configuration: the renderer will use given shaders,
         * supplied with data from collection of TiledImages, to render.
         * TiledImages are treated only as data sources, the rendering outcome is fully in controls of the shader specs.
         * @param {Object.<string, ShaderLayerConfig>} shaders map of id -> shader config value
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
                const sanitized = $.FlexRenderer.sanitizeKey(shaderId);
                if (this.renderer._shaders[sanitized]) {
                    this.renderer.removeShader(sanitized);
                }
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
         * @return {ShaderLayerConfig|*|undefined}
         */
        getOverriddenShaderConfig(key) {
            const shaderLayer = this.renderer.getAllShaders()[key];
            return shaderLayer ? shaderLayer.getConfig() : undefined;
        }

        /**
         * If shaders are managed internally, tiled image can be configured a single custom
         * shader if desired. This shader is ignored if overrideConfigureAll({...}) used.
         * @param {OpenSeadragon.TiledImage} tiledImage
         * @param {ShaderLayerConfig} shader
         * @return {ShaderLayerConfig} shader config used, a copy if options.copyShaderConfig is true, otherwise a modified argument
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
                this.renderer.registerProgram(null, this.renderer.backend.secondPassProgramKey);
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

            if (this._interactionEnabled) {
                this.setInteractionOptions({
                    enabled: false
                }, {
                    notify: false,
                    redraw: false,
                    reason: "drawer-destroy"
                });
            } else {
                this._detachInteractionListeners();
                this._resetInteractionTracking();
                this._releaseInteractionViewerInputCapture();
            }

            // WebGL resource cleanup is owned by FlexRenderer and the active backend.

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

                if (this._destroyed) {
                    this._rebuildHandle = null;
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
                this.renderer.registerProgram(null, this.renderer.backend.secondPassProgramKey);
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
         * The returned array is backend-neutral input for `renderer.renderSecondPass(...)`
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

        /**
         * Drawer-level interaction observer configuration.
         *
         * This controls whether `FlexDrawer` observes pointer/mouse events and how it
         * forwards those events to the renderer-owned interaction state. These options
         * are drawer configuration options, not `FlexRenderer` interaction-state update
         * options.
         *
         * @typedef {Object} FlexDrawerInteractionOptions
         * @property {boolean} [enabled=false] - Whether FlexDrawer observes pointer/mouse events and forwards interaction state.
         * @property {boolean} [preventContextMenu=false] - Prevent the browser context menu on interaction right-click/contextmenu events.
         * @property {boolean} [notifyOnMove=false] - Emit `interaction-change` notifications for high-frequency pointermove updates.
         * @property {"all"|"drag"|"none"} [viewerInputCaptureMode="none"] - Viewer input suppression mode. `"none"` leaves OpenSeadragon viewer input unchanged. `"all"` disables OpenSeadragon mouse navigation. `"drag"` disables drag/click/flick gestures but leaves wheel zoom enabled.
         */

        /**
         * Normalize viewer input capture mode.
         *
         * @private
         * @param {*} mode
         * @return {"all"|"drag"|"none"}
         */
        _normalizeViewerInputCaptureMode(mode) {
            return mode === "all" || mode === "drag" ? mode : "none";
        }

        /**
         * Normalize drawer-level interaction configuration.
         *
         * @private
         * @param {boolean|Partial<FlexDrawerInteractionOptions>|undefined} interaction
         * @return {FlexDrawerInteractionOptions}
         */
        _normalizeInteractionOptions(interaction = false) {
            if (interaction === true) {
                return {
                    enabled: true,
                    preventContextMenu: false,
                    notifyOnMove: false,
                    viewerInputCaptureMode: "none",
                };
            }

            if (!interaction || typeof interaction !== "object") {
                return {
                    enabled: false,
                    preventContextMenu: false,
                    notifyOnMove: false,
                    viewerInputCaptureMode: "none",
                };
            }

            const viewerInputCaptureMode = this._normalizeViewerInputCaptureMode(
                interaction.viewerInputCaptureMode
            );

            return {
                enabled: !!interaction.enabled,
                preventContextMenu: !!interaction.preventContextMenu,
                notifyOnMove: !!interaction.notifyOnMove,
                viewerInputCaptureMode: viewerInputCaptureMode,
            };
        }

        /**
         * Return the DOM element used for interaction event observation.
         *
         * @private
         * @return {HTMLElement|HTMLCanvasElement|null}
         */
        _getInteractionEventTarget() {
            return this.canvas || this.container || this.element || (this.viewer && this.viewer.element) || null;
        }

        /**
         * Convert a DOM pointer/mouse event into renderer framebuffer pixels.
         *
         * Returned coordinates use physical framebuffer pixels with bottom-left origin,
         * directly comparable to `gl_FragCoord.xy`.
         *
         * @private
         * @param {PointerEvent|MouseEvent} event
         * @return {{x: number, y: number}}
         */
        _getInteractionPositionPx(event) {
            const canvas = this.renderer && this.renderer.getPresentationCanvas();
            const target = this._getInteractionEventTarget();

            if (!canvas || !target || typeof target.getBoundingClientRect !== "function") {
                return { x: 0, y: 0 };
            }

            const rect = target.getBoundingClientRect();
            const scaleX = rect.width ? canvas.width / rect.width : 1;
            const scaleY = rect.height ? canvas.height / rect.height : 1;

            return {
                x: (event.clientX - rect.left) * scaleX,
                y: (rect.bottom - event.clientY) * scaleY,
            };
        }

        /**
         * Convert a MouseEvent.button value into a MouseEvent.buttons-compatible bitmask.
         *
         * @private
         * @param {number} button
         * @return {number}
         */
        _buttonToButtonsMask(button) {
            if (button === 0) {
                return 1;
            }
            if (button === 1) {
                return 4;
            }
            if (button === 2) {
                return 2;
            }
            if (button === 3) {
                return 8;
            }
            if (button === 4) {
                return 16;
            }
            return 0;
        }

        /**
         * Return the current button bitmask from an interaction event.
         *
         * @private
         * @param {PointerEvent|MouseEvent} event
         * @return {number}
         */
        _getInteractionButtons(event) {
            if (typeof event.buttons === "number") {
                return event.buttons;
            }

            return this._buttonToButtonsMask(event.button);
        }

        /**
         * Return whether this event should be ignored by the initial mouse-focused implementation.
         *
         * @private
         * @param {PointerEvent|MouseEvent} event
         * @return {boolean}
         */
        _shouldIgnoreInteractionEvent(event) {
            if (!this._interactionEnabled) {
                return true;
            }

            return !!(event.pointerType && event.pointerType !== "mouse");
        }

        /**
         * Reset drawer-local interaction tracking fields.
         *
         * @private
         * @return {void}
         */
        _resetInteractionTracking() {
            this._interactionDragActive = false;
        }

        /**
         * Attach pointer or mouse observers used to forward interaction state to FlexRenderer.
         *
         * @private
         * @return {void}
         */
        _attachInteractionListeners() {
            if (this._interactionListeners) {
                return;
            }

            const target = this._getInteractionEventTarget();
            if (!target) {
                return;
            }

            const supportsPointerEvents = typeof window !== "undefined" && !!window.PointerEvent;
            const listeners = [];

            const add = (type, handler) => {
                target.addEventListener(type, handler, false);
                listeners.push({ type, handler });
            };

            const handleEnter = (event) => {
                if (this._shouldIgnoreInteractionEvent(event)) {
                    return;
                }

                this.setInteractionState({
                    enabled: true,
                    pointerInside: true,
                    pointerPositionPx: this._getInteractionPositionPx(event),
                    activeButtons: this._getInteractionButtons(event),
                }, {
                    notify: true,
                    reason: "drawer-pointerenter"
                });
            };

            const handleMove = (event) => {
                if (this._shouldIgnoreInteractionEvent(event)) {
                    return;
                }

                const pointerPositionPx = this._getInteractionPositionPx(event);
                const patch = {
                    enabled: true,
                    pointerInside: true,
                    pointerPositionPx: pointerPositionPx,
                    activeButtons: this._getInteractionButtons(event),
                };

                if (this._interactionDragActive) {
                    patch.dragCurrentPositionPx = pointerPositionPx;
                }

                this.setInteractionState(patch, {
                    notify: this._interactionOptions.notifyOnMove,
                    reason: "drawer-pointermove"
                });
            };

            const handleDown = (event) => {
                if (this._shouldIgnoreInteractionEvent(event)) {
                    return;
                }

                const pointerPositionPx = this._getInteractionPositionPx(event);
                const activeButtons = this._getInteractionButtons(event);

                this._interactionDragActive = true;

                this.setInteractionState({
                    enabled: true,
                    pointerInside: true,
                    pointerPositionPx: pointerPositionPx,
                    activeButtons: activeButtons,
                    dragActive: true,
                    dragStartPositionPx: pointerPositionPx,
                    dragCurrentPositionPx: pointerPositionPx,
                    dragButtons: activeButtons,
                }, {
                    notify: true,
                    reason: "drawer-pointerdown"
                });
            };

            const handleUp = (event) => {
                if (this._shouldIgnoreInteractionEvent(event)) {
                    return;
                }

                const previous = this.getInteractionState();
                const pointerPositionPx = this._getInteractionPositionPx(event);
                const activeButtons = this._getInteractionButtons(event);
                const completedDrag = this._interactionDragActive || previous.dragActive;

                this._resetInteractionTracking();

                this.setInteractionState({
                    enabled: true,
                    pointerInside: true,
                    pointerPositionPx: pointerPositionPx,
                    activeButtons: activeButtons,
                    dragActive: false,
                    dragCurrentPositionPx: pointerPositionPx,
                    dragEndPositionPx: pointerPositionPx,
                    dragSerial: completedDrag ? previous.dragSerial + 1 : previous.dragSerial,
                }, {
                    notify: true,
                    reason: completedDrag ? "drawer-drag-end" : "drawer-pointerup"
                });
            };

            const handleLeave = (event) => {
                if (this._shouldIgnoreInteractionEvent(event)) {
                    return;
                }

                this._resetInteractionTracking();

                this.setInteractionState({
                    pointerInside: false,
                    activeButtons: 0,
                    dragActive: false,
                }, {
                    notify: true,
                    reason: "drawer-pointerleave"
                });
            };

            const handleCancel = (event) => {
                if (this._shouldIgnoreInteractionEvent(event)) {
                    return;
                }

                this._resetInteractionTracking();

                this.setInteractionState({
                    pointerInside: false,
                    activeButtons: 0,
                    dragActive: false,
                }, {
                    notify: true,
                    reason: "drawer-pointercancel"
                });
            };

            const handleClick = (event) => {
                if (this._shouldIgnoreInteractionEvent(event)) {
                    return;
                }

                const previous = this.getInteractionState();
                const pointerPositionPx = this._getInteractionPositionPx(event);

                this.setInteractionState({
                    enabled: true,
                    pointerInside: true,
                    pointerPositionPx: pointerPositionPx,
                    lastClickPositionPx: pointerPositionPx,
                    lastClickButtons: this._buttonToButtonsMask(event.button),
                    clickSerial: previous.clickSerial + 1,
                }, {
                    notify: true,
                    reason: "drawer-click"
                });
            };

            const handleContextMenu = (event) => {
                if (this._interactionEnabled && this._interactionOptions.preventContextMenu) {
                    event.preventDefault();
                }
            };

            if (supportsPointerEvents) {
                add("pointerenter", handleEnter);
                add("pointermove", handleMove);
                add("pointerdown", handleDown);
                add("pointerup", handleUp);
                add("pointercancel", handleCancel);
                add("pointerleave", handleLeave);
                add("click", handleClick);
            } else {
                add("mouseenter", handleEnter);
                add("mousemove", handleMove);
                add("mousedown", handleDown);
                add("mouseup", handleUp);
                add("mouseleave", handleLeave);
                add("click", handleClick);
            }

            add("contextmenu", handleContextMenu);

            this._interactionListeners = {
                target,
                listeners
            };
        }

        /**
         * Detach pointer or mouse observers used for interaction forwarding.
         *
         * @private
         * @return {void}
         */
        _detachInteractionListeners() {
            if (!this._interactionListeners) {
                return;
            }

            const target = this._interactionListeners.target;
            for (const listener of this._interactionListeners.listeners) {
                target.removeEventListener(listener.type, listener.handler, false);
            }

            this._interactionListeners = null;
        }

        /**
         * Return whether OpenSeadragon mouse navigation is currently enabled.
         *
         * @private
         * @return {boolean}
         */
        _getViewerMouseNavEnabled() {
            if (!this.viewer) {
                return true;
            }

            if (
                this.viewer.innerTracker &&
                typeof this.viewer.innerTracker.isTracking === "function"
            ) {
                const tracking = this.viewer.innerTracker.isTracking();

                if (typeof tracking === "boolean") {
                    return tracking;
                }
            }

            if (typeof this.viewer.isMouseNavEnabled === "function") {
                const enabled = this.viewer.isMouseNavEnabled();

                if (typeof enabled === "boolean") {
                    return enabled;
                }
            }

            if (typeof this.viewer.mouseNavEnabled === "boolean") {
                return this.viewer.mouseNavEnabled;
            }

            return true;
        }

        /**
         * Disable OpenSeadragon mouse navigation while interaction forwarding is active.
         *
         * This is the `"all"` capture mode. It disables the OpenSeadragon mouse
         * tracker as a whole and restores its previous tracking state on release.
         *
         * @private
         * @return {void}
         */
        _captureInteractionMouseNavigation() {
            if (this._interactionMouseNavCaptured || !this.viewer) {
                return;
            }

            // Mark as captured before mutating OpenSeadragon state. This prevents a
            // synchronous re-entrant capture path from overwriting the saved previous
            // value after setMouseNavEnabled(false) has already disabled navigation.
            this._interactionPreviousMouseNavEnabled = this._getViewerMouseNavEnabled();
            this._interactionMouseNavCaptured = true;

            if (typeof this.viewer.setMouseNavEnabled === "function") {
                this.viewer.setMouseNavEnabled(false);
                return;
            }

            if (typeof this.viewer.mouseNavEnabled === "boolean") {
                this.viewer.mouseNavEnabled = false;
                return;
            }

            this._interactionMouseNavCaptured = false;
            this._interactionPreviousMouseNavEnabled = null;
        }

        /**
         * Restore OpenSeadragon mouse navigation after `"all"` input capture.
         *
         * @private
         * @param {boolean} [force=false] - Attempt restoration even if the local capture flag is stale.
         * @param {boolean|null} [forceEnabled=null] - Explicit restored mouse-navigation state.
         * @return {void}
         */
        _releaseInteractionMouseNavigationCapture(force = false, forceEnabled = null) {
            if ((!this._interactionMouseNavCaptured && !force) || !this.viewer) {
                this._interactionMouseNavCaptured = false;
                this._interactionPreviousMouseNavEnabled = null;
                return;
            }

            const restoreEnabled = typeof forceEnabled === "boolean" ?
                forceEnabled :
                this._interactionPreviousMouseNavEnabled !== false;

            this._interactionMouseNavCaptured = false;
            this._interactionPreviousMouseNavEnabled = null;

            if (typeof this.viewer.setMouseNavEnabled === "function") {
                this.viewer.setMouseNavEnabled(restoreEnabled);
            } else if (typeof this.viewer.mouseNavEnabled === "boolean") {
                this.viewer.mouseNavEnabled = restoreEnabled;
            }
        }

        /**
         * Disable drag/click OpenSeadragon gestures while keeping wheel zoom available.
         *
         * This is the `"drag"` capture mode. It keeps the OpenSeadragon mouse tracker
         * active, but temporarily disables mouse gesture settings that would conflict
         * with shader interaction tools.
         *
         * @private
         * @return {void}
         */
        _captureInteractionGestureSettings() {
            if (this._interactionGestureSettingsCaptured || !this.viewer) {
                return;
            }

            const settings = this.viewer.gestureSettingsMouse;

            if (!settings || typeof settings !== "object") {
                return;
            }

            this._interactionPreviousGestureSettings = {
                dragToPan: settings.dragToPan,
                clickToZoom: settings.clickToZoom,
                dblClickToZoom: settings.dblClickToZoom,
                dblClickDragToZoom: settings.dblClickDragToZoom,
                flickEnabled: settings.flickEnabled,
            };
            this._interactionGestureSettingsCaptured = true;

            settings.dragToPan = false;
            settings.clickToZoom = false;
            settings.dblClickToZoom = false;

            if ("dblClickDragToZoom" in settings) {
                settings.dblClickDragToZoom = false;
            }

            if ("flickEnabled" in settings) {
                settings.flickEnabled = false;
            }
        }

        /**
         * Restore OpenSeadragon gesture settings after `"drag"` input capture.
         *
         * @private
         * @param {boolean} [force=false] - Attempt restoration even if the local capture flag is stale.
         * @param {Object|null} [forceSettings=null] - Explicit gesture settings to restore.
         * @return {void}
         */
        _releaseInteractionGestureSettingsCapture(force = false, forceSettings = null) {
            if ((!this._interactionGestureSettingsCaptured && !force) || !this.viewer) {
                this._interactionGestureSettingsCaptured = false;
                this._interactionPreviousGestureSettings = null;
                return;
            }

            const settings = this.viewer.gestureSettingsMouse;
            const previous = forceSettings || this._interactionPreviousGestureSettings || {};

            this._interactionGestureSettingsCaptured = false;
            this._interactionPreviousGestureSettings = null;

            if (!settings || typeof settings !== "object") {
                return;
            }

            for (const key of Object.keys(previous)) {
                if (previous[key] !== undefined) {
                    settings[key] = previous[key];
                }
            }
        }

        /**
         * Suppress OpenSeadragon viewer input according to current interaction options.
         *
         * @private
         * @return {void}
         */
        _captureInteractionViewerInput() {
            if (!this._interactionOptions) {
                this._restoreInteractionViewerInputDefaults();
                return;
            }

            const mode = this._interactionOptions.viewerInputCaptureMode || "none";

            if (mode === "drag") {
                this._releaseInteractionMouseNavigationCapture();
                this._captureInteractionGestureSettings();
                return;
            }

            if (mode === "all") {
                this._releaseInteractionGestureSettingsCapture();
                this._captureInteractionMouseNavigation();
                return;
            }

            this._restoreInteractionViewerInputDefaults();
        }

        /**
         * Restore all OpenSeadragon viewer input modified by interaction capture.
         *
         * @private
         * @return {void}
         */
        _releaseInteractionViewerInputCapture() {
            this._releaseInteractionMouseNavigationCapture();
            this._releaseInteractionGestureSettingsCapture();
        }

        /**
         * Restore normal OpenSeadragon mouse input after viewer input capture is
         * explicitly set to `"none"`.
         *
         * This is intentionally stronger than restoring only the saved capture
         * snapshot. It prevents stale or already-mutated gesture snapshots from
         * leaving the viewer unable to pan or click-zoom after capture is turned off.
         *
         * @private
         * @return {void}
         */
        _restoreInteractionViewerInputDefaults() {
            this._releaseInteractionMouseNavigationCapture(true, true);

            this._releaseInteractionGestureSettingsCapture(true, {
                dragToPan: true,
                clickToZoom: true,
                dblClickToZoom: true,
                dblClickDragToZoom: true,
                flickEnabled: true,
            });
        }

        /**
         * Synchronize OpenSeadragon input capture with current drawer interaction options.
         *
         * @private
         * @return {void}
         */
        _syncInteractionViewerInputCapture() {
            if (
                this._interactionEnabled &&
                this._interactionOptions
            ) {
                this._captureInteractionViewerInput();
                return;
            }

            this._releaseInteractionViewerInputCapture();
        }

        /**
         * Update drawer-level interaction observer options.
         *
         * This is the main implementation for drawer-side interaction configuration.
         * It controls whether FlexDrawer observes pointer/mouse events and how those
         * events are forwarded to the renderer-owned interaction state.
         *
         * The second argument is forwarded only when this method needs to mutate
         * renderer-owned interaction state because `enabled` changed.
         *
         * @param {boolean|Partial<FlexDrawerInteractionOptions>} interaction
         * @param {InteractionStateUpdateOptions} [stateOptions={}] - Renderer state update options used only when enabling/disabling forwarding.
         * @return {FlexDrawerInteractionOptions}
         */
        setInteractionOptions(interaction, stateOptions = {}) {
            const previousEnabled = this._interactionEnabled;
            const previousOptions = this.getInteractionOptions();
            const previousViewerInputCaptureMode = previousOptions.viewerInputCaptureMode || "none";

            const nextOptions = this._normalizeInteractionOptions(
                interaction && typeof interaction === "object" ?
                    $.extend(true, {}, this._interactionOptions, interaction) :
                    interaction
            );

            this._interactionOptions = nextOptions;

            if (nextOptions.enabled) {
                if (!this._interactionListeners) {
                    this._attachInteractionListeners();
                }

                if (!this._interactionListeners) {
                    this._interactionEnabled = false;
                    this._interactionOptions.enabled = false;
                    return this.getInteractionOptions();
                }

                this._interactionEnabled = true;
                this._interactionOptions.enabled = true;

                if (
                    previousViewerInputCaptureMode !== "none" &&
                    this._interactionOptions.viewerInputCaptureMode === "none"
                ) {
                    this._restoreInteractionViewerInputDefaults();
                } else {
                    this._syncInteractionViewerInputCapture();
                }

                if (!previousEnabled) {
                    this.setInteractionState({
                        enabled: true
                    }, $.extend(true, {
                        reason: "drawer-enable-interaction"
                    }, stateOptions));
                }

                return this.getInteractionOptions();
            }

            this._interactionEnabled = false;
            this._interactionOptions.enabled = false;
            this._detachInteractionListeners();
            this._resetInteractionTracking();
            this._releaseInteractionViewerInputCapture();

            this.clearInteractionState($.extend(true, {
                reason: "drawer-disable-interaction"
            }, stateOptions));

            return this.getInteractionOptions();
        }

        /**
         * Return drawer-level interaction observer options.
         *
         * @return {FlexDrawerInteractionOptions}
         */
        getInteractionOptions() {
            return $.extend(true, {}, this._interactionOptions);
        }

        /**
         * Enable or disable drawer-side interaction observation and forwarding.
         *
         * On FlexDrawer, "interaction enabled" means the drawer observes pointer/mouse
         * events and forwards normalized interaction state to FlexRenderer.
         *
         * This is a convenience wrapper around `setInteractionOptions(...)`.
         *
         * @param {boolean} enabled
         * @param {InteractionStateUpdateOptions} [stateOptions={}] - Renderer state update options used only for the enable/disable state mutation.
         * @return {FlexDrawerInteractionOptions}
         */
        setInteractionEnabled(enabled, stateOptions = {}) {
            return this.setInteractionOptions({
                enabled: !!enabled
            }, stateOptions);
        }

        /**
         * Return whether drawer-side interaction observation and forwarding is enabled.
         *
         * @return {boolean}
         */
        isInteractionEnabled() {
            return !!this.getInteractionOptions().enabled;
        }

        /**
         * Forward an interaction-state patch to the renderer-owned interaction API.
         *
         * @param {Partial<InteractionState>|undefined} state
         * @param {InteractionStateUpdateOptions} [options={}]
         * @return {InteractionState}
         */
        setInteractionState(state = undefined, options = {}) {
            if (!this.renderer || typeof this.renderer.setInteractionState !== "function") {
                return OpenSeadragon.FlexRenderer.normalizeInteractionState();
            }

            return this.renderer.setInteractionState(state, $.extend(true, {
                reason: "drawer-set-interaction-state"
            }, options));
        }

        /**
         * Return the renderer-owned canonical interaction state.
         *
         * @return {InteractionState}
         */
        getInteractionState() {
            if (!this.renderer || typeof this.renderer.getInteractionState !== "function") {
                return OpenSeadragon.FlexRenderer.normalizeInteractionState();
            }

            return this.renderer.getInteractionState();
        }

        /**
         * Clear drawer-local interaction tracking and renderer-owned interaction state.
         *
         * @param {InteractionStateUpdateOptions} [options={}]
         * @return {InteractionState}
         */
        clearInteractionState(options = {}) {
            this._resetInteractionTracking();

            if (!this.renderer || typeof this.renderer.clearInteractionState !== "function") {
                return OpenSeadragon.FlexRenderer.normalizeInteractionState();
            }

            return this.renderer.clearInteractionState($.extend(true, {
                reason: "drawer-clear-interaction-state"
            }, options));
        }

        // DRAWING METHODS
        /**
         * Draw using `FlexRenderer`.
         *
         * This method is the OpenSeadragon `DrawerBase` draw entry point. It remains
         * responsible for OpenSeadragon-specific adaptation: resolving the current
         * viewport, building the viewport matrix, collecting tile data, and collecting
         * ShaderLayer render uniforms that depend on TiledImage state.
         *
         * The actual two-pass render orchestration is delegated to
         * `OpenSeadragon.FlexRenderer#render`.
         *
         * @override
         * @param {Array<OpenSeadragon.TiledImage>} tiledImages - TiledImage objects to draw.
         * @param {object} [view=undefined] - Optional custom view state.
         * @param {OpenSeadragon.Rect} view.bounds - Viewport bounds.
         * @param {OpenSeadragon.Point} view.center - Viewport center.
         * @param {number} view.rotation - Viewport rotation in radians.
         * @param {number} view.zoom - Viewport zoom.
         * @returns {void}
         *
         * @memberof OpenSeadragon.FlexDrawer#
         */
        draw(tiledImages, view = undefined) {
            if (!tiledImages || tiledImages.length === 0) {
                this.renderer.clear();
                return;
            }

            if (!this._drawReady && !this._refreshDrawReadyState()) {
                return;
            }

            view = this._resolveRenderView(view);

            // TODO consider sending data and computing on GPU.
            // calculate view matrix for viewer
            const flipMultiplier = this.viewport.flipped ? -1 : 1;
            const posMatrix = $.Mat3.makeTranslation(-view.center.x, -view.center.y);
            const scaleMatrix = $.Mat3.makeScaling(2 / view.bounds.width * flipMultiplier, -2 / view.bounds.height);
            const rotMatrix = $.Mat3.makeRotation(-view.rotation);
            const viewMatrix = scaleMatrix.multiply(rotMatrix).multiply(posMatrix);

            this._ensurePackLayout();

            const firstPass = this._collectFirstPassPayload(tiledImages, view, viewMatrix);
            const secondPass = this._collectSecondPassPayload(view);

            this.renderer.render({
                firstPass: firstPass,
                secondPass: secondPass
            });
        } // end of function

        /**
         * Build first-pass render packages from OpenSeadragon TiledImage state.
         *
         * This method is the OpenSeadragon-to-renderer adaptation step for the first
         * pass. It collects drawable tiles, extracts renderer-ready cache payloads,
         * computes tile transform matrices, and converts crop/clip polygons into
         * viewport-coordinate polygons consumed by the active backend.
         *
         * It intentionally does not clear WebGL state and does not execute the first
         * pass. The normal draw path passes the returned packages to
         * `OpenSeadragon.FlexRenderer#render`.
         *
         * @private
         * @param {Array<OpenSeadragon.TiledImage>} tiledImages - TiledImage objects to draw.
         * @param {object} viewport - Resolved viewport state.
         * @param {OpenSeadragon.Rect} viewport.bounds - Viewport bounds.
         * @param {OpenSeadragon.Point} viewport.center - Viewport center.
         * @param {number} viewport.rotation - Viewport rotation in radians.
         * @param {number} viewport.zoom - Viewport zoom.
         * @param {OpenSeadragon.Mat3} viewMatrix - Matrix mapping viewport coordinates into renderer clip space.
         * @returns {Array<FPRenderPackage>} First-pass render packages.
         *
         * @memberof OpenSeadragon.FlexDrawer#
         */
        _collectFirstPassPayload(tiledImages, viewport, viewMatrix) {
            // FIRST PASS (render things as they are into the corresponding off-screen textures)
            const TI_PAYLOAD = [];

            for (let tiledImageIndex = 0; tiledImageIndex < tiledImages.length; tiledImageIndex++) {
                const tiledImage = tiledImages[tiledImageIndex];
                const payload = [];
                const vecPayload = [];
                const diagnosticPayload = [];

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
                            continue;
                        }

                        if (this._isDiagnosticTileInfo(tileInfo)) {
                            diagnosticPayload.push(this._makeTileDiagnosticRegion(
                                tile,
                                tiledImage,
                                overallMatrix,
                                tileInfo.reason || "invalid-data"
                            ));
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
                            // Flatten vector meshes into a simple draw list.

                            if (tileInfo.vectors.fills) {
                                tileInfo.vectors.fills.matrix = transformMatrix;
                            }
                            if (tileInfo.vectors.lines) {
                                tileInfo.vectors.lines.matrix = transformMatrix;
                            }
                            if (tileInfo.vectors.linePrimitives) {
                                for (const lineBatch of tileInfo.vectors.linePrimitives) {
                                    lineBatch.matrix = transformMatrix;
                                }
                            }
                            if (tileInfo.vectors.points) {
                                tileInfo.vectors.points.matrix = transformMatrix;
                            }

                            vecPayload.push(tileInfo.vectors);
                        } else {
                            diagnosticPayload.push(this._makeTileDiagnosticRegion(
                                tile,
                                tiledImage,
                                overallMatrix,
                                "invalid-data"
                            ));
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
                        diagnostics: diagnosticPayload,
                        polygons: polygons,
                        dataIndex: baseLayer + packIndex,
                        stencilIndex: tiledImageIndex,
                        packIndex: packIndex,
                        _temp: overallMatrix, // todo dirty
                    });
                }
            }

            // todo flatten render data

            return TI_PAYLOAD;
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

            const canvas = this.renderer.getPresentationCanvas();
            const osdViewport = this.viewer.viewport;
            const inner = osdViewport && osdViewport._containerInnerSize;
            const sx = inner && inner.x ? canvas.width / inner.x : 1;
            const sy = inner && inner.y ? canvas.height / inner.y : 1;

            for (const shader of flatShaders) {
                const config = shader.getConfig();
                const hasSources = Array.isArray(config.tiledImages) && config.tiledImages.length > 0;
                const tiledImage = hasSources ? this.viewer.world.getItemAt(config.tiledImages[0]) : null;

                let imageOriginPx = [0, 0];
                if (tiledImage && osdViewport) {
                    // image (0,0) → viewport coords → CSS viewer-element pixels (top-down)
                    // → framebuffer pixels (bottom-up to match gl_FragCoord).
                    const vp = tiledImage.imageToViewportCoordinates(0, 0, true);
                    const cssPt = osdViewport.pixelFromPoint(vp, true);
                    imageOriginPx[0] = cssPt.x * sx;
                    imageOriginPx[1] = canvas.height - cssPt.y * sy;
                }

                sources.push({
                    zoom: viewport.zoom,
                    pixelSize: tiledImage ? this._tiledImageViewportToImageZoom(tiledImage, viewport.zoom) : 1,
                    opacity: tiledImage ? tiledImage.getOpacity() : 1,
                    imageOriginPx,
                    shader: shader,
                });
            }

            return sources;
        }

        /**
         * Build the second-pass render package array from the renderer's current
         * ShaderLayer graph and the resolved OpenSeadragon viewport state.
         *
         * This remains drawer-owned because pixel size and opacity are currently
         * derived from OpenSeadragon `TiledImage` instances.
         *
         * @private
         * @param {object} viewport - Resolved viewport state.
         * @param {number} viewport.zoom - Viewport zoom.
         * @returns {Array<SPRenderPackage>} Second-pass render packages.
         *
         * @memberof OpenSeadragon.FlexDrawer#
         */
        _collectSecondPassPayload(viewport) {
            return this._collectShaderUniforms(
                this.renderer.getAllShaders(),
                this.renderer.getShaderLayerOrder(),
                viewport
            );
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

            const canvas = this.renderer.getPresentationCanvas();
            let viewportSize = this._calculateCanvasSize();

            // SETUP CANVASES
            this._setupCanvases();

            canvas.width = viewportSize.x;
            canvas.height = viewportSize.y;
            this._refreshDrawReadyState();

            this._interactionOptions = this._normalizeInteractionOptions(
                this._isNavigatorDrawer ? false : this.options.interaction
            );

            if (this._interactionOptions.enabled) {
                this.setInteractionOptions(this._interactionOptions, {
                    notify: true,
                    redraw: false,
                    reason: "drawer-init-interaction"
                });
            }

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
            }).catch(error => {
                $.console.error(`Failed to prepare tile data.`, error, normalized.data);

                return this._createDiagnosticTileInfo(
                    error && error.reason ? error.reason : "invalid-data"
                );
            });
        }

        /**
         * Create an internal tile-info sentinel for tile data that was received but
         * could not be converted into renderer-ready raster or vector data.
         *
         * @private
         * @param {string} reason
         * @return {{__flexDiagnostic: boolean, reason: string}}
         */
        _createDiagnosticTileInfo(reason = "invalid-data") {
            return {
                __flexDiagnostic: true,
                reason: reason
            };
        }

        /**
         * Return whether tile info is an internal diagnostic sentinel.
         *
         * @private
         * @param {*} tileInfo
         * @return {boolean}
         */
        _isDiagnosticTileInfo(tileInfo) {
            return !!(tileInfo && tileInfo.__flexDiagnostic === true);
        }

        /**
         * Return renderer-neutral texture options for prepared tile resources.
         *
         * @private
         * @returns {RasterTileTextureOptions}
         */
        _getPreparedTileTextureOptions() {
            return {
                imageSmoothingEnabled: !!this._imageSmoothingEnabled
            };
        }

        /**
         * Convert a successful renderer preparation result into FlexDrawer's
         * internal raster tile-info shape.
         *
         * FlexDrawer owns OpenSeadragon tile placement. The renderer/backend owns
         * the prepared resource.
         *
         * @private
         * @param {PreparedRasterTileSuccess} result - Successful preparation result.
         * @param {OpenSeadragon.Tile} tile - OpenSeadragon tile.
         * @param {OpenSeadragon.TiledImage} tiledImage - Owning tiled image.
         * @returns {{position: Float32Array, texture: *, resource: *, vectors: undefined}}
         */
        _createPreparedRasterTileInfo(result, tile, tiledImage) {
            return {
                position: this._computeTilePosition(tile, tiledImage, result.width, result.height),
                texture: result.texture,
                resource: result.resource,
                vectors: undefined
            };
        }

        /**
         * Convert a preparation failure into the existing diagnostic tile sentinel.
         *
         * @private
         * @param {PreparedTileFailure} result - Failed preparation result.
         * @returns {{__flexDiagnostic: boolean, reason: string}}
         */
        _createDiagnosticTileInfoFromPreparationFailure(result) {
            const reason = result && result.reason ? result.reason : "invalid-data";
            return this._createDiagnosticTileInfo(reason);
        }

        /**
         * Return whether OpenSeadragon/canvas preflight can already identify a
         * bitmap-like tile source as tainted.
         *
         * This is an adapter-level optimization only. It does not replace renderer/backend upload classification.
         *
         * @private
         * @param {*} data - Normalized tile data.
         * @param {OpenSeadragon.TiledImage} tiledImage - Owning tiled image.
         * @returns {boolean}
         */
        _isKnownTaintedBitmapTileData(data, tiledImage) {
            if (tiledImage && typeof tiledImage.isTainted === "function" && tiledImage.isTainted()) {
                return true;
            }

            const canvas = this._getCanvasFromBitmapTileData(data);

            if (!canvas) {
                return false;
            }

            // checks if the canvas is tainted by trying to read from it
            return !!$.isCanvasTainted(canvas);
        }

        /**
         * Extract a canvas from bitmap-like tile data when available.
         *
         * @private
         * @param {*} data - Tile data.
         * @returns {HTMLCanvasElement | OffscreenCanvas | null}
         */
        _getCanvasFromBitmapTileData(data) {
            if (!data) {
                return null;
            }

            if (typeof CanvasRenderingContext2D !== "undefined" && data instanceof CanvasRenderingContext2D) {
                return data.canvas || null;
            }

            if (typeof HTMLCanvasElement !== "undefined" && data instanceof HTMLCanvasElement) {
                return data;
            }

            if (typeof OffscreenCanvas !== "undefined" && data instanceof OffscreenCanvas) {
                return data;
            }

            return null;
        }

        async createTileInfoFromSource({ data, type, tile, tiledImage }) {
            if (type === "undefined") {
                return null;
            }

            if (type === "vector-mesh" || (data && (data.fills || data.lines || data.linePrimitives || data.points))) {
                const result = await this.renderer.prepareVectorTile({
                    data: data
                });

                if (!result.ok) {
                    return this._createDiagnosticTileInfoFromPreparationFailure(result);
                }

                return {
                    position: null,
                    texture: null,
                    resource: result.resource,
                    vectors: result.vectors
                };
            }

            const isGpuTextureSet = type === "gpuTextureSet" || (data && typeof data.getType === "function" && data.getType() === "gpuTextureSet");

            if (isGpuTextureSet) {
                const result = await this.renderer.prepareGpuTextureTile({
                    data: data,
                    textureOptions: this._getPreparedTileTextureOptions()
                });

                if (!result.ok) {
                    return this._createDiagnosticTileInfoFromPreparationFailure(result);
                }

                this._updatePackMetadata(
                    tiledImage,
                    result.packCount || result.textureDepth || 1,
                    result.channelCount || (result.packCount || result.textureDepth || 1) * 4
                );

                if (this._packLayoutDirty) {
                    // TODO: is this refreshing logic necessary?
                    //  this._refreshPackLayoutNow();
                    this._packLayoutDirty = false;
                    this._requestRebuild();
                }

                return this._createPreparedRasterTileInfo(result, tile, tiledImage);
            }

            if (this._isKnownTaintedBitmapTileData(data, tiledImage)) {
                return this._createDiagnosticTileInfo("tainted-data");
            }

            const result = await this.renderer.prepareBitmapTile({
                data: data,
                textureOptions: this._getPreparedTileTextureOptions()
            });

            if (!result.ok) {
                return this._createDiagnosticTileInfoFromPreparationFailure(result);
            }

            this._updatePackMetadata(
                tiledImage,
                result.packCount || 1,
                result.channelCount || 4
            );

            return this._createPreparedRasterTileInfo(result, tile, tiledImage);
        }

        // _refreshPackLayoutNow() {
        //     this._updatePackLayout();
        //     this._packLayoutDirty = false;
        // }

        /**
         * Compute fallback dimensions for a diagnostic tile region.
         *
         * Diagnostic entries have no decoded image/texture dimensions, so this uses
         * source bounds when OpenSeadragon exposes them and falls back to the tile
         * source's nominal tile dimensions.
         *
         * @private
         * @param {OpenSeadragon.Tile} tile
         * @param {OpenSeadragon.TiledImage} tiledImage
         * @return {{width: number, height: number}}
         */
        _getDiagnosticTileDimensions(tile, tiledImage) {
            const source = tiledImage && tiledImage.source ? tiledImage.source : {};
            const sourceBounds = tile && tile.sourceBounds ? tile.sourceBounds : null;
            const width = sourceBounds && Number.isFinite(sourceBounds.width) && sourceBounds.width > 0 ?
                sourceBounds.width :
                source.tileWidth || source.tileSize || 1;
            const height = sourceBounds && Number.isFinite(sourceBounds.height) && sourceBounds.height > 0 ?
                sourceBounds.height :
                source.tileHeight || source.tileSize || width;

            return {
                width: width,
                height: height
            };
        }

        /**
         * Create a renderer-ready diagnostic first-pass region for a tile.
         *
         * @private
         * @param {OpenSeadragon.Tile} tile
         * @param {OpenSeadragon.TiledImage} tiledImage
         * @param {OpenSeadragon.Mat3} overallMatrix
         * @param {string} [reason="invalid-data"]
         * @return {FPRenderDiagnosticTile}
         */
        _makeTileDiagnosticRegion(tile, tiledImage, overallMatrix, reason = "invalid-data") {
            const dimensions = this._getDiagnosticTileDimensions(tile, tiledImage);
            const position = this._computeTilePosition(
                tile,
                tiledImage,
                dimensions.width,
                dimensions.height
            );
            const diagnosticTileInfo = {
                position: position
            };

            return {
                reason: reason,
                transformMatrix: this._updateTileMatrix(
                    diagnosticTileInfo,
                    tile,
                    tiledImage,
                    overallMatrix
                ),
                position: position
            };
        }

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

            if (data.resource) {
                this.renderer.releasePreparedTileResource(data.resource);
                data.resource = null;
            } else {
                if (data.texture) {
                    this.renderer.releasePreparedTileResource(data.texture);
                }

                if (data.vectors) {
                    this.renderer.releasePreparedTileResource(data.vectors);
                }
            }

            data.texture = null;
            data.vectors = null;
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

        _setClip(){
            // no-op: called, handled during rendering from tiledImage data
        }
    }

    FlexDrawer._idGenerator = 0;
    Object.defineProperty(FlexDrawer, 'idGenerator', {
        get: function() {
            return this._idGenerator++;
        }
    });

    $.FlexDrawer = FlexDrawer;

}( OpenSeadragon ));
