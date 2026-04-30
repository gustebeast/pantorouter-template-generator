r"""
Pantorouter Template Generator

A parametric CadQuery port of FozzTexx's "Pantorouter Tenon Template"
(CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/),
simplified to a single-size dual-profile template: straight outer
walls (no taper) and a straight-walled inner pocket (no step rings),
so each profile cuts one precise size.

Output: pantorouter_template.step

The template is dual-profile:
  • OUTER perimeter — sized so a router bit, riding a guide bushing
    around the OUTSIDE of the template, cuts a tenon of nominal size
    (TENON_WIDTH × TENON_LENGTH) on the workpiece.
  • INNER pocket   — sized so the same bit + bushing dropped INTO the
    pocket cuts a matching mortise.

Both profiles obey the standard pantorouter pantograph relationship,
which is also what The Pantorouter Co.'s template-sizing calculator
uses (verified against the calculator's formula and the 12.7 mm bit /
22 mm bearing / 12.7 mm tenon / 28.6 mm template-height example row):

    outer_dim = 2·(tenon_dim + bit_dia) − bearing_dia      # tenon
    inner_dim = 2·(tenon_dim − bit_dia) + bearing_dia      # mortise

(The inner formula gets multiplied by SHRINK_COMP — see below.)

Both walls are vertical: the outer perimeter is a straight prism
(no draft taper), so the tenon size doesn't change with bushing
height. The inner pocket is also a straight prism (no step rings),
so the mortise size is fixed regardless of how deep the bit plunges.
One template = one tenon size + one matching mortise size.

A solid base layer (BASE_DEPTH thick) sits under the inner pocket —
the pocket is blind, not through. The center-locating hole and the
two screw holes pierce the base; the mortise pocket itself does not.

A separately-printed RAIL slides into a dovetail-shaped slot in the
back of the template. The rail's bottom protrudes below the
template and engages the pantorouter's T-track. The slot/rail
cross-section is a self-supporting "pointed dovetail":

       /\           ← peak (template's slot ceiling, ≤45° → printable)
     /    \
   /        \       ← widens to a catch (the dovetail undercut)
  -          -      ← narrows to a neck at the template's bottom face
  ──┐      ┌──      ← rail's wide base, sits below the template
    └──────┘            in the pantorouter's T-track

Both pieces print without supports: the rail prints flat on its
base (W_BASE side down); the template prints right-side-up
(mortise face up, slot opening on the build plate), with the slot's
peaked ceiling self-supporting at ≤45°.

Outputs (two files, per print):
  {STEM}_template.{step,stl}   the template body
  {STEM}_rail.{step,stl}       the matching rail

Mounting features:
  • Dovetail slot in the back of the template (full long-axis length,
    open at both rounded ends). Rail slides in from one end.
  • Two countersunk M4 screw holes, one each side of the center pin,
    positioned halfway between the center hole and the inner pocket
    wall along the long axis. The screws clamp template + rail to
    the carrier; matching clearance holes in the rail let the screws
    pass through.
  • One CENTER_DIAMETER center-locating hole through template + rail
    (registers on the carrier's center pin).
  • Two 45° centering V-notches, one on each long edge at x=±W/2,
    for visually aligning the workpiece centerline.

Material: PA6-GF, 0.4 mm nozzle.

SHRINK COMPENSATION:
  PA6-GF shrinks ~0.5–1.5 % depending on brand, glass loading, and
  print parameters — enough to matter for a precision template.
  Calibrate by test print:
    1. Set SHRINK_COMP = 1.000 for the first print.
    2. Cut a mortise with the printed template.
    3. Measure the actual mortise width (W_actual).
    4. Set SHRINK_COMP = TENON_WIDTH / W_actual and reprint.
  FozzTexx's PLA value of 51.8/49.68 ≈ 1.0427 is a starting point
  but is too aggressive for PA6-GF. Expect ~1.005–1.015 for PA6-GF.

Build:  py -3.12 pantorouter_template_generator.py
"""

import math
import argparse
import cadquery as cq

# ── CLI ─────────────────────────────────────────────────────────────────────
def parse_args():
    p = argparse.ArgumentParser(
        description="Generate a Pantorouter dual-profile (tenon + mortise) "
                    "template as STEP and STL. All measurements in mm.")
    p.add_argument("--tenon-width",  type=float, default=20.0,
                   help="Final tenon thickness in mm (short axis).")
    p.add_argument("--tenon-length", type=float, default=70.0,
                   help="Final tenon length in mm (long axis).")
    p.add_argument("--tenon-radius", type=float, default=None,
                   help="Corner radius of the finished tenon, in mm. A "
                        "round-bottom router bit can never cut a sharper "
                        "inside corner than its own radius, so the smallest "
                        "valid value is bit/2 (which is also the default if "
                        "omitted) — that gives crisp corners that exactly "
                        "match the bit. Larger values round the tenon "
                        "corners more (e.g. half the short axis = a fully "
                        "rounded 'obround' tenon). Smaller is impossible.")
    p.add_argument("--bit",     type=float, default=12.7,
                   help="Router bit diameter in mm.")
    p.add_argument("--bearing", type=float, default=12.0,
                   help="Guide bushing outer diameter in mm.")
    p.add_argument("--shrink-comp", type=float, default=1.000,
                   help="Inner-pocket shrink compensation. 1.000 = none. "
                        "Calibrate per material/printer.")
    p.add_argument("--template-depth", type=float, default=12.0,
                   help="Template Z height in mm.")
    p.add_argument("--output", default="pantorouter_template",
                   help="Output filename stem (no extension). STEP and STL "
                        "files will be written alongside.")
    return p.parse_args()


args = parse_args()

# ── Workpiece / cutter parameters (all mm) ──────────────────────────────────
TENON_WIDTH   = args.tenon_width
TENON_LENGTH  = args.tenon_length
OUTER_BIT     = args.bit
OUTER_BEARING = args.bearing
INNER_BIT     = args.bit
INNER_BEARING = args.bearing
TENON_RADIUS  = (args.tenon_radius
                 if args.tenon_radius is not None
                 else INNER_BIT / 2.0)

# Outer profile cuts air around the template, so material shrinkage helps
# rather than hurts. The inner pocket cuts material, so its real-world
# dimensions need to match the geometric target after print shrinkage.
SHRINK_COMP    = args.shrink_comp

# ── Template geometry ───────────────────────────────────────────────────────
TEMPLATE_DEPTH  = args.template_depth
CENTER_DIAMETER = 6.0   # final center-pin hole diameter (used as a
                        # REFERENCE only — the printed hole is just a 1 mm
                        # pilot, with this diameter shown as a wider
                        # counterbore in the top 1 mm of the body so the
                        # user can pick the matching drill bit and drill
                        # the rest by hand. See PILOT_DIA below.
SCREW_DIAMETER  = 4.0   # final M4 screw clearance diameter (REFERENCE
                        # only, same scheme).
PILOT_DIA       = 1.0   # actual printed hole diameter through the entire
                        # part. Sized to a #60 / 1 mm bit; gives a clean
                        # centered start when drilling out to final size.
REFERENCE_H     = 1.0   # depth of the full-diameter reference counterbore
                        # at the top of the template body. Once printed,
                        # find a drill bit that matches the counterbore
                        # diameter and drill straight down through the
                        # pilot.
CENTER_MARK_SIZE = 1.5  # side of the 45°-rotated cube subtracted at
                        # the long-edge midpoints to form V-notches

# Dovetail slot / rail. The slot runs along the long axis, open at both
# ends (rail slides in lengthwise). Cross-section in XZ:
#     z = SLOT_DEPTH          peak (single point at x=0)
#     z = SLOT_CATCH_H        widest, at ±RAIL_CATCH_W/2
#     z = 0                   slot opening at template bottom face,
#                             at ±RAIL_NECK_W/2
# Below z=0 (rail only): rectangular base ±RAIL_BASE_W/2 wide, RAIL_BASE_H
# tall. The base is the part that engages the pantorouter's T-track.
NOZZLE_W         = 0.4   # printer nozzle width.
RAIL_NECK_W      = 4.0   # slot opening width = waist width (between the
                         # two stacked catches).
RAIL_CATCH_W     = 6.0   # widest width — same on the lower and upper
                         # catch, since each is its own arrowhead.
RAIL_TOP_FLAT    = 1.2   # flat width at the very top of the dovetail.
                         # Sized to the PILOT_DIA (1 mm) plus a bit of
                         # clearance, so the pilot passes through with
                         # a small wall of material on either side.
                         # Both rail and slot use the same flat, so
                         # they mate flush.
RAIL_BASE_W      = 8.0   # rail's wide base — sized to the pantorouter
                         # T-track. Below the template, no clearance
                         # against the slot.
RAIL_BASE_H      = 1.8   # depth the rail's base sticks below the template.
RAIL_CLEARANCE   = 0.2        # per-side gap between rail and slot, in
                              # all three directions (catch widths, neck
                              # width, vertical under tip, AND in Y at
                              # the closed end of the slot). Sized to
                              # the nozzle: anything below NOZZLE_W is
                              # in the slicer's approximation zone, so
                              # making the gap = NOZZLE_W keeps it
                              # reliably above print tolerance and
                              # leaves bond-line room for CA / PVA /
                              # epoxy. Drop toward ~0.15 mm if you want
                              # a press-fit without glue.

# All-45° dovetail profile, going from the slot opening UP to the
# dulled tip:
#   1. Slot opening — wider than NECK_W due to a lead-in chamfer.
#   2. 45° lead-in chamfer (line 4 in the user's numbering, length
#      RAIL_LEAD_IN_LEN) narrows down-and-inward to the SHOULDER.
#   3. SHOULDER — narrowest point above the opening, at NECK_W wide.
#   4. 45° body wall (line 3) flares back outward to the upper catch.
#   5. Upper catch widest, at CATCH_W wide.
#   6. 45° peak wall (lines 1+2) narrows inward to the dulled tip.
#   7. Dulled tip flat, TOP_FLAT wide.
# Each successive segment is at 90° to the previous — a pure zig-zag.
RAIL_LEAD_IN_LEN = 0.8     # diagonal length (mm) of the lead-in chamfer
                           # at the bottom of the dovetail. 2x nozzle
                           # width so the slicer prints the chamfer
                           # cleanly. Tradeoff: longer chamfer = wider
                           # slot opening = more lead-in for inserting
                           # the rail, but shallower effective dovetail.

_LEAD_IN_DX = RAIL_LEAD_IN_LEN * math.sin(math.radians(45.0))
_LEAD_IN_DZ = RAIL_LEAD_IN_LEN * math.cos(math.radians(45.0))

RAIL_OPENING_HALF_W = RAIL_NECK_W / 2.0 + _LEAD_IN_DX
RAIL_SHOULDER_Z     = _LEAD_IN_DZ
RAIL_UPPER_CATCH_H  = RAIL_SHOULDER_Z + (RAIL_CATCH_W - RAIL_NECK_W) / 2.0
RAIL_TIP_H          = (RAIL_UPPER_CATCH_H +
                       (RAIL_CATCH_W - RAIL_TOP_FLAT) / 2.0)

SLOT_DEPTH = RAIL_TIP_H
BASE_DEPTH = SLOT_DEPTH + 1.0  # solid floor under the mortise pocket;
                               # ≥SLOT_DEPTH so the slot doesn't break
                               # through to the pocket floor.

# Stop / registration. The dovetail portion of the rail ends short of
# the rail's full length on the leading (+Y) end, leaving STOP_LEN of
# base-only tail. The slot's dovetail ends at the matching position,
# leaving a STOP_LEN cap of solid template material at the +Y end. When
# the rail is fully inserted, the dovetail's leading edge butts against
# the cap → fixed insertion depth, with both ends of the rail flush
# with the body. Vertical (90°) faces only — no overhangs introduced.
STOP_LEN         = 8.0

# Joint fit-test pieces. Small printable mortise + tenon that exercise
# only the dovetail/rail joint, without the rest of the template body.
# Print these first to verify the slot/rail clearance before committing
# to the full-size template print.
TEST_LENGTH      = 20.0  # total length of each test piece, along Y.
TEST_STOP_LEN    = 10.0  # length of the closed-cap region (stop) at +Y.
                         # Remaining 10 mm is the slot/rail engagement.
TEST_WALL_T      = 1.2   # minimum wall thickness around the slot in
                         # the test mortise (measured at the slot's
                         # widest point — the catch at CATCH_W).
TEST_FLAT_THICK  = 2.0   # thickness of the flat clearance-comparison
                         # wafers along Y. Each wafer is just the
                         # XZ cross-section of its piece, extruded a
                         # few mm. Print both, lay them flat on a
                         # surface side-by-side, and you can see the
                         # actual XY-plane gap between rail and slot.

OUTPUT_STEM = args.output

# ── Derived sizes (pantorouter pantograph math) ─────────────────────────────
# Outer perimeter (tenon profile): the bit cuts a path offset OUTSIDE of
# where the bushing rides, so the template must be smaller than the tenon
# by (bit − bearing/2) on each side. The 2× factor is the pantorouter's
# 2:1 pantograph reduction.
OUTER_W = (TENON_WIDTH  + OUTER_BIT) * 2 - OUTER_BEARING
OUTER_L = (TENON_LENGTH + OUTER_BIT) * 2 - OUTER_BEARING
OUTER_R = ((TENON_RADIUS * 2 + OUTER_BIT) * 2 - OUTER_BEARING) / 2

# Inner pocket (mortise profile): bit cuts INSIDE where the bushing rides,
# so the pocket must be larger than the mortise. Sign on the bit term
# flips. SHRINK_COMP scales up to cancel print shrinkage.
INNER_W = ((TENON_WIDTH  - INNER_BIT) * 2 + INNER_BEARING) * SHRINK_COMP
INNER_L = ((TENON_LENGTH - INNER_BIT) * 2 + INNER_BEARING) * SHRINK_COMP
INNER_R = (((TENON_RADIUS * 2 - INNER_BIT) * 2 + INNER_BEARING) / 2) * SHRINK_COMP

# Sanity checks. INNER_R must be > 0 (i.e. bit can actually fit inside the
# corner radius); inner pocket must have positive size.
assert INNER_W > 0 and INNER_L > 0, (
    f"Inner pocket has zero/negative size: bit too large for tenon. "
    f"INNER_W={INNER_W:.2f} INNER_L={INNER_L:.2f}")
assert INNER_R > 0, (
    f"Inner corner radius collapsed: tenon corner radius is smaller than "
    f"bit radius — bit physically can't reach the corners. "
    f"INNER_R={INNER_R:.3f}")


# ── Helpers ─────────────────────────────────────────────────────────────────
def rounded_rect_solid(width, length, radius, height, z0=0.0):
    """Centered rounded-rect prism of given height starting at z0."""
    return (cq.Workplane("XY")
            .workplane(offset=z0)
            .sketch()
            .rect(width, length)
            .vertices()
            .fillet(radius)
            .finalize()
            .extrude(height))


def centering_vnotches(width):
    """Two 45°-rotated square prisms at x=±width/2, used as cutters to
    form V-notches on the long edges. Span the full Z so they intersect
    the body at every height."""
    side = CENTER_MARK_SIZE
    total_h = BASE_DEPTH + TEMPLATE_DEPTH
    height = total_h + 2.0
    z0 = -1.0
    notches = None
    for sx in (-width / 2.0, +width / 2.0):
        n = (cq.Workplane("XY").workplane(offset=z0)
             .center(sx, 0.0).rect(side, side).extrude(height)
             .rotateAboutCenter((0, 0, 1), 45))
        notches = n if notches is None else notches.union(n)
    return notches


def _dovetail_extrude(pts, length, center_y):
    return (cq.Workplane("XZ")
            .polyline(pts).close()
            .extrude(length / 2.0, both=True)
            .translate((0, center_y, 0)))


def slot_dovetail_solid(length, center_y):
    """8-vertex all-45° dovetail void. Going up from the slot opening:
    chamfered opening → shoulder (narrowest, NECK_W) → upper catch
    widest (CATCH_W) → dulled tip (TOP_FLAT). Each segment is at 90°
    to the previous one, all 45° from vertical."""
    pts = [
        (-RAIL_OPENING_HALF_W,  0.0),
        (-RAIL_NECK_W   / 2.0,  RAIL_SHOULDER_Z),
        (-RAIL_CATCH_W  / 2.0,  RAIL_UPPER_CATCH_H),
        (-RAIL_TOP_FLAT / 2.0,  RAIL_TIP_H),
        ( RAIL_TOP_FLAT / 2.0,  RAIL_TIP_H),
        ( RAIL_CATCH_W  / 2.0,  RAIL_UPPER_CATCH_H),
        ( RAIL_NECK_W   / 2.0,  RAIL_SHOULDER_Z),
        ( RAIL_OPENING_HALF_W,  0.0),
    ]
    return _dovetail_extrude(pts, length, center_y)


def rail_dovetail_solid(length, center_y):
    """Rail's dovetail. Same 8-vertex profile as the slot, offset
    inward by c horizontally on every width and downward by c on the
    tip. Walls remain parallel to the slot's, so the gap is uniformly
    ~c everywhere."""
    c = RAIL_CLEARANCE
    neck_w_rail     = RAIL_NECK_W  - 2 * c
    catch_w_rail    = RAIL_CATCH_W - 2 * c
    opening_half_w  = RAIL_OPENING_HALF_W - c
    tip_z           = RAIL_TIP_H - c
    pts = [
        (-opening_half_w,        0.0),
        (-neck_w_rail   / 2.0,  RAIL_SHOULDER_Z),
        (-catch_w_rail  / 2.0,  RAIL_UPPER_CATCH_H),
        (-RAIL_TOP_FLAT / 2.0,  tip_z),
        ( RAIL_TOP_FLAT / 2.0,  tip_z),
        ( catch_w_rail  / 2.0,  RAIL_UPPER_CATCH_H),
        ( neck_w_rail   / 2.0,  RAIL_SHOULDER_Z),
        ( opening_half_w,        0.0),
    ]
    return _dovetail_extrude(pts, length, center_y)


def rail_base_solid(length, center_y):
    """Just the rail's wide base (z < 0): the part below the template
    that engages the pantorouter's T-track. Runs the full rail length."""
    return (cq.Workplane("XZ")
            .center(0.0, -RAIL_BASE_H / 2.0)
            .rect(RAIL_BASE_W, RAIL_BASE_H)
            .extrude(length / 2.0, both=True)
            .translate((0, center_y, 0)))


def pilot_hole_with_reference(reference_dia, z_bottom, z_top):
    """A PILOT_DIA pilot hole from z_bottom to z_top, with the topmost
    REFERENCE_H widened to reference_dia. The pilot is what gets
    printed; the reference counterbore at the top is a visual cue so
    the user can pick a matching drill bit and drill out to final size
    after printing."""
    height = z_top - z_bottom
    pilot = (cq.Workplane("XY").workplane(offset=z_bottom)
             .circle(PILOT_DIA / 2.0).extrude(height))
    ref = (cq.Workplane("XY").workplane(offset=z_top - REFERENCE_H)
           .circle(reference_dia / 2.0).extrude(REFERENCE_H + 0.01))
    return pilot.union(ref)


def screw_y_position():
    """Common to template and rail: screw holes are centered on x=0,
    positioned halfway between the center pin (y=0) and the inner
    pocket wall (y=INNER_L/2)."""
    return INNER_L / 4.0


# ── Build ───────────────────────────────────────────────────────────────────
def build_template():
    total_h = BASE_DEPTH + TEMPLATE_DEPTH

    # 1. Outer body — straight prism over the full height (base + template).
    body = rounded_rect_solid(OUTER_W, OUTER_L, OUTER_R,
                              height=total_h, z0=0.0)

    # 2. Subtract the dovetail slot. Slot is open at the −Y end (rail
    # slides in from there) and closed at the +Y end (a STOP_LEN cap of
    # solid template material acts as the registration stop). Slot
    # length = OUTER_L − STOP_LEN; we extend an extra 2 mm past the −Y
    # body edge so the slot punches cleanly through the rounded end.
    slot_length = OUTER_L - STOP_LEN + 2.0
    slot_center_y = -STOP_LEN / 2.0 - 1.0   # shifts the extra 2 mm onto
                                            # the −Y (open) end only
    body = body.cut(slot_dovetail_solid(slot_length, slot_center_y))

    # 3. Subtract the mortise pocket — blind, sits ON the base layer.
    pocket = rounded_rect_solid(INNER_W, INNER_L, INNER_R,
                                height=TEMPLATE_DEPTH + 1.0, z0=BASE_DEPTH)
    body = body.cut(pocket)

    # 4. Subtract the centering V-notches on the long edges.
    body = body.cut(centering_vnotches(OUTER_W))

    # 5. Center-locating pilot hole (PILOT_DIA through the part) +
    # CENTER_DIAMETER reference counterbore embedded in the TOP OF THE
    # BASE LAYER (= the mortise-pocket floor at z=BASE_DEPTH). The
    # counterbore is visible from above when looking into the empty
    # mortise pocket, since that's where the pilots actually terminate
    # in solid material — anything above z=BASE_DEPTH is just open air
    # in the pocket.
    body = body.cut(pilot_hole_with_reference(
        reference_dia=CENTER_DIAMETER,
        z_bottom=-1.0, z_top=BASE_DEPTH))

    # 6. Two M4 mounting holes along the LONG axis, same scheme.
    screw_y = screw_y_position()
    for sy in (-screw_y, +screw_y):
        h = pilot_hole_with_reference(
            reference_dia=SCREW_DIAMETER,
            z_bottom=-1.0, z_top=BASE_DEPTH)
        body = body.cut(h.translate((0, sy, 0)))

    # The pilots also need to continue all the way through the part
    # above z=BASE_DEPTH (so the mortise pocket isn't blocked by their
    # absence — well, they're not blocking anything, but for the post-
    # print drill bit to pass cleanly through, we want the pilot's
    # geometric column to extend up through any future-solid material.
    # For the current pocket-only design, no extra material to remove
    # above BASE_DEPTH at the hole positions — pocket already covers it.

    return body


def build_rail():
    """Rail in the same coord frame as the template (so they can be
    assembled directly). Two parts unioned:
      • Base: full body length OUTER_L, runs the entire underside
        — including the STOP_LEN tail that sits below the body's
        closed-cap region.
      • Dovetail: shorter (length OUTER_L − STOP_LEN), shifted toward
        −Y so its leading edge butts against the slot's stop wall
        when the rail's base is flush with the body."""
    base = rail_base_solid(OUTER_L, center_y=0.0)
    # Dovetail length is shortened by RAIL_CLEARANCE on the LEADING (+Y)
    # end so when the base is flush with both body ends, the dovetail's
    # leading edge stops RAIL_CLEARANCE short of the slot's closed cap.
    # That gap is glue room + Y print-tolerance budget; the trailing
    # (−Y) end of the rail enters through the open end of the slot, so
    # no clearance is needed there.
    dt_len = OUTER_L - STOP_LEN - RAIL_CLEARANCE
    dt_center_y = -STOP_LEN / 2.0 - RAIL_CLEARANCE / 2.0
    dt = rail_dovetail_solid(dt_len, center_y=dt_center_y)
    rail = base.union(dt)

    # PILOT_DIA pilot holes through the rail at the same x,y positions
    # as the template's holes — so when the user drills out the
    # template's pilots to final size, the same drill bit continues
    # cleanly through the rail. No reference counterbore needed on the
    # rail (the reference is on the template's top face).
    pilot_h = RAIL_BASE_H + SLOT_DEPTH + 2.0
    pilot_z0 = -RAIL_BASE_H - 1.0
    rail = rail.cut(
        cq.Workplane("XY").workplane(offset=pilot_z0)
          .circle(PILOT_DIA / 2.0)
          .extrude(pilot_h))
    screw_y = screw_y_position()
    for sy in (-screw_y, +screw_y):
        rail = rail.cut(
            cq.Workplane("XY").workplane(offset=pilot_z0)
              .center(0, sy)
              .circle(PILOT_DIA / 2.0)
              .extrude(pilot_h))

    return rail


def build_assembly():
    """Both pieces in their as-mounted positions, for visual / fit
    verification only. Not for printing — print the template and rail
    separately."""
    asm = cq.Assembly(name="pantorouter_template_assembly")
    asm.add(build_template(), name="template", color=cq.Color(0.7, 0.7, 0.75))
    asm.add(build_rail(),     name="rail",     color=cq.Color(0.85, 0.55, 0.20))
    return asm


def build_test_mortise():
    """Small rectangular block with the dovetail slot — for printing a
    quick fit test of the joint before committing to the full template.
    Outer X width sized so there's TEST_WALL_T of material around the
    slot's widest point (the catch). Outer Y length is TEST_LENGTH,
    with TEST_STOP_LEN of solid cap at +Y; rail slides in from −Y."""
    outer_w = RAIL_CATCH_W + 2 * TEST_WALL_T
    outer_l = TEST_LENGTH
    outer_h = BASE_DEPTH

    body = (cq.Workplane("XY")
            .box(outer_w, outer_l, outer_h, centered=(True, True, False)))

    # Slot extends from past the −Y end (so it cuts cleanly through)
    # to TEST_STOP_LEN short of the +Y end (leaving the cap).
    slot_length = (outer_l - TEST_STOP_LEN) + 2.0
    slot_center_y = -TEST_STOP_LEN / 2.0 - 1.0
    body = body.cut(slot_dovetail_solid(slot_length, slot_center_y))

    return body


def build_test_tenon():
    """Small rail piece matching the test mortise. Same dovetail and
    base profile as the full rail, but TEST_LENGTH long with no
    pilot/screw holes."""
    base = rail_base_solid(TEST_LENGTH, center_y=0.0)
    dt_len = (TEST_LENGTH - TEST_STOP_LEN) - RAIL_CLEARANCE
    dt_center_y = -TEST_STOP_LEN / 2.0 - RAIL_CLEARANCE / 2.0
    dt = rail_dovetail_solid(dt_len, center_y=dt_center_y)
    return base.union(dt)


def build_flat_mortise():
    """Just the slot's XZ cross-section, extruded TEST_FLAT_THICK along
    Y. A thin wafer with the slot cut as a void. Print and lay flat
    next to build_flat_tenon() to see the joint clearance directly.

    The block extends from z=-RAIL_BASE_H to z=BASE_DEPTH so its bottom
    sits at the same level as the flat tenon's base. With both wafers
    on a flat surface, the slot opening is at the same height as the
    tenon's neck-to-base step — slide the tenon into the slot directly."""
    outer_w = RAIL_CATCH_W + 2 * TEST_WALL_T
    outer_h = BASE_DEPTH + RAIL_BASE_H

    block = (cq.Workplane("XY").workplane(offset=-RAIL_BASE_H)
             .box(outer_w, TEST_FLAT_THICK, outer_h,
                  centered=(True, True, False)))
    slot = slot_dovetail_solid(TEST_FLAT_THICK + 2.0, center_y=0.0)
    return block.cut(slot)


def build_flat_tenon():
    """Just the rail's XZ cross-section (dovetail + base), extruded
    TEST_FLAT_THICK along Y. Lay flat next to build_flat_mortise() to
    visually compare the gap on each wall."""
    base = rail_base_solid(TEST_FLAT_THICK, center_y=0.0)
    dt   = rail_dovetail_solid(TEST_FLAT_THICK, center_y=0.0)
    return base.union(dt)


if __name__ == "__main__":
    print(f"Tenon: {TENON_WIDTH:.2f} x {TENON_LENGTH:.2f} mm")
    print(f"Bit: {OUTER_BIT:.2f} mm  Bearing: {OUTER_BEARING:.2f} mm")
    print(f"Outer profile: {OUTER_W:.2f} x {OUTER_L:.2f} mm  R={OUTER_R:.2f}")
    print(f"Inner pocket : {INNER_W:.2f} x {INNER_L:.2f} mm  R={INNER_R:.2f}")
    print(f"Slot         : opening {2*RAIL_OPENING_HALF_W:.2f} mm "
          f"-> neck (shoulder) {RAIL_NECK_W} mm -> catch {RAIL_CATCH_W} "
          f"mm -> tip flat {RAIL_TOP_FLAT} mm, "
          f"all 45 deg, depth {SLOT_DEPTH:.2f} mm "
          f"(lead-in chamfer {RAIL_LEAD_IN_LEN} mm)")
    print(f"Holes        : {PILOT_DIA} mm pilots (drill out post-print "
          f"to: center {CENTER_DIAMETER} mm, screws {SCREW_DIAMETER} mm)")
    print(f"Rail         : base {RAIL_BASE_W} x {RAIL_BASE_H} mm, "
          f"length {OUTER_L:.2f} mm (dovetail "
          f"{OUTER_L - STOP_LEN - RAIL_CLEARANCE:.2f} mm + "
          f"{STOP_LEN:.0f} mm stop tail + {RAIL_CLEARANCE} mm Y gap)")
    print(f"Fit clearance: {RAIL_CLEARANCE} mm/side (slip-fit + glue room)")
    print(f"Shrink comp  : {SHRINK_COMP:.4f}")
    print()

    parts = [
        ("_template",     build_template()),
        ("_rail",         build_rail()),
        ("_test_mortise", build_test_mortise()),
        ("_test_tenon",   build_test_tenon()),
        ("_flat_mortise", build_flat_mortise()),
        ("_flat_tenon",   build_flat_tenon()),
    ]
    for suffix, part in parts:
        path = OUTPUT_STEM + suffix + ".step"
        cq.exporters.export(part, path)
        print(f"Wrote {path}")

    asm_path = OUTPUT_STEM + "_assembly.step"
    build_assembly().save(asm_path, cq.exporters.ExportTypes.STEP)
    print(f"Wrote {asm_path}")
