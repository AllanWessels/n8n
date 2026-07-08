#!/usr/bin/env node
// Validates every JSON fixture under fixtures/ parses and has the expected
// top-level shape. Does not call Date.now()/new Date() — the fixture capture
// timestamp is the hardcoded literal "2026-07-07T00:00:00Z" everywhere it's
// needed, per repo convention for committed fixture code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURED_AT = "2026-07-07T00:00:00Z";

function loadJson(relPath) {
  const abs = join(__dirname, relPath);
  const raw = readFileSync(abs, "utf-8");
  return JSON.parse(raw);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const checks = [
  {
    path: "jolpica/driver_standings.json",
    validate: (d) => {
      assert(typeof d === "object" && d !== null, "not an object");
      assert("MRData" in d, "missing MRData");
      assert("StandingsTable" in d.MRData, "missing MRData.StandingsTable");
    },
  },
  {
    path: "jolpica/last_results.json",
    validate: (d) => {
      assert(typeof d === "object" && d !== null, "not an object");
      assert("MRData" in d, "missing MRData");
      assert("RaceTable" in d.MRData, "missing MRData.RaceTable");
    },
  },
  {
    path: "jolpica/constructor_standings.json",
    validate: (d) => {
      assert(typeof d === "object" && d !== null, "not an object");
      assert("MRData" in d, "missing MRData");
      assert("StandingsTable" in d.MRData, "missing MRData.StandingsTable");
    },
  },
  {
    path: "openf1/weather.json",
    validate: (d) => {
      assert(Array.isArray(d), "not an array");
      assert(d.length > 0, "empty array");
      assert("session_key" in d[0], "missing session_key");
      assert("air_temperature" in d[0], "missing air_temperature");
    },
  },
  {
    path: "openf1/sessions.json",
    validate: (d) => {
      assert(Array.isArray(d), "not an array");
      assert(d.length > 0, "empty array");
      assert("session_key" in d[0], "missing session_key");
      assert("session_name" in d[0], "missing session_name");
    },
  },
  {
    path: "openmeteo/silverstone_forecast.json",
    validate: (d) => {
      assert(typeof d === "object" && d !== null, "not an object");
      assert("hourly" in d, "missing hourly");
      assert("temperature_2m" in d.hourly, "missing hourly.temperature_2m");
      assert(
        "precipitation_probability" in d.hourly,
        "missing hourly.precipitation_probability"
      );
    },
  },
  {
    path: "news/autosport_f1.json",
    validate: (d) => {
      assert(Array.isArray(d), "not an array");
      assert(d.length > 0, "empty array");
      for (const item of d) {
        assert("title" in item, "item missing title");
        assert("link" in item, "item missing link");
        assert("isoDate" in item, "item missing isoDate");
        assert("contentSnippet" in item, "item missing contentSnippet");
      }
    },
  },
  {
    path: "kalshi/kxf1_markets.json",
    validate: (d) => {
      assert(typeof d === "object" && d !== null, "not an object");
      assert(Array.isArray(d.markets), "missing markets array");
      assert(d.markets.length > 0, "empty markets array");
      for (const m of d.markets) {
        assert("ticker" in m, "market missing ticker");
        assert("title" in m, "market missing title");
        assert("close_time" in m, "market missing close_time");
        assert("status" in m, "market missing status");
        assert(typeof m.yes_bid === "number", "market yes_bid not a number");
        assert(typeof m.yes_ask === "number", "market yes_ask not a number");
      }
    },
  },
  {
    path: "manifest.json",
    validate: (d) => {
      assert(Array.isArray(d), "not an array");
      assert(d.length > 0, "empty manifest");
      for (const entry of d) {
        assert("name" in entry, "manifest entry missing name");
        assert("path" in entry, "manifest entry missing path");
        assert("source" in entry, "manifest entry missing source");
        assert("capturedAt" in entry, "manifest entry missing capturedAt");
        assert(
          entry.capturedAt === CAPTURED_AT,
          `manifest entry ${entry.name} has wrong capturedAt: ${entry.capturedAt}`
        );
      }
    },
  },
];

let failures = 0;
for (const { path, validate } of checks) {
  try {
    const data = loadJson(path);
    validate(data);
    console.log(`OK   ${path}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${path}: ${err.message}`);
  }
}

// The raw XML isn't JSON, just confirm it's readable and non-empty.
try {
  const raw = readFileSync(join(__dirname, "news/autosport_f1.raw.xml"), "utf-8");
  assert(raw.includes("<rss"), "raw XML missing <rss root element");
  console.log("OK   news/autosport_f1.raw.xml");
} catch (err) {
  failures++;
  console.error(`FAIL news/autosport_f1.raw.xml: ${err.message}`);
}

if (failures > 0) {
  console.error(`\n${failures} fixture(s) failed validation.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length + 1} fixtures parsed and validated successfully.`);
