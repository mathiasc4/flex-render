/**
 * Default graph used by the modular ShaderLayer demo and tests.
 *
 * This graph recreates the legacy heatmap ShaderLayer with modules:
 * raw scalar sample -> layer filter chain -> heatmap threshold alpha -> fixed RGB color.
 *
 * @type {object}
 */
const DEFAULT_MODULAR_GRAPH = Object.freeze({
    nodes: {
        src: {
            type: "sample-source-channel",
            params: {
                sourceIndex: 0,
                channelIndex: 0
            }
        },
        filtered: {
            type: "apply-filter",
            inputs: {
                value: "src.value"
            }
        },
        alpha: {
            type: "threshold-alpha-gate",
            inputs: {
                value: "filtered.value"
            },
            params: {
                threshold: 1,
                inverse: false
            }
        },
        color: {
            type: "color-with-alpha",
            inputs: {
                value: "alpha.alpha",
                alpha: "alpha.alpha"
            },
            params: {
                color: "#fff700"
            }
        }
    },
    output: "color.color"
});

/**
 * Return a mutable clone of the default graph.
 *
 * @returns {object} Mutable default graph clone.
 */
function createDefaultModularGraph() {
    return JSON.parse(JSON.stringify(DEFAULT_MODULAR_GRAPH));
}


/**
 * Preset modular ShaderLayer configurations available in the demo.
 *
 * Each preset changes only the single modular layer's display name and
 * params.graph. The currently selected image source is preserved.
 *
 * @type {object[]}
 */
const MODULAR_SHADER_PRESETS = Object.freeze([
    {
        id: "identity",
        label: "Identity",
        name: "Modular identity",
        description: "Recreates the legacy identity ShaderLayer by sampling four source channels and returning the vec4 unchanged.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channels",
                    params: {
                        sourceIndex: 0,
                        channelIndexes: [0, 1, 2, 3]
                    }
                }
            },
            output: "src.value"
        }
    },
    {
        id: "threshold",
        label: "Threshold",
        name: "Modular threshold",
        description: "Recreates the legacy global threshold ShaderLayer: filter the scalar source, apply the OpenCV-like threshold mode, and render binary fg/bg or grayscale output.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0
                    }
                },
                filtered: {
                    type: "apply-filter",
                    inputs: {
                        value: "src.value"
                    }
                },
                threshold: {
                    type: "opencv-threshold",
                    inputs: {
                        value: "filtered.value"
                    },
                    params: {
                        threshold: 0.5,
                        max_value: 1.0,
                        version: 0
                    }
                },
                preview: {
                    type: "threshold-preview-color",
                    inputs: {
                        value: "threshold.value",
                        mode: "threshold.mode",
                        maxValue: "threshold.maxValue",
                        binaryMode: "threshold.binaryMode"
                    },
                    params: {
                        colorize_binary: true,
                        fg_color: "#ffffff",
                        bg_color: "#000000",
                        opacity: 1
                    }
                }
            },
            output: "preview.color"
        }
    },
    {
        id: "sobel",
        label: "Sobel",
        name: "Modular Sobel",
        description: "Recreates the legacy Sobel ShaderLayer by sampling a 3x3 RGB neighborhood, computing Sobel X/Y edge strength, and returning grayscale with alpha fixed to 1.",
        graph: {
            nodes: {
                edge: {
                    type: "sobel-edge",
                    params: {
                        sourceIndex: 0,
                        channelIndexes: [0, 1, 2]
                    }
                },
                grayscale: {
                    type: "grayscale-alpha",
                    inputs: {
                        value: "edge.edge"
                    },
                    params: {
                        opacity: {
                            type: "range",
                            default: 1,
                            min: 0,
                            max: 1,
                            step: 0.1,
                            title: "Opacity",
                            interactive: false
                        }
                    }
                }
            },
            output: "grayscale.color"
        }
    },
    {
        id: "heatmap",
        label: "Heatmap",
        name: "Modular heatmap",
        description: "Recreates the legacy heatmap ShaderLayer by filtering one scalar channel, applying heatmap threshold/inverse alpha logic, and tinting visible values.",
        graph: createDefaultModularGraph()
    },
    {
        id: "colormap",
        label: "ColorMap",
        name: "Modular colormap",
        description: "Recreates the legacy colormap ShaderLayer by filtering one scalar channel, sampling a discrete colormap, and using an advanced-slider mask as alpha.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0
                    }
                },
                filtered: {
                    type: "apply-filter",
                    inputs: {
                        value: "src.value"
                    }
                },
                classify: {
                    type: "colormap-classify",
                    inputs: {
                        value: "filtered.value"
                    },
                    params: {
                        color: {
                            type: "colormap",
                            default: "Viridis",
                            mode: "sequential",
                            steps: [0, 0.25, 0.75, 1],
                            continuous: false
                        },
                        threshold: {
                            type: "advanced_slider",
                            default: [0.25, 0.75],
                            mask: [1, 0, 1],
                            maskOnly: true,
                            inverted: false,
                            title: "Breaks",
                            pips: {
                                mode: "positions",
                                values: [0, 35, 50, 75, 90, 100],
                                density: 4
                            }
                        }
                    }
                }
            },
            output: "classify.color"
        }
    },
    {
        id: "bipolar-heatmap",
        label: "Bipolar heatmap",
        name: "Modular bipolar heatmap",
        description: "Recreates the legacy bipolar-heatmap ShaderLayer by treating 0.5 as neutral, filtering low/high distance from midpoint, thresholding it, and rendering side-specific colors.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0
                    }
                },
                strengths: {
                    type: "bipolar-strengths",
                    inputs: {
                        value: "src.value"
                    },
                    params: {
                        threshold: 1
                    }
                },
                color: {
                    type: "bipolar-colorize",
                    inputs: {
                        lowAlpha: "strengths.lowAlpha",
                        highAlpha: "strengths.highAlpha"
                    },
                    params: {
                        colorHigh: "#ff1000",
                        colorLow: "#01ff00"
                    }
                }
            },
            output: "color.color"
        }
    }
]);

const CUSTOM_SHADER_PRESET_ID = "custom";


/**
 * Synthetic source size used by the multi-channel demo TileSource.
 *
 * @type {number}
 */
const SYNTHETIC_MULTI_CHANNEL_SIZE = 512;

/**
 * Return a byte in [0, 255] from a normalized scalar.
 *
 * @param {number} value - Normalized scalar.
 * @returns {number} Byte value.
 */
function normalizedToByte(value) {
    return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/**
 * Build one RGBA8 pack for the synthetic multi-channel source.
 *
 * @param {number} size - Width and height in pixels.
 * @param {function(number, number, number, number): number[]} sampler - Channel sampler returning four normalized values.
 * @returns {Uint8Array} RGBA8 pack data.
 */
function buildSyntheticChannelPack(size, sampler) {
    const data = new Uint8Array(size * size * 4);
    let offset = 0;

    for (let y = 0; y < size; y++) {
        const yn = size > 1 ? y / (size - 1) : 0;

        for (let x = 0; x < size; x++) {
            const xn = size > 1 ? x / (size - 1) : 0;
            const values = sampler(x, y, xn, yn);

            data[offset++] = normalizedToByte(values[0]);
            data[offset++] = normalizedToByte(values[1]);
            data[offset++] = normalizedToByte(values[2]);
            data[offset++] = normalizedToByte(values[3]);
        }
    }

    return data;
}

/**
 * Create an 8-channel gpuTextureSet.
 *
 * Channel layout:
 * - 0: horizontal gradient
 * - 1: vertical gradient
 * - 2: checkerboard
 * - 3: radial falloff
 * - 4: diagonal bands
 * - 5: inverse horizontal gradient
 * - 6: inverse vertical gradient
 * - 7: circular mask
 *
 * @returns {object} gpuTextureSet payload consumed by FlexDrawer.
 */
function createSyntheticEightChannelGpuTextureSet() {
    const size = SYNTHETIC_MULTI_CHANNEL_SIZE;

    const pack0 = buildSyntheticChannelPack(size, (x, y, xn, yn) => {
        const checker = ((Math.floor(x / 32) + Math.floor(y / 32)) % 2) ? 1 : 0.15;
        const radius = Math.hypot(xn - 0.5, yn - 0.5);
        const radial = Math.max(0, 1 - radius * 2);

        return [
            xn,
            yn,
            checker,
            radial
        ];
    });

    const pack1 = buildSyntheticChannelPack(size, (x, y, xn, yn) => {
        const diagonalBands = (Math.floor((x + y) / 36) % 2) ? 1 : 0.15;
        const circle = Math.hypot(xn - 0.5, yn - 0.5) < 0.38 ? 1 : 0.05;

        return [
            diagonalBands,
            1 - xn,
            1 - yn,
            circle
        ];
    });

    return {
        getType: () => "gpuTextureSet",
        width: size,
        height: size,
        channelCount: 8,
        packs: [
            {
                format: "RGBA8",
                data: pack0
            },
            {
                format: "RGBA8",
                data: pack1
            }
        ]
    };
}

/**
 * OpenSeadragon TileSource that emits one synthetic 8-channel gpuTextureSet tile.
 */
OpenSeadragon.SyntheticMultiChannelTileSource = class extends OpenSeadragon.TileSource {
    supports(data, url) {
        return (data && data.type === "synthetic-multi-channel") ||
            (url && url.type === "synthetic-multi-channel");
    }

    configure(options) {
        const size = Number.parseInt(options.size, 10) || SYNTHETIC_MULTI_CHANNEL_SIZE;

        options.width = size;
        options.height = size;
        options.tileWidth = size;
        options.tileHeight = size;
        options._tileWidth = size;
        options._tileHeight = size;
        options.tileSize = size;
        options.tileOverlap = 0;
        options.minLevel = 0;
        options.maxLevel = 0;
        options.dimensions = new OpenSeadragon.Point(size, size);

        return options;
    }

    getTileUrl(level, x, y) { // eslint-disable-line no-unused-vars
        return "synthetic-multi-channel://tile/0/0/0";
    }

    downloadTileStart(context) {
        context.finish(
            createSyntheticEightChannelGpuTextureSet(),
            undefined,
            "gpuTextureSet"
        );
    }

    getMetadata() {
        return {
            type: "synthetic-multi-channel",
            channelCount: 8,
            packCount: 2
        };
    }
};


/**
 * Image sources available to the modular ShaderLayer demo.
 *
 * @type {object[]}
 */
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
    {
        key: "synthetic8",
        label: "Synthetic 8-channel GPU set",
        tileSource: {
            type: "synthetic-multi-channel",
            size: SYNTHETIC_MULTI_CHANNEL_SIZE
        }
    },
];


const REGULAR_SHADER_ID = "regular";
const MODULAR_SHADER_ID = "modular";
const DEFAULT_PRESET_ID = "heatmap";

const REGULAR_SHADER_PRESETS = Object.freeze([
    {
        id: "identity",
        label: "Identity",
        name: "Identity",
        type: "identity",
        description: "Uses the existing identity ShaderLayer to sample the source as-is.",
        params: {}
    },
    {
        id: "threshold",
        label: "Threshold",
        name: "Threshold",
        type: "threshold",
        description: "Uses the existing global threshold ShaderLayer with OpenCV-like threshold modes.",
        params: {
            threshold: 0.5,
            max_value: 1.0,
            version: 0,
            colorize_binary: true,
            fg_color: "#ffffff",
            bg_color: "#000000",
            opacity: 1
        }
    },
    {
        id: "sobel",
        label: "Sobel",
        name: "Sobel",
        type: "sobel",
        description: "Uses the existing Sobel ShaderLayer to render grayscale edge strength.",
        params: {}
    },
    {
        id: "heatmap",
        label: "Heatmap",
        name: "Heatmap",
        type: "heatmap",
        description: "Uses the existing heatmap ShaderLayer to tint one scalar channel and gate opacity with threshold/inverse logic.",
        params: {
            color: "#fff700",
            threshold: 1,
            inverse: false
        }
    },
    {
        id: "colormap",
        label: "ColorMap",
        name: "ColorMap",
        type: "colormap",
        description: "Uses the existing ColorMap ShaderLayer with an advanced-slider class mask.",
        params: {
            color: {
                type: "colormap",
                default: "Viridis",
                mode: "sequential",
                steps: [0, 0.25, 0.75, 1],
                continuous: false
            },
            threshold: {
                type: "advanced_slider",
                default: [0.25, 0.75],
                mask: [1, 0, 1],
                maskOnly: true,
                inverted: false,
                title: "Breaks",
                pips: {
                    mode: "positions",
                    values: [0, 35, 50, 75, 90, 100],
                    density: 4
                }
            },
            connect: true
        }
    },
    {
        id: "bipolar-heatmap",
        label: "Bipolar heatmap",
        name: "Bi-polar Heatmap",
        type: "bipolar-heatmap",
        description: "Uses the existing bipolar-heatmap ShaderLayer to render low/high sides around midpoint 0.5.",
        params: {
            colorHigh: "#ff1000",
            colorLow: "#01ff00",
            threshold: 1
        }
    }
]);

const indexedImageSources = IMAGE_SOURCES.map((source, index) => ({
    index,
    label: source.label,
}));

const viewportMargins = {
    left: 70,
    top: 0,
    right: 70,
    bottom: 0,
};

function createDrawerOptions(controlContainerId, badgeText, badgeClass) {
    return {
        "flex-renderer": {
            debug: false,
            webGLPreferredVersion: "2.0",
            htmlHandler: (shaderLayer, shaderConfig) => renderShaderLayerControls(
                shaderLayer,
                shaderConfig,
                controlContainerId,
                badgeText,
                badgeClass
            ),
            htmlReset: () => resetShaderLayerControls(controlContainerId),
        },
    };
}

$("#title-w").html("ShaderLayer / ModularShaderLayer comparison");

const regularViewer = window.regularViewer = OpenSeadragon({
    id: "regular-drawer-canvas",
    prefixUrl: "../../openseadragon/images/",
    minZoomImageRatio: 0.01,
    maxZoomPixelRatio: 100,
    minPixelRatio: 1.2,
    smoothTileEdgesMinZoom: 1.1,
    crossOriginPolicy: "Anonymous",
    ajaxWithCredentials: false,
    drawer: "flex-renderer",
    drawerOptions: createDrawerOptions("regular-shader-ui-container", "Existing", "shader-badge--legacy"),
    blendTime: 0,
    showNavigator: true,
    viewportMargins: viewportMargins,
});

const modularViewer = window.modularViewer = OpenSeadragon({
    id: "modular-drawer-canvas",
    prefixUrl: "../../openseadragon/images/",
    minZoomImageRatio: 0.01,
    maxZoomPixelRatio: 100,
    minPixelRatio: 1.2,
    smoothTileEdgesMinZoom: 1.1,
    crossOriginPolicy: "Anonymous",
    ajaxWithCredentials: false,
    drawer: "flex-renderer",
    drawerOptions: createDrawerOptions("modular-shader-ui-container", "Modular", "shader-badge--modular"),
    blendTime: 0,
    showNavigator: true,
    viewportMargins: viewportMargins,
});

window.viewer = modularViewer;

addImageSourcesToViewer(regularViewer, "regular-viewer-status");
addImageSourcesToViewer(modularViewer, "modular-viewer-status");

let regularShaderLayerConfig = {
    [REGULAR_SHADER_ID]: createRegularShaderLayerConfig(getRegularShaderPreset(DEFAULT_PRESET_ID), 0),
};

let modularShaderLayerConfig = {
    [MODULAR_SHADER_ID]: createModularShaderLayerConfig(getModularShaderPreset(DEFAULT_PRESET_ID), 0),
};

let regularShaderLayerOrder = [REGULAR_SHADER_ID];
let modularShaderLayerOrder = [MODULAR_SHADER_ID];

let pendingGraphText = null;
let modularConfigDiagnostics = [];
let modularConfigAnalysis = null;
let selectedRegularPresetId = DEFAULT_PRESET_ID;
let selectedModularPresetId = DEFAULT_PRESET_ID;
let moduleGraphEditor = null;
let moduleGraphPreviewDrawer = null;

function addImageSourcesToViewer(targetViewer, statusElementId) {
    let loadedCount = 0;

    IMAGE_SOURCES.forEach((source) => {
        targetViewer.addTiledImage({
            tileSource: cloneTileSource(source.tileSource),
            success: () => {
                loadedCount++;
                setViewerStatus(statusElementId, `Loaded ${loadedCount}/${IMAGE_SOURCES.length} image sources.`, "ok");
            },
            error: (event) => {
                const message = event && event.message ? event.message : "Image source failed to load.";
                setViewerStatus(statusElementId, message, "error");
            }
        });
    });
}

function cloneTileSource(tileSource) {
    if (typeof tileSource === "string") {
        return tileSource;
    }

    return cloneJson(tileSource);
}

function setViewerStatus(id, message, kind = "info") {
    const status = document.getElementById(id);

    if (!status) {
        return;
    }

    status.textContent = message;
    status.className = "viewer-status";

    if (kind === "error") {
        status.classList.add("viewer-status--error");
    } else if (kind === "ok") {
        status.classList.add("viewer-status--ok");
    }
}

function createRegularShaderLayerConfig(preset, imageIndex) {
    const selectedPreset = preset || getRegularShaderPreset(DEFAULT_PRESET_ID);

    return {
        name: selectedPreset.name,
        type: selectedPreset.type,
        visible: 1,
        fixed: false,
        tiledImages: [imageIndex],
        params: cloneJson(selectedPreset.params || {}),
        cache: {},
    };
}

function createModularShaderLayerConfig(preset, imageIndex) {
    const selectedPreset = preset || getModularShaderPreset(DEFAULT_PRESET_ID);

    return {
        name: selectedPreset.name,
        type: "modular",
        visible: 1,
        fixed: false,
        tiledImages: [imageIndex],
        params: {
            graph: cloneJson(selectedPreset.graph),
        },
        cache: {},
    };
}

function renderShaderLayerControls(shaderLayer, shaderConfig, containerId, badgeText, badgeClass) {
    const container = document.getElementById(containerId);

    if (!container || !shaderLayer) {
        return "";
    }

    const wrapper = document.createElement("div");
    wrapper.className = "shader-control-card";

    const header = document.createElement("div");
    header.className = "shader-control-card__header";

    const title = document.createElement("div");
    title.className = "shader-control-card__title";
    title.textContent = shaderConfig.name || shaderConfig.type;
    header.appendChild(title);

    header.appendChild(createBadge(badgeText, badgeClass));
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

function resetShaderLayerControls(containerId) {
    const container = document.getElementById(containerId);

    if (container) {
        container.innerHTML = "";
    }
}

function createBadge(text, className = "") {
    const badge = document.createElement("span");
    badge.className = ["shader-badge", className].filter(Boolean).join(" ");
    badge.textContent = text;

    return badge;
}

function renderRegularShaderConfigPanel() {
    const shaderConfig = regularShaderLayerConfig[REGULAR_SHADER_ID];

    setPanelHtml("regular-shader-config-panel", `
        <h3>Shader layer configuration</h3>
        ${renderRegularShaderConfigCard(shaderConfig)}
        <p class="shader-config-help">
            This viewer uses the original non-modular ShaderLayer implementations. Choose a preset and image source to compare against the modular equivalent.
        </p>
    `);

    bindRegularShaderConfigPanelEvents();
}

function renderRegularShaderConfigCard(shaderConfig) {
    const preset = getRegularShaderPreset(selectedRegularPresetId);
    const description = preset ? preset.description : "Manual existing ShaderLayer configuration.";
    const selectedIndex = getSelectedImageIndex(shaderConfig);

    return `
        <div class="shader-config-preset-panel">
            <label class="shader-config-field-label">
                Preset shader layer configuration
                <select class="shader-config-preset-select regular-shader-preset-select">
                    ${renderRegularShaderPresetOptions()}
                </select>
            </label>
            <p class="shader-config-preset-description">${escapeHtml(description)}</p>
        </div>

        <ul class="shader-config-list">
            <li class="shader-config-item" data-shader-id="${escapeHtml(REGULAR_SHADER_ID)}">
                <div class="shader-config-row">
                    <label class="shader-config-field-label">
                        Name
                        <input
                            type="text"
                            class="shader-config-name-input regular-shader-name-input"
                            value="${escapeHtml(shaderConfig.name || REGULAR_SHADER_ID)}"
                        >
                    </label>

                    <div class="shader-config-row__selectors">
                        <div>
                            <label class="shader-config-field-label">
                                Type
                                <span class="shader-config-type-locked">${escapeHtml(shaderConfig.type || "")}</span>
                            </label>
                        </div>

                        <div>
                            <label class="shader-config-field-label">
                                Image
                                <select class="shader-config-image-index-select regular-shader-image-index-select">
                                    ${renderImageIndexOptions(selectedIndex)}
                                </select>
                            </label>
                        </div>
                    </div>
                </div>
            </li>
        </ul>
    `;
}

function renderRegularShaderPresetOptions() {
    return REGULAR_SHADER_PRESETS.map((preset) => {
        const selected = preset.id === selectedRegularPresetId ? "selected" : "";

        return `
            <option value="${escapeHtml(preset.id)}" ${selected}>
                ${escapeHtml(preset.label)}
            </option>
        `;
    }).join("");
}

function bindRegularShaderConfigPanelEvents() {
    $(".regular-shader-preset-select").on("change", function() {
        applyRegularShaderLayerPreset(this.value);
    });

    $(".regular-shader-name-input").on("change", function() {
        const shaderConfig = regularShaderLayerConfig[REGULAR_SHADER_ID];

        shaderConfig.name = this.value.trim() || REGULAR_SHADER_ID;
        applyRegularShaderLayerGuiConfig();
        renderRegularShaderConfigPanel();
    });

    $(".regular-shader-image-index-select").on("change", function() {
        const shaderConfig = regularShaderLayerConfig[REGULAR_SHADER_ID];

        shaderConfig.tiledImages = [Number(this.value)];
        shaderConfig.cache = {};
        applyRegularShaderLayerGuiConfig();
        renderRegularShaderConfigPanel();
    });
}

function applyRegularShaderLayerPreset(presetId) {
    const preset = getRegularShaderPreset(presetId);

    if (!preset) {
        return;
    }

    const currentConfig = regularShaderLayerConfig[REGULAR_SHADER_ID];
    const imageIndex = getSelectedImageIndex(currentConfig);

    selectedRegularPresetId = preset.id;
    regularShaderLayerConfig[REGULAR_SHADER_ID] = createRegularShaderLayerConfig(preset, imageIndex);

    applyRegularShaderLayerGuiConfig();
    renderRegularShaderConfigPanel();
}

function renderModularShaderConfigPanel() {
    const shaderConfig = modularShaderLayerConfig[MODULAR_SHADER_ID];

    setPanelHtml("modular-shader-config-panel", `
        <h3>Shader layer configuration</h3>
        ${renderModularShaderConfigCard(shaderConfig)}
        <p class="shader-config-help">
            This viewer uses one fixed <code>modular</code> ShaderLayer. Edit the layer name, choose the image source, or replace the <code>params.graph</code> JSON. Press <code>Ctrl/Cmd+Enter</code> in the JSON editor to commit immediately.
        </p>
    `);

    bindModularShaderConfigPanelEvents();
}

function renderModularShaderConfigCard(shaderConfig) {
    const name = shaderConfig.name || MODULAR_SHADER_ID;
    const selectedIndex = getSelectedImageIndex(shaderConfig);
    const graphText = pendingGraphText !== null ?
        pendingGraphText : JSON.stringify(getGraphConfig(shaderConfig), null, 4);
    const diagnosticsHtml = modularConfigDiagnostics.length ? renderGraphDiagnostics(modularConfigDiagnostics) : "";

    return `
        ${renderModularShaderPresetPanel()}
        <ul class="shader-config-list">
            <li class="shader-config-item" data-shader-id="${escapeHtml(MODULAR_SHADER_ID)}">
                <div class="shader-config-row shader-config-row--modular">
                    <label class="shader-config-field-label">
                        Name
                        <input
                            type="text"
                            class="shader-config-name-input modular-shader-name-input"
                            value="${escapeHtml(name)}"
                        >
                    </label>

                    <div class="shader-config-row__selectors">
                        <div>
                            <label class="shader-config-field-label">
                                Type
                                <span class="shader-config-type-locked">modular</span>
                            </label>
                        </div>

                        <div>
                            <label class="shader-config-field-label">
                                Image
                                <select class="shader-config-image-index-select modular-shader-image-index-select">
                                    ${renderImageIndexOptions(selectedIndex)}
                                </select>
                            </label>
                        </div>
                    </div>

                    <div class="shader-config-row__module">
                        <label class="shader-config-field-label">
                            Modular configuration <span class="shader-config-type-locked">params.graph JSON</span>
                            <textarea
                                class="shader-config-module-textarea modular-shader-module-textarea"
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

function renderModularShaderPresetPanel() {
    const preset = getModularShaderPreset(selectedModularPresetId);
    const description = preset ?
        preset.description :
        "Manual graph configuration. Editing the name or JSON marks the selection as custom.";

    return `
        <div class="shader-config-preset-panel">
            <label class="shader-config-field-label">
                Preset shader layer configuration
                <select class="shader-config-preset-select modular-shader-preset-select">
                    ${renderModularShaderPresetOptions()}
                </select>
            </label>
            <p class="shader-config-preset-description">
                ${escapeHtml(description)}
            </p>
        </div>
    `;
}

function renderModularShaderPresetOptions() {
    const customSelected = selectedModularPresetId === CUSTOM_SHADER_PRESET_ID ? "selected" : "";

    return `
        <option value="${CUSTOM_SHADER_PRESET_ID}" ${customSelected}>Custom / manual JSON</option>
        ${MODULAR_SHADER_PRESETS.map((preset) => {
        const selected = preset.id === selectedModularPresetId ? "selected" : "";

        return `
                <option value="${escapeHtml(preset.id)}" ${selected}>
                    ${escapeHtml(preset.label)}
                </option>
            `;
    }).join("")}
    `;
}

function bindModularShaderConfigPanelEvents() {
    $(".modular-shader-preset-select").on("change", function() {
        if (this.value === CUSTOM_SHADER_PRESET_ID) {
            selectedModularPresetId = CUSTOM_SHADER_PRESET_ID;
            renderModularShaderConfigPanel();
            return;
        }

        applyModularShaderLayerPreset(this.value);
    });

    $(".modular-shader-name-input").on("change", function() {
        const shaderConfig = modularShaderLayerConfig[MODULAR_SHADER_ID];

        selectedModularPresetId = CUSTOM_SHADER_PRESET_ID;
        shaderConfig.name = this.value.trim() || MODULAR_SHADER_ID;
        applyModularShaderLayerGuiConfig();
        renderModularShaderConfigPanel();
    });

    $(".modular-shader-image-index-select").on("change", function() {
        const shaderConfig = modularShaderLayerConfig[MODULAR_SHADER_ID];

        shaderConfig.tiledImages = [Number(this.value)];
        shaderConfig.cache = {};
        applyModularShaderLayerGuiConfig();
        renderModularShaderConfigPanel();

        if (moduleGraphEditor) {
            moduleGraphEditor.resize();
        }
    });

    $(".modular-shader-module-textarea").on("input", function() {
        selectedModularPresetId = CUSTOM_SHADER_PRESET_ID;
        updateDraftGraphDiagnostics(this.value);
    });

    $(".modular-shader-module-textarea").on("change", function() {
        commitModularGraphFromText(this.value);
    });

    $(".modular-shader-module-textarea").on("keydown", function(event) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            commitModularGraphFromText(this.value);
        }
    });
}

function applyModularShaderLayerPreset(presetId) {
    const preset = getModularShaderPreset(presetId);

    if (!preset) {
        return;
    }

    const shaderConfig = modularShaderLayerConfig[MODULAR_SHADER_ID];
    const graph = cloneJson(preset.graph);
    const result = analyzeGraphConfig(graph);
    const hasErrors = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

    selectedModularPresetId = preset.id;
    shaderConfig.name = preset.name;

    if (hasErrors) {
        pendingGraphText = JSON.stringify(graph, null, 4);
        modularConfigDiagnostics = result.diagnostics;
        modularConfigAnalysis = result.analysis;
        renderModularShaderConfigPanel();
        return;
    }

    shaderConfig.params = shaderConfig.params || {};
    shaderConfig.params.graph = graph;
    shaderConfig.cache = {};

    pendingGraphText = null;
    modularConfigDiagnostics = [];
    modularConfigAnalysis = null;

    applyModularShaderLayerGuiConfig();
    renderModularShaderConfigPanel();
    syncModuleGraphEditorFromConfig("apply-modular-shader-layer-preset");
}

function resetDefaultGraph() {
    applyModularShaderLayerPreset(DEFAULT_PRESET_ID);
}

function getRegularShaderPreset(id) {
    return REGULAR_SHADER_PRESETS.find((preset) => preset.id === id);
}

function getModularShaderPreset(id) {
    return MODULAR_SHADER_PRESETS.find((preset) => preset.id === id);
}

function getSelectedImageIndex(shaderConfig) {
    return Array.isArray(shaderConfig.tiledImages) && shaderConfig.tiledImages.length ?
        Number(shaderConfig.tiledImages[0]) :
        0;
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

function mountModuleGraphEditor() {
    const container = document.getElementById("module-graph-editor-container");

    if (!container) {
        return;
    }

    if (!OpenSeadragon.FlexRenderer.ShaderModuleGraphEditor) {
        setModuleGraphEditorStatus("ShaderModuleGraphEditor is not available in the current build.", "error");
        return;
    }

    if (moduleGraphEditor) {
        moduleGraphEditor.destroy();
        moduleGraphEditor = null;
    }

    container.innerHTML = "";

    moduleGraphEditor = new OpenSeadragon.FlexRenderer.ShaderModuleGraphEditor({
        container,
        graphConfig: cloneJson(getGraphConfig(modularShaderLayerConfig[MODULAR_SHADER_ID])),
        height: 680,
        previewProvider: createModuleGraphPreviewProvider(),
        onDraftChange: () => {
            setModuleGraphEditorStatus("Editor draft changed. Apply the graph editor changes to update the live modular ShaderLayer.", "info");
        },
        onDiagnosticsChange: (event) => {
            const diagnostics = event.diagnostics || [];
            const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;

            if (errorCount) {
                setModuleGraphEditorStatus(`${errorCount} graph editor diagnostic error(s). Fix them before applying.`, "error");
            }
        },
        onApply: () => {
            setModuleGraphEditorStatus("Graph editor draft applied to the demo shader layer.", "ok");
        },
        onApplyFailed: (result) => {
            const diagnostics = result.diagnostics || [];
            const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;

            setModuleGraphEditorStatus(`Graph editor apply failed with ${errorCount} error(s).`, "error");
        }
    });

    bindModuleGraphEditorPanelEvents();
    moduleGraphEditor.resize();
    setModuleGraphEditorStatus("Module graph editor ready.", "ok");
}

function bindModuleGraphEditorPanelEvents() {
    const applyButton = document.getElementById("module-graph-editor-apply");
    const resetButton = document.getElementById("module-graph-editor-reset");

    if (applyButton) {
        applyButton.onclick = applyModuleGraphEditorDraft;
    }

    if (resetButton) {
        resetButton.onclick = resetModuleGraphEditorDraft;
    }
}

function applyModuleGraphEditorDraft() {
    if (!moduleGraphEditor) {
        return;
    }

    const result = moduleGraphEditor.apply();

    if (!result.ok) {
        modularConfigAnalysis = result.analysis;
        modularConfigDiagnostics = result.diagnostics || [];
        renderModularShaderConfigPanel();
        bindModuleGraphEditorPanelEvents();
        return;
    }

    const shaderConfig = modularShaderLayerConfig[MODULAR_SHADER_ID];

    selectedModularPresetId = CUSTOM_SHADER_PRESET_ID;
    shaderConfig.params = shaderConfig.params || {};
    shaderConfig.params.graph = cloneJson(result.graphConfig);
    shaderConfig.cache = {};

    pendingGraphText = null;
    modularConfigAnalysis = result.analysis;
    modularConfigDiagnostics = result.diagnostics || [];

    applyModularShaderLayerGuiConfig();
    renderModularShaderConfigPanel();
    bindModuleGraphEditorPanelEvents();
    setModuleGraphEditorStatus("Graph editor changes applied to the live modular ShaderLayer.", "ok");
}

function resetModuleGraphEditorDraft() {
    syncModuleGraphEditorFromConfig("reset-editor-draft");
    setModuleGraphEditorStatus("Graph editor draft reset from the current modular shader layer config.", "ok");
}

function syncModuleGraphEditorFromConfig(reason) {
    if (!moduleGraphEditor) {
        return;
    }

    moduleGraphEditor.setDraftGraphConfig(
        cloneJson(getGraphConfig(modularShaderLayerConfig[MODULAR_SHADER_ID])),
        {
            updateSource: true,
            reason
        }
    );

    moduleGraphEditor.resize();
}

function setModuleGraphEditorStatus(message, kind = "info") {
    const status = document.getElementById("module-graph-editor-status");

    if (!status) {
        return;
    }

    status.className = "module-graph-editor-status";

    if (kind === "ok") {
        status.classList.add("viewer-status--ok");
    } else if (kind === "error") {
        status.classList.add("viewer-status--error");
    }

    status.textContent = message;
}

function updateDraftGraphDiagnostics(text) {
    pendingGraphText = text;
    const result = analyzeGraphText(text);
    modularConfigAnalysis = result.analysis;
    modularConfigDiagnostics = result.diagnostics;

    renderGraphDiagnosticsIntoPanel();
}

function commitModularGraphFromText(text) {
    const shaderConfig = modularShaderLayerConfig[MODULAR_SHADER_ID];
    pendingGraphText = text;

    const result = analyzeGraphText(text);
    modularConfigAnalysis = result.analysis;
    modularConfigDiagnostics = result.diagnostics;

    if (modularConfigDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        renderModularShaderConfigPanel();
        return;
    }

    selectedModularPresetId = CUSTOM_SHADER_PRESET_ID;
    shaderConfig.params = shaderConfig.params || {};
    shaderConfig.params.graph = result.graph;
    shaderConfig.cache = {};

    pendingGraphText = null;
    modularConfigDiagnostics = [];
    modularConfigAnalysis = null;

    applyModularShaderLayerGuiConfig();
    renderModularShaderConfigPanel();
    syncModuleGraphEditorFromConfig("commit-modular-graph-json");
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

    const Analyzer = OpenSeadragon.FlexRenderer.ShaderModuleGraphAnalyzer;
    if (!Analyzer || typeof Analyzer.analyze !== "function") {
        diagnostics.push({
            severity: "error",
            code: "graph-analyzer-unavailable",
            message: "ShaderModuleGraphAnalyzer.analyze(...) is not available in the current FlexRenderer build.",
            path: [],
            details: {}
        });

        return {
            graph,
            analysis: null,
            diagnostics
        };
    }

    const analysis = Analyzer.analyze(makeDraftModuleGraphOwner(), graph);
    diagnostics.push(...analysis.diagnostics);

    return {
        graph,
        analysis,
        diagnostics
    };
}

function getLiveFlexRenderer() {
    if (!modularViewer || !modularViewer.drawer) {
        return null;
    }

    return modularViewer.drawer.renderer || modularViewer.drawer.flexRenderer || null;
}

function getLiveModularShaderLayer() {
    const renderer = getLiveFlexRenderer();

    if (!renderer || typeof renderer.getShaderLayer !== "function") {
        return null;
    }

    return renderer.getShaderLayer(MODULAR_SHADER_ID) || null;
}

function makeDraftModuleGraphOwner() {
    const liveLayer = getLiveModularShaderLayer();

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

function createModuleGraphPreviewProvider() {
    return {
        isNodePreviewAvailable(request) {
            const renderer = getLiveFlexRenderer();
            const layer = getLiveModularShaderLayer();
            const tiledImages = getModuleGraphPreviewTiledImages();

            if (!renderer || !layer || !tiledImages.length) {
                return false;
            }

            if (typeof renderer.canPreviewModuleGraphOutput !== "function") {
                return false;
            }

            return renderer.canPreviewModuleGraphOutput({
                shaderLayer: layer,
                graphConfig: request.graphConfig,
                nodeId: request.nodeId,
                output: request.output,
                outputType: request.outputType,
                owner: makeDraftModuleGraphOwner()
            });
        },

        renderNodePreview(request) {
            const renderer = getLiveFlexRenderer();
            const layer = getLiveModularShaderLayer();
            const tiledImages = getModuleGraphPreviewTiledImages();

            if (!renderer || !layer) {
                return {
                    ok: false,
                    reason: "renderer-unavailable",
                    message: "The live FlexRenderer or modular ShaderLayer is not available.",
                    diagnostics: []
                };
            }

            const previewDrawer = getModuleGraphPreviewDrawer();

            if (!previewDrawer || typeof previewDrawer.drawWithConfiguration !== "function") {
                return {
                    ok: false,
                    reason: "drawer-preview-unavailable",
                    message: "The standalone FlexDrawer preview extraction API is not available.",
                    diagnostics: []
                };
            }

            if (!tiledImages.length) {
                return {
                    ok: false,
                    reason: "preview-source-unavailable",
                    message: "No active tiled image is available for this module graph preview.",
                    diagnostics: []
                };
            }

            if (typeof renderer.renderModuleGraphOutputPreview !== "function") {
                return {
                    ok: false,
                    reason: "renderer-preview-unavailable",
                    message: "The live FlexRenderer does not expose renderModuleGraphOutputPreview(...).",
                    diagnostics: []
                };
            }

            const dimensions = getModuleGraphPreviewSourceDimensions();

            return renderer.renderModuleGraphOutputPreview({
                shaderLayer: layer,
                graphConfig: request.graphConfig,
                nodeId: request.nodeId,
                output: request.output,
                outputType: request.outputType,
                owner: makeDraftModuleGraphOwner(),
                sourceWidth: dimensions.width,
                sourceHeight: dimensions.height,
                maxWidth: 256,
                maxHeight: 160,
                drawPreview: async (preview) => {
                    const context = await previewDrawer.drawWithConfiguration(
                        tiledImages,
                        preview.configuration,
                        getModuleGraphPreviewView(),
                        {
                            x: preview.width,
                            y: preview.height
                        }
                    );

                    return context && context.canvas ? context.canvas : null;
                }
            });
        }
    };
}

function getModuleGraphPreviewTiledImages() {
    if (!modularViewer || !modularViewer.world || typeof modularViewer.world.getItemAt !== "function") {
        return [];
    }

    const shaderConfig = modularShaderLayerConfig[MODULAR_SHADER_ID] || {};
    const indexes = Array.isArray(shaderConfig.tiledImages) && shaderConfig.tiledImages.length ?
        shaderConfig.tiledImages :
        [0];
    const result = [];

    for (const index of indexes) {
        const numericIndex = Number(index);

        if (!Number.isFinite(numericIndex)) {
            continue;
        }

        const tiledImage = modularViewer.world.getItemAt(numericIndex);

        if (tiledImage) {
            result.push(tiledImage);
        }
    }

    return result;
}

function getModuleGraphPreviewSourceDimensions() {
    const tiledImages = getModuleGraphPreviewTiledImages();
    const tiledImage = tiledImages[0];

    if (tiledImage && tiledImage.source && tiledImage.source.dimensions) {
        return {
            width: Math.max(1, Number(tiledImage.source.dimensions.x) || 1),
            height: Math.max(1, Number(tiledImage.source.dimensions.y) || 1)
        };
    }

    if (modularViewer && modularViewer.drawer && modularViewer.drawer.canvas) {
        return {
            width: Math.max(1, Number(modularViewer.drawer.canvas.width) || 1),
            height: Math.max(1, Number(modularViewer.drawer.canvas.height) || 1)
        };
    }

    return {
        width: 256,
        height: 160
    };
}

function getModuleGraphPreviewDrawer() {
    if (moduleGraphPreviewDrawer) {
        return moduleGraphPreviewDrawer;
    }

    if (typeof OpenSeadragon.makeStandaloneFlexDrawer !== "function") {
        return null;
    }

    moduleGraphPreviewDrawer = OpenSeadragon.makeStandaloneFlexDrawer(modularViewer);
    return moduleGraphPreviewDrawer;
}

function getModuleGraphPreviewView() {
    const bounds = modularViewer.viewport.getBoundsNoRotateWithMargins(true);

    return {
        bounds,
        center: new OpenSeadragon.Point(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
        ),
        rotation: modularViewer.viewport.getRotation(true) * Math.PI / 180,
        zoom: modularViewer.viewport.getZoom(true)
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
    const modulePanel = document.querySelector("#modular-shader-config-panel .shader-config-row__module");
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
    return params.graph || createDefaultModularGraph();
}

function applyRegularShaderLayerGuiConfig(options = {}) {
    return regularViewer.drawer.overrideConfigureAll(regularShaderLayerConfig, regularShaderLayerOrder, options);
}

function applyModularShaderLayerGuiConfig(options = {}) {
    return modularViewer.drawer.overrideConfigureAll(modularShaderLayerConfig, modularShaderLayerOrder, options);
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

window.modularShaderLayerDemo = {
    regularViewer,
    modularViewer,
    regularShaderLayerConfig,
    modularShaderLayerConfig,
    regularShaderLayerOrder,
    modularShaderLayerOrder,
    regularShaderPresets: REGULAR_SHADER_PRESETS,
    modularShaderPresets: MODULAR_SHADER_PRESETS,
    regularShaderId: REGULAR_SHADER_ID,
    modularShaderId: MODULAR_SHADER_ID,
    applyRegularShaderLayerGuiConfig,
    applyModularShaderLayerGuiConfig,
    applyRegularShaderLayerPreset,
    applyModularShaderLayerPreset,
    getLiveFlexRenderer,
    getLiveModularShaderLayer,
    makeDraftModuleGraphOwner,
    createModuleGraphPreviewProvider,
    getModuleGraphPreviewTiledImages,
    getModuleGraphPreviewSourceDimensions,
    analyzeGraphText,
    analyzeGraphConfig,
    resetDefaultGraph,
    renderRegularShaderConfigPanel,
    renderModularShaderConfigPanel,
    mountModuleGraphEditor,
    syncModuleGraphEditorFromConfig,
    applyModuleGraphEditorDraft,
    resetModuleGraphEditorDraft,
    getModuleGraphEditor: () => moduleGraphEditor,
    cloneJson,
};

applyRegularShaderLayerGuiConfig();
applyModularShaderLayerGuiConfig();
renderRegularShaderConfigPanel();
renderModularShaderConfigPanel();
mountModuleGraphEditor();
