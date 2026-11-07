/* global QUnit, OpenSeadragon */

/**
 * Navigator mirroring must survive a missing navigator drawer.
 *
 * The OpenSeadragon navigator -- and so its drawer -- is created asynchronously. FlexDrawer#rebuild
 * used to dereference viewer.navigator.drawer unguarded, so a rebuild before the navigator drawer
 * existed threw, and hosts turned handleNavigator off to dodge it. These tests pin the guard and the
 * catch-up: mirroring skipped while the navigator drawer is missing is replayed once it appears.
 */
(function() {

    function identityConfig(ids) {
        const config = {};
        ids.forEach(id => {
            config[id] = {
                id: id,
                name: id,
                type: "identity",
                visible: 1,
                tiledImages: [0],
                params: {},
                cache: {}
            };
        });
        return config;
    }

    QUnit.module('NavigatorGuard', {
        beforeEach: function() {
            const element = document.createElement("div");
            element.id = "navigator-guard-viewer";
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

    function openViewer(testCase, showNavigator, body) {
        const done = testCase.assert.async();
        // eslint-disable-next-line new-cap
        const viewer = testCase.viewer = OpenSeadragon({
            id: "navigator-guard-viewer",
            prefixUrl: "/openseadragon/images/",
            drawer: "flex-renderer",
            drawerOptions: { "flex-renderer": { handleNavigator: true } },
            showNavigator: showNavigator,
            springStiffness: 100,
            tileSources: "/test/data/testpattern.dzi"
        });
        viewer.addHandler('open', async function() {
            try {
                await body(viewer);
            } catch (e) {
                testCase.assert.ok(false, `unexpected throw: ${e && e.message}`);
            } finally {
                done();
            }
        });
    }

    QUnit.test('mirroring calls do not throw without a navigator', function(assert) {
        this.assert = assert;
        assert.expect(4);

        openViewer(this, false, async viewer => {
            const drawer = viewer.drawer;
            assert.ok(drawer.options.handleNavigator, "navigator mirroring is requested");

            await drawer.overrideConfigureAll(identityConfig(["a"]), undefined, { immediate: true });
            assert.ok(drawer.getOverriddenShaderConfig("a"), "overrideConfigureAll applied on the main drawer");

            await drawer.rebuild();
            assert.ok(true, "rebuild() completed");
            assert.ok(drawer._navigatorSyncPending, "the skipped mirror is marked pending");
        });
    });

    QUnit.test('rebuild before the navigator drawer exists does not throw', function(assert) {
        this.assert = assert;
        assert.expect(2);

        openViewer(this, true, async viewer => {
            const drawer = viewer.drawer;
            const navigator = viewer.navigator;
            // a navigator whose drawer is not wired yet
            viewer.navigator = {};
            try {
                await drawer.rebuild();
                assert.ok(true, "rebuild() completed");
                assert.ok(drawer._navigatorSyncPending, "the skipped mirror is marked pending");
            } finally {
                viewer.navigator = navigator;
            }
        });
    });

    QUnit.test('skipped external configuration is replayed when the navigator drawer appears', function(assert) {
        this.assert = assert;
        assert.expect(5);

        openViewer(this, true, async viewer => {
            const drawer = viewer.drawer;
            const navigator = viewer.navigator;
            const navDrawer = navigator.drawer;

            viewer.navigator = undefined;
            try {
                await drawer.overrideConfigureAll(identityConfig(["a", "b"]), ["b", "a"], { immediate: true });
                await drawer.rebuild();
            } finally {
                viewer.navigator = navigator;
            }
            assert.ok(drawer._navigatorSyncPending, "the skipped mirror is marked pending");
            assert.notOk(navDrawer.renderer.getAllShaders().a, "the navigator missed the configuration");

            drawer._onNavigatorDrawerReady(navDrawer);

            assert.notOk(drawer._navigatorSyncPending, "the pending mirror is consumed");
            assert.ok(navDrawer._configuredExternally, "the navigator is externally configured");
            assert.deepEqual(navDrawer.renderer.getShaderLayerOrder(), drawer.renderer.getShaderLayerOrder(),
                "the navigator mirrors the main shader order");
        });
    });

    QUnit.test('replayed external configuration keeps shader ids for ids that need sanitizing', function(assert) {
        this.assert = assert;
        assert.expect(3);

        openViewer(this, true, async viewer => {
            const drawer = viewer.drawer;
            const navigator = viewer.navigator;
            const navDrawer = navigator.drawer;

            const shaders = identityConfig(["layer 1", "a.b"]);
            viewer.navigator = undefined;
            try {
                await drawer.overrideConfigureAll(shaders, ["a.b", "layer 1"], { immediate: true });
            } finally {
                viewer.navigator = navigator;
            }
            drawer._onNavigatorDrawerReady(navDrawer);

            const mainIds = Object.keys(drawer.renderer.getAllShaders()).sort();
            assert.deepEqual(mainIds, ["ab", "layer1"], "the main drawer sanitized the ids");
            assert.deepEqual(Object.keys(navDrawer.renderer.getAllShaders()).sort(), mainIds,
                "the navigator holds the same shader ids");
            assert.deepEqual(navDrawer.renderer.getShaderLayerOrder(), drawer.renderer.getShaderLayerOrder(),
                "and the same order");
        });
    });

    /**
     * The navigator's tiled image loads after the main one, so wait for it before inspecting
     * the navigator drawer.
     */
    function navigatorItemLoaded(navigator) {
        if (navigator.world.getItemCount()) {
            return Promise.resolve(navigator.world.getItemAt(0));
        }
        return new Promise(resolve => {
            navigator.world.addOnceHandler('add-item', e => resolve(e.item));
        });
    }

    function heatmapConfig() {
        return { name: "heatmap", type: "heatmap", visible: 1, params: {}, cache: {} };
    }

    async function navigatorShaderFor(navigator, shaderId) {
        await navigatorItemLoaded(navigator);
        await navigator.drawer.rebuild();
        return navigator.drawer.renderer.getShaderLayer(shaderId);
    }

    QUnit.test('configureTiledImage on open reaches the navigator item that loads later', function(assert) {
        this.assert = assert;
        assert.expect(2);

        openViewer(this, true, async viewer => {
            const shader = viewer.drawer.configureTiledImage(viewer.world.getItemAt(0), heatmapConfig());

            const navShader = await navigatorShaderFor(viewer.navigator, shader.id);
            assert.ok(navShader, "the navigator has a shader under the configured id");
            assert.strictEqual(navShader && navShader.constructor.type(), "heatmap",
                "and it is the configured type, not the identity fallback");
        });
    });

    QUnit.test('configureTiledImage before the navigator drawer exists reaches the navigator', function(assert) {
        this.assert = assert;
        assert.expect(3);

        openViewer(this, true, async viewer => {
            const drawer = viewer.drawer;
            const navigator = viewer.navigator;

            viewer.navigator = undefined;
            let shader;
            try {
                shader = drawer.configureTiledImage(viewer.world.getItemAt(0), heatmapConfig());
            } finally {
                viewer.navigator = navigator;
            }
            assert.ok(drawer._navigatorSyncPending, "the skipped mirror is marked pending");
            drawer._onNavigatorDrawerReady(navigator.drawer);

            const navShader = await navigatorShaderFor(navigator, shader.id);
            assert.ok(navShader, "the navigator has a shader under the configured id");
            assert.strictEqual(navShader && navShader.constructor.type(), "heatmap",
                "and it is the configured type, not the identity fallback");
        });
    });

    QUnit.test('copyShaderConfig: the navigator shares the copied config instead of copying again', function(assert) {
        this.assert = assert;
        assert.expect(2);

        openViewer(this, true, async viewer => {
            const drawer = viewer.drawer;
            const navigator = viewer.navigator;
            const navTiledImage = await navigatorItemLoaded(navigator);
            drawer.options.copyShaderConfig = true;
            navigator.drawer.options.copyShaderConfig = true;

            const input = heatmapConfig();
            const shader = drawer.configureTiledImage(viewer.world.getItemAt(0), input);
            assert.notStrictEqual(shader, input, "the main drawer copied the argument");
            assert.strictEqual(navTiledImage.__shaderConfig, shader,
                "the navigator item shares the main drawer's config object");
        });
    });

    QUnit.test('setMinificationFilter before the navigator drawer exists is replayed', function(assert) {
        this.assert = assert;
        assert.expect(3);

        openViewer(this, true, async viewer => {
            const drawer = viewer.drawer;
            const navigator = viewer.navigator;
            const navDrawer = navigator.drawer;

            viewer.navigator = undefined;
            try {
                drawer.setMinificationFilter("max");
            } finally {
                viewer.navigator = navigator;
            }
            assert.ok(drawer._navigatorSyncPending, "the skipped mirror is marked pending");
            assert.strictEqual(navDrawer.renderer.getMinificationFilter(), "default", "the navigator missed it");

            drawer._onNavigatorDrawerReady(navDrawer);
            assert.strictEqual(navDrawer.renderer.getMinificationFilter(), "max", "the navigator caught up");
        });
    });

})();
