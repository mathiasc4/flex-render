const DEMO_TILE_SIZE = 256;
const DEMO_MAX_LEVEL = 2;

const DEMO_SOURCE_OPTIONS = {
    type: "diagnostic-demo",
    width: DEMO_TILE_SIZE * 4,
    height: DEMO_TILE_SIZE * 4,
    tileSize: DEMO_TILE_SIZE,
    tileOverlap: 0,
    minLevel: 0,
    maxLevel: DEMO_MAX_LEVEL,
    diagnosticScenario: "invalid-center",
    failurePattern: "center",
    failureReason: "invalid-data"
};

const DIAGNOSTIC_SCENARIOS = {
    "valid-only": {
        failurePattern: "none",
        failureReason: "invalid-data"
    },
    "invalid-center": {
        failurePattern: "center",
        failureReason: "invalid-data"
    },
    "invalid-checker": {
        failurePattern: "checker",
        failureReason: "invalid-data"
    },
    "tainted-center": {
        failurePattern: "center",
        failureReason: "tainted-data"
    },
    "unsupported-center": {
        failurePattern: "center",
        failureReason: "unsupported-data"
    },
    "mixed-reasons": {
        failurePattern: "mixed",
        failureReason: "mixed"
    },
    "custom": {
        failurePattern: "center",
        failureReason: "invalid-data"
    }
};

const drawerOptions = {
    "flex-renderer": {
        debug: false,
        webGLPreferredVersion: "2.0",
        renderDiagnostics: true,
        htmlHandler: renderShaderLayerControls,
        htmlReset: resetShaderLayerControls
    }
};

$("#title-w").html("FlexRenderer tile diagnostics demo");

installDiagnosticDemoTileSource(OpenSeadragon);

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

const IMAGE_SOURCES = [
    {
        key: "diagnostic-demo",
        label: "Diagnostic Demo Source",
        tileSource: DEMO_SOURCE_OPTIONS
    }
];

const indexedImageSources = IMAGE_SOURCES.map((source, index) => ({
    index,
    label: source.label
}));

let shaderLayerConfig = {
    diagnostic_source: {
        name: "Diagnostic Demo Source",
        type: "identity",
        visible: 1,
        tiledImages: [0],
        params: {},
        cache: {}
    }
};

let shaderLayerOrder = [
    "diagnostic_source"
];

function installDiagnosticDemoTileSource($) {
    if ($.DiagnosticDemoTileSource) {
        return;
    }

    class DiagnosticDemoTileSource extends $.TileSource {
        supports(data, url) {
            return !!(
                data && typeof data === "object" &&
                data.type === "diagnostic-demo"
            ) || !!(
                url && typeof url === "object" &&
                url.type === "diagnostic-demo"
            );
        }

        configure(options) {
            const tileSize = Number(options.tileSize) || DEMO_TILE_SIZE;

            this.diagnosticScenario = options.diagnosticScenario || DEMO_SOURCE_OPTIONS.diagnosticScenario;
            this.failurePattern = options.failurePattern || options.invalidPattern || DEMO_SOURCE_OPTIONS.failurePattern;
            this.failureReason = options.failureReason || DEMO_SOURCE_OPTIONS.failureReason;
            this.tileSize = tileSize;
            this.tileWidth = tileSize;
            this.tileHeight = tileSize;
            this.minLevel = Number.isFinite(Number(options.minLevel)) ? Number(options.minLevel) : 0;
            this.maxLevel = Number.isFinite(Number(options.maxLevel)) ? Number(options.maxLevel) : DEMO_MAX_LEVEL;

            return $.extend(options, {
                width: Number(options.width) || tileSize * 4,
                height: Number(options.height) || tileSize * 4,
                tileSize: tileSize,
                tileOverlap: Number(options.tileOverlap) || 0,
                minLevel: this.minLevel,
                maxLevel: this.maxLevel
            });
        }

        getTileUrl(level, x, y) {
            return [
                "diagnostic-demo",
                this.diagnosticScenario,
                this.failurePattern,
                this.failureReason,
                level,
                x,
                y
            ].join(":");
        }

        downloadTileStart(context) {
            const coords = this._parseTileCoordinates(context);
            const failureReason = this._getTileFailureReason(coords.level, coords.x, coords.y);

            if (failureReason) {
                const payload = this._createFailurePayload(failureReason, coords);

                context.finish(payload.data, undefined, payload.type);
                return;
            }

            context.finish(
                this._createTileCanvas(coords.level, coords.x, coords.y, "valid tile data"),
                undefined,
                "image"
            );
        }

        getMetadata() {
            return {
                type: "diagnostic-demo",
                width: this.width,
                height: this.height,
                tileSize: this.tileSize,
                diagnosticScenario: this.diagnosticScenario,
                failurePattern: this.failurePattern,
                failureReason: this.failureReason
            };
        }

        _parseTileCoordinates(context) {
            const src = String(
                context.src ||
                context.url ||
                context.tileUrl ||
                context.source ||
                ""
            );

            const match = /diagnostic-demo:([^:]+):([^:]+):([^:]+):(\d+):(\d+):(\d+)/.exec(src);

            if (match) {
                return {
                    scenario: match[1],
                    failurePattern: match[2],
                    failureReason: match[3],
                    level: Number(match[4]),
                    x: Number(match[5]),
                    y: Number(match[6])
                };
            }

            const tile = context.tile || {};
            return {
                scenario: this.diagnosticScenario,
                failurePattern: this.failurePattern,
                failureReason: this.failureReason,
                level: Number(tile.level) || this.maxLevel,
                x: Number(tile.x) || 0,
                y: Number(tile.y) || 0
            };
        }

        _getTileFailureReason(level, x, y) {
            if (level !== this.maxLevel) {
                return null;
            }

            if (this.diagnosticScenario === "mixed-reasons") {
                return this._getMixedFailureReason(x, y);
            }

            if (!this._matchesFailurePattern(this.failurePattern, x, y)) {
                return null;
            }

            return this.failureReason === "mixed" ? "invalid-data" : this.failureReason;
        }

        _getMixedFailureReason(x, y) {
            if (x === 0 && y === 0) {
                return "invalid-data";
            }

            if (x === 1 && y === 1) {
                return "tainted-data";
            }

            if (x === 2 && y === 2) {
                return "unsupported-data";
            }

            return null;
        }

        _matchesFailurePattern(pattern, x, y) {
            if (pattern === "none") {
                return false;
            }

            if (pattern === "center") {
                return x === 1 && y === 1;
            }

            if (pattern === "diagonal") {
                return x === y;
            }

            if (pattern === "checker") {
                return (x + y) % 2 === 0;
            }

            return false;
        }

        _createFailurePayload(reason, coords) {
            if (reason === "tainted-data") {
                return {
                    type: "image",
                    data: this._createSyntheticTaintedCanvas(coords.level, coords.x, coords.y)
                };
            }

            if (reason === "unsupported-data") {
                return {
                    type: "gpuTextureSet",
                    data: "unsupported-gpu-texture-set-payload"
                };
            }

            return {
                type: "image",
                data: {
                    invalid: true,
                    level: coords.level,
                    x: coords.x,
                    y: coords.y,
                    reason: "demo-invalid-data"
                }
            };
        }

        _createSyntheticTaintedCanvas(level, x, y) {
            const canvas = this._createTileCanvas(level, x, y, "synthetic tainted-data");
            const originalGetContext = canvas.getContext.bind(canvas);
            let taintedContext = null;

            canvas.getContext = function(type, ...args) {
                const context = originalGetContext(type, ...args);

                if (type !== "2d" || !context || typeof context.getImageData !== "function") {
                    return context;
                }

                if (!taintedContext) {
                    taintedContext = new Proxy(context, {
                        get(target, property) {
                            if (property === "getImageData") {
                                return function() {
                                    throw createSyntheticSecurityError();
                                };
                            }

                            const value = target[property];

                            return typeof value === "function" ? value.bind(target) : value;
                        }
                    });
                }

                return taintedContext;
            };

            canvas.__diagnosticDemoTainted = true;

            return canvas;
        }

        _createTileCanvas(level, x, y, label = "valid tile data") {
            const canvas = document.createElement("canvas");
            canvas.width = this.tileWidth || DEMO_TILE_SIZE;
            canvas.height = this.tileHeight || DEMO_TILE_SIZE;

            const ctx = canvas.getContext("2d");
            const hue = (x * 67 + y * 37 + level * 29) % 360;

            ctx.fillStyle = `hsl(${hue}, 65%, 78%)`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = `hsl(${hue}, 70%, 62%)`;
            ctx.fillRect(0, 0, canvas.width, 28);
            ctx.fillRect(0, 0, 28, canvas.height);

            ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

            ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
            ctx.lineWidth = 1;
            for (let i = 32; i < canvas.width; i += 32) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i, canvas.height);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(0, i);
                ctx.lineTo(canvas.width, i);
                ctx.stroke();
            }

            ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
            ctx.font = "bold 20px system-ui, sans-serif";
            ctx.textBaseline = "top";
            ctx.fillText(`L${level} / ${x},${y}`, 40, 42);

            ctx.font = "13px system-ui, sans-serif";
            ctx.fillText(label, 40, 72);

            return canvas;
        }
    }

    $.DiagnosticDemoTileSource = DiagnosticDemoTileSource;
}

function createSyntheticSecurityError() {
    if (typeof DOMException === "function") {
        return new DOMException(
            "The canvas has been tainted by cross-origin data.",
            "SecurityError"
        );
    }

    const error = new Error("The canvas has been tainted by cross-origin data.");
    error.name = "SecurityError";
    error.code = 18;
    return error;
}

function createDemoTileSourceOptions() {
    const settings = getDiagnosticSettingsFromControls();

    return {
        ...DEMO_SOURCE_OPTIONS,
        diagnosticScenario: settings.scenario,
        failurePattern: settings.failurePattern,
        failureReason: settings.failureReason
    };
}

function getDiagnosticSettingsFromControls() {
    const scenarioSelect = document.getElementById("diagnostic-scenario-select");
    const patternSelect = document.getElementById("failure-pattern-select");
    const reasonSelect = document.getElementById("failure-reason-select");

    const scenario = scenarioSelect ? scenarioSelect.value : DEMO_SOURCE_OPTIONS.diagnosticScenario;
    const preset = DIAGNOSTIC_SCENARIOS[scenario] || DIAGNOSTIC_SCENARIOS["custom"];

    return {
        scenario: scenario,
        failurePattern: patternSelect ? patternSelect.value : preset.failurePattern,
        failureReason: reasonSelect ? reasonSelect.value : preset.failureReason
    };
}

function applyScenarioPresetToControls(scenario) {
    const patternSelect = document.getElementById("failure-pattern-select");
    const reasonSelect = document.getElementById("failure-reason-select");
    const preset = DIAGNOSTIC_SCENARIOS[scenario] || DIAGNOSTIC_SCENARIOS["custom"];

    if (patternSelect) {
        patternSelect.value = preset.failurePattern === "mixed" ? "none" : preset.failurePattern;
    }

    if (reasonSelect) {
        reasonSelect.value = preset.failureReason === "mixed" ? "invalid-data" : preset.failureReason;
    }
}

function reloadDemoSource() {
    viewer.close();

    viewer.addTiledImage({
        tileSource: createDemoTileSourceOptions(),
        success: () => {
            applyShaderLayerGuiConfig();
            writeDiagnosticsState();
            viewer.viewport.goHome(true);
        }
    });
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
            Drag layers to reorder them. Toggle visibility, mode, blend, type, and image source
            to verify that first-pass tile diagnostics still compose through normal shader layers.
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
    const options = OpenSeadragon.FlexRenderer.ShaderLayerRegistry
        .availableShaderLayers()
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
    const Shader = OpenSeadragon.FlexRenderer.ShaderLayerRegistry.get(type);

    if (!Shader || typeof Shader.sources !== "function") {
        return true;
    }

    return (Shader.sources() || []).length > 0;
}

function applyShaderLayerGuiConfig() {
    if (!viewer.drawer || typeof viewer.drawer.overrideConfigureAll !== "function") {
        return;
    }

    viewer.drawer.overrideConfigureAll(shaderLayerConfig, shaderLayerOrder);
}

function setupDiagnosticsPanel() {
    const renderDiagnosticsToggle = document.getElementById("render-diagnostics-toggle");
    const scenarioSelect = document.getElementById("diagnostic-scenario-select");
    const patternSelect = document.getElementById("failure-pattern-select");
    const reasonSelect = document.getElementById("failure-reason-select");
    const reloadSourceButton = document.getElementById("reload-source-button");

    const syncControls = () => {
        const renderer = viewer.drawer && viewer.drawer.renderer;

        if (renderDiagnosticsToggle && renderer && typeof renderer.getRenderDiagnostics === "function") {
            renderDiagnosticsToggle.checked = renderer.getRenderDiagnostics();
        }

        writeDiagnosticsState();
    };

    if (renderDiagnosticsToggle) {
        renderDiagnosticsToggle.addEventListener("change", () => {
            const renderer = viewer.drawer && viewer.drawer.renderer;

            if (renderer && typeof renderer.setRenderDiagnostics === "function") {
                renderer.setRenderDiagnostics(renderDiagnosticsToggle.checked);
            }

            syncControls();
        });
    }

    if (scenarioSelect) {
        scenarioSelect.value = DEMO_SOURCE_OPTIONS.diagnosticScenario;
        applyScenarioPresetToControls(scenarioSelect.value);

        scenarioSelect.addEventListener("change", () => {
            applyScenarioPresetToControls(scenarioSelect.value);
            reloadDemoSource();
            syncControls();
        });
    }

    if (patternSelect) {
        patternSelect.addEventListener("change", () => {
            if (scenarioSelect) {
                scenarioSelect.value = "custom";
            }

            reloadDemoSource();
            syncControls();
        });
    }

    if (reasonSelect) {
        reasonSelect.addEventListener("change", () => {
            if (scenarioSelect) {
                scenarioSelect.value = "custom";
            }

            reloadDemoSource();
            syncControls();
        });
    }

    if (reloadSourceButton) {
        reloadSourceButton.addEventListener("click", () => {
            reloadDemoSource();
            syncControls();
        });
    }

    syncControls();
}

function setupDiagnosticsChecksPanel() {
    const button = document.getElementById("run-diagnostics-checks-button");

    if (!button) {
        return;
    }

    button.addEventListener("click", async () => {
        button.disabled = true;

        try {
            await runDiagnosticsChecks();
        } finally {
            button.disabled = false;
        }
    });
}

async function runDiagnosticsChecks() {
    const output = document.getElementById("diagnostics-checks-output");
    const drawer = viewer && viewer.drawer;
    const renderer = drawer && drawer.renderer;
    const checks = [];

    if (output) {
        output.textContent = "Running diagnostics checks...\n";
    }

    const record = async (name, run) => {
        try {
            await run();
            checks.push({
                name,
                ok: true
            });
        } catch (error) {
            checks.push({
                name,
                ok: false,
                error: error && error.message ? error.message : String(error)
            });
        }

        writeDiagnosticsChecksText(checks);
    };

    await record("renderer exposes tile preparation APIs", () => {
        assertFunction(renderer, "prepareBitmapTile");
        assertFunction(renderer, "prepareGpuTextureTile");
        assertFunction(renderer, "prepareVectorTile");
        assertFunction(renderer, "releasePreparedTileResource");
    });

    await record("gpuTextureSet unsupported payload returns unsupported-data", async () => {
        const result = await renderer.prepareGpuTextureTile({
            data: "not-a-gpu-texture-set"
        });

        assertPreparationFailure(result, "unsupported-data");
    });

    await record("bitmap invalid payload returns invalid-data or unsupported-data", async () => {
        const result = await renderer.prepareBitmapTile({
            data: {
                invalid: true,
                reason: "diagnostics-demo-invalid-bitmap"
            }
        });

        if (!result || result.ok !== false) {
            throw new Error("Expected bitmap preparation to fail.");
        }

        if (result.reason !== "invalid-data" && result.reason !== "unsupported-data") {
            throw new Error(`Expected invalid-data or unsupported-data, got '${result.reason}'.`);
        }
    });

    await record("drawer preserves invalid-data preparation reason", async () => {
        await assertDrawerPreparationFailureReason(drawer, renderer, "invalid-data");
    });

    await record("drawer preserves tainted-data preparation reason", async () => {
        await assertDrawerPreparationFailureReason(drawer, renderer, "tainted-data");
    });

    await record("drawer preserves unsupported-data preparation reason", async () => {
        await assertDrawerPreparationFailureReason(drawer, renderer, "unsupported-data");
    });

    await record("drawer preserves webgl-upload-failed preparation reason", async () => {
        await assertDrawerPreparationFailureReason(drawer, renderer, "webgl-upload-failed");
    });

    await record("drawer taint preflight returns tainted-data without renderer upload", async () => {
        await assertDrawerTaintPreflight(drawer, renderer);
    });

    await record("internalCacheFree releases backend-owned resources through renderer", () => {
        assertDrawerResourceRelease(drawer, renderer);
    });
}

function assertFunction(owner, name) {
    if (!owner || typeof owner[name] !== "function") {
        throw new Error(`Expected ${name}() to exist.`);
    }
}

function assertPreparationFailure(result, expectedReason) {
    if (!result || result.ok !== false) {
        throw new Error("Expected a failed preparation result.");
    }

    if (result.reason !== expectedReason) {
        throw new Error(`Expected reason '${expectedReason}', got '${result.reason}'.`);
    }
}

function assertDiagnosticTileInfo(tileInfo, expectedReason) {
    if (!tileInfo || tileInfo.__flexDiagnostic !== true) {
        throw new Error("Expected a diagnostic tile sentinel.");
    }

    if (tileInfo.reason !== expectedReason) {
        throw new Error(`Expected diagnostic reason '${expectedReason}', got '${tileInfo.reason}'.`);
    }
}

async function assertDrawerPreparationFailureReason(drawer, renderer, reason) {
    const originalPrepareBitmapTile = renderer.prepareBitmapTile;
    const canvas = createDiagnosticsCheckCanvas();

    renderer.prepareBitmapTile = async () => ({
        ok: false,
        reason,
        error: new Error(`Synthetic ${reason} failure`)
    });

    try {
        const tileInfo = await drawer.createTileInfoFromSource({
            data: canvas,
            type: "image",
            tile: {},
            tiledImage: {}
        });

        assertDiagnosticTileInfo(tileInfo, reason);
    } finally {
        renderer.prepareBitmapTile = originalPrepareBitmapTile;
    }
}

async function assertDrawerTaintPreflight(drawer, renderer) {
    const originalPrepareBitmapTile = renderer.prepareBitmapTile;
    const canvas = createSyntheticTaintedDiagnosticsCheckCanvas();
    let prepareCalled = false;

    renderer.prepareBitmapTile = async () => {
        prepareCalled = true;

        return {
            ok: true,
            resource: {},
            texture: {},
            width: 1,
            height: 1,
            textureDepth: 1,
            packCount: 1,
            channelCount: 4
        };
    };

    try {
        const tileInfo = await drawer.createTileInfoFromSource({
            data: canvas,
            type: "image",
            tile: {},
            tiledImage: {}
        });

        assertDiagnosticTileInfo(tileInfo, "tainted-data");

        if (prepareCalled) {
            throw new Error("Expected drawer taint preflight to skip renderer preparation.");
        }
    } finally {
        renderer.prepareBitmapTile = originalPrepareBitmapTile;
    }
}

function assertDrawerResourceRelease(drawer, renderer) {
    const originalRelease = renderer.releasePreparedTileResource;
    const resource = {
        kind: "diagnostics-check-resource"
    };
    const tileInfo = {
        resource,
        texture: {
            kind: "texture-alias"
        },
        vectors: {
            kind: "vector-alias"
        }
    };
    let released = null;

    renderer.releasePreparedTileResource = (received) => {
        released = received;
    };

    try {
        drawer.internalCacheFree(tileInfo);

        if (released !== resource) {
            throw new Error("Expected internalCacheFree() to release the backend-owned resource.");
        }

        if (tileInfo.resource !== null || tileInfo.texture !== null || tileInfo.vectors !== null) {
            throw new Error("Expected internalCacheFree() to clear resource, texture, and vectors.");
        }
    } finally {
        renderer.releasePreparedTileResource = originalRelease;
    }
}

function createDiagnosticsCheckCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;

    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1, 1);

    return canvas;
}

function createSyntheticTaintedDiagnosticsCheckCanvas() {
    const canvas = createDiagnosticsCheckCanvas();
    const originalGetContext = canvas.getContext.bind(canvas);
    let taintedContext = null;

    canvas.getContext = function(type, ...args) {
        const context = originalGetContext(type, ...args);

        if (type !== "2d" || !context || typeof context.getImageData !== "function") {
            return context;
        }

        if (!taintedContext) {
            taintedContext = new Proxy(context, {
                get(target, property) {
                    if (property === "getImageData") {
                        return function() {
                            throw createSyntheticSecurityError();
                        };
                    }

                    const value = target[property];

                    return typeof value === "function" ? value.bind(target) : value;
                }
            });
        }

        return taintedContext;
    };

    return canvas;
}

function writeDiagnosticsState() {
    const renderer = viewer.drawer && viewer.drawer.renderer;
    const settings = getDiagnosticSettingsFromControls();
    const expectedDiagnostics = describeExpectedDiagnostics(settings);

    writeJson("diagnostics-state-output", {
        renderDiagnostics: renderer && typeof renderer.getRenderDiagnostics === "function" ?
            renderer.getRenderDiagnostics() :
            null,
        scenario: settings.scenario,
        failurePattern: settings.failurePattern,
        failureReason: settings.failureReason,
        expectedReasons: Array.from(new Set(expectedDiagnostics.map((item) => item.reason))),
        expectedDiagnosticSource: "renderer preparation failure converted to diagnostic sentinel",
        expectedDiagnosticsAtMaxLevel: expectedDiagnostics,
        note: settings.scenario === "mixed-reasons" ?
            "Mixed scenario uses fixed tiles for invalid-data, tainted-data, and unsupported-data." :
            "Custom controls apply one reason across the selected pattern."
    });
}

function writeDiagnosticsChecksText(checks) {
    const output = document.getElementById("diagnostics-checks-output");

    if (!output) {
        return;
    }

    const passed = checks.filter((check) => check.ok).length;
    const failed = checks.length - passed;
    const lines = [];

    lines.push(`Diagnostics checks: ${passed}/${checks.length} passed`);
    lines.push(`Failed: ${failed}`);
    lines.push("");

    for (const check of checks) {
        lines.push(`${check.ok ? "[PASS]" : "[FAIL]"} ${check.name}`);

        if (!check.ok && check.error) {
            lines.push(`       ${check.error}`);
        }
    }

    output.textContent = lines.join("\n");
    output.scrollTop = output.scrollHeight;
}

function describeExpectedDiagnostics(settings) {
    if (settings.scenario === "mixed-reasons") {
        return [
            { tile: "L2 / 0,0", reason: "invalid-data" },
            { tile: "L2 / 1,1", reason: "tainted-data" },
            { tile: "L2 / 2,2", reason: "unsupported-data" }
        ];
    }

    return describePatternTiles(settings.failurePattern).map((tile) => ({
        tile,
        reason: settings.failureReason
    }));
}

function describePatternTiles(pattern) {
    if (pattern === "none") {
        return [];
    }

    if (pattern === "center") {
        return ["L2 / 1,1"];
    }

    if (pattern === "diagonal") {
        return ["L2 / 0,0", "L2 / 1,1", "L2 / 2,2", "L2 / 3,3"];
    }

    if (pattern === "checker") {
        return [
            "L2 / 0,0",
            "L2 / 2,0",
            "L2 / 1,1",
            "L2 / 3,1",
            "L2 / 0,2",
            "L2 / 2,2",
            "L2 / 1,3",
            "L2 / 3,3"
        ];
    }

    return [];
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

viewer.addHandler("open", () => {
    applyShaderLayerGuiConfig();
    renderShaderConfigPanel();
    setupDiagnosticsPanel();
    setupDiagnosticsChecksPanel();
});

viewer.addTiledImage({
    tileSource: createDemoTileSourceOptions()
});

renderShaderConfigPanel();
setupDiagnosticsPanel();
setupDiagnosticsChecksPanel();
