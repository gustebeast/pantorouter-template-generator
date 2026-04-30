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

## Design

Based on "Pantorouter Tenon Template" by FozzTexx (CC0 1.0). Pantograph
math verified against The Pantorouter Co.'s sizing calculator. Dovetail
rail is a separately-printed piece keyed in via a self-supporting "lava
lamp" profile (lead-in chamfer + 45° flares + dulled tip), with all walls
≤ 45° from vertical for FDM printability.

## Materials

Designed for **PA6-GF** with a 0.4 mm nozzle. Tunable shrink compensation
for other materials.

## Examples

Pre-generated reference outputs at the default parameters
(20 × 70 mm tenon, 12.7 mm bit, 12 mm bushing) live in
[`example/`](example/):

- `pantorouter-template-body.step`
- `pantorouter-template-rail.step`
- `pantorouter-template-assembled.step` — both pieces in their
  as-mounted positions, for visual verification only.

## Local development

The site is plain static HTML/JS; no build step. To preview locally:

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

(A real HTTP server is needed; `file://` won't work for the WASM imports.)

## License

CC0 (matching FozzTexx's original).
