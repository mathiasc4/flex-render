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

const MODULAR_GRAPH_TESTS = [
    {
        id: "valid-default-runtime",
        label: "Valid default graph / runtime commit",
        description: "Validates the standard sample → threshold → colorize graph and commits it through the live modular layer.",
        graph: DEFAULT_MODULAR_GRAPH,
        tiledImages: [0],
        expect: {
            errorCodes: [],
            warningCodes: [],
            runtime: true,
        },
    },
    {
        id: "valid-two-source-runtime",
        label: "Valid two-source graph / runtime commit",
        description: "Samples source 0 for intensity and source 1 for alpha mask to test multiple graph source requirements.",
        tiledImages: [0, 1],
        graph: {
            nodes: {
                value: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0,
                    },
                },
                alphaSource: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 1,
                        channelIndex: 0,
                    },
                },
                alphaMask: {
                    type: "threshold-mask",
                    inputs: {
                        value: "alphaSource.value",
                    },
                    params: {
                        threshold: 0.45,
                    },
                },
                colorize: {
                    type: "colorize",
                    inputs: {
                        value: "value.value",
                        alpha: "alphaMask.mask",
                    },
                    params: {
                        color: "#ff00ff",
                    },
                },
            },
            output: "colorize.color",
        },
        expect: {
            errorCodes: [],
            warningCodes: [],
            runtime: true,
            sourceDefinitions: [
                {
                    index: 0,
                    sampledChannels: [0],
                    requiredChannelCount: 1,
                },
                {
                    index: 1,
                    sampledChannels: [0],
                    requiredChannelCount: 1,
                },
            ],
        },
    },
    {
        id: "valid-duplicate-source-merge-runtime",
        label: "Duplicate source requirements merge / runtime commit",
        description: "Samples channels 0 and 2 from source 0 through different nodes to test source requirement merging.",
        tiledImages: [0],
        graph: {
            nodes: {
                value: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0,
                    },
                },
                alphaSource: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 2,
                    },
                },
                alphaMask: {
                    type: "threshold-mask",
                    inputs: {
                        value: "alphaSource.value",
                    },
                    params: {
                        threshold: 0.4,
                    },
                },
                colorize: {
                    type: "colorize",
                    inputs: {
                        value: "value.value",
                        alpha: "alphaMask.mask",
                    },
                    params: {
                        color: "#00ff66",
                    },
                },
            },
            output: "colorize.color",
        },
        expect: {
            errorCodes: [],
            warningCodes: [],
            runtime: true,
            sourceDefinitions: [
                {
                    index: 0,
                    sampledChannels: [0, 2],
                    requiredChannelCount: 3,
                },
            ],
        },
    },
    {
        id: "valid-high-channel-analysis",
        label: "High channel index source requirement / analyzer only",
        description: "Samples channel 7 to verify requiredChannelCount is reported as at least 8 without committing the graph.",
        graph: {
            nodes: {
                value: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 7,
                    },
                },
                alphaMask: {
                    type: "threshold-mask",
                    inputs: {
                        value: "value.value",
                    },
                    params: {
                        threshold: 0.5,
                    },
                },
                colorize: {
                    type: "colorize",
                    inputs: {
                        value: "value.value",
                        alpha: "alphaMask.mask",
                    },
                    params: {
                        color: "#ffaa00",
                    },
                },
            },
            output: "colorize.color",
        },
        expect: {
            errorCodes: [],
            warningCodes: [],
            runtime: false,
            sourceDefinitions: [
                {
                    index: 0,
                    sampledChannels: [7],
                    requiredChannelCount: 8,
                },
            ],
        },
    },
    {
        id: "warning-unreachable-node",
        label: "Unreachable node warning",
        description: "Adds a valid unused node to verify unreachable-node diagnostics without blocking commit.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0,
                    },
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
                    },
                },
                unused: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 1,
                    },
                },
            },
            output: "colorize.color",
        },
        expect: {
            errorCodes: [],
            warningCodes: ["unreachable-node"],
            runtime: true,
        },
    },
    {
        id: "error-unknown-input-key",
        label: "Unknown input key diagnostic",
        description: "Adds an undeclared input key to colorize to verify strict editor-facing diagnostics.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0,
                    },
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
                        extra: "src.value",
                    },
                    params: {
                        color: "#00ffff",
                    },
                },
            },
            output: "colorize.color",
        },
        expect: {
            errorCodes: ["unknown-input-port"],
            runtime: false,
        },
    },
    {
        id: "error-missing-required-input",
        label: "Missing required input diagnostic",
        description: "Omits threshold-mask.value to verify required input validation.",
        graph: {
            nodes: {
                threshold: {
                    type: "threshold-mask",
                    params: {
                        threshold: 0.5,
                    },
                },
            },
            output: "threshold.mask",
        },
        expect: {
            errorCodes: ["missing-required-input"],
            runtime: false,
        },
    },
    {
        id: "error-unknown-module",
        label: "Unknown module type diagnostic",
        description: "Uses a non-existent module type to verify module registry diagnostics.",
        graph: {
            nodes: {
                src: {
                    type: "missing-test-module",
                    params: {},
                },
            },
            output: "src.value",
        },
        expect: {
            errorCodes: ["unknown-module-type"],
            runtime: false,
        },
    },
    {
        id: "error-unknown-output-port",
        label: "Unknown graph output port diagnostic",
        description: "References an output port that the colorize module does not declare.",
        graph: {
            nodes: {
                src: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0,
                    },
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
                    },
                },
            },
            output: "colorize.missing",
        },
        expect: {
            errorCodes: ["unknown-graph-output-port"],
            runtime: false,
        },
    },
    {
        id: "error-type-mismatch",
        label: "Type mismatch diagnostic",
        description: "Connects a vec3 source value to colorize.value, which expects a float.",
        graph: {
            nodes: {
                rgb: {
                    type: "sample-source-channels",
                    params: {
                        sourceIndex: 0,
                        channelIndexes: [0, 1, 2],
                    },
                },
                alphaSource: {
                    type: "sample-source-channel",
                    params: {
                        sourceIndex: 0,
                        channelIndex: 0,
                    },
                },
                alphaMask: {
                    type: "threshold-mask",
                    inputs: {
                        value: "alphaSource.value",
                    },
                    params: {
                        threshold: 0.5,
                    },
                },
                colorize: {
                    type: "colorize",
                    inputs: {
                        value: "rgb.value",
                        alpha: "alphaMask.mask",
                    },
                    params: {
                        color: "#00ffff",
                    },
                },
            },
            output: "colorize.color",
        },
        expect: {
            errorCodes: ["type-mismatch"],
            runtime: false,
        },
    },
    {
        id: "error-cycle",
        label: "Graph cycle diagnostic",
        description: "Creates a self-cycle on threshold-mask.value to verify cycle detection.",
        graph: {
            nodes: {
                threshold: {
                    type: "threshold-mask",
                    inputs: {
                        value: "threshold.mask",
                    },
                    params: {
                        threshold: 0.5,
                    },
                },
            },
            output: "threshold.mask",
        },
        expect: {
            errorCodes: ["graph-cycle"],
            runtime: false,
        },
    },
    {
        id: "error-invalid-json",
        label: "Invalid JSON diagnostic",
        description: "Tests textarea parsing before analyzer execution.",
        text: "{\n    \"nodes\": {\n",
        expect: {
            errorCodes: ["invalid-json"],
            runtime: false,
        },
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
let selectedGraphTestId = MODULAR_GRAPH_TESTS[0].id;
let modularGraphTestResults = [];

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
                        ${renderModularGraphTestControls()}
                        <label class="shader-config-field-label">
                            Modular configuration <span class="shader-config-type-locked">params.graph JSON</span>
                            <textarea
                                class="shader-config-module-textarea"
                                spellcheck="false"
                            >${escapeHtml(graphText)}</textarea>
                        </label>
                        ${diagnosticsHtml}
                        ${renderModularGraphTestResults()}
                    </div>
                </div>
            </li>
        </ul>
    `;
}

function renderModularGraphTestControls() {
    return `
        <div class="shader-config-tests">
            <div class="shader-config-tests__title">Modular graph test harness</div>
            <div class="shader-config-tests__row">
                <label class="shader-config-field-label">
                    Test case
                    <select class="shader-config-test-select">
                        ${renderGraphTestOptions()}
                    </select>
                </label>
            </div>
            <div class="shader-config-tests__actions">
                <button type="button" class="shader-config-load-test">Load selected</button>
                <button type="button" class="shader-config-run-test">Run selected</button>
                <button type="button" class="shader-config-run-suite">Run full suite</button>
                <button type="button" class="shader-config-reset-default">Reset default</button>
            </div>
        </div>
    `;
}

function renderGraphTestOptions() {
    return MODULAR_GRAPH_TESTS.map((test) => {
        const selected = test.id === selectedGraphTestId ? "selected" : "";

        return `
            <option value="${escapeHtml(test.id)}" ${selected}>
                ${escapeHtml(test.label)}
            </option>
        `;
    }).join("");
}

function renderModularGraphTestResults() {
    if (!modularGraphTestResults.length) {
        return "";
    }

    const rows = modularGraphTestResults.map((result) => {
        const statusClass = result.ok ?
            "shader-config-test-results__item--pass" :
            result.skipped ?
                "shader-config-test-results__item--skip" :
                "shader-config-test-results__item--fail";

        return `
            <li class="shader-config-test-results__item ${statusClass}">
                <span class="shader-config-test-results__code">${escapeHtml(result.id)}</span>
                — ${escapeHtml(result.message)}
                ${renderGraphTestResultMeta(result)}
            </li>
        `;
    }).join("");

    const passed = modularGraphTestResults.filter((result) => result.ok).length;
    const total = modularGraphTestResults.length;

    return `
        <div class="shader-config-test-results">
            <div class="shader-config-test-results__title">
                Test results: ${passed}/${total} passed
            </div>
            <ul class="shader-config-test-results__list">
                ${rows}
            </ul>
        </div>
    `;
}

function renderGraphTestResultMeta(result) {
    if (!result.details || !result.details.length) {
        return "";
    }

    return `
        <div class="shader-config-test-results__meta">
            ${escapeHtml(result.details.join(" | "))}
        </div>
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

    $(".shader-config-test-select").on("change", function() {
        selectedGraphTestId = this.value;
    });

    $(".shader-config-load-test").on("click", function() {
        loadSelectedGraphTest();
    });

    $(".shader-config-run-test").on("click", function() {
        runSelectedGraphTest();
    });

    $(".shader-config-run-suite").on("click", function() {
        runModularGraphTestSuite();
    });

    $(".shader-config-reset-default").on("click", function() {
        resetDefaultGraph();
    });
}

function loadSelectedGraphTest() {
    const test = getSelectedGraphTest();

    if (!test) {
        return;
    }

    pendingGraphText = getGraphTestText(test);
    modularGraphTestResults = [];

    const result = analyzeGraphText(pendingGraphText);
    modularConfigAnalysis = result.analysis;
    modularConfigDiagnostics = result.diagnostics;

    renderShaderConfigPanel();
}

function runSelectedGraphTest() {
    const test = getSelectedGraphTest();

    if (!test) {
        return;
    }

    pendingGraphText = getGraphTestText(test);

    const result = analyzeGraphText(pendingGraphText);
    modularConfigAnalysis = result.analysis;
    modularConfigDiagnostics = result.diagnostics;

    modularGraphTestResults = [
        runModularGraphTest(test),
    ];

    renderShaderConfigPanel();
}

function runModularGraphTestSuite() {
    const originalConfig = cloneJson(shaderLayerConfig[MODULAR_SHADER_ID]);

    modularGraphTestResults = MODULAR_GRAPH_TESTS.map(runModularGraphTest);

    restoreModularShaderConfig(originalConfig);
    pendingGraphText = null;
    modularConfigDiagnostics = [];
    modularConfigAnalysis = null;

    applyShaderLayerGuiConfig();
    renderShaderConfigPanel();
}

function resetDefaultGraph() {
    const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

    shaderConfig.name = "Modular heatmap";
    shaderConfig.tiledImages = [0];
    shaderConfig.params = {
        graph: cloneJson(DEFAULT_MODULAR_GRAPH),
    };
    shaderConfig.cache = {};

    pendingGraphText = null;
    modularConfigDiagnostics = [];
    modularConfigAnalysis = null;
    modularGraphTestResults = [];

    applyShaderLayerGuiConfig();
    renderShaderConfigPanel();
}

function getSelectedGraphTest() {
    return MODULAR_GRAPH_TESTS.find((test) => test.id === selectedGraphTestId) || MODULAR_GRAPH_TESTS[0];
}

function getGraphTestText(test) {
    if (typeof test.text === "string") {
        return test.text;
    }

    return JSON.stringify(test.graph, null, 4);
}

function runModularGraphTest(test) {
    const text = getGraphTestText(test);
    const result = analyzeGraphText(text);
    const diagnostics = result.diagnostics || [];
    const expected = test.expect || {};
    const details = [];
    const failures = [];

    assertExpectedDiagnostics(test, diagnostics, expected, failures, details);
    assertExpectedSourceDefinitions(result.analysis, expected, failures, details);

    if (!failures.length && expected.runtime) {
        const runtimeResult = runRuntimeCommitTest(test, result.graph);
        details.push(...runtimeResult.details);

        if (!runtimeResult.ok) {
            failures.push(runtimeResult.message);
        }
    } else if (!expected.runtime) {
        details.push("runtime commit skipped");
    }

    return {
        id: test.id,
        ok: failures.length === 0,
        skipped: false,
        message: failures.length ? failures.join(" ") : test.description,
        details,
    };
}

function assertExpectedDiagnostics(test, diagnostics, expected, failures, details) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
    const errorCodes = errors.map((diagnostic) => diagnostic.code);
    const warningCodes = warnings.map((diagnostic) => diagnostic.code);

    details.push(`errors: ${errorCodes.length ? errorCodes.join(", ") : "none"}`);
    details.push(`warnings: ${warningCodes.length ? warningCodes.join(", ") : "none"}`);

    const expectedErrorCodes = expected.errorCodes || [];
    const expectedWarningCodes = expected.warningCodes || [];

    for (const code of expectedErrorCodes) {
        if (!errorCodes.includes(code)) {
            failures.push(`Expected error '${code}' was not reported.`);
        }
    }

    for (const code of expectedWarningCodes) {
        if (!warningCodes.includes(code)) {
            failures.push(`Expected warning '${code}' was not reported.`);
        }
    }

    if (!expectedErrorCodes.length && errorCodes.length) {
        failures.push(`Unexpected errors: ${errorCodes.join(", ")}.`);
    }

    if (expected.warningCodes && !expectedWarningCodes.length && warningCodes.length) {
        failures.push(`Unexpected warnings: ${warningCodes.join(", ")}.`);
    }

    if (expected.runtime && errorCodes.length) {
        failures.push("Runtime test expected an analyzer-clean graph.");
    }
}

function assertExpectedSourceDefinitions(analysis, expected, failures, details) {
    if (!expected.sourceDefinitions) {
        return;
    }

    const definitions = analysis &&
    analysis.partial &&
    Array.isArray(analysis.partial.sourceDefinitions) ?
        analysis.partial.sourceDefinitions : [];

    for (const expectedSource of expected.sourceDefinitions) {
        const actual = definitions[expectedSource.index];

        if (!actual) {
            failures.push(`Expected source definition ${expectedSource.index} is missing.`);
            continue;
        }

        if (expectedSource.requiredChannelCount !== undefined &&
            actual.requiredChannelCount < expectedSource.requiredChannelCount) {
            failures.push(
                `Source ${expectedSource.index} requiredChannelCount expected at least ` +
                `${expectedSource.requiredChannelCount}, got ${actual.requiredChannelCount}.`
            );
        }

        if (expectedSource.sampledChannels) {
            const actualChannels = Array.isArray(actual.sampledChannels) ? actual.sampledChannels : [];

            for (const channel of expectedSource.sampledChannels) {
                if (!actualChannels.includes(channel)) {
                    failures.push(`Source ${expectedSource.index} missing sampled channel ${channel}.`);
                }
            }
        }

        details.push(
            `source ${expectedSource.index}: channels ` +
            `${(actual.sampledChannels || []).join(", ") || "none"}, required ${actual.requiredChannelCount || 0}`
        );
    }
}

function runRuntimeCommitTest(test, graph) {
    const previousConfig = cloneJson(shaderLayerConfig[MODULAR_SHADER_ID]);
    const details = [];

    try {
        const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];

        shaderConfig.params = shaderConfig.params || {};
        shaderConfig.params.graph = cloneJson(graph);
        shaderConfig.tiledImages = Array.isArray(test.tiledImages) ? test.tiledImages.slice() : [0];
        shaderConfig.cache = {};

        applyShaderLayerGuiConfig({ immediate: true });

        const liveLayer = getLiveModularShaderLayer();

        if (!liveLayer) {
            return {
                ok: false,
                message: "Runtime commit did not produce a live modular shader layer.",
                details,
            };
        }

        details.push("runtime commit ok");
        details.push(`tiledImages: ${shaderConfig.tiledImages.join(", ")}`);

        return {
            ok: true,
            message: "Runtime commit succeeded.",
            details,
        };
    } catch (error) {
        return {
            ok: false,
            message: error && error.message ? error.message : String(error),
            details,
        };
    } finally {
        restoreModularShaderConfig(previousConfig);
        applyShaderLayerGuiConfig({ immediate: true });
    }
}

function restoreModularShaderConfig(snapshot) {
    shaderLayerConfig[MODULAR_SHADER_ID] = cloneJson(snapshot);
}

function updateDraftGraphDiagnostics(text) {
    pendingGraphText = text;
    modularGraphTestResults = [];

    const result = analyzeGraphText(text);
    modularConfigAnalysis = result.analysis;
    modularConfigDiagnostics = result.diagnostics;

    renderGraphDiagnosticsIntoPanel();
}

function commitModularGraphFromText(text) {
    const shaderConfig = shaderLayerConfig[MODULAR_SHADER_ID];
    modularGraphTestResults = [];

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

applyShaderLayerGuiConfig();
renderImageSourceIndexPanel();
renderShaderConfigPanel();
