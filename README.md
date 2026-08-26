# Braille Input Engine

Headless six-dot Braille input for a modern browser. The core accepts normalized input actions, maintains one pending Cell, and emits Unicode Braille Patterns `U+2800–U+283F`. It does not translate English, Chinese, numbers, mathematics, music, or other Braille notation.

This is an experimental, community-supported, best-effort project with no SLA. The normal distribution is public GitHub source and optional GitHub Release assets; the package is intentionally private and is not intended for registry distribution.

## Quick start

```sh
npm ci
npm run build
```

```ts
import {
  attachBrailleEditable,
  attachKeyboard,
  createBrailleController,
} from "braille-input-engine/browser";

const target = document.querySelector("textarea");
if (!target) throw new Error("Missing textarea");

const controller = createBrailleController({
  spaceMode: "ascii",
});
const editable = attachBrailleEditable(controller, target);
const keyboard = attachKeyboard(controller, target, { activation: "focus" });

// Detach both attachments and destroy the controller when the host is done.
void editable;
void keyboard;
```

The default keyboard map uses the physical `KeyboardEvent.code` values `F D S J K L` for dots 1–6. The project-specific Numpad map is `Numpad7/4/1 + Numpad8/5/2`; this is not presented as an industry standard. Sequential mode is the default and toggles a dot on repeated selection. Space commits a pending Cell and otherwise follows `spaceMode`; `NumpadEnter` commits only when a Cell is pending.

For an editor such as React, ProseMirror, or CodeMirror, use one synchronous `outputSink` and its official editing API instead of the native editable adapter. A sink is the only transactional writer for a controller. `accepted`, `rejected`, `unhandled`, and `conflicted` have different retry semantics; see `SPECIFICATION.md` §§14–16.

## Browser entry points

- `braille-input-engine` / `braille-input-engine/core`: SSR-safe core and Unicode encoder.
- `braille-input-engine/browser`: browser adapters, default UI, and Web Component.
- `braille-input-engine/adapters`: keyboard, pointer, editable, and activation-group adapters.
- `braille-input-engine/default-ui`: light-DOM default UI and CSS entry `braille-input-engine/default-ui.css`.
- `braille-input-engine/web-component`: `<braille-input>` class and explicit `defineBrailleInput()`.
- `braille-input-engine/auto-register`: the only entry with automatic custom-element registration.

The Web Component can target a same-root native input with `for="id"`, or a same-realm `target` property. It never crosses a Shadow Root implicitly. It uses an external stylesheet; no runtime `<style>`, inline style, remote CDN, telemetry, or content history is added.

## Development

The complete product and compatibility contract is [SPECIFICATION.md](SPECIFICATION.md). Useful local checks are:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:dom
npm run build
npm run test:ssr
npm run test:package
npm run ci:auto
```

The M3 automated suite is intended to run from a clean checkout with Node `24.19.0` and npm `11.17.0`. Brand browser, real assistive technology, physical six-key rollover, mobile-device, and target-user evidence are M4 work and must remain explicitly `pending` until performed on the listed environments.

## License and security

MIT; see [LICENSE](LICENSE). See [SECURITY.md](SECURITY.md) for the supported scope and private-reporting guidance.
