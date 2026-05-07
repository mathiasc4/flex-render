const sources = {
    mvt: {
        type: "mvt",
        tiles: [ "http://localhost:3000/data/v3/{z}/{x}/{y}.pbf" ],
        tileSize: 512,
        minzoom: 0,
        maxzoom: 14,
        scheme: "xyz",
        extent: 4096
    },
    fabric: "../data/fabric.geometry.json",
    geojson: {
        type: "geojson",
        url: "../data/geojson-sample.geojson",
        projection: OpenSeadragon.GeoJSONTileSourceProjection.IMAGE,
        width: 4096,
        height: 4096,
        bounds: [0, 0, 4096, 4096]
    },
    geojson_10k: {
        type: "geojson",
        url: "../data/geojson-performance-10k.geojson",
        projection: OpenSeadragon.GeoJSONTileSourceProjection.IMAGE,
        width: 4096 * 8,
        height: 4096 * 8,
        bounds: [0, 0, 4096, 4096],
        maxLevel: 25,
        aggregation: {
            enabled: true,
            threshold: 25,
            badgeSize: 64,
            badgeColor: [1, 0.6, 0.05, 0.9],
            labelColor: [0, 0, 0, 1],
            labelSize: 26,
            labelStrokeWidth: 3,
            maxLabelValue: 999
        }
    }
};

const labels = {
    mvt: "MVT",
    fabric: "Fabric",
    geojson: "GeoJSON",
    geojson_10k: "GeoJSON 10k",
};

const GEOJSON_10K_SOURCE_KEY = "geojson_10k";

const drawerOptions = {
    "flex-renderer": {
        debug: true,
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

let viewer = window.viewer = OpenSeadragon({
    id: "viewer-container",
    prefixUrl: "../../openseadragon/images/",
    minZoomImageRatio: 0.01,
    maxZoomPixelRatio: 100,
    smoothTileEdgesMinZoom: 1.1,
    crossOriginPolicy: 'Anonymous',
    ajaxWithCredentials: false,
    // maxImageCacheCount: 30,
    drawer: "flex-renderer",
    drawerOptions: drawerOptions,
    blendTime: 0,
    showNavigator: true,
    viewportMargins,
});


function createImageOptionsElement(key, label){
    const aggregationControl = key === GEOJSON_10K_SOURCE_KEY
        ? `<label>Aggregation: <input type="checkbox" data-image="" data-field="aggregation" checked></label>`
        : "";

    const nativeLinesControl = key !== "fabric"
        ? `<label>Native Lines: <input type="checkbox" data-image="" data-field="useNativeLines"></label>`
        : "";

    return $(`<div class="image-options" data-image-row="">
        <span class="image-options-drag-handle ui-icon ui-icon-arrowthick-2-n-s"></span>

        <label class="image-options-title">
            <input type="checkbox" data-image="" class="toggle">
            __title__
        </label>

        <div class="option-grid">
            <label>X: <input type="number" value="0" data-image="" data-field="x"> </label>
            <label>Y: <input type="number" value="0" data-image="" data-field="y"> </label>
            <label>Width: <input type="number" value="1" data-image="" data-field="width" min="0"> </label>
            <label>Degrees: <input type="number" value="0" data-image="" data-field="degrees"> </label>
            <label>Opacity: <input type="number" value="1" data-image="" data-field="opacity" min="0" max="1" step="0.2"> </label>
            <label>Flipped: <input type="checkbox" data-image="" data-field="flipped"></label>
            <label>Cropped: <input type="checkbox" data-image="" data-field="cropped"></label>
            <label>Clipped: <input type="checkbox" data-image="" data-field="clipped"></label>
            <label>Chess Tile Opacity: <input type="checkbox" data-image="" data-field="tile-level-opecity"></label>
            <label>Debug: <input type="checkbox" data-image="" data-field="debug"></label>
            <label>Composite: <select data-image="" data-field="composite"></select></label>
            <label>Wrap: <select data-image="" data-field="wrapping"></select></label>
            <label>Smoothing: <input type="checkbox" data-image="" data-field="smoothing" checked></label>
            ${nativeLinesControl}
            ${aggregationControl}
        </div>
    </div>`.replaceAll('data-image=""', `data-image="${key}"`).replace('__title__', label));
}

Object.keys(sources).forEach((key, index) => {
    const element = createImageOptionsElement(key, labels[key] || key);

    $('#image-options-container').append(element);

    if (index === 0) {
        element.find('.toggle').prop('checked', true);
    }
});

$('#image-options-container').sortable({
    handle: '.image-options-drag-handle',
    items: '> .image-options',
    update: function(event, ui) {
        const thisItem = ui.item.find('.toggle').data('item');
        const items = $('#image-options-container input.toggle:checked')
            .toArray()
            .map((item) => $(item).data('item'))
            .filter(Boolean);

        const newIndex = items.indexOf(thisItem);

        if (thisItem && newIndex !== -1) {
            viewer.world.setItemIndex(thisItem, newIndex);
        }
    },
});

$('#image-options-container input.toggle').on('change', function() {
    const data = $(this).data();

    if (this.checked) {
        addTileSource(data.image, this).catch(error => {
            console.error(`Failed to add tile source '${data.image}'.`, error);
            $(this).prop("checked", false);
        });
    } else {
        const item = $(this).data('item');

        if (item) {
            viewer.world.removeItem(item);
            $(this).data('item', null);
        }
    }
}).trigger('change');

$('#image-options-container input:not(.toggle)').on('change', function() {
    const data = $(this).data();
    const value = this.type === "checkbox" ? $(this).prop("checked") : $(this).val();
    const tiledImage = getTiledImageForSource(data.image);

    updateTiledImage(tiledImage, data, value, this);
});

function updateTiledImage(tiledImage, data, value, item) {
    let field = data.field;

    if (field === "aggregation") {
        updateGeoJSON10kAggregation(Boolean(value)).catch(error => {
            console.error(`Failed to update aggregation for '${data.image}'.`, error);
        });
        return;
    }

    if (field === "useNativeLines") {
        reloadTileSource(data.image).catch(error => {
            console.error(`Failed to reload tile source '${data.image}'.`, error);
        });
        return;
    }

    if (!tiledImage) {
        return;
    }

    if (field == 'x') {
        let bounds = tiledImage.getBoundsNoRotate();
        let position = new OpenSeadragon.Point(Number(value), bounds.y);

        tiledImage.setPosition(position);
    } else if (field == 'y') {
        let bounds = tiledImage.getBoundsNoRotate();
        let position = new OpenSeadragon.Point(bounds.x, Number(value));

        tiledImage.setPosition(position);
    } else if (field == 'width') {
        tiledImage.setWidth(Number(value));
    } else if (field == 'degrees') {
        tiledImage.setRotation(Number(value));
    } else if (field == 'opacity') {
        tiledImage.setOpacity(Number(value));
    } else if (field == 'flipped') {
        tiledImage.setFlip($(item).prop('checked'));
    } else if (field == 'smoothing') {
        const checked = $(item).prop('checked');
        viewer.drawer.setImageSmoothingEnabled(checked);
    } else if (field == 'cropped'){
        if ($(item).prop('checked')) {
            let scale = tiledImage.source.width;
            let croppingPolygons = [ [{x:0.2*scale, y:0.2*scale}, {x:0.8*scale, y:0.2*scale}, {x:0.5*scale, y:0.8*scale}] ];

            tiledImage.setCroppingPolygons(croppingPolygons);
        } else {
            tiledImage.resetCroppingPolygons();
        }
    } else if (field == 'clipped') {
        if ($(item).prop('checked')) {
            let scale = tiledImage.source.width;
            let clipRect = new OpenSeadragon.Rect(0.1*scale, 0.2*scale, 0.6*scale, 0.4*scale);

            tiledImage.setClip(clipRect);
        } else {
            tiledImage.setClip(null);
        }
    } else if (field == 'debug'){
        if( $(item).prop('checked') ){
            tiledImage.debugMode = true;
        } else {
            tiledImage.debugMode = false;
        }
    }
}

$('.image-options select[data-field=composite]').append(getCompositeOperationOptions()).on('change', function() {
    const data = $(this).data();
    const tiledImage = getTiledImageForSource(data.image);

    if (tiledImage) {
        tiledImage.setCompositeOperation(this.value === 'null' ? null : this.value);
    }
}).trigger('change');

$('.image-options select[data-field=wrapping]').append(getWrappingOptions()).on('change', function() {
    const data = $(this).data();
    const tiledImage = getTiledImageForSource(data.image);

    if (tiledImage) {
        switch (this.value) {
            case "None": tiledImage.wrapHorizontal = tiledImage.wrapVertical = false; break;
            case "Horizontal": tiledImage.wrapHorizontal = true; tiledImage.wrapVertical = false; break;
            case "Vertical": tiledImage.wrapHorizontal = false; tiledImage.wrapVertical = true; break;
            case "Both": tiledImage.wrapHorizontal = tiledImage.wrapVertical = true; break;
        }

        tiledImage.redraw();
    }
}).trigger('change');

function getTiledImageForSource(image) {
    return $(`#image-options-container input.toggle[data-image="${image}"]`).data('item');
}

function getOptionsForSource(image) {
    const options = $(`#image-options-container input[data-image="${image}"][type=number]`)
        .toArray()
        .reduce((acc, input) => {
            const field = $(input).data('field');

            if (field && isTiledImageNumberOption(field)) {
                acc[field] = Number(input.value);
            }

            return acc;
        }, {});

    options.flipped = $(`#image-options-container input[data-image="${image}"][data-field=flipped]`).prop('checked');

    return options;
}

function isTiledImageNumberOption(field) {
    return field === "x" ||
        field === "y" ||
        field === "width" ||
        field === "degrees" ||
        field === "opacity";
}

function getInsertionIndex(checkbox) {
    const items = $('#image-options-container input.toggle:checked').toArray();

    return items.indexOf(checkbox);
}

async function getTileSourceForImage(image) {
    const source = sources[image];

    if (!source) {
        return source;
    }

    const useNativeLines = getUseNativeLinesEnabled(image);

    if (image === "fabric") {
        return source;
    }

    if (image === GEOJSON_10K_SOURCE_KEY) {
        const aggregationEnabled = getGeoJSON10kAggregationEnabled();

        return {
            ...source,
            useNativeLines,
            aggregation: {
                ...source.aggregation,
                enabled: aggregationEnabled
            }
        };
    }

    if (typeof source === "string") {
        const response = await fetch(source);

        if (!response.ok) {
            throw new Error(`Failed to fetch ${source}: ${response.status}`);
        }

        const data = await response.json();

        if (image === "mvt") {
            const options = OpenSeadragon.MVTTileSource.prototype.configure({
                ...data,
                useNativeLines
            }, source);

            return new OpenSeadragon.MVTTileSource({
                ...options,
                useNativeLines
            });
        }

        if (image === "geojson") {
            const options = OpenSeadragon.GeoJSONTileSource.prototype.configure({
                ...data,
                useNativeLines
            }, source);

            return new OpenSeadragon.GeoJSONTileSource({
                ...options,
                useNativeLines
            });
        }

        return source;
    }

    return {
        ...source,
        useNativeLines
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
    const composite = tiledImage.compositeOperation;
    const wrapHorizontal = tiledImage.wrapHorizontal;
    const wrapVertical = tiledImage.wrapVertical;
    const debugMode = tiledImage.debugMode === true;

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
        success: function(event) {
            const item = event.item;

            item.debugMode = debugMode;
            item.wrapHorizontal = wrapHorizontal;
            item.wrapVertical = wrapVertical;

            if (composite !== undefined) {
                item.setCompositeOperation(composite === "null" ? null : composite);
            }

            checkbox.data("item", item);
            applySelectOptionsToTiledImage(GEOJSON_10K_SOURCE_KEY, item);
        }
    });
}

function getUseNativeLinesEnabled(image) {
    const input = $(`#image-options-container input[data-image="${image}"][data-field=useNativeLines]`);

    return input.length ? input.prop("checked") : false;
}

async function addTileSource(image, checkbox) {
    const tileSource = await getTileSourceForImage(image);

    if (!tileSource || !$(checkbox).prop("checked")) {
        return;
    }

    const options = getOptionsForSource(image);
    const index = getInsertionIndex(checkbox);

    viewer && viewer.addTiledImage({
        tileSource: tileSource,
        ...options,
        index: index,
        success: function(event) {
            const item = event.item;

            $(checkbox).data('item', item);

            applySelectOptionsToTiledImage(image, item);
        },
    });
}

function applySelectOptionsToTiledImage(image, tiledImage) {
    const composite = $(`#image-options-container select[data-image="${image}"][data-field=composite]`).val();
    const wrapping = $(`#image-options-container select[data-image="${image}"][data-field=wrapping]`).val();

    if (composite !== undefined) {
        tiledImage.setCompositeOperation(composite === 'null' ? null : composite);
    }

    if (wrapping !== undefined) {
        switch (wrapping) {
            case "None": tiledImage.wrapHorizontal = tiledImage.wrapVertical = false; break;
            case "Horizontal": tiledImage.wrapHorizontal = true; tiledImage.wrapVertical = false; break;
            case "Vertical": tiledImage.wrapHorizontal = false; tiledImage.wrapVertical = true; break;
            case "Both": tiledImage.wrapHorizontal = tiledImage.wrapVertical = true; break;
        }

        tiledImage.redraw();
    }
}

function getWrappingOptions(){
    let opts = ['None', 'Horizontal', 'Vertical', 'Both'];
    let elements = opts.map((opt, i)=>{
        let el = $('<option>',{value:opt}).text(opt);
        if(i===0){
            el.attr('selected',true);
        }
        return el[0];
        // $('.image-options select').append(el);
    });
    return $(elements);
}

function getCompositeOperationOptions(){
    let opts = [
        null,
        'source-over',
        'source-in',
        'source-out',
        'source-atop',
        'destination-over',
        'destination-in',
        'destination-out',
        'destination-atop',
        'lighten',
        'darken',
        'copy',
        'xor',
        'multiply',
        'screen',
        'overlay',
        'color-dodge',
        'color-burn',
        'hard-light',
        'soft-light',
        'difference',
        'exclusion',
        'hue',
        'saturation',
        'color',
        'luminosity'
    ];

    let elements = opts.map((opt, i)=>{
        let el = $('<option>', { value: opt }).text(opt);

        if (i === 0) {
            el.attr('selected', true);
        }

        return el[0];
    });

    return $(elements);
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
    const composite = tiledImage.compositeOperation;
    const wrapHorizontal = tiledImage.wrapHorizontal;
    const wrapVertical = tiledImage.wrapVertical;
    const debugMode = tiledImage.debugMode === true;

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
        success: function(event) {
            const item = event.item;

            item.debugMode = debugMode;
            item.wrapHorizontal = wrapHorizontal;
            item.wrapVertical = wrapVertical;

            if (composite !== undefined) {
                item.setCompositeOperation(composite === "null" ? null : composite);
            }

            checkbox.data("item", item);
            applySelectOptionsToTiledImage(image, item);
        }
    });
}
