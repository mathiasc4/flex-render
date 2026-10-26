(function($) {

    /**
     * Blank layer that takes almost no memory and current renderer skips it.
     */
    class BlankTileSource extends $.TileSource {
        supports(data, url) {
            return (data && data.type === "_blank") || (url && url.type === "_blank");
        }

        configure(options, _dataUrl, _postData) {
            return $.extend(options, {
                width: 512,
                height: 512,
                tileSize: 512,
                tileOverlap: 0,
                minLevel: 0,
                maxLevel: 0,
            });
        }

        getTileUrl(level, x, y) {
            return "_blank";
        }

        downloadTileStart(context) {
            return context.finish("_blank", undefined, "undefined");
        }
    }

    $.BlankTileSource = BlankTileSource;

})(OpenSeadragon);
