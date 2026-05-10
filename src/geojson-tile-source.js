(function($) {
    /**
     * Options controlling annotation style.
     *
     * @typedef {object} GeoJSONStyleOptions
     * @property {number} [pointSize=4] - Point size in pixels.
     * @property {number[]} [pointColor=[1, 0.2, 0.2, 1]] - Point color as [r, g, b, a].
     * @property {number} [lineWidth=2] - Line width in pixels.
     * @property {number[]} [lineColor=[0.2, 1, 0.2, 1]] - Line color as [r, g, b, a].
     * @property {number[]} [fillColor=[0.2, 0.2, 1, 0.6]] - Fill color as [r, g, b, a].
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
             * @private
             * @type {?string}
             */
            this._workerError = null;

            this._worker = this._createWorker();
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
                aggregation: normalizeAggregationOptions(options.aggregation)
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
                aggregation: this.aggregation
            });
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

                for (const job of jobs) {
                    job.finish({
                        fills: (tile.fills || []).map(packMesh),
                        lines: (tile.lines || []).map(packMesh),
                        linePrimitives: (tile.linePrimitives || []).map(packMesh),
                        points: (tile.points || []).map(packMesh)
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

        return normalized;
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
     * Normalize an RGBA color.
     *
     * @param {*} color - Candidate color.
     * @param {string} label - Error label.
     * @returns {number[]} Color as [r, g, b, a].
     * @throws {Error} Thrown when color is invalid.
     */
    function normalizeColor(color, label) {
        if (!Array.isArray(color) || color.length !== 4 || !color.every(Number.isFinite)) {
            throw new Error(`${label} must be [r, g, b, a].`);
        }

        return color;
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
