/* global QUnit, OpenSeadragon */

/**
 * Shader/node ids must be GLSL-safe in one consistent way: idPattern, sanitizeKey and the graph
 * analyzer agree that a trailing '_' is invalid (generated names append '_<suffix>', forming the
 * reserved '__'), and ids that collapse onto the same sanitized key are rejected instead of one
 * layer silently replacing the other.
 */
(function() {
    const $ = OpenSeadragon;

    QUnit.module('KeySanitize');

    QUnit.test('idPattern and sanitizeKey agree on trailing underscores', function(assert) {
        const pattern = $.FlexRenderer.idPattern;
        assert.ok(pattern.test("blur"), "plain id is valid");
        assert.ok(pattern.test("a_b"), "inner single '_' is valid");
        assert.notOk(pattern.test("blur_"), "trailing '_' is invalid");
        assert.notOk(pattern.test("_blur"), "leading '_' is invalid");
        assert.notOk(pattern.test("a__b"), "'__' is invalid");

        assert.strictEqual($.FlexRenderer.sanitizeKey("blur_"), "blur", "trailing '_' stripped");
        assert.strictEqual($.FlexRenderer.sanitizeKey("a.b__"), "ab", "mixed invalid chars and trailing '_'");
        assert.strictEqual($.FlexRenderer.sanitizeKey(5), 5, "numeric keys pass through");
        assert.throws(() => $.FlexRenderer.sanitizeKey("__"), /removed all parts/, "all-underscore key throws");
    });

    QUnit.test('graph analyzer rejects a trailing-underscore node id with a valid suggestion', function(assert) {
        const owner = { id: "graph_owner", uid: "graph_owner", constructor: { type: () => "modular" } };
        const analysis = $.FlexRenderer.ShaderModuleGraphAnalyzer.analyze(owner, {
            nodes: { blur_: { type: "gamma" } },
            output: "blur_.color"
        });
        const diagnostic = (analysis.diagnostics || []).find(d => d.code === "invalid-node-id");
        assert.ok(diagnostic, "invalid-node-id diagnostic reported");
        assert.strictEqual(diagnostic && diagnostic.details.suggestedId, "blur", "suggestion is itself valid");
        assert.ok($.FlexRenderer.idPattern.test("blur"), "suggested id passes idPattern");
    });

    QUnit.test('assertUniqueSanitizedKeys rejects colliding ids', function(assert) {
        assert.throws(() => $.FlexRenderer.assertUniqueSanitizedKeys(["a", "a_"], "ctx"),
            /ctx: shader ids 'a' and 'a_' both map to 'a'/, "'a' and 'a_' collide");
        assert.throws(() => $.FlexRenderer.assertUniqueSanitizedKeys(["a.b", "ab"]),
            /both map to 'ab'/, "'a.b' and 'ab' collide");
        $.FlexRenderer.assertUniqueSanitizedKeys(["a", "b", "layer 1"]);
        assert.ok(true, "distinct ids pass");
    });

    QUnit.module('KeySanitizeDrawer', {
        beforeEach: function() {
            const element = document.createElement("div");
            element.id = "key-sanitize-viewer";
            element.style.width = "200px";
            element.style.height = "200px";
            document.getElementById("qunit-fixture").appendChild(element);
        },
        afterEach: function() {
            if (this.viewer) {
                this.viewer.destroy();
                this.viewer = null;
            }
        }
    });

    function identity(id) {
        return { id, name: id, type: "identity", visible: 1, tiledImages: [0], params: {}, cache: {} };
    }

    function openViewer(testCase, assert, body) {
        const done = assert.async();
        // eslint-disable-next-line new-cap
        const viewer = testCase.viewer = OpenSeadragon({
            id: "key-sanitize-viewer",
            prefixUrl: "/openseadragon/images/",
            drawer: "flex-renderer",
            showNavigator: false,
            springStiffness: 100,
            tileSources: "/test/data/testpattern.dzi"
        });
        viewer.addHandler('open', async function() {
            try {
                await body(viewer);
            } catch (e) {
                assert.ok(false, `unexpected throw: ${e && e.message}`);
            } finally {
                done();
            }
        });
    }

    QUnit.test('overrideConfigureAll rejects colliding ids and keeps the previous shaders', function(assert) {
        openViewer(this, assert, async viewer => {
            const drawer = viewer.drawer;
            await drawer.overrideConfigureAll({ keep: identity("keep") }, undefined, { immediate: true });

            assert.throws(() => drawer.overrideConfigureAll({ a: identity("a"), a_: identity("a_") }),
                /both map to 'a'/, "collision throws");
            assert.deepEqual(Object.keys(drawer.renderer.getAllShaders()), ["keep"], "previous shaders intact");
        });
    });

    QUnit.test('getOverriddenShaderConfig sanitizes the lookup key', function(assert) {
        openViewer(this, assert, async viewer => {
            const drawer = viewer.drawer;
            await drawer.overrideConfigureAll({ foo_: identity("foo_") }, undefined, { immediate: true });

            assert.ok(drawer.getOverriddenShaderConfig("foo_"), "raw key finds the shader");
            assert.ok(drawer.getOverriddenShaderConfig("foo"), "sanitized key finds the shader");
            assert.strictEqual(drawer.getOverriddenShaderConfig("__"), undefined, "unsanitizable key returns undefined");
        });
    });

})();
