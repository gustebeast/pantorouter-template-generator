// Headless regeneration of the example/sample STEP files.
//
//   node tools/generate.mjs
//
// Runs the SAME geometry as the browser (geometry.js) under Node with the
// npm replicad + opencascade WASM, at the UI's default parameters, and
// rewrites example/*.step and the root sample-test files. Follow with
//   py -3.12 -m tools.make_assembly
// to refresh the root assembly.step for the FreeCAD viewer hub.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const replicad = require("replicad");
// The emscripten loader mixes ESM export syntax with CJS __dirname, which
// Node 24 refuses to classify — rewrite it to pure CJS in a cache file.
const { readFileSync, writeFileSync } = await import("node:fs");
const ocSrcPath = require.resolve("replicad-opencascadejs/src/replicad_single.js");
const ocCjsPath = ocSrcPath.replace(/\.js$/, ".cadkit-cache.cjs");
writeFileSync(ocCjsPath, readFileSync(ocSrcPath, "utf8")
  .replace(/export default Module;\s*$/, "module.exports = Module;"));
const opencascade = require(ocCjsPath);
const wasmPath = require.resolve("replicad-opencascadejs/src/replicad_single.wasm");

const OC = await opencascade({
  locateFile: () => wasmPath,
});
replicad.setOC(OC);

const { makeBuilders } = await import(pathToFileURL(path.join(ROOT, "geometry.js")).href);
const G = makeBuilders(replicad);

// UI defaults (index.html)
const params = {
  tenonWidth: 20, tenonLength: 40, tenonRadius: null,
  bit: 12.7, bearing: 12, shrinkComp: 1.0, templateDepth: 8,
  dualRailMount: false, outerTaper: false,
  displayWidth: 20, displayLength: 40, displayUnits: "mm",
};

const d = G.deriveSizes(params);

async function save(shape, rel) {
  const blob = shape.blobSTEP();
  const buf = Buffer.from(await blob.arrayBuffer());
  const out = path.join(ROOT, rel);
  await fs.writeFile(out, buf);
  console.log("wrote", rel, `(${(buf.length / 1024).toFixed(0)} kB)`);
}

await save(G.buildTemplate(d), "example/pantorouter-template-body.step");
await save(G.buildRail(d), "example/pantorouter-template-rail.step");
await save(G.buildAssembly(d), "example/pantorouter-template-assembled-demo.step");
await save(G.buildScrewTest(d), "example/pantorouter-template-screw-test.step");
await save(G.buildMortiseTest(), "sample-test-mortise.step");
await save(G.buildTenonTest(), "sample-test-tenon.step");
console.log("octagon:", G.OCT_W.toFixed(2), "mm wide; slot depth",
            G.SLOT_DEPTH.toFixed(2), "mm");
