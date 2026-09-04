// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// DOOR B — A SEED WHOSE WRITE FAILS IS THE SAME ORPHAN BY A DIFFERENT ROUTE.
//
// guaranteed the identity seed RUNS before any refusal. It cannot guarantee the write SUCCEEDS,
// and both of writeRunStatus's exits are silent by design: a bare return when there is no run dir, and
// a swallowed catch on the write. `atomicWrite` does not catch its own writeFileSync, so an ENOSPC or
// EACCES lands straight in that empty catch — producing status.json with no identity, a round that
// settles "unknown" forever, and an operator told the evidence "may have been torn down".
//
// This is a BEHAVIOURAL test, deliberately: 's tests are source-text assertions over an ordering
// and a no-op leaves them green. Here the write is stubbed to throw and the forensic row is asserted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { writeRunStatus } from "../progress.mjs";

const runDirWith = () => {
  const d = mkdtempSync(join(tmpdir(), "seed-wf-"));
  mkdirSync(driverDir(d), { recursive: true });
  return d;
};

/** Make status.json unwritable without touching _driver, so the RECORD path stays available. */
function withUnwritableStatus(runDir, fn) {
  const statusDir = join(runDir, "status.json");
  mkdirSync(statusDir);           // a DIRECTORY where the file goes: the write throws EISDIR
  try { return fn(); } finally { rmSync(statusDir, { recursive: true, force: true }); }
}

const rows = (runDir) => {
  const p = driverDir(runDir, "run.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

test("#947B A CRITICAL WRITE THAT FAILS LEAVES A ROW — the invisibility is what is being closed", () => {
  const d = runDirWith();
  try {
    withUnwritableStatus(d, () => {
      writeRunStatus(null, { schema: 1, id: "J1", runId: "slug-date-code", ref: "e2e:R4:3e738078" }, d, { critical: true });
    });
    const failed = rows(d).filter((r) => r.event === "status-write-failed");
    assert.equal(failed.length, 1, "the seed's failure is recorded");
    assert.equal(failed[0].critical, true);
    assert.ok(failed[0].reason, "and it says what went wrong");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#947B THE ROW NAMES THE FIELDS WHOSE ABSENCE ORPHANS THE ROUND", () => {
  // A row saying only "a write failed" leaves the reader where the bug did. With these, a run can be
  // bound to its round by hand.
  const d = runDirWith();
  try {
    withUnwritableStatus(d, () => {
      writeRunStatus(null, { id: "J1", runId: "slug-date-code", ref: "e2e:R4:3e738078" }, d, { critical: true });
    });
    const r = rows(d).find((x) => x.event === "status-write-failed");
    assert.equal(r.ref, "e2e:R4:3e738078");
    assert.equal(r.runId, "slug-date-code");
    assert.equal(r.id, "J1");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#947B ROUTINE WRITES STAY SILENT — a row per failed step write would bury the one that matters", () => {
  const d = runDirWith();
  try {
    withUnwritableStatus(d, () => {
      writeRunStatus(null, { stepIndex: 3, stepLabel: "synthesis" }, d);          // no critical flag
      writeRunStatus(null, { verdict: "CLEAR" }, d);
    });
    assert.deepEqual(rows(d).filter((r) => r.event === "status-write-failed"), []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#947B RECORD, DO NOT KILL — the failure never throws into the pipeline", () => {
  // A run that cannot record its identity must still deliver. Same rule as the delivery gate never
  // dropping a deliverable; kill switches are retired house-wide.
  const d = runDirWith();
  try {
    withUnwritableStatus(d, () => {
      assert.doesNotThrow(() => writeRunStatus(null, { ref: "r" }, d, { critical: true }));
    });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#947B a SUCCESSFUL critical write records nothing", () => {
  const d = runDirWith();
  try {
    writeRunStatus(null, { id: "J1", ref: "r" }, d, { critical: true });
    assert.ok(existsSync(join(d, "status.json")), "the seed landed");
    assert.deepEqual(rows(d).filter((r) => r.event === "status-write-failed"), [],
      "and said nothing about it — the row is a failure signal, not a heartbeat");
  } finally { rmSync(d, { recursive: true, force: true }); }
});
