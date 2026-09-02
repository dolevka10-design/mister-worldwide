/**
 * Build assets/models/earth.glb — textured sphere
 * Run: node scripts/build-earth-glb.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Blob } from "node:buffer";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

globalThis.Blob = Blob;
globalThis.FileReader = class FileReader {
  constructor() { this.onloadend = null; this.result = null; }
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); });
  }
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "..", "assets", "models", "earth.glb");

const scene = new THREE.Scene();
const mesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 128, 128),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 })
);
mesh.name = "Earth";
scene.add(mesh);

new GLTFExporter().parse(
  scene,
  (result) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(result));
    console.log("Wrote", out, `(${fs.statSync(out).size} bytes)`);
  },
  (err) => { console.error(err); process.exit(1); },
  { binary: true }
);
