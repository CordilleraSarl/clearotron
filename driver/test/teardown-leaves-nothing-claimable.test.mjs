// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — "teardown complete" AND "the run cannot start again" ARE DIFFERENT CLAIMS.
//
// Two scenario runs were abandoned on the owner's instruction. `e2e.mjs teardown` ran on both, preserved
// the evidence, pruned the ledger rows, cleared the queue markers, and printed "teardown complete". It
// also reported honestly that purge had REFUSED the run directories under its KEEP rules — the section
// is titled "TEARDOWN PROBLEMS (N) — NOT swallowed", so the harness was reporting rather than hiding.
//
// ~100 minutes later the runner's orphan reclaim resumed one of them FROM ITS SURVIVING RUN DIRECTORY —
// `placement-inquiry`, opus, a fresh dispatch — with no queue marker anywhere. Its `status.json` still
// read `running`. It spent tokens on a matter the owner had cancelled, on a subscription that had
// already hit its weekly cap that day, and it held a slot against CLEAROTRON_MAX_CONCURRENT_RUNS while the
// round that replaced it sat unclaimed as `.json`.
//
// So a refused purge must still leave the record TRUE — nothing is producing this run — and the closing
// line must not say "complete" over anything still claimable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { markTerminal } from "../../scripts/e2e.mjs";

const runDir = (status) => {
  const d = mkdtempSync(join(tmpdir(), "teardown-606-"));
  if (status !== undefined) writeFileSync(join(d, "status.json"), JSON.stringify(status));
  return d;
};
const statusOf = (d) => JSON.parse(readFileSync(join(d, "status.json"), "utf8"));

test("#606 a `running` record that survives a purge is corrected to the truth", () => {
  const d = runDir({ runId: "r1", state: "running", step: "placement-inquiry", markName: "AQUA" });
  const r = markTerminal(d, "r1", "purge refused", () => "2026-08-11T00:00:00.000Z");
  assert.deepEqual(r, { runId: "r1", ok: true, why: "corrected to failed" });
  const st = statusOf(d);
  assert.equal(st.state, "failed", "the orphan reclaim keys on `running` — that is what has to stop being true");
  assert.equal(st.failedStage, "placement-inquiry", "the stage it died on is kept, not overwritten with a guess");
  assert.match(st.reason, /E2E teardown \(purge refused\)/, "the reason NAMES the teardown");
  assert.match(st.reason, /nothing is producing this run/,
    "…and says what is true, so an operator reading this later is not left with a bare `failed`");
  assert.equal(st.markName, "AQUA", "every other field survives — this is a correction, not a rewrite");
  // …and it lands atomically. status.json is what the orphan reclaim reads to decide claimability: a
  // crash mid-write leaves a truncated JSON the reclaim cannot parse, on the very run this function is
  // making unclaimable. Every sibling injector in the driver writes this way, for this reason.
  const src = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export function markTerminal"), src.indexOf("export function markTerminal") + 1600);
  assert.match(fn, /writeFileSync\(`\$\{stPath\}\.tmp`/, "written to a temp file first");
  assert.match(fn, /renameSync\(`\$\{stPath\}\.tmp`, stPath\)/, "…and renamed into place");
});

test("#606 a record that is ALREADY terminal is left alone, and reported as fine", () => {
  const d = runDir({ runId: "r2", state: "delivered" });
  const r = markTerminal(d, "r2", "purge refused");
  assert.deepEqual(r, { runId: "r2", ok: true, why: "already delivered" });
  assert.equal(statusOf(d).state, "delivered", "teardown does not relabel a run that finished");
});

test("#606 a record that CANNOT be corrected is a finding, not a throw and not a silence", () => {
  // The whole point of returning a row: this is the case the closing report has to name out loud. A
  // throw here would abort a teardown mid-way and leave MORE claimable than it started with.
  const d = runDir(undefined);                       // no status.json at all
  const r = markTerminal(d, "r3", "purge refused");
  assert.equal(r.ok, false);
  assert.match(r.why, /no status\.json/);
  assert.equal(r.runId, "r3", "the report names the run by id — an unnamed problem is not actionable");
});

test("#606 the closing line is CONDITIONAL on nothing being left claimable", () => {
  // Source-anchored: the teardown walks a live pool and its closing report is the last thing it prints.
  // What is under test is that the sentence cannot be printed over an outstanding problem.
  const src = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
  assert.match(src, /const stillClaimable = unclaimable\.filter\(\(u\) => !u\.ok\)/,
    "the report is derived from what markTerminal actually returned, never asserted");
  assert.match(src, /teardown finished WITH RUNS STILL CLAIMABLE/,
    "the unhappy path says so in the line an operator reads, not only in a section above it");
  assert.match(src, /STILL CLAIMABLE \(\$\{stillClaimable\.length\}\)/, "…and names how many");
  assert.match(src, /for \(const u of stillClaimable\) console\.log\(`  · \$\{u\.runId\}/, "…by runId");
  assert.match(src, /teardown complete — every run it touched is terminal and unclaimable/,
    "and the happy path states the property it is claiming, rather than just 'complete'");
  // the correction is wired to the refused-purge branch, which is the one that leaves a directory behind
  const refused = src.slice(src.indexOf("purge REFUSED:"), src.indexOf("purge REFUSED:") + 600);
  assert.match(refused, /markTerminal\(runDir, runId, "purge refused"\)/,
    "a refused purge must correct the record — that is the run the reclaim can resume");
});
