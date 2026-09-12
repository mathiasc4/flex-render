/* global QUnit, OpenSeadragon */

/**
 * Enforces that every registered UI control implements the whole IControl contract.
 *
 * Motivation: IControl declares its API as methods that throw "must be implemented", so a class
 * that forgets one still passes every `typeof x.set === "function"` guard in the codebase and only
 * fails at runtime, deep inside a try/catch (see FlexDrawer._syncNavigatorShaderState). These tests
 * make the omission fail at test time instead.
 */
(function() {
    const UIControls = OpenSeadragon.FlexRenderer.UIControls;
    const IControl = UIControls.IControl;

    // Every abstract member declared by IControl.
    const REQUIRED_MEMBERS = [
        "init", "set", "glDrawing", "glLoaded", "toHtml", "define", "sample",
        "supports", "supportsAll", "type", "raw", "encoded"
    ];

    /**
     * Per-type test fixture. `params` are merged into the control definition, `alt` is a second
     * legal encoded value used to prove that set() actually moves the state. Types with no `alt`
     * are still round-tripped, just not moved (their encoding is not synthesizable here).
     */
    function fixtures() {
        const sequential = OpenSeadragon.FlexRenderer.ColorMaps.schemeGroups.sequential;
        return {
            number: { alt: 42 },
            range: { alt: 0.75 },
            color: { alt: "#123456" },
            bool: { alt: false },
            select: { alt: 0 },
            range_input: { alt: 0.25 },
            colormap: { alt: sequential.find(name => name !== "YlOrRd") },
            custom_colormap: { alt: ["#010101", "#020202", "#030303"] },
            advanced_slider: { alt: [0.1, 0.9] },
            text_area: { alt: "some text" },
            button: { alt: 7 },
            image: { alt: 3 },
            icon: { alt: JSON.stringify({ icon: "star", color: "#00ff00" }) }
        };
    }

    function makeOwner() {
        const storage = {};
        return {
            id: "control_api_shader",
            uid: "control_api_shader_1",
            _interactive: false,
            _renderer: { htmlHandler: null },
            backend: {
                secondAtlas: null,
                renderer: {
                    debug: false,
                    notifyVisualizationChanged: function() {
                        this.notifications++;
                    },
                    notifications: 0
                }
            },
            // IControl.changed() reads owner.constructor.type()
            constructor: { type: () => "control_api_shader_type" },
            loadProperty: (name, defaultValue) =>
                (Object.prototype.hasOwnProperty.call(storage, name) ? storage[name] : defaultValue),
            storeProperty: (name, value) => {
                storage[name] = value;
            },
            includeGlobalCode: () => true,
            invalidate: () => {}
        };
    }

    function buildControl(type, params) {
        const owner = makeOwner();
        const definition = {
            default: OpenSeadragon.extend({ type: type }, params || {}),
            accepts: () => true,
            required: {}
        };
        return UIControls.build(owner, "testControl", definition, `control_api_${type}`);
    }

    /**
     * Walk the prototype chain for `key` and return the prototype that owns it. Needed because
     * half of the contract is accessor properties, which `control[key]` would silently invoke.
     */
    function owningPrototype(instance, key) {
        let proto = Object.getPrototypeOf(instance);
        while (proto) {
            if (Object.prototype.hasOwnProperty.call(proto, key)) {
                return proto;
            }
            proto = Object.getPrototypeOf(proto);
        }
        return null;
    }

    QUnit.module('ControlApi');

    QUnit.test('every registered control implements the full IControl contract', function(assert) {
        const types = Object.keys(UIControls._items).concat(Object.keys(UIControls._impls));
        assert.ok(types.length > 0, "there are registered control types");

        types.forEach(type => {
            const control = buildControl(type);
            assert.ok(control, `${type}: control was built`);
            if (!control) {
                return;
            }

            REQUIRED_MEMBERS.forEach(key => {
                const proto = owningPrototype(control, key);
                assert.ok(proto, `${type}.${key} is defined`);
                assert.notStrictEqual(
                    proto, IControl.prototype,
                    `${type}.${key} is implemented (not the throwing IControl stub)`
                );
            });
        });
    });

    QUnit.test('set(encoded) round-trips and moves the state', function(assert) {
        const cases = fixtures();

        Object.keys(cases).forEach(type => {
            const control = buildControl(type);
            if (!control) {
                assert.ok(false, `${type}: control was built`);
                return;
            }
            control.init();

            const original = control.encoded;
            control.set(original);
            assert.deepEqual(control.encoded, original, `${type}: set(encoded) is idempotent`);

            const alt = cases[type].alt;
            if (alt === undefined) {
                return;
            }
            control.set(alt);
            assert.notDeepEqual(control.encoded, original, `${type}: set(alt) changed the encoded value`);
            assert.notStrictEqual(control.raw, undefined, `${type}: raw is defined after set()`);
        });
    });

    QUnit.test('cache object round-trips through loadCacheObject', function(assert) {
        const cases = fixtures();

        Object.keys(cases).forEach(type => {
            const alt = cases[type].alt;
            if (alt === undefined) {
                return;
            }

            const control = buildControl(type);
            if (!control) {
                assert.ok(false, `${type}: control was built`);
                return;
            }
            control.init();

            const cache = control.createCacheObject();
            const cached = cache.encodedValue;

            control.set(alt);
            control.loadCacheObject({ encodedValue: cached, value: cache.value });

            assert.deepEqual(control.encoded, cached, `${type}: cache restored the encoded value`);
        });
    });
})();
