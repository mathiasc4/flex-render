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

const IMAGE_SOURCE_INDEX_BY_KEY = IMAGE_SOURCES.reduce((result, source, index) => {
    result[source.key] = index;
    return result;
}, {});

const drawerOptions = {
    "flex-renderer": {
        debug: false,
        webGLPreferredVersion: "2.0",
        interaction: {
            enabled: true,
            preventContextMenu: true,
            notifyOnMove: false,
            viewerInputCaptureMode: "drag",
        },
        htmlHandler: renderShaderLayerControls,
        htmlReset: resetShaderLayerControls,
    },
};

$("#title-w").html("OpenSeadragon viewer using FlexRenderer interaction uniforms");

const viewportMargins = {
    left: 70,
    top: 0,
    right: 70,
    bottom: 0,
};

const viewer = window.viewer = OpenSeadragon({
    id: "drawer-canvas",
    prefixUrl: "../../openseadragon/images/",
    minZoomImageRatio: 0.01,
    maxZoomPixelRatio: 100,
    minPixelRatio: 1.2,
    smoothTileEdgesMinZoom: 1.1,
    crossOriginPolicy: "Anonymous",
    ajaxWithCredentials: false,
    drawer: "flex-renderer",
    drawerOptions: drawerOptions,
    blendTime: 0,
    showNavigator: true,
    viewportMargins: viewportMargins
});

IMAGE_SOURCES.forEach((source) => {
    viewer.addTiledImage({
        tileSource: source.tileSource,
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
        tiledImages: [sourceIndex("rainbow")],
        params: {
            opacity: 1,
            use_mode: "show",
        },
    },
    below_leaves: {
        name: "Leaves",
        type: "fisheye-lens",
        visible: 1,
        fixed: false,
        tiledImages: [sourceIndex("leaves")],
        params: {
            opacity: 1,
            use_mode: "show",
        },
    },
    interaction_debug: {
        name: "Interaction Debug",
        type: "interaction-debug",
        visible: 1,
        fixed: false,
        tiledImages: [],
        params: {
            opacity: 1,
            use_mode: "blend",
            use_blend: "source-over",
        },
        cache: {},
    },
    above_bblue: {
        name: "Blue B",
        type: "identity",
        visible: 0,
        fixed: false,
        tiledImages: [sourceIndex("bblue")],
        params: {
            opacity: 0.85,
            use_mode: "blend",
            use_blend: "source-over",
        },
    },
};

let shaderLayerOrder = [
    "base_rainbow",
    "below_leaves",
    "interaction_debug",
    "above_bblue",
];

function sourceIndex(sourceKey) {
    return IMAGE_SOURCE_INDEX_BY_KEY[sourceKey];
}

function renderShaderLayerControls(shaderLayer, shaderConfig) {
    const container = document.getElementById("my-shader-ui-container");

    if (!container || !shaderLayer) {
        return "";
    }

    const isInteractionLayer = shaderConfig.type === "interaction-debug";
    const wrapper = document.createElement("div");
    wrapper.className = [
        "shader-control-card",
        isInteractionLayer ? "shader-control-card--interaction" : "",
    ].filter(Boolean).join(" ");

    const header = document.createElement("div");
    header.className = "shader-control-card__header";

    const title = document.createElement("div");
    title.className = "shader-control-card__title";
    title.textContent = shaderConfig.name || shaderConfig.type;
    header.appendChild(title);

    const badges = document.createElement("div");
    badges.className = "shader-control-card__badges";

    if (isInteractionLayer) {
        badges.appendChild(createBadge("Interaction", "shader-badge--interaction"));
    }

    header.appendChild(badges);
    wrapper.appendChild(header);

    if (shaderLayer.error) {
        const errorNode = document.createElement("div");
        errorNode.className = "shader-control-card__error";
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

function createBadge(text, className = "") {
    const badge = document.createElement("span");
    badge.className = ["shader-badge", className].filter(Boolean).join(" ");
    badge.textContent = text;

    return badge;
}

function resetShaderLayerControls() {
    const container = document.getElementById("my-shader-ui-container");

    if (container) {
        container.innerHTML = "";
    }
}

function renderShaderConfigPanel() {
    const rows = shaderLayerOrder
        .filter((shaderId) => shaderLayerConfig[shaderId])
        .map((shaderId) => renderShaderConfigItem(shaderId, shaderLayerConfig[shaderId]))
        .join("");

    setPanelHtml("shader-config-panel", `
        <h3>Shader layer configuration</h3>
        <div class="shader-config-scroll">
            <ul class="shader-config-list">
                ${rows}
            </ul>
        </div>
        <p class="shader-config-help">
            Drag cards to reorder active layers. Keep at least one layer above and below Interaction Debug
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
            <div class="shader-config-row ${shaderConfig.type === "interaction-debug" ? "shader-config-row--interaction" : ""}">
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
    const options = OpenSeadragon.FlexRenderer.ShaderLayerRegistry
        .availableLayers()
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
    const selectedBlend = params.use_blend || "mask";
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
                use_mode: previousParams.use_mode || "show",
                use_blend: previousParams.use_blend || "mask"
            };
            shaderConfig.cache = {};

            if (!shaderTypeHasSources(shaderConfig.type)) {
                shaderConfig.tiledImages = [];
            } else if (!Array.isArray(shaderConfig.tiledImages) || !shaderConfig.tiledImages.length) {
                shaderConfig.tiledImages = [sourceIndex("rainbow")];
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
    const Shader = OpenSeadragon.FlexRenderer.ShaderLayerRegistry.get(type);

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
                enabled: enabledToggle.checked,
            });
            setViewerStatus(enabledToggle.checked ?
                "Interaction forwarding enabled." :
                "Interaction forwarding disabled; shader-visible state should clear.");
            syncControls();
        });
    }

    if (preventContextMenuToggle) {
        preventContextMenuToggle.addEventListener("change", () => {
            viewer.drawer.setInteractionOptions({
                preventContextMenu: preventContextMenuToggle.checked,
            });
            setViewerStatus(preventContextMenuToggle.checked ?
                "Context menu prevention enabled." :
                "Context menu prevention disabled.");
            syncControls();
        });
    }

    if (notifyOnMoveToggle) {
        notifyOnMoveToggle.addEventListener("change", () => {
            viewer.drawer.setInteractionOptions({
                notifyOnMove: notifyOnMoveToggle.checked,
            });
            setViewerStatus(notifyOnMoveToggle.checked ?
                "Pointer-move notifications enabled for event-driven readout." :
                "Pointer-move notifications disabled; use the polled readout for continuous state.");
            syncControls();
        });
    }

    if (viewerInputCaptureModeSelect) {
        viewerInputCaptureModeSelect.addEventListener("change", () => {
            viewer.drawer.setInteractionOptions({
                viewerInputCaptureMode: viewerInputCaptureModeSelect.value,
            });
            setViewerStatus(`Viewer input capture mode: ${viewerInputCaptureModeSelect.value}.`);
            syncControls();
        });
    }

    if (clearButton) {
        clearButton.addEventListener("click", () => {
            viewer.drawer.clearInteractionState({
                reason: "demo-clear-interaction-state",
            });
            setViewerStatus("Interaction state cleared.");
        });
    }

    if (viewer.drawer.renderer && typeof viewer.drawer.renderer.addHandler === "function") {
        viewer.drawer.renderer.addHandler("interaction-change", (event) => {
            writeJson("interaction-event-state-output", {
                reason: event.reason,
                changed: event.changed,
                previous: event.previous,
                current: event.current,
            });
            setViewerStatus(`Interaction event: ${event.reason || "state change"}.`);
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
        redraw: true,
    });

    syncControls();
    poll();
}

function setViewerStatus(message) {
    const element = document.getElementById("interaction-viewer-status");

    if (element) {
        element.textContent = message;
    }
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
renderShaderConfigPanel();
setupInteractionPanel();
setViewerStatus("Ready. Move, click, and drag inside the viewer to exercise the interaction-debug shader layer.");
