
(function($) {
/**
 * ColorMap Input
 * @class OpenSeadragon.FlexRenderer.UIControls.ColorMap
 */
$.FlexRenderer.UIControls.ColorMap = class extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
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
                let self = $(e.target),
                    selected = self.val();
                _this.colorPallete = $.FlexRenderer.ColorMaps[selected][_this.maxSteps];
                _this._setPallete(_this.colorPallete);
                self.css("background", _this.cssGradient(_this.colorPallete));
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
            node.html(schemas.join(""));
            node.val(this.value);
            node.on('change', updater);
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
        let node = $(`#${this.id}`);
        node.css("background", this.cssGradient(this.colorPallete));
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
            return `<div class="${classes}" style="${css}"><span> ${this.params.title}</span><span id="${this.id}" class="text-white-shadow p-1 rounded-2"
style="width: 60%;">${this.load(this.params.default)}</span></div>`;
        }

        return `<div class="${classes}" style="${css}"><span> ${this.params.title}</span><select id="${this.id}" class="form-control text-white-shadow"
style="width: 60%;"></select></div>`;
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
                let self = $(e.target),
                    index = Number.parseInt(e.target.dataset.index, 10),
                    selected = self.val();

                if (Number.isInteger(index)) {
                    _this.colorPallete[index] = selected;
                    _this._setPallete(_this.colorPallete);
                    self.parent().css("background", _this.cssGradient(_this.colorPallete));
                    _this.value = _this.colorPallete;
                    _this.store(_this.colorPallete);
                    _this.changed("default", _this.pallete, _this.value, _this);
                    _this.owner.invalidate();
                }
            };

            this._setPallete(this.colorPallete);
            let node = this.updateColormapUI();

            const width = 1 / this.colorPallete.length * 100;
            node.html(this.colorPallete.map((x, i) => `<input type="color" style="width: ${width}%; height: 30px; background: none; border: none; padding: 4px 5px;" value="${x}" data-index="${i}">`).join(""));
            node.val(this.value);
            node.children().on('change', updater);
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
            return `<div class="${classes}" style="${css}"><span> ${this.params.title}</span><span id="${this.id}" class="text-white-shadow rounded-2 p-0 d-inline-block"
style="width: 60%;">&emsp;</span></div>`;
        }

        return `<div class="${classes}" style="${css}"><span> ${this.params.title}</span><span id="${this.id}" class="form-control text-white-shadow p-0 d-inline-block"
style="width: 60%;"></span></div>`;
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
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
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
                                "var(--color-icon-danger)" : "var(--color-icon-tertiary)";
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
                "var(--color-icon-danger)" : "var(--color-icon-tertiary)";
            pips[i].dataset.index = (i).toString();
        }
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
        return `<div style="${css}" class="${classes}"><span>${this.params.title}: </span><div id="${this.id}" style="height: 9px;
margin-left: 5px; width: 60%; display: inline-block"></div></div>`;
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
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
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
        let title = this.params.title ? `<span style="height: 54px;">${this.params.title}: </span>` : "";
        return `<div class="${classes}">${title}<textarea id="${this.id}" class="form-control"
style="width: 100%; display: block; resize: vertical; ${css}" ${disabled} placeholder="${this.params.placeholder}"></textarea></div>`;
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
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
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
        css = `style="${css ? css : ""}float: right;"`;
        return `<button id="${this.id}" ${css} class="${classes}" ${disabled}></button>`;
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

$.FlexRenderer.UIControls.Image = class extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this.atlas = owner.webglContext.secondAtlas;
        this._params = this.getParams(params);
    }

    init() {
        this.encodedTextureId = this.load(this.params.default);

        this.textureId = Number.parseInt(this.encodedTextureId, 10);

        if (this.params.interactive) {
            const _this = this;

            let number = document.getElementById(`${this.id}_number`);
            if (number) {
                let updater = function(e) {
                    _this.set(e.target.value);
                    _this.owner.invalidate();
                };

                number.value = this.encodedTextureId;
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
                                _this.atlas.addImage(image);
                                _this.atlas._commitUploads();
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
        this.encodedTextureId = encodedTextureId;
        this.textureId = Number.parseInt(this.encodedTextureId, 10);

        this.changed("default", this.textureId, this.encodedTextureId, this);
        this.store(this.encodedTextureId);
        this._needsLoad = true;
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

    toHtml(classes = "", css = "") {
        return `<span>${this.params.title}</span>
        <div class="${classes}" style="${css}">
            Selected: <input type="number" id="${this.id}_number" min="-1" max="16" step="1"><br>
            <input type="file" id="${this.id}_file" accept="image/png"><br>
            <button id="${this.id}_button">Add Image</button>
        </div>`;
    }

    sample(value = undefined, valueGlType = 'void') {
        if (!value) {
            throw new Error("Requires a vec2 value/variable specifying the texture coordinate to sample at");
        }

        if (valueGlType === 'vec2') {
            return `osd_atlas_texture(${this.webGLVariableName}_textureId, ${value})`;
        }

        throw new Error(`Incompatible parameter type '${valueGlType}' for image sampling control '${this.name}'; only vec2 is supported`);
    }

    get supports() {
        return {
            title: "Images",
            interactive: true,
            default: -1,
        };
    }

    get supportsAll() {
        return {};
    }

    get raw() {
        return this.textureId;
    }

    get encoded() {
        return this.encodedTextureId;
    }

    get type() {
        return "vec4";
    }
};
$.FlexRenderer.UIControls.registerClass("image", $.FlexRenderer.UIControls.Image);

})(OpenSeadragon);
