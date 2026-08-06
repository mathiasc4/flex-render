/**
 * Synthetic pathology tile sources.
 *
 * Every source here generates its pixels in the browser, per tile, on demand --
 * nothing is stored on disk. The point is to give each shader layer input that
 * shows what it is actually for, on the domain this renderer was built for
 * (whole-slide brightfield and multiplex fluorescence pathology).
 *
 * Four sources are installed:
 *
 *   synthetic-he      brightfield H&E (or H-DAB) slide, canvas tiles
 *   synthetic-scalar  one scalar field in the red channel, canvas tiles
 *   synthetic-if      8-channel immunofluorescence, 2x RGBA8 gpuTextureSet packs
 *   synthetic-f16     4-channel RGBA16F gpuTextureSet with values outside [0,1]
 *
 * Three properties make the whole thing hang together:
 *
 * 1. Every field is a pure function of *image* coordinates, not tile
 *    coordinates. Tiles therefore agree with each other and across pyramid
 *    levels, and -- because all sources share the same `lesionField` -- a
 *    probability overlay lands on the same lesion the slide shows.
 *
 * 2. The brightfield slide is built in stain-concentration space and composed
 *    forward through Beer-Lambert using the *same* Ruifrok-Johnston basis the
 *    `stain-separation` layer inverts (src/flex-layers/stain-separation.js).
 *    The reference tissue colours below are deconvolved into concentrations at
 *    load time, so the slide looks like a real slide AND round-trips exactly
 *    through the shader. `synthetic-scalar` field "truth-hematoxylin" exposes
 *    the generator's own hematoxylin concentration, which makes the
 *    deconvolution checkable rather than merely plausible.
 *
 * 3. The low-frequency fields (lesion, tissue outline, nuclear density, fat
 *    regions, vessels) are evaluated once per tile on a coarse grid and
 *    bilinearly interpolated; only genuinely high-frequency detail -- collagen
 *    fibres, individual nuclei, chromatin -- is computed per pixel. Evaluating
 *    everything per pixel is ~30x slower and misses the tile deadline.
 */
(function($) {

    if ($.SyntheticHETileSource) {
        return;
    }

    // ---------------------------------------------------------------- geometry

    const IMAGE_SIZE = 8192;
    const TILE_SIZE = 256;
    // 2^13 === 8192, so level 13 is full resolution.
    const MAX_LEVEL = 13;
    // 8192 >> 5 === 256: the whole slide fits in a single tile at level 8.
    const MIN_LEVEL = 8;

    // Spacing, in tile pixels, of the coarse sample grid used for smooth fields.
    const COARSE_STRIDE = 8;

    // ------------------------------------------------------------------- noise

    // Integer hash -> [0,1). Deterministic across reloads and machines, which is
    // what lets tiles at different levels agree without any shared state.
    function hash2(ix, iy, seed) {
        let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }

    function smoothT(t) {
        return t * t * (3 - 2 * t);
    }

    function valueNoise(x, y, seed) {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = smoothT(x - ix);
        const fy = smoothT(y - iy);

        const a = hash2(ix, iy, seed);
        const b = hash2(ix + 1, iy, seed);
        const c = hash2(ix, iy + 1, seed);
        const d = hash2(ix + 1, iy + 1, seed);

        const top = a + (b - a) * fx;
        const bottom = c + (d - c) * fx;
        return top + (bottom - top) * fy;
    }

    function fbm(x, y, seed, octaves = 4) {
        let sum = 0;
        let amp = 0.5;
        let norm = 0;
        let fx = x;
        let fy = y;

        for (let i = 0; i < octaves; i++) {
            sum += amp * valueNoise(fx, fy, seed + i * 101);
            norm += amp;
            amp *= 0.5;
            fx *= 2.03;
            fy *= 1.97;
        }

        return sum / norm;
    }

    function clamp01(v) {
        return v < 0 ? 0 : (v > 1 ? 1 : v);
    }

    function smoothstep(edge0, edge1, v) {
        if (edge1 === edge0) {
            return v < edge0 ? 0 : 1;
        }
        return smoothT(clamp01((v - edge0) / (edge1 - edge0)));
    }

    function mix(a, b, t) {
        return a + (b - a) * t;
    }

    // -------------------------------------------------- Ruifrok-Johnston basis

    // Ported verbatim from src/flex-layers/stain-separation.js so the generator
    // and the shader cannot drift apart. If you change one, change both.
    const STAIN_VECTORS = {
        H: [0.65, 0.70, 0.29],
        E: [0.07, 0.99, 0.11],
        DAB: [0.27, 0.57, 0.78],
        R: [0.27, 0.57, 0.78]
    };

    function normalize3(v) {
        const m = Math.hypot(v[0], v[1], v[2]);
        return m > 0 ? [v[0] / m, v[1] / m, v[2] / m] : [0, 0, 0];
    }

    function cross3(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    function buildMatrix(rows, autoResidualIndex) {
        const m = rows.map(r => (r ? normalize3(r) : null));
        if (autoResidualIndex !== undefined) {
            const others = m.filter((_, i) => i !== autoResidualIndex);
            m[autoResidualIndex] = normalize3(cross3(others[0], others[1]));
        }
        return m;
    }

    function inverse3(rows) {
        const [a, b, c] = rows[0];
        const [d, e, f] = rows[1];
        const [g, h, i] = rows[2];
        const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        if (Math.abs(det) < 1e-12) {
            return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        }
        const k = 1 / det;
        return [
            [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k],
            [(f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k],
            [(d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k]
        ];
    }

    // A basis bundles the forward matrix (rows = stain OD signatures) and its
    // inverse, exactly the pair the shader builds.
    function makeBasis(rows, autoResidualIndex) {
        const forward = buildMatrix(rows, autoResidualIndex);
        return { forward: forward, inverse: inverse3(forward) };
    }

    const BASIS = {
        he: makeBasis([STAIN_VECTORS.H, STAIN_VECTORS.E, STAIN_VECTORS.R]),
        hdab: makeBasis([STAIN_VECTORS.H, STAIN_VECTORS.DAB, null], 2)
    };

    const LN10 = Math.log(10);

    // The shader reads OD as -log10((rgb*255 + 1) / 256). Using the identical
    // formulation here (rather than plain -log10(rgb)) is what makes the
    // round-trip through the GPU near-exact instead of merely close.
    function rgb8ToOd(rgb8) {
        return [
            -Math.log((rgb8[0] + 1) / 256) / LN10,
            -Math.log((rgb8[1] + 1) / 256) / LN10,
            -Math.log((rgb8[2] + 1) / 256) / LN10
        ];
    }

    // od * Q, i.e. row-vector times matrix -- the same multiply order as GLSL.
    function odToConcentrations(od, basis) {
        const q = basis.inverse;
        return [
            od[0] * q[0][0] + od[1] * q[1][0] + od[2] * q[2][0],
            od[0] * q[0][1] + od[1] * q[1][1] + od[2] * q[2][1],
            od[0] * q[0][2] + od[1] * q[1][2] + od[2] * q[2][2]
        ];
    }

    function deconvolve(rgb8, basis) {
        return odToConcentrations(rgb8ToOd(rgb8), basis);
    }

    // Forward model: concentrations -> 8-bit RGB. Inverse of rgb8ToOd.
    function recompose(c, basis, out, offset) {
        const f = basis.forward;
        for (let ch = 0; ch < 3; ch++) {
            const od = c[0] * f[0][ch] + c[1] * f[1][ch] + c[2] * f[2][ch];
            const v = 256 * Math.exp(-od * LN10) - 1;
            out[offset + ch] = v < 0 ? 0 : (v > 255 ? 255 : v);
        }
    }

    // Reference colours sampled from the way real H&E prints, deconvolved once
    // into the H&E basis. The tissue model interpolates *these concentration
    // triples*, never RGB -- optical density is what adds linearly.
    //
    // Worth knowing: real H&E pink cannot be produced by the H and E vectors
    // alone. Ruifrok's eosin vector is almost a pure green absorber, so H+E on
    // their own give magenta (R and B suppressed equally). The pink comes from the
    // residual row, which absorbs blue. So these references carry a substantial
    // residual concentration by construction, and the residual channel of the
    // deconvolution is *not* near-empty on this slide -- see the residual card.
    // Add a hematoxylin floor on top of a deconvolved reference. Deconvolving a
    // plausible stroma pink yields cH ~= 0.01, i.e. no hematoxylin at all, which
    // is wrong -- real stroma is mildly basophilic (fibroblast nuclei, basophilic
    // ground substance) and a slide with a literally empty H channel makes the
    // hematoxylin card look broken. The floor darkens the composed colour slightly
    // toward blue, which is also what the real thing does.
    function withHematoxylin(c, extra) {
        return [c[0] + extra, c[1], c[2]];
    }

    const TISSUE = {
        glass: deconvolve([243, 243, 244], BASIS.he),
        fat: withHematoxylin(deconvolve([240, 236, 241], BASIS.he), 0.02),
        stroma: withHematoxylin(deconvolve([206, 128, 166], BASIS.he), 0.14),
        cytoplasm: withHematoxylin(deconvolve([224, 166, 191], BASIS.he), 0.09),
        nucleus: deconvolve([84, 60, 136], BASIS.he),
        chromatin: deconvolve([54, 38, 104], BASIS.he),
        rbc: deconvolve([206, 96, 86], BASIS.he)
    };

    // H-DAB reference colours for the IHC variant.
    const IHC = {
        glass: deconvolve([243, 243, 244], BASIS.hdab),
        counterstain: deconvolve([176, 190, 214], BASIS.hdab),
        nucleus: deconvolve([96, 112, 158], BASIS.hdab),
        dabWeak: deconvolve([196, 158, 116], BASIS.hdab),
        dabStrong: deconvolve([104, 62, 22], BASIS.hdab)
    };

    function lerp3(a, b, t, out) {
        out[0] = a[0] + (b[0] - a[0]) * t;
        out[1] = a[1] + (b[1] - a[1]) * t;
        out[2] = a[2] + (b[2] - a[2]) * t;
        return out;
    }

    // ------------------------------------------------------------ tissue model
    //
    // All of these take image-space coordinates in [0, IMAGE_SIZE].

    // How much tissue is on the glass at all. Slides have empty corners; showing
    // that makes the thresholding and edge cards honest.
    function tissueMask(x, y) {
        const nx = x / IMAGE_SIZE;
        const ny = y / IMAGE_SIZE;
        const dx = nx - 0.5;
        const dy = ny - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy);
        const wobble = 0.10 * (fbm(nx * 3.1, ny * 3.1, 7717, 3) - 0.5);
        return smoothstep(0.50, 0.42, r + wobble);
    }

    // The lesion. Two lobes plus a low-frequency warp; smooth on purpose so the
    // heatmap / colormap / contour cards have something clean to work with.
    function lesionField(x, y) {
        const nx = x / IMAGE_SIZE;
        const ny = y / IMAGE_SIZE;

        const warp = fbm(nx * 2.6, ny * 2.6, 4211, 4) - 0.5;
        const wx = nx + 0.10 * warp;
        const wy = ny + 0.10 * (fbm(nx * 2.6 + 5.5, ny * 2.6 - 3.1, 4211, 4) - 0.5);

        const d1 = Math.hypot(wx - 0.36, wy - 0.41) / 0.21;
        const d2 = Math.hypot(wx - 0.64, wy - 0.66) / 0.14;
        const d3 = Math.hypot(wx - 0.72, wy - 0.28) / 0.075;

        const lobes = Math.exp(-d1 * d1) + 0.85 * Math.exp(-d2 * d2) + 0.6 * Math.exp(-d3 * d3);
        const texture = 0.80 + 0.40 * fbm(nx * 9, ny * 9, 9091, 3);

        return clamp01(lobes * texture) * tissueMask(x, y);
    }

    // Nuclei are denser inside the lesion; stroma keeps a sparse background
    // population. This is the field the density / grid-heatmap card visualises.
    function nucleiDensity(x, y) {
        const lesion = lesionField(x, y);
        const scatter = fbm(x / 720, y / 720, 3313, 3);
        return clamp01((0.16 + 0.78 * lesion) * (0.70 + 0.60 * scatter)) * tissueMask(x, y);
    }

    // Low-frequency region fields, coarse-sampled.
    function fatRegionField(x, y, seed) {
        return fbm(x / 2100, y / 2100, seed + 6151, 3);
    }

    // Vessels: ridge lines of a low-frequency field. The threshold looks extreme
    // because it has to be -- fbm clusters around 0.5, which is exactly where the
    // ridge transform peaks, so `ridged` sits above 0.88 for a third of the slide.
    // 0.975 puts vessel coverage at a few percent, which is what tissue looks like.
    function vesselField(x, y, seed) {
        const ridged = 1 - Math.abs(2 * fbm(x / 900, y / 900, seed + 5099, 3) - 1);
        return smoothstep(0.975, 0.996, ridged);
    }

    // Collagen. Noise stretched along a slowly rotating local direction, which
    // is what makes it read as fibres instead of as clouds. Per-pixel: this is
    // the detail the sobel and adaptive-threshold cards are looking at.
    function stromaFibres(x, y, seed) {
        const angle = 6.28318 * fbm(x / 1450, y / 1450, seed + 4441, 2);
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const u = x * ca + y * sa;
        const v = -x * sa + y * ca;
        return fbm(u / 260, v / 30, seed + 8081, 3);
    }

    const NUCLEUS_CELL = 22;

    // Mean discrete nuclear weight the lattice produces per unit density. Used to
    // match the averaged low-zoom regime to the resolved high-zoom one, so the
    // slide does not change overall darkness as you zoom. Measured by integrating
    // nucleiWeight over full-resolution windows; re-measure it if the nucleus
    // geometry below changes.
    const NUCLEUS_MEAN_WEIGHT = 0.202;

    // ------------------------------------------------------------ tile context
    //
    // Per-tile caches. Coarse grids for the smooth fields, a memo table for the
    // per-nucleus density lookups, and the level-of-detail weight.

    function makeCoarseGrid(geom, fn) {
        const n = Math.ceil(geom.size / COARSE_STRIDE) + 2;
        const grid = new Float64Array(n * n);

        for (let j = 0; j < n; j++) {
            const iy = geom.originY + j * COARSE_STRIDE * geom.stepY;
            for (let i = 0; i < n; i++) {
                grid[j * n + i] = fn(geom.originX + i * COARSE_STRIDE * geom.stepX, iy);
            }
        }

        return function sample(px, py) {
            const gx = px / COARSE_STRIDE;
            const gy = py / COARSE_STRIDE;
            let i0 = Math.floor(gx);
            let j0 = Math.floor(gy);
            if (i0 < 0) {
                i0 = 0;
            }
            if (j0 < 0) {
                j0 = 0;
            }
            if (i0 > n - 2) {
                i0 = n - 2;
            }
            if (j0 > n - 2) {
                j0 = n - 2;
            }
            const tx = gx - i0;
            const ty = gy - j0;
            const row0 = j0 * n + i0;
            const row1 = row0 + n;
            const top = grid[row0] + (grid[row0 + 1] - grid[row0]) * tx;
            const bottom = grid[row1] + (grid[row1 + 1] - grid[row1]) * tx;
            return top + (bottom - top) * ty;
        };
    }

    function makeTileContext(geom, seed) {
        const ctx = {
            seed: seed,
            geom: geom,
            lesion: makeCoarseGrid(geom, lesionField),
            mask: makeCoarseGrid(geom, tissueMask),
            density: makeCoarseGrid(geom, nucleiDensity),
            fatRegion: makeCoarseGrid(geom, (x, y) => fatRegionField(x, y, seed)),
            vessel: makeCoarseGrid(geom, (x, y) => vesselField(x, y, seed)),
            // Individual nuclei cannot survive an output pixel much wider than a
            // nucleus radius. Above that they fade into the smooth density term,
            // which is what averaging optical density over a larger footprint
            // physically does anyway -- and it keeps the low-zoom levels from
            // turning into aliasing noise.
            detail: clamp01((NUCLEUS_CELL * 0.35 - geom.step) / (NUCLEUS_CELL * 0.25)),
            cellDensity: new Map()
        };

        // Density at a nucleus lattice cell centre. Memoized because the 3x3
        // neighbourhood scan asks for the same cells over and over.
        ctx.densityAtCell = function(cx, cy) {
            // Cell indexes are small but can be negative at a tile's left/top
            // edge, so bias before packing to keep the key injective.
            const key = (cx + 32768) * 65536 + (cy + 32768);
            let value = ctx.cellDensity.get(key);
            if (value === undefined) {
                value = nucleiDensity((cx + 0.5) * NUCLEUS_CELL, (cy + 0.5) * NUCLEUS_CELL);
                ctx.cellDensity.set(key, value);
            }
            return value;
        };

        return ctx;
    }

    // Discrete nuclei: a jittered lattice, 3x3 neighbourhood per pixel. Returns
    // an unnormalized "nuclear weight" in roughly [0, 1.6].
    function nucleiWeight(x, y, ctx) {
        const seed = ctx.seed;
        const cx0 = Math.floor(x / NUCLEUS_CELL);
        const cy0 = Math.floor(y / NUCLEUS_CELL);
        let acc = 0;

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const cx = cx0 + dx;
                const cy = cy0 + dy;

                if (hash2(cx, cy, seed) > ctx.densityAtCell(cx, cy)) {
                    continue;
                }

                const r1 = hash2(cx, cy, seed + 31);
                const r2 = hash2(cx, cy, seed + 67);
                const r3 = hash2(cx, cy, seed + 113);
                const r4 = hash2(cx, cy, seed + 191);

                const px = (cx + 0.18 + 0.64 * r1) * NUCLEUS_CELL;
                const py = (cy + 0.18 + 0.64 * r2) * NUCLEUS_CELL;
                const radius = NUCLEUS_CELL * (0.26 + 0.16 * r3);
                // Slight elongation; perfectly round nuclei read as synthetic.
                const stretch = 0.78 + 0.44 * r4;

                const ex = (x - px) / (radius * stretch);
                const ey = (y - py) / (radius / stretch);
                const d2 = ex * ex + ey * ey;
                if (d2 >= 1) {
                    continue;
                }

                acc += Math.pow(1 - d2, 0.85) * (0.78 + 0.40 * r3);
            }
        }

        if (acc > 0) {
            // Chromatin mottle inside the nucleus.
            acc *= 0.80 + 0.40 * valueNoise(x / 4.5, y / 4.5, seed + 977);
        }

        return acc > 1.6 ? 1.6 : acc;
    }

    /** Nuclear weight blended between the resolvable and the averaged regime. */
    function nuclearAmount(ix, iy, px, py, ctx) {
        const smoothPart = ctx.density(px, py) * NUCLEUS_MEAN_WEIGHT;
        if (ctx.detail <= 0.002) {
            return smoothPart;
        }
        return mix(smoothPart, nucleiWeight(ix, iy, ctx), ctx.detail);
    }

    /** Hematoxylin / eosin / residual concentrations at one image point. */
    function heConcentrations(ix, iy, px, py, ctx, out) {
        const tissue = ctx.mask(px, py);
        if (tissue <= 0.001) {
            out[0] = TISSUE.glass[0];
            out[1] = TISSUE.glass[1];
            out[2] = TISSUE.glass[2];
            return out;
        }

        const lesion = ctx.lesion(px, py);
        const fibres = stromaFibres(ix, iy, ctx.seed);

        // Background: collagen-rich stroma outside the lesion, paler cytoplasm
        // inside it. The floor matters -- weighted too far toward cytoplasm the
        // whole slide washes out to near-white at low zoom.
        const stromaAmount = 0.55 + 0.45 * fibres;
        lerp3(TISSUE.cytoplasm, TISSUE.stroma, clamp01(stromaAmount * (1 - 0.45 * lesion)), out);

        const nuclear = nuclearAmount(ix, iy, px, py, ctx);
        if (nuclear > 0) {
            const target = lesion > 0.55 ? TISSUE.chromatin : TISSUE.nucleus;
            lerp3(out, target, clamp01(nuclear), out);
        }

        const region = ctx.fatRegion(px, py);
        if (region > 0.54) {
            const cells = fbm(ix / 260, iy / 260, ctx.seed + 2287, 2);
            const fat = smoothstep(0.54, 0.62, region) * smoothstep(0.46, 0.60, cells);
            if (fat > 0) {
                lerp3(out, TISSUE.fat, fat * 0.92, out);
            }
        }

        const vessel = ctx.vessel(px, py) * tissue;
        if (vessel > 0.01) {
            lerp3(out, TISSUE.rbc, vessel * 0.85, out);
        }

        // Fade the whole thing toward glass at the tissue border.
        if (tissue < 1) {
            lerp3(TISSUE.glass, out, tissue, out);
        }

        return out;
    }

    /** Hematoxylin / DAB / residual concentrations for the IHC variant. */
    function hdabConcentrations(ix, iy, px, py, ctx, out) {
        const tissue = ctx.mask(px, py);
        if (tissue <= 0.001) {
            out[0] = IHC.glass[0];
            out[1] = IHC.glass[1];
            out[2] = IHC.glass[2];
            return out;
        }

        const lesion = ctx.lesion(px, py);

        out[0] = IHC.counterstain[0];
        out[1] = IHC.counterstain[1];
        out[2] = IHC.counterstain[2];

        const nuclear = nuclearAmount(ix, iy, px, py, ctx);
        if (nuclear > 0) {
            lerp3(out, IHC.nucleus, clamp01(nuclear), out);
        }

        // Membranous DAB positivity, strongest at the lesion core, patchy at the
        // rim -- the heterogeneity an H-DAB demo needs to be worth looking at.
        const patch = fbm(ix / 540, iy / 540, ctx.seed + 7331, 3);
        const positivity = clamp01((lesion - 0.28) / 0.55) * smoothstep(0.35, 0.72, patch);
        if (positivity > 0) {
            lerp3(out, IHC.dabWeak, positivity * 0.85, out);
            lerp3(out, IHC.dabStrong, positivity * positivity * 0.7, out);
        }

        if (tissue < 1) {
            lerp3(IHC.glass, out, tissue, out);
        }

        return out;
    }

    // ------------------------------------------------------------ scalar fields
    //
    // Signature: (ix, iy, px, py, ctx) -> [0,1]

    const SCALAR_SCRATCH = [0, 0, 0];

    const SCALAR_FIELDS = {
        "tumour-prob": function(ix, iy, px, py, ctx) {
            return ctx.lesion(px, py);
        },

        // Four discrete grades. Values sit in the middle of the bands produced by
        // breaks [0.25, 0.5, 0.75], so a 4-step colormap lands one class per step.
        "grade-classes": function(ix, iy, px, py, ctx) {
            const v = ctx.lesion(px, py);
            if (v < 0.22) {
                return 0.12;
            }
            if (v < 0.45) {
                return 0.38;
            }
            if (v < 0.68) {
                return 0.62;
            }
            return 0.88;
        },

        "nuclei-density": function(ix, iy, px, py, ctx) {
            return ctx.density(px, py);
        },

        // Diverging around 0.5: up-regulated in the lesion core, down-regulated in
        // the reactive rim, and genuinely unchanged in between.
        //
        // The dead band matters. bipolar-heatmap derives alpha from the distance
        // from 0.5, so a field that is saturated nearly everywhere renders as an
        // opaque sheet and hides the slide underneath it. Most of the tissue has to
        // actually sit at 0.5 for the layer to show what it is for.
        "expression-delta": function(ix, iy, px, py, ctx) {
            const lesion = ctx.lesion(px, py);
            const tissue = ctx.mask(px, py);
            const noise = fbm(ix / 1100, iy / 1100, 1531, 4) - 0.5;
            const rim = smoothstep(0.10, 0.34, lesion) * (1 - smoothstep(0.42, 0.72, lesion));

            let signed = 1.7 * (lesion - 0.46) - 1.0 * rim + 0.55 * noise;
            const DEAD = 0.22;
            const magnitude = Math.abs(signed) - DEAD;
            signed = magnitude <= 0 ? 0 : Math.sign(signed) * magnitude / (1 - DEAD);

            return mix(0.5, 0.5 + 0.47 * Math.tanh(2.0 * signed), tissue);
        },

        // Solid region mask -- what the `edge` layer wants: a clean iso-contour
        // rather than a noisy gradient.
        mask: function(ix, iy, px, py, ctx) {
            return smoothstep(0.48, 0.52, ctx.lesion(px, py));
        },

        // Ground truth for the deconvolution check. Scaled by 0.5 so it matches a
        // stain-separation layer running at intensity 0.5, and so the top of the
        // range is not clipped by the 8-bit container.
        "truth-hematoxylin": function(ix, iy, px, py, ctx) {
            heConcentrations(ix, iy, px, py, ctx, SCALAR_SCRATCH);
            return clamp01(SCALAR_SCRATCH[0] * 0.5);
        },

        // Three overlapping soft class memberships for the stacked-pattern card.
        "class-stroma": function(ix, iy, px, py, ctx) {
            return clamp01(1.15 * (1 - ctx.lesion(px, py)) * ctx.mask(px, py) - 0.15);
        },
        "class-invasive": function(ix, iy, px, py, ctx) {
            const v = ctx.lesion(px, py);
            return smoothstep(0.20, 0.44, v) * (1 - smoothstep(0.58, 0.80, v));
        },
        "class-core": function(ix, iy, px, py, ctx) {
            return smoothstep(0.62, 0.84, ctx.lesion(px, py));
        }
    };

    // Immunofluorescence markers, 8 of them across two RGBA8 packs.
    const IF_MARKERS = [
        // pack 0
        function dapi(ix, iy, px, py, ctx) {
            return clamp01(nuclearAmount(ix, iy, px, py, ctx) * 1.5);
        },
        function cd3(ix, iy, px, py, ctx) {
            // T cells crowd the invasive margin.
            const v = ctx.lesion(px, py);
            const margin = smoothstep(0.24, 0.42, v) * (1 - smoothstep(0.50, 0.72, v));
            return clamp01(margin * (0.35 + 1.1 * fbm(ix / 95, iy / 95, 2113, 2)) - 0.12);
        },
        function cd8(ix, iy, px, py, ctx) {
            const v = ctx.lesion(px, py);
            const margin = smoothstep(0.26, 0.46, v) * (1 - smoothstep(0.52, 0.74, v));
            return clamp01(margin * (0.2 + 1.3 * fbm(ix / 78, iy / 78, 6607, 2)) - 0.30);
        },
        function cd20(ix, iy, px, py, ctx) {
            // B-cell aggregates: a few tight follicles.
            const cluster = fbm(ix / 620, iy / 620, 4457, 3);
            return clamp01(smoothstep(0.70, 0.86, cluster) * 1.4 * ctx.mask(px, py));
        },
        // pack 1
        function panck(ix, iy, px, py, ctx) {
            return clamp01(smoothstep(0.30, 0.58, ctx.lesion(px, py)) * 1.15);
        },
        function ki67(ix, iy, px, py, ctx) {
            const nuclear = nuclearAmount(ix, iy, px, py, ctx);
            // Proliferating subset only: a fraction of nuclei, biased to the core.
            const fraction = smoothstep(0.35, 0.80, ctx.lesion(px, py));
            const pick = valueNoise(ix / NUCLEUS_CELL, iy / NUCLEUS_CELL, 8887);
            return clamp01(nuclear * 1.5 * (pick < 0.25 + 0.5 * fraction ? 1 : 0.06));
        },
        function cd68(ix, iy, px, py, ctx) {
            const scatter = fbm(ix / 130, iy / 130, 9931, 2);
            return clamp01(smoothstep(0.76, 0.92, scatter) * 1.3 * ctx.mask(px, py));
        },
        function asma(ix, iy, px, py, ctx) {
            // Smooth-muscle actin follows the collagen fibres and the vessels.
            return clamp01((0.55 * stromaFibres(ix, iy, ctx.seed) + 1.2 * ctx.vessel(px, py)) *
                ctx.mask(px, py) - 0.22);
        }
    ];

    const IF_MARKER_NAMES = ["DAPI", "CD3", "CD8", "CD20", "PanCK", "Ki-67", "CD68", "aSMA"];

    // ----------------------------------------------------- half-float encoding

    // IEEE-754 binary16 encoder, same implementation as test/modules/precision.js.
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);

    function toHalf(value) {
        floatView[0] = value;
        const x = int32View[0];

        let bits = (x >> 16) & 0x8000;
        let mantissa = (x >> 12) & 0x07ff;
        const exponent = (x >> 23) & 0xff;

        if (exponent < 103) {
            return bits;
        }
        if (exponent > 142) {
            bits |= 0x7c00;
            bits |= ((exponent === 255) ? 0 : 1) && (x & 0x007fffff);
            return bits;
        }
        if (exponent < 113) {
            mantissa |= 0x0800;
            bits |= (mantissa >> (114 - exponent)) + ((mantissa >> (113 - exponent)) & 1);
            return bits;
        }

        bits |= ((exponent - 112) << 10) | (mantissa >> 1);
        bits += mantissa & 1;
        return bits;
    }

    // --------------------------------------------------------- source plumbing

    // Shared by every source below: a tile's pixel grid in image coordinates.
    //
    // Note that OpenSeadragon's TileSource constructor moves `tileSize` into the
    // private `_tileWidth`/`_tileHeight` pair and deletes it, so the tile edge has
    // to be read back through the accessor rather than off the options.
    // The fields are defined on a normalized unit square scaled to IMAGE_SIZE, so a
    // source of any dimensions maps onto the same model. That is what lets an
    // overlay register with a real slide of some unrelated size instead of only
    // with the 8192-square procedural one.
    function tileGeometry(source, level, x, y) {
        const scale = 1 / (1 << (source.maxLevel - level));
        const step = 1 / scale;
        const size = Number(source.getTileWidth(level)) || TILE_SIZE;
        const modelX = IMAGE_SIZE / (Number(source.width) || IMAGE_SIZE);
        const modelY = IMAGE_SIZE / (Number(source.height) || IMAGE_SIZE);
        return {
            // Model units per output pixel, used for the level-of-detail decision.
            step: step * Math.max(modelX, modelY),
            size: size,
            modelX: modelX,
            modelY: modelY,
            originX: x * size * step * modelX,
            originY: y * size * step * modelY,
            stepX: step * modelX,
            stepY: step * modelY
        };
    }

    // `configure` is invoked with `this` bound to the viewer, not to the tile
    // source (see OpenSeadragon's TileSource.determineType call site), so it must
    // be pure and return everything the instance needs through its options.
    function baseConfigure(options, extra) {
        const tileSize = Number(options.tileSize) || TILE_SIZE;
        return $.extend({}, options, extra, {
            width: Number(options.width) || IMAGE_SIZE,
            height: Number(options.height) || IMAGE_SIZE,
            tileSize: tileSize,
            tileOverlap: 0,
            minLevel: Number.isFinite(Number(options.minLevel)) ? Number(options.minLevel) : MIN_LEVEL,
            maxLevel: Number.isFinite(Number(options.maxLevel)) ? Number(options.maxLevel) : MAX_LEVEL
        });
    }

    function parseCoords(context, source, prefix, fieldCount) {
        const src = String(context.src || context.url || context.tileUrl || context.source || "");
        const parts = src.split(":");

        if (parts[0] === prefix && parts.length >= fieldCount + 4) {
            const base = 1 + fieldCount;
            return {
                level: Number(parts[base]),
                x: Number(parts[base + 1]),
                y: Number(parts[base + 2])
            };
        }

        const tile = context.tile || {};
        return {
            level: Number.isFinite(Number(tile.level)) ? Number(tile.level) : source.maxLevel,
            x: Number(tile.x) || 0,
            y: Number(tile.y) || 0
        };
    }

    function newTileCanvas(size) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        return canvas;
    }

    // ------------------------------------------------- brightfield H&E / H-DAB

    /**
     * Procedural brightfield slide.
     *
     * Options: `stains` ("he" | "hdab"), `seed` (integer; vary it for serial
     * sections), plus the usual width/height/tileSize/minLevel/maxLevel.
     */
    $.SyntheticHETileSource = class SyntheticHETileSource extends $.TileSource {

        supports(data, url) {
            const probe = (data && typeof data === "object") ? data : url;
            return !!(probe && typeof probe === "object" && probe.type === "synthetic-he");
        }

        configure(options) {
            return baseConfigure(options, {
                stains: options.stains === "hdab" ? "hdab" : "he",
                seed: Number.isFinite(Number(options.seed)) ? Number(options.seed) : 0
            });
        }

        getTileUrl(level, x, y) {
            return ["synthetic-he", this.stains, this.seed, level, x, y].join(":");
        }

        getMetadata() {
            return {
                type: "synthetic-he",
                stains: this.stains,
                seed: this.seed,
                width: this.width,
                height: this.height
            };
        }

        downloadTileStart(context) {
            const coords = parseCoords(context, this, "synthetic-he", 2);
            context.finish(this._paint(coords.level, coords.x, coords.y), undefined, "image");
        }

        _paint(level, x, y) {
            const geom = tileGeometry(this, level, x, y);
            const canvas = newTileCanvas(geom.size);
            const ctx2d = canvas.getContext("2d");
            const image = ctx2d.createImageData(geom.size, geom.size);
            const data = image.data;

            const basis = this.stains === "hdab" ? BASIS.hdab : BASIS.he;
            const model = this.stains === "hdab" ? hdabConcentrations : heConcentrations;
            const ctx = makeTileContext(geom, this.seed * 1013 + 17);
            const scratch = [0, 0, 0];

            for (let py = 0; py < geom.size; py++) {
                const iy = geom.originY + py * geom.stepY;
                for (let px = 0; px < geom.size; px++) {
                    const ix = geom.originX + px * geom.stepX;
                    model(ix, iy, px, py, ctx, scratch);
                    const offset = (py * geom.size + px) * 4;
                    recompose(scratch, basis, data, offset);
                    data[offset + 3] = 255;
                }
            }

            ctx2d.putImageData(image, 0, 0);
            return canvas;
        }
    };

    // -------------------------------------------------------- scalar overlays

    /**
     * One scalar field, replicated into R/G/B with opaque alpha.
     *
     * Options: `field` (a key of SCALAR_FIELDS).
     */
    $.SyntheticScalarTileSource = class SyntheticScalarTileSource extends $.TileSource {

        supports(data, url) {
            const probe = (data && typeof data === "object") ? data : url;
            return !!(probe && typeof probe === "object" && probe.type === "synthetic-scalar");
        }

        configure(options) {
            const field = SCALAR_FIELDS[options.field] ? options.field : "tumour-prob";
            return baseConfigure(options, { field: field });
        }

        getTileUrl(level, x, y) {
            return ["synthetic-scalar", this.field, level, x, y].join(":");
        }

        getMetadata() {
            return { type: "synthetic-scalar", field: this.field };
        }

        downloadTileStart(context) {
            const coords = parseCoords(context, this, "synthetic-scalar", 1);
            context.finish(this._paint(coords.level, coords.x, coords.y), undefined, "image");
        }

        _paint(level, x, y) {
            const geom = tileGeometry(this, level, x, y);
            const canvas = newTileCanvas(geom.size);
            const ctx2d = canvas.getContext("2d");
            const image = ctx2d.createImageData(geom.size, geom.size);
            const data = image.data;
            const field = SCALAR_FIELDS[this.field] || SCALAR_FIELDS["tumour-prob"];
            const ctx = makeTileContext(geom, 17);

            for (let py = 0; py < geom.size; py++) {
                const iy = geom.originY + py * geom.stepY;
                for (let px = 0; px < geom.size; px++) {
                    const ix = geom.originX + px * geom.stepX;
                    const v = Math.round(255 * clamp01(field(ix, iy, px, py, ctx)));
                    const offset = (py * geom.size + px) * 4;
                    data[offset] = v;
                    data[offset + 1] = v;
                    data[offset + 2] = v;
                    data[offset + 3] = 255;
                }
            }

            ctx2d.putImageData(image, 0, 0);
            return canvas;
        }
    };

    // ---------------------------------------------- 8-channel immunofluorescence

    /**
     * Eight fluorescence markers as two RGBA8 packs.
     *
     * Packing them as a `gpuTextureSet` rather than as canvases buys two things:
     * eight logical channels instead of four, and an alpha channel that carries
     * data instead of being eaten by premultiplication.
     */
    $.SyntheticIFTileSource = class SyntheticIFTileSource extends $.TileSource {

        supports(data, url) {
            const probe = (data && typeof data === "object") ? data : url;
            return !!(probe && typeof probe === "object" && probe.type === "synthetic-if");
        }

        configure(options) {
            return baseConfigure(options, {
                seed: Number.isFinite(Number(options.seed)) ? Number(options.seed) : 0
            });
        }

        getTileUrl(level, x, y) {
            return ["synthetic-if", this.seed, level, x, y].join(":");
        }

        getMetadata() {
            return { type: "synthetic-if", markers: IF_MARKER_NAMES.slice() };
        }

        getTileDataPrecision() {
            return "unorm8";
        }

        downloadTileStart(context) {
            const coords = parseCoords(context, this, "synthetic-if", 1);
            context.finish(this._pack(coords.level, coords.x, coords.y), undefined, "gpuTextureSet");
        }

        _pack(level, x, y) {
            const geom = tileGeometry(this, level, x, y);
            const pixels = geom.size * geom.size;
            const packs = [new Uint8Array(pixels * 4), new Uint8Array(pixels * 4)];
            const ctx = makeTileContext(geom, this.seed * 1013 + 17);

            for (let py = 0; py < geom.size; py++) {
                const iy = geom.originY + py * geom.stepY;
                for (let px = 0; px < geom.size; px++) {
                    const ix = geom.originX + px * geom.stepX;
                    const offset = (py * geom.size + px) * 4;

                    for (let m = 0; m < 8; m++) {
                        const v = IF_MARKERS[m](ix, iy, px, py, ctx);
                        packs[m >> 2][offset + (m & 3)] = Math.round(255 * clamp01(v));
                    }
                }
            }

            return {
                getType: () => "gpuTextureSet",
                width: geom.size,
                height: geom.size,
                channelCount: 8,
                packs: [
                    { format: "RGBA8", data: packs[0] },
                    { format: "RGBA8", data: packs[1] }
                ]
            };
        }
    };

    // --------------------------------------------------- high dynamic range f16

    /**
     * RGBA16F tile source whose values deliberately leave [0,1].
     *
     * r: Ki-67 labelling index as a score, roughly -0.4 .. 3.1
     * g: expression log ratio, signed
     * b: the same Ki-67 field squashed into [0,1] for side-by-side comparison
     * a: 1.0
     *
     * Under the default `unorm8` colour target r and g are clamped away; under
     * `float16` they survive. That contrast is the whole point of the card.
     */
    $.SyntheticF16TileSource = class SyntheticF16TileSource extends $.TileSource {

        supports(data, url) {
            const probe = (data && typeof data === "object") ? data : url;
            return !!(probe && typeof probe === "object" && probe.type === "synthetic-f16");
        }

        configure(options) {
            return baseConfigure(options, {});
        }

        getTileUrl(level, x, y) {
            return ["synthetic-f16", level, x, y].join(":");
        }

        getMetadata() {
            return {
                type: "synthetic-f16",
                channels: ["ki67-score", "log-ratio", "ki67-normalized", "one"]
            };
        }

        getTileDataPrecision() {
            return "float16";
        }

        downloadTileStart(context) {
            const coords = parseCoords(context, this, "synthetic-f16", 0);
            context.finish(this._pack(coords.level, coords.x, coords.y), undefined, "gpuTextureSet");
        }

        _pack(level, x, y) {
            const geom = tileGeometry(this, level, x, y);
            const data = new Uint16Array(geom.size * geom.size * 4);
            const ctx = makeTileContext(geom, 17);
            const one = toHalf(1);

            for (let py = 0; py < geom.size; py++) {
                const iy = geom.originY + py * geom.stepY;
                for (let px = 0; px < geom.size; px++) {
                    const ix = geom.originX + px * geom.stepX;
                    const lesion = ctx.lesion(px, py);
                    const noise = fbm(ix / 640, iy / 640, 2749, 3);

                    // Deliberately out of range at both ends.
                    const score = -0.4 + 3.5 * lesion * (0.55 + 0.75 * noise);
                    const ratio = 2.4 * (lesion - 0.42) + 0.9 * (noise - 0.5);

                    const offset = (py * geom.size + px) * 4;
                    data[offset] = toHalf(score);
                    data[offset + 1] = toHalf(ratio);
                    data[offset + 2] = toHalf(clamp01(score / 3.1));
                    data[offset + 3] = one;
                }
            }

            return {
                getType: () => "gpuTextureSet",
                width: geom.size,
                height: geom.size,
                channelCount: 4,
                packs: [{ format: "RGBA16F", data: data }]
            };
        }
    };

    // ------------------------------------------------------------ public helpers

    const REAL_SLIDE_URL = "../data/synthetic/out/he_slide.dzi";

    /**
     * Resolve the brightfield slide to use.
     *
     * Prefers the real slide produced by `test/data/synthetic/generate.py --slide`
     * and falls back to the procedural one, so the gallery is fully functional
     * with nothing generated at all.
     *
     * @returns {Promise<{tileSource: (string|object), real: boolean, label: string}>}
     */
    async function resolveSlideSource() {
        const procedural = {
            tileSource: { type: "synthetic-he" },
            real: false,
            label: "procedural H&E (generated in-browser)",
            geometry: null
        };

        try {
            const response = await fetch(REAL_SLIDE_URL);
            if (!response.ok) {
                return procedural;
            }

            // A real slide is whatever size it is, and almost certainly not square.
            // Overlays have to be told its dimensions or they cover a different
            // region of the viewport and stop registering with it.
            const text = await response.text();
            const doc = new DOMParser().parseFromString(text, "application/xml");
            const size = doc.querySelector("Size");
            const width = Number(size && size.getAttribute("Width"));
            const height = Number(size && size.getAttribute("Height"));

            if (!width || !height) {
                $.console.warn(
                    "SyntheticPathology: found he_slide.dzi but could not read its Size; " +
                    "falling back to the procedural slide."
                );
                return procedural;
            }

            const maxLevel = Math.max(1, Math.ceil(Math.log2(Math.max(width, height))));

            return {
                tileSource: REAL_SLIDE_URL,
                real: true,
                label: `real H&E slide (${width}×${height})`,
                geometry: {
                    width: width,
                    height: height,
                    maxLevel: maxLevel,
                    minLevel: Math.max(0, maxLevel - 5)
                }
            };
        } catch (e) {
            // Offline, or the file was never generated. Either way: procedural.
        }

        return procedural;
    }

    $.SyntheticPathology = {
        IMAGE_SIZE: IMAGE_SIZE,
        TILE_SIZE: TILE_SIZE,
        MIN_LEVEL: MIN_LEVEL,
        MAX_LEVEL: MAX_LEVEL,
        REAL_SLIDE_URL: REAL_SLIDE_URL,
        scalarFields: Object.keys(SCALAR_FIELDS),
        markers: IF_MARKER_NAMES.slice(),
        resolveSlideSource: resolveSlideSource,

        // Exposed so a demo, or a test, can check the generator against the
        // shader instead of taking the pretty picture on faith.
        basis: BASIS,
        deconvolve: deconvolve,
        lesionField: lesionField,
        nucleiDensity: nucleiDensity,
        makeTileContext: makeTileContext,
        heConcentrations: heConcentrations,
        nucleiWeight: nucleiWeight,
        NUCLEUS_MEAN_WEIGHT: NUCLEUS_MEAN_WEIGHT,
        toHalf: toHalf
    };

})(OpenSeadragon);
