#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/categorize.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/import-planner.js"), "utf8"), ctx);
const { parseDelimited, buildTripDraft } = ctx.window.WorldPlannerImport;

const sample = `
USA Trip Planner
Date\tDay\tLocation\tTime/Order\tPlace/Activity\tNotes\tCategory\tGoogle Maps Link
17.09.26\tDay 1\tNew York\t05:15\tLanding in LGA\tFlight LY027\tTransportation / Flight\thttps://maps.google.com/a
17.09.26\tDay 1\tNew York\t19:00\tJunior's Restaurant\tDinner\tFood & Dining\thttps://maps.google.com/b
18.09.26\tDay 2\tNew York\t10:00\tStatue of Liberty\t\tSightseeing / Attraction\thttps://maps.google.com/c
30.09.26\tDay 14\tNew York\t18:00\tJFK Departure\tFlight home\tTransportation / Flight\thttps://maps.google.com/d
Sightseeing / Attraction\tActivity\tNotes\tPlaces
Place/Activity\tUnited States\t\t
`;

const parsed = parseDelimited(sample);
const draft = buildTripDraft(parsed);

console.log("rows parsed:", parsed.rows.length);
console.log("dayPlans:", draft.dayPlans.length, draft.dayPlans.map((d) => d.date).join(", "));
console.log("places:", draft.dayPlans.flatMap((d) => d.rows.map((r) => r.place)));

let failed = false;
if (draft.dayPlans.length !== 3) {
  console.error("FAIL: expected 3 unique days, got", draft.dayPlans.length);
  failed = true;
}
if (parsed.rows.some((r) => /^sightseeing/i.test(r.place))) {
  console.error("FAIL: category leaked as place name");
  failed = true;
}
if (parsed.rows.length !== 4) {
  console.error("FAIL: expected 4 activity rows, got", parsed.rows.length);
  failed = true;
}
process.exit(failed ? 1 : 0);
