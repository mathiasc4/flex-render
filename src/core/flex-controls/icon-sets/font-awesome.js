
(function($) {
/**
 * Font Awesome 6 Free icon sets for {@link OpenSeadragon.FlexRenderer.UIControls.IconLibrary}.
 *
 * Metadata only — the webfont is never bundled. The host page loads Font
 * Awesome itself if it wants these sets, e.g.
 *
 *     <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">
 *
 * See `phosphor.js` for the equivalent Phosphor sets. Font Awesome is kept
 * because it covers brand icons Phosphor has no counterpart for (docker, npm,
 * node-js, firefox, edge, python).
 */
const makeClass = (name, className, aliases = [], tags = []) => ({
    name,
    className,
    aliases,
    tags
});

const faSolidCommon = [
    makeClass("house", "fa-solid fa-house", ["home"], ["building", "ui"]),
    makeClass("location-dot", "fa-solid fa-location-dot", ["map-marker", "pin"], ["map", "marker"]),
    makeClass("flag", "fa-solid fa-flag", [], ["marker"]),
    makeClass("star", "fa-solid fa-star", [], ["rating"]),
    makeClass("heart", "fa-solid fa-heart", [], ["status"]),
    makeClass("circle", "fa-solid fa-circle", ["dot"], ["shape"]),
    makeClass("square", "fa-solid fa-square", [], ["shape"]),
    makeClass("triangle-exclamation", "fa-solid fa-triangle-exclamation", ["warning", "alert"], ["status"]),
    makeClass("diamond", "fa-solid fa-gem", ["gem"], ["shape"]),
    makeClass("plus", "fa-solid fa-plus", ["add"], ["action"]),
    makeClass("minus", "fa-solid fa-minus", ["subtract"], ["action"]),
    makeClass("xmark", "fa-solid fa-xmark", ["close", "times"], ["action"]),
    makeClass("check", "fa-solid fa-check", ["ok"], ["action"]),
    makeClass("circle-info", "fa-solid fa-circle-info", ["info", "information"], ["status"]),
    makeClass("circle-question", "fa-solid fa-circle-question", ["question", "help"], ["status"]),
    makeClass("gear", "fa-solid fa-gear", ["cog", "settings"], ["ui"]),
    makeClass("magnifying-glass", "fa-solid fa-magnifying-glass", ["search"], ["ui"]),
    makeClass("envelope", "fa-solid fa-envelope", ["mail"], ["communication"]),
    makeClass("phone", "fa-solid fa-phone", ["call"], ["communication"]),
    makeClass("user", "fa-solid fa-user", ["person", "profile"], ["people"]),
    makeClass("users", "fa-solid fa-users", ["group"], ["people"]),
    makeClass("lock", "fa-solid fa-lock", [], ["security"]),
    makeClass("unlock", "fa-solid fa-unlock", [], ["security"]),
    makeClass("eye", "fa-solid fa-eye", ["visible"], ["visibility"]),
    makeClass("eye-slash", "fa-solid fa-eye-slash", ["hidden"], ["visibility"]),
    makeClass("sun", "fa-solid fa-sun", [], ["weather"]),
    makeClass("moon", "fa-solid fa-moon", [], ["weather"]),
    makeClass("cloud", "fa-solid fa-cloud", [], ["weather"]),
    makeClass("cloud-rain", "fa-solid fa-cloud-rain", ["rain"], ["weather"]),
    makeClass("umbrella", "fa-solid fa-umbrella", [], ["weather"]),
    makeClass("snowflake", "fa-solid fa-snowflake", [], ["weather"]),
    makeClass("bolt", "fa-solid fa-bolt", ["lightning"], ["energy"]),
    makeClass("music", "fa-solid fa-music", ["note"], ["media"]),
    makeClass("play", "fa-solid fa-play", [], ["media"]),
    makeClass("pause", "fa-solid fa-pause", [], ["media"]),
    makeClass("stop", "fa-solid fa-stop", [], ["media"]),
    makeClass("backward", "fa-solid fa-backward", [], ["media"]),
    makeClass("forward", "fa-solid fa-forward", [], ["media"]),
    makeClass("image", "fa-solid fa-image", ["photo"], ["media"]),
    makeClass("camera", "fa-solid fa-camera", [], ["media"]),
    makeClass("video", "fa-solid fa-video", [], ["media"]),
    makeClass("folder", "fa-solid fa-folder", [], ["ui"]),
    makeClass("file", "fa-solid fa-file", ["document"], ["ui"]),
    makeClass("file-lines", "fa-solid fa-file-lines", ["file-text"], ["ui"]),
    makeClass("trash", "fa-solid fa-trash", ["delete", "bin"], ["action"]),
    makeClass("pen", "fa-solid fa-pen", ["edit", "pencil"], ["action"]),
    makeClass("scissors", "fa-solid fa-scissors", ["cut"], ["action"]),
    makeClass("copy", "fa-solid fa-copy", [], ["action"]),
    makeClass("paste", "fa-solid fa-paste", [], ["action"]),
    makeClass("download", "fa-solid fa-download", [], ["action"]),
    makeClass("upload", "fa-solid fa-upload", [], ["action"]),
    makeClass("share-nodes", "fa-solid fa-share-nodes", ["share"], ["action"]),
    makeClass("link", "fa-solid fa-link", [], ["action"]),
    makeClass("filter", "fa-solid fa-filter", [], ["ui"]),
    makeClass("sliders", "fa-solid fa-sliders", ["adjust"], ["ui"]),
    makeClass("palette", "fa-solid fa-palette", ["color"], ["ui"]),
    makeClass("brush", "fa-solid fa-brush", [], ["tools"]),
    makeClass("ruler", "fa-solid fa-ruler", ["measure"], ["tools"]),
    makeClass("crop", "fa-solid fa-crop", [], ["tools"]),
    makeClass("crosshairs", "fa-solid fa-crosshairs", ["target"], ["marker"]),
    makeClass("bullseye", "fa-solid fa-bullseye", [], ["marker"]),
    makeClass("tag", "fa-solid fa-tag", ["label"], ["ui"]),
    makeClass("bookmark", "fa-solid fa-bookmark", [], ["ui"]),
    makeClass("clock", "fa-solid fa-clock", ["time"], ["ui"]),
    makeClass("calendar", "fa-solid fa-calendar", ["date"], ["ui"]),
    makeClass("microscope", "fa-solid fa-microscope", [], ["science"]),
    makeClass("flask", "fa-solid fa-flask", [], ["science"]),
    makeClass("dna", "fa-solid fa-dna", [], ["science"]),
    makeClass("leaf", "fa-solid fa-leaf", [], ["nature"]),
    makeClass("fire", "fa-solid fa-fire", [], ["status"]),
    makeClass("droplet", "fa-solid fa-droplet", ["water"], ["nature"]),
    makeClass("seedling", "fa-solid fa-seedling", [], ["nature"]),
    makeClass("hospital", "fa-solid fa-hospital", [], ["medical"]),
    makeClass("stethoscope", "fa-solid fa-stethoscope", [], ["medical"]),
    makeClass("syringe", "fa-solid fa-syringe", [], ["medical"]),
    makeClass("pills", "fa-solid fa-pills", ["pill"], ["medical"]),
    makeClass("bug", "fa-solid fa-bug", [], ["status"]),
    makeClass("shield-halved", "fa-solid fa-shield-halved", ["shield"], ["security"]),
    makeClass("database", "fa-solid fa-database", [], ["data"]),
    makeClass("server", "fa-solid fa-server", [], ["data"]),
    makeClass("chart-line", "fa-solid fa-chart-line", ["analytics"], ["data"]),
    makeClass("chart-pie", "fa-solid fa-chart-pie", [], ["data"]),
    makeClass("layer-group", "fa-solid fa-layer-group", ["layers"], ["ui"]),
    makeClass("grid", "fa-solid fa-table-cells", ["table", "cells"], ["ui"])
];

const faRegularCommon = [
    makeClass("star", "fa-regular fa-star", [], ["rating"]),
    makeClass("heart", "fa-regular fa-heart", [], ["status"]),
    makeClass("circle", "fa-regular fa-circle", [], ["shape"]),
    makeClass("square", "fa-regular fa-square", [], ["shape"]),
    makeClass("bookmark", "fa-regular fa-bookmark", [], ["ui"]),
    makeClass("bell", "fa-regular fa-bell", [], ["ui"]),
    makeClass("calendar", "fa-regular fa-calendar", [], ["ui"]),
    makeClass("clock", "fa-regular fa-clock", [], ["ui"]),
    makeClass("file", "fa-regular fa-file", [], ["ui"]),
    makeClass("file-lines", "fa-regular fa-file-lines", [], ["ui"]),
    makeClass("folder", "fa-regular fa-folder", [], ["ui"]),
    makeClass("image", "fa-regular fa-image", [], ["media"]),
    makeClass("message", "fa-regular fa-message", ["comment"], ["communication"]),
    makeClass("circle-question", "fa-regular fa-circle-question", ["help"], ["status"]),
    makeClass("circle-user", "fa-regular fa-circle-user", ["profile"], ["people"])
];

const faBrandsCommon = [
    makeClass("github", "fa-brands fa-github", [], ["brand"]),
    makeClass("gitlab", "fa-brands fa-gitlab", [], ["brand"]),
    makeClass("docker", "fa-brands fa-docker", [], ["brand"]),
    makeClass("chrome", "fa-brands fa-chrome", [], ["brand"]),
    makeClass("firefox", "fa-brands fa-firefox", [], ["brand"]),
    makeClass("edge", "fa-brands fa-edge", [], ["brand"]),
    makeClass("linux", "fa-brands fa-linux", [], ["brand"]),
    makeClass("windows", "fa-brands fa-windows", [], ["brand"]),
    makeClass("apple", "fa-brands fa-apple", [], ["brand"]),
    makeClass("google", "fa-brands fa-google", [], ["brand"]),
    makeClass("python", "fa-brands fa-python", [], ["brand"]),
    makeClass("js", "fa-brands fa-js", ["javascript"], ["brand"]),
    makeClass("html5", "fa-brands fa-html5", [], ["brand"]),
    makeClass("css3", "fa-brands fa-css3-alt", ["css3-alt"], ["brand"]),
    makeClass("node", "fa-brands fa-node-js", ["node-js"], ["brand"]),
    makeClass("npm", "fa-brands fa-npm", [], ["brand"]),
    makeClass("slack", "fa-brands fa-slack", [], ["brand"]),
    makeClass("discord", "fa-brands fa-discord", [], ["brand"]),
    makeClass("figma", "fa-brands fa-figma", [], ["brand"]),
    makeClass("twitter", "fa-brands fa-x-twitter", ["x-twitter"], ["brand"])
];

$.FlexRenderer.UIControls.IconLibrary
    .registerSet("fa-solid-common", {
        kind: "font-class",
        fontFamily: "'Font Awesome 6 Free','Font Awesome 5 Free'",
        fontWeight: "900",
        items: faSolidCommon
    })
    .registerSet("fa-regular-common", {
        kind: "font-class",
        fontFamily: "'Font Awesome 6 Free','Font Awesome 5 Free'",
        fontWeight: "400",
        items: faRegularCommon
    })
    .registerSet("fa-brands-common", {
        kind: "font-class",
        fontFamily: "'Font Awesome 6 Brands','Font Awesome 5 Brands'",
        fontWeight: "400",
        items: faBrandsCommon
    });

})(OpenSeadragon);
