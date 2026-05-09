/**
 * GeoJSON worker for GeoJSONTileSource.
 *
 * Debug-first implementation:
 * - accepts standard GeoJSON Feature, FeatureCollection, raw Geometry, and GeometryCollection objects;
 * - explodes MultiPoint, MultiLineString, MultiPolygon, and GeometryCollection
 *   into simple Point, LineString, and Polygon records before coordinate normalization;
 * - meshes Point, LineString, and Polygon geometries;
 * - can emit LineString geometries as native gl.LINES payloads;
 * - triangulates Polygon rings with earcut, including holes;
 * - uses a top-level GeoJSON bbox as the source coordinate extent;
 * - performs geometry bbox filtering before exact per-tile clipping;
 * - optionally aggregates dense non-max-level tiles into one count badge;
 * - emits FlexDrawer-compatible vector-mesh payloads with vec4 vertices.
 *
 * Vertex format:
 *   [x, y, depth, textureId]
 *
 * where x/y are normalized tile-local coordinates in [0, 1] when inside the
 * tile, depth follows the MVT worker convention, and textureId is -1 for
 * non-textured geometry.
 */

let STATE = {
    configured: false,
    configurePromise: null,
    geometries: [],
    spatialIndex: null,
    tileSize: 512,
    minLevel: 0,
    maxLevel: 0,
    bbox: null,
    width: 1,
    height: 1,
    style: {},
    useNativeLines: false,
    aggregation: null
};


/**
 * Seven-segment glyph definitions used for aggregate tile count labels.
 *
 * @type {object}
 */
const SEVEN_SEGMENT_GLYPHS = Object.freeze({
    '0': ['top', 'upperRight', 'lowerRight', 'bottom', 'lowerLeft', 'upperLeft'],
    '1': ['upperRight', 'lowerRight'],
    '2': ['top', 'upperRight', 'middle', 'lowerLeft', 'bottom'],
    '3': ['top', 'upperRight', 'middle', 'lowerRight', 'bottom'],
    '4': ['upperLeft', 'middle', 'upperRight', 'lowerRight'],
    '5': ['top', 'upperLeft', 'middle', 'lowerRight', 'bottom'],
    '6': ['top', 'upperLeft', 'middle', 'lowerRight', 'lowerLeft', 'bottom'],
    '7': ['top', 'upperRight', 'lowerRight'],
    '8': ['top', 'upperRight', 'lowerRight', 'bottom', 'lowerLeft', 'upperLeft', 'middle'],
    '9': ['top', 'upperRight', 'lowerRight', 'bottom', 'upperLeft', 'middle'],
    '+': ['middle', 'verticalMiddle']
});


self.onmessage = function(event) {
    const message = event.data || {};

    switch (message.type) {
        case 'config':
            STATE.configurePromise = configure(message);
            break;

        case 'tile':
            buildTileWhenReady(message);
            break;

        default:
            self.postMessage({
                type: 'error',
                ok: false,
                error: `GeoJson worker: unsupported message type ${message.type}`
            });
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

        const data = await fetchGeoJSON(message.url);

        STATE = {
            configured: true,
            configurePromise: null,
            geometries: [],
            spatialIndex: null,
            bbox: message.bbox || data.bbox,
            width: message.width,
            height: message.height,
            tileSize: message.tileSize,
            minLevel: message.minLevel,
            maxLevel: message.maxLevel,
            style: message.style,
            useNativeLines: message.useNativeLines === true,
            aggregation: message.aggregation
        };

        STATE.geometries = parseGeojson(data);
        STATE.spatialIndex = createSpatialIndex(STATE.geometries);
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
 * @typedef {object} SimpleGeoJSONGeometry
 * @property {'Point'|'LineString'|'Polygon'} type - Simple geometry type.
 * @property {*} coordinates - Geometry coordinates in full-resolution image coordinates.
 * @property {number[]} bbox - The geometry's bbox in full-resolution image coordinates.
 * @property {object|null|undefined} properties - Feature properties.
 * @property {string|number|undefined} id - Feature id.
 */

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
 * @returns {SimpleGeoJSONGeometry[]} Simple geometry records.
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
 * @returns {SimpleGeoJSONGeometry[]} Simple geometry records.
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
 * @returns {SimpleGeoJSONGeometry[]} Simple feature records.
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
 * @returns {SimpleGeoJSONGeometry[]} Internal simple geometry records.
 * @throws {Error} Thrown when geometry is not a valid GeoJSON geometry object.
 */
function parseGeometry(geometry, properties = undefined, id = undefined) {
    if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) {
        throw new Error('GeoJSON worker: geometry must be a non-array GeoJSON geometry object.');
    }

    switch (geometry.type) {
        case 'Point':
            validatePointCoordinates(geometry.coordinates);
            return [ createGeometryRecord('Point', geometry.coordinates, properties, id) ].filter(Boolean);

        case 'LineString':
            validateLineStringCoordinates(geometry.coordinates);
            return [ createGeometryRecord('LineString', geometry.coordinates, properties, id) ].filter(Boolean);

        case 'Polygon':
            validatePolygonCoordinates(geometry.coordinates);
            return [ createGeometryRecord('Polygon', geometry.coordinates, properties, id) ].filter(Boolean);

        case 'MultiPoint':
            if (!Array.isArray(geometry.coordinates)) {
                throw new Error('GeoJSON worker: MultiPoint.coordinates must be an array of Point positions.');
            }

            geometry.coordinates.forEach(validatePointCoordinates);

            return geometry.coordinates.map(coordinate => createGeometryRecord('Point', coordinate, properties, id)).filter(Boolean);

        case 'MultiLineString':
            if (!Array.isArray(geometry.coordinates)) {
                throw new Error('GeoJSON worker: MultiLineString.coordinates must be an array of LineString coordinate arrays.');
            }

            geometry.coordinates.forEach(validateLineStringCoordinates);

            return geometry.coordinates.map(line => createGeometryRecord('LineString', line, properties, id)).filter(Boolean);

        case 'MultiPolygon':
            if (!Array.isArray(geometry.coordinates)) {
                throw new Error('GeoJSON worker: MultiPolygon.coordinates must be an array of Polygon coordinate arrays.');
            }

            geometry.coordinates.forEach(validatePolygonCoordinates);

            return geometry.coordinates.map(polygon => createGeometryRecord('Polygon', polygon, properties, id)).filter(Boolean);

        case 'GeometryCollection':
            if (!Array.isArray(geometry.geometries)) {
                throw new Error('GeoJSON worker: GeometryCollection.geometries must be an array of geometry objects.');
            }

            return geometry.geometries.flatMap(child => parseGeometry(child, properties, id)).filter(Boolean);

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
    if (!isCoordinates(coordinates)) {
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
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(isCoordinates)) {
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
 * Create one simple internal geometry record in full-resolution image coordinates.
 *
 * The geometry record's coordinates are projected into full-resolution image space
 * and the bbox is calculated to save on extra processing time.
 *
 * @param {'Point'|'LineString'|'Polygon'} type - Simple geometry type.
 * @param {*} coordinates - Geometry coordinates.
 * @param {object|null|undefined} properties - Feature properties.
 * @param {string|number|undefined} id - Feature id.
 * @returns {SimpleGeoJSONGeometry|null} Internal geometry record.
 */
function createGeometryRecord(type, coordinates, properties, id) {
    switch (type) {
        case 'Point':
            coordinates = projectCoordinates(coordinates);
            break;
        case 'LineString':
            coordinates = coordinates.map(projectCoordinates);
            break;
        case 'Polygon':
            coordinates = coordinates.map(ring => ring.map(projectCoordinates));
            break;
        default:
            return null;
    }

    const bbox = computeImageSpaceBbox(coordinates);

    return {
        type,
        coordinates,
        bbox,
        properties,
        id
    };
}

/**
 * Convert one source coordinates into full-resolution image coordinates.
 *
 * Source coordinates are linearly mapped from the GeoJSON bbox into the
 * tile source width and height. With bbox [0, 0, width, height], coordinates
 * are preserved. With explicit width and height, the bbox coordinates range is
 * rescaled into those destination dimensions.
 *
 * @param {number[]} coordinates - Raw source coordinates.
 * @returns {number[]} Image coordinates.
 */
function projectCoordinates(coordinates) {
    // GeoJSON coordinates may contain z or other extra dimensions. Rendering is 2D.
    const [x, y] = coordinates;
    const [minX, minY, maxX, maxY] = STATE.bbox;

    const u = (x - minX) / (maxX - minX);
    const v = (y - minY) / (maxY - minY);

    return [
        u * STATE.width,
        v * STATE.height
    ];
}

/**
 * Compute image-space bbox for coordinates.
 *
 * @param {*} coordinates - Point, line, or polygon coordinates.
 * @returns {number[]} Bbox as [minX, minY, maxX, maxY].
 */
function computeImageSpaceBbox(coordinates) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    forEachCoordinates(coordinates, (coordinate) => {
        minX = Math.min(minX, coordinate[0]);
        minY = Math.min(minY, coordinate[1]);
        maxX = Math.max(maxX, coordinate[0]);
        maxY = Math.max(maxY, coordinate[1]);
    });

    return [minX, minY, maxX, maxY];
}

/**
 * Visit every coordinates in a supported coordinates structure.
 *
 * @param {*} coordinates - Coordinates structure.
 * @param {function(number[]): void} visitor - Coordinates visitor.
 * @returns {void}
 */
function forEachCoordinates(coordinates, visitor) {
    if (!Array.isArray(coordinates)) {
        return;
    }

    if (isCoordinates(coordinates)) {
        visitor(coordinates);
        return;
    }

    for (const child of coordinates) {
        forEachCoordinates(child, visitor);
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
    if (Array.isArray(coordinates) && coordinates.length >= 4 && coordinates.every(isCoordinates)) {
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
function isCoordinates(coordinate) {
    return Array.isArray(coordinate) && coordinate.length >= 2 && coordinate.every(Number.isFinite);
}


/**
 * Minimum projected geometry count before a spatial index is built.
 *
 * Small sources are usually faster to scan directly because the quadtree has
 * build cost and adds extra traversal during tile generation.
 *
 * @type {number}
 */
const SPATIAL_INDEX_MIN_GEOMETRIES = 256;

/**
 * Maximum number of geometries stored in one quadtree node before subdivision.
 *
 * @type {number}
 */
const QUADTREE_NODE_CAPACITY = 32;

/**
 * Maximum quadtree depth.
 *
 * This prevents excessive subdivision for highly clustered or nearly identical
 * bboxes.
 *
 * @type {number}
 */
const QUADTREE_MAX_DEPTH = 16;

/**
 * @typedef {object} QuadtreeNode
 * @property {number} depth - The depth of the quadtree node.
 * @property {number[]} bounds - The bounds of the quadtree node as [minX, minY, maxX, maxY].
 * @property {SimpleGeoJSONGeometry[]} geometries - The geometries assigned to this node.
 * @property {QuadtreeNode[]|null} children - The children nodes of this node or null if it is a leaf node.
 */

/**
 * Create a static quadtree spatial index for projected geometries.
 *
 * The quadtree is built in full-resolution image coordinates. It stores
 * references to projected geometry records, not copies. Geometry insertion is
 * conservative: a geometry is pushed into a child only when its bbox is fully
 * contained by that child; otherwise it remains in the current node.
 *
 * @param {SimpleGeoJSONGeometry[]} geometries - Projected geometry records.
 * @returns {QuadtreeNode|null} Quadtree root node, or null when direct scanning is preferable.
 */
function createSpatialIndex(geometries) {
    if (!Array.isArray(geometries) || geometries.length < SPATIAL_INDEX_MIN_GEOMETRIES) {
        return null;
    }

    const root = createQuadtreeNode([0, 0, STATE.width, STATE.height], 0);

    for (const geometry of geometries) {
        insertIntoQuadtree(root, geometry);
    }

    return root;
}

/**
 * Create one quadtree node.
 *
 * @param {number[]} bounds - Node bounds as [minX, minY, maxX, maxY].
 * @param {number} depth - Node depth.
 * @returns {QuadtreeNode} Quadtree node.
 */
function createQuadtreeNode(bounds, depth) {
    return {
        bounds,
        depth,
        geometries: [],
        children: null
    };
}

/**
 * Insert one geometry into a quadtree node.
 *
 * @param {QuadtreeNode} node - Quadtree node.
 * @param {SimpleGeoJSONGeometry} geometry - Projected geometry record.
 * @returns {void}
 */
function insertIntoQuadtree(node, geometry) {
    if (node.children) {
        const child = findContainingChild(node.children, geometry.bbox);

        if (child) {
            insertIntoQuadtree(child, geometry);
            return;
        }
    }

    node.geometries.push(geometry);

    if (node.geometries.length > QUADTREE_NODE_CAPACITY && node.depth < QUADTREE_MAX_DEPTH) {
        subdivideQuadtreeNode(node);
    }
}

/**
 * Subdivide one quadtree node and move contained geometries into children.
 *
 * Geometries that do not fit completely inside a single child remain in the
 * parent node. This avoids duplicating large lines and polygons across many
 * descendants.
 *
 * @param {QuadtreeNode} node - Quadtree node.
 * @returns {void}
 */
function subdivideQuadtreeNode(node) {
    if (node.children) {
        return;
    }

    const [minX, minY, maxX, maxY] = node.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const nextDepth = node.depth + 1;

    if (midX <= minX || midX >= maxX || midY <= minY || midY >= maxY) {
        return;
    }

    node.children = [
        createQuadtreeNode([minX, minY, midX, midY], nextDepth),
        createQuadtreeNode([midX, minY, maxX, midY], nextDepth),
        createQuadtreeNode([minX, midY, midX, maxY], nextDepth),
        createQuadtreeNode([midX, midY, maxX, maxY], nextDepth)
    ];

    const remaining = [];

    for (const geometry of node.geometries) {
        const child = findContainingChild(node.children, geometry.bbox);

        if (child) {
            insertIntoQuadtree(child, geometry);
        } else {
            remaining.push(geometry);
        }
    }

    node.geometries = remaining;
}

/**
 * Return the child that fully contains a bbox.
 *
 * @param {object[]} children - Quadtree child nodes.
 * @param {number[]} bbox - Geometry bbox as [minX, minY, maxX, maxY].
 * @returns {QuadtreeNode|null} Containing child node, or null when no single child contains the bbox.
 */
function findContainingChild(children, bbox) {
    for (const child of children) {
        if (containsBounds(child.bounds, bbox)) {
            return child;
        }
    }

    return null;
}

/**
 * Test whether outer bounds fully contain inner bounds.
 *
 * @param {number[]} outer - Outer bounds as [minX, minY, maxX, maxY].
 * @param {number[]} inner - Inner bounds as [minX, minY, maxX, maxY].
 * @returns {boolean} True when inner is fully inside outer.
 */
function containsBounds(outer, inner) {
    return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

/**
 * Return candidate geometries for a tile.
 *
 * If no spatial index is available, this returns the full geometry list and
 * preserves the previous direct-scan behavior.
 *
 * @param {number[]} tileBounds - Tile image-space bounds.
 * @returns {SimpleGeoJSONGeometry[]} Candidate geometry records.
 */
function getTileCandidateGeometries(tileBounds) {
    if (!STATE.spatialIndex) {
        return STATE.geometries;
    }

    const results = [];
    queryQuadtree(STATE.spatialIndex, tileBounds, results);

    return results;
}

/**
 * Query a quadtree node for geometries whose quadtree may intersect the query.
 *
 * @param {object} quadtree - Quadtree to query.
 * @param {number[]} bbox - Query bounds as [minX, minY, maxX, maxY].
 * @param {SimpleGeoJSONGeometry[]} results - Mutable result list.
 * @returns {void}
 */
function queryQuadtree(quadtree, bbox, results) {
    if (!intersects(bbox, quadtree.bounds)) {
        return;
    }

    for (const geometry of quadtree.geometries) {
        results.push(geometry);
    }

    if (!quadtree.children) {
        return;
    }

    for (const child of quadtree.children) {
        queryQuadtree(child, bbox, results);
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
 * Return the OpenSeadragon pyramid scale for a level.
 *
 * @param {number} level - OSD level.
 * @returns {number} Level scale.
 */
function getLevelScale(level) {
    return 1 / Math.pow(2, STATE.maxLevel - level);
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
    return point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3];
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
            throw new Error('GeoJSON worker: received tile request before valid configuration.');
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
    const depth = getTileDepth(tile.level, tile.x, tile.y);

    const output = {
        fills: [],
        lines: [],
        linePrimitives: [],
        points: []
    };

    const transfers = [];

    const visibleGeometries = getVisibleTileGeometries(tileBounds);

    if (shouldAggregateTile(tile, visibleGeometries.length)) {
        buildAggregateTile(tile, depth, visibleGeometries.length, output, transfers);
    } else {
        buildGeometryTile(tile, depth, visibleGeometries, output, transfers);
    }

    self.postMessage({
        type: 'tile',
        key: tile.key,
        ok: true,
        data: output
    }, transfers);
}

/**
 * Return geometries that actually contribute to a tile.
 *
 * The candidate list comes from the quadtree when available. This function then
 * applies the same geometry-specific inclusion and clipping checks used by the
 * previous direct rendering path.
 *
 * @param {number[]} tileBounds - Tile image-space bounds.
 * @returns {object[]} Array of objects containing the full visible geometries and their clipped variants.
 */
function getVisibleTileGeometries(tileBounds) {
    const visible = [];

    // Candidate geometries are read from a static image-space quadtree when the
    // source is large enough to justify indexing. Small sources fall back to
    // direct scanning.
    //
    // The quadtree is only an acceleration structure. Each candidate is still
    // bbox-checked and then clipped/meshed by the existing geometry-specific
    // paths, preserving previous rendering behavior.
    const candidateGeometries = getTileCandidateGeometries(tileBounds);

    // Geometries are bbox-filtered first, then clipped to the current tile before meshing.
    // This prevents large geometries from being emitted into every intersecting tile in full.
    for (const geometry of candidateGeometries) {
        if (!intersects(geometry.bbox, tileBounds)) {
            continue;
        }

        if (geometry.type === 'Point') {
            if (pointInBounds(geometry.coordinates, tileBounds)) {
                visible.push({
                    geometry
                });
            }
        } else if (geometry.type === 'LineString') {
            const clippedLines = clipLineStringToBounds(geometry.coordinates, tileBounds);

            if (clippedLines.length) {
                visible.push({
                    geometry,
                    clippedLines
                });
            }
        } else if (geometry.type === 'Polygon') {
            const clippedPolygon = clipPolygonToBounds(geometry.coordinates, tileBounds);

            if (clippedPolygon) {
                visible.push({
                    geometry,
                    clippedPolygon
                });
            }
        }
    }

    return visible;
}

/**
 * Test whether a tile should be rendered as one aggregate marker.
 *
 * Aggregation is disabled at max level so the deepest available level always
 * renders the original annotation geometry.
 *
 * @param {object} tile - Tile request.
 * @param {number} count - Visible annotation count.
 * @returns {boolean} True when the tile should be aggregated.
 */
function shouldAggregateTile(tile, count) {
    return !!(STATE.aggregation && STATE.aggregation.enabled && tile.level < STATE.maxLevel && count > STATE.aggregation.threshold);
}

/**
 * Build normal annotation meshes for a tile.
 *
 * @param {object} tile - Tile request.
 * @param {number} depth - Depth value.
 * @param {object[]} visibleGeometries - Array of objects containing the full visible geometries and their clipped variants.
 * @param {object} output - Mesh output object.
 * @param {ArrayBuffer[]} transfers - Transferable buffers.
 * @returns {void}
 */
function buildGeometryTile(tile, depth, visibleGeometries, output, transfers) {
    for (const item of visibleGeometries) {
        const geometry = item.geometry;

        switch (geometry.type) {
            case 'Point': {
                const mesh = makePointMesh(geometry.coordinates, tile, depth, STATE.style.pointSize, STATE.style.pointColor);
                pushMesh(output.points, transfers, mesh);
                break;
            }

            case 'LineString': {
                const target = STATE.useNativeLines ? output.linePrimitives : output.lines;

                for (const clippedLine of item.clippedLines) {
                    const mesh = makeLineMesh(clippedLine, tile, depth, STATE.style.lineWidth, STATE.style.lineColor);
                    pushMesh(target, transfers, mesh);
                }

                break;
            }

            case 'Polygon': {
                const mesh = makePolygonMesh(item.clippedPolygon, tile, depth, STATE.style.fillColor);
                pushMesh(output.fills, transfers, mesh);
                break;
            }
        }
    }
}

/**
 * Build one aggregate badge tile.
 *
 * @param {object} tile - Tile request.
 * @param {number} depth - Depth value.
 * @param {number} count - Visible geometry count.
 * @param {object} output - Mesh output object.
 * @param {ArrayBuffer[]} transfers - Transferable buffers.
 * @returns {void}
 */
function buildAggregateTile(tile, depth, count, output, transfers) {
    const tileBounds = getTileImageBounds(tile.level, tile.x, tile.y);
    const center = [ (tileBounds[0] + tileBounds[2]) / 2, (tileBounds[1] + tileBounds[3]) / 2 ];
    const badgeMesh = makeAggregateBadgeMesh(center, tile, depth, count);

    pushMesh(output.fills, transfers, badgeMesh);

    const labelTarget = STATE.useNativeLines ? output.linePrimitives : output.lines;

    for (const labelMesh of makeAggregateLabelMeshes(center, tile, depth, count)) {
        pushMesh(labelTarget, transfers, labelMesh);
    }
}


/**
 * Create a filled octagonal aggregate badge mesh.
 *
 * @param {number[]} center - Badge center in image coordinates.
 * @param {object} tile - Tile request.
 * @param {number} depth - Depth value.
 * @returns {object} Mesh object.
 */
function makeAggregateBadgeMesh(center, tile, depth) {
    const [x, y] = imageToTileUv(center, tile);
    const rect = getTileLevelRect(tile.level, tile.x, tile.y);
    const radiusX = (STATE.aggregation.badgeSize / 2) / rect.width;
    const radiusY = (STATE.aggregation.badgeSize / 2) / rect.height;
    const vertices = [
        x, y, depth, -1
    ];
    const indices = [];
    const sides = 8;

    for (let i = 0; i < sides; i += 1) {
        const angle = -Math.PI / 2 + (i / sides) * Math.PI * 2;

        vertices.push(
            x + Math.cos(angle) * radiusX,
            y + Math.sin(angle) * radiusY,
            depth,
            -1
        );
    }

    for (let i = 1; i <= sides; i += 1) {
        indices.push(0, i, i === sides ? 1 : i + 1);
    }

    return makeMesh(vertices, indices, STATE.aggregation.badgeColor);
}

/**
 * Create line meshes for an aggregate badge count label.
 *
 * @param {number[]} center - Label center in image coordinates.
 * @param {object} tile - Tile request.
 * @param {number} depth - Depth value.
 * @param {number} count - Visible annotation count.
 * @returns {object[]} Label line meshes.
 */
function makeAggregateLabelMeshes(center, tile, depth, count) {
    const label = count > STATE.aggregation.maxLabelValue ? `${STATE.aggregation.maxLabelValue}+` : String(count);
    const scale = getLevelScale(tile.level);
    const height = STATE.aggregation.labelSize / scale;
    const width = height * 0.55;
    const gap = height * 0.22;
    const totalWidth = label.length * width + Math.max(0, label.length - 1) * gap;
    const startX = center[0] - totalWidth / 2 + width / 2;
    const meshes = [];

    for (let index = 0; index < label.length; index += 1) {
        const character = label[index];
        const glyphCenter = [
            startX + index * (width + gap),
            center[1]
        ];

        for (const segment of getGlyphSegments(character, glyphCenter, width, height)) {
            const mesh = makeLineMesh(
                segment,
                tile,
                depth,
                STATE.aggregation.labelStrokeWidth,
                STATE.aggregation.labelColor
            );

            if (mesh) {
                meshes.push(mesh);
            }
        }
    }

    return meshes;
}

/**
 * Return line segments for one seven-segment glyph.
 *
 * @param {string} character - Digit or plus sign.
 * @param {number[]} center - Glyph center in image coordinates.
 * @param {number} width - Glyph width in image coordinates.
 * @param {number} height - Glyph height in image coordinates.
 * @returns {number[][][]} Glyph line segments.
 */
function getGlyphSegments(character, center, width, height) {
    const segments = SEVEN_SEGMENT_GLYPHS[character];

    if (!segments) {
        return [];
    }

    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const midY = center[1];

    const points = {
        topLeft: [center[0] - halfWidth, center[1] - halfHeight],
        topRight: [center[0] + halfWidth, center[1] - halfHeight],
        middleLeft: [center[0] - halfWidth, midY],
        middleRight: [center[0] + halfWidth, midY],
        bottomLeft: [center[0] - halfWidth, center[1] + halfHeight],
        bottomRight: [center[0] + halfWidth, center[1] + halfHeight],
        topMiddle: [center[0], center[1] - halfHeight * 0.65],
        bottomMiddle: [center[0], center[1] + halfHeight * 0.65]
    };

    const segmentCoordinates = {
        top: [points.topLeft, points.topRight],
        upperRight: [points.topRight, points.middleRight],
        lowerRight: [points.middleRight, points.bottomRight],
        bottom: [points.bottomLeft, points.bottomRight],
        lowerLeft: [points.middleLeft, points.bottomLeft],
        upperLeft: [points.topLeft, points.middleLeft],
        middle: [points.middleLeft, points.middleRight],
        verticalMiddle: [points.topMiddle, points.bottomMiddle]
    };

    return segments.map(segment => segmentCoordinates[segment]);
}


/**
 * Create a square point marker mesh.
 *
 * @param {number[]} coordinate - Image coordinate.
 * @param {object} tile - Tile request.
 * @param {number} depth - Depth value.
 * @param {number} pointSize - Line width in level pixels.
 * @param {number[]} color - RGBA color.
 * @returns {?object} Mesh object.
 */
function makePointMesh(coordinate, tile, depth, pointSize, color) {
    const [x, y] = imageToTileUv(coordinate, tile);
    const size = tilePixelSizeToUv(pointSize, tile);
    const half = size / 2;

    return makeMesh(
        [
            x - half, y - half, depth, -1,
            x + half, y - half, depth, -1,
            x + half, y + half, depth, -1,
            x - half, y + half, depth, -1
        ],
        [0, 1, 2, 0, 2, 3],
        color
    );
}

/**
 * Create simple rectangular segment meshes for a styled line.
 *
 * @param {number[][]} coordinates - Image coordinates.
 * @param {object} tile - Tile request.
 * @param {number} depth - Depth value.
 * @param {number} lineWidth - Line width in level pixels.
 * @param {number[]} color - RGBA color.
 * @returns {?object} Mesh object.
 */
function makeLineMesh(coordinates, tile, depth, lineWidth, color) {
    if (!coordinates || coordinates.length < 2) {
        return null;
    }

    if (STATE.useNativeLines) {
        const vertices = [];
        const indices = [];

        for (let i = 0; i < coordinates.length; i++) {
            const point = imageToTileUv(coordinates[i], tile);

            vertices.push(point[0], point[1], depth, -1);

            if (i < coordinates.length - 1) {
                indices.push(i, i + 1);
            }
        }

        if (!indices.length) {
            return null;
        }

        const mesh = makeMesh(vertices, indices, color);
        mesh.lineWidth = Number.isFinite(lineWidth) && lineWidth > 0 ? lineWidth : 1;
        return mesh;
    }

    const vertices = [];
    const indices = [];
    const width = tilePixelSizeToUv(lineWidth, tile);
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
            p0[0] - nx, p0[1] - ny, depth, -1,
            p0[0] + nx, p0[1] + ny, depth, -1,
            p1[0] + nx, p1[1] + ny, depth, -1,
            p1[0] - nx, p1[1] - ny, depth, -1
        );

        indices.push(
            base, base + 1, base + 2,
            base, base + 2, base + 3
        );
    }

    if (!indices.length) {
        return null;
    }

    return makeMesh(vertices, indices, color);
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
 * @param {number} depth - Depth value.
 * @param {number[]} color - RGBA color.
 * @returns {?object} Mesh object.
 */
function makePolygonMesh(coordinates, tile, depth, color) {
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
            vertices.push(point[0], point[1], depth, -1);
            vertexCount += 1;
        }
    }

    const indices = self.earcut(flat, holes, 2);

    if (!indices.length) {
        return null;
    }

    return makeMesh(vertices, indices, color);
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

/**
 * Push a mesh and its transferable buffers into tile output arrays.
 *
 * @param {object[]} target - Mesh target array.
 * @param {ArrayBuffer[]} transfers - Transferable buffers.
 * @param {?object} mesh - Mesh to push.
 * @returns {void}
 */
function pushMesh(target, transfers, mesh) {
    if (!mesh) {
        return;
    }

    target.push(mesh);
    transfers.push(mesh.vertices, mesh.indices);
}
