(function ($) {
    // todo: support no-atlas mode (dont bind anything if not used at all)
    $.FlexRenderer.WebGL20.TextureAtlas2DArray = class extends $.FlexRenderer.TextureAtlas {

        constructor(gl, opts) {
            super(gl, opts);

            this.version = 1;
            this._atlasUploadedVersion = -1;
            this._metadataDirty = true;

            /** @type {{ id:number, source:any, w:number, h:number, layer:number, x:number, y:number }[]} */
            this._entries = [];
            this._pendingUploads = [];

            /** @type {{ shelves: { y:number, h:number, x:number }[], nextY:number }[]} */
            this._layerState = [];
            this._createTexture(this.layerWidth, this.layerHeight, this.layers);
        }


        /**
         * Add an image. Returns a stable textureId.
         * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|ImageData|Uint8Array} source
         * @param {{
         *   width?: number,
         *   height?: number,
         * }} [opts]
         * @returns {number}
         */
        addImage(source, opts) {
            const width = (opts && opts.width && typeof opts.width === 'number') ? opts.width :
                (source && (source.width || source.naturalWidth || (source.canvas && source.canvas.width) || source.w));
            const height = (opts && opts.height && typeof opts.height === 'number') ? opts.height :
                (source && (source.height || source.naturalHeight || (source.canvas && source.canvas.height) || source.h));

            if (!width || !height) {
                throw new Error('TextureAtlas2DArray.addImage: width or height missing');
            }

            const place = this._ensureCapacityFor(width, height);

            const id = this._entries.length;

            // remember for re-pack / re-upload
            this._entries.push({
                id: id,
                source: source,
                w: width,
                h: height,
                layer: place.layer,
                x: place.x,
                y: place.y
            });

            // enqueue GPU upload (performed later in load()/commitUploads())
            this._pendingUploads.push({
                source: source,
                w: width,
                h: height,
                layer: place.layer,
                x: place.x,
                y: place.y
            });

            if (id + 1 > this.maxIds) {
                throw new Error('TextureAtlas2DArray: exceeded maxIds capacity');
            }

            this._metadataDirty = true;
            this.version++;
            return id;
        }

        /**
         * Texture atlas works as a single texture unit. Bind the atlas before using it at desired texture unit.
         * @param textureUnit
         */
        bind(textureUnit, textureUnitIndex) {
            const gl = this.gl;

            // textureUnit is the numeric unit index (0..N-1)
            gl.activeTexture(textureUnit);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
            gl.uniform1i(this._atlasTexLoc, textureUnitIndex);
            gl.uniform1i(this._atlasWidthLoc, this.layerWidth);
            gl.uniform1i(this._atlasHeightLoc, this.layerHeight);
            gl.uniform1i(this._atlasMetadataRowsLoc, this._metadataRows());
            this._atlasUploadedVersion = this.version;
        }

        /**
         * Get WebGL Atlas shader code. This code must define the following function:
         * vec4 osd_atlas_texture(int, vec2)
         * which selects texture ID (1st arg) and returns the color at the uv position (2nd arg)
         *
         * @return {string}
         */
        getFragmentShaderDefinition() {
            const metadataTexelsPerEntry = 3;
            return `
uniform sampler2DArray u_atlasTex;
uniform int u_atlasWidth;
uniform int u_atlasHeight;
uniform int u_atlasMetadataRows;

const int OSD_ATLAS_MAX_IDS = ${this.maxIds};
const int OSD_ATLAS_METADATA_TEXELS_PER_ENTRY = ${metadataTexelsPerEntry};
const int OSD_ATLAS_PADDING = ${this.padding};

int osd_atlas_unpack_u16(vec2 normalizedPair) {
ivec2 bytes = ivec2(round(clamp(normalizedPair, 0.0, 1.0) * 255.0));
return bytes.x | (bytes.y << 8);
}

ivec2 osd_atlas_meta_coord(int linearIndex, int atlasWidth) {
return ivec2(linearIndex % atlasWidth, linearIndex / atlasWidth);
}

vec4 osd_atlas_texture(int textureId, vec2 uv) {
if (textureId < 0 || textureId >= OSD_ATLAS_MAX_IDS) {
    // return purple for non-existent texture
    return vec4(1.0, 0.0, 1.0, 1.0);
}

int baseIndex = textureId * OSD_ATLAS_METADATA_TEXELS_PER_ENTRY;
ivec2 meta0Coord = osd_atlas_meta_coord(baseIndex, u_atlasWidth);
ivec2 meta1Coord = osd_atlas_meta_coord(baseIndex + 1, u_atlasWidth);
ivec2 meta2Coord = osd_atlas_meta_coord(baseIndex + 2, u_atlasWidth);

if (meta2Coord.y >= u_atlasMetadataRows) {
    return vec4(1.0, 0.0, 1.0, 1.0);
}

vec4 meta0 = texelFetch(u_atlasTex, ivec3(meta0Coord, 0), 0);
vec4 meta1 = texelFetch(u_atlasTex, ivec3(meta1Coord, 0), 0);
vec4 meta2 = texelFetch(u_atlasTex, ivec3(meta2Coord, 0), 0);

int packedLayer = osd_atlas_unpack_u16(meta2.rg);
if (packedLayer <= 0) {
    return vec4(1.0, 0.0, 1.0, 1.0);
}

int x = osd_atlas_unpack_u16(meta0.rg);
int y = osd_atlas_unpack_u16(meta0.ba);
int w = osd_atlas_unpack_u16(meta1.rg);
int h = osd_atlas_unpack_u16(meta1.ba);

// enable mirroring
uv = mod(uv, 2.0);
uv = uv - 1.0;
uv = sign(uv) * uv;
uv = 1.0 - uv;

vec2 atlasSize = vec2(float(u_atlasWidth), float(u_atlasHeight));
vec2 offset = vec2(float(x + OSD_ATLAS_PADDING), float(y + OSD_ATLAS_PADDING)) / atlasSize;
vec2 scale = vec2(float(w), float(h)) / atlasSize;
vec2 st = offset + uv * scale;

return texture(u_atlasTex, vec3(st, float(packedLayer)));
}
`;
        }

        /**
         * Load the current atlas uniform locations.
         * @param {WebGLProgram} program
         */
        load(program) {
            const gl = this.gl;

            this._atlasTexLoc    = gl.getUniformLocation(program, "u_atlasTex");
            this._atlasWidthLoc = gl.getUniformLocation(program, "u_atlasWidth");
            this._atlasHeightLoc = gl.getUniformLocation(program, "u_atlasHeight");
            this._atlasMetadataRowsLoc = gl.getUniformLocation(program, "u_atlasMetadataRows");
            this._commitUploads();
        }

        /**
         * Destroy the atlas.
         */
        destroy() {
            const gl = this.gl;

            if (this.texture) {
                gl.deleteTexture(this.texture);
                this.texture = null;
            }

            this._entries.length = 0;
            this._layerState.length = 0;
        }

        _commitUploads() {
            if (!this.texture) {
                // allocate storage if not created yet
                this._createTexture(this.layerWidth, this.layerHeight, this.layers);
            }

            if (!this._pendingUploads.length && !this._metadataDirty) {
                return;
            }

            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);

            for (const u of this._pendingUploads) {
                const x = u.x + this.padding;
                const y = u.y + this.padding;
                const physicalLayer = u.layer + 1;
                this._uploadSubImage(gl, u.source, u.w, u.h, physicalLayer, x, y);
            }

            if (this._metadataDirty) {
                this._uploadMetadata(gl);
                this._metadataDirty = false;
            }

            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

            // all uploads done; clear queue
            this._pendingUploads.length = 0;
        }

        _createTexture(w, h, depth) {
            const gl = this.gl;

            if (this.texture) {
                gl.deleteTexture(this.texture);
                this.texture = null;
            }

            this.texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
            const metadataRows = Math.ceil((this.maxIds * 3) / Math.max(w, 1));
            const height = Math.max(h, metadataRows || 1);
            const physicalDepth = Math.max(depth + 1, 2);
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, this.internalFormat, w, height, physicalDepth);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

            this.layerWidth = w;
            this.layerHeight = height;
            this.layers = depth;
            this._physicalLayers = physicalDepth;
            this._metadataDirty = true;

            // reset packer state sized to current depth
            this._layerState = [];
            for (let i = 0; i < depth; i++) {
                this._layerState.push({ shelves: [], nextY: 0 });
            }
        }

        _ensureCapacityFor(width, height) {
            const paddedWidth = width + 2 * this.padding;
            const paddedHeight = height + 2 * this.padding;

            // try current layers first
            for (let li = 0; li < this.layers; li++) {
                const pos = this._tryPlaceRect(li, paddedWidth, paddedHeight);
                if (pos) {
                    return { layer: li, x: pos.x, y: pos.y, willRealloc: false };
                }
            }

            // if rectangle is bigger than layer extent, grow extent (power of 2)
            let newW = this.layerWidth;
            let newH = this.layerHeight;
            if (paddedWidth > newW || paddedHeight > newH) {
                while (newW < paddedWidth) {
                    newW *= 2;
                }
                while (newH < paddedHeight) {
                    newH *= 2;
                }
                // reallocate texture with same layer count but bigger extent
                this._resizeAndReupload(newW, newH, this.layers);
            }

            // try again after extent growth
            for (let li = 0; li < this.layers; li++) {
                const pos2 = this._tryPlaceRect(li, paddedWidth, paddedHeight);
                if (pos2) {
                    return { layer: li, x: pos2.x, y: pos2.y, willRealloc: false };
                }
            }

            // still not fitting due to fragmentation / filled layers: add one or more layers
            let newLayers = Math.max(this.layers * 2, this.layers + 1);
            this._resizeAndReupload(this.layerWidth, this.layerHeight, newLayers);

            // after adding layers there will be empty layers to place into
            const li = this._firstEmptyLayer();
            const pos3 = this._tryPlaceRect(li, paddedWidth, paddedHeight);
            return { layer: li, x: pos3.x, y: pos3.y, willRealloc: false };
        }

        _firstEmptyLayer() {
            for (let i = 0; i < this.layers; i++) {
                const st = this._layerState[i];
                if ((st.nextY === 0) && st.shelves.length === 0) {
                    return i;
                }
            }
            return 0;
        }

        _resizeAndReupload(newW, newH, newLayers) {
            // keep old entries and repack from scratch
            const oldEntries = this._entries.slice();

            this._createTexture(newW, newH, newLayers);

            // clear packing and pending upload queues
            this._entries.length = 0;
            this._pendingUploads.length = 0;

            // re-place each entry; update uniforms; enqueue for upload
            for (const ent of oldEntries) {
                const pos = this._ensureCapacityFor(ent.w, ent.h);
                ent.layer = pos.layer;
                ent.x = pos.x;
                ent.y = pos.y;

                this._entries.push(ent);
                this._pendingUploads.push({
                    source: ent.source,
                    w: ent.w,
                    h: ent.h,
                    layer: ent.layer,
                    x: ent.x,
                    y: ent.y
                });
            }

            this._metadataDirty = true;
            this.version++;
        }

        _tryPlaceRect(layerIndex, w, h) {
            const W = this.layerWidth;
            const H = this.layerHeight;
            let st = this._layerState[layerIndex];

            if (!st) {
                // todo it happens that the _layerState is empty but plaing called! this is a bug
                $.console.error('TextureAtlas2DArray._tryPlaceRect: invalid layerIndex');
                this._createTexture(W, H, this.layers);
                st = this._layerState[layerIndex];
            }

            // try existing shelves
            for (const shelf of st.shelves) {
                if (h <= shelf.h && shelf.x + w <= W) {
                    const x = shelf.x;
                    const y = shelf.y;
                    shelf.x += w;
                    return { x: x, y: y };
                }
            }

            // start a new shelf
            if (st.nextY + h <= H) {
                const y = st.nextY;
                st.shelves.push({ y: y, h: h, x: w });
                st.nextY += h;
                return { x: 0, y: y };
            }

            return null;
        }

        _uploadSource(source, w, h, layer, x, y) {
            const gl = this.gl;

            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
            const physicalLayer = layer + 1;
            this._uploadSubImage(gl, source, w, h, physicalLayer, x, y);

            // optional: no mipmaps for now (icon UI)
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        }

        _uploadSubImage(gl, source, w, h, physicalLayer, x, y) {
            const isDomImageSource = source instanceof ImageBitmap ||
                (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) ||
                (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement);

            if (isDomImageSource) {
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                try {
                    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, physicalLayer, w, h, 1, this.format, this.type, source);
                } finally {
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                }
                return;
            }

            if (source && source.data && typeof source.width === 'number' && typeof source.height === 'number') {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, physicalLayer, w, h, 1, this.format, this.type, source.data);
                return;
            }

            if (source && (source instanceof Uint8Array || source instanceof Uint8ClampedArray)) {
                gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, physicalLayer, w, h, 1, this.format, this.type, source);
                return;
            }

            throw new Error('Unsupported image source for atlas');
        }

        _metadataRows() {
            return Math.ceil((this.maxIds * 3) / Math.max(this.layerWidth, 1));
        }

        _metadataCoord(linearIndex) {
            return {
                x: linearIndex % this.layerWidth,
                y: Math.floor(linearIndex / this.layerWidth)
            };
        }

        _uploadMetadata(gl) {
            const rows = this._metadataRows();
            if (rows < 1) {
                return;
            }

            const texels = new Uint8Array(this.layerWidth * rows * 4);
            const pack16 = (value) => {
                const safe = Math.max(0, Math.min(65535, Number.parseInt(value, 10) || 0));
                return [safe & 255, (safe >> 8) & 255];
            };

            for (const ent of this._entries) {
                const baseIndex = ent.id * 3;
                const coords = [
                    this._metadataCoord(baseIndex),
                    this._metadataCoord(baseIndex + 1),
                    this._metadataCoord(baseIndex + 2)
                ];
                const texelOffset0 = (coords[0].y * this.layerWidth + coords[0].x) * 4;
                const texelOffset1 = (coords[1].y * this.layerWidth + coords[1].x) * 4;
                const texelOffset2 = (coords[2].y * this.layerWidth + coords[2].x) * 4;
                const x = pack16(ent.x);
                const y = pack16(ent.y);
                const w = pack16(ent.w);
                const h = pack16(ent.h);
                const physicalLayer = pack16(ent.layer + 1);

                texels[texelOffset0 + 0] = x[0];
                texels[texelOffset0 + 1] = x[1];
                texels[texelOffset0 + 2] = y[0];
                texels[texelOffset0 + 3] = y[1];

                texels[texelOffset1 + 0] = w[0];
                texels[texelOffset1 + 1] = w[1];
                texels[texelOffset1 + 2] = h[0];
                texels[texelOffset1 + 3] = h[1];

                texels[texelOffset2 + 0] = physicalLayer[0];
                texels[texelOffset2 + 1] = physicalLayer[1];
                texels[texelOffset2 + 2] = 0;
                texels[texelOffset2 + 3] = 255;
            }

            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, this.layerWidth, rows, 1, this.format, this.type, texels);
        }
    };

})(OpenSeadragon);
