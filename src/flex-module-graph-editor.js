(function($) {

    /**
     * Construction options for ShaderModuleGraphEditor.
     *
     * @typedef {object} ShaderModuleGraphEditorOptions
     * @property {HTMLElement} container - DOM element that receives the editor UI.
     * @property {object} [graphConfig] - Modular ShaderLayer graph config edited as a draft.
     * @property {number|string} [width="100%"] - Initial editor width.
     * @property {number|string} [height=480] - Initial editor height.
     * @property {object} [LiteGraph] - Optional LiteGraph namespace object.
     * @property {Function} [LGraph] - Optional LiteGraph graph constructor.
     * @property {Function} [LGraphCanvas] - Optional LiteGraph canvas constructor.
     * @property {Function} [LGraphNode] - Optional LiteGraph base node constructor.
     * @property {Function} [onDraftChange] - Handler registered for draft-change events.
     * @property {Function} [onSelectionChange] - Handler registered for selection-change events.
     * @property {Function} [onDiagnosticsChange] - Handler registered for diagnostics-change events.
     * @property {Function} [onApply] - Handler registered for apply events.
     */

    /**
     * Result returned by ShaderModuleGraphEditor#apply.
     *
     * @typedef {object} ShaderModuleGraphEditorApplyResult
     * @property {boolean} ok - Whether the draft can be applied.
     * @property {object} graphConfig - Defensive copy of the draft graph config.
     * @property {?object} analysis - Last graph analysis result, or null before analyzer integration.
     * @property {boolean} changed - Whether the draft differs from the current apply baseline.
     */

    /**
     * Standalone visual editor shell for modular ShaderLayer graph configs.
     *
     * The editor owns DOM, LiteGraph lifecycle, and draft graph state. It does
     * not mutate live ShaderLayer, FlexRenderer, or FlexDrawer state directly.
     */
    $.FlexRenderer.ShaderModuleGraphEditor = class extends $.EventSource {
        /**
         * Create a module graph editor.
         *
         * @param {ShaderModuleGraphEditorOptions} options - Editor options.
         * @throws {TypeError} Thrown when options.container is missing or invalid.
         * @throws {Error} Thrown when LiteGraph constructors are unavailable.
         */
        constructor(options = {}) {
            super();

            if (!options.container || options.container.nodeType !== 1) {
                throw new TypeError("ShaderModuleGraphEditor requires options.container to be an HTMLElement.");
            }

            const root = window;

            /**
             * DOM element that owns the editor UI.
             *
             * @type {HTMLElement}
             */
            this.container = options.container;

            /**
             * Original construction options.
             *
             * @private
             * @type {ShaderModuleGraphEditorOptions}
             */
            this.options = options;

            /**
             * Whether destroy has completed.
             *
             * @private
             * @type {boolean}
             */
            this._destroyed = false;

            /**
             * LiteGraph namespace object.
             *
             * @private
             * @type {?object}
             */
            this.LiteGraph = options.LiteGraph || root.LiteGraph || null;

            /**
             * LiteGraph graph constructor.
             *
             * @private
             * @type {?Function}
             */
            this.LGraph = options.LGraph || root.LGraph || (this.LiteGraph && this.LiteGraph.LGraph) || null;

            /**
             * LiteGraph canvas constructor.
             *
             * @private
             * @type {?Function}
             */
            this.LGraphCanvas = options.LGraphCanvas || root.LGraphCanvas || (this.LiteGraph && this.LiteGraph.LGraphCanvas) || null;

            /**
             * LiteGraph base node constructor.
             *
             * @private
             * @type {?Function}
             */
            this.LGraphNode = options.LGraphNode || root.LGraphNode || (this.LiteGraph && this.LiteGraph.LGraphNode) || null;

            if (!this.LiteGraph || !this.LGraph || !this.LGraphCanvas || !this.LGraphNode) {
                throw new Error(
                    "ShaderModuleGraphEditor requires LiteGraph. Include LiteGraph before flex-module-graph-editor.js " +
                    "or pass options.LiteGraph, options.LGraph, options.LGraphCanvas, and options.LGraphNode."
                );
            }

            /**
             * Draft reset/apply baseline.
             *
             * @private
             * @type {object}
             */
            this._sourceGraphConfig = this._cloneGraphConfig(options.graphConfig || {});

            /**
             * Mutable draft graph config owned by the editor.
             *
             * @private
             * @type {object}
             */
            this._draftGraphConfig = this._cloneGraphConfig(this._sourceGraphConfig);

            /**
             * Last graph analysis result.
             *
             * @private
             * @type {?object}
             */
            this._analysis = null;

            /**
             * Selected module node id, or null when no graph node is selected.
             *
             * @private
             * @type {?string}
             */
            this._selectedNodeId = null;

            /**
             * Module registry used by the palette and graph adapter.
             *
             * @private
             * @type {object}
             */
            this.moduleRegistry = options.moduleRegistry || $.FlexRenderer.ShaderModuleMediator;

            /**
             * LiteGraph nodes keyed by modular graph node id.
             *
             * @private
             * @type {Object<string, object>}
             */
            this._liteNodesById = {};

            /**
             * Internal id used by the synthetic Graph Output node.
             *
             * @private
             * @type {string}
             */
            this._outputNodeId = "__output";

            /**
             * Whether LiteGraph is currently being rebuilt from draft config.
             *
             * @private
             * @type {boolean}
             */
            this._renderingDraftGraph = false;

            this._registerOptionHandlers(options);
            this._ensureDefaultStyles();
            this._buildDom();
            this._createLiteGraph();
            this._renderModulePalette();
            this._renderDraftGraph();
            this.resize(options.width || "100%", options.height || 480);
        }

        /**
         * Return a defensive copy of the current draft graph config.
         *
         * @returns {object} Draft graph config.
         */
        getDraftGraphConfig() {
            return this._cloneGraphConfig(this._draftGraphConfig);
        }

        /**
         * Replace the current draft graph config.
         *
         * @param {object} graphConfig - New draft graph config.
         * @param {object} [options={}] - Draft replacement options.
         * @param {boolean} [options.updateSource=false] - Whether to also replace the reset/apply baseline.
         * @param {string} [options.reason="set-draft-graph-config"] - Event reason.
         * @returns {object} Defensive copy of the current draft.
         */
        setDraftGraphConfig(graphConfig, options = {}) {
            this._assertNotDestroyed();

            this._draftGraphConfig = this._cloneGraphConfig(graphConfig || {});

            if (options.updateSource) {
                this._sourceGraphConfig = this._cloneGraphConfig(this._draftGraphConfig);
            }

            this._renderDraftGraph();

            this.raiseEvent("draft-change", {
                graphConfig: this.getDraftGraphConfig(),
                reason: options.reason || "set-draft-graph-config"
            });

            return this.getDraftGraphConfig();
        }

        /**
         * Restore the draft graph to the last supplied or applied baseline.
         *
         * @returns {object} Defensive copy of the reset draft.
         */
        resetDraft() {
            return this.setDraftGraphConfig(this._sourceGraphConfig, {
                reason: "reset-draft"
            });
        }

        /**
         * Add a new module node to the draft graph.
         *
         * @param {string} moduleType - Registered ShaderModule type.
         * @param {object} [options={}] - Add options.
         * @param {number} [options.x] - Initial graph-space x position.
         * @param {number} [options.y] - Initial graph-space y position.
         * @param {string} [options.label] - Optional editor display label.
         * @returns {?string} Created node id, or null when the module type is unknown.
         */
        addModuleNode(moduleType, options = {}) {
            this._assertNotDestroyed();

            const ModuleClass = this._getModuleClass(moduleType);

            if (!ModuleClass) {
                $.console.warn(`ShaderModuleGraphEditor.addModuleNode: Unknown module type '${moduleType}'.`);
                return null;
            }

            this._syncLayoutToDraft();

            const graphConfig = this._draftGraphConfig;

            if (!graphConfig.nodes || typeof graphConfig.nodes !== "object" || Array.isArray(graphConfig.nodes)) {
                graphConfig.nodes = {};
            }

            const nodeId = this._createUniqueNodeId(moduleType);
            graphConfig.nodes[nodeId] = {
                type: moduleType,
                params: this._getDefaultModuleParams(ModuleClass)
            };

            if (!graphConfig.editor || typeof graphConfig.editor !== "object" || Array.isArray(graphConfig.editor)) {
                graphConfig.editor = {};
            }

            if (!graphConfig.editor.nodes || typeof graphConfig.editor.nodes !== "object" || Array.isArray(graphConfig.editor.nodes)) {
                graphConfig.editor.nodes = {};
            }

            const position = this._getInitialAddedNodePosition(options);
            graphConfig.editor.layoutVersion = 1;
            graphConfig.editor.nodes[nodeId] = {
                x: position.x,
                y: position.y
            };

            if (typeof options.label === "string" && options.label.trim()) {
                graphConfig.editor.nodes[nodeId].label = options.label.trim();
            }

            this._selectedNodeId = nodeId;
            this._renderDraftGraph();

            this.raiseEvent("draft-change", {
                graphConfig: this.getDraftGraphConfig(),
                reason: "add-module-node",
                nodeId: nodeId,
                moduleType: moduleType
            });

            return nodeId;
        }

        /**
         * Remove a module node from the draft graph.
         *
         * References from other module inputs and graph.output are removed when
         * they point to the deleted node.
         *
         * @param {string} nodeId - Module node id to remove.
         * @returns {boolean} True when a node was removed.
         */
        removeModuleNode(nodeId) {
            this._assertNotDestroyed();

            if (!nodeId || nodeId === this._outputNodeId) {
                return false;
            }

            this._syncLayoutToDraft();

            const graphConfig = this._draftGraphConfig;

            if (!graphConfig.nodes || !graphConfig.nodes[nodeId]) {
                return false;
            }

            delete graphConfig.nodes[nodeId];

            if (graphConfig.editor && graphConfig.editor.nodes) {
                delete graphConfig.editor.nodes[nodeId];
            }

            this._removeReferencesToNode(nodeId);

            if (this._selectedNodeId === nodeId) {
                this._selectedNodeId = null;
            }

            this._renderDraftGraph();

            this.raiseEvent("draft-change", {
                graphConfig: this.getDraftGraphConfig(),
                reason: "remove-module-node",
                nodeId: nodeId
            });

            return true;
        }

        /**
         * Set an editor-only display label for a module node.
         *
         * The executable node id is not changed. The label is stored in
         * graph.editor.nodes[nodeId].label.
         *
         * @param {string} nodeId - Module node id.
         * @param {string} label - Display label. Empty labels remove the saved label.
         * @returns {boolean} True when the label was updated.
         */
        setNodeLabel(nodeId, label) {
            this._assertNotDestroyed();

            const graphConfig = this._draftGraphConfig;

            if (!nodeId || !graphConfig.nodes || !graphConfig.nodes[nodeId]) {
                return false;
            }

            this._syncLayoutToDraft();

            if (!graphConfig.editor || typeof graphConfig.editor !== "object" || Array.isArray(graphConfig.editor)) {
                graphConfig.editor = {};
            }

            if (!graphConfig.editor.nodes || typeof graphConfig.editor.nodes !== "object" || Array.isArray(graphConfig.editor.nodes)) {
                graphConfig.editor.nodes = {};
            }

            const layout = graphConfig.editor.nodes[nodeId] || {};
            const nextLabel = String(label || "").trim();

            if (nextLabel) {
                layout.label = nextLabel;
            } else {
                delete layout.label;
            }

            graphConfig.editor.layoutVersion = 1;
            graphConfig.editor.nodes[nodeId] = layout;

            const liteNode = this._liteNodesById[nodeId];

            if (liteNode) {
                liteNode.title = this._getNodeDisplayTitle(nodeId, graphConfig.nodes[nodeId], layout);
            }

            this._renderInspector();

            if (this.graphCanvas && typeof this.graphCanvas.draw === "function") {
                this.graphCanvas.draw(true, true);
            }

            this.raiseEvent("draft-change", {
                graphConfig: this.getDraftGraphConfig(),
                reason: "set-node-label",
                nodeId: nodeId
            });

            return true;
        }

        /**
         * Patch one module-local control config in the draft graph.
         *
         * The stored value becomes an object so it can carry both the selected UI
         * control type and common control parameters such as default/min/max/step.
         *
         * @param {string} nodeId - Module node id.
         * @param {string} controlName - Module control name.
         * @param {object} patch - Control params to merge.
         * @returns {boolean} True when the control config was updated.
         */
        setModuleControlParams(nodeId, controlName, patch) {
            this._assertNotDestroyed();

            const graphConfig = this._draftGraphConfig;
            const nodeConfig = graphConfig.nodes && graphConfig.nodes[nodeId];
            const ModuleClass = nodeConfig ? this._getModuleClass(nodeConfig.type) : null;
            const controlDefinition = this._getModuleControlDefinition(ModuleClass, controlName);

            if (!nodeConfig || !controlDefinition || !patch || typeof patch !== "object") {
                return false;
            }

            if (!nodeConfig.params || typeof nodeConfig.params !== "object" || Array.isArray(nodeConfig.params)) {
                nodeConfig.params = {};
            }

            const current = this._getStoredControlParams(nodeConfig, controlName, controlDefinition);
            nodeConfig.params[controlName] = $.extend(true, {}, current, patch);

            this._renderInspector();

            this.raiseEvent("draft-change", {
                graphConfig: this.getDraftGraphConfig(),
                reason: "set-module-control-params",
                nodeId: nodeId,
                controlName: controlName
            });

            return true;
        }

        /**
         * Analyze the current draft graph.
         *
         * Analyzer integration is added in a later phase. This method currently
         * emits an empty diagnostics-change event so callers can depend on the
         * editor lifecycle shape.
         *
         * @returns {?object} Last analysis result.
         */
        analyze() {
            this._assertNotDestroyed();

            this._analysis = null;
            this.raiseEvent("diagnostics-change", {
                analysis: this._analysis,
                diagnostics: [],
                reason: "analyze-unavailable"
            });

            return this._analysis;
        }

        /**
         * Return an apply result without mutating renderer state.
         *
         * Full validation is added in a later phase. This shell implementation
         * commits the current draft as the new reset/apply baseline.
         *
         * @returns {ShaderModuleGraphEditorApplyResult} Apply result.
         */
        apply() {
            this._assertNotDestroyed();

            this._syncLayoutToDraft();

            const graphConfig = this.getDraftGraphConfig();
            const changed = JSON.stringify(this._sourceGraphConfig) !== JSON.stringify(graphConfig);

            this._sourceGraphConfig = this._cloneGraphConfig(graphConfig);

            const result = {
                ok: true,
                graphConfig: graphConfig,
                analysis: this._analysis,
                changed: changed
            };

            this.raiseEvent("apply", result);

            return result;
        }

        /**
         * Resize the editor and LiteGraph canvas.
         *
         * Call this after the host changes the editor container size or visibility.
         *
         * @param {number|string} [width] - New editor width. Omit to keep the current root width.
         * @param {number|string} [height] - New editor height. Omit to keep the current root height.
         * @returns {void}
         */
        resize(width = undefined, height = undefined) {
            this._assertNotDestroyed();

            if (width !== undefined) {
                this.root.style.width = typeof width === "number" ? `${width}px` : width;
            }

            if (height !== undefined) {
                this.root.style.height = typeof height === "number" ? `${height}px` : height;
            }

            const rect = this.canvasHost.getBoundingClientRect();
            const canvas = this.canvas;

            canvas.width = Math.max(1, Math.floor(rect.width || 1));
            canvas.height = Math.max(1, Math.floor(rect.height || 1));
            canvas.style.width = "100%";
            canvas.style.height = "100%";

            if (this.graphCanvas && typeof this.graphCanvas.resize === "function") {
                this.graphCanvas.resize();
            }

            if (this.graphCanvas && typeof this.graphCanvas.draw === "function") {
                this.graphCanvas.draw(true, true);
            }
        }

        /**
         * Destroy editor DOM and LiteGraph objects owned by this instance.
         *
         * @returns {void}
         */
        destroy() {
            if (this._destroyed) {
                return;
            }

            this._destroyed = true;

            if (this.graphCanvas && typeof this.graphCanvas.stopRendering === "function") {
                this.graphCanvas.stopRendering();
            }

            if (this.graph && typeof this.graph.stop === "function") {
                this.graph.stop();
            }

            this.graphCanvas = null;
            this.graph = null;

            if (this.root && this.root.parentNode) {
                this.root.parentNode.removeChild(this.root);
            }

            this.raiseEvent("destroy", {});
            this.container = null;
        }

        /**
         * Register callback options as event handlers.
         *
         * @private
         * @param {ShaderModuleGraphEditorOptions} options - Editor options.
         * @returns {void}
         */
        _registerOptionHandlers(options) {
            const callbacks = {
                "draft-change": options.onDraftChange,
                "selection-change": options.onSelectionChange,
                "diagnostics-change": options.onDiagnosticsChange,
                apply: options.onApply
            };

            for (const eventName in callbacks) {
                if (typeof callbacks[eventName] === "function") {
                    this.addHandler(eventName, callbacks[eventName]);
                }
            }
        }

        /**
         * Create the editor DOM structure.
         *
         * @private
         * @returns {void}
         */
        _buildDom() {
            /**
             * Root editor element.
             *
             * @private
             * @type {HTMLElement}
             */
            this.root = document.createElement("div");
            this.root.className = "fr-module-graph-editor";

            /**
             * Module palette panel.
             *
             * @private
             * @type {HTMLElement}
             */
            this.palette = document.createElement("div");
            this.palette.className = "fr-module-graph-editor__palette";
            this.palette.innerHTML = [
                '<div class="fr-module-graph-editor__section-title">Modules</div>',
                '<input class="fr-module-graph-editor__palette-search" type="search" placeholder="Search modules...">',
                '<div class="fr-module-graph-editor__module-list"></div>'
            ].join("");

            this.paletteSearch = this.palette.querySelector(".fr-module-graph-editor__palette-search");
            this.moduleList = this.palette.querySelector(".fr-module-graph-editor__module-list");
            this.paletteSearch.addEventListener("input", () => this._renderModulePalette());

            /**
             * Canvas host element.
             *
             * @private
             * @type {HTMLElement}
             */
            this.canvasHost = document.createElement("div");
            this.canvasHost.className = "fr-module-graph-editor__canvas";

            /**
             * LiteGraph canvas element.
             *
             * @private
             * @type {HTMLCanvasElement}
             */
            this.canvas = document.createElement("canvas");
            this.canvas.className = "fr-module-graph-editor__litegraph-canvas";
            this.canvasHost.appendChild(this.canvas);

            /**
             * Selected-node inspector panel.
             *
             * @private
             * @type {HTMLElement}
             */
            this.inspector = document.createElement("div");
            this.inspector.className = "fr-module-graph-editor__inspector";
            this.inspector.innerHTML = [
                '<div class="fr-module-graph-editor__section-title">Inspector</div>',
                '<div class="fr-module-graph-editor__empty-state">No node selected.</div>',
                '<div class="fr-module-graph-editor__diagnostics"></div>'
            ].join("");

            this.root.appendChild(this.palette);
            this.root.appendChild(this.canvasHost);
            this.root.appendChild(this.inspector);

            this.container.appendChild(this.root);
        }

        /**
         * Create the LiteGraph graph and canvas objects.
         *
         * @private
         * @returns {void}
         */
        _createLiteGraph() {
            /**
             * LiteGraph graph instance.
             *
             * @private
             * @type {object}
             */
            this.graph = new this.LGraph();

            /**
             * LiteGraph canvas controller.
             *
             * @private
             * @type {object}
             */
            this.graphCanvas = new this.LGraphCanvas(this.canvas, this.graph);

            this.graphCanvas.onNodeSelected = (node) => {
                this._selectedNodeId = node && node.properties ? node.properties.moduleNodeId || null : null;
                this._renderInspector();
                this.raiseEvent("selection-change", {
                    nodeId: this._selectedNodeId
                });
            };

            this.graphCanvas.onNodeDeselected = () => {
                this._selectedNodeId = null;
                this._renderInspector();
                this.raiseEvent("selection-change", {
                    nodeId: null
                });
            };
        }

        /**
         * Render the available module palette.
         *
         * @private
         * @returns {void}
         */
        _renderModulePalette() {
            if (!this.moduleList || !this.moduleRegistry || typeof this.moduleRegistry.availableModules !== "function") {
                return;
            }

            const query = ((this.paletteSearch && this.paletteSearch.value) || "").toLowerCase();
            const modules = this.moduleRegistry.availableModules();

            this.moduleList.textContent = "";

            for (const ModuleClass of modules) {
                const type = ModuleClass.type();
                const name = typeof ModuleClass.name === "function" ? ModuleClass.name() : type;
                const description = typeof ModuleClass.description === "function" ? ModuleClass.description() : "";
                const haystack = `${type} ${name} ${description}`.toLowerCase();

                if (query && !haystack.includes(query)) {
                    continue;
                }

                const item = document.createElement("button");
                item.type = "button";
                item.className = "fr-module-graph-editor__module-item";
                item.innerHTML = [
                    `<span class="fr-module-graph-editor__module-name">${this._escapeHtml(name)}</span>`,
                    `<span class="fr-module-graph-editor__module-type">${this._escapeHtml(type)}</span>`
                ].join("");

                item.addEventListener("click", () => {
                    this.addModuleNode(type);
                });

                if (description) {
                    item.title = description;
                }

                this.moduleList.appendChild(item);
            }
        }

        /**
         * Render the current draft graph into LiteGraph.
         *
         * @private
         * @returns {void}
         */
        _renderDraftGraph() {
            if (!this.graph) {
                return;
            }

            this._renderingDraftGraph = true;
            this._syncLayoutToDraft();

            if (typeof this.graph.clear === "function") {
                this.graph.clear();
            }

            this._liteNodesById = {};

            const graphConfig = this._draftGraphConfig || {};
            const nodes = graphConfig.nodes || {};
            const editor = graphConfig.editor || {};
            const layoutNodes = editor.nodes || {};

            let index = 0;

            for (const nodeId of Object.keys(nodes)) {
                const nodeConfig = nodes[nodeId] || {};
                const node = this._createLiteGraphNode(nodeId, nodeConfig, index, layoutNodes[nodeId]);

                this.graph.add(node);
                this._liteNodesById[nodeId] = node;
                index++;
            }

            const outputNode = this._createGraphOutputNode(layoutNodes[this._outputNodeId], index);
            this.graph.add(outputNode);
            this._liteNodesById[this._outputNodeId] = outputNode;

            this._connectDraftGraphLinks();

            if (this._selectedNodeId && this._liteNodesById[this._selectedNodeId] && typeof this.graphCanvas.selectNode === "function") {
                this.graphCanvas.selectNode(this._liteNodesById[this._selectedNodeId]);
            }

            this._renderInspector();

            if (this.graphCanvas && typeof this.graphCanvas.draw === "function") {
                this.graphCanvas.draw(true, true);
            }

            this._renderingDraftGraph = false;
        }

        /**
         * Create one LiteGraph node from a ShaderModule node config.
         *
         * @private
         * @param {string} nodeId - Modular graph node id.
         * @param {object} nodeConfig - Modular graph node config.
         * @param {number} index - Fallback layout index.
         * @param {object} [layout] - Saved editor layout for this node.
         * @returns {object} LiteGraph node.
         */
        _createLiteGraphNode(nodeId, nodeConfig, index, layout = undefined) {
            const ModuleClass = this._getModuleClass(nodeConfig.type);
            const title = this._getNodeDisplayTitle(nodeId, nodeConfig, layout);
            const node = new this.LGraphNode(title);

            node.title = title;
            node.size = node.size || [180, 90];
            node.inputs = node.inputs || [];
            node.outputs = node.outputs || [];
            node.properties = {
                moduleNodeId: nodeId,
                moduleType: nodeConfig.type || null,
                synthetic: false
            };

            node.onConnectionsChange = () => {
                this._handleLiteGraphConnectionChange();
            };

            const inputs = this._getStaticPortMap(ModuleClass, "inputs");
            const outputs = this._getStaticPortMap(ModuleClass, "outputs");

            for (const inputName of Object.keys(inputs)) {
                node.addInput(inputName, this._getPortType(inputs[inputName]));
                const input = node.inputs[node.inputs.length - 1];

                if (input) {
                    input.single = true;
                }
            }

            for (const outputName of Object.keys(outputs)) {
                node.addOutput(outputName, this._getPortType(outputs[outputName]));
            }

            const position = this._getNodePosition(layout, index);
            node.pos = [position.x, position.y];

            return node;
        }

        /**
         * Create the synthetic Graph Output node.
         *
         * @private
         * @param {object} [layout] - Saved editor layout.
         * @param {number} index - Fallback layout index.
         * @returns {object} LiteGraph node.
         */
        _createGraphOutputNode(layout = undefined, index = 0) {
            const node = new this.LGraphNode("Graph Output");

            node.title = "Graph Output";
            node.size = node.size || [180, 70];
            node.properties = {
                moduleNodeId: this._outputNodeId,
                moduleType: null,
                synthetic: true
            };

            node.onConnectionsChange = () => {
                this._handleLiteGraphConnectionChange();
            };

            node.addInput("output", "*");

            if (node.inputs && node.inputs[0]) {
                node.inputs[0].single = true;
            }

            const position = this._getNodePosition(layout, index);
            node.pos = [position.x, position.y];

            return node;
        }

        /**
         * Connect LiteGraph links from the draft config.
         *
         * @private
         * @returns {void}
         */
        _connectDraftGraphLinks() {
            const graphConfig = this._draftGraphConfig || {};
            const nodes = graphConfig.nodes || {};

            for (const nodeId of Object.keys(nodes)) {
                const targetNode = this._liteNodesById[nodeId];
                const inputs = nodes[nodeId] && nodes[nodeId].inputs;

                if (!targetNode || !inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
                    continue;
                }

                for (const inputName of Object.keys(inputs)) {
                    this._connectReference(inputs[inputName], targetNode, inputName);
                }
            }

            const outputNode = this._liteNodesById[this._outputNodeId];

            if (outputNode && typeof graphConfig.output === "string") {
                this._connectReference(graphConfig.output, outputNode, "output");
            }
        }

        /**
         * Connect one source reference to a LiteGraph target input.
         *
         * @private
         * @param {string} reference - Source reference in nodeId.portName form.
         * @param {object} targetNode - Target LiteGraph node.
         * @param {string} inputName - Target input name.
         * @returns {void}
         */
        _connectReference(reference, targetNode, inputName) {
            if (typeof reference !== "string") {
                return;
            }

            const dotIndex = reference.lastIndexOf(".");

            if (dotIndex <= 0 || dotIndex >= reference.length - 1) {
                return;
            }

            const sourceNodeId = reference.slice(0, dotIndex);
            const outputName = reference.slice(dotIndex + 1);
            const sourceNode = this._liteNodesById[sourceNodeId];

            if (!sourceNode || !targetNode) {
                return;
            }

            const outputIndex = this._findSlotIndex(sourceNode.outputs, outputName);
            const inputIndex = this._findSlotIndex(targetNode.inputs, inputName);

            if (outputIndex < 0 || inputIndex < 0 || typeof sourceNode.connect !== "function") {
                return;
            }

            sourceNode.connect(outputIndex, targetNode, inputIndex);
        }

        /**
         * Synchronize user-edited LiteGraph links into the draft graph config.
         *
         * @private
         * @returns {void}
         */
        _handleLiteGraphConnectionChange() {
            if (this._renderingDraftGraph || !this.graph || !this._draftGraphConfig) {
                return;
            }

            this._syncLiteGraphLinksToDraft();
            this.raiseEvent("draft-change", {
                graphConfig: this.getDraftGraphConfig(),
                reason: "connection-change"
            });
            this._renderInspector();
        }

        /**
         * Store current LiteGraph links in graph.nodes[*].inputs and graph.output.
         *
         * @private
         * @returns {void}
         */
        _syncLiteGraphLinksToDraft() {
            const graphConfig = this._draftGraphConfig;

            if (!graphConfig.nodes || typeof graphConfig.nodes !== "object" || Array.isArray(graphConfig.nodes)) {
                graphConfig.nodes = {};
            }

            this._syncLayoutToDraft();

            for (const nodeId of Object.keys(graphConfig.nodes)) {
                const nodeConfig = graphConfig.nodes[nodeId];

                if (!nodeConfig || typeof nodeConfig !== "object") {
                    continue;
                }

                delete nodeConfig.inputs;
            }

            graphConfig.output = null;

            for (const targetNodeId of Object.keys(this._liteNodesById)) {
                const targetNode = this._liteNodesById[targetNodeId];

                if (!targetNode || !Array.isArray(targetNode.inputs)) {
                    continue;
                }

                for (let inputIndex = 0; inputIndex < targetNode.inputs.length; inputIndex++) {
                    const input = targetNode.inputs[inputIndex];

                    if (!input || input.link === undefined || input.link === null) {
                        continue;
                    }

                    const reference = this._getLinkOutputReference(input.link);

                    if (!reference) {
                        continue;
                    }

                    const inputName = input.name;

                    if (targetNodeId === this._outputNodeId) {
                        graphConfig.output = reference;
                        continue;
                    }

                    const nodeConfig = graphConfig.nodes[targetNodeId];

                    if (!nodeConfig) {
                        continue;
                    }

                    if (!nodeConfig.inputs || typeof nodeConfig.inputs !== "object" || Array.isArray(nodeConfig.inputs)) {
                        nodeConfig.inputs = {};
                    }

                    nodeConfig.inputs[inputName] = reference;
                }
            }
        }

        /**
         * Remove graph references that point to a deleted module node.
         *
         * @private
         * @param {string} nodeId - Deleted module node id.
         * @returns {void}
         */
        _removeReferencesToNode(nodeId) {
            const graphConfig = this._draftGraphConfig;
            const nodes = graphConfig.nodes || {};
            const prefix = `${nodeId}.`;

            for (const targetNodeId of Object.keys(nodes)) {
                const nodeConfig = nodes[targetNodeId];

                if (!nodeConfig || !nodeConfig.inputs || typeof nodeConfig.inputs !== "object") {
                    continue;
                }

                for (const inputName of Object.keys(nodeConfig.inputs)) {
                    if (typeof nodeConfig.inputs[inputName] === "string" && nodeConfig.inputs[inputName].startsWith(prefix)) {
                        delete nodeConfig.inputs[inputName];
                    }
                }

                if (!Object.keys(nodeConfig.inputs).length) {
                    delete nodeConfig.inputs;
                }
            }

            if (typeof graphConfig.output === "string" && graphConfig.output.startsWith(prefix)) {
                graphConfig.output = null;
            }
        }

        /**
         * Return the source reference for a LiteGraph link.
         *
         * @private
         * @param {number|string} linkId - LiteGraph link id.
         * @returns {?string} Source reference in nodeId.outputName form.
         */
        _getLinkOutputReference(linkId) {
            const link = this.graph && this.graph.links ? this.graph.links[linkId] : null;

            if (!link) {
                return null;
            }

            const sourceNode = this.graph.getNodeById ?
                this.graph.getNodeById(link.origin_id) :
                null;

            if (!sourceNode || !sourceNode.properties || sourceNode.properties.synthetic) {
                return null;
            }

            const sourceNodeId = sourceNode.properties.moduleNodeId;
            const output = sourceNode.outputs && sourceNode.outputs[link.origin_slot];

            if (!sourceNodeId || !output || !output.name) {
                return null;
            }

            return `${sourceNodeId}.${output.name}`;
        }

        /**
         * Store current LiteGraph positions in graph.editor metadata.
         *
         * @private
         * @returns {void}
         */
        _syncLayoutToDraft() {
            if (!this.graph || !this._draftGraphConfig) {
                return;
            }

            const graphConfig = this._draftGraphConfig;

            if (!graphConfig.editor || typeof graphConfig.editor !== "object" || Array.isArray(graphConfig.editor)) {
                graphConfig.editor = {};
            }

            graphConfig.editor.layoutVersion = 1;

            if (!graphConfig.editor.nodes || typeof graphConfig.editor.nodes !== "object" || Array.isArray(graphConfig.editor.nodes)) {
                graphConfig.editor.nodes = {};
            }

            for (const nodeId of Object.keys(this._liteNodesById || {})) {
                const node = this._liteNodesById[nodeId];

                if (!node || !node.pos) {
                    continue;
                }

                const previous = graphConfig.editor.nodes[nodeId] || {};
                graphConfig.editor.nodes[nodeId] = $.extend(true, {}, previous, {
                    x: Number(node.pos[0]) || 0,
                    y: Number(node.pos[1]) || 0
                });
            }
        }

        /**
         * Render the basic selected-node inspector.
         *
         * @private
         * @returns {void}
         */
        _renderInspector() {
            if (!this.inspector) {
                return;
            }

            const diagnostics = this.inspector.querySelector(".fr-module-graph-editor__diagnostics");
            const nodeId = this._selectedNodeId;
            const graphConfig = this._draftGraphConfig || {};
            const nodeConfig = graphConfig.nodes && graphConfig.nodes[nodeId];

            if (!nodeId || !nodeConfig) {
                this.inspector.innerHTML = [
                    '<div class="fr-module-graph-editor__section-title">Inspector</div>',
                    '<div class="fr-module-graph-editor__empty-state">No module node selected.</div>',
                    '<div class="fr-module-graph-editor__diagnostics"></div>'
                ].join("");
                return;
            }

            const ModuleClass = this._getModuleClass(nodeConfig.type);
            const name = ModuleClass && typeof ModuleClass.name === "function" ? ModuleClass.name() : nodeConfig.type;
            const description = ModuleClass && typeof ModuleClass.description === "function" ? ModuleClass.description() : "";

            this.inspector.innerHTML = [
                '<div class="fr-module-graph-editor__section-title">Inspector</div>',
                '<div class="fr-module-graph-editor__field">',
                '<label for="fr-module-graph-editor-label">Label</label>',
                `<input id="fr-module-graph-editor-label" class="fr-module-graph-editor__label-input" type="text" value="${this._escapeHtml(this._getEditorNodeLabel(nodeId) || name || nodeId)}">`,
                '</div>',
                '<div class="fr-module-graph-editor__field">',
                '<label>Node id</label>',
                `<code>${this._escapeHtml(nodeId)}</code>`,
                '</div>',
                '<div class="fr-module-graph-editor__field">',
                '<label>Module type</label>',
                `<code>${this._escapeHtml(nodeConfig.type || "unknown")}</code>`,
                '</div>',
                description ? `<p class="fr-module-graph-editor__description">${this._escapeHtml(description)}</p>` : "",
                this._renderControlInspectorHtml(nodeId, nodeConfig, ModuleClass),
                '<button type="button" class="fr-module-graph-editor__danger-button">Remove node</button>',
                '<div class="fr-module-graph-editor__diagnostics"></div>'
            ].join("");

            if (diagnostics && diagnostics.innerHTML) {
                this.inspector.querySelector(".fr-module-graph-editor__diagnostics").innerHTML = diagnostics.innerHTML;
            }

            const labelInput = this.inspector.querySelector(".fr-module-graph-editor__label-input");

            if (labelInput) {
                labelInput.addEventListener("change", () => {
                    this.setNodeLabel(nodeId, labelInput.value);
                });
            }

            const removeButton = this.inspector.querySelector(".fr-module-graph-editor__danger-button");

            if (removeButton) {
                removeButton.addEventListener("click", () => {
                    this.removeModuleNode(nodeId);
                });
            }

            this._bindControlInspectorEvents(nodeId);
        }

        /**
         * Render selected-node control editing markup.
         *
         * @private
         * @param {string} nodeId - Module node id.
         * @param {object} nodeConfig - Module node config.
         * @param {?Function} ModuleClass - Module class.
         * @returns {string} Control editor HTML.
         */
        _renderControlInspectorHtml(nodeId, nodeConfig, ModuleClass) {
            const controls = ModuleClass && ModuleClass.defaultControls ? ModuleClass.defaultControls : {};
            const controlNames = Object.keys(controls).filter((controlName) => {
                return controls[controlName] && controls[controlName] !== false;
            });

            if (!controlNames.length) {
                return [
                    '<div class="fr-module-graph-editor__section-title">Controls</div>',
                    '<div class="fr-module-graph-editor__empty-state">This module declares no editable controls.</div>'
                ].join("");
            }

            return [
                '<div class="fr-module-graph-editor__section-title">Controls</div>',
                ...controlNames.map((controlName) => {
                    const controlDefinition = controls[controlName];
                    const params = this._getStoredControlParams(nodeConfig, controlName, controlDefinition);
                    const type = params.type || (controlDefinition.default && controlDefinition.default.type) || "";
                    const compatibleTypes = this._getCompatibleControlTypes(controlDefinition);
                    const commonFields = ["title", "default", "min", "max", "step", "interactive", "options"];

                    return [
                        `<fieldset class="fr-module-graph-editor__control" data-control-name="${this._escapeHtml(controlName)}">`,
                        `<legend>${this._escapeHtml(controlName)}</legend>`,
                        '<label class="fr-module-graph-editor__control-row">',
                        '<span>Type</span>',
                        `<select class="fr-module-graph-editor__control-type" data-control-field="type">${compatibleTypes.map((descriptor) => {
                            const selected = descriptor.type === type ? "selected" : "";

                            return `<option value="${this._escapeHtml(descriptor.type)}" ${selected}>${this._escapeHtml(descriptor.type)} (${this._escapeHtml(descriptor.glType)})</option>`;
                        }).join("")}</select>`,
                        '</label>',
                        ...commonFields
                            .filter((fieldName) => this._shouldShowControlField(params, fieldName))
                            .map((fieldName) => this._renderControlFieldHtml(fieldName, params[fieldName])),
                        '</fieldset>'
                    ].join("");
                })
            ].join("");
        }

        /**
         * Render one common control parameter field.
         *
         * @private
         * @param {string} fieldName - Control parameter name.
         * @param {*} value - Current control parameter value.
         * @returns {string} Field HTML.
         */
        _renderControlFieldHtml(fieldName, value) {
            if (fieldName === "interactive") {
                const checked = value !== false ? "checked" : "";

                return [
                    '<label class="fr-module-graph-editor__control-row">',
                    '<span>interactive</span>',
                    `<input class="fr-module-graph-editor__control-field" data-control-field="interactive" type="checkbox" ${checked}>`,
                    '</label>'
                ].join("");
            }

            if (fieldName === "options") {
                const text = value === undefined ? "" : JSON.stringify(value, null, 2);

                return [
                    '<label class="fr-module-graph-editor__control-row fr-module-graph-editor__control-row--stacked">',
                    '<span>options</span>',
                    `<textarea class="fr-module-graph-editor__control-field" data-control-field="options" spellcheck="false">${this._escapeHtml(text)}</textarea>`,
                    '</label>'
                ].join("");
            }

            const inputType = fieldName === "min" || fieldName === "max" || fieldName === "step" ? "number" : "text";
            const valueText = value === undefined ? "" : String(value);

            return [
                '<label class="fr-module-graph-editor__control-row">',
                `<span>${this._escapeHtml(fieldName)}</span>`,
                `<input class="fr-module-graph-editor__control-field" data-control-field="${this._escapeHtml(fieldName)}" type="${inputType}" value="${this._escapeHtml(valueText)}">`,
                '</label>'
            ].join("");
        }

        /**
         * Bind selected-node control editor events.
         *
         * @private
         * @param {string} nodeId - Selected module node id.
         * @returns {void}
         */
        _bindControlInspectorEvents(nodeId) {
            const controls = this.inspector.querySelectorAll(".fr-module-graph-editor__control");

            for (const control of controls) {
                const controlName = control.getAttribute("data-control-name");

                const typeSelect = control.querySelector(".fr-module-graph-editor__control-type");
                if (typeSelect) {
                    typeSelect.addEventListener("change", () => {
                        this._setControlTypeFromInspector(nodeId, controlName, typeSelect.value);
                    });
                }

                const fields = control.querySelectorAll(".fr-module-graph-editor__control-field");
                for (const field of fields) {
                    field.addEventListener("change", () => {
                        const fieldName = field.getAttribute("data-control-field");
                        const value = this._readControlFieldValue(field, fieldName);

                        this.setModuleControlParams(nodeId, controlName, {
                            [fieldName]: value
                        });
                    });
                }
            }
        }

        /**
         * Change a module-local control type from the inspector.
         *
         * @private
         * @param {string} nodeId - Module node id.
         * @param {string} controlName - Module control name.
         * @param {string} type - Selected UI control type.
         * @returns {void}
         */
        _setControlTypeFromInspector(nodeId, controlName, type) {
            const descriptor = $.FlexRenderer.UIControls.describeType(type);

            if (!descriptor) {
                return;
            }

            const graphConfig = this._draftGraphConfig;
            const nodeConfig = graphConfig.nodes && graphConfig.nodes[nodeId];
            const ModuleClass = nodeConfig ? this._getModuleClass(nodeConfig.type) : null;
            const controlDefinition = this._getModuleControlDefinition(ModuleClass, controlName);
            const current = nodeConfig ? this._getStoredControlParams(nodeConfig, controlName, controlDefinition) : {};
            const next = $.extend(true, {}, descriptor.defaults || {}, current, {
                type: type
            });

            this.setModuleControlParams(nodeId, controlName, next);
        }

        /**
         * Return one module control definition.
         *
         * @private
         * @param {?Function} ModuleClass - Module class.
         * @param {string} controlName - Control name.
         * @returns {?object} Control definition.
         */
        _getModuleControlDefinition(ModuleClass, controlName) {
            const controls = ModuleClass && ModuleClass.defaultControls;

            return controls && controls[controlName] && controls[controlName] !== false ?
                controls[controlName] :
                null;
        }

        /**
         * Return stored params for one module-local control as an object.
         *
         * @private
         * @param {object} nodeConfig - Module node config.
         * @param {string} controlName - Control name.
         * @param {object} controlDefinition - Module control definition.
         * @returns {object} Control params object.
         */
        _getStoredControlParams(nodeConfig, controlName, controlDefinition) {
            const params = nodeConfig.params || {};
            const stored = params[controlName];
            const defaults = controlDefinition && controlDefinition.default && typeof controlDefinition.default === "object" ?
                controlDefinition.default :
                {};

            if (stored && typeof stored === "object" && !Array.isArray(stored)) {
                return $.extend(true, {}, defaults, stored);
            }

            if (stored !== undefined) {
                return $.extend(true, {}, defaults, {
                    default: stored
                });
            }

            return $.extend(true, {}, defaults);
        }

        /**
         * Return UI control descriptors compatible with a module control definition.
         *
         * @private
         * @param {object} controlDefinition - Module control definition.
         * @returns {object[]} Compatible UI control descriptors.
         */
        _getCompatibleControlTypes(controlDefinition) {
            if (!$.FlexRenderer.UIControls || typeof $.FlexRenderer.UIControls.describeTypes !== "function") {
                return [];
            }

            const descriptors = $.FlexRenderer.UIControls.describeTypes();

            if (!controlDefinition || typeof controlDefinition.accepts !== "function") {
                return descriptors;
            }

            return descriptors.filter((descriptor) => {
                try {
                    return controlDefinition.accepts(descriptor.glType, descriptor);
                } catch (e) {
                    return false;
                }
            });
        }

        /**
         * Return whether a common control field should be displayed.
         *
         * @private
         * @param {object} params - Current control params.
         * @param {string} fieldName - Field name.
         * @returns {boolean} True when the field should be visible.
         */
        _shouldShowControlField(params, fieldName) {
            return Object.prototype.hasOwnProperty.call(params, fieldName);
        }

        /**
         * Read one control field value from the inspector.
         *
         * @private
         * @param {HTMLElement} field - Input or textarea element.
         * @param {string} fieldName - Control field name.
         * @returns {*} Parsed value.
         */
        _readControlFieldValue(field, fieldName) {
            if (fieldName === "interactive") {
                return !!field.checked;
            }

            if (fieldName === "min" || fieldName === "max" || fieldName === "step") {
                const value = Number(field.value);
                return Number.isFinite(value) ? value : 0;
            }

            if (fieldName === "options") {
                try {
                    return field.value.trim() ? JSON.parse(field.value) : [];
                } catch (e) {
                    return field.value;
                }
            }

            return field.value;
        }

        /**
         * Return a registered module class by type.
         *
         * @private
         * @param {string} type - Module type.
         * @returns {Function|null} Module class, if registered.
         */
        _getModuleClass(type) {
            if (!type || !this.moduleRegistry) {
                return null;
            }

            if (typeof this.moduleRegistry.getClass === "function") {
                return this.moduleRegistry.getClass(type) || null;
            }

            if (typeof this.moduleRegistry.get === "function") {
                return this.moduleRegistry.get(type) || null;
            }

            return null;
        }

        /**
         * Create a unique graph node id from a module type.
         *
         * @private
         * @param {string} moduleType - Registered ShaderModule type.
         * @returns {string} Unique node id.
         */
        _createUniqueNodeId(moduleType) {
            const graphConfig = this._draftGraphConfig || {};
            const nodes = graphConfig.nodes || {};
            let base = String(moduleType || "module").replace(/[^0-9a-zA-Z_]/g, "_");
            base = base.replace(/_+/g, "_").replace(/^_+/, "");

            if (!base) {
                base = "module";
            }

            let index = 1;
            let nodeId = `${base}_${index}`;

            while (nodes[nodeId]) {
                index++;
                nodeId = `${base}_${index}`;
            }

            return nodeId;
        }

        /**
         * Return compact default params for a newly added module.
         *
         * @private
         * @param {Function} ModuleClass - ShaderModule class.
         * @returns {object} Default node params.
         */
        _getDefaultModuleParams(ModuleClass) {
            const controls = ModuleClass.defaultControls || {};
            const params = {};

            for (const controlName of Object.keys(controls)) {
                const control = controls[controlName];

                if (!control || control === false || !control.default || typeof control.default !== "object") {
                    continue;
                }

                if (Object.prototype.hasOwnProperty.call(control.default, "default")) {
                    params[controlName] = this._cloneJsonValue(control.default.default);
                }
            }

            return params;
        }

        /**
         * Clone a JSON-compatible value used in node params.
         *
         * @private
         * @param {*} value - Value to clone.
         * @returns {*} Cloned value.
         */
        _cloneJsonValue(value) {
            if (value === undefined || value === null) {
                return value;
            }

            if (Array.isArray(value)) {
                return value.map(item => this._cloneJsonValue(item));
            }

            if (typeof value === "object") {
                return $.extend(true, {}, value);
            }

            return value;
        }

        /**
         * Return static module port declarations.
         *
         * @private
         * @param {?Function} ModuleClass - Module class.
         * @param {"inputs"|"outputs"} direction - Static port method name.
         * @returns {object} Port declarations.
         */
        _getStaticPortMap(ModuleClass, direction) {
            if (!ModuleClass || typeof ModuleClass[direction] !== "function") {
                return {};
            }

            const ports = ModuleClass[direction]();

            return ports && typeof ports === "object" && !Array.isArray(ports) ? ports : {};
        }

        /**
         * Return a LiteGraph-compatible port type label.
         *
         * @private
         * @param {object|string} port - Port descriptor.
         * @returns {string} Port type label.
         */
        _getPortType(port) {
            if (!port) {
                return "*";
            }

            if (typeof port === "string") {
                return port;
            }

            if (Array.isArray(port.type)) {
                return port.type.join("|");
            }

            return port.type || "*";
        }

        /**
         * Return saved or fallback node position.
         *
         * @private
         * @param {object|undefined} layout - Saved node layout.
         * @param {number} index - Fallback node index.
         * @returns {{x: number, y: number}} Position.
         */
        _getNodePosition(layout, index) {
            if (layout && Number.isFinite(layout.x) && Number.isFinite(layout.y)) {
                return {
                    x: layout.x,
                    y: layout.y
                };
            }

            return {
                x: 80 + (index % 4) * 240,
                y: 80 + Math.floor(index / 4) * 150
            };
        }

        /**
         * Return the initial position for a newly added node.
         *
         * @private
         * @param {object} options - Add options.
         * @param {number} [options.x] - Explicit graph-space x position.
         * @param {number} [options.y] - Explicit graph-space y position.
         * @returns {{x: number, y: number}} Initial position.
         */
        _getInitialAddedNodePosition(options = {}) {
            if (Number.isFinite(options.x) && Number.isFinite(options.y)) {
                return {
                    x: options.x,
                    y: options.y
                };
            }

            const canvas = this.canvas;
            const ds = this.graphCanvas && this.graphCanvas.ds;

            if (canvas && ds && Array.isArray(ds.offset) && Number.isFinite(ds.scale) && ds.scale !== 0) {
                return {
                    x: Math.round((canvas.width * 0.5 - ds.offset[0]) / ds.scale),
                    y: Math.round((canvas.height * 0.5 - ds.offset[1]) / ds.scale)
                };
            }

            const count = this._draftGraphConfig && this._draftGraphConfig.nodes ?
                Object.keys(this._draftGraphConfig.nodes).length :
                0;

            return this._getNodePosition(undefined, count);
        }

        /**
         * Return the display title for a module node.
         *
         * @private
         * @param {string} nodeId - Module node id.
         * @param {object} nodeConfig - Module node config.
         * @param {object|undefined} layout - Saved node layout.
         * @returns {string} Node title.
         */
        _getNodeDisplayTitle(nodeId, nodeConfig, layout) {
            const label = layout && typeof layout.label === "string" ? layout.label : null;

            if (label) {
                return label;
            }

            const ModuleClass = this._getModuleClass(nodeConfig.type);

            if (ModuleClass && typeof ModuleClass.name === "function") {
                return ModuleClass.name();
            }

            return nodeConfig.type || nodeId;
        }

        /**
         * Return the editor label saved for a node.
         *
         * @private
         * @param {string} nodeId - Module node id.
         * @returns {?string} Saved label.
         */
        _getEditorNodeLabel(nodeId) {
            const editor = this._draftGraphConfig && this._draftGraphConfig.editor;
            const nodes = editor && editor.nodes;
            const node = nodes && nodes[nodeId];

            return node && typeof node.label === "string" ? node.label : null;
        }

        /**
         * Return the slot index with the given name.
         *
         * @private
         * @param {object[]|undefined} slots - LiteGraph slot list.
         * @param {string} name - Slot name.
         * @returns {number} Slot index, or -1 when absent.
         */
        _findSlotIndex(slots, name) {
            if (!Array.isArray(slots)) {
                return -1;
            }

            return slots.findIndex(slot => slot && slot.name === name);
        }

        /**
         * Escape text before inserting it into generated editor markup.
         *
         * @private
         * @param {*} value - Text-like value.
         * @returns {string} Escaped text.
         */
        _escapeHtml(value) {
            return String((value === undefined || value === null) ? "" : value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        /**
         * Install minimal default editor styles once per page.
         *
         * @private
         * @returns {void}
         */
        _ensureDefaultStyles() {
            const styleId = "fr-module-graph-editor-default-styles";

            if (document.getElementById(styleId)) {
                return;
            }

            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
.fr-module-graph-editor {
    display: grid;
    grid-template-columns: 220px minmax(300px, 1fr) 280px;
    min-height: 360px;
    border: 1px solid #333;
    background: #1f1f1f;
    color: #e8e8e8;
    font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
}

.fr-module-graph-editor__palette,
.fr-module-graph-editor__inspector {
    min-width: 0;
    padding: 10px;
    background: #252525;
    overflow: auto;
}

.fr-module-graph-editor__palette {
    border-right: 1px solid #333;
}

.fr-module-graph-editor__inspector {
    border-left: 1px solid #333;
}

.fr-module-graph-editor__canvas {
    position: relative;
    min-width: 0;
    min-height: 0;
    background: #161616;
}

.fr-module-graph-editor__litegraph-canvas {
    display: block;
}

.fr-module-graph-editor__section-title {
    margin: 0 0 8px;
    font-weight: 600;
    color: #fff;
}

.fr-module-graph-editor__palette-search {
    box-sizing: border-box;
    width: 100%;
    margin-bottom: 8px;
    padding: 5px 7px;
    border: 1px solid #444;
    background: #181818;
    color: #eee;
}

.fr-module-graph-editor__empty-state {
    color: #aaa;
}

.fr-module-graph-editor__diagnostics {
    margin-top: 12px;
}


.fr-module-graph-editor__module-list {
    display: grid;
    gap: 6px;
}

.fr-module-graph-editor__module-item {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 6px 7px;
    border: 1px solid #444;
    border-radius: 3px;
    background: #1b1b1b;
    color: #eee;
    text-align: left;
}

.fr-module-graph-editor__module-item {
    cursor: pointer;
}

.fr-module-graph-editor__module-item:hover {
    background: #222;
    border-color: #666;
}

.fr-module-graph-editor__module-name {
    font-weight: 600;
}

.fr-module-graph-editor__module-type {
    color: #aaa;
    font-size: 11px;
}

.fr-module-graph-editor__field {
    display: grid;
    gap: 3px;
    margin-bottom: 10px;
}

.fr-module-graph-editor__field label {
    color: #aaa;
    font-size: 11px;
    text-transform: uppercase;
}

.fr-module-graph-editor__field code {
    overflow-wrap: anywhere;
}

.fr-module-graph-editor__description {
    color: #ccc;
}

.fr-module-graph-editor__label-input {
    box-sizing: border-box;
    width: 100%;
    padding: 5px 7px;
    border: 1px solid #444;
    background: #181818;
    color: #eee;
}

.fr-module-graph-editor__danger-button {
    width: 100%;
    margin: 4px 0 10px;
    padding: 6px 8px;
    border: 1px solid #7f1d1d;
    background: #3f1212;
    color: #fecaca;
    cursor: pointer;
}

.fr-module-graph-editor__danger-button:hover {
    background: #551818;
}

.fr-module-graph-editor__control {
    margin: 0 0 12px;
    padding: 8px;
    border: 1px solid #3f3f3f;
}

.fr-module-graph-editor__control legend {
    padding: 0 4px;
    color: #fff;
    font-weight: 600;
}

.fr-module-graph-editor__control-row {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    margin: 6px 0;
}

.fr-module-graph-editor__control-row--stacked {
    grid-template-columns: 1fr;
}

.fr-module-graph-editor__control-row span {
    color: #aaa;
    font-size: 11px;
}

.fr-module-graph-editor__control-row input,
.fr-module-graph-editor__control-row select,
.fr-module-graph-editor__control-row textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 4px 6px;
    border: 1px solid #444;
    background: #181818;
    color: #eee;
}

.fr-module-graph-editor__control-row textarea {
    min-height: 60px;
    font-family: monospace;
    resize: vertical;
}
`;
            document.head.appendChild(style);
        }

        /**
         * Clone a graph config for draft-state isolation.
         *
         * @private
         * @param {object} graphConfig - Graph config to clone.
         * @returns {object} Cloned graph config.
         */
        _cloneGraphConfig(graphConfig) {
            return $.extend(true, {}, graphConfig || {});
        }

        /**
         * Throw when the editor is no longer usable.
         *
         * @private
         * @returns {void}
         * @throws {Error} Thrown when destroy has already completed.
         */
        _assertNotDestroyed() {
            if (this._destroyed) {
                throw new Error("ShaderModuleGraphEditor has been destroyed.");
            }
        }
    };

})(OpenSeadragon);
