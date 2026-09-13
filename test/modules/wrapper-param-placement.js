/* global QUnit, OpenSeadragon */

/**
 * `params` is the only place a wrapper shader's own settings may live.
 *
 * `channel-series` and `time-series` read theirs through what is now
 * `ShaderLayer.readWrapperParam`, which used to fall back from `config.params[name]` to a top-level
 * `config[name]`. The published JSON Schema compiles those settings into the `params` sub-schema
 * only and closes every layer object with `additionalProperties: false`, so a config using the
 * tolerated top-level placement rendered correctly and failed validation -- and since no `oneOf`
 * branch then matched, one misplaced key was reported once per registered shader type.
 *
 * The fallback is gone. Legacy configs keep working because both wrappers now hoist the top-level
 * keys into `params` in `normalizeConfig()`, and `FlexRenderer.createShaderLayer()` runs
 * normalization on every creation path (it previously ran only in the standalone runtime, which is
 * why the fallback was load-bearing).
 */
(function() {

    const ShaderLayer = OpenSeadragon.FlexRenderer.ShaderLayer;
    const Registry = OpenSeadragon.FlexRenderer.ShaderLayerRegistry;

    function captureWarnings(fn) {
        const previous = OpenSeadragon.console;
        const warnings = [];
        OpenSeadragon.console = Object.assign({}, previous, {
            warn: msg => warnings.push(String(msg))
        });
        try {
            fn();
        } finally {
            OpenSeadragon.console = previous;
        }
        return warnings;
    }

    function normalize(config) {
        let warnings;
        const normalized = (() => {
            let result;
            warnings = captureWarnings(() => {
                result = OpenSeadragon.FlexRenderer.normalizeShaderConfig(config, { source: "test" });
            });
            return result;
        })();
        return { config: normalized, warnings };
    }

    QUnit.module('WrapperParamPlacement');

    QUnit.test('the top-level fallback is gone', function(assert) {
        assert.strictEqual(
            ShaderLayer.readWrapperParam({ channelRenderer: "colormap" }, "channelRenderer"),
            undefined,
            "a top-level key is not read as an alternative spelling");
        assert.strictEqual(
            ShaderLayer.readWrapperParam({ params: { channelRenderer: "colormap" } }, "channelRenderer"),
            "colormap",
            "params is read");
        assert.strictEqual(
            ShaderLayer.readWrapperParam({}, "channelRenderer", "single_channel"),
            "single_channel",
            "and the declared default still applies");
    });

    QUnit.test('time-series lifts its legacy top-level settings into params', function(assert) {
        const outcome = normalize({
            id: "ts",
            type: "time-series",
            seriesRenderer: "identity",
            series: [0, 1]
        });
        const config = outcome.config;

        assert.deepEqual(config.params.series, [0, 1], "series moved into params");
        assert.strictEqual(config.params.seriesRenderer, "identity", "seriesRenderer moved into params");
        assert.strictEqual(config.series, undefined, "the top-level series is removed");
        assert.strictEqual(config.seriesRenderer, undefined, "and so is the top-level seriesRenderer");

        assert.ok(outcome.warnings.some(w => w.indexOf("'series'") !== -1 && w.indexOf("ts") !== -1),
            "the move is reported with the key and the shader id");
    });

    QUnit.test('channel-series lifts its legacy top-level settings the same way', function(assert) {
        const outcome = normalize({
            id: "cs",
            type: "channel-series",
            channelRenderer: "single_channel",
            channelRendererConfig: { params: { color: "#ff0000" } },
            sourceIndex: 2
        });
        const config = outcome.config;

        assert.strictEqual(config.params.channelRenderer, "single_channel", "channelRenderer moved into params");
        assert.deepEqual(config.params.channelRendererConfig, { params: { color: "#ff0000" } },
            "channelRendererConfig moved into params");
        assert.strictEqual(config.params.sourceIndex, 2, "sourceIndex moved into params");

        ["channelRenderer", "channelRendererConfig", "sourceIndex"].forEach(key => {
            assert.strictEqual(config[key], undefined, `the top-level ${key} is removed`);
        });

        assert.ok(outcome.warnings.some(w => w.indexOf("'sourceIndex'") !== -1 && w.indexOf("cs") !== -1),
            "the move is reported with the key and the shader id");
    });

    QUnit.test('when both placements are given, params wins and the duplicate is removed',
        function(assert) {
            const outcome = normalize({
                id: "cs_conflict",
                type: "channel-series",
                channelRenderer: "colormap",
                params: { channelRenderer: "single_channel" }
            });
            const config = outcome.config;

            assert.strictEqual(config.params.channelRenderer, "single_channel",
                "the params value is kept");
            assert.strictEqual(config.channelRenderer, undefined,
                "and the top-level copy is removed rather than left to drift");
            assert.ok(outcome.warnings.some(w => w.indexOf("both at the") !== -1),
                "the conflict is reported, not silently resolved");
        });

    // createShaderLayer() runs normalization, so normalizing an already-normalized config must be a
    // no-op -- otherwise every layer refresh would keep mutating it.
    QUnit.test('normalization is idempotent', function(assert) {
        [
            { id: "ts", type: "time-series", seriesRenderer: "identity", series: [0, 1] },
            { id: "cs", type: "channel-series", channelRenderer: "single_channel", sourceIndex: 1 }
        ].forEach(input => {
            const once = normalize(input).config;
            const snapshot = JSON.stringify(once);
            const twice = normalize(once).config;

            assert.strictEqual(JSON.stringify(twice), snapshot,
                `${input.type}: a second normalization pass changes nothing`);
        });
    });

    QUnit.test('createShaderLayer normalizes, so the drawer path no longer needs the fallback',
        async function(assert) {
            const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
                uniqueId: `wrapperplacement_${Math.floor(Math.random() * 1e9)}`,
                width: 4,
                height: 4
            });

            try {
                // Straight at createShaderLayer, deliberately bypassing normalizeShaderMap -- this is
                // the shape drawer.overrideConfigureAll() takes.
                const config = {
                    id: "cs_direct",
                    type: "channel-series",
                    visible: 1,
                    tiledImages: [0],
                    channelRenderer: "single_channel",
                    sourceIndex: 0
                };

                let shader = null;
                captureWarnings(() => {
                    shader = runtime.renderer.createShaderLayer("cs_direct", config, false);
                });

                assert.ok(shader, "the layer was created");

                const stored = shader.getConfig();
                assert.strictEqual(stored.params.channelRenderer, "single_channel",
                    "the setting reached params without the caller normalizing first");
                assert.strictEqual(stored.channelRenderer, undefined,
                    "and the top-level key is gone");
            } finally {
                runtime.destroy();
            }
        });

    QUnit.test('the wrappers agree with each other about where their settings live', function(assert) {
        ["time-series", "channel-series"].forEach(type => {
            const Klass = Registry.get(type);
            assert.ok(Klass, `${type} is registered`);
            assert.strictEqual(typeof Klass.normalizeConfig, "function",
                `${type} declares normalizeConfig`);
            assert.notStrictEqual(Klass.normalizeConfig, ShaderLayer.normalizeConfig,
                `${type} overrides the base no-op rather than inheriting it`);

            // Every setting the shader publishes to the schema must be reachable from params.
            const declared = Object.keys(Klass.customParams || {});
            assert.ok(declared.length > 0, `${type} declares customParams`);
        });
    });

})();
