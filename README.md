# Lab Tools

Browser-based tools in one repo. Static files only: no build step, no server code, nothing leaves the browser. Dark by default with an orange accent; every page has a light/dark switch that is remembered (`localStorage`, key `cp-theme`).

| Tool | Folder | What it does |
|---|---|---|
| Home | `index.html` | Landing page with a card for each tool |
| Bondline | `bondline/` | 2D chemical structure editor |
| RapidDock | `dock/` | Draw → 3D → minimise → define pocket → dock; kcal/mol or kJ/mol, pose images |
| Positioning Kit Generator | `positioning-kit/` | Parametric rests for a head or limb; 3D preview and STL download |
| Brain Matrix Generator | `brain-matrix/` | Brain slicing matrices (fixed block or sliding halves); STL download |
| Layerline Slicer | `slicer/` | Draft 3D print slicer for the Bambu Lab H2S, P2S and Elegoo Centauri Carbon: STL/OBJ/3MF, layer preview, G-code export |
| Changelog | `changelog/` | What changed in each tool; add an entry here with every release |
| Shared | `shared/` | `theme.js`, `nav.js`, and one copy of three.js r128 used by every 3D tool |

## Run locally

```
npm run serve        # or: python3 -m http.server 8000
```

Open http://localhost:8000. Pages must be served over http: opening files from disk will not work, because Dock loads Bondline and its examples, and Brain Matrix loads its WebAssembly file, with `fetch`.

## Publish with GitHub Pages

Push the repo, then Settings → Pages → "Deploy from a branch" → `main` → `/ (root)`. `.nojekyll` is included. Use relative links only so it also works under `https://<user>.github.io/<repo>/`.

## Version numbers

All version numbers live in `shared/versions.js` (all Beta 0.5 for now): one per tool plus `site` for the home page. Add a matching entry to `changelog/index.html` with every release. Bump the number when you change that tool and commit. Each tool page shows its number beside the theme button, and the home page shows its own number next to the title and each tool's number on its card.

## Adding a tool

1. Put it in its own folder with an `index.html`.
2. In `<head>` add `<script src="../shared/theme.js"></script>`; before `</body>` add `<script src="../shared/nav.js"></script>` (adds an "All tools" link and, if the page has no theme button of its own, a theme switch).
3. Define colours as CSS variables with the dark values on `:root` and the light values on `:root[data-theme="light"]`.
4. Add an entry to `TOOLS` in the root `index.html`, and a version for it in `shared/versions.js`.

## Notes per tool

**Bondline** has offline IUPAC naming (`bondline/iupac.js` is the source, inlined into `index.html`; rebuild the inlined copy if you edit it; tests in `bondline/test/`). It is your single-file editor, with three small edits: the theme is dark by default and shared (`cp-theme` instead of its own key), it repaints when another page changes the theme, and the palette is the shared one. If you replace `bondline/index.html` with a newer version, re-apply those edits. Dock only needs the editor to keep exposing `molfile()`.

**Dock** loads `../bondline/index.html` into an iframe and reads the drawing through `molfile()`. Files: `chem.js` (molfile parsing, 3D build, UFF-style minimisation, conformer search), `dock.js` (Vina-style scoring, grid maps, Monte Carlo + BFGS, pocket detection), `viewer.js` (three.js viewer), `props.js` (drug-likeness: Lipinski, Veber, Egan, TPSA, MLOGP, ESOL, SwissADME-style radar; estimates only), `app.js` (interface, console, AutoDock-GPU job sheet), `data/` (1IEP example). Units are Å and kcal/mol (kJ/mol on request). The scoring terms and weights are AutoDock Vina's (unchanged since 1.0; 1.2.7 is the current release). Grid maps are used for the search, then every kept pose is re-optimised and scored with exact pair sums, because trilinear maps under-resolve the sharp gauss1 term and read about 7 % too weak. Checked against Vina 1.2.7 on 1IEP/imatinib: crystal pose -12.53 vs -12.51 kcal/mol, redock top -13.3 vs -13.26 kcal/mol (`dock/test/vina.test.js`). Scores are still estimates: receptor/ligand preparation and search differ from Vina's. Use it for exploration and ranking. Run `npm test` for the chemistry and docking tests.

**Positioning Kit Generator** is split into `core.js` (parameters, signed-distance models, mesher, STL and ZIP writers) and `app.js` (interface and 3D preview).

**Brain Matrix Generator** is split into `engine.js` (matrix geometry), `manifold.js` + `manifold.wasm` (mesh boolean kernel, loaded by `app.js` with `fetch`) and `app.js` (interface).

## Third-party code

- three.js r128 (MIT), `shared/vendor/three.min.js`.
- `slicer/printers.js` holds machine start/end G-code taken from Bambu Studio (Bambu Lab H2S, P2S) and OrcaSlicer (Elegoo Centauri Carbon) profiles, which are AGPL-3.0. Keep the notice at the top of the file, and consider that licence when you choose one for the repo.
- `slicer/vendor/clipper.js` is Clipper 6.4.2 (Angus Johnson, Boost Software License). Keep its header if you redistribute it.
- `brain-matrix/manifold.js` and `manifold.wasm` are a WebAssembly build of the Manifold geometry library, which is Apache-2.0. Keep its notice with the files if you redistribute them.
- Fonts (IBM Plex, Inter, JetBrains Mono, Schibsted Grotesk) load from Google Fonts.

## Licence

MIT for the code written for this repo (replace the name in `LICENSE`). Third-party code keeps its own licence.
