# GeoJSON Tile Source

`OpenSeadragon.GeoJSONTileSource` renders a GeoJSON document as vector tiles. Parsing,
indexing, clipping and meshing all happen in a worker; the tile source itself is only
the OpenSeadragon `TileSource` boundary.

````js
viewer.addTiledImage({
    tileSource: new OpenSeadragon.GeoJSONTileSource({
        url: 'annotations.geojson',
        bbox: [0, 0, 40000, 30000],
        width: 40000,
        height: 30000,
    })
});
````

## Options

| option | default | meaning |
|---|---|---|
| `url` | required | GeoJSON to fetch. Relative URLs resolve against the document base. |
| `bbox` | from data | Source coordinate extent `[minX, minY, maxX, maxY]`. A GeoJSON 3D bbox is accepted and normalized. |
| `width` / `height` | inferred from `bbox` | Destination extent in OpenSeadragon image coordinates. Supplied together with `bbox`, coordinates are mapped from one into the other. |
| `tileSize` | `512` | Logical tile size. |
| `minLevel` / `maxLevel` | `0` / `ceil(log2(max(width, height)))` | Pyramid range. |
| `style` | see below | Style descriptor. |
| `useNativeLines` | `false` | Emit `LineString` as `gl.LINES` primitives instead of stroke-triangle meshes. |
| `aggregation` | disabled | Collapse dense non-max-level tiles into one count badge. |
| `httpAdapter` | drawer default | Host-supplied HTTP transport for the worker's fetches. |

Accepted GeoJSON roots: `FeatureCollection`, `Feature`, a bare geometry, or a
`GeometryCollection`. `MultiPoint`, `MultiLineString`, `MultiPolygon` and
`GeometryCollection` are exploded into simple records; each part inherits the parent
feature's `properties` and `id`.

## Styling

The flat form colors every feature in a source identically:

````js
style: {
    pointSize: 4,
    pointColor: [1, 0.2, 0.2, 1],
    lineWidth: 2,
    lineColor: [0.2, 1, 0.2, 1],
    fillColor: [0.2, 0.2, 1, 0.6],
}
````

That is rarely what you want for model output, where the colour *is* the payload —
one file is typically thousands of patches, each coloured by what the model predicted
there. Four optional fields derive a colour per feature instead.

### Colour resolution order

Per feature, **first hit wins**:

1. **`classes[properties[classProperty]]`** — a label lookup. Wins over everything
   else, which is what lets you recolour at runtime via [`setStyle`](#setstyle) without
   re-exporting the source data.
2. **`colorProperties`** — the first listed path holding a parseable colour. This is
   the colour the producer baked into the file.
3. **`colormap`** — ramp a numeric property through a colour scale.
4. **`pointColor` / `lineColor` / `fillColor`** — the flat fallback.

All four are optional. **Omit them all and styling behaves exactly as it did before
they existed** — no existing caller changes behaviour.

Nothing here is hardcoded to any ontology: every path, label and ramp is yours. Note
that the spec must be plain JSON rather than a `getColor(props)` callback, because the
resolver runs inside a worker and `postMessage` structured clone does not transfer
functions.

### Worked example

A producer emitting two kinds of prediction into one file:

````js
// categorical — the class name and its colour travel together
{ "type": "Feature",
  "properties": { "classification": { "name": "Papillary", "color": "#e41a1c" } },
  "geometry": { "type": "Polygon", "coordinates": [ ... ] } }

// continuous — colour is a colormap of the score, the score itself sits in metadata
{ "type": "Feature",
  "properties": { "color": [228, 26, 28],
                  "metadata": { "ANNOTATION_DESCRIPTION": 0.7 } },
  "geometry": { "type": "Polygon", "coordinates": [ ... ] } }
````

One style reads both:

````js
style: {
    colorProperties: ['classification.color', 'color'],
    fillColor: [0.2, 0.2, 1, 0.6],   // features carrying neither path
}
````

Add a `classes` table to override the file's own colours — useful for recolouring
subtypes live, without re-running the producer:

````js
style: {
    classProperty: 'classification.name',
    classes: {
        Papillary: '#e41a1c',
        Acinar:    [55, 126, 184],
        Solid:     { color: [0.1, 0.9, 0.1, 1] },   // object form, for future per-class fields
    },
    colorProperties: ['classification.color', 'color'],
    fillColor: [0.2, 0.2, 1, 0.6],
}
````

A class label absent from the table falls through to `colorProperties`, so a partial
table only overrides what it names. Continuous features have no class name at all and
skip tier 1 entirely.

### `colormap`

Ramps a numeric property. Use it when the score is present but a colour is not — or
when you want a ramp the producer didn't bake in:

````js
style: {
    colormap: {
        property: 'metadata.ANNOTATION_DESCRIPTION',
        name: 'Viridis',
        domain: [0, 1],
    },
}
````

| field | meaning |
|---|---|
| `property` | Dotted path to the numeric property. Non-numeric values fall through to the next tier. |
| `name` | Scheme from `src/colormaps.js` (`Viridis`, `Spectral`, `RdBu`, …). |
| `steps` | How many stops to pull from the named scheme. Defaults to the scheme's largest variant. |
| `stops` | Explicit ramp, bypassing `name`. At least two colours. |
| `domain` | `[min, max]`, default `[0, 1]`. Values outside are clamped. |

**`steps` is ramp fidelity, not quantization.** Interpolation between stops is
continuous. If your values are already quantized (a Python `round(p, 1)`, say), that
happened before the value ever reached here and `steps` has no bearing on it.

**Schemes differ in which step counts they offer** — `Viridis` provides 2–8, while
`Spectral` reaches 11. Asking for a variant a scheme lacks throws at construction and
lists what is available. For a ramp of an arbitrary size, pass `stops` directly.

### Colour encodings

Every colour field — flat, `classes`, `colormap.stops` — accepts:

| form | example | → |
|---|---|---|
| CSS hex (leading `#` optional) | `'#e41a1c'`, `'#e41a1c80'`, `'#abc'` | `[0.894, 0.102, 0.110, 1]` |
| 0-255 components | `[228, 26, 28]`, `[228, 26, 28, 153]` | `[0.894, 0.102, 0.110, 0.6]` |
| 0..1 floats | `[0.89, 0.1, 0.11, 0.6]` | as-is |
| packed signed ARGB int (QuPath) | `-1876915` | `[0.890, 0.361, 0.302, 1]` |

Missing alpha means opaque. A packed int with a zero alpha byte is treated as opaque,
matching QuPath's RGB-only convention.

**The 0-255 vs 0..1 rule:** a numeric array is read as 0..1 floats when **every**
component is `<= 1`, and as 0-255 otherwise. `[1, 0, 0]` is genuinely ambiguous — it is
valid in both scales — and resolves to **red**, not 0-255 near-black. This is deliberate:
the alternative rule breaks `[0, 0, 0, 1]`, which must keep meaning opaque black. The
cost is that 0-255 near-black is unwritable as an array; use `'#010000'` if you need it.

In `classes`, `colormap.stops` and the flat fields, an unparseable colour **throws at
construction** — it is a configuration error worth surfacing immediately. In
`colorProperties`, an unparseable per-feature value **falls through to the next tier**
rather than failing the tile, because producer data is not under your control.

## `setStyle`

````js
source.setStyle({
    classProperty: 'classification.name',
    classes: { Papillary: '#00ff00' },
    colorProperties: ['classification.color', 'color'],
});
````

Re-meshes only. The worker keeps its parsed geometries and its spatial index, so
**nothing is refetched and the quadtree is not rebuilt** — cheap enough to drive from a
colour picker. Re-posting the full config would instead re-download the source and
reindex it.

The style is validated before any state changes, so an invalid style is rejected
without leaving the source half-updated. Calling `setStyle` before the source is
attached to a viewer still updates the worker.

## Error handling

Malformed features are **skipped, counted, and warned about**, not fatal:

````
GeoJSONTileSource: skipped 3 of 10000 malformed features. ["feature[9998]: ...", ...]
````

One bad ring in a large file costs you that feature and nothing else — the remaining
features render normally and tiles keep loading at every level. At most a handful of
skip reasons are retained, so a badly broken file does not flood the console.

These are fatal, and latch the source so later tile jobs fail immediately with the real
reason:

- the fetch failing, or `earcut` being unavailable;
- a root that is not a supported GeoJSON type;
- a `FeatureCollection` in which **every** feature fails — the file is not what it claims;
- an invalid style, which throws at construction rather than latching.

Recovering from a fatal error means constructing a new tile source.

## Notes for contributors

### Per-feature colour is free

`_prepareVectorTileBatch` (`src/flex-webgl2.js`) already allocates a per-vertex RGBA
buffer for every vector tile and fans one mesh colour across it, and the worker already
emits one mesh per feature. Per-feature colour therefore only changes *which* colour
each mesh carries — the GPU upload is byte-identical, and the renderer is untouched.
`mesh.parameters` (true per-vertex colour) stays unused; it would only earn its keep if
colour varied *within* one feature.

Resolved colours are memoized on the geometry record against a style epoch, so a
feature spanning many tiles resolves once and `setStyle` invalidates every cache by
bumping the epoch rather than walking every record.

### Why this does not mirror the MVT `classes` shape

`AbstractMVTTileSource.defaultStyle()` has a `style.layers[*].classes` map that looks
similar. It is not reusable here: MVT's `classes` resolves only to **icon atlas
textures**, rasterizing a CSS hex string into a canvas glyph, and never produces the
per-vertex RGBA that fills and lines need. It also cannot express a continuous
producer's output, which has no class name at all — colour there is a per-patch
colormap result. The `classes` *concept* is carried over; the icon-atlas mechanism is
not.

### Deferred: a score channel

Carrying a raw score to the GPU, so a stock `threshold` ShaderLayer can act on it, is
**designed but not implemented**. Recorded here so the contract is fixed in advance.

A score cannot ride in `mesh.parameters`: that *is* `a_payload1`, the colour. No spare
channel exists.

| attribute | contents |
|---|---|
| `a_payload0` | `(x, y, depth, textureId)` |
| `a_payload1` | `(r, g, b, a)` when `textureId < 0`; icon atlas rect otherwise |

Adding an `a_payload2` would cost +16 B/vertex (+50% VBO) and is rejected. The viable
design instead reuses the contract the raster path already states — *"Tiles MUST NOT
blend - alpha channel can carry data just like another channel payload"*. Vectors blend
only because *"they can overlap within single layer"*, and **that premise is false for a
non-overlapping patch grid**. So:

- a per-source opt-in flag (`vectorDataMode`) makes that source's vectors take the
  raster branch (`gl.disable(gl.BLEND)`), and `a_payload1` becomes `(r, g, b, score)`;
- this is safely per-source: vector payloads are assembled per `TiledImage` in
  `src/flex-drawer.js` and the draw loop consumes each source's vectors as a unit, so
  blend state can be set per source with no cross-source contamination. Default off
  leaves every existing flow byte-identical;
- vectors rasterize into the same texture array that ShaderLayers sample, so a stock
  `threshold` with `use_channel0: 'a'` then works unmodified.

Caveats to weigh when it is built: 8-bit quantization (`RGBA8` storage); `LINEAR`
filtering bleeds score across polygon edges; overlapping features become
last-writer-wins; and only `textureId < 0` geometry can carry a score, since textured
meshes hit the icon depth-kill sentinel.

Note that **`colormap` already covers much of this without the alpha channel**: it reads
a score straight from wherever the producer buried it and gives a live-adjustable ramp
via `setStyle`. What it does not give is interactive GPU-side thresholding.
