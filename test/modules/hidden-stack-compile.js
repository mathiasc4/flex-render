/* global QUnit, OpenSeadragon */

/**
 * Hiding layers must never produce a program that fails to compile.
 *
 * `visible: 0` swaps a layer body for a placeholder compute function and its stack slot for
 * comments. A report of "FRAGMENT_SHADER: ERROR: '{' : syntax error" after hiding the last visible
 * layer could not be reproduced from HEAD, so this module is a wide net rather than a single
 * repro: every registered layer type hidden, visible and mixed; groups (nested, empty, colliding
 * child ids); string visibility values; and a malformed global include. Every assembled source is
 * also checked structurally (balanced braces/parens, no empty `if ()`, no duplicate compute
 * functions) so a regression points at its cause instead of at a driver error line.
 */
(function() {

    const $ = OpenSeadragon;
    const SIZE = 2;

    async function withSilencedConsole(fn) {
        const previous = $.console;
        $.console = Object.assign({}, previous, {
            log: () => {},
            info: () => {},
            warn: () => {},
            error: () => {}
        });
        try {
            return await fn();
        } finally {
            $.console = previous;
        }
    }

    function makeRuntime() {
        return $.makeStandaloneFlexRenderer({
            uniqueId: `hiddenstack_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });
    }

    function stripComments(src) {
        return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    }

    /**
     * Structural sanity of an assembled fragment shader. Returns a list of problems; empty = ok.
     */
    function sourceProblems(src) {
        const problems = [];
        const imbalance = $.FlexRenderer.findGlslImbalance(src);
        if (imbalance) {
            const lines = src.split("\n");
            const from = Math.max(0, imbalance.line - 4);
            const excerpt = lines.slice(from, imbalance.line + 3)
                .map((line, i) => `${from + i + 1}: ${line}`).join("\n");
            problems.push(`unbalanced at line ${imbalance.line} of ${lines.length}: ` +
                `${imbalance.reason}\n${excerpt}`);
        }
        const code = stripComments(src);
        if (/\bif\s*\(\s*\)/.test(code)) {
            problems.push("empty if ()");
        }
        const names = {};
        const re = /\bvec4\s+(fr_(?:compute|stack)_\w+)\s*\(\s*\)\s*\{/g;
        let match;
        while ((match = re.exec(code))) {
            names[match[1]] = (names[match[1]] || 0) + 1;
        }
        const duplicates = Object.keys(names).filter(name => names[name] > 1);
        if (duplicates.length) {
            problems.push(`duplicate functions: ${duplicates.join(", ")}`);
        }
        return problems;
    }

    /**
     * Configure, build the second pass, and report {error, failedEvents, problems, source}.
     */
    async function build(runtime, config) {
        const renderer = runtime.renderer;
        const key = renderer.backend.secondPassProgramKey;
        const failedEvents = [];
        const onFailed = e => failedEvents.push(e);
        renderer.addHandler("shader-program-failed", onFailed);
        let error = null;
        try {
            await withSilencedConsole(async () => {
                await runtime.overrideConfigureAll(config);
                renderer.registerProgram(null, key);
            });
        } catch (e) {
            error = e;
        } finally {
            renderer.removeHandler("shader-program-failed", onFailed);
        }
        const program = renderer.getProgram(key);
        const source = program && program.fragmentShader || "";
        return { error, failedEvents, problems: sourceProblems(source), source, renderer };
    }

    function assertLinks(assert, result, label) {
        assert.strictEqual(result.error, null, `${label}: links` +
            (result.error ? ` (${result.error.message})` : ""));
        assert.equal(result.failedEvents.length, 0, `${label}: no shader-program-failed`);
        assert.deepEqual(result.problems, [], `${label}: source is structurally sound`);
    }

    function exampleConfig(type, id, visible) {
        const Shader = $.FlexRenderer.ShaderLayerRegistry.get(type);
        const sources = typeof Shader.sources === "function" ? Shader.sources() : [];
        let example = null;
        try {
            example = $.FlexRenderer.ShaderConfigurator._buildShaderLayerExamples(Shader, sources)[0];
        } catch (e) {
            example = null;
        }
        const config = example ? JSON.parse(JSON.stringify(example)) : { type, params: {} };
        config.id = id;
        config.name = id;
        config.type = type;
        config.visible = visible;
        config.tiledImages = (sources || []).map(() => 0);
        config.cache = {};
        config.params = config.params || {};
        return config;
    }

    // Types whose visible body cannot assemble in a bare standalone runtime (no viewer, no
    // interaction, no data references). Hidden/mixed variants still run for them.
    function standaloneVisibleSkip(type) {
        return type === "group" || type === "modular" || type === "interaction_debug" ||
            type === "time-series" || type === "test_rebuild_probe";
    }

    QUnit.module('HiddenStackCompile');

    QUnit.test('every registered layer type: all hidden, all visible, hidden among visible', async function(assert) {
        const types = $.FlexRenderer.ShaderLayerRegistry.availableTypes()
            .filter(type => type !== "none" && !/^test_/.test(type));
        assert.ok(types.length > 10, `${types.length} registered types`);

        const runtime = makeRuntime();
        try {
            for (const type of types) {
                const hidden = {};
                ["h1", "h2", "h3"].forEach(id => {
                    hidden[id] = exampleConfig(type, id, 0);
                });
                assertLinks(assert, await build(runtime, hidden), `${type} x3 hidden`);

                const mixed = {
                    below: { id: "below", name: "below", type: "identity", visible: 1, tiledImages: [0], params: {}, cache: {} },
                    target: exampleConfig(type, "target", 0),
                    above: { id: "above", name: "above", type: "identity", visible: 1, tiledImages: [0], params: {}, cache: {} }
                };
                assertLinks(assert, await build(runtime, mixed), `${type} hidden between visible`);

                const clip = {
                    base: { id: "base", name: "base", type: "identity", visible: 1, tiledImages: [0], params: {}, cache: {} },
                    target: exampleConfig(type, "target", 0)
                };
                clip.target.params.use_mode = "clip";
                assertLinks(assert, await build(runtime, clip), `${type} hidden clip layer`);

                if (!standaloneVisibleSkip(type)) {
                    const visible = {};
                    ["v1", "v2", "v3"].forEach(id => {
                        visible[id] = exampleConfig(type, id, 1);
                    });
                    const result = await build(runtime, visible);
                    assertLinks(assert, result, `${type} x3 visible`);
                }
            }
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('visibility values that mean hidden are hidden', async function(assert) {
        const runtime = makeRuntime();
        try {
            for (const visible of [0, false, "0", "false", "", null]) {
                const config = {
                    a: { id: "a", name: "a", type: "heatmap", visible: visible, tiledImages: [0],
                        params: { use_channel0: "r" }, cache: {} }
                };
                const result = await build(runtime, config);
                assertLinks(assert, result, `visible=${JSON.stringify(visible)}`);
                const uid = result.renderer.getShaderLayer("a").uid;
                assert.ok(result.source.indexOf(`// ${uid} - Disabled, hidden, or error placeholder`) !== -1,
                    `visible=${JSON.stringify(visible)} emits the placeholder`);
            }
            for (const visible of [1, true, "1", "true", undefined]) {
                const config = {
                    a: { id: "a", name: "a", type: "heatmap", visible: visible, tiledImages: [0],
                        params: { use_channel0: "r" }, cache: {} }
                };
                const result = await build(runtime, config);
                const uid = result.renderer.getShaderLayer("a").uid;
                assert.ok(result.source.indexOf(`// ${uid} - Definition`) !== -1,
                    `visible=${JSON.stringify(visible)} emits the layer body`);
            }
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('string visibility is normalized in place', function(assert) {
        const config = { id: "a", type: "identity", visible: "0" };
        $.FlexRenderer.normalizeShaderConfig(config);
        assert.strictEqual(config.visible, 0, '"0" becomes 0');
        const nested = { id: "g", type: "group", visible: 1, shaders: { c: { id: "c", type: "identity", visible: "false" } } };
        $.FlexRenderer.normalizeShaderConfig(nested);
        assert.strictEqual(nested.shaders.c.visible, 0, "group children are normalized too");
        assert.strictEqual($.FlexRenderer.isShaderConfigActive({ type: "identity" }), true, "missing visible = visible");
        assert.strictEqual($.FlexRenderer.isShaderConfigActive({ type: "identity", visible: 1, error: true }), false,
            "error layers are inactive");
    });

    function identity(id, visible = 1) {
        return { id, name: id, type: "identity", visible, tiledImages: [0], params: {}, cache: {} };
    }
    function heatmap(id, visible = 1) {
        return { id, name: id, type: "heatmap", visible, tiledImages: [0], params: { use_channel0: "r" }, cache: {} };
    }
    function group(id, shaders, extra = {}) {
        return Object.assign({ id, name: id, type: "group", visible: 1, tiledImages: [], params: {}, cache: {}, shaders }, extra);
    }

    QUnit.test('groups: hidden children, hidden groups, nesting, empty, missing ids, collisions', async function(assert) {
        const runtime = makeRuntime();
        try {
            assertLinks(assert, await build(runtime, {
                g: group("g", { a: heatmap("a", 0), b: identity("b", 0) })
            }), "group with every child hidden");

            assertLinks(assert, await build(runtime, {
                g: group("g", { a: heatmap("a"), b: identity("b") }, { visible: 0 })
            }), "hidden group with visible children");

            assertLinks(assert, await build(runtime, {
                outer: group("outer", {
                    hiddenLeaf: heatmap("hiddenLeaf", 0),
                    inner: group("inner", { leaf: heatmap("leaf"), off: identity("off", 0) })
                })
            }), "nested groups, only the innermost child visible");

            assertLinks(assert, await build(runtime, {
                outer: group("outer", { inner: group("inner", { leaf: heatmap("leaf", 0) }) })
            }), "nested groups, everything hidden");

            assertLinks(assert, await build(runtime, { g: group("g", {}) }), "empty group");

            const missing = await build(runtime, {
                g: group("g", { a: heatmap("a") }, { order: ["a", "ghost"] })
            });
            assertLinks(assert, missing, "group order naming a missing child");
            assert.deepEqual(missing.renderer.getShaderLayer("g").shaderLayerOrder, ["a"],
                "missing ids are dropped from the group order");

            assertLinks(assert, await build(runtime, {
                a: heatmap("a"),
                g1: group("g1", { a: heatmap("a") }),
                g2: group("g2", { a: heatmap("a") })
            }), "same child id and type in two groups and at the root (visible)");

            assertLinks(assert, await build(runtime, {
                a: heatmap("a", 0),
                g1: group("g1", { a: heatmap("a", 0) }),
                g2: group("g2", { a: heatmap("a", 0) })
            }), "same child id and type in two groups and at the root (hidden)");

            assertLinks(assert, await build(runtime, {
                g: group("g", { a: identity("a") }),
                // eslint-disable-next-line camelcase
                g_stack: group("g_stack", { b: identity("b") })
            }), "group 'g' next to group 'g_stack'");
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('a malformed layer or global include is isolated', async function(assert) {
        const Base = $.FlexRenderer.ShaderLayer;
        $.FlexRenderer.ShaderLayerRegistry.register(class extends Base {
            static type() {
                return "test_unbalanced_layer";
            }
            static name() {
                return "Unbalanced (test)";
            }
            static sources() {
                return [{ acceptsChannelCount: () => true, description: "any" }];
            }
            getFragmentShaderDefinition() {
                return super.getFragmentShaderDefinition() + "\nfloat test_unbalanced_fn() {\n    return 1.0;\n";
            }
            getFragmentShaderExecution() {
                return "    return vec4(1.0);";
            }
        });
        $.FlexRenderer.ShaderLayerRegistry.register(class extends Base {
            static type() {
                return "test_bad_include";
            }
            static name() {
                return "Bad include (test)";
            }
            static sources() {
                return [{ acceptsChannelCount: () => true, description: "any" }];
            }
            construct() {
                super.construct();
                this.includeGlobalCode("test_bad_include", "void test_bad_include_fn() {");
            }
            getFragmentShaderExecution() {
                return "    return vec4(1.0);";
            }
        });

        const includes = Base.__globalIncludes;
        const runtime = makeRuntime();
        try {
            const broken = await build(runtime, {
                ok: heatmap("ok"),
                bad: { id: "bad", name: "bad", type: "test_unbalanced_layer", visible: 1, tiledImages: [0], params: {}, cache: {} }
            });
            assertLinks(assert, broken, "an unbalanced visible layer does not break the program");
            assert.ok(broken.renderer.getShaderLayer("bad").getConfig().error, "the unbalanced layer is marked as error");

            const polluted = await build(runtime, {
                inc: { id: "inc", name: "inc", type: "test_bad_include", visible: 0, tiledImages: [0], params: {}, cache: {} },
                a: heatmap("a", 0)
            });
            assert.notOk(includes.test_bad_include, "the unbalanced global include was refused");
            assertLinks(assert, polluted, "an all-hidden program after a malformed include links");
        } finally {
            delete includes.test_bad_include;
            runtime.destroy();
        }
    });

    QUnit.module('HiddenStackCompileDrawer', {
        beforeEach: function() {
            const element = document.createElement("div");
            element.id = "hidden-stack-viewer";
            element.style.width = "200px";
            element.style.height = "200px";
            document.getElementById("qunit-fixture").appendChild(element);
        },
        afterEach: function() {
            if (this.viewer && !this.viewer.isDestroyed()) {
                this.viewer.destroy();
            }
            this.viewer = null;
        }
    });

    QUnit.test('hiding every layer of a live viewer one by one keeps a working program', function(assert) {
        const done = assert.async();
        // eslint-disable-next-line new-cap
        const viewer = this.viewer = $({
            id: "hidden-stack-viewer",
            prefixUrl: "/openseadragon/images/",
            drawer: "flex-renderer",
            drawerOptions: { "flex-renderer": { handleNavigator: true } },
            showNavigator: true,
            springStiffness: 100,
            tileSources: "/test/data/testpattern.dzi"
        });
        viewer.addHandler("open", async () => {
            const drawer = viewer.drawer;
            const failed = [];
            const onFailed = e => failed.push(e);
            drawer.renderer.addHandler("shader-program-failed", onFailed);
            try {
                const config = {
                    heat: { id: "heat", name: "heat", type: "heatmap", visible: 1, tiledImages: [0],
                        params: { use_channel0: "r", threshold: 10 }, cache: {} },
                    map: { id: "map", name: "map", type: "colormap", visible: 1, tiledImages: [0],
                        params: { use_channel0: "r" }, cache: {} },
                    thr: { id: "thr", name: "thr", type: "threshold", visible: 1, tiledImages: [0],
                        params: { use_channel0: "r" }, cache: {} },
                    pat: { id: "pat", name: "pat", type: "patternmap", visible: 1, tiledImages: [0],
                        params: { use_channel0: "r" }, cache: {} }
                };
                await withSilencedConsole(() => drawer.overrideConfigureAll(config, undefined, { immediate: true }));

                const ids = Object.keys(config);
                // first half via direct config edit + rebuild, second half via the mutation API
                for (let i = 0; i < ids.length; i++) {
                    const id = ids[i];
                    if (i < 2) {
                        drawer.getOverriddenShaderConfig(id).visible = 0;
                        await withSilencedConsole(() => drawer._requestRebuild(0, true, true, true));
                    } else {
                        await withSilencedConsole(() => drawer._applyShaderConfigMutationRequest({
                            shaderId: id, mutation: { visible: 0 }
                        }));
                        await withSilencedConsole(() => drawer._requestRebuild(0, true, true, true));
                    }
                    const program = drawer.renderer.getProgram(drawer.renderer.backend.secondPassProgramKey);
                    assert.deepEqual(sourceProblems(program.fragmentShader), [],
                        `source sound after hiding ${i + 1}/${ids.length}`);
                }

                viewer.forceRedraw();
                await new Promise(resolve => setTimeout(resolve, 50));
                const gl = drawer.renderer.gl;
                assert.equal(gl.getError(), gl.NO_ERROR, "no GL error after drawing the all-hidden stack");
                assert.equal(failed.length, 0, "no shader-program-failed on the main renderer");
                const nav = viewer.navigator && viewer.navigator.drawer;
                if (nav && nav.renderer) {
                    const navProgram = nav.renderer.getProgram(nav.renderer.backend.secondPassProgramKey);
                    if (navProgram) {
                        assert.deepEqual(sourceProblems(navProgram.fragmentShader), [], "navigator source sound");
                    }
                }
            } catch (e) {
                assert.ok(false, `unexpected throw: ${e && e.message}`);
            } finally {
                drawer.renderer && drawer.renderer.removeHandler("shader-program-failed", onFailed);
                done();
            }
        });
    });
})();
