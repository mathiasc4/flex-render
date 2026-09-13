/* global QUnit, OpenSeadragon */

/**
 * The second pass relinks when a uniform array is too short for the scene, and it says so.
 *
 * `u_tiInfo` is sized to the tiled-image count known at compile time, so a world that grows past
 * UNIFORM_ARRAY_FLOOR triggers a relink from setDimensions(). That used to log at `warn` -- but
 * filling the world with tiled images is what opening a visualization *is*, so the message fired on
 * every ordinary open (twice, for a five-image session) and landed in the host's user-visible log
 * next to real problems.
 *
 * Growth before the program has presented a frame is the initial build discovering the world size,
 * and now logs at `debug`. Growth afterwards means a linked program was outgrown mid-session and
 * stays at `warn`. The other caller -- use(), when the arrays are too short for the frame being
 * drawn -- always means a stale frame and is unconditionally `warn`.
 */
(function() {

    const SIZE = 4;

    // $.console is window.console where available, so swap the whole object rather than individual
    // methods and restore it in a finally.
    function captureConsole(fn) {
        const previous = OpenSeadragon.console;
        const seen = { warn: [], debug: [] };
        OpenSeadragon.console = Object.assign({}, previous, {
            warn: msg => seen.warn.push(String(msg)),
            debug: msg => seen.debug.push(String(msg))
        });
        try {
            fn();
        } finally {
            OpenSeadragon.console = previous;
        }
        return seen;
    }

    function secondPassProgram(renderer) {
        return renderer.getProgram(renderer.backend.secondPassProgramKey);
    }

    // The growth condition is `tiledImageCount > _uTiInfoSlots`, and the floor is not necessarily 4
    // forever, so derive the count from the program rather than hardcoding one.
    function growPast(program) {
        program.setDimensions(0, 0, SIZE, SIZE, 4, program._uTiInfoSlots + 1);
    }

    function withRuntime(fn) {
        const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `relinkdiag_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });
        try {
            return fn(runtime);
        } finally {
            runtime.destroy();
        }
    }

    QUnit.module('RelinkDiagnostics');

    QUnit.test('growth before the first frame is reported at debug, not warn', function(assert) {
        withRuntime(runtime => {
            const program = secondPassProgram(runtime.renderer);
            program._hasDrawn = false;
            program._relinkScheduled = false;

            const seen = captureConsole(() => growPast(program));

            assert.equal(seen.debug.length, 1, "one debug line");
            assert.ok(seen.debug[0].indexOf("u_tiInfo holds") !== -1,
                `and it is the u_tiInfo growth message (got: ${seen.debug[0]})`);
            assert.equal(seen.warn.length, 0, "and nothing at warn on the ordinary open path");
        });
    });

    QUnit.test('growth after a presented frame stays at warn', function(assert) {
        withRuntime(runtime => {
            const program = secondPassProgram(runtime.renderer);
            program._hasDrawn = true;
            program._relinkScheduled = false;

            const seen = captureConsole(() => growPast(program));

            assert.equal(seen.warn.length, 1, "one warn line");
            assert.ok(seen.warn[0].indexOf("u_tiInfo holds") !== -1,
                `and it is the u_tiInfo growth message (got: ${seen.warn[0]})`);
            assert.equal(seen.debug.length, 0, "and nothing demoted to debug");
        });
    });

    QUnit.test('a relink asked for mid-frame is always a warning', function(assert) {
        withRuntime(runtime => {
            const program = secondPassProgram(runtime.renderer);
            // The use() caller passes no level: arrays too short for the frame being drawn means
            // that frame is stale, which is worth reporting whether or not anything drew before.
            program._hasDrawn = false;
            program._relinkScheduled = false;

            const seen = captureConsole(() => program._scheduleRelink("arrays hold (4, 4), frame needs (5, 5)"));

            assert.equal(seen.warn.length, 1, "the default level is warn");
            assert.equal(seen.debug.length, 0, "not debug");
        });
    });

    QUnit.test('a presented frame marks the program as drawn', async function(assert) {
        const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `relinkdiag_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });

        try {
            const program = secondPassProgram(runtime.renderer);
            assert.notOk(program._hasDrawn, "a fresh program has not drawn");

            await runtime.overrideConfigureAll({
                a: {
                    id: "a",
                    name: "a",
                    type: "identity",
                    visible: 1,
                    tiledImages: [0],
                    params: {},
                    cache: {}
                }
            });
            await runtime.setInputs(new ImageData(
                new Uint8ClampedArray(SIZE * SIZE * 4).fill(255), SIZE, SIZE));
            await runtime.drawWithConfiguration();

            assert.ok(program._hasDrawn,
                "drawing sets the flag the log level is chosen from");
        } finally {
            runtime.destroy();
        }
    });

})();
