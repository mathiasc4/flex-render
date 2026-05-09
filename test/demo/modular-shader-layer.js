const IMAGE_SOURCES = [
    {
        key: "rainbow",
        label: "Rainbow Grid",
        tileSource: "../data/testpattern.dzi",
    },
    {
        key: "leaves",
        label: "Leaves",
        tileSource: "../data/iiif_2_0_sizes/info.json",
    },
    {
        key: "a",
        label: "A",
        tileSource: {
            type: "image",
            url: "../data/A.png",
        },
    },
    {
        key: "bblue",
        label: "Blue B",
        tileSource: {
            type: "image",
            url: "../data/BBlue.png",
        },
    },
    {
        key: "duomo",
        label: "Duomo",
        tileSource: "https://openseadragon.github.io/example-images/duomo/duomo.dzi",
    },
];

const MODULAR_SHADER_ID = "modular";

const DEFAULT_MODULAR_GRAPH = {
    nodes: {
        src: {
            type: "sample-source-channel",
            params: {
                sourceIndex: 0,
                channelIndex: 0
            }
        },
        threshold: {
            type: "threshold-mask",
            inputs: {
                value: "src.value",
            },
            params: {
                threshold: 0.5,
            },
        },
        colorize: {
            type: "colorize",
            inputs: {
                value: "src.value",
                alpha: "threshold.mask",
            },
            params: {
                color: "#00ffff",
            }
        },
    },
    output: "colorize.color",
};

const drawer = "flex-renderer";
const drawerOptions = {
    "flex-renderer": {
        debug: false,
        webGLPreferredVersion: "2.0",
        htmlHandler: renderShaderLayerControls,
        htmlReset: resetShaderLayerControls,
    },
};

const viewportMargins = {
    left: 100,
    top: 0,
    right: 0,
    bottom: 50,
};

$("#title-w").html("OpenSeadragon viewer using FlexRenderer");

const viewer = window.viewer = OpenSeadragon({
    id: "drawer-canvas",
    prefixUrl: "../../openseadragon/images/",
    minZoomImageRatio: 0.01,
    maxZoomPixelRatio: 100,
    smoothTileEdgesMinZoom: 1.1,
    crossOriginPolicy: "Anonymous",
    ajaxWithCredentials: false,
    drawer: drawer,
    drawerOptions: drawerOptions,
    blendTime: 0,
    showNavigator: true,
    viewportMargins: viewportMargins,
});

const indexedImageSources = IMAGE_SOURCES.map((source, index) => ({
    index,
    label: source.label,
}));

IMAGE_SOURCES.forEach((source) => {
    viewer.addTiledImage({
        tileSource: source.tileSource,
    });
});

let shaderLayerConfig = {
    [MODULAR_SHADER_ID]: {
        name: "Modular heatmap",
        type: "modular",
        visible: 1,
        fixed: false,
        tiledImages: [0],
        params: {
            graph: cloneJson(DEFAULT_MODULAR_GRAPH),
        },
        cache: {},
    },
};

let shaderLayerOrder = [MODULAR_SHADER_ID];

let pendingGraphText = null;
let modularConfigDiagnostics = [];
let modularConfigAnalysis = null;

function renderShaderLayerControls(shaderLayer, shaderConfig) {
    const container = document.getElementById("my-shader-ui-container");

    if (!container || !shaderLayer) {
        return "";
    }

    const wrapper = document.createElement("div");
    wrapper.className = "shader-control-card shader-control-card--top";
    wrapper.style.marginBottom = "6px";
    wrapper.style.padding = "6px";
    wrapper.style.border = "1px solid #d1d5db";
    wrapper.style.borderRadius = "0";
    wrapper.style.background = "#ffffff";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "flex-start";
    header.style.justifyContent = "space-between";
    header.style.gap = "10px";
    header.style.marginBottom = "6px";

    const titleWrap = document.createElement("div");
    titleWrap.style.minWidth = "0";
    titleWrap.appendChild(createShaderControlTitle(shaderConfig));

    header.appendChild(titleWrap);
    header.appendChild(createBadge("Modular", {
        border: "1px solid #9ca3af",
        background: "#ffffff",
    }));
    wrapper.appendChild(header);

    if (shaderLayer.error) {
        const errorNode = document.createElement("div");
        errorNode.style.marginBottom = "8px";
        errorNode.style.color = "#b91c1c";
        errorNode.style.fontSize = "12px";
        errorNode.textContent = shaderLayer.error;
        wrapper.appendChild(errorNode);
    }

    const controls = document.createElement("div");
    controls.className = "shader-control-card__controls";
    controls.innerHTML = shaderLayer.htmlControls();
    wrapper.appendChild(controls);

    container.appendChild(wrapper);
    return "";
}

function resetShaderLayerControls() {
    const container = document.getElementById("my-shader-ui-container");

    if (container) {
        container.innerHTML = "";
    }
}

function createShaderControlTitle(shaderConfig) {
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.margin = "0";
    title.textContent = shaderConfig.name || shaderConfig.type;

    return title;
}

function createBadge(text, style = {}) {
    const badge = document.createElement("span");
    badge.textContent = text;
    badge.style.fontSize = "11px";
    badge.style.padding = "2px 6px";
    badge.style.borderRadius = "999px";
    badge.style.color = "#374151";
    badge.style.whiteSpace = "nowrap";

    Object.assign(badge.style, style);
    return badge;
}

function renderImageSourceIndexPanel() {
    const rows = indexedImageSources.map((source) => `
        <tr>
            <td>${escapeHtml(source.label)}</td>
            <td><code>${source.index}</code></td>
        </tr>
    `).join("");

    setPanelHtml("image-source-index-panel", `
        <h3>Image sources</h3>
        <table class="image-source-index-table">
            <thead>
                <tr>
                    <th>Label</th>
                    <th>Index</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `);
}

function renderShaderConfigPanel() {
    const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

    setPanelHtml("shader-config-panel", `
        <h3>Shader layer configuration</h3>
        ${renderModularShaderConfigCard(shaderConfig)}
        <p class="shader-config-help">
            This demo contains one fixed <code>modular</code> shader layer.
            Edit the layer name, choose the image source, or replace the graph JSON below.
            The graph must compile to a <code>vec4</code> output.
        </p>
    `);

    bindShaderConfigPanelEvents();
}

function renderModularShaderConfigCard(shaderConfig) {
    const name = shaderConfig.name || MODULAR_SHADER_ID;
    const selectedIndex = Array.isArray(shaderConfig.tiledImages) && shaderConfig.tiledImages.length ?
        Number(shaderConfig.tiledImages[0]) :
        0;

    const graphText = pendingGraphText !== null ?
        pendingGraphText : JSON.stringify(getGraphConfig(shaderConfig), null, 4);

    const diagnosticsHtml = modularConfigDiagnostics.length ? renderGraphDiagnostics(modularConfigDiagnostics) : "";

    return `
        <ul class="shader-config-list">
            <li class="shader-config-item" data-shader-id="${escapeHtml(MODULAR_SHADER_ID)}">
                <div class="shader-config-row shader-config-row--modular">
                    <label class="shader-config-field-label shader-config-row__name">
                        Name
                        <input
                            type="text"
                            class="shader-config-name-input"
                            value="${escapeHtml(name)}"
                        >
                    </label>

                    <div class="shader-config-row__selectors">
                        <div class="shader-config-row__type">
                            <label class="shader-config-field-label">
                                Type
                                <span class="shader-config-type-locked">modular</span>
                            </label>
                        </div>

                        <div class="shader-config-row__image">
                            <label class="shader-config-field-label">
                                Image
                                <select class="shader-config-image-index-select">
                                    ${renderImageIndexOptions(selectedIndex)}
                                </select>
                            </label>
                        </div>
                    </div>

                    <div class="shader-config-row__module">
                        <label class="shader-config-field-label">
                            Modular configuration <span class="shader-config-type-locked">params.graph JSON</span>
                            <textarea
                                class="shader-config-module-textarea"
                                spellcheck="false"
                            >${escapeHtml(graphText)}</textarea>
                        </label>
                        ${diagnosticsHtml}
                    </div>
                </div>
            </li>
        </ul>
    `;
}

function renderImageIndexOptions(selectedIndex) {
    return indexedImageSources.map((source) => {
        const selected = source.index === selectedIndex ? "selected" : "";

        return `
            <option value="${source.index}" ${selected}>
                ${escapeHtml(source.label)} (${source.index})
            </option>
        `;
    }).join("");
}

function bindShaderConfigPanelEvents() {
    $(".shader-config-name-input").on("change", function() {
        const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

        shaderConfig.name = this.value.trim() || MODULAR_SHADER_ID;
        applyShaderLayerGuiConfig();
        renderShaderConfigPanel();
    });

    $(".shader-config-image-index-select").on("change", function() {
        const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

        shaderConfig.tiledImages = [Number(this.value)];
        applyShaderLayerGuiConfig();
        renderShaderConfigPanel();
    });

    $(".shader-config-module-textarea").on("input", function() {
        updateDraftGraphDiagnostics(this.value);
    });

    $(".shader-config-module-textarea").on("change", function() {
        commitModularGraphFromText(this.value);
    });

    $(".shader-config-module-textarea").on("keydown", function(event) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            commitModularGraphFromText(this.value);
        }
    });
}

function updateDraftGraphDiagnostics(text) {
    pendingGraphText = text;

    const result = analyzeGraphText(text);
    modularConfigAnalysis = result.analysis;
    modularConfigDiagnostics = result.diagnostics;

    renderGraphDiagnosticsIntoPanel();
}

function commitModularGraphFromText(text) {
    const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

    pendingGraphText = text;

    const result = analyzeGraphText(text);
    modularConfigAnalysis = result.analysis;
    modularConfigDiagnostics = result.diagnostics;

    if (modularConfigDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        renderShaderConfigPanel();
        return;
    }

    shaderConfig.params = shaderConfig.params || {};
    shaderConfig.params.graph = result.graph;
    shaderConfig.cache = {};

    pendingGraphText = null;
    modularConfigDiagnostics = [];
    modularConfigAnalysis = null;

    applyShaderLayerGuiConfig();
    renderShaderConfigPanel();
}

function analyzeGraphText(text) {
    let graph;

    try {
        graph = JSON.parse(text);
    } catch (error) {
        return {
            graph: null,
            analysis: null,
            diagnostics: [{
                severity: "error",
                code: "invalid-json",
                message: error && error.message ? error.message : String(error),
                path: [],
                details: {}
            }]
        };
    }

    return analyzeGraphConfig(graph);
}

function analyzeGraphConfig(graph) {
    const diagnostics = [];

    if (graph && typeof graph === "object" && !Array.isArray(graph) &&
        graph.version !== undefined && graph.version !== 1) {
        diagnostics.push({
            severity: "error",
            code: "unsupported-graph-version",
            message: `Unsupported graph version '${graph.version}'.`,
            path: ["version"],
            details: {
                version: graph.version,
                supportedVersion: 1
            }
        });
    }

    const Graph = OpenSeadragon.FlexRenderer.ShaderModuleGraph;
    if (!Graph || typeof Graph.analyze !== "function") {
        diagnostics.push({
            severity: "error",
            code: "graph-analyzer-unavailable",
            message: "ShaderModuleGraph.analyze(...) is not available in the current FlexRenderer build.",
            path: [],
            details: {}
        });

        return {
            graph,
            analysis: null,
            diagnostics
        };
    }

    const analysis = Graph.analyze(makeDraftModuleGraphOwner(), graph);
    diagnostics.push(...analysis.diagnostics);

    return {
        graph,
        analysis,
        diagnostics
    };
}

function makeDraftModuleGraphOwner() {
    const liveLayer = viewer &&
    viewer.drawer &&
    viewer.drawer.flexRenderer &&
    typeof viewer.drawer.flexRenderer.getShaderLayer === "function" ?
        viewer.drawer.flexRenderer.getShaderLayer(MODULAR_SHADER_ID) :
        null;

    if (liveLayer) {
        return liveLayer;
    }

    return {
        id: MODULAR_SHADER_ID,
        uid: MODULAR_SHADER_ID,
        constructor: {
            type: () => "modular"
        }
    };
}

function renderGraphDiagnostics(diagnostics) {
    const visibleDiagnostics = diagnostics.filter((diagnostic) =>
        diagnostic && diagnostic.severity !== "info"
    );

    if (!visibleDiagnostics.length) {
        return "";
    }

    const rows = visibleDiagnostics.map((diagnostic) => `
        <li class="shader-config-diagnostics__item">
            <span class="shader-config-diagnostics__code">${escapeHtml(diagnostic.code || "diagnostic")}</span>
            ${renderDiagnosticPath(diagnostic)}
            — ${escapeHtml(diagnostic.message || "Graph diagnostic.")}
        </li>
    `).join("");

    return `
        <div class="shader-config-diagnostics">
            <div class="shader-config-diagnostics__title">
                Graph configuration diagnostics
            </div>
            <ul class="shader-config-diagnostics__list">
                ${rows}
            </ul>
        </div>
    `;
}

function renderDiagnosticPath(diagnostic) {
    if (!diagnostic || !Array.isArray(diagnostic.path) || !diagnostic.path.length) {
        return "";
    }

    return `
        <span class="shader-config-diagnostics__path">
            [${escapeHtml(formatDiagnosticPath(diagnostic.path))}]
        </span>
    `;
}

function formatDiagnosticPath(path) {
    return path.map((part) => {
        if (typeof part === "number") {
            return `[${part}]`;
        }

        return String(part);
    }).join(".");
}

function renderGraphDiagnosticsIntoPanel() {
    const modulePanel = document.querySelector(".shader-config-row__module");
    if (!modulePanel) {
        return;
    }

    const existing = modulePanel.querySelector(".shader-config-diagnostics");
    if (existing) {
        existing.remove();
    }

    const html = renderGraphDiagnostics(modularConfigDiagnostics);
    if (!html) {
        return;
    }

    modulePanel.insertAdjacentHTML("beforeend", html);
}

function getGraphConfig(shaderConfig) {
    const params = shaderConfig.params || {};
    return params.graph || cloneJson(DEFAULT_MODULAR_GRAPH);
}

function applyShaderLayerGuiConfig() {
    viewer.drawer.overrideConfigureAll(shaderLayerConfig, shaderLayerOrder);
}

function setPanelHtml(id, html) {
    const container = document.getElementById(id);

    if (container) {
        container.innerHTML = html;
    }
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

applyShaderLayerGuiConfig();
renderImageSourceIndexPanel();
renderShaderConfigPanel();
