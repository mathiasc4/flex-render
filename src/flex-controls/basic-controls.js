(function($) {
/**
 * Factory Manager for predefined UIControls
 *  - you can manage all your UI control logic within your shader implementation
 *  and not to touch this class at all, but here you will find some most common
 *  or some advanced controls ready to use, simple and powerful
 *  - registering an IComponent implementation (or an UiElement) in the factory results in its support
 *  among all the shaders (given the GLSL type, result of sample(...) matches).
 *  - UiElements are objects to create simple controls quickly and get rid of code duplicity,
 *  for more info @see OpenSeadragon.FlexRenderer.UIControls.register()
 * @class OpenSeadragon.FlexRenderer.UIControls
 */
$.FlexRenderer.UIControls = class {
    /**
     * Get all available control types
     * @return {string[]} array of available control types
     */
    static types() {
        return Object.keys(this._items).concat(Object.keys(this._impls));
    }

    /**
     * Get an element used to create simple controls, if you want
     * an implementation of the controls themselves (IControl), use build(...) to instantiate
     * @param {string} id type of the control
     * @return {*}
     */
    static getUiElement(id) {
        let ctrl = this._items[id];
        if (!ctrl) {
            console.error("Invalid control: " + id);
            ctrl = this._items["number"];
        }
        return ctrl;
    }

    /**
     * Get an element used to create advanced controls, if you want
     * an implementation of simple controls, use build(...) to instantiate
     * @param {string} id type of the control
     * @return {OpenSeadragon.FlexRenderer.UIControls.IControl}
     */
    static getUiClass(id) {
        let ctrl = this._impls[id];
        if (!ctrl) {
            console.error("Invalid control: " + id);
            ctrl = this._impls["colormap"];
        }
        return ctrl;
    }

    /**
     * Build UI control object based on given parameters
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer} owner owner of the control, shaderLayer
     * @param {string} controlName name used for the control (eg.: opacity)
     * @param {object} controlObject object from shaderLayer.defaultControls, defines control
     * @param {string} controlId
     * @param {object|*} customParams parameters passed to the control (defined by the control) or set as default value if not object ({})
     * @return {OpenSeadragon.FlexRenderer.UIControls.IControl}
     */
    static build(owner, controlName, controlObject, controlId, customParams = {}) {
        let defaultParams = controlObject.default,
            accepts = controlObject.accepts,
            requiredParams = controlObject.required === undefined ? {} : controlObject.required;

        let interactivityEnabled = owner._interactive;

        // if not an object, but a value, make it the default one
        if (!(typeof customParams === 'object')) {
            customParams = {default: customParams};
        }
        //must be false if HTML nodes are not managed
        if (!interactivityEnabled) {
            customParams.interactive = false;
        }

        let originalType = defaultParams.type;

        // merge dP < cP < rP recursively with rP having the biggest overwriting priority, without modifying the original objects
        const params = $.extend(true, {}, defaultParams, customParams, requiredParams);

        if (!this._items[params.type]) {
            const controlType = params.type;

            // if cannot use the new control type, try to use the default one
            if (!this._impls[controlType]) {
                return this._buildFallback(controlType, originalType, owner, controlName, controlObject, params);
            }

            let cls = new this._impls[controlType](owner, controlName, controlId, params);

            if (accepts(cls.type, cls)) {
                return cls;
            }

            // cannot built with custom implementation, try to build with a default one
            return this._buildFallback(controlType, originalType, owner, controlName, controlObject, params);

        } else { // control's type (eg.: range/number/...) is defined in this._items
            let intristicComponent = this.getUiElement(params.type);
            let comp = new $.FlexRenderer.UIControls.SimpleUIControl(
                owner, controlName, controlId, params, intristicComponent
            );

            if (accepts(comp.type, comp)) {
                return comp;
            }
            return this._buildFallback(intristicComponent.glType, originalType,
                owner, controlName, controlObject, params);
        }
    }

    static _buildFallback(newType, originalType, owner, controlName, controlObject, customParams) {
        //repeated check when building object from type

        customParams.interactive = false;
        if (originalType === newType) { //if default and new equal, fail - recursion will not help
            console.error(`Invalid parameter in shader '${customParams.type}': the parameter could not be built.`);
            return undefined;
        } else { //otherwise try to build with originalType (default)
            customParams.type = originalType;
            console.warn("Incompatible UI control type '" + newType + "': making the input non-interactive.");
            return this.build(owner, controlName, controlObject, customParams);
        }
    }

    /**
     * Register simple UI element by providing necessary object
     * implementation:
     *  { defaults: function() {...}, // object with all default values for all supported parameters
         html: function(uniqueId, params, classes="", css="") {...}, //how the HTML UI controls look like
        glUniformFunName: function() {...}, //what function webGL uses to pass this attribute to GPU
        decode: function(fromValue) {...}, //parse value obtained from HTML controls into something
                                                gl[glUniformFunName()](...) can pass to GPU
        glType: //what's the type of this parameter wrt. GLSL: int? vec3?
     * @param type the identifier under which is this control used: lookup made against params.type
     * @param uiElement the object to register, fulfilling the above-described contract
     */
    static register(type, uiElement) {
        function check(el, prop, desc) {
            if (!el[prop]) {
                console.warn(`Skipping UI control '${type}' due to '${prop}': missing ${desc}.`);
                return false;
            }
            return true;
        }

        if (check(uiElement, "defaults", "defaults():object") &&
            check(uiElement, "html", "html(uniqueId, params, css):htmlString") &&
            check(uiElement, "glUniformFunName", "glUniformFunName():string") &&
            check(uiElement, "decode", "decode(encodedValue):<compatible with glType>") &&
            check(uiElement, "normalize", "normalize(value, params):<typeof value>") &&
            check(uiElement, "sample", "sample(value, valueGlType):glslString") &&
            check(uiElement, "glType", "glType:string")
        ) {
            uiElement.prototype.getName = () => type;
            if (this._items[type]) {
                console.warn("Registering an already existing control component: ", type);
            }
            uiElement["uiType"] = type;
            this._items[type] = uiElement;
        }
    }

    /**
     * Register class as a UI control
     * @param {string} type unique control name / identifier
     * @param {OpenSeadragon.FlexRenderer.UIControls.IControl} cls to register, implementation class of the controls
     */
    static registerClass(type, cls) {
        //todo not really possible with syntax checker :/
        // if ($.FlexRenderer.UIControls.IControl.isPrototypeOf(cls)) {
        cls.prototype.getName = () => type;

        if (this._items[type]) {
            console.warn("Registering an already existing control component: ", type);
        }
        cls._uiType = type;
        this._impls[type] = cls;
        // } else {
        //     console.warn(`Skipping UI control '${type}': does not inherit from $.FlexRenderer.UIControls.IControl.`);
        // }
    }
};

// Definitions of possible controls' types, simple functionalities:
$.FlexRenderer.UIControls._items = {
    number: {
        defaults: function() {
            return {title: "Number", interactive: true, default: 0, min: 0, max: 100, step: 1};
        },
        // returns string corresponding to html code for injection
        html: function(uniqueId, params, classes = "", css = "") {
            let title = params.title ? `<span> ${params.title}</span>` : "";
            return `${title}<input class="${classes}" style="${css}" min="${params.min}" max="${params.max}"
step="${params.step}" type="number" id="${uniqueId}">`;
        },
        glUniformFunName: function() {
            return "uniform1f";
        },
        decode: function(fromValue) {
            return Number.parseFloat(fromValue);
        },
        normalize: function(value, params) {
            return (value - params.min) / (params.max - params.min);
        },
        sample: function(name, ratio) {
            return name;
        },
        glType: "float",
        uiType: "number"
    },

    range: {
        defaults: function() {
            return {title: "Range", interactive: true, default: 0, min: 0, max: 100, step: 1};
        },
        html: function(uniqueId, params, classes = "", css = "") {
            let title = params.title ? `<span> ${params.title}</span>` : "";
            return `${title}<input type="range" style="${css}"
class="${classes}" min="${params.min}" max="${params.max}" step="${params.step}" id="${uniqueId}">`;
        },
        glUniformFunName: function() {
            return "uniform1f";
        },
        decode: function(fromValue) {
            return Number.parseFloat(fromValue);
        },
        normalize: function(value, params) {
            return (value - params.min) / (params.max - params.min);
        },
        sample: function(name, ratio) {
            return name;
        },
        glType: "float",
        uiType: "range"
    },

    color: {
        defaults: function() {
            return { title: "Color", interactive: true, default: "#fff900" };
        },
        html: function(uniqueId, params, classes = "", css = "") {
            let title = params.title ? `<span> ${params.title}</span>` : "";
            return `${title}<input type="color" id="${uniqueId}" style="${css}" class="${classes}">`;
        },
        glUniformFunName: function() {
            return "uniform3fv";
        },
        decode: function(fromValue) {
            try {
                let index = fromValue.startsWith("#") ? 1 : 0;
                return [
                    parseInt(fromValue.slice(index, index + 2), 16) / 255,
                    parseInt(fromValue.slice(index + 2, index + 4), 16) / 255,
                    parseInt(fromValue.slice(index + 4, index + 6), 16) / 255
                ];
            } catch (e) {
                return [0, 0, 0];
            }
        },
        normalize: function(value, params) {
            return value;
        },
        sample: function(name, ratio) {
            return name;
        },
        glType: "vec3",
        uiType: "color"
    },

    bool: {
        defaults: function() {
            return { title: "Checkbox", interactive: true, default: true };
        },
        html: function(uniqueId, params, classes = "", css = "") {
            let title = params.title ? `<span> ${params.title}</span>` : "";
            let value = this.decode(params.default) ? "checked" : "";
            //note a bit dirty, but works :) - we want uniform access to 'value' property of all inputs
            return `${title}<input type="checkbox" style="${css}" id="${uniqueId}" ${value}
class="${classes}" onchange="this.value=this.checked; return true;">`;
        },
        glUniformFunName: function() {
            return "uniform1i";
        },
        decode: function(fromValue) {
            return fromValue && fromValue !== "false" ? 1 : 0;
        },
        normalize: function(value, params) {
            return value;
        },
        sample: function(name, ratio) {
            return name;
        },
        glType: "bool",
        uiType: "bool"
    }
};

// Implementation of UI control classes, complex functionalities.
$.FlexRenderer.UIControls._impls = {
    // e.g.: colormap: $.FlexRenderer.UIControls.ColorMap
};

/**
 * @interface
 */
$.FlexRenderer.UIControls.IControl = class {

    /**
     * Sets common properties needed to create the controls:
     *  this.owner @extends FlexRenderer.ShaderLayer - owner
     *  this.name - name of the parameter for this.owner.[load/store]Property(...) call
     *  this.id - unique ID for HTML id attribute, to be able to locate controls in DOM,
     *      created as ${uniq}${name}-${owner.uid}
     *  this.webGLVariableName - unique webgl uniform variable name, to not to cause conflicts
     *
     * If extended (class-based definition, see registerCass) children should define constructor as
     *
     * @example
     *   constructor(owner, name, webGLVariableName, params) {
     *       super(owner, name, webGLVariableName);
     *       ...
     *       //possibly make use of params:
     *       this.params = this.getParams(params);
     *
     *       //now access params:
     *       this.params...
     *   }
     *
     * @param {ShaderLayer} owner shader context owning this control
     * @param {string} name name of the control (key to the params in the shader configuration)
     * @param {string} uniq another element to construct the DOM id from, mostly for compound controls
     */
    constructor(owner, name, id) {
        this.owner = owner;
        this.name = name;
        this.id = id;
        this.webGLVariableName = `${name}_${owner.uid}`;
        this._params = {};
        this.__onchange = {};
    }

    /**
     * Safely sets outer params with extension from 'supports'
     *  - overrides 'supports' values with the correct type (derived from supports or supportsAll)
     *  - sets 'supports' as defaults if not set
     * @param params
     */
    getParams(params) {
        const t = this.constructor.getVarType;
        function mergeSafeType(mask, from, possibleTypes) {
            const to = Object.assign({}, mask);
            Object.keys(from).forEach(key => {
                const tVal = to[key],
                    fVal = from[key],
                    tType = t(tVal),
                    fType = t(fVal);

                const typeList = possibleTypes ? possibleTypes[key] : undefined,
                    pTypeList = typeList ? typeList.map(x => t(x)) : [];

                //our type detector distinguishes arrays and objects
                if (tVal && fVal && tType === "object" && fType === "object") {
                    to[key] = mergeSafeType(tVal, fVal, typeList);
                } else if (tVal === undefined || tType === fType || pTypeList.includes(fType)) {
                    to[key] = fVal;
                } else if (fType === "string") {
                    //try parsing NOTE: parsing from supportsAll is ignored!
                    if (tType === "number") {
                        const parsed = Number.parseFloat(fVal);
                        if (!Number.isNaN(parsed)) {
                            to[key] = parsed;
                        }
                    } else if (tType === "boolean") {
                        const value = fVal.toLowerCase();
                        if (value === "false") {
                            to[key] = false;
                        }
                        if (value === "true") {
                            to[key] = true;
                        }
                    }
                }
            });
            return to;
        }

        return mergeSafeType(this.supports, params, this.supportsAll);
    }

    /**
     * Safely check certain param value
     * @param value  value to check
     * @param defaultValue default value to return if check fails
     * @param paramName name of the param to check value type against
     * @return {boolean|number|*}
     */
    getSafeParam(value, defaultValue, paramName) {
        const t = this.constructor.getVarType;
        function nest(suppNode, suppAllNode) {
            if (t(suppNode) !== "object") {
                return [suppNode, suppAllNode];
            }
            if (!suppNode[paramName]) {
                return [undefined, undefined];
            }
            return nest(suppNode[paramName], suppAllNode ? suppAllNode[paramName] : undefined);
        }
        const param = nest(this.supports, this.supportsAll),
            tParam = t(param[0]);

        if (tParam === "object") {
            console.warn("Parameters should not be stored at object level. No type inspection is done.");
            return true; //no supported inspection
        }
        const tValue = t(value);
        //supported type OR supports all types includes the type
        if (tValue === tParam || (param[1] && param[1].map(t).includes(tValue))) {
            return value;
        }

        if (tValue === "string") {
            //try parsing NOTE: parsing from supportsAll is ignored!
            if (tParam === "number") {
                const parsed = Number.parseFloat(value);
                if (!Number.isNaN(parsed)) {
                    return parsed;
                }
            } else if (tParam === "boolean") {
                const val = value.toLowerCase();
                if (val === "false") {
                    return false;
                }
                if (val === "true") {
                    return true;
                }
            }
        }

        return defaultValue;
    }

    /**
     * Uniform behaviour wrt type checking in shaders
     * @param x
     * @return {string}
     */
    static getVarType(x) {
        if (x === undefined) {
            return "undefined";
        }
        if (x === null) {
            return "null";
        }
        return Array.isArray(x) ? "array" : typeof x;
    }

    /**
     * JavaScript initialization
     *  - read/store default properties here using this.owner.[load/store]Property(...)
     *  - work with own HTML elements already attached to the DOM
     *      - set change listeners, input values!
     */
    init() {
        throw "FlexRenderer.UIControls.IControl::init() must be implemented.";
    }

    /**
     * TODO: improve overall setter API
     * Allows to set the control value programatically.
     * Does not trigger canvas re-rednreing, must be done manually (e.g. control.owner.invalidate())
     * @param encodedValue any value the given control can support, encoded
     *  (e.g. as the control acts on the GUI - for input number of
     *    values between 5 and 42, the value can be '6' or 6 or 6.15
     */
    set(encodedValue) {
        throw "FlexRenderer.UIControls.IControl::set() must be implemented.";
    }

    /**
     * Called when an image is rendered
     * @param {WebGLProgram} program
     * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
     */
    glDrawing(program, gl) {
        //the control should send something to GPU
        throw "FlexRenderer.UIControls.IControl::glDrawing() must be implemented.";
    }

    /**
     * Called when associated webgl program is switched to
     * @param {WebGLProgram} program
     * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
     */
    glLoaded(program, gl) {
        //the control should send something to GPU
        throw "FlexRenderer.UIControls.IControl::glLoaded() must be implemented.";
    }

    /**
     * Get the UI HTML controls
     *  - these can be referenced in this.init(...)
     *  - should respect this.params.interactive attribute and return non-interactive output if interactive=false
     *      - don't forget to no to work with DOM elements in init(...) in this case
     *
     * todo: when overrided value before 'init' call on params, toHtml was already called, changes might not get propagated
     *  - either: delay toHtml to trigger insertion later (not nice)
     *  - do not allow changes before init call, these changes must happen at constructor
     */
    toHtml(classes = "", css = "") {
        throw "FlexRenderer.UIControls.IControl::toHtml() must be implemented.";
    }

    /**
     * Handles how the variable is being defined in GLSL
     *  - should use variable names derived from this.webGLVariableName
     */
    define() {
        throw "FlexRenderer.UIControls.IControl::define() must be implemented.";
    }

    /**
     * Sample the parameter using ratio as interpolation, must be one-liner expression so that GLSL code can write
     *    `vec3 mySampledValue = ${this.color.sample("0.2")};`
     * NOTE: you can define your own global-scope functions to keep one-lined sampling,
     * see this.owner.includeGlobalCode(...)
     * @param {(string|undefined)} value openGL value/variable, used in a way that depends on the UI control currently active
     *        (do not pass arguments, i.e. 'undefined' just get that value, note that some inputs might require you do it..)
     * @param {string} valueGlType GLSL type of the value
     * @return {string} valid GLSL oneliner (wihtout ';') for sampling the value, or invalid code (e.g. error message) to signal error
     */
    sample(value = undefined, valueGlType = 'void') {
        throw "FlexRenderer.UIControls.IControl::sample() must be implemented.";
    }

    /**
     * Parameters supported by this UI component, must contain at least
     *  - 'interactive' - type bool, enables and disables the control interactivity
     *  (by changing the content available when rendering html)
     *  - 'title' - type string, the control title
     *
     *  Additionally, for compatibility reasons, you should, if possible, define
     *  - 'default' - type any; the default value for the particular control
     * @return {{}} name: default value mapping
     */
    get supports() {
        throw "FlexRenderer.UIControls.IControl::supports must be implemented.";
    }

    /**
     * Type definitions for supports. Can return empty object. In case of missing
     * type definitions, the type is derived from the 'supports()' default value type.
     *
     * Each key must be an array of default values for the given key if applicable.
     * This is an _extension_ to the supports() and can be used only for keys that have more
     * than one default type applicable
     * @return {{}}
     */
    get supportsAll() {
        throw "FlexRenderer.UIControls.IControl::typeDefs must be implemented.";
    }

    /**
     * GLSL type of this control: what type is returned from this.sample(...) ?
     * @return {string}
     */
    get type() {
        throw "FlexRenderer.UIControls.IControl::type must be implemented.";
    }

    /**
     * Raw value sent to the GPU, note that not necessarily typeof raw() === type()
     * some controls might send whole arrays of data (raw) and do smart sampling such that type is only a number
     * @return {any}
     */
    get raw() {
        throw "FlexRenderer.UIControls.IControl::raw must be implemented.";
    }

    /**
     * Encoded value as used in the UI, e.g. a name of particular colormap, or array of string values of breaks...
     * @return {any}
     */
    get encoded() {
        throw "FlexRenderer.UIControls.IControl::encoded must be implemented.";
    }

    //////////////////////////////////////
    //////// COMMON API //////////////////
    //////////////////////////////////////

    /**
     * The control type component was registered with. Handled internally.
     * @return {*}
     */
    get uiControlType() {
        return this.constructor._uiType;
    }

    /**
     * Get current control parameters
     * the control should set the value as this._params = this.getParams(incomingParams);
     * @return {{}}
     */
    get params() {
        return this._params;
    }

    /**
     * Automatically overridden to return the name of the control it was registered with
     * @return {string}
     */
    getName() {
        return "IControl";
    }

    /**
     * Load a value from cache to support its caching - should be used on all values
     * that are available for the user to play around with and change using UI controls
     *
     * @param defaultValue value to return in case of no cached value, if undefined, it is fetched from supports()
     * @param paramName name of the parameter, must be equal to the name from 'supports' definition
     * @return {*} cached or default value
     */
    load(defaultValue, paramName = "") {
        return this.owner.loadProperty(this.name + (paramName === "default" ? "" : paramName),
            defaultValue === undefined ? this.supports[paramName] : defaultValue,
        );
    }

    /**
     * Store a value from cache to support its caching - should be used on all values
     * that are available for the user to play around with and change using UI controls
     *
     * @param value to store
     * @param paramName name of the parameter, must be equal to the name from 'supports' definition
     *  - default value can be empty string
     */
    store(value, paramName = "") {
        if (paramName === "default") {
            paramName = "";
        }
        this.owner.storeProperty(this.name + paramName, value);
    }

    /**
     * On parameter change register self
     * @param {string} event which event to fire on
     *  - events are with inputs the names of supported parameters (this.supports), separated by dot if nested
     *  - most controls support "default" event - change of default value
     *  - see specific control implementation to see what events are fired (Advanced Slider fires "breaks" and "mask" for instance)
     * @param {function} clbck(rawValue, encodedValue, context) call once change occurs, context is the control instance
     */
    on(event, clbck) {
        this.__onchange[event] = clbck; //only one possible event -> rewrite?
    }

    /**
     * Clear events of the event type
     * @param {string} event type
     */
    off(event) {
        delete this.__onchange[event];
    }

    /**
     * Clear ALL events
     */
    clearEvents() {
        this.__onchange = {};
    }

    /**
     * Invoke changed value event
     *  -- should invoke every time a value changes !driven by USER!, and use unique or compatible
     *     event name (event 'value') so that shader knows what changed
     * @param event event to call
     * @param value decoded value of encodedValue
     * @param encodedValue value that was received from the UI input
     * @param context self reference to bind to the callback
     */
    changed(event, value, encodedValue, context) {
        if (typeof this.__onchange[event] === "function") {
            this.__onchange[event](value, encodedValue, context);
        }
    }

    /**
     * Create cache object to store this control's values.
     * @returns {object}
     */
    createCacheObject() {
        this._cache = {
            encodedValue: this.encoded,
            value: this.raw
        };
        return this._cache;
    }

    /**
     *
     * @param {object} cache object to serve as control's cache
     */
    loadCacheObject(cache) {
        this._cache = cache;
        this.set(cache.encodedValue);
    }
};


/**
 * Generic UI control implementations
 * used if:
 * {
 *     type: "CONTROL TYPE",
 *     ...
 * }
 *
 * The subclass constructor should get the owner reference, the name
 * of the input and the parametrization.
 *
 * Further parameters passed are dependent on the control type, see
 * @ FlexRenderer.UIControls
 *
 * @class FlexRenderer.UIControls.SimpleUIControl
 */
$.FlexRenderer.UIControls.SimpleUIControl = class extends $.FlexRenderer.UIControls.IControl {
    /**
     * Uses intristicComponent from UIControls._items that corresponds to type of this control.
     * @param {ShaderLayer} owner owner of the control (shaderLayer)
     * @param {string} name name of the control (eg. "opacity")
     * @param {string} id unique control's id, corresponds to it's DOM's element's id
     * @param {object} params
     * @param {object} intristicComponent control's object from UIControls._items, keyed with it's params.default.type?
     */
    constructor(owner, name, id, params, intristicComponent) {
        super(owner, name, id);
        this.component = intristicComponent;
        this._params = this.getParams(params);
        this._needsLoad = true;
    }

    /**
     * Set this.encodedValue to the default value defined in the intristicComponent.
     * Set this.value to the normalized value (from the encoded value) that will be sent to the GLSL.
     * Register "change" event handler to the control, if interactive.
     */
    init() {
        this.encodedValue = this.load(this.params.default);
        // nothing was stored in the cache so we got the default value from the load call => store the value in the cache
        if (this.encodedValue === this.params.default) {
            this.store(this.encodedValue);
        }

        /** Firstly decode encodedValue:
         *      for color it means that it is converted from string "#ffffff" to an array of three floats,
         *      for range it just parses the float on input.
         *  Secondly normalize the obtained value:
         *      for color it does nothing,
         *      for range it somehow gets it to the range <0, 1>;
         *          e.g.: with the range-min being 0 and range-max 100 and default value 40, it will set the min to 0, max to 100, and value to 0.4;
         *                  so that "distances" between the value and min and max remain the same.
         */
        this.value = this.component.normalize(this.component.decode(this.encodedValue), this.params);

        if (this.params.interactive) {
            const _this = this;
            let node = document.getElementById(this.id);
            if (node) {
                let updater = function(e) {
                    _this.set(e.target.value);
                    _this.owner.invalidate();
                };

                // TODO: some elements do not have 'value' attribute, but 'checked' or 'selected' instead
                node.value = this.encodedValue;
                node.addEventListener('change', updater);
            } else {
                console.error('$.FlexRenderer.UIControls.SimpleUIControl::init: HTML element with id =', this.id, 'not found! Cannot set event listener for the control.');
            }
        }
    }

    set(encodedValue) {
        this.encodedValue = encodedValue;
        this.value = this.component.normalize(this.component.decode(this.encodedValue), this.params);

        this.changed("default", this.value, this.encodedValue, this);
        this.store(this.encodedValue);
        this._needsLoad = true;
    }

    glDrawing(program, gl) {
        if (this._needsLoad) {
            // debugging purposes
            // console.debug('Setting', this.component.glUniformFunName(), 'corresponding to', this.webGLVariableName, 'to value', this.value);

            gl[this.component.glUniformFunName()](this.glLocation, this.value);
            this._needsLoad = false;
        }
    }

    glLoaded(program, gl) {
        // debugging purposes
        // console.debug(`Setting control's glLocation to ${this.webGLVariableName}`);
        this.glLocation = gl.getUniformLocation(program, this.webGLVariableName);
        this._needsLoad = true;
    }

    toHtml(classes = "", css = "") {
        if (!this.params.interactive) {
            return "";
        }
        return this.component.html(this.id, this.params, classes, css);
    }

    define() {
        return `uniform ${this.component.glType} ${this.webGLVariableName};`;
    }

    sample(value = undefined, valueGlType = 'void') {
        if (!value || valueGlType !== 'float') {
            return this.webGLVariableName;
        }
        return this.component.sample(this.webGLVariableName, value);
    }

    get uiControlType() {
        return this.component["uiType"];
    }

    get supports() {
        return this.component.defaults();
    }

    get supportsAll() {
        return {};
    }

    get raw() {
        return this.value;
    }

    get encoded() {
        return this.encodedValue;
    }

    get type() {
        return this.component.glType;
    }
};

$.FlexRenderer.UIControls.SliderWithInput = class extends $.FlexRenderer.UIControls.IControl {
    constructor(owner, name, webGLVariableName, params) {
        super(owner, name, webGLVariableName);
        this._c1 = new $.FlexRenderer.UIControls.SimpleUIControl(
            owner, name, webGLVariableName, params, $.FlexRenderer.UIControls.getUiElement('range'));
        params.title = "";
        this._c2 = new $.FlexRenderer.UIControls.SimpleUIControl(
            owner, name, webGLVariableName + "_2", params, $.FlexRenderer.UIControls.getUiElement('number'), "second-");
    }

    init() {
        const _this = this;
        this._c2._params = this._c1._params;
        this._c1.init();
        this._c2.init();
        this._c1.on("default", function(value, encoded, owner) {
            document.getElementById(_this._c2.id).value = encoded;
            _this._c2.value = value;
            _this.changed("default", value, encoded, owner);
        }, true); //silently fail if registered
        this._c2.on("default", function(value, encoded, owner) {
            document.getElementById(_this._c1.id).value = encoded;
            _this._c1.value = value;
            // Only C1 loads values to gpu, request change
            _this._c1._needsLoad = true;
            _this.changed("default", value, encoded, owner);
        }, true); //silently fail if registered
    }

    glDrawing(program, dimension, gl) {
        this._c1.glDrawing(program, dimension, gl);
    }

    glLoaded(program, gl) {
        this._c1.glLoaded(program, gl);
    }

    toHtml(classes = "", css = "") {
        if (!this._c1.params.interactive) {
            return "";
        }
        return this._c1.toHtml(classes, css + "flex: 1;") + this._c2.toHtml(classes, css);
    }

    define() {
        return this._c1.define();
    }

    sample(ratio) {
        return this._c1.sample(ratio);
    }

    get supports() {
        return this._c1.supports;
    }

    get params() {
        return this._c1.params;
    }

    get type() {
        return this._c1.type;
    }

    get raw() {
        return this._c1.raw;
    }

    get encoded() {
        return this._c1.encoded;
    }
};
$.FlexRenderer.UIControls.registerClass("range_input", $.FlexRenderer.UIControls.SliderWithInput);
})(OpenSeadragon);
