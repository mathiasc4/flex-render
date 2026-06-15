# Inspector Contract

This document defines the public inspector API and backend responsibilities.
It is intentionally renderer-backend agnostic so a future WebGPU implementation can match the same behavior without copying the WebGL2 internals.

## Purpose

The inspector is a second-pass visualization modifier controlled by one canonical renderer-owned state object.

Phase 1 supports three modes:

- `reveal-inside`
- `reveal-outside`
- `lens-zoom`

The required visible behavior is:

- reveal modes act as A/B comparison over shader slots using `shaderSplitIndex`
- the first shader slot with index `>= shaderSplitIndex` is affected by the reveal mask
- shader slots before `shaderSplitIndex` are always rendered normally
- lens mode magnifies the already composed second-pass image inside the lens

## Ownership And Responsibilities

### Renderer owns

- canonical inspector state storage
- state normalization
- public API for reading and updating the state
- `inspector-change` event emission
- deciding whether the active mode stays inline in the normal second pass or uses a backend compositor path

### Drawer owns

- convenience forwarding methods for application code
- building second-pass render arrays from the current viewer state

The drawer does not own inspector state and does not synchronize it to the navigator.

### Backend owns

- GPU resources, programs, and offscreen targets
- inline second-pass implementation for reveal modes
- optional compositor path for lens mode
- consuming the canonical state from `renderer.getInspectorState()`

The backend must not invent a different inspector state shape.

## Canonical Inspector State

Use this exact logical shape:

```js
{
    enabled: false,
    mode: "reveal-inside",
    centerPx: { x: 0, y: 0 },
    radiusPx: 96,
    featherPx: 16,
    lensZoom: 2,
    shaderSplitIndex: 0
}
```

Normalization rules:

- invalid or missing input resolves to the defaults above
- `mode` must be one of `reveal-inside`, `reveal-outside`, `lens-zoom`
- `enabled` is boolean
- `radiusPx >= 0`
- `featherPx >= 0`
- `lensZoom >= 1`
- `shaderSplitIndex` is a non-negative integer
- `centerPx.x` and `centerPx.y` are numeric canvas-pixel coordinates

All geometric values are defined in canvas pixel space.

## Public API

### Renderer API

- `renderer.setInspectorState(state, options)`
- `renderer.getInspectorState()`
- `renderer.clearInspectorState(options)`
- `renderer.renderSecondPassToTexture(renderArray, options)`
- `renderer.clientPointToFramebufferPx({clientX, clientY})`

Expected semantics:

- `setInspectorState(...)` stores normalized state, emits `inspector-change`, and optionally requests redraw
- `getInspectorState()` returns a defensive copy
- `clearInspectorState()` resets to the normalized disabled state
- `renderSecondPassToTexture(...)` reuses the current first-pass result and renders the normal second pass into an offscreen target

### Drawer API

- `drawer.setInspectorState(state)`
- `drawer.clearInspectorState()`
- `drawer.getCurrentShaderRenderArray(view, shaderMap, shaderOrder)`
- `drawer.renderVisualizationToTexture(options)`
- `drawer.clientPointToFramebufferPx({clientX, clientY})`

These are convenience entry points. The drawer forwards state changes to the renderer.

### Client-to-framebuffer conversion

`clientPointToFramebufferPx({clientX, clientY})` is the canonical way to convert a DOM pointer event (or any `{clientX, clientY}` pair) into the canvas-pixel space used by `inspector.centerPx`. It returns physical framebuffer pixels with bottom-left origin (directly comparable to `gl_FragCoord.xy`) and is `devicePixelRatio`-aware via `canvas.width / rect.width`. Application code that drives `inspector.centerPx` from mouse movement should use this method rather than reimplementing the conversion — reimplementations that ignore DPR cause the lens to drift away from the cursor on high-DPI displays.

## Execution Model

### Reveal modes

`reveal-inside` and `reveal-outside` must execute inline in the normal second-pass composition.

Required behavior:

- each shader slot computes a per-slot alpha modifier
- only slots with index `>= shaderSplitIndex` are masked
- `reveal-inside` keeps the masked area and suppresses the outside
- `reveal-outside` suppresses the masked area and keeps the outside

This is intentionally defined at the composed-layer level, not as a separate compositor pass.

### Lens mode

`lens-zoom` may use a backend-specific compositor path.

Phase-1 required model:

1. render the full normal second pass to an offscreen color target
2. run a cheap compositor over that full result
3. inside the lens, sample the same full result with zoomed UVs
4. outside the lens, keep the original full result

Phase 1 explicitly does not include:

- base texture contracts
- alternate texture contracts
- split logic inside the compositor
- navigator synchronization

## Shader-Side Meaning

Mode mapping:

- `0` disabled
- `1` reveal-inside
- `2` reveal-outside
- `3` lens-zoom

Backends may encode the state differently internally, but they must preserve the same semantics.

The reference WebGL2 implementation packs second-pass uniforms as:

```js
u_inspectorA = [
    centerPx.x,
    centerPx.y,
    radiusPx,
    featherPx
];

u_inspectorB = [
    enabled ? 1 : 0,
    modeInt,
    shaderSplitIndex,
    lensZoom
];
```

This packing is not the API by itself. The API is the canonical logical state and the visible behavior above.

## Events

Renderer emits:

```js
renderer.addHandler("inspector-change", (e) => {
    console.log(e.reason, e.previous, e.current);
});
```

Payload:

```js
{
    reason: "set-inspector-state" | "clear-inspector-state" | "drawer-set-inspector-state" | string,
    previous: InspectorState,
    current: InspectorState
}
```

`current` and `previous` use the normalized canonical shape.

## Backend Checklist

A backend is compatible with the inspector contract when all of the following are true:

- it reads state through `renderer.getInspectorState()`
- reveal modes stay in the normal second-pass composition
- lens mode matches the full-second-pass-plus-compositor model
- the lens geometry uses canvas pixel coordinates
- shader split behavior starts at `shaderSplitIndex`
- offscreen rendering through `renderSecondPassToTexture(...)` is supported if the backend claims inspector compositor support
- no navigator-specific state propagation is required for correctness
