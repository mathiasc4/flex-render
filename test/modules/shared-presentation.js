/* global QUnit, OpenSeadragon */

/**
 * Shared-context presentation transfer.
 *
 * With `sharedContextKey` the WebGL canvas is off-DOM and every renderer owns a 2D presentation
 * canvas; each frame has to move from one to the other. That used to be an unconditional
 * synchronous readPixels + CPU row flip + putImageData -- the single largest cost in a profiled
 * multi-viewer session. The GPU route blits the final color target into the shared default
 * framebuffer and drawImage()s it onto the presentation canvas.
 *
 * These tests pin that the GPU route is the one chosen, that it is pixel-identical to the
 * readPixels fallback AND to the private-context path (orientation, translucency), that renderers
 * of different sizes on one context do not see each other's pixels, and that the fallbacks work.
 */
(function() {

    const $ = OpenSeadragon;

    function uid(prefix) {
        return `${prefix}_${Math.floor(Math.random() * 1e9)}`;
    }

    function makeRuntime(width, height, options = {}) {
        return $.makeStandaloneFlexRenderer(Object.assign({
            uniqueId: uid("sharedpresent"),
            width: width,
            height: height,
            presentationClearColor: [0, 0, 0, 0]
        }, options));
    }

    function identityConfiguration() {
        return {
            probe: { id: "probe", name: "Probe", type: "identity", visible: 1, tiledImages: [0], params: {}, cache: {} }
        };
    }

    /**
     * Asymmetric pattern: top half opaque `color`, left half of the last row translucent green,
     * everything else transparent. Orientation and alpha handling both show up in it.
     */
    function pattern(width, height, color) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                let rgba = [0, 0, 0, 0];
                if (y < height / 2) {
                    rgba = color;
                } else if (y === height - 1 && x < width / 2) {
                    rgba = [0, 255, 0, 128];
                }
                data.set(rgba, i);
            }
        }
        return new ImageData(data, width, height);
    }

    async function draw(runtime, width, height, color) {
        await runtime.overrideConfigureAll(identityConfiguration());
        await runtime.setInputs(pattern(width, height, color));
        await runtime.drawWithConfiguration();
    }

    function readPresentation(runtime) {
        const source = runtime.renderer.getPresentationCanvas();
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(source, 0, 0);
        return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    }

    function pixelAt(image, x, y) {
        const i = (y * image.width + x) * 4;
        return Array.from(image.data.subarray(i, i + 4));
    }

    function close(actual, expected, tolerance) {
        return actual.every((v, c) => Math.abs(v - expected[c]) <= tolerance);
    }

    function assertClose(assert, actual, expected, tolerance, message) {
        assert.pushResult({
            result: close(actual, expected, tolerance),
            actual: `[${actual.join(", ")}]`,
            expected: `[${expected.join(", ")}]`,
            message: message
        });
    }

    function assertOrientation(assert, image, color, label) {
        assertClose(assert, pixelAt(image, 0, 0), color, 2, `${label}: top-left is the top-half colour`);
        assertClose(assert, pixelAt(image, image.width - 1, Math.floor(image.height / 2) - 1), color, 2,
            `${label}: last row of the top half is the top-half colour`);
        // The exact alpha is the pipeline's business (identity blends the source alpha in, on
        // every route alike); what the transfer must get right is straight alpha: full-intensity
        // green at a partial alpha. Premultiplied data put through putImageData reads darker.
        const translucent = pixelAt(image, 0, image.height - 1);
        assert.ok(translucent[3] > 0 && translucent[3] < 255, `${label}: bottom-left is translucent (a=${translucent[3]})`);
        assertClose(assert, translucent.slice(0, 3), [0, 255, 0], 4,
            `${label}: bottom-left is full-intensity green (straight alpha)`);
        assertClose(assert, pixelAt(image, image.width - 1, image.height - 1), [0, 0, 0, 0], 2,
            `${label}: bottom-right is transparent`);
    }

    function assertImagesMatch(assert, actual, expected, label) {
        let mismatches = 0;
        let first = null;
        for (let y = 0; y < expected.height; y++) {
            for (let x = 0; x < expected.width; x++) {
                const a = pixelAt(actual, x, y);
                const e = pixelAt(expected, x, y);
                const tolerance = e[3] > 0 && e[3] < 255 ? 4 : 2;
                if (!close(a, e, tolerance)) {
                    mismatches++;
                    first = first || `(${x},${y}) [${a.join(",")}] vs [${e.join(",")}]`;
                }
            }
        }
        assert.equal(mismatches, 0, `${label}: every pixel matches${first ? `, first mismatch ${first}` : ""}`);
    }

    function sharedStatus(key) {
        return $.FlexRenderer.getSharedContextStatus().find(entry => entry.key === key) || null;
    }

    QUnit.module("SharedPresentationTransfer");

    QUnit.test("auto mode probes once and presents through the GPU", async function(assert) {
        const key = uid("presentauto");
        const runtime = makeRuntime(8, 6, { sharedContextKey: key });
        try {
            await draw(runtime, 8, 6, [255, 0, 0, 255]);
            const renderer = runtime.renderer;
            assert.ok(renderer.isSharedContext(), "runtime is on a shared context");
            assert.equal(renderer.presentationTransferMode, "blit-draw-image", "the GPU route ran");
            const status = sharedStatus(key);
            assert.ok(status && status.presentationTransfer, "status reports the transfer state");
            assert.strictEqual(status.presentationTransfer.probed, true, "probe ran");
            assert.strictEqual(status.presentationTransfer.blitAvailable, true, "probe passed");
            assert.strictEqual(status.canvasOptions.antialias, false, "shared context forces antialias off");
            assert.strictEqual(renderer.gl.getContextAttributes().antialias, false, "the context really is not multisampled");
            assert.equal(renderer.gl.getError(), renderer.gl.NO_ERROR, "no GL error");
            assertOrientation(assert, readPresentation(runtime), [255, 0, 0, 255], "auto");
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test("blit, read-pixels and the private path produce the same picture", async function(assert) {
        const key = uid("presentmatch");
        const W = 8;
        const H = 6;
        const red = [255, 0, 0, 255];
        const priv = makeRuntime(W, H);
        const blit = makeRuntime(W, H, { sharedContextKey: key, presentationTransfer: "blit" });
        const read = makeRuntime(W, H, { sharedContextKey: key, presentationTransfer: "read-pixels" });
        try {
            await draw(priv, W, H, red);
            const reference = readPresentation(priv);
            assert.equal(priv.renderer.presentationTransferMode, null, "private renderers report no transfer");
            assertOrientation(assert, reference, red, "private reference");

            await draw(blit, W, H, red);
            assert.equal(blit.renderer.presentationTransferMode, "blit-draw-image", "blit route ran");
            const viaBlit = readPresentation(blit);
            assertOrientation(assert, viaBlit, red, "blit");
            assertImagesMatch(assert, viaBlit, reference, "blit vs private");

            await draw(read, W, H, red);
            assert.equal(read.renderer.presentationTransferMode, "read-pixels", "read-pixels route ran");
            const viaRead = readPresentation(read);
            assertOrientation(assert, viaRead, red, "read-pixels");
            assertImagesMatch(assert, viaRead, reference, "read-pixels vs private (translucency unpremultiplied)");
        } finally {
            read.destroy();
            blit.destroy();
            priv.destroy();
        }
    });

    QUnit.test("the backend reports the route it ran", async function(assert) {
        const key = uid("presentroute");
        const runtime = makeRuntime(4, 4, { sharedContextKey: key });
        try {
            await draw(runtime, 4, 4, [255, 0, 0, 255]);
            const renderer = runtime.renderer;
            const backend = renderer.backend;
            const canvas = renderer.getPresentationCanvas();
            const source = renderer.getWebGLCanvas();
            assert.equal(backend.presentColorTargetToCanvas(renderer._finalColorTarget, canvas,
                { transfer: "blit", sourceCanvas: source }), "blit-draw-image", "blit requested");
            assert.equal(backend.presentColorTargetToCanvas(renderer._finalColorTarget, canvas,
                { transfer: "read-pixels" }), "read-pixels", "read-pixels requested");
            assert.equal(backend.presentColorTargetToCanvas(renderer._finalColorTarget, canvas),
                "read-pixels", "no options means read-pixels");
            assert.equal(backend.presentColorTargetToCanvas(null, canvas,
                { transfer: "blit", sourceCanvas: source }), "none", "no target means none");
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test("renderers of different sizes on one context stay separate", async function(assert) {
        const key = uid("presentsizes");
        const red = [255, 0, 0, 255];
        const blue = [0, 0, 255, 255];
        const a = makeRuntime(8, 6, { sharedContextKey: key });
        const b = makeRuntime(4, 10, { sharedContextKey: key });
        try {
            await draw(a, 8, 6, red);
            await draw(b, 4, 10, blue);
            await a.drawWithConfiguration();

            const source = a.renderer.getWebGLCanvas();
            assert.ok(source.width >= 8 && source.height >= 10, `shared canvas grew to ${source.width}x${source.height}`);
            assert.equal(a.renderer.presentationTransferMode, "blit-draw-image", "A used the GPU route");
            assert.equal(b.renderer.presentationTransferMode, "blit-draw-image", "B used the GPU route");

            const imageA = readPresentation(a);
            const imageB = readPresentation(b);
            assert.equal(`${imageA.width}x${imageA.height}`, "8x6", "A presentation size");
            assert.equal(`${imageB.width}x${imageB.height}`, "4x10", "B presentation size");
            assertOrientation(assert, imageA, red, "A (shorter than the shared canvas)");
            assertOrientation(assert, imageB, blue, "B");

            const containsColor = (image, color) => {
                for (let y = 0; y < image.height; y++) {
                    for (let x = 0; x < image.width; x++) {
                        if (close(pixelAt(image, x, y), color, 8)) {
                            return true;
                        }
                    }
                }
                return false;
            };
            assert.notOk(containsColor(imageA, blue), "A shows none of B's pixels");
            assert.notOk(containsColor(imageB, red), "B shows none of A's pixels");
        } finally {
            b.destroy();
            a.destroy();
        }
    });

    QUnit.test("fallbacks: failed probe and multisampled default framebuffer", async function(assert) {
        const red = [255, 0, 0, 255];

        const probeKey = uid("presentprobefail");
        const probeFail = makeRuntime(6, 4, { sharedContextKey: probeKey });
        const previousConsole = $.console;
        $.console = Object.assign({}, previousConsole, { warn: () => {} });
        try {
            probeFail.renderer.backend.probePresentationBlit = () => ({ ok: false, reason: "test" });
            await draw(probeFail, 6, 4, red);
            assert.equal(probeFail.renderer.presentationTransferMode, "read-pixels", "a failed probe falls back");
            const status = sharedStatus(probeKey);
            assert.strictEqual(status.presentationTransfer.blitAvailable, false, "fallback recorded");
            assert.equal(status.presentationTransfer.reason, "test", "probe reason reported");
            assertOrientation(assert, readPresentation(probeFail), red, "after failed probe");
        } finally {
            $.console = previousConsole;
            probeFail.destroy();
        }

        const msaaKey = uid("presentmsaa");
        const msaa = makeRuntime(6, 4, { sharedContextKey: msaaKey, presentationTransfer: "blit" });
        $.console = Object.assign({}, previousConsole, { warn: () => {} });
        try {
            msaa.renderer.backend.getDefaultFramebufferSamples = () => 4;
            await draw(msaa, 6, 4, red);
            assert.equal(msaa.renderer.presentationTransferMode, "read-pixels",
                "a multisampled default framebuffer rules the blit out even when requested");
            assert.equal(sharedStatus(msaaKey).presentationTransfer.reason, "multisampled-default-framebuffer",
                "reason reported");
            assertOrientation(assert, readPresentation(msaa), red, "multisampled fallback");
        } finally {
            $.console = previousConsole;
            msaa.destroy();
        }
    });

    QUnit.test("the GPU route leaves GL state as it found it", async function(assert) {
        const key = uid("presentstate");
        const red = [255, 0, 0, 255];
        const runtime = makeRuntime(8, 6, { sharedContextKey: key, presentationTransfer: "blit" });
        try {
            await draw(runtime, 8, 6, red);
            const renderer = runtime.renderer;
            const gl = renderer.gl;
            const canvas = renderer.getPresentationCanvas();
            canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);

            const programBefore = gl.getParameter(gl.CURRENT_PROGRAM);
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(0, 0, 1, 1);
            let mode;
            try {
                mode = renderer._presentFinalColorTarget();
                assert.ok(gl.isEnabled(gl.SCISSOR_TEST), "scissor test restored");
            } finally {
                gl.disable(gl.SCISSOR_TEST);
            }
            assert.equal(mode, "blit-draw-image", "GPU route ran");
            assertOrientation(assert, readPresentation(runtime), red, "full image presented despite a 1x1 scissor");
            assert.strictEqual(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), null, "read framebuffer unbound");
            assert.strictEqual(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), null, "draw framebuffer unbound");
            assert.strictEqual(gl.getParameter(gl.CURRENT_PROGRAM), programBefore, "program untouched");
            assert.strictEqual(gl.getParameter(gl.CURRENT_PROGRAM), renderer._glProgramSlot().__currentGLProgram,
                "context program record still agrees with GL");
            assert.equal(gl.getError(), gl.NO_ERROR, "no GL error");
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test("a lost context presents nothing and resets the probe", async function(assert) {
        const key = uid("presentlost");
        const runtime = makeRuntime(4, 4, { sharedContextKey: key });
        const previousConsole = $.console;
        try {
            await draw(runtime, 4, 4, [255, 0, 0, 255]);
            assert.ok(sharedStatus(key).presentationTransfer, "probe state exists after a frame");
            const ext = runtime.renderer.gl.getExtension("WEBGL_lose_context");
            if (!ext) {
                assert.ok(true, "WEBGL_lose_context unavailable; skipped");
                return;
            }
            $.console = Object.assign({}, previousConsole, { warn: () => {} });
            const lost = new Promise(resolve => runtime.renderer.getWebGLCanvas()
                .addEventListener("webglcontextlost", resolve, { once: true }));
            ext.loseContext();
            await lost;
            assert.strictEqual(sharedStatus(key).presentationTransfer, null, "probe state reset on loss");
            assert.equal(runtime.renderer._presentFinalColorTarget(), "none", "nothing presented while lost");
            assert.equal(runtime.renderer.presentationTransferMode, "none", "mode reports none");
        } finally {
            $.console = previousConsole;
            runtime.destroy();
        }
    });
})();
