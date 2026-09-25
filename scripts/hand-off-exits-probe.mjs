#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// hand-off-exits-probe.mjs — replay the hand-off check against ANY finished clearance run directory,
// READ-ONLY: how many records left the picking step, and how many pages the web notes marked as
// candidates or conflicts left the findings step, with no ground.
//
//   node scripts/hand-off-exits-probe.mjs <run-dir>
//   node scripts/hand-off-exits-probe.mjs <run-dir> --explain <record uri | page address>
//   node scripts/hand-off-exits-probe.mjs <run-dir> --json
//
// It reads the traces and files the run wrote, and never writes to the run. A knockout run is outside the
// check: the knockout's rating step owes no ground per page, and the probe says so rather than counting.
//
// Exit 0 when every hand-off could be read, 2 when one could not. Exits with no ground are a finding, not a
// failure, so they never change the exit code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { pickingExits, notesExits, exitsForLog } from "../driver/hand-off-exits.mjs";
import { normalizeUrl } from "../driver/verify-knockout.mjs";
import { readDeclinations } from "../driver/declination-tool.mjs";

const args = process.argv.slice(2);
const runDir = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");
const explainAt = args.indexOf("--explain");
const needle = explainAt >= 0 ? args[explainAt + 1] : null;

if (!runDir) {
  console.error("usage: node scripts/hand-off-exits-probe.mjs <run-dir> [--explain <record uri | page address>] [--json]");
  process.exit(2);
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
if (Array.isArray(readJson(join(runDir, "knockout-findings.json"))?.marks)) {
  const why = "a knockout run: its rating step owes no ground per page, so the hand-off check does not count it";
  console.log(asJson ? JSON.stringify({ runDir, counted: false, reason: why }, null, 2) : `not counted — ${why}`);
  process.exit(0);
}
const exits = {
  picking: pickingExits(readJson(driverDir(runDir, "record-carry.json"))),
  notes: notesExits(readText(join(runDir, "common-law-findings.md")), readJson(join(runDir, "findings.json"))?.findings ?? null,
    readDeclinations(runDir).byPage),
};

let explained = null;
if (needle) {
  const n = String(needle).trim().toLowerCase();
  const page = normalizeUrl(needle);
  explained = [];
  for (const [handOff, e] of Object.entries(exits)) {
    for (const r of e.rows ?? []) {
      if ((r.uri && String(r.uri).toLowerCase() === n) || (page && r.url && normalizeUrl(r.url) === page)) explained.push({ handOff, ...r });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ runDir, exits: exitsForLog(exits), ...(explained ? { explained } : {}) }, null, 2));
} else {
  for (const [handOff, e] of Object.entries(exits)) {
    if (!e.computable) { console.log(`${handOff}: not computable — ${e.reason}`); continue; }
    const extra = "owners" in e ? `, ${e.owners} owner(s)`
      : "marked" in e ? ` of ${e.marked} page(s) the notes marked${e.declined ? `, ${e.declined} declined with a ground` : ""}` : "";
    console.log(`${handOff}: ${e.exits} left with no ground${extra}`);
  }
  if (explained) {
    console.log(explained.length
      ? explained.map((x) => `  EXIT at ${x.handOff}: ${x.uri ?? x.url}`).join("\n")
      : `  ${needle}: not among the exits with no ground`);
  }
}
process.exit(Object.values(exits).every((e) => e.computable) ? 0 : 2);
