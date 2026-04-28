
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

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
        this.prepare();
    }

    prepare() {
        //Note that builtin colormap must support 2->this.MAX_SAMPLES color arrays
        this.MAX_SAMPLES = 8;
        this.GLOBAL_GLSL_KEY = 'colormap';

        this.parser = $.FlexRenderer.UIControls.getUiElement("color").decode;
        if (this.params.continuous) {
            this.cssGradient = this._continuousCssFromPallete;
        } else {
            this.cssGradient = this._discreteCssFromPallete;
        }
        this.owner.includeGlobalCode(this.GLOBAL_GLSL_KEY, this._glslCode());
    }

    init() {
        this.value = this.load(this.params.default);

        //steps could have been set manually from the outside
        if (!Array.isArray(this.steps)) {
            this.setSteps();
        }

        if (!this.value || !$.FlexRenderer.ColorMaps.schemeGroups[this.params.mode].includes(this.value)) {
            this.value = $.FlexRenderer.ColorMaps.defaults[this.params.mode];
        }
        this.colorPallete = $.FlexRenderer.ColorMaps[this.value][this.maxSteps];

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                const self = e.target;
                const selected = self.value;
                _this.colorPallete = $.FlexRenderer.ColorMaps[selected][_this.maxSteps];
                _this._setPallete(_this.colorPallete);
                self.style.background = _this.cssGradient(_this.colorPallete);
                _this.value = selected;
                _this.store(selected);
                _this.changed("default", _this.pallete, _this.value, _this);
                _this.owner.invalidate();
            };

            this._setPallete(this.colorPallete);
            let node = this.updateColormapUI();

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

    _glslCode() {
        return `
#define COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES} ${this.MAX_SAMPLES}
vec3 sample_colormap(in float ratio, in vec3 map[COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES}], in float steps[COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES}+1], in int max_steps, in bool discrete) {
for (int i = 1; i < COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES} + 1; i++) {
    if (ratio <= steps[i]) {
        if (discrete) return map[i-1];

        float scale = (ratio - steps[i-1]) / (steps[i] - steps[i-1]) - 0.5;

        if (scale < .0) {
            if (i == 1) return map[0];
            //scale should be positive, but we need to keep the right direction
            return mix(map[i-1], map[i-2], -scale);
        }

        if (i == max_steps) return map[i-1];
        return mix(map[i-1], map[i], scale);
    } else if (i >= max_steps) {
        return map[i-1];
    }
}
}`;
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
            this.steps.forEach(x => (x - min) / (max - min));
            for (let i = this.maxSteps + 1; i < maximum + 1; i++) {
                this.steps.push(-1);
            }
        }
    }

    _continuousCssFromPallete(pallete) {
        let css = [`linear-gradient(90deg`];
        for (let i = 0; i < this.maxSteps; i++) {
            css.push(`, ${pallete[i]} ${Math.round((this.steps[i] + this.steps[i + 1]) * 50)}%`);
        }
        css.push(")");
        return css.join("");
    }

    _discreteCssFromPallete(pallete) {
        let css = [`linear-gradient(90deg, ${pallete[0]} 0%`];
        for (let i = 1; i < this.maxSteps; i++) {
            css.push(`, ${pallete[i - 1]} ${Math.round(this.steps[i] * 100)}%, ${pallete[i]} ${Math.round(this.steps[i] * 100)}%`);
        }
        css.push(")");
        return css.join("");
    }

    _setPallete(newPallete) {
        if (typeof newPallete[0] === "string") {
            let temp = newPallete; //if this.pallete passed
            this.pallete = [];
            for (let color of temp) {
                this.pallete.push(...this.parser(color));
            }
        }
        for (let i = this.pallete.length; i < 3 * (this.MAX_SAMPLES); i++) {
            this.pallete.push(0);
        }
    }

    glDrawing(program, gl) {
        gl.uniform3fv(this.colormapGluint, Float32Array.from(this.pallete));
        gl.uniform1fv(this.stepsGluint, Float32Array.from(this.steps));
        gl.uniform1i(this.colormapSizeGluint, this.maxSteps);
    }

    glLoaded(program, gl) {
        this.stepsGluint = gl.getUniformLocation(program, this.webGLVariableName + "_steps[0]");
        this.colormapGluint = gl.getUniformLocation(program, this.webGLVariableName + "_colormap[0]");
        this.colormapSizeGluint = gl.getUniformLocation(program, this.webGLVariableName + "_colormap_size");
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
        return `uniform vec3 ${this.webGLVariableName}_colormap[COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES}];
uniform float ${this.webGLVariableName}_steps[COLORMAP_ARRAY_LEN_${this.MAX_SAMPLES}+1];
uniform int ${this.webGLVariableName}_colormap_size;`;
    }

    get type() {
        return "vec3";
    }

    sample(value = undefined, valueGlType = 'void') {
        if (!value || valueGlType !== 'float') {
            return `ERROR Incompatible control. Colormap cannot be used with ${this.name} (sampling type '${valueGlType}')`;
        }
        return `sample_colormap(${value}, ${this.webGLVariableName}_colormap, ${this.webGLVariableName}_steps, ${this.webGLVariableName}_colormap_size, ${!this.params.continuous})`;
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

    prepare() {
        this.MAX_SAMPLES = 32;
        this.GLOBAL_GLSL_KEY = 'custom_colormap';

        this.parser = $.FlexRenderer.UIControls.getUiElement("color").decode;
        if (this.params.continuous) {
            this.cssGradient = this._continuousCssFromPallete;
        } else {
            this.cssGradient = this._discreteCssFromPallete;
        }
        this.owner.includeGlobalCode(this.GLOBAL_GLSL_KEY, this._glslCode());
    }

    init() {
        this.value = this.load(this.params.default);

        if (!Array.isArray(this.steps)) {
            this.setSteps();
        }
        if (this.maxSteps < this.value.length) {
            this.value = this.value.slice(0, this.maxSteps);
        }

        //super class compatibility in methods, keep updated
        this.colorPallete = this.value;

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                const self = e.target;
                const index = Number.parseInt(e.target.dataset.index, 10);
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

            this._setPallete(this.colorPallete);
            let node = this.updateColormapUI();

            const width = 1 / this.colorPallete.length * 100;
            node.innerHTML = this.colorPallete.map((x, i) => `<input type="color" style="width: ${width}%; height: 30px; background: none; border: none; padding: 4px 5px;" value="${x}" data-index="${i}">`).join("");
            Array.from(node.children).forEach(child => child.addEventListener("change", updater));
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
                { name: "pips", type: "object" }
            ],
            glType: "float"
        };
    }

    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._params = this.getParams(params);
        this.MAX_SLIDERS = 12;

        this.owner.includeGlobalCode('advanced_slider', `
#define ADVANCED_SLIDER_LEN ${this.MAX_SLIDERS}
float sample_advanced_slider(in float ratio, in float breaks[ADVANCED_SLIDER_LEN], in float mask[ADVANCED_SLIDER_LEN+1], in bool maskOnly, in float minValue) {
float bigger = .0, actualLength = .0, masked = minValue;
bool sampling = true;
for (int i = 0; i < ADVANCED_SLIDER_LEN; i++) {
    if (breaks[i] < .0) {
        if (sampling) masked = mask[i];
        sampling = false;
        break;
    }

    if (sampling) {
        if (ratio <= breaks[i]) {
            sampling = false;
            masked = mask[i];
        } else bigger++;
    }
    actualLength++;
}
if (sampling) masked = mask[ADVANCED_SLIDER_LEN];
if (maskOnly) return masked;
return masked * bigger / actualLength;
}`);
    }

    init() {
        this._updatePending = false;
        //encoded values hold breaks values between min and max,
        this.encodedValues = this.load(this.params.breaks, "breaks");
        this.mask = this.load(this.params.mask, "mask");

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

        if (this.params.interactive) {
            const _this = this;
            let container = document.getElementById(this.id);
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
                pips: $.extend({format: format}, this.params.pips)
            });

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

    _updateConnectStyles(container) {
        if (!container) {
            container = document.getElementById(this.id);
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

    glDrawing(program, gl) {
        gl.uniform1fv(this.breaksGluint, Float32Array.from(this.value));
        gl.uniform1fv(this.maskGluint, Float32Array.from(this.mask));
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
uniform float ${this.webGLVariableName}_breaks[ADVANCED_SLIDER_LEN];
uniform float ${this.webGLVariableName}_mask[ADVANCED_SLIDER_LEN+1];`;
    }

    get type() {
        return "float";
    }

    sample(value = undefined, valueGlType = 'void') {
        // TODO: throwing & managing exception would be better, now we don't know what happened when this gets baked to GLSL
        if (!value || valueGlType !== 'float') {
            return `ERROR Incompatible control. Advanced slider cannot be used with ${this.name} (sampling type '${valueGlType}')`;
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

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                let self = $(e.target);
                _this.value = self.val();
                _this.store(_this.value);
                _this.changed("default", _this.value, _this.value, _this);
            };
            let node = $(`#${this.id}`);
            node.val(this.value);
            node.on('change', updater);
        } else {
            let node = $(`#${this.id}`);
            node.val(this.value);
        }
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

        if (this.params.interactive) {
            const _this = this;
            let updater = function(e) {
                _this.value++;
                _this.store(_this.value);
                _this.changed("default", _this.value, _this.value, _this);
            };
            let node = $(`#${this.id}`);
            node.html(this.params.title);
            node.click(updater);
        } else {
            let node = $(`#${this.id}`);
            node.html(this.params.title);
        }
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
        this.atlas = owner.webglContext ? owner.webglContext.secondAtlas : null;
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

        const textureId = this.atlas.addImage(source, opts);
        this.atlas._commitUploads();

        if (cacheKey) {
            this.atlas.__flexRendererCache[cacheKey] = textureId;
        }

        return textureId;
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

    set(encodedTextureId) {
        const parsed = Number.parseInt(encodedTextureId, 10);
        if (Number.isNaN(parsed)) {
            this._setTexture(-1, -1);
            return;
        }
        this._setTexture(String(parsed), parsed);
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

$.FlexRenderer.UIControls.IconLibrary = {
    sets: {
        core: [
            { name: "house", glyph: "⌂", aliases: ["home", "fa-house", "fa-home"], tags: ["building", "ui"] },
            { name: "location-pin", glyph: "⌖", aliases: ["pin", "map-pin", "marker", "fa-location-dot", "fa-map-marker-alt"], tags: ["map", "place"] },
            { name: "flag", glyph: "⚑", aliases: ["banner", "fa-flag"], tags: ["marker", "state"] },
            { name: "star", glyph: "★", aliases: ["favorite", "fa-star"], tags: ["rating", "bookmark"] },
            { name: "heart", glyph: "♥", aliases: ["like", "fa-heart"], tags: ["favorite"] },
            { name: "circle", glyph: "●", aliases: ["dot", "fa-circle"], tags: ["shape"] },
            { name: "square", glyph: "■", aliases: ["fa-square"], tags: ["shape"] },
            { name: "triangle", glyph: "▲", aliases: ["warning", "fa-triangle-exclamation", "fa-exclamation-triangle"], tags: ["shape", "alert"] },
            { name: "diamond", glyph: "◆", aliases: ["gem", "fa-diamond"], tags: ["shape"] },
            { name: "plus", glyph: "✚", aliases: ["add", "cross", "fa-plus"], tags: ["action"] },
            { name: "check", glyph: "✓", aliases: ["ok", "success", "fa-check"], tags: ["action"] },
            { name: "xmark", glyph: "✕", aliases: ["close", "times", "fa-xmark", "fa-times"], tags: ["action"] },
            { name: "info", glyph: "ℹ", aliases: ["information", "fa-circle-info", "fa-info-circle"], tags: ["status"] },
            { name: "gear", glyph: "⚙", aliases: ["settings", "cog", "fa-gear", "fa-cog"], tags: ["ui"] },
            { name: "search", glyph: "⌕", aliases: ["magnifier", "fa-magnifying-glass", "fa-search"], tags: ["ui"] },
            { name: "mail", glyph: "✉", aliases: ["envelope", "fa-envelope"], tags: ["communication"] },
            { name: "phone", glyph: "☎", aliases: ["call", "fa-phone"], tags: ["communication"] },
            { name: "user", glyph: "☺", aliases: ["person", "profile", "fa-user"], tags: ["people"] },
            { name: "lock", glyph: "🔒", aliases: ["secure", "fa-lock"], tags: ["security"] },
            { name: "unlock", glyph: "🔓", aliases: ["fa-unlock"], tags: ["security"] },
            { name: "eye", glyph: "◉", aliases: ["view", "show", "fa-eye"], tags: ["visibility"] },
            { name: "sun", glyph: "☀", aliases: ["brightness", "fa-sun"], tags: ["weather"] },
            { name: "cloud", glyph: "☁", aliases: ["fa-cloud"], tags: ["weather"] },
            { name: "umbrella", glyph: "☂", aliases: ["rain", "fa-umbrella"], tags: ["weather"] },
            { name: "music", glyph: "♫", aliases: ["note", "fa-music"], tags: ["media"] }
        ]
    },

    getSetNames() {
        return Object.keys(this.sets);
    },

    getIcons(setName = "core") {
        if (setName === "all") {
            return Object.values(this.sets).flat();
        }
        return this.sets[setName] || this.sets.core || [];
    },

    resolveIconSpec(query, setName = "core") {
        const value = String(query === undefined || query === null ? "" : query).trim();
        if (!value) {
            return null;
        }

        const normalized = this._normalizeName(value);
        const directChar = this._resolveDirectGlyph(value);
        if (directChar) {
            return {
                key: `glyph:${directChar}`,
                glyph: directChar,
                label: value,
                set: normalized.startsWith("&#") || normalized.startsWith("&") ? "entity" : "literal"
            };
        }

        const icons = this.getIcons(setName);
        for (const icon of icons) {
            const haystack = [icon.name].concat(icon.aliases || []);
            if (haystack.map(item => this._normalizeName(item)).includes(normalized)) {
                return {
                    key: `${setName}:${icon.name}`,
                    glyph: icon.glyph,
                    label: icon.name,
                    set: setName,
                    icon: icon
                };
            }
        }

        return null;
    },

    search(query = "", setName = "core") {
        const value = this._normalizeName(query);
        const icons = this.getIcons(setName);
        if (!value) {
            return icons.slice(0, 24);
        }

        return icons.filter(icon => {
            const tokens = [icon.name].concat(icon.aliases || [], icon.tags || []);
            return tokens.some(token => this._normalizeName(token).includes(value));
        }).slice(0, 48);
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
    }
};

$.FlexRenderer.UIControls.IconLibrary = (() => {
    const makeGlyph = (name, glyph, aliases = [], tags = []) => ({
        name,
        glyph,
        aliases,
        tags
    });

    const makeClass = (name, className, aliases = [], tags = []) => ({
        name,
        className,
        aliases,
        tags
    });

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

    const faSolidCommon = [
        makeClass("house", "fa-solid fa-house", ["home"], ["building", "ui"]),
        makeClass("location-dot", "fa-solid fa-location-dot", ["map-marker", "pin"], ["map", "marker"]),
        makeClass("flag", "fa-solid fa-flag", [], ["marker"]),
        makeClass("star", "fa-solid fa-star", [], ["rating"]),
        makeClass("heart", "fa-solid fa-heart", [], ["status"]),
        makeClass("circle", "fa-solid fa-circle", ["dot"], ["shape"]),
        makeClass("square", "fa-solid fa-square", [], ["shape"]),
        makeClass("triangle-exclamation", "fa-solid fa-triangle-exclamation", ["warning", "alert"], ["status"]),
        makeClass("diamond", "fa-solid fa-gem", ["gem"], ["shape"]),
        makeClass("plus", "fa-solid fa-plus", ["add"], ["action"]),
        makeClass("minus", "fa-solid fa-minus", ["subtract"], ["action"]),
        makeClass("xmark", "fa-solid fa-xmark", ["close", "times"], ["action"]),
        makeClass("check", "fa-solid fa-check", ["ok"], ["action"]),
        makeClass("circle-info", "fa-solid fa-circle-info", ["info", "information"], ["status"]),
        makeClass("circle-question", "fa-solid fa-circle-question", ["question", "help"], ["status"]),
        makeClass("gear", "fa-solid fa-gear", ["cog", "settings"], ["ui"]),
        makeClass("magnifying-glass", "fa-solid fa-magnifying-glass", ["search"], ["ui"]),
        makeClass("envelope", "fa-solid fa-envelope", ["mail"], ["communication"]),
        makeClass("phone", "fa-solid fa-phone", ["call"], ["communication"]),
        makeClass("user", "fa-solid fa-user", ["person", "profile"], ["people"]),
        makeClass("users", "fa-solid fa-users", ["group"], ["people"]),
        makeClass("lock", "fa-solid fa-lock", [], ["security"]),
        makeClass("unlock", "fa-solid fa-unlock", [], ["security"]),
        makeClass("eye", "fa-solid fa-eye", ["visible"], ["visibility"]),
        makeClass("eye-slash", "fa-solid fa-eye-slash", ["hidden"], ["visibility"]),
        makeClass("sun", "fa-solid fa-sun", [], ["weather"]),
        makeClass("moon", "fa-solid fa-moon", [], ["weather"]),
        makeClass("cloud", "fa-solid fa-cloud", [], ["weather"]),
        makeClass("cloud-rain", "fa-solid fa-cloud-rain", ["rain"], ["weather"]),
        makeClass("umbrella", "fa-solid fa-umbrella", [], ["weather"]),
        makeClass("snowflake", "fa-solid fa-snowflake", [], ["weather"]),
        makeClass("bolt", "fa-solid fa-bolt", ["lightning"], ["energy"]),
        makeClass("music", "fa-solid fa-music", ["note"], ["media"]),
        makeClass("play", "fa-solid fa-play", [], ["media"]),
        makeClass("pause", "fa-solid fa-pause", [], ["media"]),
        makeClass("stop", "fa-solid fa-stop", [], ["media"]),
        makeClass("backward", "fa-solid fa-backward", [], ["media"]),
        makeClass("forward", "fa-solid fa-forward", [], ["media"]),
        makeClass("image", "fa-solid fa-image", ["photo"], ["media"]),
        makeClass("camera", "fa-solid fa-camera", [], ["media"]),
        makeClass("video", "fa-solid fa-video", [], ["media"]),
        makeClass("folder", "fa-solid fa-folder", [], ["ui"]),
        makeClass("file", "fa-solid fa-file", ["document"], ["ui"]),
        makeClass("file-lines", "fa-solid fa-file-lines", ["file-text"], ["ui"]),
        makeClass("trash", "fa-solid fa-trash", ["delete", "bin"], ["action"]),
        makeClass("pen", "fa-solid fa-pen", ["edit", "pencil"], ["action"]),
        makeClass("scissors", "fa-solid fa-scissors", ["cut"], ["action"]),
        makeClass("copy", "fa-solid fa-copy", [], ["action"]),
        makeClass("paste", "fa-solid fa-paste", [], ["action"]),
        makeClass("download", "fa-solid fa-download", [], ["action"]),
        makeClass("upload", "fa-solid fa-upload", [], ["action"]),
        makeClass("share-nodes", "fa-solid fa-share-nodes", ["share"], ["action"]),
        makeClass("link", "fa-solid fa-link", [], ["action"]),
        makeClass("filter", "fa-solid fa-filter", [], ["ui"]),
        makeClass("sliders", "fa-solid fa-sliders", ["adjust"], ["ui"]),
        makeClass("palette", "fa-solid fa-palette", ["color"], ["ui"]),
        makeClass("brush", "fa-solid fa-brush", [], ["tools"]),
        makeClass("ruler", "fa-solid fa-ruler", ["measure"], ["tools"]),
        makeClass("crop", "fa-solid fa-crop", [], ["tools"]),
        makeClass("crosshairs", "fa-solid fa-crosshairs", ["target"], ["marker"]),
        makeClass("bullseye", "fa-solid fa-bullseye", [], ["marker"]),
        makeClass("tag", "fa-solid fa-tag", ["label"], ["ui"]),
        makeClass("bookmark", "fa-solid fa-bookmark", [], ["ui"]),
        makeClass("clock", "fa-solid fa-clock", ["time"], ["ui"]),
        makeClass("calendar", "fa-solid fa-calendar", ["date"], ["ui"]),
        makeClass("microscope", "fa-solid fa-microscope", [], ["science"]),
        makeClass("flask", "fa-solid fa-flask", [], ["science"]),
        makeClass("dna", "fa-solid fa-dna", [], ["science"]),
        makeClass("leaf", "fa-solid fa-leaf", [], ["nature"]),
        makeClass("fire", "fa-solid fa-fire", [], ["status"]),
        makeClass("droplet", "fa-solid fa-droplet", ["water"], ["nature"]),
        makeClass("seedling", "fa-solid fa-seedling", [], ["nature"]),
        makeClass("hospital", "fa-solid fa-hospital", [], ["medical"]),
        makeClass("stethoscope", "fa-solid fa-stethoscope", [], ["medical"]),
        makeClass("syringe", "fa-solid fa-syringe", [], ["medical"]),
        makeClass("pills", "fa-solid fa-pills", ["pill"], ["medical"]),
        makeClass("bug", "fa-solid fa-bug", [], ["status"]),
        makeClass("shield-halved", "fa-solid fa-shield-halved", ["shield"], ["security"]),
        makeClass("database", "fa-solid fa-database", [], ["data"]),
        makeClass("server", "fa-solid fa-server", [], ["data"]),
        makeClass("chart-line", "fa-solid fa-chart-line", ["analytics"], ["data"]),
        makeClass("chart-pie", "fa-solid fa-chart-pie", [], ["data"]),
        makeClass("layer-group", "fa-solid fa-layer-group", ["layers"], ["ui"]),
        makeClass("grid", "fa-solid fa-table-cells", ["table", "cells"], ["ui"])
    ];

    const faRegularCommon = [
        makeClass("star", "fa-regular fa-star", [], ["rating"]),
        makeClass("heart", "fa-regular fa-heart", [], ["status"]),
        makeClass("circle", "fa-regular fa-circle", [], ["shape"]),
        makeClass("square", "fa-regular fa-square", [], ["shape"]),
        makeClass("bookmark", "fa-regular fa-bookmark", [], ["ui"]),
        makeClass("bell", "fa-regular fa-bell", [], ["ui"]),
        makeClass("calendar", "fa-regular fa-calendar", [], ["ui"]),
        makeClass("clock", "fa-regular fa-clock", [], ["ui"]),
        makeClass("file", "fa-regular fa-file", [], ["ui"]),
        makeClass("file-lines", "fa-regular fa-file-lines", [], ["ui"]),
        makeClass("folder", "fa-regular fa-folder", [], ["ui"]),
        makeClass("image", "fa-regular fa-image", [], ["media"]),
        makeClass("message", "fa-regular fa-message", ["comment"], ["communication"]),
        makeClass("circle-question", "fa-regular fa-circle-question", ["help"], ["status"]),
        makeClass("circle-user", "fa-regular fa-circle-user", ["profile"], ["people"])
    ];

    const faBrandsCommon = [
        makeClass("github", "fa-brands fa-github", [], ["brand"]),
        makeClass("gitlab", "fa-brands fa-gitlab", [], ["brand"]),
        makeClass("docker", "fa-brands fa-docker", [], ["brand"]),
        makeClass("chrome", "fa-brands fa-chrome", [], ["brand"]),
        makeClass("firefox", "fa-brands fa-firefox", [], ["brand"]),
        makeClass("edge", "fa-brands fa-edge", [], ["brand"]),
        makeClass("linux", "fa-brands fa-linux", [], ["brand"]),
        makeClass("windows", "fa-brands fa-windows", [], ["brand"]),
        makeClass("apple", "fa-brands fa-apple", [], ["brand"]),
        makeClass("google", "fa-brands fa-google", [], ["brand"]),
        makeClass("python", "fa-brands fa-python", [], ["brand"]),
        makeClass("js", "fa-brands fa-js", ["javascript"], ["brand"]),
        makeClass("html5", "fa-brands fa-html5", [], ["brand"]),
        makeClass("css3", "fa-brands fa-css3-alt", ["css3-alt"], ["brand"]),
        makeClass("node", "fa-brands fa-node-js", ["node-js"], ["brand"]),
        makeClass("npm", "fa-brands fa-npm", [], ["brand"]),
        makeClass("slack", "fa-brands fa-slack", [], ["brand"]),
        makeClass("discord", "fa-brands fa-discord", [], ["brand"]),
        makeClass("figma", "fa-brands fa-figma", [], ["brand"]),
        makeClass("twitter", "fa-brands fa-x-twitter", ["x-twitter"], ["brand"])
    ];

    const sets = {
        "html-glyphs": {
            kind: "glyph",
            fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif",
            fontWeight: "400",
            items: htmlGlyphs
        },
        "fa-solid-common": {
            kind: "font-class",
            fontFamily: "'Font Awesome 6 Free','Font Awesome 5 Free'",
            fontWeight: "900",
            items: faSolidCommon
        },
        "fa-regular-common": {
            kind: "font-class",
            fontFamily: "'Font Awesome 6 Free','Font Awesome 5 Free'",
            fontWeight: "400",
            items: faRegularCommon
        },
        "fa-brands-common": {
            kind: "font-class",
            fontFamily: "'Font Awesome 6 Brands','Font Awesome 5 Brands'",
            fontWeight: "400",
            items: faBrandsCommon
        }
    };

    return {
        sets,

        getSetNames() {
            return Object.keys(this.sets);
        },

        getSet(setName = "fa-solid-common") {
            if (setName === "core") {
                return this.sets["html-glyphs"];
            }
            return this.sets[setName] || this.sets["fa-solid-common"];
        },

        getIcons(setName = "fa-solid-common") {
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

        search(query = "", setName = "fa-solid-common", maxResults = 120) {
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

        resolveIconSpec(query, setName = "fa-solid-common") {
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
                    fontFamily: set.fontFamily,
                    fontWeight: set.fontWeight,
                    icon
                };
            }

            return null;
        },

        resolveAnyIconSpec(query, preferredSetName = "fa-solid-common") {
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
        }
    };
})();

$.FlexRenderer.UIControls.Icon = class extends $.FlexRenderer.IAtlasTextureControl {
    static docs() {
        return {
            summary: "Atlas-backed icon control with separate HTML-glyph and Font Awesome sets.",
            description: "Searches curated icon sets, previews Font Awesome entries by rendering the actual font-backed class in DOM, converts the selected icon to atlas texture content, and samples the second-pass atlas from GLSL.",
            kind: "ui-control",
            iconSets: $.FlexRenderer.UIControls.IconLibrary.getSetNames(),
            parameters: [
                { name: "title", type: "string", default: "Icon" },
                { name: "interactive", type: "boolean", default: true },
                { name: "default", type: "string", default: "" },
                { name: "iconSet", type: "string", default: "fa-solid-common", allowedValues: $.FlexRenderer.UIControls.IconLibrary.getSetNames() },
                { name: "size", type: "number", default: 160 },
                { name: "padding", type: "number", default: 4 },
                { name: "color", type: "string", default: "#111111" },
                { name: "backgroundColor", type: "string", default: "#00000000" },
                { name: "previewSize", type: "number", default: 34 },
                { name: "maxResults", type: "number", default: 120 },
                { name: "glyphFontFamily", type: "string", default: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif" },
                { name: "glyphFontWeight", type: "string", default: "400" }
            ],
            glType: "vec4"
        };
    }

    init() {
        this.selectedSet = this.load(this.params.iconSet || "fa-solid-common", "set") || (this.params.iconSet || "fa-solid-common");
        this.currentColor = this.params.color || "#111111";
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
                    queryInput.focus();
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
            colorInput.addEventListener("input", () => {
                this._applyUiState(queryInput ? queryInput.value : "", colorInput.value, preview, false);
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
        const fallbackColor = this._normalizeColor(this.currentColor || this.params.color || "#111111");
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
        return JSON.stringify({
            icon: String(iconValue || ""),
            color: this._normalizeColor(colorValue || this.currentColor || this.params.color || "#111111")
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
        return String(this.params.color || "#111111").toLowerCase();
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
        if (resolved.renderMode === "glyph") {
            return {
                text: resolved.glyph,
                fontFamily: resolved.fontFamily || this.params.glyphFontFamily,
                fontWeight: resolved.fontWeight || this.params.glyphFontWeight
            };
        }

        if (resolved.renderMode === "class") {
            return this._resolveFontClassRenderSpec(resolved.className, resolved);
        }

        return null;
    }

    _resolveFontClassRenderSpec(className, resolved) {
        if (typeof document === "undefined") {
            return null;
        }

        const probe = document.createElement("i");
        probe.className = className;
        probe.setAttribute("aria-hidden", "true");
        probe.style.position = "absolute";
        probe.style.left = "-10000px";
        probe.style.top = "-10000px";
        probe.style.fontSize = `${Math.max(16, Number.parseInt(this.params.previewSize, 10) || 34)}px`;
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
                fontWeight: pseudo.fontWeight || resolved.fontWeight || "900"
            };
        } finally {
            probe.remove();
        }
    }

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
    }

    _renderIconCanvas(renderSpec) {
        const size = Math.max(16, Number.parseInt(this.params.size, 10) || 160);
        const padding = Math.max(0, Number.parseInt(this.params.padding, 10) || 0);

        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, size, size);

        if (this.params.backgroundColor && this.params.backgroundColor !== "#00000000") {
            ctx.fillStyle = this.params.backgroundColor;
            ctx.fillRect(0, 0, size, size);
        }

        const availableSize = Math.max(8, size - (padding * 2));
        const measureAt = (fontSize) => {
            ctx.font = `${renderSpec.fontWeight || "400"} ${fontSize}px ${renderSpec.fontFamily || this.params.glyphFontFamily}`;
            return ctx.measureText(renderSpec.text);
        };

        let metrics = measureAt(size);
        let boundsWidth = Math.max(
            1,
            (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0),
            metrics.width || 0
        );
        let boundsHeight = Math.max(
            1,
            (metrics.actualBoundingBoxAscent || 0) + (metrics.actualBoundingBoxDescent || 0),
            size * 0.7
        );
        const fitScale = Math.min(availableSize / boundsWidth, availableSize / boundsHeight);
        const fontSize = Math.max(8, Math.floor(size * fitScale));
        metrics = measureAt(fontSize);

        ctx.fillStyle = this.currentColor;
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

        const strokeWidth = Math.max(1, fontSize * 0.035);
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = this.currentColor;
        ctx.strokeText(renderSpec.text, x, y);
        ctx.fillText(renderSpec.text, x, y);

        return canvas;
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
            return;
        }

        node.title = `${resolved.label} (${resolved.set})`;

        if (resolved.renderMode === "class") {
            const icon = document.createElement("i");
            icon.className = resolved.className;
            icon.setAttribute("aria-hidden", "true");
            icon.style.fontSize = `${Math.max(18, Number.parseInt(this.params.previewSize, 10) || 34)}px`;
            icon.style.color = this.currentColor;
            node.appendChild(icon);
            return;
        }

        const span = document.createElement("span");
        span.textContent = resolved.glyph;
        span.style.fontFamily = resolved.fontFamily || this.params.glyphFontFamily;
        span.style.fontWeight = resolved.fontWeight || this.params.glyphFontWeight;
        span.style.fontSize = `${Math.max(18, Number.parseInt(this.params.previewSize, 10) || 34)}px`;
        span.style.lineHeight = "1";
        span.style.color = this.currentColor;
        node.appendChild(span);
    }

    _renderIconResults(node, query) {
        if (!node) {
            return;
        }

        const maxResults = Math.max(20, Number.parseInt(this.params.maxResults, 10) || 120);
        const icons = $.FlexRenderer.UIControls.IconLibrary.searchAll(query, maxResults);

        node.innerHTML = icons.map(icon => {
            const previewHtml = icon.className
                ? `<i class="${icon.className}" aria-hidden="true" style="font-size: 24px;"></i>`
                : `<span style="font-size: 24px; line-height: 1;">${icon.glyph}</span>`;

            return `
<button type="button"
    class="icon-search-result"
    data-icon-name="${icon.name}"
    data-icon-set="${icon.set || ""}"
    title="${icon.name}"
    style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 84px; padding: 10px; border: 1px solid #d8e2d9; border-radius: 10px; background: #fff;">
<span style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;">${previewHtml}</span>
<span style="font-size: 12px; text-align: center; line-height: 1.2;">${icon.name}</span>
<span style="font-size: 11px; text-align: center; line-height: 1.2; opacity: 0.6;">${icon.set || ""}</span>
</button>`;
        }).join("");

        node.querySelectorAll("[data-icon-name]").forEach(button => {
            button.addEventListener("click", () => {
                const queryInput = document.getElementById(`${this.id}_query`);
                const preview = document.getElementById(`${this.id}_preview`);
                const popup = document.getElementById(`${this.id}_popup`);

                if (queryInput) {
                    queryInput.value = button.dataset.iconName;
                }

                this._applyIconSelection(button.dataset.iconName, preview, popup, button.dataset.iconSet || undefined);
            });
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
        const body = `<div id="${this.id}_root" class="er-control__widget er-control__widget--icon"${$.FlexRenderer.UIControls.styleAttr(`${css}; position: relative;`)}>
<div class="er-control__toolbar er-control__toolbar--icon" style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
    <button id="${this.id}_trigger" type="button" class="er-control__button er-control__button--icon-trigger" ${disabled}
        style="width: 52px; height: 52px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #ccc; border-radius: 8px; background: #fff; cursor: pointer;">
        <span id="${this.id}_preview" class="er-control__preview er-control__preview--icon" style="display: inline-flex; align-items: center; justify-content: center; width: 100%; height: 100%;">?</span>
    </button>
</div>
<div id="${this.id}_popup" class="er-control__popup er-control__popup--icon"
     style="display: none; position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: min(420px, 90vw); padding: 12px; border: 1px solid #c9d5ca; border-radius: 12px; background: #fdfefd; box-shadow: 0 16px 36px rgba(18, 32, 24, 0.12);">
    <div class="er-control__popup-header er-control__popup-header--icon" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <strong style="font-size: 13px;">Icon picker</strong>
        <button id="${this.id}_close" type="button" class="er-control__button er-control__button--icon-close" ${disabled}>Close</button>
    </div>
    <div class="er-control__search er-control__search--icon" style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-bottom: 10px; align-items: end;">
        <input type="text" id="${this.id}_query" class="er-control__input er-control__input--icon-query" placeholder="Search icons, aliases, glyphs" style="width: 100%;" ${disabled}>
        <label class="er-control__color-picker er-control__color-picker--icon" style="display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #4e5d52;">
            <span>Color</span>
            <input type="color" id="${this.id}_color" class="er-control__input er-control__input--icon-color" value="${this._decodeStoredValue(this.encodedValue || this.params.default).color}" style="width: 44px; height: 38px; padding: 2px;" ${disabled}>
        </label>
    </div>
    <div id="${this.id}_results" class="er-control__results er-control__results--icon"
         style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; max-height: 360px; overflow: auto;"></div>
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
            iconSet: "fa-solid-common",
            size: 160,
            padding: 4,
            color: "#111111",
            backgroundColor: "#00000000",
            previewSize: 34,
            maxResults: 120,
            glyphFontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Emoji',sans-serif",
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
