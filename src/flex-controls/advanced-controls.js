
(function($) {
/**
 * ColorMap Input
 * @class OpenSeadragon.FlexRenderer.UIControls.ColorMap
 */
$.FlexRenderer.UIControls.ColorMap = class extends $.FlexRenderer.UIControls.IControl {
    static docs() {
        return {
            summary: "Named colormap control producing vec3 samples from a float ratio.",
            description: "Loads a palette by name from the configured scheme group, uploads palette colors and step boundaries as uniforms, and samples colors through generated GLSL helper code. Supports discrete and continuous rendering modes.",
            kind: "ui-control",
            parameters: [
                { name: "steps", type: "number|array", default: 3 },
                { name: "default", type: "string", default: "YlOrRd" },
                { name: "mode", type: "string", default: "sequential" },
                { name: "interactive", type: "boolean", default: true },
                { name: "title", type: "string", default: "Colormap" },
                { name: "continuous", type: "boolean", default: false }
            ],
            glType: "vec3"
        };
    }

    /**
     * Envelope-level couplings, applied to every shader that nests a `colormap`
     * envelope. Surfaced in the published schema at
     * `$defs.uiControlEnvelopes.colormap['x-controlCouplings']` and reachable
     * at runtime via `ShaderConfigurator.getEnvelopeCouplingValidators("colormap")`.
     */
    static controlCouplings() {
        return [{
            name: "colormap_palette_in_mode",
            summary: "Colormap default must be a palette listed in schemeGroups[mode].",
            corrective: "Set default to a palette that appears in $.FlexRenderer.ColorMaps.schemeGroups[mode], or change mode to a group whose list includes the desired palette.",
            controls: ["default", "mode"],
            validate: (envelope) => {
                const palette = envelope && envelope.default;
                const mode = envelope && envelope.mode;
                // Skip array defaults — those belong to `custom_colormap`, which
                // does not constrain palette name to a scheme group.
                if (typeof palette !== "string" || typeof mode !== "string") {
                    return { ok: true };
                }
                const group = $.FlexRenderer.ColorMaps && $.FlexRenderer.ColorMaps.schemeGroups
                    && $.FlexRenderer.ColorMaps.schemeGroups[mode];
                if (!group) {
                    return { ok: true };
                }
                if (group.includes(palette)) {
                    return { ok: true };
                }
                return {
                    ok: false,
                    expected: { default: `∈ schemeGroups["${mode}"] = [${group.join(", ")}]` },
                    actual: { default: palette, mode }
                };
            }
        }];
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
        this._normalizeParams();
        this.prepare();
    }

    /**
     * Coerce caller-supplied params into the shape `init()` and `prepare()` expect.
     * If the user passed an array `default` they likely meant `type: "custom_colormap"` —
     * we warn rather than mutate the type, and fall back to a safe palette name so
     * `init()`'s `schemeGroups[mode].includes(...)` cannot blow up.
     */
    _normalizeParams() {
        const params = this._params || {};
        const groups = ($.FlexRenderer.ColorMaps && $.FlexRenderer.ColorMaps.schemeGroups) || {};
        const defaults = ($.FlexRenderer.ColorMaps && $.FlexRenderer.ColorMaps.defaults) || {};

        if (typeof params.mode !== "string" || !groups[params.mode]) {
            console.warn(
                `[FlexRenderer.UIControls.ColorMap] params.mode "${params.mode}" is not a known scheme group ` +
                `(${Object.keys(groups).join(", ")}); falling back to "sequential".`
            );
            params.mode = "sequential";
        }

        if (Array.isArray(params.default)) {
            console.warn(
                `[FlexRenderer.UIControls.ColorMap] params.default is an array — ` +
                `did you mean type: "custom_colormap"? Falling back to the default palette for mode "${params.mode}".`
            );
            params.default = defaults[params.mode];
        }

        if (typeof params.default !== "string" || !params.default) {
            params.default = defaults[params.mode];
        }
    }

    prepare() {
        //Note that builtin colormap must support 2->this.MAX_SAMPLES color arrays
        this.MAX_SAMPLES = 8;
        this.GLOBAL_GLSL_KEY = 'colormap_lut';

        this._prepareLut();

        this.parser = $.FlexRenderer.UIControls.getUiElement("color").decode;
        if (this.params.continuous) {
            this.cssGradient = this._continuousCssFromPallete;
        } else {
            this.cssGradient = this._discreteCssFromPallete;
        }
        this.owner.includeGlobalCode(this.GLOBAL_GLSL_KEY, this._glslCode());
    }

    /**
     * Shared setup for the atlas-backed lookup table.
     *
     * The palette used to live in the shader as `vec3 map[N]` plus `float steps[N+1]`, which cost
     * 18 uniform vectors for this class and 66 for `custom_colormap` — per control, per layer.
     * Every array element takes a full uniform vector in GLSL ES, so a handful of colormap layers
     * exhausted MAX_FRAGMENT_UNIFORM_VECTORS on mobile GPUs. Baking the resolved palette into a
     * 1-row RGBA strip in the texture atlas costs a single `int` uniform instead.
     */
    _prepareLut() {
        // 256 texels pad to 258, still inside the atlas' default 512px layer width, so the atlas
        // never has to grow a layer for one of these. 512 would pad past it and force a doubling.
        this.LUT_SIZE = 256;
        this.atlas = this.owner.backend ? this.owner.backend.secondAtlas : null;
        this.textureId = -1;
        this._lutDirty = true;
    }

    init() {
        this.value = this.load(this.params.default);

        //steps could have been set manually from the outside
        if (!Array.isArray(this.steps)) {
            this.setSteps();
        }

        const mode = this.params.mode;
        const group = $.FlexRenderer.ColorMaps.schemeGroups[mode];
        const requested = this.params.default;
        if (!this.value || !group || !group.includes(this.value)) {
            const fallback = $.FlexRenderer.ColorMaps.defaults[mode];
            if (requested && fallback && requested !== fallback) {
                // Visible signal so the script-driven layer (and any human
                // reading devtools) can correlate the unexpected preview
                // colour with a palette/mode mismatch. Behaviour is unchanged
                // — still falls back — to avoid breaking persisted configs
                // that rely on the substitution.
                // Printing the legal list makes the message self-correcting: the lookup is
                // case-sensitive ("turbo" is not "Turbo"), which is otherwise invisible.
                console.warn(
                    `[FlexRenderer.ColorMap] palette "${requested}" is not in schemeGroups["${mode}"]; ` +
                    `substituting with "${fallback}". Pick a mode whose schemeGroups list contains ` +
                    `the desired palette. schemeGroups["${mode}"] = ` +
                    `[${group ? group.join(", ") : ""}]`
                );
            }
            this.value = fallback;
        }
        this.colorPallete = $.FlexRenderer.ColorMaps[this.value][this.maxSteps];

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                _this.set(e.target.value);
                _this.owner.invalidate();
            };

            this._setPallete(this.colorPallete);
            // updateColormapUI() tolerates a missing node and hands it back as null. Without the
            // markup mounted there is nothing to populate: report it here rather than throwing
            // into $.FlexRenderer's init() catch, which reduces the failure to a generic
            // "the shader control will not work" and drops which control was at fault.
            let node = this.updateColormapUI();
            if (!node) {
                this._warnMissingNode("ColorMap", "The control will not be interactive.");
                return;
            }

            let schemas = [];
            for (let pallete of $.FlexRenderer.ColorMaps.schemeGroups[this.params.mode]) {
                schemas.push(`<option value="${pallete}">${pallete}</option>`);
            }
            node.innerHTML = schemas.join("");
            node.value = this.value;
            node.addEventListener("change", updater);
        } else {
            this._setPallete(this.colorPallete);
            this.updateColormapUI();
            //be careful with what the DOM elements contains or not if not interactive...
            let existsNode = document.getElementById(this.id);
            if (existsNode) {
                existsNode.style.background = this.cssGradient(this.pallete);
            }
        }
    }

    /**
     * GLSL for sampling the baked colormap.
     *
     * Emitted once for both `colormap` and `custom_colormap`: the two used to register separate
     * globals that differed only in MAX_SAMPLES, but the LUT form is identical, so
     * includeGlobalCode's identical-content check collapses them.
     */
    _glslCode() {
        return `
#define FLEX_COLORMAP_LUT_N ${this.LUT_SIZE}
vec3 sample_colormap_lut(in int textureId, in float ratio) {
// No atlas (e.g. the configurator preview path) — black beats the atlas' magenta error texel.
if (textureId < 0) return vec3(.0);
// Half-texel inset: ratio 0 lands on the centre of texel 0, ratio 1 on the centre of texel N-1.
// osd_atlas_texture() filters LINEAR against a 1px padding ring and does no inset of its own,
// so sampling the raw edge would bleed the padding in. Clamping first also keeps the uv
// mirroring inside osd_atlas_texture() on its identity branch.
float u = (0.5 + clamp(ratio, .0, 1.0) * float(FLEX_COLORMAP_LUT_N - 1)) / float(FLEX_COLORMAP_LUT_N);
return osd_atlas_texture(textureId, vec2(u, 0.5)).rgb;
}`;
    }

    /**
     * Colour at `t` in [0,1]. A direct port of the GLSL `sample_colormap` loop this replaces, so
     * baked output matches what the shader used to compute for the same palette and steps.
     * @param {number} t
     * @return {number[]} rgb, each 0..1
     */
    _evaluateColor(t) {
        const map = this.pallete;
        const steps = this.steps;
        const maxSteps = this.maxSteps;
        const discrete = !this.params.continuous;
        const at = (i) => [map[i * 3], map[i * 3 + 1], map[i * 3 + 2]];
        const mix = (a, b, s) => [
            a[0] + (b[0] - a[0]) * s,
            a[1] + (b[1] - a[1]) * s,
            a[2] + (b[2] - a[2]) * s
        ];

        for (let i = 1; i < this.MAX_SAMPLES + 1; i++) {
            if (t <= steps[i]) {
                if (discrete) {
                    return at(i - 1);
                }
                const scale = (t - steps[i - 1]) / (steps[i] - steps[i - 1]) - 0.5;
                if (scale < 0) {
                    //scale should be positive, but we need to keep the right direction
                    return i === 1 ? at(0) : mix(at(i - 1), at(i - 2), -scale);
                }
                if (i === maxSteps) {
                    return at(i - 1);
                }
                return mix(at(i - 1), at(i), scale);
            }
            if (i >= maxSteps) {
                return at(i - 1);
            }
        }
        // The GLSL original had no return here — falling off the loop was undefined behaviour.
        // Pinning the last colour makes the baked result deterministic.
        return at(Math.max(0, maxSteps - 1));
    }

    /**
     * Render the palette into a LUT_SIZE x 1 RGBA byte strip.
     * @return {Uint8Array}
     */
    _bakeLut() {
        const n = this.LUT_SIZE;
        const pixels = new Uint8Array(n * 4);
        for (let k = 0; k < n; k++) {
            // k/(n-1) inverts the shader's inset mapping exactly, so texel k holds the colour the
            // old shader produced at that ratio.
            const color = this._evaluateColor(k / (n - 1));
            for (let channel = 0; channel < 3; channel++) {
                const value = color[channel];
                pixels[k * 4 + channel] = Math.round(Math.min(1, Math.max(0, value || 0)) * 255);
            }
            pixels[k * 4 + 3] = 255;
        }
        return pixels;
    }

    /**
     * Bake and push the LUT to the atlas, reusing this control's own slot.
     *
     * Deliberately does not go through IAtlasTextureControl's shared `__flexRendererCache`: this
     * entry is mutated in place whenever the palette or steps change, so sharing a slot between
     * two controls would let each corrupt the other.
     */
    _bakeAndUploadLut() {
        // prepare() flags the LUT dirty before init() has produced a palette or steps. Stay dirty
        // rather than baking garbage, so the first draw after init() still gets a real LUT.
        if (!this.pallete || !Array.isArray(this.steps)) {
            return;
        }
        this._lutDirty = false;
        if (!this.atlas) {
            this.textureId = -1;
            return;
        }
        const pixels = this._bakeLut();
        const opts = { width: this.LUT_SIZE, height: 1 };
        if (this.textureId < 0 || !this.atlas.updateImage(this.textureId, pixels, opts)) {
            this.textureId = this.atlas.addImage(pixels, opts);
        }
        this.atlas._commitUploads();
    }

    updateColormapUI() {
        let node = document.getElementById(this.id);
        if (node) {
            node.style.background = this.cssGradient(this.colorPallete);
        }
        return node;
    }

    /**
     * Setup the pallete density, the value is trimmed with a cap of MAX_SAMPLES
     * @param {(number|number[])} steps - amount of sampling steps
     *   number: input number of colors to use
     *   array: put number of colors + 1 values, example: for three color pallete,
     *      put 4 numbers: 2 separators and 2 bounds (min, max value)
     * @param maximum max number of steps available, should not be greater than this.MAX_SAMPLES
     *   unless you know you can modify that value
     */
    setSteps(steps, maximum = this.MAX_SAMPLES) {
        this.steps = steps || this.params.steps;
        if (!Array.isArray(this.steps)) {
            if (this.steps < 2) {
                this.steps = 2;
            }
            if (this.steps > maximum) {
                this.steps = maximum;
            }
            this.maxSteps = this.steps;

            this.steps++; //step generated must have one more value (separators for colors)
            let step = 1.0 / this.maxSteps;
            this.steps = new Array(maximum + 1);
            this.steps.fill(-1);
            this.steps[0] = 0;
            for (let i = 1; i < this.maxSteps; i++) {
                this.steps[i] = this.steps[i - 1] + step;
            }
            this.steps[this.maxSteps] = 1.0;
        } else {
            this.steps = this.steps.filter(x => x >= 0);
            this.steps.sort();
            let max = this.steps[this.steps.length - 1];
            let min = this.steps[0];
            this.steps = this.steps.slice(0, maximum + 1);
            this.maxSteps = this.steps.length - 1;
            // Normalize to 0..1 if the caller passed an unnormalized range. The previous
            // `forEach` here computed the rescaled values and discarded them — a no-op
            // disguised as normalization. `map` actually applies it.
            const span = max - min;
            if (span > 0 && (min !== 0 || max !== 1)) {
                this.steps = this.steps.map(x => (x - min) / span);
            }
            for (let i = this.maxSteps + 1; i < maximum + 1; i++) {
                this.steps.push(-1);
            }
        }
        this._lutDirty = true;
    }

    _continuousCssFromPallete(pallete) {
        if (!pallete || !pallete.length) {
            return "";
        }
        let css = [`linear-gradient(90deg`];
        for (let i = 0; i < this.maxSteps; i++) {
            css.push(`, ${pallete[i]} ${Math.round((this.steps[i] + this.steps[i + 1]) * 50)}%`);
        }
        css.push(")");
        return css.join("");
    }

    _discreteCssFromPallete(pallete) {
        if (!pallete || !pallete.length) {
            return "";
        }
        let css = [`linear-gradient(90deg, ${pallete[0]} 0%`];
        for (let i = 1; i < this.maxSteps; i++) {
            css.push(`, ${pallete[i - 1]} ${Math.round(this.steps[i] * 100)}%, ${pallete[i]} ${Math.round(this.steps[i] * 100)}%`);
        }
        css.push(")");
        return css.join("");
    }

    /**
     * Rebuild `this.pallete` (flat float uniform buffer) from a canonical hex-string palette.
     * Contract: `hexColors` MUST be an array of `"#rrggbb"` strings. Input normalization
     * belongs at the boundary (init / updater / cache round-trip), not here. The previous
     * implementation tried to be polymorphic (parse strings on one call, re-pad on another)
     * and crashed when given any other shape because `this.pallete` was never initialized
     * along the alternate branch.
     */
    _setPallete(hexColors) {
        this.pallete = [];
        for (const color of hexColors) {
            this.pallete.push(...this.parser(color));
        }
        while (this.pallete.length < 3 * this.MAX_SAMPLES) {
            this.pallete.push(0);
        }
        this._lutDirty = true;
    }

    /**
     * Select a palette by name. The single write path for both the UI updater and programmatic
     * callers (navigator state sync, cache restore), so the two cannot drift.
     * @param {string} encodedValue palette name, must belong to schemeGroups[params.mode]
     */
    set(encodedValue) {
        const group = $.FlexRenderer.ColorMaps.schemeGroups[this.params.mode];
        let name = encodedValue;
        if (!name || !group || !group.includes(name)) {
            name = $.FlexRenderer.ColorMaps.defaults[this.params.mode];
        }

        this.value = name;
        this.colorPallete = $.FlexRenderer.ColorMaps[this.value][this.maxSteps];
        this._setPallete(this.colorPallete);  // flags the LUT dirty, glDrawing rebakes

        const node = document.getElementById(this.id);
        if (node) {
            node.style.background = this.cssGradient(this.colorPallete);
            if (this.params.interactive) {
                node.value = this.value;
            }
        }

        this.store(this.value);
        this.changed("default", this.pallete, this.value, this);
    }

    glDrawing(program, gl) {
        if (this._lutDirty) {
            this._bakeAndUploadLut();
        }
        gl.uniform1i(this.textureIdGluint, this.textureId);
    }

    glLoaded(program, gl) {
        this.textureIdGluint = gl.getUniformLocation(program, this.webGLVariableName + "_textureId");
        // The atlas slot survives a relink, but the uniform value does not.
        this._lutDirty = true;
    }

    toHtml(classes = "", css = "") {
        if (!this.params.interactive) {
            const display = `<span id="${this.id}" class="er-control__display er-control__display--colormap"${$.FlexRenderer.UIControls.styleAttr(css)}>${this.load(this.params.default)}</span>`;
            return $.FlexRenderer.UIControls.renderControl("colormap", this.params.title, display, classes);
        }

        const input = `<select id="${this.id}" class="er-control__input er-control__input--colormap"${$.FlexRenderer.UIControls.styleAttr(css)}></select>`;
        return $.FlexRenderer.UIControls.renderControl("colormap", this.params.title, input, classes);
    }

    define() {
        return `uniform int ${this.webGLVariableName}_textureId;`;
    }

    get type() {
        return "vec3";
    }

    sample(value = undefined, valueGlType = 'void') {
        if (!value || valueGlType !== 'float') {
            throw new Error(`Incompatible control. Colormap cannot be used with ${this.name} (sampling type '${valueGlType}').`);
        }
        return `sample_colormap_lut(${this.webGLVariableName}_textureId, ${value})`;
    }

    get supports() {
        return {
            steps: 3,
            default: "YlOrRd",
            mode: "sequential",  // todo provide 'set' of available values for documentation
            interactive: true,
            title: "Colormap",
            continuous: false,
        };
    }

    get supportsAll() {
        return {
            steps: [3, [0, 0.5, 1]]
        };
    }

    get raw() {
        return this.pallete;
    }

    get encoded() {
        return this.value;
    }
};
$.FlexRenderer.UIControls.registerClass("colormap", $.FlexRenderer.UIControls.ColorMap);


$.FlexRenderer.UIControls.registerClass("custom_colormap", class extends $.FlexRenderer.UIControls.ColorMap {
    static docs() {
        return {
            summary: "Editable custom colormap control.",
            description: "Variant of the colormap control that uses user-provided color arrays instead of named palettes and expands the maximum sample count to 32.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "array", default: ["#000000", "#888888", "#ffffff"] },
                { name: "steps", type: "number|array", default: 3 },
                { name: "mode", type: "string", default: "sequential" },
                { name: "interactive", type: "boolean", default: true },
                { name: "title", type: "string", default: "Colormap:" },
                { name: "continuous", type: "boolean", default: false }
            ],
            glType: "vec3"
        };
    }

    static controlCouplings() {
        // The parent's palette-in-mode coupling has no meaning here:
        // `default` is an array of user-supplied colors, not a named palette.
        return [];
    }

    _normalizeParams() {
        // Hook overridden because the parent ColorMap's normalization encodes invariants specific to
        // its own semantics (params.default must be a named palette string in some scheme group).
        // custom_colormap has different semantics — params.default is the palette itself, as an array.
        // Inheriting the parent's normalization would clobber legitimate user input.
        // General rule: parent-class invariants that don't hold for a subclass belong behind an
        // overridable hook, not in a constructor-driven mutation path.
    }

    /**
     * Coerce an arbitrary palette value (user input or stale cache) into the canonical shape:
     * an array of `"#rrggbb"` hex strings. Called once at the init boundary so every internal
     * consumer (`_setPallete`, `cssGradient`, the color-input UI, the cache round-trip) can
     * assume the canonical shape and skip its own defensive branching.
     *
     * Tolerated inputs:
     *   - array of hex strings (canonical)              → returned as-is
     *   - array of [r, g, b] or [r, g, b, a] in 0..1   → converted to hex (alpha dropped — GLSL is vec3)
     *   - anything else                                  → warn, fall back to supports().default
     */
    _normalizePalette(value) {
        if (Array.isArray(value) && value.length > 0) {
            if (value.every(item => typeof item === "string")) {
                return value;
            }
            if (value.every(item => Array.isArray(item) && item.length >= 3)) {
                return value.map(rgb => this._rgbTupleToHex(rgb));
            }
        }
        console.warn(
            `[FlexRenderer.UIControls.custom_colormap] palette has unsupported shape; ` +
            `expected an array of "#rrggbb" hex strings (or [r,g,b] tuples in 0..1). ` +
            `Falling back to default.`,
            value
        );
        return this.supports.default;
    }

    _rgbTupleToHex(tuple) {
        const channel = (n) => {
            const v = Math.max(0, Math.min(255, Math.round(Number(n) * 255)));
            return v.toString(16).padStart(2, "0");
        };
        return `#${channel(tuple[0])}${channel(tuple[1])}${channel(tuple[2])}`;
    }

    prepare() {
        this.MAX_SAMPLES = 32;
        // Same key as the parent: the LUT helper no longer depends on MAX_SAMPLES, so the two
        // classes emit byte-identical GLSL and includeGlobalCode keeps a single copy.
        this.GLOBAL_GLSL_KEY = 'colormap_lut';

        this._prepareLut();

        this.parser = $.FlexRenderer.UIControls.getUiElement("color").decode;
        if (this.params.continuous) {
            this.cssGradient = this._continuousCssFromPallete;
        } else {
            this.cssGradient = this._discreteCssFromPallete;
        }
        this.owner.includeGlobalCode(this.GLOBAL_GLSL_KEY, this._glslCode());
    }

    init() {
        // Pin the shape contract at the boundary: `this.value` / `this.colorPallete` are always
        // an array of `"#rrggbb"` hex strings from this point on. The loaded value may be the
        // user-supplied default in any tolerated input shape, or a stale cache entry from an
        // earlier (possibly buggy) run — normalize once here so internal methods can trust it.
        this.value = this._normalizePalette(this.load(this.params.default));

        if (!Array.isArray(this.steps)) {
            this.setSteps();
        }
        if (this.maxSteps < this.value.length) {
            this.value = this.value.slice(0, this.maxSteps);
        }

        //super class compatibility in methods, keep updated
        this.colorPallete = this.value;

        if (this.params.interactive) {
            this._setPallete(this.colorPallete);
            this._renderPaletteInputs();
        } else {
            this._setPallete(this.colorPallete);
            this.updateColormapUI();
            //be careful with what the DOM elements contains or not if not interactive...
            let existsNode = document.getElementById(this.id);
            if (existsNode) {
                existsNode.style.background = this.cssGradient(this.pallete);
            }
        }
    }

    /**
     * (Re)build the row of color inputs from `this.colorPallete` and bind their change handlers.
     * The whole row is rebuilt rather than updated in place because a new palette may have a
     * different number of colors than the one currently rendered.
     */
    _renderPaletteInputs() {
        const node = this.updateColormapUI();
        if (!node) {
            return;
        }

        const _this = this;
        const updater = function(e) {
            const self = e.target;
            const index = Number.parseInt(self.dataset.index, 10);
            const selected = self.value;

            if (Number.isInteger(index)) {
                _this.colorPallete[index] = selected;
                _this._setPallete(_this.colorPallete);
                if (self.parentElement) {
                    self.parentElement.style.background = _this.cssGradient(_this.colorPallete);
                }
                _this.value = _this.colorPallete;
                _this.store(_this.colorPallete);
                _this.changed("default", _this.pallete, _this.value, _this);
                _this.owner.invalidate();
            }
        };

        const width = 1 / this.colorPallete.length * 100;
        node.innerHTML = this.colorPallete.map((x, i) => `<input type="color" style="width: ${width}%; height: 30px; background: none; border: none; padding: 4px 5px;" value="${x}" data-index="${i}">`).join("");
        Array.from(node.children).forEach(child => child.addEventListener("change", updater));
    }

    /**
     * Replace the whole palette. Accepts any shape `_normalizePalette` tolerates, so a value
     * coming from a stale cache or another drawer's `encoded` can be applied directly.
     * @param {string[]} encodedValue array of "#rrggbb" colors
     */
    set(encodedValue) {
        let palette = this._normalizePalette(encodedValue);
        if (this.maxSteps < palette.length) {
            palette = palette.slice(0, this.maxSteps);
        }

        this.value = palette;
        //super class compatibility in methods, keep updated
        this.colorPallete = palette;
        this._setPallete(this.colorPallete);

        if (this.params.interactive) {
            this._renderPaletteInputs();
        } else {
            // repaints the swatch strip from this.colorPallete
            this.updateColormapUI();
        }

        this.store(this.colorPallete);
        this.changed("default", this.pallete, this.value, this);
    }

    toHtml(classes = "", css = "") {
        if (!this.params.interactive) {
            const display = `<span id="${this.id}" class="er-control__display er-control__display--custom-colormap"${$.FlexRenderer.UIControls.styleAttr(css)}>&emsp;</span>`;
            return $.FlexRenderer.UIControls.renderControl("custom-colormap", this.params.title, display, classes);
        }

        const display = `<span id="${this.id}" class="er-control__display er-control__display--custom-colormap"${$.FlexRenderer.UIControls.styleAttr(css)}></span>`;
        return $.FlexRenderer.UIControls.renderControl("custom-colormap", this.params.title, display, classes);
    }

    get supports() {
        return {
            default: ["#000000", "#888888", "#ffffff"],
            steps: 3,  // todo probably not necessary
            mode: "sequential",  // todo not used
            interactive: true,
            title: "Colormap:",
            continuous: false,
        };
    }

    get supportsAll() {
        return {
            steps: [3, [0, 0.5, 1]]
        };
    }
});

/**
 * Advanced slider that can define multiple points and interval masks
 * | --- A - B -- C -- D ----- |
 * will be sampled with mask float[5], the result is
 * the percentage reached within this interval: e.g. if C <= ratio < D, then
 * the result is  4/5 * mask[3]   (4-th interval out of 5 reached, multiplied by 4th mask)
 * @class OpenSeadragon.FlexRenderer.UIControls.AdvancedSlider
 */
$.FlexRenderer.UIControls.AdvancedSlider = class extends $.FlexRenderer.UIControls.IControl {
    static docs() {
        return {
            summary: "Multi-breakpoint slider with per-interval mask values.",
            description: "Stores ordered breakpoints and interval masks, uploads both arrays to GLSL, and samples either the active mask or a masked interval ratio through generated helper code. Interactive mode depends on noUiSlider being present.",
            kind: "ui-control",
            parameters: [
                { name: "breaks", type: "array", default: [0.2, 0.8] },
                { name: "mask", type: "array", default: [1, 0, 1] },
                { name: "interactive", type: "boolean", default: true },
                { name: "inverted", type: "boolean", default: true },
                { name: "maskOnly", type: "boolean", default: true },
                { name: "toggleMask", type: "boolean", default: true },
                { name: "title", type: "string", default: "Threshold" },
                { name: "min", type: "number", default: 0 },
                { name: "max", type: "number", default: 1 },
                { name: "minGap", type: "number", default: 0.05 },
                { name: "step", type: "null|number", default: null },
                { name: "pips", type: "object", description: "noUiSlider pips config. Extra field `labels` accepts an object map { value: 'text' } that overrides the displayed text for matching pip positions; unmatched pips keep the numeric format. When `labels` is present, pip text is rendered vertically." }
            ],
            glType: "float"
        };
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
        this.MAX_SLIDERS = 12;
        // Breaks and masks are packed four floats to a vec4. A GLSL ES array spends a full
        // uniform vector on every element regardless of its type, so the previous
        // float[12] + float[13] cost 25 vectors per control where vec4[3] + vec4[4] cost 7.
        this.BREAK_VEC4S = Math.ceil(this.MAX_SLIDERS / 4);
        this.MASK_VEC4S = Math.ceil((this.MAX_SLIDERS + 1) / 4);

        this.owner.includeGlobalCode('advanced_slider', `
#define ADVANCED_SLIDER_LEN ${this.MAX_SLIDERS}
#define ADVANCED_SLIDER_BREAK_VEC4S ${this.BREAK_VEC4S}
#define ADVANCED_SLIDER_MASK_VEC4S ${this.MASK_VEC4S}

// Component index into the packed arrays. GLSL ES 3.00 allows dynamic indexing of a vector,
// so this compiles to the same addressing the flat float arrays used to do.
float advanced_slider_break(in vec4 packed[ADVANCED_SLIDER_BREAK_VEC4S], in int i) {
    return packed[i >> 2][i & 3];
}
float advanced_slider_mask(in vec4 packed[ADVANCED_SLIDER_MASK_VEC4S], in int i) {
    return packed[i >> 2][i & 3];
}

float sample_advanced_slider(in float ratio, in vec4 breaks[ADVANCED_SLIDER_BREAK_VEC4S], in vec4 mask[ADVANCED_SLIDER_MASK_VEC4S], in bool maskOnly, in float minValue) {
float bigger = .0, actualLength = .0, masked = minValue;
bool sampling = true;
for (int i = 0; i < ADVANCED_SLIDER_LEN; i++) {
    float breakValue = advanced_slider_break(breaks, i);
    if (breakValue < .0) {
        if (sampling) masked = advanced_slider_mask(mask, i);
        sampling = false;
        break;
    }

    if (sampling) {
        if (ratio <= breakValue) {
            sampling = false;
            masked = advanced_slider_mask(mask, i);
        } else bigger++;
    }
    actualLength++;
}
if (sampling) masked = advanced_slider_mask(mask, ADVANCED_SLIDER_LEN);
if (maskOnly) return masked;
return masked * bigger / actualLength;
}`);
    }

    /**
     * Copy `values` into a vec4-aligned buffer.
     *
     * Padded with -1 rather than 0 because -1 is already this control's "unused slot" sentinel —
     * the sampler loop breaks on a negative break value, so a 0 pad would read as a real
     * breakpoint at the bottom of the range.
     *
     * @param {number[]} values
     * @param {number} vec4Count
     * @return {Float32Array}
     */
    _packVec4(values, vec4Count) {
        const packed = new Float32Array(vec4Count * 4);
        packed.fill(-1);
        const count = Math.min(values.length, packed.length);
        for (let i = 0; i < count; i++) {
            packed[i] = values[i];
        }
        return packed;
    }

    init() {
        this._updatePending = false;
        //encoded values hold breaks values between min and max,
        // Pin the shape contract at the boundary: `encodedValues` and `mask` are always arrays of
        // finite numbers from this point on. Loaders may return user-supplied input or stale cache
        // entries in any shape; normalize once here so the rest of init() and every later method
        // (slider setup, mask toggling, glDrawing) can skip its own defensive branching.
        this.encodedValues = this._normalizeNumberArray(
            this.load(this.params.breaks, "breaks"),
            this.supports.breaks,
            "breaks"
        );
        this.mask = this._normalizeNumberArray(
            this.load(this.params.mask, "mask"),
            this.supports.mask,
            "mask"
        );

        this.value = this.encodedValues.map(this._normalize.bind(this));
        this.value = this.value.slice(0, this.MAX_SLIDERS);
        this.sampleSize = this.value.length;

        this.mask = this.mask.slice(0, this.MAX_SLIDERS + 1);
        let size = this.mask.length;
        this.connects = this.value.map(_ => true);
        this.connects.push(true); //intervals have +1 elems
        for (let i = size; i < this.MAX_SLIDERS + 1; i++) {
            this.mask.push(-1);
        }

        if (!this.params.step || this.params.step < 1) {
            delete this.params.step;
        }

        let limit =  this.value.length < 2 ? undefined : this.params.max;

        let format = this.params.max < 10 ? {
            to: v => (v).toLocaleString('en-US', { minimumFractionDigits: 1 }),
            from: v => Number.parseFloat(v)
        } : {
            to: v => (v).toLocaleString('en-US', { minimumFractionDigits: 0 }),
            from: v => Number.parseFloat(v)
        };

        // `pips.labels` is our extension over noUiSlider — a { value: "text" } map
        // that overrides the displayed text for matching pip positions while leaving
        // tooltips (which share `format`) numeric. Strip it from the object handed
        // to noUiSlider so its config remains pure.
        const pipsLabels = this.params.pips && typeof this.params.pips.labels === "object"
            ? this.params.pips.labels : null;
        let userPips = this.params.pips;
        if (pipsLabels) {
            userPips = $.extend({}, this.params.pips);
            delete userPips.labels;
        }
        const pipsFormat = pipsLabels ? {
            to: v => {
                if (Object.prototype.hasOwnProperty.call(pipsLabels, v)) {
                    return String(pipsLabels[v]);
                }
                if (Object.prototype.hasOwnProperty.call(pipsLabels, String(v))) {
                    return String(pipsLabels[String(v)]);
                }
                for (const k of Object.keys(pipsLabels)) {
                    if (Math.abs(Number(k) - v) < 1e-6) {
                        return String(pipsLabels[k]);
                    }
                }
                return format.to(v);
            },
            from: format.from
        } : format;

        // Everything in this branch dereferences the mount — noUiSlider.create, the pip/connect
        // queries and the change handler. Report an absent mount and leave the control
        // non-interactive rather than throwing into FlexRenderer's init() catch, which reduces the
        // failure to a generic message and drops both the control id and the reason. Gating on the
        // resolved node instead of returning early keeps the value padding at the end of init()
        // reachable — the uniform needs it whether or not a slider was built.
        const container = this.params.interactive ? document.getElementById(this.id) : null;
        if (this.params.interactive && !container) {
            this._warnMissingNode("AdvancedSlider", "The slider will not be created.");
        }

        if (container) {
            const _this = this;
            if (!window.noUiSlider) {
                throw new Error("noUiSlider not found: install noUiSlide library!");
            }
            window.noUiSlider.create(container, {
                range: {
                    min: _this.params.min,
                    max: _this.params.max
                },
                step: _this.params.step,
                start: _this.encodedValues,
                margin: _this.params.minGap,
                limit: limit,
                connect: _this.connects,
                direction: 'ltr',
                orientation: 'horizontal',
                behaviour: 'drag',
                tooltips: true,
                format: format,
                pips: $.extend({format: pipsFormat}, userPips)
            });

            if (pipsLabels) {
                container.classList.add("er-slider--vertical-pips");
            }

            if (this.params.pips) {
                let pips = container.querySelectorAll('.noUi-value');
                /* eslint-disable no-inner-declarations */
                function clickOnPip() {
                    let idx = 0;
                    /* eslint-disable no-invalid-this */
                    let value = Number(this.getAttribute('data-value'));
                    let encoded = container.noUiSlider.get();
                    let values = encoded.map(v => Number.parseFloat(v));

                    if (Array.isArray(values)) {
                        let closest = Math.abs(values[0] - value);
                        for (let i = 1; i < values.length; i++) {
                            let d = Math.abs(values[i] - value);
                            if (d < closest) {
                                idx = i;
                                closest = d;
                            }
                        }
                        container.noUiSlider.setHandle(idx, value, false, false);
                    } else { //just one
                        container.noUiSlider.set(value);
                    }
                    value = _this._normalize(value);
                    _this.value[idx] = value;

                    _this.changed("breaks", _this.value, encoded, _this);
                    _this.store(values, "breaks");
                    _this.owner.invalidate();
                }

                for (let i = 0; i < pips.length; i++) {
                    pips[i].addEventListener('click', clickOnPip);
                }
            }

            if (this.params.toggleMask) {
                this._originalMask = this.mask.map(x => x > 0 ? x : 1);
                let connects = container.querySelectorAll('.noUi-connect');
                for (let i = 0; i < connects.length; i++) {
                    connects[i].addEventListener('mouseup', function(e) {
                        let d = Math.abs(Date.now() - _this._timer);
                        _this._timer = 0;
                        if (d >= 180) {
                            return;
                        }

                        let idx = Number.parseInt(this.dataset.index, 10);
                        _this.mask[idx] = _this.mask[idx] > 0 ? 0 : _this._originalMask[idx];
                        /* eslint-disable eqeqeq */
                        this.style.background = (!_this.params.inverted && _this.mask[idx] > 0) ||
                            (_this.params.inverted && _this.mask[idx] == 0) ?
                                "oklch(var(--er))" : "";
                        _this.owner.invalidate();
                        _this._ignoreNextClick = idx !== 0 && idx !== _this.sampleSize - 1;
                        _this.changed("mask", _this.mask, _this.mask, _this);
                        _this.store(_this.mask, "mask");
                    });

                    connects[i].addEventListener('mousedown', function(e) {
                        _this._timer = Date.now();
                    });

                    connects[i].style.cursor = "pointer";
                }
            }

            container.noUiSlider.on("change", function(strValues, handle, unencoded, tap, positions, noUiSlider) {
                _this.value[handle] = _this._normalize(unencoded[handle]);
                _this.encodedValues = strValues;
                if (_this._ignoreNextClick) {
                    _this._ignoreNextClick = false;
                } else if (!_this._updatePending) {
                    //can be called multiple times upon multiple handle updates, do once if possible
                    _this._updatePending = true;
                    setTimeout(_ => {
                        //todo re-scale values or filter out -1ones
                        _this.changed("breaks", _this.value, strValues, _this);
                        _this.store(unencoded, "breaks");

                        _this.owner.invalidate();
                        _this._updatePending = false;
                    }, 50);
                }
            });

            this._updateConnectStyles(container);
        }

        //do at last since value gets stretched by -1ones
        for (let i =  this.sampleSize; i < this.MAX_SLIDERS; i++) {
            this.value.push(-1);
        }
    }

    _normalize(value) {
        return (value - this.params.min) / (this.params.max - this.params.min);
    }

    /**
     * Coerce an arbitrary `breaks` / `mask` value (user input or stale cache) into the canonical
     * shape: an array of finite numbers. Tolerates a single-number input (treated as a one-element
     * array, since `breaks: 0.5` is a reasonable user shorthand). Anything else — non-array,
     * empty, full of NaN — warns and returns the supports() default. The single-number branch is
     * the only "convenience" coercion; everything else fails loudly so silent corruption can't
     * propagate into uniforms.
     */
    _normalizeNumberArray(value, fallback, paramName) {
        let candidate = value;
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            candidate = [candidate];
        }
        if (Array.isArray(candidate)) {
            const cleaned = candidate
                .map(v => Number.parseFloat(v))
                .filter(v => Number.isFinite(v));
            if (cleaned.length > 0) {
                return cleaned;
            }
        }
        console.warn(
            `[FlexRenderer.UIControls.AdvancedSlider] params.${paramName} has unsupported shape; ` +
            `expected an array of finite numbers. Falling back to default.`,
            value
        );
        return fallback.slice();
    }

    _updateConnectStyles(container) {
        if (!container) {
            container = document.getElementById(this.id);
        }
        // Reached from setMask() long after init(), so a missing mount here is either a control
        // that never became interactive (already reported by init()) or markup torn down by the
        // host: a no-op, not a new fault to report.
        if (!container) {
            return;
        }
        let pips = container.querySelectorAll('.noUi-connect');
        for (let i = 0; i < pips.length; i++) {
            /* eslint-disable eqeqeq */
            pips[i].style.background = (!this.params.inverted && this.mask[i] > 0) ||
                (this.params.inverted && this.mask[i] == 0) ?
                "oklch(var(--er))" : "";
            pips[i].dataset.index = (i).toString();
        }
    }

    getIntervalCount() {
        const breaks = Array.isArray(this.encodedValues) ? this.encodedValues : [];
        return Math.max(1, breaks.length + 1);
    }

    setMask(maskValues, store = true) {
        const values = Array.isArray(maskValues) ? maskValues.slice(0, this.MAX_SLIDERS + 1) : [];
        while (values.length < this.MAX_SLIDERS + 1) {
            values.push(-1);
        }

        this.mask = values;
        this._originalMask = this.mask.map(x => x > 0 ? x : 1);

        if (store) {
            this.store(this.mask, "mask");
        }

        if (this.params.interactive) {
            this._updateConnectStyles();
        }
    }

    syncMaskToIntervals(mapper = undefined, store = true) {
        const intervalCount = this.getIntervalCount();
        const values = [];
        for (let index = 0; index < intervalCount; index++) {
            values.push(typeof mapper === "function" ? mapper(index, intervalCount) : index);
        }
        this.setMask(values, store);
    }

    /**
     * Replace the breakpoints, and optionally the mask.
     *
     * `encoded` carries the breaks only, so the array form is what round-trips through
     * `IControl.createCacheObject` and the navigator state sync. The object form
     * `{breaks, mask}` exists for callers that want to restore both halves of the state at once.
     *
     * @param {number[]|number|{breaks: number[], mask: number[]}} encodedValue
     */
    set(encodedValue) {
        let breaks = encodedValue;
        let mask = null;
        if (encodedValue && !Array.isArray(encodedValue) && typeof encodedValue === "object") {
            breaks = encodedValue.breaks;
            mask = encodedValue.mask;
        }

        breaks = this._normalizeNumberArray(breaks, this.supports.breaks, "breaks")
            .slice(0, this.MAX_SLIDERS);

        this.encodedValues = breaks;
        this.value = breaks.map(this._normalize.bind(this));
        this.sampleSize = this.value.length;

        if (Array.isArray(mask)) {
            this.setMask(mask, true);
        }

        const container = document.getElementById(this.id);
        if (container && container.noUiSlider) {
            // second argument false: do not fire noUiSlider's own 'set' event, the "change"
            // handler registered in init() would re-enter this state as if the user dragged.
            container.noUiSlider.set(breaks, false);
        }

        this.store(this.encodedValues, "breaks");
        this.changed("breaks", this.value, this.encodedValues, this);

        //do at last since value gets stretched by -1ones
        for (let i = this.sampleSize; i < this.MAX_SLIDERS; i++) {
            this.value.push(-1);
        }
    }

    glDrawing(program, gl) {
        gl.uniform4fv(this.breaksGluint, this._packVec4(this.value, this.BREAK_VEC4S));
        gl.uniform4fv(this.maskGluint, this._packVec4(this.mask, this.MASK_VEC4S));
    }

    glLoaded(program, gl) {
        this.minGluint = gl.getUniformLocation(program, this.webGLVariableName + "_min");
        gl.uniform1f(this.minGluint, this.params.min);
        this.breaksGluint = gl.getUniformLocation(program, this.webGLVariableName + "_breaks[0]");
        this.maskGluint = gl.getUniformLocation(program, this.webGLVariableName + "_mask[0]");
    }

    toHtml(classes = "", css = "") {
        if (!this.params.interactive) {
            return "";
        }
        const slider = `<div id="${this.id}" class="er-control__widget er-control__widget--advanced-slider"${$.FlexRenderer.UIControls.styleAttr(`height: 9px; display: inline-block;${css}`)}></div>`;
        return $.FlexRenderer.UIControls.renderControl("advanced-slider", this.params.title, slider, classes);
    }

    define() {
        return `uniform float ${this.webGLVariableName}_min;
uniform vec4 ${this.webGLVariableName}_breaks[ADVANCED_SLIDER_BREAK_VEC4S];
uniform vec4 ${this.webGLVariableName}_mask[ADVANCED_SLIDER_MASK_VEC4S];`;
    }

    get type() {
        return "float";
    }

    sample(value = undefined, valueGlType = 'void') {
        if (!value || valueGlType !== 'float') {
            throw new Error(`Incompatible control. Advanced slider cannot be used with ${this.name} (sampling type '${valueGlType}').`);
        }
        return `sample_advanced_slider(${value}, ${this.webGLVariableName}_breaks, ${this.webGLVariableName}_mask, ${this.params.maskOnly}, ${this.webGLVariableName}_min)`;
    }

    get supports() {
        return {
            breaks: [0.2, 0.8],
            mask: [1, 0, 1],
            interactive: true,
            inverted: true,
            maskOnly: true,
            toggleMask: true,
            title: "Threshold",
            min: 0,
            max: 1,
            minGap: 0.05,
            step: null,
            pips: {
                mode: 'positions',
                values: [0, 20, 40, 50, 60, 80, 90, 100],
                density: 4
            }
        };
    }

    get supportsAll() {
        return {
            step: [null, 0.1]
        };
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.encodedValues;
    }
};
$.FlexRenderer.UIControls.registerClass("advanced_slider", $.FlexRenderer.UIControls.AdvancedSlider);

/**
 * Text area input
 * @class WebGLModule.UIControls.TextArea
 */
$.FlexRenderer.UIControls.TextArea = class extends $.FlexRenderer.UIControls.IControl {
    static docs() {
        return {
            summary: "Textarea control for free-form text values.",
            description: "Renders a textarea, stores string values, and does not define or upload any GLSL uniform.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "string", default: "" },
                { name: "placeholder", type: "string", default: "" },
                { name: "interactive", type: "boolean", default: true },
                { name: "title", type: "string", default: "Text" }
            ],
            glType: "text"
        };
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
    }

    init() {
        this.value = this.load(this.params.default);

        let node = document.getElementById(this.id);
        if (node) {
            node.value = this.value;
        }

        if (this.params.interactive && node) {
            const _this = this;
            let updater = function(e) {
                _this.value = e.target.value;
                _this.store(_this.value);
                _this.changed("default", _this.value, _this.value, _this);
            };
            node.addEventListener('change', updater);
        }
    }

    set(encodedValue) {
        this.value = encodedValue === undefined || encodedValue === null ? "" : String(encodedValue);

        let node = document.getElementById(this.id);
        if (node) {
            // no synthetic 'change' event: the listener from init() would re-enter set()
            node.value = this.value;
        }

        this.store(this.value);
        this.changed("default", this.value, this.value, this);
    }

    glDrawing(program, gl) {
        //do nothing
    }

    glLoaded(program, gl) {
        //do nothing
    }

    toHtml(classes = "", css = "") {
        let disabled = this.params.interactive ? "" : "disabled";
        const textarea = `<textarea id="${this.id}" class="er-control__input er-control__input--textarea"
${$.FlexRenderer.UIControls.styleAttr(`width: 100%; display: block; resize: vertical; ${css}`)} ${disabled} placeholder="${this.params.placeholder}"></textarea>`;
        return $.FlexRenderer.UIControls.renderControl("text-area", this.params.title, textarea, classes);
    }

    define() {
        return "";
    }

    get type() {
        return "text";
    }

    sample(value = undefined, valueGlType = 'void') {
        return this.value;
    }

    get supports() {
        return {
            default: "",
            placeholder: "",
            interactive: true,
            title: "Text"
        };
    }

    get supportsAll() {
        return {};
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.value;
    }
};
$.FlexRenderer.UIControls.registerClass("text_area", $.FlexRenderer.UIControls.TextArea);

/**
 * Button Input
 * @class OpenSeadragon.FlexRenderer.UIControls.Button
 */
$.FlexRenderer.UIControls.Button = class extends $.FlexRenderer.UIControls.IControl {
    static docs() {
        return {
            summary: "Button control that counts clicks.",
            description: "Renders a button, increments an internal counter on click, and does not define or upload any GLSL uniform.",
            kind: "ui-control",
            parameters: [
                { name: "default", type: "number", default: 0 },
                { name: "interactive", type: "boolean", default: true },
                { name: "title", type: "string", default: "Button" }
            ],
            glType: "action"
        };
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
    }

    init() {
        this.value = this.load(this.params.default);

        let node = document.getElementById(this.id);
        if (node) {
            node.innerHTML = this.params.title;
        }

        if (this.params.interactive && node) {
            const _this = this;
            let updater = function(e) {
                _this.set(_this.value + 1);
            };
            node.addEventListener('click', updater);
        }
    }

    /**
     * The button's value is its click counter; setting it mirrors the counter of another
     * instance of the same control (navigator sync, cache restore) without faking a click.
     * @param {number|string} encodedValue
     */
    set(encodedValue) {
        const parsed = Number.parseInt(encodedValue, 10);
        this.value = Number.isFinite(parsed) ? parsed : 0;

        this.store(this.value);
        this.changed("default", this.value, this.value, this);
    }

    glDrawing(program, gl) {
        //do nothing
    }

    glLoaded(program, gl) {
        //do nothing
    }

    toHtml(classes = "", css = "") {
        let disabled = this.params.interactive ? "" : "disabled";
        const button = `<button id="${this.id}" class="er-control__button er-control__button--action"${$.FlexRenderer.UIControls.styleAttr(`${css ? css : ""}float: right;`)} ${disabled}></button>`;
        return $.FlexRenderer.UIControls.renderControl("button", this.params.title, button, classes);
    }

    get layoutColumns() {
        return 1;
    }

    define() {
        return "";
    }

    get type() {
        return "action";
    }

    sample(value = undefined, valueGlType = 'void') {
        return "";
    }

    get supports() {
        return {
            default: 0, //counts clicks
            interactive: true,
            title: "Button"
        };
    }

    get supportsAll() {
        return {};
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.value;
    }
};
$.FlexRenderer.UIControls.registerClass("button", $.FlexRenderer.UIControls.Button);

$.FlexRenderer.IAtlasTextureControl = class IAtlasTextureControl extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this.atlas = owner.backend ? owner.backend.secondAtlas : null;
        this._params = this.getParams(params);
        this.textureId = -1;
        this.encodedValue = this.params.default;
        this._needsLoad = true;
    }

    _setTexture(encodedValue, textureId, opts = {}) {
        const emitChange = opts.emitChange !== false;
        const store = opts.store !== false;
        this.encodedValue = encodedValue;
        this.textureId = Number.isInteger(textureId) ? textureId : -1;

        if (emitChange) {
            this.changed("default", this.textureId, this.encodedValue, this);
        }
        if (store) {
            this.store(this.encodedValue);
        }
        this._needsLoad = true;
    }

    _uploadAtlasEntry(source, opts = {}) {
        if (!this.atlas) {
            return -1;
        }

        const cacheKey = opts.cacheKey ? String(opts.cacheKey) : null;
        if (cacheKey) {
            this.atlas.__flexRendererCache = this.atlas.__flexRendererCache || {};
            if (Number.isInteger(this.atlas.__flexRendererCache[cacheKey])) {
                return this.atlas.__flexRendererCache[cacheKey];
            }
        }

        // Enqueue only. This is reached from Image.onload and from DOM change handlers, where
        // nothing of ours is bound; the atlas flushes the queue from bind(), inside a draw.
        const textureId = this.atlas.addImage(source, opts);

        if (cacheKey) {
            this.atlas.__flexRendererCache[cacheKey] = textureId;
        }

        return textureId;
    }

    /**
     * The encoded value of an atlas-backed control is its texture id. Subclasses whose encoding
     * carries more than the id (e.g. Icon, which also encodes the glyph and its color) override this.
     * @param {number|string} encodedTextureId
     */
    set(encodedTextureId) {
        const parsed = Number.parseInt(encodedTextureId, 10);
        // The encoded value stays a number, matching what init() loads from params.default:
        // stringifying it here would make set(control.encoded) return a differently-typed
        // encoded value than it was given.
        const textureId = Number.isNaN(parsed) ? -1 : parsed;
        this._setTexture(textureId, textureId);
    }

    define() {
        return `uniform int ${this.webGLVariableName}_textureId;`;
    }

    glLoaded(program, gl) {
        this.textureIdLocation = gl.getUniformLocation(program, this.webGLVariableName + "_textureId");
        this._needsLoad = true;
    }

    glDrawing(program, gl) {
        if (this._needsLoad) {
            gl.uniform1i(this.textureIdLocation, this.textureId);
            this._needsLoad = false;
        }
    }

    sample(value = undefined, valueGlType = 'void') {
        if (!value) {
            throw new Error("Requires a vec2 value/variable specifying the texture coordinate to sample at");
        }

        if (valueGlType === 'vec2') {
            return `osd_atlas_texture(${this.webGLVariableName}_textureId, ${value})`;
        }

        throw new Error(`Incompatible parameter type '${valueGlType}' for atlas sampling control '${this.name}'; only vec2 is supported`);
    }

    get raw() {
        return this.textureId;
    }

    get encoded() {
        return this.encodedValue;
    }

    get type() {
        return "vec4";
    }
};

$.FlexRenderer.UIControls.Image = class extends $.FlexRenderer.IAtlasTextureControl {
    static docs() {
        return {
            summary: "Atlas-backed image sampling control.",
            description: "Stores an integer texture id for the second-pass atlas, starts empty by default, allows uploading arbitrary images through a file input, and samples atlas textures when given vec2 texture coordinates.",
            kind: "ui-control",
            parameters: [
                { name: "title", type: "string", default: "Images" },
                { name: "interactive", type: "boolean", default: true },
                { name: "default", type: "number", default: -1 },
                { name: "accept", type: "string", default: "image/*" }
            ],
            glType: "vec4"
        };
    }

    init() {
        this.encodedValue = this.load(this.params.default);
        this.textureId = Number.parseInt(this.encodedValue, 10);
        if (!Number.isInteger(this.textureId)) {
            this.textureId = -1;
        }

        if (this.params.interactive) {
            const _this = this;

            let number = document.getElementById(`${this.id}_number`);
            if (number) {
                let updater = function(e) {
                    _this.set(e.target.value);
                    _this.owner.invalidate();
                };

                number.value = this.encodedValue;
                number.addEventListener("change", updater);
            }

            let button = document.getElementById(`${this.id}_button`);
            if (button) {
                let updater = function(e) {
                    let file = document.getElementById(`${_this.id}_file`);

                    if (file.files && file.files.length) {
                        const fr = new FileReader();
                        fr.onload = function() {
                            const image = new Image();
                            image.onload = function() {
                                const textureId = _this._uploadAtlasEntry(image, {
                                    width: image.naturalWidth || image.width,
                                    height: image.naturalHeight || image.height
                                });
                                _this.set(textureId);
                                if (number) {
                                    number.value = String(textureId);
                                }
                                file.value = "";
                                _this.owner.invalidate();
                            };
                            image.src = fr.result;
                        };
                        fr.readAsDataURL(file.files[0]);
                    } else {
                        alert("No file selected");
                    }
                };

                button.addEventListener("click", updater);
            }
        }
    }

    toHtml(classes = "", css = "") {
        const disabled = this.params.interactive ? "" : "disabled";
        const body = `
        <div id="${this.id}_root" class="er-control__widget er-control__widget--image"${$.FlexRenderer.UIControls.styleAttr(`${css}; position: relative;`)}>
            <div class="er-control__hint er-control__hint--image">The atlas starts empty. Upload an image to create a new atlas entry.</div>
            <label class="er-control__row er-control__row--image-number">Selected: <input type="number" id="${this.id}_number" class="er-control__input er-control__input--image-number" min="-1" step="1" ${disabled}></label>
            <input type="file" id="${this.id}_file" class="er-control__input er-control__input--image-file" accept="${this.params.accept}" ${disabled}>
            <button id="${this.id}_button" class="er-control__button er-control__button--image-upload" ${disabled}>Upload Image</button>
        </div>`;
        return $.FlexRenderer.UIControls.renderControl("image", this.params.title, body, classes);
    }

    get supports() {
        return {
            title: "Images",
            interactive: true,
            default: -1,
            accept: "image/*",
        };
    }

    get supportsAll() {
        return {};
    }
};
$.FlexRenderer.UIControls.registerClass("image", $.FlexRenderer.UIControls.Image);

$.FlexRenderer.UIControls.IconLibrary = (() => {
    const makeGlyph = (name, glyph, aliases = [], tags = []) => ({
        name,
        glyph,
        aliases,
        tags
    });

    // Font-backed sets (Phosphor, Font Awesome) register themselves from
    // src/flex-controls/icon-sets/*.js via registerSet(). None of them ship a
    // webfont — the host page loads the font it wants, and icons stay pending
    // until document.fonts reports the family. Only "html-glyphs" renders with
    // no host setup at all, which is why it is the default.
    const DEFAULT_SET = "html-glyphs";

    const htmlGlyphs = [
        makeGlyph("star", "★", ["favourite", "favorite", "&starf;", "filled star"], ["shape", "rating"]),
        makeGlyph("star-outline", "☆", ["&star;", "outline star"], ["shape", "rating"]),
        makeGlyph("heart", "♥", ["love", "&hearts;"], ["shape", "status"]),
        makeGlyph("diamond", "◆", ["gem", "&diams;"], ["shape"]),
        makeGlyph("circle", "●", ["dot", "&bull;"], ["shape"]),
        makeGlyph("circle-outline", "○", ["ring"], ["shape"]),
        makeGlyph("square", "■", ["block"], ["shape"]),
        makeGlyph("square-outline", "□", ["outline square"], ["shape"]),
        makeGlyph("triangle-up", "▲", ["caret-up"], ["shape", "direction"]),
        makeGlyph("triangle-down", "▼", ["caret-down"], ["shape", "direction"]),
        makeGlyph("triangle-right", "▶", ["play", "caret-right"], ["shape", "direction", "media"]),
        makeGlyph("triangle-left", "◀", ["caret-left"], ["shape", "direction"]),
        makeGlyph("plus", "✚", ["add", "cross"], ["action"]),
        makeGlyph("minus", "−", ["subtract"], ["action"]),
        makeGlyph("multiply", "✕", ["times", "close", "xmark"], ["action"]),
        makeGlyph("check", "✓", ["ok", "done"], ["action", "status"]),
        makeGlyph("warning", "⚠", ["alert", "&warning;"], ["status"]),
        makeGlyph("info", "ℹ", ["information"], ["status"]),
        makeGlyph("question", "?", ["help"], ["status"]),
        makeGlyph("flag", "⚑", ["banner"], ["marker"]),
        makeGlyph("location-pin", "⌖", ["pin", "marker"], ["map", "marker"]),
        makeGlyph("house", "⌂", ["home"], ["building", "ui"]),
        makeGlyph("gear", "⚙", ["settings", "cog"], ["ui"]),
        makeGlyph("search", "⌕", ["magnifier"], ["ui"]),
        makeGlyph("mail", "✉", ["envelope"], ["communication"]),
        makeGlyph("phone", "☎", ["call"], ["communication"]),
        makeGlyph("user", "☺", ["person", "profile"], ["people"]),
        makeGlyph("lock", "🔒", ["secure"], ["security"]),
        makeGlyph("unlock", "🔓", [], ["security"]),
        makeGlyph("eye", "◉", ["view", "visible"], ["visibility"]),
        makeGlyph("sun", "☀", [], ["weather"]),
        makeGlyph("cloud", "☁", [], ["weather"]),
        makeGlyph("umbrella", "☂", [], ["weather"]),
        makeGlyph("snowflake", "❄", [], ["weather"]),
        makeGlyph("lightning", "⚡", ["bolt"], ["energy", "status"]),
        makeGlyph("music", "♫", ["note"], ["media"]),
        makeGlyph("scissors", "✂", ["cut"], ["action"]),
        makeGlyph("pencil", "✎", ["edit"], ["action"]),
        makeGlyph("trash", "🗑", ["delete", "bin"], ["action"]),
        makeGlyph("folder", "🗀", ["directory"], ["ui"]),
        makeGlyph("document", "🗎", ["file"], ["ui"]),
        makeGlyph("camera", "📷", ["photo"], ["media"]),
        makeGlyph("clock", "🕒", ["time"], ["ui"]),
        makeGlyph("leaf", "🍃", [], ["nature"]),
        makeGlyph("fire", "🔥", [], ["status"]),
        makeGlyph("droplet", "💧", ["water"], ["nature"]),
        makeGlyph("microscope", "🔬", [], ["science"]),
        makeGlyph("dna", "🧬", [], ["science"]),
        makeGlyph("pill", "💊", [], ["medical"]),
        makeGlyph("crosshair", "⌖", ["target"], ["marker"]),
        makeGlyph("ruler", "📏", ["measure"], ["tools"])
    ];

    const sets = {
        "html-glyphs": {
            kind: "glyph",
            // Color emoji fonts first so the browser renders glyphs
            // present in those fonts (most emoji) in their native colors.
            // Symbol fonts (monochrome) catch shapes the emoji fonts
            // don't have (★, ♥, geometric symbols, etc.).
            fontFamily: "'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif",
            fontWeight: "400",
            items: htmlGlyphs
        }
    };

    return {
        sets,

        /**
         * Add or replace an icon set. Used by the bundled set files
         * (`icon-sets/phosphor.js`, `icon-sets/font-awesome.js`) and available
         * to host applications that want to contribute their own font.
         *
         * @param {string} name set identifier, also accepted as an `iconSet`
         *   value and as a `set:icon` query prefix
         * @param {object} definition
         * @param {string} definition.kind `"glyph"` for literal characters,
         *   `"font-class"` for icon fonts addressed by CSS class
         * @param {string} definition.fontFamily CSS font-family list the
         *   glyphs are drawn with
         * @param {string} definition.fontWeight CSS font-weight
         * @param {Array} definition.items `{name, glyph|className, aliases, tags}`
         *   entries; `font-class` items resolve their codepoint from
         *   {@link OpenSeadragon.FlexRenderer.UIControls.IconCodepoints},
         *   falling back to a DOM probe of the icon stylesheet.
         * @return {object} this, for chaining
         */
        registerSet(name, definition) {
            this.sets[name] = definition;
            return this;
        },

        getSetNames() {
            return Object.keys(this.sets);
        },

        getSet(setName = DEFAULT_SET) {
            if (setName === "core") {
                return this.sets["html-glyphs"];
            }
            return this.sets[setName] || this.sets[DEFAULT_SET];
        },

        getIcons(setName = DEFAULT_SET) {
            return this.getSet(setName).items || [];
        },

        getIconEntries(setName = undefined) {
            if (setName) {
                const set = this.getSet(setName);
                return (set.items || []).map(icon => ({ icon, setName, set }));
            }

            return this.getSetNames().flatMap((name) => {
                const set = this.getSet(name);
                return (set.items || []).map(icon => ({ icon, setName: name, set }));
            });
        },

        search(query = "", setName = DEFAULT_SET, maxResults = 120) {
            const set = this.getSet(setName);
            const normalized = this._normalizeName(query);

            if (!normalized) {
                return set.items.slice(0, maxResults);
            }

            return set.items.filter(icon => {
                const tokens = [
                    icon.name,
                    icon.className || "",
                    ...(icon.aliases || []),
                    ...(icon.tags || [])
                ];
                return tokens.some(token => this._normalizeName(token).includes(normalized));
            }).slice(0, maxResults);
        },

        searchAll(query = "", maxResults = 120) {
            const normalized = this._normalizeName(query);
            const entries = this.getIconEntries();

            if (!normalized) {
                return entries.slice(0, maxResults).map(({ icon, setName }) => ({
                    ...icon,
                    set: setName
                }));
            }

            return entries.filter(({ icon }) => {
                const tokens = [
                    icon.name,
                    icon.className || "",
                    ...(icon.aliases || []),
                    ...(icon.tags || [])
                ];
                return tokens.some(token => this._normalizeName(token).includes(normalized));
            }).slice(0, maxResults).map(({ icon, setName }) => ({
                ...icon,
                set: setName
            }));
        },

        resolveIconSpec(query, setName = DEFAULT_SET) {
            const raw = String(query === undefined || query === null ? "" : query).trim();
            if (!raw) {
                return null;
            }

            const qualifiedMatch = raw.match(/^([a-z0-9_-]+):(.*)$/i);
            if (qualifiedMatch && this.sets[qualifiedMatch[1]]) {
                setName = qualifiedMatch[1];
                return this.resolveIconSpec(qualifiedMatch[2], setName);
            }

            const set = this.getSet(setName);
            const normalized = this._normalizeName(raw);

            const directGlyph = this._resolveDirectGlyph(raw);
            if (directGlyph) {
                return {
                    key: `${setName}:glyph:${directGlyph}`,
                    label: raw,
                    set: setName,
                    renderMode: "glyph",
                    glyph: directGlyph,
                    fontFamily: set.fontFamily,
                    fontWeight: set.fontWeight
                };
            }

            for (const icon of set.items) {
                const tokens = [
                    icon.name,
                    icon.className || "",
                    ...(icon.aliases || [])
                ];
                if (!tokens.some(token => this._normalizeName(token) === normalized)) {
                    continue;
                }

                if (set.kind === "glyph") {
                    return {
                        key: `${setName}:${icon.name}`,
                        label: icon.name,
                        set: setName,
                        renderMode: "glyph",
                        glyph: icon.glyph,
                        fontFamily: set.fontFamily,
                        fontWeight: set.fontWeight,
                        icon
                    };
                }

                return {
                    key: `${setName}:${icon.name}`,
                    label: icon.name,
                    set: setName,
                    renderMode: "class",
                    className: icon.className,
                    codepoint: icon.codepoint,
                    fontFamily: set.fontFamily,
                    fontWeight: set.fontWeight,
                    icon
                };
            }

            return null;
        },

        resolveAnyIconSpec(query, preferredSetName = DEFAULT_SET) {
            const raw = String(query === undefined || query === null ? "" : query).trim();
            if (!raw) {
                return null;
            }

            const preferred = this.resolveIconSpec(raw, preferredSetName);
            if (preferred) {
                return preferred;
            }

            for (const setName of this.getSetNames()) {
                if (setName === preferredSetName) {
                    continue;
                }
                const resolved = this.resolveIconSpec(raw, setName);
                if (resolved) {
                    return resolved;
                }
            }

            return null;
        },

        _normalizeName(value) {
            let normalized = String(value || "").trim().toLowerCase();
            normalized = normalized.replace(/\s+/g, " ");
            normalized = normalized.replace(/\b(?:fa-solid|fa-regular|fa-light|fa-thin|fa-brands|fa-duotone)\b/g, "");
            normalized = normalized.replace(/\b(?:fas|far|fal|fat|fab|fad)\b/g, "");
            normalized = normalized.replace(/\s+/g, " ").trim();

            if (normalized.includes(" ")) {
                const tokens = normalized.split(" ").filter(Boolean);
                normalized = tokens[tokens.length - 1];
            }

            return normalized;
        },

        _resolveDirectGlyph(value) {
            if (!value) {
                return null;
            }

            const entityGlyph = this._decodeHtmlEntity(value);
            if (entityGlyph) {
                return entityGlyph;
            }

            const codeMatch =
                value.match(/^&#x([0-9a-f]+);?$/i) ||
                value.match(/^&#([0-9]+);?$/i) ||
                value.match(/^0x([0-9a-f]+)$/i) ||
                value.match(/^u\+([0-9a-f]+)$/i) ||
                value.match(/^\\u\{?([0-9a-f]+)\}?$/i);

            if (codeMatch) {
                const radix = /^[0-9]+$/.test(codeMatch[1]) && value.startsWith("&#") && !/x/i.test(value) ? 10 : 16;
                const codePoint = Number.parseInt(codeMatch[1], radix);
                if (Number.isInteger(codePoint)) {
                    try {
                        return String.fromCodePoint(codePoint);
                    } catch (_) {
                        return null;
                    }
                }
            }

            const symbols = [...value];
            if (symbols.length === 1) {
                return symbols[0];
            }

            return null;
        },

        _decodeHtmlEntity(value) {
            if (typeof document === "undefined" || !String(value).includes("&")) {
                return null;
            }

            const textarea = document.createElement("textarea");
            textarea.innerHTML = String(value);
            const decoded = textarea.value;
            if (decoded && decoded !== value && [...decoded].length === 1) {
                return decoded;
            }
            return null;
        },

        renderIconToCanvas(spec = {}) {
            const iconQuery = String(spec.icon || "").trim();
            const iconSet = spec.iconSet || DEFAULT_SET;
            const size = Math.max(16, Number.parseInt(spec.size, 10) || 160);
            const padding = Math.max(0, Number.parseInt(spec.padding, 10) || 0);
            const color = spec.color || "#ff0000";
            const backgroundColor = spec.backgroundColor || "#00000000";
            const glyphFontFamily = spec.glyphFontFamily
                || "'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif";
            const glyphFontWeight = spec.glyphFontWeight || "400";

            if (!iconQuery) {
                return { canvas: null, cacheKey: null, ready: false, retry: false };
            }

            const resolved = this.resolveAnyIconSpec(iconQuery, iconSet);
            if (!resolved) {
                return { canvas: null, cacheKey: null, ready: false, retry: false };
            }

            const renderSpec = this._resolveRenderSpec(resolved, glyphFontFamily, glyphFontWeight);
            if (!renderSpec || !renderSpec.text) {
                // Neither a known codepoint nor a usable class probe — for a
                // font-backed set that means the icon stylesheet hasn't loaded.
                return { canvas: null, cacheKey: null, ready: false, retry: resolved.renderMode === "class" };
            }

            // A codepoint resolves without touching the DOM, so it succeeds even
            // when the webfont is missing — drawing it now would bake a tofu box
            // into the atlas. Hold off and let the caller retry; every retry path
            // hangs off document.fonts, which is exactly what we are waiting on.
            if (resolved.renderMode === "class" && !this._isFontAvailable(renderSpec.fontFamily, renderSpec.fontWeight)) {
                return { canvas: null, cacheKey: null, ready: false, retry: true };
            }

            const canvas = this._renderIconCanvas(renderSpec, {
                size,
                padding,
                color,
                backgroundColor,
                glyphFontFamily
            });

            const cacheKey = JSON.stringify({
                key: resolved.key,
                text: renderSpec.text,
                size,
                padding,
                color,
                backgroundColor,
                fontFamily: renderSpec.fontFamily,
                fontWeight: renderSpec.fontWeight
            });

            const colored = this.isIconColored(renderSpec, glyphFontFamily);
            return { canvas, cacheKey, ready: true, retry: false, colored };
        },

        uploadToAtlas(atlas, canvasResult) {
            if (!atlas || !canvasResult || !canvasResult.canvas) {
                return -1;
            }
            const cacheKey = canvasResult.cacheKey;
            atlas.__flexRendererCache = atlas.__flexRendererCache || {};
            if (cacheKey && Number.isInteger(atlas.__flexRendererCache[cacheKey])) {
                return atlas.__flexRendererCache[cacheKey];
            }
            // Enqueue only. Icon glyphs resolve from document.fonts.ready and from a retry timer,
            // so this runs with nothing bound; the atlas flushes from bind(), inside a draw.
            const textureId = atlas.addImage(canvasResult.canvas, {
                width: canvasResult.canvas.width,
                height: canvasResult.canvas.height,
                cacheKey
            });
            if (cacheKey) {
                atlas.__flexRendererCache[cacheKey] = textureId;
            }
            return textureId;
        },

        _resolveRenderSpec(resolved, glyphFontFamily, glyphFontWeight) {
            if (resolved.renderMode === "glyph") {
                return {
                    text: resolved.glyph,
                    fontFamily: resolved.fontFamily || glyphFontFamily,
                    fontWeight: resolved.fontWeight || glyphFontWeight
                };
            }
            if (resolved.renderMode === "class") {
                const codepoint = this._lookupCodepoint(resolved);
                if (codepoint !== undefined) {
                    return {
                        text: String.fromCodePoint(codepoint),
                        fontFamily: resolved.fontFamily,
                        fontWeight: resolved.fontWeight || glyphFontWeight || "400"
                    };
                }
                return this._resolveFontClassRenderSpec(resolved.className, resolved, glyphFontWeight);
            }
            return null;
        },

        // Curated icons carry a generated codepoint (see icon-sets/
        // icon-codepoints.generated.js), which lets them render from the
        // webfont alone. Anything outside the curated lists — a class the user
        // typed by hand — still falls back to probing the icon stylesheet.
        _lookupCodepoint(resolved) {
            if (Number.isInteger(resolved.codepoint)) {
                return resolved.codepoint;
            }
            const icon = resolved.icon;
            if (icon && Number.isInteger(icon.codepoint)) {
                return icon.codepoint;
            }
            const table = $.FlexRenderer.UIControls.IconCodepoints;
            if (table && resolved.className && Number.isInteger(table[resolved.className])) {
                return table[resolved.className];
            }
            return undefined;
        },

        // True when the browser can draw text in any family of the list. Never
        // cached: the answer flips from false to true the moment the host's
        // webfont finishes loading.
        //
        // On a miss this also *requests* the font. A @font-face declaration
        // alone downloads nothing — the browser fetches the file only once
        // something uses the family — and we render on a canvas, which does not
        // count as a use. Without this kick the check would stay false forever
        // on a page that loaded the stylesheet but has no icon elements in DOM.
        _isFontAvailable(fontFamily, fontWeight) {
            if (typeof document === "undefined" || !document.fonts || typeof document.fonts.check !== "function") {
                return true;
            }
            const families = String(fontFamily || "").split(",").map(name => name.trim()).filter(Boolean);
            if (!families.length) {
                return true;
            }
            const weight = fontWeight || "400";
            const available = families.some((family) => {
                try {
                    return document.fonts.check(`${weight} 34px ${family}`);
                } catch (_) {
                    // Malformed family name — let the render attempt proceed.
                    return true;
                }
            });

            if (!available && typeof document.fonts.load === "function") {
                this._requestedFonts = this._requestedFonts || {};
                families.forEach((family) => {
                    const key = `${weight} ${family}`;
                    if (this._requestedFonts[key]) {
                        return;
                    }
                    this._requestedFonts[key] = true;
                    try {
                        // Rejects when the family is undeclared, which is the
                        // normal case for a font the host never loaded.
                        document.fonts.load(`${weight} 34px ${family}`).catch(() => {});
                    } catch (_) {
                        // noop
                    }
                });
            }

            return available;
        },

        _resolveFontClassRenderSpec(className, resolved, glyphFontWeight) {
            if (typeof document === "undefined") {
                return null;
            }

            const probe = document.createElement("i");
            probe.className = className;
            probe.setAttribute("aria-hidden", "true");
            probe.style.position = "absolute";
            probe.style.left = "-10000px";
            probe.style.top = "-10000px";
            probe.style.fontSize = "34px";
            document.body.appendChild(probe);

            try {
                const pseudo = window.getComputedStyle(probe, "::before");
                let content = pseudo.getPropertyValue("content");
                if (!content || content === "none" || content === "normal") {
                    const base = window.getComputedStyle(probe);
                    content = base.getPropertyValue("content");
                }

                const text = this._decodeCssContent(content);
                if (!text) {
                    return null;
                }

                return {
                    text,
                    fontFamily: pseudo.fontFamily || resolved.fontFamily,
                    fontWeight: pseudo.fontWeight || resolved.fontWeight || glyphFontWeight || "900"
                };
            } finally {
                probe.remove();
            }
        },

        _decodeCssContent(content) {
            if (!content || content === "none" || content === "normal") {
                return null;
            }

            let value = String(content).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            value = value.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => {
                try {
                    return String.fromCodePoint(Number.parseInt(hex, 16));
                } catch (_) {
                    return "";
                }
            });

            value = value.replace(/\\\\/g, "\\");
            value = value.replace(/\\"/g, '"');
            value = value.replace(/\\'/g, "'");

            return value || null;
        },

        _renderIconCanvas(renderSpec, opts) {
            const { size, padding, color, backgroundColor, glyphFontFamily } = opts;
            const text = renderSpec.text;
            const fontFamily = renderSpec.fontFamily || glyphFontFamily;
            const fontWeight = renderSpec.fontWeight || "400";

            // Detection cache: whether the browser draws this glyph via
            // its own color tables (color emoji) vs. honoring fillStyle
            // (monochrome). Determined purely by text+font, not color/size.
            this._coloredCache = this._coloredCache || {};
            const detectKey = `${text}::${fontFamily}::${fontWeight}`;
            let colored = this._coloredCache[detectKey];

            const draw = (fillColor, withStroke) => {
                const canvas = document.createElement("canvas");
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext("2d");
                ctx.clearRect(0, 0, size, size);

                if (backgroundColor && backgroundColor !== "#00000000") {
                    ctx.fillStyle = backgroundColor;
                    ctx.fillRect(0, 0, size, size);
                }

                const availableSize = Math.max(8, size - (padding * 2));
                const measureAt = (fontSize) => {
                    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
                    return ctx.measureText(text);
                };

                let metrics = measureAt(size);
                const boundsWidth = Math.max(
                    1,
                    (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0),
                    metrics.width || 0
                );
                const boundsHeight = Math.max(
                    1,
                    (metrics.actualBoundingBoxAscent || 0) + (metrics.actualBoundingBoxDescent || 0),
                    size * 0.7
                );
                const fitScale = Math.min(availableSize / boundsWidth, availableSize / boundsHeight, 1.0);
                const fontSize = Math.max(8, Math.floor(size * fitScale));
                metrics = measureAt(fontSize);

                ctx.fillStyle = fillColor;
                ctx.textAlign = "left";
                ctx.textBaseline = "alphabetic";
                ctx.lineJoin = "round";
                ctx.miterLimit = 2;

                const left = metrics.actualBoundingBoxLeft || 0;
                const right = metrics.actualBoundingBoxRight || metrics.width || 0;
                const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.75;
                const descent = metrics.actualBoundingBoxDescent || fontSize * 0.25;
                const x = (size / 2) + ((left - right) / 2);
                const y = (size / 2) + ((ascent - descent) / 2);

                if (withStroke) {
                    const strokeWidth = Math.max(1, fontSize * 0.035);
                    ctx.lineWidth = strokeWidth;
                    ctx.strokeStyle = fillColor;
                    ctx.strokeText(text, x, y);
                }
                ctx.fillText(text, x, y);
                return canvas;
            };

            if (colored === undefined) {
                // Probe-render with neutral color; color emoji ignore
                // fillStyle and reveal themselves via non-zero RGB pixels.
                const probe = draw("#000000", false);
                colored = this._detectColoredCanvas(probe);
                this._coloredCache[detectKey] = colored;

                if (colored) {
                    this._applyTint(probe, color);
                    return probe;
                }
                return draw(color, true);
            }

            if (colored) {
                const c = draw("#000000", false);
                this._applyTint(c, color);
                return c;
            }
            return draw(color, true);
        },

        // Sample non-transparent pixels; any non-zero RGB component means
        // the browser drew its own colors instead of honoring fillStyle.
        _detectColoredCanvas(canvas) {
            let imageData;
            try {
                imageData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
            } catch (_) {
                return false;
            }
            const data = imageData.data;
            const len = data.length;
            for (let i = 0; i < len; i += 4) {
                if (data[i + 3] < 8) {
                    continue;
                }
                if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) {
                    return true;
                }
            }
            return false;
        },

        // source-atop fills only existing pixels, preserving the glyph's
        // alpha mask. Alpha 0.5 keeps the original hues recognizable.
        _applyTint(canvas, tintColor, alpha = 0.5) {
            const ctx = canvas.getContext("2d");
            ctx.save();
            ctx.globalCompositeOperation = "source-atop";
            ctx.globalAlpha = alpha;
            ctx.fillStyle = tintColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        },

        isIconColored(renderSpec, glyphFontFamily) {
            if (!renderSpec || !renderSpec.text) {
                return false;
            }
            this._coloredCache = this._coloredCache || {};
            const fontFamily = renderSpec.fontFamily || glyphFontFamily || "";
            const fontWeight = renderSpec.fontWeight || "400";
            const detectKey = `${renderSpec.text}::${fontFamily}::${fontWeight}`;
            return Boolean(this._coloredCache[detectKey]);
        }
    };
})();

$.FlexRenderer.UIControls.Icon = class extends $.FlexRenderer.IAtlasTextureControl {
    static docs() {
        return {
            summary: "Atlas-backed icon control over HTML-glyph, Phosphor and Font Awesome sets.",
            description: "Searches curated icon sets, rasterizes the selected glyph to atlas texture content, and samples the second-pass atlas from GLSL. Icon webfonts are not bundled: the 'html-glyphs' default renders anywhere, while the Phosphor and Font Awesome sets need the host page to load the corresponding font.",
            kind: "ui-control",
            iconSets: $.FlexRenderer.UIControls.IconLibrary.getSetNames(),
            parameters: [
                { name: "title", type: "string", default: "Icon" },
                { name: "interactive", type: "boolean", default: true },
                { name: "default", type: "string", default: "" },
                { name: "iconSet", type: "string", default: "html-glyphs", allowedValues: $.FlexRenderer.UIControls.IconLibrary.getSetNames() },
                { name: "size", type: "number", default: 160 },
                { name: "padding", type: "number", default: 4 },
                { name: "color", type: "string", default: "#ff0000" },
                { name: "backgroundColor", type: "string", default: "#00000000" },
                { name: "previewSize", type: "number", default: 27 },
                { name: "maxResults", type: "number", default: 120 },
                { name: "glyphFontFamily", type: "string", default: "'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif" },
                { name: "glyphFontWeight", type: "string", default: "400" }
            ],
            glType: "vec4"
        };
    }

    init() {
        this.selectedSet = this.load(this.params.iconSet || "html-glyphs", "set") || (this.params.iconSet || "html-glyphs");
        this.currentColor = this.params.color || "#ff0000";
        this.encodedValue = this.load(this.params.default);
        this.textureId = -1;

        if (this.encodedValue) {
            this._applyEncodedIcon(this.encodedValue, false);
        }

        if (!this.params.interactive) {
            return;
        }

        const queryInput = document.getElementById(`${this.id}_query`);
        const results = document.getElementById(`${this.id}_results`);
        const preview = document.getElementById(`${this.id}_preview`);
        const popup = document.getElementById(`${this.id}_popup`);
        const closeButton = document.getElementById(`${this.id}_close`);
        const triggerButton = document.getElementById(`${this.id}_trigger`);
        const colorInput = document.getElementById(`${this.id}_color`);

        if (triggerButton) {
            triggerButton.addEventListener("click", () => {
                if (!popup) {
                    return;
                }
                popup.style.display = "block";
                const decoded = this._decodeStoredValue(this.encodedValue || "");
                this._renderIconResults(results, queryInput ? queryInput.value : decoded.icon);
                if (queryInput) {
                    // preventScroll: input lives inside the side-menu's
                    // overflow-y:auto ancestor; default focus would
                    // scroll-into-view the scroller and jump the menu.
                    queryInput.focus({ preventScroll: true });
                    queryInput.select();
                }
            });
        }

        if (queryInput) {
            queryInput.value = this._decodeStoredValue(this.encodedValue || "").icon;
            queryInput.addEventListener("input", () => {
                if (popup) {
                    popup.style.display = "block";
                }
                this._renderIconResults(results, queryInput.value);
            });
            queryInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    this._applyIconSelection(queryInput.value, preview, popup);
                }
                if (event.key === "Escape" && popup) {
                    popup.style.display = "none";
                }
            });
        }

        if (colorInput) {
            colorInput.value = this.currentColor;
            // "input" fires continuously during color-picker drag. Each
            // _applyUiState call uploads a fresh atlas entry per color
            // value, so dragging alone can exhaust the 256-slot atlas.
            // During drag we only re-render the visual preview; the
            // atlas commit + invalidate runs once on "change" (release).
            colorInput.addEventListener("input", () => {
                this.currentColor = this._normalizeColor(colorInput.value);
                this._renderIconPreview(preview, queryInput ? queryInput.value : "");
            });
            colorInput.addEventListener("change", () => {
                this._applyUiState(queryInput ? queryInput.value : "", colorInput.value, preview, true);
            });
        }

        if (closeButton && popup) {
            closeButton.addEventListener("click", () => {
                popup.style.display = "none";
            });
        }

        if (!this._outsideClickHandler) {
            this._outsideClickHandler = (event) => {
                if (!popup || popup.style.display === "none") {
                    return;
                }
                const root = document.getElementById(`${this.id}_root`);
                if (root && !root.contains(event.target)) {
                    popup.style.display = "none";
                }
            };
            document.addEventListener("click", this._outsideClickHandler);
        }

        this._renderIconPreview(preview, this._decodeStoredValue(this.encodedValue || "").icon);
    }

    destroy() {
        if (this._outsideClickHandler) {
            document.removeEventListener("click", this._outsideClickHandler);
            this._outsideClickHandler = null;
        }
    }

    set(encodedValue) {
        this._applyEncodedIcon(encodedValue, true);
    }

    _applyEncodedIcon(encodedValue, emitChange) {
        const decoded = this._decodeStoredValue(encodedValue);
        this.currentColor = decoded.color;

        const resolved = $.FlexRenderer.UIControls.IconLibrary.resolveAnyIconSpec(decoded.icon, this.selectedSet);
        if (!resolved) {
            this.encodedValue = this._encodeStoredValue(decoded.icon, this.currentColor);
            this.textureId = -1;
            if (emitChange) {
                this.changed("default", this.textureId, this.encodedValue, this);
            }
            this.store(this.encodedValue);
            this._needsLoad = true;
            return;
        }

        this.selectedSet = resolved.set || this.selectedSet;
        this.store(this.selectedSet, "set");

        const renderSpec = this._resolveRenderSpec(resolved);
        if (!renderSpec || !renderSpec.text) {
            this.encodedValue = this._encodeStoredValue(decoded.icon, this.currentColor);
            this.textureId = -1;
            if (emitChange) {
                this.changed("default", this.textureId, this.encodedValue, this);
            }
            this.store(this.encodedValue);
            this._needsLoad = true;
            return;
        }

        const canvas = this._renderIconCanvas(renderSpec);
        const cacheKey = JSON.stringify({
            key: resolved.key,
            text: renderSpec.text,
            size: this.params.size,
            padding: this.params.padding,
            color: this.currentColor,
            backgroundColor: this.params.backgroundColor,
            fontFamily: renderSpec.fontFamily,
            fontWeight: renderSpec.fontWeight
        });

        const textureId = this._uploadAtlasEntry(canvas, {
            width: canvas.width,
            height: canvas.height,
            cacheKey: cacheKey
        });

        this._setTexture(this._encodeStoredValue(decoded.icon, this.currentColor), textureId, { emitChange });
    }

    _decodeStoredValue(encodedValue) {
        const fallbackColor = this._normalizeColor(this.currentColor || this.params.color || "#ff0000");
        if (encodedValue && typeof encodedValue === "object") {
            return {
                icon: String(encodedValue.icon || encodedValue.default || ""),
                color: this._normalizeColor(encodedValue.color || fallbackColor)
            };
        }

        const raw = String(encodedValue || "").trim();
        if (!raw) {
            return { icon: "", color: fallbackColor };
        }

        if (raw.startsWith("{")) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    return {
                        icon: String(parsed.icon || parsed.default || ""),
                        color: this._normalizeColor(parsed.color || fallbackColor)
                    };
                }
            } catch (_) {
                // Legacy plain-string values remain supported.
            }
        }

        return { icon: raw, color: fallbackColor };
    }

    _encodeStoredValue(iconValue, colorValue) {
        // "no icon" encodes as the empty string, the same shape init() loads it back as. Wrapping
        // it in JSON instead would make set(control.encoded) return a different encoded value than
        // it was given, which breaks cache restore and navigator state sync.
        if (!iconValue) {
            return "";
        }
        return JSON.stringify({
            icon: String(iconValue || ""),
            color: this._normalizeColor(colorValue || this.currentColor || this.params.color || "#ff0000")
        });
    }

    _normalizeColor(colorValue) {
        const raw = String(colorValue || "").trim();
        if (/^#[0-9a-f]{6}$/i.test(raw)) {
            return raw.toLowerCase();
        }
        if (/^#[0-9a-f]{3}$/i.test(raw)) {
            return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
        }
        return String(this.params.color || "#ff0000").toLowerCase();
    }

    _applyUiState(iconQuery, colorValue, preview, invalidate) {
        const nextEncodedValue = this._encodeStoredValue(iconQuery, colorValue);
        this.set(nextEncodedValue);
        this._renderIconPreview(preview, iconQuery);
        if (invalidate) {
            this.owner.invalidate();
        }
    }

    _resolveRenderSpec(resolved) {
        return $.FlexRenderer.UIControls.IconLibrary._resolveRenderSpec(
            resolved,
            this.params.glyphFontFamily,
            this.params.glyphFontWeight
        );
    }

    _resolveFontClassRenderSpec(className, resolved) {
        return $.FlexRenderer.UIControls.IconLibrary._resolveFontClassRenderSpec(
            className,
            resolved,
            this.params.glyphFontWeight
        );
    }

    _decodeCssContent(content) {
        return $.FlexRenderer.UIControls.IconLibrary._decodeCssContent(content);
    }

    _renderIconCanvas(renderSpec) {
        const size = Math.max(16, Number.parseInt(this.params.size, 10) || 160);
        const padding = Math.max(0, Number.parseInt(this.params.padding, 10) || 0);
        return $.FlexRenderer.UIControls.IconLibrary._renderIconCanvas(renderSpec, {
            size,
            padding,
            color: this.currentColor,
            backgroundColor: this.params.backgroundColor,
            glyphFontFamily: this.params.glyphFontFamily
        });
    }

    _renderIconPreview(node, query) {
        if (!node) {
            return;
        }

        node.innerHTML = "";

        const resolved = $.FlexRenderer.UIControls.IconLibrary.resolveAnyIconSpec(query, this.selectedSet);
        if (!resolved) {
            node.textContent = "?";
            node.title = "Unknown icon";
            this._updateColorMode(false);
            return;
        }

        node.title = `${resolved.label} (${resolved.set})`;

        const previewSize = Math.max(18, Number.parseInt(this.params.previewSize, 10) || 27);
        const result = this._buildIconVisual(query, resolved.set, resolved, previewSize);
        if (result && result.node) {
            node.appendChild(result.node);
        }
        this._updateColorMode(Boolean(result && result.colored));
    }

    _updateColorMode(colored) {
        const badge = document.getElementById(`${this.id}_color_mode`);
        if (badge) {
            badge.classList.toggle("hidden", !colored);
        }
        const colorInput = document.getElementById(`${this.id}_color`);
        if (colorInput) {
            colorInput.title = colored ? "Tint color (applied over original colors)" : "Icon color";
        }
    }

    // Render through the same canvas pipeline the texture uses, so the
    // picker / trigger preview never diverge from the rendered output.
    // Returns { node, colored }. Falls back to DOM-glyph/CSS-class
    // rendering only if the canvas pipeline isn't ready (e.g. the host's
    // icon webfont is still loading); fallback assumes monochrome.
    _buildIconVisual(iconName, iconSet, resolved, previewSize) {
        const canvasResult = $.FlexRenderer.UIControls.IconLibrary.renderIconToCanvas({
            icon: iconName,
            iconSet: iconSet || this.selectedSet,
            size: 64,
            padding: 4,
            color: this.currentColor,
            backgroundColor: "#00000000",
            glyphFontFamily: this.params.glyphFontFamily,
            glyphFontWeight: this.params.glyphFontWeight
        });

        if (canvasResult && canvasResult.canvas) {
            const canvas = canvasResult.canvas;
            canvas.style.width = `${previewSize}px`;
            canvas.style.height = `${previewSize}px`;
            // inline-block + middle alignment mirrors the original <i>/<span>
            // glyph behavior so icons flow inline alongside siblings.
            canvas.style.display = "inline-block";
            canvas.style.verticalAlign = "middle";
            return { node: canvas, colored: Boolean(canvasResult.colored) };
        }

        if (resolved && resolved.renderMode === "class" && resolved.className) {
            const i = document.createElement("i");
            i.className = resolved.className;
            i.setAttribute("aria-hidden", "true");
            i.style.fontSize = `${previewSize}px`;
            i.style.color = this.currentColor;
            return { node: i, colored: false };
        }

        if (resolved && resolved.glyph) {
            const span = document.createElement("span");
            span.textContent = resolved.glyph;
            span.style.fontFamily = resolved.fontFamily || this.params.glyphFontFamily;
            span.style.fontWeight = resolved.fontWeight || this.params.glyphFontWeight;
            span.style.fontSize = `${previewSize}px`;
            span.style.lineHeight = "1";
            span.style.color = this.currentColor;
            return { node: span, colored: false };
        }

        return null;
    }

    _renderIconResults(node, query) {
        if (!node) {
            return;
        }

        const maxResults = Math.max(20, Number.parseInt(this.params.maxResults, 10) || 120);
        const icons = $.FlexRenderer.UIControls.IconLibrary.searchAll(query, maxResults);
        const previewSize = Math.max(18, Number.parseInt(this.params.previewSize, 10) || 27);

        node.innerHTML = "";

        icons.forEach(icon => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "icon-search-result btn btn-ghost btn-sm p-1 min-h-0 h-auto";
            button.dataset.iconName = icon.name;
            button.dataset.iconSet = icon.set || "";
            button.title = icon.set ? `${icon.name} (${icon.set})` : icon.name;

            const visual = this._buildIconVisual(icon.name, icon.set, icon, previewSize);
            if (visual && visual.node) {
                button.appendChild(visual.node);
            }

            button.addEventListener("click", () => {
                const queryInput = document.getElementById(`${this.id}_query`);
                const preview = document.getElementById(`${this.id}_preview`);
                const popup = document.getElementById(`${this.id}_popup`);

                if (queryInput) {
                    queryInput.value = icon.name;
                }

                this._applyIconSelection(icon.name, preview, popup, icon.set || undefined);
            });

            node.appendChild(button);
        });
    }

    _applyIconSelection(query, preview, popup, preferredSet = undefined) {
        if (preferredSet) {
            this.selectedSet = preferredSet;
            this.store(this.selectedSet, "set");
        }
        const colorInput = document.getElementById(`${this.id}_color`);
        this._applyUiState(query, colorInput ? colorInput.value : this.currentColor, preview, true);

        if (popup) {
            popup.style.display = "none";
        }
    }

    toHtml(classes = "", css = "") {
        const disabled = this.params.interactive ? "" : "disabled";
        const decodedColor = this._decodeStoredValue(this.encodedValue || this.params.default).color;
        // Positioning (`position: absolute`, top/right offsets, z-index, width
        // clamp) and the `display: none` toggle stay inline — init() flips
        // display directly, and these utilities don't compose cleanly as
        // single Tailwind classes. Visual styling delegates to daisyUI tokens
        // so the popover follows the host theme.
        const body = `<div id="${this.id}_root" class="er-control__widget er-control__widget--icon relative"${$.FlexRenderer.UIControls.styleAttr(css)}>
<div class="er-control__toolbar er-control__toolbar--icon flex items-center justify-between gap-2">
    <button id="${this.id}_trigger" type="button" class="er-control__button er-control__button--icon-trigger btn btn-square btn-outline" ${disabled}>
        <span id="${this.id}_preview" class="er-control__preview er-control__preview--icon inline-flex items-center justify-center w-full h-full">?</span>
    </button>
</div>
<div id="${this.id}_popup" class="er-control__popup er-control__popup--icon card card-compact bg-base-100 border border-base-300 shadow-lg"
     style="display: none; position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 30; max-width: 100%;">
    <div class="card-body p-3">
        <div class="er-control__popup-header er-control__popup-header--icon flex justify-between items-center mb-2">
            <span class="font-medium text-sm">Icon picker</span>
            <button id="${this.id}_close" type="button" class="er-control__button er-control__button--icon-close btn btn-ghost btn-xs btn-circle" aria-label="Close" ${disabled}>✕</button>
        </div>
        <div class="er-control__search er-control__search--icon flex items-center gap-2 mb-2">
            <input type="text" id="${this.id}_query" class="er-control__input er-control__input--icon-query input input-bordered input-sm flex-1" placeholder="Search icons, aliases, glyphs" ${disabled}>
            <div class="relative">
                <input type="color" id="${this.id}_color" class="er-control__input er-control__input--icon-color w-10 h-10 rounded cursor-pointer" value="${decodedColor}" title="Icon color" ${disabled}>
                <span id="${this.id}_color_mode" class="er-control__color-mode badge badge-xs absolute -top-1 -right-1 hidden">tint</span>
            </div>
        </div>
        <div id="${this.id}_results" class="er-control__results er-control__results--icon flex flex-wrap gap-1 max-h-[360px] overflow-auto"></div>
    </div>
</div>
</div>`;
        return $.FlexRenderer.UIControls.renderControl("icon", this.params.title, body, classes);
    }

    get layoutColumns() {
        return 1;
    }

    get supports() {
        return {
            title: "Icon",
            interactive: true,
            default: "",
            iconSet: "html-glyphs",
            size: 160,
            padding: 4,
            color: "#ff0000",
            backgroundColor: "#00000000",
            previewSize: 27,
            maxResults: 120,
            glyphFontFamily: "'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif",
            glyphFontWeight: "400"
        };
    }

    get supportsAll() {
        return {
            iconSet: $.FlexRenderer.UIControls.IconLibrary.getSetNames()
        };
    }
};
$.FlexRenderer.UIControls.registerClass("icon", $.FlexRenderer.UIControls.Icon);

})(OpenSeadragon);
