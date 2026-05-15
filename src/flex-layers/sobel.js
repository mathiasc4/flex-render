(function($) {
/**
 * Sobel shader
 */
$.FlexRenderer.ShaderLayerRegistry.register(class extends $.FlexRenderer.ShaderLayer {

    static type() {
        return "sobel";
    }

    static name() {
        return "Sobel";
    }

    static description() {
        return "sobel edge detector";
    }

    static docs() {
        return {
            summary: "Sobel edge detector for RGB input.",
            description: "Samples a 3x3 neighborhood, applies Sobel X and Y kernels independently to RGB data, and returns grayscale edge strength with alpha fixed to 1.0.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: [3],
                description: "Data to detect edges on"
            }],
            controls: [
                { name: "use_channel0", default: "rgb" }
            ]
        };
    }

    static sources() {
        return [{
            acceptsChannelCount: (x) => x === 3,
            description: "Data to detect edges on"
        }];
    }

    static get defaultControls() {
        return {
            use_channel0: {  // eslint-disable-line camelcase
                default: "rgb"
            }
        };
    }

    getFragmentShaderExecution() {
        return `
        // Sobel kernel for edge detection
        float kernelX[9] = float[9](-1.0,  0.0,  1.0,
                                    -2.0,  0.0,  2.0,
                                    -1.0,  0.0,  1.0);

        float kernelY[9] = float[9](-1.0, -2.0, -1.0,
                                     0.0,  0.0,  0.0,
                                     1.0,  2.0,  1.0);

        vec3 sumX = vec3(0.0);
        vec3 sumY = vec3(0.0);
        vec2 texelSize = vec2(1.0) / vec2(float(${this.getTextureSize()}.x), float(${this.getTextureSize()}.y));

        // Sampling 3x3 neighborhood
        int idx = 0;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec3 sampleColor = ${this.sampleChannel('v_texture_coords + vec2(float(x), float(y)) * texelSize')};
                sumX += sampleColor * kernelX[idx];
                sumY += sampleColor * kernelY[idx];
                idx++;
            }
        }

        float edgeStrength = length(sumX) + length(sumY);
        return vec4(vec3(edgeStrength), 1.0);
`;
    }
});

})(OpenSeadragon);
