(function() {
    const ShaderConfigurator = OpenSeadragon.FlexRenderer.ShaderConfigurator;

    function countEntries(model, defName) {
        return Object.keys((model.$defs && model.$defs[defName]) || {}).length;
    }

    function getSelectedView(model) {
        const select = document.getElementById("schema-view");
        const view = select ? select.value : "full";

        if (view === "shaderLayers") {
            return (model.$defs && model.$defs.shaderLayers) || {};
        }

        if (view === "shaderModules") {
            return (model.$defs && model.$defs.shaderModules) || {};
        }

        if (view === "shaderModuleGraph") {
            return (model.$defs && model.$defs.shaderModuleGraph) || {};
        }

        if (view === "uiControlEnvelopes") {
            return (model.$defs && model.$defs.uiControlEnvelopes) || {};
        }

        return model;
    }

    function render() {
        const model = ShaderConfigurator.compileConfigSchemaModel();
        const graphSchemaExists = !!(model.$defs && model.$defs.shaderModuleGraph);

        document.getElementById("model-version").textContent = String(model["x-schemaVersion"] || "");
        document.getElementById("shader-count").textContent = String(countEntries(model, "shaderLayers"));
        document.getElementById("control-count").textContent = String(countEntries(model, "uiControlEnvelopes"));
        document.getElementById("module-count").textContent = String(countEntries(model, "shaderModules"));
        document.getElementById("graph-schema-status").textContent = graphSchemaExists ? "yes" : "no";
        document.getElementById("scheme-output").textContent = JSON.stringify(getSelectedView(model), null, 2);
    }

    window.addEventListener("load", () => {
        ShaderConfigurator.setUniqueId("configurator_scheme_demo");

        render();

        document.getElementById("refresh-btn").addEventListener("click", render);

        const schemaView = document.getElementById("schema-view");
        if (schemaView) {
            schemaView.addEventListener("change", render);
        }
    });
})();
