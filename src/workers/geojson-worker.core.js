/**
 * GeoJSON worker for GeoJSONTileSource.
 *
 * Debug-first implementation:
 * - accepts standard GeoJSON Feature, FeatureCollection, raw Geometry, and GeometryCollection objects;
 * - explodes MultiPoint, MultiLineString, MultiPolygon, and GeometryCollection
 *   into simple Point, LineString, and Polygon records before projection;
 * - meshes Point, LineString, and Polygon geometries;
 * - triangulates Polygon rings with earcut, including holes;
 * - uses a top-level GeoJSON bbox as source bounds when provided by the tile source;
 * - performs geometry bbox filtering before exact per-tile clipping;
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
    bbox: null,
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
        if (!self.earcut) {
            throw new Error('GeoJSON worker: missing earcut library.');
        }

        const projection = message.projection || 'image';

        if (projection !== 'image') {
            throw new Error(
                `GeoJSON worker: unsupported projection '${projection}'. ` +
                'Only image-space coordinates are currently supported.'
            );
        }

        const data = await fetchGeoJSON(message.url);
        const bounds = normalizeGeoJSONBBox(message.bounds || message.bbox || data.bbox, 'GeoJSON worker: bounds');
        const bbox = data.bbox ? normalizeGeoJSONBBox(data.bbox, 'GeoJSON worker: GeoJSON bbox') : null;

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
            bbox,
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
 * Normalize a GeoJSON bbox to the 2D bounds used by the worker.
 *
 * GeoJSON bbox is [minX, minY, maxX, maxY] for 2D coordinates and
 * [minX, minY, minZ, maxX, maxY, maxZ] for 3D coordinates. The renderer is
 * 2D, so z bounds are ignored.
 *
 * @param {*} bbox - Candidate GeoJSON bbox.
 * @param {string} label - Error label used in validation messages.
 * @returns {number[]} Bounds as [minX, minY, maxX, maxY].
 * @throws {Error} Thrown when bbox cannot define positive 2D dimensions.
 */
function normalizeGeoJSONBBox(bbox, label) {
    if (!Array.isArray(bbox) || bbox.length < 4 || bbox.length % 2 !== 0 || !bbox.every(Number.isFinite)) {
        throw new Error(`${label} must be a GeoJSON bbox array with finite numeric values.`);
    }

    const dimensions = bbox.length / 2;
    const minX = bbox[0];
    const minY = bbox[1];
    const maxX = bbox[dimensions];
    const maxY = bbox[dimensions + 1];

    if (minX >= maxX) {
        throw new Error(`${label} minX must be smaller than maxX.`);
    }

    if (minY >= maxY) {
        throw new Error(`${label} minY must be smaller than maxY.`);
    }

    return [minX, minY, maxX, maxY];
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
 * @returns {object[]} Simple geometry records.
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
 * @returns {object[]} Simple geometry records.
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
 * Convert a supported standard GeoJSON geometry into internal simple geometry records.
 *
 * Multi* geometries and GeometryCollection are exploded into simple records.
 * Polygon holes are preserved in the coordinate structure for now, but the
 * current mesher still consumes only the exterior ring.
 *
 * @param {object} geometry - GeoJSON geometry.
 * @param {object|null|undefined} properties - Feature properties.
 * @param {string|number|undefined} id - Feature id.
 * @returns {object[]} Internal simple geometry records.
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
 * @returns {object} Internal geometry record.
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
 * Project one raw geometry into full-resolution image coordinates.
 *
 * @param {object} geometry - Raw geometry.
 * @returns {?object} Projected geometry.
 */
function projectGeometry(geometry) {
    let coordinates;

    switch (geometry.type) {
        case 'Point':
            coordinates = projectCoordinate(geometry.coordinates);
            break;
        case 'LineString':
            coordinates = geometry.coordinates.map(projectCoordinate);
            break;
        case 'Polygon':
            coordinates = geometry.coordinates.map(ring => ring.map(projectCoordinate));
            break;
        default:
            return null;
    }

    const bbox = computeImageBounds(coordinates);
    if (!isFiniteBounds(bbox)) {
        return null;
    }

    return {
        type: geometry.type,
        coordinates,
        bbox,
        properties: geometry.properties,
        id: geometry.id
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
 * Test whether bounds contain finite values.
 *
 * @param {number[]} bounds - Bounds as [minX, minY, maxX, maxY].
 * @returns {boolean} True when all values are finite and ordered.
 */
function isFiniteBounds(bounds) {
    return Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite) && bounds[0] <= bounds[2] && bounds[1] <= bounds[3];
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
 * Test whether an image-space point is inside image-space bounds.
 *
 * @param {number[]} point - Image-space point.
 * @param {number[]} bounds - Bounds as [minX, minY, maxX, maxY].
 * @returns {boolean} True when the point is inside or on the bounds edge.
 */
function pointInBounds(point, bounds) {
    return point[0] >= bounds[0] &&
        point[0] <= bounds[2] &&
        point[1] >= bounds[1] &&
        point[1] <= bounds[3];
}

/**
 * Clip a LineString to rectangular image-space bounds.
 *
 * Each visible segment is returned as a separate two-point LineString. This
 * avoids connecting disjoint clipped segments after clipping.
 *
 * @param {number[][]} coordinates - Image-space LineString coordinates.
 * @param {number[]} bounds - Bounds as [minX, minY, maxX, maxY].
 * @returns {number[][][]} Clipped LineString segments.
 */
function clipLineStringToBounds(coordinates, bounds) {
    const clipped = [];

    for (let i = 0; i < coordinates.length - 1; i += 1) {
        const segment = clipLineSegmentToBounds(coordinates[i], coordinates[i + 1], bounds);

        if (segment) {
            clipped.push(segment);
        }
    }

    return clipped;
}

/**
 * Clip one line segment to rectangular image-space bounds.
 *
 * Uses Liang-Barsky segment clipping.
 *
 * @param {number[]} start - Segment start point.
 * @param {number[]} end - Segment end point.
 * @param {number[]} bounds - Bounds as [minX, minY, maxX, maxY].
 * @returns {?number[][]} Clipped two-point segment, or null when outside.
 */
function clipLineSegmentToBounds(start, end, bounds) {
    const [minX, minY, maxX, maxY] = bounds;
    const x0 = start[0];
    const y0 = start[1];
    const x1 = end[0];
    const y1 = end[1];
    const dx = x1 - x0;
    const dy = y1 - y0;

    let t0 = 0;
    let t1 = 1;

    const clip = (p, q) => {
        if (p === 0) {
            return q >= 0;
        }

        const r = q / p;

        if (p < 0) {
            if (r > t1) {
                return false;
            }

            if (r > t0) {
                t0 = r;
            }
        } else {
            if (r < t0) {
                return false;
            }

            if (r < t1) {
                t1 = r;
            }
        }

        return true;
    };

    if (
        clip(-dx, x0 - minX) &&
        clip(dx, maxX - x0) &&
        clip(-dy, y0 - minY) &&
        clip(dy, maxY - y0)
    ) {
        return [
            [x0 + t0 * dx, y0 + t0 * dy],
            [x0 + t1 * dx, y0 + t1 * dy]
        ];
    }

    return null;
}

/**
 * Clip a Polygon to rectangular image-space bounds.
 *
 * The first ring is clipped as the exterior ring. Following rings are clipped
 * as hole rings and passed through to earcut.
 *
 * @param {number[][][]} coordinates - Polygon image-space coordinates.
 * @param {number[]} bounds - Bounds as [minX, minY, maxX, maxY].
 * @returns {?number[][][]} Clipped Polygon coordinates, or null when outside.
 */
function clipPolygonToBounds(coordinates, bounds) {
    if (!coordinates || coordinates.length === 0) {
        return null;
    }

    const clippedRings = [];

    for (let ringIndex = 0; ringIndex < coordinates.length; ringIndex += 1) {
        const clippedRing = clipRingToBounds(coordinates[ringIndex], bounds);

        if (clippedRing.length >= 4) {
            clippedRings.push(clippedRing);
        }
    }

    if (!clippedRings.length) {
        return null;
    }

    return clippedRings;
}

/**
 * Clip one polygon ring to rectangular image-space bounds.
 *
 * Uses Sutherland-Hodgman clipping against the four rectangle edges.
 *
 * @param {number[][]} ring - Closed polygon ring.
 * @param {number[]} bounds - Bounds as [minX, minY, maxX, maxY].
 * @returns {number[][]} Closed clipped ring, or an empty array.
 */
function clipRingToBounds(ring, bounds) {
    if (!Array.isArray(ring) || ring.length < 4) {
        return [];
    }

    const [minX, minY, maxX, maxY] = bounds;
    let output = ring.slice(0, -1);

    output = clipRingToBoundary(
        output,
        point => point[0] >= minX,
        (start, end) => intersectVertical(start, end, minX)
    );

    output = clipRingToBoundary(
        output,
        point => point[0] <= maxX,
        (start, end) => intersectVertical(start, end, maxX)
    );

    output = clipRingToBoundary(
        output,
        point => point[1] >= minY,
        (start, end) => intersectHorizontal(start, end, minY)
    );

    output = clipRingToBoundary(
        output,
        point => point[1] <= maxY,
        (start, end) => intersectHorizontal(start, end, maxY)
    );

    if (output.length < 3) {
        return [];
    }

    output.push(output[0].slice());

    return output;
}

/**
 * Clip one polygon ring against one half-plane.
 *
 * @param {number[][]} ring - Ring without duplicate closing coordinate.
 * @param {function(number[]): boolean} isInside - Boundary inclusion test.
 * @param {function(number[], number[]): number[]} intersect - Boundary intersection function.
 * @returns {number[][]} Clipped ring without duplicate closing coordinate.
 */
function clipRingToBoundary(ring, isInside, intersect) {
    if (!ring.length) {
        return [];
    }

    const clipped = [];

    for (let i = 0; i < ring.length; i += 1) {
        const current = ring[i];
        const previous = ring[(i + ring.length - 1) % ring.length];
        const currentInside = isInside(current);
        const previousInside = isInside(previous);

        if (currentInside) {
            if (!previousInside) {
                clipped.push(intersect(previous, current));
            }

            clipped.push(current);
        } else if (previousInside) {
            clipped.push(intersect(previous, current));
        }
    }

    return clipped;
}

/**
 * Intersect a segment with a vertical line.
 *
 * @param {number[]} start - Segment start.
 * @param {number[]} end - Segment end.
 * @param {number} x - Vertical line x coordinate.
 * @returns {number[]} Intersection point.
 */
function intersectVertical(start, end, x) {
    const dx = end[0] - start[0];

    if (dx === 0) {
        return [x, start[1]];
    }

    const t = (x - start[0]) / dx;

    return [
        x,
        start[1] + t * (end[1] - start[1])
    ];
}

/**
 * Intersect a segment with a horizontal line.
 *
 * @param {number[]} start - Segment start.
 * @param {number[]} end - Segment end.
 * @param {number} y - Horizontal line y coordinate.
 * @returns {number[]} Intersection point.
 */
function intersectHorizontal(start, end, y) {
    const dy = end[1] - start[1];

    if (dy === 0) {
        return [start[0], y];
    }

    const t = (y - start[1]) / dy;

    return [
        start[0] + t * (end[0] - start[0]),
        y
    ];
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

    // TODO: perf: Add a spatial index when feature counts become large.
    // The current implementation scans every feature for every tile and filters by bbox, which
    // is simple but O(tileCount * featureCount).
    //
    // Geometries are bbox-filtered first, then clipped to the current tile before meshing.
    // This prevents large geometries from being emitted into every intersecting tile in full.
    for (const geometry of STATE.geometries) {
        if (!intersects(geometry.bbox, tileBounds)) {
            continue;
        }

        if (geometry.type === 'Point') {
            if (!pointInBounds(geometry.coordinates, tileBounds)) {
                continue;
            }

            const mesh = makePointMesh(geometry.coordinates, tile, tileDepth);
            if (mesh) {
                points.push(mesh);
                transfers.push(mesh.vertices, mesh.indices);

                if (mesh.parameters) {
                    transfers.push(mesh.parameters);
                }
            }
        } else if (geometry.type === 'LineString') {
            const clippedLines = clipLineStringToBounds(geometry.coordinates, tileBounds);

            for (const clippedLine of clippedLines) {
                const mesh = makeLineMesh(clippedLine, tile, tileDepth);
                if (mesh) {
                    lines.push(mesh);
                    transfers.push(mesh.vertices, mesh.indices);

                    if (mesh.parameters) {
                        transfers.push(mesh.parameters);
                    }
                }
            }
        } else if (geometry.type === 'Polygon') {
            const clippedPolygon = clipPolygonToBounds(geometry.coordinates, tileBounds);

            if (!clippedPolygon) {
                continue;
            }

            const mesh = makePolygonMesh(clippedPolygon, tile, tileDepth);
            if (mesh) {
                fills.push(mesh);
                transfers.push(mesh.vertices, mesh.indices);

                if (mesh.parameters) {
                    transfers.push(mesh.parameters);
                }
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
 * Create a triangulated mesh for a Polygon.
 *
 * Earcut supports concave polygons and holes. The first ring is treated as the
 * exterior ring and all following rings are treated as holes, matching GeoJSON
 * Polygon coordinate structure.
 *
 * @param {number[][][]} coordinates - Polygon image coordinates.
 * @param {object} tile - Tile request.
 * @param {number} tileDepth - Packed tile-depth value.
 * @returns {?object} Mesh object.
 */
function makePolygonMesh(coordinates, tile, tileDepth) {
    if (!self.earcut) {
        throw new Error('GeoJSON worker: missing earcut library.');
    }

    if (coordinates.length === 0) {
        return null;
    }

    const flat = [];
    const holes = [];
    const vertices = [];
    let vertexCount = 0;

    for (let ringIndex = 0; ringIndex < coordinates.length; ringIndex += 1) {
        const ring = coordinates[ringIndex].slice(0, -1);

        if (ringIndex > 0) {
            holes.push(vertexCount);
        }

        for (const coordinate of ring) {
            const point = imageToTileUv(coordinate, tile);

            flat.push(point[0], point[1]);
            vertices.push(point[0], point[1], tileDepth, -1);
            vertexCount += 1;
        }
    }

    const indices = self.earcut(flat, holes, 2);

    if (!indices.length) {
        return null;
    }

    return makeMesh(vertices, indices, STATE.style.fillColor || [0.1, 0.8, 0.25, 0.45]);
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
