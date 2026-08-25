/* global QUnit, $, OpenSeadragon, testLog */

(function() {

    // These tests drive drawer._collectReadyTiles() with fake tiled images. Passing view=undefined
    // makes _syncViewerViewport() return immediately, so no tile source, no fixtures and no real
    // tile traffic are involved - the load state is entirely scripted here, which is the only way
    // to assert the 'completes', 'stalls' and 'times out' exits deterministically.

    let viewer = null;
    let drawer = null;

    /**
     * @param {object} [script]
     * @param {number} [script.tiles] number of drawable tiles reported
     * @param {number} [script.loadedAfterPumps] pump count after which the image is fully loaded;
     *      Infinity to never load
     * @param {number} [script.tilesLoading] value reported as _tilesLoading on every pump
     * @param {boolean} [script.reportsLoadState] false to mimic an image too old to expose
     *      getFullyLoaded()
     * @param {boolean} [script.loaderBusy] true to mimic the shared ImageLoader kept busy by the
     *      live viewer's own navigation
     */
    function makeFakeTiledImage(script = {}) {
        const tiles = script.tiles === undefined ? 1 : script.tiles;
        const loadedAfterPumps = script.loadedAfterPumps === undefined ? 0 : script.loadedAfterPumps;
        const tilesLoading = script.tilesLoading === undefined ? 0 : script.tilesLoading;

        const drawInfos = [];
        for (let i = 0; i < tiles; i++) {
            drawInfos.push({ tile: { fakeIndex: i } });
        }

        const image = {
            pumps: 0,
            _fullyLoaded: false,
            _tilesLoading: tilesLoading,
            _tilesToDraw: tiles ? [drawInfos] : [],
            _imageLoader: script.loaderBusy ? {
                jobsInProgress: 5,
                jobQueue: [{}, {}],
                failedTiles: [{}]
            } : {
                jobsInProgress: 0,
                jobQueue: [],
                failedTiles: []
            },
            update: function() {
                this.pumps++;
                this._tilesLoading = tilesLoading;
                if (this.pumps >= loadedAfterPumps) {
                    this._fullyLoaded = true;
                    this._tilesLoading = 0;
                }
                return true;
            },
            getTilesToDraw: function() {
                return drawInfos;
            }
        };

        if (script.reportsLoadState !== false) {
            image.getFullyLoaded = function() {
                return this._fullyLoaded;
            };
        }

        return image;
    }

    // One viewer for the whole module: each viewer plus its standalone drawer costs two WebGL
    // contexts, and the browser evicts the oldest once too many are alive - which would break
    // unrelated modules. No test here draws, so a single shared instance is enough. The host
    // element lives outside #qunit-fixture, which QUnit empties between tests.
    QUnit.module('StandaloneExtract', {
        before: function() {
            $('<div id="standalone-extract-example"></div>').appendTo(document.body);
            testLog.reset();

            // eslint-disable-next-line new-cap
            viewer = OpenSeadragon({
                id: 'standalone-extract-example',
                prefixUrl: '/openseadragon/images/',
                springStiffness: 100,
                drawer: 'flex-renderer'
            });
            drawer = OpenSeadragon.makeStandaloneFlexDrawer(viewer);
        },
        after: function() {
            if (drawer && typeof drawer.destroy === "function") {
                drawer.destroy();
            }
            drawer = null;
            if (viewer) {
                viewer.destroy();
            }
            viewer = null;
            $('#standalone-extract-example').remove();
        }
    });

    QUnit.test('waitFullLoad completes once every image reports fully loaded', async function(assert) {
        const images = [
            makeFakeTiledImage({ loadedAfterPumps: 3, tilesLoading: 2 }),
            makeFakeTiledImage({ loadedAfterPumps: 2, tilesLoading: 1 })
        ];

        const started = OpenSeadragon.now();
        const result = await drawer._collectReadyTiles(images, undefined, undefined, {
            waitFullLoad: true,
            loadTimeoutMs: 3000,
            stallTimeoutMs: 100,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.ok(result.fullyLoaded, 'reports fully loaded');
        assert.notOk(result.timedOut, 'did not time out');
        assert.notOk(result.stalled, 'did not stall');
        assert.equal(result.tiles.length, 2, 'collected the tiles of both images');
        assert.ok(elapsed < 3000, 'returned well before the deadline, took ' + elapsed + 'ms');
    });

    QUnit.test('waitFullLoad stalls out instead of burning the whole timeout', async function(assert) {
        // Nothing loading, nothing queued, nothing ever completing: no further tile can arrive.
        const images = [makeFakeTiledImage({ loadedAfterPumps: Infinity, tilesLoading: 0 })];

        const started = OpenSeadragon.now();
        const result = await drawer._collectReadyTiles(images, undefined, undefined, {
            waitFullLoad: true,
            loadTimeoutMs: 5000,
            stallTimeoutMs: 60,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.ok(result.stalled, 'reports stalled');
        assert.notOk(result.fullyLoaded, 'does not claim completeness');
        assert.notOk(result.timedOut, 'stall is not reported as a timeout');
        assert.equal(result.tiles.length, 1, 'still returns whatever is drawable');
        assert.ok(elapsed < 2000, 'gave up on the stall, not on the deadline, took ' + elapsed + 'ms');
    });

    QUnit.test('waitFullLoad is bounded by loadTimeoutMs while tiles keep loading', async function(assert) {
        // Permanently loading: the stall exit must not fire, so only the deadline can end this.
        const images = [makeFakeTiledImage({ loadedAfterPumps: Infinity, tilesLoading: 4 })];

        const started = OpenSeadragon.now();
        const result = await drawer._collectReadyTiles(images, undefined, undefined, {
            waitFullLoad: true,
            loadTimeoutMs: 200,
            stallTimeoutMs: 50,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.ok(result.timedOut, 'reports timed out');
        assert.notOk(result.stalled, 'work was in flight, so not a stall');
        assert.notOk(result.fullyLoaded, 'does not claim completeness');
        assert.ok(elapsed >= 150, 'waited for the deadline, took ' + elapsed + 'ms');
        assert.ok(elapsed < 3000, 'loop is bounded by the deadline, took ' + elapsed + 'ms');
    });

    QUnit.test('without waitFullLoad the first drawable tile still ends the collect', async function(assert) {
        const images = [makeFakeTiledImage({ loadedAfterPumps: Infinity, tilesLoading: 3 })];

        const result = await drawer._collectReadyTiles(images, undefined, undefined, {});

        assert.equal(images[0].pumps, 1, 'exactly one update() pump, as before');
        assert.equal(result.tiles.length, 1, 'returns the resident tile');
        assert.notOk(result.fullyLoaded, 'reports the pass was not complete');
        assert.notOk(result.timedOut, 'no wait, so no timeout');
        assert.notOk(result.stalled, 'no wait, so no stall');
    });

    QUnit.test('without waitFullLoad an empty draw list retries a few frames', async function(assert) {
        const images = [makeFakeTiledImage({ tiles: 0, loadedAfterPumps: Infinity, tilesLoading: 1 })];

        const result = await drawer._collectReadyTiles(images, undefined, undefined, {
            pollIntervalMs: 5
        });

        assert.equal(result.tiles.length, 0, 'nothing became drawable');
        assert.equal(images[0].pumps, 4, 'one pump plus three retries, as before');
        assert.notOk(result.fullyLoaded, 'reports the pass was not complete');
    });

    QUnit.test('an image that cannot report its load state is never waited on', async function(assert) {
        const images = [makeFakeTiledImage({ reportsLoadState: false, tilesLoading: 5 })];

        const started = OpenSeadragon.now();
        const result = await drawer._collectReadyTiles(images, undefined, undefined, {
            waitFullLoad: true,
            loadTimeoutMs: 5000,
            stallTimeoutMs: 1000,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.notOk(result.fullyLoaded, 'unknown completeness degrades closed');
        assert.notOk(result.timedOut, 'returned through the best-effort path');
        assert.equal(result.tiles.length, 1, 'returns the resident tile');
        assert.ok(elapsed < 2000, 'did not spin to the timeout, took ' + elapsed + 'ms');
    });

    QUnit.test('waitImages narrows what completeness means', async function(assert) {
        const background = makeFakeTiledImage({ loadedAfterPumps: 2, tilesLoading: 1 });
        const brokenOverlay = makeFakeTiledImage({ loadedAfterPumps: Infinity, tilesLoading: 0 });

        const result = await drawer._collectReadyTiles([background, brokenOverlay], undefined, undefined, {
            waitFullLoad: true,
            waitImages: [background],
            loadTimeoutMs: 3000,
            stallTimeoutMs: 100,
            pollIntervalMs: 10
        });

        assert.ok(result.fullyLoaded, 'an overlay that can never load does not brand the pass incomplete');
        assert.notOk(result.timedOut, 'did not wait for the overlay');
        assert.ok(brokenOverlay.pumps > 0, 'the overlay is still drawn and still pumped');
        assert.equal(result.tiles.length, 2, 'tiles of every drawn image are collected');
    });

    QUnit.test('waitImages naming images this pass does not draw falls back to all of them', async function(assert) {
        const drawn = makeFakeTiledImage({ loadedAfterPumps: 2, tilesLoading: 1 });
        const foreign = makeFakeTiledImage({ loadedAfterPumps: 1 });

        const result = await drawer._collectReadyTiles([drawn], undefined, undefined, {
            waitFullLoad: true,
            waitImages: [foreign],
            loadTimeoutMs: 3000,
            stallTimeoutMs: 100,
            pollIntervalMs: 10
        });

        assert.ok(result.fullyLoaded, 'waited on the image it actually draws');
        assert.notOk(result.timedOut, 'did not spin on an image nobody pumps');
        assert.equal(foreign.pumps, 0, 'the foreign image was never pumped');
    });

    QUnit.test('the live viewer keeping the shared loader busy does not block the stall exit', async function(assert) {
        const images = [makeFakeTiledImage({
            loadedAfterPumps: Infinity,
            tilesLoading: 0,
            loaderBusy: true
        })];

        const started = OpenSeadragon.now();
        const result = await drawer._collectReadyTiles(images, undefined, undefined, {
            waitFullLoad: true,
            loadTimeoutMs: 5000,
            stallTimeoutMs: 60,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.ok(result.stalled, 'reports stalled');
        assert.notOk(result.timedOut, 'did not fall through to the deadline');
        assert.ok(elapsed < 2000, 'exited on the stall, took ' + elapsed + 'ms');
    });

    QUnit.test('tile traffic of images this pass does not wait on is not progress', async function(assert) {
        const images = [makeFakeTiledImage({ loadedAfterPumps: Infinity, tilesLoading: 0 })];
        const foreign = makeFakeTiledImage();

        // Stands in for the user navigating the live viewer while the off-screen pass runs.
        const traffic = setInterval(function() {
            viewer.raiseEvent('tile-loaded', { tiledImage: foreign, tile: {} });
        }, 10);

        try {
            const started = OpenSeadragon.now();
            const result = await drawer._collectReadyTiles(images, undefined, undefined, {
                waitFullLoad: true,
                loadTimeoutMs: 5000,
                stallTimeoutMs: 60,
                pollIntervalMs: 10
            });
            const elapsed = OpenSeadragon.now() - started;

            assert.ok(result.stalled, 'live traffic does not look like our progress');
            assert.notOk(result.timedOut, 'did not fall through to the deadline');
            assert.ok(elapsed < 2000, 'exited on the stall, took ' + elapsed + 'ms');
        } finally {
            clearInterval(traffic);
        }
    });

    QUnit.test('tile traffic of a waited image is progress', async function(assert) {
        const image = makeFakeTiledImage({ loadedAfterPumps: Infinity, tilesLoading: 0 });

        const traffic = setInterval(function() {
            viewer.raiseEvent('tile-loaded', { tiledImage: image, tile: {} });
        }, 10);

        try {
            const result = await drawer._collectReadyTiles([image], undefined, undefined, {
                waitFullLoad: true,
                loadTimeoutMs: 300,
                stallTimeoutMs: 60,
                pollIntervalMs: 10
            });

            assert.notOk(result.stalled, 'tiles were still arriving, so this is not a stall');
            assert.ok(result.timedOut, 'ran to the deadline instead');
        } finally {
            clearInterval(traffic);
        }
    });

    QUnit.test('no tiled images at all is reported as incomplete, not complete', async function(assert) {
        const result = await drawer._collectReadyTiles([], undefined, undefined, {
            waitFullLoad: true
        });

        assert.equal(result.tiles.length, 0, 'no tiles');
        assert.notOk(result.fullyLoaded, 'an empty pass is not a complete pass');
        assert.notOk(result.timedOut, 'nothing to wait for');
        assert.notOk(result.stalled, 'nothing to stall on');
    });

}());
