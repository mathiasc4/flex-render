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
     * @param {boolean} [script.inView] false to mimic an image the pass cannot touch - hidden, or
     *      lying outside the extracted region - which is what makes getDrawArea() falsy
     * @param {boolean} [script.reportsDrawArea] false to mimic an image too old to expose
     *      getDrawArea()
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

        if (script.reportsDrawArea !== false) {
            const drawArea = script.inView === false ?
                false : new OpenSeadragon.Rect(0, 0, 1, 1);
            image.getDrawArea = function() {
                return drawArea;
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

    QUnit.test('waited reports the EFFECTIVE wait, not the one that was asked for', async function(assert) {
        const waited = await drawer._collectReadyTiles(
            [makeFakeTiledImage({ loadedAfterPumps: 2, tilesLoading: 1 })], undefined, undefined, {
                waitFullLoad: true,
                loadTimeoutMs: 3000,
                stallTimeoutMs: 100,
                pollIntervalMs: 10
            });
        assert.ok(waited.waited, 'a pass that really waited says so');

        const downgraded = await drawer._collectReadyTiles(
            [makeFakeTiledImage({ reportsLoadState: false })], undefined, undefined, {
                waitFullLoad: true,
                loadTimeoutMs: 3000,
                stallTimeoutMs: 100,
                pollIntervalMs: 10
            });
        assert.notOk(downgraded.waited, 'a silently downgraded pass must not claim it waited');

        const bestEffort = await drawer._collectReadyTiles(
            [makeFakeTiledImage()], undefined, undefined, {});
        assert.notOk(bestEffort.waited, 'the best-effort path never waits');
    });

    // ---------------------------------------------------------------------
    // An image the pass cannot touch is not something the pass waits for
    // ---------------------------------------------------------------------

    QUnit.test('an image outside the extracted region does not hold the pass', async function(assert) {
        // Its _updateLevelsForViewport() bails out before it counts anything and hands back the
        // previous _fullyLoaded, false for an image never yet in view. Nothing of it is ever
        // requested, so that flag can never flip: waiting for it means waiting forever, and the
        // zeroed _tilesLoading makes the pass exit through the stall path on every single render.
        const background = makeFakeTiledImage({ loadedAfterPumps: 2, tilesLoading: 1 });
        const elsewhere = makeFakeTiledImage({ loadedAfterPumps: Infinity, inView: false });

        const started = OpenSeadragon.now();
        const result = await drawer._collectReadyTiles([background, elsewhere], undefined, undefined, {
            waitFullLoad: true,
            loadTimeoutMs: 3000,
            stallTimeoutMs: 100,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.ok(result.fullyLoaded, 'completeness is that of the images actually in the view');
        assert.notOk(result.stalled, 'no longer exits through the stall path');
        assert.notOk(result.timedOut, 'nor through the deadline');
        assert.ok(elapsed < 1000, 'settled as soon as the in-view image loaded, took ' + elapsed + 'ms');
    });

    QUnit.test('a pass with nothing in the view is incomplete, not complete', async function(assert) {
        const result = await drawer._collectReadyTiles(
            [makeFakeTiledImage({ loadedAfterPumps: Infinity, inView: false })], undefined, undefined, {
                waitFullLoad: true,
                loadTimeoutMs: 3000,
                stallTimeoutMs: 60,
                pollIntervalMs: 10
            });

        assert.notOk(result.fullyLoaded, 'nothing was observed, so nothing is complete');
        assert.ok(result.stalled, 'and nothing can arrive either');
    });

    QUnit.test('an image too old to expose getDrawArea is still waited on', async function(assert) {
        // Unknown means keep the historical behaviour: wait, do not assume it is out of the view.
        const image = makeFakeTiledImage({
            loadedAfterPumps: Infinity,
            tilesLoading: 2,
            reportsDrawArea: false
        });

        const result = await drawer._collectReadyTiles([image], undefined, undefined, {
            waitFullLoad: true,
            loadTimeoutMs: 200,
            stallTimeoutMs: 50,
            pollIntervalMs: 10
        });

        assert.ok(result.timedOut, 'waited for it as before');
        assert.notOk(result.fullyLoaded, 'and does not claim completeness');
    });

    QUnit.test('the live wait skips a hidden or off-view live image', async function(assert) {
        const shown = makeFakeTiledImage();
        shown._fullyLoaded = true;
        const hidden = makeFakeTiledImage({ loadedAfterPumps: Infinity, inView: false });
        const host = makeFakeLiveHost([shown, hidden]);

        const started = OpenSeadragon.now();
        const result = await drawer._waitForLiveFullLoad(host, {
            waitFullLoad: true,
            loadTimeoutMs: 3000,
            stallTimeoutMs: 100,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.ok(result.fullyLoaded, 'an image drawing nothing cannot make the live view incomplete');
        assert.notOk(result.timedOut, 'did not wait for it');
        assert.ok(elapsed < 1000, 'returned at once, took ' + elapsed + 'ms');
    });

    // ---------------------------------------------------------------------
    // The live viewer must not observe the standalone viewport (review finding #1)
    // ---------------------------------------------------------------------

    QUnit.test('the standalone viewport is never bound across an await', async function(assert) {
        // The live viewer's own rAF loop runs between tasks. If a binding outlives an await, that
        // loop reads tiledImage.viewport - the standalone one - and recomputes _tilesToDraw and
        // _fullyLoaded for the OFF-SCREEN region, which the on-screen canvas then paints.
        const image = makeFakeTiledImage({ loadedAfterPumps: Infinity, tilesLoading: 2 });
        image.viewport = viewer.viewport;

        let done = false;
        const seen = [];
        const observe = () => seen.push(image.viewport);
        const rafObserver = function() {
            observe();
            if (!done) {
                requestAnimationFrame(rafObserver);
            }
        };

        const timerObserver = setInterval(observe, 3);
        requestAnimationFrame(rafObserver);

        try {
            await drawer._collectReadyTiles([image], undefined, undefined, {
                waitFullLoad: true,
                loadTimeoutMs: 300,
                stallTimeoutMs: 1000,
                pollIntervalMs: 10
            });
        } finally {
            done = true;
            clearInterval(timerObserver);
        }

        assert.ok(seen.length > 5, 'the observer actually ran, ' + seen.length + ' samples');
        assert.notOk(seen.some(vp => vp === drawer.viewport),
            'no task between two pumps ever saw the standalone viewport');
        assert.equal(image.viewport, viewer.viewport, 'the original viewport is restored');
        assert.ok(image.pumps > 1, 'the pass did pump the image, so it was bound at some point');
    });

    // ---------------------------------------------------------------------
    // Live path: `view` omitted, the pass steals the live first-pass texture (finding #2)
    // ---------------------------------------------------------------------

    /**
     * Stand-in for the live viewer: an EventSource - the tile traffic latch subscribes to it - plus
     * the world and the ImageLoader the live wait reads.
     */
    function makeFakeLiveHost(items, loaderJobs = 0) {
        const host = new OpenSeadragon.EventSource();
        host.world = {
            getItemCount: function() {
                return items.length;
            },
            getItemAt: function(index) {
                return items[index];
            }
        };
        host.imageLoader = { jobsInProgress: loaderJobs };
        return host;
    }

    QUnit.test('the live wait stalls instead of burning the whole timeout', async function(assert) {
        // An image whose drawArea is empty keeps returning its sticky _fullyLoaded, so it can never
        // complete. Before, this burned loadTimeoutMs in full - while holding the drawer mutex.
        const host = makeFakeLiveHost([makeFakeTiledImage({ loadedAfterPumps: Infinity })]);

        const started = OpenSeadragon.now();
        const result = await drawer._waitForLiveFullLoad(host, {
            waitFullLoad: true,
            loadTimeoutMs: 5000,
            stallTimeoutMs: 60,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.ok(result.stalled, 'reports stalled');
        assert.notOk(result.timedOut, 'a stall is not a timeout');
        assert.notOk(result.fullyLoaded, 'does not claim completeness');
        assert.ok(result.waited, 'it did wait');
        assert.ok(elapsed < 2000, 'gave up on the stall, took ' + elapsed + 'ms');
    });

    QUnit.test('the live wait honours waitImages', async function(assert) {
        const background = makeFakeTiledImage();
        background._fullyLoaded = true;
        const brokenOverlay = makeFakeTiledImage({ loadedAfterPumps: Infinity });
        const host = makeFakeLiveHost([background, brokenOverlay]);

        const narrowed = await drawer._waitForLiveFullLoad(host, {
            waitFullLoad: true,
            waitImages: [background],
            loadTimeoutMs: 5000,
            stallTimeoutMs: 60,
            pollIntervalMs: 10
        });

        assert.ok(narrowed.fullyLoaded, 'an overlay that can never load no longer brands it incomplete');
        assert.notOk(narrowed.timedOut, 'returned at once');
        assert.notOk(narrowed.stalled, 'nothing to stall on');
        assert.equal(narrowed.waitSet.length, 1, 'completeness is defined over the narrowed set');
        assert.strictEqual(narrowed.waitSet[0], background, 'and that set is the requested image');

        const whole = await drawer._waitForLiveFullLoad(host, {
            waitFullLoad: true,
            loadTimeoutMs: 300,
            stallTimeoutMs: 60,
            pollIntervalMs: 10
        });
        assert.notOk(whole.fullyLoaded, 'without waitImages the overlay still counts');
    });

    QUnit.test('the live wait ignores waitImages the live world does not hold', async function(assert) {
        const live = makeFakeTiledImage({ loadedAfterPumps: Infinity });
        const foreign = makeFakeTiledImage();
        foreign._fullyLoaded = true;
        const host = makeFakeLiveHost([live]);

        const result = await drawer._waitForLiveFullLoad(host, {
            waitFullLoad: true,
            waitImages: [foreign],
            loadTimeoutMs: 300,
            stallTimeoutMs: 60,
            pollIntervalMs: 10
        });

        assert.equal(result.waitSet.length, 1, 'fell back to the whole world');
        assert.strictEqual(result.waitSet[0], live, 'and waits on the live image only');
        assert.notOk(result.fullyLoaded, 'an image nobody drives cannot be the completeness verdict');
    });

    QUnit.test('an image added mid-wait does not hold the live wait hostage', async function(assert) {
        // The wait set is a snapshot, so the pass means what it meant when it started. The old
        // event-driven wait was the opposite of both: completeness re-read the world every check but
        // the handler set was fixed, so an image added mid-wait could only ever make it hang.
        const first = makeFakeTiledImage({ loadedAfterPumps: Infinity });
        const late = makeFakeTiledImage({ loadedAfterPumps: Infinity });
        const items = [first];
        const host = makeFakeLiveHost(items);

        // The live viewer adds an image mid-wait: an overlay toggled on, an addTiledImage resolving.
        setTimeout(function() {
            items.push(late);
        }, 20);
        setTimeout(function() {
            first._fullyLoaded = true;
        }, 50);

        const started = OpenSeadragon.now();
        const result = await drawer._waitForLiveFullLoad(host, {
            waitFullLoad: true,
            loadTimeoutMs: 3000,
            stallTimeoutMs: 1000,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.ok(result.fullyLoaded, 'the snapshot completed');
        assert.notOk(result.timedOut, 'did not hang on an image that joined halfway through');
        assert.equal(result.waitSet.length, 1, 'the late image is not part of this pass');
        assert.ok(elapsed < 2000, 'settled shortly after the flag flipped, took ' + elapsed + 'ms');
    });

    QUnit.test('a busy live loader suppresses the live stall exit', async function(assert) {
        // The ImageLoader queue is shared with the user's browsing, so it can only ever DELAY the
        // exit. Missing a stall is safe; calling one while tiles are still downloading is not.
        const host = makeFakeLiveHost([makeFakeTiledImage({ loadedAfterPumps: Infinity })], 3);

        const result = await drawer._waitForLiveFullLoad(host, {
            waitFullLoad: true,
            loadTimeoutMs: 200,
            stallTimeoutMs: 30,
            pollIntervalMs: 10
        });

        assert.notOk(result.stalled, 'work is in flight, so this is not a stall');
        assert.ok(result.timedOut, 'ran to the deadline instead');
    });

    QUnit.test('a live image that cannot report its load state is never waited on', async function(assert) {
        const host = makeFakeLiveHost([makeFakeTiledImage({ reportsLoadState: false })]);

        const started = OpenSeadragon.now();
        const result = await drawer._waitForLiveFullLoad(host, {
            waitFullLoad: true,
            loadTimeoutMs: 5000,
            stallTimeoutMs: 1000,
            pollIntervalMs: 10
        });
        const elapsed = OpenSeadragon.now() - started;

        assert.notOk(result.waited, 'a silently downgraded wait must not claim it waited');
        assert.notOk(result.fullyLoaded, 'unknown completeness degrades closed');
        assert.notOk(result.timedOut, 'did not spin to the deadline');
        assert.ok(elapsed < 2000, 'returned at once, took ' + elapsed + 'ms');
    });

}());
