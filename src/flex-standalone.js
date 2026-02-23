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
         * @param {Array<OpenSeadragon.TiledImage>} tiledImages - The tiled images to draw.
         * @param {Object.<string, ShaderConfig>} [configuration] - map of id -> shader config value
         * @param {OpenSeadragon.Point} [size] - The size of the viewer. Inherited from viewOrReference if not provided,
         *      required if viewport description is provided to the viewOrReference argument.
         * @param {object|OpenSeadragon.FlexDrawer} [viewOrReference] draw desired viewport (full pass) or re-use last frame
         *    - The viewport to draw, see {@link OpenSeadragon.FlexDrawer#draw}
         *    - Or, the reference to the drawer to draw the same viewport as the previous one. By default, the
         *      reference to the standalone drawer is used - which is probably not desired!
         * @returns {Promise<CanvasRenderingContext2D>}
         */
        drawer.drawWithConfiguration = (async function (tiledImages, configuration = undefined, view = undefined, size = undefined) {
            // do not block preprocessing if necessary, custom view requires tiles -> ensure tiles are supported
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
                        const stencilLayers = tiledImages.length; // one stencil layer per TI

                        this.renderer.setDimensions(0, 0, size.x, size.y, colorLayers, stencilLayers);
                        this.draw(tiledImages, view);

                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = size.x;
                        canvas.height = size.y;
                        ctx.drawImage(this.renderer.canvas, 0, 0);
                        return ctx;
                    }).catch(e => console.error(e)).finally(() => {
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
        return drawer;
    };

}(OpenSeadragon));
