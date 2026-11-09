/* global QUnit, OpenSeadragon */

/**
 * The second pass must fit the fragment uniform budget of a phone.
 *
 * The per-instance arrays (u_instanceOffsets, u_instanceTextureIndexes, u_shaderVariables, u_tiInfo)
 * used to be a fixed 64 elements each. Every array element costs a full uniform vector, so those four
 * alone were 256 vectors -- the whole MAX_FRAGMENT_UNIFORM_VECTORS of a typical mobile GPU -- and the
 * program failed to link even for the single identity layer of the runtime self-test, aborting the
 * host application. Desktop GPUs report 1024+, so nothing in development ever noticed.
 *
 * These tests measure the GLSL actually built against the GLES3 minimum of 224, independent of the
 * GPU the suite happens to run on.
 */
(function() {

    const SIZE = 4;
    const GLES3_MIN_FRAGMENT_UNIFORM_VECTORS = 224;

    function identity(id) {
        return {
            id: id, name: id, type: "identity", visible: 1, tiledImages: [0], params: {}, cache: {}
        };
    }

    function estimateSecondPass(renderer) {
        const program = renderer.getProgram(renderer.backend.secondPassProgramKey);
        return OpenSeadragon.FlexRenderer.WebGLImplementation
            .estimateFragmentUniformVectors(program.fragmentShader);
    }

    function describe(estimate) {
        return estimate.items.slice(0, 6)
            .map(item => `${item.vectors} ${item.name}`)
            .join(", ");
    }

    async function withRuntime(config, fn) {
        const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `uniformbudget_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });
        try {
            await runtime.overrideConfigureAll(config);
            return await fn(runtime);
        } finally {
            runtime.destroy();
        }
    }

    QUnit.module('UniformBudget');

    QUnit.test('the self-test layer fits the GLES3 minimum budget', async function(assert) {
        await withRuntime({ selftest_layer: identity("selftest_layer") }, runtime => {
            const program = runtime.renderer.getProgram(runtime.renderer.backend.secondPassProgramKey);
            const estimate = estimateSecondPass(runtime.renderer);

            assert.ok(estimate.total > 0, `the estimator found the uniform declarations (${estimate.total})`);
            assert.ok(estimate.total <= GLES3_MIN_FRAGMENT_UNIFORM_VECTORS,
                `~${estimate.total} vectors <= ${GLES3_MIN_FRAGMENT_UNIFORM_VECTORS} (${describe(estimate)})`);
            assert.ok(program._uInstanceSlots < 16,
                `per-instance arrays are sized to demand, not a fixed upper bound (${program._uInstanceSlots})`);
        });
    });

    QUnit.test('a realistic multi-layer scene fits the GLES3 minimum budget', async function(assert) {
        const config = {
            heat: {
                id: "heat", name: "heat", type: "heatmap", visible: 1, tiledImages: [0],
                params: { use_channel0: "r", threshold: 10 }, cache: {}
            },
            map: {
                id: "map", name: "map", type: "colormap", visible: 1, tiledImages: [0],
                params: { use_channel0: "r", color: { type: "colormap", default: "YlOrRd" } },
                cache: {}
            },
            thr: {
                id: "thr", name: "thr", type: "threshold", visible: 1, tiledImages: [0],
                params: { use_channel0: "r" }, cache: {}
            },
            pat: {
                id: "pat", name: "pat", type: "patternmap", visible: 1, tiledImages: [0],
                params: { use_channel0: "r" }, cache: {}
            }
        };
        for (const id of ["i0", "i1", "i2", "i3"]) {
            config[id] = identity(id);
        }

        await withRuntime(config, runtime => {
            assert.equal(runtime.renderer.getShaderLayerOrder().length, 8, "eight layers are configured");
            const estimate = estimateSecondPass(runtime.renderer);
            assert.ok(estimate.total <= GLES3_MIN_FRAGMENT_UNIFORM_VECTORS,
                `~${estimate.total} vectors <= ${GLES3_MIN_FRAGMENT_UNIFORM_VECTORS} (${describe(estimate)})`);
        });
    });

})();
