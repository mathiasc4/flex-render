/* global QUnit, OpenSeadragon */

/**
 * A ShaderLayer that reads host-forwarded pointer state declares it with
 * `static requiresInteraction()`. FlexDrawer forwarding is off by default (every changed
 * pointer move costs a redraw), and such a layer renders its inactive branch when the state
 * never arrives -- indistinguishable, from the outside, from a broken shader.
 *
 * These tests pin the two halves of the contract: the static is readable off the registered
 * class before anything is constructed, and the drawer reports the mismatch once per shader
 * type instead of enabling forwarding behind the host's back.
 */
(function() {

    const Registry = OpenSeadragon.FlexRenderer.ShaderLayerRegistry;

    Registry.register(
        class InteractionProbeLayer extends OpenSeadragon.FlexRenderer.ShaderLayer {
            static type() {
                return "test_interaction_probe";
            }
            static name() {
                return "Interaction probe (test)";
            }
            static requiresInteraction() {
                return true;
            }
            static sources() {
                return [{ acceptsChannelCount: () => true, description: "any" }];
            }
            getFragmentShaderExecution() {
                return `
    vec2 pointerPx = fr_interaction_pointer_position_px();
    return vec4(pointerPx / max(vec2(1.0), vec2(${this.getTextureSize()})), 0.0, 1.0);
`;
            }
        }
    );

    function probeConfig(type) {
        return {
            probe: {
                id: "probe",
                name: "Probe",
                type: type,
                visible: 1,
                tiledImages: [0],
                params: {},
                cache: {}
            }
        };
    }

    // Collects OpenSeadragon.console.warn from a synchronous call while keeping the rest
    // of the console intact.
    function captureWarnings(fn) {
        const previous = OpenSeadragon.console;
        const warnings = [];
        OpenSeadragon.console = Object.assign({}, previous, {
            warn: (...args) => warnings.push(args.join(" "))
        });
        try {
            fn();
        } finally {
            OpenSeadragon.console = previous;
        }
        return warnings;
    }

    async function captureWarningsAsync(fn) {
        const previous = OpenSeadragon.console;
        const warnings = [];
        OpenSeadragon.console = Object.assign({}, previous, {
            warn: (...args) => warnings.push(args.join(" "))
        });
        try {
            await fn();
        } finally {
            OpenSeadragon.console = previous;
        }
        return warnings;
    }

    function interactionWarnings(warnings) {
        return warnings.filter(text => text.indexOf("requiresInteraction") !== -1);
    }

    QUnit.module('ShaderInteractionRequirement');

    QUnit.test('the requirement is declared on the class, not inferred from GLSL', function(assert) {
        assert.strictEqual(Registry.get("fisheye-lens").requiresInteraction(), true,
            "fisheye-lens declares it");
        assert.strictEqual(Registry.get("interaction-debug").requiresInteraction(), true,
            "interaction-debug declares it");
        assert.strictEqual(Registry.get("identity").requiresInteraction(), false,
            "identity does not");

        class Bare extends OpenSeadragon.FlexRenderer.ShaderLayer {
            static type() {
                return "test_interaction_bare";
            }
            static name() {
                return "Bare (test)";
            }
            static sources() {
                return [];
            }
        }
        assert.strictEqual(Bare.requiresInteraction(), false, "the base class defaults to false");
    });

    QUnit.module('DrawerInteractionRequirement', {
        beforeEach: function() {
            const element = document.createElement("div");
            element.id = "interaction-requirement-viewer";
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

    QUnit.test('a layer requiring interaction warns once while forwarding is off',
        function(assert) {
            const done = assert.async();
            const testCase = this;

            // Guards against a viewer that never opens, or a throw before the assertions.
            assert.expect(6);

            // eslint-disable-next-line new-cap
            const viewer = testCase.viewer = OpenSeadragon({
                id: "interaction-requirement-viewer",
                prefixUrl: "/openseadragon/images/",
                drawer: "flex-renderer",
                springStiffness: 100,
                tileSources: "/test/data/testpattern.dzi"
            });

            viewer.addHandler('open', async function() {
                try {
                    const drawer = viewer.drawer;

                    assert.notOk(drawer.getInteractionOptions().enabled,
                        "interaction forwarding is off by default");

                    // The rebuild itself reports it: the host learns at build time, not on
                    // the first frame the user finds unresponsive.
                    let warnings = interactionWarnings(await captureWarningsAsync(
                        () => drawer.overrideConfigureAll(probeConfig("test_interaction_probe"),
                            undefined, { immediate: true })
                    ));
                    assert.equal(warnings.length, 1, "the mismatch is reported");
                    assert.ok(warnings[0].indexOf("test_interaction_probe") !== -1,
                        "and it names the shader type");

                    warnings = interactionWarnings(captureWarnings(
                        () => drawer._warnOnMissingInteractionForwarding()
                    ));
                    assert.equal(warnings.length, 0, "a repeated rebuild does not repeat it");

                    drawer.setInteractionEnabled(true);
                    warnings = interactionWarnings(captureWarnings(
                        () => drawer._warnOnMissingInteractionForwarding()
                    ));
                    assert.equal(warnings.length, 0, "nothing to report once forwarding is on");

                    // Turning it back off is a new mismatch, so the warning re-arms.
                    drawer.setInteractionEnabled(false);
                    warnings = interactionWarnings(captureWarnings(
                        () => drawer._warnOnMissingInteractionForwarding()
                    ));
                    assert.equal(warnings.length, 1, "disabling forwarding again warns again");
                } catch (e) {
                    assert.ok(false, `unexpected throw: ${e && e.message}`);
                } finally {
                    done();
                }
            });
        });

    // The drawer's own interaction setup runs from the base-class constructor, before the
    // subclass constructor body assigns its fields, so anything the enable path touches has
    // to tolerate not existing yet.
    QUnit.test('a drawer constructed with forwarding already on builds', function(assert) {
        const done = assert.async();
        const testCase = this;

        assert.expect(2);

        // eslint-disable-next-line new-cap
        const viewer = testCase.viewer = OpenSeadragon({
            id: "interaction-requirement-viewer",
            prefixUrl: "/openseadragon/images/",
            drawer: "flex-renderer",
            springStiffness: 100,
            tileSources: "/test/data/testpattern.dzi",
            drawerOptions: {
                "flex-renderer": {
                    interaction: { enabled: true }
                }
            }
        });

        viewer.addHandler('open', function() {
            try {
                assert.ok(viewer.drawer, "the drawer was constructed");
                assert.strictEqual(viewer.drawer.getInteractionOptions().enabled, true,
                    "and forwarding is on from the start");
            } catch (e) {
                assert.ok(false, `unexpected throw: ${e && e.message}`);
            } finally {
                done();
            }
        });
    });

    QUnit.test('a layer that does not require interaction is never reported', function(assert) {
        const done = assert.async();
        const testCase = this;

        assert.expect(1);

        // eslint-disable-next-line new-cap
        const viewer = testCase.viewer = OpenSeadragon({
            id: "interaction-requirement-viewer",
            prefixUrl: "/openseadragon/images/",
            drawer: "flex-renderer",
            springStiffness: 100,
            tileSources: "/test/data/testpattern.dzi"
        });

        viewer.addHandler('open', async function() {
            try {
                const drawer = viewer.drawer;
                await drawer.overrideConfigureAll(probeConfig("identity"),
                    undefined, { immediate: true });

                const warnings = interactionWarnings(captureWarnings(
                    () => drawer._warnOnMissingInteractionForwarding()
                ));
                assert.equal(warnings.length, 0, "identity draws fine without pointer state");
            } catch (e) {
                assert.ok(false, `unexpected throw: ${e && e.message}`);
            } finally {
                done();
            }
        });
    });

})();
