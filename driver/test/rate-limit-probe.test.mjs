// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A PARKED RUN RE-CHECKS AVAILABILITY INSTEAD OF SLEEPING TO A STORED TIMESTAMP.
//
// The incident, 2026-08-06: a subscription cap was lifted AHEAD of its stated reset and the parked run
// did not resume. It came back only after a human nulled the stale `resetsAt` by hand in BOTH the queue
// meta and the run-dir sentinel — either can resume independently, so one edit would not have been
// enough. The park was correct; the blocker was a record that had gone stale.
//
// The test the issue asks for, in its own words: "park a run against a `resetsAt` in the future, make
// the underlying limit not apply, and require the run to resume without anyone touching a file. A test
// that advances the clock past `resetsAt` proves the timer works and proves nothing about this."
//
// So NOTHING below moves the clock past the reset. The reset stays in 2033 in every case, and no file is
// edited after the park is written. What changes is only how long the run has been parked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Far enough out that no test run could ever reach it — the point is that we never wait for it.
const RESET_2033 = new Date(2000000000 * 1000).toISOString();
const MIN = 60 * 1000;

const parkedQueue = (postponedAt, extra = {}) => {
  const root = mkdtempSync(join(tmpdir(), "prelim-443-"));
  const q = join(root, "q");
  const runDir = join(root, "run");
  mkdirSync(q, { recursive: true }); mkdirSync(runDir, { recursive: true });
  writeFileSync(join(q, "j.postponed"), JSON.stringify({ id: "j", msgId: "<j@x>", ref: "TMP8439", markName: "PROBE" }));
  writeFileSync(join(q, "j.postponed.meta"), JSON.stringify({
    resetsAt: RESET_2033, codename: "probe-run", dateISO: "2026-08-06",
    runDir, agentId: "clawdi", postponedAt, ...extra,
  }));
  return { q, runDir };
};

test("#443 a park sleeping on a 2033 reset is claimed once its probe interval elapses — no file touched", async () => {
  process.env.CLEAROTRON_RATE_LIMIT_PROBE_MS = String(10 * MIN);
  process.env.CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS = String(40 * MIN);
  const { claimDuePostponed } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);

  // Parked 30 minutes ago. Its stated reset is seven years away. Nobody has edited anything.
  const { q } = parkedQueue(new Date(Date.now() - 30 * MIN).toISOString());
  const claimed = claimDuePostponed(q);

  assert.equal(claimed.length, 1, "the run resumes on its own — this is the hand-edit that no longer has to happen");
  assert.ok(readdirSync(q).some((f) => f.endsWith(".processing")), "and it is atomically claimed, exactly as a due park is");
});

test("#443 a park inside its probe interval is NOT claimed — this is not resume-always", async () => {
  process.env.CLEAROTRON_RATE_LIMIT_PROBE_MS = String(10 * MIN);
  process.env.CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS = String(40 * MIN);
  const { claimDuePostponed } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);

  // Parked one minute ago. Resuming now would re-hit the same cap and hot-loop, re-running a stage and
  // burning tokens each pass — the failure the original backoff was written against, still closed.
  const { q } = parkedQueue(new Date(Date.now() - 1 * MIN).toISOString());
  assert.deepEqual(claimDuePostponed(q), []);
  assert.ok(!readdirSync(q).some((f) => f.endsWith(".processing")));
});

test("#443 each refused probe widens the next one, so a genuinely long cap is not a poll loop", async () => {
  process.env.CLEAROTRON_RATE_LIMIT_PROBE_MS = String(10 * MIN);
  process.env.CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS = String(40 * MIN);
  const { claimDuePostponed } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);

  // Woken and refused three times already: the next probe is 80 minutes out, so 30 minutes in it waits.
  // "A fix that only shortens the poll interval is the wrong fix" — this is why the interval grows.
  const { q } = parkedQueue(new Date(Date.now() - 30 * MIN).toISOString(), { probeAttempt: 3 });
  assert.deepEqual(claimDuePostponed(q), [], "a run that has already been refused three times waits longer");
});

test("#443 the park record says what it is waiting on and how it will find out", async () => {
  // "Parked until T" is not that, and the whole cost of this defect was that a stranded run and a
  // working one read identically. parkPostponed writes both fields; this pins the contract they carry.
  const { parkPostponed } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);
  const root = mkdtempSync(join(tmpdir(), "prelim-443m-"));
  writeFileSync(join(root, "j.processing"), "{}");
  parkPostponed(join(root, "j.processing"), root, "j", {
    resetsAt: RESET_2033, postponedAt: new Date().toISOString(), probeAttempt: 1,
    waitingOn: "provider rate limit (the cap that refused the last dispatch)",
    resolvedBy: "a live retry — the stored reset is a hint about when to look, not the authority on whether to.",
  });
  const meta = JSON.parse(readFileSync(join(root, "j.postponed.meta"), "utf8"));
  assert.match(meta.waitingOn, /rate limit/);
  assert.match(meta.resolvedBy, /not the authority/);
  assert.equal(meta.probeAttempt, 1, "and how many times it has already asked, which is what widens the next wait");
});
