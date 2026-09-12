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
`sharedContextKey`, the standalone drawer attaches to the same shared context unless you say otherwise.
Say otherwise with the second argument of `makeStandaloneFlexDrawer`, which is merged over the inherited
options:

````js
const drawer = OpenSeadragon.makeStandaloneFlexDrawer(viewer, { sharedContextKey: null });
````

Prefer a private context for extraction workflows unless you intentionally need shared-context behavior.
The same argument is the only way to reach the other construction-time renderer options —
`presentationClearColor` and `precision` are read once in the constructor and have no setter at all, and
`backgroundColor` has one that does nothing until the shaders are rebuilt. Six keys are pinned and an override of them is ignored:
`debug`, `htmlReset`, `htmlHandler`, `interactive`, `handleNavigator`, `offScreen`. They are what keep the
off-screen drawer from binding another renderer's control DOM by element id and from taking the live
viewer's canvas with it when it is destroyed.

Shared-context presentation currently uses `readPixels` for the final transfer into the presentation
canvas. This avoids using the shared default framebuffer as an intermediate output target.

Do not call `gl.readPixels` against `renderer.gl` to get a drawer's output. It happens to work in
private-context mode, where the default framebuffer *is* the presentation canvas, and it silently reads
the wrong surface in shared-context mode, where the default framebuffer is the registry's page-global
scratch canvas — shared by every renderer on that key and not this drawer's output at all. The supported
ways out are `drawer.extract({result})`, the context returned by `drawer.drawWithConfiguration()`, and
`renderer.getPresentationCanvas()`.

## The Backdrop

Every off-screen pass clears its output to `renderer.presentationClearColor` before its second pass.
This is not cosmetic: the second pass composites premultiplied, with `ONE`/`ONE_MINUS_SRC_ALPHA`, so
without it a region shows the previous pass through wherever it is transparent, and a pass with
nothing to draw leaves the previous region entirely intact.

`presentationClearColor` is not the same knob as `backgroundColor`, and neither substitutes for the
other. `backgroundColor` is the *source*: it is baked into the second-pass fragment shader as the seed
of the layer composition, which is why changing it needs a shader rebuild and why the renderer warns
that `setBackground()` does nothing until one happens. `presentationClearColor` is the *destination*:
the colour the output surface is cleared to before that composition blends onto it. Per pixel the
result is `stack(seeded by backgroundColor) + backdrop * (1 - src.a)`. Making `backgroundColor` opaque
to get an opaque picture would force every pixel opaque regardless of coverage; setting the backdrop
never changes what the shaders emit.

A consumer composing its own passes should call `renderer.clearOutput()` — or `drawer.clearOutput()`
/ `runtime.clearOutput()` on the standalone facades — and should not reach into `renderer.gl` for it.
A bare `gl.clear(gl.COLOR_BUFFER_BIT)` there clears to whatever `clearColor` was last set, which the
first pass leaves at `(0, 0, 0, 0)`, not to the backdrop. `clearOutput()` also binds the target for
itself: the first-pass program leaves its own framebuffer bound on exit, so "whatever is current" is
not reliably the canvas.

`clearOutput()` is not `clear()`. `clear()` drops the renderer's pass results and, in shared-context
mode, clears the presentation canvas to fully transparent; `clearOutput()` keeps the pass results and
clears to the backdrop, which is what a caller re-running only the second pass wants.

A translucent `presentationClearColor` must be supplied with RGB already premultiplied by alpha —
the context is created with `premultipliedAlpha: true`. Nominal black at 50% is `[0, 0, 0, 0.5]`;
nominal red at 50% is `[0.5, 0, 0, 0.5]`, not `[1, 0, 0, 0.5]`.

### Output with an alpha channel

The default backdrop is `[1, 1, 1, 1]`, opaque white, so by default every raster an off-screen pass
returns is opaque — uncovered regions read as white, not as transparent. A consumer that needs a real
alpha channel (a mask, a layer to composite elsewhere) asks for no backdrop at all:

````js
const drawer = OpenSeadragon.makeStandaloneFlexDrawer(viewer, {
    presentationClearColor: [0, 0, 0, 0],  // no backdrop -> the shader's own alpha survives
    sharedContextKey: null,                // private context, see the note above
});
const { data } = await drawer.extract({ result: "imageData", /* view, size, ... */ });
````

This works through the ordinary `extract()` / `drawWithConfiguration()` return value in both context
modes, for different reasons, and neither needs a special readback:

* **private context** — `clearOutput()` clears the default framebuffer, which *is* the presentation
  canvas, to `[0, 0, 0, 0]`, and the copy-out never fills in private mode.
* **shared context** — the second pass lands in a color target that is always cleared to
  `[0, 0, 0, 0]` whatever the backdrop is, and the copy-out's backdrop fill is skipped when the
  backdrop's alpha is zero.

`backgroundColor` does not need changing for this: its default is already `#00000000`. An opaque
`backgroundColor` would defeat the whole thing, since it makes the shader stack emit alpha 1 for every
pixel it covers.

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
