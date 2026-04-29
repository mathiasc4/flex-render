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

const drawer = "flex-renderer";
const drawerOptions = {
    "flex-renderer": {
        debug: true,
        webGLPreferredVersion: "2.0",
        htmlHandler: (shaderLayer, shaderConfig, htmlContext = {}) => {
            const container = document.getElementById('my-shader-ui-container');

            // Be careful, shaderLayer.id is changing. It should not be used as a key to identify the layer between
            // different programs such as in this case, but it's okay to use it when referencing concrete running layer.

            // Create custom layer controls - you can add more HTML controls allowing users to
            // control gamma, blending, or even change the shader type. Here we just show shader layer name + checkbox representing
            // its visibility (but we do not manage change event and thus users cannot change it). In case of error, we show
            // the error message below the checkbox.
            // The compulsory step is to include `shaderLayer.htmlControls()` output.

            if (!container || !shaderLayer) {
                return "";
            }

            const renderer = shaderLayer.backend && shaderLayer.backend.renderer;
            const drawer = renderer && renderer.drawer ? renderer.drawer : null;

            const depth = Number.isFinite(htmlContext.depth) ? htmlContext.depth : 0;
            const isGroupChild = !!htmlContext.isGroupChild;
            const isGroup = shaderConfig.type === "group";
            const parentName = htmlContext.parentConfig ?
                (htmlContext.parentConfig.name || htmlContext.parentConfig.type || htmlContext.parentShaderId) :
                null;

            const pathString = htmlContext.pathString || shaderLayer.id;
            const pathClass = pathString.replace(/[^0-9a-zA-Z_-]/g, '_');

            const wrapper = document.createElement("div");
            wrapper.className =
                `shader-control-card shader-control-card--depth-${depth} ` +
                `${isGroupChild ? 'shader-control-card--group-child' : 'shader-control-card--top'} ` +
                `${isGroup ? 'shader-control-card--group' : ''} shader-control-card--${pathClass}`;
            wrapper.dataset.shaderId = shaderLayer.id;
            wrapper.dataset.shaderPath = pathString;
            wrapper.dataset.shaderDepth = String(depth);
            wrapper.dataset.groupChild = isGroupChild ? "true" : "false";

            wrapper.style.marginLeft = `${depth * 18}px`;
            wrapper.style.marginBottom = "10px";
            wrapper.style.padding = "10px 12px";
            wrapper.style.border = "1px solid #d1d5db";
            wrapper.style.borderLeft = isGroupChild ? "4px solid #9ca3af" : "1px solid #d1d5db";
            wrapper.style.borderRadius = "8px";
            wrapper.style.background = isGroupChild ? "#fafafa" : "#f3f3f3";

            const header = document.createElement("div");
            header.style.display = "flex";
            header.style.alignItems = "flex-start";
            header.style.justifyContent = "space-between";
            header.style.gap = "10px";
            header.style.marginBottom = "6px";

            const titleWrap = document.createElement("div");
            titleWrap.style.minWidth = "0";

            const label = document.createElement("label");
            label.style.display = "flex";
            label.style.alignItems = "center";
            label.style.gap = "6px";
            label.style.fontWeight = "600";
            label.style.margin = "0";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = !!shaderConfig.visible;

            const title = document.createElement("span");
            title.textContent = shaderConfig.name || shaderConfig.type;

            label.appendChild(checkbox);
            label.appendChild(title);
            titleWrap.appendChild(label);

            if (isGroupChild && parentName) {
                const parentLabel = document.createElement("div");
                parentLabel.style.fontSize = "12px";
                parentLabel.style.color = "#6b7280";
                parentLabel.style.marginTop = "2px";
                parentLabel.textContent = `In group: ${parentName}`;
                titleWrap.appendChild(parentLabel);
            }

            const badges = document.createElement("div");
            badges.style.display = "flex";
            badges.style.gap = "6px";
            badges.style.flexWrap = "wrap";
            badges.style.justifyContent = "flex-end";

            if (isGroup) {
                const groupBadge = document.createElement("span");
                groupBadge.textContent = "Group";
                groupBadge.style.fontSize = "11px";
                groupBadge.style.padding = "2px 6px";
                groupBadge.style.border = "1px solid #9ca3af";
                groupBadge.style.borderRadius = "999px";
                groupBadge.style.background = "#ffffff";
                groupBadge.style.color = "#374151";
                groupBadge.style.whiteSpace = "nowrap";
                badges.appendChild(groupBadge);
            }

            if (isGroupChild) {
                const childBadge = document.createElement("span");
                childBadge.textContent = `Level ${depth}`;
                childBadge.style.fontSize = "11px";
                childBadge.style.padding = "2px 6px";
                childBadge.style.borderRadius = "999px";
                childBadge.style.background = "#e5e7eb";
                childBadge.style.color = "#374151";
                childBadge.style.whiteSpace = "nowrap";
                badges.appendChild(childBadge);
            }

            header.appendChild(titleWrap);
            header.appendChild(badges);
            wrapper.appendChild(header);

            if (shaderLayer.error) {
                const errorNode = document.createElement("div");
                errorNode.style.marginBottom = "8px";
                errorNode.style.color = "#b91c1c";
                errorNode.style.fontSize = "12px";
                errorNode.textContent = shaderLayer.error;
                wrapper.appendChild(errorNode);
            }

            const controls = document.createElement("div");
            controls.className = "shader-control-card__controls";
            controls.innerHTML = shaderLayer.htmlControls();
            wrapper.appendChild(controls);

            checkbox.addEventListener("change", () => {
                const config = shaderLayer.getConfig ? shaderLayer.getConfig() : shaderConfig;
                const visible = checkbox.checked ? 1 : 0;

                config.visible = visible;
                shaderConfig.visible = visible;

                if (renderer && typeof renderer.notifyVisualizationChanged === "function") {
                    renderer.notifyVisualizationChanged({
                        reason: "visibility-change",
                        shaderId: shaderLayer.id,
                        shaderType: shaderLayer.constructor.type(),
                        visible: visible
                    });
                }

                if (drawer && typeof drawer.rebuild === "function") {
                    drawer.rebuild();
                    return;
                }

                if (typeof shaderLayer._rebuild === "function") {
                    shaderLayer._rebuild();
                }

                if (typeof shaderLayer.invalidate === "function") {
                    shaderLayer.invalidate();
                }
            });

            container.appendChild(wrapper);
            return "";
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

viewer.addTiledImage({
    tileSource: sources["duomo"],
    index: 3,
});

let shaderLayerConfig = {
    "rainbow": {
        "name": "Rainbow",
        "type": "identity",
        "tiledImages": [0],
    },
    "g": {
        "name": "Group Layer",
        "type": "group",
        "shaders": {
            "leaves": {
                "name": "Leaves",
                "type": "heatmap",
                "tiledImages": [1],
            },
            "bblue": {
                "name": "Blue B",
                "type": "identity",
                "tiledImages": [2],
            },
        },
    },
    "duomo": {
        "name": "Duomo",
        "type": "identity",
        "tiledImages": [3],
    },
};

// shaderLayerConfig = {
//     "rainbow": {
//         "type": "identity",
//         "tiledImages": [0],
//     },
//     "leaves": {
//         "type": "identity",
//         "tiledImages": [1],
//     },
//     "bblue": {
//         "type": "identity",
//         "tiledImages": [2],
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
