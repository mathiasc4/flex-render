const DEMO_TILE_SIZE = 256;
const DEMO_MAX_LEVEL = 2;
const DEMO_WIDTH = DEMO_TILE_SIZE * 4;
const DEMO_HEIGHT = DEMO_TILE_SIZE * 4;

const state = {
    viewerA: null,
    viewerB: null,
    viewerPrivate: null,
    loaded: {
        sharedA: false,
        sharedB: false,
        privateViewer: false
    },
    clearCheckActive: false,
    lastAction: "No action yet."
};

$("#title-w").html("FlexDrawer shared-context validation demo");

installSharedContextValidationTileSource(OpenSeadragon);

document.getElementById("create-viewers-button").addEventListener("click", () => {
    createViewers();
});

document.getElementById("destroy-viewers-button").addEventListener("click", () => {
    destroyViewers();
    writeState("Destroyed all demo viewers.");
});

document.getElementById("reload-sources-button").addEventListener("click", () => {
    reloadSources();
});

document.getElementById("refresh-state-button").addEventListener("click", () => {
    writeState("Refreshed validation state.");
});

document.getElementById("run-clear-check-button").addEventListener("click", () => {
    runClearCheck();
});

window.addEventListener("beforeunload", () => {
    destroyViewers();
});

createViewers();

function createViewers() {
    destroyViewers();
    resetLoadState();
    state.clearCheckActive = false;

    const key = getSharedContextKey();

    state.viewerA = createViewer({
        id: "viewer-shared-a",
        label: "Shared viewer A",
        variant: "shared-a",
        sharedContextKey: key
    });

    state.viewerB = createViewer({
        id: "viewer-shared-b",
        label: "Shared viewer B",
        variant: "shared-b",
        sharedContextKey: key
    });

    state.viewerPrivate = createViewer({
        id: "viewer-private",
        label: "Private viewer",
        variant: "private",
        sharedContextKey: null
    });

    writeState(`Created OpenSeadragon viewers with shared key '${key}'.`);

    setTimeout(() => {
        writeState(`Created OpenSeadragon viewers with shared key '${key}'.`);
    }, 500);
}

function createViewer({
                          id,
                          label,
                          variant,
                          sharedContextKey
                      }) {
    const loadStateKey = getLoadStateKey(variant);

    const drawerConfig = {
        debug: false,
        webGLPreferredVersion: "2.0",
        backgroundColor: "#00000000"
    };

    if (sharedContextKey) {
        drawerConfig.sharedContextKey = sharedContextKey;
    }

    const viewer = OpenSeadragon({
        id,
        prefixUrl: "../../openseadragon/images/",
        minZoomImageRatio: 0.01,
        maxZoomPixelRatio: 100,
        smoothTileEdgesMinZoom: 1.1,
        crossOriginPolicy: "Anonymous",
        ajaxWithCredentials: false,
        drawer: "flex-renderer",
        drawerOptions: {
            "flex-renderer": drawerConfig
        },
        tileSources: createDemoTileSourceOptions({
            label,
            variant
        }),
        blendTime: 0,
        showNavigator: false,
        visibilityRatio: 0,
        constrainDuringPan: false
    });

    viewer.addHandler("open", () => {
        if (loadStateKey) {
            state.loaded[loadStateKey] = false;
        }

        writeState(`Opened ${label}.`);
    });

    viewer.addHandler("fully-loaded-change", (event) => {
        if (event.fullyLoaded) {
            if (loadStateKey) {
                state.loaded[loadStateKey] = true;
            }

            setTimeout(() => {
                writeState(`Fully loaded ${label}.`);
            }, 50);
        }
    });

    return viewer;
}

function destroyViewers() {
    for (const key of ["viewerA", "viewerB", "viewerPrivate"]) {
        if (state[key]) {
            try {
                state[key].destroy();
            } catch (error) {
                console.warn(`Failed to destroy ${key}.`, error);
            }

            state[key] = null;
        }
    }

    clearElement("viewer-shared-a");
    clearElement("viewer-shared-b");
    clearElement("viewer-private");

    resetLoadState();
    state.clearCheckActive = false;
}

function reloadSources() {
    if (!ensureViewers()) {
        return;
    }

    resetLoadState();
    state.clearCheckActive = false;

    state.viewerA.open(createDemoTileSourceOptions({
        label: "Shared viewer A",
        variant: "shared-a"
    }));

    state.viewerB.open(createDemoTileSourceOptions({
        label: "Shared viewer B",
        variant: "shared-b"
    }));

    state.viewerPrivate.open(createDemoTileSourceOptions({
        label: "Private viewer",
        variant: "private"
    }));

    writeState("Reloaded viewer tile sources.");
}

function runClearCheck() {
    if (!ensureViewers()) {
        return;
    }

    const rendererA = getRenderer(state.viewerA);
    const rendererB = getRenderer(state.viewerB);

    if (!rendererA || !rendererB) {
        writeState("Cannot run clear check before shared renderers exist.");
        return;
    }

    const before = {
        sharedAAlpha: readPresentationAlphaSum(rendererA),
        sharedBAlpha: readPresentationAlphaSum(rendererB)
    };

    rendererA.clear();
    state.clearCheckActive = true;

    const after = {
        sharedAAlpha: readPresentationAlphaSum(rendererA),
        sharedBAlpha: readPresentationAlphaSum(rendererB)
    };

    writeState("Ran clear check: only Shared viewer A should be blank afterward.", {
        before,
        after,
        passed:
            before.sharedAAlpha > 0 &&
            before.sharedBAlpha > 0 &&
            after.sharedAAlpha === 0 &&
            after.sharedBAlpha > 0
    });
}

function ensureViewers() {
    if (state.viewerA && state.viewerB && state.viewerPrivate) {
        return true;
    }

    writeState("Create viewers first.");
    return false;
}

function resetLoadState() {
    state.loaded = {
        sharedA: false,
        sharedB: false,
        privateViewer: false
    };
}

function getLoadStateKey(variant) {
    if (variant === "shared-a") {
        return "sharedA";
    }

    if (variant === "shared-b") {
        return "sharedB";
    }

    if (variant === "private") {
        return "privateViewer";
    }

    return null;
}

function getSharedContextKey() {
    const input = document.getElementById("shared-context-key-input");
    const value = input ? input.value.trim() : "";

    return value || "demo-shared-context";
}

function createDemoTileSourceOptions({
                                         label,
                                         variant
                                     }) {
    return {
        type: "shared-context-validation-demo",
        width: DEMO_WIDTH,
        height: DEMO_HEIGHT,
        tileSize: DEMO_TILE_SIZE,
        tileOverlap: 0,
        minLevel: 0,
        maxLevel: DEMO_MAX_LEVEL,
        label,
        variant
    };
}

function installSharedContextValidationTileSource($) {
    if ($.SharedContextValidationTileSource) {
        return;
    }

    class SharedContextValidationTileSource extends $.TileSource {
        supports(data, url) {
            return !!(
                data && typeof data === "object" &&
                data.type === "shared-context-validation-demo"
            ) || !!(
                url && typeof url === "object" &&
                url.type === "shared-context-validation-demo"
            );
        }

        configure(options) {
            const tileSize = Number(options.tileSize) || DEMO_TILE_SIZE;

            this.label = options.label || "Shared Context Demo";
            this.variant = options.variant || "shared-a";
            this.tileSize = tileSize;
            this.tileWidth = tileSize;
            this.tileHeight = tileSize;
            this.minLevel = Number.isFinite(Number(options.minLevel)) ? Number(options.minLevel) : 0;
            this.maxLevel = Number.isFinite(Number(options.maxLevel)) ? Number(options.maxLevel) : DEMO_MAX_LEVEL;

            return $.extend(options, {
                width: Number(options.width) || DEMO_WIDTH,
                height: Number(options.height) || DEMO_HEIGHT,
                tileSize,
                tileOverlap: Number(options.tileOverlap) || 0,
                minLevel: this.minLevel,
                maxLevel: this.maxLevel
            });
        }

        getTileUrl(level, x, y) {
            return [
                "shared-context-validation-demo",
                this.variant,
                level,
                x,
                y
            ].join(":");
        }

        downloadTileStart(context) {
            const coords = this._parseTileCoordinates(context);

            context.finish(
                this._createTileCanvas(coords.level, coords.x, coords.y),
                undefined,
                "image"
            );
        }

        getMetadata() {
            return {
                type: "shared-context-validation-demo",
                width: this.width,
                height: this.height,
                tileSize: this.tileSize,
                label: this.label,
                variant: this.variant
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

            const match = /shared-context-validation-demo:([^:]+):(\d+):(\d+):(\d+)/.exec(src);

            if (match) {
                return {
                    variant: match[1],
                    level: Number(match[2]),
                    x: Number(match[3]),
                    y: Number(match[4])
                };
            }

            const tile = context.tile || {};
            return {
                variant: this.variant,
                level: Number(tile.level) || this.maxLevel,
                x: Number(tile.x) || 0,
                y: Number(tile.y) || 0
            };
        }

        _createTileCanvas(level, x, y) {
            const canvas = document.createElement("canvas");
            canvas.width = this.tileWidth || DEMO_TILE_SIZE;
            canvas.height = this.tileHeight || DEMO_TILE_SIZE;

            const ctx = canvas.getContext("2d");
            const baseHue = this._variantHue();
            const hue = (baseHue + x * 37 + y * 67 + level * 19) % 360;

            ctx.fillStyle = `hsl(${hue}, 62%, 78%)`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = `hsl(${hue}, 72%, 58%)`;
            ctx.fillRect(0, 0, canvas.width, 30);
            ctx.fillRect(0, 0, 30, canvas.height);

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
            ctx.font = "bold 18px system-ui, sans-serif";
            ctx.textBaseline = "top";
            ctx.fillText(this.label, 40, 42);

            ctx.font = "13px system-ui, sans-serif";
            ctx.fillText(`variant: ${this.variant}`, 40, 70);
            ctx.fillText(`tile: L${level} / ${x},${y}`, 40, 90);

            return canvas;
        }

        _variantHue() {
            if (this.variant === "shared-a") {
                return 215;
            }

            if (this.variant === "shared-b") {
                return 135;
            }

            return 0;
        }
    }

    $.SharedContextValidationTileSource = SharedContextValidationTileSource;
}

function getRenderer(viewer) {
    return viewer && viewer.drawer && viewer.drawer.renderer ?
        viewer.drawer.renderer :
        null;
}

function getSharedContextStatusForDisplay() {
    if (!OpenSeadragon.FlexRenderer.getSharedContextStatus) {
        return {
            error: "OpenSeadragon.FlexRenderer.getSharedContextStatus() is not available."
        };
    }

    return OpenSeadragon.FlexRenderer.getSharedContextStatus();
}

function getSharedEntry() {
    const status = getSharedContextStatusForDisplay();

    if (!Array.isArray(status)) {
        return null;
    }

    return status.find(entry => entry.key === getSharedContextKey()) || null;
}

function getIdentityChecks() {
    const rendererA = getRenderer(state.viewerA);
    const rendererB = getRenderer(state.viewerB);
    const rendererPrivate = getRenderer(state.viewerPrivate);

    if (!rendererA || !rendererB || !rendererPrivate) {
        return {
            ready: false
        };
    }

    const sharedAIsShared = typeof rendererA.isSharedContext === "function" && rendererA.isSharedContext();
    const sharedBIsShared = typeof rendererB.isSharedContext === "function" && rendererB.isSharedContext();
    const privateIsShared = typeof rendererPrivate.isSharedContext === "function" && rendererPrivate.isSharedContext();

    return {
        ready: true,

        sharedAIsShared,
        sharedBIsShared,
        privateIsShared,

        sharedWebGLCanvasSame: rendererA.getWebGLCanvas() === rendererB.getWebGLCanvas(),
        sharedPresentationCanvasDifferent: rendererA.getPresentationCanvas() !== rendererB.getPresentationCanvas(),

        sharedAPresentationDifferentFromWebGL: rendererA.getPresentationCanvas() !== rendererA.getWebGLCanvas(),
        sharedBPresentationDifferentFromWebGL: rendererB.getPresentationCanvas() !== rendererB.getWebGLCanvas(),

        privatePresentationSameAsWebGL: rendererPrivate.getPresentationCanvas() === rendererPrivate.getWebGLCanvas(),

        drawerACanvasIsPresentation: state.viewerA.drawer.canvas === rendererA.getPresentationCanvas(),
        drawerBCanvasIsPresentation: state.viewerB.drawer.canvas === rendererB.getPresentationCanvas(),
        drawerPrivateCanvasIsPresentation: state.viewerPrivate.drawer.canvas === rendererPrivate.getPresentationCanvas()
    };
}

function getDimensionsForDisplay() {
    const rendererA = getRenderer(state.viewerA);
    const rendererB = getRenderer(state.viewerB);
    const rendererPrivate = getRenderer(state.viewerPrivate);

    return {
        sharedA: rendererA ? rendererA.getRenderDimensions() : null,
        sharedB: rendererB ? rendererB.getRenderDimensions() : null,
        privateRenderer: rendererPrivate ? rendererPrivate.getRenderDimensions() : null
    };
}

function getRendererEntries() {
    return [
        {
            key: "sharedA",
            label: "Shared viewer A",
            renderer: getRenderer(state.viewerA)
        },
        {
            key: "sharedB",
            label: "Shared viewer B",
            renderer: getRenderer(state.viewerB)
        },
        {
            key: "privateViewer",
            label: "Private viewer",
            renderer: getRenderer(state.viewerPrivate)
        }
    ];
}

function getWebGLContextUsageForDisplay() {
    const entries = getRendererEntries();
    const contextLabels = [];
    const contexts = [];

    for (const entry of entries) {
        const renderer = entry.renderer;
        const gl = renderer && renderer.gl ? renderer.gl : null;

        if (!gl) {
            contextLabels.push({
                renderer: entry.label,
                contextIndex: null,
                sharedContext: null
            });
            continue;
        }

        let contextIndex = contexts.indexOf(gl);

        if (contextIndex === -1) {
            contexts.push(gl);
            contextIndex = contexts.length - 1;
        }

        contextLabels.push({
            renderer: entry.label,
            contextIndex: contextIndex + 1,
            sharedContext: !!(
                renderer &&
                typeof renderer.isSharedContext === "function" &&
                renderer.isSharedContext()
            )
        });
    }

    return {
        ready: entries.every(entry => !!(entry.renderer && entry.renderer.gl)),
        rendererCount: entries.filter(entry => !!entry.renderer).length,
        webGLContextCount: contexts.length,
        expectedWebGLContextCount: 2,
        expected: "Shared viewer A and B reuse context #1; private viewer uses context #2.",
        passed: contexts.length === 2 &&
            contextLabels.length === 3 &&
            contextLabels[0].contextIndex === contextLabels[1].contextIndex &&
            contextLabels[2].contextIndex !== contextLabels[0].contextIndex,
        renderers: contextLabels
    };
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

function readDefaultFramebufferAlphaSum(renderer) {
    const canvas = renderer && renderer.getWebGLCanvas ? renderer.getWebGLCanvas() : null;
    const gl = renderer && renderer.gl;

    if (!gl || !canvas || !canvas.width || !canvas.height) {
        return -1;
    }

    const pixels = new Uint8Array(canvas.width * canvas.height * 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.finish();
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let alpha = 0;

    for (let i = 3; i < pixels.length; i += 4) {
        alpha += pixels[i];
    }

    return alpha;
}

function readRendererVisibleAlphaSum(renderer) {
    if (!renderer) {
        return -1;
    }

    if (typeof renderer.isSharedContext === "function" && renderer.isSharedContext()) {
        return readPresentationAlphaSum(renderer);
    }

    return readDefaultFramebufferAlphaSum(renderer);
}

function getPresentationOutputForDisplay() {
    const rendererA = getRenderer(state.viewerA);
    const rendererB = getRenderer(state.viewerB);
    const rendererPrivate = getRenderer(state.viewerPrivate);

    const allLoaded =
        !!state.loaded.sharedA &&
        !!state.loaded.sharedB &&
        !!state.loaded.privateViewer;

    const alpha = {
        sharedA: readRendererVisibleAlphaSum(rendererA),
        sharedB: readRendererVisibleAlphaSum(rendererB),
        privateViewer: readRendererVisibleAlphaSum(rendererPrivate)
    };

    const expectsSharedABlank = !!state.clearCheckActive;

    return {
        ready: !!rendererA && !!rendererB && !!rendererPrivate,
        loaded: $.extend(true, {}, state.loaded),
        allLoaded: allLoaded,
        expectation: expectsSharedABlank ?
            "after-clear-check: sharedA blank, sharedB visible, private visible" :
            "normal: all viewers visible",
        alpha: alpha,
        checks: {
            sharedA: expectsSharedABlank ?
                alpha.sharedA === 0 :
                alpha.sharedA > 0,
            sharedB: alpha.sharedB > 0,
            privateViewer: alpha.privateViewer > 0
        }
    };
}

function writeState(action, details = undefined) {
    state.lastAction = action;

    const presentationOutput = getPresentationOutputForDisplay();
    const webGLContextUsage = getWebGLContextUsageForDisplay();

    writeJson("action-output", {
        action,
        details: details || null
    });

    writeJson("shared-context-status-output", getSharedContextStatusForDisplay());
    writeJson("identity-output", getIdentityChecks());
    writeJson("webgl-context-output", webGLContextUsage);
    writeJson("presentation-output", presentationOutput);
    writeJson("dimensions-output", getDimensionsForDisplay());

    renderChecks(details, presentationOutput, webGLContextUsage);
}

function renderChecks(
    details = undefined,
    presentationOutput = getPresentationOutputForDisplay(),
    webGLContextUsage = getWebGLContextUsageForDisplay()
) {
    const list = document.getElementById("checks-list");
    const identity = getIdentityChecks();
    const status = getSharedContextStatusForDisplay();
    const sharedEntry = getSharedEntry();

    const checks = [];

    checks.push({
        label: "Shared context diagnostic API is available",
        pass: Array.isArray(status)
    });

    checks.push({
        label: "Shared context entry exists for the configured key",
        pass: !!sharedEntry
    });

    checks.push({
        label: "Shared context refCount is 2",
        pass: !!sharedEntry && sharedEntry.refCount === 2
    });

    checks.push({
        label: "Three FlexRenderer instances use exactly two WebGL rendering contexts",
        pass: !!webGLContextUsage.ready && webGLContextUsage.passed
    });

    checks.push({
        label: "Shared viewer A renderer reports shared-context mode",
        pass: !!identity.ready && identity.sharedAIsShared
    });

    checks.push({
        label: "Shared viewer B renderer reports shared-context mode",
        pass: !!identity.ready && identity.sharedBIsShared
    });

    checks.push({
        label: "Private viewer renderer reports private-context mode",
        pass: !!identity.ready && identity.privateIsShared === false
    });

    checks.push({
        label: "Shared viewer A and B use the same WebGL canvas",
        pass: !!identity.ready && identity.sharedWebGLCanvasSame
    });

    checks.push({
        label: "Shared viewer A and B use different presentation canvases",
        pass: !!identity.ready && identity.sharedPresentationCanvasDifferent
    });

    checks.push({
        label: "Shared viewer A presentation canvas differs from WebGL canvas",
        pass: !!identity.ready && identity.sharedAPresentationDifferentFromWebGL
    });

    checks.push({
        label: "Shared viewer B presentation canvas differs from WebGL canvas",
        pass: !!identity.ready && identity.sharedBPresentationDifferentFromWebGL
    });

    checks.push({
        label: "Private viewer presentation canvas equals WebGL canvas",
        pass: !!identity.ready && identity.privatePresentationSameAsWebGL
    });

    checks.push({
        label: "FlexDrawer A uses renderer presentation canvas as drawer canvas",
        pass: !!identity.ready && identity.drawerACanvasIsPresentation
    });

    checks.push({
        label: "FlexDrawer B uses renderer presentation canvas as drawer canvas",
        pass: !!identity.ready && identity.drawerBCanvasIsPresentation
    });

    checks.push({
        label: "Private FlexDrawer uses renderer presentation canvas as drawer canvas",
        pass: !!identity.ready && identity.drawerPrivateCanvasIsPresentation
    });

    if (presentationOutput.ready && presentationOutput.allLoaded) {
        checks.push({
            label: state.clearCheckActive ?
                "Shared viewer A presentation output is blank after clear check" :
                "Shared viewer A presentation output has visible pixels",
            pass: !!presentationOutput.checks.sharedA
        });

        checks.push({
            label: "Shared viewer B presentation output has visible pixels",
            pass: !!presentationOutput.checks.sharedB
        });

        checks.push({
            label: "Private viewer output has visible pixels",
            pass: !!presentationOutput.checks.privateViewer
        });
    } else {
        checks.push({
            label: "Visual output checks are pending until all viewers are fully loaded",
            pending: true
        });
    }

    if (details && Object.prototype.hasOwnProperty.call(details, "passed")) {
        checks.push({
            label: `Latest action passed: ${state.lastAction}`,
            pass: !!details.passed
        });
    }

    list.innerHTML = checks.map(check => {
        const className = check.pending ?
            "validation-neutral" :
            (check.pass ? "validation-pass" : "validation-fail");

        const statusText = check.pending ?
            "PENDING" :
            (check.pass ? "PASS" : "FAIL");

        return `
            <li class="${className}">
                ${escapeHtml(statusText)} — ${escapeHtml(check.label)}
            </li>
        `;
    }).join("");
}

function writeJson(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = JSON.stringify(value, null, 2);
    }
}

function clearElement(id) {
    const element = document.getElementById(id);

    if (element) {
        element.innerHTML = "";
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
