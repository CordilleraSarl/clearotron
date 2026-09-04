// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A3 (2026-07-28 postmortem) — the operator-local startedAt backfill. The seed used to re-stamp startedAt on
// every resume, so historical status.json files carry the LAST resume time as the start; the
// append-only run.jsonl spine kept the truth (`start` events, resume:false = the cold start). The
// script derives min(ts | event=start, resume=false), writes provenance, preserves updatedAt, dry-runs
// by default, and is idempotent. All synthetic fixtures — structure copied from the real artifact
// SHAPES only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { backfillRun, trueStartFromSpine, findRunDirs } from "../../scripts/backfill-started-at.mjs";

const TRUE_START = "2026-07-28T08:31:24.877Z";
const LAST_RESUME = "2026-07-28T14:16:37.000Z";

function mkRun({ spine = true, startedAt = LAST_RESUME } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "backfill-run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    runId: "tmp1-x-2026-07-28-briar-test", state: "failed", startedAt, updatedAt: "2026-07-28T14:20:00.000Z",
  }, null, 2) + "\n");
  if (spine) {
    // the 2026-07-28 postmortem shape: one true start, three resumes — each pass logged a start event
    const rows = [
      { ts: TRUE_START, event: "start", resume: false },
      { ts: "2026-07-28T08:31:25.000Z", event: "stage", stage: "matter-frame", ok: true },
      { ts: "2026-07-28T12:34:17.000Z", event: "start", resume: true },
      { ts: "2026-07-28T14:07:37.000Z", event: "start", resume: true },
      { ts: LAST_RESUME, event: "start", resume: true },
    ];
    writeFileSync(driverDir(runDir, "run.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return runDir;
}

test("trueStartFromSpine: min ts of start events with resume STRICTLY false", () => {
  const runDir = mkRun();
  assert.equal(trueStartFromSpine(runDir), TRUE_START);
  // a malformed row (resume absent) can never claim the cold start
  writeFileSync(driverDir(runDir, "run.jsonl"), JSON.stringify({ ts: "2026-07-28T01:00:00Z", event: "start" }) + "\n");
  assert.equal(trueStartFromSpine(runDir), null);
});

test("backfill: dry-run reports and writes NOTHING; --apply rewrites startedAt with provenance and preserves updatedAt", () => {
  const runDir = mkRun();
  const before = readFileSync(join(runDir, "status.json"), "utf8");
  const dry = backfillRun(runDir, { apply: false });
  assert.equal(dry.outcome, "would-backfill");
  assert.equal(readFileSync(join(runDir, "status.json"), "utf8"), before, "dry run is byte-inert");

  const applied = backfillRun(runDir, { apply: true, today: "2026-07-28" });
  assert.equal(applied.outcome, "backfilled");
  const s = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(s.startedAt, TRUE_START, "the honest clock");
  assert.equal(s.startedAtPrior, LAST_RESUME, "what the field lied before is kept as provenance");
  assert.equal(s.startedAtSource, "run.jsonl:start(resume:false) backfill 2026-07-28");
  assert.equal(s.updatedAt, "2026-07-28T14:20:00.000Z", "updatedAt untouched — the mtime>updatedAt forensic survives");
});

test("backfill: idempotent — an already-honest run is skipped; no spine / no cold start is reported, never guessed", () => {
  const runDir = mkRun();
  backfillRun(runDir, { apply: true });
  assert.equal(backfillRun(runDir, { apply: true }).outcome, "already-honest", "second pass is a no-op");
  assert.equal(backfillRun(mkRun({ spine: false }), { apply: true }).outcome, "no-true-start");
  // a status with NO startedAt at all still gains one, with null provenance
  const bare = mkRun();
  const sp = join(bare, "status.json");
  const st = JSON.parse(readFileSync(sp, "utf8"));
  delete st.startedAt;
  writeFileSync(sp, JSON.stringify(st, null, 2) + "\n");
  const r = backfillRun(bare, { apply: true });
  assert.equal(r.outcome, "backfilled");
  assert.equal(JSON.parse(readFileSync(sp, "utf8")).startedAtPrior, null);
});

test("findRunDirs: walks live + archive layouts, skips queue/_driver leaves", () => {
  const studio = mkdtempSync(join(tmpdir(), "backfill-studio-"));
  const live = join(studio, "tmp1-x", "2026-07-28-teal-arch");
  const archived = join(studio, "archive", "2026-07", "tmp2-y", "2026-07-01-marble-gantry");
  for (const d of [live, archived]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, "status.json"), "{}\n"); }
  mkdirSync(join(studio, "queue"), { recursive: true });
  writeFileSync(join(studio, "queue", "status.json"), "{}\n");   // must NOT be picked up
  const found = findRunDirs(studio).sort();
  assert.deepEqual(found, [archived, live].sort());
});
