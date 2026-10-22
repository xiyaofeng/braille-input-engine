# Toolchain record

The frozen target toolchain is Node `24.19.0`, npm `11.17.0`, TypeScript `6.0.3`, Vite `8.2.4`, esbuild `0.28.2`, Vitest `4.1.11`, jsdom `30.1.2`, Playwright `1.62.1`, ESLint `10.8.1`, Prettier `3.9.6`, and the exact versions in `package.json`. esbuild is an explicit build-only dependency because Vite 8 declares it as an optional peer for minification.

The complete automated M3 gate has been exercised with Node `24.19.0` and npm `11.17.0`. Packed-package consumers are also verified across Node `22.12.0` and `24.19.0` with TypeScript `5.7.3` and `6.0.3`. The checked-in lockfile, workflow, package matrix, and toolchain checks keep these versions aligned; a release candidate must rerun the same gates from a clean checkout on its exact commit.

The R06 audit remediation pins transitive `source-map-js` to `1.2.2` through a package override for GHSA-68fv-2mgg-jv7q. This is a targeted development-dependency security patch; direct toolchain versions stay frozen. The full automated gate and packed consumer matrix must be rerun after this lockfile change.

The distribution now uses one Vite module graph per ESM/CJS format plus the standalone IIFE, followed by esbuild identifier/whitespace minification. There is no second canonical replacement runtime, property protocol mangling, string alias pass, or unsafe Terser pass. Existing packed diagnostic-message normalization remains unchanged. Tool versions and dependencies are unchanged in this remediation. Different ESM/CJS/IIFE deployments remain separate runtime instances; use one format's entries together, rather than mixing format-specific group/registry objects.

`npm run size` retains reachable-file accounting and per-file deterministic gzip, enforces 16/20/30 KiB caps, and rejects growth over 512 B from the reviewed baseline. `node scripts/measure-consumers.mjs` reports supplementary bundled consumers, direct module graphs, and local compile/evaluation samples; those samples are not browser/network benchmarks. The actual packed consumer gate now executes controllers, rejects DOM/UI retention in the core bundle, and checks shared class/exception/group/target identities within each format. See [ADR-0002](adr/0002-lifecycle-runtime-and-size.md).

Release smoke is a required CI job: `npm run pack:release` followed by `npm run verify:release-asset` on the same clean commit. Both scripts stream the complete Git archive into SHA-256 and require Git to exit successfully. Local `ci:auto` remains usable with uncommitted changes; M3 acceptance additionally requires the clean-commit release smoke and packed consumer matrix. This smoke creates local assets without publishing them.

Declarations use `tsc -p tsconfig.types.json` and `scripts/copy-conditional-types.mjs`; license checks use `scripts/check-licenses.mjs` against the lockfile. Neither vite-plugin-dts nor license-checker-rseidelsohn is installed.

Vite is frozen to `8.2.4`, the compatible 8.2 branch fix for GHSA-587h-7wmj-h5pm (Windows launch-editor path handling). Security thresholds and development-dependency auditing are unchanged. Release smoke executes the exact tgz consumer suite and an isolated static consumer of the actual demo ZIP; hash-consistent broken-asset controls are required in the same CI job.

The exact-tgz consumer suite also executes `auto-register` through ESM and CJS package exports in separate processes with fresh DOM/customElements state. It requires automatic registration, shared component constructor identity, idempotence and actual textarea input, while ordinary entries must leave the default tag unregistered. Release negative controls include both throwing and successfully imported but non-registering auto-register assets in each format.
