#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// hand-off-exits-probe.mjs — replay the hand-off check against ANY finished run directory, READ-ONLY: how
// many records, pages and hits left each hand-off with no ground.
//
//   node scripts/hand-off-exits-probe.mjs <run-dir>
//   node scripts/hand-off-exits-probe.mjs <run-dir> --explain <record uri | page address>
//   node scripts/hand-off-exits-probe.mjs <run-dir> --json
//
// It reads the traces the run wrote. A knockout run archived before its trace existed has the trace derived
// here from its research payloads and findings, and the output says so. It never writes to the run.
//
// Exit 0 when every hand-off could be read, 2 when one could not. Exits with no ground are a finding, not a
// failure, so they never change the exit code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { pickingExits, webExits, notesExits, knockoutCarry, knockoutExits, exitsForLog } from "../driver/hand-off-exits.mjs";
import { normalizeUrl } from "../driver/verify-knockout.mjs";
import { kebab } from "../driver/search-policy.mjs";

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
const koFindings = readJson(join(runDir, "knockout-findings.json"));
let exits;
let derived = false;
if (koFindings && Array.isArray(koFindings.marks)) {
  let carry = readJson(driverDir(runDir, "knockout-carry.json"));
  if (!carry) {
    derived = true;
    carry = knockoutCarry(koFindings.marks, (name) => {
      try { return readFileSync(join(runDir, "research", `${kebab(name)}.md`), "utf8"); } catch { return null; }
    });
  }
  exits = { knockout: knockoutExits(carry) };
} else {
  exits = {
    picking: pickingExits(readJson(driverDir(runDir, "record-carry.json"))),
    web: webExits([driverDir(runDir, "commonlaw-carry.json"), driverDir(runDir, "jx", "zh-carry.json")].map(readJson).filter(Boolean)),
    notes: notesExits(readText(join(runDir, "common-law-findings.md")), readJson(join(runDir, "findings.json"))?.findings ?? null),
  };
}

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
  console.log(JSON.stringify({ runDir, derived, exits: exitsForLog(exits), ...(explained ? { explained } : {}) }, null, 2));
} else {
  for (const [handOff, e] of Object.entries(exits)) {
    if (!e.computable) { console.log(`${handOff}: not computable — ${e.reason}`); continue; }
    const extra = "owners" in e ? `, ${e.owners} owner(s)` : "pages" in e ? `, ${e.pages} page(s), ${e.cells} cell(s)`
      : "surfaced" in e ? ` of ${e.surfaced} page(s) the notes surfaced` : "";
    console.log(`${handOff}: ${e.exits} left with no ground${extra}${handOff === "knockout" && derived ? " (trace derived here: the run wrote none)" : ""}`);
  }
  if (explained) {
    console.log(explained.length
      ? explained.map((x) => `  EXIT at ${x.handOff}: ${x.uri ?? x.url}`).join("\n")
      : `  ${needle}: not among the exits with no ground`);
  }
}
process.exit(Object.values(exits).every((e) => e.computable) ? 0 : 2);
