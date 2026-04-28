/**
 * Shader configurator for current FlexRenderer API.
 *
 * - compile* methods build machine-friendly docs JSON
 * - serialize* methods serialize docs as json or text
 * - render* methods render static docs or interactive UI
 * - preview is optional and injected through previewAdapter
 *
 * Requires:
 *   - OpenSeadragon.FlexRenderer
 *   - OpenSeadragon.FlexRenderer.ShaderMediator
 *   - OpenSeadragon.FlexRenderer.UIControls
 */
(function($) {

    function deepClone(value) {
        if (typeof structuredClone === "function") {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    }

    function firstDefined(...values) {
        for (const value of values) {
            if (value !== undefined) {
                return value;
            }
        }
        return undefined;
    }

    function escapeHtml(v) {
        return String(v || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }

    function resolveNode(nodeOrId) {
        if (typeof nodeOrId === "string") {
            const node = document.getElementById(nodeOrId);
            if (!node) {
                throw new Error(`Node "${nodeOrId}" not found`);
            }
            return node;
        }
        if (!(nodeOrId instanceof Node)) {
            throw new Error("Expected DOM node or element id");
        }
        return nodeOrId;
    }

    function isNode(v) {
        return typeof Node !== "undefined" && v instanceof Node;
    }

    function inferDefaultPreviewAssetBasePath() {
        if (typeof document === "undefined" || !document.currentScript || !document.currentScript.src) {  // eslint-disable-line compat/compat
            return null;
        }
        try {
            return new URL("shaders/", document.currentScript.src).toString().replace(/\/$/, "");  // eslint-disable-line compat/compat
        } catch (_) {
            return null;
        }
    }

    function svgToDataUri(svg) {
        return `data:image/svg+xml;utf8,${encodeURIComponent(String(svg || "").trim())}`;
    }

    function getRenderableDimensions(data) {
        if (!data) {
            return { width: 256, height: 256 };
        }

        const width = Number(
            data.videoWidth ||
            data.naturalWidth ||
            data.width ||
            (data.canvas && data.canvas.width) ||
            256
        );
        const height = Number(
            data.videoHeight ||
            data.naturalHeight ||
            data.height ||
            (data.canvas && data.canvas.height) ||
            256
        );

        return {
            width: Math.max(1, Math.round(width) || 256),
            height: Math.max(1, Math.round(height) || 256)
        };
    }

    class Registry {
        constructor(items = {}) {
            this._map = new Map(Object.entries(items));
        }
        register(key, value) {
            this._map.set(key, value);
            return this;
        }
        get(key) {
            return this._map.get(key) || null;
        }
        has(key) {
            return this._map.has(key);
        }
        entries() {
            return [...this._map.entries()];
        }
    }

    class PreviewSession {
        constructor({
                        uniqueId,
                        width = 256,
                        height = 256,
                        backgroundColor = "#00000000",
                        controlMountResolver,
                        onVisualizationChanged
                    }) {
            this.uniqueId = $.FlexRenderer.sanitizeKey(uniqueId);
            this.width = width;
            this.height = height;
            this.controlMountResolver = controlMountResolver;
            this.onVisualizationChanged = onVisualizationChanged;
            this._currentShaderId = null;
            this._suspendVisualizationSync = false;

            this.renderer = new $.FlexRenderer({
                uniqueId: this.uniqueId,
                webGLPreferredVersion: "2.0",
                debug: false,
                interactive: true,
                redrawCallback: () => {},
                refetchCallback: () => {},
                backgroundColor,
                htmlHandler: (shaderLayer, shaderConfig) => {
                    const mount = this.controlMountResolver();
                    if (!mount || !shaderLayer) {
                        return "";
                    }

                    const section = document.createElement("div");
                    section.className = "card bg-base-200 border border-base-300 shadow-sm";

                    const body = document.createElement("div");
                    body.className = "card-body p-3 gap-2";

                    const title = document.createElement("div");
                    title.className = "text-sm font-semibold";
                    title.textContent = shaderConfig.name || shaderLayer.constructor.name();

                    const controlsId = `${this.uniqueId}_${shaderLayer.id}_controls`;
                    const controls = document.createElement("div");
                    controls.id = controlsId;
                    controls.className = "flex flex-col gap-2";
                    controls.innerHTML = shaderLayer.htmlControls(
                        html => `<div class="flex flex-col gap-2">${html}</div>`
                    );

                    body.appendChild(title);
                    body.appendChild(controls);
                    section.appendChild(body);
                    mount.appendChild(section);

                    return controlsId;
                },
                htmlReset: () => {
                    const mount = this.controlMountResolver();
                    if (mount) {
                        mount.innerHTML = "";
                    }
                },
                canvasOptions: {
                    stencil: true
                }
            });

            this.renderer.setDataBlendingEnabled(true);
            this.renderer.setDimensions(0, 0, width, height, 1, 1);
            this.renderer.canvas.classList.add("rounded-box", "border", "border-base-300", "bg-base-100");
            this.renderer.addHandler("visualization-change", () => {
                if (this._suspendVisualizationSync || typeof this.onVisualizationChanged !== "function") {
                    return;
                }
                const shader = this.getShader();
                if (shader) {
                    this.onVisualizationChanged(deepClone(shader.getConfig()), this);
                }
            });
        }

        setSize(width, height) {
            this.width = width;
            this.height = height;
            this.renderer.setDimensions(0, 0, width, height, 1, 1);
        }

        setShader(shaderConfig) {
            const config = deepClone(shaderConfig);
            const shaderId = $.FlexRenderer.sanitizeKey(config.id || "prl");
            this._currentShaderId = shaderId;
            this._suspendVisualizationSync = true;

            try {
                this.renderer.deleteShaders();
                this.renderer.createShaderLayer(shaderId, config, true);
                this.renderer.setShaderLayerOrder([shaderId]);

                // Rebuild second-pass to regenerate controls and shader JS/GL state.
                this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
                this.renderer.useProgram(this.renderer.getProgram(this.renderer.webglContext.secondPassProgramKey), "second-pass");
            } finally {
                this._suspendVisualizationSync = false;
            }
        }

        getShader() {
            if (!this._currentShaderId) {
                return null;
            }
            return this.renderer.getShaderLayer(this._currentShaderId);
        }

        destroy() {
            this.renderer.destroy();
        }
    }

    var ShaderConfigurator = {
        REF: "ShaderConfigurator",
        _uniqueId: "live_setup",
        _renderData: null,
        _previewAdapter: null,
        _previewSession: null,
        _rootNode: null,
        _docsModel: null,
        _onControlSelectFinish: undefined,

        interactiveRenderers: new Registry(),
        docsRenderers: new Registry(),

        previewAssets: {
            basePath: inferDefaultPreviewAssetBasePath(),
            aliases: {
                "bipolar-heatmap": "bipolar-heatmap.png",
                code: "code.png",
                colormap: "colormap.png",
                edge: "edge.png",
                heatmap: "heatmap.png",
                identity: "identity.png"
            },
            registry: new Registry()
        },

        setup: {
            shader: {
                id: "prl",
                name: "Shader controls and configuration",
                type: undefined,
                visible: 1,
                fixed: false,
                tiledImages: [0],
                params: {},
                cache: {}
            }
        },

        renderStyle: {
            _styles: {},
            advanced(key) {
                return this._styles[key] === true;
            },
            setAdvanced(key) {
                this._styles[key] = true;
            },
            ui(key) {
                return !this.advanced(key);
            },
            setUi(key) {
                delete this._styles[key];
            }
        },

        setUniqueId(id) {
            this._uniqueId = $.FlexRenderer.sanitizeKey(id);
        },

        setData(data) {
            this._renderData = data || null;
        },

        setPreviewAssetBasePath(basePath) {
            this.previewAssets.basePath = basePath ? String(basePath).replace(/\/+$/, "") : null;
            return this;
        },

        registerShaderPreview(shaderType, preview) {
            this.previewAssets.registry.register(shaderType, preview);
            return this;
        },

        registerShaderPreviewAlias(shaderType, fileName) {
            this.previewAssets.aliases[shaderType] = fileName;
            return this;
        },

        setPreviewAdapter(adapter) {
            this._previewAdapter = adapter || null;
            return this;
        },

        registerInteractiveRenderer(type, renderer) {
            this.interactiveRenderers.register(type, renderer);
            return this;
        },

        registerDocsRenderer(kind, renderer) {
            this.docsRenderers.register(kind, renderer);
            return this;
        },

        destroy() {
            if (this._previewSession) {
                this._previewSession.destroy();
                this._previewSession = null;
            }
        },

        buildShadersAndControlsDocs(nodeId) {
            const node = resolveNode(nodeId);
            const model = this.compileDocsModel();
            this.renderDocsPage(node, model);
        },

        compileDocsModel() {
            const shaders = $.FlexRenderer.ShaderMediator.availableShaders().map(Shader => {
                const sources = typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
                const controls = this._compileControlDescriptors(Shader);
                const customParams = Shader.customParams || {};
                const configNotes = this._compileSpecialConfigNotes(Shader);
                const classDocs = this._getShaderClassDocs(Shader);

                return {
                    type: Shader.type(),
                    name: typeof Shader.name === "function" ? Shader.name() : Shader.type(),
                    description: typeof Shader.description === "function" ? Shader.description() : "",
                    intent: typeof Shader.intent === "function" ? Shader.intent() : undefined,
                    expects: typeof Shader.expects === "function" ? Shader.expects() : undefined,
                    exampleParams: typeof Shader.exampleParams === "function" ? Shader.exampleParams() : undefined,
                    controlCouplings: this._serializeControlCouplings(Shader),
                    preview: this._resolveShaderPreview(Shader),
                    sources: sources.map((src, index) => ({
                        index,
                        description: src.description || "",
                        acceptedChannelCounts: this._probeAcceptedChannelCounts(src)
                    })),
                    controls,
                    customParams: Object.entries(customParams).map(([name, meta]) =>
                        this._compileCustomParamDescriptor(name, meta)
                    ),
                    configNotes,
                    classDocs
                };
            });

            const controls = this._compileAvailableControls();

            const model = {
                version: 6,
                generatedAt: new Date().toISOString(),
                shaders,
                controls
            };

            this._docsModel = model;
            return model;
        },

        compileConfigSchemaModel() {
            const controlTypedefs = this._compileControlTypedefs();
            const shaders = $.FlexRenderer.ShaderMediator.availableShaders().map(Shader => {
                const sources = typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
                return {
                    type: Shader.type(),
                    name: typeof Shader.name === "function" ? Shader.name() : Shader.type(),
                    description: typeof Shader.description === "function" ? Shader.description() : "",
                    intent: typeof Shader.intent === "function" ? Shader.intent() : undefined,
                    expects: typeof Shader.expects === "function" ? Shader.expects() : undefined,
                    exampleParams: typeof Shader.exampleParams === "function" ? Shader.exampleParams() : undefined,
                    controlCouplings: this._serializeControlCouplings(Shader),
                    rootConfig: this._compileShaderRootConfigSchema(Shader),
                    params: this._compileShaderParamsSchema(Shader, sources),
                    sources: sources.map((src, index) => ({
                        index,
                        description: src.description || "",
                        acceptedChannelCounts: this._probeAcceptedChannelCounts(src)
                    }))
                };
            });

            return {
                version: 1,
                generatedAt: new Date().toISOString(),
                rendererConfig: {
                    type: "object",
                    usage: "Renderer configuration snapshot with explicit shader order and shader definitions.",
                    properties: [
                        {
                            key: "order",
                            type: "string[]",
                            required: false,
                            usage: "Optional top-level render order override. When omitted, the renderer falls back to Object.keys(shaders).",
                            overridesDefaultOrder: true,
                            targets: "top-level",
                            defaultBehavior: "Object.keys(shaders)"
                        },
                        {
                            key: "shaders",
                            type: "Object<string, ShaderConfig>",
                            required: true,
                            usage: "Map of shader id -> shader configuration object."
                        }
                    ]
                },
                shaderConfigBase: this._compileBaseShaderConfigSchema(),
                controlTypedefs,
                uiControls: this._compileControlSchemas(),
                shaders
            };
        },

        async compileConfigSchemaModelAsync() {
            return this.compileConfigSchemaModel();
        },

        /**
         * Serialization-friendly view of a shader's `controlCouplings()`.
         * Returns `undefined` when the shader has none (so JSON output stays clean),
         * or an array of `{name, summary, controls}` (no functions).
         */
        _serializeControlCouplings(Shader) {
            if (!Shader || typeof Shader.controlCouplings !== "function") {
                return undefined;
            }
            const raw = Shader.controlCouplings();
            if (!Array.isArray(raw) || raw.length === 0) {
                return undefined;
            }
            return raw.map(c => ({
                name: c.name,
                summary: c.summary,
                controls: c.controls
            }));
        },

        /**
         * Canonical "how many color classes does this `color` control value carry?".
         * Single source of truth for couplings and renderer-side coercion.
         * Precedence: a `custom_colormap` with a `default` array wins over `steps`,
         * otherwise `steps` wins; primitives count as one class.
         */
        resolveEffectiveColorSteps(colorValue) {
            if (!colorValue || typeof colorValue !== "object") {
                return 1;
            }
            if (colorValue.type === "custom_colormap" && Array.isArray(colorValue.default)) {
                return colorValue.default.length;
            }
            if (typeof colorValue.steps === "number") {
                return colorValue.steps;
            }
            return 1;
        },

        /**
         * Returns runtime coupling validators (with the `validate` function attached) for
         * a given shader type. Hosts call this to validate layers before submission.
         * The schema model only ships serialization-friendly entries (no functions).
         */
        getShaderCouplingValidators(shaderType) {
            const Mediator = $.FlexRenderer.ShaderMediator;
            const Shader = Mediator && (typeof Mediator.getShaderByType === "function"
                ? Mediator.getShaderByType(shaderType)
                : typeof Mediator.getClass === "function"
                    ? Mediator.getClass(shaderType)
                    : null);
            if (!Shader || typeof Shader.controlCouplings !== "function") {
                return [];
            }
            const raw = Shader.controlCouplings();
            if (!Array.isArray(raw)) {
                return [];
            }
            return raw.map(c => ({
                name: c.name,
                summary: c.summary,
                controls: c.controls,
                validate: typeof c.validate === "function" ? c.validate : undefined
            }));
        },

        async compileDocsModelAsync() {
            return this.compileDocsModel();
        },

        serializeDocs(mode = "json", model = this._docsModel || this.compileDocsModel()) {
            if (mode === "json") {
                return JSON.stringify(model, null, 2);
            }
            if (mode === "text") {
                return this._serializeDocsText(model);
            }
            throw new Error(`Unsupported docs serialization mode "${mode}"`);
        },

        renderDocsPage(nodeId, model = this._docsModel || this.compileDocsModel()) {
            const node = resolveNode(nodeId);
            node.innerHTML = "";

            const root = document.createElement("div");
            root.className = "flex flex-col gap-6";

            const customRoot = this.docsRenderers.get("root");
            if (customRoot) {
                const rendered = customRoot({ configurator: this, model, mount: root });
                if (rendered === false) {
                    node.appendChild(root);
                    return;
                }
            }

            const shadersSection = document.createElement("section");
            shadersSection.className = "flex flex-col gap-4";
            shadersSection.innerHTML = `<h3 class="text-xl font-semibold">Available shaders</h3>`;

            for (const shader of model.shaders) {
                const customShaderRenderer = this.docsRenderers.get("shader");
                let rendered = null;
                if (customShaderRenderer) {
                    rendered = customShaderRenderer({ configurator: this, shader, model });
                }
                shadersSection.appendChild(isNode(rendered) ? rendered : this._renderDefaultShaderDoc(shader));
            }

            const controlsSection = document.createElement("section");
            controlsSection.className = "flex flex-col gap-4";
            controlsSection.innerHTML = `<h3 class="text-xl font-semibold">Available UI controls</h3>`;

            for (const [glType, controls] of Object.entries(model.controls)) {
                const block = document.createElement("div");
                block.className = "card bg-base-100 border border-base-300 shadow-sm";

                const rows = controls.map(ctrl => `
<tr>
    <td class="font-mono">${escapeHtml(ctrl.name)}</td>
    <td class="font-mono">${escapeHtml(ctrl.glType)}</td>
    <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(ctrl.supports, null, 2))}</pre></td>
</tr>`).join("");

                block.innerHTML = `
<div class="card-body">
    <div class="card-title">GL type: <code>${escapeHtml(glType)}</code></div>
    <div class="overflow-x-auto">
        <table class="table table-sm">
            <thead><tr><th>Name</th><th>GL type</th><th>Supports</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>
</div>`;
                controlsSection.appendChild(block);
            }

            root.appendChild(shadersSection);
            root.appendChild(controlsSection);
            node.appendChild(root);
        },

        runShaderSelector(nodeId, onFinish) {
            if (!this.picker || typeof this.picker.init !== "function") {
                throw new Error("ShaderConfigurator.picker.init(...) is not available.");
            }
            this.picker.init(this, nodeId, { onFinish });
        },

        runShaderAndControlSelector(nodeId, onFinish) {
            const _this = this;
            this.runShaderSelector(nodeId, async(shaderId) => {
                const src = _this.picker.granularity("image") ||
                    _this.picker.selectionRules.granularity._config.image.granular;

                if (src) {
                    const data = await _this._loadRenderableData(src);
                    if (data) {
                        _this.setData(data);
                    }
                }
                _this.runControlSelector(nodeId, shaderId, onFinish);
            });
        },

        async _loadRenderableData(source) {
            if (!source) {
                return null;
            }

            if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
                return source;
            }
            if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
                if (source.complete && source.naturalWidth > 0) {
                    return source;
                }
                return await new Promise(resolve => {
                    source.onload = () => resolve(source);
                    source.onerror = () => resolve(null);
                });
            }
            if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
                return source;
            }
            if (typeof ImageData !== "undefined" && source instanceof ImageData) {
                return source;
            }
            if (typeof source === "string") {
                return await new Promise(resolve => {
                    const image = document.createElement("img");
                    image.decoding = "async";
                    image.onload = () => resolve(image);
                    image.onerror = () => resolve(null);
                    image.src = source;
                });
            }
            if (source && typeof source === "object" && typeof source.src === "string") {
                return await this._loadRenderableData(source.src);
            }
            return source;
        },


        async runControlSelector(nodeId, shaderId, onFinish = undefined) {
            this._onControlSelectFinish = onFinish;
            this._rootNode = resolveNode(nodeId);

            if (this._previewSession && this.setup.shader.type && this.setup.shader.type !== shaderId) {
                this._previewSession.destroy();
                this._previewSession = null;
            }

            const Shader = $.FlexRenderer.ShaderMediator.getClass(shaderId);
            if (!Shader) {
                throw new Error(`Invalid shader: ${shaderId}. Not present.`);
            }

            const srcDecl = typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
            this.setup.shader = {
                id: "prl",
                name: `Configuration: ${shaderId}`,
                type: shaderId,
                visible: 1,
                fixed: false,
                tiledImages: srcDecl.map((_, i) => i),
                params: deepClone(this.setup.shader.params || {}),
                cache: {}
            };

            this._renderInteractiveShell(this._rootNode, Shader);
            await this._refreshInteractive();
        },

        getCurrentShaderConfig() {
            return deepClone(this.setup.shader);
        },

        refresh() {
            this.setup.shader.cache = {};
            return this._refreshInteractive();
        },

        refreshUserSwitched(controlId) {
            if (this.renderStyle.advanced(controlId)) {
                this.renderStyle.setUi(controlId);
            } else {
                this.renderStyle.setAdvanced(controlId);
            }
            this.refresh();
        },

        refreshUserSelected(controlId, type) {
            if (!this.setup.shader.params[controlId]) {
                this.setup.shader.params[controlId] = {};
            }
            this.setup.shader.params[controlId].type = type;
            if (this._previewSession) {
                this._previewSession.destroy();
                this._previewSession = null;
            }
            this.refresh();
        },

        refreshUserScripted(node, controlId) {
            try {
                this.parseJSONConfig(node.value, controlId);
                node.classList.remove("textarea-error");
                this.refresh();
            } catch (e) {
                node.classList.add("textarea-error");
            }
        },

        refreshUserUpdated(_node, controlId, keyChain, value) {
            const ensure = (o, key) => {
                if (!o[key]) {
                    o[key] = {};
                }
                return o[key];
            };

            let ref = ensure(this.setup.shader.params, controlId);
            const keys = keyChain.split(".");
            const key = keys.pop();
            keys.forEach(x => {
                ref = ensure(ref, x);
            });
            ref[key] = value;
            this.refresh();
        },

        parseJSONConfig(value, controlId) {
            const config = JSON.parse(value);
            const current = this.setup.shader.params[controlId] || {};
            if (current.type && !config.type) {
                config.type = current.type;
            }
            this.setup.shader.params[controlId] = config;
            return config;
        },

        getAvailableControlsForShader(shader) {
            const uiControls = this._buildControls();
            const controls = this._resolveShaderControlDefinitions(shader);

            if (controls.opacity === undefined || (typeof controls.opacity === "object" && typeof controls.opacity.accepts === "function" && !controls.opacity.accepts("float"))) {
                controls.opacity = {
                    default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity"},
                    accepts: (type) => type === "float"
                };
            }

            const result = {};
            for (let control in controls) {
                if (control.startsWith("use_")) {
                    continue;
                }
                if (controls[control] === false) {
                    continue;
                }

                const supported = [];
                if (controls[control].required && controls[control].required.type) {
                    supported.push(controls[control].required.type);
                } else {
                    if (typeof controls[control].accepts !== "function") {
                        result[control] = supported;
                        continue;
                    }
                    for (let glType in uiControls) {
                        for (let existing of uiControls[glType]) {
                            if (!controls[control].accepts(glType, existing)) {
                                continue;
                            }
                            supported.push(existing.name);
                        }
                    }
                }
                result[control] = [...new Set(supported)];
            }
            return result;
        },

        _compileControlDescriptors(Shader) {
            const supports = this.getAvailableControlsForShader(Shader);
            const defs = this._resolveShaderControlDefinitions(Shader);

            return Object.keys(supports).map(name => ({
                name,
                supportedUiTypes: supports[name],
                default: (defs[name] && defs[name].default) || null,
                required: (defs[name] && defs[name].required) || null
            }));
        },

        _resolveShaderControlDefinitions(Shader) {
            const probe = this._createShaderDefinitionProbe(Shader);
            const baseControls = typeof probe.getControlDefinitions === "function" ?
                probe.getControlDefinitions() :
                $.extend(true, {}, Shader.defaultControls || {});

            if (typeof probe._expandControlDefinitions === "function") {
                return probe._expandControlDefinitions(baseControls);
            }
            return baseControls;
        },

        _createShaderDefinitionProbe(Shader) {
            const probe = Object.create(Shader.prototype);
            probe.constructor = Shader;
            probe._customControls = {};
            probe._controls = {};
            probe.loadProperty = (_name, defaultValue) => defaultValue;
            probe.storeProperty = () => {};
            probe.invalidate = () => {};
            probe._rebuild = () => {};
            probe._refresh = () => {};
            probe._refetch = () => {};
            return probe;
        },

        _compileAvailableControls() {
            const built = this._buildControls();
            const out = {};
            for (const [glType, controls] of Object.entries(built)) {
                out[glType] = controls.map(ctrl => ({
                    name: ctrl.name,
                    glType: ctrl.type,
                    uiType: ctrl.uiControlType,
                    supports: deepClone(ctrl.supports || {}),
                    classDocs: this._getControlClassDocs(ctrl)
                }));
            }
            return out;
        },

        _compileControlSchemas() {
            const built = this._buildControls();
            const out = {};
            for (const [glType, controls] of Object.entries(built)) {
                out[glType] = controls.map(ctrl => ({
                    name: ctrl.name,
                    glType: ctrl.type,
                    uiType: ctrl.uiControlType,
                    typedef: this._getControlTypedefId(ctrl),
                    config: this._compileControlConfigShape(ctrl)
                }));
            }
            return out;
        },

        _compileControlTypedefs() {
            const built = this._buildControls();
            const typedefs = {};

            for (const controls of Object.values(built)) {
                for (const control of controls) {
                    const typedefId = this._getControlTypedefId(control);
                    if (!typedefs[typedefId]) {
                        typedefs[typedefId] = {
                            id: typedefId,
                            name: control.name,
                            uiType: control.uiControlType,
                            glType: control.type,
                            config: this._compileControlConfigShape(control)
                        };
                    }
                }
            }

            return typedefs;
        },

        _probeAcceptedChannelCounts(src) {
            if (!src || typeof src.acceptsChannelCount !== "function") {
                return null;
            }
            const accepted = [];
            for (let n = 1; n <= 32; n++) {
                try {
                    if (src.acceptsChannelCount(n)) {
                        accepted.push(n);
                    }
                } catch (_) {
                    // no-op
                }
            }
            return accepted;
        },

        _compileBaseShaderConfigSchema() {
            return {
                type: "object",
                usage: "Base JSON object accepted by renderer shader-layer configuration.",
                properties: [
                    {
                        key: "id",
                        type: "string",
                        required: true,
                        usage: "Unique shader identifier used by the renderer."
                    },
                    {
                        key: "name",
                        type: "string",
                        required: false,
                        usage: "Optional human-readable layer name."
                    },
                    {
                        key: "type",
                        type: "string",
                        required: true,
                        usage: "Registered shader type resolved through ShaderMediator."
                    },
                    {
                        key: "visible",
                        type: "number|boolean",
                        required: false,
                        usage: "Layer visibility flag. Renderer examples use 1 or 0."
                    },
                    {
                        key: "fixed",
                        type: "boolean",
                        required: false,
                        usage: "Renderer flag stored on ShaderConfig."
                    },
                    {
                        key: "tiledImages",
                        type: "number[]|OpenSeadragon.TiledImage[]",
                        required: false,
                        usage: "Data sources consumed by the shader. Entries are indexed by source position."
                    },
                    {
                        key: "params",
                        type: "object",
                        required: false,
                        usage: "Shader-specific settings, built-in use_* options, UI-control configs, and custom parameters."
                    },
                    {
                        key: "_controls",
                        type: "object",
                        required: false,
                        usage: "Renderer-managed control storage present on ShaderConfig."
                    },
                    {
                        key: "cache",
                        type: "object",
                        required: false,
                        usage: "Persistent runtime state used by controls and reset* helpers."
                    }
                ]
            };
        },

        _compileShaderRootConfigSchema(Shader) {
            const base = this._compileBaseShaderConfigSchema().properties.map(item => deepClone(item));
            const byKey = new Map(base.map(item => [item.key, item]));

            for (const note of this._compileSpecialConfigNotes(Shader)) {
                byKey.set(note.key, {
                    ...(byKey.get(note.key) || {}),
                    key: note.key,
                    type: note.kind || "special",
                    required: false,
                    usage: note.usage || ""
                });
            }

            return {
                type: "object",
                properties: [...byKey.values()]
            };
        },

        _compileShaderParamsSchema(Shader, sources = []) {
            const defs = Shader.defaultControls || {};
            const controls = this._compileControlDescriptors(Shader).map(control => ({
                key: control.name,
                kind: "ui-control",
                usage: `Shader param for UI control '${control.name}'.`,
                supportedUiTypes: control.supportedUiTypes,
                defaultControlConfig: control.default !== null ? deepClone(control.default) : null,
                requiredControlConfig: control.required !== null ? deepClone(control.required) : null,
                supportedTypes: control.supportedUiTypes
            }));

            const customParams = Object.entries(Shader.customParams || {}).map(([name, meta]) => ({
                key: name,
                kind: "custom-param",
                type: this._resolveCustomParamType(meta),
                usage: (meta && meta.usage) || "",
                default: meta && meta.default !== undefined ? deepClone(meta.default) : null,
                required: meta && meta.required !== undefined ? deepClone(meta.required) : null
            }));

            return {
                type: "object",
                usage: "Configuration object assigned to ShaderConfig.params.",
                builtIn: [
                    ...this._compileUseChannelSchemas(Shader, sources, defs),
                    this._compileUseModeSchema(defs),
                    this._compileUseBlendSchema(defs),
                    ...this._compileUseFilterSchemas(defs)
                ],
                controls,
                customParams
            };
        },

        _compileUseChannelSchemas(_Shader, sources = [], defs = {}) {
            return sources.flatMap((src, index) => {
                const accepted = this._probeAcceptedChannelCounts(src);
                const defaultControl = defs[`use_channel${index}`] || {};
                const baseControl = defs[`use_channel_base${index}`] || {};

                return [
                    {
                        key: `use_channel${index}`,
                        kind: "built-in",
                        type: "string",
                        usage: "Channel pattern used for sampling this source. Accepts swizzles like 'r', 'rg', 'rgba' and inline base form 'N:pattern'.",
                        acceptedChannelCounts: accepted,
                        default: firstDefined(defaultControl.required, defaultControl.default, "r"),
                        required: firstDefined(defaultControl.required, null)
                    },
                    {
                        key: `use_channel_base${index}`,
                        kind: "built-in",
                        type: "number",
                        usage: "Explicit flattened base-channel offset for this source. Overrides the optional N prefix from use_channel.",
                        default: firstDefined(baseControl.required, baseControl.default, 0),
                        required: firstDefined(baseControl.required, null)
                    }
                ];
            });
        },

        _compileUseModeSchema(defs = {}) {
            const spec = defs.use_mode || {};
            return {
                key: "use_mode",
                kind: "built-in",
                type: "string",
                usage: "Rendering mode resolved by resetMode(). Supported values come from renderer WebGL context.",
                allowedValues: ["show", "blend", "clip", "mask", "clip_mask"],
                default: firstDefined(spec.required, spec.default, "show"),
                required: firstDefined(spec.required, null)
            };
        },

        _compileUseBlendSchema(defs = {}) {
            const spec = defs.use_blend || {};
            return {
                key: "use_blend",
                kind: "built-in",
                type: "string",
                usage: "Blend function used when the current use_mode applies blending.",
                allowedValues: deepClone($.FlexRenderer.BLEND_MODE || []),
                default: firstDefined(spec.required, spec.default, ($.FlexRenderer.BLEND_MODE || [])[0], null),
                required: firstDefined(spec.required, null)
            };
        },

        _compileUseFilterSchemas(defs = {}) {
            const names = $.FlexRenderer.ShaderLayer.filterNames || {};
            return Object.keys($.FlexRenderer.ShaderLayer.filters || {}).map(key => {
                const spec = defs[key] || {};
                const label = names[key] || key;
                return {
                    key,
                    kind: "built-in",
                    type: "number",
                    usage: `${label} filter parameter applied by resetFilters().`,
                    default: firstDefined(spec.required, spec.default, null),
                    required: firstDefined(spec.required, null)
                };
            });
        },

        _expandSupportedUiSchemas(names = []) {
            const built = this._buildControls();
            const seen = new Set();
            const out = [];

            for (const controls of Object.values(built)) {
                for (const control of controls) {
                    if (!names.includes(control.name) || seen.has(control.name)) {
                        continue;
                    }
                    seen.add(control.name);
                    out.push({
                        name: control.name,
                        glType: control.type,
                        uiType: control.uiControlType,
                        typedef: this._getControlTypedefId(control),
                        config: this._compileControlConfigShape(control)
                    });
                }
            }

            return out;
        },

        _getControlTypedefId(control) {
            const uiType = control && control.uiControlType ? control.uiControlType : "unknown";
            const glType = control && control.type ? control.type : "unknown";
            return `control:${uiType}:${glType}`;
        },

        _compileControlConfigShape(control) {
            const docs = this._getControlClassDocs(control);
            const docParams = new Map(((docs && docs.parameters) || []).map(param => [param.name, param]));
            const supports = deepClone(this._safeReadControlProp(control, "supports", {}) || {});
            const supportsAll = deepClone(this._safeReadControlProp(control, "supportsAll", {}) || {});
            const keys = [...new Set([
                ...Object.keys(supports),
                ...Object.keys(supportsAll),
                ...docParams.keys()
            ])];

            const config = {};
            for (const key of keys) {
                config[key] = this._compileControlConfigPropertySchema(
                    key,
                    supports[key],
                    supportsAll[key],
                    docParams.get(key) || null
                );
            }
            return config;
        },

        _safeReadControlProp(control, prop, fallback = undefined) {
            if (!control) {
                return fallback;
            }
            try {
                const value = control[prop];
                return value === undefined ? fallback : value;
            } catch (_) {
                return fallback;
            }
        },

        _compileControlConfigPropertySchema(name, sampleValue, variantsValue, docParam) {
            const schema = {
                type: this._inferSchemaType(sampleValue, variantsValue, docParam)
            };

            if (sampleValue !== undefined) {
                schema.default = deepClone(sampleValue);
            } else if (docParam && docParam.default !== undefined) {
                schema.default = deepClone(docParam.default);
            }

            if (variantsValue !== undefined) {
                schema.examples = deepClone(Array.isArray(variantsValue) ? variantsValue : [variantsValue]);
            }

            if (docParam && docParam.usage) {
                schema.usage = docParam.usage;
            }

            if (docParam && Array.isArray(docParam.allowedValues)) {
                schema.allowedValues = deepClone(docParam.allowedValues);
            }

            if (docParam && docParam.examples !== undefined) {
                schema.examples = deepClone(Array.isArray(docParam.examples) ? docParam.examples : [docParam.examples]);
            }

            return schema;
        },

        _inferSchemaType(sampleValue, variantsValue, docParam) {
            if (docParam && docParam.type) {
                return docParam.type;
            }

            if (variantsValue !== undefined) {
                return this._inferValueType(variantsValue);
            }

            return this._inferValueType(sampleValue);
        },

        _inferValueType(value) {
            if (value === null) {
                return "null";
            }
            if (Array.isArray(value)) {
                if (value.length === 0) {
                    return "array";
                }
                const itemTypes = [...new Set(value.map(item => this._inferValueType(item)))];
                if (itemTypes.length === 1) {
                    return `${itemTypes[0]}[]`;
                }
                return `array<${itemTypes.join("|")}>`;
            }
            if (typeof value === "string") {
                return "string";
            }
            if (typeof value === "number") {
                return "number";
            }
            if (typeof value === "boolean") {
                return "boolean";
            }
            if (value && typeof value === "object") {
                return "object";
            }
            return "unknown";
        },

        _compileSpecialConfigNotes(Shader) {
            if (!Shader || typeof Shader.type !== "function") {
                return [];
            }

            if (Shader.type() === "group") {
                return [
                    {
                        key: "shaders",
                        kind: "map",
                        usage: "Map of child shader id -> ShaderConfig. This is the nested layer collection rendered by the group."
                    },
                    {
                        key: "order",
                        kind: "string[]",
                        usage: "Optional child render order override inside the group. When omitted, the group falls back to Object.keys(shaders).",
                        overridesDefaultOrder: true,
                        targets: "group-children",
                        defaultBehavior: "Object.keys(shaders)"
                    },
                    {
                        key: "tiledImages",
                        kind: "special",
                        usage: "Unlike regular shader layers, the group shader does not usually consume tiled images directly. Child shaders define and use their own tiledImages."
                    },
                    {
                        key: "controls",
                        kind: "special",
                        usage: "Renderer-native controls are created for child shaders. The group shader itself is mainly a container and blend/composition stage."
                    }
                ];
            }

            return [];
        },

        _serializeDocsText(model) {
            const out = [];
            out.push(`Shader documentation`);
            out.push(`Version: ${model.version}`);
            out.push(`Generated at: ${model.generatedAt}`);
            out.push("");

            for (const shader of model.shaders) {
                out.push(`Shader: ${shader.name} [${shader.type}]`);
                if (shader.description) {
                    out.push(`Description: ${shader.description}`);
                }
                if (shader.intent) {
                    out.push(`Intent: ${shader.intent}`);
                }
                if (shader.expects) {
                    out.push(`Expects: ${JSON.stringify(shader.expects)}`);
                }
                if (shader.exampleParams !== undefined) {
                    out.push(`Example params: ${JSON.stringify(shader.exampleParams)}`);
                }
                if (Array.isArray(shader.controlCouplings) && shader.controlCouplings.length) {
                    out.push(`Control couplings:`);
                    for (const c of shader.controlCouplings) {
                        out.push(`- ${c.name} [${(c.controls || []).join(", ")}]: ${c.summary}`);
                    }
                }

                if (shader.sources.length) {
                    out.push(`Sources:`);
                    for (const src of shader.sources) {
                        out.push(`- Source ${src.index}: ${src.description || "No description"}` +
                            (src.acceptedChannelCounts ? ` | accepted channel counts: ${src.acceptedChannelCounts.join(", ")}` : ""));
                    }
                }

                if (shader.controls.length) {
                    out.push(`Controls:`);
                    for (const control of shader.controls) {
                        out.push(`- ${control.name}: supported ui types = ${control.supportedUiTypes.join(", ")}`);
                    }
                }

                if (shader.customParams.length) {
                    out.push(`Custom parameters:`);
                    for (const param of shader.customParams) {
                        const detail = [
                            param.type ? `type = ${param.type}` : "",
                            param.default !== undefined ? `default = ${JSON.stringify(param.default)}` : "",
                            param.required !== undefined ? `required = ${JSON.stringify(param.required)}` : ""
                        ].filter(Boolean).join(" | ");
                        out.push(`- ${param.name}: ${param.usage}${detail ? ` | ${detail}` : ""}`);
                    }
                }

                if (shader.classDocs && shader.classDocs.summary) {
                    out.push(`Class docs: ${shader.classDocs.summary}`);
                }

                if (shader.configNotes && shader.configNotes.length) {
                    out.push(`Configuration notes:`);
                    for (const note of shader.configNotes) {
                        out.push(`- ${note.key}${note.kind ? ` (${note.kind})` : ""}: ${note.usage}`);
                    }
                }

                out.push("");
            }

            return out.join("\n");
        },

        _inferCustomParamTypeFromValue(value) {
            if (Array.isArray(value) || value === null) {
                return "json";
            }
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                return typeof value;
            }
            if (typeof value === "object") {
                return "json";
            }
            return null;
        },

        _resolveCustomParamType(meta = {}) {
            if (meta && typeof meta.type === "string" && meta.type.trim()) {
                return meta.type.trim();
            }
            if (meta && meta.required && typeof meta.required === "object" &&
                typeof meta.required.type === "string" && meta.required.type.trim()) {
                return meta.required.type.trim();
            }
            if (meta && meta.default !== undefined) {
                return this._inferCustomParamTypeFromValue(meta.default) || "json";
            }
            if (meta && meta.required !== undefined) {
                return this._inferCustomParamTypeFromValue(meta.required) || "json";
            }
            return "json";
        },

        _compileCustomParamDescriptor(name, meta = {}) {
            return {
                name,
                type: this._resolveCustomParamType(meta),
                usage: (meta && meta.usage) || "",
                default: meta && meta.default !== undefined ? deepClone(meta.default) : undefined,
                required: meta && meta.required !== undefined ? deepClone(meta.required) : undefined
            };
        },

        _normalizeClassDocs(rawDocs, fallback = {}) {
            if (!rawDocs) {
                return null;
            }

            if (typeof rawDocs === "function") {
                rawDocs = rawDocs(fallback);
            }

            if (!rawDocs) {
                return null;
            }

            if (typeof rawDocs === "string") {
                return {
                    summary: rawDocs,
                    description: rawDocs
                };
            }

            if (typeof rawDocs !== "object") {
                return null;
            }

            const normalized = deepClone(rawDocs);
            if (!normalized.summary && normalized.description) {
                normalized.summary = String(normalized.description).split(/\n\s*\n/)[0].trim();
            }
            if (!normalized.description && normalized.summary) {
                normalized.description = normalized.summary;
            }

            if (fallback.type && normalized.type === undefined) {
                normalized.type = fallback.type;
            }
            if (fallback.name && normalized.name === undefined) {
                normalized.name = fallback.name;
            }
            if (fallback.kind && normalized.kind === undefined) {
                normalized.kind = fallback.kind;
            }

            return normalized;
        },

        _extractDocsProvider(subject, fallback = {}) {
            if (!subject) {
                return null;
            }

            if (typeof subject.docs === "function") {
                return this._normalizeClassDocs(subject.docs(subject, fallback), fallback);
            }

            if (typeof subject.docs === "object" || typeof subject.docs === "string") {
                return this._normalizeClassDocs(subject.docs, fallback);
            }

            if (typeof subject.getDocs === "function") {
                return this._normalizeClassDocs(subject.getDocs(subject, fallback), fallback);
            }

            return null;
        },

        _getShaderClassDocs(Shader) {
            if (!Shader || typeof Shader.type !== "function") {
                return null;
            }

            const fallback = {
                kind: "shader",
                type: Shader.type(),
                name: typeof Shader.name === "function" ? Shader.name() : Shader.type()
            };

            const explicit = this._extractDocsProvider(Shader, fallback);
            if (explicit) {
                return explicit;
            }

            const description = typeof Shader.description === "function" ? Shader.description() : "";
            return this._normalizeClassDocs({
                ...fallback,
                summary: description || `${fallback.name} shader`,
                description: description || `${fallback.name} shader.`,
                api: {
                    hasSources: typeof Shader.sources === "function",
                    hasDefaultControls: !!Shader.defaultControls,
                    hasCustomParams: !!Shader.customParams
                }
            }, fallback);
        },

        _getControlClassDocs(control) {
            if (!control) {
                return null;
            }

            const fallback = {
                kind: "ui-control",
                type: control.uiControlType || control.name,
                name: control.name || control.uiControlType
            };

            if (control.component) {
                const docs = this._extractDocsProvider(control.component, fallback);
                if (docs) {
                    return docs;
                }
            }

            const explicit = this._extractDocsProvider(control.constructor, fallback);
            if (explicit) {
                return explicit;
            }

            return this._normalizeClassDocs({
                ...fallback,
                summary: `${fallback.name || fallback.type} UI control`,
                description: `${fallback.name || fallback.type} UI control for GLSL type ${control.type}.`,
                api: {
                    glType: control.type,
                    supports: deepClone(control.supports || {})
                }
            }, fallback);
        },

        _renderDefaultShaderDoc(shader) {
            const card = document.createElement("div");
            card.className = "card bg-base-100 border border-base-300 shadow-sm";
            const preview = this._normalizePreviewDefinition(shader.preview, shader);

            card.innerHTML = `
<details class="bg-base-100">
  <summary class="flex cursor-pointer list-none flex-wrap items-start justify-between gap-4 p-4">
        <span class="min-w-[180px] flex-1">
            <span class="block text-lg font-semibold">${escapeHtml(shader.name)}</span>
            <span class="badge badge-outline mt-1">${escapeHtml(shader.type)}</span>
            <span class="mt-2 block text-sm opacity-80">${escapeHtml(shader.description || "")}</span>
        </span>
        ${this._renderShaderPreviewMarkup(preview, "rounded-box border border-base-300 max-w-[150px] max-h-[150px] shrink-0")}
  </summary>
  <div class="border-t border-base-300 p-4 text-sm">
    ${shader.intent ? `
    <div class="mb-3">
        <div class="font-semibold">Intent</div>
        <div>${escapeHtml(shader.intent)}</div>
    </div>` : ""}

    ${shader.expects ? `
    <div class="mb-3">
        <div class="font-semibold">Expects</div>
        <pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(shader.expects, null, 2))}</pre>
    </div>` : ""}

    ${shader.exampleParams !== undefined ? `
    <div class="mb-3">
        <div class="font-semibold">Example params</div>
        <pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(shader.exampleParams, null, 2))}</pre>
    </div>` : ""}

    ${Array.isArray(shader.controlCouplings) && shader.controlCouplings.length ? `
    <div class="mb-3">
        <div class="font-semibold">Control couplings</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Controls</th><th>Rule</th></tr></thead>
                <tbody>
                    ${shader.controlCouplings.map(c => `
                    <tr>
                        <td><code>${escapeHtml(c.name)}</code></td>
                        <td>${escapeHtml((c.controls || []).join(", "))}</td>
                        <td>${escapeHtml(c.summary || "")}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

     ${shader.sources.length ? `
    <div>
        <div class="mb-2 font-semibold">Sources</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>#</th><th>Description</th><th>Accepted channels</th></tr></thead>
                <tbody>
                    ${shader.sources.map(src => `
                    <tr>
                        <td>${src.index}</td>
                        <td>${escapeHtml(src.description || "")}</td>
                        <td>${src.acceptedChannelCounts ? escapeHtml(src.acceptedChannelCounts.join(", ")) : "any"}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

    ${shader.controls.length ? `
    <div class="mt-4">
        <div class="mb-2 font-semibold">Controls</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Supported UI types</th><th>Default</th></tr></thead>
                <tbody>
                    ${shader.controls.map(ctrl => `
                    <tr>
                        <td><code>${escapeHtml(ctrl.name)}</code></td>
                        <td>${escapeHtml(ctrl.supportedUiTypes.join(", "))}</td>
                        <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(ctrl.default || ctrl.required || {}, null, 2))}</pre></td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

    ${shader.customParams && shader.customParams.length ? `
    <div class="mt-4">
        <div class="mb-2 font-semibold">Custom Parameters</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Type</th><th>Usage</th><th>Default</th><th>Required</th></tr></thead>
                <tbody>
                    ${shader.customParams.map(param => `
                    <tr>
                        <td><code>${escapeHtml(param.name)}</code></td>
                        <td><code>${escapeHtml(param.type || "json")}</code></td>
                        <td>${escapeHtml(param.usage || "")}</td>
                        <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(param.default, null, 2))}</pre></td>
                        <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(param.required, null, 2))}</pre></td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

    ${shader.configNotes && shader.configNotes.length ? `
    <div class="mt-4">
        <div class="mb-2 font-semibold">Configuration notes</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Key</th><th>Kind</th><th>Usage</th></tr></thead>
                <tbody>
                    ${shader.configNotes.map(note => `
                    <tr>
                        <td><code>${escapeHtml(note.key)}</code></td>
                        <td>${escapeHtml(note.kind || "")}</td>
                        <td>${escapeHtml(note.usage || "")}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}
  </div>
</details>`;
            return card;
        },

        _renderInteractiveShell(node, Shader) {
            const shaderType = Shader.type();
            const preview = this._resolveShaderPreview(Shader);
            node.innerHTML = `
<div class="grid grid-cols-1 xl:grid-cols-[minmax(380px,540px)_1fr] gap-4" id="${this._uniqueId}_interactive_root">
    <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body gap-4">
            <div class="flex items-center justify-between gap-4">
                <div>
                    <div class="card-title">Shader configurator</div>
                    <div class="badge badge-primary">${escapeHtml(shaderType)}</div>
                </div>
                ${this._onControlSelectFinish ? `<button class="btn btn-primary btn-sm" id="${this._uniqueId}_done_btn">Done</button>` : ""}
            </div>
            <div class="alert alert-info text-sm">
                Renderer-native controls below are mounted by FlexRenderer itself.
                Meta-editors on the left change shader config and recompile the preview.
            </div>
            <div id="${this._uniqueId}_meta_editors" class="flex flex-col gap-3"></div>
        </div>
    </div>

    <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body gap-4">
            <div class="card-title">Renderer controls & preview</div>
            ${preview ? `<div class="flex items-center justify-center rounded-box bg-base-200 p-2">${this._renderShaderPreviewMarkup(preview, "rounded-box border border-base-300 max-h-[180px] w-auto")}</div>` : ""}
            <div id="${this._uniqueId}_native_controls" class="flex flex-col gap-3"></div>
            <div id="${this._uniqueId}_preview_host" class="min-h-[180px] flex items-center justify-center rounded-box bg-base-200 p-2"></div>
        </div>
    </div>
</div>`;

            const doneBtn = document.getElementById(`${this._uniqueId}_done_btn`);
            if (doneBtn && this._onControlSelectFinish) {
                doneBtn.addEventListener("click", () => {
                    this._onControlSelectFinish(this.getCurrentShaderConfig());
                });
            }
        },

        async _refreshInteractive() {
            if (!this._rootNode) {
                return;
            }

            const Shader = $.FlexRenderer.ShaderMediator.getClass(this.setup.shader.type);
            if (!Shader) {
                return;
            }

            const previewHost = document.getElementById(`${this._uniqueId}_preview_host`);
            await this._ensurePreviewSession(previewHost);
            const previewSize = getRenderableDimensions(this._renderData);
            await this._previewSession.setSize(previewSize.width, previewSize.height);
            await this._previewSession.setShader(this.setup.shader);

            this._renderMetaEditors(Shader);
            await this._renderInteractivePreview(previewHost, previewSize);
        },

        async _ensurePreviewSession(previewHost = undefined) {
            if (this._previewSession) {
                return;
            }

            const previewSize = getRenderableDimensions(this._renderData);
            const sessionOptions = {
                uniqueId: `${this._uniqueId}_preview`,
                width: previewSize.width,
                height: previewSize.height,
                controlMountResolver: () => document.getElementById(`${this._uniqueId}_native_controls`),
                previewHost,
                data: this._renderData,
                onVisualizationChanged: (shaderConfig, session) => {
                    this.setup.shader = deepClone(shaderConfig);
                    if (this._previewAdapter && typeof this._previewAdapter.onSessionVisualizationChanged === "function") {
                        this._previewAdapter.onSessionVisualizationChanged({
                            configurator: this,
                            session,
                            shaderConfig: this.getCurrentShaderConfig(),
                            data: this._renderData,
                            previewHost: document.getElementById(`${this._uniqueId}_preview_host`),
                            previewSize: getRenderableDimensions(this._renderData)
                        });
                    }
                }
            };

            if (this._previewAdapter && typeof this._previewAdapter.createSession === "function") {
                this._previewSession = await this._previewAdapter.createSession(sessionOptions);
            } else {
                this._previewSession = new PreviewSession(sessionOptions);
            }
        },

        async _renderInteractivePreview(previewHost, previewSize) {
            if (this._previewAdapter && typeof this._previewAdapter.render === "function") {
                const renderedPreview = await this._previewAdapter.render({
                    configurator: this,
                    session: this._previewSession,
                    shaderConfig: this.getCurrentShaderConfig(),
                    data: this._renderData,
                    previewHost,
                    previewSize
                });

                if (previewHost && isNode(renderedPreview) && renderedPreview.parentNode !== previewHost) {
                    previewHost.innerHTML = "";
                    previewHost.appendChild(renderedPreview);
                }
            } else if (previewHost) {
                if (this._previewSession.renderer.canvas.parentNode !== previewHost) {
                    previewHost.innerHTML = "";
                    previewHost.appendChild(this._previewSession.renderer.canvas);
                }
                this._previewSession.setSize(previewSize.width, previewSize.height);
            }
        },

        _resolvePreviewSrc(fileOrSrc) {
            if (!fileOrSrc) {
                return null;
            }
            const value = String(fileOrSrc);
            if (/^(?:data:|blob:|https?:|\/)/i.test(value)) {
                return value;
            }
            const basePath = this.previewAssets.basePath;
            if (!basePath) {
                return value;
            }
            return `${basePath.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
        },

        _normalizePreviewDefinition(preview, shaderMeta = {}) {
            if (!preview) {
                return null;
            }

            if (typeof preview === "function") {
                preview = preview(shaderMeta);
            }
            if (!preview) {
                return null;
            }

            const alt = preview.alt || `${shaderMeta.name || shaderMeta.type || "Shader"} preview`;

            if (typeof preview === "string") {
                return {
                    src: this._resolvePreviewSrc(preview),
                    alt
                };
            }
            if (preview.svg) {
                return {
                    src: svgToDataUri(preview.svg),
                    alt,
                    className: preview.className || ""
                };
            }
            if (preview.file) {
                return {
                    src: this._resolvePreviewSrc(preview.file),
                    alt,
                    className: preview.className || ""
                };
            }
            if (preview.src) {
                return {
                    src: this._resolvePreviewSrc(preview.src),
                    alt,
                    className: preview.className || ""
                };
            }
            return null;
        },

        _buildFallbackPreview(shaderMeta = {}) {
            const label = escapeHtml(shaderMeta.name || shaderMeta.type || "Shader");
            return this._normalizePreviewDefinition({
                svg: `
+<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-label="${label}">
+  <defs>
+    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
<stop offset="0%" stop-color="#1f2937"/>
<stop offset="100%" stop-color="#111827"/>
+    </linearGradient>
+  </defs>
+  <rect width="320" height="180" rx="18" fill="url(#g)"/>
+  <g fill="none" stroke="#60a5fa" stroke-width="10" opacity="0.9">
+    <path d="M24 126 C72 48, 122 48, 168 126 S264 204, 296 58"/>
+    <path d="M24 86 C72 150, 122 150, 168 86 S264 22, 296 122" opacity="0.55"/>
+  </g>
+  <rect x="20" y="20" width="112" height="30" rx="15" fill="#0f172a" stroke="#334155"/>
+  <text x="76" y="40" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#e5e7eb">${label}</text>
+</svg>`,
                alt: `${label} preview`
            }, shaderMeta);
        },

        _resolveShaderPreview(shaderLike) {
            if (!shaderLike) {
                return null;
            }

            const type = typeof shaderLike.type === "function" ? shaderLike.type() : shaderLike.type;
            const name = typeof shaderLike.name === "function" ? shaderLike.name() : shaderLike.name || type;
            const meta = { type, name };

            let preview = this.previewAssets.registry.get(type);
            if (!preview && typeof shaderLike.preview === "function") {
                preview = shaderLike.preview();
            } else if (!preview && shaderLike.preview) {
                preview = shaderLike.preview;
            }
            if (!preview && this.previewAssets.aliases[type]) {
                preview = { file: this.previewAssets.aliases[type] };
            }

            return this._normalizePreviewDefinition(preview, meta) || this._buildFallbackPreview(meta);
        },

        _renderShaderPreviewMarkup(preview, className = "") {
            const normalized = this._normalizePreviewDefinition(preview, {});
            if (!normalized || !normalized.src) {
                return "";
            }
            const classes = [normalized.className || "", className].filter(Boolean).join(" ").trim();
            return `<img alt="${escapeHtml(normalized.alt || "Shader preview")}" loading="lazy" decoding="async" class="${escapeHtml(classes)}" src="${escapeHtml(normalized.src)}">`;
        },

        _renderMetaEditors(Shader) {
            const mount = document.getElementById(`${this._uniqueId}_meta_editors`);
            if (!mount) {
                return;
            }
            mount.innerHTML = "";

            const supports = this.getAvailableControlsForShader(Shader);
            const defs = Shader.defaultControls || {};
            const customParams = Shader.customParams || {};

            for (const [controlName, supported] of Object.entries(supports)) {
                const current = this.setup.shader.params[controlName] || {};
                const requiredType = defs[controlName] && defs[controlName].required && typeof defs[controlName].required === "object" ?
                    defs[controlName].required.type : undefined;
                const defaultType = defs[controlName] && defs[controlName].default && typeof defs[controlName].default === "object" ?
                    defs[controlName].default.type : undefined;
                const activeType =
                    current.type ||
                    requiredType ||
                    defaultType ||
                    supported[0];

                if (!this.setup.shader.params[controlName]) {
                    this.setup.shader.params[controlName] = { type: activeType };
                } else if (!this.setup.shader.params[controlName].type) {
                    this.setup.shader.params[controlName].type = activeType;
                }

                const card = document.createElement("div");
                card.className = "card bg-base-200 border border-base-300 shadow-sm";

                const useSimple = this.renderStyle.ui(controlName) && !!this.interactiveRenderers.get(activeType);

                card.innerHTML = `
<div class="card-body p-4 gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
            <div class="font-semibold">Control <code>${escapeHtml(controlName)}</code></div>
            <div class="text-xs opacity-70">Supported: ${escapeHtml(supported.join(", "))}</div>
        </div>
        <div class="flex items-center gap-3">
            <label class="label cursor-pointer gap-2">
                <span class="label-text text-sm">Simple</span>
                <input type="checkbox" class="toggle toggle-sm" ${useSimple ? "checked" : ""} data-role="style-toggle">
            </label>
            <select class="select select-bordered select-sm" data-role="type-select">
                ${supported.map(type => `<option value="${escapeHtml(type)}" ${type === activeType ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}
            </select>
        </div>
    </div>
    <div data-role="simple-editor"></div>
    <details class="collapse collapse-arrow bg-base-100 border border-base-300">
        <summary class="collapse-title text-sm font-medium">JSON</summary>
        <div class="collapse-content">
            <textarea class="textarea textarea-bordered w-full h-40 font-mono text-xs" data-role="json-editor"></textarea>
        </div>
    </details>
</div>`;

                const typeSelect = card.querySelector(`[data-role="type-select"]`);
                const styleToggle = card.querySelector(`[data-role="style-toggle"]`);
                const simpleEditor = card.querySelector(`[data-role="simple-editor"]`);
                const jsonEditor = card.querySelector(`[data-role="json-editor"]`);

                jsonEditor.value = JSON.stringify(this.setup.shader.params[controlName], null, 2);

                typeSelect.addEventListener("change", () => {
                    this.refreshUserSelected(controlName, typeSelect.value);
                });

                styleToggle.addEventListener("change", () => {
                    this.refreshUserSwitched(controlName);
                });

                jsonEditor.addEventListener("change", () => {
                    this.refreshUserScripted(jsonEditor, controlName);
                });

                const renderer = this.interactiveRenderers.get(activeType);
                if (useSimple && renderer) {
                    const api = {
                        configurator: this,
                        controlName,
                        shaderConfig: this.setup.shader,
                        controlDefinition: defs[controlName],
                        controlConfig: this.setup.shader.params[controlName],
                        mount: simpleEditor,
                        update: (patch) => {
                            this.setup.shader.params[controlName] = {
                                ...this.setup.shader.params[controlName],
                                ...patch
                            };
                            this.refresh();
                        }
                    };

                    const rendered = typeof renderer === "function" ? renderer(api) : renderer.render(api);
                    if (typeof rendered === "string") {
                        simpleEditor.innerHTML = rendered;
                    } else if (isNode(rendered)) {
                        simpleEditor.appendChild(rendered);
                    }
                } else {
                    simpleEditor.innerHTML = `
<div class="alert alert-warning text-sm">
    No simple editor registered for <code>${escapeHtml(activeType)}</code>.
    Use JSON editor.
</div>`;
                }

                mount.appendChild(card);
            }

            for (const [paramName, meta] of Object.entries(customParams)) {
                const currentValue = this.setup.shader.params[paramName] !== undefined ?
                    this.setup.shader.params[paramName] :
                    (meta && meta.default);
                const inferredType = this._resolveCustomParamType({
                    ...(meta || {}),
                    default: currentValue
                });

                const card = document.createElement("div");
                card.className = "card bg-base-200 border border-base-300 shadow-sm";
                card.innerHTML = `
<div class="card-body p-4 gap-3">
    <div>
        <div class="font-semibold">Parameter <code>${escapeHtml(paramName)}</code></div>
        <div class="text-xs opacity-70">${escapeHtml((meta && meta.usage) || "")}</div>
        <div class="text-xs opacity-60">Type: <code>${escapeHtml(inferredType)}</code></div>
    </div>
    <div data-role="simple-editor"></div>
    <details class="collapse collapse-arrow bg-base-100 border border-base-300">
        <summary class="collapse-title text-sm font-medium">JSON</summary>
        <div class="collapse-content">
            <textarea class="textarea textarea-bordered w-full h-40 font-mono text-xs" data-role="json-editor"></textarea>
        </div>
    </details>
</div>`;

                const simpleEditor = card.querySelector(`[data-role="simple-editor"]`);
                const jsonEditor = card.querySelector(`[data-role="json-editor"]`);
                jsonEditor.value = JSON.stringify(currentValue, null, 2);
                jsonEditor.addEventListener("change", () => {
                    try {
                        this.setup.shader.params[paramName] = JSON.parse(jsonEditor.value);
                        jsonEditor.classList.remove("textarea-error");
                        this.refresh();
                    } catch (_) {
                        jsonEditor.classList.add("textarea-error");
                    }
                });

                const setValue = (value) => {
                    this.setup.shader.params[paramName] = value;
                    this.refresh();
                };

                if (inferredType === "string") {
                    simpleEditor.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Value</span></div>
    <input class="input input-bordered input-sm" type="text" value="${escapeHtml(currentValue === undefined ? "" : String(currentValue))}">
</label>`;
                    simpleEditor.querySelector("input").addEventListener("change", (e) => {
                        setValue(e.target.value);
                    });
                } else if (inferredType === "number") {
                    simpleEditor.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Value</span></div>
    <input class="input input-bordered input-sm" type="number" value="${escapeHtml(currentValue === undefined ? "" : String(currentValue))}">
</label>`;
                    simpleEditor.querySelector("input").addEventListener("change", (e) => {
                        setValue(Number(e.target.value));
                    });
                } else if (inferredType === "boolean") {
                    simpleEditor.innerHTML = `
<label class="label cursor-pointer justify-start gap-3">
    <input type="checkbox" class="toggle toggle-sm" ${currentValue ? "checked" : ""}>
    <span class="label-text">Enabled</span>
</label>`;
                    simpleEditor.querySelector("input").addEventListener("change", (e) => {
                        setValue(!!e.target.checked);
                    });
                } else {
                    simpleEditor.innerHTML = `
<div class="alert alert-warning text-sm">
    No simple typed editor available. Use JSON editor.
</div>`;
                }

                mount.appendChild(card);
            }
        },

        _buildControls() {
            if (this.__uicontrols) {
                return this.__uicontrols;
            }
            this.__uicontrols = {};

            const types = $.FlexRenderer.UIControls.types();
            const ShaderClass = $.FlexRenderer.ShaderMediator.getClass("identity");

            const fallbackLayer = new ShaderClass("id", {
                shaderConfig: {
                    id: "fallback__",
                    name: "Layer",
                    type: "identity",
                    visible: 1,
                    fixed: false,
                    tiledImages: [0],
                    params: {},
                    cache: {}
                },
                webglContext: {
                    supportedUseModes: ["show"],
                    includeGlobalCode: () => {}
                },
                params: {},
                interactive: false,
                invalidate: () => {},
                rebuild: () => {},
                refetch: () => {}
            });

            fallbackLayer.construct({}, [0]);

            for (let type of types) {
                const ctrl = $.FlexRenderer.UIControls.build(fallbackLayer, type, {
                    default: { type: type },
                    accepts: () => true
                }, Date.now(), {});

                const glType = ctrl.type;
                ctrl.name = type;
                if (!this.__uicontrols[glType]) {
                    this.__uicontrols[glType] = [];
                }
                this.__uicontrols[glType].push(ctrl);
            }

            return this.__uicontrols;
        }
    };

    // ---------------------------------------------------------------------
    // Optional default simple editors
    // ---------------------------------------------------------------------

    ShaderConfigurator.registerInteractiveRenderer("range", ({ mount, controlConfig, update }) => {
        const spec = controlConfig;
        const wrap = document.createElement("div");
        wrap.className = "flex flex-col gap-2";
        wrap.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Default</span></div>
    <input class="input input-bordered input-sm" type="number" value="${escapeHtml(spec.default || "")}">
</label>`;
        wrap.querySelector("input").addEventListener("change", (e) => {
            update({ default: Number(e.target.value) });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("range_input", ({ mount, controlConfig, update }) => {
        const spec = controlConfig;
        const wrap = document.createElement("div");
        wrap.className = "grid grid-cols-2 gap-2";
        wrap.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Default</span></div>
    <input class="input input-bordered input-sm" data-k="default" type="number" value="${escapeHtml(spec.default || "")}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Step</span></div>
    <input class="input input-bordered input-sm" data-k="step" type="number" value="${escapeHtml(spec.step || "")}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Min</span></div>
    <input class="input input-bordered input-sm" data-k="min" type="number" value="${escapeHtml(spec.min || "")}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Max</span></div>
    <input class="input input-bordered input-sm" data-k="max" type="number" value="${escapeHtml(spec.max || "")}">
</label>`;
        wrap.querySelectorAll("input").forEach(input => {
            input.addEventListener("change", () => {
                update({ [input.dataset.k]: Number(input.value) });
            });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("bool", ({ mount, controlConfig, update }) => {
        const wrap = document.createElement("label");
        wrap.className = "label cursor-pointer justify-start gap-3";
        wrap.innerHTML = `
<input type="checkbox" class="toggle toggle-sm" ${controlConfig.default ? "checked" : ""}>
<span class="label-text">Default enabled</span>`;
        wrap.querySelector("input").addEventListener("change", (e) => {
            update({ default: !!e.target.checked });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("color", ({ mount, controlConfig, update }) => {
        const wrap = document.createElement("label");
        wrap.className = "form-control";
        wrap.innerHTML = `
<div class="label"><span class="label-text">Default color</span></div>
<input type="color" class="input input-bordered input-sm p-1" value="${escapeHtml(controlConfig.default || "#ffffff")}">`;
        wrap.querySelector("input").addEventListener("change", (e) => {
            update({ default: e.target.value });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("select_int", ({ mount, controlConfig, update }) => {
        const options = Array.isArray(controlConfig.options) ? controlConfig.options : [];
        const wrap = document.createElement("div");
        wrap.className = "flex flex-col gap-2";
        wrap.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Default</span></div>
    <input class="input input-bordered input-sm" type="number" value="${escapeHtml(controlConfig.default || 0)}">
</label>
<details class="collapse collapse-arrow bg-base-100 border border-base-300">
    <summary class="collapse-title text-sm font-medium">Options</summary>
    <div class="collapse-content">
        <textarea class="textarea textarea-bordered w-full h-28 font-mono text-xs">${escapeHtml(JSON.stringify(options, null, 2))}</textarea>
    </div>
</details>`;
        const defaultInput = wrap.querySelector("input");
        const optionsArea = wrap.querySelector("textarea");

        defaultInput.addEventListener("change", () => {
            update({ default: Number(defaultInput.value) });
        });
        optionsArea.addEventListener("change", () => {
            update({ options: JSON.parse(optionsArea.value) });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("icon", ({ mount, controlConfig, update }) => {
        const iconSets = $.FlexRenderer.UIControls.IconLibrary.getSetNames();
        const wrap = document.createElement("div");
        wrap.className = "grid grid-cols-2 gap-2";
        wrap.innerHTML = `
<label class="form-control col-span-2">
    <div class="label"><span class="label-text">Default icon query</span></div>
    <input class="input input-bordered input-sm" data-k="default" type="text" value="${escapeHtml(controlConfig.default || "")}" placeholder="fa-house, &#xf015;, ★">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Icon set</span></div>
    <select class="select select-bordered select-sm" data-k="iconSet">
        ${iconSets.map(name => `<option value="${escapeHtml(name)}" ${name === (controlConfig.iconSet || "core") ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
    </select>
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Size</span></div>
    <input class="input input-bordered input-sm" data-k="size" type="number" min="16" value="${escapeHtml(controlConfig.size || 128)}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Padding</span></div>
    <input class="input input-bordered input-sm" data-k="padding" type="number" min="0" value="${escapeHtml(controlConfig.padding || 16)}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Color</span></div>
    <input class="input input-bordered input-sm p-1" data-k="color" type="color" value="${escapeHtml(controlConfig.color || "#111111")}">
</label>`;

        wrap.querySelectorAll("input, select").forEach(input => {
            input.addEventListener("change", () => {
                const key = input.dataset.k;
                const value = input.type === "number" ? Number(input.value) : input.value;
                update({ [key]: value });
            });
        });
        mount.appendChild(wrap);
    });

    OpenSeadragon.FlexRenderer.ShaderConfigurator = ShaderConfigurator;

})(OpenSeadragon);
