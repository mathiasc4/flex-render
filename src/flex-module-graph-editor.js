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

            if (!this.LiteGraph || !this.LGraph || !this.LGraphCanvas) {
                throw new Error(
                    "ShaderModuleGraphEditor requires LiteGraph. Include LiteGraph before flex-module-graph-editor.js " +
                    "or pass options.LiteGraph, options.LGraph, and options.LGraphCanvas."
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

            this._registerOptionHandlers(options);
            this._ensureDefaultStyles();
            this._buildDom();
            this._createLiteGraph();
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
                '<input class="fr-module-graph-editor__palette-search" type="search" placeholder="Search modules..." disabled>',
                '<div class="fr-module-graph-editor__module-list"></div>'
            ].join("");

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

            if (typeof this.graph.start === "function") {
                this.graph.start();
            }
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
