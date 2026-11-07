/* global QUnit, OpenSeadragon */

/**
 * Markup contract of the renderer-native UI controls: class threading (`classes` / `css` /
 * `options.inputClasses`), the per-role input class defaults, single-line tags, colormap preview
 * hooks, slider connect state classes and the string translator.
 */
(function() {
    const UIControls = OpenSeadragon.FlexRenderer.UIControls;

    const ALL_TYPES = [
        "number", "range", "color", "bool", "select", "range_input", "colormap",
        "custom_colormap", "advanced_slider", "text_area", "button", "image", "icon"
    ];

    function makeOwner(interactive) {
        const storage = {};
        return {
            id: "control_markup_shader",
            uid: "control_markup_shader_1",
            _interactive: interactive !== false,
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
            constructor: { type: () => "control_markup_shader_type" },
            loadProperty: (name, defaultValue) =>
                (Object.prototype.hasOwnProperty.call(storage, name) ? storage[name] : defaultValue),
            storeProperty: (name, value) => {
                storage[name] = value;
            },
            includeGlobalCode: () => true,
            invalidate: () => {}
        };
    }

    let counter = 0;
    function buildControl(type, params, interactive) {
        const owner = makeOwner(interactive);
        const definition = {
            default: OpenSeadragon.extend({ type: type }, params || {}),
            accepts: () => true,
            required: {}
        };
        counter++;
        return UIControls.build(owner, "markupControl", definition, `control_markup_${type}_${counter}`);
    }

    function fixture() {
        return document.getElementById("qunit-fixture");
    }

    function mount(html) {
        const host = document.createElement("div");
        host.innerHTML = html;
        fixture().appendChild(host);
        return host;
    }

    let savedDefaults = null;
    let savedAlert = null;
    const pendingDestroy = [];

    QUnit.module("ControlMarkup", {
        beforeEach: function() {
            savedDefaults = UIControls.inputClassDefaults;
            savedAlert = window.alert;
        },
        afterEach: function() {
            UIControls.setInputClassDefaults(savedDefaults, { merge: false });
            UIControls.setTranslator(null);
            window.alert = savedAlert;
            while (pendingDestroy.length) {
                const control = pendingDestroy.pop();
                try {
                    control.destroy();
                } catch (e) {
                    // ignore
                }
            }
        }
    });

    QUnit.test("no newline inside any class attribute or tag", function(assert) {
        ALL_TYPES.forEach(type => {
            const control = buildControl(type, { title: "Some title" });
            const html = control.toHtml("root-extra", "color: red;");
            assert.ok(typeof html === "string" && html.length > 0, `${type}: markup produced`);
            assert.notOk(/class="[^"]*[\r\n]/.test(html), `${type}: no newline in class attribute`);
            assert.notOk(/<[^<>]*[\r\n][^<>]*>/.test(html), `${type}: no newline inside a tag`);
            assert.notOk(/data-columns="\d+"\s+>/.test(html), `${type}: no stray space before '>' on the root`);
        });
    });

    QUnit.test("default DaisyUI + BEM classes per role", function(assert) {
        const expectations = {
            number: ["input.er-control__input--number", "input input-bordered input-sm"],
            range: ["input.er-control__input--range", "range range-sm"],
            bool: ["input.er-control__input--bool", "checkbox checkbox-sm"],
            select: ["select.er-control__input--select", "select select-bordered select-sm"],
            colormap: ["select.er-control__input--colormap", "select select-bordered select-sm"],
            text_area: ["textarea.er-control__input--textarea", "textarea textarea-bordered textarea-sm"],
            button: ["button.er-control__button--action", "btn btn-sm btn-outline"]
        };
        Object.keys(expectations).forEach(type => {
            const control = buildControl(type);
            const host = mount(control.toHtml());
            const [selector, classes] = expectations[type];
            const node = host.querySelector(selector);
            assert.ok(node, `${type}: ${selector} exists`);
            if (node) {
                classes.split(" ").forEach(cls => {
                    assert.ok(node.classList.contains(cls), `${type}: has ${cls}`);
                });
                assert.ok(node.classList.contains("er-control__input") || node.classList.contains("er-control__button"),
                    `${type}: keeps base BEM class`);
            }
        });

        const color = mount(buildControl("color").toHtml()).querySelector("input.er-control__input--color");
        assert.equal(color.className, "er-control__input er-control__input--color", "color: BEM only");

        const image = mount(buildControl("image").toHtml());
        assert.ok(image.querySelector(".er-control__input--image-number").classList.contains("input-bordered"), "image number role");
        assert.ok(image.querySelector(".er-control__input--image-file").classList.contains("file-input"), "image file role");
        assert.ok(image.querySelector(".er-control__button--image-upload").classList.contains("btn"), "image upload role");

        const icon = mount(buildControl("icon").toHtml());
        assert.ok(icon.querySelector(".er-control__button--icon-trigger").classList.contains("btn-square"), "icon trigger role");
        assert.ok(icon.querySelector(".er-control__button--icon-close").classList.contains("btn-ghost"), "icon close role");
        assert.ok(icon.querySelector(".er-control__input--icon-query").classList.contains("input-sm"), "icon query role");
    });

    QUnit.test("inputClasses: string append, per-role replace, null clear", function(assert) {
        const control = buildControl("number");

        let input = mount(control.toHtml("", "", { inputClasses: "my-extra" })).querySelector("input");
        assert.ok(input.classList.contains("my-extra"), "string appended");
        assert.ok(input.classList.contains("input-bordered"), "default kept with string");

        input = mount(control.toHtml("", "", { inputClasses: { number: "form-control" } })).querySelector("input");
        assert.ok(input.classList.contains("form-control"), "role map applied");
        assert.notOk(input.classList.contains("input-bordered"), "role map replaces default");
        assert.ok(input.classList.contains("er-control__input--number"), "BEM kept");

        input = mount(control.toHtml("", "", { inputClasses: { number: null } })).querySelector("input");
        assert.equal(input.className, "er-control__input er-control__input--number", "null clears");

        input = mount(control.toHtml("", "", { inputClasses: { range: "other" } })).querySelector("input");
        assert.ok(input.classList.contains("input-bordered"), "unrelated role key keeps default");

        assert.equal(UIControls.resolveInputClasses("number", ""), "input input-bordered input-sm", "resolve default");
        assert.equal(UIControls.resolveInputClasses("number", "x"), "input input-bordered input-sm x", "resolve string");
        assert.equal(UIControls.resolveInputClasses("number", { number: "" }), "", "resolve empty clears");
        assert.equal(UIControls.resolveInputClasses("unknown-role"), "", "unknown role empty");
    });

    QUnit.test("setInputClassDefaults: null leaves only BEM, merge works", function(assert) {
        const copy = UIControls.inputClassDefaults;
        copy.number = "mutated";
        assert.notEqual(UIControls.inputClassDefaults.number, "mutated", "getter returns a copy");

        UIControls.setInputClassDefaults(null);
        ALL_TYPES.forEach(type => {
            const html = buildControl(type).toHtml();
            ["input-bordered", "range-sm", "checkbox", "select-bordered", "textarea-bordered", "btn-outline", "file-input"]
                .forEach(cls => {
                    assert.notOk(new RegExp(`class="[^"]*\\b${cls}\\b`).test(html), `${type}: no ${cls} after clear`);
                });
        });

        UIControls.setInputClassDefaults({ number: "a" });
        UIControls.setInputClassDefaults({ range: "b" });
        assert.equal(UIControls.inputClassDefaults.number, "a", "merge keeps earlier key");
        assert.equal(UIControls.inputClassDefaults.range, "b", "merge adds key");

        UIControls.setInputClassDefaults({ range: "c" }, { merge: false });
        assert.equal(UIControls.inputClassDefaults.range, "c", "replace sets key");
        assert.notOk(UIControls.inputClassDefaults.number, "replace drops other keys");
    });

    QUnit.test("SliderWithInput: root gets classes, nested inputs get roles + options", function(assert) {
        const control = buildControl("range_input", { title: "T" });
        const host = mount(control.toHtml("root-cls", "", { inputClasses: "opt-cls" }));
        const roots = host.querySelectorAll(".root-cls");
        assert.equal(roots.length, 1, "classes only on the outer root");
        assert.ok(roots[0].classList.contains("er-control--slider-with-input"), "outer root has classes");
        const range = host.querySelector("input[type=range]");
        const number = host.querySelector("input[type=number]");
        assert.ok(range.classList.contains("range-sm") && range.classList.contains("opt-cls"), "range role + options");
        assert.ok(number.classList.contains("input-bordered") && number.classList.contains("opt-cls"), "number role + options");
    });

    QUnit.test("htmlControls threads classes/css/options, positional and object form", function(assert) {
        const calls = [];
        const fake = {
            _controls: { a: true, b: true },
            a: { toHtml: (c, css, o) => { calls.push(["a", c, css, o]); return "<i>a</i>"; } },
            b: { toHtml: (c, css, o) => { calls.push(["b", c, css, o]); return "<i>b</i>"; } }
        };
        const proto = OpenSeadragon.FlexRenderer.ShaderLayer.prototype;

        let html = proto.htmlControls.call(fake, h => `[${h}]`, "cls", "css:1;", { inputClasses: "x" });
        assert.equal(html, "[<i>a</i>][<i>b</i>]", "wrapper applied");
        assert.deepEqual(calls[0], ["a", "cls", "css:1;", { inputClasses: "x" }], "positional threading");

        calls.length = 0;
        html = proto.htmlControls.call(fake, { wrapper: h => `(${h})`, classes: "c2", css: "d2", inputClasses: { number: "n" } });
        assert.equal(html, "(<i>a</i>)(<i>b</i>)", "object form wrapper");
        assert.equal(calls[1][1], "c2", "object form classes");
        assert.equal(calls[1][2], "d2", "object form css");
        assert.deepEqual(calls[1][3].inputClasses, { number: "n" }, "object form inputClasses");

        calls.length = 0;
        proto.htmlControls.call(fake);
        assert.equal(calls[0][1], "", "no-arg classes");
        assert.equal(calls[0][2], "", "no-arg css");
        assert.ok(calls[0][3] && typeof calls[0][3] === "object", "no-arg options object");
    });

    QUnit.test("titled Button and Icon use their layoutColumns", function(assert) {
        [["button", "1"], ["icon", "2"]].forEach(([type, columns]) => {
            const host = mount(buildControl(type, { title: "Titled" }).toHtml());
            const root = host.querySelector(".er-control");
            assert.equal(root.getAttribute("data-columns"), columns, `${type}: data-columns=${columns}`);
        });
        const untitled = mount(buildControl("icon", { title: "" }).toHtml()).querySelector(".er-control");
        assert.equal(untitled.getAttribute("data-columns"), "1", "untitled icon: data-columns=1");
    });

    QUnit.test("control titles are escaped unless titleHtml opts in", function(assert) {
        ["number", "range", "bool", "advanced_slider"].forEach(type => {
            const escaped = mount(buildControl(type, { title: "A <b>B</b>" }).toHtml());
            const title = escaped.querySelector(".er-control__title");
            assert.ok(title, `${type}: title span`);
            assert.equal(title && title.textContent, "A <b>B</b>", `${type}: title is text`);
            assert.notOk(title && title.querySelector("b"), `${type}: no markup`);

            const raw = mount(buildControl(type, { title: "A <b>B</b>", titleHtml: true }).toHtml());
            const rawTitle = raw.querySelector(".er-control__title");
            assert.ok(rawTitle && rawTitle.querySelector("b"), `${type}: titleHtml keeps markup`);
        });

        const button = mount(buildControl("button", { title: "<i>x</i> Run", titleHtml: true }).toHtml())
            .querySelector("button");
        assert.ok(button.querySelector("i"), "button: titleHtml keeps markup");
    });

    QUnit.test("Button markup and behaviour", function(assert) {
        const control = buildControl("button", { title: "Do <it>" });
        const host = mount(control.toHtml("", "margin: 1px;"));
        control.init();

        const button = host.querySelector("button");
        assert.notOk(host.querySelector(".er-control__title"), "no title span");
        assert.equal(button.textContent, "Do <it>", "title text, escaped");
        assert.equal(host.textContent.split("Do <it>").length - 1, 1, "title appears exactly once");
        assert.equal(button.getAttribute("type"), "button", "type=button");
        assert.notOk(/float/.test(button.getAttribute("style") || ""), "no float");
        assert.ok(/margin/.test(button.getAttribute("style") || ""), "css still applied");
        assert.ok(button.classList.contains("er-control__button") && button.classList.contains("er-control__button--action"), "BEM");

        const before = control.encoded;
        button.click();
        assert.equal(control.encoded, before + 1, "click increments value");
    });

    function rootVar(host) {
        return host.querySelector(".er-control").style.getPropertyValue("--er-colormap");
    }

    QUnit.test("ColorMap paints --er-colormap (interactive)", function(assert) {
        const sequential = OpenSeadragon.FlexRenderer.ColorMaps.schemeGroups.sequential;
        const control = buildControl("colormap", { default: sequential[0] });
        const host = mount(control.toHtml());
        control.init();

        const value = rootVar(host);
        assert.ok(value.includes("linear-gradient"), "var has gradient");
        assert.ok(value.includes("#"), "var has hex colors");
        const select = host.querySelector("select");
        assert.equal(select.style.background, "", "select has no inline background");
        assert.equal(select.style.backgroundImage, "", "select has no inline background-image");
        assert.ok(select.classList.contains("select-bordered"), "colormap role");
        assert.ok(host.querySelector(".er-control__colormap-preview"), "preview exists");

        control.set(sequential[1]);
        assert.notEqual(rootVar(host), value, "set() repaints the var");
        assert.equal(select.value, sequential[1], "select follows set()");
    });

    QUnit.test("ColorMap paints --er-colormap (non-interactive)", function(assert) {
        const control = buildControl("colormap", {}, false);
        const host = mount(control.toHtml());
        control.init();
        const value = rootVar(host);
        assert.ok(value.includes("linear-gradient") && value.includes("#"), "var set");
        const display = host.querySelector(".er-control__display--colormap");
        assert.equal(display.style.background, "", "display has no inline background");
    });

    QUnit.test("custom colormap swatch change updates the var", function(assert) {
        const control = buildControl("custom_colormap", { default: ["#000000", "#888888", "#ffffff"] });
        const host = mount(control.toHtml());
        control.init();
        const before = rootVar(host);
        assert.ok(before.includes("linear-gradient"), "initial var");
        const swatch = host.querySelector("input[type=color]");
        swatch.value = "#ff0000";
        swatch.dispatchEvent(new Event("change"));
        const after = rootVar(host);
        assert.ok(after.includes("#ff0000"), "var follows swatch");
        assert.equal(host.querySelector(".er-control__display--custom-colormap").style.background, "", "no inline background on display");

        const nonInteractive = buildControl("custom_colormap", {}, false);
        const host2 = mount(nonInteractive.toHtml());
        nonInteractive.init();
        assert.ok(rootVar(host2).includes("linear-gradient"), "non-interactive custom var");
    });

    QUnit.test("AdvancedSlider connect classes", function(assert) {
        const control = buildControl("advanced_slider");
        assert.ok(control.toHtml().length > 0, "markup without noUiSlider");
        assert.ok(typeof control.destroy === "function", "destroy exists");
        control.destroy();
        assert.ok(true, "destroy before init does not throw");

        const div = document.createElement("div");
        for (let i = 0; i < 3; i++) {
            const c = document.createElement("div");
            c.className = "noUi-connect";
            div.appendChild(c);
        }
        control.mask = [1, 0, 1, -1];
        control.params.inverted = false;
        control._updateConnectStyles(div);
        let connects = div.querySelectorAll(".noUi-connect");
        const active = () => Array.from(connects).map(c => c.classList.contains("er-slider__connect--active"));
        assert.deepEqual(active(), [true, false, true], "non-inverted: mask > 0 active");
        Array.from(connects).forEach(c => assert.equal(c.style.background, "", "no inline background"));

        control.params.inverted = true;
        control._updateConnectStyles(div);
        connects = div.querySelectorAll(".noUi-connect");
        assert.deepEqual(active(), [false, true, false], "inverted flips");
        assert.equal(connects[1].dataset.index, "1", "index kept");
        assert.ok(control._isConnectActive(1), "_isConnectActive");
    });

    QUnit.test("translator: Image strings, overrides, fallback, escaping, alert", function(assert) {
        const seen = [];
        UIControls.setTranslator((key, fallback, vars) => {
            seen.push(key);
            if (key === "image.hint") {
                return "HINT <b id=\"injected\">x</b>";
            }
            if (key === "image.noFile") {
                return "NOFILE";
            }
            if (key === "image.selected") {
                return "SEL";
            }
            return undefined;   // non-string → fallback
        });

        const control = buildControl("image", { strings: { "image.upload": "Override" } });
        const host = mount(control.toHtml());
        assert.ok(seen.includes("image.hint"), "translator called");
        assert.ok(host.textContent.includes("HINT <b id=\"injected\">x</b>"), "hint translated as text");
        assert.notOk(host.querySelector("#injected"), "translated output escaped");
        assert.ok(host.textContent.includes("SEL"), "selected translated");
        assert.equal(host.querySelector(".er-control__button--image-upload").textContent.trim(), "Override", "params.strings wins");

        const alerts = [];
        window.alert = msg => alerts.push(msg);
        control.init();
        host.querySelector(".er-control__button--image-upload").click();
        assert.deepEqual(alerts, ["NOFILE"], "alert uses translated image.noFile");

        UIControls.setTranslator(() => {
            throw new Error("boom");
        });
        const warn = console.warn;
        console.warn = () => {};
        let html;
        try {
            html = buildControl("image").toHtml();
        } finally {
            console.warn = warn;
        }
        assert.ok(html.includes("Upload Image"), "throwing translator falls back");
        assert.ok(html.includes("The atlas starts empty."), "throwing translator falls back (hint)");
    });

    QUnit.test("translator: Icon strings and t() helper", function(assert) {
        UIControls.setTranslator((key, fallback) => `T[${key}]`);
        const control = buildControl("icon", { strings: { "icon.close": "Zavřít" } });
        const host = mount(control.toHtml());
        pendingDestroy.push(control);
        assert.ok(host.textContent.includes("T[icon.pickerTitle]"), "picker title translated");
        assert.equal(host.querySelector(".er-control__input--icon-query").getAttribute("placeholder"), "T[icon.searchPlaceholder]", "placeholder");
        assert.equal(host.querySelector(".er-control__button--icon-close").getAttribute("aria-label"), "Zavřít", "params.strings override");
        assert.ok(host.textContent.includes("T[icon.tintBadge]"), "tint badge");

        control.init();
        assert.equal(host.querySelector(".er-control__preview--icon").title, "T[icon.unknown]", "unknown icon title");
        assert.equal(host.querySelector(".er-control__input--icon-color").title, "T[icon.color]", "color title");

        UIControls.setTranslator(null);
        assert.equal(UIControls.t("x.y", "Hello {name}", { name: "W" }), "Hello W", "var substitution");
        assert.equal(UIControls.t("x.y", "F", {}, { "x.y": "O {a}" }), "O {a}", "override wins, unknown var kept");
        assert.equal(control.t("icon.close", "Close"), "Zavřít", "IControl.t uses params.strings");
        assert.equal(UIControls.escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;", "escapeHtml");
    });
})();
