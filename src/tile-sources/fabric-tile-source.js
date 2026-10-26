// fabric-tile-source.js (single rectangular tile, unit-normalized in worker)
(function ($) {

    $.FabricTileSource = class extends $.TileSource {
        constructor(options) {
            // options: { width, height, origin?, objects, workerLibs? }
            super(options);

            this.width = options.width;
            this.height = options.height;

            // Rectangular single tile
            this.tileWidth = this.width;
            this.tileHeight = this.height;
            this.minLevel = 0;
            this.maxLevel = 0;

            this._origin = options.origin || { x: 0, y: 0 };
            this._pending = new Map();

            this._worker = makeWorker(options.workerLibs);

            this._worker.postMessage({
                type: 'config',
                width: this.width,
                height: this.height,
                origin: this._origin
            });

            if (options.objects && options.objects.length > 0) {
                let autoId = 0;
                for (const o of options.objects) {
                    const entries = normalizeToWorkerPrims(o);
                    for (const entry of entries) {
                        const id = entry.id || ('fab_' + (autoId++));
                        this._worker.postMessage({
                            type: 'addOrUpdate',
                            id: id,
                            fabric: entry.fabric,
                            style: entry.style
                        });
                    }
                }
            }

            this._worker.onmessage = (e) => {
                const msg = e.data || {};

                if (msg.type === 'tiles' && Array.isArray(msg.tiles)) {
                    for (const t of msg.tiles) {
                        this._deliverTileRecord(t);
                    }
                    return;
                }

                if (msg.key) {
                    this._deliverTileRecord(msg);
                }
            };
        }

        supports(data, url) {
            const hasObjects = data && Array.isArray(data.objects) && data.objects.length > 0;
            const okFormat = !data.format || data.format === 'fabric' || data.format === 'native';
            const looksJson = typeof url === 'string' ? url.toLowerCase().endsWith('.json') : true;

            if (hasObjects && okFormat && looksJson) {
                return true;
            }

            return false;
        }

        configure(data, dataUrl, postData) {
            const objs = Array.isArray(data.objects) ? data.objects : [];
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;

            const upd = (x, y) => {
                if (x < minX) {
                    minX = x;
                }
                if (y < minY) {
                    minY = y;
                }
                if (x > maxX) {
                    maxX = x;
                }
                if (y > maxY) {
                    maxY = y;
                }
            };

            for (const o of objs) {
                if (o.type === 'rect') {
                    upd(o.left, o.top);
                    upd(o.left + o.width, o.top + o.height);
                } else if (o.type === 'ellipse') {
                    upd(o.left - o.rx, o.top - o.ry);
                    upd(o.left + o.rx, o.top + o.ry);
                } else if ((o.type === 'polygon' || o.type === 'polyline') && Array.isArray(o.points)) {
                    for (const p of o.points) {
                        upd(p.x, p.y);
                    }
                } else if (o.type === 'path' && o.factoryID === 'multipolygon' && Array.isArray(o.points)) {
                    for (const ring of o.points) {
                        for (const p of ring) {
                            upd(p.x, p.y);
                        }
                    }
                }
            }

            if (!isFinite(minX)) {
                minX = 0;
                minY = 0;
                maxX = 1;
                maxY = 1;
            }

            const width  = data.width ? data.width : Math.ceil(maxX - minX);
            const height = data.height ? data.height : Math.ceil(maxY - minY);

            // If caller provides the full image size, anchor at (0,0) so the tile is in-view.
            // Otherwise, fall back to bbox origin.
            const origin = (data.width && data.height) ? { x: 0, y: 0 } : { x: minX, y: minY };

            return {
                width: width,
                height: height,
                origin: origin,
                // rectangular single tile
                tileWidth: width,
                tileHeight: height,
                minLevel: 0,
                maxLevel: 0,
                objects: objs,
                template: 'fabric://{z}/{x}/{y}',
                scheme: 'xyz'
            };
        }

        getTileUrl(level, x, y) {
            return 'fabric://' + level + '/' + x + '/' + y;
        }

        downloadTileStart(context) {
            const tile = context.tile;
            const level = tile.level;
            const x = tile.x;
            const y = tile.y;

            const key = this.getTileUrl(level, x, y);

            // allow multiple waiters (main viewer + navigator)
            const list = this._pending.get(key);
            if (list) {
                list.push(context);
            } else {
                this._pending.set(key, [ context ]);
            }

            this._worker.postMessage({
                type: 'tiles',
                z: 0,
                keys: [ level + '/' + x + '/' + y ]
            });
        }

        _deliverTileRecord(rec) {
            const key = rec.key ? ('fabric://' + rec.key) : null;
            if (!key) {
                return;
            }

            const waiters = this._pending.get(key);
            if (!waiters || waiters.length === 0) {
                return;
            }
            this._pending.delete(key);

            const toMeshes = (packed, defaultColor) => {
                if (!packed) {
                    return [];
                }

                const vertsBuf = packed.positions || packed.vertices;
                const idxBuf = packed.indices;

                const sourceVertices = new Float32Array(vertsBuf);
                const sourceIndices = new Uint32Array(idxBuf);

                // fabric worker emits vec2 vertices: [x, y]
                // FlexDrawer vector-mesh path expects vec4 vertices
                const vertexCount = sourceVertices.length / 2;
                const vertices = new Float32Array(vertexCount * 4);

                for (let i = 0; i < vertexCount; i++) {
                    const sourceOffset = i * 2;
                    const targetOffset = i * 4;

                    vertices[targetOffset + 0] = sourceVertices[sourceOffset + 0];
                    vertices[targetOffset + 1] = sourceVertices[sourceOffset + 1];
                    vertices[targetOffset + 2] = 0;
                    vertices[targetOffset + 3] = -1;
                }

                return [{
                    vertices: vertices,
                    indices: sourceIndices,
                    color: Array.isArray(defaultColor) ? defaultColor : [ 1, 1, 1, 1 ]
                }];
            };

            if (rec.error) {
                for (const p of waiters) {
                    p.fail(rec.error || 'Worker failed');
                }
                return;
            }

            const fills = toMeshes(rec.fills, [ 1, 0, 0, 1 ]);
            const lines = toMeshes(rec.lines, [ 0, 0, 1, 1 ]);
            for (const p of waiters) {
                p.finish({ fills: fills, lines: lines }, undefined, 'vector-mesh');
            }
        }
    };

    // ---------- Helpers ----------

    function makeWorker() {
        const inline = OpenSeadragon && OpenSeadragon.__FABRIC_WORKER_SOURCE__;

        if (inline) {
            const blob = new Blob([ inline ], { type: 'text/javascript' });
            const url = (window.URL || window.webkitURL).createObjectURL(blob);
            return new Worker(url);
        }

        throw new Error('No FABRIC worker source available');
    }

    function hexToRgba(hex, a) {
        const alpha = typeof a === 'number' ? a : 1;

        if (!hex || typeof hex !== 'string') {
            return [ 0, 0, 0, alpha ];
        }

        const s = hex.replace('#', '');

        if (s.length === 3) {
            const r = parseInt(s[0] + s[0], 16);
            const g = parseInt(s[1] + s[1], 16);
            const b = parseInt(s[2] + s[2], 16);
            return [ r / 255, g / 255, b / 255, alpha ];
        }

        if (s.length >= 6) {
            const r = parseInt(s.substring(0, 2), 16);
            const g = parseInt(s.substring(2, 4), 16);
            const b = parseInt(s.substring(4, 6), 16);
            return [ r / 255, g / 255, b / 255, alpha ];
        }

        return [ 0, 0, 0, alpha ];
    }

    function normalizeToWorkerPrims(obj) {
        const color = obj.color || '#ff0000';
        const fill = hexToRgba(color, 0.6);
        const stroke = hexToRgba(color, 1);

        if (obj.type === 'rect') {
            const x = obj.left;
            const y = obj.top;
            const w = obj.width;
            const h = obj.height;

            return [
                {
                    id: obj.id,
                    fabric: { type: 'rect', x: x, y: y, w: w, h: h },
                    style: { fill: fill, stroke: [ 0, 0, 0, 0 ], strokeWidth: 0 }
                }
            ];
        }

        if (obj.type === 'ellipse') {
            const cx = obj.left;
            const cy = obj.top;
            const rx = obj.rx;
            const ry = obj.ry;

            return [
                {
                    id: obj.id,
                    fabric: { type: 'ellipse', cx: cx, cy: cy, rx: rx, ry: ry, segments: 64 },
                    style: { fill: fill, stroke: [ 0, 0, 0, 0 ], strokeWidth: 0 }
                }
            ];
        }

        if (obj.type === 'polygon' && Array.isArray(obj.points)) {
            return [
                {
                    id: obj.id,
                    fabric: { type: 'polygon', points: obj.points.map((p) => { return { x: p.x, y: p.y }; }) },
                    style: { fill: fill, stroke: [ 0, 0, 0, 0 ], strokeWidth: 0 }
                }
            ];
        }

        if (obj.type === 'polyline' && Array.isArray(obj.points)) {
            return [
                {
                    id: obj.id,
                    fabric: { type: 'polyline', points: obj.points.map((p) => { return { x: p.x, y: p.y }; }) },
                    style: { stroke: stroke, strokeWidth: obj.strokeWidth || 2 }
                }
            ];
        }

        if (obj.type === 'path' && obj.factoryID === 'multipolygon' && Array.isArray(obj.points)) {
            const out = [];

            for (const ring of obj.points) {
                out.push({
                    id: undefined,
                    fabric: { type: 'polygon', points: ring.map((p) => { return { x: p.x, y: p.y }; }) },
                    style: { fill: fill, stroke: [ 0, 0, 0, 0 ], strokeWidth: 0 }
                });
            }

            return out;
        }

        return [];
    }

})(OpenSeadragon);
