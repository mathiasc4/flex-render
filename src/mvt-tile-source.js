(function ($) {
/**
 * MVTTileJSONSource
 * ------------------
 * A TileSource that reads TileJSON metadata, fetches MVT (.mvt/.pbf) tiles,
 * decodes + tessellates them on a Web Worker, and returns FlexDrawer-compatible
 * caches using the `vector-mesh` format.
 *
 * Requirements:
 *  - flex-drawer.js patched to accept `vector-mesh` (see vector-mesh-support.patch)
 *  - flex-webgl2.js patched to draw geometry in first pass (see flex-webgl2-vector-pass.patch)
 *
 * Usage:
 *   const src = await OpenSeadragon.MVTTileJSONSource.from(
 *     'https://tiles.example.com/basemap.json',
 *     { style: defaultStyle() }
 *   );
 *   viewer.addTiledImage({ tileSource: src });
 *
 * Usage (local server for testing via docker):
 *     Download desired vector tiles from the server, and run:
 *       docker run -it --rm -p 8080:8080 -v /path/to/data:/data maptiler/tileserver-gl-light:latest
 *
 * Alternatives (not supported):
 *      PMTiles range queries
 *      Raw files: pip install mbutil && mb-util --image_format=pbf mytiles.mbtiles ./tiles
 *
 *
 * TODO OSD uses // eslint-disable-next-line compat/compat to disable URL warns for opera mini - what is the purpose of supporting it at all
 */
$.MVTTileSource = class extends $.TileSource {
    constructor({
                    template,
                    scheme = 'xyz',
                    tileSize = 512,
                    minLevel = 0,
                    maxLevel = 14,
                    width,
                    height,
                    extent = 4096,
                    style,
                    useNativeLines = false
                }) {
        super({ width, height, tileSize, minLevel, maxLevel });
        this.template = template;
        this.scheme = scheme;
        this.extent = extent;
        this.style = style || defaultStyle();
        this.useNativeLines = useNativeLines === true;

        this._worker = makeWorker();
        this._pending = new Map(); // key -> {resolve,reject}

        // Wire worker responses
        this._worker.onmessage = (e) => {
            const msg = e.data;
            if (!msg || !msg.key) {
                return;
            }

            const waiters = this._pending.get(msg.key);
            if (!waiters) {
                return;
            }
            this._pending.delete(msg.key);

            if (msg.ok) {
                const t = msg.data;

                for (const ctx of waiters) {
                    ctx.finish({
                        fills: (t.fills || []).map(packMesh),
                        lines: (t.lines || []).map(packMesh),
                        linePrimitives: (t.linePrimitives || []).map(packMesh),
                        points: (t.points || []).map(packMesh),
                    }, undefined, 'vector-mesh');
                }
            } else {
                for (const ctx of waiters) {
                    ctx.fail(msg.error || 'Worker failed');
                }
            }
        };

        // Send config once
        this._worker.postMessage({
            type: 'config',
            extent: this.extent,
            style: this.style,
            useNativeLines: this.useNativeLines
        });
    }

    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     * @function
     * @param {Object|Array} data
     * @param {String} url - optional
     */
    supports(data, url) {
        if (!isPlainObject(data)) {
            return false;
        }

        if (!hasTileTemplate(data)) {
            return false;
        }

        // Explicit opt-in for manually supplied sources.
        // Useful for:
        // {
        //   type: "mvt",
        //   tiles: ["http://localhost:3000/source/{z}/{x}/{y}"]
        // }
        if (data.type === "mvt" || data.type === "vector") {
            return true;
        }

        // Common TileJSON / tileserver declarations.
        if (data.format === "pbf" || data.format === "mvt") {
            return true;
        }

        // Vector TileJSON commonly contains vector_layers.
        // Martin/OpenMapTiles should generally expose this on the source endpoint,
        // not on /catalog.
        if (Array.isArray(data.vector_layers)) {
            return true;
        }

        // Last safe fallback: the tile template itself clearly says MVT/PBF.
        // This accepts e.g. ".../{z}/{x}/{y}.pbf" but avoids raster TileJSON
        // such as png/jpg tiles.
        return hasVectorTileTemplate(data);
    }

    /**
     *
     * @function
     * @param {Object} data - the options
     * @param {String} dataUrl - the url the image was retrieved from, if any.
     * @param {String} postData - HTTP POST data in k=v&k2=v2... form or null
     * @returns {Object} options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure(data, dataUrl, postData) {
        const tj = data;

        const tiles = getTileTemplates(tj);
        if (!tiles.length) {
            throw new Error("TileJSON missing tiles template");
        }

        const template = resolveTileTemplate(tiles[0], dataUrl);

        const tileSize = Number.isFinite(tj.tileSize)
            ? tj.tileSize
            : Number.isFinite(tj.tile_size)
                ? tj.tile_size
                : 512;

        const minLevel = Number.isFinite(tj.minzoom) ? tj.minzoom : 0;
        const maxLevel = Number.isFinite(tj.maxzoom) ? tj.maxzoom : 14;

        const scheme = tj.scheme === "tms" ? "tms" : "xyz";

        // This is the internal vector-tile coordinate extent, not geographic bounds.
        const extent = Number.isFinite(tj.extent) ? tj.extent : 4096;

        const width = Math.pow(2, maxLevel) * tileSize;
        const height = width;

        return {
            template,
            scheme,
            tileSize,
            minLevel,
            maxLevel,
            width,
            height,
            extent,
            style: tj.style || defaultStyle(),
            useNativeLines: tj.useNativeLines === true
        };
    }

    getTileUrl(level, x, y) {
        const z = level;
        const n = 1 << z;
        const flippedY = n - 1 - y;
        const yValue = this.scheme === "tms" ? flippedY : y;

        return this.template
            .replace(/\{-y\}/g, String(flippedY))
            .replace(/\{z\}/g, String(z))
            .replace(/\{x\}/g, String(x))
            .replace(/\{y\}/g, String(yValue));
    }

    getTileHashKey(level, x, y) {
        return `mvt:${this.useNativeLines ? 'native-lines' : 'stroke-lines'}:${this.getTileUrl(level, x, y)}`;
    }

    /**
     * Return a FlexDrawer cache object directly (vector-mesh).
     */
    downloadTileStart(context) {
        const tile = context.tile;
        const key = context.src;

        const list = this._pending.get(key);
        if (list) {
            list.push(context);
            return;
        }

        this._pending.set(key, [ context ]);

        this._worker.postMessage({
            type: 'tile',
            key: key,
            z: tile.level,
            x: tile.x,
            y: tile.y,
            url: context.src
        });
    }
};

// ---------- Helpers ----------

function packMesh(m) {
    return {
        vertices: new Float32Array(m.vertices),
        indices: new Uint32Array(m.indices),
        color: m.color || [1, 0, 0, 1],
        parameters: m.parameters ? new Float32Array(m.parameters) : undefined,
        lineWidth: Number.isFinite(m.lineWidth) && m.lineWidth > 0 ? m.lineWidth : undefined,
    };
}

// TODO: make icons dynamic
const iconMapping = {
    country: {
        textureId: 0,
        width: 256,
        height: 256,
    },
    city: {
        textureId: 1,
        width: 256,
        height: 256,
    },
    village: {
        textureId: 2,
        width: 256,
        height: 256,
    },
};

function defaultStyle() {
    // Super-minimal style mapping; replace as needed.
    // layerName => {type:'fill'|'line', color:[r,g,b,a], widthPx?:number, join?:'miter'|'bevel'|'round', cap?:'butt'|'square'|'round'}
    return {
        layers: {
            water:          { type: 'fill', color: [0.10, 0.80, 0.80, 0.80] },
            landcover:      { type: 'fill', color: [0.10, 0.80, 0.10, 0.80] },
            landuse:        { type: 'fill', color: [0.80, 0.80, 0.10, 0.80] },
            park:           { type: 'fill', color: [0.10, 0.80, 0.10, 0.80] },
            boundary:       { type: 'line', color: [0.60, 0.20, 0.60, 1.00], widthPx: 2.0, join: 'round', cap: 'round' },
            waterway:       { type: 'line', color: [0.10, 0.10, 0.80, 1.00], widthPx: 1.2, join: 'round', cap: 'round' },
            transportation: { type: 'line', color: [0.80, 0.60, 0.10, 1.00], widthPx: 1.6, join: 'round', cap: 'round' },
            road:           { type: 'line', color: [0.60, 0.60, 0.60, 1.00], widthPx: 1.6, join: 'round', cap: 'round' },
            building:       { type: 'fill', color: [0.10, 0.10, 0.10, 0.80] },
            aeroway:        { type: 'fill', color: [0.10, 0.80, 0.60, 0.80] },
            poi:            { type: 'point', color: [0.00, 0.00, 0.00, 1.00], size: 10.0 },
            housenumber:    { type: 'point', color: [0.50, 0.00, 0.50, 1.00], size: 8.0 },
            place:          {
                type: 'icon',
                color: [0.80, 0.10, 0.10, 1.00],
                size: 0.8,
                iconMapping: iconMapping, // TODO: somehow pass a function instead?
            },
        },
        // Default if layer not listed
        fallback: { type: 'line', color: [0.50, 0.50, 0.50, 1.00], widthPx: 0.8, join: 'bevel', cap: 'butt' }
    };
}

function makeWorker() {
    // Prefer the inlined source if available
    const inline = (OpenSeadragon && OpenSeadragon.__MVT_WORKER_SOURCE__);
    if (inline) {
        const blob = new Blob([inline], { type: "text/javascript" });
        return new Worker((window.URL || window.webkitURL).createObjectURL(blob));
    }

    throw new Error('No worker source available');
}

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function getTileTemplates(data) {
    if (!isPlainObject(data)) {
        return [];
    }

    if (Array.isArray(data.tiles)) {
        return data.tiles.filter(t => typeof t === "string");
    }

    if (typeof data.tilesURL === "string") {
        return [data.tilesURL];
    }

    if (typeof data.template === "string") {
        return [data.template];
    }

    return [];
}

function hasTileTemplate(data) {
    return getTileTemplates(data).some(isZxyTemplate);
}

function isZxyTemplate(template) {
    return /\{z\}/.test(template)
        && /\{x\}/.test(template)
        && (/\{y\}/.test(template) || /\{-y\}/.test(template));
}

function hasVectorTileTemplate(data) {
    return getTileTemplates(data).some(template => {
        const clean = template.split("?")[0].split("#")[0];

        return /\.(pbf|mvt)$/i.test(clean)
            || /[?&]format=(pbf|mvt)(?:&|$)/i.test(template);
    });
}

function resolveTileTemplate(template, dataUrl) {
    if (!dataUrl) {
        return template;
    }

    const placeholders = [
        ["{-y}", "__MVT_NEG_Y__"],
        ["{z}", "__MVT_Z__"],
        ["{x}", "__MVT_X__"],
        ["{y}", "__MVT_Y__"],
    ];

    let protectedTemplate = template;
    for (const [raw, token] of placeholders) {
        protectedTemplate = protectedTemplate.replaceAll(raw, token);
    }

    try {
        let resolved = new URL(protectedTemplate, dataUrl).toString();

        for (const [raw, token] of placeholders) {
            resolved = resolved.replaceAll(token, raw);
        }

        return resolved;
    } catch (e) {
        return template;
    }
}

})(OpenSeadragon);
