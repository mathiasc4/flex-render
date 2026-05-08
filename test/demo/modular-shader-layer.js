const modularHeatmapConfig = {
    id: "modular_heatmap",
    name: "Modular heatmap",
    type: "modular",
    visible: 1,
    fixed: false,
    tiledImages: [0],
    params: {
        graph: {
            version: 1,
            nodes: {
                src: {
                    type: "sample-channel",
                    params: {
                        sourceIndex: 0,
                        channel: "r"
                    }
                },
                threshold: {
                    type: "threshold-mask",
                    inputs: {
                        value: "src.value"
                    },
                    params: {
                        threshold: 0.5
                    }
                },
                colorize: {
                    type: "colorize",
                    inputs: {
                        value: "src.value",
                        alpha: "threshold.mask"
                    },
                    params: {
                        color: "#fff700"
                    }
                }
            },
            output: "colorize.color"
        }
    },
    cache: {}
};
