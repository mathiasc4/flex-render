## Events

`FlexRenderer` is an `OpenSeadragon.EventSource`. Subscribe with `addHandler(...)`.

### Listen to events

```js
const renderer = viewer.drawer.renderer;

renderer.addHandler('visualization-change', (e) => {
    console.log('visualization-change', e.reason, e.snapshot);
});

renderer.addHandler('program-used', (e) => {
    console.log('program-used', e.name, e.program);
});

renderer.addHandler('html-controls-created', (e) => {
    console.log('html-controls-created', e.name);
});
```

---

## `visualization-change`

Canonical semantic event for persistence, sync, autosave, undo/redo, and history.

### Payload

```js
{
    reason: "control-change" | "mode-change" | "filter-change" | "channel-change" | "external-config" | "configure-tiled-image",
    snapshot: {
        order: ["shaderA", "shaderB"],
        shaders: {
            shaderA: {
                id: "shaderA",
                    name: "Layer A",
                    type: "identity",
                    visible: 1,
                    fixed: false,
                    tiledImages: [0],
                    params: { ... },
                cache: { ... }
            }
        }
    },

    // present when applicable
    shaderId: "shaderA",
    shaderType: "identity",

    // control-change
    controlName: "opacity",
    controlVariableName: "default",
    encodedValue: "0.5",
    value: 0.5,

    // mode-change
    mode: "show",
    blend: "source-over",

    // external-config
    external: true
}
```

### Emission points

- `control-change`
  Fired from UI control change path.
- `mode-change`
  Fired when shader mode / blend is reset.
- `filter-change`
  Fired when shader filters are reset.
- `channel-change`
  Fired when shader channels are reset.
- `external-config`
  Fired when `overrideConfigureAll(...)` applies external configuration.
- `configure-tiled-image`
  Fired when `configureTiledImage(...)` assigns or updates per-image shader config.

### Notes

- `snapshot` is always included.
- `snapshot` is JSON-safe and intended for persistence/export.
- `params` contains effective shader settings.
- `cache` contains stored UI control values.
- This is the event to use for save/restore workflows.

---

## Lifecycle events

### `inspector-change`

Semantic event fired when the canonical inspector state changes.

### Payload

```js
{
    reason: "set-inspector-state" | "clear-inspector-state" | "drawer-set-inspector-state" | string,
    previous: {
        enabled: false,
        mode: "reveal-inside",
        centerPx: { x: 0, y: 0 },
        radiusPx: 96,
        featherPx: 16,
        lensZoom: 2,
        shaderSplitIndex: 0
    },
    current: {
        enabled: true,
        mode: "lens-zoom",
        centerPx: { x: 320, y: 180 },
        radiusPx: 96,
        featherPx: 16,
        lensZoom: 2,
        shaderSplitIndex: 1
    }
}
```

### Notes

- `previous` and `current` are normalized copies of the canonical inspector state.
- Use this event for inspector UI sync, persistence, or instrumentation.
- Backend implementations should read inspector state from `renderer.getInspectorState()`, not from event payload caching.

---

### `interaction-change`

Semantic event fired when the canonical renderer-owned interaction state is updated.

This event is intended for observers, debug UI, instrumentation, tests, and future tooling. Backend implementations should read interaction state from `renderer.getInteractionState()` during rendering, not from cached event payloads.

### Payload

```js
{
    reason: "set-interaction-state" | "clear-interaction-state" | "drawer-enable-interaction" | "drawer-disable-interaction" | string,
    changed: true,
    previous: {
        enabled: false,
        pointerInside: false,
        pointerPositionPx: { x: 0, y: 0 },
        activeButtons: 0,
        lastClickPositionPx: { x: 0, y: 0 },
        lastClickButtons: 0,
        clickSerial: 0,
        dragActive: false,
        dragStartPositionPx: { x: 0, y: 0 },
        dragCurrentPositionPx: { x: 0, y: 0 },
        dragEndPositionPx: { x: 0, y: 0 },
        dragButtons: 0,
        dragSerial: 0
    },
    current: {
        enabled: true,
        pointerInside: true,
        pointerPositionPx: { x: 320, y: 180 },
        activeButtons: 1,
        lastClickPositionPx: { x: 300, y: 180 },
        lastClickButtons: 1,
        clickSerial: 2,
        dragActive: true,
        dragStartPositionPx: { x: 260, y: 160 },
        dragCurrentPositionPx: { x: 320, y: 180 },
        dragEndPositionPx: { x: 0, y: 0 },
        dragButtons: 1,
        dragSerial: 0
    }
}
```

### Interaction state coordinates

All interaction position fields use physical renderer framebuffer pixels with bottom-left origin. They are directly comparable to `gl_FragCoord.xy` in generated GLSL code.

This applies to:

- `pointerPositionPx`
- `lastClickPositionPx`
- `dragStartPositionPx`
- `dragCurrentPositionPx`
- `dragEndPositionPx`

### Button bitmasks

Button fields use the browser `MouseEvent.buttons` / `PointerEvent.buttons` bitmask:

```txt
0  = no button active
1  = primary button, usually left mouse button
2  = secondary button, usually right mouse button
4  = auxiliary button, usually middle mouse button
8  = fourth button, usually browser back
16 = fifth button, usually browser forward
```

Multiple pressed buttons are represented by bitwise OR:

```txt
3 = primary | secondary
5 = primary | auxiliary
```

The relevant state fields are:

- `activeButtons`
- `lastClickButtons`
- `dragButtons`

### Notes

- `previous` and `current` are normalized defensive snapshots of the canonical interaction state.
- `changed` is `true` when the full normalized state changed and `false` when an attempted update normalized to the same state.
- `setInteractionState(...)` uses patch semantics.
- `clearInteractionState(...)` performs a full reset to the disabled default state.
- FlexDrawer may suppress notifications for high-frequency pointer movement by using `notify: false`.
- FlexDrawer disables interaction by detaching observer listeners, resetting drawer-local tracking state, and clearing the renderer-owned interaction state.
- Backend uniform upload does not depend on this event. It reads the latest state through `renderer.getInteractionState()`.

---

### `program-used`

Fired after a WebGL program is switched to and before shader-layer JS initialization runs.

### Payload

```js
{
name: "first-pass" | "second-pass",
program: programInstance,
shaderLayers: renderer.getAllShaders()
}
```

### `html-controls-created`

Fired after HTML controls are generated by `htmlHandler(...)` during second-pass initialization.

### Payload

```js
{
name: "second-pass",
program: programInstance,
shaderLayers: renderer.getAllShaders()
}
```

Use these lifecycle events for instrumentation and UI orchestration, not for semantic persistence.

---

## Snapshot / export API

### Get current visualization snapshot

```js
const snapshot = renderer.getVisualizationSnapshot();
```

### Explicit export alias

```js
const snapshot = renderer.exportVisualization();
```

### Snapshot shape

```js
{
    order: ["shaderA", "shaderB"],
        shaders: {
        shaderA: {
            id: "shaderA",
                name: "Layer A",
                type: "identity",
                visible: 1,
                fixed: false,
                tiledImages: [0],
                params: { ... },
            cache: { ... }
        }
    }
}
```

### Notes

- `order` is the shader render order.
- `shaders` is a map of shader id -> serialized `ShaderConfig`.
- Private/runtime fields are excluded by the serializer.
- Persist this object, not live shader/control/program instances.

---

## Autosave example with debounce

```js
function debounce(fn, wait = 250) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

const renderer = viewer.drawer.renderer;

const persistVisualization = debounce((snapshot) => {
    localStorage.setItem('viewer.visualization', JSON.stringify(snapshot));
}, 250);

renderer.addHandler('visualization-change', (e) => {
    persistVisualization(e.snapshot);
});
```

---

## Restore example

```js
async function restoreVisualization(viewer) {
    const raw = localStorage.getItem('viewer.visualization');
    if (!raw) return;

    const snapshot = JSON.parse(raw);
    await viewer.drawer.overrideConfigureAll(snapshot.shaders, snapshot.order);
    viewer.forceRedraw();
}
```
