(function() {
    const ShaderConfigurator = OpenSeadragon.FlexRenderer.ShaderConfigurator;

    function countControlEntries(model) {
        return Object.values(model.uiControls || {}).reduce((sum, entries) => sum + entries.length, 0);
    }

    function render() {
        const model = ShaderConfigurator.compileConfigSchemaModel();

        document.getElementById("model-version").textContent = String(model.version);
        document.getElementById("shader-count").textContent = String((model.shaders || []).length);
        document.getElementById("control-count").textContent = String(countControlEntries(model));
        document.getElementById("scheme-output").textContent = JSON.stringify(model, null, 2);
    }

    window.addEventListener("load", () => {
        ShaderConfigurator.setUniqueId("configurator_scheme_demo");
        render();
        document.getElementById("refresh-btn").addEventListener("click", render);
    });
})();
