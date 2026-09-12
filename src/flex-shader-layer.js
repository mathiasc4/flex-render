(function($) {
    /**
     * Determines how a shader layer participates in stack composition.
     *
     * @typedef {"show" | "blend" | "clip"} ShaderLayerCompositionMode
     */

    /**
     * @typedef {object} ShaderLayerConfig
     * @property {string} id
     * @property {string} name
     * @property {string} type         equal to ShaderLayer.type(), e.g. "identity"
     * @property {number} visible      1 = use for rendering, 0 = do not use for rendering
     * @property {OpenSeadragon.TiledImage[] | number[]} tiledImages images that provide the data
     * @property {object} params          settings for the ShaderLayer
     * @property {object} cache          cache object used by the ShaderLayer's controls
     * @property {"float16"|"unorm8"} [precision] per-instance override of the first-pass color
     *      target precision, honored only while the renderer option `precision` is `"auto"`.
     *      `"float16"` demands a high-precision (RGBA16F) target even over 8-bit data — any
     *      active layer declaring it upgrades the target for the whole renderer. `"unorm8"`
     *      is the veto: this layer requires values clamped to [0,1], and forces the whole
     *      renderer back to 8-bit even when the data carries float. Under a float16 target,
     *      sampleChannel()/osd_channel() no longer guarantee values in [0,1].
     *
     * `_`-prefixed keys are never part of this config: they are ShaderLayer instance state
     * (e.g. `_controls`, populated in the constructor) and FlexRenderer.jsonReplacer strips
     * them on export, so no persisted config carries one. The published JSON Schema is
     * closed against them accordingly.
     */

    /**
     * Abstract base class for classes that implement any rendering logic and are part of the final WebGLProgram.
     *
     * @property {object} defaultControls default controls for the ShaderLayer
     * @property {object} customParams
     * @property {object} filters
     * @property {object} filterNames
     * @property {object} __globalIncludes
     *
     * @abstract
     * @memberof OpenSeadragon.FlexRenderer
     */
    class ShaderLayer {
        /**
         * @typedef channelSettings
         * @type {Object}
         * @property {Function} acceptsChannelCount
         * @property {String} description
         */

        /**
         * @param {String} id unique identifier
         * @param {Object} privateOptions
         * @param {Object} privateOptions.shaderConfig              object bind with this ShaderLayer
         * @param {WebGLImplementation} privateOptions.backend
         * @param {Object} privateOptions.cache
         * @param {Function} privateOptions.invalidate  // callback to re-render the viewport
         * @param {Function} privateOptions.rebuild     // callback to rebuild the WebGL program
         * @param {Function} privateOptions.refresh     // callback to recreate the ShaderLayer when control layout changes
         * @param {Function} privateOptions.refetch     // callback to request source/config refetch work from the owning drawer
         */
        constructor(id, privateOptions) {
            /**
             * Unique identifier of this ShaderLayer for FlexRenderer.
             *
             * @type {string}
             */
            this.id = id;

            /**
             * Unique identifier of this ShaderLayer for WebGLProgram.
             *
             * @type {string}
             */
            this.uid = this.constructor.type().replaceAll('-', '_') + '_' + id;

            if (!$.FlexRenderer.idPattern.test(this.uid)) {
                console.error(`Invalid ID for the shader: ${id} does not match to the pattern`, $.FlexRenderer.idPattern);
            }

            this.__shaderConfig = privateOptions.shaderConfig;

            this.backend = privateOptions.backend;

            this._interactive = privateOptions.interactive;
            this._controls = {};
            this._params = privateOptions.params ? privateOptions.params : {};


            this.invalidate = privateOptions.invalidate;
            this._rebuild = privateOptions.rebuild;
            this._refresh = privateOptions.refresh;
            this._refetch = privateOptions.refetch;

            // channels used for sampling data from the texture
            this.__channels = null;
            // channel offset
            this.__baseChannels = null;
            // WebGLProgram this layer's controls last resolved their uniform locations against
            this.__glProgram = null;

            /**
             * @private
             * @type {ShaderLayerCompositionMode | null}
             */
            this._compositionMode = null;

            // which blend mode is being used
            this._blendMode = null;

            // parameters used for applying filters
            this.__filterPrefix = null;
            this.__filterSuffix = null;
        }

        /**
         * Manual constructor for ShaderLayer. Kept for backward compatibility.
         */
        construct() {
            // Default init respects cached value, manual usage overrides.

            // set up the color channel(s) for texture sampling
            this.resetChannel(this._params, false, false);
            // set up the blending mode
            this.resetMode(this._params, false, false);
            // set up the filters to be applied to sampled data from the texture
            this.resetFilters(this._params, false, false);

            // build the ShaderLayer's controls
            this._buildControls();
        }

        // STATIC METHODS
        /**
         * Parses value to a float string representation with given precision (length after decimal)
         *
         * @param {number} value value to convert
         * @param {number} defaultValue default value on failure
         * @param {number} precision number of decimals
         * @return {string}
         */
        static toShaderFloatString(value, defaultValue, precision = 5) {
            if (!Number.isInteger(precision) || precision < 0 || precision > 9) {
                precision = 5;
            }

            try {
                return value.toFixed(precision);
            } catch (e) {
                return defaultValue.toFixed(precision);
            }
        }

        // METHODS TO (re)IMPLEMENT WHEN EXTENDING
        /**
         * @returns {string} - Key under which the shader is registered, should be unique.
         */
        static type() {
            throw "ShaderLayer::type() must be implemented!";
        }

        /**
         * @returns {string} - A user-friendly name for the ShaderLayer type.
         */
        static name() {
            throw "ShaderLayer::name() must be implemented!";
        }

        /**
         * @returns {string} - An optional technical description for the ShaderLayer.
         */
        static description() {
            return "This ShaderLayer has no description.";
        }

        /**
         * Whether this ShaderLayer type can correctly render float data that is NOT clamped
         * to [0,1] — negatives, values above 1, quantitative units.
         *
         * This is a VETO, not a request. Precision is a property of the data, not of the
         * shader: the same layer is used over an 8-bit brightfield slide and over a 16-bit
         * float plane, so it cannot know in advance what it will be pointed at. The renderer
         * upgrades the first-pass color target when the *data* declares float precision (see
         * FlexRendererOptions.precision), and a layer returning false forces the whole
         * renderer back to 8-bit unorm.
         *
         * Return false only if the layer's math genuinely assumes a [0,1] input — a LUT index,
         * a normalized threshold with no rescale. Most layers never need to override this:
         * unorm sources stay clamped to [0,1] under a float target anyway (the first pass
         * clamps them), so only a layer actually fed float data sees any difference.
         *
         * @returns {boolean}
         */
        static supportsHighPrecision() {
            return true;
        }

        /**
         * Whether this ShaderLayer type reads host-supplied pointer state — the
         * `fr_interaction_*` GLSL helpers backed by `FlexRenderer#getInteractionState()`.
         *
         * This is a REQUIREMENT ON THE HOST, not a veto like `supportsHighPrecision()`:
         * nothing inside the renderer changes because of it. A layer returning true still
         * compiles and draws with forwarding off — it simply renders its inactive branch
         * (the fisheye lens never opens, the debug overlay stays transparent), which reads
         * as "the shader is broken" to a user who cannot know the state was never supplied.
         *
         * Hosts read it off the registered class, before constructing anything:
         *
         *     const Klass = OpenSeadragon.FlexRenderer.ShaderLayerRegistry.get(type);
         *     if (Klass.requiresInteraction()) {
         *         drawer.setInteractionEnabled(true);
         *     }
         *
         * Forwarding is off by default because every changed pointer move triggers a redraw,
         * so a host wants it enabled only while such a layer is actually visible.
         *
         * NOT to be confused with a UI control's `interactive` flag, which says whether that
         * control is user-editable/shown; this static is about pointer state reaching the GLSL
         * and says nothing about controls. Nor with the `FlexDrawer` option
         * `interaction: {enabled: ...}`, which is the host-side switch this static asks about.
         *
         * Return true whenever the generated GLSL calls any `fr_interaction_*` helper.
         *
         * @returns {boolean}
         */
        static requiresInteraction() {
            return false;
        }

        /**
         * Optional machine-readable documentation descriptor.
         *
         * External shader registrations can override this as either:
         *  - static docs() { return {...}; }
         *  - static docs = {...}
         *
         * @returns {object | null}
         */
        static docs() {
            return null;
        }

        /**
         * One-line guidance: when should a caller pick this shader?
         *
         * `description()` is technical (what the shader does); `intent()` is "when to use it".
         * Read by hosts (e.g. xOpat scripting / LLM driven layer construction) when picking
         * a shader for a given dataset. Keep it generic — no use-case-specific recipes.
         *
         * Override per ShaderLayer; the default returns `undefined`, in which case hosts treat
         * "no info" as a safe fallback.
         *
         * @returns {string | undefined}
         */
        static intent() {
            return undefined;
        }

        /**
         * Data-shape hints. Tells the host whether this shader is appropriate for the
         * source the user has loaded. Hosts match the returned `expects` against source
         * metadata (e.g. channel count) to filter candidate shaders.
         *
         * Shape:
         * {
         *   dataKind: "scalar" | "multi-channel" | "rgb" | "mask" | "any",
         *   channels?: number | "any",   // expected source channel count
         *   requiresThreshold?: boolean  // true when behavior depends on threshold breaks
         * }
         *
         * Override per ShaderLayer; the default returns `undefined`.
         *
         * @returns {{dataKind?: string, channels?: number|string, requiresThreshold?: boolean} | undefined}
         */
        static expects() {
            return undefined;
        }

        /**
         * A minimal valid `params` object for a fresh layer of this shader. Hosts use it
         * when building a "create from scratch" template so they don't have to invent
         * values. Keep small — only controls that need a non-default value to render
         * something sensible. If the shader declares `controlCouplings`, the returned
         * object MUST satisfy them (it doubles as the canonical example).
         *
         * Override per ShaderLayer; the default returns `undefined`.
         *
         * @returns {object | undefined}
         */
        static exampleParams() {
            return undefined;
        }

        /**
         * Declares relationships between controls that must hold true on every committed
         * layer. Hosts use the returned entries for two purposes:
         *  (a) tell the LLM the rule in plain English so it can construct compliant layers,
         *  (b) validate submitted layers and reject violations with structured errors.
         *
         * Each entry:
         * {
         *   name: string,                                  // stable id, e.g. "colormap_class_count"
         *   summary: string,                               // human-readable rule, shown to the LLM
         *   controls: string[],                            // control keys involved
         *   validate: (layer) => {                         // pure, fast, side-effect-free
         *     ok: boolean,
         *     expected?: Record<string, any>,              // what the coupling requires
         *     actual?: Record<string, any>                 // what the layer currently has
         *   }
         * }
         *
         * The `validate` function is exposed at runtime via
         * `ShaderConfigurator.getShaderCouplingValidators(shaderType)`; the schema model
         * only ships `{name, summary, controls}` (JSON-serializable).
         *
         * Override per shader when controls are coupled; the default returns `undefined`.
         * Returning `[]` is also accepted ("declared, but no couplings").
         *
         * @returns {Array<{name: string, summary: string, controls: string[], validate: Function}> | undefined}
         */
        static controlCouplings() {
            return undefined;
        }

        /**
         * Declare the object for channel settings. One for each data source (NOT USED, ALWAYS RETURNS ARRAY OF ONE OBJECT; for backward compatibility the array is returned)
         * @returns {channelSettings[]}
         */
        static sources() {
            throw "ShaderLayer::sources() must be implemented!";
        }

        /**
         * Declare supported controls by a particular shader,
         * each control defined this way is automatically created for the shader.
         *
         * Structure:
         * get defaultControls () => {
         *     controlName: {
                   default: {type: <>, title: <>, default: <>, interactive: true|false, ...},
                   accepts: (type, instance) => <>,
                   required: {type: <>, ...} [OPTIONAL]
         *     }, ...
         * }
         *
         * Repeated control arrays are also supported:
         * get defaultControls () => {
         *     items: {
         *         array: {
         *             count: (layer) => <number>,
         *             name: (index, layer, baseName) => <controlName>,   // OPTIONAL
         *             item: (index, layer, baseName) => ({
         *                 default: {...},
         *                 accepts: (type, instance) => <>
         *             })
         *         }
         *     }
         * }
         *
         * use: controlId: false to disable a specific control (e.g. all shaders
         *  support opacity by default - use to remove this feature)
         *
         *
         * Additionally, use_[...] value can be specified, such controls enable shader
         * to specify default or required values for built-in use_[...] params. Example:
         * {
         *     use_channel0: {
         *         default: "bg"
         *     },
         *     use_channel1: {
         *         required: "rg"
         *     },
         *     use_gamma: {
         *         default: 0.5
         *     },
         * }
         * reads by default for texture 1 channels 'bg', second texture is always forced to read 'rg',
         * textures apply gamma filter with 0.5 by default if not overridden
         * todo: allow also custom object without structure being specified (use in custom manner,
         *  but limited in automated docs --> require field that summarises its usage)
         *
         * @member {object}
         */
        static get defaultControls() {
            return {
                opacity: {
                    default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity: "},
                    accepts: (type, instance) => type === "float"
                }
            };
        }

        /**
         * @typedef {Object} NormalizationContext
         * @property {function} [expandDataSourceRef] - function that maps synthetic source references to real references usable by openseadragon
         */

        /**
         * Modification of the configuration object before it is used.
         * @param {ShaderLayerConfig} config
         * @param {NormalizationContext} context
         * @returns {ShaderLayerConfig}
         */
        static normalizeConfig(config, context = {}) {
            return config;
        }

        /**
         * Read a wrapper shader's own setting (`channelRenderer`, `series`, ...) out of a config.
         *
         * `params` is the only accepted placement, matching the published JSON Schema, which
         * compiles these into the `params` sub-schema and closes every layer object with
         * `additionalProperties: false`. This used to fall back to a top-level `config[name]`, so a
         * config written that way rendered correctly and failed validation -- and because no `oneOf`
         * branch then matched, one misplaced key was reported as one error per registered shader
         * type. Legacy top-level keys are lifted into `params` by hoistWrapperParams(), called from
         * each wrapper's normalizeConfig(), so nothing reaches here needing a fallback.
         *
         * @param {ShaderLayerConfig} config
         * @param {string} name setting name, as declared in the shader's static customParams
         * @param {*} [fallback] returned when params does not carry the key
         * @returns {*}
         */
        static readWrapperParam(config, name, fallback = undefined) {
            const params = (config && config.params) || {};
            return params[name] !== undefined ? params[name] : fallback;
        }

        /**
         * Move legacy top-level wrapper settings into `params` and delete the originals.
         *
         * Deleting is the point, not a tidy-up: a retained top-level key is rejected by the
         * published schema's `additionalProperties: false`, so a normalized config could not be
         * round-tripped through it, and a hoisted-but-retained key can drift from its `params` twin
         * with no way to tell which one the renderer used. Nothing strips these on export --
         * jsonReplacer only drops `_`-prefixed keys.
         *
         * @param {ShaderLayerConfig} config mutated in place
         * @param {string[]} names setting names to lift
         * @returns {ShaderLayerConfig} the same config
         */
        static hoistWrapperParams(config, names) {
            if (!config || typeof config !== "object") {
                return config;
            }
            const params = config.params || (config.params = {});
            const type = typeof this.type === "function" ? this.type() : "shader";
            const id = config.id || "<unnamed>";

            for (const name of names || []) {
                if (config[name] === undefined) {
                    continue;
                }

                if (params[name] === undefined) {
                    params[name] = config[name];
                    $.console.warn(`ShaderLayer '${id}' (${type}): top-level '${name}' is ` +
                        `deprecated and has been moved to params.${name}. Wrapper settings belong ` +
                        `under 'params' -- the published schema is params-only and rejects the ` +
                        `top-level form.`);
                } else {
                    $.console.warn(`ShaderLayer '${id}' (${type}): '${name}' is given both at the ` +
                        `top level and under params. params.${name} is used; the top-level copy is ` +
                        `ignored and removed.`);
                }

                delete config[name];
            }

            return config;
        }

        /**
         * Instance-level control definition hook.
         * Override when the available controls depend on current config/state.
         * @returns {object}
         */
        getControlDefinitions() {
            return $.extend(true, {}, this.constructor.defaultControls);
        }

        /**
         * Code executed to create the output color. The code
         * must always return a vec4 value, otherwise the program
         * will fail to compile (this code actually runs inside a glsl vec4 function() {...here...}).
         *
         * DO NOT SAMPLE TEXTURE MANUALLY: use this.sampleChannel(...) to generate the sampling code
         *
         * @return {string}
         */
        getFragmentShaderExecution() {
            throw "ShaderLayer::getFragmentShaderExecution must be implemented!";
        }

        /**
         * Code placed outside fragment shader's main function.
         * By default, it includes all definitions of controls defined in this.defaultControls.
         *
         * ANY VARIABLE NAME USED IN THIS FUNCTION MUST CONTAIN UNIQUE ID: this.uid
         * DO NOT SAMPLE TEXTURE MANUALLY: use this.sampleChannel(...) to generate the sampling code
         * WHEN OVERRIDING, INCLUDE THE OUTPUT OF THIS METHOD AT THE BEGINNING OF THE NEW OUTPUT.
         *
         * @return {string} glsl code
         */
        getFragmentShaderDefinition() {
            const glsl = [];

            for (const controlName in this._controls) {
                let code = this[controlName].define();
                if (code) {
                    // trim removes whitespace from beggining and the end of the string
                    glsl.push(code.trim());
                }
            }
            return glsl.join("\n    ");
        }

        /**
         * Initialize the ShaderLayer's controls.
         */
        init() {
            for (const controlName in this._controls) {
                const control = this[controlName];
                control.init();
            }
        }

        // CONTROLs LOGIC
        /**
         * Build the ShaderLayer's controls.
         */
        _buildControls() {
            const defaultControls = this.getControlDefinitions();

            // add opacity control manually to every ShaderLayer; if not already defined
            if (defaultControls.opacity === undefined || (typeof defaultControls.opacity === "object" && !defaultControls.opacity.accepts("float"))) {
                defaultControls.opacity = {
                    default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity"},
                    accepts: (type, instance) => type === "float"
                };
            }

            const expandedControls = this._expandControlDefinitions(defaultControls);

            for (let controlName in expandedControls) {
                // with use_ prefix are defined not UI controls but filters, blend modes, etc.
                if (controlName.startsWith("use_")) {
                    continue;
                }

                // control is manually disabled
                const controlConfig = expandedControls[controlName];
                if (controlConfig === false) {
                    continue;
                }

                const control = $.FlexRenderer.UIControls.build(this, controlName, controlConfig, this.id + '_' + controlName, this._params[controlName]);

                // UIControls._buildFallback returns undefined when neither the requested nor the
                // declared type could be built. Storing that made every later `this[controlName]`
                // dereference a TypeError -- getFragmentShaderDefinition(), init(), htmlControls(),
                // glLoaded() and glDrawing() all index _controls unguarded, and only the first runs
                // inside a caller's try/catch. An absent control is handled everywhere, because
                // every consumer iterates `for (name in this._controls)`.
                if (!control) {
                    const requestedType = this._params[controlName] && this._params[controlName].type;
                    $.console.error(`ShaderLayer '${this.id}' (${this.constructor.type()}): control ` +
                        `'${controlName}'${requestedType ? ` of type '${requestedType}'` : ""} could not ` +
                        `be built and is omitted. GLSL referencing it will fail to assemble.`);
                    continue;
                }

                // enables iterating over the owned controls
                this._controls[controlName] = control;
                // simplify usage of controls (e.g. this.opacity instead of this._controls.opacity)
                this[controlName] = control;
            }

            this._warnOnUndeclaredParams(expandedControls);
        }

        /**
         * Report `params` keys that no control declares.
         *
         * `_buildControls` iterates the *declared* controls and reads `this._params[name]`, so a
         * key nobody declares (`params.classifier` on `colormap`, `params.color` on `threshold`,
         * which declares `fg_color`) is dead config: no control, no GLSL, and previously no
         * warning either. The published JSON Schema already sets `additionalProperties: false`,
         * so the key is known to be invalid -- it was simply never said out loud, and the mistake
         * surfaced much later as an unexplained render result.
         *
         * Keys are reported, never deleted: dropping them is `FlexRenderer._sanitizeShaderParams`'s
         * job on shader-type-change paths, where the previous type's keys are genuinely orphaned.
         *
         * The accepted set is the same one the published schema is compiled from -- built-ins
         * (every `use_*` key: per-source channels, mode, blend, filters), UI controls, and the
         * shader's `customParams` (see Configurator's `checkExampleParamsConsistency`).
         *
         * @param {Object} expandedControls control definitions after array expansion
         * @private
         */
        _warnOnUndeclaredParams(expandedControls) {
            if (!this._params || typeof this._params !== "object") {
                return;
            }

            const customParams = this.constructor.customParams || {};
            const declared = Object.keys(expandedControls).concat(Object.keys(customParams));
            const undeclared = Object.keys(this._params).filter(
                key => !key.startsWith("use_") &&
                    expandedControls[key] === undefined &&
                    customParams[key] === undefined
            );

            if (!undeclared.length) {
                return;
            }

            $.console.warn(`ShaderLayer '${this.id}' (${this.constructor.type()}): params ` +
                `${undeclared.map(k => `'${k}'`).join(", ")} declared by no control or custom ` +
                `param, and therefore ignored. Accepted here: ${declared.join(", ")}, ` +
                `plus any use_* built-in.`);
        }

        _expandControlDefinitions(controlDefinitions) {
            const expanded = {};

            for (const [baseName, controlConfig] of Object.entries(controlDefinitions || {})) {
                if (!controlConfig || typeof controlConfig !== "object" || !controlConfig.array) {
                    expanded[baseName] = controlConfig;
                    continue;
                }

                const arrayConfig = controlConfig.array;
                const countValue = typeof arrayConfig.count === "function" ?
                    arrayConfig.count(this, baseName) :
                    arrayConfig.count;
                const count = Math.max(0, Number.parseInt(countValue, 10) || 0);

                for (let index = 0; index < count; index++) {
                    const itemConfig = typeof arrayConfig.item === "function" ?
                        arrayConfig.item(index, this, baseName) :
                        $.extend(true, {}, arrayConfig.item || {});

                    if (!itemConfig || itemConfig === false) {
                        continue;
                    }

                    const expandedName = itemConfig.name || (
                        typeof arrayConfig.name === "function" ?
                            arrayConfig.name(index, this, baseName) :
                            `${baseName}${index}`
                    );

                    if (!expandedName) {
                        continue;
                    }

                    if (itemConfig.name !== undefined) {
                        delete itemConfig.name;
                    }

                    expanded[expandedName] = itemConfig;
                }
            }

            return expanded;
        }

        /**
         * Get HTML code of the ShaderLayer's controls.
         * @returns {String} HTML code
         */
        htmlControls(wrapper = null, classes = "", css = "") {
            let controlsHtmls = [];
            for (const controlName in this._controls) {
                const control = this[controlName];
                controlsHtmls.push(control.toHtml(classes, css));
            }
            if (wrapper) {
                controlsHtmls = controlsHtmls.map(wrapper);
            }
            return controlsHtmls.join("");
        }

        /**
         * Remove all ShaderLayer's controls.
         */
        removeControls() {
            for (const controlName in this._controls) {
                this.removeControl(controlName);
            }
        }

        /**
         * @param {String} controlName name of the control to remove
         */
        removeControl(controlName) {
            if (!this._controls[controlName]) {
                return;
            }
            delete this._controls[controlName];
            delete this[controlName];
        }

        // GLSL LOGIC (getFragmentShaderDefinition and getFragmentShaderExecution could also have been placed in this section)
        /**
         * Called from the the WebGLImplementation's loadProgram function.
         * For every control owned by this ShaderLayer connect control.glLocation attribute to it's corresponding glsl variable.
         * @param {WebGLProgram} program
         * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
         */
        glLoaded(program, gl) {
            this.__glProgram = program;
            for (const controlName in this._controls) {
                this[controlName].glLoaded(program, gl);
            }
        }

        /**
         * Called from the the WebGLImplementation's useProgram function.
         * For every control owned by this ShaderLayer fill it's corresponding glsl variable.
         * @param {WebGLProgram} program WebglProgram instance
         * @param {WebGLRenderingContext|WebGL2RenderingContext} gl WebGL Context
         */
        glDrawing(program, gl) {
            // A control's cached uniform location belongs to the program it was resolved against,
            // and registerProgram() deletes and recreates the WebGLProgram without clearing those
            // caches. The signal that says "re-resolve" is `requiresLoad`, a one-shot flag whose
            // obligation is discharged by whatever render array happened to run first -- so a
            // shader absent from that array, or a caller that drops useProgram()'s return value,
            // would upload through a location belonging to a deleted program and raise
            // INVALID_OPERATION. Comparing the program itself is cheap and cannot go stale.
            if (this.__glProgram !== program) {
                this.glLoaded(program, gl);
            }
            for (const controlName in this._controls) {
                this[controlName].glDrawing(program, gl);
            }
        }

        /**
         * Include GLSL shader code on global scope (e.g. define function that is repeatedly used).
         * @param {String} key a key under which is the code stored
         * @param {String} code GLSL code to add to the WebGL shader
         */
        includeGlobalCode(key, code) {
            const container = this.constructor.__globalIncludes;
            if (container[key]) {
                if (container[key] === code) {
                    return;
                }
                console.warn('$.FlexRenderer.ShaderLayer::includeGlobalCode: Global code with key', key, 'already exists in this.__globalIncludes. Overwriting the content!');
            }
            container[key] = code;
        }

        /**
         * Called when shader is destructed
         */
        destroy() {
        }

        /**
         * Proxy cache to the config object. The config object stores the cached values, which keeps consistent state.
         * @return {Object}
         */
        get cache() {
            return this.__shaderConfig.cache;
        }

        // CACHE LOGIC
        /**
         * Load value from the cache, return default value if not found.
         *
         * @param {String} name
         * @param {String} defaultValue
         * @return {String}
         */
        loadProperty(name, defaultValue) {
            const value = this.cache[name];
            return value !== undefined ? value : defaultValue;
        }

        /**
         * Store value in the cache.
         * @param {String} name
         * @param {String} value
         */
        storeProperty(name, value) {
            this.cache[name] = value;
        }

        // TEXTURE SAMPLING LOGIC
        /**
         * Set color channel(s) for texture sampling.
         * @param {Object} options
         * @param {String} options.use_channel[X] "r", "g" or "b" channel to sample index X, default "r"
         * @param {boolean} [force=true] when false, cached values are prioritized
         */
        resetChannel(options = {}, force = true, evented = true) {
            if (Object.keys(options) === 0) {
                options = this._params;
            }

            // regex to compare with value used with use_channel, to check its correctness
            const channelPattern = new RegExp('[rgba]{1,4}');
            this.__channels = [];
            this.__baseChannels = [];

            const parseChannel = (def, sourceDef, index) => {
                const controlName = `use_channel${index}`;
                const predefined = this.constructor.defaultControls[controlName];
                const baseName = `use_channel_base${index}`;
                const predefinedBase = this.constructor.defaultControls[baseName];

                let base = 0;
                let channel;

                // 1) read raw channel value from options or predefined
                if (options[controlName] || predefined) {
                    channel = predefined && predefined.required;
                    if (!channel) {
                        channel = force ? options[controlName] :
                            this.loadProperty(controlName, options[controlName] || predefined.default);
                    }
                }

                // 2) parse inline "N:pattern" syntax if used
                if (typeof channel === "string") {
                    const m = channel.match(/^(\d+):(.*)$/);
                    if (m) {
                        base = parseInt(m[1], 10) || 0;
                        channel = m[2];
                    }
                }

                // 3) explicit base override via use_channel_baseX
                if (options[baseName] || predefinedBase) {
                    base = predefinedBase && predefinedBase.required;
                    if (!base) {
                        base = force ? options[baseName] :
                            this.loadProperty(baseName, options[baseName] || predefinedBase.default);
                    }
                    base = parseInt(base, 10);
                }

                if (Number.isNaN(base) || base < 0) {
                    base = 0;
                }

                if (channel === undefined) {
                    channel = def;
                }

                // 4) validate / normalize channel pattern as before
                if (!channel || typeof channel !== "string" || channelPattern.exec(channel) === null) {
                    console.warn(`Invalid channel '${controlName}'. Will use channel '${def}'.`, channel, options);
                    this.storeProperty(controlName, def);
                    channel = predefined && predefined.default ? predefined.default : def;
                }

                if (!sourceDef.acceptsChannelCount(channel.length)) {
                    console.warn(`${this.constructor.name()} does not support channel length ${channel.length} for channel: ${channel}. Using default.`);
                    this.storeProperty(controlName, def);
                    channel = predefined && predefined.default ? predefined.default : def;

                    if (!sourceDef.acceptsChannelCount(channel.length)) {
                        channel = def;
                        console.warn(`${this.constructor.name()} does not support channel length ${channel.length} for channel: ${channel}. Using default.`);
                        while (channel.length < 5 && !sourceDef.acceptsChannelCount(channel.length)) {
                            channel += def;
                        }
                        this.storeProperty(controlName, channel);
                    }
                }

                if (channel !== options[controlName]) {
                    this.storeProperty(controlName, channel);
                }

                this.__channels[index] = channel;
                this.__baseChannels[index] = base;
            };

            const sources = this.constructor.sources();
            for (let i = 0; i < sources.length; i++) {
                parseChannel("r", sources[i], i);
            }

            if (evented) {
                this.backend.renderer.notifyVisualizationChanged({
                    reason: "channel-change",
                    shaderId: this.id,
                    shaderType: this.constructor.type()
                });
            }
        }

        /**
         * Unified texture sampling helper.
         *
         * Usage:
         *   sampleChannel("v_texCoord")                      // sourceIndex=0, baseChannel=0
         *   sampleChannel("v_texCoord", 1)                   // sourceIndex=1, baseChannel=0
         *   sampleChannel("v_texCoord", { baseChannel: 4 })  // sourceIndex=0, baseChannel=4
         *   sampleChannel("v_texCoord", { baseChannel: "my_uniform" })  // sourceIndex=0, runtime GLSL expression
         *   sampleChannel("v_texCoord", 0, { baseChannel: 8, raw: true })
         *
         * Returns GLSL:
         *   float, vec2, vec3, or vec4 depending on use_channel pattern.
         */
        sampleChannel(textureCoords, sourceIndexOrOptions = 0, maybeOptions = undefined) {
            let sourceIndex = 0;
            let raw = false;

            let opt = null;

            if (typeof sourceIndexOrOptions === "object") {
                // sampleChannel(uv, { ... })
                opt = sourceIndexOrOptions || {};
                sourceIndex = opt.sourceIndex || 0;
            } else {
                // sampleChannel(uv, sourceIndex, maybeOptions/raw)
                sourceIndex = sourceIndexOrOptions || 0;

                if (typeof maybeOptions === "object") {
                    opt = maybeOptions || {};
                } else if (typeof maybeOptions === "boolean") {
                    raw = maybeOptions;
                }
            }

            // Default baseChannel from resetChannel
            let baseChannel = this.getDefaultChannelBase(sourceIndex);

            // Override from options if provided
            if (opt) {
                if (typeof opt.baseChannel === "number" || typeof opt.baseChannel === "string") {
                    baseChannel = opt.baseChannel;
                }
                if (opt.raw != null) { // eslint-disable-line eqeqeq
                    raw = !!opt.raw;
                }
            }

            const chanPattern = this.__channels[sourceIndex] || "r";
            const glslExpr = this._buildChannelSampleExpr(sourceIndex, textureCoords, baseChannel, chanPattern);

            return raw ? glslExpr : this.filter(glslExpr);
        }

        /**
         * Get number of channels for a given sourceIndex.
         * @param sourceIndex
         * @return {number|*|number}
         */
        getSourceChannelCount(sourceIndex = 0) {
            const cfg = this.getConfig() || {};
            if (!cfg.tiledImages || cfg.tiledImages.length <= sourceIndex) {
                return 4;
            }
            const worldIndex = cfg.tiledImages[sourceIndex];
            const drawer = this.backend.renderer.drawer;
            if (!drawer || worldIndex == null) {  // eslint-disable-line eqeqeq
                return 4;
            }
            return drawer.getChannelCount(worldIndex);
        }

        /**
         * Get how many components one texture-array layer of a source carries: 4 for
         * RGBA8/RGBA16F, 2 for RG16F, 1 for R16F. Channel N of a source therefore lives in
         * pack N / componentsPerPack, not N / 4.
         * @param {number} sourceIndex
         * @return {number}
         */
        getSourceComponentsPerPack(sourceIndex = 0) {
            const cfg = this.getConfig() || {};
            if (!cfg.tiledImages || cfg.tiledImages.length <= sourceIndex) {
                return 4;
            }
            const worldIndex = cfg.tiledImages[sourceIndex];
            const drawer = this.backend.renderer.drawer;
            if (!drawer || worldIndex == null || typeof drawer.getComponentsPerPack !== "function") {  // eslint-disable-line eqeqeq
                return 4;
            }
            return drawer.getComponentsPerPack(worldIndex);
        }

        /**
         * Resolve the tiled image used by a given shader source slot.
         * @param {number} sourceIndex
         * @return {OpenSeadragon.TiledImage|null}
         */
        getSourceTiledImage(sourceIndex = 0) {
            const cfg = this.getConfig() || {};
            if (!cfg.tiledImages || cfg.tiledImages.length <= sourceIndex) {
                return null;
            }

            const worldIndex = cfg.tiledImages[sourceIndex];
            const drawer = this.backend.renderer.drawer;
            const world = drawer && drawer.viewer ? drawer.viewer.world : null;
            if (!world || worldIndex == null) {  // eslint-disable-line eqeqeq
                return null;
            }

            return world.getItemAt(worldIndex) || null;
        }

        /**
         * Get pack count for a given sourceIndex.
         * @param {number} sourceIndex
         * @return {number}
         */
        getSourcePackCount(sourceIndex = 0) {
            const cfg = this.getConfig() || {};
            if (!cfg.tiledImages || cfg.tiledImages.length <= sourceIndex) {
                return 1;
            }
            const worldIndex = cfg.tiledImages[sourceIndex];
            const drawer = this.backend.renderer.drawer;
            if (!drawer || worldIndex == null) {  // eslint-disable-line eqeqeq
                return 1;
            }
            return drawer.getPackCount(worldIndex);
        }

        /**
         * Get source dimensions when available from the tile source metadata.
         * @param {number} sourceIndex
         * @return {{width:number, height:number}}
         */
        getSourceDimensions(sourceIndex = 0) {
            const tiledImage = this.getSourceTiledImage(sourceIndex);
            const source = tiledImage && tiledImage.source;
            const dimensions = source && source.dimensions;

            return {
                width: dimensions && typeof dimensions.x === "number" ? dimensions.x : (source && source.width) || 0,
                height: dimensions && typeof dimensions.y === "number" ? dimensions.y : (source && source.height) || 0,
            };
        }

        /**
         * Get source level metadata.
         * @param {number} sourceIndex
         * @return {{minLevel:number, maxLevel:number, levelCount:number}}
         */
        getSourceLevels(sourceIndex = 0) {
            const tiledImage = this.getSourceTiledImage(sourceIndex);
            const source = tiledImage && tiledImage.source;
            const minLevel = Number.isInteger(source && source.minLevel) ? source.minLevel : 0;
            const maxLevel = Number.isInteger(source && source.maxLevel) ? source.maxLevel : minLevel;

            return {
                minLevel,
                maxLevel,
                levelCount: Math.max(0, maxLevel - minLevel + 1),
            };
        }

        /**
         * Get source metadata object from the tile source when available.
         * @param {number} sourceIndex
         * @return {object|null}
         */
        getSourceMetadata(sourceIndex = 0) {
            const tiledImage = this.getSourceTiledImage(sourceIndex);
            const source = tiledImage && tiledImage.source;
            if (!source) {
                return null;
            }

            if (typeof source.getMetadata === "function") {
                return source.getMetadata();
            }
            return source;
        }

        /**
         * Get consolidated source information for the given source slot.
         * metadataReady becomes true after the drawer has observed tile payload metadata
         * for this source, which matters for gpuTextureSet inputs where channel/pack counts
         * are only known after data arrives.
         *
         * @param {number} sourceIndex
         * @return {{
         *   tiledImage: OpenSeadragon.TiledImage|null,
         *   metadata: object|null,
         *   metadataReady: boolean,
         *   channelCount: number,
         *   packCount: number,
         *   dimensions: {width:number, height:number},
         *   minLevel: number,
         *   maxLevel: number,
         *   levelCount: number
         * }}
         */
        getSourceInfo(sourceIndex = 0) {
            const tiledImage = this.getSourceTiledImage(sourceIndex);
            const levels = this.getSourceLevels(sourceIndex);

            return {
                tiledImage,
                metadata: this.getSourceMetadata(sourceIndex),
                metadataReady: !!(tiledImage && tiledImage.__flexMetadataReady),
                channelCount: this.getSourceChannelCount(sourceIndex),
                packCount: this.getSourcePackCount(sourceIndex),
                dimensions: this.getSourceDimensions(sourceIndex),
                minLevel: levels.minLevel,
                maxLevel: levels.maxLevel,
                levelCount: levels.levelCount,
            };
        }

        /**
         * Get the default channel base offset for a given sourceIndex.
         * @param sourceIndex
         * @return {number} channel offset, usually 0, read from use_channel_baseX controls
         */
        getDefaultChannelBase(sourceIndex = 0) {
            let baseChannel = this.__baseChannels[sourceIndex];
            if (typeof baseChannel !== "number") {
                baseChannel = 0;
            }
            return baseChannel;
        }

        /**
         * Get how many logical channels the configured swizzle consumes for a source.
         * @param {number} sourceIndex
         * @return {number}
         */
        getConfiguredChannelWidth(sourceIndex = 0) {
            const pattern = this.__channels[sourceIndex];
            return typeof pattern === "string" && pattern.length > 0 ? pattern.length : 1;
        }

        /**
         *
         * @param otherDataIndex
         * @return {never}
         */
        getTextureSize(otherDataIndex = 0) {
            return this.backend.getTextureSize(otherDataIndex);
        }

        // BLENDING LOGIC
        /**
         * Set blending mode.
         * @param {Object} options
         * @param {String} options.use_mode rendering mode to use: one of supportedUseModes
         * @param {String} options.use_blend blending mode to use: one of standard supported blending modes (+ "mask")
         * @param {boolean} [force=true] when false, cached values are prioritized
         */
        resetMode(options = {}, force = true, evented = true) {
            this._compositionMode = this._resetOption("use_mode", this.backend.supportedUseModes, options, force);
            this._blendMode = this._resetOption("use_blend", OpenSeadragon.FlexRenderer.SUPPORTED_BLEND_MODES, options, force);

            if (evented) {
                this.backend.renderer.notifyVisualizationChanged({
                    reason: "mode-change",
                    shaderId: this.id,
                    shaderType: this.constructor.type(),
                    mode: this._compositionMode,
                    blend: this._blendMode
                });
            }
        }

        /**
         * Build GLSL that samples the requested components.
         * @param {number} sourceIndex   index into config.tiledImages
         * @param {string} uv            GLSL vec2 identifier
         * @param {number} baseChannel   first flattened channel index to use
         * @param {string} pattern       e.g. "r", "rg", "rgba", "bgra"
         */
        _buildChannelSampleExpr(sourceIndex, uv, baseChannel, pattern) {
            // pattern is relative channel order, we must convert "rgba" to offsets 0,1,2,3
            const offsets = [];
            for (const ch of pattern) {
                let off;
                if (ch === "r") {
                    off = 0;
                } else if (ch === "g") {
                    off = 1;
                } else if (ch === "b") {
                    off = 2;
                } else if (ch === "a") {
                    off = 3;
                } else {
                    continue;
                } // or warn
                offsets.push(off);
            }
            if (offsets.length === 0) {
                offsets.push(0);
            }

            // If this is the common simple case (baseChannel==0, contiguous, canonical "xyz"):
            // The swizzle reads components of pack 0 directly, so it is only valid while the
            // requested width fits inside one pack AND inside the source. A "rg" swizzle over an
            // R16F source would otherwise read the 0 that texture-format conversion supplies for
            // the missing green, silently and without a GL error.
            const componentsPerPack = this.getSourceComponentsPerPack(sourceIndex);
            const channelCount = this.getSourceChannelCount(sourceIndex);

            // `acceptsChannelCount` validates the swizzle width, not what the source actually
            // carries, so pointing a 4-channel layer at a 1-channel source is accepted in
            // silence and renders the format fill. The out-of-range guard in osd_channel makes
            // that zeroes rather than garbage, but the author still gets no other signal.
            if (typeof baseChannel === "number" &&
                    this.getSourceTiledImage(sourceIndex) &&
                    (this.getSourceTiledImage(sourceIndex).__flexMetadataReady) &&
                    baseChannel + offsets.length > channelCount) {
                this.__channelWidthWarned = this.__channelWidthWarned || {};
                if (!this.__channelWidthWarned[sourceIndex]) {
                    this.__channelWidthWarned[sourceIndex] = true;
                    let typeName;
                    try {
                        typeName = this.constructor.type();
                    } catch (e) {
                        typeName = this.constructor.name;
                    }
                    $.console.warn(
                        `FlexRenderer: shader '${typeName}' reads channels ` +
                        `${baseChannel}..${baseChannel + offsets.length - 1} of source ${sourceIndex}, ` +
                        `which carries only ${channelCount}. Out-of-range channels read 0.`
                    );
                }
            }
            const contiguous =
                typeof baseChannel === "number" &&
                baseChannel === 0 &&
                offsets.length <= 4 &&
                offsets.length <= componentsPerPack &&
                offsets.length <= channelCount &&
                offsets.every((o, i) => o === i);

            if (contiguous) {
                // Use the old fast path: osd_texture + swizzle
                return `${this.backend.sampleTexture(sourceIndex, uv)}.${pattern}`;
            }

            // TODO: we should call here API of the underlying engine to get sampling method, not hardcoding it here!
            //       we should also rely on osd_channel_pack instead of calling X times osd_channel
            const baseExpr = typeof baseChannel === "string" ? `(${baseChannel})` : `${baseChannel}`;
            const comps = offsets.map(off => {
                const channelExpr = off === 0 ? baseExpr : `((${baseExpr}) + ${off})`;
                return `osd_channel(${sourceIndex}, ${channelExpr}, ${uv})`;
            });

            if (comps.length === 1) {
                return comps[0];
            }
            if (comps.length === 2) {
                return `vec2(${comps.join(", ")})`;
            }
            if (comps.length === 3) {
                return `vec3(${comps.join(", ")})`;
            }
            // 4 or more → vec4, extra components ignored
            return `vec4(${comps.slice(0, 4).join(", ")})`;
        }

        _resetOption(name, supportedValueList, options = {}, force = true) {
            let result;
            if (!options) {
                options = this._params;
            }

            const predefined = this.constructor.defaultControls[name];
            // if required, set mode to required
            result = predefined && predefined.required;

            if (!result) {
                let dynamicValue = options[name];
                if (name === "use_mode") {
                    // Supporting legacy names
                    if (dynamicValue === "mask") {
                        dynamicValue = "blend";
                        $.console.warn("OpenSeadragon.FlexRenderer.ShaderLayer: use_mode 'mask' is deprecated, use 'blend' instead.");
                    }
                    if (dynamicValue === "mask_clip") {
                        dynamicValue = "clip";
                        $.console.warn("OpenSeadragon.FlexRenderer.ShaderLayer: use_mode 'mask_clip' is deprecated, use 'clip' instead.");
                    }
                }

                if (dynamicValue) {
                    // firstly try to load from cache, if not in cache, use options.use_mode
                    result = force ? dynamicValue : this.loadProperty(name, dynamicValue);

                    // if mode was not in the cache and we got default value = options.use_mode, store it in the cache
                    if (result === dynamicValue) {
                        this.storeProperty(name, result);
                    }
                } else {
                    result = (predefined && predefined.default) || supportedValueList[0];
                }
            }

            if (!supportedValueList.includes(result)) {
                $.console.warn(`Invalid ${name}: ${result}. Using default`, supportedValueList[0]);
                return supportedValueList[0];
            }
            return result;
        }

        /**
         * @returns {String} GLSL code of the custom blend function
         * TODO configurable...
         */
        getCustomBlendFunction(functionName) {
            let code = this.backend.getBlendingFunction(this._blendMode);
            if (!code) {
                $.console.warn("Invalid blending - using default", this._blendMode, this);
                // Set to mask, typical wanted value if mode is not show. If mode=show, there is a hardcoded blend function.
                this._blendMode = 'mask';
                code = this.backend.getBlendingFunction(this._blendMode);
            }
            return `vec4 ${functionName}(vec4 fg, vec4 bg) {
${code}
}`;
        }

        /**
         * Get JSON configuration
         * @return {ShaderLayerConfig}
         */
        getConfig() {
            return this.__shaderConfig;
        }

        /**
         * Request a config mutation that may require drawer/world level re-fetch or shader refresh.
         * The drawer owns how this request is fulfilled.
         * @param {Function|Object} mutation function(config, shaderLayer) or plain patch object
         * @param {Object} options
         * @return {*}
         */
        requestConfigMutation(mutation, options = {}) {
            if (typeof this._refetch !== "function") {
                return undefined;
            }

            let apply = mutation;
            if (mutation && typeof mutation === "object" && typeof mutation !== "function") {
                apply = (config) => Object.assign(config, mutation);
            }

            return this._refetch({
                kind: "shader-config-mutation",
                shaderId: this.id,
                shaderType: this.constructor.type(),
                mutation: apply,
                ...options
            });
        }

        /**
         * Request source rebinding for one shader source slot.
         * The entry can be a direct world index or any opaque descriptor
         * resolved later by the owning drawer/application.
         * @param {number} sourceIndex
         * @param {*} entry
         * @param {Object} options
         * @return {*}
         */
        requestSourceBinding(sourceIndex, entry, options = {}) {
            if (typeof this._refetch !== "function") {
                return undefined;
            }

            return this._refetch({
                kind: "shader-source-request",
                shaderId: this.id,
                shaderType: this.constructor.type(),
                sourceIndex,
                entry,
                ...options
            });
        }

        // FILTERS LOGIC
        /**
         * Set filters for a ShaderLayer.
         * @param {Object} options contains filters to apply, currently supported are "use_gamma", "use_exposure", "use_logscale"
         * @param {boolean} [force=true] when false, cached values are prioritized
         */
        resetFilters(options = {}, force = true, evented = true) {
            if (Object.keys(options) === 0) {
                options = this._params;
            }

            this.__filterPrefix = [];
            this.__filterSuffix = [];
            for (let key in this.constructor.filters) {
                const predefined = this.constructor.defaultControls[key];
                let value = predefined ? predefined.required : undefined;
                if (value === undefined) {
                    if (options[key]) {
                        value = force ? options[key] : this.loadProperty(key, options[key]);
                    } else {
                        value = predefined ? predefined.default : undefined;
                    }
                }

                if (value !== undefined) {
                    let filter = this.constructor.filters[key](value);
                    this.__filterPrefix.push(filter[0]);
                    this.__filterSuffix.push(filter[1]);
                }
            }
            this.__filterPrefix = this.__filterPrefix.join("");
            this.__filterSuffix = this.__filterSuffix.reverse().join("");

            if (evented) {
                this.backend.renderer.notifyVisualizationChanged({
                    reason: "filter-change",
                    shaderId: this.id,
                    shaderType: this.constructor.type()
                });
            }
        }

        /**
         * Apply global filters on value
         * @param {String} value GLSL code string, value to filter
         * @return {String} filtered value (GLSL oneliner without ';')
         */
        filter(value) {
            return `${this.__filterPrefix}${value}${this.__filterSuffix}`;
        }

        /**
         * Set filter value
         * @param filter filter name
         * @param value value of the filter
         */
        setFilterValue(filter, value) {
            if (!this.constructor.filterNames[filter]) {
                console.error("Invalid filter name", filter);
                return;
            }
            this.storeProperty(filter, value);
        }

        /**
         * Get the filter value (alias for loadProperty(...)
         * @param {String} filter filter to read the value of
         * @param {String} defaultValue
         * @return {String} stored filter value or defaultValue if no value available
         */
        getFilterValue(filter, defaultValue) {
            return this.loadProperty(filter, defaultValue);
        }


        // UTILITIES
        /**
         * Evaluates option flag, e.g. any value that indicates boolean 'true'
         * @param {*} value value to interpret
         * @return {Boolean} true if the value is considered boolean 'true'
         */
        isFlag(value) {
            return value === "1" || value === true || value === "true";
        }

        isFlagOrMissing(value) {
            return value === undefined || this.isFlag(value);
        }

        /**
         * Parses value to a float string representation with given precision (length after decimal)
         * @param {Number} value value to convert
         * @param {Number} defaultValue default value on failure
         * @param {Number} precisionLen number of decimals
         * @return {String}
         */
        toShaderFloatString(value, defaultValue, precisionLen = 5) {
            return this.constructor.toShaderFloatString(value, defaultValue, precisionLen);
        }

        /**
         * Get the blend mode.
         * @return {String}
         */
        get mode() {
            return this._compositionMode;
        }
    }

    /**
     * Declare custom parameters for documentation purposes.
     * Can set default values to provide sensible defaults.
     * Requires only 'usage' parameter describing the use.
     * Unlike controls, these values are not processed in any way.
     * Of course you don't have to define your custom parameters,
     * but then these won't be documented in any nice way. Note that
     * the value can be an object, or a different value (e.g., an array)
     * {
     *     customParamId: {
     *         default: {myItem: 1, myValue: "string" ...}, [OPTIONAL]
     *         usage: "This parameter can be used like this and that.",
     *         required: {type: <> ...} [OPTIONAL]
     *     }, ...
     * }
     * @type {any}
     */
    ShaderLayer.customParams = {};

    /**
     * Parameter to save shaderLayer's functionality that can be shared and reused between ShaderLayer instantions.
     */
    ShaderLayer.__globalIncludes = {};


    //not really modular
    //add your filters here if you want... function that takes parameter (number)
    //and returns prefix and suffix to compute oneliner filter
    //should start as 'use_[name]' for namespace collision avoidance (params object)
    //expression should be wrapped in parenthesses for safety: ["(....(", ")....)"] in the middle the
    // filtered variable will be inserted, notice pow does not need inner brackets since its an argument...
    //note: pow avoided in gamma, not usable on vectors, we use pow(x, y) === exp(y*log(x))
    // TODO: implement filters as shader nodes instead!
    ShaderLayer.filters = {};
    ShaderLayer.filters["use_gamma"] = (x) => ["exp(log(", `) / ${ShaderLayer.toShaderFloatString(x, 1)})`];
    ShaderLayer.filters["use_exposure"] = (x) => ["(1.0 - exp(-(", `)* ${ShaderLayer.toShaderFloatString(x, 1)}))`];
    ShaderLayer.filters["use_logscale"] = (x) => {
        x = ShaderLayer.toShaderFloatString(x, 1);
        return [`((log(${x} + (`, `)) - log(${x})) / (log(${x}+1.0)-log(${x})))`];
    };

    ShaderLayer.filterNames = {};
    ShaderLayer.filterNames["use_gamma"] = "Gamma";
    ShaderLayer.filterNames["use_exposure"] = "Exposure";
    ShaderLayer.filterNames["use_logscale"] = "Logarithmic scale";


    $.FlexRenderer.ShaderLayer = ShaderLayer;


    /**
     * A registry of ShaderLayers.
     *
     * @property {boolean} _acceptsShaderLayers - Whether the mediator allows new ShaderLayer registrations.
     * @property {Record<string, ShaderLayer>} _ShaderLayers - Registered ShaderLayers keyed by their type() output, { ShaderLayer.type(): ShaderLayer }.
     *
     * @memberof OpenSeadragon.FlexRenderer
     */
    class ShaderLayerRegistry {
        /**
         * Enable or disable ShaderLayer registrations.
         *
         * @param {boolean} accepts
         */
        static setAcceptsRegistrations(accepts) {
            if (accepts === true || accepts === false) {
                this._acceptsShaderLayers = accepts;
            } else {
                console.warn("OpenSeadragon.FlexRenderer.ShaderLayerRegistry::setAcceptsRegistrations: accepts parameter must be either true or false!");
            }
        }

        /**
         * Registers a ShaderLayer.
         *
         * @param {typeof ShaderLayer} ShaderLayerClass - The ShaderLayer to be registered.
         */
        static register(ShaderLayerClass) {
            if (this._acceptsShaderLayers) {
                if (this._ShaderLayers[ShaderLayerClass.type()]) {
                    console.warn(`OpenSeadragon.FlexRenderer.ShaderLayerRegistry::register: ShaderLayer ${ShaderLayerClass.type()} already registered, overwriting the content!`);
                }

                // Removed in favour of the data-driven negotiation (static supportsHighPrecision()
                // + FlexRendererOptions.precision). An unknown static is simply never called, so
                // without this the old opt-in fails silently.
                if (typeof ShaderLayerClass.requiresHighPrecision === "function") {
                    console.warn(`OpenSeadragon.FlexRenderer.ShaderLayerRegistry::register: ShaderLayer ${ShaderLayerClass.type()} defines the removed static requiresHighPrecision(); it is ignored. Precision is now declared by the data (see FlexRendererOptions.precision); use static supportsHighPrecision() to veto, or config precision: "float16" to demand.`);
                }

                this._ShaderLayers[ShaderLayerClass.type()] = ShaderLayerClass;
            } else {
                console.warn("OpenSeadragon.FlexRenderer.ShaderLayerRegistry::register: ShaderLayerRegistry is set to not accept new ShaderLayers!");
            }
        }

        /**
         * Gets the specified ShaderLayer.
         *
         * @param {string} shaderLayerType - The output of type() of the desired ShaderLayer.
         * @returns {typeof ShaderLayer}
         */
        static get(shaderLayerType) {
            return this._ShaderLayers[shaderLayerType];
        }

        /**
         * Gets all available ShaderLayer types.
         *
         * @returns {string[]}
         */
        static availableTypes() {
            return Object.keys(this._ShaderLayers);
        }

        /**
         * Gets all available ShaderLayers.
         *
         * @returns {(typeof ShaderLayer)[]}
         */
        static availableShaderLayers() {
            return Object.values(this._ShaderLayers);
        }
    }

    /**
     * Whether the mediator allows new ShaderLayer registrations.
     *
     * @type {boolean}
     * @private
     */
    ShaderLayerRegistry._acceptsShaderLayers = true;

    /**
     * Registered ShaderLayers keyed by their type() output, { ShaderLayer.type(): ShaderLayer }.
     *
     * @type {Record<string, (typeof ShaderLayer)>}
     * @private
     */
    ShaderLayerRegistry._ShaderLayers = {};


    $.FlexRenderer.ShaderLayerRegistry = ShaderLayerRegistry;

})(OpenSeadragon);
