// libs (Pbf, vectorTile, earcut) are concatenated before this file

let EXTENT = 4096; let STYLE = {layers:{},fallback:{type:'line',color:[0,0,0,1],widthPx:1,join:'bevel',cap:'butt'}};
self.onmessage = async (e) => {
    const msg = e.data;
    try {
        if (msg.type === 'config') {
            EXTENT = msg.extent || EXTENT; STYLE = msg.style || STYLE; return;
        }
        if (msg.type === 'tile') {
            const {key, url, z, x, y} = msg;
            // lazy-load libs
            if (!self.Pbf || !self.vectorTile || !self.earcut) {
                throw new Error('Missing libs');
            }
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('HTTP '+resp.status);
            const buf = await resp.arrayBuffer();
            const vt = new self.vectorTile.VectorTile(new self.Pbf(new Uint8Array(buf)));

            const fills = [], lines = [], points = [];
            // Iterate layers
            for (const lname in vt.layers) {
                const lyr = vt.layers[lname];
                const lstyle = STYLE.layers[lname] || STYLE.fallback;
                for (let i=0;i<lyr.length;i++) {
                    const feat = lyr.feature(i);
                    const geom = feat.loadGeometry();
                    const fstyle = lstyle; // TODO: evaluate by properties/zoom if needed
                    if (feat.type === 3 && fstyle.type === 'fill') {
                        // Polygon with holes; MVT ring rule: outer CW, holes CCW (y down)
                        const polys = classifyRings(geom);
                        for (const poly of polys) {
                            const flat = []; const holes = []; let len=0;
                            for (let r=0;r<poly.length;r++) {
                                const ring = poly[r];
                                if (r>0) holes.push(len);
                                for (let k=0;k<ring.length;k++){ const p=ring[k]; flat.push(p.x, p.y); len++; }
                            }
                            const idx = self.earcut(flat, holes, 2);
                            if (idx.length) {
                                // Normalize to 0..1 UV for the renderer
                                const vert_count = flat.length / 2;
                                const verts = new Float32Array(3 * vert_count);
                                for (let v = 0; v < vert_count; v += 1) {
                                    verts[3 * v + 0] = flat[2 * v + 0] / lyr.extent;
                                    verts[3 * v + 1] = flat[2 * v + 1] / lyr.extent;
                                    verts[3 * v + 2] = z;
                                }
                                fills.push({ vertices: verts.buffer, indices: new Uint32Array(idx).buffer, color: fstyle.color });
                            }
                        }
                    }
                    if (feat.type === 2 && fstyle.type === 'line') {
                        // Build stroke triangles (bevel joins + requested caps; miter threshold)
                        const widthPx = fstyle.widthPx || 1.0;
                        const widthTile = widthPx * (lyr.extent / (512)); // heuristic: px@512 tile
                        for (let p=0;p<geom.length;p++) {
                            const pts = geom[p];
                            const mesh = strokePoly(pts, widthTile, fstyle.join||'bevel', fstyle.cap||'butt', fstyle.miterLimit||2.0);
                            if (mesh && mesh.indices.length) {
                                const vert_count = mesh.vertices.length / 2;
                                const verts = new Float32Array(3 * vert_count);
                                for (let v = 0; v < vert_count; v += 1) {
                                    verts[3 * v + 0] = mesh.vertices[2 * v + 0] / lyr.extent;
                                    verts[3 * v + 1] = mesh.vertices[2 * v + 1] / lyr.extent;
                                    verts[3 * v + 2] = z;
                                }
                                lines.push({ vertices: verts.buffer, indices: new Uint32Array(mesh.indices).buffer, color: fstyle.color });
                            }
                        }
                    }
                    if (feat.type === 1 && fstyle.type === 'point') {
                        const size = (fstyle.size || 10.0) / 2.0
                        const verts = [];
                        const idx = [0, 1, 2, 0, 2, 3];
                        for (let p = 0; p < geom.length; p++) {
                            const pts = geom[p];
                            for (let pi = 0; pi < pts.length; pi += 1) {
                                const pt = pts[pi];
                                verts.push((pt.x + size) / lyr.extent, (pt.y - size) / lyr.extent, z);
                                verts.push((pt.x - size) / lyr.extent, (pt.y - size) / lyr.extent, z);
                                verts.push((pt.x - size) / lyr.extent, (pt.y + size) / lyr.extent, z);
                                verts.push((pt.x + size) / lyr.extent, (pt.y + size) / lyr.extent, z);
                            }
                        }
                        points.push({ vertices: new Float32Array(verts).buffer, indices: new Uint32Array(idx).buffer, color: fstyle.color })
                    }
                }
            }

            // Transfer buffers
            const transfer = [];
            for (const a of fills) { transfer.push(a.vertices, a.indices); }
            for (const a of lines) { transfer.push(a.vertices, a.indices); }
            for (const a of points) { transfer.push(a.vertices, a.indices); }
            self.postMessage({ type:'tile', key, ok:true, data:{ fills, lines, points } }, transfer);
        }
    } catch (err) {
        self.postMessage({ type:'tile', key: e.data && e.data.key, ok:false, error: String(err) });
    }
};

// --- Helpers (worker) ---
function ringArea(r){ let s=0; for(let i=0;i<r.length;i++){ const p=r[i], q=r[(i+1)%r.length]; s += p.x*q.y - q.x*p.y; } return 0.5*s; }
function isOuter(r){ return ringArea(r) > 0; } // y-down: CW yields positive area
function classifyRings(rings){
    const polys=[]; let current=null;
    for (let i=0;i<rings.length;i++){
        const r=rings[i];
        if (isOuter(r)) { current && polys.push(current); current=[r]; }
        else { if (!current) { current=[r]; } else current.push(r); }
    }
    if (current) polys.push(current);
    return polys;
}

function strokePoly(points, width, join, cap, miterLimit){
    if (!points || points.length<2) return {vertices:[], indices:[]};
    const half=width/2; const V=[]; const I=[];
    let vi=0;
    function addTri(a,b,c){ I.push(a,b,c); }
    function addQuad(a,b,c,d){ I.push(a,b,c, c,b,d); }
    function add(v){ V.push(v[0],v[1]); return vi++; }
    function normal(a,b){ const dx=b.x-a.x, dy=b.y-a.y; const L=Math.hypot(dx,dy)||1; return [-dy/L, dx/L]; }
    function miter(a,b,c){ const n0=normal(a,b), n1=normal(b,c); const t=[n0[0]+n1[0], n0[1]+n1[1]]; const tl=Math.hypot(t[0],t[1]); if (tl<1e-6) return { ok:false, n:n1, ml:1e9}; const m=[t[0]/tl, t[1]/tl]; const cos= (n0[0]*n1[0]+n0[1]*n1[1]); const ml = 1/Math.max(1e-6, Math.sqrt((1+cos)/2)); return { ok:true, n:m, ml}; }

    for (let i=0;i<points.length-1;i++){
        const a=points[i], b=points[i+1];
        const n=normal(a,b);
        const off=[n[0]*half, n[1]*half];
        const aL=[a.x-off[0], a.y-off[1]], aR=[a.x+off[0], a.y+off[1]];
        const bL=[b.x-off[0], b.y-off[1]], bR=[b.x+off[0], b.y+off[1]];

        const i0=add(aL), i1=add(aR), i2=add(bL), i3=add(bR);
        addQuad(i0,i1,i2,i3);

        // Join at vertex b (if next segment exists)
        if (i < points.length-2) {
            const c=points[i+2];
            const mit=miter(a,b,c);
            if (join==='miter' && mit.ml <= (miterLimit||2)) {
                // add miter triangle to extend outer edge
                // Determine which side is outer using cross product sign
                const v0=[bL[0]-bR[0], bL[1]-bR[1]]; const outerLeft = (v0[0]*(c.y-b.y) - v0[1]*(c.x-b.x)) > 0;
                const mpt=[b.x+mit.n[0]*half/Math.max(1e-6,Math.sin(Math.acos((mit.ml*mit.ml-1)/(mit.ml*mit.ml+1)))), b.y+mit.n[1]*half/Math.max(1e-6,Math.sin(Math.acos((mit.ml*mit.ml-1)/(mit.ml*mit.ml+1))))];
                const iM=add(mpt);
                if (outerLeft) { addTri(i2,iM,i0); } else { addTri(i1,iM,i3); }
            } else if (join==='round') {
                // approximate round join with fan (8 segments)
                const segs=8; const dirA=Math.atan2(a.y-b.y, a.x-b.x)+Math.PI/2; const dirB=Math.atan2(c.y-b.y, c.x-b.x)+Math.PI/2; let start=dirA, end=dirB;
                // ensure sweep in correct direction (outer side)
                let sweep=end-start; while (sweep<=0) sweep+=Math.PI*2; if (sweep>Math.PI) { const t=start; start=end; end=t; sweep=2*Math.PI-sweep; }
                let prevIdx=add([b.x+Math.cos(start)*half, b.y+Math.sin(start)*half]);
                for (let s=1;s<=segs;s++){ const t=start + sweep*s/segs; const curIdx=add([b.x+Math.cos(t)*half, b.y+Math.sin(t)*half]); addTri(i2, prevIdx, curIdx); prevIdx=curIdx; }
            } else {
                // bevel (default): connect outer corners with a triangle; choose side by turn
                const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
                if (cross>0) { // left turn => outer on left
                    const iOuter=add([bL[0],bL[1]]); addTri(i2,iOuter,i0);
                } else {
                    const iOuter=add([bR[0],bR[1]]); addTri(i1,iOuter,i3);
                }
            }
        }

        // Caps at ends
        if (i===0) {
            if (cap==='square' || cap==='round') {
                const capOff=[-n[0]*half, -n[1]*half];
                const aL2=[aL[0]+capOff[0], aL[1]+capOff[1]]; const aR2=[aR[0]+capOff[0], aR[1]+capOff[1]];
                const j0=add(aL2), j1=add(aR2); addQuad(j0,j1,i0,i1);
            }
        }
        if (i===points.length-2) {
            if (cap==='square' || cap==='round') {
                const capOff=[n[0]*half, n[1]*half];
                const bL2=[bL[0]+capOff[0], bL[1]+capOff[1]]; const bR2=[bR[0]+capOff[0], bR[1]+capOff[1]];
                const j2=add(bL2), j3=add(bR2); addQuad(i2,i3,j2,j3);
            }
        }
    }
    return { vertices: V, indices: I };
}
