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
let modularConfigError = "";

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

    const errorHtml = modularConfigError ? `
        <div class="shader-config-error">${escapeHtml(modularConfigError)}</div>
    ` : "";

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
                        ${errorHtml}
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

    $(".shader-config-module-textarea").on("change", function() {
        updateModularGraphFromText(this.value);
    });

    $(".shader-config-module-textarea").on("keydown", function(event) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            updateModularGraphFromText(this.value);
        }
    });
}

function updateModularGraphFromText(text) {
    const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

    pendingGraphText = text;

    let parsed;
    try {
        parsed = JSON.parse(text);
        validateGraphConfig(parsed);
    } catch (error) {
        modularConfigError = error && error.message ? error.message : String(error);
        renderShaderConfigPanel();
        return;
    }

    shaderConfig.params = shaderConfig.params || {};
    shaderConfig.params.graph = parsed;
    shaderConfig.cache = {};

    pendingGraphText = null;
    modularConfigError = "";

    applyShaderLayerGuiConfig();
    renderShaderConfigPanel();
}

function validateGraphConfig(graph) {
    if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
        throw new Error("Modular configuration must be a JSON object.");
    }

    if (graph.version !== undefined && graph.version !== 1) {
        throw new Error(`Unsupported graph version '${graph.version}'.`);
    }

    if (!graph.nodes || typeof graph.nodes !== "object" || Array.isArray(graph.nodes)) {
        throw new Error("Modular configuration must contain a nodes object.");
    }

    if (!graph.output || typeof graph.output !== "string") {
        throw new Error("Modular configuration must contain an output string.");
    }

    for (const nodeId of Object.keys(graph.nodes)) {
        const node = graph.nodes[nodeId];

        if (!node || typeof node !== "object" || Array.isArray(node)) {
            throw new Error(`Node '${nodeId}' must be an object.`);
        }

        if (!node.type || typeof node.type !== "string") {
            throw new Error(`Node '${nodeId}' must declare a string type.`);
        }

        if (
            OpenSeadragon.FlexRenderer.ShaderModuleMediator &&
            !OpenSeadragon.FlexRenderer.ShaderModuleMediator.getClass(node.type)
        ) {
            throw new Error(`Node '${nodeId}' uses unknown module type '${node.type}'.`);
        }

        if (node.inputs !== undefined && (typeof node.inputs !== "object" || Array.isArray(node.inputs))) {
            throw new Error(`Node '${nodeId}' inputs must be an object map.`);
        }

        if (node.params !== undefined && (typeof node.params !== "object" || Array.isArray(node.params))) {
            throw new Error(`Node '${nodeId}' params must be an object.`);
        }
    }
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
