/* global QUnit, OpenSeadragon */

/**
 * Deferred work must not outlive the viewer.
 *
 * OpenSeadragon's Viewer#destroy() nulls the viewer's private state slot, after which
 * Viewer#forceRedraw() throws "Cannot set properties of undefined". FlexDrawer schedules rebuilds
 * and redraws on timers, and control listeners / debounce timers route redraws through the
 * renderer's redrawCallback -- all of which can fire after teardown. Hosts used to monkey-patch
 * forceRedraw with a try/catch to survive this. These tests pin that every such path is a no-op
 * once the drawer (or viewer) is destroyed.
 */
(function() {

    const WAIT_MS = 80;

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

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Collect uncaught errors and unhandled rejections raised while the body runs (including
     * timers that fire during the trailing wait), plus forceRedraw calls on the given viewers.
     */
    function watch(viewers) {
        const errors = [];
        const onError = e => {
            errors.push(e && (e.message || (e.error && e.error.message)) || String(e));
            e.preventDefault();
        };
        const onRejection = e => {
            errors.push(e && e.reason && e.reason.message || String(e && e.reason));
            e.preventDefault();
        };
        window.addEventListener("error", onError);
        window.addEventListener("unhandledrejection", onRejection);

        const spies = viewers.filter(Boolean).map(viewer => {
            const original = viewer.forceRedraw;
            const spy = { viewer, original, calls: 0, armed: false };
            viewer.forceRedraw = function() {
                if (spy.armed) {
                    spy.calls++;
                }
                return original.apply(this, arguments);
            };
            return spy;
        });

        return {
            errors,
            arm() {
                spies.forEach(spy => {
                    spy.armed = true;
                });
            },
            calls() {
                return spies.reduce((sum, spy) => sum + spy.calls, 0);
            },
            stop() {
                window.removeEventListener("error", onError);
                window.removeEventListener("unhandledrejection", onRejection);
                spies.forEach(spy => {
                    spy.viewer.forceRedraw = spy.original;
                });
            }
        };
    }

    QUnit.module('DestroyDeferred', {
        beforeEach: function() {
            const element = document.createElement("div");
            element.id = "destroy-deferred-viewer";
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

    function openViewer(testCase, showNavigator, body) {
        const done = testCase.assert.async();
        // eslint-disable-next-line new-cap
        const viewer = testCase.viewer = OpenSeadragon({
            id: "destroy-deferred-viewer",
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

    function waitForNavigatorDrawer(viewer, timeout = 2000) {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const poll = () => {
                const nav = viewer.navigator;
                if (nav && nav.drawer && nav.drawer.renderer) {
                    resolve(nav.drawer);
                } else if (Date.now() - start > timeout) {
                    reject(new Error("navigator drawer never appeared"));
                } else {
                    setTimeout(poll, 10);
                }
            };
            poll();
        });
    }

    QUnit.test('a rebuild pending at destroy never fires', function(assert) {
        this.assert = assert;
        openViewer(this, true, async viewer => {
            const drawer = viewer.drawer;
            await drawer.overrideConfigureAll(identityConfig(["a"]), undefined, { immediate: true });
            const probe = watch([viewer, viewer.navigator]);
            try {
                drawer._requestRebuild(30);
                assert.ok(drawer._rebuildHandle, "rebuild is pending");
                probe.arm();
                viewer.destroy();
                await wait(WAIT_MS);
                assert.deepEqual(probe.errors, [], "no uncaught error after teardown");
                assert.equal(probe.calls(), 0, "forceRedraw never ran after destroy");
                assert.equal(drawer._rebuildHandle, null, "rebuild handle cleared");
                assert.ok(drawer._destroyed, "drawer destroyed");
            } finally {
                probe.stop();
            }
        });
    });

    QUnit.test('the deferred redraw after an immediate rebuild never fires post-destroy', function(assert) {
        this.assert = assert;
        openViewer(this, false, async viewer => {
            const drawer = viewer.drawer;
            await drawer.overrideConfigureAll(identityConfig(["a"]), undefined, { immediate: true });
            const probe = watch([viewer]);
            try {
                drawer._requestRebuild(0);
                // runRebuild fires on the 0 ms timer and arms _deferredRedrawHandle; destroy
                // right after it, before the redraw timer runs.
                await new Promise(resolve => {
                    const check = () => {
                        if (drawer._deferredRedrawHandle) {
                            resolve();
                        } else if (!drawer._rebuildHandle) {
                            resolve();
                        } else {
                            setTimeout(check, 0);
                        }
                    };
                    setTimeout(check, 0);
                });
                probe.arm();
                viewer.destroy();
                await wait(WAIT_MS);
                assert.deepEqual(probe.errors, [], "no uncaught error after teardown");
                assert.equal(probe.calls(), 0, "forceRedraw never ran after destroy");
                assert.equal(drawer._deferredRedrawHandle, null, "deferred redraw handle cleared");
            } finally {
                probe.stop();
            }
        });
    });

    QUnit.test('redraw entry points captured before destroy are no-ops after it', function(assert) {
        this.assert = assert;
        openViewer(this, true, async viewer => {
            const drawer = viewer.drawer;
            await drawer.overrideConfigureAll(identityConfig(["a"]), undefined, { immediate: true });
            await waitForNavigatorDrawer(viewer).catch(() => null);

            const renderer = drawer.renderer;
            const redrawCallback = renderer.redrawCallback;
            const shader = renderer.getShaderLayer("a");
            const invalidate = shader && shader.invalidate;
            assert.equal(typeof redrawCallback, "function", "redrawCallback captured");
            assert.equal(typeof invalidate, "function", "shader invalidate captured");

            const probe = watch([viewer, viewer.navigator]);
            try {
                probe.arm();
                viewer.destroy();

                const calls = {
                    "redrawCallback()": () => redrawCallback(),
                    "shader.invalidate()": () => invalidate(),
                    "renderer.setRenderDiagnostics()": () => renderer.setRenderDiagnostics(true),
                    "drawer.resumeRendering()": () => drawer.resumeRendering(),
                    "drawer.rebuild()": () => drawer.rebuild(),
                    "drawer._requestRebuild(immediate)": () => drawer._requestRebuild(0, true, true, true),
                    "drawer.overrideConfigureAll()": () => drawer.overrideConfigureAll(identityConfig(["b"])),
                    "drawer._handleRefetchRequest()": () => drawer._handleRefetchRequest({
                        kind: "shader-config-mutation", shaderId: "a", mutation: { visible: 0 }
                    }),
                    "drawer.setInspectorState()": () => drawer.setInspectorState({ enabled: true }),
                    "drawer._syncNavigatorShaderState()": () => drawer._syncNavigatorShaderState()
                };
                for (const label in calls) {
                    let threw = null;
                    try {
                        await calls[label]();
                    } catch (e) {
                        threw = e;
                    }
                    assert.equal(threw, null, `${label} does not throw after destroy` +
                        (threw ? `: ${threw.message}` : ""));
                }

                await wait(WAIT_MS);
                assert.deepEqual(probe.errors, [], "no uncaught error after teardown");
                assert.equal(probe.calls(), 0, "forceRedraw never ran after destroy");
                assert.equal(drawer._rebuildHandle, null, "no rebuild armed after destroy");
            } finally {
                probe.stop();
            }
        });
    });

    QUnit.test('suspend, schedule, destroy, resume', function(assert) {
        this.assert = assert;
        openViewer(this, false, async viewer => {
            const drawer = viewer.drawer;
            await drawer.overrideConfigureAll(identityConfig(["a"]), undefined, { immediate: true });
            const probe = watch([viewer]);
            try {
                drawer.suspendRendering("test");
                drawer._requestRebuild(10);
                assert.ok(drawer._pendingRebuildRequest, "rebuild recorded as pending while suspended");
                probe.arm();
                viewer.destroy();
                drawer.resumeRendering("test");
                await wait(WAIT_MS);
                assert.deepEqual(probe.errors, [], "no uncaught error");
                assert.equal(probe.calls(), 0, "forceRedraw never ran after destroy");
                assert.equal(drawer._pendingRebuildRequest, null, "pending rebuild dropped by destroy");
                assert.equal(drawer._rebuildHandle, null, "no rebuild armed by resume");
            } finally {
                probe.stop();
            }
        });
    });

    QUnit.test('a drawer swapped out detaches its world handler', function(assert) {
        this.assert = assert;
        openViewer(this, false, async viewer => {
            const oldDrawer = viewer.drawer;
            const world = viewer.world;
            const before = world.numberOfHandlers("remove-item");
            assert.ok(oldDrawer._onWorldRemoveItem, "remove-item handler is retained for detaching");

            const probe = watch([viewer]);
            try {
                viewer.requestDrawer("canvas");
                assert.ok(oldDrawer._destroyed, "old flex drawer destroyed by the swap");
                assert.equal(world.numberOfHandlers("remove-item"), before - 1,
                    "old drawer's remove-item handler removed");

                world.removeItem(world.getItemAt(0));
                await wait(WAIT_MS);
                assert.deepEqual(probe.errors, [], "removing an item after the swap does not throw");
            } finally {
                probe.stop();
            }
        });
    });

    QUnit.test('a relink scheduled in the destroying tick is dropped', function(assert) {
        this.assert = assert;
        openViewer(this, false, async viewer => {
            const drawer = viewer.drawer;
            await drawer.overrideConfigureAll(identityConfig(["a"]), undefined, { immediate: true });
            const renderer = drawer.renderer;
            const program = renderer.getProgram(renderer.backend.secondPassProgramKey);
            assert.ok(program && typeof program._scheduleRelink === "function", "second pass can relink");

            const probe = watch([viewer]);
            let registerCalls = 0;
            const originalRegister = renderer.registerProgram;
            renderer.registerProgram = function() {
                registerCalls++;
                return originalRegister.apply(this, arguments);
            };
            try {
                program._scheduleRelink("test");
                viewer.destroy();
                await wait(WAIT_MS);
                assert.deepEqual(probe.errors, [], "no uncaught error");
                assert.equal(registerCalls, 0, "relink skipped on a destroyed renderer");
            } finally {
                renderer.registerProgram = originalRegister;
                probe.stop();
            }
        });
    });

    QUnit.test('the navigator drawer with a pending rebuild survives viewer teardown', function(assert) {
        this.assert = assert;
        openViewer(this, true, async viewer => {
            const drawer = viewer.drawer;
            await drawer.overrideConfigureAll(identityConfig(["a"]), undefined, { immediate: true });
            const navDrawer = await waitForNavigatorDrawer(viewer);
            const probe = watch([viewer, viewer.navigator]);
            try {
                navDrawer._requestRebuild(30);
                drawer._requestRebuild(30);
                probe.arm();
                viewer.destroy();
                await wait(WAIT_MS);
                assert.deepEqual(probe.errors, [], "no uncaught error");
                assert.equal(probe.calls(), 0, "neither viewer nor navigator redrawn after destroy");
                assert.ok(navDrawer._destroyed, "navigator drawer destroyed");
                assert.equal(navDrawer._rebuildHandle, null, "navigator rebuild handle cleared");
            } finally {
                probe.stop();
            }
        });
    });

    QUnit.test('destroying a layer destroys its controls', function(assert) {
        this.assert = assert;
        openViewer(this, false, async viewer => {
            const drawer = viewer.drawer;
            await drawer.overrideConfigureAll(identityConfig(["a"]), undefined, { immediate: true });
            const shader = drawer.renderer.getShaderLayer("a");
            const names = Object.keys(shader._controls);
            assert.ok(names.length > 0, "identity layer owns controls");
            let destroyed = 0;
            const control = shader[names[0]];
            control.destroy = () => {
                destroyed++;
            };
            viewer.destroy();
            assert.equal(destroyed, 1, "control.destroy() called when the renderer tears down");
        });
    });
})();
