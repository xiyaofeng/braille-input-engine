# Deployment

This project does not require a backend server or a registry account. The demo
does require a static HTTP server (or the Vite commands below); opening the
TypeScript source page directly as `file://` is not a supported run mode.
From a clone:

```sh
npm ci
npm run build
npm run build:demo
```

For local browser testing, use the Vite entry points instead of opening
`demo/index.html` as a `file://` URL. The source demo imports TypeScript
modules and is intended to run through Vite:

```sh
npm run dev
# open http://127.0.0.1:5173/
```

To test the exact built static artifact:

```sh
npm run build:demo
npm run preview:demo
# open http://127.0.0.1:4173/
```

Host `dist/demo/` on any static web server. The browser bundle and `default-ui.css` are local build artifacts; no CDN or remote runtime dependency is required.

For a local tarball, run `npm run build` and `npm pack`, then install the generated `.tgz` from the consuming project. The package is marked `private` by design; do not treat the local tarball command as permission to create a registry release.

The Web Component is explicit:

```html
<link rel="stylesheet" href="./default-ui.css" />
<braille-input for="translation-source"></braille-input>
<textarea id="translation-source"></textarea>
```

Either import `defineBrailleInput` and call it in the browser, or load the separate `auto-register` entry. The core entry is safe to import in SSR; browser-only entries require a DOM and are documented as such.
