# Offscreen Rendering

This renderer is also able to render offscreen data. Not too many renderers should be created;
rather, re-use existing standalone drawers or renderers when possible.

````js
let drawer;
viewer.__offscreenRender = (drawer = viewer.__offscreenRender || OpenSeadragon.makeStandaloneFlexDrawer(viewer));
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


## Canvas and Shared-Context Notes

Use `renderer.getPresentationCanvas()` when copying the visible result of a draw. In private-context
mode this is the WebGL canvas. In shared-context mode it is a renderer-local 2D presentation canvas
that receives the final rendered output from a renderer-owned color target.

Do not copy from `renderer.getWebGLCanvas()` unless you explicitly need the backing WebGL canvas. In
shared-context mode that canvas is shared scratch state and is not durable visible output for any one
renderer.

Standalone helpers inherit the drawer options from the source viewer. If the source drawer uses
`sharedContextKey`, the standalone drawer may attach to the same shared context unless you override that
option before constructing the standalone drawer. Prefer a private context for extraction workflows unless
you intentionally need shared-context behavior.

Shared-context presentation currently uses `readPixels` for the final transfer into the presentation
canvas. This avoids using the shared default framebuffer as an intermediate output target.

## Rendering Different Parts of the Viewer

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

## Waiting for Tiles

An off-screen pass is not a frame of an interactive session. An interactive viewer may draw the tiles
it has and refine over the next few frames; a one-shot extraction has no next frame, so whatever
happened to be resident *is* the whole result. Both `extract()` and `drawWithConfiguration()` can
therefore be told to wait, and always report what they got:

````js
const { data, fullyLoaded, timedOut, stalled } = await drawer.extract({
    view: {bounds, center, rotation: 0, zoom: 1.0 / bounds.width},
    size: {x: 2048, y: 2048},
    waitFullLoad: true,     // wait until every waited image reports getFullyLoaded()
    waitImages: [reference],// wait on these only; every image is still drawn, default: all of them
    loadTimeoutMs: 20000,   // hard upper bound of that wait, default 10000
    stallTimeoutMs: 1500,   // give up earlier when nothing can arrive anymore
    pollIntervalMs: 50,     // upper bound between two tiled image update() pumps
});
````

* ``waitFullLoad: false`` (default) keeps the historical best-effort behaviour: draw the tiles that
  are resident, retrying a few frames only when nothing at all is drawable.
* ``fullyLoaded`` means every **waited** tiled image reported all tiles **for this viewport** loaded.
  It says nothing about tiles OpenSeadragon deliberately discards - a tile that fails permanently is
  excluded from the computation, so a source with missing tiles can report ``fullyLoaded`` with holes.
  An image that contributes nothing to the pass is excluded too: one that is hidden (``opacity: 0``
  and not preloading) or lies outside the rendered region draws no tile and requests none, so it can
  neither complete nor block. A pass in which *no* waited image is in the view reports incomplete -
  nothing was observed.
* ``waitImages`` narrows what completeness means, it does not narrow what is drawn. Pass the images
  whose pixels the caller actually consumes, when an overlay that *is* in the view can never finish -
  a source whose tiles error out, say. Entries that this pass does not draw are ignored (only a
  pumped image can ever complete). It applies to both paths - when ``view`` is omitted the pass has
  no images of its own, so the entries are live world items and entries the live world does not hold
  are ignored.
* ``stalled`` is what separates "finished" from "gave up because nothing more could arrive": no tile
  of the waited images is loading and none of their tiles arrived for ``stallTimeoutMs``. Every
  signal is scoped to the pass, so the user navigating the live viewer neither suppresses this exit
  nor counts as progress. A caller that must degrade closed should trust only
  ``fullyLoaded && !stalled``.
* ``timedOut`` means the deadline ran out with work still in flight.

Only ``mode: "second-pass"`` (the default) returns this envelope; ``"viewport-copy"`` and
``"first-pass-layer"`` return their payload bare, as neither has a notion of per-pass tile
completeness. When the pass re-uses the live drawer's first-pass texture instead of drawing the tiled
images itself (``view`` omitted or a drawer reference), completeness is that of the live viewer's
world at the moment the texture was copied.

The returned ``waited`` (also written into ``options.status`` by ``drawWithConfiguration``) is the
**effective** wait, not the one that was asked for: an image too old to expose ``getFullyLoaded()``
downgrades the pass to best-effort, and ``waited: false`` is how the caller sees that.

### Which images to pass

The wait on the live-texture path is purely observational - the live viewer drives its own loop, so
this only polls it. Its ``stalled`` verdict is therefore arrival-based (the ``_tilesLoading`` counter
is zeroed every frame by the live drawer) and deliberately conservative: a non-empty ImageLoader
queue, which the user's own browsing keeps busy, suppresses it. It can be late, it will not be wrong.

A custom-``view`` pass is the opposite: it must drive ``TiledImage.update()`` itself, against the
standalone viewport, which is only possible by pointing ``tiledImage.viewport`` at it. That binding
is held for a synchronous block at a time and never across an ``await``, so the live viewer never
observes it - but the pump still loads the off-screen region through the same tile cache and the same
per-frame load budget as the user's view. Prefer handing such a pass **detached region mirrors**
(tiled images never added to ``viewer.world``) over the live world items that ``extract()`` defaults
to; ``extract({tiledImages: [...]})`` takes them.
