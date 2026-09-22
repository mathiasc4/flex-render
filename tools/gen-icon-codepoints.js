#!/usr/bin/env node
/**
 * Generates `src/flex-controls/icon-sets/icon-codepoints.generated.js`.
 *
 * The icon sets in `src/flex-controls/icon-sets/*.js` declare CSS class names
 * ("ph ph-house", "fa-solid fa-house"). At render time the IconLibrary needs
 * the *codepoint* behind each class so it can draw the glyph on a canvas
 * without the icon stylesheet being present in the document. This script
 * extracts those codepoints from the icon packages' own CSS and emits them as
 * a plain lookup table.
 *
 * Run with `npm run icons` after adding or renaming an icon. The packages are
 * devDependencies only — no font or CSS is shipped with flex-renderer.
 *
 * Exits non-zero (and writes nothing) if any declared class name is absent
 * from the parsed CSS, so a typo can never reach the bundle as a silent
 * missing icon.
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const setsDir = path.join(repoRoot, "src", "flex-controls", "icon-sets");
const outFile = path.join(setsDir, "icon-codepoints.generated.js");

const read = (...segments) => {
    const file = path.join(repoRoot, ...segments);
    if (!fs.existsSync(file)) {
        console.error(`Missing ${path.relative(repoRoot, file)} — run \`npm install\` first.`);
        process.exit(1);
    }
    return fs.readFileSync(file, "utf8");
};

const packageVersion = (name) =>
    JSON.parse(read("node_modules", ...name.split("/"), "package.json")).version;

/**
 * Phosphor ships one stylesheet per weight, each with rules shaped
 * `.ph.ph-acorn:before { content: "\eb9a"; }` (the first class is the weight).
 * Codepoints differ between weights, so every weight is parsed separately and
 * keyed by its own weight class.
 */
const parsePhosphor = (weightClass, cssPath) => {
    const css = read(...cssPath);
    const escaped = weightClass.replace(/-/g, "\\-");
    const pattern = new RegExp(`\\.${escaped}\\.ph-([a-z0-9-]+):before\\s*\\{\\s*content:\\s*"\\\\([0-9a-fA-F]+)"`, "g");
    const table = new Map();
    for (const match of css.matchAll(pattern)) {
        table.set(`${weightClass} ph-${match[1]}`, Number.parseInt(match[2], 16));
    }
    return table;
};

/**
 * Font Awesome 6 declares codepoints as a custom property on the icon class
 * (`.fa-house { --fa: "\f015"; }`), shared by every style. The style class
 * ("fa-solid" / "fa-regular" / "fa-brands") only selects the font family and
 * weight, so one table serves all three sets.
 */
const parseFontAwesome = () => {
    const css = read("node_modules", "@fortawesome", "fontawesome-free", "css", "all.css");
    const table = new Map();
    for (const match of css.matchAll(/\.fa-([a-z0-9-]+)\s*\{\s*--fa:\s*"\\([0-9a-fA-F]+)"/g)) {
        table.set(`fa-${match[1]}`, Number.parseInt(match[2], 16));
    }
    return table;
};

// Every class name declared by the hand-written set files, in source order.
const collectDeclaredClasses = () => {
    const declared = [];
    for (const file of fs.readdirSync(setsDir)) {
        if (!file.endsWith(".js") || file.endsWith(".generated.js")) {
            continue;
        }
        const source = fs.readFileSync(path.join(setsDir, file), "utf8");
        // Literal class strings, plus phosphor.js's `${weightClass} ph-${name}`
        // template, which is expanded from the weights it registers.
        for (const match of source.matchAll(/"((?:ph|ph-fill|ph-bold|ph-thin|ph-light|ph-duotone|fa-solid|fa-regular|fa-brands) (?:ph|fa)-[a-z0-9-]+)"/g)) {
            declared.push({ className: match[1], file });
        }
        for (const match of source.matchAll(/buildCommon\("([a-z-]+)"\)/g)) {
            const weightClass = match[1];
            for (const entry of source.matchAll(/^\s*\["([a-z0-9-]+)",/gm)) {
                declared.push({ className: `${weightClass} ph-${entry[1]}`, file });
            }
        }
    }
    return declared;
};

const phosphorTables = [
    parsePhosphor("ph", ["node_modules", "@phosphor-icons", "web", "src", "regular", "style.css"]),
    parsePhosphor("ph-fill", ["node_modules", "@phosphor-icons", "web", "src", "fill", "style.css"]),
    parsePhosphor("ph-bold", ["node_modules", "@phosphor-icons", "web", "src", "bold", "style.css"])
];
const faTable = parseFontAwesome();

const lookup = (className) => {
    for (const table of phosphorTables) {
        if (table.has(className)) {
            return table.get(className);
        }
    }
    // "fa-solid fa-house" -> "fa-house"
    const iconClass = className.split(/\s+/).pop();
    return faTable.has(iconClass) ? faTable.get(iconClass) : undefined;
};

const codepoints = new Map();
const missing = [];
for (const { className, file } of collectDeclaredClasses()) {
    if (codepoints.has(className)) {
        continue;
    }
    const codepoint = lookup(className);
    if (codepoint === undefined) {
        missing.push(`${file}: "${className}"`);
        continue;
    }
    codepoints.set(className, codepoint);
}

if (missing.length) {
    console.error(`${missing.length} icon class(es) not found in the installed icon packages:`);
    missing.forEach(entry => console.error(`  ${entry}`));
    console.error("Fix the name in the set file, or install a package version that has it. Nothing was written.");
    process.exit(1);
}

const entries = [...codepoints.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([className, codepoint]) => `    "${className}": 0x${codepoint.toString(16)}`)
    .join(",\n");

const output = `
(function($) {
/**
 * GENERATED FILE — do not edit. Run \`npm run icons\` to regenerate.
 *
 * Maps an icon set's CSS class name to the codepoint of the glyph it renders,
 * so {@link OpenSeadragon.FlexRenderer.UIControls.IconLibrary} can rasterize
 * icons with only the webfont loaded — the icon stylesheet is not required.
 *
 * Sources: @phosphor-icons/web ${packageVersion("@phosphor-icons/web")}, @fortawesome/fontawesome-free ${packageVersion("@fortawesome/fontawesome-free")}
 */
$.FlexRenderer.UIControls.IconCodepoints = {
${entries}
};

})(OpenSeadragon);
`.trimStart();

fs.writeFileSync(outFile, output, "utf8");
console.log(`Wrote ${codepoints.size} codepoints to ${path.relative(repoRoot, outFile)}`);
