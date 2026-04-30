// Pantorouter Template Generator — browser port.
// Geometry mirrors pantorouter_template_generator.py (the reference Python
// implementation). Keep the two in sync if you edit one — defaults,
// constants, and formulas should match line-for-line.

import opencascade from "https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.0/src/replicad_single.js";
import * as replicad from "https://cdn.jsdelivr.net/npm/replicad@0.21.0/dist/replicad.js";
import * as THREE from "https://esm.sh/three@0.160.0";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";

// ── Constants (pulled from the .py reference) ───────────────────────────────
const NOZZLE_W = 0.4;

const RAIL_NECK_W = 4.0;
const RAIL_CATCH_W = 6.0;
const RAIL_TOP_FLAT = 1.2;
const RAIL_BASE_W = 8.0;
const RAIL_BASE_H = 1.8;
const RAIL_CLEARANCE = 0.2;

const RAIL_LEAD_IN_LEN = 0.8;

const _LEAD_IN_DX = RAIL_LEAD_IN_LEN * Math.sin((45 * Math.PI) / 180);
const _LEAD_IN_DZ = RAIL_LEAD_IN_LEN * Math.cos((45 * Math.PI) / 180);

const RAIL_OPENING_HALF_W = RAIL_NECK_W / 2 + _LEAD_IN_DX;
const RAIL_SHOULDER_Z = _LEAD_IN_DZ;
const RAIL_UPPER_CATCH_H = RAIL_SHOULDER_Z + (RAIL_CATCH_W - RAIL_NECK_W) / 2;
const RAIL_TIP_H = RAIL_UPPER_CATCH_H + (RAIL_CATCH_W - RAIL_TOP_FLAT) / 2;

const SLOT_DEPTH = RAIL_TIP_H;
const BASE_DEPTH = SLOT_DEPTH + 1.0;

const STOP_LEN = 8.0;

const CENTER_DIAMETER = 6.0;
const SCREW_DIAMETER = 4.0;
const PILOT_DIA = 1.0;
const REFERENCE_H = 1.0;
const CENTER_MARK_SIZE = 1.5;

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

  return {
    OUTER_W, OUTER_L, OUTER_R, INNER_W, INNER_L, INNER_R,
    TEMPLATE_DEPTH: p.templateDepth,
  };
}

function screwYPosition(d) {
  return d.INNER_L / 4;
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

  // Two M4 screw pilots, ditto.
  const sy = screwYPosition(d);
  for (const yy of [-sy, +sy]) {
    body = body.cut(
      pilotHoleWithReference(SCREW_DIAMETER, -1.0, BASE_DEPTH).translate([0, yy, 0])
    );
  }

  return body;
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
  const sy = screwYPosition(d);
  for (const yy of [-sy, +sy]) {
    rail = rail.cut(
      replicad
        .drawCircle(PILOT_DIA / 2)
        .sketchOnPlane("XY", pilotZ0)
        .extrude(pilotH)
        .translate([0, yy, 0])
    );
  }
  return rail;
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
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(80, -120, 200);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-100, 80, 50);
  scene.add(fill);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  // Default view (camera back from origin) until shapes load.
  camera.position.set(120, -180, 100);
  controls.target.set(0, 0, 5);

  resizePreview();
  window.addEventListener("resize", resizePreview);

  // Wire visibility checkboxes (one per part).
  for (const key of Object.keys(previewParts)) {
    const cb = document.getElementById("show-" + key);
    if (cb) {
      cb.addEventListener("change", () => {
        for (const obj of previewParts[key]) obj.visible = cb.checked;
      });
    }
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

function readParams() {
  const tenonRadiusRaw = $("tenonRadius").value.trim();
  return {
    tenonWidth: parseFloat($("tenonWidth").value),
    tenonLength: parseFloat($("tenonLength").value),
    tenonRadius: tenonRadiusRaw === "" ? null : parseFloat(tenonRadiusRaw),
    bit: parseFloat($("bit").value),
    bearing: parseFloat($("bearing").value),
    shrinkComp: parseFloat($("shrinkComp").value),
    templateDepth: parseFloat($("templateDepth").value),
  };
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

    const parts = [
      ["body", "pantorouter-template-body.step", () => buildTemplate(d), 0xb0b0b0],
      ["rail", "pantorouter-template-rail.step", () => buildRail(d),     0xd9882a],
    ];

    for (const [partKey, filename, build, color] of parts) {
      setStatus(`Building ${filename}…`, "info");
      // Yield to the UI thread so the status text actually renders.
      await new Promise((r) => setTimeout(r, 0));
      const shape = build();
      const blob = await shape.blobSTEP();
      addDownload(filename, blob);
      addShapeToPreview(shape, color, partKey);
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
    btn.textContent = "Generate STEP files";
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  initPreview();
  setStatus("Loading CAD kernel (~5 MB) — this only happens once.", "info");
  try {
    await bootKernel();
    setStatus("Ready. Adjust parameters and click Generate.", "ok");
    const btn = $("generate");
    btn.disabled = false;
    btn.textContent = "Generate STEP files";
    btn.addEventListener("click", generateAll);
  } catch (e) {
    console.error(e);
    setStatus("Failed to load CAD kernel: " + e.message, "error");
  }
})();
