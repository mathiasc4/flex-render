(function($) {
    /**
     * Class-icon shader
     *
     * Scalar input is classified by the advanced slider control.
     * Each interval is mapped to its own icon texture.
     * The icon is then repeated over the visible class area using a configurable grid.
     */
    class IconMapShader extends $.FlexRenderer.ShaderLayer {
        static type() {
            return "iconmap";
        }

        static name() {
            return "IconMap";
        }

        static description() {
            return "maps scalar classes to repeated per-class icons";
        }

        static docs() {
            return {
                summary: "Scalar-to-icon class shader.",
                description: "Samples one scalar channel, classifies each sparse screen-space marker cell by the value at its center, maps each interval to its own icon texture, and renders the whole icon for that class.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "1D scalar data used for class selection"
                }],
                controls: [
                    { name: "use_channel0", default: "r" },
                    {
                        name: "threshold",
                        ui: "advanced_slider",
                        valueType: "float",
                        default: {
                            default: [0.25, 0.75],
                            mask: [1, 1, 1]
                        },
                        required: {
                            type: "advanced_slider",
                            inverted: false
                        }
                    },
                    {
                        name: "iconN",
                        ui: "icon",
                        valueType: "vec4",
                        description: "One icon control is generated per class interval."
                    },
                    { name: "grid_layout", ui: "select_int", valueType: "int", default: { default: 0 } },
                    { name: "cell_size", ui: "float", valueType: "float", default: { default: 15 } },
                    { name: "jitter", ui: "float", valueType: "float", default: { default: 0 } },
                    { name: "icon_scale", ui: "float", valueType: "float", default: { default: 0.82 } },
                    { name: "clip_icons", ui: "bool", valueType: "bool", default: { default: false } }
                ]
            };
        }

        static sources() {
            return [{
                acceptsChannelCount: (x) => x === 1,
                description: "1D scalar data used for class selection"
            }];
        }

        static get defaultControls() {
            return {
                use_channel0: {  // eslint-disable-line camelcase
                    default: "r"
                },
                threshold: {
                    default: {
                        type: "advanced_slider",
                        default: [0.25, 0.75],
                        mask: [1, 1, 1],
                        title: "Breaks",
                        pips: {
                            mode: "positions",
                            values: [0, 25, 50, 75, 100],
                            density: 4
                        }
                    },
                    accepts: (type) => type === "float",
                    required: { type: "advanced_slider", inverted: false }
                },
                icons: {
                    array: {
                        count: (layer) => layer._getClassCount(),
                        name: (index) => `icon${index}`,
                        item: (index, layer) => ({
                            default: {
                                type: "icon",
                                title: `Icon ${index + 1}`,
                                default: layer._getDefaultIconName(index),
                                size: 384,
                                padding: 10,
                                previewSize: 40
                            },
                            accepts: (type) => type === "vec4"
                        })
                    }
                },
                grid_layout: {  // eslint-disable-line camelcase
                    default: {
                        type: "select",
                        title: "Grid Layout",
                        default: 0,
                        options: [
                            { value: 0, label: "Square" },
                            { value: 1, label: "Brick" },
                            { value: 2, label: "Hex" }
                        ]
                    },
                    accepts: (type) => type === "int"
                },
                cell_size: { // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        title: "Cell Size (px)",
                        default: 15,
                        min: 3,
                        max: 50,
                        step: 1
                    },
                    accepts: (type) => type === "float"
                },
                jitter: {
                    default: {
                        type: "range_input",
                        title: "Jitter",
                        default: 0,
                        min: 0,
                        max: 0.45,
                        step: 0.01
                    },
                    accepts: (type) => type === "float"
                },
                icon_scale: { // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        title: "Icon Size",
                        default: 0.82,
                        min: 0.3,
                        max: 1.0,
                        step: 0.01
                    },
                    accepts: (type) => type === "float"
                },
                clip_icons: { // eslint-disable-line camelcase
                    default: {
                        type: "bool",
                        title: "Clip To Data",
                        default: false
                    },
                    accepts: (type) => type === "bool"
                }
            };
        }

        init() {
            if (this.threshold) {
                this.threshold.on("breaks", (raw) => {
                    const nextClassCount = Array.isArray(raw) ? raw.length + 1 : this._getClassCount();
                    if (nextClassCount !== this._getIconControlCount() && typeof this._refresh === "function") {
                        this._refresh();
                        return;
                    }
                    if (typeof this.threshold.syncMaskToIntervals === "function") {
                        this.threshold.syncMaskToIntervals((index) => index, true);
                    }
                    this.invalidate();
                }, true);
            }

            super.init();

            if (this.threshold && typeof this.threshold.syncMaskToIntervals === "function") {
                this.threshold.syncMaskToIntervals((index) => index, true);
                this.invalidate();
            }
        }

        _getClassCount() {
            if (this.threshold && Array.isArray(this.threshold.encodedValues)) {
                return this.threshold.getIntervalCount();
            }
            const configuredBreaks = this._getConfiguredThresholdBreaks();
            if (configuredBreaks) {
                return Math.max(1, configuredBreaks.length + 1);
            }
            const fallbackBreaks = this.constructor.defaultControls.threshold.default.default || [];
            return Math.max(1, fallbackBreaks.length + 1);
        }

        _getConfiguredThresholdBreaks() {
            const configured = this._customControls && this._customControls.threshold;
            if (!configured || typeof configured !== "object") {
                return null;
            }

            if (Array.isArray(configured.breaks)) {
                return configured.breaks;
            }

            if (Array.isArray(configured.default)) {
                return configured.default;
            }

            if (configured.default && typeof configured.default === "object" && Array.isArray(configured.default.default)) {
                return configured.default.default;
            }

            return null;
        }

        _getIconControlCount() {
            let count = 0;
            while (this._getIconControl(count)) {
                count++;
            }
            return count;
        }

        _getDefaultIconName(index) {
            const defaultIcons = ["diamond", "circle", "triangle-up", "square", "star", "flag", "plus", "check"];
            return defaultIcons[index % defaultIcons.length];
        }

        _getIconControl(index) {
            const control = this[`icon${index}`];
            return control && typeof control.sample === "function" ? control : null;
        }

        _buildGridHelpers() {
            const uid = this.uid;

            return `
float iconmap_decodeCellSize_${uid}(float rawValue) {
        return rawValue <= 1.0 ? mix(${this.cell_size.params.min}.0, ${this.cell_size.params.max}.0, clamp(rawValue, 0.0, 1.0)) : rawValue;
    }

float iconmap_hash_${uid}(vec2 value) {
        return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
    }

vec2 iconmap_hash2_${uid}(vec2 value) {
        return vec2(
            iconmap_hash_${uid}(value),
            iconmap_hash_${uid}(value + vec2(19.19, 73.73))
        );
    }

vec2 iconmap_jitterOffset_${uid}(vec2 cellId, vec2 spacing, float amount) {
        if (amount <= 0.0) {
            return vec2(0.0);
        }
        vec2 rnd = iconmap_hash2_${uid}(cellId) * 2.0 - 1.0;
        return rnd * amount * spacing;
    }

vec3 iconmap_squarePlacement_${uid}(vec2 fragCoord, float cellSize, float jitterAmount, bool brickLayout) {
        float row = floor(fragCoord.y / cellSize);
        float shift = brickLayout ? 0.5 * cellSize * mod(row, 2.0) : 0.0;
        float col = floor((fragCoord.x + shift) / cellSize);
        vec2 centerPx = vec2((col + 0.5) * cellSize - shift, (row + 0.5) * cellSize);
        centerPx += iconmap_jitterOffset_${uid}(vec2(col, row), vec2(cellSize), jitterAmount);
        return vec3(centerPx, cellSize);
    }

vec3 iconmap_hexPlacement_${uid}(vec2 fragCoord, float cellSize, float jitterAmount) {
        float rowHeight = cellSize * 0.8660254037844386;
        float baseRow = floor(fragCoord.y / rowHeight);
        vec2 bestCenter = fragCoord;
        float bestDist2 = 1e30;

        for (int rowOffset = -1; rowOffset <= 1; rowOffset++) {
            float row = baseRow + float(rowOffset);
            float shift = 0.5 * cellSize * mod(row, 2.0);
            float colBase = floor((fragCoord.x + shift) / cellSize);

            for (int colOffset = -1; colOffset <= 1; colOffset++) {
                float col = colBase + float(colOffset);
                vec2 centerPx = vec2((col + 0.5) * cellSize - shift, (row + 0.5) * rowHeight);
                centerPx += iconmap_jitterOffset_${uid}(vec2(col, row), vec2(cellSize, rowHeight), jitterAmount);
                vec2 delta = fragCoord - centerPx;
                float dist2 = dot(delta, delta);
                if (dist2 < bestDist2) {
                    bestDist2 = dist2;
                    bestCenter = centerPx;
                }
            }
        }

        return vec3(bestCenter, rowHeight);
    }

vec3 iconmap_gridPlacement_${uid}(vec2 fragCoord) {
        int layoutMode = ${this.grid_layout.sample()};
        float cellSize = max(iconmap_decodeCellSize_${uid}(${this.cell_size.sample()}), 1.0);
        float jitterAmount = clamp(${this.jitter.sample()}, 0.0, 0.45);

        if (layoutMode == 2) {
            return iconmap_hexPlacement_${uid}(fragCoord, cellSize, jitterAmount);
        }

        return iconmap_squarePlacement_${uid}(fragCoord, cellSize, jitterAmount, layoutMode == 1);
    }

vec3 iconmap_gridUv_${uid}(vec2 fragCoord) {
        vec3 placement = iconmap_gridPlacement_${uid}(fragCoord);
        float iconScale = clamp(${this.icon_scale.sample()}, 0.3, 1.0);
        float padding = clamp((1.0 - iconScale) * 0.5, 0.0, 0.49);
        vec2 centerPx = placement.xy;
        float footprint = max(placement.z, 1.0);
        vec2 local = (fragCoord - centerPx) / vec2(footprint) + 0.5;

        vec2 spacingVec = vec2(padding);
        vec2 feather = max(fwidth(local), vec2(1e-4));

        vec2 lowMask = smoothstep(spacingVec - feather, spacingVec + feather, local);
        vec2 highMask = 1.0 - smoothstep(vec2(1.0) - spacingVec - feather, vec2(1.0) - spacingVec + feather, local);
        float inside = lowMask.x * lowMask.y * highMask.x * highMask.y;

        vec2 denom = max(vec2(1.0) - 2.0 * spacingVec, vec2(1e-5));
        vec2 paddedUv = clamp((local - spacingVec) / denom, 0.0, 1.0);

        return vec3(paddedUv, inside);
    }

vec2 iconmap_cellCenterUv_${uid}(vec2 dataUv) {
        vec2 centerPx = iconmap_gridPlacement_${uid}(gl_FragCoord.xy).xy;
        vec2 deltaPx = centerPx - gl_FragCoord.xy;
        return dataUv + dFdx(dataUv) * deltaPx.x + dFdy(dataUv) * deltaPx.y;
    }`;
        }

        _buildIconSamplerFunction() {
            const uid = this.uid;
            const classCount = this._getClassCount();
            const branches = [];
            let fallbackExpr = "vec4(0.0)";

            for (let index = 0; index < classCount; index++) {
                const control = this._getIconControl(index);
                if (!control) {
                    continue;
                }
                const sampleExpr = control.sample("localUv", "vec2");
                fallbackExpr = sampleExpr;
                if (index === 0) {
                    branches.push(`if (classIndex <= 0) { return ${sampleExpr}; }`);
                } else {
                    branches.push(`if (classIndex == ${index}) { return ${sampleExpr}; }`);
                }
            }

            return `
vec4 iconmap_sampleIcon_${uid}(int classIndex, vec2 localUv) {
        ${branches.join("\n        ")}
        return ${fallbackExpr};
    }`;
        }

        getFragmentShaderDefinition() {
            return `
${super.getFragmentShaderDefinition()}
${this._buildGridHelpers()}
${this._buildIconSamplerFunction()}
`;
        }

        getFragmentShaderExecution() {
            const uid = this.uid;
            const thresholdMaskAtCenter = `sample_advanced_slider(centerChan, ${this.threshold.webGLVariableName}_breaks, ${this.threshold.webGLVariableName}_mask, true, ${this.threshold.webGLVariableName}_min)`;
            const thresholdMaskAtPoint = `sample_advanced_slider(chan, ${this.threshold.webGLVariableName}_breaks, ${this.threshold.webGLVariableName}_mask, true, ${this.threshold.webGLVariableName}_min)`;

            return `
float chan = ${this.sampleChannel("v_texture_coords")};
vec3 grid = iconmap_gridUv_${uid}(gl_FragCoord.xy);

if (grid.z <= 0.0) {
    return vec4(0.0);
}

vec2 centerUv = iconmap_cellCenterUv_${uid}(v_texture_coords);
float centerChan = ${this.sampleChannel("centerUv")};
float centerMask = ${thresholdMaskAtCenter};
float classValue = ${this.threshold.sample("centerChan", "float")};
float visibleCenter = step(0.05, centerMask);

if (visibleCenter <= 0.0) {
    return vec4(0.0);
}

int classIndex = int(floor(classValue + 0.5));
vec4 icon = iconmap_sampleIcon_${uid}(classIndex, grid.xy);
float visible = ${this.clip_icons.sample()} ? step(0.05, ${thresholdMaskAtPoint}) : 1.0;

return vec4(icon.rgb, icon.a * visible * grid.z);
`;
        }
    }

    $.FlexRenderer.ShaderMediator.registerLayer(IconMapShader);
})(OpenSeadragon);
