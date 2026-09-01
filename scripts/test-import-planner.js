#!/usr/bin/env node
const fs = require("fs");
const vm = require("vm");

const root = require("path").join(__dirname, "..");
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(`${root}/js/categorize.js`, "utf8"), ctx);
vm.runInContext(fs.readFileSync(`${root}/js/import-planner.js`, "utf8"), ctx);
const { parseDelimited, buildTripDraft } = ctx.window.WorldPlannerImport;

const splitCityPdf = `
Date\tDay\tLocation\tTime/Order\tPlace/Activity\tNotes\tCategory
17.09.26\tDay 1\tNew\t05:15\tYork Landing In EWR Flight LY027\t\tTransportation / Flight
17.09.26\tDay 1\tNew\t\tYork Times Square\t\tSightseeing / Attraction
17.09.26\tDay 1\tNew\t19:00\tYork Junior's Restaurant & Bakery\t\tFood & Dining
`;

const partyUsa = `
Date\tDay\tLocation\tTime/Order\tPlace/Activity\tNotes\tCategory
17.09.26\tDay 1\tNew York\t05:15\tLanding In EWR Flight LY027\t\tTransportation / Flight
17.09.26\tDay 1\tNew York\t\tJoe's Pizza\t\tFood & Dining
`;

let failed = false;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); failed = true; }
}

const split = parseDelimited(splitCityPdf);
assert(split.rows[0].location === "New York", `split city: got location "${split.rows[0].location}"`);
assert(!split.rows[0].place.toLowerCase().startsWith("york"), `split city: place should not start with York: "${split.rows[0].place}"`);
assert(split.rows[1].place.includes("Times"), `split row 2 place: ${split.rows[1].place}`);
assert(split.rows[2].time === "19:00", `split row 3 time: ${split.rows[2].time}`);

const normal = parseDelimited(partyUsa);
assert(normal.rows[0].location === "New York", "normal location");
assert(normal.rows[1].place.includes("Joe"), "normal place");

process.exit(failed ? 1 : 0);
