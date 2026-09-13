/* global QUnit, OpenSeadragon */

(function() {

    // IEEE-754 binary16 encoder. Every value used below is exactly representable in half
    // precision, so a mismatch is a real defect and never a rounding artifact.
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

    const SIZE = 2;

    /**
     * One pack of `components` half-float channels, every pixel identical.
     * @param {number} width
     * @param {number} height
     * @param {number[]} values one value per component
     */
    function halfPack(width, height, values) {
        const data = new Uint16Array(width * height * values.length);
        for (let i = 0; i < width * height; i++) {
            for (let c = 0; c < values.length; c++) {
                data[i * values.length + c] = toHalf(values[c]);
            }
        }
        return data;
    }

    function textureSet(width, height, format, packValues, channelCount) {
        const set = {
            width: width,
            height: height,
            packs: packValues.map(values => ({
                format: format,
                data: halfPack(width, height, values)
            }))
        };
        if (channelCount !== undefined) {
            set.channelCount = channelCount;
        }
        return set;
    }

    function makeRuntime(precision = "float16", width = SIZE, height = SIZE) {
        return OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `packfmt_${Math.floor(Math.random() * 1e9)}`,
            width: width,
            height: height,
            precision: precision
        });
    }

    // A layer with no controls, no window and no blending: it renders one GLSL expression as an
    // opaque grey, so the red byte of the canvas IS the sampled value. Using `single_channel`
    // here instead would drag its input window into the assertion, which is a different feature.
    let probeExpression = "0.0";

    OpenSeadragon.FlexRenderer.ShaderLayerRegistry.register(
        class ChannelProbeLayer extends OpenSeadragon.FlexRenderer.ShaderLayer {
            static type() {
                return "test_channel_probe";
            }
            static name() {
                return "Channel probe (test)";
            }
            static sources() {
                return [{ acceptsChannelCount: () => true, description: "any" }];
            }
            getFragmentShaderExecution() {
                return `
    float v = ${probeExpression};
    return vec4(vec3(v), 1.0);
`;
            }
        }
    );

    function probeConfiguration() {
        return {
            probe: {
                id: "probe",
                name: "Probe",
                type: "test_channel_probe",
                visible: 1,
                tiledImages: [0],
                params: {},
                cache: {}
            }
        };
    }

    /**
     * Render `expression` over `packValues` and return the resulting byte (0-255).
     */
    async function renderProbe(runtime, expression, packValues) {
        probeExpression = expression;
        await runtime.overrideConfigureAll(probeConfiguration());
        // singleSource: one tiled image owning all packs. Without it the harness models each
        // pack as its own image, and osd_texture clamps every pack index to 0.
        await runtime.setInputs(
            textureSet(SIZE, SIZE, "R16F", packValues),
            { singleSource: true }
        );
        await runtime.drawWithConfiguration();
        const image = await runtime.extractCurrentViewport({ result: "imageData" });
        return image.data[0];
    }

    QUnit.module('GpuTexturePackFormats');

    // ---------------------------------------------------------------- upload / metadata

    QUnit.test('R16F uploads and reports one channel per pack', async function(assert) {
        const runtime = makeRuntime();
        try {
            // channelCount deliberately omitted: the default must follow the format, not
            // the historical packCount * 4.
            const result = await runtime.renderer.prepareGpuTextureTile({
                data: textureSet(SIZE, SIZE, "R16F", [[0.5]])
            });

            assert.ok(result.ok, "R16F is an accepted pack format");
            assert.equal(result.componentsPerPack, 1, "one component per texture layer");
            assert.equal(result.packCount, 1, "one pack");
            assert.equal(result.channelCount, 1,
                "channelCount defaults to packCount * componentsPerPack, not packCount * 4");
            assert.equal(result.normalized, false,
                "half-float data must not be clamped by the first-pass copy");

            runtime.renderer.releasePreparedTileResource(result.resource);
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('RG16F uploads and reports two channels per pack', async function(assert) {
        const runtime = makeRuntime();
        try {
            const result = await runtime.renderer.prepareGpuTextureTile({
                data: textureSet(SIZE, SIZE, "RG16F", [[0.25, 0.75], [0.5, 1.0]])
            });

            assert.ok(result.ok, "RG16F is an accepted pack format");
            assert.equal(result.componentsPerPack, 2, "two components per texture layer");
            assert.equal(result.channelCount, 4, "two packs of two channels");
            assert.equal(result.normalized, false, "half-float, so not clamped");

            runtime.renderer.releasePreparedTileResource(result.resource);
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('an explicit channelCount still wins over the format default', async function(assert) {
        const runtime = makeRuntime();
        try {
            // Three real channels carried by two RG16F packs: the fourth component is padding
            // the source knows about. This is exactly the case componentsPerPack cannot be
            // reverse-derived from, which is why it is carried explicitly.
            const result = await runtime.renderer.prepareGpuTextureTile({
                data: textureSet(SIZE, SIZE, "RG16F", [[0.25, 0.5], [0.75, 0.0]], 3)
            });

            assert.ok(result.ok, "prepared");
            assert.equal(result.channelCount, 3, "declared channelCount is not overwritten");
            assert.equal(result.componentsPerPack, 2, "components per pack still reflect the format");

            runtime.renderer.releasePreparedTileResource(result.resource);
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('RGBA formats are unchanged', async function(assert) {
        const runtime = makeRuntime();
        try {
            const f16 = await runtime.renderer.prepareGpuTextureTile({
                data: textureSet(SIZE, SIZE, "RGBA16F", [[0.5, 0.5, 0.5, 1.0]])
            });
            assert.ok(f16.ok, "RGBA16F still prepares");
            assert.equal(f16.componentsPerPack, 4, "RGBA16F reports four components");
            assert.equal(f16.channelCount, 4, "and four channels for one pack");
            runtime.renderer.releasePreparedTileResource(f16.resource);

            const u8 = await runtime.renderer.prepareGpuTextureTile({
                data: {
                    width: SIZE,
                    height: SIZE,
                    packs: [{ format: "RGBA8", data: new Uint8Array(SIZE * SIZE * 4) }]
                }
            });
            assert.ok(u8.ok, "RGBA8 still prepares");
            assert.equal(u8.componentsPerPack, 4, "RGBA8 reports four components");
            assert.equal(u8.channelCount, 4, "and four channels for one pack");
            runtime.renderer.releasePreparedTileResource(u8.resource);
        } finally {
            runtime.destroy();
        }
    });

    // ---------------------------------------------------------------- row alignment

    QUnit.test('odd-width R16F uploads (UNPACK_ALIGNMENT)', async function(assert) {
        // An R16F row of odd width is width*2 bytes, i.e. 2 mod 4. Under the default
        // UNPACK_ALIGNMENT of 4 the driver assumes a padded row stride, demands more bytes than
        // the tightly-packed buffer holds, and raises INVALID_OPERATION. Only edge tiles of a
        // non-multiple image are odd-width, so this would ship unnoticed.
        const runtime = makeRuntime("float16", 3, 3);
        try {
            for (const width of [1, 3, 5, 7]) {
                const result = await runtime.renderer.prepareGpuTextureTile({
                    data: textureSet(width, 3, "R16F", [[0.5]])
                });

                assert.ok(result.ok,
                    `${width}x3 R16F uploads (reason: ${result.ok ? "-" : result.reason})`);
                if (result.ok) {
                    runtime.renderer.releasePreparedTileResource(result.resource);
                }
            }
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('UNPACK_ALIGNMENT is restored after a narrow upload', async function(assert) {
        const runtime = makeRuntime("float16", 3, 3);
        try {
            const gl = runtime.renderer.gl;

            const narrow = await runtime.renderer.prepareGpuTextureTile({
                data: textureSet(3, 3, "R16F", [[0.5]])
            });
            assert.ok(narrow.ok, "odd-width R16F prepared");
            runtime.renderer.releasePreparedTileResource(narrow.resource);

            assert.equal(gl.getParameter(gl.UNPACK_ALIGNMENT), 4,
                "pixel-store state is context-global; every other upload path assumes the default");

            // Failure path must restore too.
            const failed = await runtime.renderer.prepareGpuTextureTile({
                data: textureSet(3, 3, "R16F", [[0.5, 0.5]])   // wrong element count
            });
            assert.notOk(failed.ok, "a mis-sized narrow pack is rejected");
            assert.equal(gl.getParameter(gl.UNPACK_ALIGNMENT), 4,
                "and the alignment is restored even when preparation failed");

            const rgba = await runtime.renderer.prepareGpuTextureTile({
                data: {
                    width: 3,
                    height: 3,
                    packs: [{ format: "RGBA8", data: new Uint8Array(3 * 3 * 4) }]
                }
            });
            assert.ok(rgba.ok, "a following RGBA8 upload is unaffected");
            if (rgba.ok) {
                runtime.renderer.releasePreparedTileResource(rgba.resource);
            }
        } finally {
            runtime.destroy();
        }
    });

    // ---------------------------------------------------------------- validation

    QUnit.test('payload validation', async function(assert) {
        const runtime = makeRuntime();
        try {
            const wrongView = await runtime.renderer.prepareGpuTextureTile({
                data: {
                    width: SIZE,
                    height: SIZE,
                    packs: [{ format: "R16F", data: new Float32Array(SIZE * SIZE) }]
                }
            });
            assert.notOk(wrongView.ok, "a Float32Array cannot back a HALF_FLOAT upload");
            assert.equal(wrongView.reason, "unsupported-data", "reported as unsupported-data");

            const wrongLength = await runtime.renderer.prepareGpuTextureTile({
                data: {
                    width: SIZE,
                    height: SIZE,
                    // Sized for RGBA, declared as R16F.
                    packs: [{ format: "R16F", data: new Uint16Array(SIZE * SIZE * 4) }]
                }
            });
            assert.notOk(wrongLength.ok, "a buffer sized for four components is rejected");
            assert.equal(wrongLength.reason, "invalid-data", "reported as invalid-data");

            const mixed = await runtime.renderer.prepareGpuTextureTile({
                data: {
                    width: SIZE,
                    height: SIZE,
                    packs: [
                        { format: "R16F", data: halfPack(SIZE, SIZE, [0.5]) },
                        { format: "RG16F", data: halfPack(SIZE, SIZE, [0.5, 0.5]) }
                    ]
                }
            });
            assert.notOk(mixed.ok, "mixed formats within one tile are still refused");
            assert.equal(mixed.reason, "unsupported-data", "reported as unsupported-data");

            const unknown = await runtime.renderer.prepareGpuTextureTile({
                data: {
                    width: SIZE,
                    height: SIZE,
                    packs: [{ format: "RGB9_E5", data: new Uint16Array(SIZE * SIZE * 4) }]
                }
            });
            assert.notOk(unknown.ok, "an unknown format name is still refused");
            assert.equal(unknown.reason, "unsupported-data", "reported as unsupported-data");
        } finally {
            runtime.destroy();
        }
    });

    // ---------------------------------------------------------------- rendering

    QUnit.test('a narrow pack reaches the first-pass target with a format fill', async function(assert) {
        const runtime = makeRuntime("float16");
        try {
            const gl = runtime.renderer.gl;

            if (!runtime.renderer.backend.supportsHighPrecisionTargets ||
                !gl.getExtension('EXT_color_buffer_float')) {
                assert.ok(true, "float target or float readback unavailable; skipped");
                return;
            }

            await runtime.overrideConfigureAll(probeConfiguration());
            await runtime.setInputs(textureSet(SIZE, SIZE, "R16F", [[0.5]]));

            const pixels = await runtime.extractFirstPassLayer("texture", 0, {
                format: gl.RGBA,
                type: gl.FLOAT,
                result: "float32"
            });

            for (let i = 0; i < SIZE * SIZE; i++) {
                assert.ok(Math.abs(pixels[i * 4] - 0.5) < 1e-3,
                    `pixel ${i}: the one real channel survives`);
                // Pinned deliberately: for a narrow pack these are the format fill supplied by
                // texture-format conversion, NOT payload. Unlike an RGBA pack, alpha here is a
                // constant 1.0 and carries nothing.
                assert.equal(pixels[i * 4 + 1], 0, `pixel ${i}: green is the fill`);
                assert.equal(pixels[i * 4 + 2], 0, `pixel ${i}: blue is the fill`);
                assert.equal(pixels[i * 4 + 3], 1, `pixel ${i}: alpha is the fill, not data`);
            }
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('channel addressing walks across narrow packs', async function(assert) {
        const runtime = makeRuntime("float16");
        try {
            if (!runtime.renderer.backend.supportsHighPrecisionTargets) {
                assert.ok(true, "no float target available; skipped");
                return;
            }

            // Four logical channels stored as four single-component packs. Channel N therefore
            // lives in pack N, not in component N of pack 0 -- which is what the old
            // `channelIndex >> 2` mapping assumed. Values are exact in half precision and
            // distinct after the 8-bit round trip through the presentation canvas.
            const values = [0.125, 0.375, 0.625, 0.875];
            const packValues = values.map(v => [v]);

            for (let channel = 0; channel < 4; channel++) {
                const byte = await renderProbe(runtime,
                    `osd_channel(0, ${channel}, v_texture_coords)`, packValues);

                const expected = Math.round(values[channel] * 255);
                assert.ok(Math.abs(byte - expected) <= 2,
                    `channel ${channel} reads pack ${channel} (got ${byte}, want ~${expected})`);
            }

            // The metadata the addressing is derived from, read straight out of the shader.
            const counts = [
                ["osd_channel_count(0)", 4],
                ["osd_pack_count(0)", 4],
                ["osd_components_per_pack(0)", 1]
            ];
            for (const [expr, expected] of counts) {
                const byte = await renderProbe(runtime, `float(${expr}) / 8.0`, packValues);
                assert.ok(Math.abs(byte - Math.round(expected / 8 * 255)) <= 2,
                    `${expr} === ${expected} (got byte ${byte})`);
            }
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('a channel past the source count reads zero, not the last pack', async function(assert) {
        const runtime = makeRuntime("float16");
        try {
            if (!runtime.renderer.backend.supportsHighPrecisionTargets) {
                assert.ok(true, "no float target available; skipped");
                return;
            }

            // Two channels available, channel 3 requested. osd_texture clamps the pack index, so
            // without the range guard osd_channel would hand back the last pack's real value.
            const packValues = [[0.875], [0.875]];

            const inRange = await renderProbe(runtime,
                "osd_channel(0, 1, v_texture_coords)", packValues);
            assert.ok(Math.abs(inRange - 223) <= 2,
                `the last valid channel still reads its pack (got ${inRange})`);

            const outOfRange = await renderProbe(runtime,
                "osd_channel(0, 3, v_texture_coords)", packValues);
            assert.ok(outOfRange <= 2,
                `an out-of-range channel reads 0, not the clamped last pack (got ${outOfRange})`);
        } finally {
            runtime.destroy();
        }
    });

})();
