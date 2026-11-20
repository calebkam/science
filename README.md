# Lab Tools

Browser-based tools in one repo. Static files only: no build step, no server code, nothing leaves the browser. Dark by default with an orange accent; every page has a light/dark switch that is remembered (`localStorage`, key `cp-theme`).

| Tool | Folder | What it does |
|---|---|---|
| Home | `index.html` | Landing page with a card for each tool |
| Bondline | `bondline/` | 2D chemical structure editor |
| Bondline Dock | `dock/` | Draw → 3D → minimise → define pocket → dock; kJ/mol, pose images |
| Positioning Kit Generator | `positioning-kit/` | Parametric rests for a head or limb; 3D preview and STL download |
| Brain Matrix Generator | `brain-matrix/` | Brain slicing matrices (fixed block or sliding halves); STL download |
| Shared | `shared/` | `theme.js`, `nav.js`, and one copy of three.js r128 used by every 3D tool |

## Run locally

```
npm run serve        # or: python3 -m http.server 8000
```

Open http://localhost:8000. Pages must be served over http: opening files from disk will not work, because Dock loads Bondline and its examples, and Brain Matrix loads its WebAssembly file, with `fetch`.

## Publish with GitHub Pages

Push the repo, then Settings → Pages → "Deploy from a branch" → `main` → `/ (root)`. `.nojekyll` is included. Use relative links only so it also works under `https://<user>.github.io/<repo>/`.

## Adding a tool

1. Put it in its own folder with an `index.html`.
2. In `<head>` add `<script src="../shared/theme.js"></script>`; before `</body>` add `<script src="../shared/nav.js"></script>` (adds an "All tools" link and, if the page has no theme button of its own, a theme switch).
3. Define colours as CSS variables with the dark values on `:root` and the light values on `:root[data-theme="light"]`.
4. Add an entry to `TOOLS` in the root `index.html`.

## Notes per tool

**Bondline** is your single-file editor, with three small edits: the theme is dark by default and shared (`cp-theme` instead of its own key), it repaints when another page changes the theme, and the palette is the shared one. If you replace `bondline/index.html` with a newer version, re-apply those edits. Dock only needs the editor to keep exposing `molfile()`.

**Dock** loads `../bondline/index.html` into an iframe and reads the drawing through `molfile()`. Files: `chem.js` (molfile parsing, 3D build, UFF-style minimisation, conformer search), `dock.js` (Vina-style scoring, grid maps, Monte Carlo + BFGS, pocket detection), `viewer.js` (three.js viewer), `app.js` (interface), `data/` (1IEP example). Units are Å and kJ/mol. The score is a Vina-style estimate, not AutoDock Vina itself: in testing, imatinib redocked into 1IEP within about 0.4 Å at about -48.7 kJ/mol. Use it for exploration and ranking. Run `npm test` for the chemistry and docking tests.

**Positioning Kit Generator** is split into `core.js` (parameters, signed-distance models, mesher, STL and ZIP writers) and `app.js` (interface and 3D preview).

**Brain Matrix Generator** is split into `engine.js` (matrix geometry), `manifold.js` + `manifold.wasm` (mesh boolean kernel, loaded by `app.js` with `fetch`) and `app.js` (interface).

## Third-party code

- three.js r128 (MIT), `shared/vendor/three.min.js`.
- `brain-matrix/manifold.js` and `manifold.wasm` are a WebAssembly build of the Manifold geometry library, which is Apache-2.0. Keep its notice with the files if you redistribute them.
- Fonts (IBM Plex, Inter, JetBrains Mono, Schibsted Grotesk) load from Google Fonts.

## Licence

MIT for the code written for this repo (replace the name in `LICENSE`). Third-party code keeps its own licence.
