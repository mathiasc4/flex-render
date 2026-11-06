# Styling Control UI

This document explains how to style FlexRenderer control UI and what responsibilities stay with the host application.

The short version:

- FlexRenderer generates control markup
- your application decides where that markup is mounted
- your application owns the surrounding layout, theme, spacing, typography, and framework integration
- `--er` is just a simple host-side tint variable you can use to make parts of the UI red

## What FlexRenderer Owns

FlexRenderer can generate native HTML controls for shader parameters when `htmlHandler(...)` is enabled.

The renderer itself is responsible for:

- generating control markup from shader control definitions
- rebuilding that markup when the second-pass program is rebuilt
- calling `htmlReset()` before re-mounting controls

It is not responsible for:

- page layout
- card/accordion/sidebar structure
- framework-specific form styling
- design system integration
- navigator synchronization

If you want the control UI to look like your product, you should treat FlexRenderer output as renderer-native form content mounted inside your own container.

## Main Integration Points

### `htmlHandler(shaderLayer, shaderConfig, htmlContext)`

This callback decides where controls are mounted.

Typical use:

```js
drawerOptions: {
    "flex-renderer": {
        htmlHandler: (shaderLayer, shaderConfig) => {
            const mount = document.getElementById("shader-ui");
            if (!mount) {
                return;
            }

            mount.insertAdjacentHTML("beforeend", `
                <section class="my-shader-card">
                    <header class="my-shader-card__header">
                        <h3>${shaderConfig.name || shaderConfig.type}</h3>
                    </header>
                    <div class="my-shader-card__body">
                        ${shaderLayer.htmlControls()}
                    </div>
                </section>
            `);
        },
        htmlReset: () => {
            const mount = document.getElementById("shader-ui");
            if (mount) {
                mount.innerHTML = "";
            }
        }
    }
}
```

`htmlHandler(...)` is where you decide:

- one container per shader or a flat list
- tabs, cards, accordions, drawers, sidebars, modals
- whether shader title, status, and help text are shown around the controls

### `shaderLayer.htmlControls(wrapper, classes, css, options)`

This returns the renderer-native control markup for a single shader.

Arguments:

- `wrapper`
  Optional function applied to each generated control block.
- `classes`
  Extra class string passed through to each control root (`.er-control`).
- `css`
  Extra inline CSS string passed through to the main interactive element or control widget.
- `options.inputClasses`
  Per-call input classes, see [Input classes](#input-classes).

The same arguments can be passed as one object:
`htmlControls({wrapper, classes, css, inputClasses})`.

Example:

```js
const html = shaderLayer.htmlControls(
    inner => `<div class="my-control-row">${inner}</div>`,
    "my-control-root",
    "font-size: 0.875rem;"
);

// object form
const compact = shaderLayer.htmlControls({
    wrapper: inner => `<div class="my-control-row">${inner}</div>`,
    classes: "my-control-root",
    inputClasses: { number: "form-control form-control-sm" }
});
```

Use this when you need:

- consistent wrapper structure around each control
- root-level selector hooks via `classes`
- small per-control widget overrides via `css`
- framework classes on the emitted inputs via `inputClasses`

Each control's `toHtml(classes, css, options)` takes the same three trailing arguments,
so a host rendering a single control directly gets the same hooks.

### Input classes

Every emitted input and button carries its BEM classes (`er-control__input er-control__input--<type>`,
`er-control__button ...`) plus a per-role default class string. The defaults target DaisyUI:

| Role | Element | Default classes |
| --- | --- | --- |
| `number` | number input | `input input-bordered input-sm` |
| `range` | range input | `range range-sm` |
| `color` | color input | *(none)* |
| `bool` | checkbox | `checkbox checkbox-sm` |
| `select` | select | `select select-bordered select-sm` |
| `colormap` | colormap select | `select select-bordered select-sm` |
| `textarea` | textarea | `textarea textarea-bordered textarea-sm` |
| `button` | `button` control | `btn btn-sm btn-outline` |
| `image-number` | image id input | `input input-bordered input-sm` |
| `image-file` | image file input | `file-input file-input-bordered file-input-sm` |
| `image-upload` | image upload button | `btn btn-sm btn-outline` |
| `icon-trigger` | icon picker trigger | `btn btn-square btn-outline` |
| `icon-close` | icon popup close | `btn btn-ghost btn-xs btn-circle` |
| `icon-query` | icon search input | `input input-bordered input-sm` |

Per call, `options.inputClasses` adjusts them:

- a string is appended to every role's default: `inputClasses: "my-input"`
- an object replaces the default of the roles it names: `inputClasses: { number: "form-control" }`;
  `null` or `""` for a role clears it; roles not named keep their default

Globally, `OpenSeadragon.FlexRenderer.UIControls`:

- `inputClassDefaults` returns a copy of the current map
- `setInputClassDefaults(map)` merges into it; `setInputClassDefaults(map, { merge: false })` replaces it
- `setInputClassDefaults(null)` clears every role to `""`: **do this on hosts that do not use DaisyUI**,
  so only the BEM classes remain
- `resolveInputClasses(role, inputClasses)` returns the classes a role resolves to

## Renderer Control Classes

Renderer-native controls now expose only renderer-specific hook classes.

Removed:

- `text-white-shadow`
- `form-control`

The goal is that host applications style controls through stable renderer classes instead of inheriting opinionated utility or framework classes from the library. The one exception is the per-role input classes (DaisyUI by default), which are configurable and can be cleared entirely — see [Input classes](#input-classes).

### Shared classes

These are the main stable hooks:

- `.er-control`
  Root element of one control row.
- `.er-control--<type>`
  Type-specific modifier on the root.
- `.er-control__title`
  Title/label element when a title is present.
- `.er-control__title--<type>`
  Type-specific modifier on the title element.
- `.er-control__body`
  Wrapper around the actual control widget.
- `.er-control__body--<type>`
  Type-specific modifier on the body wrapper.
- `.er-control__input`
  Base class for input/select/textarea elements emitted by the renderer.
- `.er-control__button`
  Base class for emitted buttons.
- `.er-control__display`
  Base class for non-input display widgets.
- `.er-control__widget`
  Base class for custom widget containers.
- `.er-control__aux`
  Second content column of a three-column control (the number input of `range_input`).

### Type-specific modifiers

Simple controls:

- `.er-control--number`
- `.er-control--range`
- `.er-control--color`
- `.er-control--bool`
- `.er-control--select`
- `.er-control--slider-with-input`

Simple control input elements:

- `.er-control__input--number`
- `.er-control__input--range`
- `.er-control__input--color`
- `.er-control__input--bool`
- `.er-control__input--select`

Composite helper (`range_input`): the root `.er-control--slider-with-input` holds the range in
`.er-control__body--slider-with-input` and the number input in `.er-control__aux--slider-with-input`.
Each of those wraps a nested, title-less `.er-control--range` / `.er-control--number` row; the
`classes` argument lands only on the outer root.

- `.er-control__body--slider-with-input`
- `.er-control__aux--slider-with-input`

Advanced controls:

- `.er-control--colormap`
- `.er-control--custom-colormap`
- `.er-control--advanced-slider`
- `.er-control--text-area`
- `.er-control--button`
- `.er-control--image`
- `.er-control--icon`

Advanced control elements:

- `.er-control__input--colormap`
- `.er-control__colormap-preview` (gradient strip under the interactive colormap select)
- `.er-control__display--colormap`
- `.er-control__display--custom-colormap`
- `.er-control__widget--advanced-slider`
- `.er-control__input--textarea`
- `.er-control__button--action`
- `.er-control__widget--image`
- `.er-control__hint--image`
- `.er-control__row--image-number`
- `.er-control__input--image-number`
- `.er-control__input--image-file`
- `.er-control__button--image-upload`
- `.er-control__widget--icon`
- `.er-control__toolbar--icon`
- `.er-control__button--icon-trigger`
- `.er-control__preview--icon`
- `.er-control__popup--icon`
- `.er-control__popup-header--icon`
- `.er-control__popup-title--icon`
- `.er-control__button--icon-close`
- `.er-control__search--icon`
- `.er-control__input--icon-query`
- `.er-control__input--icon-color`
- `.er-control__color-mode` (the "tint" badge)
- `.er-control__results--icon`

The icon control renders its glyphs onto a `<canvas>`, so its colors come from
the control's own color input rather than from CSS. What the host page *does*
own is the icon font itself: FlexRenderer bundles no webfont, and the Phosphor
and Font Awesome sets render only once the page loads the corresponding font.
See "Icon Fonts" in [README.md](README.md#icon-fonts) for the set/font table and
the stylesheet links. The default `html-glyphs` set needs no font at all.

### Required stylesheet: `assets/ui.controls.css`

The host page must include `assets/ui.controls.css`. Besides the row/column grid it carries
the rules that make some controls display their state at all — the renderer no longer writes
those as inline styles:

| Hook | Set by | Default rule in `ui.controls.css` |
| --- | --- | --- |
| `--er-colormap` (custom property) | `colormap` / `custom_colormap`, on the `.er-control` root (or the display node when mounted without one) | read as `background-image` by `.er-control__colormap-preview`, `.er-control__display--colormap`, `.er-control__display--custom-colormap` |
| `.er-control__colormap-preview` | interactive `colormap` (sibling of the select) | thin gradient strip under the select |
| `.er-slider__connect--active` | `advanced_slider`, on each `.noUi-connect` interval whose mask is on (off, when `inverted`) | `background: var(--er-slider-connect-active, var(--er, #c62828))` |
| `--er-slider-connect-active` (custom property) | host | color of active slider intervals |
| `.er-control--button > .er-control__body` | — | right-aligns the button |

Without the stylesheet the colormap gradient and the active slider intervals are invisible.
To restyle them, override these rules, e.g.:

```css
#shader-ui .er-control__colormap-preview { height: .75rem; }
#shader-ui { --er-slider-connect-active: #1565c0; }
```

The `button` control renders its title as the button label: there is no
`.er-control__title` span on `.er-control--button`, and the root always has `data-columns="1"`.

## Localization

Controls that emit their own text (`image`, `icon`) translate it through one hook:

```js
OpenSeadragon.FlexRenderer.UIControls.setTranslator((key, fallback, vars) => {
    return myI18n.exists(key) ? myI18n.t(key, vars) : fallback;
});
```

- the translator is called as `fn(key, fallback, vars)`; a non-string return value falls back to the
  English default, and a translator that throws is reported with `console.warn` and falls back too
- `setTranslator(null)` removes it
- per control, `params.strings` (a `{ key: "text" }` map in the control config) wins over the translator
- `{name}` placeholders in the result are substituted from `vars`
- translated text is HTML-escaped before it is inserted into the markup
- `UIControls.t(key, fallback, vars, overrides)` and `control.t(key, fallback, vars)` are available
  to custom controls

| Key | English default |
| --- | --- |
| `image.hint` | The atlas starts empty. Upload an image to create a new atlas entry. |
| `image.selected` | Selected: |
| `image.upload` | Upload Image |
| `image.noFile` | No file selected (upload clicked without a file; shown with `alert`) |
| `icon.pickerTitle` | Icon picker |
| `icon.close` | Close (aria-label of the popup close button) |
| `icon.searchPlaceholder` | Search icons, aliases, glyphs |
| `icon.color` | Icon color (color input tooltip) |
| `icon.tintColor` | Tint color (applied over original colors) |
| `icon.tintBadge` | tint |
| `icon.unknown` | Unknown icon (preview tooltip) |

Control titles come from the shader configuration (`title`) and are not passed through the translator.

Example config override:

```js
params: {
    overlay: { type: "image", title: "Obrázky", strings: { "image.upload": "Nahrát obrázek" } }
}
```

Keys starting with `_` in a shader configuration (e.g. `_controls`) are renderer-owned instance
state: `FlexRenderer.jsonReplacer` strips them on export and the published schema rejects them, so
do not put UI configuration there.

### Suggested styling pattern

Use the base classes for broad styling and the modifiers for exceptions.

Example:

```css
.renderer-controls .er-control {
    display: grid;
    grid-template-columns: minmax(8rem, auto) minmax(0, 1fr);
    gap: 0.5rem 0.75rem;
    align-items: center;
}

.renderer-controls .er-control__title {
    font-size: 0.9rem;
}

.renderer-controls .er-control__input,
.renderer-controls .er-control__button,
.renderer-controls .er-control__display {
    font: inherit;
}

.renderer-controls .er-control--bool,
.renderer-controls .er-control--button {
    grid-template-columns: minmax(0, 1fr);
}

.renderer-controls .er-control__input--range {
    width: 100%;
}

.renderer-controls .er-control__display--colormap,
.renderer-controls .er-control__display--custom-colormap {
    min-height: 1.75rem;
    border-radius: 0.375rem;
}
```

## About `--er`

There is no special renderer-wide CSS variable contract here.

`--er` is just a host-side variable you use to tint UI red. It is not a formal FlexRenderer API and it is not meant to describe the entire control theme.

`--er` holds a complete CSS color (`#c62828`, `oklch(55% .2 27)`, ...). The renderer no longer
wraps it in `oklch(...)`: its only use inside `ui.controls.css` is as the fallback color of active
`advanced_slider` intervals (`var(--er-slider-connect-active, var(--er, #c62828))`).

Example:

```css
.renderer-controls {
    --er: #c62828;
}

.renderer-controls .is-warning,
.renderer-controls .is-accent {
    color: var(--er);
}

.renderer-controls input:focus,
.renderer-controls select:focus {
    outline-color: var(--er);
}
```

Use `--er` only where a red tint is useful. Everything else should be styled with your normal app CSS, utility classes, or design-system tokens.

## What Users Usually Want To Customize

Most applications will want to adjust:

- overall container width and vertical rhythm
- typography to match the main app
- control density for compact sidebars vs spacious panels
- error and helper text treatment
- slider width and label alignment
- spacing between shader sections
- dark/light theme behavior
- mobile stacking behavior

The renderer does not know your app constraints, so these choices should be made in `htmlHandler(...)` and your host CSS.

## Practical Guidelines

### Scope styles to the control mount

Do not style all inputs globally just to affect renderer controls.

Prefer:

```css
#shader-ui,
#shader-ui * {
    box-sizing: border-box;
}

#shader-ui input,
#shader-ui select {
    font: inherit;
}
```

Avoid:

```css
input, select, textarea {
    /* affects the whole app */
}
```

### Expect remounts

The renderer can rebuild the second-pass program and regenerate controls.

That means:

- `htmlReset()` should remove previous content cleanly
- custom event listeners attached outside renderer-generated markup should be resilient to remounting
- DOM references into individual controls should not be assumed stable across rebuilds

### Wrap, do not rewrite

If renderer-native controls already expose the correct behavior, prefer wrapping them with your own container markup instead of replacing them with custom duplicated controls.

Good:

```js
shaderLayer.htmlControls(html => `<div class="field-row">${html}</div>`);
```

Risky:

- reimplementing the same control behavior separately in app code
- creating duplicate controls that drift from shader config state

### Use `classes` and `css` for local adaptation

If one mount needs a compact or embedded version of the controls, use:

- `classes` for selector hooks
- `css` for localized inline widget styling

Example:

```js
shaderLayer.htmlControls(
    html => `<div class="field-row field-row--compact">${html}</div>`,
    "my-control-root my-control-root--compact",
    "font-size: 0.875rem;"
);
```

### Keep app chrome outside renderer-native controls

Recommended split:

- application owns section headers, drag handles, collapse state, help icons, badges, presets, reset buttons
- renderer owns the actual parameter controls generated from shader definitions

This keeps renderer upgrades easier and makes backend parity simpler.

## Framework Integration

### Utility CSS frameworks

If you use Tailwind, DaisyUI, Bootstrap, or similar:

- let the framework style the outer shells you build in `htmlHandler(...)`
- use wrapper classes around `shaderLayer.htmlControls(...)`
- emitted inputs carry DaisyUI classes by default (see [Input classes](#input-classes)); with another
  framework, call `UIControls.setInputClassDefaults(null)` once and map your own classes per role
  via `setInputClassDefaults({...})` or `htmlControls({ inputClasses })`

### Component frameworks

If your app uses React, Vue, Svelte, or another component framework:

- mount renderer-native controls into a DOM node owned by the framework
- treat the native control subtree as an imperative island
- keep framework state for surrounding UI, not for every renderer-generated input unless you intentionally replace the control surface

## Accessibility And UX Notes

When adjusting the UI, keep these in mind:

- preserve readable labels and adequate contrast
- do not collapse slider labels or numeric fields so aggressively that values become unclear
- ensure keyboard focus remains visible after theme overrides
- test narrow sidebars and mobile layouts if controls can appear there
- if you visually hide titles or descriptions, keep enough context so users still know which shader they are editing

## Suggested Pattern

Use this as the default mental model:

1. create one scoped mount container for renderer controls, and include `assets/ui.controls.css`
2. optionally define `--er` on that mount if you want the red tint hook
3. build your own section/card layout in `htmlHandler(...)`
4. insert `shaderLayer.htmlControls(...)` inside those sections
5. cleanly clear the mount in `htmlReset()`

That gives you a stable renderer integration without coupling your app to a specific backend implementation.
