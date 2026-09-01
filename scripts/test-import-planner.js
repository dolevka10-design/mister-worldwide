#!/usr/bin/env node
const fs = require("fs");
const vm = require("vm");

const root = require("path").join(__dirname, "..");
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(`${root}/js/categorize.js`, "utf8"), ctx);
vm.runInContext(fs.readFileSync(`${root}/js/import-planner.js`, "utf8"), ctx);
const { parseDelimited, buildTripDraft } = ctx.window.WorldPlannerImport;

const partyUsa = `
New York Itinerary
Date\tDay\tLocation\tTime/Order\tPlace/Activity\tNotes\tCategory\tGoogle Maps Link
17.09.26\tDay 1\tNew York\t05:15\tLanding In EWR In 05:15 Flight LY027 From TLV\t\tTransportation / Flight\tMap
17.09.26\tDay 1\tNew York\t\tEWR - NYC Guide\t\tGuide / Info\tMap
17.09.26\tDay 1\tNew York\t\tJoe's Pizza\t\tFood & Dining\tMap
17.09.26\tDay 1\tNew York\t19:00\tBroadway Show\t\tSightseeing / Attraction\tMap
18.09.26\tDay 2\tNew York\t10:00\tStatue of Liberty\t\tSightseeing / Attraction\tMap
26.09.26\tDay 10\tNew York\t21:00\tDin Tai Fung\t\tFood & Dining\tMap
`;

const parsed = parseDelimited(partyUsa);
const draft = buildTripDraft(parsed);

let failed = false;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); failed = true; }
}

assert(parsed.rows.length === 5, `expected 5 activity rows, got ${parsed.rows.length}`);
assert(parsed.rows[0].place.includes("Landing"), "place from Place/Activity column");
assert(parsed.rows[0].time === "05:15", `expected time 05:15, got ${parsed.rows[0].time}`);
assert(parsed.rows[0].location === "New York", `expected location New York, got ${parsed.rows[0].location}`);
assert(/transport/i.test(parsed.rows[0].category), `expected transport category, got ${parsed.rows[0].category}`);
assert(parsed.rows[1].place.includes("Joe"), `expected Joe's Pizza, got ${parsed.rows[1].place}`);
assert(draft.dayPlans.length === 3, `expected 3 day plans, got ${draft.dayPlans.length}`);
assert(!parsed.rows.some((r) => /^york\b/i.test(r.place)), "city should not prefix place name");

process.exit(failed ? 1 : 0);
