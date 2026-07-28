// Pantorouter Template Generator — browser port.
// Geometry mirrors pantorouter_template_generator.py (the reference Python
// implementation). Keep the two in sync if you edit one — defaults,
// constants, and formulas should match line-for-line.

import opencascade from "https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.0/src/replicad_single.js";
import * as replicad from "https://cdn.jsdelivr.net/npm/replicad@0.21.0/dist/replicad.js";
import { makeBuilders } from "./geometry.js?v=1";
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

// ── Geometry layer (shared with the headless Node runner) ────────────
const {
  deriveSizes, screwPositions, slotXPositions,
  buildTemplate, buildRail, buildAssembly,
  buildScrewTest, buildMortiseTest, buildTenonTest,
  fmtDim,
  NOZZLE_W, RAIL_BASE_W, RAIL_BASE_H, RAIL_CLEARANCE,
  OCT_W, SLOT_DEPTH, BASE_DEPTH, STOP_LEN,
  T_TRACK_SPACING, DUAL_RAIL_MIN_INNER_W, DUAL_RAIL_MIN_INNER_L,
  CENTER_DIAMETER, SCREW_DIAMETER, PILOT_DIA,
} = makeBuilders(replicad);

// ── Kernel boot ─────────────────────────────────────────────────────────────
let kernelReady = false;

async function bootKernel() {
  // Initialize OpenCascade WASM and bind it into replicad.
  const OC = await opencascade({
    locateFile: (path) =>
      `https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.0/src/${path}`,
  });
  replicad.setOC(OC);
  // Load a default font for replicad's drawText. Without this, the
  // font registry is empty and drawText can't render anything — the
  // pocket-floor deboss won't appear. JetBrains Mono is a CORS-friendly
  // monospace TTF on jsdelivr.
  try {
    const font = await replicad.loadFont("fonts/Boldwinn.ttf", "default");
    console.log("[font] loaded:", font);
  } catch (e) {
    console.error("[font] failed to load deboss font:", e);
  }
  kernelReady = true;
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
    outerTaper: $("outerTaper").checked,
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
  let innerW, innerL;
  try {
    const p = readParams();
    if ([p.tenonWidth, p.tenonLength, p.bit, p.bearing, p.shrinkComp].some(Number.isNaN)) {
      return;
    }
    innerW = ((p.tenonWidth - p.bit) * 2 + p.bearing) * p.shrinkComp;
    innerL = ((p.tenonLength - p.bit) * 2 + p.bearing) * p.shrinkComp;
  } catch {
    return;
  }
  const feasibleW = innerW >= DUAL_RAIL_MIN_INNER_W;
  const feasibleL = innerL >= DUAL_RAIL_MIN_INNER_L;
  const feasible = feasibleW && feasibleL && innerW > 0 && innerL > 0;
  cb.disabled = !feasible;
  const wasChecked = cb.checked;
  if (!feasible) {
    cb.checked = false;
    if (wasChecked) updateInstructions();
    const limiter = !feasibleW
      ? `pocket short axis is ${innerW.toFixed(1)} mm; needs ≥ ${DUAL_RAIL_MIN_INNER_W.toFixed(1)} mm`
      : `pocket long axis is ${innerL.toFixed(1)} mm; needs ≥ ${DUAL_RAIL_MIN_INNER_L.toFixed(1)} mm`;
    status.textContent =
      `Disabled — ${limiter} so the cone bezels land on the pocket ` +
      `floor with ${COUNTERSINK_EDGE_BUFFER} mm clearance from the inner wall.`;
    status.style.color = "var(--muted)";
  } else {
    status.textContent =
      `Available — pocket floor is ${innerW.toFixed(1)} × ${innerL.toFixed(1)} mm.`;
    status.style.color = "";
  }
}

function updateInstructions() {
  const ol = document.getElementById("instructions");
  if (!ol) return;
  const dual = !!document.getElementById("dualRailMount")?.checked;
  const optional =
    "(Optional) Print the test mortise and tenon and ensure they fit together well. You can also print the screw test to see how the two mounting holes will fit on your Pantorouter's T track";
  const steps = dual
    ? [
        optional,
        "Print the body and two copies of the rail",
        "Apply super glue to each rail",
        "Slide one rail into each slot in the body",
        "Wait for the glue to cure",
        "Use 4 mm and 6 mm drill bits to widen the pilot holes — drill straight through the base plate AND the glued rails (rails print solid; the body's pilots guide the bit)",
      ]
    : [
        optional,
        "Print the body and the rail",
        "Apply super glue to the rail",
        "Slide the rail into the body",
        "Wait for the glue to cure",
        "Use 4 mm and 6 mm drill bits to widen the pilot holes — drill straight through the base plate AND the glued rails (rails print solid; the body's pilots guide the bit)",
      ];
  ol.innerHTML = "";
  for (const s of steps) {
    const li = document.createElement("li");
    li.textContent = s;
    ol.appendChild(li);
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
      ["assembled",   "pantorouter-template-assembled-demo", () => buildAssembly(d),  null],
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
      if (color === null) continue;
      // The downloaded rail file has just one rail piece. In dual-rail
      // mode the user prints it twice and slots one into each slot,
      // so the preview reflects that by rendering a copy at each slot
      // position.
      if (partKey === "rail") {
        // Mesh once at origin; place a THREE-side copy at each slot
        // position. Translating the same replicad shape multiple times
        // is unreliable across replicad versions (some mutate, some
        // free the underlying OCCT shape after fuse).
        const beforeCount = previewParts[partKey].length;
        addShapeToPreview(shape, color, partKey);
        const newObjs = previewParts[partKey].slice(beforeCount);
        const positions = slotXPositions(d);
        // First copy: move existing objects to positions[0].
        for (const obj of newObjs) obj.position.x += positions[0];
        // Additional copies: clone for each remaining slot position.
        for (let i = 1; i < positions.length; i++) {
          for (const obj of newObjs) {
            const clone = obj.clone();
            clone.position.x = obj.position.x - positions[0] + positions[i];
            scene.add(clone);
            previewParts[partKey].push(clone);
          }
        }
      } else {
        addShapeToPreview(shape, color, partKey);
      }
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
    updateInstructions();
    document
      .getElementById("dualRailMount")
      ?.addEventListener("change", updateInstructions);
    const btn = $("generate");
    btn.textContent = "Generate files";
    btn.disabled = false;
    btn.addEventListener("click", generateAll);
  } catch (e) {
    console.error(e);
    setStatus("Failed to load CAD kernel: " + e.message, "error");
  }
})();
