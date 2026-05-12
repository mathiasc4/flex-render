(function($) {
    /**
     * Interactive fisheye lens shader.
     *
     * Samples one RGBA source through a screen-space fisheye/magnifier lens.
     * The lens is active while the configured mouse button is held down and
     * uses FlexRenderer interaction uniforms as its input state.
     */
    class FisheyeLens extends $.FlexRenderer.ShaderLayer {
        static type() {
            return "fisheye-lens";
        }

        static name() {
            return "Fisheye Lens";
        }

        static description() {
            return "Applies a click-and-hold screen-space fisheye lens to one RGBA source.";
        }

        static intent() {
            return "Temporarily magnify image detail under the pointer while preserving surrounding context.";
        }

        static expects() {
            return {
                dataKind: "rgb",
                channels: 4
            };
        }

        static exampleParams() {
            return {
                use_mode: "show",  // eslint-disable-line camelcase
                use_blend: "source-over",  // eslint-disable-line camelcase
                radiusPx: 160,
                zoom: 3,
                featherPx: 40,
                falloffPower: 1.5,
                buttonMask: 1,
                showGuides: false,
                guideOpacity: 0.55,
                guideWidthPx: 2,
                guideColor: "#19bfff"
            };
        }

        static docs() {
            return {
                summary: "Click-and-hold fisheye lens for RGBA sources.",
                description: "Warps source texture coordinates around the current pointer position while the configured mouse button is held down. When no matching button is down, the shader returns the unwarped source image. Optional guide rings can visualize the active lens radius.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [4],
                    description: "RGBA source image to magnify"
                }],
                controls: [
                    { name: "use_channel0", required: "rgba" },
                    { name: "radiusPx", ui: "range_input", valueType: "float", default: 160, min: 20, max: 800, step: 1 },
                    { name: "zoom", ui: "range_input", valueType: "float", default: 3, min: 1, max: 8, step: 0.1 },
                    { name: "featherPx", ui: "range_input", valueType: "float", default: 40, min: 0, max: 250, step: 1 },
                    { name: "falloffPower", ui: "range_input", valueType: "float", default: 1.5, min: 0.25, max: 5, step: 0.05 },
                    { name: "buttonMask", ui: "select", valueType: "int", default: 1 },
                    { name: "showGuides", ui: "bool", valueType: "bool", default: false },
                    { name: "guideOpacity", ui: "range_input", valueType: "float", default: 0.55, min: 0, max: 1, step: 0.05 },
                    { name: "guideWidthPx", ui: "range_input", valueType: "float", default: 2, min: 1, max: 12, step: 1 },
                    { name: "guideColor", ui: "color", valueType: "vec3", default: "#19bfff" }
                ],
                notes: [
                    "Requires FlexDrawer interaction forwarding to be enabled.",
                    "Interaction positions are physical framebuffer pixels with bottom-left origin.",
                    "The first implementation supports a single active lens, not persistent multiple foci.",
                    "The shader samples RGBA only."
                ]
            };
        }

        static sources() {
            return [{
                acceptsChannelCount: (channelCount) => channelCount === 4,
                description: "RGBA source image to magnify"
            }];
        }

        static get defaultControls() {
            return {
                use_channel0: {  // eslint-disable-line camelcase
                    required: "rgba"
                },
                radiusPx: {
                    default: {
                        type: "range_input",
                        default: 160,
                        min: 20,
                        max: 800,
                        step: 1,
                        title: "Radius px: "
                    },
                    accepts: (type, instance) => type === "float"
                },
                zoom: {
                    default: {
                        type: "range_input",
                        default: 3,
                        min: 1,
                        max: 8,
                        step: 0.1,
                        title: "Zoom: "
                    },
                    accepts: (type, instance) => type === "float"
                },
                featherPx: {
                    default: {
                        type: "range_input",
                        default: 40,
                        min: 0,
                        max: 250,
                        step: 1,
                        title: "Feather px: "
                    },
                    accepts: (type, instance) => type === "float"
                },
                falloffPower: {
                    default: {
                        type: "range_input",
                        default: 1.5,
                        min: 0.25,
                        max: 5,
                        step: 0.05,
                        title: "Falloff: "
                    },
                    accepts: (type, instance) => type === "float"
                },
                buttonMask: {
                    default: {
                        type: "select",
                        default: 1,
                        title: "Button: ",
                        options: [
                            { value: 0, label: "Any" },
                            { value: 1, label: "Primary" },
                            { value: 2, label: "Secondary" },
                            { value: 4, label: "Auxiliary" }
                        ]
                    },
                    accepts: (type, instance) => type === "int"
                },
                showGuides: {
                    default: {
                        type: "bool",
                        default: false,
                        title: "Show guides: "
                    },
                    accepts: (type, instance) => type === "bool"
                },
                guideOpacity: {
                    default: {
                        type: "range_input",
                        default: 0.55,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        title: "Guide opacity: "
                    },
                    accepts: (type, instance) => type === "float"
                },
                guideWidthPx: {
                    default: {
                        type: "range_input",
                        default: 2,
                        min: 1,
                        max: 12,
                        step: 1,
                        title: "Guide width px: "
                    },
                    accepts: (type, instance) => type === "float"
                },
                guideColor: {
                    default: {
                        type: "color",
                        default: "#19bfff",
                        title: "Guide color: "
                    },
                    accepts: (type, instance) => type === "vec3"
                }
            };
        }

        getFragmentShaderDefinition() {
            return `
${super.getFragmentShaderDefinition()}

float ${this.uid}_range_value(float normalizedValue, float minValue, float maxValue) {
    return mix(minValue, maxValue, clamp(normalizedValue, 0.0, 1.0));
}

vec2 ${this.uid}_fisheye_uv(
    vec2 sourceUv,
    vec2 pointPx,
    vec2 centerPx,
    vec2 textureSizePx,
    float radiusPx,
    float zoomAmount,
    float featherPx,
    float falloffPower
) {
    float radius = max(radiusPx, 1.0);
    float zoomSafe = max(zoomAmount, 1.0);
    float falloffSafe = max(falloffPower, 0.01);
    float feather = clamp(featherPx, 0.0, radius);

    vec2 deltaPx = pointPx - centerPx;
    float distancePx = length(deltaPx);

    if (distancePx >= radius || zoomSafe <= 1.0001) {
        return sourceUv;
    }

    float normalizedDistance = clamp(distancePx / radius, 0.0, 1.0);

    // At the center, sample roughly 1 / zoomAmount as far from the center.
    // At the edge, return to normal sampling so the lens remains continuous.
    float localZoom = mix(zoomSafe, 1.0, pow(normalizedDistance, falloffSafe));
    vec2 warpedPointPx = centerPx + (deltaPx / localZoom);

    if (feather > 0.001) {
        float edgeBlend = smoothstep(max(0.0, radius - feather), radius, distancePx);
        warpedPointPx = mix(warpedPointPx, pointPx, edgeBlend);
    }

    vec2 safeTextureSize = max(textureSizePx, vec2(1.0));
    vec2 uvOffset = (warpedPointPx - pointPx) / safeTextureSize;

    return clamp(sourceUv + uvOffset, vec2(0.0), vec2(1.0));
}

float ${this.uid}_ring(
    vec2 pointPx,
    vec2 centerPx,
    float radiusPx,
    float thicknessPx,
    float featherPx
) {
    float d = abs(length(pointPx - centerPx) - radiusPx);
    return 1.0 - smoothstep(thicknessPx, thicknessPx + featherPx, d);
}
`;
        }

        getFragmentShaderExecution() {
            return `
    vec2 pointPx = gl_FragCoord.xy;
    vec2 sourceUv = v_texture_coords;

    float radiusPx = ${this.uid}_range_value(${this.radiusPx.sample()}, 20.0, 800.0);
    float zoomAmount = ${this.uid}_range_value(${this.zoom.sample()}, 1.0, 8.0);
    float featherPx = ${this.uid}_range_value(${this.featherPx.sample()}, 0.0, 250.0);
    float falloffPower = ${this.uid}_range_value(${this.falloffPower.sample()}, 0.25, 5.0);
    float guideWidthPx = ${this.uid}_range_value(${this.guideWidthPx.sample()}, 1.0, 12.0);
    float guideOpacity = clamp(${this.guideOpacity.sample()}, 0.0, 1.0);

    int activeButtons = fr_interaction_active_buttons();
    int requiredButtonMask = ${this.buttonMask.sample()};

    bool buttonMatches = requiredButtonMask == 0 ?
        activeButtons != 0 :
        ((activeButtons & requiredButtonMask) != 0);

    bool lensActive =
        fr_interaction_enabled() &&
        fr_interaction_pointer_inside() &&
        buttonMatches;

    if (!lensActive) {
        return ${this.sampleChannel("sourceUv")};
    }

    vec2 textureSizePx = vec2(
        float(${this.getTextureSize()}.x),
        float(${this.getTextureSize()}.y)
    );

    vec2 centerPx = fr_interaction_pointer_position_px();

    vec2 fisheyeUv = ${this.uid}_fisheye_uv(
        sourceUv,
        pointPx,
        centerPx,
        textureSizePx,
        radiusPx,
        zoomAmount,
        featherPx,
        falloffPower
    );

    vec4 outColor = ${this.sampleChannel("fisheyeUv")};

    if (${this.showGuides.sample()}) {
        float guide = ${this.uid}_ring(
            pointPx,
            centerPx,
            radiusPx,
            guideWidthPx,
            2.0
        );

        float guideAlpha = clamp(guide * guideOpacity, 0.0, 1.0);
        outColor.rgb = mix(outColor.rgb, ${this.guideColor.sample()}, guideAlpha);
        outColor.a = max(outColor.a, guideAlpha);
    }

    return outColor;
`;
        }
    }

    $.FlexRenderer.ShaderMediator.registerLayer(FisheyeLens);

})(OpenSeadragon);
