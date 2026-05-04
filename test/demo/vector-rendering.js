const source = "http://localhost:8888/data/v3.json";

const renderer = "OpenSeadragon";

const drawerOptions = {
    "flex-renderer": {
        debug: true,
        webGLPreferredVersion: "2.0",
        htmlHandler: (shaderLayer, shaderConfig) => {
            const container = document.getElementById('shader-ui-container');
            // Be careful, shaderLayer.id is changing. It should not be used as a key to identify the layer between
            // different programs such as in this case, but it's okay to use it when referencing concrete running layer.

            // Create custom layer controls - you can add more HTML controls allowing users to
            // control gamma, blending, or even change the shader type. Here we just show shader layer name + checkbox representing
            // its visibility (but we do not manage change event and thus users cannot change it). In case of error, we show
            // the error message below the checkbox.
            // The compulsory step is to include `shaderLayer.htmlControls()` output.
            container.insertAdjacentHTML('beforeend', `<div>
    <input type="checkbox" disabled id="enable-layer-${shaderLayer.id}" ${shaderConfig.visible ? 'checked' : ''}><span>${shaderConfig.name || shaderConfig.type}</span>
    <div>${shaderLayer.error || ""}</div>
    ${shaderLayer.htmlControls()}
</div>`);
        },
        htmlReset: () => {
            const container = document.getElementById('shader-ui-container');
            container.innerHTML = '';
        },
    }
}

const viewportMargins = {
    left: 50,
    top: 0,
    right: 50,
    bottom: 0,
};

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

let tiledImage = null;

function createSelect(name, optionMap, selectedOption) {
    return `
<select name="${name}" data-image="" data-field="${name}">
  ${Object.entries(optionMap).map(([k, v]) => {
      const selected = selectedOption === k ? "selected" : "";
      return `<option value="${k}" ${selected}>${v}</option>`;
    }).join("\n")}
</select>`;
}

function createImageOptionsElement(key, label){
    let shaderSelector = "";

    const map = {};

    for (let shader of OpenSeadragon.FlexRenderer.ShaderMediator.availableShaders()) {
        map[shader.type()] = shader.name();
    }

    shaderSelector = `<label>Shader: ${createSelect("shader-type", map, "identity")}</label>`;

    return $(`<div class="image-options">
        <label>__title__</label>
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
            <label>Wrap: <select data-image="" data-field="wrapping"></select></label>
            <label>Smoothing: <input type="checkbox" data-image="" data-field="smoothing" checked></label>
            ${shaderSelector}
        </div>
    </div>`.replaceAll('data-image=""', `data-image="${key}"`).replace('__title__', label));
}

$('#image-options-container').append(createImageOptionsElement("world", "World"));

let options = $(`#image-options input[type=number]`).toArray().reduce((acc, input)=>{
    let field = $(input).data('field');

    if (field) {
        acc[field] = Number(input.value);
    }

    return acc;
}, {});

options.flipped = $(`#image-options input[data-type=flipped]`).prop('checked');

viewer && viewer.addTiledImage({tileSource: source, ...options});

viewer && viewer.world.addOnceHandler('add-item', function(ev) {
    tiledImage = ev.item;
});

$('#image-options-container input').on('change', function() {
    let data = $(this).data();
    let value = $(this).val();

    updateTiledImage(data, value, this);
});

function updateTiledImage(data, value, item) {
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

$('.image-options select[data-field=wrapping]').append(getWrappingOptions()).on('change',function(){
    if (tiledImage) {
        switch (this.value) {
            case "None": tiledImage.wrapHorizontal = tiledImage.wrapVertical = false; break;
            case "Horizontal": tiledImage.wrapHorizontal = true; tiledImage.wrapVertical = false; break;
            case "Vertical": tiledImage.wrapHorizontal = false; tiledImage.wrapVertical = true; break;
            case "Both": tiledImage.wrapHorizontal = tiledImage.wrapVertical = true; break;
        }

        tiledImage.redraw();//trigger a redraw for the webgl renderer.
    }
}).trigger('change');

$('.image-options select[data-field=shader-type]').on('change',function(){
    const drawer = viewer.drawer;

    if (tiledImage) {
        drawer.configureTiledImage(tiledImage, {
            name: "My Custom Shader",
            type: this.value,
            params: {}
        });

        drawer.tiledImageCreated(tiledImage);
    }
})

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
