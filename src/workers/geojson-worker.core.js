/**
 * GeoJSON worker for GeoJSONTileSource.
 *
 * Debug-first implementation:
 * - supports Point, LineString, and Polygon exterior rings only;
 * - ignores Multi* geometries, GeometryCollection, and polygon holes;
 * - performs bbox filtering, not exact clipping;
 * - emits FlexDrawer-compatible vector-mesh payloads with vec4 vertices.
 *
 * Vertex format:
 *   [x, y, tileDepth, textureId]
 *
 * where x/y are normalized tile-local coordinates in [0, 1] when inside the
 * tile, tileDepth follows the MVT worker convention, and textureId is -1 for
 * non-icon geometry.
 */

let STATE = {
    configured: false,
    configurePromise: null,
    features: [],
    tileSize: 512,
    minLevel: 0,
    maxLevel: 0,
    // Currently only "image" is supported. This field is kept in the worker
    // contract so future projection modes can be added explicitly.
    projection: 'image',
    bounds: null,
    width: 1,
    height: 1,
    style: {}
};


self.onmessage = function(event) {
    const message = event.data || {};

    if (message.type === 'config') {
        STATE.configurePromise = configure(message);
        return;
    }

    if (message.type === 'tile') {
        buildTileWhenReady(message);
    }
};


/**
 * Configure the worker from the tile source.
 *
 * @param {object} message - Configuration message.
 * @returns {Promise<void>} Resolves when the source is ready.
 */
async function configure(message) {
    try {
        const data = await fetchGeoJSON(message.url);
        const rawFeatures = readSimpleFeatures(data);
        const projection = message.projection || 'image';
        const bounds = message.bounds;

        if (projection !== 'image') {
            throw new Error(
                `GeoJSON worker: unsupported projection '${projection}'. ` +
                'Only image-space coordinates are currently supported.'
            );
        }

        if (!Array.isArray(bounds) || bounds.length !== 4) {
            throw new Error('GeoJSON worker: bounds are required.');
        }

        STATE = {
            configured: true,
            configurePromise: null,
            features: [],
            width: (message.width !== null && message.width !== undefined) ? message.width : 1,
            height: (message.height !== null && message.height !== undefined) ? message.height : 1,
            tileSize: (message.tileSize !== null && message.tileSize !== undefined) ? message.tileSize : 512,
            minLevel: (message.minLevel !== null && message.minLevel !== undefined) ? message.minLevel : 0,
            maxLevel: (message.maxLevel !== null && message.maxLevel !== undefined) ? message.maxLevel : 0,
            projection,
            bounds,
            style: (message.style !== null && message.style !== undefined) ? message.style : {}
        };

        STATE.features = rawFeatures
            .map(projectFeature)
            .filter(Boolean);
    } catch (error) {
        self.postMessage({
            type: 'error',
            ok: false,
            error: error.message || String(error)
        });
    }
}

/**
 * Fetch a GeoJSON document.
 *
 * @param {string} url - GeoJSON URL.
 * @returns {Promise<object>} Parsed GeoJSON.
 */
async function fetchGeoJSON(url) {
    if (!url) {
        throw new Error('GeoJSON worker: url is required.');
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`GeoJSON worker: failed to fetch ${url}: ${response.status}`);
    }

    return response.json();
}

/**
 * Build a tile after configuration completes.
 *
 * @param {object} message - Tile request.
 * @returns {Promise<void>} Resolves after response posting.
 */
async function buildTileWhenReady(message) {
    try {
        if (STATE.configurePromise) {
            await STATE.configurePromise;
        }

        if (!STATE.configured) {
            throw new Error('GeoJSON worker: received tile request before configuration.');
        }

        buildTile(message);
    } catch (error) {
        self.postMessage({
            type: 'tile',
            key: message.key,
            ok: false,
            error: error.message || String(error)
        });
    }
}

/**
 * Build one vector-mesh tile.
 *
 * @param {object} tile - Tile request.
 * @returns {void}
 */
function buildTile(tile) {
    const tileBounds = getTileImageBounds(tile.level, tile.x, tile.y);
    const tileDepth = getTileDepth(tile.level, tile.x, tile.y);
    const fills = [];
    const lines = [];
    const points = [];
    const transfers = [];

    // TODO: Add a spatial index when feature counts become large. The current
    // implementation scans every feature for every tile and filters by bbox, which
    // is simple but O(tileCount * featureCount).
    //
    // TODO: Add geometry clipping before meshing. Right now, any feature whose bbox
    // intersects a tile is emitted into that tile in full, so large features can
    // produce tile-local coordinates outside [0, 1] and duplicate geometry across
    // many tiles.
    for (const feature of STATE.features) {
        if (!intersects(feature.bbox, tileBounds)) {
            continue;
        }

        let mesh = null;

        if (feature.type === 'Point') {
            mesh = makePointMesh(feature.coordinates, tile, tileDepth);
            if (mesh) {
                points.push(mesh);
            }
        } else if (feature.type === 'LineString') {
            mesh = makeLineMesh(feature.coordinates, tile, tileDepth);
            if (mesh) {
                lines.push(mesh);
            }
        } else if (feature.type === 'Polygon') {
            mesh = makePolygonMesh(feature.coordinates, tile, tileDepth);
            if (mesh) {
                fills.push(mesh);
            }
        }

        if (mesh) {
            transfers.push(mesh.vertices, mesh.indices);

            if (mesh.parameters) {
                transfers.push(mesh.parameters);
            }
        }
    }

    self.postMessage({
        type: 'tile',
        key: tile.key,
        ok: true,
        data: {
            fills,
            lines,
            points
        }
    }, transfers);
}

/**
 * Extract simple GeoJSON features.
 *
 * @param {object} geojson - GeoJSON object.
 * @returns {object[]} Simple feature records.
 */
function readSimpleFeatures(geojson) {
    if (!geojson || typeof geojson !== 'object') {
        throw new Error('GeoJSON worker: invalid GeoJSON object.');
    }

    if (geojson.type === 'FeatureCollection') {
        return (geojson.features || []).flatMap(readSimpleFeatures);
    }

    if (geojson.type === 'Feature') {
        return readGeometry(geojson.geometry, geojson.properties || {}, geojson.id);
    }

    return readGeometry(geojson, {}, undefined);
}

/**
 * Convert a supported geometry into internal feature records.
 *
 * @param {object} geometry - GeoJSON geometry.
 * @param {object} properties - Feature properties.
 * @param {string|number|undefined} id - Feature id.
 * @returns {object[]} Internal feature records.
 */
function readGeometry(geometry, properties, id) {
    if (!geometry || typeof geometry !== 'object') {
        return [];
    }

    if (
        geometry.type !== 'Point' &&
        geometry.type !== 'LineString' &&
        geometry.type !== 'Polygon'
    ) {
        return [];
    }

    return [{
        id,
        properties,
        type: geometry.type,
        coordinates: geometry.coordinates
    }];
}

/**
 * Project one raw feature into full-resolution image coordinates.
 *
 * @param {object} feature - Raw feature.
 * @returns {?object} Projected feature.
 */
function projectFeature(feature) {
    let coordinates;

    if (feature.type === 'Point') {
        coordinates = projectCoordinate(feature.coordinates);
    } else if (feature.type === 'LineString') {
        coordinates = feature.coordinates.map(projectCoordinate);
    } else if (feature.type === 'Polygon') {
        if (!feature.coordinates || !feature.coordinates[0]) {
            return null;
        }

        coordinates = [feature.coordinates[0].map(projectCoordinate)];
    } else {
        return null;
    }

    return {
        id: feature.id,
        properties: feature.properties,
        type: feature.type,
        coordinates,
        bbox: computeImageBounds(coordinates)
    };
}

/**
 * Convert one source coordinate into full-resolution image coordinates.
 *
 * The current implementation supports image-space coordinates only. With the
 * default bounds [0, 0, width, height], this preserves existing pathology
 * annotation coordinates.
 *
 * Projection is kept in STATE as part of the worker configuration contract so
 * future projection modes can be added explicitly. Do not add implicit behavior
 * here for unsupported projections.
 *
 * TODO: Add explicit projection handling here if future use cases need
 * longitude/latitude, Web Mercator, or other non-image coordinate systems.
 *
 * @param {number[]} coordinate - Raw source coordinate.
 * @returns {number[]} Image coordinate.
 */
function projectCoordinate(coordinate) {
    const [x, y] = coordinate;
    const [minX, minY, maxX, maxY] = STATE.bounds;

    const u = (x - minX) / (maxX - minX);
    const v = (y - minY) / (maxY - minY);

    return [
        u * STATE.width,
        v * STATE.height
    ];
}

/**
 * Compute image-space bounds for coordinates.
 *
 * @param {*} coordinates - Point, line, or polygon coordinates.
 * @returns {number[]} Bounds as [minX, minY, maxX, maxY].
 */
function computeImageBounds(coordinates) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    forEachCoordinate(coordinates, (coordinate) => {
        minX = Math.min(minX, coordinate[0]);
        minY = Math.min(minY, coordinate[1]);
        maxX = Math.max(maxX, coordinate[0]);
        maxY = Math.max(maxY, coordinate[1]);
    });

    return [minX, minY, maxX, maxY];
}

/**
 * Visit every coordinate in a supported coordinate structure.
 *
 * @param {*} coordinates - Coordinate structure.
 * @param {function(number[]): void} visitor - Coordinate visitor.
 * @returns {void}
 */
function forEachCoordinate(coordinates, visitor) {
    if (!Array.isArray(coordinates)) {
        return;
    }

    if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
        visitor(coordinates);
        return;
    }

    for (const child of coordinates) {
        forEachCoordinate(child, visitor);
    }
}

/**
 * Return one tile's full-resolution image bounds.
 *
 * Low pyramid levels and edge tiles can be smaller than tileSize in level-pixel
 * coordinates, so bounds must be derived from the actual clipped level rectangle.
 *
 * @param {number} level - OSD level.
 * @param {number} x - Tile x.
 * @param {number} y - Tile y.
 * @returns {number[]} Bounds as [minX, minY, maxX, maxY].
 */
function getTileImageBounds(level, x, y) {
    const scale = getLevelScale(level);
    const rect = getTileLevelRect(level, x, y);

    return [
        rect.left / scale,
        rect.top / scale,
        rect.right / scale,
        rect.bottom / scale
    ];
}

/**
 * Return the OpenSeadragon pyramid scale for a level.
 *
 * @param {number} level - OSD level.
 * @returns {number} Level scale.
 */
function getLevelScale(level) {
    return 1 / Math.pow(2, STATE.maxLevel - level);
}

/**
 * Return the image dimensions at one pyramid level.
 *
 * @param {number} level - OSD level.
 * @returns {number[]} Level dimensions as [width, height].
 */
function getLevelDimensions(level) {
    const scale = getLevelScale(level);

    return [
        Math.max(1, Math.ceil(STATE.width * scale)),
        Math.max(1, Math.ceil(STATE.height * scale))
    ];
}

/**
 * Return the actual tile rectangle in level-pixel coordinates.
 *
 * For low pyramid levels, the whole level image can be smaller than tileSize.
 * For edge tiles, only part of the nominal tile rectangle is inside the level.
 *
 * @param {number} level - OSD level.
 * @param {number} x - Tile x.
 * @param {number} y - Tile y.
 * @returns {{left: number, top: number, right: number, bottom: number, width: number, height: number}}
 */
function getTileLevelRect(level, x, y) {
    const [levelWidth, levelHeight] = getLevelDimensions(level);
    const left = x * STATE.tileSize;
    const top = y * STATE.tileSize;
    const right = Math.min(left + STATE.tileSize, levelWidth);
    const bottom = Math.min(top + STATE.tileSize, levelHeight);

    return {
        left,
        top,
        right,
        bottom,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
    };
}

/**
 * Return the packed tile-depth value used by the vector renderer.
 *
 * @param {number} level - OSD level.
 * @param {number} x - Tile x.
 * @param {number} y - Tile y.
 * @returns {number} Tile depth value.
 */
function getTileDepth(level, x, y) {
    return (level << 2) + (2 * (y % 2) + (x % 2)) + 1;
}

/**
 * Test whether two bounds intersect.
 *
 * @param {number[]} a - First bounds.
 * @param {number[]} b - Second bounds.
 * @returns {boolean} True when the rectangles intersect.
 */
function intersects(a, b) {
    return a[0] <= b[2] &&
        a[2] >= b[0] &&
        a[1] <= b[3] &&
        a[3] >= b[1];
}

/**
 * Convert image coordinates into normalized tile-local coordinates.
 *
 * @param {number[]} coordinate - Image coordinate.
 * @param {object} tile - Tile request.
 * @returns {number[]} Tile-local coordinate normalized to the actual tile rectangle.
 */
function imageToTileUv(coordinate, tile) {
    const scale = getLevelScale(tile.level);
    const rect = getTileLevelRect(tile.level, tile.x, tile.y);
    const levelX = coordinate[0] * scale;
    const levelY = coordinate[1] * scale;
    const localX = levelX - rect.left;
    const localY = levelY - rect.top;

    return [
        localX / rect.width,
        localY / rect.height
    ];
}

/**
 * Convert a level-pixel size to normalized tile-local units.
 *
 * Mesh coordinates are emitted in normalized tile-local coordinates, where 1.0
 * equals the actual tile width or height at the requested level.
 *
 * @param {number} size - Size in level pixels.
 * @param {object} tile - Tile request.
 * @returns {number} Size in normalized tile-local units.
 */
function tilePixelSizeToUv(size, tile) {
    const rect = getTileLevelRect(tile.level, tile.x, tile.y);
    const denominator = Math.max(rect.width, rect.height);

    return size / denominator;
}

/**
 * Create a square point marker mesh.
 *
 * @param {number[]} coordinate - Image coordinate.
 * @param {object} tile - Tile request.
 * @param {number} tileDepth - Packed tile-depth value.
 * @returns {?object} Mesh object.
 */
function makePointMesh(coordinate, tile, tileDepth) {
    const [x, y] = imageToTileUv(coordinate, tile);
    const size = tilePixelSizeToUv((STATE.style.pointSize !== undefined && STATE.style.pointSize !== null) ? STATE.style.pointSize : 12, tile);
    const half = size / 2;

    return makeMesh(
        [
            x - half, y - half, tileDepth, -1,
            x + half, y - half, tileDepth, -1,
            x + half, y + half, tileDepth, -1,
            x - half, y + half, tileDepth, -1
        ],
        [0, 1, 2, 0, 2, 3],
        STATE.style.pointColor || [1, 0.2, 0.1, 1]
    );
}

/**
 * Create simple rectangular segment meshes for a line.
 *
 * @param {number[][]} coordinates - Image coordinates.
 * @param {object} tile - Tile request.
 * @param {number} tileDepth - Packed tile-depth value.
 * @returns {?object} Mesh object.
 */
function makeLineMesh(coordinates, tile, tileDepth) {
    if (!coordinates || coordinates.length < 2) {
        return null;
    }

    const vertices = [];
    const indices = [];
    const width = tilePixelSizeToUv((STATE.style.lineWidth !== undefined && STATE.style.lineWidth !== null) ? STATE.style.lineWidth : 4, tile);
    const half = width / 2;

    for (let i = 0; i < coordinates.length - 1; i++) {
        const p0 = imageToTileUv(coordinates[i], tile);
        const p1 = imageToTileUv(coordinates[i + 1], tile);
        const dx = p1[0] - p0[0];
        const dy = p1[1] - p0[1];
        const length = Math.sqrt(dx * dx + dy * dy);

        if (!length) {
            continue;
        }

        const nx = -dy / length * half;
        const ny = dx / length * half;
        const base = vertices.length / 4;

        vertices.push(
            p0[0] - nx, p0[1] - ny, tileDepth, -1,
            p0[0] + nx, p0[1] + ny, tileDepth, -1,
            p1[0] + nx, p1[1] + ny, tileDepth, -1,
            p1[0] - nx, p1[1] - ny, tileDepth, -1
        );

        indices.push(
            base, base + 1, base + 2,
            base, base + 2, base + 3
        );
    }

    if (!indices.length) {
        return null;
    }

    return makeMesh(vertices, indices, STATE.style.lineColor || [0.1, 0.45, 1, 1]);
}

/**
 * Create a triangle-fan mesh for a simple polygon exterior ring.
 *
 * TODO: Replace this with real polygon triangulation before using this worker
 * for arbitrary pathology annotations. Triangle fans only render convex
 * polygons correctly and do not support holes.
 *
 * @param {number[][][]} coordinates - Polygon image coordinates.
 * @param {object} tile - Tile request.
 * @param {number} tileDepth - Packed tile-depth value.
 * @returns {?object} Mesh object.
 */
function makePolygonMesh(coordinates, tile, tileDepth) {
    if (!coordinates || !coordinates[0] || coordinates[0].length < 4) {
        return null;
    }

    const ring = removeClosingCoordinate(coordinates[0]);
    if (ring.length < 3) {
        return null;
    }

    const vertices = [];
    const indices = [];

    for (const coordinate of ring) {
        const point = imageToTileUv(coordinate, tile);
        vertices.push(point[0], point[1], tileDepth, -1);
    }

    for (let i = 1; i < ring.length - 1; i++) {
        indices.push(0, i, i + 1);
    }

    return makeMesh(vertices, indices, STATE.style.fillColor || [0.1, 0.8, 0.25, 0.45]);
}

/**
 * Remove duplicate closing coordinate from a polygon ring.
 *
 * @param {number[][]} ring - Polygon ring.
 * @returns {number[][]} Ring without duplicate closing coordinate.
 */
function removeClosingCoordinate(ring) {
    if (ring.length < 2) {
        return ring;
    }

    const first = ring[0];
    const last = ring[ring.length - 1];

    if (first[0] === last[0] && first[1] === last[1]) {
        return ring.slice(0, -1);
    }

    return ring;
}

/**
 * Create a vector mesh object with transferable buffers.
 *
 * @param {number[]} vertices - Flat vec4 vertex coordinates.
 * @param {number[]} indices - Triangle indices.
 * @param {number[]} color - RGBA color.
 * @returns {object} Mesh object.
 */
function makeMesh(vertices, indices, color) {
    return {
        vertices: new Float32Array(vertices).buffer,
        indices: new Uint32Array(indices).buffer,
        color
    };
}
