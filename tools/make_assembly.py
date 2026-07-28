"""Compose the root assembly.step from the example part STEPs.

Run after regenerating example/ in the browser:
  py -3.12 -m tools.make_assembly

Unlike the browser's assembled demo (which fuses body + rail into one
solid for visual reference), this keeps the parts SEPARATE, named and
coloured per the cadkit conventions — each is individually show/hide-able
in the FreeCAD viewer hub, so the rail-in-slot joinery can be inspected.

Default (single-rail) mount: the exported rail is already in as-mounted
coordinates, so both parts sit at the origin.
"""
import pathlib

import cadquery as cq

from cadkit.cq_colors import color

ROOT = pathlib.Path(__file__).resolve().parent.parent

body = cq.importers.importStep(str(ROOT / "example" / "pantorouter-template-body.step"))
rail = cq.importers.importStep(str(ROOT / "example" / "pantorouter-template-rail.step"))

asm = cq.Assembly(name="pantorouter_template")
asm.add(body, name="template_body", color=color("#DC7A6E"))
asm.add(rail, name="floating_tenon_rail", color=color("#C7A55C"))
asm.save(str(ROOT / "assembly.step"), mode="default")
print("wrote assembly.step (separate body + rail parts)")
