# Pantorouter Template Generator

Browser-based parametric generator for [Pantorouter](https://pantorouter.com)
mortise/tenon templates. Enter your bit + bearing + tenon dimensions, click
Generate, and download STEP files for printing.

## Live tool

**[gustebeast.github.io/pantorouter-template-generator](https://gustebeast.github.io/pantorouter-template-generator/)**

No install, no upload. The browser does all the geometry locally via
[replicad](https://replicad.xyz) (a JavaScript port of OpenCascade, the same
CAD kernel used by FreeCAD and OnShape).

## What it generates

- **`pantorouter-template-body.step`** — main piece. Has the dual
  mortise/tenon guide profiles plus a dovetail slot in its back for the rail.
- **`pantorouter-template-rail.step`** — slides into the back of the template
  body; engages the pantorouter's T-track.
- **`pantorouter-template-test-mortise.step` / `pantorouter-template-test-tenon.step`**
  — small test pieces (~20 mm). Print these first to verify the dovetail joint
  clearance before committing to the full template.
- **`pantorouter-template-flat-mortise.step` / `pantorouter-template-flat-tenon.step`**
  — 2 mm cross-section wafers for measuring the joint gap directly with calipers.

## Design

Based on FozzTexx's [Pantorouter Tenon Template](https://www.printables.com/)
(CC0 1.0). Pantograph math verified against The Pantorouter Co.'s sizing
calculator. Dovetail rail is a separately-printed piece keyed in via a
self-supporting "lava lamp" profile (lead-in chamfer + 45° flares + dulled
tip), with all walls ≤ 45° from vertical for FDM printability.

## Materials

Designed for **PA6-GF** with a 0.4 mm nozzle. Tunable shrink compensation
for other materials.

## Local development

The site is plain static HTML/JS; no build step. To preview locally:

```sh
cd docs
python3 -m http.server 8080
# open http://localhost:8080
```

(A real HTTP server is needed; `file://` won't work for the WASM imports.)

## License

CC0 (matching FozzTexx's original).
