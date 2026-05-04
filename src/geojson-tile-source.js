(function($) {
    /**
     * Supported GeoJSON coordinate interpretation modes.
     *
     * @readonly
     * @enum {string}
     *
     * @todo Add more projection types if necessary.
     */
    $.GeoJSONTileSourceProjection = Object.freeze({
        /** GeoJSON coordinates are WGS84 longitude/latitude. */
        EPSG4326: 'EPSG:4326',

        /** GeoJSON coordinates are Web Mercator meters. */
        EPSG3857: 'EPSG:3857',

        /** GeoJSON coordinates are already in OpenSeadragon image coordinates. */
        IMAGE: 'image'
    });

    /**
     * Options used to construct a GeoJSON tile source.
     *
     * @typedef {object} GeoJSONTileSourceOptions
     * @property {object} [data] - Parsed GeoJSON object.
     * @property {string} [url] - Source URL used to fetch or identify the GeoJSON.
     * @property {number} [tileSize=512] - Logical tile size used by OpenSeadragon.
     * @property {number} [minLevel=0] - Minimum pyramid level.
     * @property {number} [maxLevel=14] - Maximum pyramid level.
     * @property {number} [width] - Full-resolution logical source width.
     * @property {number} [height] - Full-resolution logical source height.
     * @property {number} [extent=4096] - Tile-local coordinate extent for generated vector meshes.
     * @property {number[]} [bounds] - GeoJSON bounds as [minX, minY, maxX, maxY].
     * @property {GeoJSONTileSourceProjection} [projection=OpenSeadragon.GeoJSONTileSourceProjection.EPSG4326] - Coordinate interpretation mode.
     * @property {object} [style] - Optional source-level style descriptor.
     * @property {string} [workerUrl] - Optional worker script URL.
     * @property {string} [workerSource] - Optional inline worker source.
     */

    /**
     * Tile source for GeoJSON-backed vector tiles.
     *
     * This class is intentionally only the OpenSeadragon TileSource boundary.
     * GeoJSON parsing, projection, clipping, simplification, and meshing should
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
             * Parsed GeoJSON payload, if supplied inline or through configure().
             *
             * @private
             * @type {?object}
             */
            this._data = normalized.data;

            /**
             * URL used to fetch or identify the source.
             *
             * @private
             * @type {?string}
             */
            this._url = normalized.url;

            /**
             * Tile-local coordinate extent used by the worker output.
             *
             * @type {number}
             */
            this.extent = normalized.extent;

            /**
             * Source-coordinate bounds.
             *
             * @type {number[]}
             */
            this.bounds = normalized.bounds;

            /**
             * Coordinate interpretation mode for this source.
             *
             * @type {GeoJSONTileSourceProjection}
             */
            this.projection = normalized.projection;

            /**
             * Optional source-level styling configuration.
             *
             * @type {?object}
             */
            this.style = normalized.style;

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
             * Worker construction options. Used by _createWorker().
             *
             * @private
             * @type {{workerUrl: ?string, workerSource: ?string}}
             */
            this._workerOptions = {
                workerUrl: normalized.workerUrl,
                workerSource: normalized.workerSource
            };

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
            const normalized = $.extend(true, {
                data: null,
                url: null,
                tileSize: 512,
                minLevel: 0,
                maxLevel: 14,
                width: undefined,
                height: undefined,
                extent: 4096,
                bounds: null,
                projection: $.GeoJSONTileSourceProjection.EPSG4326,
                style: null,
                workerUrl: null,
                workerSource: null
            }, options || {});

            if (!normalized.data && !normalized.url) {
                throw new Error('GeoJSONTileSource: either data or url is required.');
            }

            if (!Number.isFinite(normalized.tileSize) || normalized.tileSize <= 0) {
                throw new Error('GeoJSONTileSource: tileSize must be a positive finite number.');
            }

            if (!Number.isInteger(normalized.minLevel) || normalized.minLevel < 0) {
                throw new Error('GeoJSONTileSource: minLevel must be a non-negative integer.');
            }

            if (!Number.isInteger(normalized.maxLevel) || normalized.maxLevel < normalized.minLevel) {
                throw new Error('GeoJSONTileSource: maxLevel must be an integer greater than or equal to minLevel.');
            }

            const allowedProjections = Object.values($.GeoJSONTileSourceProjection);
            if (!allowedProjections.includes(normalized.projection)) {
                throw new Error(
                    `GeoJSONTileSource: unsupported projection '${normalized.projection}'. ` +
                    `Expected one of: ${allowedProjections.join(', ')}.`
                );
            }

            if (!normalized.bounds && normalized.data && Array.isArray(normalized.data.bbox)) {
                normalized.bounds = normalized.data.bbox.slice();
            } else if (normalized.bounds) {
                normalized.bounds = normalized.bounds.slice();
            }

            if (normalized.projection === $.GeoJSONTileSourceProjection.IMAGE) {
                if (!normalized.bounds) {
                    if (!Number.isFinite(normalized.width) || !Number.isFinite(normalized.height)) {
                        throw new Error(
                            'GeoJSONTileSource: projection "image" requires either bounds or both width and height.'
                        );
                    }

                    normalized.bounds = [0, 0, normalized.width, normalized.height];
                }

                if (!Number.isFinite(normalized.width)) {
                    normalized.width = normalized.bounds[2] - normalized.bounds[0];
                }

                if (!Number.isFinite(normalized.height)) {
                    normalized.height = normalized.bounds[3] - normalized.bounds[1];
                }
            } else {
                if (!Number.isFinite(normalized.width)) {
                    normalized.width = Math.pow(2, normalized.maxLevel) * normalized.tileSize;
                }

                if (!Number.isFinite(normalized.height)) {
                    normalized.height = Math.pow(2, normalized.maxLevel) * normalized.tileSize;
                }
            }

            if (!Number.isFinite(normalized.width) || normalized.width <= 0) {
                throw new Error('GeoJSONTileSource: width must be a positive finite number.');
            }

            if (!Number.isFinite(normalized.height) || normalized.height <= 0) {
                throw new Error('GeoJSONTileSource: height must be a positive finite number.');
            }

            if (!Number.isFinite(normalized.extent) || normalized.extent <= 0) {
                throw new Error('GeoJSONTileSource: extent must be a positive finite number.');
            }

            if (normalized.bounds !== null) {
                if (!Array.isArray(normalized.bounds) || normalized.bounds.length !== 4) {
                    throw new Error('GeoJSONTileSource: bounds must be [minX, minY, maxX, maxY].');
                }

                const [minX, minY, maxX, maxY] = normalized.bounds;

                if (
                    !Number.isFinite(minX) ||
                    !Number.isFinite(minY) ||
                    !Number.isFinite(maxX) ||
                    !Number.isFinite(maxY)
                ) {
                    throw new Error('GeoJSONTileSource: bounds values must be finite numbers.');
                }

                if (minX >= maxX) {
                    throw new Error('GeoJSONTileSource: bounds minX must be smaller than maxX.');
                }

                if (minY >= maxY) {
                    throw new Error('GeoJSONTileSource: bounds minY must be smaller than maxY.');
                }
            }

            return normalized;
        }

        /**
         * Determine whether the supplied metadata looks like GeoJSON.
         *
         * @param {object} data - Parsed metadata or inline source object.
         * @param {string} url - Metadata URL, if available.
         * @returns {boolean} True when this source can configure the input.
         */
        supports(data, url) {
            if (typeof url === 'string' && url.toLowerCase().endsWith('.geojson')) {
                return true;
            }

            if (!data || typeof data !== 'object') {
                return false;
            }

            if (data.type === 'FeatureCollection' || data.type === 'Feature') {
                return true;
            }

            if (data.type === 'geojson' && (data.data || data.url)) {
                return true;
            }

            return false;
        }

        /**
         * Convert GeoJSON metadata into constructor options.
         *
         * @param {object} data - Parsed GeoJSON or wrapper options.
         * @param {string} dataUrl - URL the metadata was loaded from, if any.
         * @param {string} postData - POST data passed during metadata loading, if any.
         * @returns {GeoJSONTileSourceOptions} Constructor options.
         */
        configure(data = {}, dataUrl, postData) {
            const wrapped = data && data.type === 'geojson';
            const geojson = wrapped ? data.data : data;

            return {
                data: geojson || null,
                url: wrapped ? data.url || dataUrl : dataUrl,
                tileSize: data.tileSize || 512,
                minLevel: data.minLevel || data.minzoom || 0,
                maxLevel: data.maxLevel || data.maxzoom || 14,
                width: data.width,
                height: data.height,
                extent: data.extent || 4096,
                bounds: data.bounds || data.bbox || (geojson && geojson.bbox) || null,
                projection: data.projection || $.GeoJSONTileSourceProjection.EPSG4326,
                style: data.style || null,
                workerUrl: data.workerUrl || null,
                workerSource: data.workerSource || null
            };
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
            const sourceId = this._url || 'inline';
            return `geojson://${sourceId}/${level}/${x}/${y}`;
        }

        /**
         * Return tile coordinates as POST-style job data.
         *
         * @param {number} level - Pyramid level.
         * @param {number} x - Tile column.
         * @param {number} y - Tile row.
         * @returns {{level: number, x: number, y: number}}
         */
        getTilePostData(level, x, y) {
            return {
                level,
                x,
                y
            };
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
         * The final implementation should call:
         *
         *     job.finish(vectorMeshPayload, undefined, 'vector-mesh');
         *
         * or:
         *
         *     job.fail(errorMessage);
         *
         * @param {OpenSeadragon.ImageJob} job - OpenSeadragon image job.
         * @returns {void}
         */
        downloadTileStart(job) {
            const tile = job.postData || this._readTileFromUrl(job.src);
            const key = this.getTileHashKey(tile.level, tile.x, tile.y);

            if (!this._pending.has(key)) {
                this._pending.set(key, []);
            }

            this._pending.get(key).push(job);

            // TODO:
            // 1. Send { type: 'tile', key, level, x, y } to the worker.
            // 2. Worker clips/project/features for this tile.
            // 3. Worker returns a normalized vector-mesh payload.
            // 4. _handleWorkerMessage(...) calls job.finish(..., 'vector-mesh').

            job.fail('GeoJSONTileSource.downloadTileStart is not implemented yet.');
        }

        /**
         * Abort a pending GeoJSON tile job.
         *
         * @param {OpenSeadragon.ImageJob} job - OpenSeadragon image job.
         * @returns {void}
         */
        downloadTileAbort(job) {
            const tile = job.postData || this._readTileFromUrl(job.src);
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

                // TODO: optionally notify worker to cancel this tile.
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
                bounds: this.bounds ? this.bounds.slice() : null,
                projection: this.projection,
                extent: this.extent,
                minLevel: this.minLevel,
                maxLevel: this.maxLevel,
                dimensions: {
                    width: this.dimensions.x,
                    height: this.dimensions.y
                }
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
                otherSource._url === this._url &&
                otherSource._data === this._data
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

            this._data = null;
        }

        /**
         * Create the GeoJSON worker.
         *
         * @private
         * @returns {?Worker} Worker instance.
         */
        _createWorker() {
            // TODO:
            // - If workerUrl is set, return new Worker(workerUrl).
            // - If workerSource is set, create a Blob URL and return a Worker.
            // - Otherwise use a bundled worker source variable, if the build adds one.
            return null;
        }

        /**
         * Send initial source configuration to the worker.
         *
         * @private
         * @returns {void}
         */
        _configureWorker() {
            if (!this._worker) {
                return;
            }

            this._worker.onmessage = (event) => {
                this._handleWorkerMessage(event.data || {});
            };

            this._worker.onerror = (event) => {
                this._failAllPending(event.message || 'GeoJSON worker failed.');
            };

            this._worker.postMessage({
                type: 'config',
                data: this._data,
                url: this._url,
                bounds: this.bounds,
                projection: this.projection,
                extent: this.extent,
                style: this.style
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
            if (!message.key) {
                return;
            }

            const jobs = this._pending.get(message.key);
            if (!jobs) {
                return;
            }

            this._pending.delete(message.key);

            for (const job of jobs) {
                if (message.ok) {
                    job.finish(message.data, undefined, 'vector-mesh');
                } else {
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

        /**
         * Read tile coordinates from this source's pseudo URL.
         *
         * @private
         * @param {string} url - Pseudo tile URL.
         * @returns {{level: number, x: number, y: number}}
         */
        _readTileFromUrl(url) {
            const parts = String(url || '').split('/');
            const y = Number.parseInt(parts.pop(), 10) || 0;
            const x = Number.parseInt(parts.pop(), 10) || 0;
            const level = Number.parseInt(parts.pop(), 10) || 0;

            return {
                level,
                x,
                y
            };
        }
    };
})(OpenSeadragon);
