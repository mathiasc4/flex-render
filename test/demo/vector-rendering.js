const MVT_DEFAULT_STYLE = {
    layers: {
        water: { type: "fill", color: [0.1, 0.8, 0.8, 0.8] },
        landcover: { type: "fill", color: [0.1, 0.8, 0.1, 0.8] },
        landuse: { type: "fill", color: [0.8, 0.8, 0.1, 0.8] },
        park: { type: "fill", color: [0.1, 0.8, 0.1, 0.8] },
        boundary: { type: "line", color: [0.6, 0.2, 0.6, 1.0], widthPx: 2.0, join: "round", cap: "round" },
        waterway: { type: "line", color: [0.1, 0.1, 0.8, 1.0], widthPx: 1.2, join: "round", cap: "round" },
        transportation: { type: "line", color: [0.8, 0.6, 0.1, 1.0], widthPx: 1.6, join: "round", cap: "round" },
        road: { type: "line", color: [0.6, 0.6, 0.6, 1.0], widthPx: 1.6, join: "round", cap: "round" },
        building: { type: "fill", color: [0.1, 0.1, 0.1, 0.8] },
        aeroway: { type: "fill", color: [0.1, 0.8, 0.6, 0.8] },
        poi: { type: "point", color: [0.0, 0.0, 0.0, 1.0], size: 10.0 },
        housenumber: { type: "point", color: [0.5, 0.0, 0.5, 1.0], size: 8.0 },
    },
    fallback: { type: "line", color: [0.5, 0.5, 0.5, 1.0], widthPx: 0.8, join: "bevel", cap: "butt" },
};

const GEOJSON_DEFAULT_STYLE = {
    pointSize: 4,
    pointColor: [1, 0.2, 0.2, 1],
    lineWidth: 2,
    lineColor: [0.2, 1, 0.2, 1],
    fillColor: [0.2, 0.2, 1, 0.6],
};

const GEOJSON_10K_DEFAULT_STYLE = {
    pointSize: 8,
    pointColor: [1, 0.2, 0.2, 1],
    lineWidth: 2,
    lineColor: [0.1, 0.85, 0.2, 1],
    fillColor: [0.1, 0.35, 1, 0.45],
};

const DEFAULT_STYLE_BY_SOURCE = {
    mvt: MVT_DEFAULT_STYLE,
    geojson: GEOJSON_DEFAULT_STYLE,
    geojson_10k: GEOJSON_10K_DEFAULT_STYLE,
};

const styleState = Object.keys(DEFAULT_STYLE_BY_SOURCE).reduce((acc, key) => {
    acc[key] = cloneStyle(DEFAULT_STYLE_BY_SOURCE[key]);
    return acc;
}, {});

const sources = {
    mvt: {
        type: "mvt",
        tiles: ["http://localhost:3000/data/v3/{z}/{x}/{y}.pbf"],
        tileSize: 512,
        minzoom: 0,
        maxzoom: 14,
        scheme: "xyz",
        extent: 4096,
    },
    fabric: "../data/fabric.geometry.json",
    geojson: "../data/geojson-sample.geojson",
    geojson_10k: {
        type: "geojson",
        url: "../data/geojson-performance-10k.geojson",
        width: 4096 * 8,
        height: 4096 * 8,
        maxLevel: 25,
        aggregation: {
            enabled: true,
            threshold: 25,
            badgeSize: 64,
            badgeColor: [1, 0.6, 0.05, 0.9],
            labelColor: [0, 0, 0, 1],
            labelSize: 26,
            labelStrokeWidth: 3,
            maxLabelValue: 999,
        },
    },
};

const labels = {
    mvt: "MVT",
    fabric: "Fabric",
    geojson: "GeoJSON",
    geojson_10k: "GeoJSON 10k",
};

const DEFAULT_ENABLED_SOURCE_KEYS = ["mvt", "geojson"];
const GEOJSON_10K_SOURCE_KEY = "geojson_10k";

const drawerOptions = {
    "flex-renderer": {
        debug: false,
        webGLPreferredVersion: "2.0",
    },
};

const viewportMargins = {
    left: 50,
    top: 0,
    right: 50,
    bottom: 0,
};

$("#title-w").html("OpenSeadragon viewer using FlexRenderer");

const viewer = (window.viewer = OpenSeadragon({
    id: "viewer-container",
    prefixUrl: "../../openseadragon/images/",
    minZoomImageRatio: 0.01,
    maxZoomPixelRatio: 100,
    minPixelRatio: 1.2,
    smoothTileEdgesMinZoom: 1.1,
    crossOriginPolicy: "Anonymous",
    ajaxWithCredentials: false,
    drawer: "flex-renderer",
    drawerOptions,
    blendTime: 0,
    showNavigator: true,
    viewportMargins,
}));

function createImageOptionsElement(key, label) {
    const aggregationControl =
        key === GEOJSON_10K_SOURCE_KEY
            ? `<label>Aggregation: <input type="checkbox" data-image="" data-field="aggregation" checked></label>`
            : "";

    const nativeLinesControl = `<label>Native Lines: <input type="checkbox" data-image="" data-field="useNativeLines" checked></label>`;
    const styleControl = getStyleControlMarkup(key);

    return $(
        `<div class="image-options" data-image-row="">
        <span class="image-options-drag-handle ui-icon ui-icon-arrowthick-2-n-s"></span>

        <label class="image-options-title">
            <input type="checkbox" data-image="" class="toggle">
            __title__
        </label>

        <button class="image-options-collapse-toggle" type="button" aria-expanded="true" title="Collapse source card" data-collapse-toggle="">
            ▾
        </button>

        <div class="image-options-body">
            <div class="option-grid">
                <label>X: <input type="number" value="0" data-image="" data-field="x"> </label>
                <label>Y: <input type="number" value="0" data-image="" data-field="y"> </label>
                <label>Width: <input type="number" value="1" data-image="" data-field="width" min="0"> </label>
                <label>Degrees: <input type="number" value="0" data-image="" data-field="degrees"> </label>
                <label>Opacity: <input type="number" value="1" data-image="" data-field="opacity" min="0" max="1" step="0.2"> </label>
                <label>Flipped: <input type="checkbox" data-image="" data-field="flipped"></label>
                <label>Cropped: <input type="checkbox" data-image="" data-field="cropped"></label>
                <label>Clipped: <input type="checkbox" data-image="" data-field="clipped"></label>
                <label>Smoothing: <input type="checkbox" data-image="" data-field="smoothing" checked></label>
                ${nativeLinesControl}
                ${aggregationControl}
                ${styleControl}
            </div>
        </div>
    </div>`
            .replaceAll('data-image=""', `data-image="${key}"`)
            .replace("__title__", label),
    );
}

Object.keys(sources).forEach((key) => {
    const element = createImageOptionsElement(key, labels[key] || key);

    $("#image-options-container").append(element);

    if (DEFAULT_ENABLED_SOURCE_KEYS.includes(key)) {
        element.find(".toggle").prop("checked", true);
    }
});

initializeStyleControlState();

$("#image-options-container").sortable({
    handle: ".image-options-drag-handle",
    items: "> .image-options",
    update: function (event, ui) {
        const thisItem = ui.item.find(".toggle").data("item");
        const items = $("#image-options-container input.toggle:checked")
            .toArray()
            .map((item) => $(item).data("item"))
            .filter(Boolean);

        const newIndex = items.indexOf(thisItem);

        if (thisItem && newIndex !== -1) {
            viewer.world.setItemIndex(thisItem, newIndex);
        }
    },
});

$("#image-options-container").on("click", ".image-options-collapse-toggle", function () {
    const card = $(this).closest(".image-options");
    const collapsed = !card.hasClass("is-collapsed");

    card.toggleClass("is-collapsed", collapsed);
    $(this)
        .attr("aria-expanded", String(!collapsed))
        .attr("title", collapsed ? "Expand source card" : "Collapse source card")
        .text(collapsed ? "▸" : "▾");
});

$("#image-options-container input.toggle")
    .on("change", function () {
        const data = $(this).data();

        if (this.checked) {
            addTileSource(data.image, this).catch((error) => {
                console.error(`Failed to add tile source '${data.image}'.`, error);
                $(this).prop("checked", false);
            });
        } else {
            const item = $(this).data("item");

            if (item) {
                viewer.world.removeItem(item);
                $(this).data("item", null);
            }
        }
    })
    .trigger("change");

$("#image-options-container input[data-field]").on("change", function () {
    const data = $(this).data();
    const value = this.type === "checkbox" ? $(this).prop("checked") : $(this).val();
    const tiledImage = getTiledImageForSource(data.image);

    updateTiledImage(tiledImage, data, value, this);
});

$("#image-options-container [data-style-field]").on("change input", function () {
    const image = $(this).data("image");

    if ($(this).data("styleField") === "type") {
        updateMVTStyleRowControlState($(this).closest(".mvt-style-row"));
    }

    setStyleStatus(image, "Style edited. Apply to reload this source.", "info");
});

$('#image-options-container button[data-style-action="apply"]').on("click", function () {
    const image = $(this).data("image");

    applyStyleFromControls(image).catch((error) => {
        console.error(`Failed to apply style for '${image}'.`, error);
        setStyleStatus(image, error.message || String(error), "error");
    });
});

$('#image-options-container button[data-style-action="reset"]').on("click", function () {
    const image = $(this).data("image");

    resetStyleForSource(image).catch((error) => {
        console.error(`Failed to reset style for '${image}'.`, error);
        setStyleStatus(image, error.message || String(error), "error");
    });
});

function updateTiledImage(tiledImage, data, value, item) {
    let field = data.field;

    if (field === "aggregation") {
        updateGeoJSON10kAggregation(Boolean(value)).catch((error) => {
            console.error(`Failed to update aggregation for '${data.image}'.`, error);
        });
        return;
    }

    if (field === "useNativeLines") {
        reloadTileSource(data.image).catch((error) => {
            console.error(`Failed to reload tile source '${data.image}'.`, error);
        });
        return;
    }

    if (!tiledImage) {
        return;
    }

    if (field == "x") {
        let bounds = tiledImage.getBoundsNoRotate();
        let position = new OpenSeadragon.Point(Number(value), bounds.y);

        tiledImage.setPosition(position);
    } else if (field == "y") {
        let bounds = tiledImage.getBoundsNoRotate();
        let position = new OpenSeadragon.Point(bounds.x, Number(value));

        tiledImage.setPosition(position);
    } else if (field == "width") {
        tiledImage.setWidth(Number(value));
    } else if (field == "degrees") {
        tiledImage.setRotation(Number(value));
    } else if (field == "opacity") {
        tiledImage.setOpacity(Number(value));
    } else if (field == "flipped") {
        tiledImage.setFlip($(item).prop("checked"));
    } else if (field == "smoothing") {
        const checked = $(item).prop("checked");
        viewer.drawer.setImageSmoothingEnabled(checked);
    } else if (field == "cropped") {
        if ($(item).prop("checked")) {
            let scale = tiledImage.source.width;
            let croppingPolygons = [
                [
                    { x: 0.2 * scale, y: 0.2 * scale },
                    { x: 0.8 * scale, y: 0.2 * scale },
                    { x: 0.5 * scale, y: 0.8 * scale },
                ],
            ];

            tiledImage.setCroppingPolygons(croppingPolygons);
        } else {
            tiledImage.resetCroppingPolygons();
        }
    } else if (field == "clipped") {
        if ($(item).prop("checked")) {
            let scale = tiledImage.source.width;
            let clipRect = new OpenSeadragon.Rect(0.1 * scale, 0.2 * scale, 0.6 * scale, 0.4 * scale);

            tiledImage.setClip(clipRect);
        } else {
            tiledImage.setClip(null);
        }
    }
}

function getTiledImageForSource(image) {
    return $(`#image-options-container input.toggle[data-image="${image}"]`).data("item");
}

function getOptionsForSource(image) {
    const options = $(`#image-options-container input[data-image="${image}"][type=number][data-field]`)
        .toArray()
        .reduce((acc, input) => {
            const field = $(input).data("field");

            if (field && isTiledImageNumberOption(field)) {
                acc[field] = Number(input.value);
            }

            return acc;
        }, {});

    options.flipped = $(`#image-options-container input[data-image="${image}"][data-field=flipped]`).prop("checked");

    return options;
}

function isTiledImageNumberOption(field) {
    return field === "x" || field === "y" || field === "width" || field === "degrees" || field === "opacity";
}

function getInsertionIndex(checkbox) {
    const items = $("#image-options-container input.toggle:checked").toArray();

    return items.indexOf(checkbox);
}

async function getTileSourceForImage(image) {
    const source = sources[image];

    if (!source) {
        return source;
    }

    const useNativeLines = getUseNativeLinesEnabled(image);
    const style = getStyleForSource(image);

    if (image === "fabric") {
        return source;
    }

    if (image === GEOJSON_10K_SOURCE_KEY) {
        const aggregationEnabled = getGeoJSON10kAggregationEnabled();

        return {
            ...source,
            useNativeLines,
            style,
            aggregation: {
                ...source.aggregation,
                enabled: aggregationEnabled,
            },
        };
    }

    if (typeof source === "string") {
        const response = await fetch(source);

        if (!response.ok) {
            throw new Error(`Failed to fetch ${source}: ${response.status}`);
        }

        const data = await response.json();

        if (image === "mvt") {
            const options = OpenSeadragon.MVTTileSource.prototype.configure(
                {
                    ...data,
                    style,
                    useNativeLines,
                },
                source,
            );

            return new OpenSeadragon.MVTTileSource({
                ...options,
                style,
                useNativeLines,
            });
        }

        if (image === "geojson") {
            const options = OpenSeadragon.GeoJSONTileSource.prototype.configure(
                {
                    ...data,
                    style,
                    useNativeLines,
                },
                source,
            );

            return new OpenSeadragon.GeoJSONTileSource({
                ...options,
                style,
                useNativeLines,
            });
        }

        return source;
    }

    return {
        ...source,
        useNativeLines,
        ...(style ? { style } : {}),
    };
}

function getGeoJSON10kAggregationEnabled() {
    const input = $(`#image-options-container input[data-image="${GEOJSON_10K_SOURCE_KEY}"][data-field=aggregation]`);

    return input.length ? input.prop("checked") : true;
}

async function updateGeoJSON10kAggregation(enabled) {
    const checkbox = $(`#image-options-container input.toggle[data-image="${GEOJSON_10K_SOURCE_KEY}"]`);
    const tiledImage = checkbox.data("item");

    if (!tiledImage) {
        return;
    }

    const oldIndex = viewer.world.getIndexOfItem(tiledImage);
    const bounds = tiledImage.getBoundsNoRotate();
    const opacity = tiledImage.opacity;
    const degrees = tiledImage.getRotation ? tiledImage.getRotation() : 0;
    const flipped = tiledImage.getFlip ? tiledImage.getFlip() : false;

    viewer.world.removeItem(tiledImage);
    checkbox.data("item", null);

    const tileSource = await getTileSourceForImage(GEOJSON_10K_SOURCE_KEY);

    if (!tileSource || !checkbox.prop("checked")) {
        return;
    }

    viewer.addTiledImage({
        tileSource,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        degrees,
        opacity,
        flipped,
        index: oldIndex,
        success: function (event) {
            const item = event.item;

            checkbox.data("item", item);
        },
    });
}

function getUseNativeLinesEnabled(image) {
    const input = $(`#image-options-container input[data-image="${image}"][data-field=useNativeLines]`);

    return input.length ? input.prop("checked") : true;
}

function getStyleForSource(image) {
    return styleState[image] ? cloneStyle(styleState[image]) : undefined;
}

function getStyleControlMarkup(image) {
    if (image === "mvt") {
        return getMVTStyleControlMarkup(image);
    }

    if (image === "geojson" || image === GEOJSON_10K_SOURCE_KEY) {
        return getGeoJSONStyleControlMarkup(image);
    }

    return "";
}

function getMVTStyleControlMarkup(image) {
    const style = getStyleForSource(image) || MVT_DEFAULT_STYLE;
    const layerRows = Object.keys(style.layers || {})
        .map((layerName) => renderMVTStyleRow(layerName, style.layers[layerName], false))
        .join("");

    return `
        <div class="style-fields" data-style-kind="mvt">
            <h5>MVT style</h5>
            <p class="style-help">Layer fields match the MVT source style object.</p>
            ${layerRows}
            ${renderMVTStyleRow("fallback", style.fallback || MVT_DEFAULT_STYLE.fallback, true)}
            <div class="style-actions">
                <button type="button" data-image="" data-style-action="apply">Apply style</button>
                <button type="button" data-image="" data-style-action="reset">Reset style</button>
            </div>
            <div class="style-status" data-style-status="${escapeHtml(image)}">Style fields match the MVT definition.</div>
        </div>
    `;
}

function renderMVTStyleRow(name, layerStyle, isFallback) {
    const style = layerStyle || {};
    const type = style.type || "line";
    const color = style.color || [0.5, 0.5, 0.5, 1];
    const rowAttr = isFallback ? `data-style-fallback="true"` : `data-style-layer="${escapeHtml(name)}"`;

    return `
        <div class="mvt-style-row" ${rowAttr}>
            <div class="mvt-style-row__title">${escapeHtml(isFallback ? "fallback" : name)}</div>
            <label>Type
                <select data-image="" data-style-field="type">
                    ${renderSelectOption("fill", "fill", type)}
                    ${renderSelectOption("line", "line", type)}
                    ${renderSelectOption("point", "point", type)}
                </select>
            </label>
            <label>Color
                <input type="color" value="${rgbaToHex(color)}" data-image="" data-style-field="color">
            </label>
            <label>Alpha
                <input type="number" value="${formatNumber(color[3] ?? 1)}" min="0" max="1" step="0.05" data-image="" data-style-field="colorAlpha">
            </label>
            <label>Width
                <input type="number" value="${style.widthPx ?? ""}" min="0" step="0.1" data-image="" data-style-field="widthPx">
            </label>
            <label>Size
                <input type="number" value="${style.size ?? ""}" min="0" step="0.5" data-image="" data-style-field="size">
            </label>
            <label>Join
                <select data-image="" data-style-field="join">
                    ${renderSelectOption("miter", "miter", style.join || "bevel")}
                    ${renderSelectOption("bevel", "bevel", style.join || "bevel")}
                    ${renderSelectOption("round", "round", style.join || "bevel")}
                </select>
            </label>
            <label>Cap
                <select data-image="" data-style-field="cap">
                    ${renderSelectOption("butt", "butt", style.cap || "butt")}
                    ${renderSelectOption("square", "square", style.cap || "butt")}
                    ${renderSelectOption("round", "round", style.cap || "butt")}
                </select>
            </label>
        </div>
    `;
}

function getGeoJSONStyleControlMarkup(image) {
    const style = getStyleForSource(image) || GEOJSON_DEFAULT_STYLE;

    return `
        <div class="style-fields" data-style-kind="geojson">
            <h5>GeoJSON style</h5>
            <p class="style-help">Fields match GeoJSONTileSource style options.</p>
            <div class="style-control-grid">
                <label>Point size
                    <input type="number" value="${formatNumber(style.pointSize ?? 4)}" min="0" step="0.5" data-image="" data-style-field="pointSize">
                </label>
                <label>Point color
                    <input type="color" value="${rgbaToHex(style.pointColor)}" data-image="" data-style-field="pointColor">
                </label>
                <label>Point alpha
                    <input type="number" value="${formatNumber(getAlpha(style.pointColor, 1))}" min="0" max="1" step="0.05" data-image="" data-style-field="pointAlpha">
                </label>
                <label>Line width
                    <input type="number" value="${formatNumber(style.lineWidth ?? 2)}" min="0" step="0.5" data-image="" data-style-field="lineWidth">
                </label>
                <label>Line color
                    <input type="color" value="${rgbaToHex(style.lineColor)}" data-image="" data-style-field="lineColor">
                </label>
                <label>Line alpha
                    <input type="number" value="${formatNumber(getAlpha(style.lineColor, 1))}" min="0" max="1" step="0.05" data-image="" data-style-field="lineAlpha">
                </label>
                <label>Fill color
                    <input type="color" value="${rgbaToHex(style.fillColor)}" data-image="" data-style-field="fillColor">
                </label>
                <label>Fill alpha
                    <input type="number" value="${formatNumber(getAlpha(style.fillColor, 0.6))}" min="0" max="1" step="0.05" data-image="" data-style-field="fillAlpha">
                </label>
            </div>
            <div class="style-actions">
                <button type="button" data-image="" data-style-action="apply">Apply style</button>
                <button type="button" data-image="" data-style-action="reset">Reset style</button>
            </div>
            <div class="style-status" data-style-status="${escapeHtml(image)}">Style fields match the GeoJSON definition.</div>
        </div>
    `;
}

function initializeStyleControlState() {
    $(".mvt-style-row").each(function () {
        updateMVTStyleRowControlState($(this));
    });
}

function updateMVTStyleRowControlState(row) {
    const type = row.find('[data-style-field="type"]').val();
    const isLine = type === "line";
    const isPoint = type === "point";

    row.find('[data-style-field="widthPx"], [data-style-field="join"], [data-style-field="cap"]').prop(
        "disabled",
        !isLine,
    );
    row.find('[data-style-field="size"]').prop("disabled", !isPoint);
}

async function applyStyleFromControls(image) {
    const nextStyle = readStyleFromControls(image);

    styleState[image] = cloneStyle(nextStyle);

    if (getTiledImageForSource(image)) {
        setStyleStatus(image, "Applying style...", "info");
        await reloadTileSource(image);
        setStyleStatus(image, "Style applied.", "ok");
    } else {
        setStyleStatus(image, "Style saved. Enable this source to preview it.", "ok");
    }
}

async function resetStyleForSource(image) {
    const defaultStyle = DEFAULT_STYLE_BY_SOURCE[image];

    if (!defaultStyle) {
        return;
    }

    styleState[image] = cloneStyle(defaultStyle);
    writeStyleToControls(image, styleState[image]);

    if (getTiledImageForSource(image)) {
        setStyleStatus(image, "Resetting style...", "info");
        await reloadTileSource(image);
        setStyleStatus(image, "Style reset.", "ok");
    } else {
        setStyleStatus(image, "Style reset. Enable this source to preview it.", "ok");
    }
}

function readStyleFromControls(image) {
    if (image === "mvt") {
        return readMVTStyleFromControls(image);
    }

    if (image === "geojson" || image === GEOJSON_10K_SOURCE_KEY) {
        return readGeoJSONStyleFromControls(image);
    }

    return undefined;
}

function readMVTStyleFromControls(image) {
    const root = $(`#image-options-container .image-options:has([data-image="${image}"])`);
    const layers = {};

    root.find(".mvt-style-row[data-style-layer]").each(function () {
        const row = $(this);
        const layerName = row.attr("data-style-layer");

        layers[layerName] = readMVTStyleRow(row);
    });

    return {
        layers,
        fallback: readMVTStyleRow(root.find('.mvt-style-row[data-style-fallback="true"]').first()),
    };
}

function readMVTStyleRow(row) {
    const type = row.find('[data-style-field="type"]').val() || "line";
    const color = hexAndAlphaToRgba(
        row.find('[data-style-field="color"]').val(),
        readNumber(row.find('[data-style-field="colorAlpha"]').val(), 1),
    );

    const style = {
        type,
        color,
    };

    if (type === "line") {
        style.widthPx = readNumber(row.find('[data-style-field="widthPx"]').val(), 1);
        style.join = row.find('[data-style-field="join"]').val() || "bevel";
        style.cap = row.find('[data-style-field="cap"]').val() || "butt";
    }

    if (type === "point") {
        style.size = readNumber(row.find('[data-style-field="size"]').val(), 8);
    }

    return style;
}

function readGeoJSONStyleFromControls(image) {
    const root = $(`#image-options-container .image-options:has([data-image="${image}"])`);

    return {
        pointSize: readNumber(root.find('[data-style-field="pointSize"]').val(), 4),
        pointColor: hexAndAlphaToRgba(
            root.find('[data-style-field="pointColor"]').val(),
            readNumber(root.find('[data-style-field="pointAlpha"]').val(), 1),
        ),
        lineWidth: readNumber(root.find('[data-style-field="lineWidth"]').val(), 2),
        lineColor: hexAndAlphaToRgba(
            root.find('[data-style-field="lineColor"]').val(),
            readNumber(root.find('[data-style-field="lineAlpha"]').val(), 1),
        ),
        fillColor: hexAndAlphaToRgba(
            root.find('[data-style-field="fillColor"]').val(),
            readNumber(root.find('[data-style-field="fillAlpha"]').val(), 0.6),
        ),
    };
}

function writeStyleToControls(image, style) {
    if (image === "mvt") {
        writeMVTStyleToControls(image, style);
        return;
    }

    if (image === "geojson" || image === GEOJSON_10K_SOURCE_KEY) {
        writeGeoJSONStyleToControls(image, style);
    }
}

function writeMVTStyleToControls(image, style) {
    const root = $(`#image-options-container .image-options:has([data-image="${image}"])`);

    Object.keys(style.layers || {}).forEach((layerName) => {
        writeMVTStyleRow(root.find(`.mvt-style-row[data-style-layer="${layerName}"]`), style.layers[layerName]);
    });

    writeMVTStyleRow(root.find('.mvt-style-row[data-style-fallback="true"]'), style.fallback || {});
}

function writeMVTStyleRow(row, style) {
    if (!row.length) {
        return;
    }

    const color = style.color || [0.5, 0.5, 0.5, 1];

    row.find('[data-style-field="type"]').val(style.type || "line");
    row.find('[data-style-field="color"]').val(rgbaToHex(color));
    row.find('[data-style-field="colorAlpha"]').val(formatNumber(getAlpha(color, 1)));
    row.find('[data-style-field="widthPx"]').val(style.widthPx ?? "");
    row.find('[data-style-field="size"]').val(style.size ?? "");
    row.find('[data-style-field="join"]').val(style.join || "bevel");
    row.find('[data-style-field="cap"]').val(style.cap || "butt");

    updateMVTStyleRowControlState(row);
}

function writeGeoJSONStyleToControls(image, style) {
    const root = $(`#image-options-container .image-options:has([data-image="${image}"])`);

    root.find('[data-style-field="pointSize"]').val(formatNumber(style.pointSize ?? 4));
    root.find('[data-style-field="pointColor"]').val(rgbaToHex(style.pointColor));
    root.find('[data-style-field="pointAlpha"]').val(formatNumber(getAlpha(style.pointColor, 1)));
    root.find('[data-style-field="lineWidth"]').val(formatNumber(style.lineWidth ?? 2));
    root.find('[data-style-field="lineColor"]').val(rgbaToHex(style.lineColor));
    root.find('[data-style-field="lineAlpha"]').val(formatNumber(getAlpha(style.lineColor, 1)));
    root.find('[data-style-field="fillColor"]').val(rgbaToHex(style.fillColor));
    root.find('[data-style-field="fillAlpha"]').val(formatNumber(getAlpha(style.fillColor, 0.6)));
}

function setStyleStatus(image, message, status) {
    const element = $(`#image-options-container [data-style-status="${image}"]`);

    if (!element.length) {
        return;
    }

    element
        .removeClass("style-status--ok style-status--error style-status--info")
        .addClass(status ? `style-status--${status}` : "")
        .text(message || "");
}

async function addTileSource(image, checkbox) {
    const tileSource = await getTileSourceForImage(image);

    if (!tileSource || !$(checkbox).prop("checked")) {
        return;
    }

    const options = getOptionsForSource(image);
    const index = getInsertionIndex(checkbox);

    viewer &&
        viewer.addTiledImage({
            tileSource: tileSource,
            ...options,
            index: index,
            success: function (event) {
                const item = event.item;

                $(checkbox).data("item", item);
            },
        });
}

async function reloadTileSource(image) {
    const checkbox = $(`#image-options-container input.toggle[data-image="${image}"]`);
    const tiledImage = checkbox.data("item");

    if (!tiledImage) {
        return;
    }

    const tileSource = await getTileSourceForImage(image);

    if (!tileSource || !checkbox.prop("checked") || checkbox.data("item") !== tiledImage) {
        return;
    }

    const oldIndex = viewer.world.getIndexOfItem(tiledImage);
    const bounds = tiledImage.getBoundsNoRotate();
    const opacity = tiledImage.opacity;
    const degrees = tiledImage.getRotation ? tiledImage.getRotation() : 0;
    const flipped = tiledImage.getFlip ? tiledImage.getFlip() : false;

    viewer.world.removeItem(tiledImage);
    checkbox.data("item", null);

    viewer.addTiledImage({
        tileSource,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        degrees,
        opacity,
        flipped,
        index: oldIndex,
        success: function (event) {
            const item = event.item;

            checkbox.data("item", item);
        },
    });
}

function renderSelectOption(value, label, selectedValue) {
    const selected = value === selectedValue ? " selected" : "";

    return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
}

function cloneStyle(style) {
    return JSON.parse(JSON.stringify(style || {}));
}

function rgbaToHex(color) {
    const source = Array.isArray(color) ? color : [0, 0, 0, 1];
    const r = channelToHex(source[0]);
    const g = channelToHex(source[1]);
    const b = channelToHex(source[2]);

    return `#${r}${g}${b}`;
}

function channelToHex(value) {
    const normalized = Math.max(0, Math.min(255, Math.round((Number(value) || 0) * 255)));

    return normalized.toString(16).padStart(2, "0");
}

function hexAndAlphaToRgba(hex, alpha) {
    const clean = String(hex || "#000000").replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);

    return [
        Number.isFinite(r) ? r / 255 : 0,
        Number.isFinite(g) ? g / 255 : 0,
        Number.isFinite(b) ? b / 255 : 0,
        clamp(readNumber(alpha, 1), 0, 1),
    ];
}

function getAlpha(color, fallback) {
    return Array.isArray(color) && Number.isFinite(Number(color[3])) ? Number(color[3]) : fallback;
}

function readNumber(value, fallback) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "";
    }

    return Number(number.toFixed(4)).toString();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
