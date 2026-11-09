/* global QUnit, OpenSeadragon */

/**
 * TileJSON has no standard way to describe a non-square world, so MVTTileSource
 * accepts `width`/`height` as an extension. Without them it must keep deriving
 * the square web-mercator pyramid byte-for-byte, and with them both the image
 * size and the TMS row flip must follow the real grid rather than 2^z.
 *
 * Numbers below are the visualization-flexibility demo slide.
 */
(function() {
    const SLIDE_W = 105185;
    const SLIDE_H = 221772;
    const TILE = 512;
    const MAX_LEVEL = 9;
    const TEMPLATE = "http://tiles.test/{z}/{x}/{y}.pbf";

    /** configure() touches no instance state, so it can run off the prototype. */
    function configure(tj) {
        return OpenSeadragon.MVTTileSource.prototype.configure.call({}, {
            tiles: [TEMPLATE],
            tileSize: TILE,
            ...tj
        }, null);
    }

    /** Builds a source without the worker; `_isVector: false` skips the template/scheme setup too. */
    function makeSource(options, template, scheme) {
        const source = new OpenSeadragon.MVTTileSource({ ...options, _isVector: false });
        source.template = template || TEMPLATE;
        source.scheme = scheme || "xyz";
        source.useNativeLines = false;
        return source;
    }

    function rowOf(url) {
        return Number(url.split("/").pop().split(".")[0]);
    }

    QUnit.module("MVT TileJSON world");

    QUnit.test("without width/height the world stays square", function(assert) {
        const opts = configure({ maxzoom: 3 });
        assert.equal(opts.width, Math.pow(2, 3) * TILE, "width");
        assert.equal(opts.height, opts.width, "height");
        assert.equal(opts.maxLevel, 3, "maxLevel");

        const defaults = configure({});
        assert.equal(defaults.maxLevel, 14, "maxzoom still defaults to 14");
        assert.equal(defaults.width, Math.pow(2, 14) * TILE, "default width");
    });

    QUnit.test("declared width/height pass through", function(assert) {
        const opts = configure({ maxzoom: MAX_LEVEL, width: SLIDE_W, height: SLIDE_H });
        assert.equal(opts.width, SLIDE_W, "width");
        assert.equal(opts.height, SLIDE_H, "height");
        assert.equal(opts.maxLevel, MAX_LEVEL, "explicit maxzoom wins");
    });

    QUnit.test("an incomplete or invalid size falls back to square", function(assert) {
        for (const tj of [
            { width: SLIDE_W },
            { height: SLIDE_H },
            { width: 0, height: SLIDE_H },
            { width: -5, height: SLIDE_H },
            { width: "abc", height: SLIDE_H },
            { width: Infinity, height: SLIDE_H }
        ]) {
            const opts = configure({ maxzoom: 3, ...tj });
            assert.equal(opts.width, Math.pow(2, 3) * TILE, `${JSON.stringify(tj)} width`);
            assert.equal(opts.height, opts.width, `${JSON.stringify(tj)} height`);
        }
    });

    QUnit.test("a missing maxzoom is derived from the declared size", function(assert) {
        const opts = configure({ width: SLIDE_W, height: SLIDE_H });
        // 2^8 * 512 = 131072 < 221772 <= 2^9 * 512 = 262144
        assert.equal(opts.maxLevel, MAX_LEVEL, "smallest level that fits the slide");

        const tiny = configure({ width: 100, height: 50 });
        assert.equal(tiny.maxLevel, 0, "a sub-tile image clamps to 0");
    });

    QUnit.test("TMS flip on a square world is unchanged", function(assert) {
        const source = makeSource(configure({ maxzoom: 4 }), TEMPLATE, "tms");
        for (let z = 0; z <= 4; z++) {
            const n = 1 << z;
            for (const y of [0, n - 1, n >> 1]) {
                assert.equal(rowOf(source.getTileUrl(z, 0, y)), n - 1 - y, `z${z} y${y}`);
            }
        }
    });

    QUnit.test("TMS flip on a slide uses the real row count", function(assert) {
        const opts = configure({ maxzoom: MAX_LEVEL, width: SLIDE_W, height: SLIDE_H });
        const tms = makeSource(opts, TEMPLATE, "tms");
        const negY = makeSource(opts, "http://tiles.test/{z}/{x}/{-y}.pbf", "xyz");

        assert.equal(tms.getNumTiles(9).y, 434, "z9 has 434 rows");
        assert.equal(rowOf(tms.getTileUrl(9, 0, 0)), 433, "z9 top row");
        assert.equal(rowOf(tms.getTileUrl(9, 0, 433)), 0, "z9 bottom row");
        assert.equal(rowOf(tms.getTileUrl(0, 0, 0)), 0, "z0 single row");

        assert.equal(rowOf(negY.getTileUrl(9, 0, 0)), 433, "{-y} agrees at z9");
        assert.equal(rowOf(negY.getTileUrl(0, 0, 0)), 0, "{-y} agrees at z0");
        assert.equal(rowOf(negY.getTileUrl(9, 0, 7)), 426, "{-y} flips mid-column too");
        assert.equal(rowOf(makeSource(opts).getTileUrl(9, 0, 7)), 7, "{y} is not flipped under xyz");
    });

    QUnit.test("a TileJSON-built source matches a factory-built one", function(assert) {
        const fromTileJSON = makeSource(configure({ maxzoom: MAX_LEVEL, width: SLIDE_W, height: SLIDE_H }));
        const fromFactory = makeSource({
            width: SLIDE_W, height: SLIDE_H, tileSize: TILE, minLevel: 0, maxLevel: MAX_LEVEL
        });

        for (const tile of [
            { level: 0, x: 0, y: 0 },
            { level: 9, x: 205, y: 433 },
            { level: 9, x: 100, y: 200 },
            { level: 5, x: 3, y: 6 }
        ]) {
            assert.deepEqual(fromTileJSON._tileUvScale(tile), fromFactory._tileUvScale(tile),
                `z${tile.level} (${tile.x},${tile.y})`);
        }
    });
})();
