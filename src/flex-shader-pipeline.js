(function($) {

    /**
     * One node of a ShaderLayer pipeline stage.
     *
     * @typedef {object} ShaderLayerPipelineNodeConfig
     * @property {string} id - GLSL-safe node id, unique within its stage.
     * @property {string} type - Registered ShaderModule type; must be pipeline capable
     *   (see ShaderModule.isPipelineCapable: `vec4 color -> vec4 color`).
     * @property {object} [params] - Initial values of the module's controls, keyed by local name.
     */

    /**
     * `params.pipeline` of any ShaderLayer.
     *
     * @typedef {object} ShaderLayerPipelineConfig
     * @property {boolean} [enabled=true] - Seeds the runtime on/off uniform (setPipelineEnabled).
     * @property {ShaderLayerPipelineNodeConfig[]} [pre] - Applied, in order, to every non-raw
     *   sampleChannel(...) result of the layer.
     * @property {ShaderLayerPipelineNodeConfig[]} [post] - Applied, in order, to the layer's
     *   computed color before opacity, blending and clipping.
     */

    const STAGES = ["pre", "post"];
    const ENABLED_CONTROL = "pipeline_enabled";

    /**
     * Pre/post chain of vec4 -> vec4 ShaderModules attached to one ShaderLayer.
     *
     * The pipeline is the ShaderModule system without the graph: each stage is a linear
     * chain whose nodes take and return `color`. Every node compiles into its own GLSL
     * function (so module locals never collide), and every stage into one chain function,
     *   vec4 <uid>_pipeline_pre(vec4)   (+ float/vec2/vec3 overloads for sampleChannel)
     *   vec4 <uid>_pipeline_post(vec4)
     * guarded by two bool uniforms so the whole pipeline can be switched off without a relink:
     * the persisted `pipeline_enabled` control and the transient `<uid>_pipeline_bypass`.
     *
     * Module controls are flattened onto the owning ShaderLayer as `pre_<node>_<control>` /
     * `post_<node>_<control>`; the owner builds and uploads them like its own controls.
     * Changing a value is a uniform update, adding or removing a node is a rebuild.
     *
     * Invalid nodes (bad id, duplicate id, unknown or non-vec4 module type) are reported
     * through the owner and skipped: a broken adjustment must never hide the layer.
     *
     * @memberof OpenSeadragon.FlexRenderer
     */
    class ShaderLayerPipeline {
        /**
         * @param {ShaderLayer} owner - Owning ShaderLayer; supplies uid, controls and reporting.
         * @param {ShaderLayerPipelineConfig|undefined} config - `params.pipeline`.
         * @param {ShaderLayerPipelineNodeConfig[]} [legacyPre=[]] - Nodes migrated from the legacy
         *   `use_gamma` / `use_exposure` / `use_logscale` filters, run before `config.pre`.
         */
        constructor(owner, config, legacyPre = []) {
            this.owner = owner;
            this.config = config && typeof config === "object" && !Array.isArray(config) ? config : {};
            this.enabledDefault = this.config.enabled !== false;

            /** @type {{pre: Array<{id:string, type:string, module:$.FlexRenderer.ShaderModule, legacy:boolean}>, post: Array}} */
            this.stages = { pre: [], post: [] };
            this.controlDefinitions = {};
            this.controlMap = {};

            this._addNodes("pre", legacyPre || [], true);
            this._addNodes("pre", this.config.pre, false);
            this._addNodes("post", this.config.post, false);

            if (this.hasPre() || this.hasPost()) {
                this.controlDefinitions[ENABLED_CONTROL] = {
                    default: {
                        type: "bool",
                        default: this.enabledDefault,
                        interactive: false,
                        title: "Adjustments"
                    },
                    accepts: (type) => type === "bool"
                };
            }

            this._compiled = null;
        }

        /** @returns {string[]} */
        static get STAGES() {
            return STAGES.slice();
        }

        /** Flat name of the on/off bool control. @returns {string} */
        static get ENABLED_CONTROL() {
            return ENABLED_CONTROL;
        }

        /**
         * Flat control name of a node-local control.
         * @param {"pre"|"post"} stage
         * @param {string} nodeId
         * @param {string} localName
         * @returns {string}
         */
        static controlName(stage, nodeId, localName) {
            return $.FlexRenderer.sanitizeKey(`${stage}_${nodeId}_${localName}`);
        }

        _report(code, message, extra = {}) {
            if (this.owner && typeof this.owner._report === "function") {
                this.owner._report("warn", code, message, extra);
            } else {
                $.console.warn(message, extra);
            }
        }

        _addNodes(stage, list, legacy) {
            if (list === undefined || list === null) {
                return;
            }
            if (!Array.isArray(list)) {
                this._report("pipeline-node-invalid",
                    `ShaderLayer '${this.owner.id}': params.pipeline.${stage} must be an array; ignored.`,
                    { stage });
                return;
            }

            const seen = new Set(this.stages[stage].map(n => n.id));
            list.forEach((nodeConfig, index) => {
                const where = `params.pipeline.${stage}[${index}]`;
                const skip = (why) => this._report("pipeline-node-invalid",
                    `ShaderLayer '${this.owner.id}': ${where} ${why}; the node is skipped.`,
                    { stage, index, node: nodeConfig });

                if (!nodeConfig || typeof nodeConfig !== "object" || Array.isArray(nodeConfig)) {
                    skip("must be an object {id, type, params}");
                    return;
                }
                const id = nodeConfig.id;
                let sanitized = null;
                try {
                    sanitized = typeof id === "string" ? $.FlexRenderer.sanitizeKey(id) : null;
                } catch (e) {
                    sanitized = null;
                }
                if (typeof id !== "string" || !id || sanitized !== id) {
                    skip(`has id '${id}', which is not GLSL-safe (letters, digits, single inner '_')`);
                    return;
                }
                if (seen.has(id)) {
                    skip(`repeats id '${id}' within the stage`);
                    return;
                }
                const ModuleClass = $.FlexRenderer.ShaderModuleRegistry.get(nodeConfig.type);
                if (!ModuleClass) {
                    skip(`has unknown module type '${nodeConfig.type}'`);
                    return;
                }
                if (!$.FlexRenderer.ShaderModule.isPipelineCapable(ModuleClass)) {
                    skip(`uses module '${nodeConfig.type}', which is not a vec4 color -> vec4 color transform`);
                    return;
                }
                const params = nodeConfig.params && typeof nodeConfig.params === "object" ? nodeConfig.params : {};

                let module;
                try {
                    module = new ModuleClass(id, {
                        uid: $.FlexRenderer.sanitizeKey(`${this.owner.uid}_${stage}_${id}`),
                        owner: this.owner,
                        config: { type: nodeConfig.type, params },
                        controlPrefix: stage
                    });
                } catch (e) {
                    skip(`failed to construct (${e && e.message ? e.message : e})`);
                    return;
                }

                const defs = module.getControlDefinitions() || {};
                const flatNames = {};
                for (const localName of Object.keys(defs)) {
                    if (localName.startsWith("use_") || defs[localName] === false) {
                        continue;
                    }
                    const flatName = module.getControlName(localName);
                    if (this.controlDefinitions[flatName] || flatName === ENABLED_CONTROL) {
                        skip(`control '${flatName}' collides with another pipeline control`);
                        return;
                    }
                    flatNames[flatName] = localName;
                }
                for (const [flatName, localName] of Object.entries(flatNames)) {
                    this.controlDefinitions[flatName] = $.extend(true, {}, defs[localName]);
                    this.controlMap[flatName] = { stage, nodeId: id, localName, module };
                }

                seen.add(id);
                this.stages[stage].push({ id, type: nodeConfig.type, module, legacy: !!legacy });
            });
        }

        /** @returns {boolean} whether the pre stage has at least one node */
        hasPre() {
            return this.stages.pre.length > 0;
        }

        /** @returns {boolean} whether the post stage has at least one node */
        hasPost() {
            return this.stages.post.length > 0;
        }

        /** @returns {Object<string, object>} flattened control definitions */
        getControlDefinitions() {
            return $.extend(true, {}, this.controlDefinitions);
        }

        /**
         * Caller-provided value for a flattened control (the node's `params[local]`).
         * @param {string} flatName
         * @returns {*}
         */
        getControlParams(flatName) {
            const ref = this.controlMap[flatName];
            if (!ref) {
                return undefined;
            }
            return ref.module.getControlParam(ref.localName);
        }

        /**
         * Whether a flat control name belongs to this pipeline.
         * @param {string} name
         * @returns {boolean}
         */
        ownsControl(name) {
            return Object.prototype.hasOwnProperty.call(this.controlDefinitions, name);
        }

        /**
         * Whether a cache key (control name + optional param suffix) belongs to this pipeline.
         * @param {string} key
         * @returns {boolean}
         */
        ownsCacheKey(key) {
            if (typeof key !== "string") {
                return false;
            }
            if (key === ENABLED_CONTROL || key.startsWith(ENABLED_CONTROL)) {
                return true;
            }
            if (!key.startsWith("pre_") && !key.startsWith("post_")) {
                return false;
            }
            for (const name in this.controlDefinitions) {
                if (key === name || key.startsWith(name)) {
                    return true;
                }
            }
            return false;
        }

        /**
         * Structural signature (stage, node ids and types) used to detect rebuild-worthy changes.
         * @param {ShaderLayerPipelineConfig|undefined} config
         * @returns {string}
         */
        static structureKey(config) {
            if (!config || typeof config !== "object") {
                return "";
            }
            const stage = (list) => Array.isArray(list) ?
                list.map(n => (n && typeof n === "object") ? `${n.id}:${n.type}` : "?").join(",") : "";
            return `pre[${stage(config.pre)}]post[${stage(config.post)}]`;
        }

        /** @returns {string} GLSL name of the pre chain function (overloaded for float..vec4) */
        get preFunctionName() {
            return `${this.owner.uid}_pipeline_pre`;
        }

        /**
         * @returns {string} GLSL name of the chain of migrated legacy filter nodes only (overloaded
         *   float..vec4); what ShaderLayer#filter() applies to derived values of raw samplers
         */
        get legacyFunctionName() {
            return `${this.owner.uid}_pipeline_legacy`;
        }

        /** @returns {string} GLSL name of the post chain function */
        get postFunctionName() {
            return `${this.owner.uid}_pipeline_post`;
        }

        /**
         * @returns {string} GLSL name of the transient bypass uniform (ShaderLayer#setPipelineBypass).
         *   Uploaded by the owner directly, never through a UIControl: no cache, no event.
         */
        get bypassUniformName() {
            return `${this.owner.uid}_pipeline_bypass`;
        }

        _enabledExpr() {
            const control = this.owner[ENABLED_CONTROL];
            return control && typeof control.sample === "function" ? control.sample() : "true";
        }

        _compileNode(stage, node) {
            const owner = this.owner;
            const graphStub = {
                owner,
                outputPrefix: $.FlexRenderer.sanitizeKey(`${owner.uid}_${stage}`),
                errorPrefix: () => `ShaderLayer '${owner.id}' pipeline ${stage}`,
                validateType: (type, label) => {
                    if (type !== "vec4" && !["void", "bool", "int", "float", "vec2", "vec3"].includes(type)) {
                        throw new Error(`ShaderLayer '${owner.id}' pipeline ${stage}: ${label} has unsupported value type '${type}'.`);
                    }
                }
            };
            const context = new $.FlexRenderer.ShaderModuleNodeCompileContext(graphStub, node.module, {
                color: { type: "vec4", expr: "color_in" }
            });
            const compiled = node.module.compile(context) || {};
            const output = compiled.outputs && compiled.outputs.color;
            if (!output || !output.expr || output.type !== "vec4") {
                throw new Error(`module '${node.type}' did not compile a vec4 'color' output`);
            }
            const fnName = $.FlexRenderer.sanitizeKey(`fr_pl_${owner.uid}_${stage}_${node.id}`);
            const helper = node.module.getFragmentShaderDefinition();
            const fn = `vec4 ${fnName}(vec4 color_in) {
${(compiled.statements || "").trim()}
    return ${output.expr};
}`;
            return { fnName, definition: [helper ? helper.trim() : "", fn].filter(Boolean).join("\n") };
        }

        _compileStage(stage) {
            const calls = [];
            const legacyCalls = [];
            const definitions = [];
            for (const node of this.stages[stage]) {
                try {
                    const result = this._compileNode(stage, node);
                    definitions.push(result.definition);
                    calls.push(`        c = ${result.fnName}(c);`);
                    if (node.legacy) {
                        legacyCalls.push(`        c = ${result.fnName}(c);`);
                    }
                } catch (e) {
                    this._report("pipeline-node-compile-failed",
                        `ShaderLayer '${this.owner.id}': pipeline ${stage} node '${node.id}' (${node.type}) ` +
                        `failed to compile and is skipped.`, { stage, node: node.id, error: e });
                }
            }
            return { calls, legacyCalls, definitions };
        }

        _emitChain(fn, calls, enabled, overloads) {
            let code = `vec4 ${fn}(vec4 c) {
    if (${enabled} && !${this.bypassUniformName}) {
${calls.join("\n")}
    }
    return c;
}`;
            if (overloads) {
                code += `
float ${fn}(float v) { return ${fn}(vec4(v, v, v, 1.0)).r; }
vec2 ${fn}(vec2 v) { return ${fn}(vec4(v, 0.0, 1.0)).rg; }
vec3 ${fn}(vec3 v) { return ${fn}(vec4(v, 1.0)).rgb; }`;
            }
            return code;
        }

        /** @returns {boolean} whether the pre stage carries nodes migrated from legacy filters */
        hasLegacyPre() {
            return this.stages.pre.some(node => node.legacy);
        }

        /**
         * GLSL definitions of the pipeline: per-node functions and the stage chain functions.
         * Control uniforms are NOT included; the owner emits them (getPipelineDefinition()).
         * Empty stages emit nothing.
         *
         * @returns {string}
         */
        getDefinition() {
            if (this._compiled !== null) {
                return this._compiled;
            }
            const enabled = this._enabledExpr();
            const out = [];
            if (this.hasPre() || this.hasPost()) {
                out.push(`uniform bool ${this.bypassUniformName};`);
            }

            if (this.hasPre()) {
                const pre = this._compileStage("pre");
                out.push(...pre.definitions);
                out.push(this._emitChain(this.preFunctionName, pre.calls, enabled, true));
                if (this.hasLegacyPre()) {
                    out.push(this._emitChain(this.legacyFunctionName, pre.legacyCalls, enabled, true));
                }
            }

            if (this.hasPost()) {
                const post = this._compileStage("post");
                out.push(...post.definitions);
                out.push(this._emitChain(this.postFunctionName, post.calls, enabled, false));
            }

            this._compiled = out.join("\n\n");
            return this._compiled;
        }
    }

    $.FlexRenderer.ShaderLayerPipeline = ShaderLayerPipeline;

})(OpenSeadragon);
