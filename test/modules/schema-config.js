/* global QUnit, OpenSeadragon */

(function() {
    const ShaderConfigurator = OpenSeadragon.FlexRenderer.ShaderConfigurator;
    const Ajv = window.ajv7 || window.Ajv;

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
        if (Array.isArray(schema.oneOf)) {
            return schema.oneOf.some(schemaAllowsNull);
        }
        return false;
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
        if (Array.isArray(schema.oneOf)) {
            return schema.oneOf.some(item => schemaAllowsPrimitive(item, primitiveType));
        }
        return false;
    }

    function createAjv() {
        return new Ajv({
            allErrors: true,
            strict: false,
            schemaId: "auto"
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
            assert.ok(schema.$ref || (Array.isArray(schema.oneOf) && schema.oneOf.some(item => item.$ref)), `${shaderType}.params.${paramName} resolves to a typed control envelope`);
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
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const shaderLayers = model.$defs.shaderLayers || {};
        const ajv = createAjv();

        for (const [shaderType, shaderSchema] of Object.entries(shaderLayers)) {
            const validate = compileLayerValidator(ajv, model, shaderType);
            const example = shaderSchema.examples && shaderSchema.examples[0];

            assert.ok(example, `${shaderType} publishes example[0]`);
            assert.ok(validate(example), `${shaderType} example[0] passes JSON Schema`);

            for (const coupling of ShaderConfigurator.getShaderCouplingValidators(shaderType)) {
                if (typeof coupling.validate !== "function") {
                    continue;
                }
                const outcome = coupling.validate(example);
                assert.notOk(outcome && outcome.ok === false, `${shaderType}.${coupling.name} example[0] passes coupling validation`);
            }
        }
    });
})();
