/* global QUnit, OpenSeadragon */

/**
 * `use_mode: "clip"` rendered exactly like a plain blend layer.
 *
 * The stack composer decided clip-ness from `shaderLayer._mode`, a field nothing assigns:
 * `resetMode()` stores the resolved mode in `_compositionMode` and exposes it through `mode`.
 * Every clip layer therefore took the non-clip branch and blended against the accumulated colour
 * of the whole stack beneath it instead of only the nearest visible non-clip layer.
 *
 * The legacy names drifted apart as well: the runtime aliased `mask_clip` while the supported
 * list (and the published schema) carried `clip_mask`, so one validated but never clipped and the
 * other clipped but failed validation. Both now resolve to `clip`.
 */
(function() {

    const SIZE = 4;

    function layer(id, mode, cache = {}) {
        return {
            id: id,
            name: id,
            type: "identity",
            visible: 1,
            tiledImages: [0],
            params: { use_mode: mode }, // eslint-disable-line camelcase
            cache: cache
        };
    }

    async function composeStack(config) {
        const runtime = OpenSeadragon.makeStandaloneFlexRenderer({
            uniqueId: `clipmode_${Math.floor(Math.random() * 1e9)}`,
            width: SIZE,
            height: SIZE
        });
        try {
            const renderer = runtime.renderer;
            await runtime.overrideConfigureAll(config);
            const all = renderer.getAllShaders();
            const stack = renderer.backend.composeShaderLayerStack(all, renderer.getShaderLayerOrder());
            const shaders = {};
            for (const [id, shader] of Object.entries(all)) {
                shaders[id] = { uid: shader.uid, mode: shader.mode, cachedMode: shader.cache.use_mode };
            }
            return { shaders, source: stack.definition };
        } finally {
            runtime.destroy();
        }
    }

    QUnit.module('ClipMode');

    for (const mode of ["clip", "mask_clip", "clip_mask"]) {
        QUnit.test(`use_mode "${mode}" composes as a clip layer`, async function(assert) {
            const { shaders, source } = await composeStack({
                base: layer("base", "show"),
                top: layer("top", mode)
            });
            const top = shaders.top;

            assert.strictEqual(top.mode, "clip", `"${mode}" resolves to clip`);
            assert.ok(source.indexOf(`// ${top.uid} - clipping`) !== -1,
                "the clip layer takes the clipping branch");
            assert.ok(source.indexOf(`intermediate_color = ${top.uid}_blend_func(clip_color, intermediate_color);`) !== -1,
                "and blends only into the target layer's colour, not the accumulated stack");
            assert.ok(source.indexOf(`// ${shaders.base.uid} - blending`) !== -1,
                "the target stays an ordinary layer");
        });
    }

    // Older builds stored "clip_mask" verbatim in the persisted cache, and the cache wins over
    // params on load, so the alias must apply to the cached value too.
    QUnit.test('a legacy mode persisted in the cache resolves and is normalised', async function(assert) {
        const { shaders, source } = await composeStack({
            base: layer("base", "show"),
            top: layer("top", "clip_mask", { use_mode: "clip_mask" }) // eslint-disable-line camelcase
        });

        assert.strictEqual(shaders.top.mode, "clip", "cached clip_mask resolves to clip");
        assert.strictEqual(shaders.top.cachedMode, "clip", "and the cache is rewritten to the canonical name");
        assert.ok(source.indexOf(`// ${shaders.top.uid} - clipping`) !== -1, "the layer clips");
    });

    QUnit.test('a clip layer with nothing beneath it is skipped', async function(assert) {
        const { shaders, source } = await composeStack({
            top: layer("top", "clip")
        });

        assert.ok(source.indexOf(`// ${shaders.top.uid} - Clip skipped`) !== -1,
            "no visible non-clip target, so no clip code is emitted");
    });

})();
