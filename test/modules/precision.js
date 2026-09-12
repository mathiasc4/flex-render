/* global QUnit, OpenSeadragon */

(function() {

    // IEEE-754 binary16 encoder. Every value used below is exactly representable in half
    // precision, so the round-trip through the GPU must be bit-exact, not merely close.
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);

    function toHalf(value) {
        floatView[0] = value;
        const x = int32View[0];

        let bits = (x >> 16) & 0x8000;
        let mantissa = (x >> 12) & 0x07ff;
        const exponent = (x >> 23) & 0xff;

        if (exponent < 103) {
            return bits;
        }
        if (exponent > 142) {
            bits |= 0x7c00;
            bits |= ((exponent === 255) ? 0 : 1) && (x & 0x007fffff);
            return bits;
        }
        if (exponent < 113) {
            mantissa |= 0x0800;
            bits |= (mantissa >> (114 - exponent)) + ((mantissa >> (113 - exponent)) & 1);
            return bits;
        }

        bits |= ((exponent - 112) << 10) | (mantissa >> 1);
        bits += mantissa & 1;
        return bits;
    }

    // Deliberately outside the [0,1] contract an RGBA8 target used to enforce:
    // a negative, an in-range value, a value above 1, and the boundary itself.
    const PROBE = [-2.5, 0.5, 3.25, 1.0];
    const SIZE = 2;

    function makeFloatTextureSet(width, height, rgba) {
        const data = new Uint16Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            data[i * 4] = toHalf(rgba[0]);
            data[i * 4 + 1] = toHalf(rgba[1]);
            data[i * 4 + 2] = toHalf(rgba[2]);
            data[i * 4 + 3] = toHalf(rgba[3]);
        }

        return {
            width: width,
            height: height,
            channelCount: 4,
            packs: [{ format: "RGBA16F", data: data }]
        };
    }

    function identityConfiguration(extra = {}) {
        return {
            probe: Object.assign({
                id: "probe",
                name: "Probe",
                type: "identity",
                visible: 1,
                tiledImages: [0],
                params: {},
                cache: {}
            }, extra)
        };
    }

    function makeRuntime(precision) {
        return OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `precision_${precision}_${Math.floor(Math.random() * 1e6)}`,
            width: SIZE,
            height: SIZE,
            precision: precision
        });
    }

    QUnit.module('RenderPrecision');

    QUnit.test('float16 target keeps values outside [0,1]', async function(assert) {
        const runtime = makeRuntime("float16");

        try {
            const gl = runtime.renderer.gl;

            if (!runtime.renderer.backend.supportsHighPrecisionTargets) {
                assert.equal(runtime.renderer.getColorTargetPrecision(), "unorm8",
                    "without a colour-buffer extension the renderer must fall back, not pretend");
                return;
            }

            assert.equal(runtime.renderer.getColorTargetPrecision(), "float16",
                "explicit precision option is honoured");

            // Reading RGBA/FLOAT back needs the 32-bit float colour-buffer extension even
            // though the target itself is half-float.
            if (!gl.getExtension('EXT_color_buffer_float')) {
                assert.ok(true, "EXT_color_buffer_float unavailable; float readback skipped");
                return;
            }

            await runtime.overrideConfigureAll(identityConfiguration());
            await runtime.setInputs(makeFloatTextureSet(SIZE, SIZE, PROBE));

            const pixels = await runtime.extractFirstPassLayer("texture", 0, {
                format: gl.RGBA,
                type: gl.FLOAT,
                result: "float32"
            });

            assert.equal(pixels.length, SIZE * SIZE * 4, "readback size matches the target");

            for (let i = 0; i < SIZE * SIZE; i++) {
                for (let c = 0; c < 4; c++) {
                    assert.pushResult({
                        result: Math.abs(pixels[i * 4 + c] - PROBE[c]) < 1e-3,
                        actual: pixels[i * 4 + c],
                        expected: PROBE[c],
                        message: `pixel ${i} channel ${c} survived the first pass`
                    });
                }
            }
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('unorm8 target still clamps and quantizes (default path)', async function(assert) {
        const runtime = makeRuntime("unorm8");

        try {
            const gl = runtime.renderer.gl;

            assert.equal(runtime.renderer.getColorTargetPrecision(), "unorm8",
                "explicit unorm8 is never upgraded");

            await runtime.overrideConfigureAll(identityConfiguration());
            await runtime.setInputs(makeFloatTextureSet(SIZE, SIZE, PROBE));

            const pixels = await runtime.extractFirstPassLayer("texture", 0, {
                format: gl.RGBA,
                type: gl.UNSIGNED_BYTE,
                result: "uint8"
            });

            for (let i = 0; i < SIZE * SIZE; i++) {
                assert.equal(pixels[i * 4], 0, `pixel ${i}: -2.5 clamped to 0`);
                assert.ok(Math.abs(pixels[i * 4 + 1] - 128) <= 1, `pixel ${i}: 0.5 quantized to ~128`);
                assert.equal(pixels[i * 4 + 2], 255, `pixel ${i}: 3.25 clamped to 255`);
                assert.equal(pixels[i * 4 + 3], 255, `pixel ${i}: 1.0 maps to 255`);
            }
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('auto resolves float16 from shader config', async function(assert) {
        const runtime = makeRuntime("auto");

        try {
            assert.equal(runtime.renderer.getColorTargetPrecision(), "unorm8",
                "auto stays 8-bit until something asks for more");

            await runtime.overrideConfigureAll(identityConfiguration({ precision: "float16" }));

            const expected = runtime.renderer.backend.supportsHighPrecisionTargets ? "float16" : "unorm8";
            assert.equal(runtime.renderer.getColorTargetPrecision(), expected,
                "a shader config declaring precision:'float16' upgrades the target when supported");
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('auto resolves float16 from the data', async function(assert) {
        const runtime = makeRuntime("auto");

        try {
            await runtime.overrideConfigureAll(identityConfiguration());

            assert.equal(runtime.renderer.getColorTargetPrecision(), "unorm8",
                "auto stays 8-bit while the data is 8-bit");

            // What the drawer reports once a tile prepares with a float pack.
            runtime.renderer.setDataCarriesHighPrecision(true);

            const expected = runtime.renderer.backend.supportsHighPrecisionTargets ? "float16" : "unorm8";
            assert.equal(runtime.renderer.getColorTargetPrecision(), expected,
                "float data upgrades the target with no shader opt-in at all");

            runtime.renderer.setDataCarriesHighPrecision(false);
            assert.equal(runtime.renderer.getColorTargetPrecision(), "unorm8",
                "and the upgrade is released when the float data goes away");
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('a shader veto blocks the data-driven upgrade', async function(assert) {
        const registry = OpenSeadragon.FlexRenderer.ShaderLayerRegistry;
        const Identity = registry.get("identity");

        class ClampedOnlyLayer extends Identity {
            static type() {
                return "test_clamped_only";
            }
            static name() {
                return "Clamped-only test layer";
            }
            static supportsHighPrecision() {
                return false;
            }
        }

        registry.register(ClampedOnlyLayer);

        const runtime = makeRuntime("auto");

        try {
            await runtime.overrideConfigureAll(identityConfiguration({ type: "test_clamped_only" }));
            runtime.renderer.setDataCarriesHighPrecision(true);

            assert.equal(runtime.renderer.getColorTargetPrecision(), "unorm8",
                "a layer declaring supportsHighPrecision() === false keeps the whole renderer 8-bit");
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('the unorm8 master switch blocks the data-driven upgrade', async function(assert) {
        const runtime = makeRuntime("unorm8");

        try {
            await runtime.overrideConfigureAll(identityConfiguration());
            runtime.renderer.setDataCarriesHighPrecision(true);

            assert.equal(runtime.renderer.getColorTargetPrecision(), "unorm8",
                "float data cannot upgrade the target while precision is explicitly unorm8");
        } finally {
            runtime.destroy();
        }
    });

})();
