(function ($) {
/**
 * MVTTileJSONSource
 * ------------------
 * A TileSource that reads TileJSON metadata, fetches MVT (.mvt/.pbf) tiles,
 * decodes + tessellates them on a Web Worker, and returns FlexDrawer-compatible
 * caches using the new `vector-mesh` format (fills + lines).
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
    constructor({ template, scheme = 'xyz', tileSize = 512, minLevel = 0, maxLevel = 14, width, height, extent = 4096, style }) {
        super({ width, height, tileSize, minLevel, maxLevel });
        this.template = template;
        this.scheme = scheme;
        this.extent = extent;
        this.style = style || defaultStyle();
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
                        fills: t.fills.map(packMesh),
                        lines: t.lines.map(packMesh),
                        points: t.points.map(packMesh),
                        icons: t.icons.map(packMesh),
                    }, undefined, 'vector-mesh');
                }
            } else {
                for (const ctx of waiters) {
                    ctx.fail(msg.error || 'Worker failed');
                }
            }
        };

        // Send config once
        this._worker.postMessage({ type: 'config', extent: this.extent, style: this.style });
    }

    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     * @function
     * @param {Object|Array} data
     * @param {String} url - optional
     */
    supports(data, url) {
        return data["tiles"] && data["format"] === "pbf" && url.endsWith(".json");
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

        // Basic TileJSON fields
        const tiles = (tj.tiles && tj.tiles.length) ? tj.tiles : (tj.tilesURL ? [tj.tilesURL] : null);
        if (!tiles) {
            throw new Error('TileJSON missing tiles template');
        }
        const template = tiles[0];
        const tileSize = tj.tileSize || 512;  // many vector tile sets use 512
        const minLevel = tj.minzoom ? tj.minzoom : 0;
        const maxLevel = tj.maxzoom ? tj.maxzoom : 14;
        const scheme = tj.scheme || 'xyz'; // 'xyz' or 'tms'
        const extent = (tj.extent && Number.isFinite(tj.extent)) ? tj.extent : 4096;

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
            style: defaultStyle(),  // todo style
        };
    }

    getTileUrl(level, x, y) {
        const z = level;
        const n = 1 << z;
        const ty = (this.scheme === 'tms') ? (n - 1 - y) : y;
        return this.template.replace('{z}', z).replace('{x}', x).replace('{y}', ty);
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
        } else {
            this._pending.set(key, [ context ]);
        }

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
    };
}

const iconMapping = {
    country: {
        atlasId: 0,
        width: 256,
        height: 256,
    },
    city: {
        atlasId: 1,
        width: 256,
        height: 256,
    },
    village: {
        atlasId: 2,
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
                size: 1.2,
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

})(OpenSeadragon);
