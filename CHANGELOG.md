# Changelog

All notable changes are recorded here. The initial alpha is not stable and is not a registry release.

## Unreleased

- Resolve editable focus through accessible open ShadowRoots before delivery and after beforeinput; preserve exact activation-group membership and rejected/conflicted transaction protections.

- Resolve keyboard admission and UI-control exclusion from the same visible event source, preserving default UI actions inside open Shadow DOM with Document listeners. Keep ordinary group input and already tracked key releases working.

- Coordinate guard-rejected pointerup and filter-rejected keyup across shared/nested scopes; preserve callback input, mixed release ownership and frozen retry. Terminal guards/filters run once inside the documented old-event transaction.
- Observe accessible open-root focus boundaries and cross-root activation-group movement with reference-counted listeners; document exact verified conditions and root re-registration requirements.

- Coordinate controller/document lifecycle loss and overlapping pointer scopes; pointer-only and focus-scope consumers now release stale input. Local keyboard cleanup preserves other attachments, and fresh input rounds use independent IDs.
- Preserve notification registration identity and snapshot order for duplicate callbacks; cancel live Chords on disable/configuration changes without discarding frozen retries.
- Use one shared ESM/CJS module graph per format across package entries, fixing split controller/exception/group/editable identities. Remove the replacement packed runtime and unsafe minification pipeline.
- Raise the core-plus-adapters gzip cap to 16 KiB with a reviewed growth baseline; UI/IIFE caps remain 20/30 KiB. See ADR-0002. No public signatures change; generated attachment input IDs are opaque and must not be parsed by consumers.

- Batch shared activation-group teardown per controller, collecting pointer and keyboard inputs before reset so callback-enqueued input survives.
- Preserve rejected Cell contents through activation loss, hidden, default disable, and configuration resets, including custom strategies; explicit discard and strategy fault rules remain enforced.
- Pin the transitive development dependency `source-map-js` to the security patch `1.2.2`.

- Complete pointer cancellation and activation-loss reset in one FIFO operation, preserving new input queued by host callbacks on other attachments.

- Fixed pointer long presses cancelling Sequential dots or duplicating Chord output. Physical clicks are handled by their down/up lifecycle, while independent keyboard, assistive-technology, and programmatic button activations remain available immediately.
- Ignore stale pointer terminal events after release or attachment replacement; cancel live pointer chords without clearing another attachment's pressed inputs.
- Restore custom strategy activation-loss resets on pointer cancellation and keep queued pointer downs tracked across reentrant state notifications.

## 0.1.0 - 2026-08-21

- Implemented the M3 feature-complete alpha target defined in `SPECIFICATION.md`.
- Added headless Unicode, Sequential, Chord, custom-strategy, sink, lifecycle, and diagnostic APIs.
- Added keyboard, Numpad, pointer, native editable, activation-group, default UI, six-key test, and Web Component integrations.
- Added ESM, CommonJS, browser IIFE, declarations, demo, package smoke checks, and CI scaffolding.
- Brand-browser, assistive-technology, real rollover, mobile-device, and target-user evidence remains M4 `pending`.

Breaking changes before 1.0 require an entry here and a migration note.
