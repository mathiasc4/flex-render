
(function($) {
/**
 * Phosphor icon sets for {@link OpenSeadragon.FlexRenderer.UIControls.IconLibrary}.
 *
 * Only *metadata* ships here — names, aliases, tags and the font family the
 * glyphs live in. The webfont itself is never bundled: the host page is
 * responsible for loading Phosphor, e.g.
 *
 *     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2/src/regular/style.css">
 *     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2/src/fill/style.css">
 *
 * Codepoints come from `icon-codepoints.generated.js`, so rendering needs the
 * font but *not* the stylesheet's CSS classes. Icons stay pending (and retry)
 * until `document.fonts` reports the family as available.
 *
 * `ph-regular-common` is the outline weight (closest to `fa-regular-common`),
 * `ph-fill-common` is the solid weight (closest to `fa-solid-common`). Both
 * carry the same icon list. FA names are registered as aliases so styles
 * authored against Font Awesome keep resolving.
 */
const makeClass = (name, className, aliases = [], tags = []) => ({
    name,
    className,
    aliases,
    tags
});

// Single source of truth for both weights: [name, aliases, tags].
// The weight prefix ("ph" / "ph-fill") is applied when the set is built.
const common = [
    ["house", ["home", "fa-house"], ["building", "ui"]],
    ["map-pin", ["location-dot", "pin", "marker", "fa-location-dot"], ["map", "marker"]],
    ["flag", ["fa-flag"], ["marker"]],
    ["star", ["fa-star"], ["rating"]],
    ["heart", ["fa-heart"], ["status"]],
    ["circle", ["fa-circle"], ["shape"]],
    ["square", ["fa-square"], ["shape"]],
    ["warning", ["triangle-exclamation", "alert", "fa-triangle-exclamation"], ["status"]],
    ["diamond", ["gem", "fa-gem"], ["shape"]],
    ["plus", ["add", "fa-plus"], ["action"]],
    ["minus", ["subtract", "fa-minus"], ["action"]],
    ["x", ["xmark", "times", "close", "fa-xmark"], ["action"]],
    ["check", ["ok", "done", "fa-check"], ["action", "status"]],
    ["info", ["circle-info", "fa-circle-info"], ["status"]],
    ["question", ["help", "circle-question", "fa-circle-question"], ["status"]],
    ["gear", ["settings", "cog", "fa-gear"], ["ui"]],
    ["magnifying-glass", ["search", "fa-magnifying-glass"], ["ui"]],
    ["envelope", ["mail", "fa-envelope"], ["communication"]],
    ["phone", ["call", "fa-phone"], ["communication"]],
    ["user", ["person", "profile", "fa-user"], ["people"]],
    ["users", ["group", "fa-users"], ["people"]],
    ["lock", ["secure", "fa-lock"], ["security"]],
    ["lock-open", ["unlock", "fa-unlock"], ["security"]],
    ["eye", ["view", "visible", "fa-eye"], ["visibility"]],
    ["eye-slash", ["hidden", "fa-eye-slash"], ["visibility"]],
    ["sun", ["fa-sun"], ["weather"]],
    ["moon", ["fa-moon"], ["weather"]],
    ["cloud", ["fa-cloud"], ["weather"]],
    ["cloud-rain", ["fa-cloud-rain"], ["weather"]],
    ["umbrella", ["fa-umbrella"], ["weather"]],
    ["snowflake", ["fa-snowflake"], ["weather"]],
    ["lightning", ["bolt", "fa-bolt"], ["energy", "status"]],
    ["music-note", ["music", "fa-music"], ["media"]],
    ["play", ["fa-play"], ["media"]],
    ["pause", ["fa-pause"], ["media"]],
    ["stop", ["fa-stop"], ["media"]],
    ["rewind", ["backward", "fa-backward"], ["media"]],
    ["fast-forward", ["forward", "fa-forward"], ["media"]],
    ["image", ["picture", "fa-image"], ["media"]],
    ["camera", ["photo", "fa-camera"], ["media"]],
    ["video-camera", ["video", "fa-video"], ["media"]],
    ["folder", ["directory", "fa-folder"], ["ui"]],
    ["file", ["document", "fa-file"], ["ui"]],
    ["file-text", ["file-lines", "fa-file-lines"], ["ui"]],
    ["trash", ["delete", "bin", "fa-trash"], ["action"]],
    ["pencil", ["edit", "pen", "fa-pen"], ["action"]],
    ["scissors", ["cut", "fa-scissors"], ["action"]],
    ["copy", ["fa-copy"], ["action"]],
    ["clipboard", ["paste", "fa-paste"], ["action"]],
    ["download-simple", ["download", "fa-download"], ["action"]],
    ["upload-simple", ["upload", "fa-upload"], ["action"]],
    ["share-network", ["share", "share-nodes", "fa-share-nodes"], ["action"]],
    ["link", ["fa-link"], ["action"]],
    ["funnel", ["filter", "fa-filter"], ["ui"]],
    ["sliders", ["fa-sliders"], ["ui"]],
    ["palette", ["fa-palette"], ["design"]],
    ["paint-brush", ["brush", "fa-brush"], ["design"]],
    ["ruler", ["measure", "fa-ruler"], ["tools"]],
    ["crop", ["fa-crop"], ["tools"]],
    ["crosshair", ["crosshairs", "fa-crosshairs"], ["marker"]],
    ["target", ["bullseye", "fa-bullseye"], ["marker"]],
    ["tag", ["label", "fa-tag"], ["ui"]],
    ["bookmark-simple", ["bookmark", "fa-bookmark"], ["ui"]],
    ["clock", ["time", "fa-clock"], ["ui"]],
    ["calendar", ["fa-calendar"], ["ui"]],
    ["bell", ["notification", "fa-bell"], ["ui"]],
    ["chat-circle", ["message", "fa-message"], ["communication"]],
    ["user-circle", ["fa-circle-user"], ["people"]],
    ["microscope", ["fa-microscope"], ["science"]],
    ["flask", ["fa-flask"], ["science"]],
    ["dna", ["fa-dna"], ["science"]],
    ["leaf", ["fa-leaf"], ["nature"]],
    ["fire", ["fa-fire"], ["status"]],
    ["drop", ["droplet", "water", "fa-droplet"], ["nature"]],
    ["plant", ["seedling", "fa-seedling"], ["nature"]],
    ["hospital", ["fa-hospital"], ["medical"]],
    ["stethoscope", ["fa-stethoscope"], ["medical"]],
    ["syringe", ["fa-syringe"], ["medical"]],
    ["pill", ["pills", "fa-pills"], ["medical"]],
    ["bug", ["fa-bug"], ["dev"]],
    ["shield-check", ["shield-halved", "fa-shield-halved"], ["security"]],
    ["database", ["fa-database"], ["dev"]],
    ["hard-drives", ["server", "fa-server"], ["dev"]],
    ["chart-line", ["fa-chart-line"], ["data"]],
    ["chart-pie", ["fa-chart-pie"], ["data"]],
    ["stack", ["layer-group", "layers", "fa-layer-group"], ["data"]],
    ["grid-four", ["grid", "table-cells", "fa-table-cells"], ["data"]]
];

const buildCommon = (weightClass) => common.map(([name, aliases, tags]) =>
    makeClass(name, `${weightClass} ph-${name}`, aliases, tags));

// Phosphor keeps its logos in the regular font. Font Awesome brands with no
// Phosphor counterpart (docker, npm, node-js, firefox, edge, python) are
// intentionally absent — use the `fa-brands-common` set for those.
const phBrandsCommon = [
    makeClass("github-logo", "ph ph-github-logo", ["github", "fa-github"], ["brand"]),
    makeClass("gitlab-logo", "ph ph-gitlab-logo", ["gitlab", "fa-gitlab"], ["brand"]),
    makeClass("google-chrome-logo", "ph ph-google-chrome-logo", ["chrome", "fa-chrome"], ["brand"]),
    makeClass("linux-logo", "ph ph-linux-logo", ["linux", "fa-linux"], ["brand"]),
    makeClass("windows-logo", "ph ph-windows-logo", ["windows", "fa-windows"], ["brand"]),
    makeClass("apple-logo", "ph ph-apple-logo", ["apple", "fa-apple"], ["brand"]),
    makeClass("google-logo", "ph ph-google-logo", ["google", "fa-google"], ["brand"]),
    makeClass("file-js", "ph ph-file-js", ["js", "javascript", "fa-js"], ["brand", "dev"]),
    makeClass("file-html", "ph ph-file-html", ["html", "html5", "fa-html5"], ["brand", "dev"]),
    makeClass("file-css", "ph ph-file-css", ["css", "css3", "fa-css3-alt"], ["brand", "dev"]),
    makeClass("slack-logo", "ph ph-slack-logo", ["slack", "fa-slack"], ["brand"]),
    makeClass("discord-logo", "ph ph-discord-logo", ["discord", "fa-discord"], ["brand"]),
    makeClass("figma-logo", "ph ph-figma-logo", ["figma", "fa-figma"], ["brand"]),
    makeClass("x-logo", "ph ph-x-logo", ["twitter", "x-twitter", "fa-x-twitter"], ["brand"]),
    makeClass("stack-overflow-logo", "ph ph-stack-overflow-logo", ["stackoverflow"], ["brand"]),
    makeClass("codepen-logo", "ph ph-codepen-logo", ["codepen"], ["brand"]),
    makeClass("open-ai-logo", "ph ph-open-ai-logo", ["openai"], ["brand"]),
    makeClass("linkedin-logo", "ph ph-linkedin-logo", ["linkedin"], ["brand"]),
    makeClass("youtube-logo", "ph ph-youtube-logo", ["youtube"], ["brand"]),
    makeClass("reddit-logo", "ph ph-reddit-logo", ["reddit"], ["brand"])
];

$.FlexRenderer.UIControls.IconLibrary
    .registerSet("ph-regular-common", {
        kind: "font-class",
        fontFamily: "'Phosphor'",
        fontWeight: "400",
        items: buildCommon("ph")
    })
    .registerSet("ph-fill-common", {
        kind: "font-class",
        fontFamily: "'Phosphor-Fill'",
        fontWeight: "400",
        items: buildCommon("ph-fill")
    })
    .registerSet("ph-brands-common", {
        kind: "font-class",
        fontFamily: "'Phosphor'",
        fontWeight: "400",
        items: phBrandsCommon
    });

})(OpenSeadragon);
