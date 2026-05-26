(function() {
    const ShaderConfigurator = OpenSeadragon.FlexRenderer.ShaderConfigurator;

    let docsModel = null;
    let schemaModel = null;
    let selectedModuleType = null;

    function escapeHtml(value) {
        return String(value === undefined || value === null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function stringify(value) {
        return JSON.stringify(value === undefined ? null : value, null, 2);
    }

    function renderPortTypes(type) {
        const types = Array.isArray(type) ? type : [type || "unknown"];

        return `
<span style="display: inline-grid; gap: 4px; justify-items: start;">
    ${types.map(entry => `<code style="width: fit-content;">${escapeHtml(entry || "unknown")}</code>`).join("")}
</span>`;
    }

    function renderControlMetadata(control) {
        return `<pre style="margin: 0; max-height: 220px;">${escapeHtml(stringify({
            default: control.default,
            required: control.required
        }))}</pre>`;
    }

    function updateText(id, value) {
        const node = document.getElementById(id);
        if (node) {
            node.textContent = String(value);
        }
    }

    function getModules() {
        return Array.isArray(docsModel && docsModel.modules) ? docsModel.modules : [];
    }

    function getVisibleModules() {
        const search = document.getElementById("module-search");
        const query = (search && search.value || "").toLowerCase().trim();

        return getModules()
            .filter(moduleDoc => {
                if (!query) {
                    return true;
                }

                return `${moduleDoc.name} ${moduleDoc.type} ${moduleDoc.description || ""}`
                    .toLowerCase()
                    .includes(query);
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    function getSelectedModule() {
        return getModules().find(moduleDoc => moduleDoc.type === selectedModuleType) || getModules()[0] || null;
    }

    function renderPortTable(title, ports, includeRequired = true) {
        if (!Array.isArray(ports) || !ports.length) {
            return `
<div class="section">
    <h3>${escapeHtml(title)}</h3>
    <p>No ${escapeHtml(title.toLowerCase())} declared.</p>
</div>`;
        }

        return `
<div class="section">
    <h3>${escapeHtml(title)}</h3>
    <table>
        <thead>
            <tr>
                <th>Name</th>
                <th>Type</th>
                ${includeRequired ? "<th>Required</th>" : ""}
                <th>Description</th>
            </tr>
        </thead>
        <tbody>
            ${ports.map(port => `
            <tr>
                <td><code>${escapeHtml(port.name)}</code></td>
                <td>${renderPortTypes(port.type)}</td>
                ${includeRequired ? `<td>${port.required ? "yes" : "no"}</td>` : ""}
                <td>${escapeHtml(port.description || "")}</td>
            </tr>`).join("")}
        </tbody>
    </table>
</div>`;
    }

    function renderControlTable(controls) {
        if (!Array.isArray(controls) || !controls.length) {
            return `
<div class="section">
    <h3>Controls</h3>
    <p>No module-local controls declared.</p>
</div>`;
        }

        return `
<div class="section">
    <h3>Controls</h3>
    <table>
        <thead>
            <tr>
                <th>Name</th>
                <th>Supported UI types</th>
                <th>Default / required metadata</th>
            </tr>
        </thead>
        <tbody>
            ${controls.map(control => `
            <tr>
                <td><code>${escapeHtml(control.name)}</code></td>
                <td>${escapeHtml((control.supportedTypes || []).join(", "))}</td>
                <td>${renderControlMetadata(control)}</td>
            </tr>`).join("")}
        </tbody>
    </table>
</div>`;
    }

    function renderClassDocs(moduleDoc) {
        const classDocs = moduleDoc && moduleDoc.classDocs;
        if (!classDocs) {
            return "";
        }

        return `
<details>
    <summary>Class docs</summary>
    <div class="details-content">
        <pre>${escapeHtml(stringify(classDocs))}</pre>
    </div>
</details>`;
    }

    function renderModuleList() {
        const list = document.getElementById("module-list");
        const query = (document.getElementById("module-search").value || "").toLowerCase().trim();

        const modules = getVisibleModules();

        if (!selectedModuleType && modules.length) {
            selectedModuleType = modules[0].type;
        }

        list.innerHTML = modules.map(moduleDoc => `
<button class="module-button ${moduleDoc.type === selectedModuleType ? "active" : ""}" type="button" data-module-type="${escapeHtml(moduleDoc.type)}">
    <span class="module-name">${escapeHtml(moduleDoc.name)}</span>
    <span class="module-type">${escapeHtml(moduleDoc.type)}</span>
</button>`).join("") || `<p>No modules match the filter.</p>`;
    }

    function renderSelectedModule() {
        const host = document.getElementById("module-details");
        const moduleDoc = getSelectedModule();

        if (!moduleDoc) {
            host.innerHTML = "<p>No module documentation entries are available.</p>";
            updateText("module-schema-output", "No module selected.");
            return;
        }

        selectedModuleType = moduleDoc.type;

        host.innerHTML = `
<div class="section">
    <span class="badge">${escapeHtml(moduleDoc.type)}</span>
    <h3>${escapeHtml(moduleDoc.name)}</h3>
    <p>${escapeHtml(moduleDoc.description || "No description provided.")}</p>
</div>

${renderPortTable("Inputs", moduleDoc.inputs)}
${renderPortTable("Outputs", moduleDoc.outputs, false)}
${renderControlTable(moduleDoc.controls)}
${renderClassDocs(moduleDoc)}
`;

        const schema = schemaModel &&
            schemaModel.$defs &&
            schemaModel.$defs.shaderModules &&
            schemaModel.$defs.shaderModules[moduleDoc.type];

        updateText("module-schema-output", schema ? stringify(schema) : "No schema entry for this module.");
    }

    function renderGraphExample() {
        const modularShader = docsModel &&
            Array.isArray(docsModel.shaders) &&
            docsModel.shaders.find(shader => shader.type === "modular");

        const graph = modularShader &&
            modularShader.exampleParams &&
            modularShader.exampleParams.graph;

        updateText("graph-example-output", graph ? stringify(graph) : "No modular graph example found.");
    }

    function renderSummary() {
        const shaderCount = Array.isArray(docsModel && docsModel.shaders) ? docsModel.shaders.length : 0;
        const moduleCount = getModules().length;
        const graphSchemaExists = !!(
            schemaModel &&
            schemaModel.$defs &&
            schemaModel.$defs.shaderModuleGraph
        );

        updateText("docs-version", docsModel && docsModel.version ? docsModel.version : "-");
        updateText("shader-count", shaderCount);
        updateText("module-count", moduleCount);
        updateText("graph-schema-status", graphSchemaExists ? "yes" : "no");
    }

    function render() {
        docsModel = ShaderConfigurator.compileDocsModel();

        try {
            schemaModel = ShaderConfigurator.compileConfigSchemaModel();
        } catch (error) {
            console.warn("Could not compile config schema for docs demo.", error);
            schemaModel = null;
        }

        selectedModuleType = null;

        renderSummary();
        renderModuleList();
        renderSelectedModule();
        renderGraphExample();
    }

    window.addEventListener("load", () => {
        ShaderConfigurator.setUniqueId("configurator_docs_demo");

        document.getElementById("refresh-btn").addEventListener("click", render);
        document.getElementById("module-search").addEventListener("input", () => {
            renderModuleList();
        });
        document.getElementById("module-list").addEventListener("click", event => {
            const button = event.target.closest("[data-module-type]");
            if (!button) {
                return;
            }

            selectedModuleType = button.getAttribute("data-module-type");
            renderModuleList();
            renderSelectedModule();
        });

        render();
    });
})();
