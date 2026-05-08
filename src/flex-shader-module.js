(function($) {
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
     * Value type supported by the ShaderModule graph validator.
     *
     * @typedef {"void"|"bool"|"int"|"float"|"vec2"|"vec3"|"vec4"} ShaderModuleValueType
     */

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
     * Input or output port declared by a ShaderModule.
     *
     * @typedef {object} ShaderModulePortDescriptor
     * @property {ShaderModuleValueType} type - Value type carried by the port.
     * @property {boolean} [required=false] - Whether an input edge is required.
     * @property {*} [default] - Optional default value or fallback descriptor.
     * @property {string} [description] - Human-readable port description.
     */

    /**
     * Source requirement declared by a ShaderModule.
     *
     * @typedef {object} ShaderModuleSourceRequirement
     * @property {number} index - Source slot index in the owning ShaderLayer.
     * @property {function(number): boolean} acceptsChannelCount - Predicate that accepts compatible source channel counts.
     * @property {string} description - Human-readable source requirement description.
     */

    /**
     * Compiled output emitted by ShaderModule#compile.
     *
     * @typedef {object} ShaderModuleCompiledOutput
     * @property {ShaderModuleValueType} type - Compiled value type.
     * @property {string} expr - Expression or variable name for the output.
     */

    /**
     * Result returned by ShaderModule#compile.
     *
     * @typedef {object} ShaderModuleCompileResult
     * @property {string} statements - Statements emitted into the generated function body.
     * @property {Object<string, ShaderModuleCompiledOutput>} outputs - Compiled outputs keyed by port name.
     */

    /**
     * Construction options passed to a ShaderModule node instance.
     *
     * @typedef {object} ShaderModuleOptions
     * @property {string} uid - Stable GLSL-safe module uid.
     * @property {ShaderLayer} owner - Owning ShaderLayer.
     * @property {object} config - Raw graph node config.
     * @property {object} [config.params] - Node-local parameter values.
     * @property {Object<string, string>} [config.inputs] - Input references keyed by input port name.
     */

    /**
     * Abstract base for typed shader modules.
     *
     * A ShaderModule is a graph node, not a renderable ShaderLayer. Concrete modules
     * declare typed ports, optional UI controls, optional helper definitions,
     * and compile-time emission logic.
     *
     * This class is not meant to be instantiated directly. Register concrete module
     * classes through ShaderModuleMediator.registerModule(...). Concrete modules may
     * extend this class or provide the same static and instance contract expected by
     * ShaderModuleMediator and ShaderModuleGraph.
     *
     * Required overrides:
     * - type()
     * - compile(context)
     *
     * Recommended overrides:
     * - inputs()
     * - outputs()
     * - docs()
     *
     * Optional overrides:
     * - name()
     * - description()
     * - defaultControls
     * - getSourceRequirements()
     * - getFragmentShaderDefinition()
     *
     * Infrastructure helpers such as getControlName(...), control(...),
     * getInputDefinitions(), and getOutputDefinitions() should normally be called
     * rather than overridden.
     *
     * @abstract
     */
    $.FlexRenderer.ShaderModule = class {
        /**
         * Create a module node instance.
         *
         * ShaderModuleGraph constructs one instance for each graph node. Module authors
         * normally read node-local values through this.params and input edge references
         * through this.inputRefs.
         *
         * @param {string} nodeId - Node id from the graph config.
         * @param {ShaderModuleOptions} options - Module construction options.
         */
        constructor(nodeId, options) {
            /**
             * Node id from the graph config.
             *
             * @type {string}
             */
            this.id = nodeId;

            /**
             * Stable GLSL-safe module uid.
             *
             * @type {string}
             */
            this.uid = options.uid;

            /**
             * Owning ShaderLayer.
             *
             * @type {ShaderLayer}
             */
            this.owner = options.owner;

            /**
             * Raw graph node config.
             *
             * @type {object}
             */
            this.config = options.config || {};

            /**
             * Node-local parameter values.
             *
             * @type {object}
             */
            this.params = this.config.params || {};

            /**
             * Input edge references keyed by input port name.
             *
             * @type {Object<string, string>}
             */
            this.inputRefs = this.config.inputs || {};
        }

        /**
         * Registered module type.
         *
         * Override: REQUIRED.
         *
         * The returned value is the stable public identifier used in graph node configs.
         * It must be unique among registered ShaderModules.
         *
         * @abstract
         * @returns {string} Unique registered module type.
         * @throws {Error} Thrown by the base implementation.
         */
        static type() {
            throw new Error("ShaderModule::type must be implemented.");
        }

        /**
         * Human-readable module name.
         *
         * Override: OPTIONAL.
         *
         * Used by documentation, schema tooling, and visual-editor module palettes.
         * When omitted, the registered module type is used as the display name.
         *
         * @returns {string} Human-readable module name.
         */
        static name() {
            return this.type();
        }

        /**
         * Human-readable module description.
         *
         * Override: RECOMMENDED.
         *
         * Used by documentation and visual-editor module palettes to explain what the
         * module does.
         *
         * @returns {string} Module description.
         */
        static description() {
            return "";
        }

        /**
         * Machine-readable module documentation.
         *
         * Override: RECOMMENDED.
         *
         * The returned object should be JSON-compatible. ShaderConfigurator may use it
         * to expose richer documentation than name, description, ports, and controls
         * provide.
         *
         * @returns {?object} Documentation descriptor, or null when the module has no extra docs.
         */
        static docs() {
            return null;
        }

        /**
         * Typed input port declarations.
         *
         * Override: RECOMMENDED for modules that consume values from other nodes.
         * Leave empty only for source, constant, or root modules with no graph inputs.
         *
         * ShaderModuleGraph uses these declarations to validate required edges, referenced
         * output ports, and GLSL type compatibility before shader compilation.
         *
         * @returns {Object<string, ShaderModulePortDescriptor>} Input port declarations keyed by port name.
         */
        static inputs() {
            return {};
        }

        /**
         * Typed output port declarations.
         *
         * Override: REQUIRED for normal value-producing modules.
         *
         * ShaderModuleGraph uses these declarations to validate graph edges and final graph
         * output type. Every declared output must be returned by compile(context).
         *
         * @returns {Object<string, ShaderModulePortDescriptor>} Output port declarations keyed by port name.
         */
        static outputs() {
            return {};
        }

        /**
         * Module-local UI control definitions.
         *
         * Override: OPTIONAL.
         *
         * Use this for node parameters that should become renderer UI controls and GLSL uniforms.
         * ShaderModuleGraph flattens these controls onto the owning ModularShaderLayer using deterministic names.
         *
         * @type {Object<string, object|boolean>}
         */
        static get defaultControls() {
            return {};
        }

        /**
         * Instance-level UI control definitions.
         *
         * Override: OPTIONAL.
         *
         * Prefer defaultControls for fixed control sets. Override this only when the
         * available controls depend on this node instance's params.
         *
         * @returns {Object<string, object|boolean>} Module-local control definitions.
         */
        getControlDefinitions() {
            return $.extend(true, {}, this.constructor.defaultControls);
        }

        /**
         * Instance-level input port declarations.
         *
         * Override: INFRASTRUCTURE. Do not override in normal modules.
         *
         * This forwards to inputs() so ShaderModuleGraph can read input declarations from a
         * module instance. Module authors should override inputs() instead.
         *
         * @returns {Object<string, ShaderModulePortDescriptor>} Input port declarations keyed by port name.
         */
        getInputDefinitions() {
            return this.constructor.inputs();
        }

        /**
         * Instance-level output port declarations.
         *
         * Override: INFRASTRUCTURE. Do not override in normal modules.
         *
         * This forwards to outputs() so ShaderModuleGraph can read output declarations from a
         * module instance. Module authors should override outputs() instead.
         *
         * @returns {Object<string, ShaderModulePortDescriptor>} Output port declarations keyed by port name.
         */
        getOutputDefinitions() {
            return this.constructor.outputs();
        }

        /**
         * Return source requirements introduced by this module.
         *
         * Override: OPTIONAL.
         *
         * Override this when the module samples one or more source textures from the
         * owning ShaderLayer. ModularShaderLayer aggregates these requirements into its
         * dynamic source definitions before source/channel setup.
         *
         * @returns {ShaderModuleSourceRequirement[]} Source requirements introduced by this module.
         */
        getSourceRequirements() {
            return [];
        }

        /**
         * Return the owning ShaderLayer's flat control name for a module-local control.
         *
         * Override: INFRASTRUCTURE. Do not override in normal modules.
         *
         * Module authors may call this when they need the generated control key, but
         * should usually use control(localName) instead.
         *
         * @param {string} localName - Module-local control name.
         * @returns {string} GLSL-safe flat control name owned by the parent ShaderLayer.
         */
        getControlName(localName) {
            return $.FlexRenderer.sanitizeKey(`m_${this.id}_${localName}`);
        }

        /**
         * Return caller-provided params for a module-local control.
         *
         * Override: OPTIONAL.
         *
         * The default implementation reads this.params[localName]. Override only when a
         * module maps a local control to a differently named or derived config value.
         *
         * @param {string} localName - Module-local control name.
         * @returns {*} Caller-provided control configuration value.
         */
        getControlParam(localName) {
            return this.params[localName];
        }

        /**
         * Return an instantiated UI control from the owning ShaderLayer.
         *
         * Override: INFRASTRUCTURE. Do not override in normal modules.
         *
         * Call this from compile(context) when generating GLSL that depends on a
         * module-local UI control.
         *
         * @param {string} localName - Module-local control name.
         * @returns {*} Instantiated UI control owned by the parent ShaderLayer.
         */
        control(localName) {
            return this.owner[this.getControlName(localName)];
        }

        /**
         * Return extra GLSL definitions emitted outside the generated function body.
         *
         * Override: OPTIONAL.
         *
         * Use this for helper functions, constants, structs, or shared GLSL declarations
         * required by compile(context). Emitted symbol names must avoid collisions with
         * other modules; include this.uid when practical.
         *
         * @returns {string} GLSL definitions, or an empty string.
         */
        getFragmentShaderDefinition() {
            return "";
        }

        /**
         * Compile this module into GLSL statements and typed output expressions.
         *
         * Override: REQUIRED.
         *
         * ShaderModuleGraph calls this after validating and resolving the node's input edges.
         * The returned outputs object must contain every port declared by outputs(), and
         * each compiled output type must match its declared GLSL type.
         *
         * Use context.input(name[, fallback]) to read a connected input expression.
         * Use context.output(name, type) to allocate a deterministic GLSL variable name
         * for an output.
         *
         * @abstract
         * @param {ShaderModuleNodeCompileContext} context - Per-node compile context.
         * @returns {ShaderModuleCompileResult} GLSL statements and typed output expressions.
         * @throws {Error} Thrown by the base implementation.
         */
        compile(context) {
            throw new Error("ShaderModule::compile must be implemented.");
        }
    };

    /**
     * Compile-time helper passed to ShaderModule#compile.
     *
     * The context exposes resolved input expressions and stable output variable
     * allocation for one module node.
     *
     * @private
     */
    class ShaderModuleNodeCompileContext {
        /**
         * Create a compile context for one module node.
         *
         * @param {ShaderModuleGraph} graph - Graph being compiled.
         * @param {ShaderModule} node - Module node being compiled.
         * @param {Object<string, ShaderModuleCompiledOutput>} resolvedInputs - Resolved inputs keyed by input port name.
         */
        constructor(graph, node, resolvedInputs) {
            /**
             * Graph being compiled.
             *
             * @private
             * @type {ShaderModuleGraph}
             */
            this.graph = graph;

            /**
             * Module node being compiled.
             *
             * @private
             * @type {ShaderModule}
             */
            this.node = node;

            /**
             * Resolved inputs keyed by input port name.
             *
             * @private
             * @type {Object<string, ShaderModuleCompiledOutput>}
             */
            this.resolvedInputs = resolvedInputs || {};
        }

        /**
         * Return a GLSL expression for one input port.
         *
         * @param {string} name - Input port name.
         * @param {string|undefined} [fallback] - Fallback expression used when the input is not connected.
         * @returns {string} GLSL expression for the input.
         * @throws {Error} Thrown when the input is missing and no fallback was provided.
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
         * Return a stable GLSL variable name for one output port.
         *
         * @param {string} name - Output port name.
         * @param {ShaderModuleValueType} type - Output type.
         * @returns {string} Stable GLSL-safe variable name.
         * @throws {Error} Thrown when type is not supported by the graph validator.
         */
        output(name, type) {
            this.graph.validateType(type, `node '${this.node.id}' output '${name}'`);
            return $.FlexRenderer.sanitizeKey(`${this.graph.owner.uid}_${this.node.id}_${name}`);
        }
    }

    /**
     * Parsed node output reference.
     *
     * @typedef {object} ShaderModuleGraphOutputRef
     * @property {string} nodeId - Referenced node id.
     * @property {string} portName - Referenced output port name.
     */

    /**
     * Node-local parameter values for one ShaderModule graph node.
     *
     * The shape is module-specific. ShaderModuleGraph does not interpret these keys as
     * graph structure; it passes the object to the module instance as
     * ShaderModule#params. Concrete modules may use this object for two kinds of
     * values:
     *
     * - static compile-time parameters, such as sourceIndex, channel, baseChannel,
     *   or mode names;
     * - initial values for module-local UI controls declared through
     *   ShaderModule.defaultControls, such as threshold or color.
     *
     * Values should be JSON-compatible because graph configs are intended to be
     * stored, exported, edited, and reloaded.
     *
     * Example for sample-channel:
     * {
     *     sourceIndex: 0,
     *     channel: "r",
     *     baseChannel: 0
     * }
     *
     * Example for threshold-mask:
     * {
     *     threshold: 0.5
     * }
     *
     * Example for colorize:
     * {
     *     color: "#fff700"
     * }
     *
     * @typedef {Object<string, *>} ShaderModuleNodeParams
     */

    /**
     * Raw config for one ShaderModule graph node.
     *
     * @typedef {object} ShaderModuleGraphNodeConfig
     * @property {string} type - Registered ShaderModule type.
     * @property {Object<string, string>} [inputs] - Input edge references keyed by input port name.
     * @property {ShaderModuleNodeParams} [params] - Node-local parameter and control values.
     */

    /**
     * Raw config for a ShaderModule DAG.
     *
     * @typedef {object} ShaderModuleGraphConfig
     * @property {Object<string, ShaderModuleGraphNodeConfig>} nodes - Graph nodes keyed by node id.
     * @property {string} output - Final output reference in nodeId.portName format.
     */

    /**
     * Mapping between a flattened ShaderLayer control name and a module-local control name.
     *
     * @typedef {object} ShaderModuleGraphControlRef
     * @property {string} nodeId - Node that owns the local control.
     * @property {string} localName - Module-local control name.
     */

    /**
     * Compiled graph output.
     *
     * @typedef {object} ShaderModuleGraphCompileResult
     * @property {string} definitions - GLSL definitions emitted outside the generated function body.
     * @property {string} execution - Statements and final return statement emitted into the generated function body.
     */

    /**
     * Typed DAG compiler used by ModularShaderLayer.
     *
     * ShaderModuleGraph validates a module graph, instantiates ShaderModule nodes, checks
     * port types, topologically sorts nodes, collects source/control declarations,
     * and emits GLSL code that can be inserted into a ShaderLayer fragment-shader
     * function body.
     *
     * This class is renderer-internal infrastructure. Module authors normally work
     * with ShaderModule and ShaderModuleNodeCompileContext, not with ShaderModuleGraph directly.
     */
    $.FlexRenderer.ShaderModuleGraph = class {
        /**
         * Create a module graph for one ModularShaderLayer.
         *
         * @param {ShaderLayer} owner - Owning ShaderLayer.
         * @param {ShaderModuleGraphConfig} graphConfig - Graph configuration from params.graph.
         */
        constructor(owner, graphConfig) {
            /**
             * Owning ShaderLayer.
             *
             * @type {ShaderLayer}
             */
            this.owner = owner;

            /**
             * Raw graph configuration.
             *
             * @type {ShaderModuleGraphConfig}
             */
            this.config = graphConfig || {};

            /**
             * Instantiated module nodes keyed by graph node id.
             *
             * @type {Object<string, ShaderModule>}
             */
            this.nodes = {};

            /**
             * Topologically sorted node ids.
             *
             * @type {string[]}
             */
            this.order = [];

            /**
             * Mapping from flattened ShaderLayer control names to module-local controls.
             *
             * @type {Object<string, ShaderModuleGraphControlRef>}
             */
            this.controlMap = {};

            /**
             * Flattened control definitions exposed to the owning ShaderLayer.
             *
             * @type {Object<string, object|boolean>}
             */
            this.controlDefinitions = {};

            /**
             * Source definitions collected from module source requirements.
             *
             * @type {ShaderModuleSourceRequirement[]}
             */
            this.sourceDefinitions = [];

            /**
             * Cached compiled graph output.
             *
             * @private
             * @type {?ShaderModuleGraphCompileResult}
             */
            this._compiled = null;
        }

        /**
         * Validate graph shape, instantiate nodes, sort the DAG, and collect exposed
         * controls and source requirements.
         *
         * Call this before asking the graph for control definitions, source definitions,
         * or generated GLSL.
         *
         * @returns {ShaderModuleGraph} This graph, for chaining.
         * @throws {Error} Thrown when the graph config is invalid.
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
         * Return the common prefix used by graph validation and compilation errors.
         *
         * @returns {string} Error message prefix identifying the owning layer.
         */
        errorPrefix() {
            return `ModularShaderLayer '${this.owner.id}'`;
        }

        /**
         * Validate that a value type is supported by the module graph compiler.
         *
         * @param {string} type - Candidate value type.
         * @param {string} label - Human-readable label used in thrown errors.
         * @returns {void}
         * @throws {Error} Thrown when type is not supported.
         */
        validateType(type, label) {
            if (!VALID_TYPES.has(type)) {
                throw new Error(`${this.errorPrefix()}: ${label} has unsupported value type '${type}'.`);
            }
        }

        /**
         * Return flattened UI control definitions exposed by graph nodes.
         *
         * @returns {Object<string, object|boolean>} Flattened control definitions keyed by ShaderLayer control name.
         */
        getControlDefinitions() {
            return $.extend(true, {}, this.controlDefinitions);
        }

        /**
         * Return caller-provided config for one flattened control name.
         *
         * @param {string} flatName - Flat ShaderLayer control name.
         * @returns {*|undefined} Control config value, if the flat name belongs to a graph node.
         */
        getControlParams(flatName) {
            const ref = this.controlMap[flatName];
            if (!ref) {
                return undefined;
            }

            const node = this.nodes[ref.nodeId];
            return node && typeof node.getControlParam === "function" ? node.getControlParam(ref.localName) : undefined;
        }

        /**
         * Return built-in use_* params contributed by graph nodes.
         *
         * These values are passed into ShaderLayer.resetChannel(...) so source/channel
         * setup can see graph-derived built-in declarations.
         *
         * @returns {object} Built-in params keyed by use_* control name.
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
         * The returned array is a shallow copy so callers cannot replace the graph's
         * internal source definition list.
         *
         * @returns {ShaderModuleSourceRequirement[]} Source definitions collected from graph nodes.
         */
        getSourceDefinitions() {
            return this.sourceDefinitions.slice();
        }

        /**
         * Return GLSL definitions emitted by graph nodes.
         *
         * This compiles the graph on first use and then returns the cached definitions.
         *
         * @returns {string} GLSL definitions emitted outside the generated function body.
         * @throws {Error} Thrown when graph compilation fails.
         */
        getFragmentShaderDefinition() {
            return this._getCompiled().definitions;
        }

        /**
         * Return GLSL definitions emitted by graph nodes.
         *
         * This compiles the graph on first use and then returns the cached definitions.
         *
         * @returns {string} GLSL definitions emitted outside the generated function body.
         * @throws {Error} Thrown when graph compilation fails.
         */
        getFragmentShaderExecution() {
            return this._getCompiled().execution;
        }

        /**
         * Validate the top-level graph config shape.
         *
         * @private
         * @returns {void}
         * @throws {Error} Thrown when params.graph, graph.nodes, or graph.output has an invalid shape.
         */
        _validateShape() {
            if (!this.config || typeof this.config !== "object") {
                throw new Error(`${this.errorPrefix()}: params.graph must be an object.`);
            }

            if (!this.config.nodes || typeof this.config.nodes !== "object" || Array.isArray(this.config.nodes)) {
                throw new Error(`${this.errorPrefix()}: graph.nodes must be an object map.`);
            }

            if (!this.config.output || typeof this.config.output !== "string") {
                throw new Error(`${this.errorPrefix()}: graph.output must be a node output reference string.`);
            }
        }

        /**
         * Instantiate ShaderModule nodes from graph node configs.
         *
         * @private
         * @returns {void}
         * @throws {Error} Thrown when a node id is not GLSL-safe or a module type is unknown.
         */
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

        /**
         * Validate graph edges, check port types, detect cycles, and compute node order.
         *
         * The final graph output must resolve to a vec4 output port.
         *
         * @private
         * @returns {void}
         * @throws {Error} Thrown when an edge, port type, cycle, or final output is invalid.
         */
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
                    this.validateType(inputDef.type, `node '${nodeId}' input '${inputName}'`);

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

                    this.validateType(outputDef.type, `node '${parsed.nodeId}' output '${parsed.portName}'`);

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

        /**
         * Collect and flatten UI control definitions from all module nodes.
         *
         * Module-local controls are renamed through ShaderModule#getControlName(...).
         * Built-in use_* declarations keep their original names.
         *
         * @private
         * @returns {void}
         * @throws {Error} Thrown when two non-built-in controls resolve to the same flat name.
         */
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

        /**
         * Collect source requirements from all module nodes.
         *
         * Missing source slots between declared indexes are filled with permissive
         * placeholder definitions so source indexes remain dense.
         *
         * @private
         * @returns {void}
         */
        _collectSources() {
            const sources = [];

            for (const nodeId of Object.keys(this.nodes)) {
                const node = this.nodes[nodeId];
                const requirements = typeof node.getSourceRequirements === "function" ? node.getSourceRequirements() : [];

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

        /**
         * Compile the prepared graph into GLSL definitions and execution code.
         *
         * Compilation is cached. The compiler walks nodes in topological order, resolves
         * input expressions, asks each ShaderModule to compile itself, validates compiled
         * outputs against declared output ports, and emits the final graph return.
         *
         * @private
         * @returns {ShaderModuleGraphCompileResult} Compiled graph definitions and execution body.
         * @throws {Error} Thrown when a module fails to compile one of its declared outputs.
         */
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
                const context = new ShaderModuleNodeCompileContext(this, node, resolvedInputs);
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

        /**
         * Resolve already compiled input expressions for one node.
         *
         * @private
         * @param {ShaderModule} node - Node whose inputs should be resolved.
         * @param {Object<string, Object<string, ShaderModuleCompiledOutput>>} compiledOutputs - Compiled outputs keyed by node id and port name.
         * @returns {Object<string, ShaderModuleCompiledOutput>} Resolved inputs keyed by input port name.
         * @throws {Error} Thrown when an input references an output that has not been compiled yet.
         */
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

        /**
         * Parse a graph edge or output reference.
         *
         * @private
         * @param {*} ref - Candidate reference value.
         * @param {string} label - Human-readable label used in thrown errors.
         * @returns {ShaderModuleGraphOutputRef} Parsed node id and port name.
         * @throws {Error} Thrown when ref is not a nodeId.portName string.
         */
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
