const sources = {
    "rainbow":"../data/testpattern.dzi",
    "leaves":"../data/iiif_2_0_sizes/info.json",
    "bblue":{
        type:'image',
        url: "../data/BBlue.png",
    },
    "duomo":"https://openseadragon.github.io/example-images/duomo/duomo.dzi",
    "fabricGeometry": "../data/fabric.geometry.json",
    "japan":"http://localhost:8888/data/v3.json"
}
const labels = {
    rainbow: 'Rainbow Grid',
    leaves: 'Leaves',
    bblue: 'Blue B',
    duomo: 'Duomo',
    fabricGeometry: 'Fabric Geometry',
    japan: 'Japan'
}
const drawers = {
    "flex-renderer": "Flex Renderer"
}

//Support drawer type from the url
const url = new URL(window.location.href);
const drawer = "flex-renderer"

const selectedWebglVersion = url.searchParams.get("webgl-version") || "2.0";
const drawerOptions = {
    "flex-renderer": {
        debug: true,
        webGLPreferredVersion: selectedWebglVersion,
        htmlHandler: (shaderLayer, shaderConfig) => {
            const container = document.getElementById('my-shader-ui-container');
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
            const container = document.getElementById('my-shader-ui-container');
            container.innerHTML = '';
        }
    }
}

const viewportMargins = {
    left: 100,
    top: 0,
    right: 0,
    bottom: 50,
};

$("#title-w").html(drawers[drawer]);

//Double viewer setup for comparison - CanvasDrawer and WebGLDrawer
let viewer = window.viewer = OpenSeadragon({
    id: "drawer-canvas",
    prefixUrl: "../../openseadragon/images/",
    minZoomImageRatio:0.01,
    maxZoomPixelRatio:100,
    smoothTileEdgesMinZoom:1.1,
    crossOriginPolicy: 'Anonymous',
    ajaxWithCredentials: false,
    // maxImageCacheCount: 30,
    drawer: drawer,
    drawerOptions: drawerOptions,
    blendTime:0,
    showNavigator:true,
    viewportMargins,
});

$('#image-picker').sortable({
    update: function(event, ui){
        let thisItem = ui.item.find('.toggle').data('item');
        let items = $('#image-picker input.toggle:checked').toArray().map(item=>$(item).data('item'));
        let newIndex = items.indexOf(thisItem);
        if(thisItem){
            viewer.world.setItemIndex(thisItem, newIndex);
        }
    }
});

Object.keys(sources).forEach((key, index)=>{
    let element = makeImagePickerElement(key, labels[key])
    $('#image-picker').append(element);
    if(index === 0){
        element.find('.toggle').prop('checked',true);
    }
})

$('#image-picker input.toggle').on('change',function(){
    let data = $(this).data();
    if(this.checked){
        addTileSource(viewer, data.image, this);
    } else {
        if(data.item){
            viewer.world.removeItem(data.item);
            $(this).data({item: null});
        }
    }
}).trigger('change');

$('#image-picker input:not(.toggle)').on('change',function(){
    let data = $(this).data();
    let value = $(this).val();
    let tiledImage = $(`#image-picker input.toggle[data-image=${data.image}]`).data('item');
    updateTiledImage(tiledImage, data, value, this);
});

function updateTiledImage(tiledImage, data, value, item){
    let field = data.field;

    if(tiledImage){
        //item = tiledImage
        if(field == 'x'){
            let bounds = tiledImage.getBoundsNoRotate();
            let position = new OpenSeadragon.Point(Number(value), bounds.y);
            tiledImage.setPosition(position);
        } else if ( field == 'y'){
            let bounds = tiledImage.getBoundsNoRotate();
            let position = new OpenSeadragon.Point(bounds.x, Number(value));
            tiledImage.setPosition(position);
        } else if (field == 'width'){
            tiledImage.setWidth(Number(value));
        } else if (field == 'degrees'){
            tiledImage.setRotation(Number(value));
        } else if (field == 'opacity'){
            tiledImage.setOpacity(Number(value));
        } else if (field == 'flipped'){
            tiledImage.setFlip($(item).prop('checked'));
        } else if (field == 'smoothing'){
            const checked = $(item).prop('checked');
            viewer.drawer.setImageSmoothingEnabled(checked);
            $('[data-field=smoothing]').prop('checked', checked);
        } else if (field == 'cropped'){
            if( $(item).prop('checked') ){
                let scale = tiledImage.source.width;
                let croppingPolygons = [ [{x:0.2*scale, y:0.2*scale}, {x:0.8*scale, y:0.2*scale}, {x:0.5*scale, y:0.8*scale}] ];
                tiledImage.setCroppingPolygons(croppingPolygons);
            } else {
                tiledImage.resetCroppingPolygons();
            }
        } else if (field == 'clipped'){
            if( $(item).prop('checked') ){
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
    } else {
        //viewer-level option
    }
}

$('.image-options select[data-field=composite]').append(getCompositeOperationOptions()).on('change',function(){
    let data = $(this).data();
    let tiledImage = $(`#image-picker input.toggle[data-image=${data.image}]`).data('item');
    if(tiledImage){
        tiledImage.setCompositeOperation(this.value == 'null' ? null : this.value);
    }
}).trigger('change');

$('.image-options select[data-field=wrapping]').append(getWrappingOptions()).on('change',function(){
    let data = $(this).data();
    let tiledImage = $(`#image-picker input.toggle[data-image=${data.image}]`).data('item');
    if(tiledImage){
        switch(this.value){
            case "None": tiledImage.wrapHorizontal = tiledImage.wrapVertical = false; break;
            case "Horizontal": tiledImage.wrapHorizontal = true; tiledImage.wrapVertical = false; break;
            case "Vertical": tiledImage.wrapHorizontal = false; tiledImage.wrapVertical = true; break;
            case "Both": tiledImage.wrapHorizontal = tiledImage.wrapVertical = true; break;
        }
        tiledImage.redraw();//trigger a redraw for the webgl renderer.
    }
}).trigger('change');

$('.image-options select[data-field=shader-type]').on('change',function(){
    let data = $(this).data();
    const tiledImages = ['item']
        .map(selector => $(`#image-picker input.toggle[data-image=${data.image}]`).data(selector)).filter(Boolean);

    if (viewer.drawer.getType() === "flex-renderer") {
        const drawer = viewer.drawer;
        tiledImages.forEach(tiledImage => {
            drawer.configureTiledImage(tiledImage, {
                name: "My Custom Shader",
                type: this.value,
                params: {}
            });
            drawer.tiledImageCreated(tiledImage);
        });
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
function getCompositeOperationOptions(){
    let opts = [null,'source-over','source-in','source-out','source-atop',
                'destination-over','destination-in','destination-out','destination-atop',
                'lighten','darken','copy','xor','multiply','screen','overlay','color-dodge',
                'color-burn','hard-light','soft-light','difference','exclusion',
                'hue','saturation','color','luminosity'];
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

function addTileSource(viewer, image, checkbox){
    let options = $(`#image-picker input[data-image=${image}][type=number]`).toArray().reduce((acc, input)=>{
        let field = $(input).data('field');
        if(field){
            acc[field] = Number(input.value);
        }
        return acc;
    }, {});

    options.flipped = $(`#image-picker input[data-image=${image}][data-type=flipped]`).prop('checked');

    let items = $('#image-picker input.toggle:checked').toArray();
    let insertionIndex = items.indexOf(checkbox);

    let tileSource = sources[image];
    if(tileSource){
        viewer&&viewer.addTiledImage({tileSource: tileSource, ...options, index: insertionIndex});
        viewer&&viewer.world.addOnceHandler('add-item',function(ev){
            let item = ev.item;
            let field = 'item';
            $(checkbox).data(field,item);
            // item.source.hasTransparency = ()=>true; //simulate image with transparency, to show seams in default renderer
        });
    }
}

// build select with name attribute and option map {optionValue: label} data
function getSelectForValues(name, selectedOption, optionMap) {
    return `
<select name="${name}" data-image="" data-field="${name}">
  ${Object.entries(optionMap).map(([k, v]) => {
      const selected = selectedOption === k ? "selected" : "";
      return `<option value="${k}" ${selected}>${v}</option>`;
    }).join("\n")}
</select>`;
}

function addOptionToForm(html) {
    $("#refresh-page-form").append(html + "<br>");
}

function makeImagePickerElement(key, label){
    let shaderSelector = "";
    if (drawer === "flex-renderer") {
        const map = {};
        for (let shader of OpenSeadragon.FlexRenderer.ShaderMediator.availableShaders()) {
            map[shader.type()] = shader.name();
        }
        shaderSelector = `<label>Shader: ${getSelectForValues("shader-type", "identity", map)}</label>`;
    }

    return $(`<div class="image-options">
        <span class="ui-icon ui-icon-arrowthick-2-n-s"></span>
        <label><input type="checkbox" data-image="" class="toggle"> __title__</label>
        <div class="option-grid">
            <label>X: <input type="number" value="0" data-image="" data-field="x"> </label>
            <label>Y: <input type="number" value="0" data-image="" data-field="y"> </label>
            <label>Width: <input type="number" value="1" data-image="" data-field="width" min="0"> </label>
            <label>Degrees: <input type="number" value="0" data-image="" data-field="degrees"> </label>
            <label>Opacity: <input type="number" value="1" data-image="" data-field="opacity" min="0" max="1" step="0.2"> </label>
            <span></span>
            <label>Flipped: <input type="checkbox" data-image="" data-field="flipped"></label>
            <label>Cropped: <input type="checkbox" data-image="" data-field="cropped"></label>
            <label>Clipped: <input type="checkbox" data-image="" data-field="clipped"></label>
            <label>Chess Tile Opacity: <input type="checkbox" data-image="" data-field="tile-level-opecity"></label>
            <label>Debug: <input type="checkbox" data-image="" data-field="debug"></label>
            <label>Composite: <select data-image="" data-field="composite"></select></label>
            <label>Wrap: <select data-image="" data-field="wrapping"></select></label>
            <label>Smoothing: <input type="checkbox" data-image="" data-field="smoothing" checked></label>
            ${shaderSelector}
        </div>
    </div>`.replaceAll('data-image=""', `data-image="${key}"`).replace('__title__', label));

}


// Ability to select desired drawer
addOptionToForm(`
<div>
  Note: you can run the comparison with desired drawers like this: drawercomparison.html?left=[type]&right=[type]
   ${getSelectForValues("left", drawer, drawers)}
</div>`);


if (drawer === "flex-renderer") {
    // Setup for modular renderer
    addOptionToForm(`
<div>
    For Flex Renderer, a webgl version of a choice can be used:
     ${getSelectForValues("webgl-version", selectedWebglVersion, {"1.0": "WebGL 1", "2.0": "WebGL 2"})}
</div>`);


}
