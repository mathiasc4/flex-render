/* global QUnit, OpenSeadragon */

(function() {

    // A control's uniform location belongs to the WebGLProgram it was resolved against, and
    // registerProgram() deletes and recreates that program. The signal to re-resolve is
    // `requiresLoad`, a single program-wide one-shot flag - so whichever render array runs first
    // after a rebuild discharges it for every shader, including the ones it did not contain.
    // Those shaders then upload through a location belonging to the deleted program, which WebGL
    // rejects with "INVALID_OPERATION: uniform1f: location is not from the associated program".
    //
    // These tests drive that directly rather than through a viewer, because reproducing it in a
    // viewer depends on the order tiles happen to arrive in.

    const SIZE = 2;

    // Renders one float control as an opaque grey, so the red byte of the canvas IS the value
    // the uniform upload delivered. A rejected upload leaves the uniform at a fresh program's
    // zero, which reads as black and is unmistakable.
    OpenSeadragon.FlexRenderer.ShaderLayerRegistry.register(
        class ControlProbeLayer extends OpenSeadragon.FlexRenderer.ShaderLayer {
            static type() {
                return "test_control_probe";
            }
            static name() {
                return "Control probe (test)";
            }
            static sources() {
                return [{ acceptsChannelCount: () => true, description: "any" }];
            }
            static get defaultControls() {
                return {
                    // min/max 0..1 so `normalize` -- (value - min) / (max - min) -- is the
                    // identity and the byte on the canvas is the configured value directly.
                    level: {
                        default: { type: "number", default: 0, min: 0, max: 1, step: 0.01, title: "Level" },
                        accepts: (type) => type === "float"
                    }
                };
            }
            getFragmentShaderExecution() {
                return `
    return vec4(vec3(${this.level.sample()}), 1.0);
`;
            }
        }
    );

    // Same probe, but its GLSL can be made uncompilable on demand. registerProgram() used to
    // delete the working program before it knew the replacement compiled, which stranded every
    // cached uniform location on a deleted program with nothing left to re-link.
    let breakGlsl = false;

    OpenSeadragon.FlexRenderer.ShaderLayerRegistry.register(
        class BreakableProbeLayer extends OpenSeadragon.FlexRenderer.ShaderLayer {
            static type() {
                return "test_breakable_probe";
            }
            static name() {
                return "Breakable probe (test)";
            }
            static sources() {
                return [{ acceptsChannelCount: () => true, description: "any" }];
            }
            static get defaultControls() {
                return {
                    level: {
                        default: { type: "number", default: 0, min: 0, max: 1, step: 0.01, title: "Level" },
                        accepts: (type) => type === "float"
                    }
                };
            }
            getFragmentShaderExecution() {
                if (breakGlsl) {
                    return `
    this is not glsl and will not compile;
`;
                }
                return `
    return vec4(vec3(${this.level.sample()}), 1.0);
`;
            }
        }
    );

    // The compile failure logs both numbered shader sources through $.console; that is several
    // hundred lines of noise per run and says nothing the assertions do not.
    async function withSilencedConsole(fn) {
        const previous = OpenSeadragon.console;
        OpenSeadragon.console = Object.assign({}, previous, {
            log: () => {},
            info: () => {},
            warn: () => {},
            error: () => {}
        });
        try {
            return await fn();
        } finally {
            OpenSeadragon.console = previous;
        }
    }

    function probeConfig(levels, type = "test_control_probe") {
        const config = {};
        Object.keys(levels).forEach(id => {
            config[id] = {
                id: id,
                name: id,
                type: type,
                visible: 1,
                tiledImages: [0],
                params: { level: levels[id] },
                cache: {}
            };
        });
        return config;
    }

    function makeRuntime() {
        return OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `progstate_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });
    }

    function trivialInput() {
        return {
            width: SIZE,
            height: SIZE,
            packs: [{ format: "RGBA8", data: new Uint8Array(SIZE * SIZE * 4) }]
        };
    }

    async function setup(runtime, levels, type = undefined) {
        await runtime.overrideConfigureAll(probeConfig(levels, type));
        await runtime.setInputs(trivialInput());
    }

    function drainErrors(gl) {
        let guard = 0;
        while (gl.getError() !== gl.NO_ERROR && guard++ < 32) { /* drain */ }
    }

    function readRed(runtime) {
        const canvas = runtime.renderer.getPresentationCanvas();
        const scratch = document.createElement("canvas");
        scratch.width = canvas.width;
        scratch.height = canvas.height;
        const ctx = scratch.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0);
        return ctx.getImageData(0, 0, 1, 1).data[0];
    }

    QUnit.module('SharedProgramState');

    QUnit.test('a partial render array still loads every shader', async function(assert) {
        const runtime = makeRuntime();
        try {
            const gl = runtime.renderer.gl;
            // 'b' is last in order and opaque, so it is what the canvas shows.
            await setup(runtime, { a: 0.25, b: 0.75 });
            await runtime.drawWithConfiguration();

            // Rebuild: the old WebGLProgram is deleted and every cached uniform location with it.
            runtime.renderer.registerProgram(null, runtime.renderer.backend.secondPassProgramKey);

            runtime._renderFirstPass();
            const full = runtime._buildRenderArray();
            assert.equal(full.length, 2, "two shader layers are configured");

            drainErrors(gl);

            // The first render after the rebuild carries only shader 'a'. This is what
            // renderVisualizationToTexture({shaderMap}) and an offscreen region pass do.
            runtime.renderer.renderSecondPass([full[0]]);
            assert.equal(gl.getError(), gl.NO_ERROR, "the partial render itself is clean");

            // 'b' was never in that array, so its locations were never re-resolved.
            runtime.renderer.renderSecondPassToOutput(full);
            gl.finish();

            assert.equal(gl.getError(), gl.NO_ERROR,
                "a shader absent from the loading render array does not upload a stale location");
            assert.ok(Math.abs(readRed(runtime) - 191) <= 3,
                `shader 'b' rendered its control value (got ${readRed(runtime)}, want ~191)`);
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('a caller that drops useProgram\'s return value does not strand locations',
        async function(assert) {
            const runtime = makeRuntime();
            try {
                const gl = runtime.renderer.gl;
                await setup(runtime, { a: 0.75 });
                await runtime.drawWithConfiguration();

                // Exactly what configurator.js used to do: rebuild, then consume `requiresLoad`
                // through useProgram() and throw the answer away, so load() never runs.
                const renderer = runtime.renderer;
                const key = renderer.backend.secondPassProgramKey;
                renderer.registerProgram(null, key);
                renderer.useProgram(renderer.getProgram(key), "second-pass");

                drainErrors(gl);

                await runtime.drawWithConfiguration();
                gl.finish();

                assert.equal(gl.getError(), gl.NO_ERROR,
                    "the next draw re-resolves rather than uploading through the deleted program");
                assert.ok(Math.abs(readRed(runtime) - 191) <= 3,
                    `the control value still reaches the GPU (got ${readRed(runtime)}, want ~191)`);
            } finally {
                runtime.destroy();
            }
        });

    QUnit.test('switching a shader between programs re-resolves its locations', async function(assert) {
        const runtime = makeRuntime();
        try {
            const gl = runtime.renderer.gl;
            await setup(runtime, { a: 0.75 });
            await runtime.drawWithConfiguration();

            const shader = runtime.renderer.getShaderLayer("a");
            assert.ok(shader.__glProgram, "the layer records the program it loaded against");

            // Forge the situation the shared-context race produces: the layer is loaded against
            // a program that is no longer the one being drawn with, and its cached location is
            // therefore not usable. Without the re-resolve the upload goes nowhere and the
            // uniform keeps the fresh program's zero.
            shader.__glProgram = {};
            shader.level.glLocation = null;
            shader.level._needsLoad = true;

            drainErrors(gl);
            await runtime.drawWithConfiguration();
            gl.finish();

            assert.equal(gl.getError(), gl.NO_ERROR, "no stale-location upload");
            assert.ok(Math.abs(readRed(runtime) - 191) <= 3,
                `the value survives the re-resolve (got ${readRed(runtime)}, want ~191)`);
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('a program that fails to compile leaves the working one rendering', async function(assert) {
        const runtime = makeRuntime();
        try {
            const gl = runtime.renderer.gl;
            const renderer = runtime.renderer;
            const key = renderer.backend.secondPassProgramKey;

            await setup(runtime, { a: 0.75 }, "test_breakable_probe");
            await runtime.drawWithConfiguration();

            const before = readRed(runtime);
            assert.ok(Math.abs(before - 191) <= 3, `the probe renders its value first (got ${before})`);

            const workingProgram = renderer.getProgram(key).webGLProgram;

            breakGlsl = true;
            await withSilencedConsole(() => {
                assert.throws(
                    () => renderer.registerProgram(null, key),
                    /failed to compile or link/,
                    "the failure is reported rather than returned as a silent undefined"
                );
            });

            assert.strictEqual(renderer.getProgram(key).webGLProgram, workingProgram,
                "the program that was linked is still the registered one");

            drainErrors(gl);
            await runtime.drawWithConfiguration();
            gl.finish();

            // Before the swap-on-success reorder this raised, every frame and forever,
            // "INVALID_OPERATION: uniform4f: location is not from the associated program".
            assert.equal(gl.getError(), gl.NO_ERROR,
                "the next draw does not upload through a location belonging to a deleted program");
            assert.ok(Math.abs(readRed(runtime) - before) <= 3,
                `and it still renders what it rendered before the failed build (got ${readRed(runtime)})`);
        } finally {
            breakGlsl = false;
            runtime.destroy();
        }
    });

    QUnit.test('the second pass repairs locations that belong to another program', async function(assert) {
        const runtime = makeRuntime();
        try {
            const gl = runtime.renderer.gl;
            const renderer = runtime.renderer;
            await setup(runtime, { a: 0.75 });
            await runtime.drawWithConfiguration();

            const second = renderer.getProgram(renderer.backend.secondPassProgramKey);
            const first = renderer.getProgram(renderer.backend.firstPassProgramKey);

            // Forge what a rebuild used to leave behind: a location resolved against a different
            // program, with `_locationProgram` no longer naming the program being drawn with.
            // use() has to notice on its own -- it is the last uploader that used to trust the
            // caller, the way ShaderLayer.glDrawing and TextureAtlas.bind already do not.
            second._zoomLoc = gl.getUniformLocation(first.webGLProgram, "u_tileLayer");
            second._locationProgram = null;

            drainErrors(gl);
            await runtime.drawWithConfiguration();
            gl.finish();

            assert.equal(gl.getError(), gl.NO_ERROR, "no stale-location upload");
            assert.strictEqual(second._locationProgram, second.webGLProgram,
                "use() re-resolved against the program it is drawing with");
            assert.ok(Math.abs(readRed(runtime) - 191) <= 3,
                `the value still reaches the GPU (got ${readRed(runtime)}, want ~191)`);
        } finally {
            runtime.destroy();
        }
    });

    QUnit.module('AtlasDetachedGlState');

    QUnit.test('atlas work outside a draw does not leak context state', async function(assert) {
        const runtime = makeRuntime();
        try {
            const gl = runtime.renderer.gl;
            await setup(runtime, { a: 0.5 });
            await runtime.drawWithConfiguration();

            const atlas = runtime.renderer.backend.secondAtlas;

            // Stand in for whatever another renderer sharing this context left bound.
            const foreign = gl.createTexture();
            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, foreign);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            drainErrors(gl);

            // Reached from Image.onload / document.fonts.ready in the real thing.
            const pixels = new Uint8Array(4 * 4 * 4).fill(255);
            atlas.addImage(pixels, { width: 4, height: 4 });
            atlas._commitUploads();

            assert.equal(gl.getParameter(gl.ACTIVE_TEXTURE), gl.TEXTURE5,
                "the active texture unit is restored");
            assert.equal(gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY), foreign,
                "the array binding on that unit is restored");
            assert.equal(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), true,
                "UNPACK_FLIP_Y_WEBGL is restored, not left at the atlas's setting");
            assert.equal(gl.getError(), gl.NO_ERROR, "no GL error from the detached upload");

            gl.activeTexture(gl.TEXTURE0);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.deleteTexture(foreign);
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('enqueued atlas uploads are flushed by the next draw', async function(assert) {
        const runtime = makeRuntime();
        try {
            const gl = runtime.renderer.gl;
            await setup(runtime, { a: 0.5 });
            await runtime.drawWithConfiguration();

            const atlas = runtime.renderer.backend.secondAtlas;
            const pixels = new Uint8Array(4 * 4 * 4).fill(255);

            // Producers enqueue and do not commit; bind() is what flushes, inside a draw.
            atlas.addImage(pixels, { width: 4, height: 4 });
            assert.ok(atlas._pendingUploads.length > 0, "the upload is queued, not committed");

            drainErrors(gl);
            await runtime.drawWithConfiguration();
            gl.finish();

            assert.equal(atlas._pendingUploads.length, 0, "the draw flushed the queue");
            assert.equal(gl.getError(), gl.NO_ERROR, "and did so without a GL error");
        } finally {
            runtime.destroy();
        }
    });

})();
