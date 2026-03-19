const sources = {
    "rainbow": "../data/testpattern.dzi",
    "leaves": "../data/iiif_2_0_sizes/info.json",
    "bblue": {
        type: "image",
        url: "../data/BBlue.png",
    },
    "duomo": "https://openseadragon.github.io/example-images/duomo/duomo.dzi",
    "japan": "http://localhost:8888/data/v3.json"
};

const labels = {
    rainbow: "Rainbow Grid",
    leaves: "Leaves",
    bblue: "Blue B",
    duomo: "Duomo",
    japan: "Japan",
};

const drawer = "flex-renderer"
const drawerOptions = {
    "flex-renderer": {
        debug: true,
        webGLPreferredVersion: "2.0",
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
};

const viewportMargins = {
    left: 100,
    top: 0,
    right: 0,
    bottom: 50,
};

$("#title-w").html("FlexRenderer");

let viewer = window.viewer = OpenSeadragon({
    id: "drawer-canvas",
    prefixUrl: "../../openseadragon/images/",
    minZoomImageRatio: 0.01,
    maxZoomPixelRatio: 100,
    smoothTileEdgesMinZoom: 1.1,
    crossOriginPolicy: "Anonymous",
    ajaxWithCredentials: false,
    // maxImageCacheCount: 30,
    drawer: drawer,
    drawerOptions: drawerOptions,
    blendTime: 0,
    showNavigator: true,
    viewportMargins: viewportMargins,
});

viewer.addTiledImage({
    tileSource: sources["rainbow"],
    index: 0,
});

viewer.addTiledImage({
    tileSource: sources["leaves"],
    index: 1,
});

viewer.addTiledImage({
    tileSource: sources["bblue"],
    index: 2,
});

let shaderLayerConfig = {
    "rainbow": {
        "type": "identity",
        "tiledImages": [0],
    },
    "g": {
        "type": "group",
        "shaders": {
            "leaves": {
                "type": "identity",
                "tiledImages": [1]
            },
            "bblue": {
                "type": "identity",
                "tiledImages": [2]
            },
        },
    },
};

// let shaderLayerConfig = {
//     "rainbow": {
//         "type": "identity",
//         "tiledImages": [0],
//         "visible": true,
//     },
//     "leaves": {
//         "type": "identity",
//         "tiledImages": [1],
//         "visible": true,
//     },
//     "bblue": {
//         "type": "identity",
//         "tiledImages": [2],
//         "visible": true,
//     },
// };

viewer.drawer.overrideConfigureAll(shaderLayerConfig);


// $('#image-picker').sortable({
//     update: function() {
//         let shaderLayerOrder = $('#image-picker input.toggle:checked').map((_, e) => $(e).data().image).get();
//         viewer.drawer.overrideConfigureAll(shaderLayerConfig, shaderLayerOrder);
//     }
// });

// // build select with name attribute and option map {optionValue: label} data
// function getSelectForValues(name, selectedOption, optionMap) {
//     return `
// <select name="${name}" data-image="" data-field="${name}">
//   ${Object.entries(optionMap).map(([k, v]) => {
//       const selected = selectedOption === k ? "selected" : "";
//       return `<option value="${k}" ${selected}>${v}</option>`;
//     }).join("\n")}
// </select>`;
// }

// function makeImagePickerElement(key, label) {
//     const map = {};

//     for (let shader of OpenSeadragon.FlexRenderer.ShaderMediator.availableShaders()) {
//         map[shader.type()] = shader.name();
//     }

//     const shaderSelector = `<label>Shader: ${getSelectForValues("shader-type", "identity", map)}</label>`;

//     return $(`<div class="image-options">
//         <span class="ui-icon ui-icon-arrowthick-2-n-s"></span>
//         <label><input type="checkbox" data-image="" class="toggle">__title__</label>
//         <div class="option-grid">
//             <label>Opacity: <input type="number" value="1" data-image="" data-field="opacity" min="0" max="1" step="0.2"> </label>
//             <label>Debug: <input type="checkbox" data-image="" data-field="debug"></label>
//             <label>Composite: <select data-image="" data-field="composite"></select></label>
//             ${shaderSelector}
//         </div>
//     </div>`.replaceAll('data-image=""', `data-image="${key}"`).replace('__title__', label));
// }

// Object.keys(shaderLayerConfig).forEach(
//     function(key) {
//         let element = makeImagePickerElement(key, labels[key]);

//         $('#image-picker').append(element);

//         // if (index === 0) {
//             element.find('.toggle').prop('checked', true);
//         // }
//     }
// );

// $('#image-picker input.toggle').on(
//     'change',
//     function() {
//         console.log("toggled");

//         let shaderLayerOrder = $('#image-picker input.toggle:checked').map((_, e) => $(e).data().image).get();
//         viewer.drawer.overrideConfigureAll(shaderLayerConfig, shaderLayerOrder);
//     }
// ).trigger('change');


// $('#image-picker input').on(
//     'change',
//     function() {
//         let data = $(this).data();
//         let value = $(this).val();

//         console.log(data);
//         console.log(value);

//         if (this.checked) {
//             addTileSource(viewer, data.image, this);
//         } else {
//             if (data.item) {
//                 viewer.world.removeItem(data.item);
//                 $(this).data({item: null});
//             }
//         }
//     }
// ).trigger('change');


// function updateTiledImage(tiledImage, data, value, item){
//     let field = data.field;

//     if(tiledImage){
//         //item = tiledImage
//         if(field == 'x'){
//             let bounds = tiledImage.getBoundsNoRotate();
//             let position = new OpenSeadragon.Point(Number(value), bounds.y);
//             tiledImage.setPosition(position);
//         } else if ( field == 'y'){
//             let bounds = tiledImage.getBoundsNoRotate();
//             let position = new OpenSeadragon.Point(bounds.x, Number(value));
//             tiledImage.setPosition(position);
//         } else if (field == 'width'){
//             tiledImage.setWidth(Number(value));
//         } else if (field == 'degrees'){
//             tiledImage.setRotation(Number(value));
//         } else if (field == 'opacity'){
//             tiledImage.setOpacity(Number(value));
//         } else if (field == 'flipped'){
//             tiledImage.setFlip($(item).prop('checked'));
//         } else if (field == 'smoothing'){
//             const checked = $(item).prop('checked');
//             viewer.drawer.setImageSmoothingEnabled(checked);
//             $('[data-field=smoothing]').prop('checked', checked);
//         } else if (field == 'cropped'){
//             if( $(item).prop('checked') ){
//                 let scale = tiledImage.source.width;
//                 let croppingPolygons = [ [{x:0.2*scale, y:0.2*scale}, {x:0.8*scale, y:0.2*scale}, {x:0.5*scale, y:0.8*scale}] ];
//                 tiledImage.setCroppingPolygons(croppingPolygons);
//             } else {
//                 tiledImage.resetCroppingPolygons();
//             }
//         } else if (field == 'clipped'){
//             if( $(item).prop('checked') ){
//                 let scale = tiledImage.source.width;
//                 let clipRect = new OpenSeadragon.Rect(0.1*scale, 0.2*scale, 0.6*scale, 0.4*scale);
//                 tiledImage.setClip(clipRect);
//             } else {
//                 tiledImage.setClip(null);
//             }
//         } else if (field == 'debug'){
//             if( $(item).prop('checked') ){
//                 tiledImage.debugMode = true;
//             } else {
//                 tiledImage.debugMode = false;
//             }
//         }
//     } else {
//         //viewer-level option
//     }
// }

// $('.image-options select[data-field=composite]').append(getCompositeOperationOptions()).on('change',function(){
//     let data = $(this).data();
//     let tiledImage = $(`#image-picker input.toggle[data-image=${data.image}]`).data('item');
//     if(tiledImage){
//         tiledImage.setCompositeOperation(this.value == 'null' ? null : this.value);
//     }
// }).trigger('change');

// $('.image-options select[data-field=wrapping]').append(getWrappingOptions()).on('change',function(){
//     let data = $(this).data();
//     let tiledImage = $(`#image-picker input.toggle[data-image=${data.image}]`).data('item');
//     if(tiledImage){
//         switch(this.value){
//             case "None": tiledImage.wrapHorizontal = tiledImage.wrapVertical = false; break;
//             case "Horizontal": tiledImage.wrapHorizontal = true; tiledImage.wrapVertical = false; break;
//             case "Vertical": tiledImage.wrapHorizontal = false; tiledImage.wrapVertical = true; break;
//             case "Both": tiledImage.wrapHorizontal = tiledImage.wrapVertical = true; break;
//         }
//         tiledImage.redraw();//trigger a redraw for the webgl renderer.
//     }
// }).trigger('change');

// $('.image-options select[data-field=shader-type]').on('change',function(){
//     let data = $(this).data();
//     const tiledImages = ['item']
//         .map(selector => $(`#image-picker input.toggle[data-image=${data.image}]`).data(selector)).filter(Boolean);

//     if (viewer.drawer.getType() === "flex-renderer") {
//         const drawer = viewer.drawer;
//         tiledImages.forEach(tiledImage => {
//             drawer.configureTiledImage(tiledImage, {
//                 name: "My Custom Shader",
//                 type: this.value,
//                 params: {}
//             });
//             drawer.tiledImageCreated(tiledImage);
//         });
//     }
// })


// function getWrappingOptions(){
//     let opts = ['None', 'Horizontal', 'Vertical', 'Both'];
//     let elements = opts.map((opt, i)=>{
//         let el = $('<option>',{value:opt}).text(opt);
//         if(i===0){
//             el.attr('selected',true);
//         }
//         return el[0];
//         // $('.image-options select').append(el);
//     });
//     return $(elements);
// }

// function getCompositeOperationOptions(){
//     let opts = [null,'source-over','source-in','source-out','source-atop',
//                 'destination-over','destination-in','destination-out','destination-atop',
//                 'lighten','darken','copy','xor','multiply','screen','overlay','color-dodge',
//                 'color-burn','hard-light','soft-light','difference','exclusion',
//                 'hue','saturation','color','luminosity'];

//     let elements = opts.map((opt, i)=>{
//         let el = $('<option>', {value: opt}).text(opt);

//         if (i === 0) {
//             el.attr('selected', true);
//         }

//         return el[0];
//         // $('.image-options select').append(el);
//     });

//     return $(elements);
// }
