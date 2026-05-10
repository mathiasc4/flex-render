(function() {
    const STATUS_PASS = "pass";
    const STATUS_FAIL = "fail";
    const STATUS_SKIP = "skip";

    let lastReport = null;

    function deepClone(value) {
        if (value === undefined) {
            return undefined;
        }
        if (typeof structuredClone === "function") {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    }

    function sorted(values) {
        return values.slice().sort();
    }

    function sameStringSet(a, b) {
        return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
    }

    function getAjvConstructor() {
        const candidate = window.Ajv || window.ajv7 || window.ajv;

        if (typeof candidate === "function") {
            return candidate;
        }

        if (candidate && typeof candidate.default === "function") {
            return candidate.default;
        }

        return null;
    }

    function compileAjvValidator(schema) {
        const AjvConstructor = getAjvConstructor();

        if (!AjvConstructor) {
            throw new Error("AJV was not loaded.");
        }

        const schemaForAjv = deepClone(schema);

        // The browser CDN bundle used by this demo may not preload the draft-2020-12
        // metaschema. The generated schema uses only keywords handled by AJV here, so
        // remove $schema for this local validation runner.
        delete schemaForAjv.$schema;

        const ajv = new AjvConstructor({
            allErrors: true,
            strict: false,
            schemaId: "auto"
        });

        return ajv.compile(schemaForAjv);
    }

    function toErrorMessage(error) {
        return error && error.message ? error.message : String(error);
    }

    function assert(condition, message, details) {
        if (!condition) {
            const error = new Error(message);
            error.details = details;
            throw error;
        }
    }

    function skip(message, details) {
        const error = new Error(message);
        error.skip = true;
        error.details = details;
        throw error;
    }

    function createContext() {
        const FlexRenderer = window.OpenSeadragon && window.OpenSeadragon.FlexRenderer;

        if (!FlexRenderer) {
            throw new Error("OpenSeadragon.FlexRenderer is not available.");
        }

        const ShaderConfigurator = FlexRenderer.ShaderConfigurator;
        const ShaderMediator = FlexRenderer.ShaderMediator;
        const ShaderModuleMediator = FlexRenderer.ShaderModuleMediator;
        const ShaderModuleGraphAnalyzer = FlexRenderer.ShaderModuleGraphAnalyzer;

        if (!ShaderConfigurator) {
            throw new Error("OpenSeadragon.FlexRenderer.ShaderConfigurator is not available.");
        }
        if (!ShaderMediator) {
            throw new Error("OpenSeadragon.FlexRenderer.ShaderMediator is not available.");
        }

        ShaderConfigurator.setUniqueId("configurator_docs_schema_tests");

        let docs = null;
        let docsError = null;
        try {
            docs = ShaderConfigurator.compileDocsModel();
        } catch (error) {
            docsError = error;
        }

        let schema = null;
        let schemaError = null;
        try {
            schema = ShaderConfigurator.compileConfigSchemaModel();
        } catch (error) {
            schemaError = error;
        }

        let validator = null;
        let validatorError = null;
        if (schema) {
            try {
                validator = compileAjvValidator(schema);
            } catch (error) {
                validatorError = error;
            }
        }

        return {
            FlexRenderer,
            ShaderConfigurator,
            ShaderMediator,
            ShaderModuleMediator,
            ShaderModuleGraphAnalyzer,
            docs,
            docsError,
            schema,
            schemaError,
            validator,
            validatorError
        };
    }

    function getRegisteredShaderTypes(context) {
        return context.ShaderMediator.availableShaders()
            .map(Shader => Shader.type());
    }

    function getRegisteredModuleTypes(context) {
        const mediator = context.ShaderModuleMediator;

        if (!mediator || typeof mediator.availableTypes !== "function") {
            return [];
        }

        return mediator.availableTypes();
    }

    function getRegisteredModules(context) {
        const mediator = context.ShaderModuleMediator;

        if (!mediator || typeof mediator.availableModules !== "function") {
            return [];
        }

        return mediator.availableModules();
    }

    function getModularShader(context) {
        const mediator = context.ShaderMediator;

        if (typeof mediator.getClass === "function") {
            return mediator.getClass("modular");
        }

        if (typeof mediator.getShaderByType === "function") {
            return mediator.getShaderByType("modular");
        }

        return null;
    }

    function getModularExampleParams(context) {
        const ModularShader = getModularShader(context);

        assert(ModularShader, "Registered shader type 'modular' was not found.");
        assert(
            typeof ModularShader.exampleParams === "function",
            "ModularShaderLayer.exampleParams() is not available."
        );

        const params = ModularShader.exampleParams();

        assert(params && typeof params === "object", "ModularShaderLayer.exampleParams() must return an object.");
        assert(params.graph && typeof params.graph === "object", "ModularShaderLayer.exampleParams().graph is missing.");

        return deepClone(params);
    }

    function createModularVisualizationConfig(context) {
        const params = getModularExampleParams(context);

        return {
            order: ["modular_test"],
            shaders: {
                modular_test: {
                    id: "modular_test",
                    name: "Modular schema test",
                    type: "modular",
                    visible: 1,
                    fixed: false,
                    tiledImages: [0],
                    params
                }
            }
        };
    }

    function getFirstGraphNode(config) {
        const graph = config &&
            config.shaders &&
            config.shaders.modular_test &&
            config.shaders.modular_test.params &&
            config.shaders.modular_test.params.graph;
        const nodes = graph && graph.nodes;
        const firstNodeId = nodes && Object.keys(nodes)[0];

        if (!firstNodeId) {
            throw new Error("Modular example graph has no nodes.");
        }

        return {
            graph,
            nodeId: firstNodeId,
            node: nodes[firstNodeId]
        };
    }

    function validateWithAjv(context, config) {
        assert(context.schema, "Schema model was not compiled.", {
            error: context.schemaError && toErrorMessage(context.schemaError)
        });
        assert(context.validator, "AJV validator was not compiled.", {
            error: context.validatorError && toErrorMessage(context.validatorError)
        });

        const ok = context.validator(config);

        return {
            ok,
            errors: deepClone(context.validator.errors || [])
        };
    }

    function createTestSuites() {
        return [
            {
                id: "baseline",
                title: "Current configurator baseline",
                tests: [
                    {
                        name: "Docs model compiles",
                        run(context) {
                            assert(context.docs, "compileDocsModel() failed.", {
                                error: context.docsError && toErrorMessage(context.docsError)
                            });
                            assert(typeof context.docs.version === "number", "Docs model should expose numeric version.");
                            assert(Array.isArray(context.docs.shaders), "Docs model should expose shaders array.");
                            assert(context.docs.version >= 6, "Docs model version should be at least 6.", {
                                version: context.docs.version
                            });

                            return {
                                version: context.docs.version,
                                shaderDocs: context.docs.shaders.length
                            };
                        }
                    },
                    {
                        name: "Every registered shader has docs",
                        run(context) {
                            assert(context.docs, "Docs model was not compiled.");

                            const registeredTypes = getRegisteredShaderTypes(context);
                            const documentedTypes = context.docs.shaders.map(shader => shader.type);

                            assert(
                                sameStringSet(registeredTypes, documentedTypes),
                                "Registered shader types and docs shader types do not match.",
                                { registeredTypes: sorted(registeredTypes), documentedTypes: sorted(documentedTypes) }
                            );

                            for (const shader of context.docs.shaders) {
                                assert(shader.type, "Shader docs entry is missing type.", shader);
                                assert(shader.name, `Shader '${shader.type}' docs entry is missing name.`, shader);
                                assert(Array.isArray(shader.sources), `Shader '${shader.type}' docs entry is missing sources array.`);
                                assert(Array.isArray(shader.controls), `Shader '${shader.type}' docs entry is missing controls array.`);
                            }

                            return {
                                shaderCount: registeredTypes.length,
                                shaderTypes: sorted(registeredTypes)
                            };
                        }
                    },
                    {
                        name: "Schema model compiles",
                        run(context) {
                            assert(context.schema, "compileConfigSchemaModel() failed.", {
                                error: context.schemaError && toErrorMessage(context.schemaError)
                            });
                            assert(context.schema.$defs, "Schema model should expose $defs.");
                            assert(context.schema.$defs.shaderLayers, "Schema model should expose $defs.shaderLayers.");
                            assert(context.schema.$defs.uiControlEnvelopes, "Schema model should expose $defs.uiControlEnvelopes.");
                            assert(context.schema["x-schemaVersion"] >= 2, "Schema version should be at least 2.", {
                                version: context.schema["x-schemaVersion"]
                            });

                            return {
                                schemaVersion: context.schema["x-schemaVersion"],
                                shaderLayerSchemas: Object.keys(context.schema.$defs.shaderLayers).length,
                                controlSchemas: Object.keys(context.schema.$defs.uiControlEnvelopes).length
                            };
                        }
                    },
                    {
                        name: "Every registered shader has a schema entry",
                        run(context) {
                            assert(context.schema, "Schema model was not compiled.");

                            const registeredTypes = getRegisteredShaderTypes(context);
                            const schemaTypes = Object.keys(context.schema.$defs.shaderLayers || {});

                            assert(
                                sameStringSet(registeredTypes, schemaTypes),
                                "Registered shader types and schema shader types do not match.",
                                { registeredTypes: sorted(registeredTypes), schemaTypes: sorted(schemaTypes) }
                            );

                            return {
                                shaderCount: registeredTypes.length,
                                shaderTypes: sorted(registeredTypes)
                            };
                        }
                    },
                    {
                        name: "ShaderModuleMediator registry is usable",
                        run(context) {
                            const mediator = context.ShaderModuleMediator;

                            assert(mediator, "ShaderModuleMediator is not available.");
                            assert(typeof mediator.availableModules === "function", "ShaderModuleMediator.availableModules() is missing.");
                            assert(typeof mediator.availableTypes === "function", "ShaderModuleMediator.availableTypes() is missing.");

                            const modules = getRegisteredModules(context);
                            const types = getRegisteredModuleTypes(context);

                            assert(Array.isArray(modules), "availableModules() should return an array.");
                            assert(Array.isArray(types), "availableTypes() should return an array.");
                            assert(modules.length === types.length, "Module class count should match module type count.", {
                                moduleCount: modules.length,
                                typeCount: types.length
                            });
                            assert(new Set(types).size === types.length, "Module types should be unique.", {
                                moduleTypes: types
                            });

                            for (const Module of modules) {
                                const type = Module.type();

                                assert(type && typeof type === "string", "Module type should be a non-empty string.");
                                assert(mediator.getClass(type) === Module, `getClass('${type}') should return the registered module class.`);
                                assert(typeof Module.inputs === "function", `${type}.inputs() is missing.`);
                                assert(typeof Module.outputs === "function", `${type}.outputs() is missing.`);
                                assert(typeof Module.description === "function", `${type}.description() is missing.`);
                                assert(Module.defaultControls && typeof Module.defaultControls === "object", `${type}.defaultControls should be object-like.`);
                            }

                            return {
                                moduleCount: modules.length,
                                moduleTypes: sorted(types)
                            };
                        }
                    },
                    {
                        name: "Modular shader publishes a graph example",
                        run(context) {
                            const params = getModularExampleParams(context);
                            const graph = params.graph;

                            assert(graph.nodes && typeof graph.nodes === "object", "Example graph should expose nodes object.");
                            assert(typeof graph.output === "string", "Example graph should expose output string.");

                            return {
                                nodeCount: Object.keys(graph.nodes).length,
                                output: graph.output
                            };
                        }
                    },
                    {
                        name: "ShaderModuleGraphAnalyzer accepts the modular example graph",
                        run(context) {
                            if (!context.ShaderModuleGraphAnalyzer) {
                                skip("ShaderModuleGraphAnalyzer is not available.");
                            }

                            const params = getModularExampleParams(context);
                            const result = context.ShaderModuleGraphAnalyzer.analyze(
                                { id: "configurator_docs_schema_test_owner" },
                                params.graph
                            );

                            assert(result && typeof result === "object", "Analyzer should return an object.");
                            assert(result.ok === true, "Example graph should analyze without error diagnostics.", {
                                diagnostics: result.diagnostics
                            });
                            assert(result.partial && Array.isArray(result.partial.order), "Analyzer result should expose partial.order.");

                            return {
                                order: result.partial.order,
                                diagnostics: result.diagnostics
                            };
                        }
                    }
                ]
            },
            {
                id: "modules",
                title: "Module doc/schema expectations",
                tests: [
                    {
                        name: "Docs model exposes module descriptors",
                        run(context) {
                            assert(context.docs, "Docs model was not compiled.");
                            assert(context.docs.version >= 7, "Docs model version should be bumped to at least 7.", {
                                version: context.docs.version
                            });
                            assert(Array.isArray(context.docs.modules), "Docs model should expose modules array.");

                            const registeredTypes = getRegisteredModuleTypes(context);
                            const documentedTypes = context.docs.modules.map(module => module.type);

                            assert(
                                sameStringSet(registeredTypes, documentedTypes),
                                "Registered module types and docs module types do not match.",
                                { registeredTypes: sorted(registeredTypes), documentedTypes: sorted(documentedTypes) }
                            );

                            for (const moduleDoc of context.docs.modules) {
                                assert(moduleDoc.type, "Module docs entry is missing type.", moduleDoc);
                                assert(moduleDoc.name, `Module '${moduleDoc.type}' docs entry is missing name.`, moduleDoc);
                                assert("description" in moduleDoc, `Module '${moduleDoc.type}' docs entry is missing description field.`);
                                assert(Array.isArray(moduleDoc.inputs), `Module '${moduleDoc.type}' docs entry is missing inputs array.`);
                                assert(Array.isArray(moduleDoc.outputs), `Module '${moduleDoc.type}' docs entry is missing outputs array.`);
                                assert(Array.isArray(moduleDoc.controls), `Module '${moduleDoc.type}' docs entry is missing controls array.`);
                                assert(moduleDoc.classDocs, `Module '${moduleDoc.type}' docs entry is missing classDocs.`);
                            }

                            return {
                                docsVersion: context.docs.version,
                                moduleCount: documentedTypes.length,
                                moduleTypes: sorted(documentedTypes)
                            };
                        }
                    },
                    {
                        name: "Modular shader docs expose custom params.graph",
                        run(context) {
                            assert(context.docs, "Docs model was not compiled.");

                            const modular = context.docs.shaders.find(shader => shader.type === "modular");

                            assert(modular, "Docs model has no shader entry for type 'modular'.");
                            assert(modular.exampleParams && modular.exampleParams.graph, "Modular shader docs should expose exampleParams.graph.");
                            assert(Array.isArray(modular.customParams), "Modular shader docs should expose customParams array.");

                            const graphParam = modular.customParams.find(param => param.name === "graph");

                            assert(graphParam, "Modular shader customParams should include graph.");

                            return graphParam;
                        }
                    },
                    {
                        name: "Schema exposes shaderModules and shaderModuleGraph definitions",
                        run(context) {
                            assert(context.schema, "Schema model was not compiled.");
                            assert(context.schema["x-schemaVersion"] >= 3, "Schema version should be bumped to at least 3.", {
                                version: context.schema["x-schemaVersion"]
                            });
                            assert(
                                typeof context.schema.$id === "string" && context.schema.$id.indexOf("/v3.json") !== -1,
                                "Schema $id should point to v3.",
                                { id: context.schema.$id }
                            );
                            assert(context.schema.$defs.shaderModules, "Schema should expose $defs.shaderModules.");
                            assert(context.schema.$defs.shaderModuleGraph, "Schema should expose $defs.shaderModuleGraph.");

                            const registeredTypes = getRegisteredModuleTypes(context);
                            const schemaTypes = Object.keys(context.schema.$defs.shaderModules || {});

                            assert(
                                sameStringSet(registeredTypes, schemaTypes),
                                "Registered module types and schema module types do not match.",
                                { registeredTypes: sorted(registeredTypes), schemaTypes: sorted(schemaTypes) }
                            );

                            return {
                                schemaVersion: context.schema["x-schemaVersion"],
                                moduleSchemaCount: schemaTypes.length,
                                graphSchemaPresent: !!context.schema.$defs.shaderModuleGraph
                            };
                        }
                    },
                    {
                        name: "Each module schema has node type, inputs, and params",
                        run(context) {
                            assert(context.schema, "Schema model was not compiled.");
                            assert(context.schema.$defs && context.schema.$defs.shaderModules, "Schema module definitions are missing.");

                            const moduleTypes = getRegisteredModuleTypes(context);

                            for (const type of moduleTypes) {
                                const nodeSchema = context.schema.$defs.shaderModules[type];

                                assert(nodeSchema, `Missing schema for module '${type}'.`);
                                assert(nodeSchema.type === "object", `${type} schema should be an object schema.`);
                                assert(
                                    nodeSchema.properties &&
                                    nodeSchema.properties.type &&
                                    nodeSchema.properties.type.const === type,
                                    `${type} schema should const-match its module type.`
                                );
                                assert(nodeSchema.properties.inputs, `${type} schema should define inputs object.`);
                                assert(nodeSchema.properties.params, `${type} schema should define params object.`);
                            }

                            return {
                                checkedModuleTypes: sorted(moduleTypes)
                            };
                        }
                    },
                    {
                        name: "Modular layer params.graph references shaderModuleGraph schema",
                        run(context) {
                            assert(context.schema, "Schema model was not compiled.");

                            const modularSchema = context.schema.$defs &&
                                context.schema.$defs.shaderLayers &&
                                context.schema.$defs.shaderLayers.modular;
                            const graphParam = modularSchema &&
                                modularSchema.properties &&
                                modularSchema.properties.params &&
                                modularSchema.properties.params.properties &&
                                modularSchema.properties.params.properties.graph;

                            assert(graphParam, "Modular layer schema should expose params.graph.");
                            assert(
                                graphParam.$ref === "#/$defs/shaderModuleGraph",
                                "Modular params.graph should reference #/$defs/shaderModuleGraph.",
                                graphParam
                            );

                            return graphParam;
                        }
                    },
                    {
                        name: "AJV accepts modular example visualization config",
                        run(context) {
                            const config = createModularVisualizationConfig(context);
                            const result = validateWithAjv(context, config);

                            assert(result.ok, "Valid modular visualization config should pass AJV validation.", {
                                errors: result.errors,
                                config
                            });

                            return {
                                valid: result.ok
                            };
                        }
                    },
                    {
                        name: "AJV rejects modular graph without output",
                        run(context) {
                            const config = createModularVisualizationConfig(context);
                            const graph = config.shaders.modular_test.params.graph;

                            delete graph.output;

                            const result = validateWithAjv(context, config);

                            assert(!result.ok, "Graph without output should fail AJV validation.", {
                                config,
                                errors: result.errors
                            });

                            return {
                                valid: result.ok,
                                errors: result.errors
                            };
                        }
                    },
                    {
                        name: "AJV rejects unknown module type",
                        run(context) {
                            const config = createModularVisualizationConfig(context);
                            const first = getFirstGraphNode(config);

                            first.node.type = "__not_a_registered_shader_module__";

                            const result = validateWithAjv(context, config);

                            assert(!result.ok, "Graph with unknown module type should fail AJV validation.", {
                                config,
                                errors: result.errors
                            });

                            return {
                                valid: result.ok,
                                errors: result.errors
                            };
                        }
                    },
                    {
                        name: "AJV rejects invalid output reference syntax",
                        run(context) {
                            const config = createModularVisualizationConfig(context);
                            const graph = config.shaders.modular_test.params.graph;

                            graph.output = "bad-output-ref";

                            const result = validateWithAjv(context, config);

                            assert(!result.ok, "Graph with invalid output reference syntax should fail AJV validation.", {
                                config,
                                errors: result.errors
                            });

                            return {
                                valid: result.ok,
                                errors: result.errors
                            };
                        }
                    }
                ]
            }
        ];
    }

    async function runTest(context, suite, test) {
        try {
            const details = await test.run(context);

            return {
                suite: suite.id,
                suiteTitle: suite.title,
                name: test.name,
                status: STATUS_PASS,
                message: "Passed",
                details: details === undefined ? null : details
            };
        } catch (error) {
            return {
                suite: suite.id,
                suiteTitle: suite.title,
                name: test.name,
                status: error && error.skip ? STATUS_SKIP : STATUS_FAIL,
                message: toErrorMessage(error),
                details: error && error.details !== undefined ? error.details : null
            };
        }
    }

    async function runAllTests() {
        const startedAt = new Date();
        const context = createContext();
        const suites = createTestSuites();
        const results = [];

        for (const suite of suites) {
            for (const test of suite.tests) {
                results.push(await runTest(context, suite, test));
            }
        }

        const summary = {
            total: results.length,
            passed: results.filter(result => result.status === STATUS_PASS).length,
            failed: results.filter(result => result.status === STATUS_FAIL).length,
            skipped: results.filter(result => result.status === STATUS_SKIP).length
        };

        return {
            generatedAt: startedAt.toISOString(),
            summary,
            docsVersion: context.docs && context.docs.version,
            schemaVersion: context.schema && context.schema["x-schemaVersion"],
            shaderCount: getRegisteredShaderTypes(context).length,
            moduleCount: getRegisteredModuleTypes(context).length,
            results
        };
    }

    function updateText(id, value) {
        const node = document.getElementById(id);
        if (node) {
            node.textContent = String(value);
        }
    }

    function setStatus(id, text, status) {
        const node = document.getElementById(id);
        if (!node) {
            return;
        }
        node.textContent = text;
        node.className = `status ${status || ""}`.trim();
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function stringifyDetails(details) {
        if (details === null || details === undefined) {
            return "";
        }
        try {
            return JSON.stringify(details, null, 2);
        } catch (_) {
            return String(details);
        }
    }

    function renderDetailsCell(details) {
        const text = stringifyDetails(details);

        if (!text) {
            return `<span class="details-empty">—</span>`;
        }

        const lineCount = text.split("\n").length;
        const summary = lineCount > 1 ?
            `Show details (${lineCount} lines)` :
            "Show details";

        return `
<details class="details-toggle">
    <summary>${escapeHtml(summary)}</summary>
    <div class="details-body">${escapeHtml(text)}</div>
</details>`;
    }

    function renderResults(report) {
        const root = document.getElementById("results-root");
        const suites = [];

        for (const result of report.results) {
            let suite = suites.find(item => item.id === result.suite);
            if (!suite) {
                suite = {
                    id: result.suite,
                    title: result.suiteTitle,
                    results: []
                };
                suites.push(suite);
            }
            suite.results.push(result);
        }

        root.innerHTML = suites.map(suite => {
            const passed = suite.results.filter(result => result.status === STATUS_PASS).length;
            const failed = suite.results.filter(result => result.status === STATUS_FAIL).length;
            const skipped = suite.results.filter(result => result.status === STATUS_SKIP).length;

            const rows = suite.results.map(result => `
<tr>
    <td><span class="status ${escapeHtml(result.status)}">${escapeHtml(result.status.toUpperCase())}</span></td>
    <td>${escapeHtml(result.name)}</td>
    <td>${escapeHtml(result.message)}</td>
    <td class="details">${renderDetailsCell(result.details)}</td>
</tr>`).join("");

            return `
<div class="suite-title">
    <h2>${escapeHtml(suite.title)}</h2>
    <span class="status ${failed ? "fail" : "pass"}">${passed} passed, ${failed} failed, ${skipped} skipped</span>
</div>
<div class="table-wrap">
    <table>
        <thead>
            <tr>
                <th>Status</th>
                <th>Test</th>
                <th>Message</th>
                <th>Details</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>
</div>`;
        }).join("");
    }

    function renderReport(report) {
        lastReport = report;

        updateText("total-count", report.summary.total);
        updateText("pass-count", report.summary.passed);
        updateText("fail-count", report.summary.failed);
        updateText("skip-count", report.summary.skipped);
        updateText("docs-version", report.docsVersion || "-");
        updateText("schema-version", report.schemaVersion || "-");
        updateText("run-description", `Checked ${report.shaderCount} shaders and ${report.moduleCount} modules.`);

        setStatus(
            "run-status",
            report.summary.failed ? "Failed" : "Passed",
            report.summary.failed ? STATUS_FAIL : STATUS_PASS
        );
        setStatus("last-run-at", report.generatedAt, report.summary.failed ? STATUS_FAIL : STATUS_PASS);

        renderResults(report);
        updateText("json-output", JSON.stringify(report, null, 2));
    }

    async function handleRunTests() {
        setStatus("run-status", "Running…", "");
        updateText("run-description", "Running configurator docs/schema tests...");
        updateText("json-output", "Running...");

        try {
            const report = await runAllTests();
            renderReport(report);
        } catch (error) {
            const report = {
                generatedAt: new Date().toISOString(),
                summary: {
                    total: 1,
                    passed: 0,
                    failed: 1,
                    skipped: 0
                },
                results: [{
                    suite: "boot",
                    suiteTitle: "Boot",
                    name: "Create test context",
                    status: STATUS_FAIL,
                    message: toErrorMessage(error),
                    details: null
                }]
            };

            renderReport(report);
        }
    }

    async function handleCopyReport() {
        const reportText = JSON.stringify(lastReport || {}, null, 2);

        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(reportText);
            setStatus("last-run-at", "Copied JSON report", STATUS_PASS);
            return;
        }

        const output = document.getElementById("json-output");
        if (output) {
            const range = document.createRange();
            range.selectNodeContents(output);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    window.addEventListener("load", () => {
        const runButton = document.getElementById("run-tests-btn");
        const copyButton = document.getElementById("copy-report-btn");

        if (runButton) {
            runButton.addEventListener("click", () => {
                handleRunTests();
            });
        }

        if (copyButton) {
            copyButton.addEventListener("click", () => {
                handleCopyReport().catch(error => {
                    console.error(error);
                    setStatus("last-run-at", toErrorMessage(error), STATUS_FAIL);
                });
            });
        }

        handleRunTests();
    });
})();
