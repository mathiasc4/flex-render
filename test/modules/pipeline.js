/* global QUnit, OpenSeadragon */

/**
 * Pre/post ShaderModule pipeline on every ShaderLayer (`params.pipeline`).
 *
 * `post` wraps the layer's compute function, `pre` wraps every non-raw sampleChannel(...).
 * Node values are flattened controls (`pre_<node>_<ctl>` / `post_<node>_<ctl>`) living in a
 * type-independent cache bucket; the on/off switch is a bool uniform. Legacy use_gamma /
 * use_exposure / use_logscale filters run as pre nodes.
 */
(function() {

    const $ = OpenSeadragon;
    const UIControls = $.FlexRenderer.UIControls;
    const SIZE = 2;
    const AjvModule = window.ajv2020 || window.ajv7 || window.Ajv;
    const Ajv = (AjvModule && typeof AjvModule.default === "function") ? AjvModule.default : AjvModule;

    async function withSilencedConsole(fn) {
        const previous = $.console;
        const silent = { log() {}, debug() {}, info() {}, warn() {}, error() {}, assert() {} };
        $.console = silent;
        try {
            return await fn();
        } finally {
            $.console = previous;
        }
    }

    function layer(id, type, params, extra = {}) {
        return Object.assign({
            id, name: id, type, visible: 1, tiledImages: [0], params: params || {}, cache: {}
        }, extra);
    }

    function levelsPipeline(extra = {}) {
        return Object.assign({
            enabled: true,
            post: [{ id: "xadj_levels", type: "levels", params: { black: 0.05 } }]
        }, extra);
    }

    /**
     * Configure, build the second pass and hand the live runtime to `fn`.
     */
    async function withRuntime(config, fn) {
        const runtime = $.makeStandaloneFlexRenderer({
            uniqueId: `pipeline_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });
        const renderer = runtime.renderer;
        const key = renderer.backend.secondPassProgramKey;
        const failed = [];
        const onFailed = e => failed.push(e);
        renderer.addHandler("shader-program-failed", onFailed);
        try {
            let error = null;
            try {
                await withSilencedConsole(async () => {
                    await runtime.overrideConfigureAll(config);
                    renderer.registerProgram(null, key);
                });
            } catch (e) {
                error = e;
            }
            const source = () => {
                const program = renderer.getProgram(key);
                return (program && program.fragmentShader) || "";
            };
            return await fn({ runtime, renderer, key, error, failed, source });
        } finally {
            renderer.removeHandler("shader-program-failed", onFailed);
            runtime.destroy();
        }
    }

    function assertLinks(assert, ctx, label) {
        assert.strictEqual(ctx.error, null, `${label}: links` + (ctx.error ? ` (${ctx.error.message})` : ""));
        assert.equal(ctx.failed.length, 0, `${label}: no shader-program-failed`);
    }

    let reports = [];

    QUnit.module("ShaderLayerPipeline", {
        beforeEach: function() {
            reports = [];
            UIControls.setReporter((level, code, details) => reports.push({ level, code, details }));
        },
        afterEach: function() {
            UIControls.setReporter(null);
        }
    });

    QUnit.test("a post node wraps the layer's compute function and links", async function(assert) {
        await withRuntime({ bg: layer("bg", "identity", { pipeline: levelsPipeline() }) }, async ctx => {
            assertLinks(assert, ctx, "identity + post levels");
            const shader = ctx.renderer.getShaderLayer("bg");
            const compute = ctx.renderer.backend.getShaderLayerComputeName(shader);
            const src = ctx.source();
            assert.ok(src.includes(`vec4 ${compute}_body()`), "layer body moved to <compute>_body");
            assert.ok(src.includes(`return ${shader.uid}_pipeline_post(${compute}_body());`),
                "compute applies the post chain");
            assert.ok(/uniform bool pipeline_enabled_/.test(src), "enabled switch is a uniform");
            assert.ok(typeof shader.resetPipeline === "function", "feature-detectable API");
        });
    });

    QUnit.test("pre wraps sampled values; raw samplers are left alone", async function(assert) {
        const pre = { pre: [{ id: "g", type: "gamma", params: { gamma: 1.4 } }] };
        await withRuntime({
            bg: layer("bg", "identity", { pipeline: pre }),
            st: layer("st", "stain-separation", { pipeline: pre })
        }, async ctx => {
            assertLinks(assert, ctx, "identity + stain with pre");
            const bg = ctx.renderer.getShaderLayer("bg");
            const st = ctx.renderer.getShaderLayer("st");
            const src = ctx.source();
            assert.ok(bg.sampleChannel("v_texture_coords").startsWith(`${bg.uid}_pipeline_pre(`),
                "sampleChannel goes through the pre chain");
            assert.notOk(bg.sampleChannel("v_texture_coords", 0, true).includes("_pipeline_pre("),
                "raw sampling bypasses it");
            assert.ok(src.includes(`${bg.uid}_pipeline_pre(`), "identity body calls pre");
            const stBody = src.split(`// ${st.uid} - Shader code execution`)[1] || "";
            assert.notOk(stBody.split("// ")[0].includes(`${st.uid}_pipeline_pre(`),
                "stain-separation (raw sampler) body does not call pre");
        });
    });

    QUnit.test("getPipelineControl and value changes do not relink", async function(assert) {
        await withRuntime({ bg: layer("bg", "identity", { pipeline: levelsPipeline() }) }, async ctx => {
            const shader = ctx.renderer.getShaderLayer("bg");
            shader.init();
            const black = shader.getPipelineControl("post", "xadj_levels", "black");
            assert.ok(black, "control resolved without reconstructing the flat name");
            assert.strictEqual(black.name, "post_xadj_levels_black", "flattened name");
            assert.strictEqual(Number(black.encoded), 0.05, "seeded from node params");
            assert.strictEqual(shader.getPipelineControl("post", "nope", "black"), undefined, "unknown node");
            assert.strictEqual(shader.getPipelineControl("mid", "xadj_levels", "black"), undefined, "unknown stage");

            const program = ctx.renderer.getProgram(ctx.key);
            const linkedBefore = program.webGLProgram;
            let relinks = 0;
            const original = ctx.renderer.registerProgram;
            ctx.renderer.registerProgram = function() {
                relinks++;
                return original.apply(this, arguments);
            };
            try {
                black.set(0.2);
                shader.setPipelineEnabled(false);
                assert.notOk(shader.isPipelineEnabled(), "toggled off");
                shader.setPipelineEnabled(true);
                assert.ok(shader.isPipelineEnabled(), "toggled on");
            } finally {
                ctx.renderer.registerProgram = original;
            }
            assert.strictEqual(relinks, 0, "value change and toggle never relink");
            assert.strictEqual(ctx.renderer.getProgram(ctx.key).webGLProgram, linkedBefore, "same program");
            assert.strictEqual(shader.getConfig().cache.__pipeline.post_xadj_levels_black, 0.2,
                "value lives in the type-independent bucket");
            assert.strictEqual(shader.getConfig().params.pipeline.enabled, true, "toggle mirrored to params");
        });
    });

    QUnit.test("adjustments survive changeShaderType", async function(assert) {
        await withRuntime({ bg: layer("bg", "identity", { pipeline: levelsPipeline() }) }, async ctx => {
            let shader = ctx.renderer.getShaderLayer("bg");
            shader.init();
            shader.getPipelineControl("post", "xadj_levels", "white").set(0.7);

            await withSilencedConsole(() => ctx.renderer.changeShaderType("bg", "heatmap"));
            assert.ok(ctx.renderer.getShaderLayer("bg").getConfig().params.pipeline,
                "params.pipeline kept by the type-change sanitizer");
            await withSilencedConsole(() => ctx.renderer.changeShaderType("bg", "identity"));

            shader = ctx.renderer.getShaderLayer("bg");
            shader.init();
            assert.strictEqual(shader.getConfig().type, "identity", "back to identity");
            const white = shader.getPipelineControl("post", "xadj_levels", "white");
            assert.ok(white, "pipeline rebuilt after the type change");
            assert.strictEqual(Number(white.encoded), 0.7, "value restored from cache.__pipeline");
        });
    });

    QUnit.test("resetPipeline adds and removes nodes", async function(assert) {
        await withRuntime({ bg: layer("bg", "identity", {}) }, async ctx => {
            const shader = ctx.renderer.getShaderLayer("bg");
            assert.notOk(ctx.source().includes("_pipeline_"), "no pipeline, no pipeline GLSL");

            shader.getConfig().params.pipeline = {
                post: [
                    { id: "sat", type: "saturation", params: { saturation: 0.5 } },
                    { id: "inv", type: "invert", params: { amount: 0 } }
                ]
            };
            shader.resetPipeline();
            await withSilencedConsole(() => ctx.renderer.registerProgram(null, ctx.key));
            assert.ok(shader.getPipelineControl("post", "sat", "saturation"), "node added");
            assert.ok(ctx.source().includes(`${shader.uid}_pipeline_post(`), "post emitted after rebuild");

            shader.getConfig().params.pipeline.post = [];
            shader.resetPipeline();
            await withSilencedConsole(() => ctx.renderer.registerProgram(null, ctx.key));
            assert.strictEqual(shader.getPipelineControl("post", "sat", "saturation"), undefined, "node removed");
            assert.notOk("post_sat_saturation" in shader._controls, "its control is gone");
            assert.notOk(ctx.source().includes("_pipeline_post("), "post chain gone");
        });
    });

    QUnit.test("every adjustment module links, alone and chained twice", async function(assert) {
        const types = ["levels", "brightness-contrast", "saturation", "hue-rotate",
            "color-temperature", "invert", "gamma", "exposure", "logscale"];
        const post = [];
        types.forEach((type, i) => {
            post.push({ id: `a${i}`, type });
            post.push({ id: `b${i}`, type });
        });
        await withRuntime({
            bg: layer("bg", "identity", { pipeline: { pre: post.slice(0, 4), post } }),
            hm: layer("hm", "heatmap", { pipeline: { post: post.slice(0, 6) } })
        }, async ctx => {
            assertLinks(assert, ctx, "all modules, repeated");
            assert.deepEqual(reports.filter(r => /pipeline/.test(r.code)), [], "no pipeline warnings");
        });
    });

    QUnit.test("two gamma and two invert nodes in one modular graph compile", async function(assert) {
        const graph = {
            nodes: {
                src: { type: "sample-source-channel", params: { sourceIndex: 0, channelIndex: 0 } },
                col: { type: "colorize", inputs: { value: "src.value" }, params: { color: "#00ffff" } },
                g1: { type: "gamma", inputs: { color: "col.color" } },
                g2: { type: "gamma", inputs: { color: "g1.adjusted" } },
                i1: { type: "invert", inputs: { color: "g2.color" } },
                i2: { type: "invert", inputs: { color: "i1.inverted" } }
            },
            output: "i2.color"
        };
        await withRuntime({ m: layer("m", "modular", { graph }) }, async ctx => {
            assertLinks(assert, ctx, "repeated gamma/invert");
            const src = ctx.source();
            assert.notOk(/vec4 color = /.test(src), "no bare 'color' local");
            assert.notOk(/\.rbg\b/.test(src), "no swapped swizzle");
        });
    });

    QUnit.test("module float controls are de-normalized", function(assert) {
        const Gamma = $.FlexRenderer.ShaderModuleRegistry.get("gamma");
        const fakeControl = { type: "float", params: { min: 0.1, max: 10 }, sample: () => "u_g" };
        const node = new Gamma("g", { uid: "x_g", owner: { m_g_gamma: fakeControl }, config: {} });
        const expr = node.sampleValue("gamma");
        assert.ok(/0\.100000 \+ 9\.900000 \* u_g/.test(expr), `mix(min, max, u): ${expr}`);
        assert.ok($.FlexRenderer.ShaderModule.isPipelineCapable(Gamma), "gamma is pipeline capable");
        assert.notOk($.FlexRenderer.ShaderModule.isPipelineCapable(
            $.FlexRenderer.ShaderModuleRegistry.get("colorize")), "colorize is not");
    });

    QUnit.test("legacy use_gamma runs as a pre node under the toggle", async function(assert) {
        await withRuntime({
            bg: layer("bg", "identity", { use_gamma: 2 }) // eslint-disable-line camelcase
        }, async ctx => {
            assertLinks(assert, ctx, "legacy gamma");
            const shader = ctx.renderer.getShaderLayer("bg");
            shader.init();
            const control = shader.getPipelineControl("pre", "legacy_gamma", "gamma");
            assert.ok(control, "migrated to a pre node");
            assert.strictEqual(Number(control.encoded), 2, "value taken from use_gamma");
            assert.notOk(/exp\(log\(/.test(ctx.source()), "old one-liner gone");
            assert.ok(ctx.source().includes(`${shader.uid}_pipeline_pre(`), "sampling uses pre");

            shader.getConfig().params.use_gamma = 3; // eslint-disable-line camelcase
            shader.resetFilters(shader.getConfig().params, true, false);
            await withSilencedConsole(() => ctx.renderer.registerProgram(null, ctx.key));
            shader.init();
            assert.strictEqual(Number(shader.getPipelineControl("pre", "legacy_gamma", "gamma").encoded), 3,
                "use_gamma stays authoritative over the cache");
            shader.setPipelineEnabled(false);
            assert.notOk(shader.isPipelineEnabled(), "toggle also covers legacy nodes");
        });
    });

    QUnit.test("invalid nodes are skipped with a warning, the layer still renders", async function(assert) {
        await withRuntime({
            bg: layer("bg", "identity", {
                pipeline: {
                    post: [
                        { id: "bad id", type: "levels" },
                        { id: "c", type: "colorize" },
                        { id: "u", type: "no-such-module" },
                        { id: "ok", type: "levels" },
                        { id: "ok", type: "saturation" }
                    ]
                }
            })
        }, async ctx => {
            assertLinks(assert, ctx, "invalid nodes");
            const shader = ctx.renderer.getShaderLayer("bg");
            assert.ok(shader.getPipelineControl("post", "ok", "black"), "valid node kept");
            assert.strictEqual(shader.getPipelineControl("post", "ok", "saturation"), undefined,
                "duplicate id skipped");
            assert.strictEqual(reports.filter(r => r.code === "pipeline-node-invalid").length, 4,
                "one warning per skipped node");
            assert.notOk(shader.getConfig().error, "layer not marked as error");
        });
    });

    QUnit.test("htmlControls renders pipeline controls unless includePipeline is false", async function(assert) {
        await withRuntime({ bg: layer("bg", "identity", { pipeline: levelsPipeline() }) }, async ctx => {
            const shader = ctx.renderer.getShaderLayer("bg");
            shader._interactive = true;
            for (const name of ["post_xadj_levels_black"]) {
                shader._controls[name]._params.interactive = true;
            }
            assert.ok(shader.htmlControls().includes("post_xadj_levels_black"), "rendered by default");
            assert.notOk(shader.htmlControls({ includePipeline: false }).includes("post_xadj_levels_black"),
                "hidden on request");
        });
    });

    QUnit.test("published schema accepts params.pipeline on every layer", function(assert) {
        const ShaderConfigurator = $.FlexRenderer.ShaderConfigurator;
        const model = ShaderConfigurator.compileConfigSchemaModel();
        assert.ok(model.$defs.shaderLayerPipeline, "pipeline published in $defs");
        assert.ok(model.$defs.shaderLayerPipelineNodes.levels, "levels is a pipeline node type");
        assert.notOk(model.$defs.shaderLayerPipelineNodes.colorize, "colorize is not");

        const ajv = new Ajv({ allErrors: true, strict: false, discriminator: true });
        const compile = type => ajv.compile({ ...model.$defs.shaderLayers[type], $defs: model.$defs });
        const identity = compile("identity");
        const pipeline = levelsPipeline({ pre: [{ id: "g", type: "gamma", params: { gamma: 1.4 } }] });

        assert.ok(identity({ id: "bg", type: "identity", params: { pipeline } }),
            "identity accepts it: " + JSON.stringify(identity.errors));
        assert.ok(compile("heatmap")({ id: "h", type: "heatmap", params: { pipeline } }), "heatmap too");
        assert.notOk(identity({ id: "bg", type: "identity", params: { pipeline: { post: [], extra: 1 } } }),
            "unknown key under pipeline rejected");
        assert.notOk(identity({ id: "bg", type: "identity",
            params: { pipeline: { post: [{ id: "x", type: "colorize" }] } } }),
            "non-vec4 module rejected");
    });


    QUnit.test("setPipelineBypass is transient: uniform only, no params, cache or event", async function(assert) {
        await withRuntime({
            bg: layer("bg", "identity", {
                use_gamma: 2, // eslint-disable-line camelcase
                pipeline: levelsPipeline({ pre: [{ id: "sat", type: "saturation", params: { saturation: 1.5 } }] })
            })
        }, async ctx => {
            assertLinks(assert, ctx, "bypass layer");
            const shader = ctx.renderer.getShaderLayer("bg");
            shader.init();
            const src = ctx.source();
            const bypass = `${shader.uid}_pipeline_bypass`;
            assert.ok(src.includes(`uniform bool ${bypass};`), "bypass uniform declared");
            assert.equal(src.split(`!${bypass}`).length - 1, 3, "guards the pre, legacy and post chains");

            const config = shader.getConfig();
            const paramsBefore = JSON.stringify(config.params);
            const cacheBefore = JSON.stringify(config.cache);
            const events = [];
            const notify = ctx.renderer.notifyVisualizationChanged;
            ctx.renderer.notifyVisualizationChanged = function(e) {
                events.push(e);
                return notify.apply(this, arguments);
            };
            let relinks = 0;
            const register = ctx.renderer.registerProgram;
            ctx.renderer.registerProgram = function() {
                relinks++;
                return register.apply(this, arguments);
            };
            try {
                assert.notOk(shader.isPipelineBypassed(), "off by default");
                shader.setPipelineBypass(true);
                assert.ok(shader.isPipelineBypassed(), "bypassed");
                assert.ok(shader.isPipelineEnabled(), "the persisted toggle is untouched");
                shader.setPipelineBypass(false);
                assert.notOk(shader.isPipelineBypassed(), "back on");
                shader.setPipelineBypass(true);
            } finally {
                ctx.renderer.notifyVisualizationChanged = notify;
                ctx.renderer.registerProgram = register;
            }
            assert.equal(events.length, 0, "no visualization-change");
            assert.equal(relinks, 0, "no relink");
            assert.strictEqual(JSON.stringify(config.params), paramsBefore, "params untouched");
            assert.strictEqual(JSON.stringify(config.cache), cacheBefore, "cache untouched");

            // the uniform reaches the GPU
            const program = ctx.renderer.getProgram(ctx.key);
            const gl = ctx.renderer.gl;
            gl.useProgram(program.webGLProgram);
            shader.glDrawing(program.webGLProgram, gl);
            const location = gl.getUniformLocation(program.webGLProgram, bypass);
            assert.ok(location, "uniform location resolved");
            assert.strictEqual(!!gl.getUniform(program.webGLProgram, location), true, "uploaded value is true");

            shader.resetPipeline(config.params, false);
            assert.ok(shader.isPipelineBypassed(), "survives a pipeline rebuild");
            config.params.pipeline = { post: [] };
            delete config.params.use_gamma;
            shader.resetFilters(config.params, true, false);
            assert.notOk(shader.isPipelineBypassed(), "dropped with the pipeline");
        });
    });

    QUnit.test("setPipelineBypass on a layer without a pipeline is a no-op", async function(assert) {
        await withRuntime({ bg: layer("bg", "identity", {}) }, async ctx => {
            const shader = ctx.renderer.getShaderLayer("bg");
            shader.init();
            shader.setPipelineBypass(true);
            assert.notOk(shader.isPipelineBypassed(), "ignored");
            assert.notOk(ctx.source().includes("_pipeline_bypass"), "no uniform emitted");
        });
    });

    QUnit.test("setPipelineEnabled without a pipeline uses the __pipeline bucket", async function(assert) {
        await withRuntime({ bg: layer("bg", "identity", {}) }, async ctx => {
            const shader = ctx.renderer.getShaderLayer("bg");
            shader.init();
            shader.setPipelineEnabled(false);
            const cache = shader.getConfig().cache;
            assert.strictEqual(cache.__pipeline && cache.__pipeline.pipeline_enabled, false,
                "stored in cache.__pipeline");
            const typeBucket = cache.identity || {};
            assert.strictEqual(typeBucket.pipeline_enabled, undefined, "not in the per-type bucket");

            const params = shader.getConfig().params;
            params.pipeline = { post: [{ id: "lv", type: "levels" }] };
            shader.resetPipeline(params, false);
            await withSilencedConsole(() => ctx.renderer.registerProgram(null, ctx.key));
            shader.init();
            assert.notOk(shader.isPipelineEnabled(), "a later pipeline starts disabled");
        });
    });

    QUnit.test("resetFilters without options reads params; tolerates a missing backend", async function(assert) {
        await withRuntime({ bg: layer("bg", "identity", { use_gamma: 2 }) }, async ctx => { // eslint-disable-line camelcase
            const shader = ctx.renderer.getShaderLayer("bg");
            shader.init();
            shader.__legacyFilterNodes = [];
            shader.resetFilters(undefined, true, false);
            assert.deepEqual(shader.__legacyFilterNodes.map(n => n.id), ["legacy_gamma"],
                "fell back to the layer params");
            const backend = shader.backend;
            shader.backend = null;
            try {
                shader.resetFilters({}, true, true);
                assert.ok(true, "no throw without a backend");
            } finally {
                shader.backend = backend;
            }
        });
    });

    function assertWrapperLegacy(assert, ctx, wrapper, delegate, label) {
        assertLinks(assert, ctx, label);
        const src = ctx.source();
        assert.deepEqual(wrapper._pipeline && wrapper._pipeline.stages.pre.map(n => n.id), ["legacy_gamma"],
            `${label}: delegate's legacy node runs in the wrapper pipeline`);
        assert.notOk(/exp\(log\(/.test(src), `${label}: no inline gamma one-liner`);
        assert.ok(delegate.sampleChannel("v_texture_coords").startsWith(`${wrapper.uid}_pipeline_pre(`),
            `${label}: delegate sampling uses the wrapper pre chain`);
        assert.ok(src.includes(`!${wrapper.uid}_pipeline_bypass`), `${label}: bypass guards it`);
        assert.ok(/uniform bool pipeline_enabled_/.test(src), `${label}: toggle guards it`);
        wrapper.setPipelineBypass(true);
        assert.ok(wrapper.isPipelineBypassed() && delegate.isPipelineBypassed(), `${label}: bypass shared`);
    }

    QUnit.test("time-series: the delegate's legacy filters run in the wrapper's pipeline", async function(assert) {
        await withRuntime({
            ts: layer("ts", "time-series", { seriesRenderer: "identity", series: [0], use_gamma: 2 }) // eslint-disable-line camelcase
        }, async ctx => {
            const wrapper = ctx.renderer.getShaderLayer("ts");
            assertWrapperLegacy(assert, ctx, wrapper, wrapper._renderer, "time-series");

            // a wrapper filter change (navigator sync path) reaches the delegate
            wrapper.getConfig().params.use_gamma = 3; // eslint-disable-line camelcase
            wrapper.resetFilters(wrapper.getConfig().params, true, false);
            assert.strictEqual(wrapper._renderer.__legacyFilterNodes[0].params.gamma, 3, "delegate refreshed");
            assert.strictEqual(wrapper._pipeline.getControlParams("pre_legacy_gamma_gamma"), 3,
                "wrapper pipeline rebuilt with the new value");
        });
    });

    QUnit.test("channel-series: the delegate's legacy filters run in the wrapper's pipeline", async function(assert) {
        await withRuntime({
            cs: layer("cs", "channel-series", {
                channelRenderer: "identity",
                sourceIndex: 0,
                channelRendererConfig: { params: { use_gamma: 2 } } // eslint-disable-line camelcase
            })
        }, async ctx => {
            const wrapper = ctx.renderer.getShaderLayer("cs");
            assertWrapperLegacy(assert, ctx, wrapper, wrapper._delegateShader, "channel-series");
        });
    });

})();
