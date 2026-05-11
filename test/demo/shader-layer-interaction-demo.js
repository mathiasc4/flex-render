const IMAGE_SOURCES = [
    {
        key: "rainbow",
        label: "Rainbow Grid",
        tileSource: "../data/testpattern.dzi"
    },
    {
        key: "leaves",
        label: "Leaves",
        tileSource: "../data/iiif_2_0_sizes/info.json"
    },
    {
        key: "a",
        label: "A",
        tileSource: {
            type: "image",
            url: "../data/A.png"
        }
    },
    {
        key: "bblue",
        label: "Blue B",
        tileSource: {
            type: "image",
            url: "../data/BBlue.png"
        }
    },
    {
        key: "duomo",
        label: "Duomo",
        tileSource: "https://openseadragon.github.io/example-images/duomo/duomo.dzi"
    },
];

const drawerOptions = {
    "flex-renderer": {
        debug: false,
        webGLPreferredVersion: "2.0",
        interaction: {
            enabled: true,
            preventContextMenu: true,
            notifyOnMove: false,
            viewerInputCaptureMode: "drag"
        },
        htmlHandler: renderShaderLayerControls,
        htmlReset: resetShaderLayerControls
    }
};

$("#title-w").html("FlexRenderer interaction uniform demo");

const viewer = window.viewer = OpenSeadragon({
    id: "drawer-canvas",
    prefixUrl: "../../openseadragon/images/",
    minZoomImageRatio: 0.01,
    maxZoomPixelRatio: 100,
    smoothTileEdgesMinZoom: 1.1,
    crossOriginPolicy: "Anonymous",
    ajaxWithCredentials: false,
    drawer: "flex-renderer",
    drawerOptions,
    blendTime: 0,
    showNavigator: true,
    viewportMargins: {
        left: 100,
        top: 0,
        right: 0,
        bottom: 50
    }
});

IMAGE_SOURCES.forEach((source) => {
    viewer.addTiledImage({
        tileSource: source.tileSource
    });
});

const indexedImageSources = IMAGE_SOURCES.map((source, index) => ({
    index,
    label: source.label
}));

let shaderLayerConfig = {
    base_rainbow: {
        name: "Rainbow",
        type: "identity",
        visible: 1,
        fixed: false,
        tiledImages: [0]
    },
    below_leaves: {
        name: "Leaves",
        type: "fisheye-lens",
        visible: 1,
        fixed: false,
        tiledImages: [1]
    },
    interaction_debug: {
        name: "Interaction Debug",
        type: "interaction-debug",
        visible: 1,
        fixed: false,
        tiledImages: [],
        cache: {}
    },
    above_bblue: {
        name: "Blue B",
        type: "identity",
        visible: 0,
        fixed: false,
        tiledImages: [3]
    },
};

let shaderLayerOrder = [
    "base_rainbow",
    "below_leaves",
    "interaction_debug",
    "above_bblue"
];

function makeLayerConfig(name, type, tiledImages, mode = "show", blend = "source-over") {
    return
}

function renderShaderLayerControls(shaderLayer, shaderConfig) {
    const container = document.getElementById("my-shader-ui-container");

    if (!container || !shaderLayer) {
        return "";
    }

    const card = document.createElement("div");
    card.style.marginBottom = "6px";
    card.style.padding = "6px";
    card.style.border = "1px solid #d1d5db";
    card.style.background = "#ffffff";

    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.marginBottom = "6px";
    title.textContent = shaderConfig.name || shaderConfig.type;

    const controls = document.createElement("div");
    controls.innerHTML = shaderLayer.htmlControls();

    card.appendChild(title);
    card.appendChild(controls);
    container.appendChild(card);

    return "";
}

function resetShaderLayerControls() {
    const container = document.getElementById("my-shader-ui-container");

    if (container) {
        container.innerHTML = "";
    }
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
    const rows = shaderLayerOrder
        .filter((shaderId) => shaderLayerConfig[shaderId])
        .map((shaderId) => renderShaderConfigItem(shaderId, shaderLayerConfig[shaderId]))
        .join("");

    setPanelHtml("shader-config-panel", `
        <h3>Shader layer configuration</h3>

        <ul class="shader-config-list">
            ${rows}
        </ul>

        <p class="shader-config-help">
            Drag layers to reorder them. Keep at least one layer above and below Interaction Debug
            to test composition. Toggle visibility, mode, blend, type, and image source to validate
            that the interaction layer behaves as a regular ShaderLayer.
        </p>
    `);

    bindShaderConfigPanelEvents();
}

function renderShaderConfigItem(shaderId, shaderConfig) {
    const visible = shaderConfig.visible !== 0;

    return `
        <li class="shader-config-item" data-shader-id="${escapeHtml(shaderId)}">
            <div class="shader-config-row">
                <span class="shader-config-drag-handle ui-icon ui-icon-arrowthick-2-n-s"></span>

                <label class="shader-config-visible-label" title="Visible">
                    <input
                        type="checkbox"
                        class="shader-config-visible-toggle"
                        data-shader-id="${escapeHtml(shaderId)}"
                        ${visible ? "checked" : ""}
                    >
                </label>

                <label class="shader-config-field-label shader-config-row__name">
                    Name
                    <input
                        type="text"
                        class="shader-config-name-input"
                        data-shader-id="${escapeHtml(shaderId)}"
                        value="${escapeHtml(shaderConfig.name || shaderId)}"
                    >
                </label>

                <div class="shader-config-row__selectors">
                    <div class="shader-config-row__type">
                        ${renderShaderTypeControl(shaderConfig, shaderId)}
                    </div>

                    <div class="shader-config-row__image">
                        ${renderImageIndexControl(shaderConfig, shaderId)}
                    </div>
                </div>

                <div class="shader-config-row__blend">
                    ${renderBlendControls(shaderConfig, shaderId)}
                </div>
            </div>
        </li>
    `;
}

function renderShaderTypeControl(shaderConfig, shaderId) {
    const options = OpenSeadragon.FlexRenderer.ShaderMediator
        .availableShaders()
        .filter((Shader) => Shader.type() !== "group")
        .map((Shader) => {
            const type = Shader.type();
            const name = Shader.name ? Shader.name() : type;
            const selected = type === shaderConfig.type ? "selected" : "";

            return `
                <option value="${escapeHtml(type)}" ${selected}>
                    ${escapeHtml(name)} (${escapeHtml(type)})
                </option>
            `;
        })
        .join("");

    return `
        <label class="shader-config-field-label">
            Type
            <select class="shader-config-type-select" data-shader-id="${escapeHtml(shaderId)}">
                ${options}
            </select>
        </label>
    `;
}

function renderImageIndexControl(shaderConfig, shaderId) {
    if (!shaderTypeHasSources(shaderConfig.type)) {
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

    const options = indexedImageSources.map((source) => {
        const selected = source.index === selectedIndex ? "selected" : "";

        return `
            <option value="${source.index}" ${selected}>
                ${escapeHtml(source.label)} (${source.index})
            </option>
        `;
    }).join("");

    return `
        <label class="shader-config-field-label">
            Image
            <select class="shader-config-image-index-select" data-shader-id="${escapeHtml(shaderId)}">
                ${options}
            </select>
        </label>
    `;
}

function renderBlendControls(shaderConfig, shaderId) {
    const params = shaderConfig.params || {};
    const selectedMode = params.use_mode || "show";
    const selectedBlend = params.use_blend || "source-over";
    const blendDisabled = selectedMode === "show" ? "disabled" : "";

    return `
        <div class="shader-config-row__use-mode">
            <label class="shader-config-field-label">
                Mode
                <select class="shader-config-use-mode-select" data-shader-id="${escapeHtml(shaderId)}">
                    ${renderOptions(["show", "blend", "clip"], selectedMode)}
                </select>
            </label>
        </div>

        <div class="shader-config-row__use-blend">
            <label class="shader-config-field-label">
                Blend
                <select
                    class="shader-config-use-blend-select"
                    data-shader-id="${escapeHtml(shaderId)}"
                    ${blendDisabled}
                >
                    ${renderOptions([
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
        "source-atop"
    ], selectedBlend)}
                </select>
            </label>
        </div>
    `;
}

function renderOptions(values, selectedValue) {
    return values.map((value) => {
        const selected = value === selectedValue ? "selected" : "";

        return `
            <option value="${escapeHtml(value)}" ${selected}>
                ${escapeHtml(value)}
            </option>
        `;
    }).join("");
}

function bindShaderConfigPanelEvents() {
    $(".shader-config-list").sortable({
        handle: ".shader-config-drag-handle",
        items: "> .shader-config-item",
        update: function() {
            shaderLayerOrder = $(this)
                .children(".shader-config-item")
                .map((_, item) => $(item).attr("data-shader-id"))
                .get();

            applyShaderLayerGuiConfig();
            renderShaderConfigPanel();
        }
    });

    $(".shader-config-visible-toggle").on("change", function() {
        updateShaderConfig(this, (shaderConfig) => {
            shaderConfig.visible = this.checked ? 1 : 0;
        });
    });

    $(".shader-config-name-input").on("change", function() {
        updateShaderConfig(this, (shaderConfig, shaderId) => {
            shaderConfig.name = this.value.trim() || shaderId;
        });
    });

    $(".shader-config-image-index-select").on("change", function() {
        updateShaderConfig(this, (shaderConfig) => {
            shaderConfig.tiledImages = [Number(this.value)];
        });
    });

    $(".shader-config-use-mode-select").on("change", function() {
        updateShaderConfig(this, (shaderConfig) => {
            shaderConfig.params = shaderConfig.params || {};
            shaderConfig.params.use_mode = this.value;
        });
    });

    $(".shader-config-use-blend-select").on("change", function() {
        updateShaderConfig(this, (shaderConfig) => {
            shaderConfig.params = shaderConfig.params || {};
            shaderConfig.params.use_blend = this.value;
        });
    });

    $(".shader-config-type-select").on("change", function() {
        updateShaderConfig(this, (shaderConfig) => {
            const previousParams = shaderConfig.params || {};

            shaderConfig.type = this.value;
            shaderConfig.params = {
                use_mode: previousParams.use_mode || "blend",
                use_blend: previousParams.use_blend || "source-over"
            };
            shaderConfig.cache = {};

            if (!shaderTypeHasSources(shaderConfig.type)) {
                shaderConfig.tiledImages = [];
            } else if (!Array.isArray(shaderConfig.tiledImages) || !shaderConfig.tiledImages.length) {
                shaderConfig.tiledImages = [0];
            }
        });
    });
}

function updateShaderConfig(element, update) {
    const shaderId = $(element).attr("data-shader-id");
    const shaderConfig = shaderLayerConfig[shaderId];

    if (!shaderConfig) {
        return;
    }

    update(shaderConfig, shaderId);
    applyShaderLayerGuiConfig();
    renderShaderConfigPanel();
}

function shaderTypeHasSources(type) {
    const Shader = OpenSeadragon.FlexRenderer.ShaderMediator.getClass(type);

    if (!Shader || typeof Shader.sources !== "function") {
        return true;
    }

    return (Shader.sources() || []).length > 0;
}

function applyShaderLayerGuiConfig() {
    viewer.drawer.overrideConfigureAll(shaderLayerConfig, shaderLayerOrder);
}

function setupInteractionPanel() {
    const enabledToggle = document.getElementById("interaction-enabled-toggle");
    const preventContextMenuToggle = document.getElementById("interaction-prevent-context-menu-toggle");
    const notifyOnMoveToggle = document.getElementById("interaction-notify-on-move-toggle");
    const viewerInputCaptureModeSelect = document.getElementById("interaction-viewer-input-capture-mode-select");
    const clearButton = document.getElementById("interaction-clear-button");

    const syncControls = () => {
        const options = viewer.drawer.getInteractionOptions ?
            viewer.drawer.getInteractionOptions() :
            {};

        if (enabledToggle) {
            enabledToggle.checked = !!options.enabled;
        }

        if (preventContextMenuToggle) {
            preventContextMenuToggle.checked = !!options.preventContextMenu;
        }

        if (notifyOnMoveToggle) {
            notifyOnMoveToggle.checked = !!options.notifyOnMove;
        }

        if (viewerInputCaptureModeSelect) {
            viewerInputCaptureModeSelect.value = options.viewerInputCaptureMode || "none";
        }
    };

    if (enabledToggle) {
        enabledToggle.addEventListener("change", () => {
            viewer.drawer.setInteractionOptions({
                enabled: enabledToggle.checked
            });
            syncControls();
        });
    }

    if (preventContextMenuToggle) {
        preventContextMenuToggle.addEventListener("change", () => {
            viewer.drawer.setInteractionOptions({
                preventContextMenu: preventContextMenuToggle.checked
            });
            syncControls();
        });
    }

    if (notifyOnMoveToggle) {
        notifyOnMoveToggle.addEventListener("change", () => {
            viewer.drawer.setInteractionOptions({
                notifyOnMove: notifyOnMoveToggle.checked
            });
            syncControls();
        });
    }

    if (viewerInputCaptureModeSelect) {
        viewerInputCaptureModeSelect.addEventListener("change", () => {
            viewer.drawer.setInteractionOptions({
                viewerInputCaptureMode: viewerInputCaptureModeSelect.value
            });
            syncControls();
        });
    }

    if (clearButton) {
        clearButton.addEventListener("click", () => {
            viewer.drawer.clearInteractionState({
                reason: "demo-clear-interaction-state"
            });
        });
    }

    if (viewer.drawer.renderer && typeof viewer.drawer.renderer.addHandler === "function") {
        viewer.drawer.renderer.addHandler("interaction-change", (event) => {
            writeJson("interaction-event-state-output", {
                reason: event.reason,
                changed: event.changed,
                previous: event.previous,
                current: event.current
            });
            syncControls();
        });
    }

    const poll = () => {
        if (!viewer.drawer || typeof viewer.drawer.getInteractionState !== "function") {
            return;
        }

        writeJson("interaction-polled-state-output", viewer.drawer.getInteractionState());
        requestAnimationFrame(poll);
    };

    viewer.drawer.setInteractionOptions(viewer.drawer.getInteractionOptions(), {
        reason: "demo-init-interaction-options",
        redraw: true
    });

    syncControls();
    poll();
}

function writeJson(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = JSON.stringify(value, null, 2);
    }
}

function setPanelHtml(id, html) {
    const element = document.getElementById(id);

    if (element) {
        element.innerHTML = html;
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
setupInteractionPanel();
