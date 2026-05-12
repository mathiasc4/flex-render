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
    {
        key: "a",
        label: "A",
        tileSource: {
            type: "image",
            url: "../data/A.png",
        },
    },
    {
        key: "book",
        label: "Book",
        tileSource: "../data/iiif_1_0_files/info.json",
    },
];


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
    "rainbow": {
        "name": "Rainbow",
        "type": "identity",
        "tiledImages": [0],
    },
    "duomo": {
        "name": "Duomo",
        "type": "identity",
        "tiledImages": [3],
    },
    "group": {
        "name": "Group Layer",
        "type": "group",
        "shaders": {
            "leaves": {
                "name": "Leaves",
                "type": "identity",
                "tiledImages": [1],
            },
            "bblue": {
                "name": "Blue B",
                "type": "identity",
                "tiledImages": [2],
            },
            "nested": {
                "name": "Nested Group Layer",
                "type": "group",
                "shaders": {
                    "book": {
                        "name": "Book",
                        "type": "identity",
                        "tiledImages": [5],
                    },
                    "a": {
                        "name": "A",
                        "type": "identity",
                        "tiledImages": [4],
                    }
                }
            }
        },
    },
};

let shaderLayerOrder = Object.keys(shaderLayerConfig);


function renderShaderLayerControls(shaderLayer, shaderConfig, htmlContext = {}) {
    const container = document.getElementById("my-shader-ui-container");

    if (!container || !shaderLayer) {
        return "";
    }

    const depth = Number.isFinite(htmlContext.depth) ? htmlContext.depth : 0;
    const isGroupChild = !!htmlContext.isGroupChild;
    const isGroup = shaderConfig.type === "group";
    const parentName = htmlContext.parentConfig ?
        (htmlContext.parentConfig.name || htmlContext.parentConfig.type || htmlContext.parentShaderId) :
        null;

    const wrapper = document.createElement("div");
    wrapper.className = [
        "shader-control-card",
        `shader-control-card--depth-${depth}`,
        isGroupChild ? "shader-control-card--group-child" : "shader-control-card--top",
        isGroup ? "shader-control-card--group" : "",
    ].filter(Boolean).join(" ");

    wrapper.style.marginLeft = `${depth * 18}px`;
    wrapper.style.marginBottom = "6px";
    wrapper.style.padding = "6px";
    wrapper.style.border = "1px solid #d1d5db";
    wrapper.style.borderLeft = isGroupChild ? "3px solid #d1d5db" : "1px solid #d1d5db";
    wrapper.style.borderRadius = "0";
    wrapper.style.background = isGroupChild ? "#fafafa" : "#ffffff";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "flex-start";
    header.style.justifyContent = "space-between";
    header.style.gap = "10px";
    header.style.marginBottom = "6px";

    const titleWrap = document.createElement("div");
    titleWrap.style.minWidth = "0";
    titleWrap.appendChild(createShaderControlTitle(shaderConfig));

    if (isGroupChild && parentName) {
        const parentLabel = document.createElement("div");
        parentLabel.style.fontSize = "12px";
        parentLabel.style.color = "#6b7280";
        parentLabel.style.marginTop = "2px";
        parentLabel.textContent = `In group: ${parentName}`;
        titleWrap.appendChild(parentLabel);
    }

    header.appendChild(titleWrap);
    header.appendChild(createShaderBadges({ isGroup, isGroupChild, depth }));
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

function createShaderBadges({ isGroup, isGroupChild, depth }) {
    const badges = document.createElement("div");
    badges.style.display = "flex";
    badges.style.gap = "6px";
    badges.style.flexWrap = "wrap";
    badges.style.justifyContent = "flex-end";

    if (isGroup) {
        badges.appendChild(createBadge("Group", {
            border: "1px solid #9ca3af",
            background: "#ffffff",
        }));
    }

    if (isGroupChild) {
        badges.appendChild(createBadge(`Level ${depth}`, {
            background: "#e5e7eb",
        }));
    }

    return badges;
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
    ensureGroupOrders(shaderLayerConfig);

    setPanelHtml("shader-config-panel", `
        <h3>Shader layer configuration</h3>
        ${renderShaderConfigList(shaderLayerConfig, shaderLayerOrder)}
        <p class="shader-config-help">
            Drag layers to reorder them. Edit names directly. Choose image indexes from the Image sources table.
            Mode controls whether the layer is shown, blended, or used as a clip.
            Blend controls how the layer combines when mode is blend or clip.
            Group layers keep their type fixed and do not bind directly to an image source.
            Changing a non-group type resets shader-specific params and cache.
        </p>
    `);

    bindShaderConfigPanelEvents();
}

function renderShaderConfigList(shaderMap, order, path = []) {
    const rows = order
        .filter((shaderId) => shaderMap[shaderId])
        .map((shaderId) => renderShaderConfigItem(shaderId, shaderMap[shaderId], path))
        .join("");

    return `
        <ul
            class="shader-config-list ${path.length ? "shader-config-list--children" : ""}"
            data-order-path="${escapeHtml(encodePath(path))}"
        >
            ${rows}
        </ul>
    `;
}

function renderShaderConfigItem(shaderId, shaderConfig, path) {
    const currentPath = path.concat([shaderId]);
    const pathString = encodePath(currentPath);
    const isGroup = shaderConfig.type === "group";
    const visible = shaderConfig.visible !== 0;
    const name = shaderConfig.name || shaderId;
    const children = isGroup ? renderShaderConfigList(
        shaderConfig.shaders || {},
        shaderConfig.order || Object.keys(shaderConfig.shaders || {}),
        currentPath
    ) : "";

    return `
        <li class="shader-config-item" data-shader-id="${escapeHtml(shaderId)}">
            <div class="shader-config-row ${isGroup ? "shader-config-row--group" : ""}">
            <span class="shader-config-drag-handle ui-icon ui-icon-arrowthick-2-n-s"></span>

            <label class="shader-config-visible-label" title="Visible">
                <input
                    type="checkbox"
                    class="shader-config-visible-toggle"
                    data-shader-path="${escapeHtml(pathString)}"
                    ${visible ? "checked" : ""}
                >
            </label>

            <label class="shader-config-field-label shader-config-row__name">
                Name
                <input
                    type="text"
                    class="shader-config-name-input"
                    data-shader-path="${escapeHtml(pathString)}"
                    value="${escapeHtml(name)}"
                >
            </label>

            <div class="shader-config-row__selectors">
                <div class="shader-config-row__type">
                    ${renderShaderTypeControl(shaderConfig, pathString)}
                </div>

                <div class="shader-config-row__image">
                    ${renderShaderImageIndexControl(shaderConfig, pathString)}
                </div>
            </div>

            <div class="shader-config-row__blend">
                ${renderShaderBlendControls(shaderConfig, pathString)}
            </div>
        </div>

            ${children}
        </li>
    `;
}

function renderShaderTypeControl(shaderConfig, pathString) {
    if (shaderConfig.type === "group") {
        return `
            <label class="shader-config-field-label">
                Type
                <span class="shader-config-type-locked">group</span>
            </label>
        `;
    }

    return `
        <label class="shader-config-field-label">
            Type
            <select class="shader-config-type-select" data-shader-path="${escapeHtml(pathString)}">
                ${renderShaderTypeOptions(shaderConfig.type)}
            </select>
        </label>
    `;
}

function renderShaderTypeOptions(selectedType) {
    return getAvailableNonGroupShaderTypes().map((shaderType) => {
        const selected = shaderType.type === selectedType ? "selected" : "";

        return `
            <option value="${escapeHtml(shaderType.type)}" ${selected}>
                ${escapeHtml(shaderType.name)} (${escapeHtml(shaderType.type)})
            </option>
        `;
    }).join("");
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

function renderUseModeOptions(selectedMode) {
    return ["show", "blend", "clip"].map((mode) => {
        const selected = mode === selectedMode ? "selected" : "";

        return `
            <option value="${escapeHtml(mode)}" ${selected}>
                ${escapeHtml(mode)}
            </option>
        `;
    }).join("");
}

function renderUseBlendOptions(selectedBlend) {
    return [
        "mask",
        "add",
        "multiply",
        "screen",
        "overlay",
        "darken",
        "lighten",
        "difference",
        "exclusion",
        "source-over",
        "source-in",
        "source-out",
        "source-atop",
    ].map((blend) => {
        const selected = blend === selectedBlend ? "selected" : "";

        return `
            <option value="${escapeHtml(blend)}" ${selected}>
                ${escapeHtml(blend)}
            </option>
        `;
    }).join("");
}

function renderShaderImageIndexControl(shaderConfig, pathString) {
    if (shaderConfig.type === "group") {
        return `
            <label class="shader-config-field-label">
                Image
                <span class="shader-config-type-locked">—</span>
            </label>
        `;
    }

    const selectedIndex = Array.isArray(shaderConfig.tiledImages) && shaderConfig.tiledImages.length ?
        Number(shaderConfig.tiledImages[0]) :
        0;

    return `
        <label class="shader-config-field-label">
            Image
            <select class="shader-config-image-index-select" data-shader-path="${escapeHtml(pathString)}">
                ${renderImageIndexOptions(selectedIndex)}
            </select>
        </label>
    `;
}

function renderShaderBlendControls(shaderConfig, pathString) {
    const params = shaderConfig.params || {};
    const selectedMode = params.use_mode || "show";
    const selectedBlend = params.use_blend || "mask";
    const blendDisabled = selectedMode === "show" ? "disabled" : "";

    return `
        <div class="shader-config-row__use-mode">
            <label class="shader-config-field-label">
                Mode
                <select class="shader-config-use-mode-select" data-shader-path="${escapeHtml(pathString)}">
                    ${renderUseModeOptions(selectedMode)}
                </select>
            </label>
        </div>

        <div class="shader-config-row__use-blend">
            <label class="shader-config-field-label">
                Blend
                <select
                    class="shader-config-use-blend-select"
                    data-shader-path="${escapeHtml(pathString)}"
                    ${blendDisabled}
                >
                    ${renderUseBlendOptions(selectedBlend)}
                </select>
            </label>
        </div>
    `;
}

function bindShaderConfigPanelEvents() {
    $(".shader-config-list").sortable({
        handle: ".shader-config-drag-handle",
        items: "> .shader-config-item",
        update: function() {
            const orderPath = decodePath($(this).attr("data-order-path"));
            const orderOwner = getOrderOwnerFromPath(orderPath);

            if (!orderOwner) {
                return;
            }

            orderOwner.setOrder($(this)
                .children(".shader-config-item")
                .map((_, item) => $(item).attr("data-shader-id"))
                .get());

            applyShaderLayerGuiConfig();
            renderShaderConfigPanel();
        },
    });

    $(".shader-config-visible-toggle").on("change", function() {
        updateShaderConfigFromPath(this, (shaderConfig) => {
            shaderConfig.visible = this.checked ? 1 : 0;
        });
    });

    $(".shader-config-name-input").on("change", function() {
        updateShaderConfigFromPath(this, (shaderConfig, shaderPath) => {
            shaderConfig.name = this.value.trim() || shaderPath[shaderPath.length - 1];
        });
    });

    $(".shader-config-image-index-select").on("change", function() {
        updateShaderConfigFromPath(this, (shaderConfig) => {
            if (shaderConfig.type === "group") {
                return;
            }

            shaderConfig.tiledImages = [Number(this.value)];
        });
    });

    $(".shader-config-use-mode-select").on("change", function() {
        updateShaderConfigFromPath(this, (shaderConfig) => {
            shaderConfig.params = shaderConfig.params || {};
            shaderConfig.params.use_mode = this.value;
        });
    });

    $(".shader-config-use-blend-select").on("change", function() {
        updateShaderConfigFromPath(this, (shaderConfig) => {
            shaderConfig.params = shaderConfig.params || {};
            shaderConfig.params.use_blend = this.value;
        });
    });

    $(".shader-config-type-select").on("change", function() {
        updateShaderConfigFromPath(this, (shaderConfig) => {
            if (shaderConfig.type === "group") {
                return;
            }

            const previousParams = shaderConfig.params || {};
            const preservedGlobalParams = {
                use_mode: previousParams.use_mode,
                use_blend: previousParams.use_blend,
            };

            shaderConfig.type = this.value;
            shaderConfig.params = Object.fromEntries(
                Object.entries(preservedGlobalParams).filter(([, value]) => value !== undefined)
            );
            shaderConfig.cache = {};
        });
    });
}

function updateShaderConfigFromPath(element, update) {
    const shaderPath = decodePath($(element).attr("data-shader-path"));
    const shaderConfig = getShaderConfigByPath(shaderPath);

    if (!shaderConfig) {
        return;
    }

    update(shaderConfig, shaderPath);
    applyShaderLayerGuiConfig();
    renderShaderConfigPanel();
}

function getAvailableNonGroupShaderTypes() {
    return OpenSeadragon.FlexRenderer.ShaderLayerRegistry
        .availableShaderLayers()
        .filter((Shader) => Shader.type() !== "group")
        .map((Shader) => ({
            type: Shader.type(),
            name: Shader.name ? Shader.name() : Shader.type(),
        }));
}

function getShaderConfigByPath(path) {
    const shaderId = path[path.length - 1];
    const parentMap = getShaderMapFromPath(path.slice(0, -1));

    return parentMap ? parentMap[shaderId] : null;
}

function getOrderOwnerFromPath(path) {
    if (!path.length) {
        return {
            order: shaderLayerOrder,
            setOrder: (nextOrder) => {
                shaderLayerOrder = nextOrder;
            },
        };
    }

    const groupConfig = getShaderConfigByPath(path);

    if (!groupConfig || groupConfig.type !== "group") {
        return null;
    }

    groupConfig.order = groupConfig.order || Object.keys(groupConfig.shaders || {});

    return {
        order: groupConfig.order,
        setOrder: (nextOrder) => {
            groupConfig.order = nextOrder;
        },
    };
}

function getShaderMapFromPath(path) {
    let shaderMap = shaderLayerConfig;

    for (const shaderId of path) {
        const shaderConfig = shaderMap[shaderId];

        if (!shaderConfig || shaderConfig.type !== "group") {
            return null;
        }

        shaderMap = shaderConfig.shaders || {};
    }

    return shaderMap;
}

function ensureGroupOrders(shaderMap = shaderLayerConfig) {
    Object.values(shaderMap || {}).forEach((shaderConfig) => {
        if (!shaderConfig || shaderConfig.type !== "group") {
            return;
        }

        const childMap = shaderConfig.shaders || {};
        const childIds = Object.keys(childMap);
        const existingOrder = Array.isArray(shaderConfig.order) ? shaderConfig.order : childIds;

        shaderConfig.order = existingOrder
            .filter((childId) => childMap[childId])
            .concat(childIds.filter((childId) => !existingOrder.includes(childId)));

        ensureGroupOrders(childMap);
    });
}

function applyShaderLayerGuiConfig() {
    ensureGroupOrders(shaderLayerConfig);
    viewer.drawer.overrideConfigureAll(shaderLayerConfig, shaderLayerOrder);
}

function encodePath(path) {
    return path.join("/");
}

function decodePath(pathString) {
    return pathString ? String(pathString).split("/") : [];
}

function setPanelHtml(id, html) {
    const container = document.getElementById(id);

    if (container) {
        container.innerHTML = html;
    }
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
