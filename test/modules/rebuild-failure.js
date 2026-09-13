/* global QUnit, OpenSeadragon */

/**
 * A rebuild that fails to link must be survivable.
 *
 * FlexDrawer's rebuild used to react to a failed second-pass build by calling
 * overrideConfigureAll(undefined), which deletes every shader. The drawer never retained the
 * `shaders` map it was configured with, so that destroyed the configuration rather than disabling
 * it: every later rebuild rendered `identity`, and only a page reload brought the visualization
 * back. Every other registerProgram call site keeps the previously linked program instead.
 *
 * These tests pin the recovered behaviour -- configuration retained, event raised -- and the
 * neighbouring case that produced the original report: a stack whose layers are all hidden must
 * still assemble into a program that links.
 */
(function() {

    const SIZE = 2;

    // GLSL that can be made uncompilable on demand, so a rebuild can be failed deliberately
    // rather than by finding an input that happens to blow the uniform budget.
    let breakGlsl = false;

    OpenSeadragon.FlexRenderer.ShaderLayerRegistry.register(
        class RebuildProbeLayer extends OpenSeadragon.FlexRenderer.ShaderLayer {
            static type() {
                return "test_rebuild_probe";
            }
            static name() {
                return "Rebuild probe (test)";
            }
            static sources() {
                return [{ acceptsChannelCount: () => true, description: "any" }];
            }
            static get defaultControls() {
                return {
                    level: {
                        default: { type: "number", default: 0, min: 0, max: 1, step: 0.01, title: "Level" },
                        accepts: (type) => type === "float"
                    }
                };
            }
            getFragmentShaderExecution() {
                if (breakGlsl) {
                    return `
    this is not glsl and will not compile;
`;
                }
                return `
    return vec4(vec3(${this.level.sample()}), 1.0);
`;
            }
        }
    );

    // A failed build logs both numbered shader sources; that is several hundred lines per run
    // and says nothing the assertions do not.
    async function withSilencedConsole(fn) {
        const previous = OpenSeadragon.console;
        OpenSeadragon.console = Object.assign({}, previous, {
            log: () => {},
            info: () => {},
            warn: () => {},
            error: () => {}
        });
        try {
            return await fn();
        } finally {
            OpenSeadragon.console = previous;
        }
    }

    function probeConfig(ids, visible = 1) {
        const config = {};
        ids.forEach((id, index) => {
            config[id] = {
                id: id,
                name: id,
                type: "test_rebuild_probe",
                visible: visible,
                tiledImages: [0],
                params: { level: 0.25 + index * 0.25 },
                cache: {}
            };
        });
        return config;
    }

    QUnit.module('RebuildFailure');

    QUnit.test('a stack whose layers are all hidden still links', async function(assert) {
        const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `rebuildfail_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });

        try {
            const renderer = runtime.renderer;
            const key = renderer.backend.secondPassProgramKey;

            // visible:0 replaces each layer body with a placeholder function and its stack slot
            // with comments only. The composed source must still be a complete program -- this is
            // reachable from the UI by unchecking every layer.
            await runtime.overrideConfigureAll(probeConfig(["a", "b", "c"], 0));

            assert.equal(renderer.getShaderLayerOrder().length, 3, "all three layers are configured");

            let error = null;
            try {
                renderer.registerProgram(null, key);
            } catch (e) {
                error = e;
            }

            assert.strictEqual(error, null,
                `an all-hidden stack assembles into a linkable program (${error && error.message})`);
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('the reported four-layer stack links visible and hidden', async function(assert) {
        const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `rebuildfail_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });

        try {
            const renderer = runtime.renderer;
            const key = renderer.backend.secondPassProgramKey;

            // The configuration from the incident report: four real shader types, one colormap
            // control and one advanced_slider between them. Toggling a layer's visibility is what
            // regenerates the GLSL, so both states have to assemble.
            const config = {
                heat: {
                    id: "heat", name: "heat", type: "heatmap", visible: 1, tiledImages: [0],
                    params: { use_channel0: "r", threshold: 10 }, cache: {}
                },
                map: {
                    id: "map", name: "map", type: "colormap", visible: 1, tiledImages: [0],
                    params: { use_channel0: "r", color: { type: "colormap", default: "YlOrRd" } },
                    cache: {}
                },
                thr: {
                    id: "thr", name: "thr", type: "threshold", visible: 1, tiledImages: [0],
                    params: { use_channel0: "r" }, cache: {}
                },
                pat: {
                    id: "pat", name: "pat", type: "patternmap", visible: 1, tiledImages: [0],
                    params: { use_channel0: "r" }, cache: {}
                }
            };

            await withSilencedConsole(() => runtime.overrideConfigureAll(config));
            assert.equal(renderer.getShaderLayerOrder().length, 4, "four layers are configured");

            const linkStates = [];
            for (const visible of [1, 0]) {
                for (const id of Object.keys(config)) {
                    renderer.getShaderLayer(id).getConfig().visible = visible;
                }
                let error = null;
                try {
                    await withSilencedConsole(() => renderer.registerProgram(null, key));
                } catch (e) {
                    error = e;
                }
                linkStates.push({ visible: visible, error: error });
            }

            assert.strictEqual(linkStates[0].error, null,
                `all four visible links (${linkStates[0].error && linkStates[0].error.message})`);
            assert.strictEqual(linkStates[1].error, null,
                `all four hidden links (${linkStates[1].error && linkStates[1].error.message})`);
        } finally {
            runtime.destroy();
        }
    });

    QUnit.test('a failed build reports through shader-program-failed', async function(assert) {
        const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `rebuildfail_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });

        try {
            const renderer = runtime.renderer;
            const key = renderer.backend.secondPassProgramKey;

            await runtime.overrideConfigureAll(probeConfig(["a", "b"]));

            const events = [];
            renderer.addHandler('shader-program-failed', e => events.push(e));

            breakGlsl = true;
            // The standalone override swallows the failure to keep drawing; without the event a
            // host has no way at all to learn the program on the GPU no longer follows the config.
            await withSilencedConsole(() => runtime.overrideConfigureAll(probeConfig(["a", "b"])));

            assert.equal(events.length, 1, "exactly one failure is reported");
            assert.equal(events[0].key, key, "the payload names the program that failed");
            assert.equal(events[0].source, "standalone-override", "and the call site that failed");
            assert.deepEqual(events[0].shaderIds, ["a", "b"], "and the layers it was built for");
            assert.ok(events[0].error, "the caught error is carried");
            assert.ok(events[0].snapshot && events[0].snapshot.shaders.a,
                "the snapshot carries the still-live configuration");
        } finally {
            breakGlsl = false;
            runtime.destroy();
        }
    });

    QUnit.module('DrawerRebuildFailure', {
        beforeEach: function() {
            const element = document.createElement("div");
            element.id = "rebuild-failure-viewer";
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

    QUnit.test('a failed drawer rebuild keeps the configuration and the last good program',
        function(assert) {
            const done = assert.async();
            const testCase = this;

            // The body runs inside an 'open' handler; without this a viewer that never opens,
            // or a throw before the first assertion, would report as a pass.
            assert.expect(9);

            // eslint-disable-next-line new-cap
            const viewer = testCase.viewer = OpenSeadragon({
                id: "rebuild-failure-viewer",
                prefixUrl: "/openseadragon/images/",
                drawer: "flex-renderer",
                springStiffness: 100,
                tileSources: "/test/data/testpattern.dzi"
            });

            viewer.addHandler('open', async function() {
                try {
                    const drawer = viewer.drawer;
                    const renderer = drawer.renderer;
                    const key = renderer.backend.secondPassProgramKey;
                    const config = probeConfig(["probe"]);

                    await drawer.overrideConfigureAll(config, undefined, { immediate: true });
                    assert.ok(drawer.getOverriddenShaderConfig("probe"),
                        "the external configuration is in place");

                    const workingProgram = renderer.getProgram(key).webGLProgram;
                    const events = [];
                    renderer.addHandler('shader-program-failed', e => events.push(e));

                    breakGlsl = true;
                    // Drive the rebuild the way a visibility toggle, a type change or a reorder
                    // does: force + bypassSuspend + immediate, so runRebuild runs synchronously
                    // here rather than on its usual timeout.
                    await withSilencedConsole(() => drawer._requestRebuild(0, true, true, true));

                    assert.ok(drawer._configuredExternally,
                        "the drawer is still externally configured");
                    assert.ok(drawer.getOverriddenShaderConfig("probe"),
                        "the shader config survives the failed rebuild");
                    assert.equal(drawer.getOverriddenShaderConfig("probe").type, "test_rebuild_probe",
                        "and it is the configured type, not the identity fallback");
                    assert.strictEqual(renderer.getProgram(key).webGLProgram, workingProgram,
                        "the previously linked program is still the registered one");
                    assert.equal(events.length, 1, "the failure is reported once");
                    assert.equal(events[0].source, "drawer-rebuild", "from the drawer rebuild path");

                    // The drawer must stay usable: a rebuild that can link has to take effect.
                    breakGlsl = false;
                    await drawer._requestRebuild(0, true, true, true);
                    assert.notStrictEqual(renderer.getProgram(key).webGLProgram, workingProgram,
                        "a later successful rebuild replaces the program");
                    assert.equal(events.length, 1, "and reports no further failure");
                } catch (e) {
                    assert.ok(false, `unexpected throw: ${e && e.message}`);
                } finally {
                    breakGlsl = false;
                    done();
                }
            });
        });

})();
