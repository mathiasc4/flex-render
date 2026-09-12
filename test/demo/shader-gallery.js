/**
 * Pathology shader gallery.
 *
 * One card per shader-layer recipe. Each card's `config` / `order` is handed
 * verbatim to `viewer.drawer.overrideConfigureAll(...)`, so what you read in the
 * "config JSON" panel is exactly what produced the picture -- the demo and the
 * documentation cannot drift apart.
 *
 * Only selected cards are built, lazily as they scroll into view, and torn down
 * once too many are live, because 25 simultaneous WebGL viewers is more than a
 * browser will give you. The surviving ones share a single context through
 * `sharedContextKey`.
 *
 * All data comes from ./synthetic-pathology-sources.js.
 */

/*
 * Shader parameter names (use_channel0, use_blend, window_low, ...) are the
 * renderer's public config keys, so they are snake_case by definition and cannot
 * be renamed here.
 */
/* eslint-disable camelcase */
(function($) {

    const SP = $.SyntheticPathology;

    // How many card viewers stay alive at once. This is a hard cap, not a hint:
    // past roughly this many live viewers the renderer stops producing output and
    // cards come up blank, so letting the count drift is not an option. Override
    // with ?live=N when trying a different machine.
    const LIVE_VIEWER_BUDGET = Math.max(
        2,
        Number(new URLSearchParams(window.location.search).get("live")) || 6
    );

    const SHARED_CONTEXT_KEY = "gallery";
    // The float16 card resolves a different colour-target precision, so it gets
    // its own context rather than fighting the rest for one.
    const SHARED_CONTEXT_KEY_HP = "gallery_hp";

    // ?shared=0 gives every card its own WebGL context. Slower and limited by the
    // browser's context budget, but useful when you need to tell a context-sharing
    // problem apart from a shader problem.
    const USE_SHARED_CONTEXT =
        new URLSearchParams(window.location.search).get("shared") !== "0";

    let contextSerial = 0;

    function contextKeyFor(card) {
        if (!USE_SHARED_CONTEXT) {
            return `gallery_solo_${contextSerial++}`;
        }
        return card.precision === "unorm8" ? SHARED_CONTEXT_KEY : SHARED_CONTEXT_KEY_HP;
    }

    // ---------------------------------------------------- a demo-registered layer

    // The registry has no invert/negative layer. Registering one here does double
    // duty: it fills the gap, and it shows that an application can add a layer
    // without touching src/.
    $.FlexRenderer.ShaderLayerRegistry.register(class extends $.FlexRenderer.ShaderLayer {
        static type() {
            return "gallery-negative";
        }

        static name() {
            return "Negative (registered by the demo)";
        }

        static description() {
            return "Inverts RGB and keeps alpha. Registered from demo code, not from src/.";
        }

        static sources() {
            return [{
                acceptsChannelCount: (n) => n >= 3,
                description: "RGB(A) slide"
            }];
        }

        static get defaultControls() {
            return {
                use_channel0: { default: "rgba" }  // eslint-disable-line camelcase
            };
        }

        getFragmentShaderExecution() {
            return `
    vec4 c = ${this.sampleChannel("v_texture_coords", 0)};
    return vec4(1.0 - c.rgb, c.a);
`;
        }
    });

    // ------------------------------------------------------------ source helpers

    function he(extra) {
        return $.extend({ type: "synthetic-he" }, extra || {});
    }

    function scalar(field) {
        return { type: "synthetic-scalar", field: field };
    }

    const IF_SOURCE = { type: "synthetic-if" };
    const F16_SOURCE = { type: "synthetic-f16" };
    const R16F_SOURCE = { type: "synthetic-r16f" };
    const RG16F_SOURCE = { type: "synthetic-rg16f" };

    // Marks a source that should be sampled nearest-neighbour: class/label maps
    // must not be interpolated into values that belong to no class.
    function crisp(source) {
        return { tileSource: source, crisp: true };
    }

    /**
     * A small procedurally drawn annotation stamp for the `texture` card.
     *
     * The background is opaque white on purpose. That layer composites with
     * `blendAlpha(slide, texture, min(slide.rgb, texture.rgb))`, and min() against
     * a transparent-black texture is black -- so a stamp drawn on a clear
     * background blanks the slide everywhere it does not paint. White is the
     * identity for min(), which turns the same stamp into a watermark: the slide
     * shows through, and only the markings darken it.
     */
    function makeAnnotationTexture() {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, size, size);

        ctx.strokeStyle = "#1d6f8c";
        ctx.lineWidth = 6;
        ctx.strokeRect(14, 14, size - 28, size - 28);

        ctx.strokeStyle = "rgba(29, 111, 140, 0.35)";
        ctx.lineWidth = 3;
        for (let i = -size; i < size * 2; i += 26) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i - size, size);
            ctx.stroke();
        }

        ctx.fillStyle = "#0f4d63";
        ctx.font = "bold 46px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("ROI", size / 2, size / 2);

        return canvas.toDataURL("image/png");
    }

    // ------------------------------------------------------------------ recipes

    const SLIDE = "slide";   // placeholder replaced by the resolved slide source

    // Opening framings, in OpenSeadragon viewport coordinates (the slide is the
    // unit square). Some layers are only meaningful where individual nuclei are
    // resolved -- an adaptive threshold over a whole-slide thumbnail has no local
    // variance left to work with and comes out a flat field. Those cards open at
    // nuclear magnification instead of at full extent.
    const VIEW_NUCLEAR = { x: 0.325, y: 0.385, size: 0.035 };
    const VIEW_TISSUE = { x: 0.26, y: 0.32, size: 0.16 };
    // The two threshold cards share this one so they are a fair comparison. It is
    // deliberately lower magnification than VIEW_NUCLEAR: the adaptive threshold
    // window is measured in source-image pixels and is capped at 11, so backing off
    // slightly gives the local statistic enough tissue context to vary.
    const VIEW_CELLULAR = { x: 0.28, y: 0.34, size: 0.2 };

    const RECIPES = [
        {
            id: "identity",
            title: "H&E baseline",
            types: ["identity"],
            blurb: "The unmodified slide. Everything below is measured against this. " +
                "The gamma selector uses the reserved use_gamma filter, which has no control UI of its own.",
            sources: [SLIDE],
            config: {
                slide: { name: "H&E", type: "identity", tiledImages: [0], params: { use_channel0: "rgba" } }
            },
            extras: [{
                kind: "select",
                label: "use_gamma",
                options: ["0.5", "1", "1.6", "2.2"],
                value: "1",
                apply: (config, value) => {
                    config.slide.params.use_gamma = Number(value);
                }
            }]
        },
        {
            id: "stain-h",
            view: VIEW_NUCLEAR,
            title: "Hematoxylin, reconstructed",
            types: ["stain-separation"],
            blurb: "Ruifrok–Johnston deconvolution keeping only the hematoxylin channel, then " +
                "physically re-rendered as the slide would look stained with hematoxylin alone. " +
                "intensity is a display gain: single-stain concentrations are small, so at 1.0 this " +
                "reads as almost blank. Drag it to see what that costs you.",
            sources: [SLIDE],
            config: {
                h: {
                    name: "Hematoxylin", type: "stain-separation", tiledImages: [0],
                    params: { use_channel0: "rgb", preset: 0, stain: 0, style: 0, intensity: 2.5 }
                }
            }
        },
        {
            id: "stain-e",
            view: VIEW_NUCLEAR,
            title: "Eosin, reconstructed",
            types: ["stain-separation"],
            blurb: "Same deconvolution, eosin channel. Nuclei drop out; collagen and cytoplasm remain. " +
                "The magenta cast is real: Ruifrok's eosin vector suppresses green almost exclusively, " +
                "so eosin in isolation is not the pink you see on the intact slide.",
            sources: [SLIDE],
            config: {
                e: {
                    name: "Eosin", type: "stain-separation", tiledImages: [0],
                    params: { use_channel0: "rgb", preset: 0, stain: 1, style: 0, intensity: 3 }
                }
            }
        },
        {
            id: "stain-residual",
            view: VIEW_TISSUE,
            title: "Residual channel, tinted",
            types: ["stain-separation"],
            blurb: "Whatever the two-stain model cannot explain. It is substantial here, and that is not a " +
                "bug: Ruifrok's eosin vector is almost a pure green absorber, so H+E alone produce magenta — " +
                "real H&E pink needs the blue-absorbing residual row. This channel is where that lives.",
            sources: [SLIDE],
            config: {
                r: {
                    name: "Residual", type: "stain-separation", tiledImages: [0],
                    params: {
                        use_channel0: "rgb", preset: 0, stain: 4, style: 1,
                        tintColor: "#2ec4a6", intensity: 2
                    }
                }
            }
        },
        {
            id: "stain-hdab",
            view: VIEW_TISSUE,
            title: "IHC: H-DAB preset",
            types: ["stain-separation"],
            blurb: "A synthetic DAB-stained slide with heterogeneous membranous positivity, " +
                "separated with the H-DAB stain matrix. Switch `stain` to compare DAB against the counterstain.",
            sources: [he({ stains: "hdab" })],
            config: {
                dab: {
                    name: "DAB", type: "stain-separation", tiledImages: [0],
                    params: { use_channel0: "rgb", preset: 1, stain: 2, style: 0, intensity: 2.5 }
                }
            }
        },
        {
            id: "stain-truth",
            view: VIEW_NUCLEAR,
            title: "Deconvolution vs ground truth",
            types: ["stain-separation", "single_channel", "group"],
            blurb: "The generator knows the hematoxylin concentration it composed each pixel from. " +
                "This card renders the deconvolved concentration and differences it against that truth channel: " +
                "black means the shader recovered exactly what went in. Switch the blend to source-over or " +
                "destination-over to confirm both layers are actually non-trivial — a dead layer also " +
                "differences to black.",
            sources: [he(), scalar("truth-hematoxylin")],
            config: {
                check: {
                    name: "Recovered vs truth", type: "group",
                    order: ["recovered", "truth"],
                    shaders: {
                        recovered: {
                            name: "Recovered cH", type: "stain-separation", tiledImages: [0],
                            params: { use_channel0: "rgb", preset: 0, stain: 0, style: 2, intensity: 0.5 }
                        },
                        truth: {
                            name: "Truth cH", type: "single_channel", tiledImages: [1],
                            params: {
                                use_channel0: "r", color: "#ffffff", opaque: true,
                                use_mode: "blend", use_blend: "difference"
                            }
                        }
                    }
                }
            },
            extras: [{
                kind: "select",
                label: "truth blend",
                options: ["difference", "source-over", "destination-over"],
                value: "difference",
                apply: (config, value) => {
                    config.check.shaders.truth.params.use_blend = value;
                }
            }],
            note: "Residual brightness is expected at nucleus edges — the truth channel is stored 8-bit."
        },
        {
            id: "sobel",
            view: VIEW_NUCLEAR,
            title: "Sobel edges on the slide",
            types: ["sobel"],
            blurb: "Gradient magnitude straight off the RGB slide. Nuclear membranes and the tissue " +
                "border light up; homogeneous stroma goes dark.",
            sources: [SLIDE],
            config: {
                s: { name: "Sobel", type: "sobel", tiledImages: [0], params: { use_channel0: "rgb" } }
            }
        },
        {
            id: "negative",
            view: VIEW_NUCLEAR,
            title: "Negative — a layer the demo registered",
            types: ["gallery-negative"],
            blurb: "The registry ships no invert layer, so this page defines one in ~10 lines via " +
                "ShaderLayerRegistry.register and uses it like any built-in type.",
            sources: [SLIDE],
            config: {
                n: { name: "Negative", type: "gallery-negative", tiledImages: [0], params: { use_channel0: "rgba" } }
            }
        },
        {
            id: "threshold",
            view: VIEW_CELLULAR,
            title: "Global threshold on the green channel",
            types: ["threshold"],
            blurb: "One cut-off for the whole slide. Green is the most hematoxylin-sensitive channel, " +
                "so nuclei separate — until staining intensity drifts across the section.",
            sources: [SLIDE],
            config: {
                t: {
                    name: "Threshold", type: "threshold", tiledImages: [0],
                    params: {
                        use_channel0: "g", threshold: 0.62, version: 0, max_value: 1,
                        colorize_binary: true, fg_color: "#1b2a4a", bg_color: "#f4f1f6"
                    }
                }
            }
        },
        {
            id: "adaptive-threshold",
            view: VIEW_CELLULAR,
            title: "Adaptive threshold, same channel",
            types: ["adaptive_threshold"],
            blurb: "A local mean instead of a global cut-off — in principle the one that survives uneven " +
                "illumination and stain gradients. The neighbourhood is measured in source-image pixels, " +
                "so the decision boundary remains meaningful as the viewer changes zoom.",
            sources: [SLIDE],
            config: {
                a: {
                    name: "Adaptive", type: "adaptive_threshold", tiledImages: [0],
                    params: {
                        // Box mean, not Gaussian: a Gaussian window this small is
                        // dominated by its own centre sample, so the "local mean"
                        // tracks the pixel it is being compared against at very low
                        // magnification.
                        use_channel0: "g", block_size: 11, c_value: 0.015, gaussian: false,
                        invert: true, fg_color: "#20304f", bg_color: "#faf7fb"
                    }
                }
            },
            note: "The neighbourhood is converted from source-image pixels into the current viewport " +
                "coordinate space using the source dimensions and viewport zoom."
        },
        {
            id: "heatmap",
            title: "Tumour probability heatmap",
            types: ["heatmap"],
            blurb: "A continuous probability map rendered on its own data. The dark background makes " +
                "the thresholded colour and opacity easy to inspect. Drag the threshold to sweep the boundary.",
            sources: [SLIDE, scalar("tumour-prob")],
            config: {
                prob: {
                    name: "P(tumour)", type: "heatmap", tiledImages: [1],
                    params: {
                        use_channel0: "r", color: "#c62828", threshold: 22,
                        use_mode: "show", use_blend: "source-over", opacity: 1
                    }
                }
            }
        },
        {
            id: "colormap-discrete",
            title: "Four-class grade map (discrete)",
            types: ["colormap"],
            blurb: "A discrete class map through a 4-step palette rendered on its own data. The layer enforces " +
                "color.steps === threshold.breaks.length + 1, which is why the palette has four steps " +
                "and the slider three breaks.",
            sources: [SLIDE, scalar("grade-classes")],
            config: {
                grade: {
                    name: "Grade", type: "colormap", tiledImages: [1],
                    params: {
                        color: { type: "colormap", default: "Spectral", steps: 4, mode: "diverging", continuous: false },
                        threshold: { type: "advanced_slider", breaks: [0.25, 0.5, 0.75], mask: [1, 1, 1, 1] },
                        connect: true,
                        use_mode: "show", use_blend: "source-over", opacity: 1
                    }
                }
            }
        },
        {
            id: "colormap",
            title: "Four-class palette, continuous ramp",
            types: ["colormap"],
            blurb: "The same 4-step palette with color.continuous = true, so the shader interpolates " +
                "between neighbouring classes instead of stepping. It runs on the continuous " +
                "probability field: grade-classes only emits one value per band, and a value at the " +
                "centre of its band interpolates to exactly its own class colour, which would make " +
                "this card identical to the discrete one.",
            sources: [SLIDE, scalar("tumour-prob")],
            config: {
                grade: {
                    name: "P(tumour)", type: "colormap", tiledImages: [1],
                    params: {
                        color: { type: "colormap", default: "Spectral", steps: 4, mode: "diverging", continuous: true },
                        threshold: { type: "advanced_slider", breaks: [0.25, 0.5, 0.75], mask: [1, 1, 1, 1] },
                        connect: true,
                        use_mode: "show", use_blend: "source-over", opacity: 1
                    }
                }
            }
        },
        {
            id: "gridheatmap",
            title: "Nuclear density, grid cells",
            types: ["gridheatmap"],
            blurb: "The same palette machinery as colormap, but drawn as cells whose interiors fade as you " +
                "zoom in. The visualization is isolated from the WSI so the cell geometry stays readable.",
            sources: [SLIDE, scalar("nuclei-density")],
            config: {
                density: {
                    name: "Nuclei / cell", type: "gridheatmap", tiledImages: [1],
                    params: {
                        color: { type: "colormap", default: "Viridis", steps: 5, mode: "sequential", continuous: false },
                        threshold: { type: "advanced_slider", breaks: [0.2, 0.4, 0.6, 0.8], mask: [1, 1, 1, 1, 1] },
                        connect: true,
                        cell: 256, solid_px: 26, boundary_px: 2, adaptive_lod: true,
                        opacity: 1
                    }
                }
            }
        },
        {
            id: "patternmap",
            title: "Three classes, stacked patterns",
            types: ["patternmap", "group"],
            blurb: "Three overlapping class memberships at once. Solid fills would hide each other, so each " +
                "gets a different pattern, spacing and phase — all in screen pixels, so density is zoom-stable.",
            sources: [SLIDE, scalar("class-stroma"), scalar("class-invasive"), scalar("class-core")],
            config: {
                stack: {
                    name: "Three classes", type: "group",
                    order: ["stroma", "invasive", "core"],
                    shaders: {
                        stroma: {
                            name: "Stroma", type: "patternmap", tiledImages: [1],
                            params: {
                                use_channel0: "r", color: "#2e7d32", threshold: 30,
                                pattern_type: 1, spacing: 18, line_width: 1.5, rotation: 0,
                                use_mode: "blend", use_blend: "source-over"
                            }
                        },
                        invasive: {
                            name: "Invasive margin", type: "patternmap", tiledImages: [2],
                            params: {
                                use_channel0: "r", color: "#ef6c00", threshold: 28,
                                pattern_type: 2, spacing: 22, line_width: 2, offset_x: 7,
                                use_mode: "blend", use_blend: "source-over"
                            }
                        },
                        core: {
                            name: "Core", type: "patternmap", tiledImages: [3],
                            params: {
                                use_channel0: "r", color: "#ad1457", threshold: 26,
                                pattern_type: 3, spacing: 14, line_width: 2.5,
                                use_mode: "blend", use_blend: "source-over"
                            }
                        }
                    }
                }
            }
        },
        {
            id: "iconmap",
            title: "Class icons",
            types: ["iconmap"],
            blurb: "The class map again, rendered as one repeated glyph per class instead of as colour. " +
                "Icon controls are generated automatically — one per interval — and default to the built-in " +
                "icon library, so no image assets are needed.",
            sources: [SLIDE, crisp(scalar("grade-classes"))],
            config: {
                stack: {
                    name: "Grade icons", type: "group",
                    order: ["icons"],
                    shaders: {
                        icons: {
                            name: "Grade icons", type: "iconmap", tiledImages: [1],
                            params: {
                                use_channel0: "r",
                                threshold: {
                                    type: "advanced_slider",
                                    breaks: [0.25, 0.5, 0.75],
                                    mask: [1, 1, 1, 1],
                                    maskOnly: false
                                },
                                grid_layout: 2, cell_size: 30, jitter: 0.18,
                                icon_scale: 0.75, clip_icons: true
                            }
                        }
                    }
                }
            }
        },
        {
            id: "bipolar",
            title: "Expression, up and down",
            types: ["bipolar-heatmap"],
            blurb: "A diverging field centred on 0.5: up-regulated in the lesion, down-regulated in the " +
                "reactive rim, transparent where there is no change. A sequential heatmap cannot show this.",
            sources: [SLIDE, scalar("expression-delta")],
            config: {
                stack: {
                    name: "Expression delta", type: "group",
                    order: ["delta"],
                    shaders: {
                        delta: {
                            name: "Δ expression", type: "bipolar-heatmap", tiledImages: [1],
                            params: {
                                colorHigh: "#d32f2f", colorLow: "#1565c0", threshold: 12,
                                use_mode: "blend", use_blend: "source-over", opacity: 0.9
                            }
                        }
                    }
                }
            }
        },
        {
            id: "edge",
            title: "Lesion contour",
            types: ["edge"],
            blurb: "Only the iso-contour of a region mask is drawn, with separate colours for the inside " +
                "and outside of the boundary. Thickness is derivative-aware, so the line holds up across zoom.",
            sources: [SLIDE, scalar("mask")],
            config: {
                stack: {
                    name: "Contour", type: "group",
                    order: ["contour"],
                    shaders: {
                        contour: {
                            name: "Contour", type: "edge", tiledImages: [1],
                            params: {
                                use_channel0: "r", threshold: 50,
                                outer_color: "#00e5ff", inner_color: "#00323c",
                                edgeThickness: 1.6, use_mode: "blend", use_blend: "source-over"
                            }
                        }
                    }
                }
            }
        },
        {
            id: "if-composite",
            view: VIEW_NUCLEAR,
            title: "Multiplex IF composite",
            types: ["single_channel", "group"],
            blurb: "Eight fluorescence markers arrive as two RGBA8 texture packs — eight logical channels, " +
                "no file on disk. Four are tinted and screened together here; use_channel_base0 picks which.",
            sources: [IF_SOURCE],
            config: {
                composite: {
                    name: "IF composite", type: "group",
                    order: ["dapi", "cd3", "panck", "ki67"],
                    shaders: {
                        dapi: {
                            name: "DAPI", type: "single_channel", tiledImages: [0],
                            params: {
                                use_channel0: "r", use_channel_base0: 0, color: "#3d5afe",
                                window_low: 0, window_high: 0.85, use_blend: "screen", use_mode: "blend"
                            }
                        },
                        cd3: {
                            name: "CD3", type: "single_channel", tiledImages: [0],
                            params: {
                                use_channel0: "r", use_channel_base0: 1, color: "#00e676",
                                window_low: 0.05, window_high: 0.7, use_blend: "screen", use_mode: "blend"
                            }
                        },
                        panck: {
                            name: "PanCK", type: "single_channel", tiledImages: [0],
                            params: {
                                use_channel0: "r", use_channel_base0: 4, color: "#ff4081",
                                window_low: 0.1, window_high: 0.9, use_blend: "screen", use_mode: "blend",
                                opacity: 0.45
                            }
                        },
                        ki67: {
                            name: "Ki-67", type: "single_channel", tiledImages: [0],
                            params: {
                                use_channel0: "r", use_channel_base0: 5, color: "#ffea00",
                                window_low: 0.05, window_high: 0.8, use_blend: "screen", use_mode: "blend"
                            }
                        }
                    }
                }
            }
        },
        {
            id: "channel-series",
            view: VIEW_NUCLEAR,
            title: "Channel scrubber",
            types: ["channel-series", "single_channel"],
            blurb: "The same 8-channel stack, one channel at a time. The wrapper sizes its slider from the " +
                "source's reported channel count and only updates a uniform — no program rebuild per step. " +
                "Channel order: " + SP.markers.join(", ") + ".",
            sources: [IF_SOURCE],
            config: {
                series: {
                    name: "Markers", type: "channel-series", tiledImages: [0],
                    params: {
                        channelRenderer: "single_channel",
                        sourceIndex: 0,
                        channelRendererConfig: {
                            params: { use_channel0: "r", color: "#ffffff", opaque: true, window_low: 0, window_high: 0.85 }
                        }
                    }
                }
            }
        },
        {
            id: "time-series",
            title: "Serial sections",
            types: ["time-series", "identity"],
            blurb: "Four sections through the same block, each its own tiled image, swapped by a timeline " +
                "control. Nothing rebuilds when you scrub — the wrapper rewires the delegate's source.",
            sources: [he({ seed: 0 }), he({ seed: 1 }), he({ seed: 2 }), he({ seed: 3 })],
            config: {
                sections: {
                    name: "Section", type: "time-series", tiledImages: [0],
                    params: {
                        seriesRenderer: "identity",
                        series: [0, 1, 2, 3],
                        use_channel0: "rgba"
                    }
                }
            }
        },
        {
            id: "grid",
            title: "Image-anchored measurement grid",
            types: ["grid"],
            blurb: "A grid in image pixels, not screen pixels: it pans and zooms with the slide, and " +
                "adaptive_lod snaps the cell size so the on-screen spacing stays sane at every level.",
            sources: [SLIDE],
            config: {
                stack: {
                    name: "Measurement grid", type: "group",
                    order: ["grid"],
                    shaders: {
                        grid: {
                            name: "Grid", type: "grid", tiledImages: [0],
                            params: {
                                use_channel0: "rgba", cell_x: 512, cell_y: 512,
                                color: "#00bcd4", line_width: 1.5, adaptive_lod: true,
                                use_mode: "blend", use_blend: "source-over", opacity: 0.7
                            }
                        }
                    }
                }
            }
        },
        {
            id: "texture",
            view: VIEW_TISSUE,
            title: "Atlas texture overlay",
            types: ["texture"],
            blurb: "Blends an atlas-backed image over the first-pass colour with a min() mask, so a stamp " +
                "drawn on white reads as a watermark and one drawn on transparency reads as a stencil. " +
                "The atlas starts empty; this card seeds it with a procedurally drawn stamp, and the " +
                "control below still accepts your own upload.",
            sources: [SLIDE],
            config: {
                mark: { name: "Stamp", type: "texture", tiledImages: [0], params: { use_channel0: "rgba" } }
            },
            seedTexture: { layerId: "mark", controlName: "texture" }
        },
        {
            id: "fisheye",
            view: VIEW_TISSUE,
            title: "Fisheye magnifier",
            types: ["fisheye-lens"],
            blurb: "Select this card, then move over the viewport and hold the primary mouse button. " +
                "The screen-space lens magnifies nuclear detail without losing the low-power context.",
            sources: [SLIDE],
            // no `interaction` key: derived from fisheye-lens's static requiresInteraction()
            config: {
                lens: {
                    name: "Lens", type: "fisheye-lens", tiledImages: [0],
                    params: {
                        use_channel0: "rgba", radiusPx: 150, zoom: 3, featherPx: 40,
                        falloffPower: 1.5, showGuides: true, guideColor: "#19bfff"
                    }
                }
            },
            note: "Pointer state is forwarded to the shader while normal viewer pan and zoom remain available."
        },
        {
            id: "interaction-debug",
            view: VIEW_TISSUE,
            title: "Interaction state",
            types: ["interaction-debug"],
            blurb: "Select this card and move, click, or drag in its viewport. It visualises the " +
                "pointer/click/drag uniforms forwarded to shaders.",
            sources: [SLIDE],
            // no `interaction` key: derived from the nested interaction-debug layer's
            // static requiresInteraction()
            config: {
                stack: {
                    name: "Pointer", type: "group",
                    order: ["debug"],
                    shaders: {
                        debug: {
                            name: "Pointer", type: "interaction-debug", tiledImages: [],
                            params: { use_mode: "blend", use_blend: "screen" }
                        }
                    }
                }
            }
        },
        {
            id: "blend-modes",
            title: "Blend-mode matrix",
            types: ["heatmap"],
            blurb: "The same probability data through every supported use_blend value, rendered without " +
                "the WSI so the shader output remains the focus. " +
                "Two things worth knowing. \"add\" is not a supported mode, despite what the README " +
                "example shows. And multiply / darken zero the slide out wherever the overlay is " +
                "transparent rather than leaving it alone — so for an overlay that covers only part of " +
                "the tissue, source-over and screen are the ones you want.",
            sources: [scalar("tumour-prob")],
            config: {
                prob: {
                    name: "P(tumour)", type: "heatmap", tiledImages: [0],
                    params: {
                        use_channel0: "r", color: "#c62828", threshold: 22,
                        use_mode: "blend", use_blend: "source-over", opacity: 1
                    }
                }
            },
            extras: [{
                kind: "select",
                label: "use_blend",
                options: ($.FlexRenderer.SUPPORTED_BLEND_MODES || ["source-over"]).slice(),
                value: "source-over",
                apply: (config, value) => {
                    config.prob.params.use_blend = value;
                }
            }]
        },
        {
            id: "precision",
            title: "High dynamic range Ki-67 score",
            types: ["single_channel"],
            blurb: "An RGBA16F source whose values run from about -0.4 to 3.1. Under the default unorm8 " +
                "colour target the negatives are clamped away and the field bands; under float16 they survive. " +
                "Flip the toggle and watch the dark end.",
            sources: [F16_SOURCE],
            precision: "auto",
            config: {
                hdr: {
                    name: "Ki-67 score", type: "single_channel", tiledImages: [0],
                    params: {
                        use_channel0: "r", use_channel_base0: 0, color: "#ffd54f",
                        window_low: -0.4, window_high: 1, opaque: true
                    }
                }
            },
            extras: [{
                kind: "precision",
                label: "precision",
                options: ["auto", "unorm8"],
                value: "auto"
            }],
            note: "Falls back to unorm8 with a console warning if EXT_color_buffer_half_float is missing."
        },
        {
            id: "narrow-r16f",
            title: "Single-channel R16F",
            types: ["single_channel"],
            blurb: "The same Ki-67 score as the card above, uploaded as R16F instead of RGBA16F. " +
                "Identical on screen, a quarter of the texture memory, because it no longer pays for " +
                "three channels of zeroes. The first-pass colour target is unchanged either way.",
            sources: [R16F_SOURCE],
            precision: "auto",
            config: {
                narrow: {
                    name: "Ki-67 score", type: "single_channel", tiledImages: [0],
                    params: {
                        use_channel0: "r", use_channel_base0: 0, color: "#ffd54f",
                        window_low: -0.4, window_high: 1, opaque: true
                    }
                }
            },
            note: "Sampling an R16F pack yields (r, 0, 0, 1) — green, blue and alpha are a format " +
                "fill, not payload. Only channel 0 exists, and the source declares that."
        },
        {
            id: "narrow-rg16f",
            title: "Four markers across two RG16F packs",
            types: ["single_channel", "group"],
            blurb: "Four fluorescence markers as two two-component packs. Channels 0-1 live in pack 0 " +
                "and 2-3 in pack 1, so use_channel_base0: 2 has to cross a pack boundary — the case a " +
                "fixed four-components-per-pack assumption gets wrong. Half the memory of RGBA16F.",
            sources: [RG16F_SOURCE],
            precision: "auto",
            config: {
                composite: {
                    name: "Markers", type: "group", tiledImages: [0],
                    params: {},
                    shaders: {
                        dapi: {
                            name: "DAPI", type: "single_channel", tiledImages: [0],
                            params: {
                                use_channel0: "r", use_channel_base0: 0, color: "#3d5afe",
                                window_low: 0, window_high: 0.85, use_blend: "screen", use_mode: "blend"
                            }
                        },
                        cd3: {
                            name: "CD3", type: "single_channel", tiledImages: [0],
                            params: {
                                use_channel0: "r", use_channel_base0: 1, color: "#00e676",
                                window_low: 0.05, window_high: 0.7, use_blend: "screen", use_mode: "blend"
                            }
                        },
                        panck: {
                            name: "CD8 (pack 1)", type: "single_channel", tiledImages: [0],
                            params: {
                                use_channel0: "r", use_channel_base0: 2, color: "#ff6e40",
                                window_low: 0.05, window_high: 0.7, use_blend: "screen", use_mode: "blend"
                            }
                        },
                        ki67: {
                            name: "CD20 (pack 1)", type: "single_channel", tiledImages: [0],
                            params: {
                                use_channel0: "r", use_channel_base0: 3, color: "#ffd54f",
                                window_low: 0.05, window_high: 0.7, use_blend: "screen", use_mode: "blend"
                            }
                        }
                    }
                }
            },
            note: "If the two right-hand markers render blank, channel addressing is falling back to " +
                "four components per pack and reading pack 0's unused components."
        }
    ];

    // -------------------------------------------------------------- card plumbing

    const cards = [];
    let slideInfo = null;
    let liveOrder = [];
    let annotationTextureUrl = null;
    let selectionMode = "single";
    const activeIds = new Set([RECIPES[0].id]);
    const selectionInputs = new Map();

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function resolveSources(recipe) {
        return recipe.sources.map((entry) => {
            const spec = (entry && entry.crisp) ? entry : { tileSource: entry, crisp: false };

            if (spec.tileSource === SLIDE) {
                return { tileSource: slideInfo.tileSource, crisp: spec.crisp };
            }

            // Synthetic sources adopt the real slide's dimensions when there is
            // one, so overlays stay registered with it instead of covering a
            // differently shaped region of the viewport.
            const tileSource = slideInfo.geometry
                ? $.extend({}, spec.tileSource, slideInfo.geometry)
                : spec.tileSource;

            return { tileSource: tileSource, crisp: spec.crisp };
        });
    }

    function fitRecipeView(viewer, recipe) {
        if (!recipe.view) {
            return;
        }

        // OpenSeadragon uses image-width units for viewport coordinates. A real
        // WSI is usually not square, so the square demo framings need clamping
        // to the actual image height or they can land mostly outside the image.
        const imageAspect = slideInfo.geometry
            ? slideInfo.geometry.height / slideInfo.geometry.width
            : 1;
        const size = Math.min(recipe.view.size, 1, imageAspect);
        const x = Math.min(Math.max(recipe.view.x, 0), Math.max(0, 1 - size));
        const y = Math.min(Math.max(recipe.view.y, 0), Math.max(0, imageAspect - size));

        viewer.viewport.fitBounds(new $.Rect(  // eslint-disable-line new-cap
            x, y, size, size
        ), true);
    }

    function interactionButtons(event) {
        if (typeof event.buttons === "number") {
            return event.buttons;
        }
        return event.button === 0 ? 1 : event.button === 1 ? 4 : event.button === 2 ? 2 : 0;
    }

    function interactionButton(event) {
        return event.button === 0 ? 1 : event.button === 1 ? 4 : event.button === 2 ? 2 : 0;
    }

    // The drawer normally installs this bridge itself. The gallery also listens
    // at the viewport boundary because OpenSeadragon can consume canvas pointer
    // events before the drawer target sees them.
    function installInteractionBridge(card, viewer) {
        const drawer = viewer.drawer;
        if (!drawer || typeof drawer.setInteractionState !== "function") {
            return;
        }

        let dragging = false;
        const point = (event) => typeof drawer.clientPointToFramebufferPx === "function"
            ? drawer.clientPointToFramebufferPx(event)
            : { x: 0, y: 0 };
        const setState = (state, reason) => drawer.setInteractionState(state, {
            notify: false,
            reason: reason
        });
        const events = [];
        const add = (type, handler) => {
            card.viewport.addEventListener(type, handler, true);
            events.push([type, handler]);
        };

        add("pointerenter", (event) => setState({
            enabled: true, pointerInside: true, pointerPositionPx: point(event),
            activeButtons: interactionButtons(event)
        }, "gallery-pointerenter"));

        add("pointermove", (event) => {
            const p = point(event);
            const state = {
                enabled: true, pointerInside: true, pointerPositionPx: p,
                activeButtons: interactionButtons(event)
            };
            if (dragging) {
                state.dragCurrentPositionPx = p;
            }
            setState(state, "gallery-pointermove");
        });

        add("pointerdown", (event) => {
            const p = point(event);
            const buttons = interactionButtons(event);
            dragging = true;
            setState({
                enabled: true, pointerInside: true, pointerPositionPx: p,
                activeButtons: buttons, dragActive: true,
                dragStartPositionPx: p, dragCurrentPositionPx: p, dragButtons: buttons
            }, "gallery-pointerdown");
        });

        add("pointerup", (event) => {
            const p = point(event);
            const previous = typeof drawer.getInteractionState === "function"
                ? drawer.getInteractionState() : {};
            const completed = dragging || previous.dragActive;
            dragging = false;
            setState({
                enabled: true, pointerInside: true, pointerPositionPx: p,
                activeButtons: interactionButtons(event), dragActive: false,
                dragCurrentPositionPx: p, dragEndPositionPx: p,
                dragSerial: completed ? (previous.dragSerial || 0) + 1 : previous.dragSerial
            }, "gallery-pointerup");
        });

        const leave = () => {
            dragging = false;
            setState({ pointerInside: false, activeButtons: 0, dragActive: false }, "gallery-pointerleave");
        };
        add("pointerleave", leave);
        add("pointercancel", leave);

        add("click", (event) => {
            const previous = typeof drawer.getInteractionState === "function"
                ? drawer.getInteractionState() : {};
            const p = point(event);
            setState({
                enabled: true, pointerInside: true, pointerPositionPx: p,
                lastClickPositionPx: p, lastClickButtons: interactionButton(event),
                clickSerial: (previous.clickSerial || 0) + 1
            }, "gallery-click");
        });

        card.interactionBridgeCleanup = () => {
            events.forEach(([type, handler]) => card.viewport.removeEventListener(type, handler, true));
        };
    }

    function buildCard(recipe) {
        const root = el("section", "card");
        root.id = `card-${recipe.id}`;

        root.appendChild(el("h2", null, recipe.title));

        const types = el("div", "types");
        recipe.types.forEach((t) => types.appendChild(el("code", null, t)));
        root.appendChild(types);

        root.appendChild(el("div", "blurb", recipe.blurb));

        const viewport = el("div", "viewport");
        const placeholder = el("div", "placeholder", "scroll into view to render");
        viewport.appendChild(placeholder);
        root.appendChild(viewport);

        const footer = el("footer");
        const row = el("div", "row");

        const controlsBtn = el("button", null, "controls");
        const jsonBtn = el("button", null, "config JSON");
        row.appendChild(controlsBtn);
        row.appendChild(jsonBtn);

        const controls = el("div", "controls");
        const json = el("pre", "config");

        const card = {
            recipe: recipe,
            root: root,
            viewport: viewport,
            placeholder: placeholder,
            controls: controls,
            json: json,
            viewer: null,
            visible: false,
            active: false,
            interactionContextMenuGuard: null,
            interactionBridgeCleanup: null,
            // Deep clone so live edits from the extras UI never mutate the recipe
            // shared with the JSON panel of another card.
            config: JSON.parse(JSON.stringify(recipe.config)),
            precision: recipe.precision || "unorm8"
        };

        controlsBtn.addEventListener("click", () => controls.classList.toggle("open"));
        jsonBtn.addEventListener("click", () => {
            json.textContent = JSON.stringify(card.config, null, 2);
            json.classList.toggle("open");
        });

        (recipe.extras || []).forEach((extra) => {
            row.appendChild(el("span", null, extra.label));
            const select = el("select");
            extra.options.forEach((opt) => {
                const option = el("option", null, opt);
                option.value = opt;
                select.appendChild(option);
            });
            select.value = extra.value;

            select.addEventListener("change", () => {
                if (extra.kind === "precision") {
                    card.precision = select.value;
                    // The colour-target precision is fixed when the renderer is
                    // created, so this has to be a rebuild rather than a re-config.
                    teardown(card);
                    activate(card);
                    return;
                }

                extra.apply(card.config, select.value);
                if (card.viewer && card.viewer.drawer) {
                    applyConfig(card);
                }
                if (card.json.classList.contains("open")) {
                    card.json.textContent = JSON.stringify(card.config, null, 2);
                }
            });

            row.appendChild(select);
        });

        footer.appendChild(row);
        footer.appendChild(controls);
        footer.appendChild(json);

        if (recipe.note) {
            footer.appendChild(el("div", "note", recipe.note));
        }

        root.appendChild(footer);
        cards.push(card);
        return root;
    }

    function orderOf(config) {
        return Object.keys(config);
    }

    function applyConfig(card) {
        card.viewer.drawer.overrideConfigureAll(card.config, orderOf(card.config));
    }

    function updateSelectionSummary() {
        const count = document.getElementById("selection-count");
        if (count) {
            count.textContent = `${activeIds.size} selected / ${cards.length}`;
        }
    }

    function refreshSelectionInputs() {
        selectionInputs.forEach((input, id) => {
            input.checked = activeIds.has(id);
            input.parentElement.classList.toggle("active", input.checked);
        });
        updateSelectionSummary();
    }

    function syncSelection() {
        cards.forEach((card) => {
            card.active = activeIds.has(card.recipe.id);
            card.root.hidden = !card.active;

            if (!card.active) {
                teardown(card);
            } else if (card.visible) {
                activate(card);
            }
        });
        refreshSelectionInputs();
    }

    function chooseVisualization(id, checked) {
        if (selectionMode === "single") {
            if (checked) {
                activeIds.clear();
                activeIds.add(id);
            }
        } else if (checked) {
            activeIds.add(id);
        } else {
            activeIds.delete(id);
        }
        syncSelection();
    }

    function mountSelectionPicker() {
        const list = document.getElementById("visualization-list");
        RECIPES.forEach((recipe) => {
            const label = el("label");
            const input = document.createElement("input");
            input.type = "checkbox";
            input.value = recipe.id;
            input.checked = activeIds.has(recipe.id);
            input.addEventListener("change", () => chooseVisualization(recipe.id, input.checked));
            label.appendChild(input);
            label.appendChild(document.createTextNode(recipe.title));
            list.appendChild(label);
            selectionInputs.set(recipe.id, input);
        });

        document.querySelectorAll("input[name=selection-mode]").forEach((input) => {
            input.addEventListener("change", () => {
                if (!input.checked) {
                    return;
                }
                selectionMode = input.value;
                if (selectionMode === "single" && activeIds.size !== 1) {
                    const first = activeIds.values().next().value || RECIPES[0].id;
                    activeIds.clear();
                    activeIds.add(first);
                }
                syncSelection();
            });
        });
        refreshSelectionInputs();
    }

    /**
     * Whether any shader layer in the recipe declares `static requiresInteraction()`,
     * i.e. its GLSL reads host-forwarded pointer state (`fr_interaction_*`). This is the
     * reference host pattern: read the flag off the registered class before building
     * anything, and size the input plumbing accordingly.
     *
     * Not to be confused with a UI control's `interactive` flag, which only decides whether
     * a control is user-editable in the panel below the card.
     *
     * A recipe may still set `interaction: true|false` explicitly to override the derivation.
     */
    function recipeNeedsInteraction(recipe) {
        if (typeof recipe.interaction === "boolean") {
            return recipe.interaction;
        }

        const registry = OpenSeadragon.FlexRenderer.ShaderLayerRegistry;
        const walk = (configMap) => {
            return Object.values(configMap || {}).some(layer => {
                if (!layer || typeof layer !== "object") {
                    return false;
                }
                const Klass = layer.type ? registry.get(layer.type) : null;
                if (Klass && typeof Klass.requiresInteraction === "function" &&
                    Klass.requiresInteraction() === true) {
                    return true;
                }
                // group layers keep their children under `shaders`
                return walk(layer.shaders);
            });
        };

        return walk(recipe.config);
    }

    function activate(card) {
        if (!card.active) {
            return;
        }
        if (card.viewer) {
            touch(card);
            return;
        }

        const recipe = card.recipe;
        card.placeholder.textContent = "building…";

        const sources = resolveSources(recipe);
        const needsInteraction = recipeNeedsInteraction(recipe);

        const viewer = card.viewer = OpenSeadragon({  // eslint-disable-line new-cap
            element: card.viewport,
            prefixUrl: "../../openseadragon/images/",
            drawer: "flex-renderer",
            drawerOptions: {
                "flex-renderer": {
                    debug: false,
                    webGLPreferredVersion: "2.0",
                    sharedContextKey: contextKeyFor(card),
                    precision: card.precision,
                    interaction: needsInteraction ? {
                        enabled: true,
                        preventContextMenu: true,
                        // Keep normal pan/zoom available. Pointer events are
                        // still forwarded to the shader interaction state.
                        viewerInputCaptureMode: "none"
                    } : false,
                    htmlHandler: (shaderLayer, shaderConfig) => mountControls(card, shaderLayer, shaderConfig),
                    htmlReset: () => {
                        card.controls.innerHTML = "";
                    }
                }
            },
            crossOriginPolicy: "Anonymous",
            ajaxWithCredentials: false,
            showNavigator: false,
            showNavigationControl: false,
            blendTime: 0,
            minZoomImageRatio: 0.4,
            maxZoomPixelRatio: 12,
            smoothTileEdgesMinZoom: 1.1,
            visibilityRatio: 0.8
        });

        sources.forEach((source, index) => {
            viewer.addTiledImage({
                tileSource: source.tileSource,
                success: (event) => {
                    if (source.crisp && event.item) {
                        // Class maps must not be interpolated between classes.
                        viewer.drawer.setTiledImageSmoothingEnabled(event.item, false);
                    }
                    // Frame once, off the first image: the viewport's home bounds
                    // are only known after an image has opened.
                    if (index === 0 && recipe.view) {
                        fitRecipeView(viewer, recipe);
                    }
                }
            });
        });

        if (needsInteraction) {
            // Keep this at the card boundary as a browser-level fallback. It
            // remains effective even if a viewer or browser stops propagation
            // before the drawer's own contextmenu listener sees the event.
            const contextMenuGuard = (event) => event.preventDefault();
            card.interactionContextMenuGuard = contextMenuGuard;
            card.viewport.addEventListener("contextmenu", contextMenuGuard, true);
            installInteractionBridge(card, viewer);
        }

        applyConfig(card);

        if (recipe.seedTexture) {
            seedTextureControl(card, recipe.seedTexture);
        }

        card.placeholder.style.display = "none";
        touch(card);
        updateContextPill();
    }

    function teardown(card) {
        if (!card.viewer) {
            return;
        }

        try {
            card.viewer.destroy();
        } catch (e) {
            console.warn("gallery: viewer teardown failed", card.recipe.id, e);
        }

        card.viewer = null;
        if (card.interactionBridgeCleanup) {
            card.interactionBridgeCleanup();
            card.interactionBridgeCleanup = null;
        }
        if (card.interactionContextMenuGuard) {
            card.viewport.removeEventListener("contextmenu", card.interactionContextMenuGuard, true);
            card.interactionContextMenuGuard = null;
        }
        card.controls.innerHTML = "";
        card.viewport.innerHTML = "";
        card.viewport.appendChild(card.placeholder);
        card.placeholder.style.display = "";
        card.placeholder.textContent = "scroll into view to render";
        liveOrder = liveOrder.filter((c) => c !== card);
        updateContextPill();
    }

    // Least-recently-used eviction, so scrolling back up rebuilds rather than
    // exhausting the renderer's capacity.
    //
    // Off-screen cards are evicted first; on-screen ones only if that was not
    // enough, because the budget is a hard limit. The card that was just activated
    // is always spared -- otherwise the first screenful, which the observer
    // activates in one burst, tears down its own oldest members and the top card
    // is left showing a placeholder on a freshly loaded page.
    function touch(card) {
        liveOrder = liveOrder.filter((c) => c !== card);
        liveOrder.push(card);

        for (const preferOffscreen of [true, false]) {
            for (const victim of liveOrder.slice()) {
                if (liveOrder.length <= LIVE_VIEWER_BUDGET) {
                    return;
                }
                if (victim !== card && (!preferOffscreen || !victim.visible)) {
                    teardown(victim);
                }
            }
        }
    }

    function mountControls(card, shaderLayer, shaderConfig) {
        if (!shaderLayer || typeof shaderLayer.htmlControls !== "function") {
            return;
        }

        const block = el("div", "shader-block");
        block.appendChild(el("h4", null, shaderConfig.name || shaderConfig.type || "layer"));
        const body = el("div");
        body.innerHTML = shaderLayer.htmlControls();
        block.appendChild(body);
        card.controls.appendChild(block);
    }

    /**
     * Push a generated image into the atlas the `texture` layer samples.
     *
     * The atlas deliberately starts empty and is normally filled by the control's
     * own file input; a gallery card cannot wait for a user to pick a file, so it
     * uploads one itself. The layer instance only exists once the second pass has
     * been built, hence the retry.
     */
    function seedTextureControl(card, spec, attempt = 0) {
        if (!card.viewer || attempt > 60) {
            return;
        }

        const renderer = card.viewer.drawer && card.viewer.drawer.renderer;
        const layer = renderer && typeof renderer.getShaderLayer === "function"
            ? renderer.getShaderLayer(spec.layerId)
            : null;
        const control = layer && layer[spec.controlName];

        if (!control || !control.atlas) {
            requestAnimationFrame(() => seedTextureControl(card, spec, attempt + 1));
            return;
        }

        if (control.raw >= 0) {
            return;
        }

        if (!annotationTextureUrl) {
            annotationTextureUrl = makeAnnotationTexture();
        }

        const image = new Image();
        image.onload = () => {
            try {
                const textureId = control.atlas.addImage(image, {
                    width: image.naturalWidth,
                    height: image.naturalHeight
                });
                control.atlas._commitUploads();
                control.set(textureId);
                if (control.owner && typeof control.owner.invalidate === "function") {
                    control.owner.invalidate();
                }
                card.viewer.forceRedraw();
            } catch (e) {
                console.warn("gallery: could not seed the texture atlas; use the upload control instead", e);
            }
        };
        image.src = annotationTextureUrl;
    }

    // ----------------------------------------------------------------- page setup

    function updateContextPill() {
        const pill = document.querySelector("#gl-pill b");
        if (!pill) {
            return;
        }

        let shared = 0;
        try {
            const status = $.FlexRenderer.getSharedContextStatus();
            shared = Array.isArray(status) ? status.length : Object.keys(status || {}).length;
        } catch (e) {
            shared = 0;
        }

        pill.textContent = `${liveOrder.length} live viewer${liveOrder.length === 1 ? "" : "s"}, ${shared} shared`;
    }

    const NOUISLIDER_JS = "https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.8.1/nouislider.min.js";
    const NOUISLIDER_CSS = "https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.8.1/nouislider.css";

    /**
     * Pull in noUiSlider, which the `advanced_slider` control needs.
     *
     * Deliberately not a <script> tag in the document head: a CDN that hangs would
     * then hold up the whole page instead of costing us one control type. Resolves
     * either way, and the caller carries on regardless.
     */
    function loadNoUiSlider() {
        return new Promise((resolve) => {
            if (window.noUiSlider) {
                resolve(true);
                return;
            }

            let settled = false;
            const finish = (ok) => {
                if (!settled) {
                    settled = true;
                    resolve(ok && !!window.noUiSlider);
                }
            };

            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = NOUISLIDER_CSS;
            document.head.appendChild(link);

            const script = document.createElement("script");
            script.src = NOUISLIDER_JS;
            script.onload = () => finish(true);
            script.onerror = () => finish(false);
            document.head.appendChild(script);

            setTimeout(() => finish(false), 6000);
        });
    }

    async function main() {
        const [slide, sliders] = await Promise.all([
            SP.resolveSlideSource(),
            loadNoUiSlider()
        ]);
        slideInfo = slide;

        const sliderPill = document.getElementById("slider-pill");
        if (!sliders) {
            sliderPill.hidden = false;
            sliderPill.classList.add("synthetic");
            sliderPill.innerHTML = "break sliders: <b>noUiSlider unavailable</b>";
        }

        const pill = document.getElementById("slide-pill");
        pill.classList.add(slideInfo.real ? "real" : "synthetic");
        pill.innerHTML = `slide: <b>${slideInfo.label}</b>`;

        const registered = $.FlexRenderer.ShaderLayerRegistry.availableShaderLayers();
        const count = Array.isArray(registered) ? registered.length : Object.keys(registered || {}).length;
        document.querySelector("#layer-pill b").textContent =
            `${RECIPES.length} cards / ${count} types registered`;

        const gallery = document.getElementById("gallery");
        RECIPES.forEach((recipe) => gallery.appendChild(buildCard(recipe)));

        // Lazy card building is a progressive enhancement. Without an observer,
        // selected cards are still usable; they simply build immediately.
        if (typeof IntersectionObserver === "function") {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const card = cards.find((c) => c.root === entry.target);
                    if (!card) {
                        return;
                    }
                    card.visible = entry.isIntersecting;
                    if (entry.isIntersecting && card.active) {
                        activate(card);
                    }
                });
            }, { rootMargin: "80px 0px" });

            cards.forEach((card) => observer.observe(card.root));
        } else {
            cards.forEach((card) => {
                card.visible = true;
            });
        }
        mountSelectionPicker();
        syncSelection();

        document.getElementById("toggle-configs").addEventListener("click", (e) => {
            const open = e.target.textContent.startsWith("Show");
            cards.forEach((card) => {
                card.json.textContent = JSON.stringify(card.config, null, 2);
                card.json.classList.toggle("open", open);
            });
            e.target.textContent = open ? "Hide all config JSON" : "Show all config JSON";
        });

        document.getElementById("toggle-controls").addEventListener("click", (e) => {
            const open = e.target.textContent.startsWith("Show");
            cards.forEach((card) => card.controls.classList.toggle("open", open));
            e.target.textContent = open ? "Hide all controls" : "Show all controls";
        });

        window.galleryCards = cards;
    }

    main().catch((e) => {
        console.error("gallery: setup failed", e);
    });

})(OpenSeadragon);
