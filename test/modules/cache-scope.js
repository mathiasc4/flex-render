/* global QUnit, OpenSeadragon */

/**
 * Control values are cached per shader type, `config.cache[type][name]`.
 *
 * 3.x builds flattened the cache to `config.cache[name]`, so all types shared one key space: a
 * layer that was once a heatmap kept `cache.color = "#2962ff"`, and as a colormap its
 * custom_colormap control loaded that string, rejected it and fell back to grayscale instead of the
 * authored `params.default`. Flat caches are migrated to the current type's bucket, values that do
 * not fit their control are dropped, and every such fallback reaches the host through
 * `UIControls.setReporter()` and the renderer's `shader-warning` event.
 */
(function() {

    const $ = OpenSeadragon;
    const UIControls = $.FlexRenderer.UIControls;
    const SIZE = 2;
    const PALETTE = ["#000000", "#ff0000", "#00ff00"];

    function colormapLayer(cache, paletteDefault = PALETTE) {
        return {
            id: "cmap",
            name: "cmap",
            type: "colormap",
            visible: 1,
            tiledImages: [0],
            params: {
                color: { type: "custom_colormap", default: paletteDefault }
            },
            cache: cache
        };
    }

    // Controls init on the first use of the program; run that step directly.
    const initAll = runtime => {
        const shaders = runtime.renderer.getAllShaders();
        for (const id in shaders) {
            shaders[id].init();
        }
    };

    async function configure(config, onRuntime = null) {
        const runtime = $.makeStandaloneFlexRenderer({
            uniqueId: `cachescope_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });
        const warnings = [];
        const onWarning = e => warnings.push(e);
        runtime.renderer.addHandler("shader-warning", onWarning);
        try {
            await runtime.overrideConfigureAll(config);
            if (onRuntime) {
                await onRuntime(runtime);
            }
            const configs = {};
            for (const [id, shader] of Object.entries(runtime.renderer.getAllShaders())) {
                configs[id] = shader.getConfig();
            }
            return { warnings, configs };
        } finally {
            runtime.renderer.removeHandler("shader-warning", onWarning);
            runtime.destroy();
        }
    }

    let reports = [];

    QUnit.module("CacheScope", {
        beforeEach: function() {
            reports = [];
            UIControls.setReporter((level, code, details) => reports.push({ level, code, details }));
        },
        afterEach: function() {
            UIControls.setReporter(null);
        }
    });

    QUnit.test("normalizeCacheRoot moves a flat cache into the current type's bucket", function(assert) {
        const ShaderLayer = $.FlexRenderer.ShaderLayer;
        const root = { color: "#2962ff", opacity: 0.5 };
        const config = { type: "colormap", cache: root };
        ShaderLayer.normalizeCacheRoot(config);

        assert.strictEqual(config.cache, root, "root identity is kept");
        assert.deepEqual(root, { colormap: { color: "#2962ff", opacity: 0.5 } }, "flat keys moved");

        const bucketed = { heatmap: { color: "#2962ff" }, colormap: { opacity: 1 } };
        const copy = JSON.parse(JSON.stringify(bucketed));
        ShaderLayer.normalizeCacheRoot({ type: "colormap", cache: bucketed });
        assert.deepEqual(bucketed, copy, "an already bucketed root is untouched");
    });

    QUnit.test("values are scoped per type and restored when switching back", async function(assert) {
        const config = {
            layer: {
                id: "layer", name: "layer", type: "identity", visible: 1, tiledImages: [0],
                params: {}, cache: {}
            }
        };
        await configure(config, runtime => {
            const shader = runtime.renderer.getAllShaders().layer;
            const live = { layer: shader.getConfig() };
            shader.storeProperty("probe", 42);
            assert.strictEqual(live.layer.cache.identity.probe, 42, "stored under the type");

            live.layer.type = "heatmap";
            assert.strictEqual(shader.loadProperty("probe", "none"), "none", "another type does not see it");
            shader.storeProperty("probe", "heat");

            live.layer.type = "identity";
            assert.strictEqual(shader.loadProperty("probe", "none"), 42, "switching back restores it");
            assert.strictEqual(live.layer.cache.heatmap.probe, "heat", "the other bucket is kept");

            shader.storeProperty("probe", undefined);
            assert.notOk("probe" in live.layer.cache.identity, "storing undefined removes the entry");
        });
    });

    QUnit.test("a flat cache with a foreign value falls back to params.default", async function(assert) {
        let value = null;
        const { warnings, configs: config } = await configure({ cmap: colormapLayer({ color: "#2962ff" }) },
            runtime => {
                initAll(runtime);
                value = runtime.renderer.getAllShaders().cmap.color.value;
            });

        assert.deepEqual(Object.keys(config.cmap.cache), ["colormap"], "flat cache migrated");
        assert.notOk("color" in config.cmap.cache.colormap, "the bad entry is dropped");
        assert.deepEqual(value, PALETTE, "the control uses the authored palette");

        const rejected = reports.filter(r => r.code === "cache-value-rejected");
        assert.equal(rejected.length, 1, "reporter got cache-value-rejected");
        assert.strictEqual(rejected[0].details.layerId, "cmap");
        assert.strictEqual(rejected[0].details.control, "color");
        assert.strictEqual(rejected[0].details.value, "#2962ff");
        assert.ok(warnings.some(w => w.code === "cache-value-rejected" && w.layerId === "cmap"),
            "renderer raised shader-warning");
    });

    QUnit.test("an invalid palette falls back to params.default, then supports.default, and is stored", async function(assert) {
        await configure({ cmap: colormapLayer({}) }, runtime => {
            initAll(runtime);
            const shader = runtime.renderer.getAllShaders().cmap;
            const control = shader.color;

            control.set("#2962ff");
            assert.deepEqual(control.value, PALETTE, "falls back to the authored params.default");
            assert.deepEqual(shader.cache.color, PALETTE, "and stores it over the bad value");
            assert.ok(reports.some(r => r.code === "palette-invalid"), "reporter got palette-invalid");

            // getParams() already type-checks params.default; force the last resort directly.
            control.params.default = "not-a-palette";
            assert.deepEqual(control._normalizePalette(null), control.supports.default,
                "an invalid params.default falls back to supports.default");
        });
    });

    QUnit.test("a layer marked config.error raises shader-warning", async function(assert) {
        const Base = $.FlexRenderer.ShaderLayer;
        if (!$.FlexRenderer.ShaderLayerRegistry.get("test_cache_scope_broken")) {
            $.FlexRenderer.ShaderLayerRegistry.register(class extends Base {
                static type() {
                    return "test_cache_scope_broken";
                }
                static name() {
                    return "Broken (test)";
                }
                static sources() {
                    return [{ acceptsChannelCount: () => true, description: "any" }];
                }
                getFragmentShaderDefinition() {
                    return super.getFragmentShaderDefinition() + "\nfloat test_cache_scope_fn() {\n";
                }
                getFragmentShaderExecution() {
                    return "    return vec4(1.0);";
                }
            });
        }

        const { warnings, configs } = await configure({
            bad: { id: "bad", name: "bad", type: "test_cache_scope_broken", visible: 1,
                tiledImages: [0], params: {}, cache: {} }
        }, runtime => runtime.renderer.registerProgram(null, runtime.renderer.backend.secondPassProgramKey));

        assert.ok(configs.bad.error, "the layer is marked as error");
        const warning = warnings.find(w => w.code === "layer-assembly-failed");
        assert.ok(warning, "shader-warning raised");
        assert.strictEqual(warning && warning.layerId, "bad");
        assert.strictEqual(warning && warning.level, "error");
        assert.ok(reports.some(r => r.code === "layer-assembly-failed"), "reporter got it as well");
    });

    QUnit.test("reporter falls back to the console when cleared or throwing", function(assert) {
        const previous = $.console;
        const logged = [];
        $.console = Object.assign({}, previous, {
            warn: (...args) => logged.push(["warn", args]),
            error: (...args) => logged.push(["error", args])
        });
        try {
            UIControls.setReporter(null);
            UIControls.report("warn", "test-code", { message: "plain" });
            assert.equal(logged.length, 1, "no reporter: console");

            UIControls.setReporter(() => {
                throw new Error("boom");
            });
            UIControls.report("error", "test-code", { message: "thrown" });
            assert.ok(logged.some(([level, args]) => level === "error" &&
                String(args[0]).indexOf("thrown") !== -1), "throwing reporter: console");
        } finally {
            $.console = previous;
        }
    });
})();
