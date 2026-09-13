/* global QUnit, OpenSeadragon */

/**
 * A world holding exactly one tiled image used to render nothing at all.
 *
 * Two independent faults lined up. First, `SecondPassProgram.build()` takes an early path when the
 * render order is empty and passed an empty body straight through to the fragment template, which
 * emitted `void main() {}` while still declaring `layout(location=0) out vec4 final_color;`. A
 * declared output that nothing assigns makes every draw a GL_INVALID_OPERATION ("Active draw
 * buffers with missing fragment shader outputs") and the canvas stays white -- the program links,
 * so nothing upstream reports a fault.
 *
 * Second, the render order could reach that empty state while layers were registered.
 * `setShaderLayerOrder([])` stored the empty array, and an empty array is truthy, so
 * `getShaderLayerOrder()`'s `|| Object.keys(this._shaders)` fallback never ran again. The drawer
 * derives that array from `world._items.filter(item => item.__shaderConfig)`, and
 * `tiledImageCreated` deletes `__shaderConfig` during the external-config reset window. With one
 * world item that filter empties completely; with two or more a survivor keeps it non-empty. That
 * asymmetry is why the failure looked like it depended on the number of images.
 *
 * The discriminator test below is the one that pins the original report: it asserts one tiled image
 * behaves the same as two, which is exactly what was false.
 */
(function() {

    const SIZE = 4;

    function identityConfig(ids) {
        const config = {};
        ids.forEach((id, index) => {
            config[id] = {
                id: id,
                name: id,
                type: "identity",
                visible: 1,
                tiledImages: [0],
                params: { use_mode: index === 0 ? "show" : "blend" }, // eslint-disable-line camelcase
                cache: {}
            };
        });
        return config;
    }

    // main() is emitted as `void main() {\n${body}\n}`, so an empty body leaves only whitespace
    // between the braces.
    function hasEmptyMain(source) {
        return /void\s+main\s*\(\s*\)\s*\{\s*\}/.test(String(source));
    }

    QUnit.module('EmptyOrderBlank');

    QUnit.test('an empty render order still writes the declared output', function(assert) {
        const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `emptyorder_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });

        try {
            const renderer = runtime.renderer;
            const key = renderer.backend.secondPassProgramKey;

            renderer.deleteShaders();
            renderer.registerProgram(null, key);

            const source = renderer.getProgram(key).fragmentShader;

            assert.ok(source.indexOf("layout(location=0) out vec4 final_color;") !== -1,
                "the second pass declares final_color");
            assert.ok(/final_color\s*=/.test(source),
                "and assigns it even with nothing to compose");
            assert.notOk(hasEmptyMain(source),
                "main() is never left empty while final_color is declared");
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('an explicitly empty order is stored as "no order", not as "the empty order"',
        async function(assert) {
            const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
                uniqueId: `emptyorder_${Math.floor(Math.random() * 1e9)}`,
                width: SIZE,
                height: SIZE
            });

            try {
                const renderer = runtime.renderer;
                await runtime.overrideConfigureAll(identityConfig(["a", "b", "c"]));

                assert.equal(renderer.getShaderLayerOrder().length, 3, "three layers are configured");

                renderer.setShaderLayerOrder([]);

                assert.strictEqual(renderer._shadersOrder, null,
                    "an empty array normalises to null rather than pinning the order to nothing");
                assert.deepEqual(renderer.getShaderLayerOrder(), Object.keys(renderer._shaders),
                    "so the registered-shader fallback runs again");
            } finally {
                runtime.destroy();
            }
        });

    QUnit.module('EmptyOrderBlankDrawer', {
        beforeEach: function() {
            const element = document.createElement("div");
            element.id = "empty-order-viewer";
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

    function openViewer(testCase, tileSources) {
        return new OpenSeadragon.Promise(resolve => {
            // eslint-disable-next-line new-cap
            const viewer = testCase.viewer = OpenSeadragon({
                id: "empty-order-viewer",
                prefixUrl: "/openseadragon/images/",
                drawer: "flex-renderer",
                springStiffness: 100,
                tileSources: tileSources
            });
            viewer.addHandler('open', () => resolve(viewer));
        });
    }

    /**
     * Reproduce the reset window `runRebuild` has to survive: every world item has lost its
     * `__shaderConfig` (which `tiledImageCreated` does while the drawer is externally configured)
     * and the drawer is no longer externally configured, so the rebuild derives its order from
     * those items and finds nothing.
     */
    async function rebuildThroughResetWindow(viewer) {
        const drawer = viewer.drawer;
        viewer.world._items.forEach(item => delete item.__shaderConfig);
        drawer._configuredExternally = false;
        await drawer._requestRebuild(0, true, true, true);
    }

    // One viewer for both halves on purpose. grunt-contrib-qunit navigates with waitUntil: 'load'
    // and a 10s budget (Gruntfile.js), and every extra OSD viewer opened during the run keeps tile
    // requests pending against that budget -- so this suite pays for viewers it creates.
    QUnit.test('one tiled image behaves like two', async function(assert) {
        const viewer = await openViewer(this, "/test/data/testpattern.dzi");
        const drawer = viewer.drawer;
        const renderer = drawer.renderer;
        const key = renderer.backend.secondPassProgramKey;

        assert.equal(viewer.world.getItemCount(), 1, "the world starts with exactly one tiled image");

        const probe = async () => {
            await drawer.overrideConfigureAll(identityConfig(["p1", "p2", "p3"]), undefined,
                { immediate: true });
            await rebuildThroughResetWindow(viewer);

            const source = renderer.getProgram(key).fragmentShader;
            const uids = Object.values(renderer.getAllShaders()).map(shader => shader.uid);

            return {
                coversEveryLayer: renderer.getShaderLayerOrder().length ===
                    Object.keys(renderer.getAllShaders()).length,
                composed: renderer.getShaderLayerOrder().length > 0,
                emptyMain: hasEmptyMain(source),
                writesOutput: /final_color\s*=/.test(source),
                // The layers are in the stack, not merely counted: each emits its uid in the source.
                everyLayerContributed: uids.length > 0 &&
                    uids.every(uid => source.indexOf(uid) !== -1)
            };
        };

        const oneImage = await probe();

        assert.ok(oneImage.composed, "one tiled image composes a non-empty stack");
        assert.notOk(oneImage.emptyMain, "and does not collapse to an empty main()");
        assert.ok(oneImage.writesOutput, "which writes final_color");
        assert.ok(oneImage.coversEveryLayer, "the render order covers every registered layer");
        assert.ok(oneImage.everyLayerContributed,
            "and every registered layer contributed code to the assembled stack");

        await new OpenSeadragon.Promise(resolve => {
            viewer.addTiledImage({
                tileSource: "/test/data/testpattern.dzi",
                success: () => resolve()
            });
        });
        assert.equal(viewer.world.getItemCount(), 2, "a second tiled image joined the world");

        const twoImages = await probe();

        // The reported symptom stated as an assertion: pre-fix the one-image world composed nothing
        // and emitted an empty main() while the two-image world rendered normally.
        assert.deepEqual(oneImage, twoImages,
            "the world item count does not decide whether anything renders");
    });

})();
