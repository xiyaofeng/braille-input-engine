# Third-party license inventory

The published runtime surface has no production dependencies. The development
tooling dependencies are used only to build and test this private source
project, and are not bundled into the local package or demo assets.

`npm run check:licenses` regenerates an in-memory inventory with
`license-checker-rseidelsohn --excludePrivatePackages` and rejects any package
whose SPDX license is outside the fixed allowed license set:
`(MIT AND CC-BY-3.0)`, `0BSD`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`,
`BlueOak-1.0.0`, `CC-BY-3.0`, `CC0-1.0`, `ISC`, `MIT`, `MIT-0`, `MPL-2.0`, and
`Python-2.0`. The checker also requires package path and license metadata for
every discovered dependency. The runtime package is distributed under the MIT
License in `LICENSE`.
