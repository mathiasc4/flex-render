(function() {
    const ShaderConfigurator = OpenSeadragon.FlexRenderer.ShaderConfigurator;

    function countControlEntries(model) {
        return Object.keys((model.$defs && model.$defs.uiControlEnvelopes) || {}).length;
    }

    function render() {
        const model = ShaderConfigurator.compileConfigSchemaModel();

        document.getElementById("model-version").textContent = String(model["x-schemaVersion"] || "");
        document.getElementById("shader-count").textContent = String(Object.keys((model.$defs && model.$defs.shaderLayers) || {}).length);
        document.getElementById("control-count").textContent = String(countControlEntries(model));
        document.getElementById("scheme-output").textContent = JSON.stringify(model, null, 2);
    }

    window.addEventListener("load", () => {
        ShaderConfigurator.setUniqueId("configurator_scheme_demo");
        render();
        document.getElementById("refresh-btn").addEventListener("click", render);
    });
})();
