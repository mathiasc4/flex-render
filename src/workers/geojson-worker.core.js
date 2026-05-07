/**
 * GeoJSON worker for GeoJSONTileSource.
 *
 * Debug-first implementation:
 * - accepts standard GeoJSON Feature, FeatureCollection, raw Geometry, and GeometryCollection objects;
 * - explodes MultiPoint, MultiLineString, MultiPolygon, and GeometryCollection
 *   into simple Point, LineString, and Polygon records before projection;
 * - meshes Point, LineString, and Polygon exterior rings;
 * - currently ignores polygon holes during meshing;
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
    geometries: [],
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

        const data = await fetchGeoJSON(message.url);

        const rawGeometries = parseGeojson(data);

        STATE = {
            configured: true,
            configurePromise: null,
            geometries: [],
            width: (message.width !== null && message.width !== undefined) ? message.width : 1,
            height: (message.height !== null && message.height !== undefined) ? message.height : 1,
            tileSize: (message.tileSize !== null && message.tileSize !== undefined) ? message.tileSize : 512,
            minLevel: (message.minLevel !== null && message.minLevel !== undefined) ? message.minLevel : 0,
            maxLevel: (message.maxLevel !== null && message.maxLevel !== undefined) ? message.maxLevel : 0,
            projection,
            bounds,
            style: (message.style !== null && message.style !== undefined) ? message.style : {}
        };

        STATE.geometries = rawGeometries.map(projectGeometry).filter(Boolean);
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

const GEOMETRY_TYPES = new Set([
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection"
]);

/**
 * Extract simple GeoJSON geometry records from a GeoJSON object.
 *
 * The renderer only consumes simple Point, LineString, and Polygon records.
 * This reader accepts standard GeoJSON containers and explodes multi-geometries
 * into those simple records while preserving feature properties and id.
 *
 * Supported standard GeoJSON inputs:
 * - FeatureCollection
 * - Feature
 * - a simple geometry type or a GeometryCollection
 *
 * @param {object} geojson - GeoJSON object.
 * @returns {object[]} Simple feature records.
 * @throws {Error} Thrown when geojson is not a valid GeoJSON object.
 */
function parseGeojson(geojson) {
    if (!geojson || typeof geojson !== 'object' || Array.isArray(geojson)) {
        throw new Error('GeoJSON worker: root GeoJSON value must be a non-array object.');
    }

    if (geojson.type === 'FeatureCollection') {
        return parseFeatureCollection(geojson);
    }

    if (geojson.type === 'Feature') {
        return parseFeature(geojson);
    }

    if (GEOMETRY_TYPES.has(geojson.type)) {
        return parseGeometry(geojson);
    }

    throw new Error('GeoJSON worker: root GeoJSON type must be FeatureCollection, Feature, or a supported geometry type.');
}

/**
 * Parse a standard GeoJSON FeatureCollection.
 *
 * @param {object} collection - FeatureCollection object.
 * @returns {object[]} Simple feature records.
 * @throws {Error} Thrown when collection is not a valid GeoJSON FeatureCollection.
 */
function parseFeatureCollection(collection) {
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) {
        throw new Error('GeoJSON worker: FeatureCollection must be a non-array object.');
    }

    if (collection.type !== 'FeatureCollection') {
        throw new Error('GeoJSON worker: FeatureCollection.type must be "FeatureCollection".');
    }

    if (!Array.isArray(collection.features)) {
        throw new Error('GeoJSON worker: FeatureCollection.features must be an array of Feature objects.');
    }

    return collection.features.flatMap(feature => parseFeature(feature));
}

/**
 * Parse a standard GeoJSON Feature.
 *
 * @param {object} feature - Feature object.
 * @returns {object[]} Simple feature records.
 * @throws {Error} Thrown when feature is not a valid GeoJSON Feature.
 */
function parseFeature(feature) {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature)) {
        throw new Error('GeoJSON worker: Feature must be a non-array object.');
    }

    if (feature.type !== 'Feature') {
        throw new Error('GeoJSON worker: Feature.type must be "Feature".');
    }

    // the GeoJSON standard specifies properties as required,
    // but they are not strictly necessary for rendering so we will be permissive and allow them to be undefined
    if (!(feature.properties === undefined || (typeof feature.properties === 'object' && !Array.isArray(feature.properties)) || feature.properties === null)) {
        throw new Error('GeoJSON worker: Feature.properties must be an object, null, or undefined.');
    }

    if (!(feature.id === undefined || typeof feature.id === 'string' || typeof feature.id === 'number')) {
        throw new Error('GeoJSON worker: Feature.id must be a string, number, or undefined.');
    }

    return parseGeometry(feature.geometry, feature.properties, feature.id);
}

/**
 * Convert a supported standard GeoJSON geometry into internal simple feature records.
 *
 * Multi* geometries and GeometryCollection are exploded into simple records.
 * Polygon holes are preserved in the coordinate structure for now, but the
 * current mesher still consumes only the exterior ring.
 *
 * @param {object} geometry - GeoJSON geometry.
 * @param {object|null|undefined} properties - Feature properties.
 * @param {string|number|undefined} id - Feature id.
 * @returns {object[]} Internal simple feature records.
 * @throws {Error} Thrown when geometry is not a valid GeoJSON geometry object.
 */
function parseGeometry(geometry, properties = undefined, id = undefined) {
    if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) {
        throw new Error('GeoJSON worker: geometry must be a non-array GeoJSON geometry object.');
    }

    switch (geometry.type) {
        case 'Point':
            validatePointCoordinates(geometry.coordinates);
            return [ createGeometryRecord('Point', geometry.coordinates, properties, id) ];

        case 'LineString':
            validateLineStringCoordinates(geometry.coordinates);
            return [ createGeometryRecord('LineString', geometry.coordinates, properties, id) ];

        case 'Polygon':
            validatePolygonCoordinates(geometry.coordinates);
            return [ createGeometryRecord('Polygon', geometry.coordinates, properties, id) ];

        case 'MultiPoint':
            if (!Array.isArray(geometry.coordinates)) {
                throw new Error('GeoJSON worker: MultiPoint.coordinates must be an array of Point positions.');
            }

            geometry.coordinates.forEach(validatePointCoordinates);

            return geometry.coordinates.map(coordinate => createGeometryRecord('Point', coordinate, properties, id));

        case 'MultiLineString':
            if (!Array.isArray(geometry.coordinates)) {
                throw new Error('GeoJSON worker: MultiLineString.coordinates must be an array of LineString coordinate arrays.');
            }

            geometry.coordinates.forEach(validateLineStringCoordinates);

            return geometry.coordinates.map(line => createGeometryRecord('LineString', line, properties, id));

        case 'MultiPolygon':
            if (!Array.isArray(geometry.coordinates)) {
                throw new Error('GeoJSON worker: MultiPolygon.coordinates must be an array of Polygon coordinate arrays.');
            }

            geometry.coordinates.forEach(validatePolygonCoordinates);

            return geometry.coordinates.map(polygon => createGeometryRecord('Polygon', polygon, properties, id));

        case 'GeometryCollection':
            if (!Array.isArray(geometry.geometries)) {
                throw new Error('GeoJSON worker: GeometryCollection.geometries must be an array of geometry objects.');
            }

            return geometry.geometries.flatMap(child => parseGeometry(child, properties, id));

        default:
            throw new Error('GeoJSON worker: unsupported or missing GeoJSON geometry type.');
    }
}

/**
 * Validate a GeoJSON Point coordinate array.
 *
 * A Point coordinate must be one GeoJSON position: an array of at least two
 * finite numbers. Extra dimensions are allowed by GeoJSON but are ignored by
 * the current 2D renderer.
 *
 * @param {*} coordinates - Candidate Point coordinates.
 * @returns {void}
 * @throws {Error} Thrown when coordinates are not valid GeoJSON Point coordinates.
 */
function validatePointCoordinates(coordinates) {
    if (!isPosition(coordinates)) {
        throw new Error('GeoJSON worker: Point.coordinates must be a GeoJSON position: an array of at least two finite numbers.');
    }
}

/**
 * Validate a GeoJSON LineString coordinate array.
 *
 * A LineString coordinate array must contain at least two valid GeoJSON
 * positions.
 *
 * @param {*} coordinates - Candidate LineString coordinates.
 * @returns {void}
 * @throws {Error} Thrown when coordinates are not valid GeoJSON LineString coordinates.
 */
function validateLineStringCoordinates(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(isPosition)) {
        throw new Error('GeoJSON worker: LineString.coordinates must be an array containing at least two GeoJSON positions.');
    }
}

/**
 * Validate a GeoJSON Polygon coordinate array.
 *
 * A Polygon coordinate array contains linear rings.
 *
 * @param {*} coordinates - Candidate Polygon coordinates.
 * @returns {void}
 * @throws {Error} Thrown when coordinates are not valid GeoJSON Polygon coordinates.
 */
function validatePolygonCoordinates(coordinates) {
    if (!Array.isArray(coordinates) || !coordinates.every(isLinearRing)) {
        throw new Error('GeoJSON worker: Polygon.coordinates must be an array.');
    }
}


/**
 * Test whether a value is a valid GeoJSON linear ring.
 *
 * A linear ring is an array of at least four positions whose first and last
 * positions are equivalent. This check compares only x/y values because the
 * current renderer is 2D.
 *
 * @param {*} coordinates - Candidate linear-ring coordinates.
 * @returns {boolean} True when coordinates form a valid linear ring.
 */
function isLinearRing(coordinates) {
    if (Array.isArray(coordinates) && coordinates.length >= 4 && coordinates.every(isPosition)) {
        const first = coordinates[0];
        const last = coordinates[coordinates.length - 1];

        return first[0] === last[0] && first[1] === last[1];
    }

    return false;
}

/**
 * Test whether a value is a valid GeoJSON position.
 *
 * A position is an array of at least two finite numbers. The first two values
 * are interpreted as x/y by the current renderer; additional dimensions are
 * accepted but not rendered.
 *
 * @param {*} coordinate - Candidate position.
 * @returns {boolean} True when coordinate is a valid position.
 */
function isPosition(coordinate) {
    return Array.isArray(coordinate) && coordinate.length >= 2 && coordinate.every(Number.isFinite);
}

/**
 * Create one simple internal geometry record.
 *
 * @param {'Point'|'LineString'|'Polygon'} type - Simple geometry type.
 * @param {*} coordinates - Geometry coordinates.
 * @param {object|null|undefined} properties - Feature properties.
 * @param {string|number|undefined} id - Feature id.
 * @returns {object} Internal feature record.
 */
function createGeometryRecord(type, coordinates, properties, id) {
    return {
        type,
        coordinates,
        properties,
        id
    };
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
    for (const geometry of STATE.geometries) {
        if (!intersects(geometry.bbox, tileBounds)) {
            continue;
        }

        let mesh = null;

        if (geometry.type === 'Point') {
            mesh = makePointMesh(geometry.coordinates, tile, tileDepth);
            if (mesh) {
                points.push(mesh);
            }
        } else if (geometry.type === 'LineString') {
            mesh = makeLineMesh(geometry.coordinates, tile, tileDepth);
            if (mesh) {
                lines.push(mesh);
            }
        } else if (geometry.type === 'Polygon') {
            mesh = makePolygonMesh(geometry.coordinates, tile, tileDepth);
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
 * Project one raw geometry into full-resolution image coordinates.
 *
 * @param {object} feature - Raw geometry.
 * @returns {?object} Projected geometry.
 */
function projectGeometry(feature) {
    let coordinates;

    if (feature.type === 'Point') {
        if (!isCoordinate(feature.coordinates)) {
            return null;
        }

        coordinates = projectCoordinate(feature.coordinates);
    } else if (feature.type === 'LineString') {
        if (!Array.isArray(feature.coordinates)) {
            return null;
        }

        coordinates = feature.coordinates
            .filter(isCoordinate)
            .map(projectCoordinate);

        if (coordinates.length < 2) {
            return null;
        }
    } else if (feature.type === 'Polygon') {
        if (!Array.isArray(feature.coordinates)) {
            return null;
        }

        coordinates = feature.coordinates
            .filter(Array.isArray)
            .map(ring => ring
                .filter(isCoordinate)
                .map(projectCoordinate)
            )
            .filter(ring => ring.length >= 4);

        if (!coordinates.length) {
            return null;
        }
    } else {
        return null;
    }

    const bbox = computeImageBounds(coordinates);
    if (!isFiniteBounds(bbox)) {
        return null;
    }

    return {
        id: feature.id,
        properties: feature.properties,
        type: feature.type,
        coordinates,
        bbox
    };
}

/**
 * Test whether a value is a valid 2D coordinate.
 *
 * Extra coordinate dimensions are ignored.
 *
 * @param {*} coordinate - Candidate coordinate.
 * @returns {boolean} True when the value has finite x/y entries.
 */
function isCoordinate(coordinate) {
    return Array.isArray(coordinate) && coordinate.length >= 2 && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]);
}

/**
 * Test whether bounds contain finite values.
 *
 * @param {number[]} bounds - Bounds as [minX, minY, maxX, maxY].
 * @returns {boolean} True when all values are finite and ordered.
 */
function isFiniteBounds(bounds) {
    return Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite) && bounds[0] <= bounds[2] && bounds[1] <= bounds[3];
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
    // GeoJSON coordinates may contain z or other extra dimensions. Rendering is 2D.
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
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
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
