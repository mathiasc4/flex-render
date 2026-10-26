(function ($) {
// Shared MVT worker pipeline for concrete vector tile sources.
class AbstractMVTTileSource extends $.TileSource {
    constructor(options = {}) {
        const normalizedOptions = {
            tileSize: 512,
            minLevel: 0,
            maxLevel: 14,
            ...options,
        };

        super(normalizedOptions);

        if (normalizedOptions._isVector !== false) {
            this._initVectorPipeline(normalizedOptions);
        }
    }

    _initVectorPipeline({
        template = null,
        scheme = 'xyz',
        extent = 4096,
        style,
        useNativeLines = false,
        httpAdapter = null,
    } = {}) {
        this.template = template;
        this.scheme = scheme;
        this.extent = extent;
        this.style = style || defaultStyle();
        this.useNativeLines = useNativeLines === true;

        // Shared worker HTTP bridge; also used by GeoJSONTileSource.
        this._httpAdapter = httpAdapter || ($.FlexDrawer && $.FlexDrawer._defaultHttpAdapter) || null;
        this._worker = makeWorker();
        this._pending = new Map();

        // Icon resolution state. Icons are font-rendered to canvases on the
        // main thread (the worker can't touch DOM), uploaded into firstAtlas,
        // and reported to the worker as a class -> textureId map.
        this._iconResolutionState = 'pending';
        this._iconMap = {};
        this._iconRetryAttempts = 0;
        this._iconRetryTimer = null;

        this._httpBridge = (this._httpAdapter && $.FlexDrawer && typeof $.FlexDrawer.installHttpBridge === 'function')
            ? $.FlexDrawer.installHttpBridge(this._worker, this._httpAdapter)
            : null;

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

        this._worker.postMessage({
            type: 'config',
            extent: this.extent,
            style: this.style,
            useNativeLines: this.useNativeLines,
        });
    }

    downloadTileStart(context) {
        const tile = context.tile;
        const key = context.src;

        if (this._iconResolutionState === 'pending') {
            this._resolveIconsFromContext(context);
        }

        const list = this._pending.get(key);
        if (list) {
            list.push(context);
            return;
        }

        this._pending.set(key, [context]);

        const uvScale = this._tileUvScale(tile);

        this._worker.postMessage({
            type: 'tile',
            key: key,
            z: tile.level,
            x: tile.x,
            y: tile.y,
            url: context.src,
            uvScaleX: uvScale.x,
            uvScaleY: uvScale.y,
        });
    }

    /**
     * Ratio between the NOMINAL tile that vector geometry is authored against
     * and the CLIPPED rectangle the drawer maps UV 0..1 onto.
     *
     * MVT coordinates run 0..extent across a whole tileSize wherever the tile
     * sits, but a tile on a level's right/bottom edge — and every tile of a
     * level smaller than one tile — covers only part of that rectangle, and
     * `Tile.positionedBounds` is clipped to match. Without this factor the mesh
     * is squeezed into the visible part of its own tile. The raster path solves
     * the same problem by scaling texcoords (`sourceWidthFraction`); a vector
     * tile has no texcoords, so the correction has to reach the mesh itself.
     *
     * Both components are 1 whenever the world is an exact multiple of the tile
     * size, which is every square web-mercator pyramid.
     *
     * @param {OpenSeadragon.Tile} tile
     * @returns {{x: number, y: number}}
     * @private
     */
    _tileUvScale(tile) {
        try {
            const clipped = this.getTileBounds(tile.level, tile.x, tile.y, true);
            const nominalX = this.getTileWidth(tile.level);
            const nominalY = this.getTileHeight(tile.level);

            if (!(clipped.width > 0) || !(clipped.height > 0) || !(nominalX > 0) || !(nominalY > 0)) {
                return {x: 1, y: 1};
            }
            return {
                x: nominalX / clipped.width,
                y: nominalY / clipped.height
            };
        } catch (e) {
            // A source whose dimensions are not resolvable yet renders the way it
            // did before this correction existed, rather than not at all.
            return {x: 1, y: 1};
        }
    }

    _resolveIconsFromContext(context) {
        // Resolve the backend lazily — TileSources are constructed before any
        // FlexDrawer/renderer exists, so we walk up from the tile on first use.
        const tiledImage = context && context.tile && context.tile.tiledImage;
        const backend = tiledImage
            && tiledImage.viewer
            && tiledImage.viewer.drawer
            && tiledImage.viewer.drawer.renderer
            && tiledImage.viewer.drawer.renderer.backend;
        if (!backend || !backend.firstAtlas) {
            // Not a Flex-backed viewer — skip icon resolution silently.
            this._iconResolutionState = 'unavailable';
            return;
        }
        this._tiledImage = tiledImage;
        this._iconResolutionState = 'partial';
        this._resolveIcons(backend);
    }

    _collectIconClassSpecs() {
        const specs = [];
        const layers = (this.style && this.style.layers) || {};
        for (const layerName of Object.keys(layers)) {
            const layer = layers[layerName];
            if (!layer || layer.type !== 'icon' || !layer.classes) {
                continue;
            }
            const iconSize = Number.isFinite(layer.iconSize) ? layer.iconSize : 256;
            for (const className of Object.keys(layer.classes)) {
                const cls = layer.classes[className] || {};
                specs.push({
                    layerName,
                    className,
                    spec: {
                        icon: cls.icon,
                        iconSet: cls.iconSet || 'html-glyphs',
                        size: Number.isFinite(cls.iconSize) ? cls.iconSize : iconSize,
                        padding: Number.isFinite(cls.padding) ? cls.padding : 4,
                        color: cls.color || '#111111',
                        backgroundColor: cls.backgroundColor || '#00000000',
                        glyphFontFamily: cls.glyphFontFamily,
                        glyphFontWeight: cls.glyphFontWeight
                    }
                });
            }
        }
        return specs;
    }

    _resolveIcons(backend) {
        const lib = $.FlexRenderer && $.FlexRenderer.UIControls && $.FlexRenderer.UIControls.IconLibrary;
        if (!lib || typeof lib.renderIconToCanvas !== 'function') {
            this._iconResolutionState = 'unavailable';
            return;
        }

        const all = this._collectIconClassSpecs();
        if (!all.length) {
            this._iconResolutionState = 'resolved';
            return;
        }

        const stillPending = [];
        let changed = false;

        for (const entry of all) {
            const existing = this._iconMap[entry.layerName] && this._iconMap[entry.layerName][entry.className];
            if (Number.isInteger(existing) && existing >= 0) {
                continue;
            }
            const result = lib.renderIconToCanvas(entry.spec);
            if (result.ready) {
                const textureId = lib.uploadToAtlas(backend.firstAtlas, result);
                if (Number.isInteger(textureId) && textureId >= 0) {
                    this._iconMap[entry.layerName] = this._iconMap[entry.layerName] || {};
                    this._iconMap[entry.layerName][entry.className] = textureId;
                    changed = true;
                    continue;
                }
            }
            if (result.retry) {
                stillPending.push(entry);
            }
        }

        if (changed) {
            this._worker.postMessage({
                type: 'icons',
                iconMap: this._iconMap,
            });
            // Force already-decoded tiles to re-emit with the new textureIds.
            if (this._tiledImage && typeof this._tiledImage.reset === 'function') {
                try {
                    this._tiledImage.reset();
                } catch (_) {
                    // noop
                }
            }
        }

        if (stillPending.length && this._iconRetryAttempts < 10) {
            this._iconResolutionState = 'partial';
            this._scheduleIconRetry(backend);
        } else {
            this._iconResolutionState = 'resolved';
            if (this._iconRetryTimer) {
                clearTimeout(this._iconRetryTimer);
                this._iconRetryTimer = null;
            }
        }
    }

    /**
     * Re-apply the current style after a runtime icon-mapping change. Resets
     * the resolution state, reposts the config to the worker, and forces the
     * tiled image to re-decode so the next pass picks up new textureIds.
     */
    refreshIcons() {
        this._iconResolutionState = 'pending';
        this._iconMap = {};
        this._iconRetryAttempts = 0;
        if (this._iconRetryTimer && this._iconRetryTimer !== -1) {
            clearTimeout(this._iconRetryTimer);
        }
        this._iconRetryTimer = null;

        this._worker.postMessage({
            type: 'config',
            extent: this.extent,
            style: this.style,
            useNativeLines: this.useNativeLines,
        });
        // Clear the worker's accumulated iconMap so removed classes drop out.
        this._worker.postMessage({ type: 'icons', iconMap: {}, replace: true });

        if (this._tiledImage && typeof this._tiledImage.reset === 'function') {
            try {
                this._tiledImage.reset();
            } catch (_) {
                // noop
            }
        }
    }

    _scheduleIconRetry(backend) {
        if (this._iconRetryTimer) {
            return;
        }
        this._iconRetryAttempts += 1;
        const fonts = typeof document !== 'undefined' && document.fonts;
        const retry = () => {
            this._iconRetryTimer = null;
            this._resolveIcons(backend);
        };
        if (this._iconRetryAttempts === 1 && fonts && typeof fonts.ready === 'object') {
            // First retry: wait for the browser's font-loading promise when available.
            fonts.ready.then(retry, retry);
            this._iconRetryTimer = -1; // sentinel: pending via promise, not timer
        } else {
            this._iconRetryTimer = setTimeout(retry, 250);
        }
    }
}

// attach to flex renderer, since OSD treats all $.XXXTileSource named children as source candidates
$.FlexRenderer.AbstractMVTTileSource = AbstractMVTTileSource;

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
$.MVTTileSource = class extends $.FlexRenderer.AbstractMVTTileSource {
    constructor(options) {
        super(options);
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
            // Place labels from OpenMapTiles schema (country/city/village/...).
            // Uses HTML-glyph icons so it works without external fonts. Switch
            // iconSet to "ph-regular-common" / "ph-fill-common" (Phosphor) or
            // "fa-solid-common" (Font Awesome) once the host page loads that
            // webfont — see the "Icon fonts" section of the README.
            place: {
                type: 'icon',
                size: 0.4,
                iconSize: 256,
                classes: {
                    country: { icon: '⌖', iconSet: 'html-glyphs', color: '#0a3a0a' },
                    state:   { icon: '◆', iconSet: 'html-glyphs', color: '#06366c' },
                    city:    { icon: '●', iconSet: 'html-glyphs', color: '#c03030' },
                    town:    { icon: '●', iconSet: 'html-glyphs', color: '#d06060' },
                    village: { icon: '▲', iconSet: 'html-glyphs', color: '#946334' },
                    hamlet:  { icon: '▴', iconSet: 'html-glyphs', color: '#946334' },
                },
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
