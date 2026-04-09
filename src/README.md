# FlexRenderer ShaderLayer Guide

## 1. ShaderLayer 101

A `ShaderLayer` is a bundle of:

- **Static metadata**: `name()`, `description()`, `sources()`, `defaultControls()`
- **Instance config**: selected tiled images and user-defined `use_*` settings
- **GLSL snippets**: definitions plus fragment shader execution for the second pass
- **Helpers**: `sampleChannel(...)`, `filter(...)`, `getTextureSize(...)`, and related utilities

The base class lives in `flex-shader-layer.js` as `$.FlexRenderer.ShaderLayer`.

When Flex builds the second pass, it:

1. Reads static API from the shader class
2. Instantiates the layer with `shaderConfig`
3. Runs `construct()`, which calls:
    - `resetChannel(...)`
    - `resetMode(...)`
    - `resetFilters(...)`
    - `_buildControls()`
4. Builds GLSL using:
    - `getFragmentShaderDefinition()` for declarations and helper code
    - `getFragmentShaderExecution()` for the code that returns a `vec4`

Inside shader execution code, sample through `this.sampleChannel(...)`, not manual `texture(...)` calls.

---

## 2. Static API you must implement

### 2.1 `static name()` and `static description()`

Used for UI and diagnostics.

```js
static name() {
    return "my_edge_shader";
}

static description() {
    return "Sobel edge detection on a multi-channel TIFF.";
}
```

### 2.2 `static sources()`

Describes what each source slot expects **per sample**, independent of how many physical channels the underlying `TiledImage` has.

```js
/**
 * @typedef {Object} channelSettings
 * @property {Function} acceptsChannelCount
 * @property {String} description
 */
```

```js
static sources() {
    return [{
        acceptsChannelCount: (n) => n === 3,
        description: "Data to detect edges on"
    }];
}
```

What actually happens:

- `construct()` calls `resetChannel(...)`
- `resetChannel(...)` resolves `use_channel0`, `use_channel1`, ...
- `parseChannel(...)` validates the selected swizzle such as `"r"`, `"rg"`, `"rgb"`, `"rgba"`
- `acceptsChannelCount(n)` receives only the **swizzle length** (`1..4`)

That means `acceptsChannelCount(...)` answers:

> Does this shader make sense if `sampleChannel(...)` returns a float / vec2 / vec3 / vec4 for this source?

It does **not** verify that the underlying image truly contains enough physical channels.

Example for RGB input:

```js
static sources() {
    return [{
        acceptsChannelCount: (n) => n === 3,
        description: "Edge input (RGB vec3)"
    }];
}
```

### 2.3 `static get defaultControls()`

Defines UI controls and built-in `use_*` options.

```js
static get defaultControls() {
    return {
        opacity: {
            default: {
                type: "range",
                default: 1,
                min: 0,
                max: 1,
                step: 0.1,
                title: "Opacity:"
            },
            accepts: (type) => type === "float"
        },

        use_channel0: {
            default: "rgb",
            required: null
        },

        use_channel_base0: 0,

        use_gamma: {
            default: 1.0
        },

        use_exposure: {
            default: 0.0
        }
    };
}
```

Flex then:

- stores these settings in shader config
- exposes them to control/UI logic
- applies them through `resetChannel(...)`, `resetFilters(...)`, and `resetMode(...)`

---

## 3. Instance-side API for shader code

### 3.1 `getFragmentShaderExecution()`

Override this to produce the GLSL body that returns a `vec4`.

Use `this.sampleChannel(...)` and `this.filter(...)`, not raw `texture(...)` calls.

```js
getFragmentShaderExecution() {
    const uv = "v_texture_coords";
    const rgb = this.sampleChannel(uv, 0);

    const edge = `vec3(
        abs(dFdx(${rgb}.r)) + abs(dFdy(${rgb}.r)),
        abs(dFdx(${rgb}.g)) + abs(dFdy(${rgb}.g)),
        abs(dFdx(${rgb}.b)) + abs(dFdy(${rgb}.b))
    )`;

    return `
        vec3 color = ${edge};
        return vec4(color, 1.0);
    `;
}
```

### 3.2 `getFragmentShaderDefinition()`

Optional override for GLSL helpers outside `main`. By default it includes GLSL emitted by controls.

```js
getFragmentShaderDefinition() {
    const base = super.getFragmentShaderDefinition();
    return `
${base}

float myHelper(float x) {
    return x * x;
}
`;
}
```

### 3.3 `sampleChannel(textureCoords, sourceIndex = 0, raw = false)`

Current behavior:

```js
sampleChannel(textureCoords, otherDataIndex = 0, raw = false) {
    const chan = this.__channels[otherDataIndex];
    let sampled = `${this.webglContext.sampleTexture(otherDataIndex, textureCoords)}.${chan}`;

    if (raw) {
        return sampled;
    }
    return this.filter(sampled);
}
```

Meaning:

- `otherDataIndex` selects the source entry from `config.tiledImages`
- `chan` is the resolved swizzle from `use_channelN`
- return type depends on swizzle length:
    - `1` → `float`
    - `2` → `vec2`
    - `3` → `vec3`
    - `4` → `vec4`

So today:

```js
this.sampleChannel(uv, 0)
```

means “sample source 0, pack 0, then apply the selected RGBA swizzle”.

Current limitation: this path still samples only the first RGBA pack unless extended further with multi-pack channel addressing.

### 3.4 `filter(glslExpr)`

Applies configured filters such as `use_gamma`, `use_exposure`, `use_logscale`, and similar.

```js
const val = this.sampleChannel("v_texCoord", 0);
const filtered = this.filter(val);
```

Conceptually this becomes something like:

```glsl
logScale(exposure(gamma(raw_value)))
```

### 3.5 `getTextureSize(sourceIndex = 0)`

Exposes GLSL texture size lookup for the selected source.

```js
getTextureSize(otherDataIndex = 0) {
    return this.webglContext.getTextureSize(otherDataIndex);
}
```

Useful for pixel-space kernels, derivative scaling, and neighborhood logic.

---

## 4. Multiple tiled images per shader

The pipeline supports multiple `TiledImage` sources per shader.

### 4.1 Configuration

```js
const myShaderConfig = {
    tiledImages: [0, 3, 2, 1],
    use_channel0: "r",
    use_channel1: "g",
    use_channel2: "b",
    use_channel3: "a"
};
```

Meaning:

- `tiledImages[0] = 0` → source index `0` reads world item `0`
- `tiledImages[1] = 3` → source index `1` reads world item `3`
- and so on

Usage in shader code:

```js
getFragmentShaderExecution() {
    const uv = "v_texture_coords";
    const src0 = this.sampleChannel(uv, 0);
    const src1 = this.sampleChannel(uv, 1);

    return `
        float a = ${src0};
        float b = ${src1};
        float m = max(a, b);
        return vec4(vec3(m), 1.0);
    `;
}
```

Under the hood, second-pass rendering resolves source indices through Flex renderer uniforms and per-layer source mapping.

### 4.2 Important note

In internal mode, where shaders are created implicitly per tiled image, `tiledImageCreated(...)` wraps config so each shader effectively sees only its own tiled image. Multi-source shaders are therefore mainly for **external configuration** via `overrideConfigureAll(...)`.

---

## 5. Events

`FlexRenderer` is an `OpenSeadragon.EventSource`. Subscribe with `addHandler(...)`.

### 5.1 Listening to events

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

### 5.2 `visualization-change`

Canonical semantic event for:

- persistence
- sync
- autosave
- undo/redo
- history

Payload:

```js
{
    reason: "control-change" |
            "mode-change" |
            "filter-change" |
            "channel-change" |
            "external-config" |
            "configure-tiled-image",

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

    shaderId: "shaderA",
    shaderType: "identity",

    controlName: "opacity",
    controlVariableName: "default",
    encodedValue: "0.5",
    value: 0.5,

    mode: "show",
    blend: "source-over",

    external: true
}
```

Emission points:

- `control-change`: UI control change path
- `mode-change`: mode / blend reset
- `filter-change`: filter reset
- `channel-change`: channel reset
- `external-config`: `overrideConfigureAll(...)`
- `configure-tiled-image`: `configureTiledImage(...)`

Notes:

- `snapshot` is always included
- `snapshot` is JSON-safe and intended for export/persistence
- `params` holds effective shader settings
- `cache` holds stored UI control values

### 5.3 Lifecycle events

#### `program-used`

Fired after a WebGL program is switched to and before shader-layer JS initialization runs.

```js
{
    name: "first-pass" | "second-pass",
    program: programInstance,
    shaderLayers: renderer.getAllShaders()
}
```

#### `html-controls-created`

Fired after `htmlHandler(...)` generates controls during second-pass initialization.

```js
{
    name: "second-pass",
    program: programInstance,
    shaderLayers: renderer.getAllShaders()
}
```

Use lifecycle events for instrumentation and UI orchestration, not as the primary persistence trigger.

---

## 6. Snapshot and export API

### 6.1 Get current snapshot

```js
const snapshot = renderer.getVisualizationSnapshot();
```

### 6.2 Explicit export alias

```js
const snapshot = renderer.exportVisualization();
```

### 6.3 Snapshot shape

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

Notes:

- `order` is render order
- `shaders` is `shader id -> serialized ShaderConfig`
- private/runtime fields are excluded by serialization
- persist this object, not live shader/control/program instances

---

## 7. Autosave example with debounce

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

## 8. Restore example

```js
async function restoreVisualization(viewer) {
    const raw = localStorage.getItem('viewer.visualization');
    if (!raw) return;

    const snapshot = JSON.parse(raw);
    await viewer.drawer.overrideConfigureAll(snapshot.shaders, snapshot.order);
    viewer.forceRedraw();
}
```
