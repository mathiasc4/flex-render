/* global QUnit, OpenSeadragon */

/**
 * Each program must set the draw-buffer state of whatever framebuffer it binds.
 *
 * `SecondPassProgram.use()` used to set draw buffers only `if (framebuffer)`, so a pass rendering to
 * the canvas inherited whatever the previous one left selected. `FirstPassProgram.use()` selects two
 * attachments and used to exit with both still selected and its offscreen framebuffer still bound.
 * Neither broke this renderer on its own, but this renderer can share a GL context with other
 * drawers -- xOpat runs OpenSeadragon's own single-output drawer alongside it -- and a single-output
 * fragment shader drawing into a two-attachment selection is a GL_INVALID_OPERATION through no fault
 * of its own.
 *
 * Draw-buffer state is per-framebuffer, and for the default framebuffer the only legal entries are
 * BACK and NONE, which is why the two cases cannot be collapsed into one call.
 */
(function() {

    let viewer = null;

    async function openViewer() {
        const element = document.createElement("div");
        element.id = "draw-buffer-viewer";
        element.style.width = "200px";
        element.style.height = "200px";
        document.getElementById("qunit-fixture").appendChild(element);

        // eslint-disable-next-line new-cap
        viewer = OpenSeadragon({
            id: "draw-buffer-viewer",
            prefixUrl: "/openseadragon/images/",
            drawer: "flex-renderer",
            springStiffness: 100,
            tileSources: "/test/data/testpattern.dzi"
        });

        await new Promise(resolve => viewer.addOnceHandler('open', resolve));

        // The flex drawer rejects tile-drawn, so the first-pass result is the signal that a frame
        // has actually gone through the pipeline (same approach as test/modules/backdrop-residue.js).
        const deadline = OpenSeadragon.now() + 10000;
        while (!viewer.drawer.renderer.__firstPassResult && OpenSeadragon.now() < deadline) {
            viewer.forceRedraw();
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return viewer;
    }

    // Redraw until `predicate` holds, so the assertion reports the settled state rather than
    // whichever frame happened to be in flight. Returns whether it settled before the deadline.
    async function redrawUntil(predicate, timeout = 5000) {
        const deadline = OpenSeadragon.now() + timeout;
        while (!predicate() && OpenSeadragon.now() < deadline) {
            viewer.forceRedraw();
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return predicate();
    }

    QUnit.module('DrawBufferHygiene', {
        afterEach: function() {
            if (viewer) {
                viewer.destroy();
                viewer = null;
            }
            const element = document.getElementById("draw-buffer-viewer");
            if (element) {
                element.remove();
            }
        }
    });

    // One viewer for both halves on purpose. grunt-contrib-qunit navigates with waitUntil: 'load'
    // and a 10s budget (Gruntfile.js), and every extra OSD viewer opened during the run keeps tile
    // requests pending against that budget -- so this suite pays for viewers it creates.
    QUnit.test('a frame owns the canvas draw-buffer state rather than inheriting it',
        async function(assert) {
            await openViewer();
            const gl = viewer.drawer.renderer.gl;

            gl.finish();

            assert.strictEqual(gl.getParameter(gl.FRAMEBUFFER_BINDING), null,
                "the frame leaves the default framebuffer bound, not the first pass's offscreen one");
            assert.strictEqual(gl.getParameter(gl.DRAW_BUFFER0), gl.BACK,
                "and a single-output draw-buffer selection");
            assert.strictEqual(gl.getError(), gl.NO_ERROR, "with no pending GL error");

            // NONE is a legal default-framebuffer selection and nothing in this renderer sets it --
            // it stands in for whatever another drawer sharing the context might leave behind. The
            // second pass used to skip its drawBuffers call for the canvas entirely, so this
            // selection survived every later frame and the pass drew nowhere.
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.drawBuffers([gl.NONE]);
            assert.strictEqual(gl.getParameter(gl.DRAW_BUFFER0), gl.NONE,
                "the canvas selection starts clobbered");

            const recovered = await redrawUntil(
                () => gl.getParameter(gl.DRAW_BUFFER0) === gl.BACK);

            assert.ok(recovered,
                "a later frame selects BACK itself rather than inheriting NONE");
            assert.strictEqual(gl.getError(), gl.NO_ERROR, "with no pending GL error after recovery");
        });

})();
