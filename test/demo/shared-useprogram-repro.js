(() => {
    "use strict";

    const VIEWER_WIDTH = 320;
    const VIEWER_HEIGHT = 180;
    const RED = [1.0, 0.0, 0.0, 1.0];
    const GREEN = [0.0, 1.0, 0.0, 1.0];

    const dom = {};

    document.addEventListener("DOMContentLoaded", () => {
        dom.canvasA = document.getElementById("viewer-a");
        dom.canvasB = document.getElementById("viewer-b");
        dom.noteA = document.getElementById("viewer-a-note");
        dom.noteB = document.getElementById("viewer-b-note");
        dom.summary = document.getElementById("summary");
        dom.checksBody = document.getElementById("checks-body");

        runWithReset();
    });

    function runWithReset() {
        resetOutput();

        try {
            runRepro();
        } catch (error) {
            failHard(error);
        }
    }

    function runRepro() {
        const osd = window.OpenSeadragon;

        if (!osd) {
            throw new Error("OpenSeadragon is not available. Check ../../openseadragon/openseadragon.js.");
        }

        if (!osd.FlexRenderer) {
            throw new Error("OpenSeadragon.FlexRenderer is not available. Check /build/openseadragon/flex-renderer.js.");
        }

        const FlexRenderer = osd.FlexRenderer;

        if (!FlexRenderer.Program || typeof FlexRenderer.prototype.useProgram !== "function") {
            throw new Error("The loaded FlexRenderer build does not expose Program/useProgram as expected.");
        }

        const methodSource = Function.prototype.toString.call(FlexRenderer.prototype.useProgram);
        const methodLooksPatched = /useProgram\s*\(\s*program\.webGLProgram\s*\)[\s\S]*return\s+false/.test(methodSource);

        const backingCanvas = document.createElement("canvas");
        backingCanvas.width = VIEWER_WIDTH;
        backingCanvas.height = VIEWER_HEIGHT;

        const gl = backingCanvas.getContext("webgl2", {
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        });

        if (!gl) {
            throw new Error("WebGL2 is unavailable in this browser. This repro targets the WebGL2 shared-context path.");
        }

        gl.viewport(0, 0, backingCanvas.width, backingCanvas.height);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.STENCIL_TEST);

        const rawProgramA = createFullscreenProgram(gl, "viewer A");
        const rawProgramB = createFullscreenProgram(gl, "viewer B");
        const programA = makeFlexProgram(FlexRenderer, rawProgramA, "viewer A");
        const programB = makeFlexProgram(FlexRenderer, rawProgramB, "viewer B");

        const ownerA = makeOwner({
            FlexRenderer,
            gl,
            name: "viewer-a",
            rawProgram: rawProgramA,
            program: programA,
            presentationCanvas: dom.canvasA
        });

        const ownerB = makeOwner({
            FlexRenderer,
            gl,
            name: "viewer-b",
            rawProgram: rawProgramB,
            program: programB,
            presentationCanvas: dom.canvasB
        });

        /*
         * Render sequence:
         *
         * 1. Viewer A renders red with the shared backing WebGL context.
         * 2. Viewer B renders green with the same backing context, changing CURRENT_PROGRAM globally.
         * 3. Viewer A renders red again while its renderer-local state still says program A is active.
         *
         * Step 3 reaches FlexRenderer.useProgram's skip-load branch for owner A. The old implementation returns
         * false without rebinding program A, so WebGL remains bound to B's program and A's presentation output turns
         * green. The fixed implementation still returns false, but first calls gl.useProgram(programA.webGLProgram),
         * so A's uniform upload and draw are valid and A remains red.
         */
        const firstA = renderOwner(ownerA, RED);
        const firstB = renderOwner(ownerB, GREEN);
        const beforeConflictCurrentProgramIsB = gl.getParameter(gl.CURRENT_PROGRAM) === rawProgramB;
        const conflictA = renderOwner(ownerA, RED);

        const viewerAIsRed = isRed(conflictA.presentationPixel);
        const viewerAIsGreen = isGreen(conflictA.presentationPixel);
        const viewerBIsGreen = isGreen(firstB.presentationPixel);
        const viewerBStillGreen = isGreen(readPresentationCenterPixel(dom.canvasB));
        const viewersDiffer = viewerAIsRed && viewerBStillGreen;

        const fixedBehaviorObserved =
            isRed(firstA.presentationPixel) &&
            isGreen(firstB.presentationPixel) &&
            beforeConflictCurrentProgramIsB &&
            conflictA.needsLoad === false &&
            conflictA.currentProgramMatchesOwner &&
            conflictA.useProgramError === gl.NO_ERROR &&
            conflictA.uniformError === gl.NO_ERROR &&
            conflictA.drawError === gl.NO_ERROR &&
            conflictA.readError === gl.NO_ERROR &&
            viewerAIsRed &&
            viewerBStillGreen &&
            viewersDiffer;

        const oldBugReproduced =
            isRed(firstA.presentationPixel) &&
            isGreen(firstB.presentationPixel) &&
            beforeConflictCurrentProgramIsB &&
            conflictA.needsLoad === false &&
            !conflictA.currentProgramMatchesOwner &&
            conflictA.uniformError === gl.INVALID_OPERATION &&
            viewerAIsGreen &&
            viewerBStillGreen;

        renderChecks([
            ["Renderer source", "../../openseadragon/openseadragon.js + /build/openseadragon/flex-renderer.js"],
            ["Patch signature found", yesNo(methodLooksPatched)],
            ["Viewer A initial render was red", yesNo(isRed(firstA.presentationPixel))],
            ["Viewer B render was green", yesNo(isGreen(firstB.presentationPixel))],
            ["Before A redraw, WebGL CURRENT_PROGRAM belongs to viewer B", yesNo(beforeConflictCurrentProgramIsB)],
            ["A redraw useProgram returned false / skipped load", yesNo(conflictA.needsLoad === false)],
            ["After A redraw useProgram, WebGL CURRENT_PROGRAM belongs to viewer A", yesNo(conflictA.currentProgramMatchesOwner)],
            ["A redraw gl.useProgram error", glErrorName(gl, conflictA.useProgramError)],
            ["A redraw owner-A uniform upload error", glErrorName(gl, conflictA.uniformError)],
            ["A redraw draw error", glErrorName(gl, conflictA.drawError)],
            ["A redraw readback error", glErrorName(gl, conflictA.readError)],
            ["Viewer A final center pixel", formatPixel(conflictA.presentationPixel)],
            ["Viewer B final center pixel", formatPixel(readPresentationCenterPixel(dom.canvasB))],
            ["Viewer A is red and viewer B is green", yesNo(viewersDiffer)],
            ["Old bug reproduced", yesNo(oldBugReproduced)],
            ["Fixed behavior observed", yesNo(fixedBehaviorObserved)]
        ]);

        dom.noteA.textContent = viewerAIsRed ?
            "PASS: viewer A is red after interleaved shared-context redraw." :
            viewerAIsGreen ?
                "FAIL: viewer A is green, which means it drew with viewer B's stale program." :
                "INCONCLUSIVE: viewer A ended with an unexpected color.";

        dom.noteB.textContent = viewerBStillGreen ?
            "PASS: viewer B is green and remained unchanged." :
            "FAIL: viewer B did not retain the expected green presentation output.";

        if (fixedBehaviorObserved) {
            setSummary(
                "PASS: fixed behavior observed. Viewer A is red and viewer B is green after interleaved shared-context rendering.",
                "pass"
            );
        } else if (oldBugReproduced) {
            setSummary(
                "FAIL / BUG REPRODUCED: viewer A rendered green with viewer B's stale program after the skip-load path.",
                "fail"
            );
        } else {
            setSummary(
                "INCONCLUSIVE: the two-viewer harness did not match either the old failure signature or the fixed signature.",
                "neutral"
            );
        }
    }

    function makeOwner({ FlexRenderer, gl, name, rawProgram, program, presentationCanvas }) {
        const colorLocation = gl.getUniformLocation(rawProgram, "uColor");

        if (!colorLocation) {
            throw new Error(`Could not obtain required uColor uniform location for ${name}.`);
        }

        return {
            name,
            gl,
            rawProgram,
            program,
            colorLocation,
            presentationCanvas,
            renderer: makeRendererLike(gl)
        };
    }

    function renderOwner(owner, color) {
        const { gl } = owner;

        clearErrors(gl);
        const needsLoad = window.OpenSeadragon.FlexRenderer.prototype.useProgram.call(
            owner.renderer,
            owner.program,
            owner.name
        );
        const currentProgramMatchesOwner = gl.getParameter(gl.CURRENT_PROGRAM) === owner.rawProgram;
        const useProgramError = gl.getError();

        gl.uniform4f(owner.colorLocation, color[0], color[1], color[2], color[3]);
        const uniformError = gl.getError();

        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const clearError = gl.getError();

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const drawError = gl.getError();

        const backingPixel = readWebGLCenterPixel(gl);
        const readError = gl.getError();

        copyBackingToPresentation(gl.canvas, owner.presentationCanvas);
        const presentationPixel = readPresentationCenterPixel(owner.presentationCanvas);

        return {
            needsLoad,
            currentProgramMatchesOwner,
            useProgramError,
            uniformError,
            clearError,
            drawError,
            readError,
            backingPixel,
            presentationPixel
        };
    }

    function makeFlexProgram(FlexRenderer, webGLProgram, label) {
        const program = new FlexRenderer.Program({ label });

        program.webGLProgram = webGLProgram;
        program._justCreated = false;
        program.requiresLoad = false;
        program.load = () => {};
        program.unload = () => {};
        program.destroy = () => {};

        return program;
    }

    function makeRendererLike(gl) {
        return {
            gl,
            running: true,
            _program: null,
            _programImplementations: Object.create(null),
            _shaders: Object.create(null),
            htmlHandler: null,
            htmlReset: () => {},
            getProgram(key) {
                return this._programImplementations[key];
            },
            getShaderLayerOrder() {
                return [];
            },
            forEachShaderLayerWithContext() {},
            raiseEvent() {}
        };
    }

    function createFullscreenProgram(gl, label) {
        const vertexSource = `#version 300 es
precision highp float;
const vec2 positions[3] = vec2[3](
    vec2(-1.0, -1.0),
    vec2( 3.0, -1.0),
    vec2(-1.0,  3.0)
);
void main() {
    gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}`;

        const fragmentSource = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
    outColor = uColor;
}`;

        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex`);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
        const program = gl.createProgram();

        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`Could not link ${label} program: ${info}`);
        }

        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        return program;
    }

    function compileShader(gl, type, source, label) {
        const shader = gl.createShader(type);

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Could not compile ${label} shader: ${info}`);
        }

        return shader;
    }

    function copyBackingToPresentation(backingCanvas, presentationCanvas) {
        const ctx = presentationCanvas.getContext("2d", { willReadFrequently: true });

        if (!ctx) {
            throw new Error("Could not create 2D context for presentation canvas.");
        }

        ctx.clearRect(0, 0, presentationCanvas.width, presentationCanvas.height);
        ctx.drawImage(backingCanvas, 0, 0, presentationCanvas.width, presentationCanvas.height);
    }

    function readWebGLCenterPixel(gl) {
        const pixel = new Uint8Array(4);

        gl.readPixels(
            Math.floor(gl.canvas.width / 2),
            Math.floor(gl.canvas.height / 2),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixel
        );

        return Array.from(pixel);
    }

    function readPresentationCenterPixel(canvas) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        if (!ctx) {
            throw new Error("Could not read presentation canvas.");
        }

        const image = ctx.getImageData(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1
        );

        return Array.from(image.data);
    }

    function isRed(pixel) {
        return pixel[0] > 200 && pixel[1] < 80 && pixel[2] < 80 && pixel[3] > 200;
    }

    function isGreen(pixel) {
        return pixel[0] < 80 && pixel[1] > 200 && pixel[2] < 80 && pixel[3] > 200;
    }

    function formatPixel(pixel) {
        const color = isRed(pixel) ? "red" : isGreen(pixel) ? "green" : "unexpected color";
        return `[${pixel.join(", ")}] ${color}`;
    }

    function clearErrors(gl) {
        let guard = 0;

        while (gl.getError() !== gl.NO_ERROR && guard < 32) {
            guard++;
        }
    }

    function glErrorName(gl, value) {
        const names = new Map([
            [gl.NO_ERROR, "NO_ERROR"],
            [gl.INVALID_ENUM, "INVALID_ENUM"],
            [gl.INVALID_VALUE, "INVALID_VALUE"],
            [gl.INVALID_OPERATION, "INVALID_OPERATION"],
            [gl.INVALID_FRAMEBUFFER_OPERATION, "INVALID_FRAMEBUFFER_OPERATION"],
            [gl.OUT_OF_MEMORY, "OUT_OF_MEMORY"],
            [gl.CONTEXT_LOST_WEBGL, "CONTEXT_LOST_WEBGL"]
        ]);

        return names.get(value) || `0x${value.toString(16)}`;
    }

    function resetOutput() {
        setSummary("Running...", "neutral");
        dom.checksBody.innerHTML = "<tr><td>Status</td><td>Running.</td></tr>";
        dom.noteA.textContent = "Running.";
        dom.noteB.textContent = "Running.";
        clearPresentationCanvas(dom.canvasA);
        clearPresentationCanvas(dom.canvasB);
    }

    function clearPresentationCanvas(canvas) {
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext("2d");

        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    function setSummary(message, status) {
        const dotClass = status === "pass" ? "pass" : status === "fail" ? "fail" : "";

        dom.summary.className = `result ${status || "neutral"}`;
        dom.summary.innerHTML = `<span class="status-dot ${dotClass}"></span>${escapeHtml(message)}`;
    }

    function renderChecks(rows) {
        dom.checksBody.innerHTML = rows
            .map(([name, value]) => `<tr><th>${escapeHtml(name)}</th><td>${value}</td></tr>`)
            .join("");
    }

    function yesNo(value) {
        return value ? "<span class=\"pass\">yes</span>" : "<span class=\"fail\">no</span>";
    }


    function failHard(error) {
        console.error(error);
        setSummary(`ERROR: ${error && error.message ? error.message : error}`, "fail");
        renderChecks([["Error", `<pre>${escapeHtml(error && error.stack ? error.stack : String(error))}</pre>`]]);

        if (dom.noteA) {
            dom.noteA.textContent = "Error before viewer A could render.";
        }

        if (dom.noteB) {
            dom.noteB.textContent = "Error before viewer B could render.";
        }

    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})();
