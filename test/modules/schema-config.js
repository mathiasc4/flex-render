/* global QUnit, OpenSeadragon */

(function() {
    const ShaderConfigurator = OpenSeadragon.FlexRenderer.ShaderConfigurator;
    // Prefer the 2020-12 build: the published schema declares that dialect, so only this one can
    // compile the root document (the tests below that compile sub-schemas work under any of them).
    // `window.ajv2020` is a module namespace, hence the `.default` unwrap -- same shape
    // src/configurator.js resolves.
    const AjvModule = window.ajv2020 || window.ajv7 || window.Ajv;
    const Ajv = (AjvModule && typeof AjvModule.default === "function") ? AjvModule.default : AjvModule;

    function hasValidationKeywords(schema) {
        if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
            return false;
        }
        return !!(
            schema.type ||
            schema.$ref ||
            schema.oneOf ||
            schema.anyOf ||
            schema.allOf ||
            schema.enum ||
            schema.const ||
            schema.properties ||
            schema.items ||
            schema.required
        );
    }

    // Control params publish their variants under anyOf (a value may legitimately match
    // more than one envelope $ref, which oneOf would reject), so every shape probe has to
    // walk both keywords.
    function branches(schema) {
        return [].concat(schema.oneOf || [], schema.anyOf || []);
    }

    function schemaAllowsNull(schema) {
        if (!schema || typeof schema !== "object") {
            return false;
        }
        if (schema.type === "null") {
            return true;
        }
        if (Array.isArray(schema.type) && schema.type.includes("null")) {
            return true;
        }
        return branches(schema).some(schemaAllowsNull);
    }

    function schemaAllowsPrimitive(schema, primitiveType) {
        if (!schema || typeof schema !== "object") {
            return false;
        }
        if (schema.type === primitiveType) {
            return true;
        }
        if (Array.isArray(schema.type) && schema.type.includes(primitiveType)) {
            return true;
        }
        return branches(schema).some(item => schemaAllowsPrimitive(item, primitiveType));
    }

    function schemaResolvesToEnvelope(schema) {
        if (!schema || typeof schema !== "object") {
            return false;
        }
        if (schema.$ref) {
            return true;
        }
        return branches(schema).some(schemaResolvesToEnvelope);
    }

    function createAjv() {
        return new Ajv({
            allErrors: true,
            strict: false,
            // Mirrors ShaderConfigurator._createSchemaAjv(): acts on the `discriminator` keyword the
            // schema emits beside its `oneOf` branches. `schemaId: "auto"` used to be here; it was
            // removed in AJV 7 and AJV 8 accepts it silently while breaking $id resolution.
            discriminator: true
        });
    }

    function compileLayerValidator(ajv, model, shaderType) {
        return ajv.compile({
            ...model.$defs.shaderLayers[shaderType],
            $defs: model.$defs
        });
    }

    QUnit.module("Schema Config");

    QUnit.test("published shader schemas are closed and non-empty", function(assert) {
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const shaderLayers = (model.$defs && model.$defs.shaderLayers) || {};

        for (const [shaderType, shaderSchema] of Object.entries(shaderLayers)) {
            assert.strictEqual(shaderSchema.additionalProperties, false, `${shaderType} is closed`);
            assert.ok(Array.isArray(shaderSchema.examples) && shaderSchema.examples.length > 0, `${shaderType} publishes examples`);
            assert.ok(shaderSchema["x-expects"] && shaderSchema["x-expects"].dataKind, `${shaderType} publishes x-expects.dataKind`);

            const params = shaderSchema.properties && shaderSchema.properties.params;
            const paramProperties = (params && params.properties) || {};
            for (const [paramName, paramSchema] of Object.entries(paramProperties)) {
                assert.ok(hasValidationKeywords(paramSchema), `${shaderType}.params.${paramName} is not an empty schema`);
            }
        }
    });

    // A catalogue picks shaders for a host that may not forward pointer state, so the
    // requirement has to travel with the published schema and docs, not only on the class.
    // The class-level contract itself is covered in interaction-requirement.js.
    QUnit.test("shaders declaring requiresInteraction() publish it", function(assert) {
        const Registry = OpenSeadragon.FlexRenderer.ShaderLayerRegistry;
        // Expectations come from the classes, so a test-registered probe shader does not
        // make this fail; the shipped layers are then pinned by name.
        const declares = (type) => {
            const Klass = Registry.get(type);
            return !!(Klass && typeof Klass.requiresInteraction === "function" &&
                Klass.requiresInteraction() === true);
        };

        assert.ok(declares("fisheye-lens"), "fisheye-lens declares requiresInteraction()");
        assert.ok(declares("interaction-debug"), "interaction-debug declares requiresInteraction()");
        assert.notOk(declares("identity"), "identity does not");

        const schemaModel = ShaderConfigurator.compileConfigSchemaModel();
        const shaderLayers = (schemaModel.$defs && schemaModel.$defs.shaderLayers) || {};
        for (const [shaderType, shaderSchema] of Object.entries(shaderLayers)) {
            if (declares(shaderType)) {
                assert.strictEqual(shaderSchema["x-requiresInteraction"], true,
                    `${shaderType} publishes x-requiresInteraction`);
            } else {
                assert.notOk("x-requiresInteraction" in shaderSchema,
                    `${shaderType} omits x-requiresInteraction`);
            }
        }

        const docsModel = ShaderConfigurator.compileDocsModel();
        for (const shader of docsModel.shaders) {
            assert.strictEqual(shader.requiresInteraction, declares(shader.type),
                `docs model reports requiresInteraction for ${shader.type}`);
        }
    });

    QUnit.test("layer source bindings admit tiledImages and dataReferences", function(assert) {
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const shaderSchema = model.$defs.shaderLayers.colormap;
        const ajv = createAjv();
        const validate = compileLayerValidator(ajv, model, "colormap");

        assert.ok(
            validate({ id: "cm_tiled", type: "colormap", tiledImages: [0] }),
            "colormap accepts tiledImages"
        );
        assert.ok(
            validate({ id: "cm_refs", type: "colormap", dataReferences: [0] }),
            "colormap accepts dataReferences"
        );
    });

    // `precision` is read at runtime off the layer config (FlexRenderer._shaderTreeDemandsHighPrecision
    // / _shaderTreeVetoesHighPrecision). A closed schema that omits it makes every host emitting it
    // log "must NOT have additional properties" per layer, per registered shader type.
    QUnit.test("layer schemas admit the precision override and still catch typos in it", function(assert) {
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const ajv = createAjv();
        const validate = compileLayerValidator(ajv, model, "colormap");

        assert.ok(
            validate({ id: "cm_f16", type: "colormap", dataReferences: [0], precision: "float16" }),
            "colormap accepts precision: float16"
        );
        assert.ok(
            validate({ id: "cm_u8", type: "colormap", dataReferences: [0], precision: "unorm8" }),
            "colormap accepts precision: unorm8"
        );
        assert.notOk(
            validate({ id: "cm_typo", type: "colormap", precision: "f16" }),
            "a misspelled precision value is still rejected"
        );

        const shaderLayers = (model.$defs && model.$defs.shaderLayers) || {};
        for (const [shaderType, shaderSchema] of Object.entries(shaderLayers)) {
            assert.deepEqual(
                shaderSchema.properties.precision && shaderSchema.properties.precision.enum,
                ["float16", "unorm8"],
                `${shaderType} publishes the precision enum`
            );
        }
    });

    // `_controls` is ShaderLayer instance state, and FlexRenderer.jsonReplacer strips every
    // `_`-prefixed key on export, so no persisted config can carry one. The schema stays closed.
    QUnit.test("underscore-prefixed internals are neither published nor accepted", function(assert) {
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const ajv = createAjv();
        const validate = compileLayerValidator(ajv, model, "colormap");

        assert.notOk(
            validate({ id: "cm_internal", type: "colormap", _controls: {} }),
            "a config carrying _controls is rejected"
        );

        const shaderLayers = (model.$defs && model.$defs.shaderLayers) || {};
        for (const [shaderType, shaderSchema] of Object.entries(shaderLayers)) {
            const published = Object.keys(shaderSchema.properties || {}).filter(key => key.startsWith("_"));
            assert.deepEqual(published, [], `${shaderType} publishes no _-prefixed property`);
        }

        const rootProperties = ShaderConfigurator._compileBaseShaderConfigSchema().properties;
        assert.deepEqual(
            rootProperties.filter(item => item.key.startsWith("_")),
            [],
            "the prose config descriptor lists no _-prefixed key either"
        );
        assert.ok(
            rootProperties.some(item => item.key === "precision"),
            "the prose config descriptor lists precision, matching the JSON schema"
        );
    });

    // Custom params must follow the built-in path: a declared null default has to be admitted
    // by the type, because _synthesizeExampleParamsFromDefaults emits it into the example.
    QUnit.test("custom params publish nullable only when the declaration says default: null", function(assert) {
        const declaresNull = {
            type: () => "probe_null",
            customParams: { opt: { type: "string", default: null } }
        };
        const declaresNothing = {
            type: () => "probe_absent",
            customParams: { opt: { type: "string" } }
        };

        // _compileShaderParamsSchema coerces an absent default to null, so both shaders reach
        // _compileCustomParamJsonSchema with an identical compiled item. Only the declaration
        // distinguishes them.
        const compiledItem = { key: "opt", type: "string", default: null, required: null };

        assert.ok(
            schemaAllowsNull(ShaderConfigurator._compileCustomParamJsonSchema(declaresNull, compiledItem)),
            "a custom param declared default: null accepts null"
        );
        assert.notOk(
            schemaAllowsNull(ShaderConfigurator._compileCustomParamJsonSchema(declaresNothing, compiledItem)),
            "a custom param with no declared default stays strictly typed"
        );
    });

    QUnit.test("nullable built-ins and couplings are published consistently", function(assert) {
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const shaderLayers = (model.$defs && model.$defs.shaderLayers) || {};

        for (const [shaderType, shaderSchema] of Object.entries(shaderLayers)) {
            const params = (shaderSchema.properties && shaderSchema.properties.params) || {};
            const paramProperties = params.properties || {};

            ["use_gamma", "use_exposure", "use_logscale"].forEach((key) => {
                const paramSchema = paramProperties[key];
                if (paramSchema && paramSchema.default === null) {
                    assert.ok(schemaAllowsNull(paramSchema), `${shaderType}.params.${key} accepts null when default is null`);
                }
            });

            const couplings = shaderSchema["x-controlCouplings"] || [];
            for (const coupling of couplings) {
                assert.notOk(Object.prototype.hasOwnProperty.call(coupling, "expression"), `${shaderType}.${coupling.name} does not publish fake executable expression text`);
                assert.notOk(Object.prototype.hasOwnProperty.call(coupling, "expressionLanguage"), `${shaderType}.${coupling.name} does not publish fake expression language`);
            }
        }

        assert.strictEqual(
            shaderLayers.colormap["x-controlCouplings"][0].corrective,
            "Set params.color.steps = params.threshold.breaks.length + 1 (or pass threshold.breaks of length color.steps - 1).",
            "colormap publishes corrective coupling guidance"
        );
    });

    QUnit.test("primitive shorthand examples are admitted and select controls stay typed", function(assert) {
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const shaderLayers = (model.$defs && model.$defs.shaderLayers) || {};

        const primitiveExpectations = [
            ["bipolar-heatmap", "colorHigh", "string"],
            ["bipolar-heatmap", "colorLow", "string"],
            ["bipolar-heatmap", "threshold", "number"],
            ["colormap", "connect", "boolean"],
            ["heatmap", "color", "string"],
            ["heatmap", "threshold", "number"],
            ["heatmap", "inverse", "boolean"],
            ["single_channel", "color", "string"]
        ];

        for (const [shaderType, paramName, primitiveType] of primitiveExpectations) {
            const schema = shaderLayers[shaderType].properties.params.properties[paramName];
            assert.ok(
                schemaAllowsPrimitive(schema, primitiveType),
                `${shaderType}.params.${paramName} accepts ${primitiveType} shorthand`
            );
        }

        [
            ["iconmap", "grid_layout"],
            ["threshold", "version"]
        ].forEach(([shaderType, paramName]) => {
            const schema = shaderLayers[shaderType].properties.params.properties[paramName];
            assert.ok(schemaResolvesToEnvelope(schema), `${shaderType}.params.${paramName} resolves to a typed control envelope`);
        });
    });

    QUnit.test("published control envelopes use type discriminator only", function(assert) {
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const envelopes = model.$defs.uiControlEnvelopes || {};

        for (const [controlType, schema] of Object.entries(envelopes)) {
            assert.deepEqual(schema.required, ["type"], `${controlType} requires type`);
            assert.strictEqual(schema.properties.type.const, controlType, `${controlType} discriminator matches`);
            assert.notOk(Object.prototype.hasOwnProperty.call(schema.properties, "uiType"), `${controlType} does not publish uiType`);
        }
    });

    QUnit.test("published examples validate against schema and couplings", function(assert) {
        // The strict verdict lives here, in the test suite - not on the publish path.
        const verdict = ShaderConfigurator.validatePublishedExamples();
        assert.ok(verdict.ok, `bundled examples are consistent: ${JSON.stringify(verdict.issues)}`);

        const model = ShaderConfigurator.compileConfigSchemaModel();
        const shaderLayers = model.$defs.shaderLayers || {};
        const ajv = createAjv();

        for (const [shaderType, shaderSchema] of Object.entries(shaderLayers)) {
            const validate = compileLayerValidator(ajv, model, shaderType);
            const example = shaderSchema.examples && shaderSchema.examples[0];

            assert.ok(example, `${shaderType} publishes example[0]`);
            assert.ok(example && validate(example), `${shaderType} example[0] passes JSON Schema`);

            for (const coupling of ShaderConfigurator.getShaderCouplingValidators(shaderType)) {
                if (typeof coupling.validate !== "function") {
                    continue;
                }
                const outcome = coupling.validate(example);
                assert.notOk(outcome && outcome.ok === false, `${shaderType}.${coupling.name} example[0] passes coupling validation`);
            }
        }
    });

    // A misplaced key on one layer used to fail every `oneOf` branch, so it was reported once per
    // registered shader type: 23 findings for a single layer, most of them about shader types the
    // config never mentions (`must be equal to constant {"allowedValue":"adaptive_threshold"}`) plus
    // complaints inherited from branches that do not have the property at all. The host runs this
    // schema on every open and shows the result to the user, so the noise was the whole problem.
    QUnit.test("a misplaced key is reported once, against the declared shader type", function(assert) {
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const ajv = createAjv();

        // Compiling the ROOT document (not a sub-schema) is what exercises `discriminator`, and it
        // also throws if any branch lacks `properties.type` with a const/enum -- which is the guard
        // for a future shader that forgets it.
        let validate = null;
        try {
            validate = ajv.compile(model);
        } catch (e) {
            assert.ok(false, `the full model compiles with discriminator enabled: ${e && e.message}`);
            return;
        }
        assert.ok(validate, "the full model compiles with discriminator enabled");

        const misplaced = { shaders: { ts: { type: "time-series", seriesRenderer: "identity" } } };
        assert.notOk(validate(misplaced), "a top-level wrapper setting is rejected");

        const errors = validate.errors || [];
        assert.ok(errors.length <= 3,
            `one mistake yields few findings, not one per shader type (got ${errors.length}: ` +
            `${JSON.stringify(errors.map(e => e.keyword))})`);

        assert.ok(errors.some(e => e.instancePath === "/shaders/ts" &&
                e.keyword === "additionalProperties" &&
                e.params && e.params.additionalProperty === "seriesRenderer"),
            "and it names the misplaced key");

        assert.notOk(errors.some(e => e.keyword === "const" &&
                e.params && e.params.allowedValue !== undefined &&
                e.params.allowedValue !== "time-series"),
            "with no const failures belonging to other shader types' branches");

        assert.ok(validate({
            shaders: { ts: { type: "time-series", params: { seriesRenderer: "identity", series: [0, 1] } } }
        }), "the same setting under params validates");

        assert.notOk(validate({ shaders: { x: { type: "not_a_shader" } } }),
            "an unknown shader type is still rejected");
        assert.ok((validate.errors || []).some(e => e.keyword === "discriminator"),
            "and reports the tag miss rather than every branch");
    });

    QUnit.test("both shader maps publish the type discriminator", function(assert) {
        const model = ShaderConfigurator.compileConfigSchemaModel();

        assert.deepEqual(model.properties.shaders.additionalProperties.discriminator,
            { propertyName: "type" },
            "the root shaders map discriminates on type");

        const group = model.$defs.shaderLayers.group;
        assert.deepEqual(group.properties.shaders.additionalProperties.discriminator,
            { propertyName: "type" },
            "and so does a group's nested shaders map");
    });

    QUnit.test("compiled schema is deterministic across calls", function(assert) {
        const first = ShaderConfigurator.compileConfigSchemaModel();
        const second = ShaderConfigurator.compileConfigSchemaModel();

        assert.notOk(
            Object.prototype.hasOwnProperty.call(first, "x-generatedAt"),
            "schema carries no per-call timestamp"
        );
        assert.strictEqual(
            JSON.stringify(first),
            JSON.stringify(second),
            "two dumps are byte-identical, so the document stays content-hashable and diffable"
        );
    });

    QUnit.test("an inconsistent example degrades the schema instead of failing it", function(assert) {
        const shaderType = Object.keys(ShaderConfigurator.compileConfigSchemaModel().$defs.shaderLayers)[0];
        const original = ShaderConfigurator._collectPublishedExampleIssues;
        const originalWarn = console.warn;
        const warnings = [];

        ShaderConfigurator._collectPublishedExampleIssues = function() {
            return [{ kind: "schema", type: shaderType, errors: [{ message: "forced" }] }];
        };
        console.warn = function(msg) {
            warnings.push(msg);
        };

        try {
            const model = ShaderConfigurator.compileConfigSchemaModel();
            const layerSchema = model.$defs.shaderLayers[shaderType];

            assert.ok(model && model.$defs, "schema is still served");
            assert.notOk(
                layerSchema.examples && layerSchema.examples.length,
                "the offending example[0] is dropped rather than published as a broken template"
            );
            assert.ok(
                warnings.some(w => String(w).indexOf(shaderType) !== -1),
                "the drop is reported through console.warn"
            );

            assert.throws(
                () => ShaderConfigurator.compileConfigSchemaModel({ strict: true }),
                /published examples failed validation/,
                "strict mode is opt-in and still throws"
            );
        } finally {
            ShaderConfigurator._collectPublishedExampleIssues = original;
            console.warn = originalWarn;
        }
    });
})();
