(function($) {

$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "time-series";
    }

    static name() {
        return "Time Series";
    }

    static description() {
        return "Wrap one shader and switch its active source through a timeline control.";
    }

    static docs() {
        return {
            summary: "Wrapper shader that delegates rendering to another shader over a selectable series.",
            description: "The wrapper hosts one delegated shader and rewires its tiledImages source list to the currently selected series item. Series entries can be direct world indexes or lazy descriptors resolved externally through drawer.options.shaderSourceResolver.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: null,
                description: "Logical source slot used by the delegated shader. The active tiled image is picked from the series parameter."
            }],
            customParams: [
                {
                    name: "seriesRenderer",
                    default: "identity",
                    description: "Shader type used internally for rendering the selected series element."
                },
                {
                    name: "series",
                    description: "Array of source descriptors addressable through the timeline control. Items can be direct world indexes or opaque entries resolved lazily by drawer.options.shaderSourceResolver."
                }
            ],
            controls: [
                {
                    name: "timeline",
                    ui: "range_input",
                    valueType: "float",
                    required: { type: "range_input" }
                }
            ],
            notes: [
                "Opacity is disabled on this wrapper shader.",
                "Series entries can be direct world indexes or lazy descriptors resolved externally.",
                "Selection changes request source rebinding through the drawer so delegated shaders can react to source metadata changes."
            ]
        };
    }

    static get customParams() {
        return {
            seriesRenderer: {
                usage: "Specify shader type to use in this series. Attach the shader properties as you would normally do with your desired shader.",
                type: "string",
                default: "identity"
            },
            series: {
                type: "json",
                usage: "Specify source descriptors available through the timeline control. Entries may be direct world tiled-image indexes or arbitrary objects/IDs later resolved by drawer.options.shaderSourceResolver."
            }
        };
    }

    static _readWrapperParam(config, name, fallback = undefined) {
        const params = (config && config.params) || {};
        if (params[name] !== undefined) {
            return params[name];
        }
        if (config && config[name] !== undefined) {
            return config[name];
        }
        return fallback;
    }

    static get defaultControls() {
        return {
            timeline: {
                default: { title: "Timeline: " },
                accepts: type => type === "float",
                required: { type: "range_input" }
            },
            opacity: false
        };
    }

    static normalizeConfig(config, context = {}) {
        if (!config || typeof config !== "object") {
            return config;
        }

        const params = config.params || (config.params = {});
        if (config.series !== undefined && params.series === undefined) {
            params.series = config.series;
        }
        if (config.seriesRenderer !== undefined && params.seriesRenderer === undefined) {
            params.seriesRenderer = config.seriesRenderer;
        }

        const series = Array.isArray(params.series) ? params.series : [];
        const defs = this.defaultControls || {};
        const required = defs.timeline && defs.timeline.required ? $.extend(true, {}, defs.timeline.required) : {};
        const fallback = defs.timeline && defs.timeline.default ? $.extend(true, {}, defs.timeline.default) : {};
        const timeline = $.extend(true, {}, fallback, required, params.timeline || {});

        timeline.type = "range_input";

        const step = Number(timeline.step);
        timeline.step = Number.isFinite(step) && step > 0 ? step : 1;

        const min = Number(timeline.min);
        timeline.min = Number.isFinite(min) ? min : 0;

        if ((timeline.min % timeline.step) !== 0) {
            timeline.min = 0;
        }

        const maxIndex = Math.max(0, series.length - 1);
        timeline.max = timeline.min + maxIndex * timeline.step;

        const defaultValue = Number(timeline.default);
        if (!Number.isFinite(defaultValue) || ((defaultValue - timeline.min) % timeline.step) !== 0) {
            timeline.default = timeline.min;
        } else {
            timeline.default = Math.max(timeline.min, Math.min(timeline.max, defaultValue));
        }

        params.timeline = timeline;

        if (!Array.isArray(params.series)) {
            return config;
        }

        const expand = typeof context.expandDataSourceRef === "function"
            ? context.expandDataSourceRef
            : null;

        if (!expand) {
            return config;
        }

        params.series = params.series.map((entry, index) => expand(entry, {
            shaderType: this.type(),
            param: "series",
            entryIndex: index,
            config,
            context
        }));

        return config;
    }

    static sources() {
        return [{
            acceptsChannelCount: () => true,
            description: "Render the currently selected series item by the delegated shader."
        }];
    }

    getControlDefinitions() {
        const defs = $.extend(true, {}, this.constructor.defaultControls);
        const timeline = defs.timeline || (defs.timeline = {});
        const config = this.getConfig() || {};
        const params = config.params || {};
        timeline.default = $.extend(true, {}, timeline.default || {}, params.timeline || {});
        timeline.required = $.extend(true, {}, timeline.required || {}, { type: "range_input" });
        return defs;
    }

    _getActiveSeriesOffset() {
        const config = this.getConfig ? (this.getConfig() || {}) : (this.__shaderConfig || {});
        const timelineConfig = (config.params && config.params.timeline) || {};

        const min = Number(timelineConfig.min) || 0;
        const step = Number(timelineConfig.step) || 1;

        let encoded;
        if (this.timeline && this.timeline.encoded !== undefined) {
            encoded = Number.parseInt(this.timeline.encoded, 10);
        } else {
            encoded = Number.parseInt(timelineConfig.default, 10);
        }

        if (!Number.isFinite(encoded)) {
            encoded = min;
        }

        return Math.max(0, Math.round((encoded - min) / step));
    }

    _getActiveSeriesEntry(series) {
        if (!series.length) {
            return null;
        }
        const index = Math.max(0, Math.min(series.length - 1, this._getActiveSeriesOffset()));
        return series[index];
    }

    _getDelegateShaderConfig(activeEntry) {
        const config = this.getConfig();
        const activeWorldIndex = Number.isInteger(activeEntry)
            ? activeEntry
            : (Number.isInteger(activeEntry && activeEntry.worldIndex) ? activeEntry.worldIndex : null);
        const delegateParams = $.extend(true, {}, (config && config.params) || {});
        delete delegateParams.seriesRenderer;
        delete delegateParams.series;
        delete delegateParams.timeline;

        return {
            id: `${this.id}_delegate`,
            name: config.name || "Time series delegate",
            type: this.constructor._readWrapperParam(config, "seriesRenderer", "identity"),
            visible: 1,
            fixed: false,
            tiledImages: activeWorldIndex === null ? [] : [activeWorldIndex],
            params: delegateParams,
            cache: config.cache || {}
        };
    }

    construct() {
        const config = this.getConfig();
        const series = this.constructor._readWrapperParam(config, "series", []) || [];
        const timeline = (config.params && config.params.timeline) || {};
        const min = Number(timeline.min) || 0;
        const step = Number(timeline.step) || 1;
        const defaultValue = Number(timeline.default);
        const initialOffset = Number.isFinite(defaultValue) ? Math.max(0, Math.round((defaultValue - min) / step)) : 0;
        const activeEntry = series.length ? series[Math.max(0, Math.min(series.length - 1, initialOffset))] : null;

        super.construct();

        timeline.default = this.timeline.encoded || this.timeline.raw || config.params.timeline.default;

        const delegateConfig = this._getDelegateShaderConfig(activeEntry);

        // preserve a live source binding
        // across re-constructs. _refreshShadersForTiledImage (~line 11673) re-runs
        // construct() when a newly-opened series frame finishes loading. By that
        // point requestSourceBinding's mutation has already written
        // config.tiledImages[0] = newIdx; re-deriving from series[initialOffset]
        // would clobber it back to the original active entry, so first visits to
        // non-active frames render the active frame's data.
        const liveTiledImages = config.tiledImages;
        if (
            Array.isArray(liveTiledImages) &&
            liveTiledImages.length > 0 &&
            liveTiledImages.every(w => Number.isInteger(w) && w >= 0)
        ) {
            delegateConfig.tiledImages = liveTiledImages;
        }

        const DelegateShader = $.FlexRenderer.ShaderMediator.getClass(delegateConfig.type);
        if (!DelegateShader) {
            throw new Error(`time-series: unknown child shader type '${delegateConfig.type}'.`);
        }
        if (delegateConfig.type === this.constructor.type()) {
            throw new Error("time-series cannot recursively render itself.");
        }

        this._renderer = new DelegateShader(`${this.id}_delegate`, {
            shaderConfig: delegateConfig,
            backend: this.backend,
            params: delegateConfig.params,
            interactive: this._interactive,
            invalidate: this.invalidate,
            rebuild: this._rebuild,
            refresh: this._refresh,
            refetch: this._refetch
        });
        this._renderer.construct();
        this._renderer.removeControl("opacity");

        config.tiledImages = delegateConfig.tiledImages;

        if (!delegateConfig.tiledImages || delegateConfig.tiledImages.length < 1) {
            console.warn("time-series has no initial bound source", {
                id: this.id,
                config: this.getConfig(),
                activeEntry,
                delegateConfig
            });
        }
    }

    init() {
        super.init();
        this._renderer.init();

        // time-series scrub — was reading config.series (raw,
        // un-expanded by the data-source pipeline) and passing a raw integer to
        // requestSourceBinding, which routed to the integer-rebind shortcut and
        // bypassed the xOpat shaderSourceResolver. Drop lastOffset short-circuit
        // and delegate dedup to the resolver's cache-hit branch (it already
        // handles same-loadKey rebinds with all rebuild flags false).
        this.timeline.on("default", () => this.scrubTo(this._getActiveSeriesOffset()));
    }

    scrubTo(offset) {
        const series = this.constructor._readWrapperParam(this.getConfig(), "series", []);
        if (!Array.isArray(series) || series.length === 0) {
            return;
        }
        const idx = Math.max(0, Math.min(series.length - 1, Number(offset) | 0));
        this.requestSourceBinding(0, series[idx], {
            reason: "time-series-source-change",
            refreshShader: false,
            rebuildProgram: false,
            rebuildDrawer: false,
            resetItems: false
        });
    }

    destroy() {
        if (this._renderer) {
            this._renderer.destroy();
            this._renderer = null;
        }
    }

    getFragmentShaderDefinition() {
        return `
${super.getFragmentShaderDefinition()}
${this._renderer.getFragmentShaderDefinition()}`;
    }

    getFragmentShaderExecution() {
        return this._renderer.getFragmentShaderExecution();
    }

    glLoaded(program, gl) {
        super.glLoaded(program, gl);
        this._renderer.glLoaded(program, gl);
    }

    glDrawing(program, gl) {
        super.glDrawing(program, gl);
        this._renderer.glDrawing(program, gl);
    }

    htmlControls(wrapper = null, classes = "", css = "") {
        return `
${super.htmlControls(wrapper, classes, css)}
<h4>Rendering as ${this._renderer.constructor.name()}</h4>
${this._renderer.htmlControls(wrapper, classes, css)}`;
    }
});

})(OpenSeadragon);
