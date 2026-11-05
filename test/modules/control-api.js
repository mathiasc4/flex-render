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

    QUnit.test('glDrawing before init() uploads a defined value instead of throwing', function(assert) {
        // A shader that missed the one-shot init in useProgram used to reach glDrawing with
        // value === undefined; uniform3fv(loc, undefined) throws out of the render loop.
        const control = buildControl("color");
        const uploads = [];
        const gl = {
            uniform3fv: (location, value) => {
                if (!value || typeof value[Symbol.iterator] !== "function") {
                    throw new TypeError("The provided value cannot be converted to a sequence.");
                }
                uploads.push(Array.from(value));
            }
        };

        control.glDrawing(null, gl);

        assert.strictEqual(uploads.length, 1, "uniform was uploaded once");
        assert.strictEqual(uploads[0].length, 3, "uploaded value is a vec3");
    });

    QUnit.test('every control type survives glDrawing before init()', function(assert) {
        // Same failure for controls with their own glDrawing: AdvancedSlider packed an undefined
        // array, ColorMap never baked its LUT. Vector setters reject non-sequences like WebGL
        // does; scalar setters also reject NaN, which WebGL would swallow silently.
        const types = Object.keys(UIControls._items).concat(Object.keys(UIControls._impls));
        const bad = [];
        let current;
        const gl = new Proxy({}, {
            get: (target, fn) => (location, value) => {
                if (typeof fn !== "string" || !fn.startsWith("uniform")) {
                    return undefined;
                }
                const ok = fn.endsWith("v") ?
                    value && typeof value[Symbol.iterator] === "function" &&
                        Array.from(value).every(Number.isFinite) :
                    Number.isFinite(value);
                if (!ok) {
                    bad.push(`${current}: ${fn}(${value})`);
                }
                return undefined;
            }
        });

        types.forEach(type => {
            current = type;
            const control = buildControl(type);
            if (!control) {
                assert.ok(false, `${type}: control was built`);
                return;
            }
            try {
                control.glDrawing(null, gl);
                assert.ok(true, `${type}: glDrawing did not throw`);
                if (control instanceof UIControls.ColorMap) {
                    assert.notOk(control._lutDirty, `${type}: LUT was baked on the first draw`);
                }
            } catch (e) {
                assert.ok(false, `${type}: glDrawing threw ${e}`);
            }
        });

        assert.deepEqual(bad, [], "no uniform received an undefined or NaN value");
    });

    /**
     * Build a control declared like ShaderLayer opacity (range 0..1) but configured with another type.
     */
    function buildOverridden(customParams) {
        const definition = {
            default: { type: "range", default: 1, min: 0, max: 1, step: 0.1 },
            accepts: () => true,
            required: {}
        };
        return UIControls.build(makeOwner(), "opacity", definition, "control_api_override", customParams);
    }

    QUnit.test('type override with the same glType keeps the value domain', function(assert) {
        ["range_input", "number"].forEach(type => {
            const control = buildOverridden({ type: type, default: 0.5 });
            control.init();
            assert.strictEqual(control.params.min, 0, `${type}: min carried over`);
            assert.strictEqual(control.params.max, 1, `${type}: max carried over`);
            assert.strictEqual(control.params.step, 0.1, `${type}: step carried over`);
            assert.strictEqual(control.raw, 0.5, `${type}: 0.5 reaches the shader as 0.5`);
        });

        const custom = buildOverridden({ type: "number", default: 5, max: 10 });
        assert.strictEqual(custom.params.max, 10, "explicit max wins over the carried domain");
    });

    QUnit.test('type override with a different glType warns that the domain is dropped', function(assert) {
        const warn = console.warn;
        const warnings = [];
        console.warn = (...args) => warnings.push(args.join(" "));
        try {
            buildOverridden({ type: "bool", default: true });
        } finally {
            console.warn = warn;
        }
        assert.ok(warnings.some(w => w.includes("opacity") && w.includes("dropped")),
            "warning names the control and the dropped domain");
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
