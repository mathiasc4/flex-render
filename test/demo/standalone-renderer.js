(function() {
    const SOURCE_SIZE = 320;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function clampByte(value) {
        return Math.max(0, Math.min(255, Math.round(value)));
    }

    function createCanvasSource(painter) {
        const canvas = document.createElement("canvas");
        canvas.width = SOURCE_SIZE;
        canvas.height = SOURCE_SIZE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        painter(ctx, canvas);
        return canvas;
    }

    function createGradientField() {
        return createCanvasSource((ctx, canvas) => {
            const width = canvas.width;
            const height = canvas.height;
            const image = ctx.createImageData(width, height);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const nx = x / (width - 1);
                    const ny = y / (height - 1);
                    const dx = nx - 0.5;
                    const dy = ny - 0.5;
                    const radial = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.65);

                    image.data[idx] = clampByte(nx * 255);
                    image.data[idx + 1] = clampByte(ny * 255);
                    image.data[idx + 2] = clampByte(radial * 255);
                    image.data[idx + 3] = 255;
                }
            }

            ctx.putImageData(image, 0, 0);
            ctx.strokeStyle = "rgba(255,255,255,0.55)";
            ctx.lineWidth = 2;
            for (let i = 1; i < 6; i++) {
                const x = (width / 6) * i;
                const y = (height / 6) * i;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }
        });
    }

    function createRingsField() {
        return createCanvasSource((ctx, canvas) => {
            const width = canvas.width;
            const height = canvas.height;
            const image = ctx.createImageData(width, height);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const dx = (x - width / 2) / width;
                    const dy = (y - height / 2) / height;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const rings = 0.5 + 0.5 * Math.sin(dist * 48.0);
                    const sweep = 0.5 + 0.5 * Math.cos((Math.atan2(dy, dx) + Math.PI) * 3.0);
                    const value = clampByte((rings * 0.74 + sweep * 0.26) * 255);

                    image.data[idx] = value;
                    image.data[idx + 1] = value;
                    image.data[idx + 2] = value;
                    image.data[idx + 3] = 255;
                }
            }

            ctx.putImageData(image, 0, 0);
        });
    }

    function createBlocksField() {
        return createCanvasSource((ctx, canvas) => {
            ctx.fillStyle = "#08141b";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const blocks = [
                { x: 20, y: 22, w: 118, h: 118, color: "#ef4444" },
                { x: 154, y: 28, w: 146, h: 82, color: "#38bdf8" },
                { x: 56, y: 164, w: 86, h: 126, color: "#facc15" },
                { x: 168, y: 156, w: 122, h: 132, color: "#22c55e" },
            ];

            blocks.forEach(block => {
                ctx.fillStyle = block.color;
                ctx.fillRect(block.x, block.y, block.w, block.h);
            });

            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = 14;
            ctx.beginPath();
            ctx.moveTo(28, 294);
            ctx.lineTo(132, 148);
            ctx.lineTo(292, 34);
            ctx.stroke();

            ctx.strokeStyle = "rgba(255,255,255,0.65)";
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.moveTo(18, 40);
            ctx.lineTo(300, 286);
            ctx.stroke();
        });
    }

    function createNoiseField() {
        return createCanvasSource((ctx, canvas) => {
            const width = canvas.width;
            const height = canvas.height;
            const image = ctx.createImageData(width, height);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const value = Math.sin(x * 0.072) * 0.45 + Math.cos(y * 0.051) * 0.35 + Math.sin((x + y) * 0.024) * 0.2;
                    const normalized = clampByte((value * 0.5 + 0.5) * 255);

                    image.data[idx] = normalized;
                    image.data[idx + 1] = clampByte(normalized * 0.7);
                    image.data[idx + 2] = clampByte(255 - normalized);
                    image.data[idx + 3] = 255;
                }
            }

            ctx.putImageData(image, 0, 0);
        });
    }

    const sourceLibrary = {
        gradient: {
            id: "gradient",
            label: "Gradient Field",
            description: "Smooth RGB ramps with a radial blue falloff.",
            canvas: createGradientField()
        },
        rings: {
            id: "rings",
            label: "Ring Scalar Field",
            description: "Monochrome rings and angular sweeps for scalar shaders.",
            canvas: createRingsField()
        },
        blocks: {
            id: "blocks",
            label: "Hard Edge Blocks",
            description: "Flat color regions with sharp borders for edge detectors.",
            canvas: createBlocksField()
        },
        noise: {
            id: "noise",
            label: "Wave Noise",
            description: "Deterministic pseudo-noise for threshold and blending tests.",
            canvas: createNoiseField()
        }
    };

    function baseShader(type, tiledImages, params, extra = {}) {
        return Object.assign({
            name: type,
            type,
            visible: 1,
            fixed: false,
            tiledImages: tiledImages.slice(),
            params: params ? clone(params) : {},
            cache: {}
        }, extra);
    }

    const presets = [
        {
            id: "identity",
            label: "Identity",
            description: "Raw RGBA passthrough for a single synthetic source.",
            sourceIds: ["gradient"],
            size: { width: 768, height: 512 },
            buildConfiguration() {
                return {
                    identity: baseShader("identity", [0], {})
                };
            }
        },
        {
            id: "heatmap",
            label: "Heatmap",
            description: "Single-channel heatmap over the ring field.",
            sourceIds: ["rings"],
            size: { width: 768, height: 512 },
            buildConfiguration() {
                return {
                    heat: baseShader("heatmap", [0], {
                        use_channel0: "r",
                        color: "#f25c2a",
                        threshold: 30,
                        inverse: false
                    }, { name: "Ring Heatmap" })
                };
            }
        },
        {
            id: "threshold",
            label: "Threshold",
            description: "Threshold preview using the green channel of the gradient field.",
            sourceIds: ["gradient"],
            size: { width: 768, height: 512 },
            buildConfiguration() {
                return {
                    threshold: baseShader("threshold", [0], {
                        use_channel0: "g",
                        threshold: 0.46,
                        max_value: 1,
                        version: 0,
                        colorize_binary: true,
                        fg_color: "#fff1d0",
                        bg_color: "#13211f"
                    }, { name: "Threshold Study" })
                };
            }
        },
        {
            id: "sobel",
            label: "Sobel",
            description: "RGB Sobel edge detector over flat color blocks and diagonals.",
            sourceIds: ["blocks"],
            size: { width: 768, height: 512 },
            buildConfiguration() {
                return {
                    sobel: baseShader("sobel", [0], {
                        use_channel0: "rgb"
                    }, { name: "Sobel Blocks" })
                };
            }
        },
        {
            id: "edge",
            label: "Edge Threshold",
            description: "Derivative-aware threshold edge highlighting on scalar rings.",
            sourceIds: ["rings"],
            size: { width: 768, height: 512 },
            buildConfiguration() {
                return {
                    edge: baseShader("edge", [0], {
                        use_channel0: "r",
                        threshold: 52,
                        outer_color: "#f66b4f",
                        inner_color: "#5d180f",
                        edgeThickness: 1.7
                    }, { name: "Ring Edge" })
                };
            }
        },
        {
            id: "group",
            label: "Group Blend",
            description: "Composite three sources through a group shader for blend-path testing.",
            sourceIds: ["gradient", "blocks", "noise"],
            size: { width: 960, height: 640 },
            buildConfiguration() {
                return {
                    composite: baseShader("group", [], {}, {
                        name: "Composite Blend Stack",
                        order: ["base", "edges", "overlay"],
                        shaders: {
                            base: baseShader("identity", [0], {}, { name: "Gradient Base" }),
                            edges: baseShader("sobel", [1], {
                                use_channel0: "rgb",
                                use_mode: "blend",
                                use_blend: "screen",
                                opacity: 0.72
                            }, { name: "Block Sobel" }),
                            overlay: baseShader("heatmap", [2], {
                                use_channel0: "r",
                                color: "#a62828",
                                threshold: 58,
                                use_mode: "blend",
                                use_blend: "source-over",
                                opacity: 0.48
                            }, { name: "Noise Heatmap" })
                        }
                    })
                };
            }
        }
    ];

    const state = {
        runtime: null,
        selectedPresetId: presets[0].id,
        selectedSourceIds: presets[0].sourceIds.slice()
    };

    function getPresetById(id) {
        return presets.find(preset => preset.id === id) || presets[0];
    }

    function getSelectedPreset() {
        return getPresetById(state.selectedPresetId);
    }

    function getRenderSize() {
        const width = Math.max(64, Number.parseInt(document.getElementById("render-width").value, 10) || 64);
        const height = Math.max(64, Number.parseInt(document.getElementById("render-height").value, 10) || 64);
        return { width, height };
    }

    function setStatus(message, meta = "") {
        const statusBar = document.getElementById("status-bar");
        const statusMeta = document.getElementById("status-meta");
        statusBar.firstElementChild.innerHTML = `<strong>Status</strong> ${message}`;
        statusMeta.textContent = meta;
    }

    function updateRenderMeta(configuration, size) {
        const renderMeta = document.getElementById("render-meta");
        const shaders = Object.keys(configuration || {});
        renderMeta.innerHTML = "";

        [
            `${size.width} x ${size.height}`,
            `${state.selectedSourceIds.length} source${state.selectedSourceIds.length === 1 ? "" : "s"}`,
            `${shaders.length} root shader${shaders.length === 1 ? "" : "s"}`,
            `preset: ${getSelectedPreset().label}`
        ].forEach(text => {
            const pill = document.createElement("span");
            pill.className = "render-pill";
            pill.textContent = text;
            renderMeta.appendChild(pill);
        });
    }

    function syncSourceCheckboxes() {
        document.querySelectorAll(".source-toggle").forEach(input => {
            input.checked = state.selectedSourceIds.includes(input.value);
            const card = input.closest(".source-card");
            if (card) {
                card.classList.toggle("is-active", input.checked);
            }
        });
    }

    function syncPresetCards() {
        document.querySelectorAll(".preset-card").forEach(card => {
            card.classList.toggle("is-active", card.dataset.presetId === state.selectedPresetId);
        });
    }

    function writePresetToEditor() {
        const preset = getSelectedPreset();
        const size = preset.size || { width: 768, height: 512 };
        document.getElementById("render-width").value = size.width;
        document.getElementById("render-height").value = size.height;
        document.getElementById("config-input").value = JSON.stringify(preset.buildConfiguration(), null, 2);
        state.selectedSourceIds = preset.sourceIds.slice();
        syncPresetCards();
        syncSourceCheckboxes();
        updateRenderMeta(preset.buildConfiguration(), size);
    }

    function readEditorConfiguration() {
        const raw = document.getElementById("config-input").value.trim();
        if (!raw) {
            return {};
        }
        return JSON.parse(raw);
    }

    function getSelectedInputs() {
        return state.selectedSourceIds.map(id => sourceLibrary[id].canvas);
    }

    function mountRuntimeCanvas() {
        if (!state.runtime) {
            return;
        }
        const shell = document.getElementById("render-shell");
        shell.innerHTML = "";
        shell.appendChild(state.runtime.canvas);
    }

    async function renderFromEditor() {
        try {
            const configuration = readEditorConfiguration();
            const inputs = getSelectedInputs();
            const size = getRenderSize();

            if (!inputs.length) {
                throw new Error("Select at least one input source.");
            }

            setStatus("rendering", `${inputs.length} input source(s)`);
            await state.runtime.drawWithConfiguration(inputs, configuration, undefined, size);
            updateRenderMeta(configuration, size);
            setStatus("render complete", `${state.runtime.canvas.width}x${state.runtime.canvas.height}`);
        } catch (error) {
            setStatus("render failed", error && error.message ? error.message : String(error));
            console.error(error);
        }
    }

    function downloadCurrentCanvas() {
        const link = document.createElement("a");
        link.download = `standalone-render-${Date.now()}.png`;
        link.href = state.runtime.canvas.toDataURL("image/png");
        link.click();
    }

    function renderPresetCards() {
        const grid = document.getElementById("preset-grid");
        presets.forEach(preset => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "preset-card";
            card.dataset.presetId = preset.id;
            card.innerHTML = `
                <h3 class="preset-card__title">${preset.label}</h3>
                <p class="preset-card__copy">${preset.description}</p>
            `;
            card.addEventListener("click", async () => {
                state.selectedPresetId = preset.id;
                writePresetToEditor();
                await renderFromEditor();
            });
            grid.appendChild(card);
        });
    }

    function renderSourceCards() {
        const grid = document.getElementById("source-grid");
        Object.values(sourceLibrary).forEach(source => {
            const label = document.createElement("label");
            label.className = "source-card";
            label.innerHTML = `
                <input class="source-toggle" type="checkbox" value="${source.id}">
                <div class="source-thumb"></div>
                <div>
                    <h3 class="source-card__title">${source.label}</h3>
                    <p class="source-card__copy">${source.description}</p>
                </div>
            `;

            const thumb = label.querySelector(".source-thumb");
            const preview = document.createElement("canvas");
            preview.width = 72;
            preview.height = 72;
            preview.getContext("2d").drawImage(source.canvas, 0, 0, preview.width, preview.height);
            thumb.appendChild(preview);

            const input = label.querySelector(".source-toggle");
            input.addEventListener("change", () => {
                if (input.checked) {
                    if (!state.selectedSourceIds.includes(source.id)) {
                        state.selectedSourceIds.push(source.id);
                    }
                } else {
                    state.selectedSourceIds = state.selectedSourceIds.filter(id => id !== source.id);
                }
                syncSourceCheckboxes();
            });

            grid.appendChild(label);
        });
    }

    async function initialize() {
        state.runtime = OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: "standalone_demo_renderer",
            width: 768,
            height: 512,
            webGLPreferredVersion: "2.0",
            backgroundColor: "#00000000",
            debug: true,
            interactive: false
        });

        state.runtime.canvas.style.width = "100%";
        state.runtime.canvas.style.height = "100%";
        mountRuntimeCanvas();

        renderPresetCards();
        renderSourceCards();
        writePresetToEditor();

        document.getElementById("render-button").addEventListener("click", renderFromEditor);
        document.getElementById("load-preset").addEventListener("click", writePresetToEditor);
        document.getElementById("download-button").addEventListener("click", downloadCurrentCanvas);

        await renderFromEditor();
    }

    window.addEventListener("DOMContentLoaded", initialize);
}());
