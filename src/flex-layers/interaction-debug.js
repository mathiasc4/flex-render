(function($) {
    /**
     * Interaction debug shader.
     *
     * Visualizes FlexRenderer interaction uniforms exposed through the
     * `fr_interaction_*` GLSL helper API.
     */
    class InteractionDebug extends $.FlexRenderer.ShaderLayer {
        static type() {
            return "interaction-debug";
        }

        static name() {
            return "Interaction Debug";
        }

        static description() {
            return "Visualizes pointer position, active buttons, click state, and drag state from FlexRenderer interaction uniforms.";
        }

        static intent() {
            return "Use this layer to verify FlexRenderer interaction uniforms and GLSL helper functions visually.";
        }

        static expects() {
            return { dataKind: "any", channels: "any" };
        }

        static exampleParams() {
            return {
                use_mode: "show",  // eslint-disable-line camelcase
                use_blend: "source-over"  // eslint-disable-line camelcase
            };
        }

        static docs() {
            return {
                summary: "Interaction-uniform diagnostic overlay.",
                description: "Draws screen-space markers from fr_interaction_* GLSL helpers. It does not sample image data and is intended for validating pointer, click, button, and drag state.",
                kind: "shader",
                inputs: [],
                controls: [],
                notes: [
                    "Requires FlexDrawer interaction to be enabled.",
                    "All positions are interpreted in physical framebuffer pixels with bottom-left origin.",
                    "The shader returns transparent output when interaction is disabled or the pointer is outside."
                ]
            };
        }

        static sources() {
            return [];
        }

        static get defaultControls() {
            return {
                opacity: false
            };
        }

        getFragmentShaderDefinition() {
            return `
float ${this.uid}_circle(vec2 pointPx, vec2 centerPx, float radiusPx, float featherPx) {
    float d = distance(pointPx, centerPx);
    return 1.0 - smoothstep(radiusPx, radiusPx + featherPx, d);
}

float ${this.uid}_ring(vec2 pointPx, vec2 centerPx, float radiusPx, float thicknessPx, float featherPx) {
    float d = abs(distance(pointPx, centerPx) - radiusPx);
    return 1.0 - smoothstep(thicknessPx, thicknessPx + featherPx, d);
}

float ${this.uid}_line_segment(vec2 pointPx, vec2 startPx, vec2 endPx, float thicknessPx, float featherPx) {
    vec2 segment = endPx - startPx;
    float segmentLengthSq = dot(segment, segment);

    if (segmentLengthSq <= 0.0001) {
        return ${this.uid}_circle(pointPx, startPx, thicknessPx, featherPx);
    }

    float t = clamp(dot(pointPx - startPx, segment) / segmentLengthSq, 0.0, 1.0);
    vec2 closest = startPx + segment * t;
    float d = distance(pointPx, closest);

    return 1.0 - smoothstep(thicknessPx, thicknessPx + featherPx, d);
}

float ${this.uid}_rect_outline(vec2 pointPx, vec2 aPx, vec2 bPx, float thicknessPx, float featherPx) {
    vec2 lo = min(aPx, bPx);
    vec2 hi = max(aPx, bPx);

    vec2 clampedPoint = clamp(pointPx, lo, hi);
    float outsideDistance = distance(pointPx, clampedPoint);

    vec2 distanceToEdges = min(abs(pointPx - lo), abs(pointPx - hi));
    float insideEdgeDistance = min(distanceToEdges.x, distanceToEdges.y);

    float outsideMask = 1.0 - smoothstep(thicknessPx, thicknessPx + featherPx, outsideDistance);
    float insideMask = 1.0 - smoothstep(thicknessPx, thicknessPx + featherPx, insideEdgeDistance);

    float insideBox =
        step(lo.x, pointPx.x) *
        step(pointPx.x, hi.x) *
        step(lo.y, pointPx.y) *
        step(pointPx.y, hi.y);

    return max(outsideMask * (1.0 - insideBox), insideMask * insideBox);
}

vec3 ${this.uid}_serial_color(int serialValue, vec3 evenColor, vec3 oddColor) {
    return (serialValue & 1) == 0 ? evenColor : oddColor;
}
`;
        }

        getFragmentShaderExecution() {
            return `
    if (!fr_interaction_enabled() || !fr_interaction_pointer_inside()) {
        return vec4(0.0);
    }

    vec2 p = gl_FragCoord.xy;
    vec4 outColor = vec4(0.0);

    vec2 pointerPx = fr_interaction_pointer_position_px();
    vec2 clickPx = fr_interaction_last_click_position_px();
    vec2 dragStartPx = fr_interaction_drag_start_position_px();
    vec2 dragCurrentPx = fr_interaction_drag_current_position_px();
    vec2 dragEndPx = fr_interaction_drag_end_position_px();

    bool primaryDown = fr_interaction_button_active(1);
    bool secondaryDown = fr_interaction_button_active(2);
    bool auxiliaryDown = fr_interaction_button_active(4);

    vec3 pointerColor = vec3(0.10, 0.75, 1.00);
    if (primaryDown) {
        pointerColor = vec3(1.00, 0.25, 0.10);
    } else if (secondaryDown) {
        pointerColor = vec3(1.00, 0.10, 0.85);
    } else if (auxiliaryDown) {
        pointerColor = vec3(0.40, 1.00, 0.25);
    }

    // Current pointer marker.
    float pointerDisk = ${this.uid}_circle(p, pointerPx, 13.0, 3.0);
    float pointerRing = ${this.uid}_ring(p, pointerPx, 21.0, 2.0, 2.0);
    outColor.rgb = mix(outColor.rgb, pointerColor, max(pointerDisk, pointerRing));
    outColor.a = max(outColor.a, max(pointerDisk, pointerRing) * 0.95);

    // Active button flags as small offset dots around the pointer.
    float primaryDot = ${this.uid}_circle(p, pointerPx + vec2(-22.0, -28.0), 5.0, 2.0) * (primaryDown ? 1.0 : 0.0);
    float secondaryDot = ${this.uid}_circle(p, pointerPx + vec2(0.0, -32.0), 5.0, 2.0) * (secondaryDown ? 1.0 : 0.0);
    float auxiliaryDot = ${this.uid}_circle(p, pointerPx + vec2(22.0, -28.0), 5.0, 2.0) * (auxiliaryDown ? 1.0 : 0.0);

    outColor.rgb += primaryDot * vec3(1.0, 0.1, 0.1);
    outColor.rgb += secondaryDot * vec3(1.0, 0.1, 0.85);
    outColor.rgb += auxiliaryDot * vec3(0.3, 1.0, 0.2);
    outColor.a = max(outColor.a, max(primaryDot, max(secondaryDot, auxiliaryDot)));

    // Last click marker. Alternates color by clickSerial so repeated clicks at the same
    // coordinate are still visibly detectable.
    if (fr_interaction_click_serial() > 0) {
        vec3 clickColor = ${this.uid}_serial_color(
            fr_interaction_click_serial(),
            vec3(1.0, 0.95, 0.10),
            vec3(1.0, 0.55, 0.05)
        );

        float clickRing = ${this.uid}_ring(p, clickPx, 32.0, 2.0, 2.0);
        float clickCenter = ${this.uid}_circle(p, clickPx, 4.0, 2.0);

        outColor.rgb = mix(outColor.rgb, clickColor, max(clickRing, clickCenter));
        outColor.a = max(outColor.a, max(clickRing, clickCenter) * 0.90);
    }

    // Active drag visualization: green start, magenta current, cyan connecting line,
    // and a rectangle outline between start/current.
    if (fr_interaction_drag_active()) {
        float dragLine = ${this.uid}_line_segment(p, dragStartPx, dragCurrentPx, 3.0, 2.0);
        float dragRect = ${this.uid}_rect_outline(p, dragStartPx, dragCurrentPx, 2.0, 2.0);
        float dragStart = ${this.uid}_circle(p, dragStartPx, 9.0, 2.0);
        float dragCurrent = ${this.uid}_circle(p, dragCurrentPx, 9.0, 2.0);

        outColor.rgb += dragLine * vec3(0.10, 1.00, 1.00);
        outColor.rgb += dragRect * vec3(0.20, 0.80, 1.00);
        outColor.rgb += dragStart * vec3(0.20, 1.00, 0.20);
        outColor.rgb += dragCurrent * vec3(1.00, 0.20, 1.00);
        outColor.a = max(outColor.a, max(max(dragLine, dragRect), max(dragStart, dragCurrent)) * 0.90);
    }

    // Last completed drag visualization. Alternates by dragSerial so repeated drags
    // ending on the same coordinates can still be detected.
    if (!fr_interaction_drag_active() && fr_interaction_drag_serial() > 0) {
        vec3 completedDragColor = ${this.uid}_serial_color(
            fr_interaction_drag_serial(),
            vec3(0.20, 1.00, 0.65),
            vec3(0.70, 0.55, 1.00)
        );

        float completedLine = ${this.uid}_line_segment(p, dragStartPx, dragEndPx, 2.0, 2.0);
        float completedStart = ${this.uid}_ring(p, dragStartPx, 12.0, 2.0, 2.0);
        float completedEnd = ${this.uid}_ring(p, dragEndPx, 12.0, 2.0, 2.0);

        outColor.rgb += completedLine * completedDragColor;
        outColor.rgb += completedStart * vec3(0.20, 1.00, 0.20);
        outColor.rgb += completedEnd * completedDragColor;
        outColor.a = max(outColor.a, max(completedLine, max(completedStart, completedEnd)) * 0.75);
    }

    return clamp(outColor, 0.0, 1.0);
`;
        }
    }

    $.FlexRenderer.ShaderLayerRegistry.register(InteractionDebug);

})(OpenSeadragon);
