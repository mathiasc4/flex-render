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

    let AjvConstructor;
    const candidates = ["Ajv2020", "ajv2020", "Ajv", "ajv", "ajv7"];
    for (const name of candidates) {
        const cand = window[name];
        if (typeof cand === "function") {
            AjvConstructor = cand;
            break;
        }
        if (cand && typeof cand.default === "function") {
            AjvConstructor = cand.default;
            break;
        }
    }
    if (typeof AjvConstructor !== "function") {
        console.warn(
            "[flex renderer] AJV is not available on global scope (looked for " +
            "Ajv2020 / ajv2020 / Ajv / ajv / ajv7). Schema validation is disabled; the " +
            "playground review remains the gate."
        );
    }

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
                this.renderer.registerProgram(null, this.renderer.backend.secondPassProgramKey);
                this.renderer.useProgram(this.renderer.getProgram(this.renderer.backend.secondPassProgramKey), "second-pass");
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

            const modules = this._compileShaderModuleDescriptors();
            const controls = this._compileAvailableControls();

            const model = {
                version: 7,
                generatedAt: new Date().toISOString(),
                shaders,
                modules,
                controls
            };

            this._docsModel = model;
            return model;
        },

        compileConfigSchemaModel() {
            const availableShaders = $.FlexRenderer.ShaderMediator.availableShaders();
            const uiControlEnvelopes = this._compileJsonSchemaUiControlEnvelopes();
            const shaderModules = this._compileShaderModuleJsonSchemas();
            const shaderModuleGraph = this._compileShaderModuleGraphJsonSchema(shaderModules);
            const shaderLayerRefs = availableShaders.map(Shader => ({
                $ref: `#/$defs/shaderLayers/${Shader.type()}`
            }));
            const shaderLayers = {};

            for (const Shader of availableShaders) {
                const sources = typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
                shaderLayers[Shader.type()] = this._compileShaderLayerJsonSchema(
                    Shader,
                    sources,
                    uiControlEnvelopes,
                    shaderLayerRefs
                );
            }

            const schema = {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                $id: "https://flex-renderer/schemas/visualization-config/v3.json",
                title: "FlexRenderer visualization config",
                description: "Published JSON Schema for renderer visualization configuration.",
                type: "object",
                additionalProperties: false,
                required: ["shaders"],
                properties: {
                    order: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional top-level render order override. Defaults to Object.keys(shaders)."
                    },
                    shaders: {
                        type: "object",
                        additionalProperties: {
                            oneOf: deepClone(shaderLayerRefs)
                        },
                        description: "Map of shader id -> shader configuration object."
                    }
                },
                $defs: {
                    uiControlEnvelopes,
                    shaderLayers,
                    shaderModules,
                    shaderModuleGraph
                },
                "x-schemaVersion": 3,
                "x-generatedAt": new Date().toISOString()
            };

            this._assertPublishedExamplesValid(availableShaders, schema);
            return schema;
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
                corrective: c.corrective,
                controls: c.controls
            }));
        },

        /**
         * Canonical "what are the break positions on this `threshold` control value?".
         * Single source of truth for couplings and renderer-side syncing — the validator
         * and the shader's runtime sync logic must read through this so they cannot
         * disagree on what counts as a break.
         * Precedence: `value.breaks` first, then `value.default`, otherwise `[]`.
         */
        resolveEffectiveBreaks(thresholdValue) {
            if (!thresholdValue || typeof thresholdValue !== "object") {
                return [];
            }
            if (Array.isArray(thresholdValue.breaks)) {
                return thresholdValue.breaks;
            }
            if (Array.isArray(thresholdValue.default)) {
                return thresholdValue.default;
            }
            return [];
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
         * Walks each compiled shader entry and flags every key in `exampleParams`
         * that is not declared in `params.builtIns ∪ params.controls ∪ params.customParams`.
         * Returns a (possibly empty) list of `{ shaderType, key, allowed }` issues.
         * The published example must be a valid layer per its own schema; otherwise
         * a host that uses `exampleParams` as a template will produce layers that
         * fail their own coupling/key validation.
         */
        checkExampleParamsConsistency(shaders) {
            const issues = [];
            for (const shader of shaders || []) {
                const example = shader && shader.exampleParams;
                if (!example || typeof example !== "object") {
                    continue;
                }
                const params = shader.params || {};
                const allowed = new Set([
                    ...((params.builtIns || []).map(c => c.key)),
                    ...((params.controls || []).map(c => c.key)),
                    ...((params.customParams || []).map(c => c.key))
                ]);
                for (const key of Object.keys(example)) {
                    if (!allowed.has(key)) {
                        issues.push({ shaderType: shader.type, key, allowed: [...allowed] });
                    }
                }
            }
            return issues;
        },

        _compileExampleConsistencyInputs(ShaderClasses = []) {
            return (ShaderClasses || []).map(Shader => {
                const shaderType = Shader && typeof Shader.type === "function" ? Shader.type() : Shader && Shader.type;
                const sources = Shader && typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
                return {
                    type: shaderType,
                    exampleParams: Shader && typeof Shader.exampleParams === "function" ? Shader.exampleParams() : undefined,
                    params: this._compileShaderParamsSchema(Shader, sources)
                };
            });
        },

        _assertPublishedExamplesValid(ShaderClasses, schemaModel) {
            const issues = [];
            const compiledShaders = this._compileExampleConsistencyInputs(ShaderClasses);
            const keyIssues = this.checkExampleParamsConsistency(compiledShaders);
            for (const issue of keyIssues) {
                issues.push({
                    kind: "keys",
                    type: issue.shaderType,
                    key: issue.key,
                    allowed: issue.allowed
                });
            }

            const ajv = this._createSchemaAjv();
            for (const Shader of ShaderClasses || []) {
                const type = Shader && typeof Shader.type === "function" ? Shader.type() : Shader && Shader.type;
                if (!type) {
                    continue;
                }
                const layerSchema = schemaModel && schemaModel.$defs && schemaModel.$defs.shaderLayers &&
                    schemaModel.$defs.shaderLayers[type];
                const exampleLayer = layerSchema && layerSchema.examples && layerSchema.examples[0];
                if (!layerSchema || !exampleLayer) {
                    continue;
                }

                const validate = ajv.compile({
                    ...layerSchema,
                    $defs: deepClone((schemaModel && schemaModel.$defs) || {})
                });
                if (!validate(exampleLayer)) {
                    issues.push({
                        kind: "schema",
                        type,
                        errors: deepClone(validate.errors || [])
                    });
                }

                for (const coupling of this.getShaderCouplingValidators(type)) {
                    if (typeof coupling.validate !== "function") {
                        continue;
                    }
                    const outcome = coupling.validate(exampleLayer);
                    if (outcome && outcome.ok === false) {
                        issues.push({
                            kind: "coupling",
                            type,
                            coupling: coupling.name,
                            expected: deepClone(outcome.expected),
                            actual: deepClone(outcome.actual)
                        });
                    }
                }

                const exampleParams = exampleLayer && exampleLayer.params;
                if (exampleParams && typeof exampleParams === "object") {
                    for (const [paramKey, value] of Object.entries(exampleParams)) {
                        if (!value || typeof value !== "object" || Array.isArray(value)) {
                            continue;
                        }
                        const envelopeType = typeof value.type === "string" ? value.type : null;
                        if (!envelopeType) {
                            continue;
                        }
                        for (const coupling of this.getEnvelopeCouplingValidators(envelopeType)) {
                            if (typeof coupling.validate !== "function") {
                                continue;
                            }
                            const outcome = coupling.validate(value);
                            if (outcome && outcome.ok === false) {
                                issues.push({
                                    kind: "envelope-coupling",
                                    type,
                                    paramKey,
                                    envelope: envelopeType,
                                    coupling: coupling.name,
                                    expected: deepClone(outcome.expected),
                                    actual: deepClone(outcome.actual)
                                });
                            }
                        }
                    }
                }
            }

            if (!issues.length) {
                return;
            }
            throw new Error(
                "[FlexRenderer.ShaderConfigurator] published examples failed validation:\n" +
                issues.map(issue => `  ${JSON.stringify(issue)}`).join("\n")
            );
        },

        _createSchemaAjv() {
            if (!AjvConstructor) {
                throw new Error("[FlexRenderer.ShaderConfigurator] Ajv is required for published-example validation.");
            }
            return new AjvConstructor({
                allErrors: true,
                strict: false,
                schemaId: "auto"
            });
        },

        _warnIfExampleParamsInconsistent(shaders) {
            const issues = this.checkExampleParamsConsistency(shaders);
            if (!issues.length) {
                return;
            }
            const summary = issues.map(i => `${i.shaderType}.exampleParams.${i.key}`).join(", ");
            console.warn(
                `[FlexRenderer.ShaderConfigurator] exampleParams keys not present in published params schema: ${summary}. ` +
                `Hosts using exampleParams as a template will fail their own validation.`
            );
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
                corrective: c.corrective,
                controls: c.controls,
                validate: typeof c.validate === "function" ? c.validate : undefined
            }));
        },

        /**
         * Returns runtime coupling validators (with `validate` attached) for a UI
         * control envelope type (e.g. "colormap"). Hosts call this to validate any
         * value carrying that envelope `type` before submitting a layer. The schema
         * model surfaces the same entries (without `validate`) at
         * `$defs.uiControlEnvelopes[<type>]['x-controlCouplings']`.
         */
        getEnvelopeCouplingValidators(envelopeType) {
            if (!envelopeType) {
                return [];
            }
            const built = this._buildControls();
            for (const controls of Object.values(built)) {
                for (const control of controls) {
                    if (control && control.uiControlType === envelopeType) {
                        const Klass = control.constructor;
                        if (!Klass || typeof Klass.controlCouplings !== "function") {
                            return [];
                        }
                        const raw = Klass.controlCouplings();
                        if (!Array.isArray(raw)) {
                            return [];
                        }
                        return raw.map(c => ({
                            name: c.name,
                            summary: c.summary,
                            corrective: c.corrective,
                            controls: c.controls,
                            validate: typeof c.validate === "function" ? c.validate : undefined
                        }));
                    }
                }
            }
            return [];
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

            const modulesSection = document.createElement("section");
            modulesSection.className = "flex flex-col gap-4";
            modulesSection.innerHTML = `<h3 class="text-xl font-semibold">Available shader modules</h3>`;

            for (const module of model.modules || []) {
                const customModuleRenderer = this.docsRenderers.get("module");
                let rendered = null;
                if (customModuleRenderer) {
                    rendered = customModuleRenderer({ configurator: this, module, model });
                }
                modulesSection.appendChild(isNode(rendered) ? rendered : this._renderDefaultModuleDoc(module));
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
            if ((model.modules || []).length) {
                root.appendChild(modulesSection);
            }
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
                supportedTypes: supports[name],
                default: (defs[name] && defs[name].default) || null,
                required: (defs[name] && defs[name].required) || null
            }));
        },

        _compileShaderModuleDescriptors() {
            const Mediator = $.FlexRenderer.ShaderModuleMediator;

            if (!Mediator || typeof Mediator.availableModules !== "function") {
                return [];
            }

            return Mediator.availableModules().map(Module =>
                this._compileShaderModuleDescriptor(Module)
            );
        },

        _compileShaderModuleDescriptor(Module) {
            const type = Module.type();
            const inputs = typeof Module.inputs === "function" ? (Module.inputs() || {}) : {};
            const outputs = typeof Module.outputs === "function" ? (Module.outputs() || {}) : {};

            return {
                type,
                name: typeof Module.name === "function" ? Module.name() : type,
                description: typeof Module.description === "function" ? Module.description() : "",
                inputs: this._compileShaderModulePortDescriptors(inputs),
                outputs: this._compileShaderModulePortDescriptors(outputs, { allowMultipleTypes: true }),
                controls: this._compileShaderModuleControlDescriptors(Module),
                classDocs: this._getModuleClassDocs(Module)
            };
        },

        _compileShaderModulePortType(port, allowMultipleTypes = false) {
            const raw = port && port.type !== undefined ? port.type : "unknown";
            const values = Array.isArray(raw) ? raw : [raw];
            const normalized = values
                .filter(type => typeof type === "string" && type)
                .map(type => type.trim())
                .filter(Boolean);

            if (allowMultipleTypes) {
                return normalized.length ? [...new Set(normalized)] : ["unknown"];
            }

            return normalized.length ? normalized[0] : "unknown";
        },

        _compileShaderModulePortDescriptors(ports = {}, options = {}) {
            return Object.entries(ports || {}).map(([name, port]) => ({
                name,
                type: this._compileShaderModulePortType(port, options.allowMultipleTypes === true),
                required: !!(port && port.required),
                default: port && port.default !== undefined ? deepClone(port.default) : undefined,
                description: (port && port.description) || ""
            }));
        },

        _compileShaderModuleControlDescriptors(Module) {
            return this._compileControlDescriptorsFromDefinitions(Module.defaultControls || {});
        },

        _compileControlDescriptorsFromDefinitions(defs = {}) {
            const uiControls = this._buildControls();
            const result = {};

            for (const [controlName, controlConfig] of Object.entries(defs || {})) {
                if (controlName.startsWith("use_") || controlConfig === false) {
                    continue;
                }

                const supported = [];

                if (controlConfig && controlConfig.required && controlConfig.required.type) {
                    supported.push(controlConfig.required.type);
                } else if (controlConfig && typeof controlConfig.accepts === "function") {
                    for (const glType in uiControls) {
                        for (const existing of uiControls[glType]) {
                            if (controlConfig.accepts(glType, existing)) {
                                supported.push(existing.name);
                            }
                        }
                    }
                }

                result[controlName] = [...new Set(supported)];
            }

            return Object.keys(result).map(name => {
                const def = defs[name] || {};

                return {
                    name,
                    supportedTypes: result[name],
                    default: def.default !== undefined ? deepClone(def.default) : null,
                    required: def.required !== undefined ? deepClone(def.required) : null
                };
            });
        },

        _compileShaderModuleJsonSchemas() {
            const Mediator = $.FlexRenderer.ShaderModuleMediator;
            const schemas = {};

            if (!Mediator || typeof Mediator.availableModules !== "function") {
                return schemas;
            }

            for (const Module of Mediator.availableModules()) {
                schemas[Module.type()] = this._compileShaderModuleNodeJsonSchema(Module);
            }

            return schemas;
        },

        _compileShaderModuleNodeJsonSchema(Module) {
            const type = Module.type();
            const name = typeof Module.name === "function" ? Module.name() : type;
            const description = typeof Module.description === "function" ? Module.description() : "";
            const inputs = typeof Module.inputs === "function" ? (Module.inputs() || {}) : {};
            const outputs = typeof Module.outputs === "function" ? (Module.outputs() || {}) : {};
            const inputProperties = {};
            const requiredInputs = [];

            for (const [inputName, input] of Object.entries(inputs)) {
                inputProperties[inputName] = this._compileShaderModuleRefJsonSchema(
                    `Input reference for '${inputName}'.`
                );

                if (input && input.required) {
                    requiredInputs.push(inputName);
                }
            }

            const required = ["type"];
            const inputSchema = {
                type: "object",
                additionalProperties: false,
                properties: inputProperties,
                description: "Input edge references keyed by module input port name."
            };

            if (requiredInputs.length) {
                inputSchema.required = requiredInputs;
                required.push("inputs");
            }

            const schema = {
                type: "object",
                additionalProperties: false,
                required,
                properties: {
                    type: { const: type },
                    inputs: inputSchema,
                    params: {
                        type: "object",
                        description: "Module-local compile-time params and initial module control values."
                    }
                },
                title: name,
                description,
                "x-docs": this._getModuleClassDocs(Module),
                "x-inputs": this._compileShaderModulePortDescriptors(inputs),
                "x-outputs": this._compileShaderModulePortDescriptors(outputs, { allowMultipleTypes: true }),
                "x-controls": this._compileShaderModuleControlDescriptors(Module)
            };

            return schema;
        },

        _compileShaderModuleGraphJsonSchema(shaderModules = {}) {
            const moduleTypes = Object.keys(shaderModules).sort();
            const moduleRefs = moduleTypes.map(type => ({
                $ref: `#/$defs/shaderModules/${type}`
            }));

            return {
                type: "object",
                additionalProperties: false,
                required: ["nodes", "output"],
                properties: {
                    version: {
                        type: "integer",
                        minimum: 1,
                        description: "Optional graph config version."
                    },
                    nodes: {
                        type: "object",
                        additionalProperties: moduleRefs.length ? { oneOf: moduleRefs } : { type: "object" },
                        description: "Map of graph node id -> registered ShaderModule node config."
                    },
                    output: this._compileShaderModuleRefJsonSchema(
                        "Final graph output reference in nodeId.portName form."
                    )
                },
                description: "Typed ShaderModule DAG compiled by ModularShaderLayer.",
                "x-moduleTypes": moduleTypes
            };
        },

        _compileShaderModuleRefJsonSchema(description) {
            return {
                type: "string",
                pattern: "^[A-Za-z0-9_]+\\.[A-Za-z0-9_]+$",
                description: description || "Graph reference in nodeId.portName form."
            };
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
                    type: ctrl.uiControlType,
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
                    type: ctrl.uiControlType,
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
                            type: control.uiControlType,
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
                        key: "dataReferences",
                        type: "number[]",
                        required: false,
                        usage: "Persisted-config source indexes that hosts may resolve to tiledImages before rendering."
                    },
                    {
                        key: "params",
                        type: "object",
                        required: false,
                        usage: "Shader-specific settings, built-in use_* options, UI-control configs, and custom parameters."
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

        _compileJsonSchemaUiControlEnvelopes() {
            const built = this._buildControls();
            const envelopes = {};

            for (const controls of Object.values(built)) {
                for (const control of controls) {
                    const type = control && control.uiControlType;
                    if (!type || envelopes[type]) {
                        continue;
                    }
                    envelopes[type] = this._compileJsonSchemaUiControlEnvelope(control);
                }
            }

            return envelopes;
        },

        _compileJsonSchemaUiControlEnvelope(control) {
            const docs = this._getControlClassDocs(control) || {};
            const shape = this._compileControlConfigShape(control);
            const properties = {
                type: { const: control.uiControlType }
            };
            const required = ["type"];

            for (const [key, value] of Object.entries(shape || {})) {
                if (key === "type") {
                    continue;
                }
                properties[key] = this._compileJsonSchemaFromDescriptor(value);
            }

            const envelope = {
                type: "object",
                additionalProperties: false,
                required,
                properties,
                description: docs.description || docs.summary ||
                    `${control.uiControlType} control envelope. The 'type' field discriminates the UI control kind; it is distinct from the parent shader layer's own 'type' field by virtue of nesting depth.`,
                "x-glType": control.type
            };

            const envelopeCouplings = this._serializeEnvelopeControlCouplings(control);
            if (Array.isArray(envelopeCouplings) && envelopeCouplings.length) {
                envelope["x-controlCouplings"] = envelopeCouplings;
            }

            return envelope;
        },

        /**
         * Serialization-friendly view of a UI control class's envelope-level
         * `controlCouplings()`. Mirrors `_serializeControlCouplings` for shaders.
         * The class itself (not the instance) carries the static method.
         */
        _serializeEnvelopeControlCouplings(control) {
            const Klass = control && control.constructor;
            if (!Klass || typeof Klass.controlCouplings !== "function") {
                return undefined;
            }
            const raw = Klass.controlCouplings();
            if (!Array.isArray(raw) || raw.length === 0) {
                return undefined;
            }
            return raw.map(c => ({
                name: c.name,
                summary: c.summary,
                corrective: c.corrective,
                controls: deepClone(c.controls || [])
            }));
        },

        _compileShaderLayerJsonSchema(Shader, sources, uiControlEnvelopes, shaderLayerRefs) {
            const shaderType = Shader.type();
            const name = typeof Shader.name === "function" ? Shader.name() : shaderType;
            const description = typeof Shader.description === "function" ? Shader.description() : "";
            const properties = {
                id: { type: "string" },
                name: { type: "string" },
                type: { const: shaderType },
                visible: {
                    type: ["number", "boolean"]
                },
                fixed: { type: "boolean" },
                tiledImages: {
                    type: "array",
                    items: { type: "integer", minimum: 0 },
                    description: "Renderer form: OSD world indices the shader samples from. Use this when assembling renderer config directly (e.g. via overrideConfigureAll). The host's normalizer also accepts dataReferences and resolves them to tiledImages at render time."
                },
                dataReferences: {
                    type: "array",
                    items: { type: "integer", minimum: 0 },
                    description: "Persisted-config form: indices into config.data the shader samples from. Hosts (e.g. xOpat) resolve these to tiledImages at open time. Either tiledImages OR dataReferences (or both, when they agree) is acceptable; tiledImages takes precedence at the renderer boundary."
                }
            };

            if (Shader.type() === "group") {
                properties.order = {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional child render order override inside the group. Defaults to Object.keys(shaders)."
                };
                properties.shaders = {
                    type: "object",
                    additionalProperties: {
                        oneOf: deepClone(shaderLayerRefs)
                    }
                };
            }

            const paramsSchema = this._compileShaderParamsJsonSchema(
                Shader,
                sources,
                uiControlEnvelopes
            );
            if (Object.keys(paramsSchema.properties || {}).length > 0) {
                properties.params = paramsSchema;
            }

            const schema = {
                type: "object",
                additionalProperties: false,
                required: ["type"],
                properties,
                title: name,
                description: this._buildShaderSchemaDescription(Shader, description),
                "x-sources": (sources || []).map((src, index) => ({
                    index,
                    description: src.description || "",
                    acceptedChannelCounts: this._probeAcceptedChannelCounts(src)
                })),
                "x-controlCouplings": this._compileJsonSchemaControlCouplings(Shader)
            };

            const intent = typeof Shader.intent === "function" ? Shader.intent() : undefined;
            if (intent) {
                schema["x-intent"] = intent;
            }
            const expects = this._resolveShaderSchemaExpects(Shader, sources);
            if (expects) {
                schema["x-expects"] = expects;
            }

            const examples = this._buildShaderLayerExamples(Shader, sources);
            if (examples.length) {
                schema.examples = examples;
            }

            return schema;
        },

        _compileShaderParamsJsonSchema(Shader, sources, uiControlEnvelopes) {
            const compiled = this._compileShaderParamsSchema(Shader, sources);
            const properties = {};

            for (const item of compiled.builtIns || []) {
                properties[item.key] = this._compileBuiltInParamJsonSchema(item);
            }

            for (const control of compiled.controls || []) {
                properties[control.key] = this._compileControlParamJsonSchema(control, uiControlEnvelopes);
            }

            for (const item of compiled.customParams || []) {
                properties[item.key] = this._compileCustomParamJsonSchema(Shader, item);
            }

            return {
                type: "object",
                additionalProperties: false,
                properties
            };
        },

        _compileControlParamJsonSchema(control, uiControlEnvelopes) {
            const normalizedTypes = (control.supportedTypes || [])
                .map(type => this._normalizePublishedControlType(type))
                .filter(type => !!uiControlEnvelopes[type]);
            const primitiveSchemas = this._compileControlPrimitiveSchemasFromEnvelopes(normalizedTypes, uiControlEnvelopes);
            const refs = normalizedTypes.map(type => ({ $ref: `#/$defs/uiControlEnvelopes/${type}` }));
            const variants = primitiveSchemas.concat(refs);

            if (!variants.length) {
                return {};
            }
            if (variants.length === 1) {
                return variants[0];
            }
            return { anyOf: variants };
        },

        _normalizePublishedControlType(type) {
            if (!type) {
                return type;
            }
            if ($.FlexRenderer.UIControls && $.FlexRenderer.UIControls._items && $.FlexRenderer.UIControls._items[type]) {
                const item = $.FlexRenderer.UIControls._items[type];
                return item.type || type;
            }
            return type;
        },

        _compileControlPrimitiveSchemasFromEnvelopes(types, uiControlEnvelopes) {
            const seen = new Set();
            const schemas = [];

            for (const type of types || []) {
                const envelope = uiControlEnvelopes[type];
                const defaultSchema = envelope && envelope.properties && envelope.properties.default;
                const primitiveSchema = this._compilePrimitiveSchemaFromEnvelopeDefault(type, defaultSchema);
                if (!primitiveSchema) {
                    continue;
                }
                const key = JSON.stringify(primitiveSchema);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                schemas.push(primitiveSchema);
            }

            return schemas;
        },

        _compilePrimitiveSchemaFromEnvelopeDefault(type, defaultSchema) {
            if (!defaultSchema || !defaultSchema.type) {
                return null;
            }

            const normalizedType = Array.isArray(defaultSchema.type)
                ? defaultSchema.type[0]
                : defaultSchema.type;

            if (type === "color") {
                return {
                    type: "string",
                    pattern: "^#[0-9a-fA-F]{6,8}$"
                };
            }

            switch (normalizedType) {
                case "string":
                    return { type: "string" };
                case "integer":
                case "number":
                    return { type: "number" };
                case "boolean":
                    return { type: "boolean" };
                case "array":
                    return { type: "array" };
                default:
                    return null;
            }
        },

        _compileSchemaFromSampleValue(value) {
            if (value === null) {
                return { type: "null" };
            }
            if (Array.isArray(value)) {
                const itemSchemas = value
                    .map(item => this._compileSchemaFromSampleValue(item))
                    .filter(Boolean);
                const samePrimitiveType = itemSchemas.length > 0 &&
                    itemSchemas.every(schema => schema.type && schema.type === itemSchemas[0].type);

                return samePrimitiveType
                    ? { type: "array", items: { type: itemSchemas[0].type } }
                    : { type: "array" };
            }
            if (typeof value === "string") {
                return { type: "string" };
            }
            if (typeof value === "number") {
                return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
            }
            if (typeof value === "boolean") {
                return { type: "boolean" };
            }
            if (typeof value === "object") {
                return { type: "object" };
            }
            return null;
        },

        _compileBuiltInParamJsonSchema(item) {
            let schema;
            if (item.allowedValues) {
                schema = { enum: deepClone(item.allowedValues) };
            } else if (item.key && item.key.startsWith("use_channel_base")) {
                schema = {
                    type: "integer",
                    minimum: 0
                };
            } else {
                schema = this._compileTypeExpressionSchema(item.type, firstDefined(item.required, item.default));
            }

            if (item.default === null) {
                schema = this._withNullableSchema(schema);
            }

            if (item.default !== undefined) {
                schema.default = deepClone(item.default);
            }
            if (item.usage) {
                schema.description = item.usage;
            }
            return schema;
        },

        _compileCustomParamJsonSchema(Shader, item) {
            const schema = this._compileSpecialCustomParamJsonSchema(Shader, item) ||
                this._compileTypeExpressionSchema(item.type, firstDefined(item.required, item.default));
            if (item.default !== undefined && item.default !== null) {
                schema.default = deepClone(item.default);
            }
            if (item.usage) {
                schema.description = item.usage;
            }
            return schema;
        },

        _compileSpecialCustomParamJsonSchema(Shader, item) {
            const shaderType = Shader && typeof Shader.type === "function" ? Shader.type() : "";

            if (shaderType === "modular" && item.key === "graph") {
                return {
                    $ref: "#/$defs/shaderModuleGraph"
                };
            }

            if (shaderType === "time-series" && item.key === "series") {
                return {
                    type: "array",
                    items: {
                        oneOf: [
                            { type: "integer", minimum: 0 },
                            { type: "string" },
                            { type: "object" }
                        ]
                    }
                };
            }
            if (shaderType === "channel-series" && item.key === "channelRendererConfig") {
                return {
                    type: "object"
                };
            }
            if (shaderType === "channel-series" && item.key === "sourceIndex") {
                return {
                    type: "integer",
                    minimum: 0
                };
            }
            return null;
        },

        _compileJsonSchemaFromDescriptor(descriptor) {
            const schema = this._compileTypeExpressionSchema(
                descriptor && descriptor.type,
                descriptor && descriptor.default
            );

            if (descriptor && descriptor.default !== undefined) {
                schema.default = deepClone(descriptor.default);
            }
            if (descriptor && descriptor.default === null) {
                return this._withNullableSchema(schema);
            }
            if (descriptor && descriptor.allowedValues) {
                schema.enum = deepClone(descriptor.allowedValues);
            }
            if (descriptor && descriptor.examples) {
                schema.examples = deepClone(descriptor.examples);
            }
            if (descriptor && descriptor.usage) {
                schema.description = descriptor.usage;
            }
            return schema;
        },

        _compileTypeExpressionSchema(typeExpression, sampleValue = undefined) {
            if (!typeExpression || typeExpression === "unknown" || typeExpression === "json") {
                return {};
            }

            if (typeExpression.endsWith("[]")) {
                return {
                    type: "array",
                    items: this._compileTypeExpressionSchema(typeExpression.slice(0, -2))
                };
            }

            const arrayMatch = typeExpression.match(/^array<(.*)>$/);
            if (arrayMatch) {
                return {
                    type: "array",
                    items: this._compileTypeExpressionSchema(arrayMatch[1])
                };
            }

            const parts = typeExpression.split("|").map(part => part.trim()).filter(Boolean);
            if (parts.length > 1) {
                const schemas = parts.map(part => this._compileTypeExpressionSchema(part, sampleValue));
                const simpleTypes = schemas.every(schema =>
                    schema &&
                    Object.keys(schema).length === 1 &&
                    typeof schema.type === "string"
                );
                if (simpleTypes) {
                    return {
                        type: schemas.map(schema => schema.type)
                    };
                }
                return { oneOf: schemas };
            }

            switch (typeExpression) {
                case "string":
                    return { type: "string" };
                case "number":
                    return Number.isInteger(sampleValue) ? { type: "integer" } : { type: "number" };
                case "boolean":
                    return { type: "boolean" };
                case "null":
                    return { type: "null" };
                case "array":
                    return { type: "array" };
                case "object":
                    return { type: "object" };
                case "integer":
                    return { type: "integer" };
                default:
                    return {};
            }
        },

        _withNullableSchema(schema = {}) {
            if (schema.type && typeof schema.type === "string") {
                return {
                    ...schema,
                    type: [schema.type, "null"]
                };
            }
            if (Array.isArray(schema.type) && !schema.type.includes("null")) {
                return {
                    ...schema,
                    type: schema.type.concat(["null"])
                };
            }
            return schema;
        },

        _buildShaderLayerExamples(Shader, sources) {
            let exampleParams;
            if (Shader && typeof Shader.exampleParams === "function") {
                exampleParams = Shader.exampleParams();
            }
            if (!exampleParams || typeof exampleParams !== "object") {
                exampleParams = this._synthesizeExampleParamsFromDefaults(Shader, sources);
            }
            if (!exampleParams || typeof exampleParams !== "object") {
                return [];
            }

            const example = {
                id: `${Shader.type()}_example`,
                type: Shader.type()
            };

            if (sources && sources.length) {
                example.tiledImages = sources.map((_, index) => index);
            }
            if (Shader.type() === "group" && exampleParams.shaders) {
                Object.assign(example, deepClone(exampleParams));
            } else {
                example.params = deepClone(exampleParams);
            }

            return [example];
        },

        _synthesizeExampleParamsFromDefaults(Shader, sources) {
            if (!Shader || typeof Shader.type !== "function") {
                return null;
            }
            if (Shader.type() === "group") {
                return {
                    shaders: {
                        child_1: {  // eslint-disable-line camelcase
                            type: "identity",
                            params: {
                                use_channel0: "r" // eslint-disable-line camelcase
                            }
                        }
                    },
                    order: ["child_1"]
                };
            }
            if (Shader.type() === "time-series") {
                return {
                    seriesRenderer: "identity",
                    series: [0],
                    timeline: {
                        type: "range_input",
                        default: 0,
                        min: 0,
                        max: 0,
                        step: 1
                    }
                };
            }

            const params = {};
            const compiled = this._compileShaderParamsSchema(Shader, sources);
            for (const builtIn of compiled.builtIns || []) {
                if (builtIn.default !== undefined && builtIn.default !== null) {
                    params[builtIn.key] = deepClone(builtIn.default);
                }
            }
            for (const control of this._compileControlDescriptors(Shader)) {
                const seed = firstDefined(control.required, control.default);
                if (seed !== undefined && seed !== null) {
                    params[control.name] = deepClone(seed);
                }
            }
            for (const [name, meta] of Object.entries(Shader.customParams || {})) {
                if (meta && meta.default !== undefined) {
                    params[name] = deepClone(meta.default);
                }
            }
            return Object.keys(params).length ? params : {};
        },

        _compileJsonSchemaControlCouplings(Shader) {
            const couplings = this._serializeControlCouplings(Shader);
            if (!Array.isArray(couplings) || !couplings.length) {
                return [];
            }
            return couplings.map(coupling => ({
                name: coupling.name,
                summary: coupling.summary,
                controls: deepClone(coupling.controls || [])
            }));
        },

        _buildShaderSchemaDescription(Shader, description) {
            const type = Shader && typeof Shader.type === "function" ? Shader.type() : "";
            if (type === "time-series" || type === "channel-series") {
                return `${description} Wrapper-specific settings live under params alongside built-ins and UI controls.`;
            }
            return description;
        },

        _resolveShaderSchemaExpects(Shader, sources = []) {
            if (Shader && typeof Shader.expects === "function") {
                const explicit = Shader.expects();
                if (explicit && explicit.dataKind) {
                    return explicit;
                }
            }

            const type = Shader && typeof Shader.type === "function" ? Shader.type() : "";
            if (type === "group" || type === "time-series" || type === "channel-series") {
                return { dataKind: "any", channels: "any" };
            }

            const accepted = (sources || [])
                .map(src => this._probeAcceptedChannelCounts(src))
                .filter(values => Array.isArray(values) && values.length);
            if (!accepted.length) {
                return null;
            }
            const first = accepted[0];
            if (first.length === 1 && first[0] === 1) {
                return { dataKind: "scalar", channels: 1 };
            }
            if (first.length === 1 && first[0] === 3) {
                return { dataKind: "rgb", channels: 3 };
            }
            if (first.length === 1 && first[0] === 4) {
                return { dataKind: "rgb", channels: 4 };
            }
            return { dataKind: "multi-channel", channels: "any" };
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
                supportedTypes: control.supportedTypes,
                defaultControlConfig: control.default !== null ? deepClone(control.default) : null,
                requiredControlConfig: control.required !== null ? deepClone(control.required) : null,
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
                builtIns: [
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
                        type: control.uiControlType,
                        typedef: this._getControlTypedefId(control),
                        config: this._compileControlConfigShape(control)
                    });
                }
            }

            return out;
        },

        _getControlTypedefId(control) {
            const type = control && control.uiControlType ? control.uiControlType : "unknown";
            const glType = control && control.type ? control.type : "unknown";
            return `control:${type}:${glType}`;
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
                        out.push(`- ${control.name}: supported ui types = ${control.supportedTypes.join(", ")}`);
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

            if (Array.isArray(model.modules) && model.modules.length) {
                out.push(`Shader modules`);
                out.push("");

                for (const module of model.modules) {
                    out.push(`Module: ${module.name} [${module.type}]`);

                    if (module.description) {
                        out.push(`Description: ${module.description}`);
                    }

                    if (Array.isArray(module.inputs) && module.inputs.length) {
                        out.push(`Inputs:`);
                        for (const input of module.inputs) {
                            out.push(`- ${input.name}: ${input.type}` +
                                (input.required ? " | required" : "") +
                                (input.description ? ` | ${input.description}` : ""));
                        }
                    }

                    if (Array.isArray(module.outputs) && module.outputs.length) {
                        out.push(`Outputs:`);
                        for (const output of module.outputs) {
                            out.push(`- ${output.name}: ${output.type}` +
                                (output.description ? ` | ${output.description}` : ""));
                        }
                    }

                    if (Array.isArray(module.controls) && module.controls.length) {
                        out.push(`Controls:`);
                        for (const control of module.controls) {
                            out.push(`- ${control.name}: supported ui types = ${control.supportedTypes.join(", ")}`);
                        }
                    }

                    if (module.classDocs && module.classDocs.summary) {
                        out.push(`Class docs: ${module.classDocs.summary}`);
                    }

                    out.push("");
                }
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

        _getModuleClassDocs(Module) {
            if (!Module || typeof Module.type !== "function") {
                return null;
            }

            const fallback = {
                kind: "shader-module",
                type: Module.type(),
                name: typeof Module.name === "function" ? Module.name() : Module.type()
            };

            const explicit = this._extractDocsProvider(Module, fallback);
            if (explicit) {
                return explicit;
            }

            const description = typeof Module.description === "function" ? Module.description() : "";
            return this._normalizeClassDocs({
                ...fallback,
                summary: description || `${fallback.name} shader module`,
                description: description || `${fallback.name} shader module.`,
                api: {
                    hasInputs: typeof Module.inputs === "function",
                    hasOutputs: typeof Module.outputs === "function",
                    hasDefaultControls: !!Module.defaultControls
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
<td>${escapeHtml(ctrl.supportedTypes.join(", "))}</td>
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

        _renderDefaultModuleDoc(module) {
            const card = document.createElement("div");
            card.className = "card bg-base-100 border border-base-300 shadow-sm";

            card.innerHTML = `
<details class="bg-base-100">
  <summary class="flex cursor-pointer list-none flex-wrap items-start justify-between gap-4 p-4">
        <span class="min-w-[180px] flex-1">
            <span class="block text-lg font-semibold">${escapeHtml(module.name)}</span>
            <span class="badge badge-outline mt-1">${escapeHtml(module.type)}</span>
            <span class="mt-2 block text-sm opacity-80">${escapeHtml(module.description || "")}</span>
        </span>
  </summary>
  <div class="border-t border-base-300 p-4 text-sm">
    ${module.classDocs && module.classDocs.description ? `
    <div class="mb-3">
        <div class="font-semibold">Description</div>
        <div>${escapeHtml(module.classDocs.description)}</div>
    </div>` : ""}

    ${module.inputs && module.inputs.length ? `
    <div>
        <div class="mb-2 font-semibold">Inputs</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
                <tbody>
                    ${module.inputs.map(input => `
                    <tr>
                        <td><code>${escapeHtml(input.name)}</code></td>
                        <td><code>${escapeHtml(input.type || "unknown")}</code></td>
                        <td>${input.required ? "yes" : "no"}</td>
                        <td>${escapeHtml(input.description || "")}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

    ${module.outputs && module.outputs.length ? `
    <div class="mt-4">
        <div class="mb-2 font-semibold">Outputs</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
                <tbody>
                    ${module.outputs.map(output => `
                    <tr>
                        <td><code>${escapeHtml(output.name)}</code></td>
                        <td><code>${escapeHtml(output.type || "unknown")}</code></td>
                        <td>${escapeHtml(output.description || "")}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

    ${module.controls && module.controls.length ? `
    <div class="mt-4">
        <div class="mb-2 font-semibold">Controls</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Supported UI types</th><th>Default</th></tr></thead>
                <tbody>
                    ${module.controls.map(control => `
                    <tr>
                        <td><code>${escapeHtml(control.name)}</code></td>
                        <td>${escapeHtml(control.supportedTypes.join(", "))}</td>
                        <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(control.default || control.required || {}, null, 2))}</pre></td>
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
                backend: {
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
