#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// undeclared-field-census.mjs — WHO WRITES A FIELD NO DOOR DECLARES, over a stated denominator.
//
// made an undeclared field VISIBLE (`undeclaredJobFields` + a warning at the door and again at the
// runner's claim). is the census that has to come before refusing one, and its whole difficulty is
// in one sentence of that issue: **"A census needs the denominator."**
//
// ── WHY THIS READS MANIFESTS AND NOT LOGS ───────────────────────────────────────────────────────────
//
// The obvious census is `grep "no door declares"` over runner logs, and it was run on 2026-08-19: zero
// hits in 14 days. That number cannot be quoted, and the issue says why — nobody could establish how
// many jobs arrived by a route CAPABLE of carrying an undeclared field in that window. A zero over an
// unknown denominator is not evidence of absence.
//
// Two further reasons the log is the weaker instrument, both measured while building this:
//   · RETENTION decides the window, not the question. The test box's runner journal held 22,207 lines
//     spanning under two days — a 14-day claim could not be made from it at all.
//   · A warning is only emitted where the code runs. The manifest is the artifact itself, so a job that
//     was never claimed still counts, and the census stops depending on which surfaces logged.
//
// ── THE DENOMINATOR, AND WHY `enqueuedVia` IS IT ────────────────────────────────────────────────────
//
// An ASSEMBLING door builds the job from its own allow-list, so an undeclared field is already gone
// before the manifest is written — those jobs CANNOT exhibit the defect and including them deflates the
// rate toward zero. Every assembling door stamps `enqueuedVia` (`enqueue.mjs` sets `cli/enqueue`; the
// portal sets its own and refuses to let a body name another door — "a door that let a body name another
// door would erase its own trail"). A hand-written `<id>.json` dropped into the queue is a documented
// intake route (INTAKE.md) and goes around all of them, so nothing stamps it.
//
// **So the absence of `enqueuedVia` is the marker of the route that can carry the defect**, and the
// denominator this census reports is that population — printed beside the total, never instead of it.
//
// PRINTS FIELD NAMES AND COUNTS, NEVER VALUES. Job manifests are real client matter; the vocabulary is
// what the census is about and the content is nobody's business here.
//
// usage: node scripts/undeclared-field-census.mjs --queue <dir> [--json]
// — FIRST, and a side-effecting import rather than a call. This entry statically reaches
// driver/profiles.mjs, which captures process.env at MODULE TOP; ES modules evaluate a dependency body
// before the importer's, so an warnRetiredEnv() call down in this file would run too late and the
// renamed spellings would reach nothing. The guard names this file by path if the import is absent.
import "../shared/env-local.mjs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { undeclaredJobFields, DECLARED_JOB_FIELDS } from "../driver/enqueue-schema.mjs";

// Sidecars the queue writes beside a job. Anything else is a manifest — an ALLOW-LIST of what to skip
// rather than a guess at what to read, so an unfamiliar extension is counted and reported, never
// silently dropped. A census that quietly skips what it does not recognise is the shape this replaces.
const SIDECAR = new Set(["result", "reason", "pid", "meta"]);

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const qi = args.indexOf("--queue");
const queue = qi >= 0 ? args[qi + 1] : null;
if (!queue) {
  console.error("usage: node scripts/undeclared-field-census.mjs --queue <dir> [--json]\n"
    + "  <dir> is a queue directory holding job manifests. Reads only; writes nothing.");
  process.exit(2);
}

let entries;
try { entries = readdirSync(queue); }
catch (e) { console.error(`cannot read ${queue}: ${e.message}`); process.exit(2); }

const census = {
  queue, files: entries.length,
  manifests: 0, unreadable: 0,
  byRoute: {},                 // enqueuedVia (or "(unstamped)") → { jobs, withUndeclared }
  fieldCounts: {},             // undeclared field name → how many manifests carry it
  states: {},                  // terminal state (the extension) → count
};

for (const f of entries) {
  const ext = f.includes(".") ? f.slice(f.lastIndexOf(".") + 1) : "";
  if (SIDECAR.has(ext)) continue;
  let raw;
  try {
    if (!statSync(join(queue, f)).isFile()) continue;
    raw = readFileSync(join(queue, f), "utf8");
  } catch { census.unreadable++; continue; }
  let job;
  // AN UNPARSEABLE MANIFEST IS COUNTED, NOT SKIPPED. A hand-written file whose JSON is broken is
  // precisely the intake route this census exists to size, and dropping it would bias the count in the
  // direction that makes the problem look smaller.
  try { job = JSON.parse(raw); } catch { census.unreadable++; census.manifests++; continue; }
  census.manifests++;
  census.states[ext || "(none)"] = (census.states[ext || "(none)"] ?? 0) + 1;
  const via = typeof job?.enqueuedVia === "string" && job.enqueuedVia.trim() ? job.enqueuedVia.trim() : "(unstamped)";
  const bucket = census.byRoute[via] ??= { jobs: 0, withUndeclared: 0 };
  bucket.jobs++;
  const undeclared = undeclaredJobFields(job);
  if (undeclared.length) {
    bucket.withUndeclared++;
    for (const n of undeclared) census.fieldCounts[n] = (census.fieldCounts[n] ?? 0) + 1;
  }
}

const unstamped = census.byRoute["(unstamped)"] ?? { jobs: 0, withUndeclared: 0 };
const stampedJobs = Object.entries(census.byRoute).filter(([k]) => k !== "(unstamped)").reduce((n, [, v]) => n + v.jobs, 0);

if (asJson) { console.log(JSON.stringify(census, null, 2)); process.exit(0); }

console.log(`\n  UNDECLARED-FIELD CENSUS — ${queue}`);
console.log(`  ${DECLARED_JOB_FIELDS.length} declared field(s); a name outside that list and not \`_\`-prefixed is undeclared.\n`);
console.log(`  manifests read              ${census.manifests}   (of ${census.files} files; sidecars skipped)`);
console.log(`  unparseable / unreadable    ${census.unreadable}   counted, never skipped`);
console.log(`\n  BY ARRIVAL ROUTE — the denominator is the UNSTAMPED row, not the total:\n`);
console.log(`    ${"route".padEnd(28)} ${"jobs".padStart(6)} ${"with an undeclared field".padStart(26)}`);
for (const [via, v] of Object.entries(census.byRoute).sort((a, b) => b[1].jobs - a[1].jobs))
  console.log(`    ${via.padEnd(28)} ${String(v.jobs).padStart(6)} ${String(v.withUndeclared).padStart(26)}`);
console.log(`\n  A door-stamped job CANNOT carry one — its assembler dropped it before the manifest was written.`);
console.log(`  So the rate that answers #1325 is over the unstamped route alone:\n`);
console.log(`    ${unstamped.withUndeclared} of ${unstamped.jobs} hand-written manifest(s) carry a field no door declares`
  + `${unstamped.jobs ? ` — ${Math.round((unstamped.withUndeclared / unstamped.jobs) * 100)}%` : ""}`);
console.log(`    (${stampedJobs} further job(s) arrived through a door and are excluded, with their reason above)`);
if (!unstamped.jobs)
  console.log(`\n  THE DENOMINATOR IS ZERO. No job in this queue arrived by a route that can carry an undeclared\n`
    + `  field, so this corpus cannot answer the question either way — that is a finding about the CORPUS,\n`
    + `  and it must not be read as "nobody writes undeclared fields".`);
const names = Object.entries(census.fieldCounts).sort((a, b) => b[1] - a[1]);
if (names.length) {
  console.log(`\n  THE FIELDS THEMSELVES (names only — a manifest's values are client matter):\n`);
  for (const [n, c] of names) console.log(`    ${String(c).padStart(4)}  ${n}`);
} else {
  console.log(`\n  No undeclared field name was seen in any manifest.`);
}
console.log();
