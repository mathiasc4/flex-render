# Offscreen Rendering

This renderer is also able to render offscreen data. Not too many renderers should be created,
rather re-use existing ones.

````js
let drawer;
viewer.__ofscreenRender = (drawer = viewer.__ofscreenRender || OpenSeadragon.makeStandaloneFlexDrawer(viewer));
if (viewer.navigator) {
    viewer = viewer.navigator;
}
````

and don't forget to set dimensions and initial configuration:

````js
drawer.renderer.setDimensions(0, 0, viewer.drawer.canvas.width, viewer.drawer.canvas.height, 1, 1);
//... compute config
drawer.overrideConfigureAll(config);
````

and you can process given tiled images:
````js
drawer.draw([tiledImage1, tiledImage2, ...]);
````
Where tiled images MUST ADHERE to the indexes set in the provided config. Of course, you can just skip
the config and use the default rendering, in that case the order of tiled images is arbitrary. But, there
is a catch: this offscreen rendering re-renders the actual viewport that is currently shown.
If you need to download and render different parts of the viewer, you need to do a more complex
setup.

## Rendering Different Parts of the Viewer

You need to first ensure the viewer has necessary images loaded for a target area.
This is yet not part of the available functionality, but will be likely added later.

Once you know that target tiled image tiles are all loaded, you can render them:

````js
const originalTiledImages = config.tiledImages;
config.tiledImages = images.map(i => i.__sshotIndex);

const bounds = viewer.viewport.getHomeBounds();
await drawer.draw(images, {
    bounds: bounds,
    center: new OpenSeadragon.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
    rotation: 0,
    zoom: 1.0 / bounds.width,
});
config.tiledImages = originalTiledImages;
````
Note that unlike before, now we need to await the ``draw`` call. This is because other initialization
including missing tile initialization needs to be done.
