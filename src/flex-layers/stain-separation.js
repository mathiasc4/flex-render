(function($) {
/**
 * H&E (and related) stain-separation shader.
 *
 * Implements Ruifrok–Johnston color deconvolution for brightfield slides.
 * Each preset bakes a 3x3 stain matrix M whose rows are the normalized RGB
 * optical-density signatures of the stains. The inverse Q = M^-1 is computed
 * once at module load and injected as a GLSL constant; per pixel:
 *
 *   OD     = -log10((rgb*255 + 1) / 256)
 *   stains = OD * Q     (vec3 * mat3 -> row-vector multiply)
 *
 * The user picks one stain to display. Output is either the raw concentration
 * (debug) or the concentration multiplied by a tint color.
 */

// Standard Ruifrok stain RGB-OD vectors.
const STAIN_VECTORS = {
    H: [0.65, 0.70, 0.29],
    E: [0.07, 0.99, 0.11],
    DAB: [0.27, 0.57, 0.78],
    MG: [0.0, 1.0, 0.0],
    R: [0.27, 0.57, 0.78]   // Ruifrok's residual for HE
};

// Stain enum -> select option index. Must match SHADER_STAIN_* constants below.
const STAIN_H = 0;
const STAIN_E = 1;
const STAIN_DAB = 2;
const STAIN_MG = 3;
const STAIN_R = 4;

function normalize3(v) {
    const m = Math.hypot(v[0], v[1], v[2]);
    return m > 0 ? [v[0] / m, v[1] / m, v[2] / m] : [0, 0, 0];
}

function cross3(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

// Build a 3-row stain matrix; if autoResidualIndex is given, fill that row
// with the cross product of the other two normalized rows.
function buildMatrix(rows, autoResidualIndex) {
    const m = rows.map(r => r ? normalize3(r) : null);
    if (autoResidualIndex !== undefined) {
        const others = m.filter((_, i) => i !== autoResidualIndex);
        m[autoResidualIndex] = normalize3(cross3(others[0], others[1]));
    }
    return m;
}

function inverse3(rows) {
    const [a, b, c] = rows[0];
    const [d, e, f] = rows[1];
    const [g, h, i] = rows[2];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) {
        return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    }
    const k = 1 / det;
    return [
        [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k],
        [(f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k],
        [(d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k]
    ];
}

// Emit a GLSL mat3 literal in column-major order from a row-major JS matrix.
// We use vec3 * mat3 in GLSL, which is row-vector * matrix; storing M^-1 in
// the natural column-major layout makes that multiply produce the right thing.
function glslMat3(rowMajor) {
    const f = (x) => Number(x).toFixed(6);
    const m = rowMajor;
    return `mat3(` +
        `${f(m[0][0])}, ${f(m[1][0])}, ${f(m[2][0])}, ` +
        `${f(m[0][1])}, ${f(m[1][1])}, ${f(m[2][1])}, ` +
        `${f(m[0][2])}, ${f(m[1][2])}, ${f(m[2][2])})`;
}

function glslVec3(v) {
    const f = (x) => Number(x).toFixed(6);
    return `vec3(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;
}

// preset id -> { matrix rows (input order), GLSL inverse literal, mapping
// from stain enum to row index, list of stains the preset exposes }.
// Row order in each `rows` array fixes the index of each stain in `stains`
// that comes out of the deconvolution.
const PRESETS = (() => {
    function build(id, rowsInput, stainOrder, autoResidualIndex) {
        const rows = buildMatrix(rowsInput, autoResidualIndex);
        const inv = inverse3(rows);
        // stainEnum -> row index (0..2), or -1 if not in this preset.
        const stainToRow = { H: -1, E: -1, DAB: -1, MG: -1, R: -1 };
        stainOrder.forEach((name, idx) => {
            stainToRow[name] = idx;
        });
        return {
            id,
            matrixInvGlsl: glslMat3(inv),
            // Per-row normalized stain RGB-OD vector, used for natural reconstruction.
            stainVecGlsl: rows.map(glslVec3),
            stainToRow,
            stainOrder
        };
    }

    return {
        he: build("he", [STAIN_VECTORS.H, STAIN_VECTORS.E, STAIN_VECTORS.R], ["H", "E", "R"]),
        hdab: build("hdab", [STAIN_VECTORS.H, STAIN_VECTORS.DAB, null], ["H", "DAB", "R"], 2),
        hedab: build("hedab", [STAIN_VECTORS.H, STAIN_VECTORS.E, STAIN_VECTORS.DAB], ["H", "E", "DAB"]),
        mgdab: build("mgdab", [STAIN_VECTORS.MG, STAIN_VECTORS.DAB, null], ["MG", "DAB", "R"], 2)
    };
})();

const PRESET_INDEX = ["he", "hdab", "hedab", "mgdab"];

// Build the GLSL fragment that maps (preset, stain) -> matrix row index, plus
// the helper that returns the per-preset M^-1. Indices are stable across the
// shader uniform values for `preset` and `stain`.
function buildHelpersGlsl(uid) {
    const matrixBranches = PRESET_INDEX
        .map((id, i) => `    if (preset == ${i}) return ${PRESETS[id].matrixInvGlsl};`)
        .join("\n");

    const rowBranches = PRESET_INDEX.map((id, presetIdx) => {
        const m = PRESETS[id].stainToRow;
        const checks = [
            ["H", STAIN_H],
            ["E", STAIN_E],
            ["DAB", STAIN_DAB],
            ["MG", STAIN_MG],
            ["R", STAIN_R]
        ]
            .filter(([key]) => m[key] >= 0)
            .map(([key, enumVal]) => `        if (stain == ${enumVal}) return ${m[key]};`)
            .join("\n");
        return `    if (preset == ${presetIdx}) {\n${checks}\n        return -1;\n    }`;
    }).join("\n");

    const vectorBranches = PRESET_INDEX.map((id, presetIdx) => {
        const vecs = PRESETS[id].stainVecGlsl;
        const checks = vecs.map((v, row) => `        if (row == ${row}) return ${v};`).join("\n");
        return `    if (preset == ${presetIdx}) {\n${checks}\n    }`;
    }).join("\n");

    return `
mat3 stain_matrix_inv_${uid}(int preset) {
${matrixBranches}
    return mat3(1.0);
}

int stain_row_${uid}(int preset, int stain) {
${rowBranches}
    return -1;
}

vec3 stain_vector_${uid}(int preset, int row) {
${vectorBranches}
    return vec3(0.0);
}

float stain_pick_${uid}(vec3 stains, int row) {
    if (row == 0) return stains.x;
    if (row == 1) return stains.y;
    return stains.z;
}
`;
}

$.FlexRenderer.ShaderLayerRegistry.register(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "stain-separation";
    }

    static name() {
        return "H&E stain separation";
    }

    static description() {
        return "Ruifrok–Johnston color deconvolution for brightfield H&E and related stain combinations (H-DAB, HE-DAB, MG-DAB).";
    }

    static intent() {
        return "Separate and visualise individual stains in brightfield RGB slides (H&E, H-DAB, etc.).";
    }

    static expects() {
        return { dataKind: "rgb", channels: 3 };
    }

    static exampleParams() {
        return {
            preset: 0,
            stain: 0,
            style: 0,
            tintColor: "#5b3ea4",
            intensity: 1.0
        };
    }

    static docs() {
        return {
            summary: "Brightfield stain separation via Ruifrok–Johnston color deconvolution.",
            description: "Reads RGB, converts to optical density, multiplies by the inverse stain matrix of the chosen preset, and renders one stain channel. The default Natural style physically reconstructs what the slide would look like with only the chosen stain present (opaque, calibrated colors); Tinted multiplies a custom color by the concentration; Grayscale shows the raw concentration. Stain options not present in the chosen preset render as transparent.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [3, 4],
                description: "RGB brightfield slide (alpha is ignored)"
            }],
            controls: [
                { name: "use_channel0", required: "rgb" },
                {
                    name: "preset",
                    ui: "select",
                    valueType: "int",
                    default: 0,
                    description: "Stain matrix preset: 0=H&E, 1=H-DAB, 2=HE-DAB, 3=MG-DAB."
                },
                {
                    name: "stain",
                    ui: "select",
                    valueType: "int",
                    default: 0,
                    description: "Which stain to display: 0=Hematoxylin, 1=Eosin, 2=DAB, 3=Methyl Green, 4=Residual. Stains absent from the chosen preset render transparent."
                },
                {
                    name: "style",
                    ui: "select",
                    valueType: "int",
                    default: 0,
                    description: "Display style: 0=Natural (physically reconstructed single-stain slide, opaque), 1=Tinted (stain concentration multiplied by tintColor, alpha = concentration), 2=Grayscale (concentration as gray, alpha = concentration)."
                },
                { name: "tintColor", ui: "color", valueType: "vec3", default: "#5b3ea4" },
                { name: "intensity", ui: "range_input", valueType: "float", default: 1.0, min: 0, max: 10, step: 0.1 }
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (n) => n >= 3,
            description: "RGB brightfield slide (alpha is ignored)"
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                required: "rgb"
            },
            preset: {
                default: {
                    type: "select",
                    default: 0,
                    title: "Preset",
                    options: [
                        { value: 0, label: "H&E" },
                        { value: 1, label: "H-DAB" },
                        { value: 2, label: "HE-DAB" },
                        { value: 3, label: "MG-DAB" }
                    ]
                },
                accepts: (type) => type === "int"
            },
            stain: {
                default: {
                    type: "select",
                    default: 0,
                    title: "Stain",
                    options: [
                        { value: STAIN_H, label: "Hematoxylin" },
                        { value: STAIN_E, label: "Eosin" },
                        { value: STAIN_DAB, label: "DAB" },
                        { value: STAIN_MG, label: "Methyl Green" },
                        { value: STAIN_R, label: "Residual" }
                    ]
                },
                accepts: (type) => type === "int"
            },
            style: {
                default: {
                    type: "select",
                    default: 0,
                    title: "Style",
                    options: [
                        { value: 0, label: "Natural" },
                        { value: 1, label: "Tinted" },
                        { value: 2, label: "Grayscale" }
                    ]
                },
                accepts: (type) => type === "int"
            },
            tintColor: {
                default: { type: "color", default: "#5b3ea4", title: "Tint" },
                accepts: (type) => type === "vec3"
            },
            intensity: {
                default: { type: "range_input", default: 1.0, min: 0, max: 10, step: 0.1, title: "Intensity" },
                accepts: (type) => type === "float"
            }
        };
    }

    getFragmentShaderDefinition() {
        return `
${super.getFragmentShaderDefinition()}
${buildHelpersGlsl(this.uid)}
`;
    }

    getFragmentShaderExecution() {
        const uid = this.uid;
        return `
    vec3 rgb = ${this.sampleChannel('v_texture_coords', 0, true)};
    rgb = clamp(rgb, vec3(1.0 / 255.0), vec3(1.0));
    vec3 od = -log((rgb * 255.0 + 1.0) / 256.0) / log(10.0);

    int preset = int(${this.preset.sample()});
    int stain  = int(${this.stain.sample()});
    int row = stain_row_${uid}(preset, stain);
    if (row < 0) {
        return vec4(0.0);
    }

    mat3 Q = stain_matrix_inv_${uid}(preset);
    vec3 stains = od * Q;
    float v = max(stain_pick_${uid}(stains, row), 0.0);
    float scaled = ${this.filter(`v * ${this.intensity.sample()}`)};

    int style = int(${this.style.sample()});
    if (style == 0) {
        // Natural reconstruction: rebuild what the slide would look like with
        // only this stain present. exp(-c*s*ln10) inverts the OD formulation
        // back to RGB in [0,1]. Output is fully opaque so contrast is preserved
        // against any background.
        vec3 stainVec = stain_vector_${uid}(preset, row);
        vec3 reconRgb = exp(-scaled * stainVec * log(10.0));
        return vec4(clamp(reconRgb, 0.0, 1.0), ${this.opacity.sample()});
    }

    float t = clamp(scaled, 0.0, 1.0);
    if (style == 2) {
        return vec4(vec3(t), t);
    }
    return vec4(t * ${this.tintColor.sample()}, t);
`;
    }
});
})(OpenSeadragon);
