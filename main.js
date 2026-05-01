// Pantorouter Template Generator — browser port.
// Geometry mirrors pantorouter_template_generator.py (the reference Python
// implementation). Keep the two in sync if you edit one — defaults,
// constants, and formulas should match line-for-line.

import opencascade from "https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.0/src/replicad_single.js";
import * as replicad from "https://cdn.jsdelivr.net/npm/replicad@0.21.0/dist/replicad.js";
import * as THREE from "https://esm.sh/three@0.160.0";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";

// ── Units ───────────────────────────────────────────────────────────────────
const INCH_MM = 25.4;
let currentUnits = "mm"; // tracks the radio group below the form

// Fields whose values are physical dimensions and must be converted when
// the user toggles between mm and inches. Bearing intentionally included
// even though many woodworking guide bushings are sized in mm — if the
// user wants to keep mm-only for the bearing, they can switch back.
const UNIT_FIELDS = [
  "tenonWidth", "tenonLength", "tenonRadius",
  "bit", "bearing", "templateDepth",
];

// ── Constants (pulled from the .py reference) ───────────────────────────────
const NOZZLE_W = 0.4;

const RAIL_NECK_W = 3.8;
const RAIL_CATCH_W = 5.8;
const RAIL_TOP_FLAT = 2.969;
const RAIL_BASE_W = 4.1;
const RAIL_BASE_H = 1.3;
const RAIL_CLEARANCE = 0.2;

// Lead-in chamfer length sized so the rail's bottom (where the dovetail
// meets the rectangular base) is exactly 4.3 mm wide at the current
// clearance, matching the pantorouter T-track:
//   rail_bottom = NECK_W + 2·LEAD_IN_DX − 2·c = 4.3
//   LEAD_IN_DX  = 0.35   →   LEAD_IN_LEN = 0.35·√2 ≈ 0.4950 mm.
const RAIL_LEAD_IN_LEN = 0.495;

const _LEAD_IN_DX = RAIL_LEAD_IN_LEN * Math.sin((45 * Math.PI) / 180);
const _LEAD_IN_DZ = RAIL_LEAD_IN_LEN * Math.cos((45 * Math.PI) / 180);

const RAIL_OPENING_HALF_W = RAIL_NECK_W / 2 + _LEAD_IN_DX;
const RAIL_SHOULDER_Z = _LEAD_IN_DZ;
const RAIL_UPPER_CATCH_H = RAIL_SHOULDER_Z + (RAIL_CATCH_W - RAIL_NECK_W) / 2;
const RAIL_TIP_H = RAIL_UPPER_CATCH_H + (RAIL_CATCH_W - RAIL_TOP_FLAT) / 2;

const SLOT_DEPTH = RAIL_TIP_H;
// Countersink for the two M4 side screws — recessed cone so flat-head
// screws sit flush with the pocket floor (matches the printables
// version of the design). Below the cone, COUNTERSINK_FLOOR_THICK of
// solid material separates it from the slot ceiling.
const COUNTERSINK_TOP_DIA    = 8.7;    // diameter at the pocket floor
const COUNTERSINK_BOTTOM_DIA = 4.0;    // diameter where the cone ends (= M4 shaft)
const COUNTERSINK_DEPTH      = 3.383;  // vertical depth of the cone
const COUNTERSINK_FLOOR_THICK = 0.4;   // solid material below cone, above slot

// Pantorouter T-track geometry — three parallel T-tracks 20 mm apart.
// In "dual rail mount" mode the side screws shift from along the long
// axis to perpendicular to it, so the center hole engages the middle
// T-track and the side screws engage the outer two.
const T_TRACK_SPACING = 20.0;
// Minimum gap between the cone bezel's outer edge and the body's outer
// wall when in dual-rail mode — keeps the wall from being too thin.
const COUNTERSINK_EDGE_BUFFER = 1.0;
// Min short-axis width the template needs for dual-rail mounting:
// 2 × spacing for the side-screw positions + the cone diameter + buffer
// on each side.
const DUAL_RAIL_MIN_OUTER_W =
  2 * T_TRACK_SPACING + COUNTERSINK_TOP_DIA + 2 * COUNTERSINK_EDGE_BUFFER;

const BASE_DEPTH = SLOT_DEPTH + COUNTERSINK_FLOOR_THICK + COUNTERSINK_DEPTH;

const STOP_LEN = 8.0;

const CENTER_DIAMETER = 6.0;
const SCREW_DIAMETER = 4.0;
const PILOT_DIA = 2.369;
const REFERENCE_H = 1.0;
const CENTER_MARK_SIZE = 1.5;

// Joint fit-test pieces. Tiny mortise + tenon that exercise only the
// dovetail/rail joint, without the full template body. Print these to
// confirm the slot/rail clearance feels right before committing to a
// full-size template print.
const TEST_LENGTH   = 20.0;  // total length of each test piece, along Y
const TEST_STOP_LEN = 10.0;  // closed-cap region at +Y; remaining 10 mm is slide
const TEST_WALL_T   = 1.2;   // min wall thickness around the slot in the
                             // test mortise (measured at the slot's widest
                             // point — the catch).

// ── Kernel boot ─────────────────────────────────────────────────────────────
let kernelReady = false;

async function bootKernel() {
  // Initialize OpenCascade WASM and bind it into replicad.
  const OC = await opencascade({
    locateFile: (path) =>
      `https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.0/src/${path}`,
  });
  replicad.setOC(OC);
  kernelReady = true;
}

// ── Helpers (replicad equivalents of the .py helpers) ───────────────────────
function roundedRectPrism(width, length, radius, height, z0 = 0) {
  // Centered on the origin in XY, extruded +Z by `height` from z=z0.
  return replicad
    .drawRoundedRectangle(width, length, radius)
    .sketchOnPlane("XY", z0)
    .extrude(height);
}

function dovetailExtrude(pts, length, centerY) {
  // Build a closed polyline in XZ, extrude along +Y from -length/2 to +length/2,
  // then translate to centerY. `pts` is a list of [x, z] tuples.
  let drawing = replicad.draw().movePointerTo(pts[0]);
  for (let i = 1; i < pts.length; i++) drawing = drawing.lineTo(pts[i]);
  drawing = drawing.close();
  return drawing
    .sketchOnPlane("XZ", -length / 2)
    .extrude(length)
    .translate([0, centerY, 0]);
}

function slotDovetailSolid(length, centerY) {
  const pts = [
    [-RAIL_OPENING_HALF_W, 0.0],
    [-RAIL_NECK_W / 2, RAIL_SHOULDER_Z],
    [-RAIL_CATCH_W / 2, RAIL_UPPER_CATCH_H],
    [-RAIL_TOP_FLAT / 2, RAIL_TIP_H],
    [RAIL_TOP_FLAT / 2, RAIL_TIP_H],
    [RAIL_CATCH_W / 2, RAIL_UPPER_CATCH_H],
    [RAIL_NECK_W / 2, RAIL_SHOULDER_Z],
    [RAIL_OPENING_HALF_W, 0.0],
  ];
  return dovetailExtrude(pts, length, centerY);
}

function railDovetailSolid(length, centerY) {
  const c = RAIL_CLEARANCE;
  const neck = RAIL_NECK_W - 2 * c;
  const catchW = RAIL_CATCH_W - 2 * c;
  const openHalf = RAIL_OPENING_HALF_W - c;
  const tipZ = RAIL_TIP_H - c;
  const pts = [
    [-openHalf, 0.0],
    [-neck / 2, RAIL_SHOULDER_Z],
    [-catchW / 2, RAIL_UPPER_CATCH_H],
    [-RAIL_TOP_FLAT / 2, tipZ],
    [RAIL_TOP_FLAT / 2, tipZ],
    [catchW / 2, RAIL_UPPER_CATCH_H],
    [neck / 2, RAIL_SHOULDER_Z],
    [openHalf, 0.0],
  ];
  return dovetailExtrude(pts, length, centerY);
}

function railBaseSolid(length, centerY) {
  // Rectangular bar in XZ from z=-RAIL_BASE_H to z=0, RAIL_BASE_W wide,
  // extruded along Y for `length`, centered at centerY.
  const pts = [
    [-RAIL_BASE_W / 2, -RAIL_BASE_H],
    [-RAIL_BASE_W / 2, 0],
    [RAIL_BASE_W / 2, 0],
    [RAIL_BASE_W / 2, -RAIL_BASE_H],
  ];
  return dovetailExtrude(pts, length, centerY);
}

// Truncated-cone (frustum) recess for a flat-head screw countersink.
// Wide opening at z = zTop, narrow at z = zTop − COUNTERSINK_DEPTH.
function countersinkCone(zTop) {
  return replicad
    .drawCircle(COUNTERSINK_BOTTOM_DIA / 2)
    .sketchOnPlane("XY", zTop - COUNTERSINK_DEPTH)
    .extrude(COUNTERSINK_DEPTH, {
      extrusionProfile: {
        profile: "linear",
        endFactor: COUNTERSINK_TOP_DIA / COUNTERSINK_BOTTOM_DIA,
      },
    });
}

function pilotHoleWithReference(referenceDia, zBottom, zTop) {
  const height = zTop - zBottom;
  const pilot = replicad
    .drawCircle(PILOT_DIA / 2)
    .sketchOnPlane("XY", zBottom)
    .extrude(height);
  const ref = replicad
    .drawCircle(referenceDia / 2)
    .sketchOnPlane("XY", zTop - REFERENCE_H)
    .extrude(REFERENCE_H + 0.01);
  return pilot.fuse(ref);
}

function centeringVNotches(width, totalH) {
  const side = CENTER_MARK_SIZE;
  const height = totalH + 2.0;
  const z0 = -1.0;
  const make = (sx) =>
    replicad
      .drawRectangle(side, side)
      .sketchOnPlane("XY", z0)
      .extrude(height)
      .translate([sx, 0, 0])
      .rotate(45, [sx, 0, height / 2 + z0], [0, 0, 1]);
  return make(-width / 2).fuse(make(width / 2));
}

// ── Pantograph math (matches .py) ────────────────────────────────────────────
function deriveSizes(p) {
  const TENON_WIDTH = p.tenonWidth;
  const TENON_LENGTH = p.tenonLength;
  const OUTER_BIT = p.bit;
  const OUTER_BEARING = p.bearing;
  const INNER_BIT = p.bit;
  const INNER_BEARING = p.bearing;
  const TENON_RADIUS = p.tenonRadius != null ? p.tenonRadius : INNER_BIT / 2;
  const SHRINK_COMP = p.shrinkComp;

  const OUTER_W = (TENON_WIDTH + OUTER_BIT) * 2 - OUTER_BEARING;
  const OUTER_L = (TENON_LENGTH + OUTER_BIT) * 2 - OUTER_BEARING;
  const OUTER_R = ((TENON_RADIUS * 2 + OUTER_BIT) * 2 - OUTER_BEARING) / 2;

  const INNER_W = ((TENON_WIDTH - INNER_BIT) * 2 + INNER_BEARING) * SHRINK_COMP;
  const INNER_L = ((TENON_LENGTH - INNER_BIT) * 2 + INNER_BEARING) * SHRINK_COMP;
  const INNER_R =
    (((TENON_RADIUS * 2 - INNER_BIT) * 2 + INNER_BEARING) / 2) * SHRINK_COMP;

  if (INNER_W <= 0 || INNER_L <= 0)
    throw new Error(
      "Inner pocket has zero/negative size — bit too large for tenon."
    );
  if (INNER_R <= 0)
    throw new Error(
      "Inner corner radius collapsed — tenon corner radius is smaller than bit radius."
    );

  // Dual-rail mount is only applied if the template's short axis can
  // actually fit the side cones with the required edge buffer. Even
  // if the user has the box checked, we silently disable it for parts
  // that are too narrow.
  const dualRailFeasible = OUTER_W >= DUAL_RAIL_MIN_OUTER_W;
  const dualRailMount = !!p.dualRailMount && dualRailFeasible;

  return {
    OUTER_W, OUTER_L, OUTER_R, INNER_W, INNER_L, INNER_R,
    TEMPLATE_DEPTH: p.templateDepth,
    dualRailMount,
    dualRailFeasible,
    // Pass display values through for the debossed label.
    displayWidth: p.displayWidth,
    displayLength: p.displayLength,
    displayUnits: p.displayUnits,
  };
}

// Returns [[x, y], [x, y]] for the two side screw positions, in mm.
//
//  • Single-rail mount (default): along the long axis, half-way between
//    the center pin and the inner-pocket wall. Both screws engage the
//    same T-track as the rail.
//  • Dual-rail mount: perpendicular to the long axis, ±T_TRACK_SPACING
//    from center, so the screws engage the OUTER two T-tracks and the
//    center hole engages the center T-track.
function screwPositions(d) {
  if (d.dualRailMount) {
    return [
      [-T_TRACK_SPACING, 0],
      [ T_TRACK_SPACING, 0],
    ];
  }
  const sy = d.INNER_L / 4;
  return [[0, -sy], [0, sy]];
}

// ── Builders ────────────────────────────────────────────────────────────────
function buildTemplate(d) {
  const totalH = BASE_DEPTH + d.TEMPLATE_DEPTH;

  let body = roundedRectPrism(d.OUTER_W, d.OUTER_L, d.OUTER_R, totalH, 0);

  // Dovetail slot — open at -Y end, capped at +Y end (STOP_LEN).
  const slotLength = d.OUTER_L - STOP_LEN + 2.0;
  const slotCenterY = -STOP_LEN / 2 - 1.0;
  body = body.cut(slotDovetailSolid(slotLength, slotCenterY));

  // Mortise pocket.
  body = body.cut(
    roundedRectPrism(d.INNER_W, d.INNER_L, d.INNER_R,
                     d.TEMPLATE_DEPTH + 1, BASE_DEPTH)
  );

  // V-notches.
  body = body.cut(centeringVNotches(d.OUTER_W, totalH));

  // Center pin pilot + reference at the pocket floor.
  body = body.cut(
    pilotHoleWithReference(CENTER_DIAMETER, -1.0, BASE_DEPTH)
  );

  // Two M4 side-screw holes. Each hole has:
  //   • a PILOT_DIA pilot through the entire stack (template + slot
  //     region + rail when assembled); drill out to 4 mm post-print.
  //   • a tapered countersink cone at the top so a flat-head screw
  //     drops in flush with the pocket floor. The cone tapers from
  //     COUNTERSINK_TOP_DIA at the floor down to COUNTERSINK_BOTTOM_DIA
  //     at COUNTERSINK_DEPTH below it.
  for (const [sx, sy] of screwPositions(d)) {
    const pilot = replicad
      .drawCircle(PILOT_DIA / 2)
      .sketchOnPlane("XY", -1.0)
      .extrude(BASE_DEPTH + 1.0)
      .translate([sx, sy, 0]);
    body = body.cut(pilot);
    body = body.cut(countersinkCone(BASE_DEPTH).translate([sx, sy, 0]));
  }

  // Debossed joint-size label on the pocket floor (visible from above
  // when looking into the empty pocket). Uses a monospace font for
  // near-uniform stroke width.
  body = debossLabelOnPocketFloor(body, d);

  return body;
}

// Format a dimension for the debossed label, in the current units.
function fmtDim(value, units) {
  if (units === "in") {
    // Drop trailing zeros; up to 3 decimal places.
    return parseFloat(value.toFixed(3)).toString();
  }
  return parseFloat(value.toFixed(2)).toString();
}

function debossLabelOnPocketFloor(body, d) {
  if (d.displayWidth == null || d.displayLength == null) return body;
  const units = d.displayUnits || "mm";
  const label = `${fmtDim(d.displayWidth, units)} x ${fmtDim(d.displayLength, units)} ${units}`;

  // Pick a font size that comfortably fits the pocket floor along its
  // short axis. Cap at 6 mm so it's readable; floor at 2 mm for tiny
  // joints.
  const maxByWidth = Math.max(2.0, Math.min(6.0, d.INNER_W * 0.2));
  const fontSize = maxByWidth;

  let textDrawing;
  try {
    // replicad.drawText falls back to a built-in font if no fontFamily
    // is given. fontFamily "monospace" hints toward an even-stroke
    // family if available.
    textDrawing = replicad.drawText(label, { fontSize, fontFamily: "monospace" });
  } catch (e) {
    console.warn("[deboss] drawText failed, skipping label:", e);
    return body;
  }

  // Center the text bbox at (0, 0) so it sits on the pocket centroid.
  let textShape;
  try {
    const bbox = textDrawing.boundingBox;
    const cx = (bbox.minPoint?.x ?? bbox.xmin ?? 0 +
                (bbox.maxPoint?.x ?? bbox.xmax ?? 0)) / 2;
    const cy = (bbox.minPoint?.y ?? bbox.ymin ?? 0 +
                (bbox.maxPoint?.y ?? bbox.ymax ?? 0)) / 2;
    textShape = textDrawing
      .sketchOnPlane("XY")
      .extrude(-1.0)                // 1 mm deep deboss
      .translate([-cx, -cy, BASE_DEPTH]);
  } catch (e) {
    console.warn("[deboss] sketch/extrude failed:", e);
    return body;
  }

  try {
    return body.cut(textShape);
  } catch (e) {
    console.warn("[deboss] cut failed:", e);
    return body;
  }
}

function buildRail(d) {
  const base = railBaseSolid(d.OUTER_L, 0);
  const dtLen = d.OUTER_L - STOP_LEN - RAIL_CLEARANCE;
  const dtCenterY = -STOP_LEN / 2 - RAIL_CLEARANCE / 2;
  const dt = railDovetailSolid(dtLen, dtCenterY);
  let rail = base.fuse(dt);

  const pilotH = RAIL_BASE_H + SLOT_DEPTH + 2.0;
  const pilotZ0 = -RAIL_BASE_H - 1.0;
  rail = rail.cut(
    replicad.drawCircle(PILOT_DIA / 2).sketchOnPlane("XY", pilotZ0).extrude(pilotH)
  );
  // Side-screw pilots — only cut the ones that actually pass through
  // the rail (with dual-rail mount the side screws are off the long
  // axis at ±20 mm, well outside the rail's footprint, so we skip them
  // there).
  for (const [sx, sy] of screwPositions(d)) {
    if (Math.abs(sx) > RAIL_CATCH_W / 2) continue;
    rail = rail.cut(
      replicad
        .drawCircle(PILOT_DIA / 2)
        .sketchOnPlane("XY", pilotZ0)
        .extrude(pilotH)
        .translate([sx, sy, 0])
    );
  }
  return rail;
}

// Visual-only "assembled" view: body and rail fused together in their
// as-mounted positions. Not for printing — print the body and rail
// separately and slide them together. Useful for previewing the joint
// geometry in a single STEP/STL file.
function buildAssembly(d) {
  return buildTemplate(d).fuse(buildRail(d));
}

// Small mock-up for verifying that the M4 mounting workflow actually
// works once printed: a 10 × 10 mm vertical column carved out of the
// assembled body + rail (built WITHOUT clearance so the parts are
// perfectly mated, as if glued), centered on one of the side screw
// holes, with the side hole already drilled to 4 mm clearance + the
// countersink cone in place. Print this once at default-ish parameters
// to make sure your screws + driver + T-track engagement all work
// before committing to the full template print.
function buildScrewTest(d) {
  const totalH = BASE_DEPTH + d.TEMPLATE_DEPTH;
  const [screwX, screwY] = screwPositions(d)[0];
  const FOOTPRINT = 10.0;

  // Body without side pilots (we'll cut the 4 mm drilled hole below).
  let body = roundedRectPrism(d.OUTER_W, d.OUTER_L, d.OUTER_R, totalH, 0);
  body = body.cut(
    slotDovetailSolid(d.OUTER_L - STOP_LEN + 2.0, -STOP_LEN / 2 - 1.0)
  );
  body = body.cut(
    roundedRectPrism(d.INNER_W, d.INNER_L, d.INNER_R,
                     d.TEMPLATE_DEPTH + 1, BASE_DEPTH)
  );
  body = body.cut(centeringVNotches(d.OUTER_W, totalH));

  // Rail at full slot dimensions (zero clearance) + base bar. The
  // dovetail upper portion uses slotDovetailSolid (matches the slot
  // exactly), so when fused with the body the parts merge into one
  // continuous solid with no air gap.
  const railUpper = slotDovetailSolid(d.OUTER_L - STOP_LEN, -STOP_LEN / 2);
  const railBase  = railBaseSolid(d.OUTER_L, 0);
  const rail = railUpper.fuse(railBase);

  let assembled = body.fuse(rail);

  // Drilled-through 4 mm screw clearance hole + countersink cone.
  const fullH = totalH + RAIL_BASE_H + 2;
  const zBot = -RAIL_BASE_H - 1;
  const drilled = replicad
    .drawCircle(SCREW_DIAMETER / 2)
    .sketchOnPlane("XY", zBot)
    .extrude(fullH)
    .translate([screwX, screwY, 0]);
  assembled = assembled.cut(drilled);
  assembled = assembled.cut(
    countersinkCone(BASE_DEPTH).translate([screwX, screwY, 0])
  );

  // Slice out the FOOTPRINT × FOOTPRINT × full-height column centered
  // on the screw hole.
  const slicer = replicad
    .drawRectangle(FOOTPRINT, FOOTPRINT)
    .sketchOnPlane("XY", zBot)
    .extrude(fullH)
    .translate([screwX, screwY, 0]);

  const piece = assembled.intersect(slicer);

  // Flip vertically (180° around Y) and recenter at origin so the
  // print bed contacts the POCKET-FLOOR side of the slice (the side
  // with the wide end of the countersink cone). In this orientation
  // the slice's outer profile narrows monotonically going up — no
  // 2.95 mm bridges where the rail base meets the body. Other test
  // pieces print in their original orientation; this one is the
  // exception because we're not validating slot/rail printability
  // here, just the screw/T-track interface.
  return piece
    .rotate(180, [0, 0, 0], [0, 1, 0])
    .translate([-screwX, -screwY, BASE_DEPTH]);
}

// Small rectangular block with the dovetail slot — for fit-checking
// the rail/slot clearance before printing the full template.
function buildMortiseTest() {
  const outerW = RAIL_CATCH_W + 2 * TEST_WALL_T;
  const outerH = BASE_DEPTH;
  let block = replicad
    .drawRectangle(outerW, TEST_LENGTH)
    .sketchOnPlane("XY", 0)
    .extrude(outerH);
  const slotLength = TEST_LENGTH - TEST_STOP_LEN + 2.0;
  const slotCenterY = -TEST_STOP_LEN / 2 - 1.0;
  return block.cut(slotDovetailSolid(slotLength, slotCenterY));
}

// Matching small rail piece for the mortise test. Same dovetail and
// base profile as the full rail; just shorter and without holes.
function buildTenonTest() {
  const base = railBaseSolid(TEST_LENGTH, 0);
  const dtLen = TEST_LENGTH - TEST_STOP_LEN - RAIL_CLEARANCE;
  const dtCenterY = -TEST_STOP_LEN / 2 - RAIL_CLEARANCE / 2;
  const dt = railDovetailSolid(dtLen, dtCenterY);
  return base.fuse(dt);
}

// ── 3D preview (three.js) ───────────────────────────────────────────────────
let scene, camera, renderer, controls;
// Three.js objects keyed by part name ("body" / "rail") so each can be
// toggled independently via the checkboxes below the canvas.
const previewParts = { body: [], rail: [] };

function initPreview() {
  const canvas = document.getElementById("preview");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d0d);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  camera.up.set(0, 0, 1); // Z up — matches the geometry's coord system

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
  keyLight.position.set(80, -120, 200);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
  fillLight.position.set(-100, 80, 50);
  scene.add(fillLight);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  // Default view (camera back from origin) until shapes load.
  camera.position.set(120, -180, 100);
  controls.target.set(0, 0, 5);

  resizePreview();
  window.addEventListener("resize", resizePreview);

  // Wire visibility checkboxes (one per part).
  for (const partKey of ["body", "rail"]) {
    const cb = document.getElementById("show-" + partKey);
    if (!cb) {
      console.warn("[preview] checkbox not found:", "show-" + partKey);
      continue;
    }
    const handler = () => setPartVisibility(partKey, cb.checked);
    cb.addEventListener("change", handler);
    cb.addEventListener("input", handler);
  }

  (function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  })();
}

function resizePreview() {
  if (!renderer) return;
  const canvas = renderer.domElement;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function clearPreview() {
  for (const key of Object.keys(previewParts)) {
    for (const obj of previewParts[key]) {
      scene.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    previewParts[key] = [];
  }
}

function addShapeToPreview(shape, color, partKey) {
  const meshOpts = { tolerance: 0.05, angularTolerance: 30 };
  const m = shape.mesh(meshOpts);

  // replicad's mesh API has shifted slightly across versions — accept either
  // `.triangles` (newer) or `.indices` (older) for the index buffer.
  const indices = m.triangles || m.indices;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(m.vertices), 3)
  );
  if (m.normals) {
    geom.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Float32Array(m.normals), 3)
    );
  }
  if (indices) {
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  }
  if (!m.normals) geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
    flatShading: false,
  });
  const visible = isPartVisible(partKey);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.visible = visible;
  scene.add(mesh);
  previewParts[partKey].push(mesh);

  // Crisp edges so the part outline reads cleanly.
  try {
    const e = shape.meshEdges();
    if (e?.lines?.length) {
      const eGeom = new THREE.BufferGeometry();
      eGeom.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(e.lines), 3)
      );
      const eMat = new THREE.LineBasicMaterial({ color: 0x000000 });
      const edges = new THREE.LineSegments(eGeom, eMat);
      edges.visible = visible;
      scene.add(edges);
      previewParts[partKey].push(edges);
    }
  } catch (_) {
    // meshEdges isn't available on this version — fall back to silhouette only.
  }
}

function isPartVisible(partKey) {
  const cb = document.getElementById("show-" + partKey);
  return cb ? cb.checked : true;
}

function setPartVisibility(partKey, visible) {
  const objs = previewParts[partKey];
  if (!objs) return;
  for (const obj of objs) obj.visible = visible;
}

function fitCameraToScene() {
  const box = new THREE.Box3();
  for (const key of Object.keys(previewParts)) {
    for (const obj of previewParts[key]) {
      if (obj.isMesh) box.expandByObject(obj);
    }
  }
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 1.6;
  camera.position.set(
    center.x + dist * 0.5,
    center.y - dist,
    center.z + dist * 0.4
  );
  controls.target.copy(center);
  controls.update();
}

// ── UI plumbing ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function toMm(value) {
  return currentUnits === "in" ? value * INCH_MM : value;
}

function readParams() {
  const tenonRadiusRaw = $("tenonRadius").value.trim();
  return {
    tenonWidth:  toMm(parseFloat($("tenonWidth").value)),
    tenonLength: toMm(parseFloat($("tenonLength").value)),
    tenonRadius: tenonRadiusRaw === "" ? null : toMm(parseFloat(tenonRadiusRaw)),
    bit:         toMm(parseFloat($("bit").value)),
    bearing:     toMm(parseFloat($("bearing").value)),
    shrinkComp:  parseFloat($("shrinkComp").value),
    templateDepth: toMm(parseFloat($("templateDepth").value)),
    // Mounting mode (only honored if the geometry actually allows it
    // — see deriveSizes).
    dualRailMount: $("dualRailMount").checked,
    // Display values (in current units) for the debossed label.
    displayWidth:  parseFloat($("tenonWidth").value),
    displayLength: parseFloat($("tenonLength").value),
    displayUnits:  currentUnits,
  };
}

// Re-evaluate whether the dual-rail-mount checkbox should be enabled
// based on the current parameter values, and update its status text.
// Called on boot and after every input change.
function updateDualRailFeasibility() {
  const cb = document.getElementById("dualRailMount");
  const status = document.getElementById("dualRailStatus");
  if (!cb || !status) return;
  let outerW;
  try {
    const p = readParams();
    if ([p.tenonWidth, p.tenonLength, p.bit, p.bearing].some(Number.isNaN)) {
      return;
    }
    outerW = (p.tenonWidth + p.bit) * 2 - p.bearing;
  } catch {
    return;
  }
  const feasible = outerW >= DUAL_RAIL_MIN_OUTER_W;
  cb.disabled = !feasible;
  if (!feasible) {
    cb.checked = false;
    status.textContent =
      `Disabled — short axis is ${outerW.toFixed(1)} mm; needs ` +
      `≥ ${DUAL_RAIL_MIN_OUTER_W.toFixed(1)} mm to fit the cone bezels ` +
      `with ${COUNTERSINK_EDGE_BUFFER} mm edge clearance.`;
    status.style.color = "var(--muted)";
  } else {
    status.textContent =
      `Available — short axis is ${outerW.toFixed(1)} mm.`;
    status.style.color = "";
  }
}

function setUnits(newUnits) {
  if (newUnits === currentUnits) return;
  const factor = newUnits === "in" ? 1 / INCH_MM : INCH_MM;
  for (const id of UNIT_FIELDS) {
    const el = document.getElementById(id);
    if (!el || el.value === "") continue;
    const v = parseFloat(el.value);
    if (Number.isNaN(v)) continue;
    const converted = v * factor;
    el.value = newUnits === "in" ? converted.toFixed(3) : converted.toFixed(2);
  }
  // Update label suffixes.
  document.querySelectorAll(".unit-label").forEach((s) => {
    s.textContent = newUnits;
  });
  // Sensible step + placeholder tweaks per unit.
  for (const id of UNIT_FIELDS) {
    const el = document.getElementById(id);
    if (el) el.step = newUnits === "in" ? "0.001" : "0.1";
  }
  currentUnits = newUnits;
}

function setStatus(msg, kind = "info") {
  const el = $("status");
  el.textContent = msg;
  el.className = `status ${kind}`;
}

function clearDownloads() {
  $("downloads").innerHTML = "";
}

function addDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.textContent = filename;
  li.appendChild(a);
  $("downloads").appendChild(li);
}

async function generateAll() {
  if (!kernelReady) {
    setStatus("Still loading the CAD kernel — give it a sec.", "info");
    return;
  }

  let params;
  try {
    params = readParams();
  } catch (e) {
    setStatus("Couldn't parse parameters: " + e.message, "error");
    return;
  }

  const btn = $("generate");
  btn.disabled = true;
  btn.textContent = "Generating…";
  clearDownloads();
  clearPreview();
  setStatus("Building geometry…", "info");

  try {
    const d = deriveSizes(params);
    const format = $("format").value === "stl" ? "stl" : "step";

    const parts = [
      ["body",      "pantorouter-template-body",         () => buildTemplate(d),    0xb0b0b0],
      ["rail",      "pantorouter-template-rail",         () => buildRail(d),        0xd9882a],
      // Verification / fit-test pieces. Skipped for the preview render
      // (already rendered as separate body+rail meshes there).
      ["assembled",   "pantorouter-template-assembled",    () => buildAssembly(d),    null],
      ["screwTest",   "pantorouter-template-screw-test",   () => buildScrewTest(d),   null],
      ["mortiseTest", "pantorouter-template-mortise-test", () => buildMortiseTest(),  null],
      ["tenonTest",   "pantorouter-template-tenon-test",   () => buildTenonTest(),    null],
    ];

    for (const [partKey, baseName, build, color] of parts) {
      const filename = `${baseName}.${format}`;
      setStatus(`Building ${filename}…`, "info");
      // Yield to the UI thread so the status text actually renders.
      await new Promise((r) => setTimeout(r, 0));
      const shape = build();
      const blob = format === "stl" ? await shape.blobSTL() : await shape.blobSTEP();
      addDownload(filename, blob);
      // The assembled piece is identical (visually) to body+rail
      // already rendered — don't add it twice to the 3D preview.
      if (color !== null) addShapeToPreview(shape, color, partKey);
    }
    fitCameraToScene();
    document.getElementById("preview-overlay")?.classList.add("hidden");

    setStatus(
      `Done — ${parts.length} files ready. Outer: ${d.OUTER_W.toFixed(1)} × ${d.OUTER_L.toFixed(
        1
      )} mm. Inner pocket: ${d.INNER_W.toFixed(1)} × ${d.INNER_L.toFixed(1)} mm.`,
      "ok"
    );
  } catch (e) {
    console.error(e);
    setStatus("Error: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate files";
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  initPreview();
  setStatus("Loading CAD kernel (~5 MB) — this only happens once.", "info");
  try {
    await bootKernel();
    setStatus("Ready. Adjust parameters and click Generate.", "ok");
    // Wire unit radios.
    document.querySelectorAll('input[name="units"]').forEach((r) => {
      r.addEventListener("change", () => {
        if (r.checked) setUnits(r.value);
        updateDualRailFeasibility();
      });
    });
    // Recompute dual-rail availability whenever any parameter changes.
    document
      .querySelectorAll("#params input, #params select")
      .forEach((el) => {
        el.addEventListener("input", updateDualRailFeasibility);
        el.addEventListener("change", updateDualRailFeasibility);
      });
    updateDualRailFeasibility();
    const btn = $("generate");
    btn.textContent = "Generate files";
    btn.disabled = false;
    btn.addEventListener("click", generateAll);
  } catch (e) {
    console.error(e);
    setStatus("Failed to load CAD kernel: " + e.message, "error");
  }
})();
