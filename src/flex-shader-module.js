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
     * @property {number[]} [sampledChannels] - Zero-based logical channel indexes sampled from the source.
     * @property {number} [requiredChannelCount=0] - Minimum logical channel count required by sampledChannels.
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
     * Structured diagnostic emitted by ShaderModuleGraphAnalyzer.
     *
     * @typedef {object} ShaderModuleGraphDiagnostic
     * @property {"error"|"warning"|"info"} severity - Diagnostic severity.
     * @property {string} code - Stable machine-readable diagnostic code.
     * @property {string} message - Human-readable diagnostic message.
     * @property {Array<string|number>} path - JSON-style path inside params.graph.
     * @property {string} [nodeId] - Related graph node id, when applicable.
     * @property {string} [portName] - Related port name, when applicable.
     * @property {string} [ref] - Related graph reference string, when applicable.
     * @property {object} [details] - Additional JSON-compatible diagnostic data.
     */

    /**
     * Non-throwing graph analysis result.
     *
     * The partial payload is intended for editor/debug UI and is JSON-compatible.
     * Runtime ShaderModule instances, owner references, functions, and renderer state
     * are intentionally omitted from this object.
     *
     * @typedef {object} ShaderModuleGraphAnalysisResult
     * @property {boolean} ok - True when no error-severity diagnostics were emitted.
     * @property {ShaderModuleGraphDiagnostic[]} diagnostics - Structured diagnostics.
     * @property {object} partial - Partial graph state useful for editor/debug UI.
     * @property {Object<string, ShaderModuleGraphNodeDescriptor>} partial.nodes - JSON-compatible descriptors for valid reachable nodes.
     * @property {Object<string, object>} partial.nodeAnalyses - JSON-compatible per-node analysis data for reachable nodes.
     * @property {string[]} partial.order - Best-effort topological order for reachable nodes.
     * @property {string[]} partial.reachableNodeIds - Node ids reachable from graph.output.
     * @property {string[]} partial.unreachableNodeIds - Node ids ignored because they are not reachable from graph.output.
     * @property {Object<string, object|boolean>} partial.controlDefinitions - JSON-compatible flattened control descriptors collected from reachable nodes.
     * @property {Object<string, ShaderModuleGraphControlRef>} partial.controlMap - Flattened control ownership map for reachable nodes.
     * @property {Object[]} partial.sourceDefinitions - JSON-compatible merged source descriptors collected from reachable nodes.
     * @property {?ShaderModuleGraphOutputRef} partial.outputRef - Parsed graph output reference, when valid.
     */

    /**
     * Analysis result returned by ShaderModule#analyze(...).
     *
     * @typedef {object} ShaderModuleAnalysisResult
     * @property {Object<string, ShaderModulePortDescriptor>} inputDefinitions - Input port declarations.
     * @property {Object<string, ShaderModulePortDescriptor>} outputDefinitions - Output port declarations.
     * @property {Object<string, object|boolean>} controlDefinitions - Module-local control declarations.
     * @property {ShaderModuleSourceRequirement[]} sourceRequirements - Source requirements introduced by the module.
     */

    /**
     * Construction options passed to a ShaderModule node instance.
     *
     * Runtime ShaderModule construction is intentionally permissive for minor node
     * config shape issues. Malformed config.params and config.inputs may be passed
     * through as-is or fall back through the module constructor's defaulting behavior.
     * Editor-facing callers should use ShaderModuleGraphAnalyzer.analyze(...) before
     * committing draft graph configs when they need structured diagnostics for
     * malformed params, malformed inputs, or unknown input keys.
     *
     * @typedef {object} ShaderModuleOptions
     * @property {string} uid - Stable GLSL-safe module uid.
     * @property {ShaderLayer} owner - Owning ShaderLayer.
     * @property {object} config - Raw graph node config.
     * @property {object} [config.params] - Node-local parameter values. ShaderModuleGraphAnalyzer reports malformed values; runtime building remains permissive.
     * @property {Object<string, string>} [config.inputs] - Input references keyed by input port name. ShaderModuleGraphAnalyzer reports malformed values and unknown keys; runtime building remains permissive.
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
     * ShaderModuleMediator, ShaderModuleGraphAnalyzer, ShaderModuleGraphBuilder, and
     * the runtime ShaderModuleGraph compiler.
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
         * ShaderModuleGraphAnalyzer and ShaderModuleGraphBuilder construct module
         * instances for reachable graph nodes. Module authors normally read node-local
         * values through this.params and input edge references through this.inputRefs.
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
         * ShaderModuleGraphAnalyzer and ShaderModuleGraphBuilder use these declarations
         * to validate required edges, referenced output ports, and GLSL type compatibility.
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
         * ShaderModuleGraphAnalyzer and ShaderModuleGraphBuilder use these declarations
         * to validate graph edges and the final graph output type. Every declared output
         * must be returned by compile(context).
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
         * Use this for node parameters that should become renderer UI controls and GLSL
         * uniforms. ShaderModuleGraphAnalyzer and ShaderModuleGraphBuilder flatten these
         * controls onto the owning ModularShaderLayer using deterministic names.
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
         * This forwards to inputs() so graph analysis, building, and compilation can read
         * input declarations from a module instance. Module authors should override
         * inputs() instead.
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
         * This forwards to outputs() so graph analysis, building, and compilation can read
         * output declarations from a module instance. Module authors should override
         * outputs() instead.
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
         * Analyze this module instance without compiling GLSL.
         *
         * The default implementation derives analysis metadata from the existing module
         * declaration hooks. Modules with parameter-dependent outputs or source
         * requirements should override this method and report parameter diagnostics
         * through the supplied context instead of throwing.
         *
         * This method participates in the editor-facing analyzer path. That path is
         * intentionally stricter than runtime building: it reports malformed node
         * params/inputs and unknown input keys as diagnostics. Runtime building remains
         * more permissive and only follows declared input ports on reachable nodes.
         *
         * @param {ShaderModuleAnalysisContext} context - Per-node analysis context.
         * @returns {ShaderModuleAnalysisResult} Non-throwing module analysis data.
         */
        analyze(context) { // eslint-disable-line no-unused-vars
            return {
                inputDefinitions: this.getInputDefinitions(),
                outputDefinitions: this.getOutputDefinitions(),
                controlDefinitions: this.getControlDefinitions(),
                sourceRequirements: this.getSourceRequirements()
            };
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
         * The runtime ShaderModuleGraph compiler calls this after ShaderModuleGraphBuilder
         * validates and resolves the node's input edges. The returned outputs object must
         * contain every port declared by outputs(), and each compiled output type must
         * match its declared GLSL type.
         *
         * Use context.input(name[, fallback]) to read a connected input expression.
         * Use context.output(name, type) to allocate a deterministic GLSL variable name
         * for an output. Source-sampling modules should use context.sampleSourceChannel(...)
         * or context.sampleSourceChannels(...) instead of legacy ShaderLayer.sampleChannel(...).
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


        /**
         * Return a GLSL expression that samples one numeric source channel.
         *
         * @param {number|string} sourceIndex - Source slot index or GLSL int expression.
         * @param {number|string} channelIndex - Flattened source channel index or GLSL int expression.
         * @param {string} [textureCoords="v_texture_coords"] - GLSL vec2 coordinate expression.
         * @param {object|boolean} [options={raw:true}] - Sampling options.
         * @returns {string} GLSL expression returning float.
         */
        sampleSourceChannel(sourceIndex, channelIndex, textureCoords = "v_texture_coords", options = { raw: true }) {
            return this.node.owner.sampleSourceChannel(textureCoords, sourceIndex, channelIndex, options);
        }

        /**
         * Return a GLSL expression that samples one to four numeric source channels.
         *
         * @param {number|string} sourceIndex - Source slot index or GLSL int expression.
         * @param {Array<number|string>} channelIndexes - Flattened source channel indexes.
         * @param {string} [textureCoords="v_texture_coords"] - GLSL vec2 coordinate expression.
         * @param {object|boolean} [options={raw:true}] - Sampling options.
         * @returns {string} GLSL expression returning float, vec2, vec3, or vec4.
         */
        sampleSourceChannels(sourceIndex, channelIndexes, textureCoords = "v_texture_coords", options = { raw: true }) {
            return this.node.owner.sampleSourceChannels(textureCoords, sourceIndex, channelIndexes, options);
        }
    }

    /**
     * Analysis helper passed to ShaderModule#analyze(...).
     *
     * Modules should use this context to report invalid intermediate state without
     * throwing. The analyzer includes these diagnostics in its final result. This
     * context is editor-facing and does not expose a runtime ShaderModuleGraph.
     *
     * @private
     */
    class ShaderModuleAnalysisContext {
        /**
         * Create a module analysis context.
         *
         * @param {object} state - Analyzer-local graph state.
         * @param {ShaderModule} node - Module node being analyzed.
         * @param {ShaderModuleGraphDiagnostic[]} diagnostics - Shared diagnostic target array.
         */
        constructor(state, node, diagnostics) {
            /**
             * Analyzer-local graph state.
             *
             * @private
             * @type {object}
             */
            this.state = state;

            /**
             * Owner used for this analysis pass.
             *
             * @type {ShaderLayer|object}
             */
            this.owner = state.owner;

            /**
             * Draft graph config being analyzed.
             *
             * @type {ShaderModuleGraphConfig}
             */
            this.config = state.config;

            /**
             * Module node being analyzed.
             *
             * @type {ShaderModule}
             */
            this.node = node;

            /**
             * Shared diagnostic target array.
             *
             * @private
             * @type {ShaderModuleGraphDiagnostic[]}
             */
            this.diagnostics = diagnostics;
        }

        /**
         * Return a path below this graph node.
         *
         * @param {...(string|number)} parts - Additional path parts.
         * @returns {Array<string|number>} JSON-style path.
         */
        path(...parts) {
            return ["nodes", this.node.id].concat(parts);
        }

        /**
         * Return a path below this graph node's params object.
         *
         * @param {...(string|number)} parts - Additional path parts.
         * @returns {Array<string|number>} JSON-style path.
         */
        paramPath(...parts) {
            return this.path("params", ...parts);
        }

        /**
         * Add a diagnostic for this module.
         *
         * @param {object} diagnostic - Diagnostic fields.
         * @returns {ShaderModuleGraphDiagnostic} Added diagnostic.
         */
        diagnostic(diagnostic) {
            return addGraphDiagnostic(this.diagnostics, {
                nodeId: this.node.id,
                ...diagnostic
            });
        }

        /**
         * Add an error diagnostic for this module.
         *
         * @param {object} diagnostic - Diagnostic fields.
         * @returns {ShaderModuleGraphDiagnostic} Added diagnostic.
         */
        error(diagnostic) {
            return this.diagnostic({
                severity: "error",
                ...diagnostic
            });
        }

        /**
         * Add a warning diagnostic for this module.
         *
         * @param {object} diagnostic - Diagnostic fields.
         * @returns {ShaderModuleGraphDiagnostic} Added diagnostic.
         */
        warning(diagnostic) {
            return this.diagnostic({
                severity: "warning",
                ...diagnostic
            });
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
     * The shape is module-specific. Graph analysis and runtime building do not interpret
     * these keys as graph structure; they pass the object to the module instance as
     * ShaderModule#params. Concrete modules may use this object for two kinds of values:
     *
     * - static compile-time parameters, such as sourceIndex, channelIndex, channelIndexes, or mode names;
     * - initial values for module-local UI controls declared through ShaderModule.defaultControls, such as threshold or color.
     *
     * Values should be JSON-compatible because graph configs are intended to be
     * stored, exported, edited, and reloaded.
     *
     * Example for sample-source-channel:
     * {
     *     sourceIndex: 0,
     *     channelIndex: 0
     * }
     *
     * Example for sample-source-channels:
     * {
     *     sourceIndex: 0,
     *     channelIndexes: [0, 1, 2]
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
     * ShaderModuleGraphAnalyzer.analyze(...) treats this shape as editor-facing schema
     * and reports malformed inputs, malformed params, and unknown input keys as
     * structured diagnostics. Runtime building is more permissive: only reachable
     * nodes are instantiated and unknown extra input keys are ignored because only
     * declared input ports are followed.
     *
     * @typedef {object} ShaderModuleGraphNodeConfig
     * @property {string} type - Registered ShaderModule type.
     * @property {Object<string, string>} [inputs] - Input edge references keyed by input port name.
     * Analyzer diagnostics require this to be an object map; runtime building ignores unknown keys.
     * @property {ShaderModuleNodeParams} [params] - Node-local parameter and control values.
     * Analyzer diagnostics require this to be an object; runtime building remains permissive.
     */

    /**
     * JSON-compatible descriptor for one analyzed graph node.
     *
     * This is the editor/debug representation used by ShaderModuleGraphAnalysisResult.
     * It intentionally does not expose the live ShaderModule instance, owner reference,
     * methods, controls, or renderer state.
     *
     * @typedef {object} ShaderModuleGraphNodeDescriptor
     * @property {string} id - Graph node id.
     * @property {string} type - Registered ShaderModule type from the node config.
     * @property {Object<string, string>} inputs - JSON-compatible input reference map.
     * @property {ShaderModuleNodeParams} params - JSON-compatible node-local params object.
     */

    /**
     * Raw config for a ShaderModule DAG.
     *
     * The executable graph is the dependency closure reachable from output.
     * ShaderModuleGraphBuilder instantiates, validates, and collects controls/sources
     * only for reachable nodes. The runtime ShaderModuleGraph compiler then compiles
     * that prepared reachable graph. ShaderModuleGraphAnalyzer.analyze(...)
     * reports unreachable nodes as warnings and reports additional editor-facing
     * diagnostics for malformed node params/inputs and unknown input keys.
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
     * Prepared runtime state used to create a ShaderModuleGraph.
     *
     * This object is produced by ShaderModuleGraphBuilder from a committed graph config.
     * It is not the draft/editor analysis shape and should not be serialized.
     *
     * @typedef {object} ShaderModuleGraphPreparedState
     * @property {boolean} _shaderModuleGraphPreparedState - Internal marker for prepared graph state.
     * @property {ShaderModuleGraphConfig} config - Committed graph configuration.
     * @property {Object<string, ShaderModule>} nodes - Instantiated reachable module nodes.
     * @property {string[]} order - Topologically sorted reachable node ids.
     * @property {Object<string, ShaderModuleGraphControlRef>} controlMap - Flattened control ownership map.
     * @property {Object<string, object|boolean>} controlDefinitions - Flattened control definitions.
     * @property {ShaderModuleSourceRequirement[]} sourceDefinitions - Merged source definitions.
     */

    /**
     * Compiled graph output.
     *
     * @typedef {object} ShaderModuleGraphCompileResult
     * @property {string} definitions - GLSL definitions emitted outside the generated graph function.
     * @property {string} functionName - GLSL-safe name of the generated graph function.
     * @property {ShaderModuleValueType} returnType - Value type returned by the generated graph function.
     * @property {string} execution - Statements and final return statement emitted into the generated graph function.
     */

    /**
     * Return sorted unique numeric channel indexes.
     *
     * @private
     * @param {number[]} channels - Candidate channel indexes.
     * @returns {number[]} Sorted unique channel indexes.
     */
    function uniqueSortedSourceChannels(channels) {
        return Array.from(new Set((channels || []).filter(Number.isInteger))).sort((a, b) => a - b);
    }

    /**
     * Merge one module source requirement into a mutable aggregate requirement.
     *
     * The current ShaderLayer channel setup still calls acceptsChannelCount with legacy
     * swizzle width, not actual source metadata channel count. For that reason the merged
     * acceptsChannelCount remains permissive while numeric channel requirements are exposed
     * separately through sampledChannels and requiredChannelCount.
     *
     * @private
     * @param {ShaderModuleSourceRequirement|undefined} current - Existing aggregate requirement.
     * @param {ShaderModuleSourceRequirement} incoming - Incoming module requirement.
     * @param {number} index - Normalized source slot index.
     * @returns {ShaderModuleSourceRequirement} Merged source requirement.
     */
    function mergeSourceRequirement(current, incoming, index) {
        const currentChannels = current && Array.isArray(current.sampledChannels) ?
            current.sampledChannels : [];
        const incomingChannels = Array.isArray(incoming.sampledChannels) ?
            incoming.sampledChannels : [];

        const sampledChannels = uniqueSortedSourceChannels(currentChannels.concat(incomingChannels));
        const requiredChannelCount = Math.max(
            current && Number.isInteger(current.requiredChannelCount) ? current.requiredChannelCount : 0,
            Number.isInteger(incoming.requiredChannelCount) ? incoming.requiredChannelCount : 0,
            sampledChannels.length ? Math.max(...sampledChannels) + 1 : 0
        );

        return {
            index,
            sampledChannels,
            requiredChannelCount,
            acceptsChannelCount: () => true,
            description: buildMergedSourceDescription(index, sampledChannels, requiredChannelCount)
        };
    }

    /**
     * Build a human-readable merged source requirement description.
     *
     * @private
     * @param {number} index - Source slot index.
     * @param {number[]} sampledChannels - Sorted sampled channel indexes.
     * @param {number} requiredChannelCount - Minimum required source channel count.
     * @returns {string} Source requirement description.
     */
    function buildMergedSourceDescription(index, sampledChannels, requiredChannelCount) {
        if (!sampledChannels.length) {
            return `Modular graph source ${index}.`;
        }

        const channelWord = sampledChannels.length === 1 ? "channel" : "channels";
        const countWord = requiredChannelCount === 1 ? "channel" : "channels";

        return `Modular graph source ${index} samples ${channelWord} ${sampledChannels.join(", ")}. ` +
            `Requires at least ${requiredChannelCount} ${countWord}.`;
    }

    /**
     * Create a normalized graph diagnostic.
     *
     * @private
     * @param {object} diagnostic - Diagnostic fields.
     * @returns {ShaderModuleGraphDiagnostic} Normalized diagnostic.
     */
    function createGraphDiagnostic(diagnostic) {
        return {
            severity: diagnostic.severity || "error",
            code: diagnostic.code || "graph-diagnostic",
            message: diagnostic.message || "Shader module graph diagnostic.",
            path: Array.isArray(diagnostic.path) ? diagnostic.path.slice() : [],
            nodeId: diagnostic.nodeId,
            portName: diagnostic.portName,
            ref: diagnostic.ref,
            details: diagnostic.details || {}
        };
    }

    /**
     * Add a graph diagnostic to an array.
     *
     * @private
     * @param {ShaderModuleGraphDiagnostic[]} diagnostics - Diagnostic target array.
     * @param {object} diagnostic - Diagnostic fields.
     * @returns {ShaderModuleGraphDiagnostic} Added diagnostic.
     */
    function addGraphDiagnostic(diagnostics, diagnostic) {
        const normalized = createGraphDiagnostic(diagnostic);
        diagnostics.push(normalized);
        return normalized;
    }

    /**
     * Return true when a diagnostic list contains at least one error.
     *
     * @private
     * @param {ShaderModuleGraphDiagnostic[]} diagnostics - Diagnostics to inspect.
     * @returns {boolean} True when at least one error exists.
     */
    function hasGraphErrors(diagnostics) {
        return diagnostics.some(diagnostic => diagnostic.severity === "error");
    }

    /**
     * Return a safe suggestion for an invalid graph key.
     *
     * @private
     * @param {*} key - Candidate key.
     * @returns {string} Suggested GLSL-safe key.
     */
    function suggestGraphKey(key) {
        let out = String(key || "").replace(/[^0-9a-zA-Z_]/g, "");
        out = out.replace(/_+/g, "_").replace(/^_+/, "");
        return out || "node";
    }

    /**
     * Return true when value is a non-array object.
     *
     * @private
     * @param {*} value - Candidate value.
     * @returns {boolean} True when value is a plain object-like config value.
     */
    function isGraphObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

    /**
     * Return a JSON-compatible clone of a value.
     *
     * Functions, undefined values, symbols, and cyclic references are omitted. This is
     * used only for editor-facing graph analysis descriptors; runtime graph state keeps
     * its original richer object/function values.
     *
     * @private
     * @param {*} value - Value to clone.
     * @param {WeakSet<object>} [seen] - Objects already visited.
     * @returns {*} JSON-compatible clone, or undefined when the value cannot be represented.
     */
    function cloneJsonCompatibleForAnalysis(value, seen = new WeakSet()) {
        if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return value;
        }

        if (value === undefined || typeof value === "function" || typeof value === "symbol") {
            return undefined;
        }

        if (Array.isArray(value)) {
            const out = [];

            for (const item of value) {
                const cloned = cloneJsonCompatibleForAnalysis(item, seen);
                if (cloned !== undefined) {
                    out.push(cloned);
                }
            }

            return out;
        }

        if (typeof value === "object") {
            if (seen.has(value)) {
                return undefined;
            }

            seen.add(value);

            const out = {};
            for (const key of Object.keys(value)) {
                const cloned = cloneJsonCompatibleForAnalysis(value[key], seen);
                if (cloned !== undefined) {
                    out[key] = cloned;
                }
            }

            seen.delete(value);
            return out;
        }

        return undefined;
    }

    /**
     * Return a JSON-compatible descriptor for one analyzed graph node.
     *
     * @private
     * @param {string} nodeId - Graph node id.
     * @param {object} nodeConfig - Raw graph node config.
     * @returns {ShaderModuleGraphNodeDescriptor} Node descriptor.
     */
    function createNodeDescriptorForAnalysis(nodeId, nodeConfig) {
        const config = isGraphObject(nodeConfig) ? nodeConfig : {};

        return {
            id: nodeId,
            type: typeof config.type === "string" ? config.type : "",
            inputs: isGraphObject(config.inputs) ?
                cloneJsonCompatibleForAnalysis(config.inputs) || {} : {},
            params: isGraphObject(config.params) ?
                cloneJsonCompatibleForAnalysis(config.params) || {} : {}
        };
    }

    /**
     * Return JSON-compatible descriptors for instantiated analyzed nodes.
     *
     * @private
     * @param {Object<string, ShaderModule>} nodes - Instantiated analyzed nodes keyed by node id.
     * @param {ShaderModuleGraphConfig} graphConfig - Raw graph config.
     * @returns {Object<string, ShaderModuleGraphNodeDescriptor>} Node descriptors keyed by node id.
     */
    function createNodeDescriptorsForAnalysis(nodes, graphConfig) {
        const out = {};
        const configs = graphConfig && isGraphObject(graphConfig.nodes) ? graphConfig.nodes : {};

        for (const nodeId of Object.keys(nodes || {})) {
            out[nodeId] = createNodeDescriptorForAnalysis(nodeId, configs[nodeId]);
        }

        return out;
    }

    /**
     * Return a JSON-compatible source requirement/definition descriptor.
     *
     * Runtime-only predicates such as acceptsChannelCount are intentionally omitted.
     *
     * @private
     * @param {ShaderModuleSourceRequirement} source - Source requirement or definition.
     * @returns {object} JSON-compatible source descriptor.
     */
    function createSourceDescriptorForAnalysis(source) {
        const descriptor = cloneJsonCompatibleForAnalysis(source) || {};

        delete descriptor.acceptsChannelCount;

        if (Array.isArray(source && source.sampledChannels)) {
            descriptor.sampledChannels = source.sampledChannels.slice();
        }

        return descriptor;
    }

    /**
     * Return JSON-compatible per-node analysis descriptors.
     *
     * Runtime-only functions from controls and source requirements are omitted.
     *
     * @private
     * @param {Object<string, object>} nodeAnalyses - Runtime per-node analysis data.
     * @returns {Object<string, object>} JSON-compatible per-node analysis data.
     */
    function createNodeAnalysisDescriptorsForAnalysis(nodeAnalyses) {
        const out = {};

        for (const nodeId of Object.keys(nodeAnalyses || {})) {
            const analysis = nodeAnalyses[nodeId] || {};

            out[nodeId] = {
                inputDefinitions: cloneJsonCompatibleForAnalysis(analysis.inputDefinitions || {}) || {},
                outputDefinitions: cloneJsonCompatibleForAnalysis(analysis.outputDefinitions || {}) || {},
                controlDefinitions: cloneJsonCompatibleForAnalysis(analysis.controlDefinitions || {}) || {},
                sourceRequirements: Array.isArray(analysis.sourceRequirements) ?
                    analysis.sourceRequirements.map(createSourceDescriptorForAnalysis) : []
            };
        }

        return out;
    }

    /**
     * Return JSON-compatible source definition descriptors.
     *
     * @private
     * @param {ShaderModuleSourceRequirement[]} sourceDefinitions - Runtime source definitions.
     * @returns {object[]} JSON-compatible source descriptors.
     */
    function createSourceDefinitionDescriptorsForAnalysis(sourceDefinitions) {
        return (sourceDefinitions || []).map(createSourceDescriptorForAnalysis);
    }

    /**
     * Parse a graph reference without throwing.
     *
     * @private
     * @param {*} ref - Candidate reference.
     * @param {string} label - Human-readable label.
     * @param {Array<string|number>} path - JSON path to the reference.
     * @param {ShaderModuleGraphDiagnostic[]} diagnostics - Diagnostic target array.
     * @param {object} [extra={}] - Additional diagnostic fields.
     * @returns {?ShaderModuleGraphOutputRef} Parsed reference, or null when invalid.
     */
    function parseGraphRefForAnalysis(ref, label, path, diagnostics, extra = {}) {
        if (typeof ref !== "string") {
            addGraphDiagnostic(diagnostics, {
                severity: "error",
                code: "invalid-reference-type",
                message: `${label} must be a string reference.`,
                path,
                details: {
                    actualType: Array.isArray(ref) ? "array" : typeof ref
                },
                ...extra
            });
            return null;
        }

        const match = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/.exec(ref);
        if (!match) {
            addGraphDiagnostic(diagnostics, {
                severity: "error",
                code: "invalid-reference-syntax",
                message: `${label} must use 'nodeId.portName' syntax.`,
                path,
                ref,
                details: {
                    expected: "nodeId.portName"
                },
                ...extra
            });
            return null;
        }

        return {
            nodeId: match[1],
            portName: match[2]
        };
    }

    /**
     * Validate a graph value type without throwing.
     *
     * @private
     * @param {*} type - Candidate value type.
     * @param {string} label - Human-readable label.
     * @param {Array<string|number>} path - JSON path to the type.
     * @param {ShaderModuleGraphDiagnostic[]} diagnostics - Diagnostic target array.
     * @param {object} [extra={}] - Additional diagnostic fields.
     * @returns {boolean} True when valid.
     */
    function validateGraphValueTypeForAnalysis(type, label, path, diagnostics, extra = {}) {
        if (VALID_TYPES.has(type)) {
            return true;
        }

        addGraphDiagnostic(diagnostics, {
            severity: "error",
            code: "unsupported-value-type",
            message: `${label} has unsupported value type '${type}'.`,
            path,
            details: {
                type,
                validTypes: Array.from(VALID_TYPES)
            },
            ...extra
        });
        return false;
    }

    /**
     * Validate a module port declaration map without throwing.
     *
     * @private
     * @param {*} definitions - Candidate port declarations.
     * @param {"input"|"output"} kind - Port kind.
     * @param {string} nodeId - Owning node id.
     * @param {ShaderModuleGraphDiagnostic[]} diagnostics - Diagnostic target array.
     * @returns {Object<string, ShaderModulePortDescriptor>} Valid object-like declaration map.
     */
    function validatePortDefinitionsForAnalysis(definitions, kind, nodeId, diagnostics) {
        if (!isGraphObject(definitions)) {
            addGraphDiagnostic(diagnostics, {
                severity: "error",
                code: `invalid-${kind}-definitions`,
                message: `Node '${nodeId}' ${kind} definitions must be an object map.`,
                path: ["nodes", nodeId],
                nodeId
            });
            return {};
        }

        for (const portName of Object.keys(definitions)) {
            const port = definitions[portName];

            if (!isGraphObject(port)) {
                addGraphDiagnostic(diagnostics, {
                    severity: "error",
                    code: `invalid-${kind}-port`,
                    message: `Node '${nodeId}' ${kind} '${portName}' must be an object descriptor.`,
                    path: ["nodes", nodeId],
                    nodeId,
                    portName
                });
                continue;
            }

            validateGraphValueTypeForAnalysis(
                port.type,
                `node '${nodeId}' ${kind} '${portName}'`,
                ["nodes", nodeId],
                diagnostics,
                { nodeId, portName }
            );
        }

        return definitions;
    }

    /**
     * Report input references that are present in node config but not declared by the module.
     *
     * This check is analyzer-only. Runtime graph building intentionally remains
     * permissive and ignores unknown input keys.
     *
     * @private
     * @param {*} inputRefs - Raw node input reference map.
     * @param {Object<string, ShaderModulePortDescriptor>} inputDefinitions - Declared input ports.
     * @param {string} nodeId - Owning node id.
     * @param {ShaderModuleGraphDiagnostic[]} diagnostics - Diagnostic target array.
     * @returns {void}
     */
    function reportUnknownInputRefsForAnalysis(inputRefs, inputDefinitions, nodeId, diagnostics) {
        if (!isGraphObject(inputRefs)) {
            return;
        }

        const definitions = inputDefinitions || {};
        const declaredInputs = Object.keys(definitions);

        for (const inputName of Object.keys(inputRefs)) {
            if (Object.prototype.hasOwnProperty.call(definitions, inputName)) {
                continue;
            }

            addGraphDiagnostic(diagnostics, {
                severity: "error",
                code: "unknown-input-port",
                message: `Node '${nodeId}' has unknown input '${inputName}'.`,
                path: ["nodes", nodeId, "inputs", inputName],
                nodeId,
                portName: inputName,
                details: {
                    declaredInputs
                }
            });
        }
    }

    /**
     * Report malformed node-local params/inputs objects.
     *
     * This check is analyzer-only. Runtime graph building intentionally remains
     * permissive and lets ShaderModule construction fall back through its existing
     * config.params/config.inputs defaults.
     *
     * @private
     * @param {object} nodeConfig - Raw graph node config.
     * @param {string} nodeId - Owning node id.
     * @param {ShaderModuleGraphDiagnostic[]} diagnostics - Diagnostic target array.
     * @returns {void}
     */
    function reportInvalidNodeShapeForAnalysis(nodeConfig, nodeId, diagnostics) {
        if (nodeConfig.params !== undefined && !isGraphObject(nodeConfig.params)) {
            addGraphDiagnostic(diagnostics, {
                severity: "error",
                code: "invalid-node-params",
                message: `Node '${nodeId}' params must be an object.`,
                path: ["nodes", nodeId, "params"],
                nodeId,
                details: {
                    actualType: Array.isArray(nodeConfig.params) ? "array" : typeof nodeConfig.params
                }
            });
        }

        if (nodeConfig.inputs !== undefined && !isGraphObject(nodeConfig.inputs)) {
            addGraphDiagnostic(diagnostics, {
                severity: "error",
                code: "invalid-node-inputs",
                message: `Node '${nodeId}' inputs must be an object map.`,
                path: ["nodes", nodeId, "inputs"],
                nodeId,
                details: {
                    actualType: Array.isArray(nodeConfig.inputs) ? "array" : typeof nodeConfig.inputs
                }
            });
        }
    }

    /**
     * Prepared runtime ShaderModule graph.
     *
     * This class owns executable graph state produced by ShaderModuleGraphBuilder:
     * instantiated reachable nodes, topological order, flattened controls, source
     * definitions, and cached generated GLSL. It does not analyze draft configs or
     * build itself from raw graph config.
     *
     * Module authors normally work with ShaderModule and
     * ShaderModuleNodeCompileContext, not with ShaderModuleGraph directly.
     */
    $.FlexRenderer.ShaderModuleGraph = class {
        /**
         * Create a runtime module graph from prepared state.
         *
         * Callers should use ShaderModuleGraphBuilder.build(...) instead of constructing
         * this class directly.
         *
         * @param {ShaderLayer} owner - Owning ShaderLayer.
         * @param {ShaderModuleGraphPreparedState} preparedState - Prepared runtime graph state.
         * @throws {Error} Thrown when preparedState was not produced by ShaderModuleGraphBuilder.
         */
        constructor(owner, preparedState) {
            if (!preparedState || preparedState._shaderModuleGraphPreparedState !== true) {
                throw new Error("ShaderModuleGraph requires prepared state from ShaderModuleGraphBuilder.");
            }

            /**
             * Owning ShaderLayer.
             *
             * @type {ShaderLayer}
             */
            this.owner = owner;

            /**
             * Committed graph configuration.
             *
             * @type {ShaderModuleGraphConfig}
             */
            this.config = preparedState.config;

            /**
             * Instantiated reachable module nodes keyed by graph node id.
             *
             * @type {Object<string, ShaderModule>}
             */
            this.nodes = preparedState.nodes;

            /**
             * Topologically sorted reachable node ids.
             *
             * @type {string[]}
             */
            this.order = preparedState.order.slice();

            /**
             * Mapping from flattened ShaderLayer control names to module-local controls.
             *
             * @type {Object<string, ShaderModuleGraphControlRef>}
             */
            this.controlMap = preparedState.controlMap;

            /**
             * Flattened control definitions exposed to the owning ShaderLayer.
             *
             * @type {Object<string, object|boolean>}
             */
            this.controlDefinitions = preparedState.controlDefinitions;

            /**
             * Source definitions collected from module source requirements.
             *
             * @type {ShaderModuleSourceRequirement[]}
             */
            this.sourceDefinitions = preparedState.sourceDefinitions.slice();

            /**
             * Cached compiled graph output.
             *
             * @private
             * @type {?ShaderModuleGraphCompileResult}
             */
            this._compiled = null;
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
         * Return GLSL definitions emitted by graph nodes and the generated graph function.
         *
         * This compiles the graph on first use. The returned code belongs in shader
         * definition scope, not inside a ShaderLayer execution body.
         *
         * @returns {string} GLSL definitions and generated graph function.
         * @throws {Error} Thrown when graph compilation fails.
         */
        getFragmentShaderDefinition() {
            const compiled = this._getCompiled();

            return [
                compiled.definitions,
                `${compiled.returnType} ${compiled.functionName}() {
${compiled.execution}
}`
            ].filter(Boolean).join("\n\n");
        }

        /**
         * Return the GLSL-safe generated graph function name.
         *
         * @returns {string} Generated graph function name.
         * @throws {Error} Thrown when graph compilation fails.
         */
        getFunctionName() {
            return this._getCompiled().functionName;
        }

        /**
         * Return a GLSL call expression for the generated graph function.
         *
         * @returns {string} Generated graph function call expression.
         * @throws {Error} Thrown when graph compilation fails.
         */
        getFunctionCall() {
            return `${this.getFunctionName()}()`;
        }

        /**
         * Return a ShaderLayer execution body that directly returns the graph function call.
         *
         * This is valid only when the surrounding ShaderLayer function return type matches
         * the graph return type.
         *
         * @returns {string} GLSL execution body.
         * @throws {Error} Thrown when graph compilation fails.
         */
        getFragmentShaderExecution() {
            return `return ${this.getFunctionCall()};`;
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

            if (!output) {
                throw new Error(`${this.errorPrefix()}: graph.output did not compile.`);
            }

            this.validateType(output.type, "graph.output");

            if (output.type === "void") {
                throw new Error(`${this.errorPrefix()}: graph.output compiled to void.`);
            }

            this._compiled = {
                definitions: definitions.join("\n"),
                functionName: $.FlexRenderer.sanitizeKey(`${this.owner.uid}_module_graph`),
                returnType: output.type,
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

    /**
     * Analyzer for draft ShaderModuleGraph configs.
     *
     * Use this class from editors, demos, and visual graph tooling that need structured
     * diagnostics for invalid intermediate graph states. Analysis does not compile GLSL
     * or build a committed runtime graph.
     */
    $.FlexRenderer.ShaderModuleGraphAnalyzer = class {
        /**
         * Analyze a draft module graph config.
         *
         * @param {ShaderLayer|object} owner - Owning ShaderLayer or lightweight owner-like object.
         * @param {ShaderModuleGraphConfig} graphConfig - Draft graph configuration.
         * @param {object} [options={}] - Analyzer options reserved for future graph validation controls.
         * @returns {ShaderModuleGraphAnalysisResult} Structured analysis result.
         */
        static analyze(owner, graphConfig, options = {}) { // eslint-disable-line no-unused-vars
            const state = this._createState(owner, graphConfig);

            if (!isGraphObject(state.config)) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "invalid-graph",
                    message: "params.graph must be an object.",
                    path: []
                });
                return this._createResult(state);
            }

            if (!isGraphObject(state.config.nodes)) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "invalid-nodes",
                    message: "graph.nodes must be an object map.",
                    path: ["nodes"]
                });
                return this._createResult(state);
            }

            if (typeof state.config.output !== "string") {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "invalid-output-reference",
                    message: "graph.output must be a node output reference string.",
                    path: ["output"]
                });
            } else {
                state.outputRef = parseGraphRefForAnalysis(
                    state.config.output,
                    "graph.output",
                    ["output"],
                    state.diagnostics
                );
            }

            if (state.outputRef) {
                this._analyzeReachableNode(state, state.outputRef.nodeId);
                this._reportUnreachableNodes(state);
                this._validateAndSort(state);
                this._validateGraphOutput(state);
                this._collectControls(state);
                this._collectSources(state);
            }

            return this._createResult(state);
        }

        /**
         * Create mutable analyzer-local state.
         *
         * @private
         * @param {ShaderLayer|object} owner - Owning ShaderLayer or lightweight owner-like object.
         * @param {ShaderModuleGraphConfig} graphConfig - Draft graph configuration.
         * @returns {object} Analyzer state.
         */
        static _createState(owner, graphConfig) {
            return {
                owner,
                config: graphConfig || {},
                diagnostics: [],
                nodes: {},
                nodeAnalyses: {},
                order: [],
                controlMap: {},
                controlDefinitions: {},
                sourceDefinitions: [],
                outputRef: null,
                reachableNodeIds: new Set(),
                visitingReachability: {},
                visitedReachability: {}
            };
        }

        /**
         * Create a JSON-compatible analysis result.
         *
         * @private
         * @param {object} state - Analyzer state.
         * @returns {ShaderModuleGraphAnalysisResult} Structured analysis result.
         */
        static _createResult(state) {
            const allNodeIds = isGraphObject(state.config && state.config.nodes) ?
                Object.keys(state.config.nodes) : [];
            const reachable = Array.from(state.reachableNodeIds);
            const unreachable = allNodeIds.filter(nodeId => !state.reachableNodeIds.has(nodeId));

            return {
                ok: !hasGraphErrors(state.diagnostics),
                diagnostics: state.diagnostics,
                partial: {
                    nodes: createNodeDescriptorsForAnalysis(state.nodes, state.config),
                    nodeAnalyses: createNodeAnalysisDescriptorsForAnalysis(state.nodeAnalyses),
                    order: state.order.slice(),
                    reachableNodeIds: reachable,
                    unreachableNodeIds: unreachable,
                    controlDefinitions: cloneJsonCompatibleForAnalysis(state.controlDefinitions) || {},
                    controlMap: cloneJsonCompatibleForAnalysis(state.controlMap) || {},
                    sourceDefinitions: createSourceDefinitionDescriptorsForAnalysis(state.sourceDefinitions),
                    outputRef: cloneJsonCompatibleForAnalysis(state.outputRef) || null
                }
            };
        }

        /**
         * Analyze one node and recursively discover declared input dependencies.
         *
         * @private
         * @param {object} state - Analyzer state.
         * @param {string} nodeId - Node id to analyze.
         * @returns {void}
         */
        static _analyzeReachableNode(state, nodeId) {
            if (state.visitedReachability[nodeId]) {
                return;
            }

            if (state.visitingReachability[nodeId]) {
                return;
            }

            state.reachableNodeIds.add(nodeId);
            state.visitingReachability[nodeId] = true;

            const nodePath = ["nodes", nodeId];

            if (!$.FlexRenderer.idPattern.test(nodeId)) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "invalid-node-id",
                    message: `Node id '${nodeId}' is not GLSL-safe. Use '${suggestGraphKey(nodeId)}' or another stable id.`,
                    path: nodePath,
                    nodeId,
                    details: {
                        suggestedId: suggestGraphKey(nodeId)
                    }
                });

                state.visitingReachability[nodeId] = false;
                state.visitedReachability[nodeId] = true;
                return;
            }

            if (!Object.prototype.hasOwnProperty.call(state.config.nodes, nodeId)) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "unknown-reachable-node",
                    message: `Reachable node '${nodeId}' does not exist in graph.nodes.`,
                    path: nodePath,
                    nodeId
                });

                state.visitingReachability[nodeId] = false;
                state.visitedReachability[nodeId] = true;
                return;
            }

            const nodeConfig = state.config.nodes[nodeId];

            if (!isGraphObject(nodeConfig)) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "invalid-node-config",
                    message: `Node '${nodeId}' must be an object.`,
                    path: nodePath,
                    nodeId
                });

                state.visitingReachability[nodeId] = false;
                state.visitedReachability[nodeId] = true;
                return;
            }

            reportInvalidNodeShapeForAnalysis(nodeConfig, nodeId, state.diagnostics);

            if (typeof nodeConfig.type !== "string" || !nodeConfig.type) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "invalid-module-type",
                    message: `Node '${nodeId}' must declare a non-empty string type.`,
                    path: nodePath.concat(["type"]),
                    nodeId
                });

                state.visitingReachability[nodeId] = false;
                state.visitedReachability[nodeId] = true;
                return;
            }

            const ModuleClass = $.FlexRenderer.ShaderModuleMediator.getClass(nodeConfig.type);
            if (!ModuleClass) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "unknown-module-type",
                    message: `Unknown module type '${nodeConfig.type}' for node '${nodeId}'.`,
                    path: nodePath.concat(["type"]),
                    nodeId,
                    details: {
                        moduleType: nodeConfig.type,
                        availableTypes: $.FlexRenderer.ShaderModuleMediator.availableTypes()
                    }
                });

                state.visitingReachability[nodeId] = false;
                state.visitedReachability[nodeId] = true;
                return;
            }

            const node = new ModuleClass(nodeId, {
                uid: $.FlexRenderer.sanitizeKey(`${state.owner.uid || "draft"}_${nodeId}`),
                owner: state.owner,
                config: nodeConfig
            });

            state.nodes[nodeId] = node;

            let analysis = {};
            const context = new ShaderModuleAnalysisContext(state, node, state.diagnostics);

            try {
                analysis = node.analyze(context) || {};
            } catch (error) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "module-analysis-failed",
                    message: `Node '${nodeId}' analysis failed: ${error && error.message ? error.message : String(error)}`,
                    path: nodePath,
                    nodeId,
                    details: {
                        moduleType: nodeConfig.type
                    }
                });
            }

            const inputDefinitions = validatePortDefinitionsForAnalysis(
                analysis.inputDefinitions || {},
                "input",
                nodeId,
                state.diagnostics
            );

            const outputDefinitions = validatePortDefinitionsForAnalysis(
                analysis.outputDefinitions || {},
                "output",
                nodeId,
                state.diagnostics
            );

            state.nodeAnalyses[nodeId] = {
                inputDefinitions,
                outputDefinitions,
                controlDefinitions: isGraphObject(analysis.controlDefinitions) ? analysis.controlDefinitions : {},
                sourceRequirements: Array.isArray(analysis.sourceRequirements) ? analysis.sourceRequirements : []
            };

            const inputRefs = node.inputRefs || {};
            reportUnknownInputRefsForAnalysis(inputRefs, inputDefinitions, nodeId, state.diagnostics);

            for (const inputName of Object.keys(inputDefinitions)) {
                const ref = inputRefs[inputName];

                if (!ref) {
                    continue;
                }

                const parsed = parseGraphRefForAnalysis(
                    ref,
                    `node '${nodeId}' input '${inputName}'`,
                    ["nodes", nodeId, "inputs", inputName],
                    state.diagnostics,
                    {
                        nodeId,
                        portName: inputName
                    }
                );

                if (parsed) {
                    this._analyzeReachableNode(state, parsed.nodeId);
                }
            }

            state.visitingReachability[nodeId] = false;
            state.visitedReachability[nodeId] = true;
        }

        /**
         * Report graph nodes that are not reachable from graph.output.
         *
         * @private
         * @param {object} state - Analyzer state.
         * @returns {void}
         */
        static _reportUnreachableNodes(state) {
            for (const nodeId of Object.keys(state.config.nodes)) {
                if (state.reachableNodeIds.has(nodeId)) {
                    continue;
                }

                addGraphDiagnostic(state.diagnostics, {
                    severity: "warning",
                    code: "unreachable-node",
                    message: `Node '${nodeId}' is not reachable from graph.output and will not affect the compiled shader.`,
                    path: ["nodes", nodeId],
                    nodeId
                });
            }
        }

        /**
         * Validate reachable edges and compute best-effort topological order.
         *
         * @private
         * @param {object} state - Analyzer state.
         * @returns {void}
         */
        static _validateAndSort(state) {
            const visited = {};
            const visiting = {};
            const order = [];

            const visit = (nodeId, stack = []) => {
                if (visited[nodeId]) {
                    return;
                }

                if (visiting[nodeId]) {
                    addGraphDiagnostic(state.diagnostics, {
                        severity: "error",
                        code: "graph-cycle",
                        message: `Graph cycle detected at node '${nodeId}'.`,
                        path: ["nodes", nodeId],
                        nodeId,
                        details: {
                            cycle: stack.concat([nodeId])
                        }
                    });
                    return;
                }

                const nodeAnalysis = state.nodeAnalyses[nodeId];
                if (!nodeAnalysis) {
                    return;
                }

                visiting[nodeId] = true;

                const inputDefs = nodeAnalysis.inputDefinitions;
                const inputRefs = (state.nodes[nodeId] && state.nodes[nodeId].inputRefs) || {};

                for (const inputName of Object.keys(inputDefs)) {
                    const inputDef = inputDefs[inputName] || {};
                    const ref = inputRefs[inputName];

                    if (!ref) {
                        if (inputDef.required) {
                            addGraphDiagnostic(state.diagnostics, {
                                severity: "error",
                                code: "missing-required-input",
                                message: `Node '${nodeId}' missing required input '${inputName}'.`,
                                path: ["nodes", nodeId, "inputs", inputName],
                                nodeId,
                                portName: inputName
                            });
                        }
                        continue;
                    }

                    const parsed = parseGraphRefForAnalysis(
                        ref,
                        `node '${nodeId}' input '${inputName}'`,
                        ["nodes", nodeId, "inputs", inputName],
                        state.diagnostics,
                        {
                            nodeId,
                            portName: inputName
                        }
                    );

                    if (!parsed || !state.reachableNodeIds.has(parsed.nodeId)) {
                        continue;
                    }

                    const sourceAnalysis = state.nodeAnalyses[parsed.nodeId];
                    if (!sourceAnalysis) {
                        addGraphDiagnostic(state.diagnostics, {
                            severity: "error",
                            code: "unknown-input-node",
                            message: `Node '${nodeId}' input '${inputName}' references unknown node '${parsed.nodeId}'.`,
                            path: ["nodes", nodeId, "inputs", inputName],
                            nodeId,
                            portName: inputName,
                            ref
                        });
                        continue;
                    }

                    const outputDef = sourceAnalysis.outputDefinitions[parsed.portName];
                    if (!outputDef) {
                        addGraphDiagnostic(state.diagnostics, {
                            severity: "error",
                            code: "unknown-output-port",
                            message: `Node '${nodeId}' input '${inputName}' references unknown output '${ref}'.`,
                            path: ["nodes", nodeId, "inputs", inputName],
                            nodeId,
                            portName: inputName,
                            ref
                        });
                        continue;
                    }

                    if (inputDef.type !== outputDef.type) {
                        addGraphDiagnostic(state.diagnostics, {
                            severity: "error",
                            code: "type-mismatch",
                            message: `Node '${nodeId}' input '${inputName}' expects ${inputDef.type} but '${ref}' outputs ${outputDef.type}.`,
                            path: ["nodes", nodeId, "inputs", inputName],
                            nodeId,
                            portName: inputName,
                            ref,
                            details: {
                                expected: inputDef.type,
                                actual: outputDef.type
                            }
                        });
                    }

                    visit(parsed.nodeId, stack.concat([nodeId]));
                }

                visiting[nodeId] = false;
                visited[nodeId] = true;
                order.push(nodeId);
            };

            if (state.outputRef && state.reachableNodeIds.has(state.outputRef.nodeId)) {
                visit(state.outputRef.nodeId);
            }

            state.order = order;
        }

        /**
         * Validate the final graph output reference.
         *
         * @private
         * @param {object} state - Analyzer state.
         * @returns {void}
         */
        static _validateGraphOutput(state) {
            if (!state.outputRef) {
                return;
            }

            const outputNodeAnalysis = state.nodeAnalyses[state.outputRef.nodeId];

            if (!outputNodeAnalysis) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "unknown-output-node",
                    message: `graph.output references unknown node '${state.outputRef.nodeId}'.`,
                    path: ["output"],
                    ref: state.config.output
                });
                return;
            }

            const outputDef = outputNodeAnalysis.outputDefinitions[state.outputRef.portName];

            if (!outputDef) {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "unknown-graph-output-port",
                    message: `graph.output references unknown port '${state.config.output}'.`,
                    path: ["output"],
                    ref: state.config.output
                });
                return;
            }

            if (outputDef.type === "void") {
                addGraphDiagnostic(state.diagnostics, {
                    severity: "error",
                    code: "void-graph-output",
                    message: "graph.output must not resolve to void.",
                    path: ["output"],
                    ref: state.config.output
                });
            }
        }

        /**
         * Collect JSON-compatible control metadata from reachable nodes.
         *
         * @private
         * @param {object} state - Analyzer state.
         * @returns {void}
         */
        static _collectControls(state) {
            for (const nodeId of Object.keys(state.nodeAnalyses)) {
                if (!state.reachableNodeIds.has(nodeId)) {
                    continue;
                }

                const nodeAnalysis = state.nodeAnalyses[nodeId];
                const defs = nodeAnalysis.controlDefinitions;

                if (!isGraphObject(defs)) {
                    addGraphDiagnostic(state.diagnostics, {
                        severity: "error",
                        code: "invalid-control-definitions",
                        message: `Node '${nodeId}' control definitions must be an object map.`,
                        path: ["nodes", nodeId],
                        nodeId
                    });
                    continue;
                }

                for (const localName of Object.keys(defs)) {
                    const node = state.nodes[nodeId];
                    const flatName = localName.startsWith("use_") ?
                        localName : node.getControlName(localName);

                    if (state.controlDefinitions[flatName]) {
                        if (flatName.startsWith("use_")) {
                            continue;
                        }

                        addGraphDiagnostic(state.diagnostics, {
                            severity: "error",
                            code: "duplicate-module-control",
                            message: `Duplicate module control '${flatName}'.`,
                            path: ["nodes", nodeId],
                            nodeId,
                            details: {
                                flatName,
                                localName
                            }
                        });
                        continue;
                    }

                    state.controlDefinitions[flatName] = $.extend(true, {}, defs[localName]);
                    state.controlMap[flatName] = {
                        nodeId,
                        localName
                    };
                }
            }
        }

        /**
         * Collect JSON-compatible source metadata from reachable nodes.
         *
         * @private
         * @param {object} state - Analyzer state.
         * @returns {void}
         */
        static _collectSources(state) {
            const sources = [];

            for (const nodeId of Object.keys(state.nodeAnalyses)) {
                if (!state.reachableNodeIds.has(nodeId)) {
                    continue;
                }

                const requirements = state.nodeAnalyses[nodeId].sourceRequirements;

                for (const req of requirements) {
                    const rawIndex = Number.parseInt(req && req.index, 10);
                    if (!Number.isInteger(rawIndex) || rawIndex < 0) {
                        addGraphDiagnostic(state.diagnostics, {
                            severity: "error",
                            code: "invalid-source-index",
                            message: `Node '${nodeId}' declared an invalid source requirement index.`,
                            path: ["nodes", nodeId],
                            nodeId,
                            details: {
                                index: req && req.index
                            }
                        });
                        continue;
                    }

                    sources[rawIndex] = mergeSourceRequirement(sources[rawIndex], req, rawIndex);
                }
            }

            state.sourceDefinitions = [];
            for (let index = 0; index < sources.length; index++) {
                state.sourceDefinitions[index] = sources[index] || {
                    index,
                    sampledChannels: [],
                    requiredChannelCount: 0,
                    acceptsChannelCount: () => true,
                    description: `Unused modular graph source slot ${index}.`
                };
            }
        }
    };

    /**
     * Builder for committed ShaderModuleGraph configs.
     *
     * Use this class when a graph config is ready to become executable runtime state.
     * Invalid committed configs are reported by thrown errors. Draft/editor validation
     * should use ShaderModuleGraphAnalyzer before calling this builder.
     */
    $.FlexRenderer.ShaderModuleGraphBuilder = class {
        /**
         * Build a prepared runtime ShaderModuleGraph from a committed graph config.
         *
         * @param {ShaderLayer} owner - Owning ShaderLayer.
         * @param {ShaderModuleGraphConfig} graphConfig - Committed graph configuration.
         * @param {object} [options={}] - Builder options reserved for future runtime graph construction controls.
         * @returns {ShaderModuleGraph} Prepared runtime graph.
         * @throws {Error} Thrown when the committed graph config is invalid.
         */
        static build(owner, graphConfig, options = {}) { // eslint-disable-line no-unused-vars
            return new $.FlexRenderer.ShaderModuleGraph(
                owner,
                this._buildState(owner, graphConfig)
            );
        }

        /**
         * Build prepared runtime state from a committed graph config.
         *
         * @private
         * @param {ShaderLayer} owner - Owning ShaderLayer.
         * @param {ShaderModuleGraphConfig} graphConfig - Committed graph configuration.
         * @returns {object} Prepared runtime graph state.
         * @throws {Error} Thrown when the committed graph config is invalid.
         */
        static _buildState(owner, graphConfig) {
            const state = {
                _shaderModuleGraphPreparedState: true,
                owner,
                config: graphConfig || {},
                nodes: {},
                order: [],
                controlMap: {},
                controlDefinitions: {},
                sourceDefinitions: []
            };

            this._validateShape(state);
            this._instantiateNodes(state);
            this._validateAndSort(state);
            this._collectControls(state);
            this._collectSources(state);

            return state;
        }

        /**
         * Return the common prefix used by graph validation errors.
         *
         * @private
         * @param {object} state - Runtime build state.
         * @returns {string} Error message prefix identifying the owning layer.
         */
        static _errorPrefix(state) {
            return `ModularShaderLayer '${state.owner.id}'`;
        }

        /**
         * Validate that a value type is supported by the module graph compiler.
         *
         * @private
         * @param {object} state - Runtime build state.
         * @param {string} type - Candidate value type.
         * @param {string} label - Human-readable label used in thrown errors.
         * @returns {void}
         * @throws {Error} Thrown when type is not supported.
         */
        static _validateType(state, type, label) {
            if (!VALID_TYPES.has(type)) {
                throw new Error(`${this._errorPrefix(state)}: ${label} has unsupported value type '${type}'.`);
            }
        }

        /**
         * Parse a graph edge or output reference.
         *
         * @private
         * @param {object} state - Runtime build state.
         * @param {*} ref - Candidate reference value.
         * @param {string} label - Human-readable label used in thrown errors.
         * @returns {ShaderModuleGraphOutputRef} Parsed node id and port name.
         * @throws {Error} Thrown when ref is not a nodeId.portName string.
         */
        static _parseRef(state, ref, label) {
            if (typeof ref !== "string") {
                throw new Error(`${this._errorPrefix(state)}: ${label} must be a string reference.`);
            }

            const match = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/.exec(ref);
            if (!match) {
                throw new Error(`${this._errorPrefix(state)}: ${label} must use 'nodeId.portName' syntax, got '${ref}'.`);
            }

            return {
                nodeId: match[1],
                portName: match[2]
            };
        }

        /**
         * Validate the top-level graph config shape.
         *
         * @private
         * @param {object} state - Runtime build state.
         * @returns {void}
         * @throws {Error} Thrown when params.graph, graph.nodes, or graph.output has an invalid shape.
         */
        static _validateShape(state) {
            if (!state.config || typeof state.config !== "object") {
                throw new Error(`${this._errorPrefix(state)}: params.graph must be an object.`);
            }

            if (!state.config.nodes || typeof state.config.nodes !== "object" || Array.isArray(state.config.nodes)) {
                throw new Error(`${this._errorPrefix(state)}: graph.nodes must be an object map.`);
            }

            if (!state.config.output || typeof state.config.output !== "string") {
                throw new Error(`${this._errorPrefix(state)}: graph.output must be a node output reference string.`);
            }
        }

        /**
         * Instantiate ShaderModule nodes reachable from graph.output.
         *
         * Unreachable graph nodes are ignored by the runtime compiler. Only declared
         * input ports are followed, so unknown extra input keys remain runtime-permissive.
         *
         * @private
         * @param {object} state - Runtime build state.
         * @returns {void}
         * @throws {Error} Thrown when a reachable node id is not GLSL-safe, a reachable
         * module type is unknown, or a reachable input reference is invalid.
         */
        static _instantiateNodes(state) {
            state.nodes = {};

            const outputRef = this._parseRef(state, state.config.output, "graph.output");
            const visited = {};
            const visiting = {};

            const instantiateReachable = (nodeId) => {
                if (visited[nodeId]) {
                    return;
                }

                if (visiting[nodeId]) {
                    return;
                }

                visiting[nodeId] = true;

                const sanitized = $.FlexRenderer.sanitizeKey(nodeId);
                if (sanitized !== nodeId) {
                    throw new Error(`${this._errorPrefix(state)}: node id '${nodeId}' is not GLSL-safe. Use '${sanitized}' or another stable id.`);
                }

                if (!Object.prototype.hasOwnProperty.call(state.config.nodes, nodeId)) {
                    throw new Error(`${this._errorPrefix(state)}: unknown node '${nodeId}'.`);
                }

                const nodeConfig = state.config.nodes[nodeId];

                if (!nodeConfig || typeof nodeConfig !== "object" || Array.isArray(nodeConfig)) {
                    throw new Error(`${this._errorPrefix(state)}: node '${nodeId}' must be an object.`);
                }

                const moduleType = nodeConfig.type;
                const ModuleClass = $.FlexRenderer.ShaderModuleMediator.getClass(moduleType);

                if (!ModuleClass) {
                    throw new Error(`${this._errorPrefix(state)}: unknown module type '${moduleType}' for node '${nodeId}'.`);
                }

                const node = new ModuleClass(nodeId, {
                    uid: $.FlexRenderer.sanitizeKey(`${state.owner.uid}_${nodeId}`),
                    owner: state.owner,
                    config: nodeConfig
                });

                state.nodes[nodeId] = node;

                const inputDefs = node.getInputDefinitions();
                const inputRefs = node.inputRefs || {};

                for (const inputName of Object.keys(inputDefs)) {
                    const ref = inputRefs[inputName];

                    if (!ref) {
                        continue;
                    }

                    const parsed = this._parseRef(state, ref, `node '${nodeId}' input '${inputName}'`);
                    instantiateReachable(parsed.nodeId);
                }

                visiting[nodeId] = false;
                visited[nodeId] = true;
            };

            instantiateReachable(outputRef.nodeId);
        }

        /**
         * Validate graph edges, check port types, detect cycles, and compute node order.
         *
         * The final graph output must resolve to one supported non-void output port.
         *
         * @private
         * @param {object} state - Runtime build state.
         * @returns {void}
         * @throws {Error} Thrown when an edge, port type, cycle, or final output is invalid.
         */
        static _validateAndSort(state) {
            const visited = {};
            const visiting = {};
            const order = [];

            const visit = (nodeId) => {
                if (visited[nodeId]) {
                    return;
                }

                if (visiting[nodeId]) {
                    throw new Error(`${this._errorPrefix(state)}: graph cycle detected at node '${nodeId}'.`);
                }

                const node = state.nodes[nodeId];
                if (!node) {
                    throw new Error(`${this._errorPrefix(state)}: unknown node '${nodeId}'.`);
                }

                visiting[nodeId] = true;

                const inputDefs = node.getInputDefinitions();
                const inputRefs = node.inputRefs || {};

                for (const inputName of Object.keys(inputDefs)) {
                    const inputDef = inputDefs[inputName] || {};
                    this._validateType(state, inputDef.type, `node '${nodeId}' input '${inputName}'`);

                    const ref = inputRefs[inputName];
                    if (!ref) {
                        if (inputDef.required) {
                            throw new Error(`${this._errorPrefix(state)}: node '${nodeId}' missing required input '${inputName}'.`);
                        }
                        continue;
                    }

                    const parsed = this._parseRef(state, ref, `node '${nodeId}' input '${inputName}'`);
                    const sourceNode = state.nodes[parsed.nodeId];

                    if (!sourceNode) {
                        throw new Error(`${this._errorPrefix(state)}: node '${nodeId}' input '${inputName}' references unknown node '${parsed.nodeId}'.`);
                    }

                    const outputDefs = sourceNode.getOutputDefinitions();
                    const outputDef = outputDefs[parsed.portName];

                    if (!outputDef) {
                        throw new Error(`${this._errorPrefix(state)}: node '${nodeId}' input '${inputName}' references unknown output '${ref}'.`);
                    }

                    this._validateType(state, outputDef.type, `node '${parsed.nodeId}' output '${parsed.portName}'`);

                    if (inputDef.type !== outputDef.type) {
                        throw new Error(
                            `${this._errorPrefix(state)}: node '${nodeId}' input '${inputName}' expects ${inputDef.type} ` +
                            `but '${ref}' outputs ${outputDef.type}.`
                        );
                    }

                    visit(parsed.nodeId);
                }

                visiting[nodeId] = false;
                visited[nodeId] = true;
                order.push(nodeId);
            };

            const outputRef = this._parseRef(state, state.config.output, "graph.output");
            visit(outputRef.nodeId);

            const outputNode = state.nodes[outputRef.nodeId];
            if (!outputNode) {
                throw new Error(`${this._errorPrefix(state)}: graph.output references unknown node '${outputRef.nodeId}'.`);
            }

            const outputDef = outputNode.getOutputDefinitions()[outputRef.portName];
            if (!outputDef) {
                throw new Error(`${this._errorPrefix(state)}: graph.output references unknown port '${state.config.output}'.`);
            }

            this._validateType(state, outputDef.type, "graph.output");

            if (outputDef.type === "void") {
                throw new Error(`${this._errorPrefix(state)}: graph.output must not resolve to void.`);
            }

            state.order = order;
        }

        /**
         * Collect and flatten UI control definitions from all module nodes.
         *
         * Module-local controls are renamed through ShaderModule#getControlName(...).
         * Built-in use_* declarations keep their original names.
         *
         * @private
         * @param {object} state - Runtime build state.
         * @returns {void}
         * @throws {Error} Thrown when two non-built-in controls resolve to the same flat name.
         */
        static _collectControls(state) {
            state.controlDefinitions = {};
            state.controlMap = {};

            for (const nodeId of Object.keys(state.nodes)) {
                const node = state.nodes[nodeId];
                const defs = node.getControlDefinitions();

                for (const localName of Object.keys(defs)) {
                    const flatName = localName.startsWith("use_") ?
                        localName : node.getControlName(localName);

                    if (state.controlDefinitions[flatName]) {
                        if (flatName.startsWith("use_")) {
                            continue;
                        }

                        throw new Error(`${this._errorPrefix(state)}: duplicate module control '${flatName}'.`);
                    }

                    state.controlDefinitions[flatName] = $.extend(true, {}, defs[localName]);
                    state.controlMap[flatName] = {
                        nodeId,
                        localName
                    };
                }
            }
        }

        /**
         * Collect and merge source requirements from all module nodes.
         *
         * Multiple nodes may sample different channels from the same source slot. The
         * resulting source definition keeps the union of sampled channel indexes and the
         * maximum required channel count. Missing source slots between declared indexes
         * are filled with permissive placeholder definitions so source indexes remain dense.
         *
         * @private
         * @param {object} state - Runtime build state.
         * @returns {void}
         */
        static _collectSources(state) {
            const sources = [];

            for (const nodeId of Object.keys(state.nodes)) {
                const node = state.nodes[nodeId];
                const requirements = typeof node.getSourceRequirements === "function" ?
                    node.getSourceRequirements() : [];

                for (const req of requirements) {
                    const index = Math.max(0, Number.parseInt(req.index, 10) || 0);

                    sources[index] = mergeSourceRequirement(sources[index], req, index);
                }
            }

            state.sourceDefinitions = [];
            for (let index = 0; index < sources.length; index++) {
                state.sourceDefinitions[index] = sources[index] || {
                    index,
                    sampledChannels: [],
                    requiredChannelCount: 0,
                    acceptsChannelCount: () => true,
                    description: `Unused modular graph source slot ${index}.`
                };
            }
        }
    };
})(OpenSeadragon);
