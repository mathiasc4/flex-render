(function($) {
    /**
     * Supported GeoJSON coordinate interpretation modes.
     *
     * @readonly
     * @enum {string}
     */
    $.GeoJSONTileSourceProjection = Object.freeze({
        /** GeoJSON coordinates are already in OpenSeadragon image coordinates. */
        IMAGE: 'image'

        // TODO: add other projection options as necessary.
    });

    /**
     * Options used to construct a GeoJSON tile source.
     *
     * @typedef {object} GeoJSONTileSourceOptions
     * @property {string} url - Source URL used to fetch or identify the GeoJSON.
     * @property {number} width - Full-resolution overlay width in OpenSeadragon image coordinates.
     *     For pathology WSI overlays, this should match the full-resolution slide width.
     * @property {number} height - Full-resolution overlay height in OpenSeadragon image coordinates.
     *     For pathology WSI overlays, this should match the full-resolution slide height.
     * @property {number} [tileSize=512] - Logical tile size used by OpenSeadragon.
     * @property {number} [minLevel=0] - Minimum pyramid level.
     * @property {number} [maxLevel] - Maximum pyramid level. Defaults to ceil(log2(max(width, height))).
     * @property {GeoJSONTileSourceProjection} [projection=OpenSeadragon.GeoJSONTileSourceProjection.IMAGE] - Coordinate interpretation mode.
     * @property {number[]} [bounds] - Optional source coordinate bounds as [minX, minY, maxX, maxY].
     *     Defaults to [0, 0, width, height]. Provide this only when GeoJSON
     *     coordinates need to be mapped from another coordinate rectangle into the
     *     overlay coordinate space.
     * @property {object} [style] - Optional source-level style descriptor.
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
             * URL used to fetch or identify the source.
             *
             * @private
             * @type {?string}
             */
            this._url = normalized.url;

            /**
             * Coordinate interpretation mode for this source.
             *
             * @type {GeoJSONTileSourceProjection}
             */
            this.projection = normalized.projection;

            /**
             * Source coordinate bounds used to map GeoJSON coordinates into the overlay
             * image space.
             *
             * Defaults to [0, 0, width, height]. For pathology image-space annotations,
             * this should usually be omitted by the caller. Non-default bounds should be
             * used only when the GeoJSON coordinates are in a different coordinate
             * rectangle that must be mapped onto the overlay image space.
             *
             * @type {number[]}
             */
            this.bounds = normalized.bounds;

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
            const normalized = {
                url: options.url,
                width: options.width,
                height: options.height,
                tileSize: (options.tileSize !== null && options.tileSize !== undefined) ? options.tileSize : 512,
                minLevel: (options.minLevel !== null && options.minLevel !== undefined) ? options.minLevel : 0,
                maxLevel: options.maxLevel,
                projection: options.projection || $.GeoJSONTileSourceProjection.IMAGE,
                bounds: options.bounds || null,
                style: options.style || null
            };

            if (typeof normalized.url !== 'string' || !normalized.url.trim()) {
                throw new Error('GeoJSONTileSource: url is required and must be a non-empty string.');
            }

            normalized.url = resolveUrl(normalized.url);

            if (!Number.isFinite(normalized.width) || normalized.width <= 0) {
                throw new Error(
                    'GeoJSONTileSource: width must be a positive finite number. ' +
                    'For pathology WSI overlays, use the full-resolution slide width.'
                );
            }

            if (!Number.isFinite(normalized.height) || normalized.height <= 0) {
                throw new Error(
                    'GeoJSONTileSource: height must be a positive finite number. ' +
                    'For pathology WSI overlays, use the full-resolution slide height.'
                );
            }

            if (!Number.isFinite(normalized.tileSize) || normalized.tileSize <= 0) {
                throw new Error('GeoJSONTileSource: tileSize must be a positive finite number.');
            }

            if (!Number.isInteger(normalized.minLevel) || normalized.minLevel < 0) {
                throw new Error('GeoJSONTileSource: minLevel must be a non-negative integer.');
            }

            if (normalized.maxLevel === undefined || normalized.maxLevel === null) {
                normalized.maxLevel = Math.ceil(
                    Math.log2(Math.max(normalized.width, normalized.height))
                );
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

            if (normalized.bounds) {
                normalized.bounds = normalized.bounds.slice();
            } else {
                normalized.bounds = [0, 0, normalized.width, normalized.height];
            }

            if (!Array.isArray(normalized.bounds) || normalized.bounds.length !== 4) {
                throw new Error('GeoJSONTileSource: bounds must be [minX, minY, maxX, maxY].');
            }

            const [minX, minY, maxX, maxY] = normalized.bounds;

            if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
                throw new Error('GeoJSONTileSource: bounds values must be finite numbers.');
            }

            if (minX >= maxX) {
                throw new Error('GeoJSONTileSource: bounds minX must be smaller than maxX.');
            }

            if (minY >= maxY) {
                throw new Error('GeoJSONTileSource: bounds minY must be smaller than maxY.');
            }

            return normalized;
        }

        /**
         * Determine whether the supplied metadata can configure a GeoJSON tile source.
         *
         * Raw GeoJSON alone is not enough for automatic TileSource configuration,
         * because this source needs the dimensions of the destination overlay coordinate
         * space. For pathology WSI overlays, width and height must match the
         * full-resolution slide dimensions.
         *
         * Supported metadata should use the wrapper form:
         *
         * {
         *     type: 'geojson',
         *     url: 'annotations.geojson',
         *     width: slideFullResolutionWidth,
         *     height: slideFullResolutionHeight
         * }
         *
         * Raw GeoJSON is intentionally not accepted. This source requires WSI
         * image-space width and height, and GeoJSON fetching/parsing is owned by
         * the worker.
         *
         * @param {object} data - Parsed metadata or inline source object.
         * @param {string} url - Metadata URL, if available.
         * @returns {boolean} True when this source can configure the input.
         */
        supports(data, url) {
            if (!data || typeof data !== 'object') {
                return false;
            }

            if (data.type !== 'geojson') {
                return false;
            }

            if (typeof data.url !== 'string' || !data.url.trim()) {
                return false;
            }

            return Number.isFinite(data.width) && data.width > 0 && Number.isFinite(data.height) && data.height > 0;
        }

        /**
         * Convert GeoJSON metadata into constructor options.
         *
         * @param {object} data - GeoJSON TileSource wrapper options.
         * @param {string} dataUrl - URL the metadata was loaded from, if any.
         * @param {string} _postData - POST data passed during metadata loading, if any.
         * @returns {GeoJSONTileSourceOptions} Constructor options.
         */
        configure(data = {}, dataUrl, _postData) {
            return {
                url: resolveUrl(data.url, dataUrl),
                width: data.width,
                height: data.height,
                tileSize: (data.tileSize !== undefined && data.tileSize !== null) ? data.tileSize : 512,
                minLevel: (data.minLevel !== undefined && data.minLevel !== null) ? data.minLevel : 0,
                maxLevel: data.maxLevel,
                projection: data.projection || $.GeoJSONTileSourceProjection.IMAGE,
                bounds: data.bounds || null,
                style: data.style || null
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
         * GeoJSON vector tiles are transparent overlays.
         *
         * @returns {boolean} Always true.
         */
        hasTransparency() {
            return true;
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
                tileSize: this.tileSize,
                minLevel: this.minLevel,
                maxLevel: this.maxLevel,
                projection: this.projection,
                bounds: this.bounds ? this.bounds.slice() : null,
                style: this.style
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
                tileSize: this.tileSize,
                minLevel: this.minLevel,
                maxLevel: this.maxLevel,
                projection: this.projection,
                bounds: this.bounds,
                width: this.dimensions.x,
                height: this.dimensions.y,
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
            parameters: mesh.parameters ? new Float32Array(mesh.parameters) : undefined
        };
    }
})(OpenSeadragon);
