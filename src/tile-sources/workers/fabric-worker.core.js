// fabric-geom.worker.js  (single-rectangular-tile, unit-normalized)
/* global self */

let CONFIG = {
    width: 0,
    height: 0,
    minLevel: 0,
    maxLevel: 0,
    origin: { x: 0, y: 0 }
};

// id -> { aabb:{x,y,w,h}, meshes:{fills,lines} } ; meshes are in IMAGE space
const OBJECTS = new Map();

// Messages:
//  - { type: 'config', width, height, origin? }
//  - { type: 'addOrUpdate', id, fabric, style }
//  - { type: 'remove', id }
//  - { type: 'tiles', z, keys:[ 'z/x/y', ... ] }  -> returns same unit batch for all keys (single-tile mode)

self.onmessage = (e) => {
    const m = e.data || {};

    try {
        if (m.type === 'config') {
            if (typeof m.width === 'number') {
                CONFIG.width = m.width;
            }
            if (typeof m.height === 'number') {
                CONFIG.height = m.height;
            }
            if (m.origin) {
                CONFIG.origin = m.origin;
            }

            CONFIG.minLevel = 0;
            CONFIG.maxLevel = 0;

            self.postMessage({ type: 'config', ok: true });
            return;
        }

        if (m.type === 'addOrUpdate') {
            const id = m.id;
            const fabric = m.fabric;
            const style = m.style;

            const aabb = computeAABB(fabric);
            const meshes = toMeshes(fabric, style);

            OBJECTS.set(id, { aabb: aabb, meshes: meshes });

            self.postMessage({ type: 'ack', id: id, ok: true });
            return;
        }

        if (m.type === 'remove') {
            const id = m.id;

            OBJECTS.delete(id);

            self.postMessage({ type: 'ack', ok: true });
            return;
        }

        if (m.type === 'tiles') {
            const unit = buildUnitBatchesFromAllObjects();

            const pack = (b) => {
                if (!b) {
                    return undefined;
                }
                return {
                    vertices: b.positions.buffer,
                    colors: b.colors.buffer,
                    indices: b.indices.buffer
                };
            };

            const rec = {
                fills: pack(unit.fills),
                lines: pack(unit.lines)
            };

            const transfers = [];
            if (rec.fills) {
                transfers.push(rec.fills.vertices);
                transfers.push(rec.fills.colors);
                transfers.push(rec.fills.indices);
            }
            if (rec.lines) {
                transfers.push(rec.lines.vertices);
                transfers.push(rec.lines.colors);
                transfers.push(rec.lines.indices);
            }

            const keys = Array.isArray(m.keys) && m.keys.length > 0 ? m.keys : [ '0/0/0' ];
            const out = [];

            for (const key of keys) {
                out.push({ key: key, fills: rec.fills, lines: rec.lines });
            }

            self.postMessage({ type: 'tiles', z: 0, ok: true, tiles: out }, transfers);
            return;
        }
    } catch (err) {
        self.postMessage({ type: m.type, ok: false, error: String(err.stack || err) });
    }
};

// ---- build a single unit-UV batch from everything ----

function buildUnitBatchesFromAllObjects() {
    const fills = [];
    const lines = [];

    for (const obj of OBJECTS.values()) {
        if (obj.meshes.fills) {
            for (const m of obj.meshes.fills) {
                fills.push(normalizeMesh(m));
            }
        }
        if (obj.meshes.lines) {
            for (const m of obj.meshes.lines) {
                lines.push(normalizeMesh(m));
            }
        }
    }

    const result = {
        fills: fills.length > 0 ? makeBatch(fills) : undefined,
        lines: lines.length > 0 ? makeBatch(lines) : undefined
    };

    return result;
}

function normalizeMesh(m) {
    const W = CONFIG.width > 0 ? CONFIG.width : 1;
    const H = CONFIG.height > 0 ? CONFIG.height : 1;
    const ox = CONFIG.origin && typeof CONFIG.origin.x === 'number' ? CONFIG.origin.x : 0;
    const oy = CONFIG.origin && typeof CONFIG.origin.y === 'number' ? CONFIG.origin.y : 0;

    const src = m.vertices;
    const out = new Float32Array(src.length);

    for (let i = 0; i < src.length; i += 2) {
        out[i] = (src[i] - ox) / W;
        out[i + 1] = (src[i + 1] - oy) / H;
    }

    return {
        vertices: out,
        indices: m.indices,
        color: m.color
    };
}

// ---- meshing (image-space) ----

function toMeshes(fabric, style) {
    const colorFill = style && Array.isArray(style.fill) ? style.fill : [ 0, 0, 0, 0 ];
    const colorLine = style && Array.isArray(style.stroke) ? style.stroke : [ 0, 0, 0, 1 ];
    const widthPx = typeof style?.strokeWidth === 'number' ? style.strokeWidth : 1;

    const outF = [];
    const outL = [];

    if (fabric.type === 'rect') {
        const x = fabric.x;
        const y = fabric.y;
        const w = fabric.w;
        const h = fabric.h;

        if (colorFill[3] > 0) {
            outF.push(triRect(x, y, w, h, colorFill));
        }

        if (colorLine[3] > 0 && widthPx > 0) {
            const loop = [
                { x: x, y: y },
                { x: x + w, y: y },
                { x: x + w, y: y + h },
                { x: x, y: y + h },
                { x: x, y: y }
            ];
            const m = strokeTriangles(loop, widthPx, colorLine);
            if (m) {
                outL.push(m);
            }
        }
    } else if (fabric.type === 'ellipse') {
        const cx = fabric.cx;
        const cy = fabric.cy;
        const rx = fabric.rx;
        const ry = fabric.ry;
        const segments = typeof fabric.segments === 'number' ? fabric.segments : 64;

        const ring = [];
        for (let k = 0; k < segments; k++) {
            const t = (2 * Math.PI * k) / segments;
            ring.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
        }

        if (colorFill[3] > 0) {
            const m = triPolygon([ ring ], colorFill);
            if (m) {
                outF.push(m);
            }
        }

        if (colorLine[3] > 0 && widthPx > 0) {
            const m = strokeTriangles(ring.concat([ ring[0] ]), widthPx, colorLine);
            if (m) {
                outL.push(m);
            }
        }
    } else if (fabric.type === 'polygon') {
        const rings = normalizeRings(fabric.points);

        if (colorFill[3] > 0) {
            const m = triPolygon(rings, colorFill);
            if (m) {
                outF.push(m);
            }
        }

        if (colorLine[3] > 0 && widthPx > 0) {
            const closed = rings[0].concat([ rings[0][0] ]);
            const m = strokeTriangles(closed, widthPx, colorLine);
            if (m) {
                outL.push(m);
            }
        }
    } else if (fabric.type === 'polyline') {
        if (colorLine[3] > 0 && widthPx > 0) {
            const m = strokeTriangles(fabric.points, widthPx, colorLine);
            if (m) {
                outL.push(m);
            }
        }
    }

    return { fills: outF, lines: outL };
}

function triRect(x, y, w, h, color) {
    const vertices = new Float32Array([
        x, y,
        x + w, y,
        x + w, y + h,
        x, y + h
    ]);

    const indices = new Uint32Array([ 0, 1, 2, 0, 2, 3 ]);

    return {
        vertices: vertices,
        indices: indices,
        color: color
    };
}

function triPolygon(rings, color) {
    const flat = [];
    const holes = [];

    let len = 0;
    for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];

        if (r > 0) {
            holes.push(len);
        }

        for (const p of ring) {
            flat.push(p.x, p.y);
            len = len + 1;
        }
    }

    const idx = self.earcut ? self.earcut(flat, holes, 2) : [];

    if (!idx || idx.length === 0) {
        return null;
    }

    return {
        vertices: Float32Array.from(flat),
        indices: Uint32Array.from(idx),
        color: color
    };
}

function strokeTriangles(points, widthPx, color) {
    const stroked = strokePoly(points, widthPx);

    if (!stroked.indices || stroked.indices.length === 0) {
        return null;
    }

    return {
        vertices: Float32Array.from(stroked.vertices),
        indices: Uint32Array.from(stroked.indices),
        color: color
    };
}

// Minimal polyline stroker (bevel joins, butt caps). Width is in IMAGE pixels.
function strokePoly(points, widthPx) {
    const half = widthPx * 0.5;

    const verts = [];
    const idx = [];

    let base = 0;

    for (let i = 1; i < points.length; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];

        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;

        const len = Math.hypot(dx, dy);
        const safeLen = len > 0 ? len : 1;

        const nx = -dy / safeLen;
        const ny = dx / safeLen;

        const v0 = [ p0.x - nx * half, p0.y - ny * half ];
        const v1 = [ p0.x + nx * half, p0.y + ny * half ];
        const v2 = [ p1.x - nx * half, p1.y - ny * half ];
        const v3 = [ p1.x + nx * half, p1.y + ny * half ];

        verts.push(v0[0], v0[1]);
        verts.push(v1[0], v1[1]);
        verts.push(v2[0], v2[1]);
        verts.push(v3[0], v3[1]);

        idx.push(base + 0, base + 1, base + 2);
        idx.push(base + 1, base + 3, base + 2);

        base = base + 4;
    }

    return { vertices: verts, indices: idx };
}

// ---- batching (same layout your renderer expects) ----

function makeBatch(meshes) {
    let vCount = 0;
    let iCount = 0;

    for (const m of meshes) {
        vCount = vCount + (m.vertices.length / 2);
        iCount = iCount + m.indices.length;
    }

    const positions = new Float32Array(vCount * 2);
    const colors = new Uint8Array(vCount * 4);
    const indices = new Uint32Array(iCount);

    let vOfs = 0;
    let iOfs = 0;
    let base = 0;

    for (const m of meshes) {
        positions.set(m.vertices, vOfs * 2);

        const r = clamp255(((m.color && m.color[0]) || 0) * 255);
        const g = clamp255(((m.color && m.color[1]) || 0) * 255);
        const b = clamp255(((m.color && m.color[2]) || 0) * 255);
        const a = clamp255(((m.color && m.color[3]) || 1) * 255);

        const localVerts = m.vertices.length / 2;

        for (let k = 0; k < localVerts; k++) {
            const c = (vOfs + k) * 4;
            colors[c] = r;
            colors[c + 1] = g;
            colors[c + 2] = b;
            colors[c + 3] = a;
        }

        for (let k = 0; k < m.indices.length; k++) {
            indices[iOfs + k] = base + m.indices[k];
        }

        base = base + localVerts;
        vOfs = vOfs + localVerts;
        iOfs = iOfs + m.indices.length;
    }

    return { positions: positions, colors: colors, indices: indices };
}

function clamp255(v) {
    const n = Math.round(v);
    if (n < 0) {
        return 0;
    }
    if (n > 255) {
        return 255;
    }
    return n;
}

// ---- utils ----

function normalizeRings(points) {
    return [ points ];
}

function computeAABB(f) {
    if (f.type === 'rect') {
        return { x: f.x, y: f.y, w: f.w, h: f.h };
    }

    if (f.type === 'ellipse') {
        return { x: f.cx - f.rx, y: f.cy - f.ry, w: 2 * f.rx, h: 2 * f.ry };
    }

    const pts = Array.isArray(f.points) ? f.points : [];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of pts) {
        if (p.x < minX) {
            minX = p.x;
        }
        if (p.y < minY) {
            minY = p.y;
        }
        if (p.x > maxX) {
            maxX = p.x;
        }
        if (p.y > maxY) {
            maxY = p.y;
        }
    }

    if (!isFinite(minX)) {
        return { x: 0, y: 0, w: 0, h: 0 };
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
