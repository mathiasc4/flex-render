(function($) {
    const DEFAULT_MAX_FRAMES = 120;
    const DEFAULT_SAMPLE_INTERVAL_MS = 500;
    const SHARED_CONTEXT_KEY = "profiling-shared-context";
    const LARGE_GEOJSON_URL = "../data/geojson-performance-10k.geojson";
    const LARGE_GEOJSON_SIZE = 4096 * 8;

    const COLORS = {
        drawer: "#60a5fa",
        firstPass: "#34d399",
        secondPass: "#fbbf24",
        finish: "#f87171",
        tileSource: "#a78bfa",
        skipped: "#9ca3af",
        budget: "#6b7280",
        axis: "#d1d5db",
        text: "#374151"
    };

    const SCENARIOS = {
        "many-sources": {
            label: "Single viewer: many sources",
            description: "Profiles one FlexRenderer viewer drawing many raster/image sources during redraw, pan, and zoom. Use this scenario to identify broad pipeline bottlenecks without GeoJSON tile-source work."
        },
        "large-geojson": {
            label: "Single viewer: large GeoJSON",
            description: "Profiles one large GeoJSON source. Toggle aggregation, spatial indexing, and native lines, then capture rows to compare the resulting timings."
        },
        "two-private": {
            label: "Two viewers: private contexts",
            description: "Profiles two independent FlexRenderer viewers, each with its own private WebGL context."
        },
        "two-shared": {
            label: "Two viewers: shared context",
            description: "Profiles two FlexRenderer viewers using the same sharedContextKey so private/shared context behavior can be compared."
        }
    };

    let activeViewers = [];
    let sampleTimer = null;
    let motionTimer = null;
    let motionStep = 0;
    let captureRows = [];
    let initialized = false;

    const dom = {};

    const state = {
        scenario: "many-sources",
        profilingEnabled: true,
        includeTileSources: true,
        maxFrames: DEFAULT_MAX_FRAMES,
        sampleInterval: DEFAULT_SAMPLE_INTERVAL_MS,
        manySourceCount: 10,
        geojsonAggregation: true,
        geojsonSpatialIndex: true,
        geojsonNativeLines: true
    };

    window.flexRendererProfilingDemo = {
        init,
        loadScenario,
        forceRedraw,
        updateDashboard,
        getPrimarySnapshot,
        getActiveViewers: () => activeViewers.slice(),
        captureCurrentResult,
        clearCaptures,
        startSampling,
        stopSampling,
        startMotion,
        stopMotion
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    function init() {
        if (initialized) {
            return;
        }

        initialized = true;
        patchGeoJSONSpatialIndexOption();
        collectDom();
        bindControls();
        syncStateFromControls();
        loadScenario();
    }

    function collectDom() {
        dom.description = document.getElementById("profiling-scenario-description");
        dom.scenario = document.getElementById("profiling-scenario");
        dom.loadScenario = document.getElementById("profiling-load-scenario");
        dom.captureResult = document.getElementById("profiling-capture-result");
        dom.clearCaptures = document.getElementById("profiling-clear-captures");
        dom.viewers = document.getElementById("profiling-viewers");
        dom.status = document.getElementById("profiling-status");

        dom.enabled = document.getElementById("profiling-enabled");
        dom.maxFrames = document.getElementById("profiling-max-frames");
        dom.includeTileSources = document.getElementById("profiling-include-tile-sources");
        dom.continuousSampling = document.getElementById("profiling-continuous-sampling");
        dom.sampleInterval = document.getElementById("profiling-sample-interval");
        dom.motionEnabled = document.getElementById("profiling-motion-enabled");
        dom.forceRedraw = document.getElementById("profiling-force-redraw");
        dom.clear = document.getElementById("profiling-clear");
        dom.copy = document.getElementById("profiling-copy");
        dom.download = document.getElementById("profiling-download");

        dom.geojsonAggregation = document.getElementById("profiling-geojson-aggregation");
        dom.geojsonSpatialIndex = document.getElementById("profiling-geojson-spatial-index");
        dom.geojsonNativeLines = document.getElementById("profiling-geojson-native-lines");
        dom.manySourceCount = document.getElementById("profiling-many-source-count");

        dom.kpis = document.getElementById("profiling-kpis");
        dom.frameTimeline = document.getElementById("profiling-frame-timeline");
        dom.frameTimelineLegend = document.getElementById("profiling-frame-timeline-legend");
        dom.latestBreakdown = document.getElementById("profiling-latest-breakdown");
        dom.latestBreakdownLegend = document.getElementById("profiling-latest-breakdown-legend");
        dom.latestDetails = document.getElementById("profiling-latest-details");
        dom.sparklines = document.getElementById("profiling-sparklines");
        dom.comparisonResults = document.getElementById("profiling-comparison-results");
        dom.raw = document.getElementById("profiling-raw");
    }

    function bindControls() {
        if (dom.loadScenario) {
            dom.loadScenario.addEventListener("click", loadScenario);
        }

        if (dom.scenario) {
            dom.scenario.addEventListener("change", () => {
                syncStateFromControls();
                renderScenarioDescription();
                updateScenarioOptionState();
            });
        }

        const optionInputs = [
            dom.enabled,
            dom.maxFrames,
            dom.includeTileSources,
            dom.sampleInterval,
            dom.geojsonAggregation,
            dom.geojsonSpatialIndex,
            dom.geojsonNativeLines,
            dom.manySourceCount
        ];

        for (const input of optionInputs) {
            if (input) {
                input.addEventListener("change", () => {
                    syncStateFromControls();
                    applyProfilingOptionsToAll();

                    if (input === dom.maxFrames || input === dom.includeTileSources || input === dom.enabled) {
                        updateDashboard();
                        return;
                    }

                    if (requiresScenarioReload(input)) {
                        loadScenario();
                    }
                });
            }
        }

        if (dom.continuousSampling) {
            dom.continuousSampling.addEventListener("change", () => {
                if (dom.continuousSampling.checked) {
                    startSampling();
                } else {
                    stopSampling();
                }
            });
        }

        if (dom.motionEnabled) {
            dom.motionEnabled.addEventListener("change", () => {
                if (dom.motionEnabled.checked) {
                    startMotion();
                } else {
                    stopMotion();
                }
            });
        }

        if (dom.forceRedraw) {
            dom.forceRedraw.addEventListener("click", forceRedraw);
        }

        if (dom.clear) {
            dom.clear.addEventListener("click", clearProfiling);
        }

        if (dom.copy) {
            dom.copy.addEventListener("click", copySnapshotJson);
        }

        if (dom.download) {
            dom.download.addEventListener("click", downloadSnapshotJson);
        }

        if (dom.captureResult) {
            dom.captureResult.addEventListener("click", captureCurrentResult);
        }

        if (dom.clearCaptures) {
            dom.clearCaptures.addEventListener("click", clearCaptures);
        }
    }

    function requiresScenarioReload(input) {
        return input === dom.geojsonAggregation ||
            input === dom.geojsonSpatialIndex ||
            input === dom.geojsonNativeLines ||
            input === dom.manySourceCount;
    }

    function syncStateFromControls() {
        state.scenario = dom.scenario ? dom.scenario.value : state.scenario;
        state.profilingEnabled = !dom.enabled || dom.enabled.checked;
        state.includeTileSources = !dom.includeTileSources || dom.includeTileSources.checked;
        state.maxFrames = Math.max(1, parseInt(dom.maxFrames && dom.maxFrames.value, 10) || DEFAULT_MAX_FRAMES);
        state.sampleInterval = Math.max(100, parseInt(dom.sampleInterval && dom.sampleInterval.value, 10) || DEFAULT_SAMPLE_INTERVAL_MS);
        state.manySourceCount = Math.max(2, Math.min(16, parseInt(dom.manySourceCount && dom.manySourceCount.value, 10) || 10));
        state.geojsonAggregation = !!(dom.geojsonAggregation && dom.geojsonAggregation.checked);
        state.geojsonSpatialIndex = !dom.geojsonSpatialIndex || dom.geojsonSpatialIndex.checked;
        state.geojsonNativeLines = !dom.geojsonNativeLines || dom.geojsonNativeLines.checked;
    }

    function updateScenarioOptionState() {
        const isGeoJSON = state.scenario === "large-geojson";
        const isManySources = state.scenario === "many-sources";

        setDisabled(dom.geojsonAggregation, !isGeoJSON);
        setDisabled(dom.geojsonSpatialIndex, !isGeoJSON);
        setDisabled(dom.geojsonNativeLines, !isGeoJSON);
        setDisabled(dom.manySourceCount, !isManySources);
    }

    function setDisabled(element, disabled) {
        if (element) {
            element.disabled = !!disabled;
        }
    }

    function renderScenarioDescription() {
        if (dom.description) {
            dom.description.textContent = getScenarioDescription();
        }
    }

    function getScenarioDescription() {
        const scenario = SCENARIOS[state.scenario];
        return scenario ? scenario.description : "Unknown profiling scenario.";
    }

    function loadScenario() {
        syncStateFromControls();
        renderScenarioDescription();
        updateScenarioOptionState();
        stopSampling();
        stopMotion();
        destroyActiveViewers();

        if (dom.viewers) {
            dom.viewers.innerHTML = "";
            dom.viewers.classList.toggle("viewer-grid--single", state.scenario !== "two-private" && state.scenario !== "two-shared");
        }

        setStatus(`Loading scenario: ${SCENARIOS[state.scenario].label}`, "info");

        if (state.scenario === "many-sources") {
            createManySourcesScenario();
        } else if (state.scenario === "large-geojson") {
            createLargeGeoJSONScenario();
        } else if (state.scenario === "two-private") {
            createTwoViewerScenario(false);
        } else if (state.scenario === "two-shared") {
            createTwoViewerScenario(true);
        }

        applyProfilingOptionsToAll();

        if (dom.continuousSampling && dom.continuousSampling.checked) {
            startSampling();
        }

        if (dom.motionEnabled && dom.motionEnabled.checked) {
            startMotion();
        }

        window.setTimeout(() => {
            forceRedraw();
            updateDashboard();
        }, 250);
    }

    function createManySourcesScenario() {
        const slot = createViewerSlot("many", "Many-source viewer");
        const viewer = createViewer(slot.id, {
            showNavigator: true,
            sharedContextKey: null
        });

        activeViewers.push({
            id: "many",
            label: "Many-source viewer",
            viewer,
            slot
        });

        const sourceSpecs = getManySourceSpecs(state.manySourceCount);
        let loadedSources = 0;

        setViewerStatus(slot, `Loading 0/${sourceSpecs.length} sources...`, "info");

        sourceSpecs.forEach((spec, index) => {
            viewer.addTiledImage({
                tileSource: spec.tileSource,
                x: spec.x,
                y: spec.y,
                width: spec.width,
                degrees: spec.degrees,
                opacity: spec.opacity,
                index,
                success: () => {
                    loadedSources++;
                    setViewerStatus(slot, `Loaded ${loadedSources}/${sourceSpecs.length} sources.`, "ok");
                    setStatus(`Many-source scenario loaded ${loadedSources}/${sourceSpecs.length} sources.`, "ok");
                    forceRedraw();
                },
                error: event => {
                    const message = `Failed to load source '${spec.label}': ${getEventMessage(event)}`;

                    setViewerStatus(slot, message, "error");
                    setStatus(message, "error");
                }
            });
        });
    }

    function createLargeGeoJSONScenario() {
        const slot = createViewerSlot("geojson", "Large GeoJSON viewer");
        const viewer = createViewer(slot.id, {
            showNavigator: true,
            sharedContextKey: null
        });

        activeViewers.push({
            id: "geojson",
            label: "Large GeoJSON viewer",
            viewer,
            slot
        });

        setViewerStatus(slot, "Loading large GeoJSON source...", "info");

        viewer.addTiledImage({
            tileSource: getLargeGeoJSONTileSource(),
            success: () => {
                const message =
                    `Large GeoJSON loaded. aggregation=${state.geojsonAggregation}, ` +
                    `spatialIndex=${state.geojsonSpatialIndex}, nativeLines=${state.geojsonNativeLines}.`;

                setViewerStatus(slot, message, "ok");
                setStatus(message, "ok");
                forceRedraw();
            },
            error: event => {
                const message = `Large GeoJSON failed: ${getEventMessage(event)}`;

                setViewerStatus(slot, message, "error");
                setStatus(message, "error");
            }
        });
    }

    function createTwoViewerScenario(shared) {
        const viewerA = createViewerSlot("context-a", shared ? "Shared context viewer A" : "Private context viewer A");
        const viewerB = createViewerSlot("context-b", shared ? "Shared context viewer B" : "Private context viewer B");
        const sharedContextKey = shared ? SHARED_CONTEXT_KEY : null;

        const osdA = createViewer(viewerA.id, {
            showNavigator: false,
            sharedContextKey
        });
        const osdB = createViewer(viewerB.id, {
            showNavigator: false,
            sharedContextKey
        });

        activeViewers.push({ id: "context-a", label: viewerA.label, viewer: osdA, slot: viewerA });
        activeViewers.push({ id: "context-b", label: viewerB.label, viewer: osdB, slot: viewerB });

        setViewerStatus(viewerA, "Loading source...", "info");
        setViewerStatus(viewerB, "Loading source...", "info");

        osdA.addTiledImage({
            tileSource: "../data/testpattern.dzi",
            success: () => {
                setViewerStatus(viewerA, "Loaded test pattern source.", "ok");
                forceRedraw();
            },
            error: event => {
                const message = `Context viewer A failed: ${getEventMessage(event)}`;

                setViewerStatus(viewerA, message, "error");
                setStatus(message, "error");
            }
        });

        osdB.addTiledImage({
            tileSource: "../data/iiif_2_0_sizes/info.json",
            success: () => {
                setViewerStatus(viewerB, "Loaded IIIF source.", "ok");
                forceRedraw();
            },
            error: event => {
                const message = `Context viewer B failed: ${getEventMessage(event)}`;

                setViewerStatus(viewerB, message, "error");
                setStatus(message, "error");
            }
        });

        setStatus(shared ?
            `Created two viewers with sharedContextKey '${SHARED_CONTEXT_KEY}'.` :
            "Created two viewers with private contexts.", "ok");
    }

    function createViewerSlot(id, label) {
        const containerId = `profiling-viewer-${id}`;
        const card = document.createElement("section");
        card.className = "viewer-card";
        card.innerHTML = `
            <h4>${escapeHtml(label)}</h4>
            <div id="${containerId}" class="viewer-container"></div>
            <div class="viewer-status" data-viewer-status="${escapeHtml(id)}">Waiting for tiles...</div>
        `;

        dom.viewers.appendChild(card);

        return {
            id: containerId,
            key: id,
            label,
            card,
            status: card.querySelector("[data-viewer-status]")
        };
    }

    function createViewer(elementId, options = {}) {
        return OpenSeadragon({
            id: elementId,
            prefixUrl: "../../openseadragon/images/",
            minZoomImageRatio: 0.01,
            maxZoomPixelRatio: 100,
            minPixelRatio: 1.2,
            smoothTileEdgesMinZoom: 1.1,
            crossOriginPolicy: "Anonymous",
            ajaxWithCredentials: false,
            drawer: "flex-renderer",
            drawerOptions: {
                "flex-renderer": {
                    debug: false,
                    webGLPreferredVersion: "2.0",
                    sharedContextKey: options.sharedContextKey || null,
                    profiling: getProfilingOptions(),
                    backgroundColor: "#00000000"
                }
            },
            blendTime: 0,
            showNavigator: options.showNavigator === true
        });
    }

    function getManySourceSpecs(count) {
        const baseSources = [
            { label: "Rainbow grid", tileSource: "../data/testpattern.dzi" },
            { label: "Leaves", tileSource: "../data/iiif_2_0_sizes/info.json" },
            { label: "A", tileSource: { type: "image", url: "../data/A.png" } },
            { label: "Blue B", tileSource: { type: "image", url: "../data/BBlue.png" } }
        ];
        const specs = [];

        for (let i = 0; i < count; i++) {
            const base = baseSources[i % baseSources.length];
            const column = i % 4;
            const row = Math.floor(i / 4);
            const width = 0.62 + (i % 3) * 0.16;

            specs.push({
                ...base,
                x: column * 0.18,
                y: row * 0.16,
                width,
                degrees: 0,
                opacity: 0.64
            });
        }

        return specs;
    }

    function getLargeGeoJSONTileSource() {
        return {
            type: "geojson",
            url: LARGE_GEOJSON_URL,
            width: LARGE_GEOJSON_SIZE,
            height: LARGE_GEOJSON_SIZE,
            maxLevel: 25,
            useNativeLines: state.geojsonNativeLines,
            style: {
                pointSize: 8,
                pointColor: [1, 0.2, 0.2, 1],
                lineWidth: 2,
                lineColor: [0.1, 0.85, 0.2, 1],
                fillColor: [0.1, 0.35, 1, 0.45]
            },
            aggregation: {
                enabled: state.geojsonAggregation,
                threshold: 25,
                badgeSize: 64,
                badgeColor: [1, 0.6, 0.05, 0.9],
                labelColor: [0, 0, 0, 1],
                labelSize: 26,
                labelStrokeWidth: 3,
                maxLabelValue: 999,
                useSpatialIndex: state.geojsonSpatialIndex
            }
        };
    }


    function patchGeoJSONSpatialIndexOption() {
        if (!$.GeoJSONTileSource || $.GeoJSONTileSource.prototype.__profilingSpatialIndexPatch) {
            return;
        }

        if (typeof $.__GEOJSON_WORKER_SOURCE__ === "string" && !$.__GEOJSON_WORKER_SOURCE__.includes("message.useSpatialIndex === false ? null")) {
            $.__GEOJSON_WORKER_SOURCE__ = $.__GEOJSON_WORKER_SOURCE__.replace(
                "STATE.spatialIndex = createSpatialIndex(STATE.geometries);",
                "STATE.spatialIndex = message.useSpatialIndex === false ? null : createSpatialIndex(STATE.geometries);"
            );
        }

        $.GeoJSONTileSource.prototype._configureWorker = function() {
            this._worker.onmessage = (event) => {
                this._handleWorkerMessage(event.data || {});
            };

            this._worker.onerror = (event) => {
                this._workerError = event.message || "GeoJSON worker failed.";
                this._failAllPending(this._workerError);
            };

            this._worker.onmessageerror = () => {
                this._workerError = "GeoJSON worker sent an unreadable message.";
                this._failAllPending(this._workerError);
            };

            this._worker.postMessage({
                type: "config",
                url: this._url,
                tileSize: this._tileSize,
                minLevel: this.minLevel,
                maxLevel: this.maxLevel,
                bbox: this.bbox,
                width: this.dimensions.x,
                height: this.dimensions.y,
                style: this.style,
                useNativeLines: this.useNativeLines,
                useSpatialIndex: !(this.aggregation && this.aggregation.useSpatialIndex === false),
                aggregation: this.aggregation
            });
        };

        $.GeoJSONTileSource.prototype.__profilingSpatialIndexPatch = true;
    }

    function destroyActiveViewers() {
        for (const entry of activeViewers) {
            try {
                if (entry.viewer && typeof entry.viewer.destroy === "function") {
                    entry.viewer.destroy();
                }
            } catch (error) {
                $.console.warn("Failed to destroy profiling demo viewer.", error);
            }
        }

        activeViewers = [];
    }

    function applyProfilingOptionsToAll() {
        for (const entry of activeViewers) {
            const renderer = getViewerRenderer(entry.viewer);

            if (renderer && typeof renderer.setProfilingEnabled === "function") {
                renderer.setProfilingEnabled(state.profilingEnabled, getProfilingOptions());
            }
        }
    }

    function getProfilingOptions() {
        return {
            enabled: state.profilingEnabled,
            maxFrames: state.maxFrames,
            includeTileSources: state.includeTileSources
        };
    }

    function clearProfiling() {
        for (const entry of activeViewers) {
            const renderer = getViewerRenderer(entry.viewer);

            if (renderer && typeof renderer.clearProfiling === "function") {
                renderer.clearProfiling();
            }
        }

        updateDashboard();
    }

    function startSampling() {
        stopSampling();
        sampleTimer = window.setInterval(forceRedraw, state.sampleInterval);
    }

    function stopSampling() {
        if (sampleTimer) {
            window.clearInterval(sampleTimer);
            sampleTimer = null;
        }
    }

    function startMotion() {
        stopMotion();
        motionStep = 0;
        motionTimer = window.setInterval(() => {
            motionStep++;
            for (const entry of activeViewers) {
                const viewport = entry.viewer && entry.viewer.viewport;
                if (!viewport) {
                    continue;
                }

                const phase = motionStep * 0.35;
                const x = 0.5 + Math.sin(phase) * 0.16;
                const y = 0.5 + Math.cos(phase * 0.8) * 0.12;
                const zoom = 1.15 + Math.sin(phase * 0.55) * 0.55;

                viewport.panTo(new OpenSeadragon.Point(x, y));
                viewport.zoomTo(Math.max(0.2, zoom));
                entry.viewer.forceRedraw();
            }

            updateDashboard();
        }, Math.max(120, state.sampleInterval));
    }

    function stopMotion() {
        if (motionTimer) {
            window.clearInterval(motionTimer);
            motionTimer = null;
        }
    }

    function forceRedraw() {
        for (const entry of activeViewers) {
            if (entry.viewer && typeof entry.viewer.forceRedraw === "function") {
                entry.viewer.forceRedraw();
            }
        }

        window.setTimeout(updateDashboard, 0);
    }

    function updateDashboard() {
        const primarySnapshot = getPrimarySnapshot();

        renderKpis(primarySnapshot);
        renderFrameTimeline(primarySnapshot);
        renderLatestBreakdown(primarySnapshot);
        renderLatestDetails(primarySnapshot);
        renderSparklines(primarySnapshot);
        renderComparisonResults();

        if (dom.raw) {
            dom.raw.textContent = JSON.stringify(getAllSnapshots(), null, 2);
        }
    }

    function getPrimarySnapshot() {
        const renderer = activeViewers.length ? getViewerRenderer(activeViewers[0].viewer) : null;

        if (!renderer || typeof renderer.getProfilingSnapshot !== "function") {
            return null;
        }

        return renderer.getProfilingSnapshot();
    }

    function getAllSnapshots() {
        return activeViewers.map(entry => ({
            id: entry.id,
            label: entry.label,
            snapshot: getSnapshotForViewer(entry.viewer)
        }));
    }

    function getSnapshotForViewer(viewer) {
        const renderer = getViewerRenderer(viewer);

        if (!renderer || typeof renderer.getProfilingSnapshot !== "function") {
            return null;
        }

        return renderer.getProfilingSnapshot();
    }

    function getViewerRenderer(viewer) {
        return viewer && viewer.drawer && viewer.drawer.renderer ? viewer.drawer.renderer : null;
    }

    function renderKpis(snapshot) {
        if (!dom.kpis) {
            return;
        }

        const bottleneck = inferBottleneck(snapshot);
        const latest = snapshot && snapshot.latestFrame || {};
        const avg = snapshot && snapshot.averages && snapshot.averages.renderedFramesOnly || {};
        const sharedCount = getSharedContextEntryCount();

        dom.kpis.innerHTML = [
            renderKpi("Scenario", SCENARIOS[state.scenario].label),
            renderKpi("Active viewers", String(activeViewers.length)),
            renderKpi("Latest frame", formatMs(latest.totalMs)),
            renderKpi("Avg rendered", formatMs(avg.totalMs)),
            renderKpi("Likely bottleneck", bottleneck),
            renderKpi("Avg tile spans", formatMs(avg.tileSourceMs)),
            renderKpi("Skipped", snapshot ? String(snapshot.skippedFrameCount || 0) : "0"),
            renderKpi("Shared entries", String(sharedCount))
        ].join("");
    }

    function renderKpi(label, value) {
        return `
            <div class="kpi-card">
                <p class="kpi-card__label">${escapeHtml(label)}</p>
                <p class="kpi-card__value">${escapeHtml(value)}</p>
            </div>
        `;
    }

    function inferBottleneck(snapshot) {
        if (!snapshot || !snapshot.averages || !snapshot.averages.renderedFramesOnly) {
            return "none";
        }

        const avg = snapshot.averages.renderedFramesOnly;
        const entries = [
            ["drawer", avg.drawerMs],
            ["first pass", avg.firstPassMs],
            ["second pass", avg.secondPassMs],
            ["gl.finish", avg.finishMs],
            ["tile source", avg.tileSourceMs]
        ];
        const best = entries.reduce((winner, entry) => Number(entry[1]) > Number(winner[1]) ? entry : winner, entries[0]);

        return `${best[0]} (${formatMs(best[1])})`;
    }

    function renderFrameTimeline(snapshot) {
        if (!dom.frameTimeline) {
            return;
        }

        const frames = snapshot && Array.isArray(snapshot.frames) ? snapshot.frames : [];
        if (!frames.length) {
            dom.frameTimeline.textContent = "No frames recorded yet.";
            renderLegend(dom.frameTimelineLegend, getPipelineLegend());
            return;
        }

        const frameSegments = frames.map(frame => ({
            frame,
            segments: getFramePipelineSegments(frame)
        }));

        const frameTotals = frameSegments.map(item => sumSegments(item.segments));
        const dataMaxMs = Math.max(0, ...frameTotals);

        /*
         * Scale to the observed data instead of forcing a 33.33 ms upper bound.
         * This makes normal sub-16 ms frames visible while still leaving headroom.
         */
        const maxMs = Math.max(1, dataMaxMs * 1.2);
        const width = 920;
        const height = 154;
        const padding = { left: 44, right: 8, top: 16, bottom: 22 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        const slotWidth = chartWidth / Math.max(1, frameSegments.length);
        const barWidth = Math.max(2, Math.min(10, slotWidth * 0.7));
        let svg = `<svg class="svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Frame timing history">`;

        svg += `<text x="4" y="10" font-size="9" fill="${COLORS.text}">scale max ${escapeSvg(formatMs(maxMs))}</text>`;

        if (16.67 <= maxMs) {
            svg += renderBudgetLine(16.67, maxMs, width, padding, chartHeight, "16.67");
        }

        if (33.33 <= maxMs) {
            svg += renderBudgetLine(33.33, maxMs, width, padding, chartHeight, "33.33");
        }

        svg += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="${COLORS.axis}" />`;

        frameSegments.forEach((item, index) => {
            const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;

            if (item.frame && item.frame.skipped) {
                const y = padding.top + chartHeight - 8;
                svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="8" fill="${COLORS.skipped}" stroke="#111827" stroke-width="0.5" />`;
                return;
            }

            let yCursor = padding.top + chartHeight;

            for (const segment of item.segments) {
                const rawHeight = maxMs > 0 ? (segment.value / maxMs) * chartHeight : 0;
                const segmentHeight = segment.value > 0 ? Math.max(1, rawHeight) : 0;

                yCursor -= segmentHeight;
                svg += `<rect x="${x}" y="${yCursor}" width="${barWidth}" height="${segmentHeight}" fill="${segment.color}" />`;
            }
        });

        svg += `</svg>`;
        dom.frameTimeline.innerHTML = svg;
        renderLegend(dom.frameTimelineLegend, getPipelineLegend().concat([{ label: "skipped", color: COLORS.skipped }]));
    }

    function renderLatestBreakdown(snapshot) {
        if (!dom.latestBreakdown) {
            return;
        }

        const frame = snapshot && snapshot.latestFrame;
        if (!frame) {
            dom.latestBreakdown.textContent = "No latest frame recorded yet.";
            renderLegend(dom.latestBreakdownLegend, getPipelineLegend());
            return;
        }

        const renderer = frame.renderer || {};
        const drawer = frame.drawer || {};
        const segments = getFramePipelineSegments(frame);

        const wrapper = document.createElement("div");
        const chart = document.createElement("div");

        renderStackedBar(chart, segments, {
            width: 580,
            height: 58,
            label: frame.skipped ? `Skipped: ${frame.skipReason || "unknown"}` : `Total ${formatMs(frame.totalMs)}`
        });

        wrapper.appendChild(chart);

        const detail = document.createElement("div");
        detail.className = "latest-breakdown-details";
        detail.innerHTML = [
            renderCompactMetric("Drawer", drawer.totalMs),
            renderCompactMetric("First", renderer.firstPassMs),
            renderCompactMetric("Second", renderer.secondPassMs),
            renderCompactMetric("Finish", renderer.finishMs),
            renderCompactMetric("Tiles", drawer.tileCount),
            renderCompactMetric("Sources", drawer.sourceCount)
        ].join("");

        wrapper.appendChild(detail);

        dom.latestBreakdown.innerHTML = "";
        dom.latestBreakdown.appendChild(wrapper);

        renderLegend(dom.latestBreakdownLegend, getPipelineLegend());
    }

    function renderCompactMetric(label, value) {
        const renderedValue = Number.isFinite(Number(value)) && String(label).toLowerCase() !== "tiles" && String(label).toLowerCase() !== "sources" ?
            formatMs(value) :
            valueOrZero(value);

        return `
        <div class="compact-metric">
            <span class="compact-metric__label">${escapeHtml(label)}</span>
            <span class="compact-metric__value">${escapeHtml(renderedValue)}</span>
        </div>
    `;
    }

    function renderLatestDetails(snapshot) {
        if (!dom.latestDetails) {
            return;
        }

        const viewerRows = activeViewers.map(entry => renderViewerSnapshotDetails(entry)).join("");
        const frame = snapshot && snapshot.latestFrame;
        const renderer = frame && frame.renderer || {};
        const drawer = frame && frame.drawer || {};
        const shared = renderer.sharedContext || {};
        const tileSources = frame && Array.isArray(frame.tileSources) ? frame.tileSources : [];
        const latestRows = [
            renderDetail("Primary frame", frame ? valueOrZero(frame.frameId) : "none"),
            renderDetail("Total", frame ? formatMs(frame.totalMs) : "0.00 ms"),
            renderDetail("Drawer", formatMs(drawer.totalMs)),
            renderDetail("First pass", formatMs(renderer.firstPassMs)),
            renderDetail("Second pass", formatMs(renderer.secondPassMs)),
            renderDetail("gl.finish", formatMs(renderer.finishMs)),
            renderDetail("Tile count", valueOrZero(drawer.tileCount)),
            renderDetail("Source count", valueOrZero(drawer.sourceCount)),
            renderDetail("Tile spans", String(tileSources.length)),
            renderDetail("Shared", shared.enabled ? (shared.key || "true") : "private")
        ].join("");

        dom.latestDetails.innerHTML = latestRows + viewerRows + renderTileSourceDetails(tileSources);
    }

    function renderViewerSnapshotDetails(entry) {
        const snapshot = getSnapshotForViewer(entry.viewer);
        const avg = snapshot && snapshot.averages && snapshot.averages.renderedFramesOnly || {};
        const renderer = getViewerRenderer(entry.viewer);
        return [
            renderDetail(`${entry.label} frames`, snapshot ? valueOrZero(snapshot.frameCount) : "0"),
            renderDetail(`${entry.label} avg`, formatMs(avg.totalMs)),
            renderDetail(`${entry.label} mode`, renderer && renderer.isSharedContext && renderer.isSharedContext() ? "shared" : "private")
        ].join("");
    }

    function renderTileSourceDetails(tileSources) {
        if (!tileSources.length) {
            return renderDetail("GeoJSON spans", "none in latest frame");
        }

        const sorted = tileSources.slice().sort((a, b) => (Number(b.totalMs) || 0) - (Number(a.totalMs) || 0)).slice(0, 4);
        return sorted.map((span, index) => renderDetail(
            `Tile span ${index + 1}`,
            `${formatMs(span.totalMs)} f=${valueOrZero(span.featureCount)} v=${valueOrZero(span.vertexCount)} i=${valueOrZero(span.indexCount)}`
        )).join("");
    }

    function renderSparklines(snapshot) {
        if (!dom.sparklines) {
            return;
        }

        const previousScrollTop = dom.sparklines.scrollTop;

        const frames = snapshot && Array.isArray(snapshot.frames) ? snapshot.frames : [];
        if (!frames.length) {
            dom.sparklines.textContent = "No frame history available.";
            restoreScrollTop(dom.sparklines, previousScrollTop);
            return;
        }

        const series = [
            { label: "total frame", values: frames.map(frame => frame.totalMs || 0), color: "#2563eb" },
            { label: "drawer setup", values: frames.map(frame => frame.drawer && frame.drawer.totalMs || 0), color: COLORS.drawer },
            { label: "first pass", values: frames.map(frame => frame.renderer && frame.renderer.firstPassMs || 0), color: COLORS.firstPass },
            { label: "second pass", values: frames.map(frame => frame.renderer && frame.renderer.secondPassMs || 0), color: COLORS.secondPass },
            { label: "gl.finish wait", values: frames.map(frame => frame.renderer && frame.renderer.finishMs || 0), color: COLORS.finish },
            { label: "tile-source work", values: frames.map(frame => getTileSourceTotal(frame)), color: COLORS.tileSource }
        ];

        dom.sparklines.innerHTML = series.map(renderSparkline).join("");
        restoreScrollTop(dom.sparklines, previousScrollTop);
    }

    function captureCurrentResult() {
        const snapshots = getAllSnapshots();
        const primary = snapshots[0] && snapshots[0].snapshot;
        const avg = primary && primary.averages && primary.averages.renderedFramesOnly || {};
        const latest = primary && primary.latestFrame || {};

        captureRows.push({
            capturedAt: new Date().toISOString(),
            scenario: state.scenario,
            label: buildCaptureLabel(),
            viewerCount: activeViewers.length,
            frameCount: primary ? primary.frameCount : 0,
            avgTotalMs: avg.totalMs || 0,
            avgDrawerMs: avg.drawerMs || 0,
            avgFirstPassMs: avg.firstPassMs || 0,
            avgSecondPassMs: avg.secondPassMs || 0,
            avgFinishMs: avg.finishMs || 0,
            avgTileSourceMs: avg.tileSourceMs || 0,
            latestTileSpans: latest && Array.isArray(latest.tileSources) ? latest.tileSources.length : 0,
            snapshots
        });

        renderComparisonResults();
        setStatus("Captured current profiling row.", "ok");
    }

    function buildCaptureLabel() {
        if (state.scenario === "large-geojson") {
            return `agg=${state.geojsonAggregation} spatial=${state.geojsonSpatialIndex} native=${state.geojsonNativeLines}`;
        }

        if (state.scenario === "many-sources") {
            return `sources=${state.manySourceCount} motion=${!!(dom.motionEnabled && dom.motionEnabled.checked)}`;
        }

        return state.scenario === "two-shared" ? "shared contexts" : "private contexts";
    }

    function clearCaptures() {
        captureRows = [];
        renderComparisonResults();
    }

    function renderComparisonResults() {
        if (!dom.comparisonResults) {
            return;
        }

        if (!captureRows.length) {
            dom.comparisonResults.innerHTML = `
        <div class="empty-comparison">
            No captured rows yet. Let the active scenario collect a few frames,
            then click <strong>Capture result</strong>. For GeoJSON profiling,
            capture separate rows for aggregation/spatial-index/native-line
            combinations. For context profiling, capture one row for private
            contexts and one row for shared context.
        </div>
    `;
            return;
        }

        const rows = captureRows.map((row, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(SCENARIOS[row.scenario].label)}</td>
                <td>${escapeHtml(row.label)}</td>
                <td>${escapeHtml(valueOrZero(row.viewerCount))}</td>
                <td>${escapeHtml(valueOrZero(row.frameCount))}</td>
                <td>${escapeHtml(formatMs(row.avgTotalMs))}</td>
                <td>${escapeHtml(formatMs(row.avgDrawerMs))}</td>
                <td>${escapeHtml(formatMs(row.avgFirstPassMs))}</td>
                <td>${escapeHtml(formatMs(row.avgSecondPassMs))}</td>
                <td>${escapeHtml(formatMs(row.avgFinishMs))}</td>
                <td>${escapeHtml(formatMs(row.avgTileSourceMs))}</td>
                <td>${escapeHtml(valueOrZero(row.latestTileSpans))}</td>
            </tr>
        `).join("");

        dom.comparisonResults.innerHTML = `
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Scenario</th>
                        <th>Config</th>
                        <th>Viewers</th>
                        <th>Frames</th>
                        <th>Total</th>
                        <th>Drawer</th>
                        <th>First</th>
                        <th>Second</th>
                        <th>Finish</th>
                        <th>Tile</th>
                        <th>Spans</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    function renderStackedBar(container, segments, options = {}) {
        const width = options.width || 580;
        const height = options.height || 58;
        const total = Math.max(1, sumSegments(segments));
        let x = 0;
        let svg = `<svg class="svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Stacked timing bar">`;

        svg += `<text x="0" y="11" font-size="10" fill="${COLORS.text}">${escapeSvg(options.label || "")}</text>`;

        for (const segment of segments) {
            const segmentWidth = (segment.value / total) * width;
            svg += `<rect x="${x}" y="18" width="${segmentWidth}" height="18" fill="${segment.color}" />`;
            if (segmentWidth > 50) {
                svg += `<text x="${x + 4}" y="31" font-size="9" fill="#111827">${escapeSvg(formatMs(segment.value))}</text>`;
            }
            x += segmentWidth;
        }

        svg += `<rect x="0" y="18" width="${width}" height="18" fill="none" stroke="#111827" stroke-width="0.5" />`;
        svg += `</svg>`;
        container.innerHTML = svg;
    }

    function renderSparkline(series) {
        const width = 560;
        const height = 52;
        const values = series.values || [];
        const maxValue = Math.max(1, ...values);
        const points = values.map((value, index) => {
            const x = values.length <= 1 ? 0 : index / (values.length - 1) * (width - 8) + 4;
            const y = 8 + (height - 16) - ((Number(value) || 0) / maxValue) * (height - 16);
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(" ");
        const latest = values.length ? values[values.length - 1] : 0;

        return `
            <div class="sparkline-card">
                <div class="sparkline-label">${escapeHtml(series.label)} latest ${escapeHtml(formatMs(latest))}, max ${escapeHtml(formatMs(maxValue))}</div>
                <svg class="svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(series.label)} sparkline">
                    <line x1="4" y1="${height - 8}" x2="${width - 4}" y2="${height - 8}" stroke="${COLORS.axis}" />
                    <polyline points="${points}" fill="none" stroke="${series.color}" stroke-width="2" />
                </svg>
            </div>
        `;
    }

    function renderBudgetLine(value, maxMs, width, padding, chartHeight, label) {
        if (!Number.isFinite(value) || !Number.isFinite(maxMs) || maxMs <= 0 || value > maxMs) {
            return "";
        }

        const y = padding.top + chartHeight - (value / maxMs) * chartHeight;

        return `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${COLORS.budget}" stroke-dasharray="4 4" stroke-width="0.8" />
        <text x="4" y="${y + 3}" font-size="9" fill="${COLORS.text}">${escapeSvg(label)}</text>
    `;
    }

    function renderLegend(container, items) {
        if (!container) {
            return;
        }

        container.innerHTML = items.map(item => `
            <span class="legend-item">
                <span class="legend-swatch" style="background:${escapeHtml(item.color)}"></span>
                ${escapeHtml(item.label)}
            </span>
        `).join("");
    }

    function renderDetail(label, value) {
        return `
            <div class="detail-row">
                <span class="detail-label">${escapeHtml(label)}</span>
                <span class="detail-value">${escapeHtml(value)}</span>
            </div>
        `;
    }

    function getFramePipelineSegments(frame) {
        const renderer = frame && frame.renderer || {};
        const drawer = frame && frame.drawer || {};

        if (frame && frame.skipped) {
            return [{ label: "skipped", value: Math.max(0.001, Number(frame.totalMs) || 0.001), color: COLORS.skipped }];
        }

        return [
            { label: "drawer", value: Number(drawer.totalMs) || 0, color: COLORS.drawer },
            { label: "first pass", value: Number(renderer.firstPassMs) || 0, color: COLORS.firstPass },
            { label: "second pass", value: Number(renderer.secondPassMs) || 0, color: COLORS.secondPass },
            { label: "gl.finish", value: Number(renderer.finishMs) || 0, color: COLORS.finish }
        ];
    }

    function getPipelineLegend() {
        return [
            { label: "drawer", color: COLORS.drawer },
            { label: "first pass", color: COLORS.firstPass },
            { label: "second pass", color: COLORS.secondPass },
            { label: "gl.finish", color: COLORS.finish }
        ];
    }

    function getTileSourceTotal(frame) {
        if (!frame || !Array.isArray(frame.tileSources)) {
            return 0;
        }

        return frame.tileSources.reduce((total, span) => total + (Number(span.totalMs) || 0), 0);
    }

    function getSharedContextEntryCount() {
        if ($.FlexRenderer && typeof $.FlexRenderer.getSharedContextStatus === "function") {
            return $.FlexRenderer.getSharedContextStatus().length;
        }

        return 0;
    }

    function sumSegments(segments) {
        return segments.reduce((total, segment) => total + (Number(segment.value) || 0), 0);
    }

    function copySnapshotJson() {
        const text = JSON.stringify({ snapshots: getAllSnapshots(), captures: captureRows }, null, 2);

        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(text);
            setStatus("Profiling JSON copied to clipboard.", "ok");
            return;
        }

        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setStatus("Profiling JSON copied to clipboard.", "ok");
    }

    function downloadSnapshotJson() {
        const blob = new Blob([JSON.stringify({ snapshots: getAllSnapshots(), captures: captureRows }, null, 2)], { type: "application/json" });
        const link = document.createElement("a");

        link.href = URL.createObjectURL(blob);
        link.download = `flex-renderer-profiling-${state.scenario}-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();

        window.setTimeout(() => {
            URL.revokeObjectURL(link.href);
            document.body.removeChild(link);
        }, 0);
    }

    function setStatus(message, kind = "info") {
        if (!dom.status) {
            return;
        }

        dom.status.className = "viewer-status";
        if (kind === "ok") {
            dom.status.classList.add("viewer-status--ok");
        } else if (kind === "error") {
            dom.status.classList.add("viewer-status--error");
        }
        dom.status.textContent = message;
    }

    function setViewerStatus(slot, message, kind = "info") {
        if (!slot || !slot.status) {
            return;
        }

        slot.status.className = "viewer-status";

        if (kind === "ok") {
            slot.status.classList.add("viewer-status--ok");
        } else if (kind === "error") {
            slot.status.classList.add("viewer-status--error");
        }

        slot.status.textContent = message;
    }

    function setEntryStatus(entry, message, kind = "info") {
        if (!entry) {
            return;
        }

        setViewerStatus(entry.slot, message, kind);
    }

    function getEventMessage(event) {
        return event && event.message ? event.message : "unknown error";
    }

    function restoreScrollTop(element, scrollTop) {
        if (!element) {
            return;
        }

        const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
        element.scrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);
    }

    function formatMs(value) {
        const number = Number(value);
        return Number.isFinite(number) ? `${number.toFixed(2)} ms` : "0.00 ms";
    }

    function valueOrZero(value) {
        const number = Number(value);
        return Number.isFinite(number) ? String(number) : "0";
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function escapeSvg(value) {
        return escapeHtml(value);
    }

    window.addEventListener("beforeunload", () => {
        stopSampling();
        stopMotion();
        destroyActiveViewers();
    });
})(OpenSeadragon);
