# ADR-0002: Lifecycle coordination, shared runtime, and measured size budget

Status: accepted for local remediation, 2026-10-07. No release or milestone advancement.

## Problem

Independent controller operations cannot coordinate one DOM event that fans out through multiple attachments. Each later listener can reset a newly queued round. Group-only batching left document/window and overlapping pointer scopes outside the boundary. Function equality also cannot identify an individual subscription. Correctness needs explicit lifecycle participants and registration identity, independent of byte optimizations.

The former build generated a Vite graph, then replaced core/adapters entries with a second monolithic runtime. The replacement and browser/UI graph had different controller classes, exceptions, activation-group maps and editable registries. A Unicode-only bundler test could not establish controller isolation or cross-entry compatibility. Aggressive private-property mangling, string rewriting and unsafe compression made maintenance harder; the previous 10 KiB cap had only 2 B remaining.

## Decision

Use one Vite module graph for each alternative ESM and CJS deployment, plus standalone IIFE. Let the bundler share modules and esbuild perform ordinary identifier/syntax/whitespace minification. Remove the replacement bundle, manual adapter grouping, unsafe Terser stage and private-protocol mangling. Keep existing packed diagnostic normalization and all runtime validations. Do not change notification, ordering or copying semantics for size.

Within a format, root/core/browser/adapters/UI share controller, exception, group and target identities. Packed tests assert this and exercise both ESM and CJS. ESM, CJS and IIFE are alternative deployments, not a new promise of one shared registry across simultaneously loaded formats or multiple installed package copies.

Raise only the core + all unstyled adapters hard cap to **16 KiB (16,384 B)**. Keep UI JS+CSS at 20 KiB and IIFE at 30 KiB. Record reviewed values in `docs/size-baseline.json`; an increase exceeding 512 B requires explicit evidence and a reviewed baseline update, even below the hard cap.

## Evidence and accounting

All hard-gate measurements traverse the actual reachable distribution graph, count each file once, and sum each file's gzip size (level 9, mtime 0). CSS is included in UI, maps/types are excluded. No shared chunk is hidden or combined into a fictitious single-file gate.

| Same gate and accounting                              | Core + adapters | UI including CSS |     IIFE |
| ----------------------------------------------------- | --------------: | ---------------: | -------: |
| Initial uncommitted workspace, rebuilt                |        10,238 B |         11,999 B | 17,621 B |
| Final correctness source with original build pipeline |        10,825 B |         12,632 B | 18,280 B |
| Final shared graph and ordinary minifier              |        13,572 B |          8,566 B | 18,280 B |
| Hard cap after this ADR                               |        16,384 B |         20,480 B | 30,720 B |

The original-pipeline comparison is an isolated rebuild of the final source with the saved initial build scripts, not the final gate artifact. Keeping 10 KiB would require removing another 585 B even with the duplicate runtime and aggressive compression retained. The shared graph costs 2,747 B over that pipeline but fixes observable identity/registry failures and removes a specialized optimizer. A 14 KiB cap would leave only 764 B; 16 KiB leaves 2,812 B (17.2% of the cap) for maintenance. The 512 B increment rule prevents consuming that reserve silently.

Supplementary bundler consumers retain the selected API exports and bundle the shipped ESM with pinned esbuild. They do not replace the hard gate:

| Consumer (bundled gzip)                              |   Before |    After |
| ---------------------------------------------------- | -------: | -------: |
| Unicode                                              |    648 B |    411 B |
| Creates, dispatches, commits and destroys controller |  4,935 B |  5,523 B |
| Controller + keyboard exports                        |  6,897 B |  7,963 B |
| Controller + pointer exports                         |  5,929 B |  7,201 B |
| Core + all adapters                                  | 10,499 B | 11,743 B |
| Controller + default UI + CSS                        | 10,887 B | 12,071 B |
| IIFE                                                 | 17,621 B | 18,280 B |

Without a consumer bundler, root/core import loads the controller graph rather than the old all-adapters monolith: the `/core` reachable graph falls from 10,091 to 6,329 B. Keyboard and pointer use the same public `/adapters` entry, so direct module loading still includes all its exports; consumer bundlers remove unused adapters. No new subpath API is introduced. The directly loaded controller + UI graph falls from 22,090 to 14,284 B by avoiding the duplicate runtime. The legacy UI gate measures UI with a host-supplied controller; this supplementary whole-consumer measurement states the distinction explicitly.

The existing browser performance protocol is unchanged: 200 warmups, five rounds of 1,000 actions. Before/after state p95 is approximately 0.1 ms in every round; UI paint p95 ranges 16.2–17.0 ms before and 16.2–17.7 ms after. Both have zero attributed action long tasks and zero listener/target registry leaks over 100 lifecycle cycles. These are local automated measurements, not physical-device evidence.

Supplementary Node VM measurements use 5 warmups and 25 samples, fresh contexts and unique compilation source comments. Controller compile medians are about 0.186/0.186 ms and execute medians 0.623/0.624 ms before/after. They expose local parse/evaluation cost, not network latency, a browser loading claim, or a statistically established speedup. Transfer cost is represented by the complete reachable graph and per-consumer gzip measurements.

## Verification and consequences

Formal lifecycle fixtures run in source JSDOM and ESM/browser/IIFE under three browser engines; the unpacked tarball runs ESM/CJS identity, lifecycle, frozen-retry and generated model sequences. The core package gate now actually creates and uses a controller and rejects retained DOM/UI strings as well as checking Unicode. Generated property tests use an independent set model, fixed seeds, shrinking and persisted counterexamples. Mutation checks must fail on repeated cleanup, wrong disposer identity and Chord resurrection.

Run `npm run ci:auto`, `npm run test:package:matrix`, `node scripts/measure-consumers.mjs` and `npm run size` on subsequent candidates. Review changes to the gate, baseline and consumer fixtures together. Detailed run logs, source/artifact hashes and machine-specific timings belong in local audit evidence; they are not published as a device qualification claim. M4 real OS blur, touch/pen, assistive-technology and target-user verification remains pending.

## 2026-10-12 branch/root follow-up

The independent review found that terminal coordination excluded guard-rejected pointerup and that Document-only focus handling missed open-root exits. The follow-up coordinates actual cancellation branches (including filter-rejected keyup), reserves the old event before invoking host guards, and registers root listeners with independent ownership tokens. Document lifecycle and focus participants share a registry; root membership and event delivery assumptions are listed in `../lifecycle-coverage.md`. Normal allowed ups, per-attachment pressed ownership, frozen retry and next-round output remain explicit tests. Guard/filter sibling interleaving is now specified as one synchronous old-event batch, with callback dispatch after cancellation/release.

The fixed reachable-file gate and `docs/size-baseline.json` are unchanged. Current measurements: core + adapters **14,084 B** (+512), UI including CSS **9,042 B** (+476), IIFE **18,749 B** (+469), under the unchanged 16/20/30 KiB caps and the existing maximum 512 B growth rule. Shared lifecycle cleanup and root ownership remove duplicated implementation; no validation, diagnostic, snapshot rule or correctness branch was removed for size. The original baseline remains the reviewed comparison, rather than being automatically raised.

New branch/root fixtures run in source JSDOM, three browser engines across source/ESM/browser/IIFE, and actual tarball ESM/CJS consumers. Trusted mouse/keyboard, real focus transitions and native mouse capture are separate browser checks. Four isolated mutants restore unbatched pointerup, unbatched keyup, document-only focus and retargeted focus respectively; detected contract assertion failures are distinct from build failures. See the bounded coverage table; neither these mutations nor automated focus qualifies M4 physical-device/OS/AT behavior.

## 2026-10-17 UI exclusion follow-up

Keyboard admission and UI-control exclusion now consume one resolved visible source. The default renderer is unchanged; Document listeners no longer confuse a control's shadow host with the control itself. Existing owned-key releases remain on the terminal path. Real default UI controls, ordinary group input and the actual extracted ESM/CJS package are covered together; see `../lifecycle-coverage.md`.

Reachable-file gzip is core + adapters **14,074 B** (+502 against the reviewed baseline), UI including CSS **9,042 B** (+476), and IIFE **18,743 B** (+463). The baseline, 512 B growth threshold, build pipeline and 16/20/30 KiB hard caps remain unchanged. Resolving the source once reduces duplicated work; no correctness branch was removed for size.
