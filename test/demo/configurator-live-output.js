(function() {
    const ShaderConfigurator = OpenSeadragon.FlexRenderer.ShaderConfigurator;
    const ShaderMediator = OpenSeadragon.FlexRenderer.ShaderMediator;
    const demoUniqueId = "configurator_live_output_demo";
    const sourceImagePath = "../data/rainbow.png";
    const defaultShaderId = "iconmap";

    let loadedImage = null;
    let activeShaderId = defaultShaderId;
    let previousShaderId = null;

    function renderJson(nodeId, value) {
        document.getElementById(nodeId).textContent = JSON.stringify(value, null, 2);
    }

    function renderDataMeta(image) {
        const text = image ?
            `Loaded ${sourceImagePath} (${image.naturalWidth} x ${image.naturalHeight})` :
            "No data loaded.";
        document.getElementById("data-meta").textContent = text;
    }

    function renderShaderOptions() {
        const select = document.getElementById("shader-selector");
        const shaders = ShaderMediator.availableShaders()
            .map(Shader => ({
                id: Shader.type(),
                name: typeof Shader.name === "function" ? Shader.name() : Shader.type()
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        select.innerHTML = shaders.map(shader => `
<option value="${shader.id}" ${shader.id === activeShaderId ? "selected" : ""}>${shader.name} (${shader.id})</option>
        `).join("");
    }

    function updateShaderStatus(message) {
        document.getElementById("shader-status").textContent = message;
    }

    function inferDefaultChannel(Shader) {
        const source = Shader && typeof Shader.sources === "function" ? (Shader.sources() || [])[0] : null;
        if (!source || typeof source.acceptsChannelCount !== "function") {
            return null;
        }
        if (source.acceptsChannelCount(1)) {
            return "r";
        }
        if (source.acceptsChannelCount(2)) {
            return "rg";
        }
        if (source.acceptsChannelCount(3)) {
            return "rgb";
        }
        if (source.acceptsChannelCount(4)) {
            return "rgba";
        }
        return null;
    }

    function getPreviewHost() {
        return document.getElementById(`${demoUniqueId}_preview_host`);
    }

    function getControlsHost() {
        return document.getElementById(`${demoUniqueId}_native_controls`);
    }

    function setPreviewAspect(element, width, height) {
        if (!element || !width || !height) {
            return;
        }
        element.style.aspectRatio = `${width} / ${height}`;
    }

    function createPreviewSession({
        uniqueId,
        width,
        height,
        controlMountResolver,
        previewHost,
        onVisualizationChanged
    }) {
        let currentShaderId = null;
        let viewer = null;
        let ready = null;

        const ensureHosts = () => {
            const host = previewHost || getPreviewHost();
            const controlsHost = controlMountResolver ? controlMountResolver() : getControlsHost();
            if (!host) {
                throw new Error("Preview host not found.");
            }
            if (!controlsHost) {
                throw new Error("Native controls host not found.");
            }
            return { host, controlsHost };
        };

        const ensureViewer = () => {
            if (ready) {
                return ready;
            }

            const { host, controlsHost } = ensureHosts();
            const element = document.createElement("div");
            element.id = `${uniqueId}_viewer`;
            element.className = "osd-preview rounded-box border border-base-300 bg-base-100";
            setPreviewAspect(element, width, height);
            host.innerHTML = "";
            host.appendChild(element);

            viewer = OpenSeadragon({
                element,
                prefixUrl: "../../openseadragon/images/",
                showNavigationControl: false,
                showNavigator: false,
                animationTime: 0,
                blendTime: 0,
                maxZoomPixelRatio: 5,
                minZoomImageRatio: 1,
                visibilityRatio: 1,
                constrainDuringPan: true,
                drawer: "flex-renderer",
                drawerOptions: {
                    "flex-renderer": {
                        debug: false,
                        webGLPreferredVersion: "2.0",
                        handleNavigator: false,
                        htmlHandler: (shaderLayer, shaderConfig) => {
                            const mount = controlMountResolver ? controlMountResolver() : controlsHost;
                            if (!mount || !shaderLayer) {
                                return "";
                            }

                            const section = document.createElement("div");
                            section.className = "card bg-base-200 border border-base-300 shadow-sm";

                            const body = document.createElement("div");
                            body.className = "card-body p-3 gap-2";

                            const title = document.createElement("div");
                            title.className = "text-sm font-semibold";
                            title.textContent = shaderConfig.name || shaderLayer.constructor.name();

                            const controlsId = `${uniqueId}_${shaderLayer.id}_controls`;
                            const controls = document.createElement("div");
                            controls.id = controlsId;
                            controls.className = "flex flex-col gap-2";
                            controls.innerHTML = shaderLayer.htmlControls(
                                html => `<div class="flex flex-col gap-2">${html}</div>`
                            );

                            body.appendChild(title);
                            body.appendChild(controls);
                            section.appendChild(body);
                            mount.appendChild(section);

                            return controlsId;
                        },
                        htmlReset: () => {
                            const mount = controlMountResolver ? controlMountResolver() : controlsHost;
                            if (mount) {
                                mount.innerHTML = "";
                            }
                        }
                    }
                },
                tileSources: {
                    type: "image",
                    url: sourceImagePath
                }
            });

            ready = new Promise((resolve, reject) => {
                const cleanup = () => {
                    viewer.removeHandler("open", onOpen);
                    viewer.removeHandler("open-failed", onOpenFailed);
                };

                const onOpen = () => {
                    cleanup();
                    viewer.viewport.goHome(true);
                    viewer.drawer.renderer.addHandler("visualization-change", () => {
                        if (!currentShaderId || typeof onVisualizationChanged !== "function") {
                            return;
                        }
                        const shader = viewer.drawer.renderer.getShaderLayer(currentShaderId);
                        if (shader) {
                            onVisualizationChanged(shader.getConfig(), session);
                        }
                    });
                    resolve(viewer);
                };

                const onOpenFailed = (event) => {
                    cleanup();
                    reject(new Error(event && event.message ? event.message : "Failed to open preview viewer source."));
                };

                viewer.addHandler("open", onOpen);
                viewer.addHandler("open-failed", onOpenFailed);
            });

            return ready;
        };

        const session = {
            uniqueId,
            get renderer() {
                return viewer && viewer.drawer ? viewer.drawer.renderer : null;
            },
            async setSize(nextWidth, nextHeight) {
                width = nextWidth;
                height = nextHeight;

                const instance = await ensureViewer();
                setPreviewAspect(instance.element, width, height);
                instance.forceRedraw();
            },
            async setShader(shaderConfig) {
                const instance = await ensureViewer();
                const config = typeof structuredClone === "function" ?
                    structuredClone(shaderConfig) :
                    JSON.parse(JSON.stringify(shaderConfig));
                currentShaderId = OpenSeadragon.FlexRenderer.sanitizeKey(config.id || "prl");
                config.id = currentShaderId;

                await instance.drawer.overrideConfigureAll({
                    [currentShaderId]: config
                }, [currentShaderId]);

                instance.forceRedraw();
            },
            getShader() {
                return currentShaderId && viewer && viewer.drawer ?
                    viewer.drawer.renderer.getShaderLayer(currentShaderId) :
                    null;
            },
            destroy() {
                ready = null;
                if (!viewer) {
                    return;
                }
                try {
                    viewer.destroy();
                } catch (e) {
                    console.warn("Failed to destroy preview viewer.", e);
                }
                viewer = null;
            }
        };

        return session;
    }

    async function runSelectedShader() {
        if (!loadedImage) {
            updateShaderStatus("Waiting for source image...");
            return;
        }

        const select = document.getElementById("shader-selector");
        activeShaderId = select.value || defaultShaderId;
        updateShaderStatus(`Loading shader: ${activeShaderId}`);
        const Shader = ShaderMediator.getClass(activeShaderId);

        if (previousShaderId !== activeShaderId) {
            ShaderConfigurator.setup.shader.params = {};
            ShaderConfigurator.setup.shader.cache = {};
        }
        if (ShaderConfigurator.setup.shader.params.use_channel0 === undefined) {
            const defaultChannel = inferDefaultChannel(Shader);
            if (defaultChannel) {
                ShaderConfigurator.setup.shader.params.use_channel0 = defaultChannel;
            }
        }

        await ShaderConfigurator.runControlSelector(
            "shader-config-ui",
            activeShaderId,
            (config) => {
                renderJson("final-config-output", config);
            }
        );

        previousShaderId = activeShaderId;
        renderJson("live-config-output", ShaderConfigurator.getCurrentShaderConfig());
        updateShaderStatus(`Editing shader: ${activeShaderId}`);
    }

    async function init() {
        ShaderConfigurator.setUniqueId(demoUniqueId);
        ShaderConfigurator.setPreviewAdapter({
            createSession(options) {
                return createPreviewSession(options);
            },
            async render({ shaderConfig }) {
                renderJson("live-config-output", shaderConfig);
                updateShaderStatus(`Editing shader: ${shaderConfig.type}`);
            },
            onSessionVisualizationChanged({ shaderConfig }) {
                renderJson("live-config-output", shaderConfig);
                updateShaderStatus(`Editing shader: ${shaderConfig.type}`);
            }
        });
        renderShaderOptions();

        document.getElementById("reload-shader").addEventListener("click", () => {
            runSelectedShader().catch(error => {
                console.error(error);
                updateShaderStatus(error && error.message ? error.message : String(error));
            });
        });
        document.getElementById("shader-selector").addEventListener("change", () => {
            runSelectedShader().catch(error => {
                console.error(error);
                updateShaderStatus(error && error.message ? error.message : String(error));
            });
        });

        const image = new Image();
        image.decoding = "async";
        image.onload = async() => {
            loadedImage = image;
            ShaderConfigurator.setData(image);
            renderDataMeta(image);

            const sourceImageNode = document.getElementById("source-image");
            sourceImageNode.src = image.src;

            await runSelectedShader();
        };

        image.onerror = () => {
            document.getElementById("data-meta").textContent =
                `Failed to load ${sourceImagePath}`;
            updateShaderStatus("Failed to load source image");
        };

        image.src = sourceImagePath;
    }

    window.addEventListener("load", () => {
        init().catch(error => {
            console.error(error);
            updateShaderStatus(error && error.message ? error.message : String(error));
            const previewHost = getPreviewHost();
            if (previewHost) {
                previewHost.innerHTML = `<div class="alert alert-error text-sm">${String(error && error.message ? error.message : error)}</div>`;
            }
        });
    });
})();
