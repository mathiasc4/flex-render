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
            // We have 'undefined' extra format for blank tiles
            this._supportedFormats = ["rasterBlob", "context2d", "image", "vector-mesh", "undefined"];
            this.rebuildCounter = 0;

            // reject listening for the tile-drawing and tile-drawn events, which this drawer does not fire
            this.viewer.rejectEventHandler("tile-drawn", "The WebGLDrawer does not raise the tile-drawn event");
            this.viewer.rejectEventHandler("tile-drawing", "The WebGLDrawer does not raise the tile-drawing event");
            this.viewer.world.addHandler("remove-item", (e) => {
                const tiledImage = e.item;
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
                handleNavigator: true
            };
        }

        /**
         * Override the default configuration: the renderer will use given shaders,
         * supplied with data from collection of TiledImages, to render.
         * TiledImages are treated only as data sources, the rendering outcome is fully in controls of the shader specs.
         * @param {Object.<string, ShaderConfig>} shaders map of id -> shader config value
         * @param {Array<string>} [shaderOrder=undefined] custom order of shader ids to render.
         * @return {OpenSeadragon.Promise} promise resolved when the renderer gets rebuilt
         */
        overrideConfigureAll(shaders, shaderOrder = undefined) {
            // todo reset also when reordering tiled images!
            // or we could change order only

            if (this.options.handleNavigator && this.viewer.navigator) {
                this.viewer.navigator.drawer.overrideConfigureAll(shaders, shaderOrder);
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
            for (let shaderID in shaders) {
                $.console.log("Registering shader", shaderID, shaders[shaderID], this._isNavigatorDrawer);
                let config = shaders[shaderID];
                this.renderer.createShaderLayer(shaderID, config, this.options.copyShaderConfig);
            }
            shaderOrder = shaderOrder || Object.keys(shaders);
            this.renderer.setShaderLayerOrder(shaderOrder);
            return this._requestRebuild(0);
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

            shader.id = shader.id || tiledImage.__shaderConfig.id || this.constructor.idGenerator;
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

        _hasInvalidBuildState() {
            return this._requestBuildStamp > this._buildStamp;
        }

        _requestRebuild(timeout = 30, force = false) {
            this._requestBuildStamp = Date.now();
            if (this._rebuildHandle) {
                if (!force) {
                    return $.Promise.resolve();
                }
                clearTimeout(this._rebuildHandle);
            }

            if (timeout === 0) {
                this._buildStamp = Date.now();
                this.renderer.setDimensions(0, 0, this.canvas.width, this.canvas.height, this.viewer.world.getItemCount());
                // this.renderer.registerProgram(null, this.renderer.webglContext.firstPassProgramKey);
                this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
                this.rebuildCounter++;
                return $.Promise.resolve();
            }

            return new $.Promise((success, _) => {
                this._rebuildHandle = setTimeout(() => {
                    if (!this._configuredExternally) {
                        this.renderer.setShaderLayerOrder(this.viewer.world._items.map(item =>
                            item.__shaderConfig.id));
                    }
                    this._buildStamp = Date.now();
                    this.renderer.setDimensions(0, 0, this.canvas.width, this.canvas.height, this.viewer.world.getItemCount());
                    // this.renderer.registerProgram(null, this.renderer.webglContext.firstPassProgramKey);
                    this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
                    this.rebuildCounter++;
                    this._rebuildHandle = null;
                    success();
                    setTimeout(() => {
                        this.viewer.forceRedraw();
                    });
                }, timeout);
            });
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

                this.renderer.setDimensions(0, 0, viewportSize.x, viewportSize.y, this.viewer.world.getItemCount());
                this._size = viewportSize;
            };
            this.viewer.addHandler("resize", this._resizeHandler);
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
            // If we did not rebuild yet, avoid rendering - invalid program
            if (this._hasInvalidBuildState()) {
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
                tilesToDraw.sort((tileA, tileB) => tileB.level - tileA.level);

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
                                dataIndex: tiledImageIndex,
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

                TI_PAYLOAD.push({
                    tiles: payload,
                    vectors: vecPayload,
                    polygons: polygons,
                    dataIndex: tiledImageIndex,
                    _temp: overallMatrix, // todo dirty
                });
            }

            // todo flatten render data

            this.renderer.gl.clearColor(1.0, 1.0, 1.0, 1.0);
            this.renderer.gl.clear(this.renderer.gl.COLOR_BUFFER_BIT); // This ensures that areas that are not drawn into do not show old data

            this.renderer.firstPassProcessData(TI_PAYLOAD);
            return true;
        }

        /**
         * During the second-pass draw from the off-screen textures into the rendering canvas,
         * applying the image-processing operations and rendering customizations.
         * @param {Object} viewport has bounds, center, rotation, zoom
         */
        _drawTwoPassSecond(viewport) {
            const sources = [];
            const shaders = this.renderer.getAllShaders();

            for (let shaderID of this.renderer.getShaderLayerOrder()) {
                const shader = shaders[shaderID];
                const config = shader.getConfig();

                // TODO Here we could do some nicer logics, RN we just treat TI0 as a source of truth
                // also when rendering offscreen, the tiled image might be detached
                const tiledImage = this.viewer.world.getItemAt(config.tiledImages[0]);
                sources.push({
                    zoom: viewport.zoom,
                    pixelSize: tiledImage ? this._tiledImageViewportToImageZoom(tiledImage, viewport.zoom) : 1,
                    opacity: tiledImage ? tiledImage.getOpacity() : 1,
                    shader: shader
                });
            }

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

        /**
         * @returns {Boolean} true
         */
        canRotate() {
            return true;
        }

        /**
         * @returns {Boolean} true if canvas and webgl are supported
         */
        static isSupported() {
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
                    refetchCallback: () => this.viewer.world.resetItems(),
                    uniqueId: "osd_" + this._id,
                    // TODO: problem when navigator renders first
                    // Navigator must not have the handler since it would attempt to define the controls twice
                    htmlHandler: this._isNavigatorDrawer ? null : this.options.htmlHandler,
                    // However, navigator must have interactive same as parent renderer to bind events to the controls
                    interactive: !!this.options.htmlHandler,
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
            let tiledImage = tile.tiledImage;
            let gl = this._gl;
            let position;

            if (cache.type === "undefined") {
                return null;
            }

            let data = cache.data;

            if (data instanceof CanvasRenderingContext2D) {
                data = data.canvas;
            }

            // NEW: vector geometry path (pre-tessellated triangles in tile UV space 0..1)
            if (cache.type === "vector-mesh" || (data && (data.fills || data.lines || data.points))) {
                const tileInfo = { texture: null, position: null, vectors: {} };

                const buildBatch = (meshes) => {
                    // Count totals
                    let vCount = 0,
                        iCount = 0;
                    for (const m of meshes) {
                        vCount += (m.vertices.length / 3);
                        iCount += m.indices.length;
                    }

                    // Allocate batched arrays
                    const positions = new Float32Array(vCount * 3);
                    const colors    = new Uint8Array(vCount * 4);  // normalized RGBA
                    const indices   = new Uint32Array(iCount);

                    // Fill them
                    let vOfs = 0,
                        iOfs = 0,
                        baseVertex = 0;
                    for (const m of meshes) {
                        positions.set(m.vertices, vOfs * 3);

                        // fill color per-vertex (constant per feature)
                        const rgba = m.color ? m.color : [0, 0, 0, 1];
                        const r = Math.max(0, Math.min(255, Math.round(rgba[0] * 255)));
                        const g = Math.max(0, Math.min(255, Math.round(rgba[1] * 255)));
                        const b = Math.max(0, Math.min(255, Math.round(rgba[2] * 255)));
                        const a = Math.max(0, Math.min(255, Math.round(rgba[3] * 255)));
                        for (let k = 0; k < (m.vertices.length / 3); k++) {
                            const cOfs = (vOfs + k) * 4;
                            colors[cOfs + 0] = r;
                            colors[cOfs + 1] = g;
                            colors[cOfs + 2] = b;
                            colors[cOfs + 3] = a;
                        }

                        // rebase indices
                        for (let k = 0; k < m.indices.length; k++) {
                            indices[iOfs + k] = baseVertex + m.indices[k];
                        }

                        vOfs += (m.vertices.length / 3);
                        iOfs += m.indices.length;
                        baseVertex += (m.vertices.length / 3);
                    }

                    // Upload once
                    const vboPos = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
                    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

                    const vboCol = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, vboCol);
                    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

                    const ibo = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

                    return { vboPos, vboCol, ibo, count: indices.length };
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

                return Promise.resolve(tileInfo);
            }


            // if (cache.type === "vector-mesh") {
            //     // We keep per-primitive VBOs so first pass can draw them without re-uploading every frame
            //     const tileInfo = { texture: null, position: null, vectors: [] };
            //
            //     const meshes = Array.isArray(data.meshes) ? data.meshes : [];
            //     for (const m of meshes) {
            //         const positions = (m && m.positions) instanceof Float32Array ? m.positions : null;
            //         if (!positions || positions.length === 0) continue;
            //
            //         const color = m.color && m.color.length === 4 ? m.color : [1, 0, 0, 1]; // default red
            //
            //         const vbo = gl.createBuffer();
            //         gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            //         gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
            //         tileInfo.vectors.push({
            //             buffer: vbo,
            //             count: positions.length / 2,
            //             color: new Float32Array(color)
            //         });
            //     }
            //
            //     return Promise.resolve(tileInfo);
            // }

            return createImageBitmap(data).then(data => {
                // if (!tiledImage.isTainted()) {
                // todo tained data handle
                // if((data instanceof CanvasRenderingContext2D) && $.isCanvasTainted(data.canvas)){
                //     tiledImage.setTainted(true);
                //     $.console.warn('WebGL cannot be used to draw this TiledImage because it has tainted data. Does crossOriginPolicy need to be set?');
                //     this._raiseDrawerErrorEvent(tiledImage, 'Tainted data cannot be used by the WebGLDrawer. Falling back to CanvasDrawer for this TiledImage.');
                //     this.setInternalCacheNeedsRefresh();
                // } else {
                let sourceWidthFraction, sourceHeightFraction;
                if (tile.sourceBounds) {
                    sourceWidthFraction = Math.min(tile.sourceBounds.width, data.width) / data.width;
                    sourceHeightFraction = Math.min(tile.sourceBounds.height, data.height) / data.height;
                } else {
                    sourceWidthFraction = 1;
                    sourceHeightFraction = 1;
                }

                let overlap = tiledImage.source.tileOverlap;
                if (overlap > 0){
                    // calculate the normalized position of the rect to actually draw
                    // discarding overlap.
                    let tileMeta = this._getTileRenderMeta(tile, tiledImage);

                    let left = (tile.x === 0 ? 0 : tileMeta.overlapX) * sourceWidthFraction;
                    let top = (tile.y === 0 ? 0 : tileMeta.overlapY) * sourceHeightFraction;
                    let right = (tile.isRightMost ? 1 : 1 - tileMeta.overlapX) * sourceWidthFraction;
                    let bottom = (tile.isBottomMost ? 1 : 1 - tileMeta.overlapY) * sourceHeightFraction;
                    position = new Float32Array([
                        left, bottom,
                        left, top,
                        right, bottom,
                        right, top
                    ]);
                } else {
                    position = new Float32Array([
                        0, sourceHeightFraction,
                        0, 0,
                        sourceWidthFraction, sourceHeightFraction,
                        sourceWidthFraction, 0
                    ]);
                }

                const tileInfo = {
                    position: position,
                    texture: null,
                    vectors: undefined,
                };

                try {
                    const texture = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, texture);

                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this._imageSmoothingEnabled ? this._gl.LINEAR : this._gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this._imageSmoothingEnabled ? this._gl.LINEAR : this._gl.NEAREST);
                    //gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

                    // upload the image data into the texture
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
                    tileInfo.texture = texture;
                    return tileInfo;
                } catch (e){
                    // Todo a bit dirty re-use of the tainted flag, but makes the code more stable
                    tiledImage.setTainted(true);
                    $.console.error('Error uploading image data to WebGL. Falling back to canvas renderer.', e);
                    this._raiseDrawerErrorEvent(tiledImage, 'Unknown error when uploading texture. Falling back to CanvasDrawer for this TiledImage.');
                    this.setInternalCacheNeedsRefresh();
                }
                // }
                // }

                // TODO fix this
                // if (data instanceof Image) {
                //     const canvas = document.createElement( 'canvas' );
                //     canvas.width = data.width;
                //     canvas.height = data.height;
                //     const context = canvas.getContext('2d', { willReadFrequently: true });
                //     context.drawImage( data, 0, 0 );
                //     data = context;
                // }
                // if (data instanceof CanvasRenderingContext2D) {
                //     return data;
                // }
                $.console.error("Unsupported data used for WebGL Drawer - probably a bug!");
                return {};
            }).catch(e => {
                //TODO: support tile failure - if cache load fails in some way, the tile should be marked as such, and it should be allowed to enter rendering routine nevertheless
                $.console.error(`Unsupported data type! ${data}`, e);
            });
        }

        // internalCacheFree(data) {
        //     if (data && data.texture) {
        //         this._gl.deleteTexture(data.texture);
        //         data.texture = null;
        //     }
        // }

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
                data.vectors = null;
            }
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
