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
        if (!config || typeof config !== "object" || !Array.isArray(config.series)) {
            return config;
        }

        const expand = typeof context.expandDataSourceRef === "function"
            ? context.expandDataSourceRef
            : null;

        if (!expand) {
            return config;
        }

        config.series = config.series.map((entry, index) => expand(entry, {
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

    _normalizeTimelineConfig(seriesLength) {
        const defs = this.constructor.defaultControls || {};
        const config = this.getConfig();
        const params = config.params || (config.params = {});
        const required = defs.timeline && defs.timeline.required ? $.extend(true, {}, defs.timeline.required) : {};
        const fallback = defs.timeline && defs.timeline.default ? $.extend(true, {}, defs.timeline.default) : {};
        let timeline = $.extend(true, {}, fallback, required, params.timeline || {});

        if (!timeline.type) {
            timeline.type = "range_input";
        }

        const step = Number(timeline.step);
        timeline.step = Number.isFinite(step) && step > 0 ? step : 1;

        const min = Number(timeline.min);
        timeline.min = Number.isFinite(min) ? min : 0;

        if ((timeline.min % timeline.step) !== 0) {
            timeline.min = 0;
        }

        const maxIndex = Math.max(0, seriesLength - 1);
        timeline.max = timeline.min + maxIndex * timeline.step;

        const defaultValue = Number(timeline.default);
        if (!Number.isFinite(defaultValue) || ((defaultValue - timeline.min) % timeline.step) !== 0) {
            timeline.default = timeline.min;
        } else {
            timeline.default = Math.max(timeline.min, Math.min(timeline.max, defaultValue));
        }

        params.timeline = timeline;
        return timeline;
    }

    _getActiveSeriesOffset() {
        if (!this.timeline) {
            return 0;
        }

        const params = this.timeline.params || {};
        const min = Number(params.min) || 0;
        const step = Number(params.step) || 1;
        const encoded = Number.parseInt(this.timeline.encodedValue, 10);
        if (!Number.isFinite(encoded)) {
            const fallback = Number(params.default);
            return Number.isFinite(fallback) ? Math.max(0, Math.round((fallback - min) / step)) : 0;
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
        const activeWorldIndex = Number.isInteger(activeEntry) ? activeEntry : null;

        return {
            id: `${this.id}_delegate`,
            name: config.name || "Time series delegate",
            type: config.seriesRenderer || "identity",
            visible: 1,
            fixed: false,
            tiledImages: activeWorldIndex === null ? [] : [activeWorldIndex],
            params: config.params || {},
            cache: config.cache || {}
        };
    }

    construct() {
        const config = this.getConfig();
        const series = (config && config.series) || [];
        const activeEntry = this._getActiveSeriesEntry(series);

        this._normalizeTimelineConfig(series.length);

        const delegateConfig = this._getDelegateShaderConfig(activeEntry);
        const DelegateShader = $.FlexRenderer.ShaderMediator.getClass(delegateConfig.type);
        if (!DelegateShader) {
            throw new Error(`time-series: unknown child shader type '${delegateConfig.type}'.`);
        }
        if (delegateConfig.type === this.constructor.type()) {
            throw new Error("time-series cannot recursively render itself.");
        }

        super.construct();

        this._renderer = new DelegateShader(`${this.id}_delegate`, {
            shaderConfig: delegateConfig,
            webglContext: this.webglContext,
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

        let lastOffset = this._getActiveSeriesOffset();
        this.timeline.on("default", () => {
            const nextOffset = this._getActiveSeriesOffset();

            if (nextOffset !== lastOffset) {
                lastOffset = nextOffset;
                this.requestSourceBinding(0, this._getActiveSeriesEntry(), {
                    reason: "time-series-source-change",
                    refreshShader: true,
                    rebuildProgram: true,
                    rebuildDrawer: true,
                    resetItems: true
                });
                return;
            }
            this.invalidate();
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
