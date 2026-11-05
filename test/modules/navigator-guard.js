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

})();
