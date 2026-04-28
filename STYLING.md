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

### `shaderLayer.htmlControls(wrapper, classes, css)`

This returns the renderer-native control markup for a single shader.

Arguments:

- `wrapper`
  Optional function applied to each generated control block.
- `classes`
  Extra class string passed through to each control root.
- `css`
  Extra inline CSS string passed through to the main interactive element or control widget.

Example:

```js
const html = shaderLayer.htmlControls(
    inner => `<div class="my-control-row">${inner}</div>`,
    "my-control-root",
    "font-size: 0.875rem;"
);
```

Use this when you need:

- consistent wrapper structure around each control
- root-level selector hooks via `classes`
- small per-control widget overrides via `css`

## Renderer Control Classes

Renderer-native controls now expose only renderer-specific hook classes.

Removed:

- `text-white-shadow`
- `form-control`

The goal is that host applications style controls through stable renderer classes instead of inheriting opinionated utility or framework classes from the library.

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
- `.er-control__group`
  Base class for multi-part controls rendered inside a single control row.

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

Composite helper:

- `.er-control__group`
- `.er-control__group--slider-with-input`

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
- `.er-control__button--icon-close`
- `.er-control__search--icon`
- `.er-control__input--icon-query`
- `.er-control__color-picker--icon`
- `.er-control__input--icon-color`
- `.er-control__results--icon`

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
- avoid assuming the renderer outputs framework-specific classes internally

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

1. create one scoped mount container for renderer controls
2. optionally define `--er` on that mount if you want the red tint hook
3. build your own section/card layout in `htmlHandler(...)`
4. insert `shaderLayer.htmlControls(...)` inside those sections
5. cleanly clear the mount in `htmlReset()`

That gives you a stable renderer integration without coupling your app to a specific backend implementation.
