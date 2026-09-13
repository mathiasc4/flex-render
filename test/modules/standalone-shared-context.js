/* global QUnit, $, OpenSeadragon, testLog */

(function() {

    // Nothing else in the repo executes the intersection of makeStandaloneFlexDrawer and a
    // shared WebGL context: standalone-extract.js and backdrop-residue.js build viewers with
    // no drawerOptions, and test/demo/shared-context-validation.js never builds a standalone
    // drawer. Shared context is opt-in - sharedContextKey defaults to null in flex-drawer.js
    // - so every default setup takes the private path, which is why this combination could
    // stay broken without anyone noticing.
    //
    // It IS reachable: makeStandaloneFlexDrawer deep-clones the source viewer's drawer
    // options and overrides only debug/htmlReset/htmlHandler/interactive/handleNavigator/
    // offScreen, so sharedContextKey survives and the standalone drawer joins the same
    // shared entry.

    const SHARED_KEY = 'standalone-shared-probe';

    // Without this the standalone drawer has no shader layers of its own - it does not
    // inherit the live viewer's - so _collectSecondPassPayload returns [] and the second
    // pass draws nothing at all. Both variants would then come back blank for a reason that
    // has nothing to do with where the pass is routed, and the comparison would be void.
    const DRAW_CONFIGURATION = {
        probe: {
            id: "probe",
            name: "Probe",
            type: "identity",
            visible: 1,
            tiledImages: [0],
            params: {},
            cache: {}
        }
    };

    let viewer = null;
    let drawer = null;
    let setupError = null;

    function countOpaquePixels(data) {
        let count = 0;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 0) {
                count++;
            }
        }
        return count;
    }

    /**
     * Read the renderer's presentation canvas, NOT the facade's return value.
     *
     * The facade's copy-out composites the backdrop with fillRect in shared-context mode,
     * and the default backdrop is opaque white - so every pixel of the returned raster is
     * opaque whatever the render did, and counting opaque pixels there measures the
     * fillRect. The presentation canvas is the surface actually in question: in shared mode
     * it is a plain 2D canvas that only the color-target transfer writes.
     */
    function readPresentation() {
        const source = drawer.renderer.getPresentationCanvas();
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(source, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }

    // Blank it first so a reading can never be the previous pass's leftovers.
    function blankPresentation() {
        const canvas = drawer.renderer.getPresentationCanvas();
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    QUnit.module('StandaloneSharedContext', {
        before: async function() {
            $('<div id="standalone-shared-example"></div>').appendTo(document.body);
            testLog.reset();

            try {
                // eslint-disable-next-line new-cap
                viewer = OpenSeadragon({
                    id: 'standalone-shared-example',
                    prefixUrl: '/openseadragon/images/',
                    springStiffness: 100,
                    drawer: 'flex-renderer',
                    drawerOptions: {
                        'flex-renderer': {
                            sharedContextKey: SHARED_KEY
                        }
                    },
                    tileSources: '/test/data/testpattern.dzi'
                });

                await new Promise(resolve => viewer.addOnceHandler('open', resolve));

                // This drawer rejects the tile-drawn event, so the first-pass result is the
                // only usable "the live renderer has rendered" signal - and the live-texture
                // path steals exactly that.
                const deadline = OpenSeadragon.now() + 10000;
                while (!viewer.drawer.renderer.__firstPassResult && OpenSeadragon.now() < deadline) {
                    viewer.forceRedraw();
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                drawer = OpenSeadragon.makeStandaloneFlexDrawer(viewer);
            } catch (e) {
                setupError = e;
            }
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
            setupError = null;
            $('#standalone-shared-example').remove();
        }
    });

    QUnit.test('the standalone drawer really joins the shared context', function(assert) {
        // Without this the comparison below is meaningless: it would silently measure the
        // private path twice and report a pass either way.
        assert.equal(setupError, null, `setup completed${setupError ? `: ${setupError.message}` : ''}`);
        assert.ok(viewer.drawer.renderer.isSharedContext(),
            'the live viewer is in shared-context mode');
        assert.ok(drawer.renderer.isSharedContext(),
            'sharedContextKey survives the drawer-option clone into the standalone drawer');
        assert.strictEqual(drawer.renderer.gl, viewer.drawer.renderer.gl,
            'both renderers are on one WebGL context');
        assert.notStrictEqual(drawer.renderer.getPresentationCanvas(),
            viewer.drawer.renderer.getPresentationCanvas(),
            'but each keeps its own presentation canvas');
        assert.notStrictEqual(drawer.renderer.getPresentationCanvas(),
            drawer.renderer.getWebGLCanvas(),
            'and in shared mode the presentation canvas is not the WebGL canvas');
    });

    QUnit.test('the bound program is tracked on the context, not on the renderer', function(assert) {
        assert.equal(setupError, null, 'setup completed');

        // CURRENT_PROGRAM is a property of the GL context while each renderer keeps its own
        // `_program` belief. Every place that reconciled the two by hand was a stale-location
        // bug waiting to happen, so the binding is recorded once, on the shared entry.
        const live = viewer.drawer.renderer;
        const standalone = drawer.renderer;
        const gl = live.gl;

        const liveSecond = live.getProgram(live.backend.secondPassProgramKey);
        const standaloneSecond = standalone.getProgram(standalone.backend.secondPassProgramKey);

        assert.notStrictEqual(liveSecond.webGLProgram, standaloneSecond.webGLProgram,
            'each renderer compiled its own second-pass program');

        live._bindGLProgram(liveSecond.webGLProgram);
        assert.strictEqual(gl.getParameter(gl.CURRENT_PROGRAM), liveSecond.webGLProgram,
            'the live renderer bound its program');
        assert.strictEqual(standalone._glProgramSlot().__currentGLProgram, liveSecond.webGLProgram,
            'the other renderer on the same context reads the same record');

        assert.ok(standalone._bindGLProgram(standaloneSecond.webGLProgram),
            'so binding a different program is not skipped as already-bound');
        assert.strictEqual(gl.getParameter(gl.CURRENT_PROGRAM), standaloneSecond.webGLProgram,
            'and the bind reached the context');

        assert.notOk(standalone._bindGLProgram(standaloneSecond.webGLProgram),
            'binding what is already bound costs no GL call');
    });

    QUnit.test('the live-texture path produces a picture in shared-context mode', async function(assert) {
        assert.equal(setupError, null, 'setup completed');

        const renderer = drawer.renderer;

        // Measured first, on a blanked canvas, so it can never read the other variant's
        // leftovers. Forced down the call the branch used before this change:
        // renderSecondPass() renders into whatever framebuffer it is handed - defaulting to
        // the shared canvas's default framebuffer - and never transfers to the presentation
        // canvas.
        const real = renderer.renderSecondPassToOutput;
        renderer.renderSecondPassToOutput = function(renderArray, options) {
            return this.renderSecondPass(renderArray, options);
        };

        let legacyPixels;
        try {
            blankPresentation();
            await drawer.extract({ result: "uint8", configuration: DRAW_CONFIGURATION });
            legacyPixels = readPresentation();
        } finally {
            renderer.renderSecondPassToOutput = real;
        }

        // No `view`, so this takes the live-texture branch: it steals the live renderer's
        // first-pass texture and re-runs only the second pass.
        blankPresentation();
        await drawer.extract({ result: "uint8", configuration: DRAW_CONFIGURATION });
        const currentPixels = readPresentation();

        const legacyOpaque = countOpaquePixels(legacyPixels);
        const currentOpaque = countOpaquePixels(currentPixels);
        const total = currentPixels.length / 4;

        assert.ok(total > 0, 'the presentation canvas has a readable size');

        // The verdict, reported as explicit counts so the numbers are in the log whichever
        // way it falls.
        assert.ok(currentOpaque > 0,
            `routing the second pass through the renderer writes the presentation canvas ` +
            `(${currentOpaque} of ${total} pixels non-transparent)`);

        assert.ok(legacyOpaque === 0,
            `and rendering straight to the shared default framebuffer does not ` +
            `(${legacyOpaque} of ${legacyPixels.length / 4} pixels non-transparent) - ` +
            `if this assertion fails, renderSecondPassToOutput is unnecessary and the ` +
            `live-texture branch can go back to plain renderSecondPass`);
    });

})();
