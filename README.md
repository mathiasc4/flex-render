# OpenSeadragon - Flex Render

Versatile GPU-accelerated drawer implementation for OpenSeadragon. The design originates from [xOpat viewer](https://github.com/RationAI/xopat),
where the basis for this rendering engine was developed.

See it in action and get started using it at [https://openseadragon.github.io/][openseadragon].

Additional implementation notes:

- [OFFSCREEN.md](./OFFSCREEN.md) documents offscreen rendering helpers
- [src/EVENTS.md](./src/EVENTS.md) documents semantic and lifecycle events
- [INSPECTOR.md](./INSPECTOR.md) defines the backend-agnostic inspector contract used by WebGL2 and future backends
- [STYLING.md](./STYLING.md) explains how to mount and theme renderer-generated control UI

## Usage

OpenSeadragon v6.0+ is required to use this renderer. It is a drop-in replacement for the default OpenSeadragon drawer, which means you can use it as a regular OpenSeadragon drawer.
Load this renderer after OpenSeadragon and before creating the viewer. It will automatically register itself as a renderer option.

````js
let viewer = OpenSeadragon({
    drawer: 'flex-renderer',
    drawerOptions: {
        'flex-renderer': {
            // optional renderer configuration
            // debug: true
        }
    },
    // other options like id: ...
});
````

### Shared WebGL Contexts

Multiple `FlexDrawer` / `FlexRenderer` instances can share one WebGL context by using the same
`sharedContextKey` string in the public drawer options. The application configures this only through
`FlexDrawer`; callers do not create or pass WebGL contexts directly.

````js
const viewerA = OpenSeadragon({
    id: 'viewer-a',
    drawer: 'flex-renderer',
    drawerOptions: {
        'flex-renderer': {
            sharedContextKey: 'main-shared-context'
        }
    },
    // other viewer options...
});

const viewerB = OpenSeadragon({
    id: 'viewer-b',
    drawer: 'flex-renderer',
    drawerOptions: {
        'flex-renderer': {
            sharedContextKey: 'main-shared-context'
        }
    },
    // other viewer options...
});
````

Sharing means that renderers with the same key use the same underlying `WebGLRenderingContext` /
`WebGL2RenderingContext`. Each renderer still keeps its own shader configuration, callbacks,
OpenSeadragon drawer state, render dimensions, renderer-local presentation canvas, and visible output.
Calling `clear()` on one shared renderer clears only that renderer's presentation canvas; it must not
clear another renderer's visible output.

`clear()` drops the renderer's pass results and, in shared-context mode, clears the presentation
canvas to fully transparent. `clearOutput()` is the other one: it clears the output surface to the
presentation backdrop and keeps the pass results, which is what a caller re-running only the second
pass wants.

Important constraints:

- all renderers using the same `sharedContextKey` must request the same WebGL version;
- the first renderer that creates a shared key owns the WebGL context creation options;
- later renderers using the same key but different `canvasOptions` attach to the existing context and emit a warning;
- context loss is detected and reported in diagnostics, but automatic GPU resource restoration is not implemented;
- shared-context presentation currently uses `readPixels` to copy the renderer-owned final color target into the renderer-local presentation canvas.

For diagnostics, use:

````js
const status = OpenSeadragon.FlexRenderer.getSharedContextStatus();
console.log(status);
````

The manual demo `test/demo/shared-context-validation.html` creates two shared viewers and one private
viewer. With navigators disabled, the expected result is three `FlexRenderer` instances using two WebGL
contexts: one context shared by viewers A and B, and one private context for the private viewer.


Then, you can use one of built-in (or implement custom) visualization styles by
configuring ``TiledImages`` via JSON `shader layers`. The configuration can happen in two ways:
- handled internally: each Tiled Image will be automatically assigned ``identity`` rendering style,
  which you can customize by calling
  ````js
   viewer.drawer.configureTiledImage(tiledImage, {
       type: 'identity'
   });
  ````
- handled externally: completely override the renderer output by custom rendering configuration
   ````js
   viewer.drawer.overrideConfigureAll({
       'key1': {
           type: 'identity',
           tiledImages: [0],
       },
       'key2': {
           type: 'identity',
           tiledImages: [1],
       },
       'key3': {
           type: 'identity',
           tiledImages: [2],
       }
   }, ['key1', 'key3', 'key2']); // we can define custom layer order for rendering
   ````
In the first case, TiledImage configurations (like blending mode) are respected. In the second case,
the TiledImage settings are **completely overridden** by the provided configuration. That means properties
like `opacity` or `blendMode` are ignored on the TiledImage level, and read only from the provided JSON.

### Renderer Lifecycle

The renderer has two related but distinct lifecycles:

- configuration lifecycle: shader configs are registered, `ShaderLayer` instances are created, and the second-pass WebGL program is compiled
- data lifecycle: tile payloads arrive later, and only then does the drawer know source-dependent runtime metadata such as pack count and channel count for `gpuTextureSet` inputs

The important consequence is that shader instances are usually created before all source metadata is known.
This is intentional. The renderer does not wait for all data before creating shaders.

The current lifecycle is:

1. `configureTiledImage(...)` or `overrideConfigureAll(...)` registers shader configs and creates `ShaderLayer` instances.
2. `viewer.drawer.rebuild()` or the internal rebuild path recompiles the second-pass program from the currently registered shaders.
3. Tiles start loading. During tile normalization, the drawer extracts runtime metadata from the loaded payload.
4. If that runtime metadata changes the effective source shape, the affected shader instances are refreshed and the program is rebuilt again.
5. Rendering continues normally with the updated shader instances and metadata uniforms.

This means a shader can safely exist before all data is loaded, but source-dependent control topology should be derived from source metadata helpers rather than from constructor-time assumptions.

At the moment, the following source information is available from `ShaderLayer` on the JS side:

- `getSourceInfo(sourceIndex)` returns a consolidated object with `metadataReady`, `channelCount`, `packCount`, `dimensions`, `minLevel`, `maxLevel`, `levelCount`, `metadata`, and the bound `tiledImage`
- `getSourceChannelCount(sourceIndex)` and `getSourcePackCount(sourceIndex)` expose the runtime sampling shape
- `getSourceDimensions(sourceIndex)`, `getSourceLevels(sourceIndex)`, and `getSourceMetadata(sourceIndex)` expose tile-source metadata

For GLSL, the second-pass shader already receives per-source runtime sampling metadata:

- `osd_channel_count(sourceIndex)`
- `osd_pack_count(sourceIndex)`
- `osd_texture(sourceIndex, packIndex, uv)`
- `osd_channel(sourceIndex, channelIndex, uv)`

`overrideConfigureAll(...)` is therefore not required to "consume data first". The more precise rule is:
ensure shaders can refresh when source metadata becomes known, and rebuild the program when metadata changes shader structure.

### Render Precision

The first pass stitches tile textures into an offscreen `TEXTURE_2D_ARRAY`, and the second pass runs
`ShaderLayer` instances against it. By default that intermediate colour target is `RGBA8`, so **all** data
reaching a shader is quantized to 8 bits and clamped to `[0,1]` — even when the tile itself was uploaded as
`RGBA16F` (e.g. geotiff float packs). GPU-side rescale/VOI on real float data is impossible in that mode.

Opt into a half-float target with the `precision` option:

```js
viewer.drawerOptions['flex-renderer'] = {
    precision: 'auto'   // 'unorm8' (default) | 'auto' | 'float16'
};
```

**Precision is a property of the data, not of the shader.** The same `single_channel` layer is used over an
8-bit brightfield slide and over a 16-bit float plane, so it cannot know in advance what it will be pointed
at. Under `'auto'` the negotiation therefore runs that way round: the *data* declares what it carries, a
`ShaderLayer` may *veto*, and the renderer resolves.

| `precision` | behaviour |
|---|---|
| `'unorm8'` (default) | `RGBA8` always. Float tile data is quantized and clamped; one `info` names the fix. |
| `'auto'` | `RGBA16F` when the data carries float **and** nothing vetoes. |
| `'float16'` | `RGBA16F` whenever the context supports it, ignoring data and vetoes. |

Under `'auto'`:

1. the drawer reports what the tiles carry — `FlexRenderer#setDataCarriesHighPrecision(bool)`, aggregated over
   the world from each prepared tile's pack format, plus an optional early
   `tileSource.getTileDataPrecision()` (`'unorm8' | 'float16'`) that lets a source answer from its header and
   skip one mid-load program rebuild;
2. a shader config declaring `precision: 'float16'` demands the upgrade even over 8-bit data;
3. a `ShaderLayer` class whose `static supportsHighPrecision()` returns `false`, or a config declaring
   `precision: 'unorm8'`, **vetoes** it for the whole renderer — there is only one colour target, so a mixed
   verdict resolves to the clamped one;
4. otherwise `RGBA8`.

> **Removed:** `static requiresHighPrecision()`. A class still defining it gets a warning at registration time
> and is otherwise ignored — use `static supportsHighPrecision()` to veto, or config `precision: 'float16'`
> to demand.

`float16` requires `EXT_color_buffer_half_float` or `EXT_color_buffer_float`
(`renderer.backend.supportsHighPrecisionTargets` probes this). If neither is present the renderer **warns
loudly and falls back to `RGBA8`** rather than downgrading silently. `RGBA16F` is the target rather than
`RGBA32F` on purpose: it is filterable in WebGL2 core and blendable wherever it is colour-renderable, while
32-bit float would additionally need `EXT_float_blend`.

**Behaviour change under `precision: 'float16'`:** `RGBA8` used to clamp first-pass output implicitly, and
`RGBA16F` does not. Values sampled through `sampleChannel()` / `osd_channel()` / `osd_texture()` are therefore
**no longer guaranteed to be in `[0,1]`** — they can be negative or greater than one. Layers that relied on the
old clamp must clamp explicitly. Tiles uploaded as 8-bit unorm are still clamped by the first-pass copy, so an
8-bit background mixed with a float layer behaves exactly as before. The stencil/coverage target stays `RGBA8`.

**Memory:** the colour array is `width × height × dataLayerCount`. At 3840×2160 with 8 data layers this grows
from 66 MB to 133 MB per layer, 531 MB total — per renderer, and a viewer's navigator has one of its own.
That cost is why `'auto'` is off by default: enabling the negotiation is a deployment decision, even though
the negotiation itself then needs no per-shader configuration. Narrowing the *colour target* to `R16F`/`RG16F`
when active layers need fewer channels is a possible follow-up — that is a different thing from the narrow
*tile* formats below, which are already supported.

### Shaders That Need Interaction Forwarding

`FlexDrawer` interaction forwarding is **off by default**: while it is on, every changed pointer move forwards
state and triggers a redraw, so a host wants it enabled only while a layer that consumes pointer state is
actually visible. Which layers those are is declared, not guessed:

```js
const Klass = OpenSeadragon.FlexRenderer.ShaderLayerRegistry.get(type);
if (Klass.requiresInteraction()) {
    drawer.setInteractionEnabled(true);      // or drawerOptions interaction: {enabled: true}
}
```

`static requiresInteraction()` returns `false` on `ShaderLayer` and `true` on layers whose GLSL calls the
`fr_interaction_*` helpers (`fisheye-lens`, `interaction-debug`). Unlike `supportsHighPrecision()` it is **not a
veto**: nothing in the renderer changes because of it. The layer compiles and draws with forwarding off — it
just renders its inactive branch (the lens never opens, the debug overlay stays transparent), which is
indistinguishable from a broken shader. The drawer therefore logs one warning per shader type when such a
layer is built while forwarding is disabled, and never enables forwarding on its own.

The flag is published for catalogues and tooling: `compileDocsModel()` reports `requiresInteraction` per
shader and `compileConfigSchemaModel()` emits `x-requiresInteraction: true` on that shader's layer schema
(the key is absent when false).

Three similarly named things, kept apart:

| name | owner | meaning |
|---|---|---|
| `ShaderLayer.requiresInteraction()` | shader class | the layer's GLSL reads host-supplied pointer state |
| control `interactive: true/false` | UI control definition | whether that control is user-editable / shown |
| `interaction: {enabled}` | `FlexDrawer` option | whether pointer events are observed and forwarded |

The new static is about *pointer state reaching the GLSL* only; it says nothing about UI controls.

### Tile Pack Formats

A `gpuTextureSet` tile payload declares a pixel format per pack. Four are accepted:

| `format` | upload | data view | components/pack | bytes/texel |
|---|---|---|---|---|
| `RGBA8` (default) | RGBA / `UNSIGNED_BYTE` | `Uint8Array` | 4 | 4 |
| `RGBA16F` | RGBA / `HALF_FLOAT` | `Uint16Array` | 4 | 8 |
| `RG16F` | RG / `HALF_FLOAT` | `Uint16Array` | 2 | 4 |
| `R16F` | RED / `HALF_FLOAT` | `Uint16Array` | 1 | 2 |

The narrow formats exist so a quantitative layer with one or two channels does not pay for four. A cached
`R16F` tile is a quarter of the `RGBA16F` one, which matters wherever the tile cache holds many small
single-channel tiles rather than a few big ones.

**This shrinks the tile cache, not the colour target.** The first pass still blits each pack into a full
RGBA layer of the shared offscreen array, so `dataLayerCount` and the memory figure above are unchanged.
`R16F`/`RG16F` are core WebGL2 sized formats and are filterable in core; they are never rendered *into*, so
they need no extension and the capability gate is the same as before.

All packs of one tile must share a format, and `data.length` must be exactly
`width × height × componentsPerPack` — both are validated, with `"unsupported-data"` and `"invalid-data"`
respectively.

**Channel addressing.** Channel `N` lives in pack `N / componentsPerPack`, component `N % componentsPerPack`.
Four channels stored as four `R16F` packs therefore occupy four packs, not one — `sampleChannel()` and
`osd_channel()` handle that, and a channel index at or past the source's `channelCount` reads `0.0`.

**Alpha is not payload in a narrow pack.** Sampling `R16F` yields `(r, 0, 0, 1)` and `RG16F` yields
`(r, g, 0, 1)`; those extra components are the format fill supplied by texture-format conversion. This is the
one place the usual "alpha can carry data just like any other channel" rule does not hold. Declare
`channelCount` on the payload — or let it default to `packs.length × componentsPerPack` — so shaders know
where the data stops. A swizzle wider than the source carries logs a warning and reads zeros.

### Lazy Shader Sources

Some wrapper shaders need to switch between sources that are not already open as `TiledImage`s.
Typical example: a time series where only the currently selected frame should exist in the viewer world,
while the series configuration contains many possible entries.

The drawer now supports this directly through source-binding requests.

- `ShaderLayer.requestSourceBinding(sourceIndex, entry, options)` asks the drawer to rebind one logical shader source slot.
- If `entry` is an integer, it is treated as an existing world `TiledImage` index.
- If `entry` is a descriptor object with `tileSource` or `source`, the drawer can lazily realize it into a stable hidden world slot.
- If `entry` is an opaque ID or custom object, `drawerOptions["flex-renderer"].shaderSourceResolver` can resolve it.

Built-in managed descriptors use one stable world index per logical shader source slot and replace the underlying `TiledImage`
when the selected entry changes. This avoids index churn in `shaderConfig.tiledImages`.

Supported managed descriptor shape:

```js
{
    tileSource: "/data/frame-05.dzi",
    openOptions: {
        x: 0,
        y: 0,
        width: 1,
        opacity: 0
    }
}
```

You can also provide `source` instead of `tileSource`, and `open` instead of `openOptions`.

When you need application-specific lookup, provide a resolver:

```js
const viewer = OpenSeadragon({
    drawer: "flex-renderer",
    drawerOptions: {
        "flex-renderer": {
            shaderSourceResolver: async ({ request, drawer }) => {
                // request.entry can be an external ID, DB record, frame descriptor, ...
                const descriptor = await loadFrameDescriptor(request.entry);

                // Reuse the built-in managed slot implementation.
                return drawer.realizeShaderSourceDescriptor(request, {
                    tileSource: descriptor.url,
                    openOptions: {
                        x: descriptor.x,
                        y: descriptor.y,
                        width: descriptor.width,
                        opacity: 0
                    }
                });
            }
        }
    }
});
```

This mechanism is used by `time-series`: its `series` parameter can now contain either world indexes
or lazy source descriptors resolved later by the drawer.

### Inspector API

The inspector is a renderer-owned second-pass feature with a backend-agnostic state shape.

Application entry points:

```js
viewer.drawer.setInspectorState({
    enabled: true,
    mode: "reveal-inside",
    centerPx: { x: 320, y: 180 },
    radiusPx: 96,
    featherPx: 16,
    shaderSplitIndex: 1
});
```

```js
const state = viewer.drawer.renderer.getInspectorState();
viewer.drawer.clearInspectorState();
```

Behavior contract:

- `reveal-inside` and `reveal-outside` are executed inline in the normal second pass
- `lens-zoom` may use a backend compositor path
- the canonical state shape and backend responsibilities are defined in [INSPECTOR.md](./INSPECTOR.md)

### Shader Layers

Shader layer is a definition of how one or multiple tiled images are rendered. They allow you to
provide custom parameters and customize things like what channels you sample from the data.
Except for the ``type`` property the golden rule is: don't specify what you don't need.

````json
{
  "type": "identity",
  "name": "Probability layer",
  "visible": "1",
  "tiledImages": [0],        // indexes of tiled images to sample from
  "params": {
    "use_gamma": 2.0,        //global parameter, apply gamma correction with parameter 2
    "use_channel0": "grab",  //global parameter, identity shader expects 4 channels - we reorder rgba -> grab
    "use_mode": "show",      //global parameter, blend mode context for the layer ("show", "blend", or "clip" only)
    "use_blend": "add"       //global parameter, blend mode for the layer (mask, add, multiply, screen, overlay, etc.)
}
````
With ``use_mode=show`` the blending is ignored. With `blend`, blending is respected, with `clip` applied only against the previous layer.

Updates to the configuration are generally reflected immediately, if you re-build the program.

### UI Components
When you want to let users to control shader inputs through UI, you need to provide
a handler for rendering the UI components. This handler MUST register the component
UI to DOM when called.

````js
drawerOptions: {
   'flex-renderer':{
      htmlHandler: (shaderLayer, shaderConfig) => {
         const container = document.getElementById('my-shader-ui-container');
         // Create custom layer controls - you can add more HTML controls allowing users to
         // control gamma, blending, or even change the shader type. Here we just show shader layer name + checkbox representing
         // its visibility (but we do not manage change event and thus users cannot change it). In case of error, we show
         // the error message below the checkbox.
         // The compulsory step is to include `shaderLayer.htmlControls()` output.
         container.insertAdjacentHTML('beforeend', 
`<div id="shader-${shaderLayer.id}">
    <input type="checkbox" disabled id="enable-layer-${shaderLayer.id}" ${shaderConfig.visible ? 'checked' : ''}><span>${shaderConfig.name || shaderConfig.type}</span>
    <div>${shaderLayer.error || ""}</div>
    ${shaderLayer.htmlControls()}
</div>`);
      }, 
      htmlReset: () => {
         const container = document.getElementById('my-shader-ui-container');
         container.innerHTML = '';
      }
   }
}
````

UI Components are named arbitrarily (note the reserved `use_` prefix for global parameters though).
They can be configured like so:
````js
{
   type: 'heatmap',
   params: {
       'color': '#ff0000', // color to use for the heatmap
   }        
}
````
Or:
````js
{
   type: 'colormap',
   params: {
       'color': {
           'type': 'color',
           'default': '#ff0000'
           // .. and other properties - depends on the target control type
       }
   }        
}
````

Note that the name of the control in params depends on the shader layer.
Shader layer defines ``color`` as a name for UI control:

````js
 static get defaultControls() {
            return {
                use_channel0: {  // eslint-disable-line camelcase
                    default: "a"
                },
                color: {
                    default: {type: "color", default: "#fff700", title: "Color: "},
                    accepts: (type, instance) => type === "vec3",
                },
    ...
````
But since it does not hardcode any specific properties (missing `required` property map),
we can provide any values we want (including type change) as long as we pass the ``accepts`` check,
which in this case verifies the control outputs ``vec3`` type.

### Icon Fonts
The `icon` control and the `iconmap` shader layer draw glyphs into the WebGL
texture atlas. FlexRenderer ships **icon metadata only** — names, aliases, tags
and codepoints. **No webfont is bundled or downloaded by the library.** Loading
a font is the host page's job, and it only needs to do so for the sets it wants.

| Set | Font family | Host must load |
| --- | --- | --- |
| `html-glyphs` *(default)* | system emoji / symbol fonts | nothing |
| `ph-regular-common` | `Phosphor` | Phosphor regular |
| `ph-fill-common` | `Phosphor-Fill` | Phosphor fill |
| `ph-brands-common` | `Phosphor` | Phosphor regular |
| `fa-solid-common` | `Font Awesome 6 Free` (900) | Font Awesome 6 Free |
| `fa-regular-common` | `Font Awesome 6 Free` (400) | Font Awesome 6 Free |
| `fa-brands-common` | `Font Awesome 6 Brands` | Font Awesome 6 Free |

`html-glyphs` is the default precisely because it renders with no setup. To use
the others, add the stylesheet (or an equivalent local `@font-face`):

````html
<!-- Phosphor -->
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2/src/regular/style.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2/src/fill/style.css">
<!-- Font Awesome -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">
````

Then select the set per control or per vector-tile class:

````js
{ type: 'icon', iconSet: 'ph-fill-common', default: 'map-pin', color: '#c03030' }
````

Loading order does not matter. Because codepoints are known ahead of time, only
the *font* is required — not the stylesheet's CSS classes. Icons whose font has
not arrived yet stay unrendered and resolve themselves once `document.fonts`
reports the family, so a late or slow CDN costs nothing but a short delay.

Both families are addressed by plain names (`house`, `map-pin`, `star`), and
Font Awesome names are registered as aliases on the Phosphor sets, so a style
written as `icon: 'fa-house'` resolves against Phosphor too. Font Awesome is
kept for the brand icons Phosphor has no counterpart for: `docker`, `npm`,
`node-js`, `firefox`, `edge`, `python`.

To contribute your own font, register a set:

````js
OpenSeadragon.FlexRenderer.UIControls.IconLibrary.registerSet('my-icons', {
   kind: 'font-class',
   fontFamily: "'My Icon Font'",
   fontWeight: '400',
   items: [{ name: 'logo', className: 'mi mi-logo', aliases: [], tags: [] }]
});
````

Entries without a codepoint fall back to probing the icon stylesheet in the
DOM, so a set defined this way works as long as its CSS is loaded. The bundled
sets get their codepoints from `src/flex-controls/icon-sets/icon-codepoints.generated.js`,
regenerated with `npm run icons`.

### Changing Configuration Values
Config values can be changed anytime. It is a good idea to not to force the renderer to copy the object,
this way you can share the configuration object active state all the time and modify it as needed.
For changes to take effect, you need to call ``viewer.drawer.rebuild()``, same
for navigator if used. Moreover, ``use_*`` properties must call `reset*()` method. For filters, call `resetFilters(...)`.
For change in mode or blending, call `resetMode()`. For changes in raster channel mapping, call `resetChannel()`.
````js
const shaderLayer = viewer.drawer.renderer.getShaderLayer('my-layer');
const config = shaderLayer.getConfig();
config.params.use_gamma = 1.0; // change gamma to 1.0
shaderLayer.resetFilters(config.params); // reset the use_gamma property to apply the change
viewer.drawer.rebuild();
````
If your shader's control topology depends on source metadata, prefer reading it from `shaderLayer.getSourceInfo(...)`.
When tile payload metadata arrives later, the drawer refreshes the affected shader instances and rebuilds automatically.
We might work on this more to simplify it.

### Dealing With missing TileSources
When you override configuration to a custom shader set, you usually rely on tiled images to be present -
but what some fails to load?!

You can use
````js
VIEWER.addTiledImage({
    tileSource: {type: "_blank", error: "Here goes your error detail."},
    opacity: 0,
    index: toOpenIndex,
});
````
to render transparent placeholder data at the position of the missing tile source.
``toOpenIndex``is the index of failed image - advised is to open all images with explicit
index using ``addTiledImage`` to know it in advance. E.g., call this snipplet in `error` handler
of a parent ``addTiledImage`` call. You can access the error message later as `viewer.world.getItemAt(toOpenIndex).source.error`.

### Per-TiledImage Image Smoothing
OpenSeadragon's `setImageSmoothingEnabled(enabled)` is a drawer-wide flag — it forces the same texture filter on every tiled image.
FlexDrawer keeps that behavior as the default, but also exposes a per-`TiledImage` override:
````js
viewer.drawer.setTiledImageSmoothingEnabled(tiledImage, false); // gl.NEAREST for this image only
viewer.drawer.setTiledImageSmoothingEnabled(tiledImage, true);  // gl.LINEAR for this image only
viewer.drawer.setTiledImageSmoothingEnabled(tiledImage, null);  // inherit the drawer-wide default
````
Useful when one source needs crisp nearest-neighbor sampling (segmentation masks, label maps) while others stay smooth.
Note: the filter is baked in at texture upload time, and OSD's tile cache is keyed by tile content. If two tiled images share the
exact same source tiles, they will share the cached prepared textures and the first uploader wins the filter.

### Processing OffScreen
This drawer supports off-screen processing. You can either use the renderer directly, which is a bit harder,
or if you want to process current viewport in a different way, you can use ``$.makeStandaloneFlexDrawer(originalViewer)``
and then call ``offscreeDrawer.draw(originalViewer.world._items)``. The new viewer can have different shader configuration,
rendering the same viewport in a desired manner. It's synchronized with the originalViewer data.

### Demo Playground
Once dev dependencies are installed, you can run the demo playground to see the renderer in action:
```bash
npm run dev
```
and open http://localhost:8000/test/demo/flex-renderer-playground.html in your browser.

Additional configurator debug pages are available under `test/demo/`:
- `configurator-static-docs.html` renders the static shader/control documentation view.
- `configurator-live-output.html` runs the interactive configurator and prints live config JSON.
- `configurator-scheme.html` dumps the machine-readable configuration schema focused on usable JSON input: `ShaderConfig`, shader `params`, built-in `use_*` options, top-level and group `order` overrides, group `shaders`, typed UI-control config shapes, and reusable `controlTypedefs`.
- `standalone-renderer.html` is a preset-driven standalone runtime test bench for switching synthetic inputs and trying multiple visualization configs without a viewer.

## Roadmap
- Bugfixing & getting ready for the first release
    - Fixing coverage tests: `grunt coverage` still fails, istanbul/esprima cannot parse the modern JS in `src/`
- Modularize ShaderLayers
    - Implement modules (sample color, apply gaussian...) to connect together to create a ShaderLayer.
- Clipping & cropping: concave polygons, and better debugging of both
    - For now, only convex polygons are supported

#### What might be supported
- Canvas2D proxy. People tend to use Canvas2D api to access the rendered data, which
  is currently not possible as the output canvas is native WebGL (or other rendering engine) element.

#### What will not be supported
- Tainted Data. The purpose of this renderer is to draw advanced visualizations on GPU: if your
  data is not GPU-accessible, fix your data.

## Development

If you want to use OpenSeadragon in your own projects, you can find the latest stable build, API documentation, and example code at [https://openseadragon.github.io/][openseadragon]. If you want to modify OpenSeadragon and/or contribute to its development, read the [contributing guide][github-contributing] for instructions.

## License

OpenSeadragon is released under the New BSD license. For details, see the [LICENSE.txt file][github-license].

[openseadragon]: https://openseadragon.github.io/
[github-releases]: https://github.com/openseadragon/flex-render/releases
[github-contributing]: https://github.com/openseadragon/flex-render/blob/master/CONTRIBUTING.md
[github-license]: https://github.com/openseadragon/flex-render/blob/master/LICENSE.txt

## Sponsors

We are grateful for the (development or financial) contribution to the OpenSeadragon project.

<a href="https://www.bbmri-eric.eu"><img alt="BBMRI ERIC Logo" src="assets/logos/bbmri-logo.png" height="70" /></a>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
