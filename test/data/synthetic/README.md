# Synthetic pathology data

Data for the shader gallery at `test/demo/shader-gallery.html`.

## You probably do not need to run anything

The gallery generates every tile it needs **in the browser**, per tile, on demand.
Start the dev server and open it:

```
npm run dev
# http://localhost:8888/test/demo/shader-gallery.html
```

That gives you a procedural H&E slide, scalar overlays (tumour probability, grade
classes, nuclear density, signed expression delta, region masks), an 8-channel
immunofluorescence stack, and an RGBA16F high-dynamic-range field — all with zero
bytes on disk. The generator lives in `test/demo/synthetic-pathology-sources.js`.

The brightfield slide is built in stain-concentration space and composed forward
through Beer–Lambert using the same Ruifrok–Johnston stain vectors that
`src/flex-layers/stain-separation.js` inverts, so the deconvolution shader is
running on input it can actually be right about. The gallery's
"Deconvolution vs ground truth" card differences the recovered hematoxylin
concentration against the value the generator used; near-black means agreement.

## What `generate.py` adds

Two things the browser cannot do for itself. Output goes to `out/`, which is
gitignored.

```
pip install pillow numpy
python generate.py --slide        # real tissue instead of procedural tissue
python generate.py --precision    # file-backed RGBA16F fixture
python generate.py --all
```

### `--slide`

Searches Wikimedia Commons for a freely licensed (CC0 / CC BY / CC BY-SA / public
domain) H&E histology image, downloads it, and tiles it into a DZI pyramid with
the same `TileSize=254 Overlap=1 Format=jpg` layout as the existing fixtures in
`test/data`:

```
out/he_slide.dzi
out/he_slide_files/<level>/<col>_<row>.jpg
out/ATTRIBUTION.md
```

It searches rather than hardcoding a filename, so it does not rot when a file is
renamed, and it reports the licence and author of whatever it picked. Read
`ATTRIBUTION.md` and carry it with the images if you redistribute them.

Pass `--slide-url <url>` to use a specific image instead; then the licence check
is yours, not the script's.

The gallery probes `out/he_slide.dzi` on load. Present, and the brightfield cards
switch to it and the header pill turns green; absent, they stay procedural. So
this is purely additive — deleting `out/` breaks nothing.

### `--precision`

Writes `out/ki67_f16.bin` (interleaved RGBA half-floats, little-endian, row-major)
plus `out/ki67_f16.json` describing it. Channels 0 and 1 deliberately leave
`[0,1]`:

| channel | name            | range        |
| ------- | --------------- | ------------ |
| 0       | ki67-score      | ≈ −0.4 … 3.1 |
| 1       | log2-ratio      | signed       |
| 2       | ki67-normalized | 0 … 1        |
| 3       | one             | 1            |

The gallery does **not** load this file — its high-dynamic-range card generates
the same field at runtime, which already exercises the float16 path end to end.
The file exists so that:

- tests can feed a float pack from disk without trusting the in-browser
  `toHalf` encoder, and
- that encoder can be diffed against numpy's `float16`, which is an independent
  implementation of the same IEEE-754 binary16 rounding.

Feed it to the renderer as:

```js
{ width, height, channelCount: 4, packs: [{ format: "RGBA16F", data: uint16Array }] }
```

## Field reference

`test/demo/synthetic-pathology-sources.js` installs four tile sources:

| `type`             | payload                    | notes                                              |
| ------------------ | -------------------------- | -------------------------------------------------- |
| `synthetic-he`     | canvas / `image`           | `stains: "he" \| "hdab"`, `seed` for serial sections |
| `synthetic-scalar` | canvas / `image`           | `field:` one of the fields below                    |
| `synthetic-if`     | 2× RGBA8 `gpuTextureSet`   | 8 markers: DAPI, CD3, CD8, CD20, PanCK, Ki-67, CD68, aSMA |
| `synthetic-f16`    | 1× RGBA16F `gpuTextureSet` | declares `getTileDataPrecision() → "float16"`       |

Scalar fields: `tumour-prob`, `grade-classes`, `nuclei-density`,
`expression-delta`, `mask`, `truth-hematoxylin`, `class-stroma`,
`class-invasive`, `class-core`.

Every field is a pure function of *image* coordinates, so tiles agree with each
other and across pyramid levels, and every overlay registers with the slide —
they all read the same `lesionField`.

Individual nuclei are faded into a smooth density term once one output pixel
covers more image pixels than a nucleus radius. That is what averaging optical
density over a larger footprint physically does, and it keeps the low-zoom levels
from turning into aliasing noise.
