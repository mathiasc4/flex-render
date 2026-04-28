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
    - Fixing tests: inherited from OpenSeadragon, they expect incompatible behavior
    - Fixing coverage tests
- Adding support for WebGL 1.0 (fallback)
- Modularize ShaderLayers
    - Implement modules (sample color, apply gaussian...) to connect together to create a ShaderLayer.
- Add support for concave clipping polygons.
- Adding support for better debugging & cropping
    - For now, only convex polygons are supported
- Dynamic documentation and configuration schema output that parse available shaders and controls and show what JSON can be used where.

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
