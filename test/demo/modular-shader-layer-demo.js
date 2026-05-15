/**
 * Default graph used by the modular ShaderLayer demo and tests.
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
        threshold: {
            type: "threshold-mask",
            inputs: {
                value: "src.value"
            },
            params: {
                threshold: 0.5
            }
        },
        colorize: {
            type: "colorize",
            inputs: {
                value: "src.value",
                alpha: "threshold.mask"
            },
            params: {
                color: "#00ffff"
            }
        }
    },
    output: "colorize.color"
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
        id: "single-channel",
        label: "Single channel tint",
        name: "Modular single channel",
        description: "Samples one scalar channel, tints it with a configurable color, and uses the same scalar as alpha.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0
                    }
                },
                colorize: {
                    type: "colorize",
                    inputs: {
                        value: "src.value",
                        alpha: "src.value"
                    },
                    params: {
                        color: "#ff00ff"
                    }
                }
            },
            output: "colorize.color"
        }
    },
    {
        id: "heatmap-threshold",
        label: "Heatmap threshold",
        name: "Modular heatmap",
        description: "Samples one scalar channel, thresholds it into a visibility mask, and colorizes visible values.",
        graph: createDefaultModularGraph()
    },
    {
        id: "global-threshold",
        label: "Global threshold",
        name: "Modular global threshold",
        description: "Applies OpenCV-like threshold modes and renders the result as a foreground/background binary preview.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0
                    }
                },
                threshold: {
                    type: "threshold-mode",
                    inputs: {
                        value: "src.value"
                    },
                    params: {
                        threshold: 0.5,
                        max_value: 1.0,
                        mode: 0
                    }
                },
                colorize: {
                    type: "binary-colorize",
                    inputs: {
                        mask: "threshold.mask"
                    },
                    params: {
                        fg_color: "#ffffff",
                        bg_color: "#000000"
                    }
                }
            },
            output: "colorize.color"
        }
    },
    {
        id: "adaptive-threshold",
        label: "Adaptive threshold",
        name: "Modular adaptive threshold",
        description: "Computes a local mean/Gaussian statistic, compares the center value against localStat - C, and renders foreground/background colors.",
        graph: {
            nodes: {
                local: {
                    type: "local-window-statistic",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0,
                        maxRadius: 5,
                        block_size: 5,
                        gaussian: false
                    }
                },
                mask: {
                    type: "local-threshold-mask",
                    inputs: {
                        value: "local.center",
                        statistic: "local.statistic"
                    },
                    params: {
                        c_value: 0.03,
                        invert: false
                    }
                },
                palette: {
                    type: "binary-palette",
                    inputs: {
                        mask: "mask.mask"
                    },
                    params: {
                        fg_color: "#ffffff",
                        bg_color: "#000000"
                    }
                }
            },
            output: "palette.color"
        }
    },
    {
        id: "bipolar-heatmap",
        label: "Bipolar heatmap",
        name: "Modular bipolar heatmap",
        description: "Treats 0.5 as the midpoint, measures distance from it, thresholds that magnitude, and uses separate colors for low/high sides.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0
                    }
                },
                midpoint: {
                    type: "midpoint-distance",
                    inputs: {
                        value: "src.value"
                    },
                    params: {
                        midpoint: 0.5
                    }
                },
                threshold: {
                    type: "threshold-mask",
                    inputs: {
                        value: "midpoint.magnitude"
                    },
                    params: {
                        threshold: 0.1
                    }
                },
                colorize: {
                    type: "diverging-colorize",
                    inputs: {
                        magnitude: "midpoint.magnitude",
                        sign: "midpoint.sign",
                        mask: "threshold.mask"
                    },
                    params: {
                        colorHigh: "#ff1000",
                        colorLow: "#01ff00"
                    }
                }
            },
            output: "colorize.color"
        }
    },
    {
        id: "colormap",
        label: "Classified colormap",
        name: "Modular colormap",
        description: "Classifies one scalar channel with advanced-slider breaks, maps the class ratio through a discrete colormap, and uses the slider mask as alpha.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0
                    }
                },
                classify: {
                    type: "classify-breaks",
                    inputs: {
                        value: "src.value"
                    },
                    params: {
                        threshold: {
                            type: "advanced_slider",
                            default: [0.25, 0.75],
                            mask: [1, 0, 1],
                            maskOnly: false
                        }
                    }
                },
                colorize: {
                    type: "colormap-colorize",
                    inputs: {
                        value: "classify.classRatio",
                        alpha: "classify.mask"
                    },
                    params: {
                        color: {
                            type: "colormap",
                            default: "Viridis",
                            mode: "sequential",
                            steps: 3,
                            continuous: false
                        }
                    }
                }
            },
            output: "colorize.color"
        }
    },
    {
        id: "sobel",
        label: "Sobel edge detector",
        name: "Modular Sobel",
        description: "Samples a 3×3 RGB neighborhood, computes Sobel X/Y gradients, converts them to magnitude, and renders grayscale edge strength.",
        graph: {
            nodes: {
                neighborhood: {
                    type: "sample-neighborhood-3x3",
                    params: {
                        sourceIndex: 0,
                        channelIndexes: [0, 1, 2]
                    }
                },
                sobel: {
                    type: "sobel-gradient",
                    inputs: {
                        upperLeft: "neighborhood.upperLeft",
                        up: "neighborhood.up",
                        upperRight: "neighborhood.upperRight",
                        left: "neighborhood.left",
                        center: "neighborhood.center",
                        right: "neighborhood.right",
                        lowerLeft: "neighborhood.lowerLeft",
                        down: "neighborhood.down",
                        lowerRight: "neighborhood.lowerRight"
                    }
                },
                magnitude: {
                    type: "gradient-magnitude",
                    inputs: {
                        gx: "sobel.gx",
                        gy: "sobel.gy"
                    }
                },
                grayscale: {
                    type: "grayscale-colorize",
                    inputs: {
                        value: "magnitude.magnitude"
                    }
                }
            },
            output: "grayscale.color"
        }
    },
    {
        id: "threshold-edge",
        label: "Threshold edge",
        name: "Modular threshold edge",
        description: "Samples a local scalar neighborhood, detects threshold crossings, and renders lower/upper sides with separate edge colors.",
        graph: {
            nodes: {
                distance: {
                    type: "zoom-scaled-distance",
                    params: {
                        edge_thickness: 1,
                        zoom_scale: 0.005,
                        base_distance: 0.008
                    }
                },
                neighborhood: {
                    type: "cross-neighborhood-sample",
                    inputs: {
                        distance: "distance.distance"
                    },
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0
                    }
                },
                score: {
                    type: "threshold-neighborhood-score",
                    inputs: {
                        upperLeft: "neighborhood.upperLeft",
                        up: "neighborhood.up",
                        upperRight: "neighborhood.upperRight",
                        left: "neighborhood.left",
                        center: "neighborhood.center",
                        right: "neighborhood.right",
                        lowerLeft: "neighborhood.lowerLeft",
                        down: "neighborhood.down",
                        lowerRight: "neighborhood.lowerRight"
                    },
                    params: {
                        threshold: 50
                    }
                },
                crossing: {
                    type: "edge-crossing",
                    inputs: {
                        centerScore: "score.centerScore",
                        minScore: "score.minScore",
                        maxScore: "score.maxScore"
                    }
                },
                colorize: {
                    type: "two-sided-edge-colorize",
                    inputs: {
                        lowerAlpha: "crossing.lowerAlpha",
                        upperAlpha: "crossing.upperAlpha"
                    },
                    params: {
                        inner_color: "#b2a800",
                        outer_color: "#fff700"
                    }
                }
            },
            output: "colorize.color"
        }
    },
    {
        id: "synthetic-channel-4-alpha-7",
        label: "8-channel source: channel 4 with channel 7 alpha",
        name: "Modular 8-channel source test",
        description: "Samples channel 4 from the second RGBA pack as magenta intensity and channel 7 from the second RGBA pack as alpha. Select the Synthetic 8-channel GPU set image source.",
        graph: {
            nodes: {
                channel4: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 4
                    }
                },
                channel7: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 7
                    }
                },
                colorize: {
                    type: "colorize",
                    inputs: {
                        value: "channel4.value",
                        alpha: "channel7.value"
                    },
                    params: {
                        color: "#ff00ff"
                    }
                }
            },
            output: "colorize.color"
        }
    },
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

const MODULAR_SHADER_ID = "modular";



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
            graph: createDefaultModularGraph(),
        },
        cache: {},
    },
};

let shaderLayerOrder = [MODULAR_SHADER_ID];

let pendingGraphText = null;
let modularConfigDiagnostics = [];
let modularConfigAnalysis = null;
let selectedShaderPresetId = "heatmap-threshold";
let moduleGraphEditor = null;
let moduleGraphPreviewDrawer = null;

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
            The graph must compile to a <code>vec4</code> output. Press <code>Ctrl/Cmd+Enter</code> in the editor to commit immediately.
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
        ${renderShaderPresetPanel()}
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

/**
 * Render the preset selector above the modular graph editor.
 *
 * @returns {string} Preset selector HTML.
 */
function renderShaderPresetPanel() {
    const preset = getShaderPreset(selectedShaderPresetId);
    const description = preset ?
        preset.description :
        "Manual graph configuration. Editing the name or JSON marks the selection as custom.";

    return `
        <div class="shader-config-preset-panel">
            <label class="shader-config-field-label">
                Preset shader layer configuration
                <select class="shader-config-preset-select">
                    ${renderShaderPresetOptions()}
                </select>
            </label>
            <p class="shader-config-preset-description">
                ${escapeHtml(description)}
            </p>
        </div>
    `;
}

/**
 * Render preset selector options.
 *
 * @returns {string} Preset option HTML.
 */
function renderShaderPresetOptions() {
    const customSelected = selectedShaderPresetId === CUSTOM_SHADER_PRESET_ID ? "selected" : "";

    return `
        <option value="${CUSTOM_SHADER_PRESET_ID}" ${customSelected}>Custom / manual JSON</option>
        ${MODULAR_SHADER_PRESETS.map((preset) => {
        const selected = preset.id === selectedShaderPresetId ? "selected" : "";

        return `
                <option value="${escapeHtml(preset.id)}" ${selected}>
                    ${escapeHtml(preset.label)}
                </option>
            `;
    }).join("")}
    `;
}

/**
 * Return a preset by id.
 *
 * @param {string} id - Preset id.
 * @returns {object|undefined} Matching preset.
 */
function getShaderPreset(id) {
    return MODULAR_SHADER_PRESETS.find((preset) => preset.id === id);
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
    $(".shader-config-preset-select").on("change", function() {
        if (this.value === CUSTOM_SHADER_PRESET_ID) {
            selectedShaderPresetId = CUSTOM_SHADER_PRESET_ID;
            renderShaderConfigPanel();
            return;
        }

        applyShaderLayerPreset(this.value);
    });

    $(".shader-config-name-input").on("change", function() {
        const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

        selectedShaderPresetId = CUSTOM_SHADER_PRESET_ID;
        shaderConfig.name = this.value.trim() || MODULAR_SHADER_ID;
        applyShaderLayerGuiConfig();
        renderShaderConfigPanel();
    });

    $(".shader-config-image-index-select").on("change", function() {
        const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

        shaderConfig.tiledImages = [Number(this.value)];
        applyShaderLayerGuiConfig();
        renderShaderConfigPanel();

        if (moduleGraphEditor) {
            moduleGraphEditor.resize();
        }
    });

    $(".shader-config-module-textarea").on("input", function() {
        selectedShaderPresetId = CUSTOM_SHADER_PRESET_ID;
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

/**
 * Apply a preset to the single modular ShaderLayer.
 *
 * The current image binding is intentionally preserved so users can compare
 * presets against the same image source.
 *
 * @param {string} presetId - Preset id.
 * @returns {void}
 */
function applyShaderLayerPreset(presetId) {
    const preset = getShaderPreset(presetId);
    if (!preset) {
        return;
    }

    const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

    const graph = cloneJson(preset.graph);
    const result = analyzeGraphConfig(graph);
    const hasErrors = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

    selectedShaderPresetId = preset.id;
    shaderConfig.name = preset.name;

    if (hasErrors) {
        pendingGraphText = JSON.stringify(graph, null, 4);
        modularConfigDiagnostics = result.diagnostics;
        modularConfigAnalysis = result.analysis;
        renderShaderConfigPanel();
        return;
    }

    shaderConfig.params = shaderConfig.params || {};
    shaderConfig.params.graph = graph;
    shaderConfig.cache = {};

    pendingGraphText = null;
    modularConfigDiagnostics = [];
    modularConfigAnalysis = null;

    applyShaderLayerGuiConfig();
    renderShaderConfigPanel();
    syncModuleGraphEditorFromConfig("apply-shader-layer-preset");
}

function resetDefaultGraph() {
    applyShaderLayerPreset("heatmap-threshold");
}

/**
 * Mount the standalone module graph editor into the demo panel.
 *
 * @returns {void}
 */
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
        graphConfig: cloneJson(getGraphConfig(shaderLayerConfig[MODULAR_SHADER_ID])),
        height: 560,
        previewProvider: createModuleGraphPreviewProvider(),
        onDraftChange: () => {
            setModuleGraphEditorStatus("Editor draft changed. Apply the graph editor changes to update the live shader layer.", "info");
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

/**
 * Bind graph editor panel buttons.
 *
 * @returns {void}
 */
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

/**
 * Apply a valid graph editor draft into the demo ShaderLayer config.
 *
 * @returns {void}
 */
function applyModuleGraphEditorDraft() {
    if (!moduleGraphEditor) {
        return;
    }

    const result = moduleGraphEditor.apply();

    if (!result.ok) {
        modularConfigAnalysis = result.analysis;
        modularConfigDiagnostics = result.diagnostics || [];
        renderShaderConfigPanel();
        bindModuleGraphEditorPanelEvents();
        return;
    }

    const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

    selectedShaderPresetId = CUSTOM_SHADER_PRESET_ID;
    shaderConfig.params = shaderConfig.params || {};
    shaderConfig.params.graph = cloneJson(result.graphConfig);
    shaderConfig.cache = {};

    pendingGraphText = null;
    modularConfigAnalysis = result.analysis;
    modularConfigDiagnostics = result.diagnostics || [];

    applyShaderLayerGuiConfig();
    renderShaderConfigPanel();
    bindModuleGraphEditorPanelEvents();
    setModuleGraphEditorStatus("Graph editor changes applied to the live modular ShaderLayer.", "ok");
}

/**
 * Reset the graph editor draft from the current live demo graph config.
 *
 * @returns {void}
 */
function resetModuleGraphEditorDraft() {
    syncModuleGraphEditorFromConfig("reset-editor-draft");
    setModuleGraphEditorStatus("Graph editor draft reset from the current shader layer config.", "ok");
}

/**
 * Run a demo-local smoke test for the module graph editor integration.
 *
 * This test intentionally exercises the public editor API instead of private
 * editor internals. It applies one valid graph through the demo path, then
 * restores the previous demo graph so the live renderer is not left in a test
 * state.
 *
 * @returns {{ok: boolean, checks: object[], error: (string|null)}} Smoke test result.
 */
function runModuleGraphEditorSmokeTest() {
    const checks = [];
    let previousGraph = null;
    let previousPresetId = null;
    let previousPendingGraphText = null;
    let previousDiagnostics = null;
    let previousAnalysis = null;
    let shouldRestore = false;

    const record = (name, ok, details = {}) => {
        checks.push({
            name,
            ok: !!ok,
            details
        });

        if (!ok) {
            throw new Error(`${name} failed`);
        }
    };

    const restorePreviousState = () => {
        if (!shouldRestore || !previousGraph) {
            return;
        }

        const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

        shaderConfig.params = shaderConfig.params || {};
        shaderConfig.params.graph = cloneJson(previousGraph);
        shaderConfig.cache = {};

        selectedShaderPresetId = previousPresetId;
        pendingGraphText = previousPendingGraphText;
        modularConfigDiagnostics = previousDiagnostics || [];
        modularConfigAnalysis = previousAnalysis || null;

        applyShaderLayerGuiConfig();
        renderShaderConfigPanel();
        syncModuleGraphEditorFromConfig("module-graph-editor-smoke-test-restore");
    };

    try {
        if (!moduleGraphEditor) {
            mountModuleGraphEditor();
        }

        record("editor-mounted", !!moduleGraphEditor);

        previousGraph = cloneJson(getGraphConfig(shaderLayerConfig[MODULAR_SHADER_ID]));
        previousPresetId = selectedShaderPresetId;
        previousPendingGraphText = pendingGraphText;
        previousDiagnostics = cloneJson(modularConfigDiagnostics);
        previousAnalysis = modularConfigAnalysis;
        shouldRestore = true;

        const testGraph = {
            nodes: {
                sample_1: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0
                    }
                },
                threshold_1: {
                    type: "threshold-mask",
                    inputs: {
                        value: "sample_1.value"
                    },
                    params: {
                        threshold: {
                            type: "range",
                            default: 0.5,
                            min: 0,
                            max: 1,
                            step: 0.01,
                            title: "Threshold"
                        }
                    }
                },
                colorize_1: {
                    type: "colorize",
                    inputs: {
                        value: "sample_1.value",
                        alpha: "threshold_1.mask"
                    },
                    params: {
                        color: "#00ffff"
                    }
                }
            },
            output: "colorize_1.color"
        };

        moduleGraphEditor.setDraftGraphConfig(cloneJson(testGraph), {
            updateSource: true,
            reason: "module-graph-editor-smoke-test"
        });

        const draft = moduleGraphEditor.getDraftGraphConfig();

        record("draft-has-nodes", !!draft.nodes && !!draft.nodes.sample_1 && !!draft.nodes.threshold_1 && !!draft.nodes.colorize_1, {
            nodeIds: Object.keys(draft.nodes || {})
        });

        record("draft-has-threshold-reference", draft.nodes.threshold_1.inputs.value === "sample_1.value", {
            value: draft.nodes.threshold_1.inputs && draft.nodes.threshold_1.inputs.value
        });

        record("draft-has-colorize-references", (
            draft.nodes.colorize_1.inputs.value === "sample_1.value" &&
            draft.nodes.colorize_1.inputs.alpha === "threshold_1.mask"
        ), {
            inputs: draft.nodes.colorize_1.inputs
        });

        record("draft-has-vec4-output", draft.output === "colorize_1.color", {
            output: draft.output
        });

        const invalidApply = (() => {
            moduleGraphEditor.setDraftGraphConfig({
                nodes: {
                    sample_1: {
                        type: "sample-source-channel",
                        params: {
                            sourceIndex: 0,
                            channelIndex: 0
                        }
                    }
                },
                output: "missing.value"
            }, {
                updateSource: false,
                reason: "module-graph-editor-smoke-test-invalid"
            });

            return moduleGraphEditor.apply();
        })();

        record("invalid-apply-blocked", invalidApply.ok === false, {
            diagnostics: invalidApply.diagnostics
        });

        moduleGraphEditor.setDraftGraphConfig(cloneJson(testGraph), {
            updateSource: true,
            reason: "module-graph-editor-smoke-test-valid"
        });

        const validApply = moduleGraphEditor.apply();

        record("valid-apply-ok", validApply.ok === true, {
            diagnostics: validApply.diagnostics
        });

        applyModuleGraphEditorDraft();

        const liveGraph = getGraphConfig(shaderLayerConfig[MODULAR_SHADER_ID]);

        record("demo-config-updated", !!liveGraph.nodes && liveGraph.output === "colorize_1.color", {
            output: liveGraph.output,
            nodeIds: Object.keys(liveGraph.nodes || {})
        });

        restorePreviousState();
        shouldRestore = false;

        setModuleGraphEditorStatus("Module graph editor smoke test passed. Previous graph restored.", "ok");

        return {
            ok: true,
            checks,
            error: null
        };
    } catch (error) {
        try {
            restorePreviousState();
        } catch (restoreError) {
            checks.push({
                name: "restore-previous-state",
                ok: false,
                details: {
                    error: restoreError && restoreError.message ? restoreError.message : String(restoreError)
                }
            });
        }

        setModuleGraphEditorStatus(
            `Module graph editor smoke test failed: ${error && error.message ? error.message : String(error)}`,
            "error"
        );

        return {
            ok: false,
            checks,
            error: error && error.message ? error.message : String(error)
        };
    }
}

/**
 * Replace the editor draft with the current demo graph config.
 *
 * @param {string} reason - Synchronization reason.
 * @returns {void}
 */
function syncModuleGraphEditorFromConfig(reason) {
    if (!moduleGraphEditor) {
        return;
    }

    moduleGraphEditor.setDraftGraphConfig(
        cloneJson(getGraphConfig(shaderLayerConfig[MODULAR_SHADER_ID])),
        {
            updateSource: true,
            reason
        }
    );

    moduleGraphEditor.resize();
}

/**
 * Update the graph editor status message.
 *
 * @param {string} message - Status message.
 * @param {"info"|"ok"|"error"} [kind="info"] - Status kind.
 * @returns {void}
 */
function setModuleGraphEditorStatus(message, kind = "info") {
    const status = document.getElementById("module-graph-editor-status");

    if (!status) {
        return;
    }

    status.className = "module-graph-editor-status";

    if (kind === "ok") {
        status.classList.add("module-graph-editor-status--ok");
    } else if (kind === "error") {
        status.classList.add("module-graph-editor-status--error");
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
    if (!viewer || !viewer.drawer) {
        return null;
    }

    return viewer.drawer.renderer || viewer.drawer.flexRenderer || null;
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

/**
 * Create the preview provider used by the module graph editor.
 *
 * The provider keeps demo/OpenSeadragon state outside the editor. Structural
 * preview validation is delegated to the live FlexRenderer, while drawing uses
 * the current FlexDrawer extraction path so the preview reflects the active
 * source/view state.
 *
 * @returns {object} Preview provider for ShaderModuleGraphEditor.
 */
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

/**
 * Return the tiled images used by the live modular ShaderLayer.
 *
 * @returns {OpenSeadragon.TiledImage[]} Tiled images currently bound to the demo layer.
 */
function getModuleGraphPreviewTiledImages() {
    if (!viewer || !viewer.world || typeof viewer.world.getItemAt !== "function") {
        return [];
    }

    const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID] || {};
    const indexes = Array.isArray(shaderConfig.tiledImages) && shaderConfig.tiledImages.length ?
        shaderConfig.tiledImages :
        [0];
    const result = [];

    for (const index of indexes) {
        const numericIndex = Number(index);

        if (!Number.isFinite(numericIndex)) {
            continue;
        }

        const tiledImage = viewer.world.getItemAt(numericIndex);

        if (tiledImage) {
            result.push(tiledImage);
        }
    }

    return result;
}

/**
 * Return dimensions used to preserve preview aspect ratio.
 *
 * @returns {{width: number, height: number}} Preview source dimensions.
 */
function getModuleGraphPreviewSourceDimensions() {
    const tiledImages = getModuleGraphPreviewTiledImages();
    const tiledImage = tiledImages[0];

    if (tiledImage && tiledImage.source && tiledImage.source.dimensions) {
        return {
            width: Math.max(1, Number(tiledImage.source.dimensions.x) || 1),
            height: Math.max(1, Number(tiledImage.source.dimensions.y) || 1)
        };
    }

    if (viewer && viewer.drawer && viewer.drawer.canvas) {
        return {
            width: Math.max(1, Number(viewer.drawer.canvas.width) || 1),
            height: Math.max(1, Number(viewer.drawer.canvas.height) || 1)
        };
    }

    return {
        width: 256,
        height: 160
    };
}

/**
 * Return the standalone drawer used for module output previews.
 *
 * @returns {?OpenSeadragon.FlexDrawer} Standalone extraction drawer, or null.
 */
function getModuleGraphPreviewDrawer() {
    if (moduleGraphPreviewDrawer) {
        return moduleGraphPreviewDrawer;
    }

    if (typeof OpenSeadragon.makeStandaloneFlexDrawer !== "function") {
        return null;
    }

    moduleGraphPreviewDrawer = OpenSeadragon.makeStandaloneFlexDrawer(viewer);
    return moduleGraphPreviewDrawer;
}

/**
 * Return the current viewer view for standalone preview rendering.
 *
 * @returns {object} Current viewport state.
 */
function getModuleGraphPreviewView() {
    const bounds = viewer.viewport.getBoundsNoRotateWithMargins(true);

    return {
        bounds,
        center: new OpenSeadragon.Point(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
        ),
        rotation: viewer.viewport.getRotation(true) * Math.PI / 180,
        zoom: viewer.viewport.getZoom(true)
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
    return params.graph || createDefaultModularGraph();
}

function applyShaderLayerGuiConfig(options = {}) {
    return viewer.drawer.overrideConfigureAll(shaderLayerConfig, shaderLayerOrder, options);
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

/**
 * Debug helpers exposed for manual demo verification from the browser console.
 */
window.modularShaderLayerDemo = {
    viewer,
    shaderLayerConfig,
    shaderLayerOrder,
    modularShaderId: MODULAR_SHADER_ID,
    applyShaderLayerGuiConfig,
    getLiveFlexRenderer,
    getLiveModularShaderLayer,
    makeDraftModuleGraphOwner,
    createModuleGraphPreviewProvider,
    getModuleGraphPreviewTiledImages,
    getModuleGraphPreviewSourceDimensions,
    analyzeGraphText,
    analyzeGraphConfig,
    resetDefaultGraph,
    renderShaderConfigPanel,
    shaderPresets: MODULAR_SHADER_PRESETS,
    applyShaderLayerPreset,
    mountModuleGraphEditor,
    syncModuleGraphEditorFromConfig,
    applyModuleGraphEditorDraft,
    resetModuleGraphEditorDraft,
    runModuleGraphEditorSmokeTest,
    getModuleGraphEditor: () => moduleGraphEditor,
    cloneJson,
};

applyShaderLayerGuiConfig();
renderImageSourceIndexPanel();
renderShaderConfigPanel();
mountModuleGraphEditor();
