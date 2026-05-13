const RENDER_WIDTH = 320;
const RENDER_HEIGHT = 180;

const state = {
    sharedA: null,
    sharedB: null,
    privateRenderer: null,
    lastAction: "No action yet."
};

$("#title-w").html("FlexRenderer shared-context validation demo");

document.getElementById("create-renderers-button").addEventListener("click", () => {
    createRenderers();
});

document.getElementById("destroy-renderers-button").addEventListener("click", () => {
    destroyRenderers();
    writeState("Destroyed all demo renderers.");
});

document.getElementById("run-clear-check-button").addEventListener("click", () => {
    runClearCheck();
});

document.getElementById("run-busy-check-button").addEventListener("click", () => {
    runBusyCheck();
});

window.addEventListener("beforeunload", () => {
    destroyRenderers();
});

createRenderers();

function createRenderers() {
    destroyRenderers();

    const key = getSharedContextKey();
    const rendererBBusyPolicy = document.getElementById("throw-policy-toggle").checked ? "throw" : "warn-skip";

    state.sharedA = createRenderer({
        uniqueId: "shared_context_demo_a",
        sharedContextKey: key,
        sharedContextBusyPolicy: "warn-skip"
    });

    state.sharedB = createRenderer({
        uniqueId: "shared_context_demo_b",
        sharedContextKey: key,
        sharedContextBusyPolicy: rendererBBusyPolicy
    });

    state.privateRenderer = createRenderer({
        uniqueId: "shared_context_demo_private",
        sharedContextKey: null,
        sharedContextBusyPolicy: "warn-skip"
    });

    paintPresentationCanvas(state.sharedA, "Shared A", "#dbeafe", "#1d4ed8");
    paintPresentationCanvas(state.sharedB, "Shared B", "#dcfce7", "#15803d");
    paintPrivatePreview();

    writeState(`Created renderers with shared key '${key}'.`);
}

function createRenderer({
                            uniqueId,
                            sharedContextKey,
                            sharedContextBusyPolicy
                        }) {
    const renderer = new OpenSeadragon.FlexRenderer({
        uniqueId,
        webGLPreferredVersion: "2.0",
        sharedContextKey,
        sharedContextBusyPolicy,
        debug: false,
        interactive: false,
        backgroundColor: "#00000000",
        canvasOptions: {
            stencil: true
        },
        redrawCallback: () => {},
        refetchCallback: () => {}
    });

    renderer.setDataBlendingEnabled(true);
    renderer.setDimensions(0, 0, RENDER_WIDTH, RENDER_HEIGHT, 1, 1);

    return renderer;
}

function destroyRenderers() {
    for (const key of ["sharedA", "sharedB", "privateRenderer"]) {
        if (state[key]) {
            try {
                state[key].destroy();
            } catch (error) {
                console.warn(`Failed to destroy ${key}.`, error);
            }

            state[key] = null;
        }
    }
}

function runClearCheck() {
    if (!ensureRenderers()) {
        return;
    }

    paintPresentationCanvas(state.sharedA, "Shared A before clear", "#dbeafe", "#1d4ed8");
    paintPresentationCanvas(state.sharedB, "Shared B should survive", "#dcfce7", "#15803d");

    const before = {
        sharedAAlpha: readPresentationAlphaSum(state.sharedA),
        sharedBAlpha: readPresentationAlphaSum(state.sharedB)
    };

    state.sharedA.clear();

    const after = {
        sharedAAlpha: readPresentationAlphaSum(state.sharedA),
        sharedBAlpha: readPresentationAlphaSum(state.sharedB)
    };

    copyPresentationToPreview(state.sharedA, "preview-shared-a");
    copyPresentationToPreview(state.sharedB, "preview-shared-b");

    writeState("Ran clear check.", {
        before,
        after,
        passed: before.sharedAAlpha > 0 &&
            before.sharedBAlpha > 0 &&
            after.sharedAAlpha === 0 &&
            after.sharedBAlpha > 0
    });
}

function runBusyCheck() {
    if (!ensureRenderers()) {
        return;
    }

    const key = getSharedContextKey();
    const entry = OpenSeadragon.FlexRenderer._sharedContexts &&
        OpenSeadragon.FlexRenderer._sharedContexts.get(key);

    if (!entry) {
        writeState(`No shared context entry found for '${key}'.`);
        return;
    }

    const beforeBusySkipCount = entry.busySkipCount || 0;
    const beforeWarningCount = state.sharedB._warningCounts["shared-context-busy-render-skip"] || 0;

    entry.busy = true;
    entry.activeRenderer = state.sharedA;

    let threw = false;
    let errorMessage = null;

    try {
        state.sharedB.render({
            firstPass: [],
            secondPass: []
        });
    } catch (error) {
        threw = true;
        errorMessage = error.message;
    } finally {
        entry.busy = false;
        entry.activeRenderer = null;
    }

    const afterBusySkipCount = entry.busySkipCount || 0;
    const afterWarningCount = state.sharedB._warningCounts["shared-context-busy-render-skip"] || 0;
    const throwPolicy = state.sharedB._sharedContextBusyPolicy === "throw";

    writeState("Ran busy check.", {
        throwPolicy,
        threw,
        errorMessage,
        beforeBusySkipCount,
        afterBusySkipCount,
        beforeWarningCount,
        afterWarningCount,
        passed: throwPolicy ?
            threw :
            !threw && afterBusySkipCount === beforeBusySkipCount + 1
    });
}

function ensureRenderers() {
    if (state.sharedA && state.sharedB && state.privateRenderer) {
        return true;
    }

    writeState("Create renderers first.");
    return false;
}

function getSharedContextKey() {
    const input = document.getElementById("shared-context-key-input");
    const value = input ? input.value.trim() : "";

    return value || "demo-shared-context";
}

function paintPresentationCanvas(renderer, label, background, foreground) {
    const canvas = renderer.getPresentationCanvas();
    canvas.width = RENDER_WIDTH;
    canvas.height = RENDER_HEIGHT;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
        return false;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = foreground;
    ctx.fillRect(0, 0, canvas.width, 32);
    ctx.fillRect(0, 0, 32, canvas.height);

    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(label, 44, 48);

    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(`presentation: ${canvas.width} x ${canvas.height}`, 44, 78);

    copyPresentationToPreview(renderer, renderer === state.sharedA ? "preview-shared-a" : "preview-shared-b");

    return true;
}

function paintPrivatePreview() {
    const canvas = document.getElementById("preview-private");
    const ctx = canvas.getContext("2d");

    canvas.width = RENDER_WIDTH;
    canvas.height = RENDER_HEIGHT;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#374151";
    ctx.fillRect(0, 0, canvas.width, 32);
    ctx.fillRect(0, 0, 32, canvas.height);

    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textBaseline = "top";

    const aliases = state.privateRenderer &&
        state.privateRenderer.getPresentationCanvas() === state.privateRenderer.getWebGLCanvas();

    ctx.fillText("Private Renderer", 44, 48);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(`presentation === webGL: ${aliases}`, 44, 78);
}

function copyPresentationToPreview(renderer, previewId) {
    const source = renderer.getPresentationCanvas();
    const preview = document.getElementById(previewId);
    const ctx = preview.getContext("2d");

    preview.width = source.width || RENDER_WIDTH;
    preview.height = source.height || RENDER_HEIGHT;

    ctx.clearRect(0, 0, preview.width, preview.height);

    if (source.width && source.height) {
        ctx.drawImage(source, 0, 0);
    }
}

function readPresentationAlphaSum(renderer) {
    const canvas = renderer.getPresentationCanvas();
    const ctx = canvas.getContext("2d");

    if (!ctx || !canvas.width || !canvas.height) {
        return -1;
    }

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let alpha = 0;

    for (let i = 3; i < data.length; i += 4) {
        alpha += data[i];
    }

    return alpha;
}

function writeState(action, details = undefined) {
    state.lastAction = action;

    writeJson("action-output", {
        action,
        details: details || null
    });

    writeJson("shared-context-status-output", getSharedContextStatusForDisplay());
    writeJson("identity-output", getIdentityChecks());
    writeJson("dimensions-output", getDimensionsForDisplay());
    renderChecks(details);
}

function getSharedContextStatusForDisplay() {
    if (!OpenSeadragon.FlexRenderer.getSharedContextStatus) {
        return {
            error: "OpenSeadragon.FlexRenderer.getSharedContextStatus() is not available."
        };
    }

    return OpenSeadragon.FlexRenderer.getSharedContextStatus();
}

function getIdentityChecks() {
    const a = state.sharedA;
    const b = state.sharedB;
    const p = state.privateRenderer;

    if (!a || !b || !p) {
        return {
            ready: false
        };
    }

    return {
        ready: true,
        sharedWebGLCanvasSame: a.getWebGLCanvas() === b.getWebGLCanvas(),
        sharedPresentationCanvasDifferent: a.getPresentationCanvas() !== b.getPresentationCanvas(),
        sharedAPresentationDifferentFromWebGL: a.getPresentationCanvas() !== a.getWebGLCanvas(),
        sharedBPresentationDifferentFromWebGL: b.getPresentationCanvas() !== b.getWebGLCanvas(),
        privatePresentationSameAsWebGL: p.getPresentationCanvas() === p.getWebGLCanvas()
    };
}

function getDimensionsForDisplay() {
    return {
        sharedA: state.sharedA ? state.sharedA.getRenderDimensions() : null,
        sharedB: state.sharedB ? state.sharedB.getRenderDimensions() : null,
        privateRenderer: state.privateRenderer ? state.privateRenderer.getRenderDimensions() : null
    };
}

function renderChecks(details = undefined) {
    const list = document.getElementById("checks-list");
    const identity = getIdentityChecks();
    const status = getSharedContextStatusForDisplay();
    const sharedEntry = Array.isArray(status) ?
        status.find(entry => entry.key === getSharedContextKey()) :
        null;

    const checks = [];

    checks.push({
        label: "Shared context diagnostic API is available",
        pass: Array.isArray(status)
    });

    checks.push({
        label: "Shared context entry exists",
        pass: !!sharedEntry
    });

    checks.push({
        label: "Shared context refCount is 2",
        pass: !!sharedEntry && sharedEntry.refCount === 2
    });

    checks.push({
        label: "Renderer A and B share the same WebGL canvas",
        pass: !!identity.ready && identity.sharedWebGLCanvasSame
    });

    checks.push({
        label: "Renderer A and B have different presentation canvases",
        pass: !!identity.ready && identity.sharedPresentationCanvasDifferent
    });

    checks.push({
        label: "Shared renderer A presentation canvas differs from WebGL canvas",
        pass: !!identity.ready && identity.sharedAPresentationDifferentFromWebGL
    });

    checks.push({
        label: "Shared renderer B presentation canvas differs from WebGL canvas",
        pass: !!identity.ready && identity.sharedBPresentationDifferentFromWebGL
    });

    checks.push({
        label: "Private renderer presentation canvas equals WebGL canvas",
        pass: !!identity.ready && identity.privatePresentationSameAsWebGL
    });

    if (details && Object.prototype.hasOwnProperty.call(details, "passed")) {
        checks.push({
            label: `Latest action passed: ${state.lastAction}`,
            pass: !!details.passed
        });
    }

    list.innerHTML = checks.map(check => `
        <li class="${check.pass ? "validation-pass" : "validation-fail"}">
            ${escapeHtml(check.pass ? "PASS" : "FAIL")} — ${escapeHtml(check.label)}
        </li>
    `).join("");
}

function writeJson(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = JSON.stringify(value, null, 2);
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
