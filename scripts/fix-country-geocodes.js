/**
 * Reassign places to the correct country using reverse geocoding.
 * Usage: node scripts/fix-country-geocodes.js [--only slovenia,croatia]
 */
"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const PLACES_JSON = path.join(__dirname, "..", "data", "places.json");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "")
  .replace("--only=", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ISO_TO_ID = {
  HR: "croatia",
  SI: "slovenia",
  IT: "italy",
  AT: "austria",
  HU: "hungary",
};

const ISO_TO_NAME = {
  HR: "Croatia",
  SI: "Slovenia",
  IT: "Italy",
  AT: "Austria",
  HU: "Hungary",
};

const ISO_FLAG = {
  HR: "hr",
  SI: "si",
  IT: "it",
  AT: "at",
  HU: "hu",
};

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "MisterWorldwideFix/1.0" } }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

let chain = Promise.resolve();
function throttle(fn) {
  const run = chain.then(async () => {
    await new Promise((r) => setTimeout(r, 280));
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function reverseCountry(lat, lng) {
  return throttle(async () => {
    try {
      const data = await httpGetJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
      const p = (data.features || [])[0]?.properties || {};
      return (p.countrycode || "").toUpperCase();
    } catch {
      return "";
    }
  });
}

function recalcCountries(data) {
  const map = new Map(data.countries.map((c) => [c.id, { ...c }]));
  for (const p of data.places) {
    if (!map.has(p.countryId)) {
      const name = p.countryId.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
      map.set(p.countryId, {
        id: p.countryId,
        name,
        iso: p.countryId.slice(0, 2),
        placeCount: 0,
        lat: 0,
        lng: 0,
      });
    }
  }
  for (const c of map.values()) {
    const pts = data.places.filter((p) => p.countryId === c.id);
    c.placeCount = pts.length;
    if (pts.length) {
      c.lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      c.lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    }
  }
  data.countries = [...map.values()].filter((c) => c.placeCount > 0).sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const data = JSON.parse(fs.readFileSync(PLACES_JSON, "utf8"));
  const targets = data.places.filter((p) => !ONLY.length || ONLY.includes(p.countryId));
  let moved = 0;

  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    const cc = await reverseCountry(p.lat, p.lng);
    const want = ISO_TO_ID[cc];
    if (!want || want === p.countryId) continue;

    const countryName = ISO_TO_NAME[cc] || cc;
    p.countryId = want;
    const parts = String(p.description || "").split("|").map((x) => x.trim());
    if (parts.length >= 2) parts[1] = countryName;
    else parts.push(countryName);
    if (!parts[2] && p.url) parts[2] = p.url;
    p.description = parts.filter(Boolean).join(" | ");
    moved++;
    if (moved <= 10) console.log(`→ ${p.name}: ${want} (${cc})`);
    if ((i + 1) % 25 === 0) process.stdout.write(`\rChecked ${i + 1}/${targets.length}, moved ${moved}`);
  }

  console.log(`\nMoved ${moved} places`);
  recalcCountries(data);
  data.builtAt = new Date().toISOString();

  const hr = data.places.filter((p) => p.countryId === "croatia").length;
  const si = data.places.filter((p) => p.countryId === "slovenia").length;
  console.log(`Croatia: ${hr} | Slovenia: ${si}`);

  fs.writeFileSync(PLACES_JSON, JSON.stringify(data));
}

main().catch((e) => { console.error(e); process.exit(1); });
