/* global QUnit, $, testLog */

/**
 * The grid shader is a measurement tool: `cell_x: 512` must draw lines every 512
 * image pixels. It used to draw them every 512 / devicePixelRatio, because
 * _collectShaderUniforms hands the shader `imageOriginPx` in framebuffer pixels but
 * `pixelSize` in CSS pixels, and the GLSL divided one by the other.
 *
 * Headless Chrome runs at devicePixelRatio 1, so the defect is invisible to the rest
 * of the suite. What actually sizes the canvas is OpenSeadragon.pixelDensityRatio
 * (see _calculateCanvasSize), and that is settable — forcing it to 2 before the viewer
 * is built produces a genuine framebuffer-is-twice-CSS frame.
 */
(function() {
    const CELL = 100;            // image px; 1000px source in a 300px box → ~30 CSS px period
    const GRID_COLOR = "#ff0000";
    const SOURCE = '/test/data/testpattern.dzi';

    let viewer = null;
    let savedDensity = null;

    function gridConfiguration() {
        return {
            grid: {
                id: "grid",
                name: "Grid",
                type: "grid",
                visible: 1,
                tiledImages: [0],
                params: {
                    /* eslint-disable camelcase */
                    use_channel0: "rgba",
                    color: GRID_COLOR,
                    cell_x: CELL,
                    cell_y: CELL,
                    offset_x: 0,
                    offset_y: 0,
                    line_width: 2,
                    // Must stay off: the control defaults to true, and a power-of-two
                    // snap would replace the analytic period with a rounded one.
                    adaptive_lod: false,
                    opacity: 1
                    /* eslint-enable camelcase */
                },
                cache: {}
            }
        };
    }

    // Snapshot of the presented surface, in framebuffer pixels (same approach as
    // test/modules/backdrop-residue.js).
    function readCanvas(drawer) {
        const source = drawer.canvas;
        const scratch = document.createElement("canvas");
        scratch.width = source.width;
        scratch.height = source.height;
        const ctx = scratch.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(source, 0, 0);
        return {
            width: source.width,
            height: source.height,
            data: ctx.getImageData(0, 0, source.width, source.height).data
        };
    }

    // Centres of the red runs along one row. Anti-aliased edges make the runs a couple
    // of pixels wide, so the centre is the stable feature, not the first lit pixel.
    function lineCentersInRow(image, y) {
        const centers = [];
        let runStart = -1;
        for (let x = 0; x < image.width; x++) {
            const i = (y * image.width + x) * 4;
            const isLine = image.data[i] > 120 && image.data[i + 1] < 120 && image.data[i + 3] > 120;
            if (isLine && runStart < 0) {
                runStart = x;
            } else if (!isLine && runStart >= 0) {
                centers.push((runStart + x - 1) / 2);
                runStart = -1;
            }
        }
        if (runStart >= 0) {
            centers.push((runStart + image.width - 1) / 2);
        }
        return centers;
    }

    // Horizontal grid lines light up a whole row, so probe several rows and keep the
    // one that actually shows separated vertical lines.
    function bestRowCenters(image) {
        const rows = [0.37, 0.43, 0.53, 0.61, 0.71].map(f => Math.floor(image.height * f));
        let best = [];
        for (const y of rows) {
            const centers = lineCentersInRow(image, y);
            if (centers.length > best.length) {
                best = centers;
            }
        }
        return best;
    }

    // Median of the gaps: runs clipped by the canvas edge shift only the outermost
    // gaps, and the median ignores them.
    function medianPeriod(centers) {
        const diffs = [];
        for (let i = 1; i < centers.length; i++) {
            diffs.push(centers[i] - centers[i - 1]);
        }
        diffs.sort((a, b) => a - b);
        const mid = diffs.length >> 1;
        return diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
    }

    function zoomSettled() {
        return viewer.viewport.getZoom(true) === viewer.viewport.getZoom(false);
    }

    // The flex drawer rebuilds its programs on a timeout, so the first update-viewport
    // after configuring can still show the previous frame (same reason as the poll in
    // test/modules/multi-image.js).
    function pollForGrid(minLines, onSettled) {
        const deadline = OpenSeadragon.now() + 8000;
        (function tick() {
            const image = readCanvas(viewer.drawer);
            const centers = bestRowCenters(image);
            if ((zoomSettled() && centers.length >= minLines) || OpenSeadragon.now() > deadline) {
                onSettled(image, centers);
                return;
            }
            viewer.forceRedraw();
            setTimeout(tick, 50);
        })();
    }

    function runGridTest(assert, density) {
        const done = assert.async();
        // Pins that the async path actually reached the assertions instead of the test
        // passing vacuously because a handler never fired.
        assert.expect(3);

        viewer.addOnceHandler('open', function() {
            viewer.drawer.overrideConfigureAll(gridConfiguration(), ['grid'], { immediate: true })
                .then(function() {
                    viewer.forceRedraw();
                    pollForGrid(4, function(image, centers) {
                        const tiledImage = viewer.world.getItemAt(0);
                        const inner = viewer.viewport._containerInnerSize;
                        const devicePixelScale = image.width / inner.x;

                        assert.ok(Math.abs(devicePixelScale - density) < 0.01,
                            `framebuffer is ${density}x the CSS width (got ${devicePixelScale})`);
                        assert.ok(centers.length >= 4,
                            `at least 4 grid lines visible in the probed row (got ${centers.length})`);

                        // CSS px per image px — the value the shader receives as `pixelSize`.
                        const pixelSizeCss = viewer.drawer._tiledImageViewportToImageZoom(
                            tiledImage, viewer.viewport.getZoom(true));
                        // The line period lives in framebuffer px, so the DPR belongs in it.
                        // Without the fix this comes out a factor of `density` too small.
                        const expected = CELL * pixelSizeCss * devicePixelScale;

                        const measured = medianPeriod(centers);
                        assert.ok(Math.abs(measured - expected) <= Math.max(1.5, expected * 0.03),
                            `grid period ${measured.toFixed(2)} framebuffer px matches the ` +
                            `configured ${CELL} image px (expected ${expected.toFixed(2)})`);

                        done();
                    });
                });
        });

        viewer.open(SOURCE);
    }

    function moduleFor(density, style) {
        QUnit.module('Grid-DPR-' + density, {
            beforeEach: function() {
                $('<div id="example" style="' + (style || 'width:300px;height:300px;') + '"></div>')
                    .appendTo("#qunit-fixture");
                testLog.reset();

                // Set before the viewer exists: _calculateCanvasSize reads this every time
                // it sizes the canvas, and the first sizing happens during construction.
                savedDensity = OpenSeadragon.pixelDensityRatio;
                OpenSeadragon.pixelDensityRatio = density;

                viewer = OpenSeadragon({
                    id: 'example',
                    prefixUrl: '/openseadragon/images/',
                    springStiffness: 100,
                    animationTime: 0,
                    immediateRender: true,
                    drawer: 'flex-renderer'
                });
            },
            afterEach: function() {
                if (viewer) {
                    viewer.destroy();
                }
                viewer = null;
                OpenSeadragon.pixelDensityRatio = savedDensity;
                $("#example").remove();
            }
        });

        QUnit.test('grid cells measure cell_x image pixels', function(assert) {
            runGridTest(assert, density);
        });
    }

    // density 2 is the regression: before the fix it drew cells at half the configured
    // size. density 1 pins that the fix is a no-op where the units already agreed.
    moduleFor(2);
    moduleFor(1);

    // The framebuffer size is rounded per axis, so on a fractional density a container
    // with different width and height produces two different CSS→framebuffer scales.
    // imageOriginPx.y is built with the y scale, so the uniform has to carry both — a
    // scalar would divide an sy-built numerator by an sx-built denominator. The
    // difference is ~0.02%, too small to measure from rendered pixels, so this asserts
    // the uniform payload directly.
    QUnit.module('Grid-DPR-anisotropic', {
        beforeEach: function() {
            $('<div id="example" style="width:301px;height:300px;"></div>').appendTo("#qunit-fixture");
            testLog.reset();
            savedDensity = OpenSeadragon.pixelDensityRatio;
            OpenSeadragon.pixelDensityRatio = 1.2;
            viewer = OpenSeadragon({
                id: 'example',
                prefixUrl: '/openseadragon/images/',
                springStiffness: 100,
                animationTime: 0,
                immediateRender: true,
                drawer: 'flex-renderer'
            });
        },
        afterEach: function() {
            if (viewer) {
                viewer.destroy();
            }
            viewer = null;
            OpenSeadragon.pixelDensityRatio = savedDensity;
            $("#example").remove();
        }
    });

    QUnit.test('devicePixelScale carries both axes', function(assert) {
        const done = assert.async();
        assert.expect(4);

        viewer.addOnceHandler('open', function() {
            viewer.drawer.overrideConfigureAll(gridConfiguration(), ['grid'], { immediate: true })
                .then(function() {
                    const drawer = viewer.drawer;
                    const renderer = drawer.renderer;
                    const canvas = renderer.getPresentationCanvas();
                    const inner = viewer.viewport._containerInnerSize;

                    const sources = drawer._collectShaderUniforms(
                        renderer.getAllShaders(),
                        renderer.getShaderLayerOrder(),
                        { zoom: viewer.viewport.getZoom(true) });

                    assert.ok(sources.length > 0, "the configured grid layer produced a uniform record");
                    const dps = sources[0].devicePixelScale;

                    Util.assessNumericValue(assert, dps[0], canvas.width / inner.x, 1e-9,
                        "x scale is the canvas-to-container width ratio");
                    Util.assessNumericValue(assert, dps[1], canvas.height / inner.y, 1e-9,
                        "y scale is the canvas-to-container height ratio");
                    // Guards the premise: if the two ever came out equal here, the test would
                    // pass while a scalar uniform was still in place.
                    assert.notEqual(dps[0], dps[1],
                        `per-axis rounding really made the scales differ (${dps[0]}, ${dps[1]})`);

                    done();
                });
        });

        viewer.open(SOURCE);
    });
})();
