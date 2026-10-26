(function($) {
    /**
     * A color in any encoding the source accepts.
     *
     * Supported forms:
     * - CSS hex string: `'#rgb'`, `'#rgba'`, `'#rrggbb'`, `'#rrggbbaa'` (leading `#` optional)
     * - Array of 3 or 4 finite numbers, either 0..1 floats or 0-255 components
     * - Packed signed 32-bit ARGB integer, as written by QuPath
     *
     * A numeric array is read as 0..1 floats when every component is `<= 1`, and as
     * 0-255 otherwise. See GEOJSON.md for the reasoning and the one case this makes
     * unwritable.
     *
     * @typedef {string|number|number[]} GeoJSONColor
     */

    /**
     * Ramps a numeric feature property through a color scale.
     *
     * Supply either `name` (a scheme from src/colormaps.js) or `stops` (an explicit
     * ramp). `steps` only selects how many stops to pull from a named scheme, which
     * controls ramp fidelity; it is not a quantization count, since interpolation
     * between stops is continuous.
     *
     * @typedef {object} GeoJSONColormapSpec
     * @property {string} property - Dotted path to the numeric feature property to ramp.
     * @property {string} [name] - Colormap scheme name, for example 'Viridis' or 'Spectral'.
     * @property {number} [steps] - Stop count to pull from the named scheme. Defaults to the
     *     scheme's largest available variant. Schemes differ in which counts they offer.
     * @property {GeoJSONColor[]} [stops] - Explicit ramp, bypassing `name` entirely. At least two.
     * @property {number[]} [domain=[0, 1]] - Value range as [min, max]. Values are clamped.
     */

    /**
     * Options controlling annotation style.
     *
     * Beyond the flat per-geometry-type colors, a feature's color can be derived
     * from its own properties. Resolution order per feature, first hit wins:
     *
     * 1. `classes[properties[classProperty]]` - a label lookup, which lets a caller
     *    recolor at runtime via `setStyle` without re-exporting the source data.
     * 2. `colorProperties` - the first listed path holding a parseable color, i.e.
     *    the color the producer baked into the file.
     * 3. `colormap` - ramp a numeric property through a color scale.
     * 4. `pointColor` / `lineColor` / `fillColor` - the flat fallback.
     *
     * All four resolver fields are optional. Omit them all and styling behaves
     * exactly as it did before they existed.
     *
     * @typedef {object} GeoJSONStyleOptions
     * @property {number} [pointSize=4] - Point size in pixels.
     * @property {GeoJSONColor} [pointColor=[1, 0.2, 0.2, 1]] - Fallback point color.
     * @property {number} [lineWidth=2] - Line width in pixels.
     * @property {GeoJSONColor} [lineColor=[0.2, 1, 0.2, 1]] - Fallback line color.
     * @property {GeoJSONColor} [fillColor=[0.2, 0.2, 1, 0.6]] - Fallback fill color.
     * @property {string[]} [colorProperties] - Ordered dotted paths to read a per-feature
     *     color from, for example `['classification.color', 'color']`.
     * @property {string} [classProperty] - Dotted path to the feature property holding the
     *     class label. Required when `classes` is set.
     * @property {Object<string, GeoJSONColor|{color: GeoJSONColor}>} [classes] - Map of class
     *     label to color. Wins over `colorProperties`, which is what makes runtime recolor work.
     * @property {GeoJSONColormapSpec} [colormap] - Ramp a numeric property through a color scale.
     */

    /**
     * Options controlling per-tile annotation aggregation.
     *
     * When enabled, non-max-level tiles with more than threshold visible
     * annotations are rendered as one cluster badge instead of rendering every
     * annotation mesh in that tile.
     *
     * @typedef {object} GeoJSONAggregationOptions
     * @property {boolean} [enabled=false] - Whether tile-level aggregation is enabled.
     * @property {number} [threshold=50] - Aggregate when visible annotation count is greater than this value.
     * @property {number} [badgeSize=56] - Cluster badge diameter in level pixels.
     * @property {number[]} [badgeColor=[1, 0.5, 0, 1]] - Badge color as [r, g, b, a].
     * @property {number[]} [labelColor=[0, 0, 0, 1]] - Count label color as [r, g, b, a].
     * @property {number} [labelSize=24] - Count label size in level pixels.
     * @property {number} [labelStrokeWidth=3] - Count label stroke width in level pixels.
     * @property {number} [maxLabelValue=9999] - Maximum visible label value before using a plus suffix.
     */

    /**
     * Options used to construct a GeoJSON tile source.
     *
     * @typedef {object} GeoJSONTileSourceOptions
     * @property {string} url - Source URL used to fetch or identify the GeoJSON.
     * @property {number[]} [bbox] - Optional GeoJSON top-level bbox. This is the source
     *     coordinate extent as [minX, minY, maxX, maxY] or a valid GeoJSON 3D bbox.
     *     When supplied together with width and height, coordinates are mapped from bbox into
     *     those destination dimensions.
     * @property {number} [width] - Full-resolution overlay width in OpenSeadragon image coordinates.
     *     If omitted, it is inferred from bbox as maxX - minX. When supplied together
     *     with bbox, it is the destination width that the bbox coordinate range is
     *     mapped onto.
     * @property {number} [height] - Full-resolution overlay height in OpenSeadragon image coordinates.
     *     If omitted, it is inferred from bbox as maxY - minY. When supplied together
     *     with bbox, it is the destination height that the bbox coordinate range is
     *     mapped onto.
     * @property {number} [tileSize=512] - Logical tile size used by OpenSeadragon.
     * @property {number} [minLevel=0] - Minimum pyramid level.
     * @property {number} [maxLevel] - Maximum pyramid level. Defaults to ceil(log2(max(width, height))).
     * @property {GeoJSONStyleOptions} [style] - Optional style descriptor.
     * @property {boolean} [useNativeLines=false] - Whether LineString geometries are processed into gl.LINES primitives of stroke-triangle meshes.
     * @property {GeoJSONAggregationOptions} [aggregation] - Optional per-tile aggregation settings.
     * @property {HttpAdapter} [httpAdapter] - Optional host-supplied HTTP transport used by the GeoJSON worker.
     *     When omitted, the drawer-level adapter (if any) is used; otherwise native `fetch` is used.
     * @property {boolean} [debug=false] - When true, the worker logs suspicious empty-tile
     *     builds (a tile whose bounds overlap data yet meshes nothing), with level/x/y,
     *     tile bounds, intersecting-candidate count and per-type clip drops. Diagnostic aid
     *     for edge-tile mesh bugs; leaves rendering unchanged.
     */

    const GEOJSON_ROOT_TYPES = new Set([
        'FeatureCollection',
        'Feature',
        'Point',
        'MultiPoint',
        'LineString',
        'MultiLineString',
        'Polygon',
        'MultiPolygon',
        'GeometryCollection'
    ]);

    /**
     * Tile source for GeoJSON-backed vector tiles.
     *
     * This class is intentionally only the OpenSeadragon TileSource boundary.
     * GeoJSON parsing, bbox normalization, clipping, simplification, and meshing should
     * live in worker/helper code, not in FlexRenderer.
     */
    $.GeoJSONTileSource = class extends $.TileSource {
        /**
         * Create a GeoJSON tile source.
         *
         * @param {GeoJSONTileSourceOptions} options - Source options.
         */
        constructor(options = {}) {
            const normalized = $.GeoJSONTileSource.normalizeOptions(options);

            super({
                width: normalized.width,
                height: normalized.height,
                tileSize: normalized.tileSize,
                tileOverlap: 0,
                minLevel: normalized.minLevel,
                maxLevel: normalized.maxLevel
            });

            /**
             * URL used to fetch or identify the source.
             *
             * @private
             * @type {?string}
             */
            this._url = normalized.url;

            /**
             * GeoJSON source bbox used to infer dimensions, if supplied.
             *
             * The bbox is normalized to 2D [minX, minY, maxX, maxY] form even
             * when the source uses a 3D GeoJSON bbox.
             *
             * @type {?number[]}
             */
            this.bbox = normalized.bbox;

            /**
             * The provided tile size, store because OpenSeadragon overwrites this.tileSize.
             *
             * @type {number}
             * @private
             */
            this._tileSize = normalized.tileSize;

            /**
             * Optional source-level styling configuration.
             *
             * @type {?object}
             */
            this.style = normalized.style;

            /**
             * Whether LineString geometries are rendered with native gl.LINES.
             *
             * @type {boolean}
             */
            this.useNativeLines = normalized.useNativeLines;

            /**
             * Optional per-tile annotation aggregation settings.
             *
             * @type {GeoJSONAggregationOptions}
             */
            this.aggregation = normalized.aggregation;

            /**
             * Whether the worker logs suspicious empty-tile builds (a tile that overlaps
             * data yet meshes nothing). Off by default; enable to pin edge-tile mesh bugs.
             *
             * @type {boolean}
             */
            this.debug = normalized.debug;

            /**
             * Optional HttpAdapter routing the worker's outbound fetches.
             *
             * Explicit option wins; otherwise the drawer-level default is used.
             *
             * @private
             * @type {?HttpAdapter}
             */
            this._httpAdapter = normalized.httpAdapter;

            /**
             * Handle returned by FlexDrawer.installHttpBridge when an adapter is wired.
             *
             * @private
             * @type {?{dispose: function(): void}}
             */
            this._httpBridge = null;

            /**
             * Pending tile jobs keyed by tile id.
             *
             * @private
             * @type {Map<string, OpenSeadragon.ImageJob[]>}
             */
            this._pending = new Map();

            /**
             * Worker instance used for GeoJSON normalization and meshing.
             *
             * @private
             * @type {?Worker}
             */
            this._worker = null;

            /**
             * Object URL used to construct the inline Blob worker.
             *
             * This is revoked in destroy() after the worker is terminated.
             *
             * @private
             * @type {?string}
             */
            this._workerObjectUrl = null;

            /**
             * Fatal worker setup or runtime error, if one has occurred.
             *
             * Once set, future tile jobs fail immediately instead of being sent to a
             * worker that cannot produce valid tiles.
             *
             * Only genuinely fatal conditions latch here. Individual malformed
             * features are skipped by the worker and reported as warnings instead.
             *
             * @private
             * @type {?string}
             */
            this._workerError = null;

            /**
             * Tiled image this source is attached to, resolved lazily on first tile
             * request. Used by setStyle to force a re-decode.
             *
             * @private
             * @type {?OpenSeadragon.TiledImage}
             */
            this._tiledImage = null;

            this._worker = this._createWorker();

            // Install the HTTP bridge before the worker's config postMessage so the bridge is
            // already on when the worker performs its initial GeoJSON fetch.
            if (this._httpAdapter && $.FlexDrawer && typeof $.FlexDrawer.installHttpBridge === 'function') {
                this._httpBridge = $.FlexDrawer.installHttpBridge(this._worker, this._httpAdapter);
            }

            this._configureWorker();
        }

        /**
         * Normalize and validate constructor options before TileSource construction.
         *
         * @param {Partial<GeoJSONTileSourceOptions>} options - Raw options.
         * @returns {GeoJSONTileSourceOptions} Normalized options.
         * @throws {Error} Thrown when required coordinate or tiling options are invalid.
         */
        static normalizeOptions(options = {}) {
            const bbox = options.bbox ? normalizeGeoJSONBBox(options.bbox) : null;
            const inferredDimensions = bbox ? getBBoxDimensions(bbox) : null;
            const hasExplicitWidth = options.width !== null && options.width !== undefined;
            const hasExplicitHeight = options.height !== null && options.height !== undefined;
            const hasExplicitDimensions = hasExplicitWidth && hasExplicitHeight;

            const normalized = {
                url: options.url,
                bbox,
                width: hasExplicitDimensions ? options.width : (inferredDimensions ? inferredDimensions.width : undefined),
                height: hasExplicitDimensions ? options.height : (inferredDimensions ? inferredDimensions.height : undefined),
                tileSize: (options.tileSize !== null && options.tileSize !== undefined) ? options.tileSize : 512,
                minLevel: (options.minLevel !== null && options.minLevel !== undefined) ? options.minLevel : 0,
                maxLevel: options.maxLevel,
                style: normalizeStyleOptions(options.style),
                useNativeLines: options.useNativeLines === true,
                aggregation: normalizeAggregationOptions(options.aggregation),
                httpAdapter: options.httpAdapter || ($.FlexDrawer && $.FlexDrawer._defaultHttpAdapter) || null,
                debug: options.debug === true
            };

            if (typeof normalized.url !== 'string' || !normalized.url.trim()) {
                throw new Error('GeoJSONTileSource: url is required and must be a non-empty string.');
            }

            normalized.url = resolveUrl(normalized.url);

            // we cannot fetch the GeoJSON itself here, if neither the bbox nor width and height are provided, we throw.

            if (!Number.isFinite(normalized.width) || normalized.width <= 0) {
                throw new Error(
                    'GeoJSONTileSource: width must be a positive finite number, ' +
                    'or a valid GeoJSON bbox must be provided so width can be inferred.'
                );
            }

            if (!Number.isFinite(normalized.height) || normalized.height <= 0) {
                throw new Error(
                    'GeoJSONTileSource: height must be a positive finite number, ' +
                    'or a valid GeoJSON bbox must be provided so height can be inferred.'
                );
            }

            if (!Number.isFinite(normalized.tileSize) || normalized.tileSize <= 0) {
                throw new Error('GeoJSONTileSource: tileSize must be a positive finite number.');
            }

            if (!Number.isInteger(normalized.minLevel) || normalized.minLevel < 0) {
                throw new Error('GeoJSONTileSource: minLevel must be a non-negative integer.');
            }

            if (normalized.maxLevel === undefined || normalized.maxLevel === null) {
                normalized.maxLevel = Math.ceil(Math.log2(Math.max(normalized.width, normalized.height)));
            }

            if (!Number.isInteger(normalized.maxLevel) || normalized.maxLevel < normalized.minLevel) {
                throw new Error('GeoJSONTileSource: maxLevel must be an integer greater than or equal to minLevel.');
            }

            return normalized;
        }

        /**
         * Determine whether the supplied metadata can configure a GeoJSON tile source.
         *
         * @param {object} data - Supplied metadata.
         * @param {string} _url - URL the metadata was loaded from, if any.
         * @returns {boolean} True when the metadata is likely to configure a GeoJSONTileSource.
         */
        supports(data, _url) {
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                return false;
            }

            if (GEOJSON_ROOT_TYPES.has(data.type) && data.bbox) {
                return true;
            }

            if (data.type === 'geojson') {
                return true;
            }

            if (typeof data.url === 'string' && data.url.endsWith('.geojson')) {
                return true;
            }

            return false;
        }

        /**
         * Validate and convert supplied metadata into constructor options for a GeoJSONTileSource.
         *
         * @param {object} data - Supplied metadata.
         * @param {string} url - URL the metadata was loaded from, if any.
         * @param {string} _postData - POST data passed during metadata loading, if any.
         * @returns {GeoJSONTileSourceOptions} Constructor options.
         */
        configure(data, url, _postData) {
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error(`GeoJSONTileSource: invalid metadata from ${url}.`);
            }

            if (data.type === 'geojson') {
                return {
                    url: resolveUrl(data.url, url),
                    bbox: data.bbox,
                    width: data.width,
                    height: data.height,
                    tileSize: data.tileSize,
                    minLevel: data.minLevel,
                    maxLevel: data.maxLevel,
                    style: data.style,
                    useNativeLines: data.useNativeLines,
                    aggregation: data.aggregation
                };
            }

            if (GEOJSON_ROOT_TYPES.has(data.type)) {
                return {
                    url: resolveUrl(url),
                    bbox: data.bbox,
                };
            }

            throw new Error(`GeoJSONTileSource: invalid metadata from ${url}.`);
        }

        /**
         * Return a stable pseudo URL for OpenSeadragon tile identity.
         *
         * @param {number} level - Pyramid level.
         * @param {number} x - Tile column.
         * @param {number} y - Tile row.
         * @returns {string} Stable tile identifier.
         */
        getTileUrl(level, x, y) {
            return `geojson://${encodeURIComponent(this._url)}/${level}/${x}/${y}`;
        }

        /**
         * Return a cache key that includes GeoJSON source identity and tile coordinates.
         *
         * @param {number} level - Pyramid level.
         * @param {number} x - Tile column.
         * @param {number} y - Tile row.
         * @returns {string} Tile cache key.
         */
        getTileHashKey(level, x, y) {
            const sourceId = this._url || 'inline';
            return `geojson:${sourceId}:${level}:${x}:${y}`;
        }

        /**
         * Start loading or generating one GeoJSON vector tile.
         *
         * @param {OpenSeadragon.ImageJob} job - OpenSeadragon image job.
         * @returns {void}
         */
        downloadTileStart(job) {
            if (this._workerError) {
                job.fail(this._workerError);
                return;
            }

            if (!this._worker) {
                job.fail('GeoJSONTileSource: worker is not available.');
                return;
            }

            const tile = job.tile;
            if (!tile) {
                job.fail('GeoJSONTileSource: tile job is missing tile coordinates.');
                return;
            }

            // Resolve the tiled image lazily: TileSources are constructed before any
            // viewer attaches one, and setStyle needs it to force a re-decode.
            if (!this._tiledImage && tile.tiledImage) {
                this._tiledImage = tile.tiledImage;
            }

            const key = this.getTileHashKey(tile.level, tile.x, tile.y);
            const jobs = this._pending.get(key);

            if (jobs) {
                jobs.push(job);
                return;
            }

            this._pending.set(key, [ job ]);

            this._worker.postMessage({
                type: 'tile',
                key,
                level: tile.level,
                x: tile.x,
                y: tile.y
            });
        }

        /**
         * Abort a pending GeoJSON tile job.
         *
         * @param {OpenSeadragon.ImageJob} job - OpenSeadragon image job.
         * @returns {void}
         */
        downloadTileAbort(job) {
            const tile = job.tile;
            if (!tile) {
                return;
            }

            const key = this.getTileHashKey(tile.level, tile.x, tile.y);
            const jobs = this._pending.get(key);

            if (!jobs) {
                return;
            }

            const index = jobs.indexOf(job);
            if (index >= 0) {
                jobs.splice(index, 1);
            }

            if (!jobs.length) {
                this._pending.delete(key);

                // TODO: implement cooperative cancellation in the worker and add a cancel call here as a possible optimization
            }
        }

        /**
         * Return source metadata for drawers or debugging tools.
         *
         * @returns {object} Metadata object.
         */
        getMetadata() {
            return {
                type: 'geojson',
                url: this._url,
                dimensions: {
                    width: this.dimensions.x,
                    height: this.dimensions.y
                },
                tileSize: this._tileSize,
                minLevel: this.minLevel,
                maxLevel: this.maxLevel,
                bbox: this.bbox ? this.bbox.slice() : null,
                style: this.style,
                useNativeLines: this.useNativeLines,
                aggregation: this.aggregation
            };
        }

        /**
         * Compare this source with another source.
         *
         * @param {*} otherSource - Candidate source.
         * @returns {boolean} True when both sources represent the same GeoJSON input.
         */
        equals(otherSource) {
            return !!(
                otherSource &&
                otherSource instanceof $.GeoJSONTileSource &&
                otherSource._url === this._url
            );
        }

        /**
         * Release source-owned resources.
         *
         * @returns {void}
         */
        destroy() {
            this._pending.clear();

            if (this._httpBridge) {
                this._httpBridge.dispose();
                this._httpBridge = null;
            }

            if (this._worker) {
                this._worker.terminate();
                this._worker = null;
            }

            if (this._workerObjectUrl) {
                (window.URL || window.webkitURL).revokeObjectURL(this._workerObjectUrl);
                this._workerObjectUrl = null;
            }

            this._workerError = null;
        }

        /**
         * Create the GeoJSON worker from the bundled inline worker source.
         *
         * @private
         * @returns {Worker} Worker instance.
         */
        _createWorker() {
            const inline = (OpenSeadragon && OpenSeadragon.__GEOJSON_WORKER_SOURCE__);

            if (!inline) {
                throw new Error('GeoJSONTileSource: no worker source available.');
            }

            const blob = new Blob([inline], { type: 'text/javascript' });
            const URLConstructor = window.URL || window.webkitURL;

            this._workerObjectUrl = URLConstructor.createObjectURL(blob);

            return new Worker(this._workerObjectUrl);
        }

        /**
         * Send initial source configuration to the worker.
         *
         * @private
         * @returns {void}
         */
        _configureWorker() {
            this._worker.onmessage = (event) => {
                this._handleWorkerMessage(event.data || {});
            };

            this._worker.onerror = (event) => {
                this._workerError = event.message || 'GeoJSON worker failed.';
                this._failAllPending(this._workerError);
            };

            this._worker.onmessageerror = () => {
                this._workerError = 'GeoJSON worker sent an unreadable message.';
                this._failAllPending(this._workerError);
            };

            this._worker.postMessage({
                type: 'config',
                url: this._url,
                tileSize: this._tileSize,
                minLevel: this.minLevel,
                maxLevel: this.maxLevel,
                bbox: this.bbox,
                width: this.dimensions.x,
                height: this.dimensions.y,
                style: this.style,
                useNativeLines: this.useNativeLines,
                aggregation: this.aggregation,
                debug: this.debug
            });
        }

        /**
         * Replace the source style without refetching or reindexing the source.
         *
         * The worker keeps its parsed geometries and spatial index and only
         * re-meshes, so this is cheap enough to drive from a color picker. Re-posting
         * the full config would instead re-download the GeoJSON and rebuild the
         * quadtree.
         *
         * @param {GeoJSONStyleOptions} style - New style options.
         * @returns {void}
         * @throws {Error} Thrown when the style options are invalid.
         */
        setStyle(style) {
            // Normalize before touching any state so an invalid style is rejected
            // without leaving the source half-updated.
            const normalized = normalizeStyleOptions(style);

            this.style = normalized;

            if (this._worker) {
                this._worker.postMessage({ type: 'style', style: normalized });
            }

            if (this._tiledImage && typeof this._tiledImage.reset === 'function') {
                try {
                    this._tiledImage.reset();
                } catch (_) {
                    // The tiled image may already be torn down; the style still applies
                    // to tiles requested after this point.
                }
            }
        }

        /**
         * Handle one worker response.
         *
         * @private
         * @param {object} message - Worker message.
         * @returns {void}
         */
        _handleWorkerMessage(message) {
            if (message.type === 'error' && !message.key) {
                this._workerError = message.error || 'GeoJSON worker failed.';
                this._failAllPending(this._workerError);
                return;
            }

            if (message.type === 'warning') {
                // Non-fatal: the worker skipped malformed features and rendered the rest.
                $.console.warn(
                    `GeoJSONTileSource: skipped ${message.skipped} of ${message.total} malformed features.`,
                    message.samples
                );
                return;
            }

            if (!message.key) {
                return;
            }

            const jobs = this._pending.get(message.key);
            if (!jobs) {
                return;
            }

            this._pending.delete(message.key);

            if (message.ok) {
                const tile = message.data || {};

                // A suspicious tile (geometry with real coverage overlapped it yet nothing
                // meshed) is delivered as a successful but flagged tile. The flag rides into
                // the drawer, which renders it as a diagnostic region ("expected data here,
                // none produced") instead of a silent blank.
                if (message.suspicious) {
                    $.console.warn(
                        `GeoJSONTileSource: tile ${message.key} had geometry with real coverage but meshed nothing.`
                    );
                }

                for (const job of jobs) {
                    job.finish({
                        fills: (tile.fills || []).map(packMesh),
                        lines: (tile.lines || []).map(packMesh),
                        linePrimitives: (tile.linePrimitives || []).map(packMesh),
                        points: (tile.points || []).map(packMesh),
                        __suspicious: message.suspicious === true
                    }, undefined, 'vector-mesh');
                }
            } else {
                for (const job of jobs) {
                    job.fail(message.error || 'GeoJSON tile generation failed.');
                }
            }
        }

        /**
         * Fail all currently pending tile jobs.
         *
         * @private
         * @param {string} message - Error message.
         * @returns {void}
         */
        _failAllPending(message) {
            for (const jobs of this._pending.values()) {
                for (const job of jobs) {
                    job.fail(message);
                }
            }

            this._pending.clear();
        }
    };

    /**
     * Normalize a GeoJSON bbox.
     *
     * GeoJSON bbox is [minX, minY, maxX, maxY] for 2D coordinates and
     * [minX, minY, minZ, maxX, maxY, maxZ] for 3D coordinates. The renderer is
     * 2D, so z bounds are ignored.
     *
     * @param {*} bbox - Candidate GeoJSON bbox.
     * @returns {number[]} Bounds as [minX, minY, maxX, maxY].
     * @throws {Error} Thrown when bbox is not a valid GeoJSON bbox.
     */
    function normalizeGeoJSONBBox(bbox) {
        if (!Array.isArray(bbox) || !(bbox.length === 4 || bbox.length === 6) || !bbox.every(Number.isFinite)) {
            throw new Error('GeoJSONTileSource: GeoJSON bbox must be an array with 4 (or 6) finite numeric values.');
        }

        const dimensions = bbox.length / 2;
        const minX = bbox[0];
        const minY = bbox[1];
        const maxX = bbox[dimensions];
        const maxY = bbox[dimensions + 1];

        if (minX >= maxX) {
            throw new Error(`GeoJSONTileSource: GeoJSON minX must be smaller than maxX.`);
        }

        if (minY >= maxY) {
            throw new Error(`GeoJSONTileSource: GeoJSON minY must be smaller than maxY.`);
        }

        return [minX, minY, maxX, maxY];
    }

    /**
     * Return 2D dimensions represented by normalized bounds.
     *
     * @param {number[]} bbox - Bounds as [minX, minY, maxX, maxY].
     * @returns {{width: number, height: number}} Positive dimensions.
     */
    function getBBoxDimensions(bbox) {
        return {
            width: bbox[2] - bbox[0],
            height: bbox[3] - bbox[1]
        };
    }

    /**
     * Normalize style options.
     *
     * @param {*} options - Candidate style options.
     * @returns {GeoJSONStyleOptions} Normalized style options.
     * @throws {Error} Thrown when style options are invalid.
     */
    function normalizeStyleOptions(options) {
        const source = options || {};

        const normalized = {
            pointSize: (source.pointSize !== undefined && source.pointSize !== null) ? source.pointSize : 4,
            pointColor: source.pointColor || [1, 0.2, 0.2, 1],
            lineWidth: (source.lineWidth !== undefined && source.lineWidth !== null) ? source.lineWidth : 2,
            lineColor: source.lineColor || [0.2, 1, 0.2, 1],
            fillColor: source.fillColor || [0.2, 0.2, 1, 0.6],
        };

        if (!Number.isFinite(normalized.pointSize) || normalized.pointSize < 0) {
            throw new Error('GeoJSONTileSource: style.pointSize must be a non-negative finite number.');
        }

        if (!Number.isFinite(normalized.lineWidth) || normalized.lineWidth < 0) {
            throw new Error('GeoJSONTileSource: style.lineWidth must be a non-negative finite number.');
        }

        normalized.pointColor = normalizeColor(normalized.pointColor, 'GeoJSONTileSource: style.pointColor');
        normalized.lineColor = normalizeColor(normalized.lineColor, 'GeoJSONTileSource: style.lineColor');
        normalized.fillColor = normalizeColor(normalized.fillColor, 'GeoJSONTileSource: style.fillColor');

        if (source.colorProperties !== undefined && source.colorProperties !== null) {
            normalized.colorProperties = normalizeColorProperties(source.colorProperties);
        }

        if (source.classes !== undefined && source.classes !== null) {
            if (typeof source.classProperty !== 'string' || !source.classProperty) {
                throw new Error('GeoJSONTileSource: style.classes requires style.classProperty naming the feature property to key on.');
            }

            normalized.classProperty = source.classProperty;
            normalized.classes = normalizeClasses(source.classes);
        }

        if (source.colormap !== undefined && source.colormap !== null) {
            normalized.colormap = normalizeColormap(source.colormap);
        }

        return normalized;
    }

    /**
     * Normalize the ordered list of feature property paths to read a color from.
     *
     * @param {*} paths - Candidate path list.
     * @returns {string[]} Validated dotted paths.
     * @throws {Error} Thrown when the list is not an array of non-empty strings.
     */
    function normalizeColorProperties(paths) {
        if (!Array.isArray(paths) || !paths.length || !paths.every(path => typeof path === 'string' && path)) {
            throw new Error('GeoJSONTileSource: style.colorProperties must be a non-empty array of property path strings.');
        }

        return paths.slice();
    }

    /**
     * Normalize a class label to color map.
     *
     * Values are resolved to RGBA here so the worker never parses them.
     *
     * @param {*} classes - Candidate class map.
     * @returns {object} Map of class label to [r, g, b, a].
     * @throws {Error} Thrown when the map or any of its colors is invalid.
     */
    function normalizeClasses(classes) {
        if (typeof classes !== 'object' || Array.isArray(classes)) {
            throw new Error('GeoJSONTileSource: style.classes must be an object mapping class labels to colors.');
        }

        const normalized = {};

        for (const label of Object.keys(classes)) {
            const entry = classes[label];
            // Accept a bare color or a {color} object, so a class entry can grow
            // more per-class fields later without breaking callers.
            const color = (entry && typeof entry === 'object' && !Array.isArray(entry)) ? entry.color : entry;

            normalized[label] = normalizeColor(color, `GeoJSONTileSource: style.classes['${label}']`);
        }

        return normalized;
    }

    /**
     * Normalize a colormap spec, resolving a named scheme to literal stops.
     *
     * Stops are resolved here rather than in the worker because src/colormaps.js
     * attaches to the OpenSeadragon global and the worker is built standalone.
     *
     * `steps` selects how many stops to pull from a named scheme, which controls
     * ramp fidelity only. It is not a quantization count: the worker interpolates
     * continuously between stops. Producers that quantize (for example a Python
     * `round(p, 1)`) have already done so before the value reaches here.
     *
     * @param {*} spec - Candidate colormap spec.
     * @returns {object} Normalized spec with property, domain, and resolved stops.
     * @throws {Error} Thrown when the spec, scheme name, or step count is invalid.
     */
    function normalizeColormap(spec) {
        if (typeof spec !== 'object' || Array.isArray(spec)) {
            throw new Error('GeoJSONTileSource: style.colormap must be an object.');
        }

        if (typeof spec.property !== 'string' || !spec.property) {
            throw new Error('GeoJSONTileSource: style.colormap.property must name the feature property to ramp.');
        }

        const domain = spec.domain || [0, 1];

        if (!Array.isArray(domain) || domain.length !== 2 || !domain.every(Number.isFinite)) {
            throw new Error('GeoJSONTileSource: style.colormap.domain must be [min, max].');
        }

        let rawStops;

        if (spec.stops !== undefined && spec.stops !== null) {
            if (!Array.isArray(spec.stops) || spec.stops.length < 2) {
                throw new Error('GeoJSONTileSource: style.colormap.stops must be an array of at least two colors.');
            }

            rawStops = spec.stops;
        } else {
            const schemes = $.FlexRenderer && $.FlexRenderer.ColorMaps;

            if (!schemes) {
                throw new Error('GeoJSONTileSource: style.colormap.name requires src/colormaps.js to be loaded; pass explicit stops instead.');
            }

            if (typeof spec.name !== 'string' || !schemes[spec.name] || spec.name === 'defaults' || spec.name === 'schemeGroups') {
                throw new Error(`GeoJSONTileSource: unknown colormap scheme '${spec.name}'. Pass style.colormap.stops to use a custom ramp.`);
            }

            const scheme = schemes[spec.name];
            const available = Object.keys(scheme).map(Number).sort((a, b) => a - b);
            const steps = (spec.steps !== undefined && spec.steps !== null) ? spec.steps : available[available.length - 1];

            if (!scheme[steps]) {
                throw new Error(`GeoJSONTileSource: colormap '${spec.name}' has no ${steps}-step variant. Available: ${available.join(', ')}.`);
            }

            rawStops = scheme[steps];
        }

        return {
            property: spec.property,
            domain: domain,
            stops: rawStops.map((stop, index) => normalizeColor(stop, `GeoJSONTileSource: style.colormap.stops[${index}]`))
        };
    }

    /**
     * Normalize per-tile aggregation options.
     *
     * @param {*} options - Candidate aggregation options.
     * @returns {GeoJSONAggregationOptions} Normalized aggregation options.
     * @throws {Error} Thrown when aggregation options are invalid.
     */
    function normalizeAggregationOptions(options) {
        const source = options || {};

        const normalized = {
            enabled: source.enabled === true,
            threshold: (source.threshold !== undefined && source.threshold !== null) ? source.threshold : 50,
            badgeSize: (source.badgeSize !== undefined && source.badgeSize !== null) ? source.badgeSize : 56,
            badgeColor: source.badgeColor || [1, 0.65, 0.1, 0.85],
            labelColor: source.labelColor || [0, 0, 0, 1],
            labelSize: (source.labelSize !== undefined && source.labelSize !== null) ? source.labelSize : 24,
            labelStrokeWidth: (source.labelStrokeWidth !== undefined && source.labelStrokeWidth !== null) ? source.labelStrokeWidth : 3,
            maxLabelValue: (source.maxLabelValue !== undefined && source.maxLabelValue !== null) ? source.maxLabelValue : 9999
        };

        if (!Number.isFinite(normalized.threshold) || normalized.threshold < 0) {
            throw new Error('GeoJSONTileSource: aggregation.threshold must be a non-negative finite number.');
        }

        if (!Number.isFinite(normalized.badgeSize) || normalized.badgeSize < 0) {
            throw new Error('GeoJSONTileSource: aggregation.badgeSize must be a non-negative finite number.');
        }

        if (!Number.isFinite(normalized.labelSize) || normalized.labelSize < 0) {
            throw new Error('GeoJSONTileSource: aggregation.labelSize must be a non-negative finite number.');
        }

        if (!Number.isFinite(normalized.labelStrokeWidth) || normalized.labelStrokeWidth < 0) {
            throw new Error('GeoJSONTileSource: aggregation.labelStrokeWidth must be a non-negative finite number.');
        }

        if (!Number.isFinite(normalized.maxLabelValue) || normalized.maxLabelValue < 1) {
            throw new Error('GeoJSONTileSource: aggregation.maxLabelValue must be at least 1.');
        }

        normalized.badgeColor = normalizeColor(normalized.badgeColor, 'GeoJSONTileSource: aggregation.badgeColor');
        normalized.labelColor = normalizeColor(normalized.labelColor, 'GeoJSONTileSource: aggregation.labelColor');
        normalized.threshold = Math.floor(normalized.threshold);
        normalized.maxLabelValue = Math.floor(normalized.maxLabelValue);

        return normalized;
    }

    /**
     * Parse a color from any of the encodings producers commonly emit.
     *
     * Supported forms:
     *   - CSS hex string: '#rgb', '#rgba', '#rrggbb', '#rrggbbaa' (leading '#' optional)
     *   - Array of 3 or 4 finite numbers, either 0..1 floats or 0-255 components
     *   - Packed signed 32-bit ARGB integer, as written by QuPath
     *
     * Numeric arrays are ambiguous: [1, 0, 0] is valid in both scales. The rule is
     * that an array is read as 0..1 floats when every component is <= 1, and as
     * 0-255 otherwise. This keeps [0, 0, 0, 1] meaning opaque black rather than
     * near-transparent black, at the cost of making 0-255 near-black unwritable.
     * Use hex if you need it.
     *
     * Returns null rather than throwing so per-feature resolution can fall through
     * to the next precedence tier instead of failing a tile. Callers wanting a hard
     * failure should use normalizeColor.
     *
     * Mirrored in src/workers/geojson-worker.core.js, which is built standalone and
     * cannot import from here. Keep the two copies identical.
     *
     * @param {*} value - Candidate color.
     * @returns {?number[]} Color as [r, g, b, a] in 0..1, or null when unparseable.
     */
    function parseColor(value) {
        if (typeof value === 'string') {
            const hex = value.trim().replace(/^#/, '');
            const expand = hex.length === 3 || hex.length === 4
                ? hex.split('').map(c => c + c).join('')
                : hex;

            if ((expand.length !== 6 && expand.length !== 8) || !/^[0-9a-fA-F]+$/.test(expand)) {
                return null;
            }

            const parts = expand.match(/../g).map(byte => parseInt(byte, 16) / 255);
            return [parts[0], parts[1], parts[2], parts.length === 4 ? parts[3] : 1];
        }

        if (typeof value === 'number') {
            if (!Number.isFinite(value) || !Number.isInteger(value)) {
                return null;
            }

            const alphaByte = (value >>> 24) & 0xFF;
            return [
                ((value >>> 16) & 0xFF) / 255,
                ((value >>> 8) & 0xFF) / 255,
                (value & 0xFF) / 255,
                // QuPath stores RGB-only colors with a zero alpha byte; treat those as opaque.
                alphaByte === 0 ? 1 : alphaByte / 255
            ];
        }

        if (Array.isArray(value)) {
            if ((value.length !== 3 && value.length !== 4) || !value.every(Number.isFinite)) {
                return null;
            }

            const scale = value.every(component => component <= 1) ? 1 : 255;
            return [
                value[0] / scale,
                value[1] / scale,
                value[2] / scale,
                value.length === 4 ? value[3] / scale : 1
            ];
        }

        return null;
    }

    /**
     * Normalize an RGBA color, failing hard when it cannot be parsed.
     *
     * Accepts every encoding parseColor supports. Used for style-level and
     * aggregation-level colors, where a bad value is a configuration error worth
     * surfacing at construction time.
     *
     * @param {*} color - Candidate color.
     * @param {string} label - Error label.
     * @returns {number[]} Color as [r, g, b, a] in 0..1.
     * @throws {Error} Thrown when color is invalid.
     */
    function normalizeColor(color, label) {
        const parsed = parseColor(color);

        if (!parsed) {
            throw new Error(`${label} must be [r, g, b, a], a hex string, or a packed integer color.`);
        }

        return parsed;
    }

    /**
     * Resolve a GeoJSON source URL before sending it to a Blob worker.
     *
     * Relative URLs passed directly in a tile source object are resolved against
     * the document base URL. Relative URLs loaded from a metadata document are
     * resolved against that metadata document URL.
     *
     * @param {string} url - Source URL, absolute or relative.
     * @param {string} [baseUrl] - Optional metadata document URL.
     * @returns {string} Absolute URL.
     * @throws {Error} Thrown when the URL cannot be resolved.
     */
    function resolveUrl(url, baseUrl) {
        try {
            const base = baseUrl || (typeof document !== 'undefined' && document.baseURI) || (typeof window !== 'undefined' && window.location && window.location.href);
            return new URL(url, base).href;
        } catch (error) {
            throw new Error(`GeoJSONTileSource: invalid url '${url}'.`);
        }
    }

    /**
     * Convert worker-transferred mesh buffers into runtime typed arrays.
     *
     * @param {object} mesh - Worker mesh payload.
     * @returns {object} Runtime vector mesh.
     */
    function packMesh(mesh) {
        return {
            vertices: new Float32Array(mesh.vertices),
            indices: new Uint32Array(mesh.indices),
            color: mesh.color || [0, 1, 0, 1],
            parameters: mesh.parameters ? new Float32Array(mesh.parameters) : undefined,
            lineWidth: Number.isFinite(mesh.lineWidth) && mesh.lineWidth > 0 ? mesh.lineWidth : undefined
        };
    }
})(OpenSeadragon);
