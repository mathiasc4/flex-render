/* global QUnit, OpenSeadragon */

/**
 * MVT geometry is authored against the NOMINAL tile — 0..extent spans a whole
 * tileSize wherever the tile sits — but the drawer maps UV 0..1 onto
 * `Tile.positionedBounds`, which OpenSeadragon CLIPS at the level's right/bottom
 * edge. The two agree only when the world is an exact multiple of the tile size,
 * which is every square web-mercator pyramid and therefore everything the MVT
 * source had ever been pointed at. On a pathology slide it is false for the last
 * column, the last row, and every level smaller than one tile — so the mesh was
 * squeezed into the visible part of its own tile.
 *
 * `_tileUvScale` is the correction, and it is worth testing directly rather than
 * through a render: it is pure arithmetic over OSD's own `getTileBounds`, and a
 * pixel comparison would not say WHICH tile was wrong.
 *
 * Numbers below are the visualization-flexibility demo slide.
 */
(function() {
    const SLIDE_W = 105185;
    const SLIDE_H = 221772;
    const TILE = 512;
    const MAX_LEVEL = 9;

    function makeSource(width, height, maxLevel) {
        // `_isVector: false` skips the worker/HTTP pipeline — this test is about
        // the geometry, and spinning a Worker up would make it an integration test.
        return new OpenSeadragon.MVTTileSource({
            _isVector: false,
            width: width,
            height: height,
            tileSize: TILE,
            minLevel: 0,
            maxLevel: maxLevel
        });
    }

    /** What the level's pixel grid is, independently of the source's own maths. */
    function levelDims(width, height, maxLevel, level) {
        const scale = Math.pow(2, maxLevel - level);
        return { w: width / scale, h: height / scale };
    }

    /** No qunit-assert-close in this suite; the tolerance is nominal-unit-sized. */
    function close(assert, actual, expected, message) {
        assert.ok(Math.abs(actual - expected) < 1e-6,
            message + ` (got ${actual}, expected ${expected})`);
    }

    QUnit.module("MVT partial-tile UV scale");

    QUnit.test("a square world needs no correction", function(assert) {
        // 2^3 * 512 = 4096 on both axes: every tile is whole, at every level.
        const source = makeSource(4096, 4096, 3);

        for (let level = 0; level <= 3; level++) {
            const across = source.getNumTiles(level).x;
            const down = source.getNumTiles(level).y;

            for (let y = 0; y < down; y++) {
                for (let x = 0; x < across; x++) {
                    const uv = source._tileUvScale({ level: level, x: x, y: y });
                    assert.equal(uv.x, 1, `z${level} (${x},${y}) x`);
                    assert.equal(uv.y, 1, `z${level} (${x},${y}) y`);
                }
            }
        }
    });

    QUnit.test("interior tiles of a non-square world are untouched", function(assert) {
        const source = makeSource(SLIDE_W, SLIDE_H, MAX_LEVEL);

        // z9 is 206 x 434 tiles; (0,0) and (100,200) are both fully inside.
        for (const tile of [{ level: 9, x: 0, y: 0 }, { level: 9, x: 100, y: 200 }]) {
            const uv = source._tileUvScale(tile);
            assert.equal(uv.x, 1, `z${tile.level} (${tile.x},${tile.y}) x`);
            assert.equal(uv.y, 1, `z${tile.level} (${tile.x},${tile.y}) y`);
        }
    });

    QUnit.test("edge tiles scale by nominal / clipped", function(assert) {
        const source = makeSource(SLIDE_W, SLIDE_H, MAX_LEVEL);

        // z9 last column: 105185 - 205*512 = 225 px of a nominal 512.
        const lastCol = source._tileUvScale({ level: 9, x: 205, y: 200 });
        close(assert, lastCol.x, TILE / 225, "last column stretches x by 512/225");
        assert.equal(lastCol.y, 1, "…and leaves y alone");

        // z9 last row: 221772 - 433*512 = 76 px of a nominal 512.
        const lastRow = source._tileUvScale({ level: 9, x: 100, y: 433 });
        assert.equal(lastRow.x, 1, "last row leaves x alone");
        close(assert, lastRow.y, TILE / 76, "…and stretches y by 512/76");

        // The bottom-right corner is clipped on both axes at once.
        const corner = source._tileUvScale({ level: 9, x: 205, y: 433 });
        close(assert, corner.x, TILE / 225, "corner x");
        close(assert, corner.y, TILE / 76, "corner y");
    });

    QUnit.test("a level smaller than one tile is corrected wholesale", function(assert) {
        const source = makeSource(SLIDE_W, SLIDE_H, MAX_LEVEL);

        // z0 is a single tile whose level image is only 205.4 x 433.1 px. This is
        // the case that made the whole layer land in the wrong place at low zoom:
        // uncorrected, geometry sat at 0.40 of its true x offset.
        const dims = levelDims(SLIDE_W, SLIDE_H, MAX_LEVEL, 0);
        const uv = source._tileUvScale({ level: 0, x: 0, y: 0 });

        close(assert, uv.x, TILE / dims.w, "z0 x");
        close(assert, uv.y, TILE / dims.h, "z0 y");
        assert.ok(uv.x > 2.4 && uv.x < 2.6, "z0 x correction is the expected ~2.49x");
    });

    QUnit.test("an unresolvable world degrades to no correction, not to a throw", function(assert) {
        const source = makeSource(SLIDE_W, SLIDE_H, MAX_LEVEL);
        source.dimensions = null;

        const uv = source._tileUvScale({ level: 4, x: 1, y: 1 });
        assert.deepEqual(uv, { x: 1, y: 1 }, "falls back to the pre-correction behaviour");
    });
})();
