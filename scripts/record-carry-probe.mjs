#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// record-carry-probe.mjs — run the retrieval→findings trace against ANY finished run directory,
// READ-ONLY, and print where each retrieved register record stopped and why.
//
// This is the reader's answer to "did this record become a finding, and if not, which step dropped it
// and on what ground". The pipeline writes the same artifact to `_driver/record-carry.json` on every
// live run; this probe recomputes it in place so an archived run — one that finished before the trace
// existed — can still be interrogated. It NEVER writes to the run directory.
//
//   node scripts/record-carry-probe.mjs <run-dir>
//   node scripts/record-carry-probe.mjs <run-dir> --explain 色度
//   node scripts/record-carry-probe.mjs <run-dir> --json > trace.json
//
// --explain takes a mark text or a /mark uri and prints one line per matching record.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { traceRecordCarry, parseStageOutcomes, explainRecords } from "../driver/record-carry.mjs";
import { parsePlacementsJson } from "../driver/placement-model.mjs";

const args = process.argv.slice(2);
const runDir = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");
const explainAt = args.indexOf("--explain");
const needle = explainAt >= 0 ? args[explainAt + 1] : null;

if (!runDir) {
  console.error("usage: node scripts/record-carry-probe.mjs <run-dir> [--explain <mark|uri>] [--json]");
  process.exit(2);
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

const band = readJson(join(runDir, "register-named-band.json"));
if (!band) { console.error(`no readable register-named-band.json under ${runDir} — nothing was retrieved, or this run predates the named band`); process.exit(1); }

let placements = [];
const pPath = join(runDir, "placements.json");
if (existsSync(pPath)) {
  try { placements = parsePlacementsJson(readText(pPath)).placements; }
  catch (e) { console.error(`WARNING placements.json unparseable (${String(e?.message ?? e).slice(0, 80)}) — every placed record will read trace:indeterminate`); }
}

const artifact = traceRecordCarry({
  bandRecords: Array.isArray(band?.enumerated) ? band.enumerated : [],
  crowds: Array.isArray(band?.crowds) ? band.crowds : [],
  placements,
  registerFindingsText: readText(join(runDir, "register-findings.md")),
  findings: readJson(join(runDir, "findings.json"))?.findings ?? [],
  outcomes: parseStageOutcomes(readText(driverDir(runDir, "run.jsonl"))),
  planExecution: readJson(driverDir(runDir, "plan-execution.json")),
});

if (asJson) { console.log(JSON.stringify(artifact, null, 2)); process.exit(0); }

const t = artifact.totals;
console.log(`run: ${runDir}`);
console.log(`retrieved ${t.retrieved} record(s) · ${t.finding} became a finding · ${t.dropped} did not · ${t.unreasoned} UNREASONED`);
console.log("");
console.log("stage outcomes (a stage counts as completed only on a stage event with ok:true):");
for (const o of Object.values(artifact.stage_outcomes)) {
  console.log(`  ${o.completed ? "OK      " : "INCOMPLETE"} ${o.stage.padEnd(20)} ${o.evidence}`);
}
console.log("");
console.log("where records stopped:");
for (const [seam, n] of Object.entries(artifact.by_seam).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${seam}`);
console.log("");
console.log("drop reason × where the reason was authored:");
for (const [r, n] of Object.entries(artifact.by_reason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${r}`);
console.log("");
for (const [s, n] of Object.entries(artifact.by_reason_source).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${s}`);

if (artifact.untraceable_slices.length) {
  console.log("");
  console.log(`${artifact.untraceable_slices.length} slice(s) with NO per-record trace`
    + (t.untraced_hits ? `, carrying ${t.untraced_hits} hit(s) that were counted and never fetched:` : ":"));
  // — REFUSALS FIRST, and never rendered with a hit count. The rows are sorted by `untraced`
  // descending, and a refused slice has 0 of them, so the slices the provider never answered sorted
  // to the very bottom and fell off the 12-row cut — the least visible rows in the operator's own
  // tool were the ones where nothing had been searched at all.
  // Reads the FIELD. A v2 artifact has no slice_class, and its rows fall to the counted branch —
  // which is what they were recorded as, so an archived run is not retro-labelled a refusal.
  const refused = artifact.untraceable_slices.filter((s) => s.slice_class && s.slice_class !== "counted-not-fetched");
  const counted = artifact.untraceable_slices.filter((s) => !s.slice_class || s.slice_class === "counted-not-fetched");
  if (refused.length) console.log(`  ${refused.length} of these were NEVER ANSWERED — no count was taken, so they are unsearched rather than empty:`);
  for (const s of refused.slice(0, 12)) {
    console.log(`  ${"never".padStart(7)} answered  ${s.query || s.qid}  (${s.slice_class}, plan ${s.plan_state ?? "?"})`);
  }
  for (const s of counted.slice(0, 12)) {
    console.log(`  ${String(s.untraced).padStart(7)} untraced  ${s.query || s.qid}  (hits ${s.total_hits}, fetched ${s.fetched}, plan ${s.plan_state ?? "?"})`);
  }
  // — the cap now applies to TWO lists, so the tail must count what was actually shown.
  // `length - 12` was right for one list and undercounts the tail for two: 5 refused + 20 counted
  // shows 17 rows and would have claimed 13 more.
  const shown = Math.min(refused.length, 12) + Math.min(counted.length, 12);
  if (artifact.untraceable_slices.length > shown) {
    console.log(`  … ${artifact.untraceable_slices.length - shown} more slice(s)`);
  }
}

if (needle) {
  const hits = explainRecords(artifact, needle);
  console.log("");
  console.log(`--- explain "${needle}": ${hits.length} record(s) ---`);
  for (const r of hits) {
    console.log("");
    console.log(`${r.uri}  ${r.mark}  ${r.owner}`);
    console.log(`  ${r.office.toUpperCase()} cl ${r.classes.join(",")} ${r.status}`);
    console.log(`  reached   : ${r.reach}`);
    console.log(`  stopped at: ${r.stopped_at ?? "(became a finding)"}`);
    console.log(`  reason    : ${r.reason ?? "(none — it is a finding)"}  [authored: ${r.reason_source ?? "n/a"}]`);
    console.log(`  detail    : ${r.detail}`);
    if (r.queries.length) console.log(`  retrieved by: ${r.queries.join(" | ")}`);
  }
}
