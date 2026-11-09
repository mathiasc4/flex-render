/* global OpenSeadragon */

/**
 * MVT over a non-square world, loaded from TileJSON.
 *
 * Both layers show the same image-space grid, so any disagreement between them
 * is a placement bug, not a data bug:
 *
 *   raster  a TileSource that paints the grid on canvases (edge tiles clipped,
 *           exactly like a real DZI pyramid);
 *   vector  a TileJSON object handed straight to addTiledImage, so OSD runs
 *           MVTTileSource.supports/configure. Its tiles are encoded as MVT in
 *           the browser and served through the drawer's httpAdapter, so no tile
 *           server is needed.
 *
 * The tile "server" behaves like a slide pyramid producer: tiles are authored
 * against the NOMINAL tile of the real 105185 x 221772 grid, and TMS rows count
 * from the bottom of that real grid.
 *
 * Stress mode adds N random features per tile (polygons / polylines, configurable
 * vertex count and line width), optional layer copies, and a continuous pan/zoom
 * tour, with frame, encode and tile-latency metrics in the panel. Tiles are
 * encoded on a worker pool, so the main thread measures the renderer, not the
 * fake server.
 */
(function() {

    /**
     * Everything the tile producer needs. Self-contained on purpose: its source
     * is stringified into the encoder workers, so it may not reference anything
     * outside its own body.
     */
    function makeProducer() {
        const W = 105185;
        const H = 221772;
        const TILE = 512;
        const MAX_LEVEL = 9;
        const EXTENT = 4096;
        // Geometry may overrun its tile by this many extent units, like real producers.
        const BUFFER = 64;

        const COLS = 8;
        const CELL = W / COLS;
        // 16.87 cells tall: the last row is partial, so the bottom edge is exercised too.
        const ROWS = Math.ceil(H / CELL);

        // ------------------------------------------------------------- world

        /** Image pixels covered by one nominal tile at level z. */
        function nominalSpan(z) {
            return TILE * Math.pow(2, MAX_LEVEL - z);
        }

        function realColumns(z) {
            return Math.ceil(W / nominalSpan(z));
        }

        function realRows(z) {
            return Math.ceil(H / nominalSpan(z));
        }

        function cellRange(from, to, count) {
            return [
                Math.max(0, Math.floor(from / CELL)),
                Math.min(count - 1, Math.floor(to / CELL))
            ];
        }

        // -------------------------------------------------------- MVT encode

        /** Growable protobuf writer; plain arrays were ~5x slower at stress sizes. */
        class Writer {
            constructor(size) {
                this.buf = new Uint8Array(size || 64);
                this.pos = 0;
            }

            reserve(n) {
                if (this.pos + n <= this.buf.length) {
                    return;
                }
                let size = this.buf.length * 2;
                while (size < this.pos + n) {
                    size *= 2;
                }
                const next = new Uint8Array(size);
                next.set(this.buf.subarray(0, this.pos));
                this.buf = next;
            }

            varint(value) {
                this.reserve(10);
                while (value > 127) {
                    this.buf[this.pos++] = (value & 127) | 128;
                    value = Math.floor(value / 128);
                }
                this.buf[this.pos++] = value;
            }

            bytes(field, data) {
                this.varint((field << 3) | 2);
                this.varint(data.length);
                this.reserve(data.length);
                this.buf.set(data, this.pos);
                this.pos += data.length;
            }

            view() {
                return this.buf.subarray(0, this.pos);
            }

            finish() {
                return this.buf.slice(0, this.pos);
            }
        }

        function zigzag(n) {
            return n >= 0 ? n * 2 : -n * 2 - 1;
        }

        /** One feature, type 2 (line) or 3 (polygon ring, open: ClosePath is implied). */
        function encodeFeature(type, points) {
            const geom = new Writer(8 + points.length * 4);
            let cx = 0;
            let cy = 0;
            const push = (p) => {
                geom.varint(zigzag(p[0] - cx));
                geom.varint(zigzag(p[1] - cy));
                cx = p[0];
                cy = p[1];
            };

            geom.varint(1 | (1 << 3));
            push(points[0]);
            geom.varint(2 | ((points.length - 1) << 3));
            for (let k = 1; k < points.length; k++) {
                push(points[k]);
            }
            if (type === 3) {
                geom.varint(7 | (1 << 3));
            }

            const feature = new Writer(geom.pos + 8);
            feature.varint((3 << 3) | 0);
            feature.varint(type);
            feature.bytes(4, geom.view());
            return feature.finish();
        }

        const textEncoder = new TextEncoder();

        function encodeTile(layers) {
            const tile = new Writer(4096);
            for (const name of Object.keys(layers)) {
                const features = layers[name];
                if (!features.length) {
                    continue;
                }
                const layer = new Writer(1024);
                layer.varint((15 << 3) | 0);
                layer.varint(2);
                layer.bytes(1, textEncoder.encode(name));
                for (const f of features) {
                    layer.bytes(2, f);
                }
                layer.varint((5 << 3) | 0);
                layer.varint(EXTENT);
                tile.bytes(3, layer.view());
            }
            return tile.finish();
        }

        // ---------------------------------------------------------- geometry

        /** Liang-Barsky clip of segment a-b to rect r; null when outside. */
        function clipSegment(a, b, r) {
            let t0 = 0;
            let t1 = 1;
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const checks = [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]];
            for (const [p, q] of checks) {
                if (p === 0) {
                    if (q < 0) {
                        return null;
                    }
                    continue;
                }
                const t = q / p;
                if (p < 0) {
                    t0 = Math.max(t0, t);
                } else {
                    t1 = Math.min(t1, t);
                }
                if (t0 > t1) {
                    return null;
                }
            }
            return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
        }

        /** Drops consecutive points that rounding to the extent grid made identical. */
        function dedupe(points) {
            const out = [points[0]];
            for (let k = 1; k < points.length; k++) {
                const prev = out[out.length - 1];
                if (points[k][0] !== prev[0] || points[k][1] !== prev[1]) {
                    out.push(points[k]);
                }
            }
            return out;
        }

        // ------------------------------------------------------------ stress

        /** Deterministic per-tile PRNG, so a tile looks the same every time it is requested. */
        function mulberry32(seed) {
            let a = seed >>> 0;
            return function() {
                a = (a + 0x6D2B79F5) >>> 0;
                let t = a;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }

        function tileSeed(z, x, y, copy) {
            return Math.imul(z + 1, 73856093) ^ Math.imul(x + 1, 19349663)
                ^ Math.imul(y + 1, 83492791) ^ Math.imul(copy + 1, 2654435761);
        }

        /**
         * `count` random features inside the part of the tile that lies on the image.
         * Polygons are jittered stars (non-convex, so earcut does real work); lines
         * are random walks. Sizes are relative to the tile, so every level is as busy.
         */
        function produceStress(z, x, y, opts, toTile) {
            const layers = { stress_a: [], stress_b: [], stress_c: [], stress_lines: [] };
            if (!opts.count) {
                return layers;
            }

            const span = nominalSpan(z);
            const rx0 = x * span;
            const ry0 = y * span;
            const rw = Math.min(rx0 + span, W) - rx0;
            const rh = Math.min(ry0 + span, H) - ry0;
            if (rw <= 0 || rh <= 0) {
                return layers;
            }

            const rand = mulberry32(tileSeed(z, x, y, opts.copy));
            const fills = [layers.stress_a, layers.stress_b, layers.stress_c];

            for (let f = 0; f < opts.count; f++) {
                const cx = rx0 + rand() * rw;
                const cy = ry0 + rand() * rh;
                const asLine = opts.shape === "lines" || (opts.shape === "mixed" && rand() < 0.4);

                if (asLine) {
                    const step = span * (0.003 + 0.01 * rand());
                    let angle = rand() * Math.PI * 2;
                    let px = cx;
                    let py = cy;
                    const pts = [[px, py]];
                    for (let v = 1; v < opts.verts; v++) {
                        angle += (rand() - 0.5) * 1.2;
                        px += Math.cos(angle) * step;
                        py += Math.sin(angle) * step;
                        pts.push([px, py]);
                    }
                    const tilePts = dedupe(pts.map(toTile));
                    if (tilePts.length >= 2) {
                        layers.stress_lines.push(encodeFeature(2, tilePts));
                    }
                } else {
                    const radius = span * (0.002 + 0.012 * rand());
                    const pts = [];
                    for (let v = 0; v < opts.verts; v++) {
                        const a = (v / opts.verts) * Math.PI * 2;
                        const r = radius * (0.55 + 0.45 * rand());
                        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                    }
                    const tilePts = dedupe(pts.map(toTile));
                    if (tilePts.length >= 3) {
                        fills[f % 3].push(encodeFeature(3, tilePts));
                    }
                }
            }
            return layers;
        }

        // ------------------------------------------------------------ produce

        function produceTile(z, x, y, opts) {
            const span = nominalSpan(z);
            const x0 = x * span;
            const y0 = y * span;
            const pad = span * BUFFER / EXTENT;
            const padded = { x0: x0 - pad, y0: y0 - pad, x1: x0 + span + pad, y1: y0 + span + pad };
            const exact = { x0: x0, y0: y0, x1: x0 + span, y1: y0 + span };

            const toTile = (p) => [
                Math.round((p[0] - x0) / span * EXTENT),
                Math.round((p[1] - y0) / span * EXTENT)
            ];

            const lineFeatures = (segments) => {
                const out = [];
                for (const [a, b] of segments) {
                    const clipped = clipSegment(a, b, padded);
                    if (!clipped) {
                        continue;
                    }
                    const p = clipped.map(toTile);
                    if (p[0][0] !== p[1][0] || p[0][1] !== p[1][1]) {
                        out.push(encodeFeature(2, p));
                    }
                }
                return out;
            };

            const grid = [];
            for (let i = 1; i < COLS; i++) {
                grid.push([[i * CELL, 0], [i * CELL, H]]);
            }
            for (let j = 1; j < ROWS; j++) {
                grid.push([[0, j * CELL], [W, j * CELL]]);
            }

            const border = [
                [[0, 0], [W, 0]], [[W, 0], [W, H]], [[W, H], [0, H]], [[0, H], [0, 0]]
            ];
            const diagonals = [[[0, 0], [W, H]], [[W, 0], [0, H]]];

            const cells = [];
            if (opts.cells) {
                const [i0, i1] = cellRange(exact.x0, exact.x1, COLS);
                const [j0, j1] = cellRange(exact.y0, exact.y1, ROWS);
                for (let j = j0; j <= j1; j++) {
                    for (let i = i0; i <= i1; i++) {
                        if ((i + j) % 2 !== 0) {
                            continue;
                        }
                        const cx0 = Math.max(i * CELL, exact.x0);
                        const cy0 = Math.max(j * CELL, exact.y0);
                        const cx1 = Math.min((i + 1) * CELL, W, exact.x1);
                        const cy1 = Math.min((j + 1) * CELL, H, exact.y1);
                        if (cx1 <= cx0 || cy1 <= cy0) {
                            continue;
                        }
                        cells.push(encodeFeature(3, [[cx0, cy0], [cx1, cy0], [cx1, cy1], [cx0, cy1]].map(toTile)));
                    }
                }
            }

            // Stress first, so the alignment grid draws on top of it.
            const layers = Object.assign(produceStress(z, x, y, opts, toTile), {
                cells: cells,
                grid: lineFeatures(grid),
                diagonals: lineFeatures(diagonals),
                border: lineFeatures(border)
            });

            let features = 0;
            for (const name of Object.keys(layers)) {
                features += layers[name].length;
            }
            return { bytes: encodeTile(layers), features: features };
        }

        return {
            W, H, TILE, MAX_LEVEL, EXTENT, COLS, CELL, ROWS,
            nominalSpan, realColumns, realRows, cellRange, produceTile
        };
    }

    const P = makeProducer();
    const { W, H, TILE, MAX_LEVEL, EXTENT, COLS, CELL, ROWS, nominalSpan, realColumns, realRows, cellRange } = P;

    const HOST = "https://nonsquare-mvt.invalid";

    const STYLE = {
        layers: {
            cells: { type: "fill", color: [0.96, 0.62, 0.04, 0.55] },
            grid: { type: "line", color: [0.86, 0.15, 0.47, 1.0], widthPx: 3, join: "miter", cap: "butt" },
            border: { type: "line", color: [0.86, 0.15, 0.47, 1.0], widthPx: 6, join: "miter", cap: "square" },
            diagonals: { type: "line", color: [0.15, 0.39, 0.92, 1.0], widthPx: 2, join: "round", cap: "round" }
        },
        fallback: { type: "line", color: [0, 0, 0, 1], widthPx: 1, join: "bevel", cap: "butt" }
    };

    // ------------------------------------------------------------------ raster

    class NonSquareGridTileSource extends OpenSeadragon.TileSource {
        constructor() {
            super({
                width: W,
                height: H,
                tileSize: TILE,
                tileOverlap: 0,
                minLevel: 0,
                maxLevel: MAX_LEVEL
            });
        }

        getTileUrl(level, x, y) {
            return `nonsquare-grid:${level}:${x}:${y}`;
        }

        downloadTileStart(context) {
            const tile = context.tile;
            context.finish(paintRasterTile(tile.level, tile.x, tile.y), undefined, "image");
        }
    }

    function paintRasterTile(z, x, y) {
        const s = Math.pow(2, MAX_LEVEL - z);
        const span = nominalSpan(z);
        // Edge tiles are clipped to the level image, as in any real pyramid.
        const width = Math.max(1, Math.min(TILE, Math.ceil(W / s) - x * TILE));
        const height = Math.max(1, Math.min(TILE, Math.ceil(H / s) - y * TILE));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        const x0 = x * span;
        const y0 = y * span;
        // Draw in image pixels from here on.
        ctx.setTransform(1 / s, 0, 0, 1 / s, -x0 / s, -y0 / s);

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, H);

        const [i0, i1] = cellRange(x0, x0 + span, COLS);
        const [j0, j1] = cellRange(y0, y0 + span, ROWS);

        ctx.fillStyle = "#d1d5db";
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                if ((i + j) % 2 === 1) {
                    ctx.fillRect(i * CELL, j * CELL, Math.min(CELL, W - i * CELL), Math.min(CELL, H - j * CELL));
                }
            }
        }

        ctx.strokeStyle = "#6b7280";
        ctx.lineWidth = 6 * s;
        ctx.beginPath();
        for (let i = 0; i <= COLS; i++) {
            ctx.moveTo(i * CELL, 0);
            ctx.lineTo(i * CELL, H);
        }
        for (let j = 0; j < ROWS; j++) {
            ctx.moveTo(0, j * CELL);
            ctx.lineTo(W, j * CELL);
        }
        ctx.moveTo(0, H);
        ctx.lineTo(W, H);
        ctx.stroke();

        ctx.fillStyle = "#374151";
        ctx.font = `${Math.round(CELL * 0.16)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const cx = (i + 0.5) * CELL;
                const cy = Math.min((j + 0.5) * CELL, (j * CELL + H) / 2);
                ctx.fillText(`${i},${j}`, cx, cy);
            }
        }

        return canvas;
    }

    // ------------------------------------------------------------ encoder pool

    /** Encodes tiles off the main thread; falls back to inline if Workers are unavailable. */
    const encoders = (function() {
        const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
        const pending = new Map();
        const workers = [];
        let nextId = 0;

        try {
            const source = `const P = (${makeProducer.toString()})();
self.onmessage = (e) => {
    const m = e.data;
    const t0 = performance.now();
    const tile = P.produceTile(m.z, m.x, m.y, m.opts);
    self.postMessage({ id: m.id, bytes: tile.bytes, features: tile.features, ms: performance.now() - t0 }, [tile.bytes.buffer]);
};`;
            const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
            for (let k = 0; k < size; k++) {
                const worker = new Worker(url);
                worker.inflight = 0;
                worker.onmessage = (e) => {
                    worker.inflight--;
                    const done = pending.get(e.data.id);
                    pending.delete(e.data.id);
                    if (done) {
                        done(e.data);
                    }
                };
                workers.push(worker);
            }
        } catch (e) {
            console.warn("Encoder workers unavailable, encoding on the main thread.", e);
        }

        return {
            size: workers.length,
            produce(z, x, y, opts) {
                if (!workers.length) {
                    const t0 = performance.now();
                    const tile = P.produceTile(z, x, y, opts);
                    return Promise.resolve({ bytes: tile.bytes, features: tile.features, ms: performance.now() - t0 });
                }
                const worker = workers.reduce((best, w) => (w.inflight < best.inflight ? w : best));
                const id = nextId++;
                worker.inflight++;
                return new Promise((resolve) => {
                    pending.set(id, resolve);
                    worker.postMessage({ id, z, x, y, opts });
                });
            }
        };
    })();

    // --------------------------------------------------------- tile "server"

    const stats = {
        requests: 0,
        outsideGrid: 0,
        last: "",
        encodeMs: 0,
        encoded: 0,
        bytes: 0,
        features: 0,
        latencies: [],
        requestedAt: new Map()
    };

    function resetStats() {
        stats.requests = 0;
        stats.outsideGrid = 0;
        stats.last = "";
        stats.encodeMs = 0;
        stats.encoded = 0;
        stats.bytes = 0;
        stats.features = 0;
        stats.latencies = [];
        stats.requestedAt.clear();
    }

    function parseQuery(url) {
        const query = {};
        const q = url.split("?")[1] || "";
        for (const pair of q.split("&")) {
            const [k, v] = pair.split("=");
            if (k) {
                query[k] = v;
            }
        }
        return query;
    }

    /** URL shape: HOST/<scheme>/<z>/<x>/<y>.pbf?g=&cells=&n=&shape=&verts=&copy= */
    async function serveTile(url) {
        const path = url.slice(HOST.length).split("?")[0];
        const [, scheme, zs, xs, ys] = path.split("/");
        const query = parseQuery(url);
        const opts = {
            cells: query.cells !== "0",
            count: Number(query.n) || 0,
            shape: query.shape || "polygons",
            verts: Math.max(3, Number(query.verts) || 6),
            copy: Number(query.copy) || 0
        };
        const z = Number(zs);
        const x = Number(xs);
        const urlY = Number(ys.replace(".pbf", ""));
        // A slide producer counts TMS rows from the bottom of its REAL grid.
        const y = scheme === "xyz" ? urlY : realRows(z) - 1 - urlY;

        stats.requests++;
        stats.requestedAt.set(url, performance.now());
        stats.last = `${scheme} z${z} x${x} url-y ${urlY} → row ${y}`;
        scheduleReadout();

        if (x < 0 || y < 0 || x >= realColumns(z) || y >= realRows(z)) {
            stats.outsideGrid++;
            // An empty tile, not a 404: the point is to see placement, not failures.
            return new Uint8Array(0);
        }

        const tile = await encoders.produce(z, x, y, opts);
        stats.encodeMs += tile.ms;
        stats.encoded++;
        stats.bytes += tile.bytes.length;
        stats.features += tile.features;
        return tile.bytes;
    }

    const httpAdapter = {
        fetch(url, init) {
            if (typeof url === "string" && url.indexOf(HOST) === 0) {
                return serveTile(url).then(bytes => new Response(bytes, {
                    status: 200,
                    headers: { "Content-Type": "application/x-protobuf" }
                }));
            }
            return fetch(url, init);
        }
    };

    // ------------------------------------------------------------------ viewer

    const viewer = window.viewer = OpenSeadragon({
        id: "viewer-container",
        prefixUrl: "../../openseadragon/images/",
        drawer: "flex-renderer",
        drawerOptions: {
            "flex-renderer": {
                debug: false,
                webGLPreferredVersion: "2.0",
                httpAdapter: httpAdapter
            }
        },
        tileSources: new NonSquareGridTileSource(),
        minZoomImageRatio: 0.2,
        maxZoomPixelRatio: 8,
        // 20k features x 96 vertices per tile is slow by design; do not let OSD
        // give up on a tile that is merely queued behind its neighbours.
        timeout: 120000,
        blendTime: 0,
        showNavigator: true
    });

    const $id = (id) => document.getElementById(id);
    let vectorItems = [];
    let generation = 0;

    function buildStyle() {
        const widthPx = Number($id("stress-width").value) || 1;
        return {
            layers: {
                stress_a: { type: "fill", color: [0.49, 0.23, 0.93, 0.45] },
                stress_b: { type: "fill", color: [0.05, 0.65, 0.55, 0.45] },
                stress_c: { type: "fill", color: [0.92, 0.35, 0.05, 0.45] },
                stress_lines: { type: "line", color: [0.1, 0.1, 0.35, 0.8], widthPx: widthPx, join: "round", cap: "round" },
                ...STYLE.layers
            },
            fallback: STYLE.fallback
        };
    }

    function buildTileJSON(copy) {
        const scheme = $id("scheme").value;
        const template = scheme === "neg"
            ? `${HOST}/neg/{z}/{x}/{-y}.pbf`
            : `${HOST}/${scheme}/{z}/{x}/{y}.pbf`;

        // The generation query keeps OSD's tile cache from handing one mode's
        // meshes to another (the cache key is the tile URL); `copy` keeps layer
        // copies from sharing meshes, so N copies really cost N.
        const query = [
            `g=${generation}`,
            `cells=${$id("show-cells").checked ? 1 : 0}`,
            `n=${$id("stress-count").value}`,
            `shape=${$id("stress-shape").value}`,
            `verts=${$id("stress-verts").value}`,
            `copy=${copy}`
        ].join("&");

        const tj = {
            type: "mvt",
            tiles: [`${template}?${query}`],
            tileSize: TILE,
            minzoom: 0,
            extent: EXTENT,
            scheme: scheme === "tms" ? "tms" : "xyz",
            useNativeLines: $id("native-lines").checked,
            style: buildStyle()
        };
        if (!$id("omit-maxzoom").checked) {
            tj.maxzoom = MAX_LEVEL;
        }
        if ($id("declare-size").checked) {
            tj.width = W;
            tj.height = H;
        }
        return tj;
    }

    function loadVector() {
        generation++;
        resetStats();

        for (const item of vectorItems) {
            viewer.world.removeItem(item);
        }
        vectorItems = [];

        const copies = Number($id("stress-copies").value) || 1;
        const shown = { ...buildTileJSON(0), style: "{ stress_*, cells, grid, border, diagonals }" };
        $id("tilejson").textContent = JSON.stringify(shown, null, 2);

        // A plain object, not a TileSource: OSD picks MVTTileSource via supports()
        // and builds it from configure(), which is the code under test.
        for (let copy = 0; copy < copies; copy++) {
            const myGeneration = generation;
            viewer.addTiledImage({
                tileSource: buildTileJSON(copy),
                opacity: Number($id("opacity").value),
                success: (event) => {
                    if (myGeneration !== generation) {
                        // Settings changed while this copy was opening.
                        viewer.world.removeItem(event.item);
                        return;
                    }
                    vectorItems.push(event.item);
                    renderReadout();
                },
                error: (event) => {
                    $id("readout").innerHTML = `<tr><td class="verdict-bad"></td></tr>`;
                    $id("readout").querySelector("td").textContent = `Failed: ${event.message || event}`;
                }
            });
        }
    }

    // ----------------------------------------------------------------- metrics

    const frames = { count: 0, worst: 0, last: 0, fps: 0, worstShown: 0, redraws: 0, redrawsShown: 0, windowStart: 0 };

    function frameLoop(now) {
        if (frames.last) {
            frames.worst = Math.max(frames.worst, now - frames.last);
        }
        frames.last = now;
        frames.count++;
        if (!frames.windowStart) {
            frames.windowStart = now;
        }
        if (now - frames.windowStart >= 1000) {
            const seconds = (now - frames.windowStart) / 1000;
            frames.fps = frames.count / seconds;
            frames.worstShown = frames.worst;
            frames.redrawsShown = frames.redraws / seconds;
            frames.count = 0;
            frames.worst = 0;
            frames.redraws = 0;
            frames.windowStart = now;
            renderReadout();
        }
        requestAnimationFrame(frameLoop);
    }
    requestAnimationFrame(frameLoop);

    viewer.addHandler("update-viewport", () => {
        frames.redraws++;
    });

    viewer.addHandler("tile-loaded", (event) => {
        if (vectorItems.indexOf(event.tiledImage) < 0 || !event.tile || typeof event.tile.getUrl !== "function") {
            return;
        }
        const url = event.tile.getUrl();
        const t = stats.requestedAt.get(url);
        if (t === undefined) {
            return;
        }
        stats.requestedAt.delete(url);
        stats.latencies.push(performance.now() - t);
        if (stats.latencies.length > 300) {
            stats.latencies.shift();
        }
    });

    function percentile(values, p) {
        if (!values.length) {
            return 0;
        }
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    }

    function row(label, value, cls) {
        return `<tr><td>${label}</td><td${cls ? ` class="${cls}"` : ""}>${value}</td></tr>`;
    }

    function renderReadout() {
        const src = vectorItems[0] && vectorItems[0].source;
        if (src) {
            const sizeOk = src.width === W && src.height === H;
            const levelOk = src.maxLevel === MAX_LEVEL;
            const top = src.getNumTiles(src.maxLevel);
            $id("readout").innerHTML =
                row("width × height", `${src.width} × ${src.height}`) +
                row("maxLevel", src.maxLevel) +
                row("tiles at maxLevel", `${top.x} × ${top.y}`) +
                row("expected", `${W} × ${H}, maxLevel ${MAX_LEVEL}, ${realColumns(MAX_LEVEL)} × ${realRows(MAX_LEVEL)}`) +
                row("verdict", sizeOk && levelOk ? "matches the slide" : "does NOT match the slide",
                    sizeOk && levelOk ? "verdict-ok" : "verdict-bad");
        }

        $id("requests").innerHTML =
            row("requested", stats.requests) +
            row("outside the real grid", stats.outsideGrid, stats.outsideGrid ? "verdict-bad" : "verdict-ok") +
            row("last", stats.last || "–");

        const fpsClass = frames.fps >= 50 ? "verdict-ok" : frames.fps < 30 ? "verdict-bad" : "";
        $id("perf").innerHTML =
            row("browser frames / s", frames.fps.toFixed(0), fpsClass) +
            row("worst frame (last 1 s)", `${frames.worstShown.toFixed(0)} ms`, frames.worstShown > 50 ? "verdict-bad" : "") +
            row("viewer redraws / s", frames.redrawsShown.toFixed(0)) +
            row("vector layers", vectorItems.length) +
            row("features served", stats.features.toLocaleString()) +
            row("bytes served", `${(stats.bytes / 1048576).toFixed(1)} MB`) +
            row(`encode (${encoders.size ? encoders.size + " workers" : "main thread"})`,
                stats.encoded ? `${(stats.encodeMs / stats.encoded).toFixed(1)} ms / tile` : "–") +
            row("tile latency p50 / p95", stats.latencies.length
                ? `${percentile(stats.latencies, 0.5).toFixed(0)} / ${percentile(stats.latencies, 0.95).toFixed(0)} ms`
                : "–");
    }

    let readoutQueued = false;
    function scheduleReadout() {
        if (!readoutQueued) {
            readoutQueued = true;
            requestAnimationFrame(() => {
                readoutQueued = false;
                renderReadout();
            });
        }
    }

    // -------------------------------------------------------------- navigation

    function goTo(where) {
        const aspect = H / W;
        const views = {
            "top-left": new OpenSeadragon.Rect(-0.02, -0.02, 0.3, 0.3),
            "right-edge": new OpenSeadragon.Rect(0.8, aspect * 0.5 - 0.1, 0.3, 0.3),
            "bottom-right": new OpenSeadragon.Rect(0.75, aspect - 0.2, 0.3, 0.3)
        };
        if (where === "home") {
            viewer.viewport.goHome();
        } else {
            viewer.viewport.fitBounds(views[where]);
        }
    }

    /**
     * Continuous pan + zoom, driven every frame with `immediately`, so the viewer
     * never settles: tiles are requested, decoded, uploaded and evicted the whole
     * time. Zoom sweeps from the whole slide to 64x; the path covers every edge.
     */
    const tour = { running: false, start: 0 };

    function tourStep(now) {
        if (!tour.running) {
            return;
        }
        const speed = Number($id("tour-speed").value) || 1;
        const t = (now - tour.start) / 1000 * speed;
        const aspect = H / W;
        const center = new OpenSeadragon.Point(
            0.5 + 0.48 * Math.sin(t * 0.37),
            aspect * (0.5 + 0.48 * Math.sin(t * 0.23 + 1.1))
        );
        const zoom = viewer.viewport.getHomeZoom() * Math.pow(2, 6 * (0.5 - 0.5 * Math.cos(t * 0.5)));
        viewer.viewport.panTo(center, true);
        viewer.viewport.zoomTo(zoom, null, true);
        requestAnimationFrame(tourStep);
    }

    function toggleTour() {
        tour.running = !tour.running;
        $id("tour").textContent = tour.running ? "Stop tour" : "Start tour";
        if (tour.running) {
            tour.start = performance.now();
            requestAnimationFrame(tourStep);
        }
    }

    viewer.addOnceHandler("open", loadVector);

    ["declare-size", "omit-maxzoom", "show-cells", "scheme",
        "stress-count", "stress-shape", "stress-verts", "stress-width", "stress-copies", "native-lines"
    ].forEach(id => $id(id).addEventListener("change", loadVector));
    $id("opacity").addEventListener("input", (e) => {
        for (const item of vectorItems) {
            item.setOpacity(Number(e.target.value));
        }
    });
    $id("tour").addEventListener("click", toggleTour);
    $id("reset-stats").addEventListener("click", () => {
        resetStats();
        renderReadout();
    });
    document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => goTo(b.dataset.goto)));
})();
