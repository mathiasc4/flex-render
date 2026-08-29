/* global QUnit, $, OpenSeadragon, testLog */

(function() {

    // Every off-screen pass must start from the presentation backdrop. When it does not,
    // the previous pass survives wherever the new one is transparent - the second pass
    // composites with SRC_ALPHA/ONE_MINUS_SRC_ALPHA over whatever the surface holds - and
    // a pass with nothing to draw leaves the previous picture untouched entirely.
    //
    // These tests read the presentation canvas directly rather than trusting a facade
    // return value, because the two are allowed to differ: the copy-out composites the
    // backdrop in shared-context mode and must NOT in private-context mode, where the GL
    // clear already put it there.

    const SIZE = 8;
    const BACKDROP = [0, 0, 1, 1];          // opaque blue, nothing like the probe colours
    const RED = [255, 0, 0, 255];
    const GREEN = [0, 255, 0, 255];

    function makeRuntime(options = {}) {
        return OpenSeadragon.makeStandaloneFlexRenderer(Object.assign({
            uniqueId: `backdrop_${Math.floor(Math.random() * 1e6)}`,
            width: SIZE,
            height: SIZE,
            presentationClearColor: BACKDROP
        }, options));
    }

    function identityConfiguration() {
        return {
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
    }

    /**
     * @param {number[]} rgba the colour for every pixel, 0-255
     * @param {function} [mask] (x, y) => boolean; false makes the pixel fully transparent
     */
    function makeImageData(rgba, mask = undefined) {
        const data = new Uint8ClampedArray(SIZE * SIZE * 4);
        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                const i = (y * SIZE + x) * 4;
                const covered = mask ? mask(x, y) : true;
                data[i] = covered ? rgba[0] : 0;
                data[i + 1] = covered ? rgba[1] : 0;
                data[i + 2] = covered ? rgba[2] : 0;
                data[i + 3] = covered ? rgba[3] : 0;
            }
        }
        return new ImageData(data, SIZE, SIZE);
    }

    // Reads the renderer's own output surface, not the facade's composited copy.
    function readPresentation(runtime) {
        const source = runtime.renderer.getPresentationCanvas();
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(source, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }

    function pixelAt(pixels, x, y) {
        const i = (y * SIZE + x) * 4;
        return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    }

    function assertClose(assert, actual, expected, tolerance, message) {
        const ok = actual.every((v, c) => Math.abs(v - expected[c]) <= tolerance);
        assert.pushResult({
            result: ok,
            actual: `[${actual.join(', ')}]`,
            expected: `[${expected.join(', ')}]`,
            message: message
        });
    }

    const BACKDROP_255 = BACKDROP.map(v => Math.round(v * 255));

    QUnit.module('BackdropResidue');

    QUnit.test('a transparent region shows the backdrop, not the previous pass', async function(assert) {
        const runtime = makeRuntime();

        try {
            await runtime.overrideConfigureAll(identityConfiguration());

            // Pass A paints the whole surface red.
            await runtime.setInputs(makeImageData(RED));
            await runtime.drawWithConfiguration();
            assertClose(assert, pixelAt(readPresentation(runtime), SIZE - 1, 0), RED, 2,
                'pass A covered the surface');

            // Pass B covers only the left half and leaves the right half fully transparent.
            await runtime.setInputs(makeImageData(GREEN, x => x < SIZE / 2));
            await runtime.drawWithConfiguration();

            const pixels = readPresentation(runtime);
            assertClose(assert, pixelAt(pixels, 1, 1), GREEN, 2,
                'pass B drew where it was opaque');
            assertClose(assert, pixelAt(pixels, SIZE - 1, 1), BACKDROP_255, 2,
                'the transparent half of pass B reads as the backdrop, not as pass A');
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('a pass with nothing to draw clears rather than preserving', async function(assert) {
        const runtime = makeRuntime();

        try {
            await runtime.overrideConfigureAll(identityConfiguration());
            await runtime.setInputs(makeImageData(RED));
            await runtime.drawWithConfiguration();

            assertClose(assert, pixelAt(readPresentation(runtime), 0, 0), RED, 2,
                'the surface starts out holding the previous pass');

            // Driven one level down on purpose: drawWithConfiguration rejects an empty
            // shader set, and going through setInputs/setSize would reallocate the drawing
            // buffer and wipe the residue for reasons that have nothing to do with the fix.
            runtime.renderer.clearOutput();
            runtime.renderer.renderSecondPassToOutput([]);
            runtime.renderer.gl.finish();

            const pixels = readPresentation(runtime);
            for (let y = 0; y < SIZE; y++) {
                for (let x = 0; x < SIZE; x++) {
                    assertClose(assert, pixelAt(pixels, x, y), BACKDROP_255, 2,
                        `pixel ${x},${y} is the backdrop after an empty second pass`);
                }
            }
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('clearOutput reaches the canvas whatever framebuffer is bound', async function(assert) {
        const runtime = makeRuntime();

        try {
            await runtime.overrideConfigureAll(identityConfiguration());
            await runtime.setInputs(makeImageData(RED));
            await runtime.drawWithConfiguration();

            // What the first-pass program leaves behind: its own framebuffer still bound.
            // A clear that does not bind for itself lands here instead of on the canvas.
            const gl = runtime.renderer.gl;
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            const framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            gl.clearColor(0, 1, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);

            try {
                assert.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE,
                    'the decoy framebuffer is usable');

                runtime.renderer.clearOutput();
                gl.finish();

                assertClose(assert, pixelAt(readPresentation(runtime), 0, 0), BACKDROP_255, 2,
                    'the clear landed on the presentation canvas, not on the bound framebuffer');

                const decoy = new Uint8Array(4);
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, decoy);
                assertClose(assert, Array.from(decoy), [0, 255, 0, 255], 2,
                    'and it did not touch the framebuffer that happened to be bound');
            } finally {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.deleteFramebuffer(framebuffer);
                gl.deleteTexture(texture);
            }
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('a translucent backdrop is applied once, not twice', async function(assert) {
        // Premultiplied, as the context requires: nominal black at 50% alpha.
        const runtime = makeRuntime({ presentationClearColor: [0, 0, 0, 0.5] });

        try {
            await runtime.overrideConfigureAll(identityConfiguration());

            // Nothing opaque anywhere, so the result is the backdrop and nothing else.
            await runtime.setInputs(makeImageData(RED, () => false));
            const ctx = await runtime.drawWithConfiguration();
            const composited = ctx.getImageData(0, 0, SIZE, SIZE).data;

            // Applied twice, alpha would be 1-(1-0.5)^2 = 0.75, i.e. ~191.
            assert.ok(Math.abs(composited[3] - 128) <= 4,
                `the copy-out alpha is the backdrop alpha (~128), got ${composited[3]}`);
        } finally {
            runtime.destroy();
        }
    });

    // -------------------------------------------------------------------------
    // The live-texture branch of the standalone drawer. It bypasses
    // renderer.render() entirely, so it is the one path where an omitted clear
    // is invisible to every renderer-level test above.
    // -------------------------------------------------------------------------

    let viewer = null;
    let drawer = null;

    QUnit.module('BackdropResidueLive', {
        before: async function() {
            $('<div id="backdrop-residue-example"></div>').appendTo(document.body);
            testLog.reset();

            // eslint-disable-next-line new-cap
            viewer = OpenSeadragon({
                id: 'backdrop-residue-example',
                prefixUrl: '/openseadragon/images/',
                springStiffness: 100,
                drawer: 'flex-renderer',
                tileSources: '/test/data/testpattern.dzi'
            });

            await new Promise(resolve => viewer.addOnceHandler('open', resolve));

            // The branch steals the live renderer's first-pass texture, so the live drawer
            // has to have rendered at least once before it can run at all. This drawer
            // rejects the tile-drawn event, so the first-pass result is the signal.
            const deadline = OpenSeadragon.now() + 10000;
            while (!viewer.drawer.renderer.__firstPassResult && OpenSeadragon.now() < deadline) {
                viewer.forceRedraw();
                await new Promise(resolve => setTimeout(resolve, 50));
            }

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
            $('#backdrop-residue-example').remove();
        }
    });

    QUnit.test('the live-texture path clears its output before it draws', async function(assert) {
        const renderer = drawer.renderer;
        const calls = [];

        const realClear = renderer.clearOutput;
        const realDraw = renderer.renderSecondPassToOutput;

        renderer.clearOutput = function(...args) {
            calls.push('clear');
            return realClear.apply(this, args);
        };
        renderer.renderSecondPassToOutput = function(...args) {
            calls.push('draw');
            return realDraw.apply(this, args);
        };

        try {
            await drawer.extract({ result: "uint8" });
        } finally {
            renderer.clearOutput = realClear;
            renderer.renderSecondPassToOutput = realDraw;
        }

        assert.ok(calls.includes('clear'),
            'the pass clears its output - without this the previous region survives ' +
            'wherever the new one is transparent');
        // Ordering only - this viewer is private-context, where renderSecondPassToOutput
        // short-circuits to renderSecondPass. That it matters in shared-context mode is
        // measured in test/modules/standalone-shared-context.js, not here.
        assert.ok(calls.includes('draw'),
            'the pass routes its second pass through the renderer');
        assert.ok(calls.indexOf('clear') < calls.indexOf('draw'),
            'and it clears before it draws, with nothing in between that could rebind');
    });

    QUnit.test('the live-texture path leaves the backdrop where nothing was drawn', async function(assert) {
        // Everything hidden: the second pass composites nothing, so the whole surface must
        // read as the backdrop rather than as whatever the previous extraction left.
        const first = await drawer.extract({ result: "uint8" });
        assert.ok(first.data.length > 0, 'the live-texture path produced a raster');

        const hidden = await drawer.extract({
            result: "uint8",
            configuration: {
                hidden: {
                    id: "hidden",
                    name: "Hidden",
                    type: "identity",
                    visible: 0,
                    tiledImages: [0],
                    params: {},
                    cache: {}
                }
            }
        });

        const backdrop = drawer.renderer.presentationClearColor.map(v => Math.round(v * 255));
        let mismatches = 0;
        for (let i = 0; i < hidden.data.length; i += 4) {
            const differs = [0, 1, 2, 3].some(c => Math.abs(hidden.data[i + c] - backdrop[c]) > 2);
            if (differs) {
                mismatches++;
            }
        }

        assert.equal(mismatches, 0,
            `every pixel of a pass that draws nothing is the backdrop (${mismatches} were not)`);
    });

})();
