// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Fast tier: this drives `claimDuePostponed` against a temp queue in milliseconds. It reopens no pipeline
// and spawns nothing, so it has no business in the full tier — the marker is absent deliberately.
//
// (3) — A PARK'S HISTORY HAS TO SHOW THE WAKE, NOT ONLY THE SLEEP.
//
// `run.jsonl` carried `postponed` and nothing for the other side of it. So a park that woke and then
// died mid-clearance read exactly like a park that never woke: one `postponed` line, silence after it.
// The sentinel does carry `probeAttempt`, but it is OVERWRITTEN on every park — it says how many times,
// never when — and a run that never re-parks leaves its last wake unrecorded altogether.
//
// These arms drive the RESUME PATHS, not a helper. A record written by a function nobody calls is the
// failure this file exists to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

const MIN = 60 * 1000;
const RESET_PAST = new Date(Date.now() - 60 * MIN).toISOString();

const parkedQueue = (extra = {}) => {
  const root = mkdtempSync(join(tmpdir(), "prelim-1488-"));
  const q = join(root, "q");
  const runDir = join(root, "run");
  mkdirSync(q, { recursive: true });
  mkdirSync(driverDir(runDir, "."), { recursive: true });
  writeFileSync(join(q, "j.postponed"), JSON.stringify({ id: "j", msgId: "<j@x>", ref: "TMP8439", markName: "PARKREC" }));
  writeFileSync(join(q, "j.postponed.meta"), JSON.stringify({
    resetsAt: RESET_PAST, codename: "park-record", dateISO: "2026-08-23",
    runDir, agentId: "clawdi", postponedAt: new Date(Date.now() - 90 * MIN).toISOString(),
    kind: "rate-limit", fromStage: "register-digest", probeAttempt: 3, ...extra,
  }));
  return { q, runDir };
};

const spine = (runDir) => {
  const p = driverDir(runDir, "run.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

test("#1488 a queue-marker resume appends park-resumed, carrying which wake it was", async () => {
  const { claimDuePostponed } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);
  const { q, runDir } = parkedQueue();

  const claimed = claimDuePostponed(q);
  assert.equal(claimed.length, 1, "the fixture must actually be due — otherwise this arm proves nothing");

  const rows = spine(runDir).filter((r) => r.event === "park-resumed");
  assert.equal(rows.length, 1, `exactly one wake line: ${JSON.stringify(spine(runDir))}`);
  assert.equal(rows[0].via, "queue-marker", "the line says which door reopened the park");
  assert.equal(rows[0].probeAttempt, 3, "and which wake this was — the sentinel's count, carried onto the append-only line");
  assert.equal(rows[0].kind, "rate-limit", "a rate-limit park and a recovery park must stay distinguishable here too");
  assert.equal(rows[0].fromStage, "register-digest");
  assert.ok(rows[0].parkedAt, "the line carries WHEN it parked, which the overwritten sentinel cannot preserve");
});

// THE POINT OF THE WHOLE CRITERION, stated as an assertion rather than left to a reader: the two states
// this issue says are indistinguishable must now differ in the record.
test("#1488 a park that never woke and a park that woke are distinguishable in run.jsonl", async () => {
  const { claimDuePostponed } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);

  // (a) parked and never resumed — the window has not elapsed
  const notDue = parkedQueue({ resetsAt: new Date(Date.now() + 24 * 60 * MIN).toISOString(),
    postponedAt: new Date().toISOString(), probeAttempt: 0 });
  assert.equal(claimDuePostponed(notDue.q).length, 0, "a park inside its window is not claimed — the control");
  assert.deepEqual(spine(notDue.runDir).filter((r) => r.event === "park-resumed"), [],
    "a park that never woke writes NO wake line — without this the arm below proves nothing");

  // (b) parked and resumed
  const due = parkedQueue();
  assert.equal(claimDuePostponed(due.q).length, 1);
  assert.equal(spine(due.runDir).filter((r) => r.event === "park-resumed").length, 1,
    "and a park that woke says so — these are the two states #1488 calls indistinguishable");
});

test("#1488 a pre-fix sentinel with no probeAttempt still records the wake", async () => {
  const { claimDuePostponed } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);
  const { q, runDir } = parkedQueue({ probeAttempt: undefined, kind: undefined });
  assert.equal(claimDuePostponed(q).length, 1);
  const rows = spine(runDir).filter((r) => r.event === "park-resumed");
  assert.equal(rows.length, 1, "a park written before these fields existed must still leave a record, not throw");
  assert.equal(rows[0].probeAttempt, 0, "absent reads 0 — the conservative direction, and it is stated rather than undefined");
});

// ──: THE OTHER DOOR ───────────────────────────────────────────────────────────────────────────
//
// Every arm above routes through `claimDuePostponed`. wrote `park-resumed` at TWO doors and said
// so, and only one of them was reached: planted independently at f4892fb6, deleting the queue-marker
// write red-ed 3 of 3 arms and deleting the run-dir-sentinel write left 3 of 3 GREEN. The discriminator
// (`via`) existed with one of its two values never produced by any test.
//
// It is the door that matters more for the case the record exists for. The sentinel path resumes a run
// with no queue sidecars — the orphan sweep, and a run a person resumes BY HAND after an incident,
// which is when the spine is read most closely.
const orphanPark = (extra = {}) => {
  const root = mkdtempSync(join(tmpdir(), "prelim-1732-"));
  const runDir = join(root, "run");
  mkdirSync(driverDir(runDir, "."), { recursive: true });
  const sentPath = join(runDir, ".postponed");
  writeFileSync(sentPath, JSON.stringify({
    postponedAt: new Date(Date.now() - 90 * MIN).toISOString(),
    kind: "rate-limit", fromStage: "register-digest", probeAttempt: 2, ...extra,
  }));
  return { runDir, sentPath };
};

test("#1732 a run-dir-sentinel resume appends park-resumed too, and says which door wrote it", async () => {
  const { resumeRunDirOrphans } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);
  const { runDir, sentPath } = orphanPark();

  let dispatched = 0;
  await resumeRunDirOrphans(
    [{ runDir, sentPath, codename: "park-record", agent: "clawdi", fromStage: "register-digest", job: { id: "j" } }],
    { runPipeline: async () => { dispatched++; } },
  );
  assert.equal(dispatched, 1, "the orphan must actually be resumed — otherwise this asserts nothing");

  const rows = spine(runDir).filter((r) => r?.event === "park-resumed");
  assert.equal(rows.length, 1, "the sentinel door must append exactly one park-resumed line");
  // `via` is the whole reason the field exists: a reader of run.jsonl must not have to know which
  // door was used to see that the park reopened.
  assert.equal(rows[0].via, "run-dir-sentinel");
  assert.equal(rows[0].probeAttempt, 2);
  assert.equal(rows[0].kind, "rate-limit");
  assert.equal(rows[0].fromStage, "register-digest");
  assert.equal(typeof rows[0].parkedAt, "string");
});

test("#1732 a pre-fix run-dir sentinel with no probeAttempt still records the wake", async () => {
  // Sentinels written before are on disk on test right now. The read-back is best-effort by
  // design, so the arm pins that an unparseable one still leaves a record rather than losing the wake.
  const { resumeRunDirOrphans } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);
  const root = mkdtempSync(join(tmpdir(), "prelim-1732-old-"));
  const runDir = join(root, "run");
  mkdirSync(driverDir(runDir, "."), { recursive: true });
  const sentPath = join(runDir, ".postponed");
  writeFileSync(sentPath, "not json at all");

  await resumeRunDirOrphans(
    [{ runDir, sentPath, codename: "park-record", agent: "clawdi", fromStage: null, job: { id: "j" } }],
    { runPipeline: async () => {} },
  );
  const rows = spine(runDir).filter((r) => r?.event === "park-resumed");
  assert.equal(rows.length, 1, "an unreadable sentinel must not cost the record");
  assert.equal(rows[0].via, "run-dir-sentinel");
  assert.equal(rows[0].probeAttempt, 0, "absent reads as 0, not as undefined");
  assert.equal(rows[0].parkedAt, null);
});
