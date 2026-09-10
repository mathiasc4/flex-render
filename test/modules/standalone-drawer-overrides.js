/* global QUnit, $, OpenSeadragon, testLog */

(function() {

    // makeStandaloneFlexDrawer's second argument is the ONLY way to reach a
    // construction-time renderer option. presentationClearColor is validated once in the
    // FlexRenderer constructor and has a getter but no setter; sharedContextKey decides
    // which WebGL context the drawer joins before any of its state exists. Without the
    // argument a consumer has to mutate the LIVE viewer's drawerOptions around the
    // constructor and restore it - not concurrency-safe, and it misreports the live
    // viewer's configuration for as long as it lasts.
    //
    // The backdrop tests are the reason the argument matters in practice: the default
    // backdrop is opaque white, so every extract() raster was opaque whatever the render
    // did, and a consumer wanting an alpha channel had no way to ask for one.

    const SHARED_KEY = 'standalone-overrides-probe';
    const BLUE = [0, 0, 1, 1];
    const TRANSPARENT = [0, 0, 0, 0];

    // Nothing visible, so the second pass composites nothing and every pixel is whatever
    // the surface was cleared to - which is exactly the backdrop under test.
    function hiddenConfiguration() {
        return {
            hidden: {
                id: "hidden",
                name: "Hidden",
                type: "identity",
                visible: 0,
                tiledImages: [0],
                params: {},
                cache: {}
            }
        };
    }

    async function makeViewer(id, drawerOptions) {
        $(`<div id="${id}"></div>`).appendTo(document.body);

        // eslint-disable-next-line new-cap
        const viewer = OpenSeadragon({
            id: id,
            prefixUrl: '/openseadragon/images/',
            springStiffness: 100,
            drawer: 'flex-renderer',
            drawerOptions: { 'flex-renderer': drawerOptions },
            tileSources: '/test/data/testpattern.dzi'
        });

        await new Promise(resolve => viewer.addOnceHandler('open', resolve));

        // The standalone pass re-uses the live renderer's first-pass texture, so the live
        // drawer must have rendered at least once before extract() can run at all.
        const deadline = OpenSeadragon.now() + 10000;
        while (!viewer.drawer.renderer.__firstPassResult && OpenSeadragon.now() < deadline) {
            viewer.forceRedraw();
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return viewer;
    }

    function destroyViewer(viewer, id) {
        if (viewer) {
            viewer.destroy();
        }
        $(`#${id}`).remove();
    }

    /**
     * Every pixel of a pass that draws nothing, as [r,g,b,a] 0-255, or null when they are
     * not all the same - which is itself a failure worth reporting.
     */
    async function uniformPixelOfEmptyPass(drawer) {
        const { data } = await drawer.extract({
            result: "uint8",
            configuration: hiddenConfiguration()
        });

        if (!data.length) {
            return null;
        }

        const first = [data[0], data[1], data[2], data[3]];
        for (let i = 4; i < data.length; i += 4) {
            if ([0, 1, 2, 3].some(c => Math.abs(data[i + c] - first[c]) > 2)) {
                return null;
            }
        }
        return first;
    }

    // -------------------------------------------------------------------------
    // Private-context viewer.
    // -------------------------------------------------------------------------

    let viewer = null;

    QUnit.module('StandaloneDrawerOverrides', {
        before: async function() {
            testLog.reset();
            viewer = await makeViewer('standalone-overrides-example', {});
        },
        after: function() {
            destroyViewer(viewer, 'standalone-overrides-example');
            viewer = null;
        }
    });

    QUnit.test('an override reaches the renderer', function(assert) {
        const drawer = OpenSeadragon.makeStandaloneFlexDrawer(viewer, {
            presentationClearColor: BLUE
        });

        try {
            assert.deepEqual(drawer.renderer.presentationClearColor, BLUE,
                'the backdrop the caller asked for is the backdrop the renderer holds');
        } finally {
            drawer.destroy();
        }
    });

    QUnit.test('overriding does not touch the live viewer', function(assert) {
        const before = viewer.drawer.renderer.presentationClearColor;
        const drawer = OpenSeadragon.makeStandaloneFlexDrawer(viewer, {
            presentationClearColor: BLUE,
            backgroundColor: "#ff0000ff"
        });

        try {
            const live = viewer.drawerOptions['flex-renderer'];
            assert.strictEqual(live.presentationClearColor, undefined,
                'the override did not leak into the viewer options it was merged over');
            assert.strictEqual(live.backgroundColor, undefined,
                'nor did any other key');
            assert.deepEqual(viewer.drawer.renderer.presentationClearColor, before,
                'and the live renderer still has its own backdrop');

            // Deep merge, so the array the renderer holds is not the one the caller passed:
            // two drawers built from the same literal must not share one backdrop object.
            assert.notStrictEqual(drawer.options.presentationClearColor, BLUE,
                'the merge copied the array rather than aliasing the caller\'s');
        } finally {
            drawer.destroy();
        }
    });

    QUnit.test('the pinned options ignore an override', function(assert) {
        const drawer = OpenSeadragon.makeStandaloneFlexDrawer(viewer, {
            debug: true,
            htmlReset: function() {},
            htmlHandler: function() {},
            interactive: true,
            handleNavigator: true,
            offScreen: false
        });

        try {
            assert.strictEqual(drawer.options.debug, false, 'debug stays pinned');
            assert.strictEqual(drawer.options.htmlReset, undefined, 'htmlReset stays pinned');
            assert.strictEqual(drawer.options.htmlHandler, undefined, 'htmlHandler stays pinned');
            // The load-bearing two: interactive would have this throwaway drawer bind
            // another renderer's live controls by element id, and offScreen: false would
            // have its destroy() take the live viewer's canvas with it.
            assert.strictEqual(drawer.options.interactive, false, 'interactive stays pinned');
            assert.strictEqual(drawer.options.handleNavigator, false, 'handleNavigator stays pinned');
            assert.strictEqual(drawer.options.offScreen, true, 'offScreen stays pinned');
        } finally {
            drawer.destroy();
        }
    });

    QUnit.test('a transparent backdrop yields alpha, private context', async function(assert) {
        const transparent = OpenSeadragon.makeStandaloneFlexDrawer(viewer, {
            presentationClearColor: TRANSPARENT,
            sharedContextKey: null
        });
        const opaque = OpenSeadragon.makeStandaloneFlexDrawer(viewer, {
            sharedContextKey: null
        });

        try {
            assert.strictEqual(transparent.renderer.isSharedContext(), false,
                'the drawer under test is private-context');

            const clear = await uniformPixelOfEmptyPass(transparent);
            assert.ok(clear !== null, 'the pass produced a uniform raster');
            assert.ok(clear && clear[3] <= 2,
                `an uncovered pixel is transparent, got alpha ${clear && clear[3]}`);

            // The regression guard: without an override the same pass is opaque white, so
            // the assertion above measures the override and not a change of default.
            const white = await uniformPixelOfEmptyPass(opaque);
            assert.ok(white !== null, 'the default-backdrop pass produced a uniform raster');
            assert.ok(white && white[3] >= 253,
                `the default backdrop is still opaque, got alpha ${white && white[3]}`);
        } finally {
            transparent.destroy();
            opaque.destroy();
        }
    });

    // -------------------------------------------------------------------------
    // Shared-context viewer. The backdrop lives in a different place here: the
    // color target is cleared to [0,0,0,0] whatever the backdrop is, and the
    // backdrop is re-applied by the 2D copy-out - guarded on a non-zero alpha,
    // which is what makes the transparent case work.
    // -------------------------------------------------------------------------

    let sharedViewer = null;

    QUnit.module('StandaloneDrawerOverridesShared', {
        before: async function() {
            testLog.reset();
            sharedViewer = await makeViewer('standalone-overrides-shared-example', {
                sharedContextKey: SHARED_KEY
            });
        },
        after: function() {
            destroyViewer(sharedViewer, 'standalone-overrides-shared-example');
            sharedViewer = null;
        }
    });

    QUnit.test('a transparent backdrop yields alpha, shared context', async function(assert) {
        const drawer = OpenSeadragon.makeStandaloneFlexDrawer(sharedViewer, {
            presentationClearColor: TRANSPARENT
        });

        try {
            assert.strictEqual(drawer.renderer.isSharedContext(), true,
                'the drawer inherited the shared context, so the copy-out fill is under test');

            const clear = await uniformPixelOfEmptyPass(drawer);
            assert.ok(clear !== null, 'the pass produced a uniform raster');
            assert.ok(clear && clear[3] <= 2,
                `the copy-out skipped the backdrop fill, got alpha ${clear && clear[3]}`);
        } finally {
            drawer.destroy();
        }
    });

    QUnit.test('sharedContextKey: null opts a drawer out of a shared viewer', function(assert) {
        assert.strictEqual(sharedViewer.drawer.renderer.isSharedContext(), true,
            'the live drawer is shared, so there is something to opt out of');

        const drawer = OpenSeadragon.makeStandaloneFlexDrawer(sharedViewer, {
            sharedContextKey: null
        });

        try {
            assert.strictEqual(drawer.renderer.isSharedContext(), false,
                'the standalone drawer took a private context');
            assert.notStrictEqual(drawer.renderer.gl, sharedViewer.drawer.renderer.gl,
                'and a context of its own, not the shared one');
        } finally {
            drawer.destroy();
        }
    });

})();
