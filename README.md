# Pantorouter Template Generator

Browser-based parametric generator for [Pantorouter](https://pantorouter.com)
mortise/tenon templates. Pick units (mm or in), enter your tenon size, bit
diameter, and guide bushing diameter, hit Generate, and download STEP or
STL files for both the template body and its matching rail.

## Live tool

**[gustebeast.github.io/pantorouter-template-generator](https://gustebeast.github.io/pantorouter-template-generator/)**

The browser does all the geometry locally via
[replicad](https://replicad.xyz) (a JavaScript port of OpenCascade, the same
CAD kernel used by FreeCAD and OnShape). After the kernel loads (~5 MB,
once-per-browser), nothing leaves your machine.

## Features

- **mm or inches** — toggle at the top of the form converts every input.
- **STEP or STL** — pick the format that matches your workflow. STL goes
  straight to your slicer; STEP opens in any CAD tool.
- **3D preview** — built-in three.js viewer with toggles to show / hide
  the body and rail independently. Left-click to rotate, right-click
  to pan, scroll to zoom.
- **Debossed label** in the mortise pocket showing the joint dimensions
  in the units you generated with — so you can identify a printed
  template at a glance.

## What it generates

- **`pantorouter-template-body`** — main piece. Has the dual
  mortise/tenon guide profiles, three pilot holes (drill out to 4 mm
  for screws, 6 mm for the center pin), and a dovetail slot in its
  back to receive the rail.
- **`pantorouter-template-rail`** — slides into the back of the body
  and engages the pantorouter's T-track. Prints separately to avoid
  needing structural support.
- **`pantorouter-template-assembled`** — both pieces in their
  as-mounted positions, fused into a single solid. Visual reference
  only — print the body and rail separately.

## Assembly

1. *(Optional)* Print the test mortise and tenon and check they fit
   together. You can also print the screw test to see how the two
   mounting holes will fit on your Pantorouter's T track.
2. Print the body and the rail. **Dual rail mount:** print two copies
   of the rail — one for each slot in the body.
3. Apply super glue to the rail (each rail, for dual rail mount).
4. Slide the rail into the body (one rail per slot for dual rail mount).
5. Wait for the glue to cure.
6. Use 4 mm and 6 mm drill bits to widen the pilot holes in the base
   plate (the pocket floor's reference counterbores indicate which is
   which).

## Design

Based on "Pantorouter Tenon Template" by FozzTexx (CC0 1.0). Pantograph
math verified against The Pantorouter Co.'s sizing calculator. The
dovetail rail uses a self-supporting "lava lamp" profile (lead-in
chamfer + 45° flares + dulled tip), with all walls ≤ 45° from vertical
for FDM printability.

## Materials

Originally designed for **PA6-GF** with a 0.4 mm nozzle, but PLA, PETG,
ABS, ASA, and other common FDM filaments work too. Tunable shrink
compensation for material-specific calibration. Use a brim on the rail
(it's long and thin) for reliable bed adhesion.

## Examples

Pre-generated reference outputs at the default parameters
(20 × 70 mm tenon, 12.7 mm bit, 12 mm bushing) live in
[`example/`](example/):

- `pantorouter-template-body.step`
- `pantorouter-template-rail.step`
- `pantorouter-template-assembled.step` — both pieces in their
  as-mounted positions, for visual verification only.

To regenerate after a geometry change: open the live tool at default
parameters, click Generate, save the three STEP files into `example/`.

## Local development

The site is plain static HTML/JS; no build step. To preview locally:

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

(A real HTTP server is needed; `file://` won't work for the WASM
imports replicad does on first load.)

## Authorship

The CAD geometry, web UI, and three.js preview were written entirely by
[Claude](https://claude.ai) (Anthropic) over a long pair-programming
session. Original SCAD design (which this is parametrically derived from)
is by FozzTexx.

## License

CC0 (matching FozzTexx's original).
