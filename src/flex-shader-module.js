(function($) {
    const VALID_TYPES = new Set([
        "void",
        "bool",
        "int",
        "float",
        "vec2",
        "vec3",
        "vec4"
    ]);

    /**
     * Registry for ShaderModule classes used by ModularShaderLayer graphs.
     */
    $.FlexRenderer.ShaderModuleMediator = class {
        /**
         * Register a ShaderModule class.
         *
         * @param {typeof ShaderModule} moduleClass - Module class to register.
         * @returns {void}
         */
        static registerModule(moduleClass) {
            if (!moduleClass || typeof moduleClass.type !== "function") {
                throw new Error("ShaderModuleMediator::registerModule: moduleClass.type() is required.");
            }

            const type = moduleClass.type();
            if (!type || typeof type !== "string") {
                throw new Error("ShaderModuleMediator::registerModule: module type must be a non-empty string.");
            }

            if (this._modules[type]) {
                $.console.warn(`ShaderModuleMediator::registerModule: ShaderModule '${type}' already registered, overwriting.`);
            }

            this._modules[type] = moduleClass;
        }

        /**
         * Return a registered ShaderModule class.
         *
         * @param {string} type - Module type.
         * @returns {typeof ShaderModule|undefined}
         */
        static getClass(type) {
            return this._modules[type];
        }

        /**
         * Return all registered ShaderModule classes.
         *
         * @returns {Function[]}
         */
        static availableModules() {
            return Object.values(this._modules);
        }

        /**
         * Return all registered ShaderModule type names.
         *
         * @returns {string[]}
         */
        static availableTypes() {
            return Object.keys(this._modules);
        }
    };

    $.FlexRenderer.ShaderModuleMediator._modules = {};

    /**
     * Small typed GLSL code-generation unit used by ModularShaderLayer graphs.
     */
    $.FlexRenderer.ShaderModule = class {
        /**
         * Create a module node instance.
         *
         * @param {string} nodeId - Node id from the graph.
         * @param {object} options - Module construction options.
         * @param {string} options.uid - Stable GLSL-safe module uid.
         * @param {ShaderLayer} options.owner - Owning ShaderLayer.
         * @param {object} options.config - Raw node config.
         */
        constructor(nodeId, options) {
            this.id = nodeId;
            this.uid = options.uid;
            this.owner = options.owner;
            this.config = options.config || {};
            this.params = this.config.params || {};
            this.inputRefs = this.config.inputs || {};
        }

        /**
         * Registered module type.
         *
         * @returns {string}
         */
        static type() {
            throw new Error("ShaderModule::type must be implemented.");
        }

        /**
         * Human-readable module name.
         *
         * @returns {string}
         */
        static name() {
            return this.type();
        }

        /**
         * Human-readable module description.
         *
         * @returns {string}
         */
        static description() {
            return "";
        }

        /**
         * Machine-readable module documentation.
         *
         * @returns {object|null}
         */
        static docs() {
            return null;
        }

        /**
         * Typed input port declarations.
         *
         * @returns {object}
         */
        static inputs() {
            return {};
        }

        /**
         * Typed output port declarations.
         *
         * @returns {object}
         */
        static outputs() {
            return {};
        }

        /**
         * Module-local control definitions.
         *
         * @returns {object}
         */
        static get defaultControls() {
            return {};
        }

        /**
         * Instance-level control definition hook.
         *
         * @returns {object}
         */
        getControlDefinitions() {
            return $.extend(true, {}, this.constructor.defaultControls);
        }

        /**
         * Instance-level input port declarations.
         *
         * @returns {object}
         */
        getInputDefinitions() {
            return this.constructor.inputs();
        }

        /**
         * Instance-level output port declarations.
         *
         * @returns {object}
         */
        getOutputDefinitions() {
            return this.constructor.outputs();
        }

        /**
         * Return source requirements introduced by this module.
         *
         * @returns {Array<{index:number, acceptsChannelCount:Function, description:string}>}
         */
        getSourceRequirements() {
            return [];
        }

        /**
         * Return a flat ShaderLayer control name for a module-local control.
         *
         * @param {string} localName - Module-local control name.
         * @returns {string}
         */
        getControlName(localName) {
            return $.FlexRenderer.sanitizeKey(`m_${this.id}_${localName}`);
        }

        /**
         * Return caller-provided params for a module-local control.
         *
         * @param {string} localName - Module-local control name.
         * @returns {*}
         */
        getControlParam(localName) {
            return this.params[localName];
        }

        /**
         * Return an instantiated UI control from the owning ShaderLayer.
         *
         * @param {string} localName - Module-local control name.
         * @returns {*}
         */
        control(localName) {
            return this.owner[this.getControlName(localName)];
        }

        /**
         * Extra GLSL definitions emitted outside the generated function body.
         *
         * @returns {string}
         */
        getFragmentShaderDefinition() {
            return "";
        }

        /**
         * Compile this module into GLSL statements.
         *
         * @param {ModuleNodeCompileContext} context - Per-node compile context.
         * @returns {{statements:string, outputs:object}}
         */
        compile(context) {
            throw new Error("ShaderModule::compile must be implemented.");
        }
    };

    /**
     * Per-node compile context passed to ShaderModule.compile(...).
     */
    class ModuleNodeCompileContext {
        constructor(graph, node, resolvedInputs) {
            this.graph = graph;
            this.node = node;
            this.resolvedInputs = resolvedInputs || {};
        }

        /**
         * Return a GLSL expression for one input port.
         *
         * @param {string} name - Input port name.
         * @param {string|undefined} fallback - Fallback expression.
         * @returns {string}
         */
        input(name, fallback = undefined) {
            const value = this.resolvedInputs[name];
            if (value && value.expr) {
                return value.expr;
            }
            if (fallback !== undefined) {
                return fallback;
            }
            throw new Error(`${this.graph.errorPrefix()}: node '${this.node.id}' missing compiled input '${name}'.`);
        }

        /**
         * Return a stable GLSL variable name for an output port.
         *
         * @param {string} name - Output port name.
         * @param {string} type - GLSL type.
         * @returns {string}
         */
        output(name, type) {
            this.graph.assertGlslType(type, `node '${this.node.id}' output '${name}'`);
            return $.FlexRenderer.sanitizeKey(`${this.graph.owner.uid}_${this.node.id}_${name}`);
        }
    }

    /**
     * Typed DAG compiler used by ModularShaderLayer.
     */
    $.FlexRenderer.ModuleGraph = class {
        /**
         * Create a module graph for one ModularShaderLayer.
         *
         * @param {ShaderLayer} owner - Owning ShaderLayer.
         * @param {object} graphConfig - Graph configuration from params.graph.
         */
        constructor(owner, graphConfig) {
            this.owner = owner;
            this.config = graphConfig || {};
            this.nodes = {};
            this.order = [];
            this.controlMap = {};
            this.controlDefinitions = {};
            this.sourceDefinitions = [];
            this._compiled = null;
        }

        /**
         * Validate and prepare the graph.
         *
         * @returns {ModuleGraph}
         */
        prepare() {
            this._validateShape();
            this._instantiateNodes();
            this._validateAndSort();
            this._collectControls();
            this._collectSources();
            return this;
        }

        /**
         * Prefix used by validation errors.
         *
         * @returns {string}
         */
        errorPrefix() {
            return `ModularShaderLayer '${this.owner.id}'`;
        }

        /**
         * Validate a GLSL type string.
         *
         * @param {string} type - Type to check.
         * @param {string} label - Error label.
         * @returns {void}
         */
        assertGlslType(type, label) {
            if (!VALID_TYPES.has(type)) {
                throw new Error(`${this.errorPrefix()}: ${label} has unsupported GLSL type '${type}'.`);
            }
        }

        /**
         * Return flat control definitions owned by graph nodes.
         *
         * @returns {object}
         */
        getControlDefinitions() {
            return $.extend(true, {}, this.controlDefinitions);
        }

        /**
         * Return caller-provided params for one flat control name.
         *
         * @param {string} flatName - Flat ShaderLayer control name.
         * @returns {*}
         */
        getControlParams(flatName) {
            const ref = this.controlMap[flatName];
            if (!ref) {
                return undefined;
            }

            const node = this.nodes[ref.nodeId];
            return node && typeof node.getControlParam === "function" ?
                node.getControlParam(ref.localName) : undefined;
        }

        /**
         * Return built-in use_* params needed by ShaderLayer.resetChannel(...).
         *
         * @returns {object}
         */
        getBuiltInParams() {
            const out = {};

            for (const flatName in this.controlMap) {
                if (!flatName.startsWith("use_")) {
                    continue;
                }

                const value = this.getControlParams(flatName);
                if (value !== undefined) {
                    out[flatName] = value;
                }
            }

            return out;
        }

        /**
         * Return graph-derived source definitions.
         *
         * @returns {channelSettings[]}
         */
        getSourceDefinitions() {
            return this.sourceDefinitions.slice();
        }

        /**
         * Return graph GLSL definitions.
         *
         * @returns {string}
         */
        getFragmentShaderDefinition() {
            return this._getCompiled().definitions;
        }

        /**
         * Return graph GLSL execution body.
         *
         * @returns {string}
         */
        getFragmentShaderExecution() {
            return this._getCompiled().execution;
        }

        _validateShape() {
            if (!this.config || typeof this.config !== "object") {
                throw new Error(`${this.errorPrefix()}: params.graph must be an object.`);
            }

            if (this.config.version !== undefined && this.config.version !== 1) {
                throw new Error(`${this.errorPrefix()}: unsupported graph version '${this.config.version}'.`);
            }

            if (!this.config.nodes || typeof this.config.nodes !== "object" || Array.isArray(this.config.nodes)) {
                throw new Error(`${this.errorPrefix()}: graph.nodes must be an object map.`);
            }

            if (!this.config.output || typeof this.config.output !== "string") {
                throw new Error(`${this.errorPrefix()}: graph.output must be a node output reference string.`);
            }
        }

        _instantiateNodes() {
            for (const nodeId of Object.keys(this.config.nodes)) {
                const sanitized = $.FlexRenderer.sanitizeKey(nodeId);
                if (sanitized !== nodeId) {
                    throw new Error(`${this.errorPrefix()}: node id '${nodeId}' is not GLSL-safe. Use '${sanitized}' or another stable id.`);
                }

                const nodeConfig = this.config.nodes[nodeId] || {};
                const moduleType = nodeConfig.type;
                const ModuleClass = $.FlexRenderer.ShaderModuleMediator.getClass(moduleType);

                if (!ModuleClass) {
                    throw new Error(`${this.errorPrefix()}: unknown module type '${moduleType}' for node '${nodeId}'.`);
                }

                this.nodes[nodeId] = new ModuleClass(nodeId, {
                    uid: $.FlexRenderer.sanitizeKey(`${this.owner.uid}_${nodeId}`),
                    owner: this.owner,
                    config: nodeConfig
                });
            }
        }

        _validateAndSort() {
            const visited = {};
            const visiting = {};
            const order = [];

            const visit = (nodeId) => {
                if (visited[nodeId]) {
                    return;
                }

                if (visiting[nodeId]) {
                    throw new Error(`${this.errorPrefix()}: graph cycle detected at node '${nodeId}'.`);
                }

                const node = this.nodes[nodeId];
                if (!node) {
                    throw new Error(`${this.errorPrefix()}: unknown node '${nodeId}'.`);
                }

                visiting[nodeId] = true;

                const inputDefs = node.getInputDefinitions();
                const inputRefs = node.inputRefs || {};

                for (const inputName of Object.keys(inputDefs)) {
                    const inputDef = inputDefs[inputName] || {};
                    this.assertGlslType(inputDef.type, `node '${nodeId}' input '${inputName}'`);

                    const ref = inputRefs[inputName];
                    if (!ref) {
                        if (inputDef.required) {
                            throw new Error(`${this.errorPrefix()}: node '${nodeId}' missing required input '${inputName}'.`);
                        }
                        continue;
                    }

                    const parsed = this._parseRef(ref, `node '${nodeId}' input '${inputName}'`);
                    const sourceNode = this.nodes[parsed.nodeId];

                    if (!sourceNode) {
                        throw new Error(`${this.errorPrefix()}: node '${nodeId}' input '${inputName}' references unknown node '${parsed.nodeId}'.`);
                    }

                    const outputDefs = sourceNode.getOutputDefinitions();
                    const outputDef = outputDefs[parsed.portName];

                    if (!outputDef) {
                        throw new Error(`${this.errorPrefix()}: node '${nodeId}' input '${inputName}' references unknown output '${ref}'.`);
                    }

                    this.assertGlslType(outputDef.type, `node '${parsed.nodeId}' output '${parsed.portName}'`);

                    if (inputDef.type !== outputDef.type) {
                        throw new Error(
                            `${this.errorPrefix()}: node '${nodeId}' input '${inputName}' expects ${inputDef.type} ` +
                            `but '${ref}' outputs ${outputDef.type}.`
                        );
                    }

                    visit(parsed.nodeId);
                }

                visiting[nodeId] = false;
                visited[nodeId] = true;
                order.push(nodeId);
            };

            for (const nodeId of Object.keys(this.nodes)) {
                visit(nodeId);
            }

            const outputRef = this._parseRef(this.config.output, "graph.output");
            const outputNode = this.nodes[outputRef.nodeId];
            if (!outputNode) {
                throw new Error(`${this.errorPrefix()}: graph.output references unknown node '${outputRef.nodeId}'.`);
            }

            const outputDef = outputNode.getOutputDefinitions()[outputRef.portName];
            if (!outputDef) {
                throw new Error(`${this.errorPrefix()}: graph.output references unknown port '${this.config.output}'.`);
            }

            if (outputDef.type !== "vec4") {
                throw new Error(`${this.errorPrefix()}: graph.output must resolve to vec4, got ${outputDef.type}.`);
            }

            this.order = order;
        }

        _collectControls() {
            this.controlDefinitions = {};
            this.controlMap = {};

            for (const nodeId of Object.keys(this.nodes)) {
                const node = this.nodes[nodeId];
                const defs = node.getControlDefinitions();

                for (const localName of Object.keys(defs)) {
                    const flatName = localName.startsWith("use_") ?
                        localName : node.getControlName(localName);

                    if (this.controlDefinitions[flatName]) {
                        if (flatName.startsWith("use_")) {
                            continue;
                        }

                        throw new Error(`${this.errorPrefix()}: duplicate module control '${flatName}'.`);
                    }

                    this.controlDefinitions[flatName] = $.extend(true, {}, defs[localName]);
                    this.controlMap[flatName] = {
                        nodeId,
                        localName
                    };
                }
            }
        }

        _collectSources() {
            const sources = [];

            for (const nodeId of Object.keys(this.nodes)) {
                const node = this.nodes[nodeId];
                const requirements = typeof node.getSourceRequirements === "function" ?
                    node.getSourceRequirements() : [];

                for (const req of requirements) {
                    const index = Math.max(0, Number.parseInt(req.index, 10) || 0);

                    sources[index] = {
                        acceptsChannelCount: req.acceptsChannelCount || (() => true),
                        description: req.description || `Modular graph source ${index}`
                    };
                }
            }

            this.sourceDefinitions = sources.map(source => source || {
                acceptsChannelCount: () => true,
                description: "Unused modular graph source slot."
            });
        }

        _getCompiled() {
            if (this._compiled) {
                return this._compiled;
            }

            const definitions = [];
            const statements = [];
            const compiledOutputs = {};

            for (const nodeId of this.order) {
                const node = this.nodes[nodeId];
                const definition = node.getFragmentShaderDefinition();

                if (definition) {
                    definitions.push(definition.trim());
                }

                const resolvedInputs = this._resolveNodeInputs(node, compiledOutputs);
                const context = new ModuleNodeCompileContext(this, node, resolvedInputs);
                const compiled = node.compile(context) || {};
                const outputDefs = node.getOutputDefinitions();
                const nodeOutputs = {};

                for (const portName of Object.keys(outputDefs)) {
                    const declared = outputDefs[portName];
                    const actual = compiled.outputs && compiled.outputs[portName];

                    if (!actual || !actual.expr) {
                        throw new Error(`${this.errorPrefix()}: node '${nodeId}' did not compile output '${portName}'.`);
                    }

                    if (actual.type !== declared.type) {
                        throw new Error(
                            `${this.errorPrefix()}: node '${nodeId}' output '${portName}' declared ${declared.type} ` +
                            `but compiled ${actual.type}.`
                        );
                    }

                    nodeOutputs[portName] = {
                        type: actual.type,
                        expr: actual.expr
                    };
                }

                if (compiled.statements) {
                    statements.push(compiled.statements.trim());
                }

                compiledOutputs[nodeId] = nodeOutputs;
            }

            const outputRef = this._parseRef(this.config.output, "graph.output");
            const output = compiledOutputs[outputRef.nodeId] && compiledOutputs[outputRef.nodeId][outputRef.portName];

            if (!output || output.type !== "vec4") {
                throw new Error(`${this.errorPrefix()}: graph.output did not compile to vec4.`);
            }

            this._compiled = {
                definitions: definitions.join("\n"),
                execution: `${statements.join("\n\n")}\n\nreturn ${output.expr};`
            };

            return this._compiled;
        }

        _resolveNodeInputs(node, compiledOutputs) {
            const resolved = {};
            const inputDefs = node.getInputDefinitions();
            const inputRefs = node.inputRefs || {};

            for (const inputName of Object.keys(inputDefs)) {
                const ref = inputRefs[inputName];
                if (!ref) {
                    continue;
                }

                const parsed = this._parseRef(ref, `node '${node.id}' input '${inputName}'`);
                const output = compiledOutputs[parsed.nodeId] && compiledOutputs[parsed.nodeId][parsed.portName];

                if (!output) {
                    throw new Error(`${this.errorPrefix()}: node '${node.id}' input '${inputName}' references output '${ref}' before it is compiled.`);
                }

                resolved[inputName] = output;
            }

            return resolved;
        }

        _parseRef(ref, label) {
            if (typeof ref !== "string") {
                throw new Error(`${this.errorPrefix()}: ${label} must be a string reference.`);
            }

            const match = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/.exec(ref);
            if (!match) {
                throw new Error(`${this.errorPrefix()}: ${label} must use 'nodeId.portName' syntax, got '${ref}'.`);
            }

            return {
                nodeId: match[1],
                portName: match[2]
            };
        }
    };
})(OpenSeadragon);
