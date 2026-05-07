const sources = {
    mvt: "http://localhost:3000/osm-2020-02-10-v3.11_asia_japan",
    fabric: "../data/fabric.geometry.json",
    geojson: {
        type: "geojson",
        url: "../data/geojson-sample.geojson",
        projection: OpenSeadragon.GeoJSONTileSourceProjection.IMAGE,
        width: 4096,
        height: 4096,
    },
    geojson_10k: {
        type: "geojson",
        url: "../data/geojson-performance-10k.geojson",
        projection: OpenSeadragon.GeoJSONTileSourceProjection.IMAGE,
        width: 4096,
        height: 4096,
    }
};

const labels = {
    mvt: "MVT",
    fabric: "Fabric",
    geojson: "GeoJSON",
    geojson_10k: "GeoJSON 10k",
};

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
        addTileSource(data.image, this);
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
    const value = $(this).val();
    const tiledImage = getTiledImageForSource(data.image);

    updateTiledImage(tiledImage, data, value, this);
});

function updateTiledImage(tiledImage, data, value, item) {
    if (!tiledImage) {
        return;
    }

    let field = data.field;

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

            if (field) {
                acc[field] = Number(input.value);
            }

            return acc;
        }, {});

    options.flipped = $(`#image-options-container input[data-image="${image}"][data-field=flipped]`).prop('checked');

    return options;
}

function getInsertionIndex(checkbox) {
    const items = $('#image-options-container input.toggle:checked').toArray();

    return items.indexOf(checkbox);
}

function addTileSource(image, checkbox) {
    const tileSource = sources[image];

    if (!tileSource) {
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
