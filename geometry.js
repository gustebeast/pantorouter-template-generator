// Geometry layer of the Pantorouter Template Generator — UI-free so it
// runs both in the browser (main.js) and headlessly under Node
// (tools/generate.mjs). Pass the replicad module in; no DOM, no fetch.
// The rail ↔ body joint is the cadkit octagon (see vendored
// cadkit/joinery.py — canonical geometry; keep the port in sync).
export function makeBuilders(replicad) {
// ── Constants (pulled from the .py reference) ───────────────────────────────
const NOZZLE_W = 0.4;

const RAIL_NECK_W = 3.9;
const RAIL_CATCH_W = 5.9;
const RAIL_TOP_FLAT = 3.069;
const RAIL_BASE_W = 4.2;
const RAIL_BASE_H = 1.3;
const RAIL_CLEARANCE = 0.25;  // bumped from 0.2 (print-fit preference)

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

// ── Rail ↔ template joint: cadkit octagon ("stop sign") slide joint ──────
// Ported from cadkit/joinery.py (vendored — that file is the canonical
// geometry; keep this port in sync). Both halves print flat; the install
// axis runs along the rail. The octagon width is SOLVED so the cavity
// height stays within the legacy slot's RAIL_TIP_H budget — BASE_DEPTH's
// countersink stack depends on it.
const OCT_NOZZLE = 0.4;
const OCT_STEM_FRAC = 0.5;

function octTenonRoof(n, c) {
  // Tenon top flat sized so the MORTISE roof (dilated, mitred) is one nozzle.
  const t = n - 2.0 * c * (Math.SQRT2 - 1.0);
  if (t <= 1e-6) throw new Error("clearance too large for nozzle");
  return t;
}

function octWidthMin(n, c) {
  const roofT = octTenonRoof(n, c);
  return Math.max(n / OCT_STEM_FRAC,
                  (n * Math.SQRT2) / (1.0 - OCT_STEM_FRAC),
                  roofT + n * Math.SQRT2);
}

// Closed [x, z] points for the TENON cross-section — a stop sign on a
// stem; z = 0 is the mating plane (the template's back face).
function octProfile(width, n, baseZ, c) {
  if (width < octWidthMin(n, c) - 1e-9) {
    throw new Error("octagon width below printable minimum");
  }
  const roofT = octTenonRoof(n, c);
  const hw = width / 2.0;
  const stem = OCT_STEM_FRAC * width;
  const orange = hw - stem / 2.0;   // lower 45° diagonal run
  const green = hw - roofT / 2.0;   // upper 45° diagonal run
  const zNeck = n;
  const zWb = zNeck + orange;
  const zWt = zWb + n;
  const zRoof = zWt + green;
  return {
    pts: [
      [stem / 2, baseZ], [stem / 2, zNeck], [hw, zWb], [hw, zWt],
      [roofT / 2, zRoof], [-roofT / 2, zRoof], [-hw, zWt], [-hw, zWb],
      [-stem / 2, zNeck], [-stem / 2, baseZ],
    ],
    roof: zRoof,
  };
}

function octHeight(width, n, c) { return octProfile(width, n, 0.0, c).roof; }

// Mitred outward offset of a simple closed polygon — the equivalent of
// cadkit's offset2D(clearance, "intersection") for this profile.
function miterOffset(pts, d) {
  const m = pts.length;
  let area = 0;
  for (let i = 0; i < m; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % m];
    area += x1 * z2 - x2 * z1;
  }
  const s = area > 0 ? 1 : -1;
  const shifted = (a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    const nx = (s * dz) / L, nz = (-s * dx) / L;
    return [[a[0] + nx * d, a[1] + nz * d], [b[0] + nx * d, b[1] + nz * d]];
  };
  const out = [];
  for (let i = 0; i < m; i++) {
    const p0 = pts[(i + m - 1) % m], p1 = pts[i], p2 = pts[(i + 1) % m];
    const [a1, a2] = shifted(p0, p1);
    const [b1] = shifted(p1, p2);
    const [, b2] = shifted(p1, p2);
    const d1x = a2[0] - a1[0], d1z = a2[1] - a1[1];
    const d2x = b2[0] - b1[0], d2z = b2[1] - b1[1];
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-9) { out.push(a2); continue; }
    const tt = ((b1[0] - a1[0]) * d2z - (b1[1] - a1[1]) * d2x) / den;
    out.push([a1[0] + tt * d1x, a1[1] + tt * d1z]);
  }
  return out;
}

let OCT_W = null;
for (let w = 6.0; w > 1.0; w -= 0.05) {
  try {
    if (octHeight(w, OCT_NOZZLE, RAIL_CLEARANCE) + RAIL_CLEARANCE
        <= RAIL_TIP_H - 0.05) { OCT_W = w; break; }
  } catch (e) { /* below the width floor — keep shrinking */ }
}
if (OCT_W === null) {
  throw new Error("no printable octagon width fits the base-depth budget");
}

const SLOT_DEPTH =
  octHeight(OCT_W, OCT_NOZZLE, RAIL_CLEARANCE) + RAIL_CLEARANCE;
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
// Minimum pocket-floor dimensions for dual-rail mounting. The side
// screws (and their countersink cones) sit at (±T_TRACK_SPACING, 0) on
// the pocket floor, so the floor must be wide enough that the cone's
// outer edge clears the inner pocket wall by COUNTERSINK_EDGE_BUFFER on
// the X side, and tall enough that y=0 ± cone-radius also clears in Y.
const DUAL_RAIL_MIN_INNER_W =
  2 * T_TRACK_SPACING + COUNTERSINK_TOP_DIA + 2 * COUNTERSINK_EDGE_BUFFER;
const DUAL_RAIL_MIN_INNER_L =
  COUNTERSINK_TOP_DIA + 2 * COUNTERSINK_EDGE_BUFFER;

const BASE_DEPTH = SLOT_DEPTH + COUNTERSINK_FLOOR_THICK + COUNTERSINK_DEPTH;

const STOP_LEN = 8.0;

const CENTER_DIAMETER = 6.0;
const SCREW_DIAMETER = 4.0;
const PILOT_DIA = 2.369;
const REFERENCE_H = 1.0;
const CENTER_MARK_SIZE = 1.5;

// Outer taper for tenon fit-tuning. When enabled, the body is built
// as a loft from a slightly wider profile at z=0 (bottom) to a
// slightly narrower one at z=totalH (top). The user-typed dimension
// corresponds to the body's profile at TAPER_NOMINAL_FRACTION of the
// way from the wide (bottom) end to the narrow (top) end — closer to
// the narrow end, so most of the bearing-adjustment range is toward
// "make tenon bigger" (matches the OEM template bias).
const OUTER_TAPER_TOTAL = 3.0;          // bottom_W − top_W (mm)
const TAPER_NOMINAL_FRACTION = 2 / 3;
const TAPER_BOTTOM_DELTA = OUTER_TAPER_TOTAL * TAPER_NOMINAL_FRACTION;       // +2 mm
const TAPER_TOP_DELTA    = -OUTER_TAPER_TOTAL * (1 - TAPER_NOMINAL_FRACTION); // −1 mm

// Centering V-notch height — only the top NOTCH_H of the body has the
// notch so the bearing (which rides lower on the outer face) doesn't
// snag on it.
const NOTCH_H = 2.0;

// Joint fit-test pieces. Tiny mortise + tenon that exercise only the
// dovetail/rail joint, without the full template body. Print these to
// confirm the slot/rail clearance feels right before committing to a
// full-size template print.
const TEST_LENGTH   = 20.0;  // total length of each test piece, along Y
const TEST_STOP_LEN = 5.0;   // closed-cap region at +Y; remaining 15 mm is slide
const TEST_WALL_T   = 1.2;   // min wall thickness around the slot in the
                             // test mortise (measured at the slot's widest
                             // point — the catch).

// ── Helpers (replicad equivalents of the .py helpers) ───────────────────────
function roundedRectPrism(width, length, radius, height, z0 = 0) {
  // Centered on the origin in XY, extruded +Z by `height` from z=z0.
  return replicad
    .drawRoundedRectangle(width, length, radius)
    .sketchOnPlane("XY", z0)
    .extrude(height);
}

// Lofted rounded-rect frustum. Used for the tapered outer body when
// the "Outer taper" option is enabled. Bottom and top sketches share
// the same corner radius — the loft produces a smooth linear inset
// from bottom to top.
function roundedRectFrustum(bottomW, bottomL, topW, topL, radius, height, z0 = 0) {
  const bottomSketch = replicad
    .drawRoundedRectangle(bottomW, bottomL, radius)
    .sketchOnPlane("XY", z0);
  const topSketch = replicad
    .drawRoundedRectangle(topW, topL, radius)
    .sketchOnPlane("XY", z0 + height);
  return bottomSketch.loftWith(topSketch, { ruled: true });
}

function buildOuterBody(d, totalH) {
  if (!d.outerTaper) {
    return roundedRectPrism(d.OUTER_W, d.OUTER_L, d.OUTER_R, totalH, 0);
  }
  return roundedRectFrustum(
    d.OUTER_W + TAPER_BOTTOM_DELTA, d.OUTER_L + TAPER_BOTTOM_DELTA,
    d.OUTER_W + TAPER_TOP_DELTA,    d.OUTER_L + TAPER_TOP_DELTA,
    d.OUTER_R, totalH, 0
  );
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
  // Octagon MORTISE cavity: the tenon profile dilated by the clearance
  // (mitred) and dropped below the mating plane so it opens through the
  // template's back face. The name is kept so all call sites stay put.
  const pts = miterOffset(
    octProfile(OCT_W, OCT_NOZZLE, -1.0, RAIL_CLEARANCE).pts, RAIL_CLEARANCE);
  return dovetailExtrude(pts, length, centerY);
}

function railDovetailSolid(length, centerY) {
  // Octagon TENON at nominal size, rooted 1.2 mm into the rail base bar.
  const pts = octProfile(OCT_W, OCT_NOZZLE, -1.2, RAIL_CLEARANCE).pts;
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
  // Notch lives on the back of the template (z=0 face — the side that
  // mounts to the pantorouter holder). The front face is where the
  // bearing rides, so keep that face clear.
  //
  // Built as a pyramid (square base, tapered to a point at the apex)
  // so the cut on the outer wall reads as a triangle pointing inward
  // at the centerline rather than a flat-topped trapezoid.
  const side = CENTER_MARK_SIZE;
  const z0 = -0.01;
  const make = (sx) =>
    replicad
      .drawRectangle(side, side)
      .sketchOnPlane("XY", z0)
      .extrude(NOTCH_H + 0.01, {
        extrusionProfile: { profile: "linear", endFactor: 0.01 },
      })
      .translate([sx, 0, 0])
      .rotate(45, [sx, 0, z0 + NOTCH_H / 2], [0, 0, 1]);
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
  const dualRailFeasible =
    INNER_W >= DUAL_RAIL_MIN_INNER_W && INNER_L >= DUAL_RAIL_MIN_INNER_L;
  const dualRailMount = !!p.dualRailMount && dualRailFeasible;

  return {
    OUTER_W, OUTER_L, OUTER_R, INNER_W, INNER_L, INNER_R,
    TEMPLATE_DEPTH: p.templateDepth,
    dualRailMount,
    dualRailFeasible,
    outerTaper: !!p.outerTaper,
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

// X positions of the dovetail slots in the body. Single-rail has one
// slot at x=0; dual-rail has two slots at ±T_TRACK_SPACING (each
// engages its own outer T-track via its own copy of the rail piece).
// The user prints the rail file twice for dual-rail mode.
function slotXPositions(d) {
  return d.dualRailMount
    ? [-T_TRACK_SPACING, +T_TRACK_SPACING]
    : [0];
}

// ── Builders ────────────────────────────────────────────────────────────────
function buildTemplate(d) {
  const totalH = BASE_DEPTH + d.TEMPLATE_DEPTH;

  let body = buildOuterBody(d, totalH);

  // Dovetail slot(s) — open at -Y end, capped at +Y end (STOP_LEN).
  // Single-rail mount cuts one slot at x=0; dual-rail mount cuts a
  // slot at each ±T_TRACK_SPACING so two rail copies can engage the
  // pantorouter's two outer T-tracks.
  const slotLength = d.OUTER_L - STOP_LEN + 2.0;
  const slotCenterY = -STOP_LEN / 2 - 1.0;
  for (const sx of slotXPositions(d)) {
    body = body.cut(
      slotDovetailSolid(slotLength, slotCenterY).translate([sx, 0, 0])
    );
  }

  // Mortise pocket.
  body = body.cut(
    roundedRectPrism(d.INNER_W, d.INNER_L, d.INNER_R,
                     d.TEMPLATE_DEPTH + 1, BASE_DEPTH)
  );

  // V-notches sit at the body's back face (z=0) — track the actual
  // bottom width so the notch is centered on the outer surface even
  // with taper.
  const notchW = d.outerTaper ? d.OUTER_W + TAPER_BOTTOM_DELTA : d.OUTER_W;
  body = body.cut(centeringVNotches(notchW, totalH));

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

  // Embossed joint-size label on the top rim, running along the long
  // axis. Uses a monospace font for near-uniform stroke width.
  body = embossLabelOnTopRim(body, d);

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

function embossLabelOnTopRim(body, d) {
  if (d.displayWidth == null || d.displayLength == null) return body;
  const units = d.displayUnits || "mm";
  const label = `${fmtDim(d.displayWidth, units)} x ${fmtDim(d.displayLength, units)} ${units}`;

  // Sized to fit the rim strip alongside the pocket opening on the
  // top face. Cap at 6 mm so it stays readable; floor at 2 mm.
  const topW = d.outerTaper ? d.OUTER_W + TAPER_TOP_DELTA : d.OUTER_W;
  const rimWidth = (topW - d.INNER_W) / 2;
  const fontSize = Math.max(2.0, Math.min(6.0, rimWidth * 0.5));

  let textDrawing;
  try {
    textDrawing = replicad.drawText(label, { fontSize });
  } catch (e) {
    console.error("[label] drawText threw — is the font loaded?", e);
    return body;
  }
  if (!textDrawing) return body;

  let cx = 0, cy = 0;
  try {
    const bb = textDrawing.boundingBox;
    if (bb && Array.isArray(bb.bounds)) {
      cx = (bb.bounds[0][0] + bb.bounds[1][0]) / 2;
      cy = (bb.bounds[0][1] + bb.bounds[1][1]) / 2;
    } else if (bb && bb.center) {
      cx = bb.center[0] ?? bb.center.x ?? 0;
      cy = bb.center[1] ?? bb.center.y ?? 0;
    } else if (bb && bb.minPoint && bb.maxPoint) {
      cx = (bb.minPoint.x + bb.maxPoint.x) / 2;
      cy = (bb.minPoint.y + bb.maxPoint.y) / 2;
    }
  } catch (e) {
    console.error("[label] bbox extraction failed:", e);
  }

  const totalH = BASE_DEPTH + d.TEMPLATE_DEPTH;
  // Center of the +X rim strip (between the pocket wall and the body's
  // outer wall on the +X side of the top face).
  const rimCenterX = (d.INNER_W + topW) / 4;

  try {
    const textShape = textDrawing
      .sketchOnPlane("XY", totalH)
      .extrude(1.0)                              // embossed +1 mm above top face
      .translate([-cx, -cy, 0])                  // center bbox at origin
      .rotate(90, [0, 0, 0], [0, 0, 1])          // run text along Y (long axis)
      .translate([rimCenterX, 0, 0]);            // shift onto rim strip
    return body.fuse(textShape);
  } catch (e) {
    console.error("[label] sketch/extrude/fuse failed:", e);
    return body;
  }
}

function buildRail(d) {
  const base = railBaseSolid(d.OUTER_L, 0);
  const dtLen = d.OUTER_L - STOP_LEN - RAIL_CLEARANCE;
  const dtCenterY = -STOP_LEN / 2 - RAIL_CLEARANCE / 2;
  const dt = railDovetailSolid(dtLen, dtCenterY);
  const rail = base.fuse(dt);
  // NO holes are printed in the rail — its cross-section is too small.
  // Drill the center/screw holes through the GLUED stack after assembly,
  // guided by the template body's printed pilots.
  return rail;
}

// Visual-only "assembled" view: body and rail fused together in their
// as-mounted positions. Not for printing — print the body and rail
// separately and slide them together. Useful for previewing the joint
// geometry in a single STEP/STL file.
function buildAssembly(d) {
  let asm = buildTemplate(d);
  // Build a fresh rail per slot — `.fuse()` consumes its argument
  // (frees the underlying OCCT shape), so the same `rail` can't be
  // reused across iterations.
  for (const sx of slotXPositions(d)) {
    asm = asm.fuse(buildRail(d).translate([sx, 0, 0]));
  }
  return asm;
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

  // Body without side pilots (we'll cut the drilled hole below).
  let body = roundedRectPrism(d.OUTER_W, d.OUTER_L, d.OUTER_R, totalH, 0);
  for (const sx of slotXPositions(d)) {
    body = body.cut(
      slotDovetailSolid(d.OUTER_L - STOP_LEN + 2.0, -STOP_LEN / 2 - 1.0)
        .translate([sx, 0, 0])
    );
  }
  body = body.cut(
    roundedRectPrism(d.INNER_W, d.INNER_L, d.INNER_R,
                     d.TEMPLATE_DEPTH + 1, BASE_DEPTH)
  );
  body = body.cut(centeringVNotches(d.OUTER_W, totalH));

  // Rails at full slot dimensions (zero clearance) + bases — one per
  // slot. With dual-rail mode there are two; with single-rail one.
  let assembled = body;
  for (const sx of slotXPositions(d)) {
    const railUpper = slotDovetailSolid(d.OUTER_L - STOP_LEN, -STOP_LEN / 2)
      .translate([sx, 0, 0]);
    const railBase = railBaseSolid(d.OUTER_L, 0).translate([sx, 0, 0]);
    assembled = assembled.fuse(railUpper).fuse(railBase);
  }

  // Drilled-through screw clearance hole — over-drilled by 1 mm vs the
  // nominal SCREW_DIAMETER to simulate a real-world drill that wandered
  // a bit. If the screw still works flush in this looser hole, the
  // tighter as-printed final piece will be fine.
  const drilledDia = SCREW_DIAMETER + 1.0;
  const fullH = totalH + RAIL_BASE_H + 2;
  const zBot = -RAIL_BASE_H - 1;
  const drilled = replicad
    .drawCircle(drilledDia / 2)
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

  return {
    deriveSizes, screwPositions, slotXPositions,
    buildTemplate, buildRail, buildAssembly,
    buildScrewTest, buildMortiseTest, buildTenonTest,
    fmtDim,
    NOZZLE_W, RAIL_BASE_W, RAIL_BASE_H, RAIL_CLEARANCE,
    OCT_W, SLOT_DEPTH, BASE_DEPTH, STOP_LEN,
    T_TRACK_SPACING, DUAL_RAIL_MIN_INNER_W, DUAL_RAIL_MIN_INNER_L,
    CENTER_DIAMETER, SCREW_DIAMETER, PILOT_DIA,
  };
}
