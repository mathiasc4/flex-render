const TEST_VERSION = "2.0";
const SOFTWARE_RENDERER_PATTERN = /(swiftshader|llvmpipe|software rasterizer|warp|mesa x11|softpipe)/i;
const LOW_TEXTURE_BATCH_THRESHOLD = 7;

const drawerOptions = {
    "flex-renderer": {
        debug: false,
        webGLPreferredVersion: TEST_VERSION,
    },
};

const state = {
    viewer: null,
    probeCanvas: null,
    probeGl: null,
    probeVersion: null,
    webgl1Canvas: null,
    webgl1: null,
    webgl2Canvas: null,
    webgl2: null,
    lastResults: null,
};

const dom = {};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

function init() {
    collectDom();
    bindControls();
    createReferenceViewer();
    runChecks();
}

function collectDom() {
    dom.runButton = document.getElementById("compatibility-run-button");
    dom.status = document.getElementById("compatibility-status");
    dom.runDetails = document.getElementById("compatibility-run-details");
    dom.summary = document.getElementById("compatibility-summary");
    dom.results = document.getElementById("compatibility-results");
    dom.raw = document.getElementById("compatibility-raw");
    dom.viewerStatus = document.getElementById("viewer-status");
}

function bindControls() {
    if (dom.runButton) {
        dom.runButton.addEventListener("click", runChecks);
    }
}

function createReferenceViewer() {
    if (!window.OpenSeadragon) {
        setViewerStatus("OpenSeadragon is not available. Reference viewer was not created.", "error");
        return;
    }

    try {
        state.viewer = window.viewer = OpenSeadragon({
            id: "drawer-canvas",
            prefixUrl: "../../openseadragon/images/",
            minZoomImageRatio: 0.01,
            maxZoomPixelRatio: 100,
            minPixelRatio: 1.2,
            smoothTileEdgesMinZoom: 1.1,
            crossOriginPolicy: "Anonymous",
            ajaxWithCredentials: false,
            drawer: "flex-renderer",
            drawerOptions,
            blendTime: 0,
            showNavigator: true,
            viewportMargins: {
                left: 70,
                top: 0,
                right: 70,
                bottom: 0,
            },
        });

        state.viewer.addTiledImage({
            tileSource: "../data/testpattern.dzi",
            success: () => {
                setViewerStatus("Rainbow test pattern loaded with FlexRenderer.", "ok");
            },
            error: (event) => {
                setViewerStatus(`Rainbow test pattern failed to load: ${getEventMessage(event)}`, "error");
            },
        });
    } catch (error) {
        setViewerStatus(`Reference viewer creation failed: ${getErrorMessage(error)}`, "error");
    }
}

function runChecks() {
    setRunning(true);
    setStatus("Running compatibility checks...", "info");

    window.setTimeout(() => {
        const startedAt = Date.now();
        const contextInfo = getContextInfo();
        const gl = contextInfo.gl;
        const results = [];

        results.push(runRendererSelfTest());
        results.push(reportContextCreation(contextInfo));
        results.push(reportLineWidthRange(gl));
        results.push(reportTextureUnits(gl));
        results.push(reportGpuBackend(gl));
        results.push(reportShaderPrecision(gl));
        results.push(reportContextLoss(gl));
        results.push(reportCanvasLimits(gl, contextInfo.version));

        const finishedAt = Date.now();
        const payload = {
            testedAt: new Date(finishedAt).toISOString(),
            elapsedMs: finishedAt - startedAt,
            userAgent: navigator.userAgent,
            devicePixelRatio: window.devicePixelRatio || 1,
            results,
        };

        state.lastResults = payload;
        renderResults(payload);
        setRunning(false);
    }, 0);
}

function getContextInfo() {
    ensureProbeContexts();

    return {
        gl: state.probeGl,
        version: state.probeVersion,
        webgl1Available: !!state.webgl1,
        webgl2Available: !!state.webgl2,
    };
}

function ensureProbeContexts() {
    if (state.probeGl || state.webgl1 || state.webgl2) {
        return;
    }

    state.webgl2Canvas = document.createElement("canvas");
    state.webgl2Canvas.width = 1;
    state.webgl2Canvas.height = 1;
    state.webgl2 = getContext(state.webgl2Canvas, ["webgl2"]);

    state.webgl1Canvas = document.createElement("canvas");
    state.webgl1Canvas.width = 1;
    state.webgl1Canvas.height = 1;
    state.webgl1 = getContext(state.webgl1Canvas, ["webgl", "experimental-webgl"]);

    if (state.webgl2) {
        state.probeCanvas = state.webgl2Canvas;
        state.probeGl = state.webgl2;
        state.probeVersion = "WebGL 2";
    } else if (state.webgl1) {
        state.probeCanvas = state.webgl1Canvas;
        state.probeGl = state.webgl1;
        state.probeVersion = "WebGL 1";
    } else {
        state.probeCanvas = null;
        state.probeGl = null;
        state.probeVersion = "Unavailable";
    }
}

function getContext(canvas, names) {
    for (const name of names) {
        try {
            const gl = canvas.getContext(name, {
                alpha: true,
                stencil: true,
                antialias: false,
                preserveDrawingBuffer: false,
            });

            if (gl) {
                return gl;
            }
        } catch (error) {}
    }

    return null;
}

function runRendererSelfTest() {
    const FlexRenderer = window.OpenSeadragon && window.OpenSeadragon.FlexRenderer;

    if (!FlexRenderer || typeof FlexRenderer.runSelfTest !== "function") {
        return createCheck({
            id: "renderer-self-test",
            title: "Core FlexRenderer runtime rendering self-test",
            status: "error",
            result: "FlexRenderer.runSelfTest is not available in this build.",
            impact: "The demo cannot verify the renderer-specific WebGL path. Confirm that /build/openseadragon/flex-renderer.js loaded successfully.",
        });
    }

    const result = FlexRenderer.runSelfTest({
        width: 2,
        height: 2,
        tolerance: 8,
        webGLPreferredVersion: TEST_VERSION,
        debug: false,
    });

    if (result.ok) {
        return createCheck({
            id: "renderer-self-test",
            title: "Core FlexRenderer runtime rendering self-test",
            status: "ok",
            result: `Passed. Renderer reported ${result.webglVersion || "WebGL"}; test size ${result.width} × ${result.height}; tolerance ${result.tolerance}.`,
            impact: "This browser/GPU completed FlexRenderer's basic shader, texture-array, render, finish, and readback path.",
            data: result,
        });
    }

    return createCheck({
        id: "renderer-self-test",
        title: "Core FlexRenderer runtime rendering self-test",
        status: "error",
        result: `Failed. ${result.error || "Unknown renderer self-test failure."}`,
        impact: "FlexRenderer may not be compatible with this browser, GPU, driver, or WebGL configuration. WebGL2, texture arrays, shader compilation, rendering, or readback may be unavailable or blocked.",
        data: result,
    });
}

function reportContextCreation(contextInfo) {
    const status = contextInfo.webgl2Available ? "ok" : contextInfo.webgl1Available ? "warn" : "error";
    let result;
    let impact;

    if (contextInfo.webgl2Available) {
        result =
            "WebGL2 context creation succeeded. WebGL1 context creation also " +
            (contextInfo.webgl1Available ? "succeeded." : "failed or was unavailable.");
        impact = "The preferred FlexRenderer WebGL2 path can be attempted on this system.";
    } else if (contextInfo.webgl1Available) {
        result = "WebGL2 context creation failed, but WebGL1 context creation succeeded.";
        impact =
            "This build's renderer self-test targets the WebGL2 path. WebGL1-only systems may not support the current renderer features used by the demo.";
    } else {
        result = "Neither WebGL2 nor WebGL1 context creation succeeded.";
        impact =
            "The browser is not exposing WebGL. FlexRenderer cannot run until WebGL/GPU acceleration is available.";
    }

    return createCheck({
        id: "webgl-context",
        title: "WebGL context creation",
        status,
        result,
        impact,
        data: {
            webgl1Available: contextInfo.webgl1Available,
            webgl2Available: contextInfo.webgl2Available,
            probeContext: contextInfo.version,
        },
    });
}

function reportLineWidthRange(gl) {
    if (!gl) {
        return unavailableCheck("native-lines", "Native gl.LINES width range", "No WebGL context is available.");
    }

    const range = toArray(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) || [1, 1]);
    const max = Number(range[1]);
    const status = max > 1 ? "ok" : "warn";

    return createCheck({
        id: "native-lines",
        title: "Native gl.LINES width range",
        status,
        result: `ALIASED_LINE_WIDTH_RANGE = [${formatNumber(range[0])}, ${formatNumber(range[1])}].`,
        impact:
            max > 1
                ? "Native WebGL line primitives report support for widths above 1 px. FlexRenderer native line rendering may use wider requested widths."
                : "Native WebGL line primitives are limited to 1 px. FlexRenderer vector layers should use triangle-based stroke rendering for wider lines.",
        data: {
            aliasedLineWidthRange: range,
        },
    });
}

function reportTextureUnits(gl) {
    if (!gl) {
        return unavailableCheck("texture-units", "Fragment texture-unit capacity", "No WebGL context is available.");
    }

    const units = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    const capacity = Math.max(0, Math.min(units, 32) - 1);
    const status = capacity < LOW_TEXTURE_BATCH_THRESHOLD ? "warn" : "ok";

    return createCheck({
        id: "texture-units",
        title: "Fragment texture-unit capacity",
        status,
        result: `MAX_TEXTURE_IMAGE_UNITS = ${units}; estimated FlexRenderer raster tile batch capacity = ${capacity}.`,
        impact:
            capacity < LOW_TEXTURE_BATCH_THRESHOLD
                ? "Low fragment texture-unit capacity can force more tile draw batches and may reduce rendering throughput when many raster tiles are visible."
                : "The fragment texture-unit count should allow a normal raster tile batch size for this renderer build.",
        data: {
            maxTextureImageUnits: units,
            estimatedRasterTileBatchCapacity: capacity,
        },
    });
}

function reportGpuBackend(gl) {
    if (!gl) {
        return unavailableCheck("gpu-backend", "GPU/backend information", "No WebGL context is available.");
    }

    const extension = gl.getExtension("WEBGL_debug_renderer_info");

    if (!extension) {
        return createCheck({
            id: "gpu-backend",
            title: "GPU/backend information",
            status: "info",
            result: "WEBGL_debug_renderer_info is not exposed by this browser.",
            impact: "Detailed GPU vendor/renderer strings are hidden. This is common and does not by itself indicate incompatibility.",
            data: {
                debugRendererInfoAvailable: false,
            },
        });
    }

    const vendor = gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) || "Unknown vendor";
    const renderer = gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || "Unknown renderer";
    const software = SOFTWARE_RENDERER_PATTERN.test(`${vendor} ${renderer}`);

    return createCheck({
        id: "gpu-backend",
        title: "GPU/backend information",
        status: software ? "warn" : "ok",
        result: `Vendor: ${vendor}; Renderer: ${renderer}.`,
        impact: software
            ? "The renderer string suggests a software or compatibility backend. FlexRenderer may work, but performance and stability may be reduced compared with hardware acceleration."
            : "The renderer string does not match the demo's software-renderer warning list.",
        data: {
            debugRendererInfoAvailable: true,
            vendor,
            renderer,
            softwareRendererDetected: software,
        },
    });
}

function reportShaderPrecision(gl) {
    if (!gl) {
        return unavailableCheck("shader-precision", "Fragment-shader precision", "No WebGL context is available.");
    }

    const high = getPrecision(gl, gl.HIGH_FLOAT);
    const medium = getPrecision(gl, gl.MEDIUM_FLOAT);
    const low = getPrecision(gl, gl.LOW_FLOAT);
    const highMissing = !high || high.precision <= 0;

    return createCheck({
        id: "shader-precision",
        title: "Fragment-shader precision",
        status: highMissing ? "warn" : "ok",
        result: [
            `highp: ${formatPrecision(high)}`,
            `mediump: ${formatPrecision(medium)}`,
            `lowp: ${formatPrecision(low)}`,
        ].join("; "),
        impact: highMissing
            ? "Fragment highp float precision appears unavailable or zero. Custom shader layers may need to avoid high-precision assumptions on this system."
            : "Fragment highp float precision is exposed. FlexRenderer shader layers can use the high-precision declarations used by this build.",
        data: {
            highp: high,
            mediump: medium,
            lowp: low,
        },
    });
}

function getPrecision(gl, precisionType) {
    const value = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, precisionType);

    if (!value) {
        return null;
    }

    return {
        rangeMin: value.rangeMin,
        rangeMax: value.rangeMax,
        precision: value.precision,
    };
}

function reportContextLoss(gl) {
    if (!gl) {
        return unavailableCheck("context-loss", "Context-loss handling support", "No WebGL context is available.");
    }

    const extension = gl.getExtension("WEBGL_lose_context");

    return createCheck({
        id: "context-loss",
        title: "Context-loss handling support",
        status: extension ? "warn" : "info",
        result: extension
            ? "WEBGL_lose_context is available. The demo does not force context loss."
            : "WEBGL_lose_context is not available, so this demo cannot simulate context loss.",
        impact: "This FlexRenderer build can detect WebGL context loss, but automatic GPU resource rebuild after restoration is not supported. If real context loss occurs, recreate the viewer/renderer.",
        data: {
            loseContextExtensionAvailable: !!extension,
            forcedContextLoss: false,
            automaticResourceRebuildSupported: false,
        },
    });
}

function reportCanvasLimits(gl, version) {
    if (!gl) {
        return unavailableCheck("canvas-limits", "Maximum canvas/render-target size", "No WebGL context is available.");
    }

    const viewportDims = toArray(gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [0, 0]);
    const renderbufferSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const textureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const maxSquare = Math.min(viewportDims[0], viewportDims[1], renderbufferSize, textureSize);
    const isWebGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    const max3DTextureSize = isWebGL2 ? Number(gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)) : null;
    const maxArrayTextureLayers = isWebGL2 ? Number(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)) : null;

    return createCheck({
        id: "canvas-limits",
        title: "Maximum canvas/render-target size",
        status: "info",
        result: [
            `Conservative square canvas/render-target limit: ${formatInteger(maxSquare)} × ${formatInteger(maxSquare)} px`,
            `MAX_VIEWPORT_DIMS = [${formatInteger(viewportDims[0])}, ${formatInteger(viewportDims[1])}]`,
            `MAX_RENDERBUFFER_SIZE = ${formatInteger(renderbufferSize)}`,
            `MAX_TEXTURE_SIZE = ${formatInteger(textureSize)}`,
            isWebGL2
                ? `MAX_3D_TEXTURE_SIZE = ${formatInteger(max3DTextureSize)}`
                : `${version} probe does not expose WebGL2 texture-array limits`,
            isWebGL2 ? `MAX_ARRAY_TEXTURE_LAYERS = ${formatInteger(maxArrayTextureLayers)}` : null,
        ]
            .filter(Boolean)
            .join("; "),
        impact: "FlexRenderer canvases and offscreen render targets should stay under this conservative pixel dimension. High-DPI displays increase the backing-store size, so CSS size alone may understate the real canvas size.",
        data: {
            maxViewportDims: viewportDims,
            maxRenderbufferSize: renderbufferSize,
            maxTextureSize: textureSize,
            conservativeMaxSquareCanvasOrRenderTarget: maxSquare,
            max3DTextureSize,
            maxArrayTextureLayers,
        },
    });
}

function unavailableCheck(id, title, reason) {
    return createCheck({
        id,
        title,
        status: "error",
        result: reason,
        impact: "This check cannot run without a WebGL context.",
    });
}

function createCheck({ id, title, status, result, impact, data = null }) {
    return {
        id,
        title,
        status,
        result,
        impact,
        data,
    };
}

function renderResults(payload) {
    const results = payload.results || [];
    const counts = countResults(results);
    const context = results.find((result) => result.id === "webgl-context");

    if (dom.results) {
        dom.results.innerHTML = results.map(renderCheckCard).join("");
    }

    if (dom.summary) {
        dom.summary.innerHTML = renderSummary(counts, context);
    }

    if (dom.raw) {
        dom.raw.value = JSON.stringify(payload, null, 2);
    }

    if (dom.runDetails) {
        dom.runDetails.textContent = `Last run: ${payload.testedAt}; elapsed: ${payload.elapsedMs} ms; devicePixelRatio: ${payload.devicePixelRatio}.`;
    }

    if (counts.error > 0) {
        setStatus(
            `Compatibility checks completed with ${counts.error} error(s) and ${counts.warn} warning(s).`,
            "error",
        );
    } else if (counts.warn > 0) {
        setStatus(`Compatibility checks completed with ${counts.warn} warning(s).`, "warn");
    } else {
        setStatus("Compatibility checks completed without warnings or errors.", "ok");
    }
}

function countResults(results) {
    return results.reduce(
        (acc, result) => {
            if (result.status === "ok") {
                acc.ok++;
            } else if (result.status === "warn") {
                acc.warn++;
            } else if (result.status === "error") {
                acc.error++;
            } else {
                acc.info++;
            }

            return acc;
        },
        { ok: 0, warn: 0, error: 0, info: 0 },
    );
}

function renderSummary(counts, context) {
    const webglLabel =
        context && context.data
            ? `${context.data.webgl2Available ? "WebGL2" : "No WebGL2"} / ${context.data.webgl1Available ? "WebGL1" : "No WebGL1"}`
            : "–";

    return `
        <div class="summary-card">
            <p class="summary-card__label">Passed</p>
            <p class="summary-card__value">${counts.ok}</p>
        </div>
        <div class="summary-card">
            <p class="summary-card__label">Warnings</p>
            <p class="summary-card__value">${counts.warn}</p>
        </div>
        <div class="summary-card">
            <p class="summary-card__label">Errors</p>
            <p class="summary-card__value">${counts.error}</p>
        </div>
    `;
}

function renderCheckCard(result) {
    return `
        <div class="check-card check-card--${escapeHtml(result.status)}">
            <div class="check-card__header">
                <div class="check-card__title">${escapeHtml(result.title)}</div>
                <div class="check-card__badge">${escapeHtml(result.status)}</div>
            </div>
            <p class="check-card__result"><strong>Result:</strong> ${escapeHtml(result.result)}</p>
            <p class="check-card__impact"><strong>Consequence:</strong> ${escapeHtml(result.impact)}</p>
        </div>
    `;
}

function setRunning(running) {
    if (dom.runButton) {
        dom.runButton.disabled = !!running;
        dom.runButton.textContent = running ? "Running checks..." : "Run compatibility checks";
    }
}

function setStatus(message, status = "info") {
    if (!dom.status) {
        return;
    }

    dom.status.textContent = message;
    setStatusClass(dom.status, "toolbar-note", status);
}

function setViewerStatus(message, status = "info") {
    if (!dom.viewerStatus) {
        return;
    }

    dom.viewerStatus.textContent = message;
    setStatusClass(dom.viewerStatus, "viewer-status", status);
}

function setStatusClass(element, baseClass, status) {
    element.className = `${baseClass} ${baseClass}--${status}`;
}

function getEventMessage(event) {
    if (!event) {
        return "unknown error";
    }

    if (event.message) {
        return event.message;
    }

    if (event.error) {
        return getErrorMessage(event.error);
    }

    if (event.source) {
        return String(event.source);
    }

    return String(event);
}

function getErrorMessage(error) {
    return error && error.message ? error.message : String(error);
}

function toArray(value) {
    return Array.prototype.slice.call(value || []);
}

function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return String(value);
    }

    if (Math.abs(number - Math.round(number)) < 0.0001) {
        return String(Math.round(number));
    }

    return number.toFixed(2);
}

function formatInteger(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "unknown";
    }

    return String(Math.round(number));
}

function formatPrecision(value) {
    if (!value) {
        return "unavailable";
    }

    return `range [${value.rangeMin}, ${value.rangeMax}], precision ${value.precision}`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
