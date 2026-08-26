# Toolchain record

The frozen target toolchain is Node `24.19.0`, npm `11.17.0`, TypeScript `6.0.3`, Vite `8.2.2`, esbuild `0.28.2`, Vitest `4.1.11`, jsdom `30.0.1`, Playwright `1.62.1`, ESLint `10.8.1`, Prettier `3.9.6`, and the exact versions in `package.json`. esbuild is an explicit build-only dependency because Vite 8 declares it as an optional peer for minification.

The complete automated M3 gate has been exercised with Node `24.19.0` and npm `11.17.0`. Packed-package consumers are also verified across Node `22.12.0` and `24.19.0` with TypeScript `5.7.3` and `6.0.3`. The checked-in lockfile, workflow, package matrix, and toolchain checks keep these versions aligned; a release candidate must rerun the same gates from a clean checkout on its exact commit.
