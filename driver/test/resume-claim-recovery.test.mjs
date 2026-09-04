// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// resume-claim-recovery.test.mjs —. A run interrupted DURING self-resume is recoverable.
//
// `resumeRunDirOrphans` renames `<id>.postponed` → `<id>.resuming` before driving the pipeline. Kill the
// watcher inside that window — Ctrl-C, a reboot, an OOM — and the run directory holds `.resuming` and no
// `.postponed`. `scanDueRunDirOrphans` required `.postponed` and skipped `.resuming`, so no future watch
// start ever saw that run again: not failed, not parked, not queued, INVISIBLE. Nothing logged it,
// nothing listed it, and the run directory looked mid-flight forever.
//
// exists because a parked run silently stopped and nothing reported it. This was the same failure
// shape one layer in, reachable by the very loop added to close the original — and a laptop watcher is
// exactly the thing a user Ctrl-Cs without thinking.
//
// ── THE READING TAKEN, of the two the issue left open ───────────────────────────────────────────────
//
// Option (i): `scanDueRunDirOrphans` treats a `.resuming` whose claimer is not live the same way it
// treats a due `.postponed`, reusing the claim protocol's own liveness check. Option (ii) — making the
// rename crash-safe so `.resuming` is never the only marker on disk — changes the sentinel contract,
// and was forbidden from touching it for reasons that have not expired.
//
// ── WHAT MUST NOT BREAK ─────────────────────────────────────────────────────────────────────────────
//
// The polarity. `claimerIsAlive` declares a claimer dead only on POSITIVE evidence, because re-claiming
// a live run re-spends a billable search and delivers to the lawyer twice. Every test below that could
// pass by being permissive is paired with one that fails if it is.
import { test } from "node:test";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HAS_BIRTH_STAMP, NO_PROC_STARTTIME_WHY } from "./platform-caps.mjs";

// The PID-REUSE half of the liveness protocol needs /proc/<pid>/stat, which macOS does not have and a
// container without /proc mounted does not either. Probed rather than gated on `process.platform`, the
// same call runner.claim-liveness.test.mjs makes and for the same reason: a platform name sails past
// the container case.
//
// Only the tests that need a REAL starttime are gated. Everything that injects its own liveness source
// stays ungated on purpose, so the polarity and the claim protocol are still proved everywhere — which
// is what makes the race test below meaningful on every runner.
const PROC_GATE = HAS_BIRTH_STAMP ? {} : { skip: NO_PROC_STARTTIME_WHY };

// Pinned BEFORE the import: driver.config freezes its roots at module load, and its pool-root default
// is the real archive. The studio tree for the end-to-end scan is built under this one.
const WS = mkdtempSync(join(tmpdir(), "resume-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", WS);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || mkdtempSync(join(tmpdir(), "resume-pool-")));

const { resumeClaimIsAbandoned, claimToken, scanDueRunDirOrphans, resumeRunDirOrphans } = await import("../runner.mjs");

/** A `.resuming` claim on disk, optionally with a `.pid` sidecar and a chosen age. */
function claim({ sidecar = null, ageMs = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "resume-claim-"));
  const p = join(dir, ".resuming");
  writeFileSync(p, JSON.stringify({ job: {}, agent: "a", codename: "amber-tide" }));
  if (sidecar !== null) writeFileSync(`${p}.pid`, `${sidecar}\n`);
  if (ageMs) { const t = (Date.now() - ageMs) / 1000; utimesSync(p, t, t); }
  return p;
}

// ── the sidecar arm ──────────────────────────────────────────────────────────────────────────────────

test("#806 a claim held by a DEAD pid is abandoned, and the run becomes due again", () => {
  // A pid that cannot exist. This is the case the issue is about: the watcher is gone and the marker
  // it left is the only thing standing between the run and every future scan.
  assert.equal(resumeClaimIsAbandoned(claim({ sidecar: "2147483646:99" })), true);
});

test("#806 a claim held by a LIVE process is NOT abandoned — this is where double-running would start", PROC_GATE, () => {
  // This process, with its real starttime. Recovering it would re-run a billable search and deliver a
  // second report for the same matter.
  assert.equal(resumeClaimIsAbandoned(claim({ sidecar: claimToken() })), false);
});

test("#806 an unreadable starttime on a live pid counts as ALIVE — the fail-safe direction is preserved", () => {
  // claimerIsAlive's polarity, reused rather than restated. A claim whose liveness cannot be PROVED
  // dead stays claimed; the age arm below is the honest escape hatch for a wedge that creates.
  const p = claim({ sidecar: `${process.pid}:99999999` });
  assert.equal(resumeClaimIsAbandoned(p, Date.now(), { isAlive: () => true }), false);
});

test("#806 a recycled pid — alive, but provably a different process — IS abandoned", PROC_GATE, () => {
  const p = claim({ sidecar: `${process.pid}:1` });   // real pid, starttime that is not this boot's
  assert.equal(resumeClaimIsAbandoned(p), true,
    "a live pid with the wrong starttime is pid reuse, not the original claimer");
});

// ── the age arm, for claims written before the sidecar existed ───────────────────────────────────────

test("#806 a sidecar-less claim older than the claim-age ceiling is recovered", () => {
  // These are the runs already stuck invisible on a box today. A fix that refuses to touch them
  // recovers nothing that is actually broken.
  const p = claim({ ageMs: 72 * 3600000 });
  assert.equal(resumeClaimIsAbandoned(p, Date.now(), { maxClaimAgeMs: 48 * 3600000 }), true);
});

test("#806 a FRESH sidecar-less claim is left alone — on a box mid-upgrade it may be live", () => {
  const p = claim({ ageMs: 60000 });
  assert.equal(resumeClaimIsAbandoned(p, Date.now(), { maxClaimAgeMs: 48 * 3600000 }), false);
});

test("#806 the age arm is disabled by maxClaimAgeMs 0, the same reading takeoverClaim gives that knob", () => {
  const p = claim({ ageMs: 10 * 24 * 3600000 });
  assert.equal(resumeClaimIsAbandoned(p, Date.now(), { maxClaimAgeMs: 0 }), false);
});

test("#806 the SIDECAR wins over age — a live claimer is never recovered however old the claim", PROC_GATE, () => {
  // The ordering that matters. An old claim held by a process that is still working is exactly the case
  // the queue's max-claim-age ceiling was observed to get wrong: a run postponed across a weekend read
  // over-age on Monday while its claimer was healthy.
  const p = claim({ sidecar: claimToken(), ageMs: 10 * 24 * 3600000 });
  assert.equal(resumeClaimIsAbandoned(p, Date.now(), { maxClaimAgeMs: 48 * 3600000 }), false);
});

test("#806 a missing claim file is not abandoned — an absence is not a recovery", () => {
  assert.equal(resumeClaimIsAbandoned(join(mkdtempSync(join(tmpdir(), "resume-none-")), ".resuming")), false);
});

// ── the scan, end to end over a real studio tree ─────────────────────────────────────────────────────

test("#806 a run holding ONLY a dead .resuming is seen by a fresh scan; a live one is not", () => {
  // The real tree shape agentStudioRoots() walks: <workspaceRoot>/workspace-<agent>/studio/prelim-search.
  const studio = join(WS, "workspace-acme", "studio", "prelim-search");

  const mk = (runName, sidecar) => {
    const dir = join(studio, "amber", runName);
    mkdirSync(dir, { recursive: true });
    // The sentinel payload SURVIVES the rename — `.resuming` IS the old `.postponed` file — so nothing
    // has to be reconstructed, only the decision that it is claimable again.
    writeFileSync(join(dir, ".resuming"), JSON.stringify({
      job: { mark: "AMBER" }, agent: "acme", codename: runName, postponedAt: new Date(0).toISOString(),
    }));
    writeFileSync(join(dir, ".resuming.pid"), `${sidecar}\n`);
    return dir;
  };
  mk("2026-08-12-dead-claim", "2147483646:99");
  mk("2026-08-12-live-claim", claimToken());

  const due = scanDueRunDirOrphans();
  const names = due.map((o) => o.codename).sort();
  assert.ok(names.includes("2026-08-12-dead-claim"),
    `the abandoned run must be visible again; scan returned ${JSON.stringify(names)}`);
  assert.ok(!names.includes("2026-08-12-live-claim"),
    "a live self-resume must never be re-fired — that is a double-run of a billable search");
  // And it comes back with the payload the pipeline needs, not just a path.
  const rec = due.find((o) => o.codename === "2026-08-12-dead-claim");
  assert.equal(rec.agent, "acme");
  assert.deepEqual(rec.job, { mark: "AMBER" });
  assert.ok(existsSync(rec.sentPath), "the sentinel it will claim is the .resuming file itself");
});

// ── THE CLAIM, which is where recovery is most dangerous ─────────────────────────────────────────────

test("#806 two watchers recovering the SAME abandoned claim run the pipeline ONCE", async () => {
  // The hole this closes, and it was in the first draft of the fix. Atomicity on the ordinary path is
  // rename(2): both watchers call it, one wins, the loser gets ENOENT and drops out. On the recovery
  // path the sentinel IS `.resuming`, so renaming it to ITSELF is a no-op that succeeds for BOTH —
  // no claim, two pipelines, one billable search run twice and one lawyer delivered to twice.
  //
  // Nothing in the liveness tests above can see that: none of them races. This one does.
  const dir = join(WS, "workspace-race", "studio", "prelim-search", "amber", "2026-08-12-contended");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".resuming"), JSON.stringify({ job: { mark: "AMBER" }, agent: "race", codename: "contended" }));
  writeFileSync(join(dir, ".resuming.pid"), "2147483646:99\n");   // a pid that cannot exist

  const orphan = {
    runDir: dir, sentPath: join(dir, ".resuming"), job: { mark: "AMBER" },
    agent: "race", codename: "contended", fromStage: null, reparks: 0, payload: {},
  };
  let ran = 0;
  const runPipeline = async () => { ran += 1; };
  // Both watchers hold the same scan result — exactly what two ticks landing together produces.
  await Promise.all([
    resumeRunDirOrphans([orphan], { runPipeline }),
    resumeRunDirOrphans([orphan], { runPipeline }),
  ]);
  assert.equal(ran, 1, `the pipeline ran ${ran}× for one run — a double-run of a billable search`);
});

test("#806 the dead claimer's sidecar does not outlive its claim", async () => {
  // A stale `.pid` beside a LIVE claim makes the next scan ask about the wrong process, and the answer
  // it gets is "dead" — which would re-recover a run that is currently working.
  const dir = join(WS, "workspace-sidecar", "studio", "prelim-search", "amber", "2026-08-12-stale");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".resuming"), JSON.stringify({ job: {}, agent: "s", codename: "stale" }));
  writeFileSync(join(dir, ".resuming.pid"), "2147483646:99\n");
  await resumeRunDirOrphans(
    [{ runDir: dir, sentPath: join(dir, ".resuming"), job: {}, agent: "s", codename: "stale", reparks: 0 }],
    { runPipeline: async () => {
      const held = readFileSync(join(dir, ".resuming.pid"), "utf8").trim();
      assert.notEqual(held, "2147483646:99", "the claim is still recorded against the DEAD pid mid-run");
      assert.equal(held, claimToken(), "…it names this process, which is the one actually holding it");
    } },
  );
});
