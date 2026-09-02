/**
 * Copy static site files into dist/ for Cloudflare Workers deploy.
 * Excludes node_modules, scripts, and dev-only data files.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const out = path.join(root, "dist");

const COPY_DIRS = ["css", "js", "assets"];
const COPY_FILES = ["index.html"];
const DATA_FILES = ["places.json"];
const VERSION_TOKEN = "%%MW_BUILD%%";

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function cpDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) cpDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function buildVersion() {
  if (process.env.APP_VERSION) return String(process.env.APP_VERSION).trim();
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: root }).trim();
  } catch {
    return String(Date.now());
  }
}

function injectVersion(filePath, version) {
  const html = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(filePath, html.split(VERSION_TOKEN).join(version));
}

function writeHeaders(dir) {
  const headers = [
    "# Always fetch fresh HTML so iOS/Safari picks up new JS/CSS query strings",
    "/",
    "  Cache-Control: no-cache, must-revalidate",
    "",
    "/index.html",
    "  Cache-Control: no-cache, must-revalidate",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "_headers"), headers);
}

rmrf(out);
fs.mkdirSync(out, { recursive: true });

for (const file of COPY_FILES) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}

for (const dir of COPY_DIRS) {
  const src = path.join(root, dir);
  if (fs.existsSync(src)) cpDir(src, path.join(out, dir));
}

const dataOut = path.join(out, "data");
fs.mkdirSync(dataOut, { recursive: true });
for (const file of DATA_FILES) {
  const src = path.join(root, "data", file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataOut, file));
}

const version = buildVersion();
injectVersion(path.join(out, "index.html"), version);
writeHeaders(out);

console.log(`Prepared dist/ for deploy (version ${version})`);
