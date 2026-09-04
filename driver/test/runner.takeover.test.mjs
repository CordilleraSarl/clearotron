// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives two real runners contending for one claim
// Atomic claim TAKEOVER (review fix on B2). The old takeover of a dead claimer's `.processing` was a
// plain writeFileSync of `.pid` — no mutual exclusion, so two runners whose reclaim scans overlapped
// (a .path-triggered systemd activation + a manual backlog drain) could both judge the claimer dead,
// both overwrite `.pid`, and BOTH dispatch the same job (a concurrent double-run of one codename/run
// dir — torn artifacts, double delivery). The queue-marker never-two-claims invariant cannot see it:
// both claims share the single `.processing`. The fix makes the rename the lock: takeoverClaim renames
// the marker to a token-named `.claimed-` path (single winner), RE-VERIFIES the claimer under the lock
// (a sibling may have completed its takeover between our liveness read and our rename), stamps a fresh
// token, restores the marker; sweepAbandonedTakeovers recovers a marker whose takeover-er died between
// the two renames. These unit tests pin the primitive deterministically; the cross-process race test
// pins the end-to-end invariant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync, utimesSync, renameSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { claimToken, claimAgeMs, takeoverClaim, sweepAbandonedTakeovers, procStarttime, retireMarker } from "../runner.mjs";
import { deadClaimToken, PROC_GATE } from "./claim-fixtures.mjs";   // — one dead-claimer fixture

// — the test below asks the REAL procStarttime to tell two processes on one pid apart, and
// that answer comes from /proc/<pid>/stat. Where there is no /proc there is no answer, the fail-safe
// polarity reports the claimer ALIVE, and the assertion that the takeover proceeds cannot hold. The
// reasoning, and why this is a probe rather than a `process.platform` check, is written out in full at
// the head of runner.claim-liveness.test.mjs; README.md 'Where it runs' carries the user-facing half.
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "..", "runner.mjs");
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

// A really-dead pid: a child that has already exited (the slot-lock-xproc precedent).
async function deadPid() {
  const c = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((r) => c.on("exit", r));
  return c.pid;
}

// The dead-claimer fixture and its reasoning now live in claim-fixtures.mjs, so the three
// other files that build this same fixture cannot drift from it.

test("claimAgeMs: the .pid sidecar (claim time) wins over the marker (enqueue time, rename-preserved)", () => {
  const dir = mkdtempSync(join(tmpdir(), "claimage-"));
  const proc = join(dir, "j.processing");
  writeFileSync(proc, "{}");
  const old = (Date.now() - 62 * 3600000) / 1000;
  utimesSync(proc, old, old);                              // enqueue 62h ago
  // no sidecar → legacy fallback to the marker
  assert.ok(claimAgeMs(proc) > 61 * 3600000, "sidecar-less claim falls back to the marker mtime");
  writeFileSync(`${proc}.pid`, claimToken());              // claimed JUST NOW
  assert.ok(claimAgeMs(proc) < 3600000, "with a sidecar, the claim's age is the sidecar's mtime");
  assert.equal(claimAgeMs(join(dir, "absent.processing")), 0, "nothing to stat → 0 (never over-age)");
});

test("takeoverClaim: wins on a dead claimer — fresh live token, marker restored, no lock residue", async () => {
  const dir = mkdtempSync(join(tmpdir(), "takeover-dead-"));
  const proc = join(dir, "j.processing");
  writeFileSync(proc, "{}");
  writeFileSync(`${proc}.pid`, await deadClaimToken());   // — pid+starttime, so a recycled pid still reads dead
  assert.equal(takeoverClaim(proc), true, "the dead claim is taken over");
  assert.equal(readFileSync(`${proc}.pid`, "utf8"), claimToken(), "our claim token is stamped");
  assert.ok(existsSync(proc), "the marker is restored");
  assert.equal(readdirSync(dir).filter((f) => f.includes(".claimed-")).length, 0, "no lock residue");
});

test("takeoverClaim: STANDS DOWN when a sibling completed its takeover first (live .pid re-verified under the lock)", () => {
  // The exact double-dispatch interleaving: we read a dead .pid, but before our rename a sibling
  // finished ITS takeover and stamped a LIVE token. The re-verify under the lock must decline and
  // restore — the old plain-overwrite takeover clobbered the live token and dispatched a second run.
  const dir = mkdtempSync(join(tmpdir(), "takeover-live-"));
  const proc = join(dir, "j.processing");
  writeFileSync(proc, "{}");
  const sibling = claimToken();                            // this process: alive AND starttime-authentic
  writeFileSync(`${proc}.pid`, sibling);
  assert.equal(takeoverClaim(proc), false, "a live, authentic claim is never taken over");
  assert.equal(readFileSync(`${proc}.pid`, "utf8"), sibling, "the live token is untouched");
  assert.ok(existsSync(proc), "the marker is restored");
});

test("takeoverClaim: the over-age escape hatch still fires under the lock (wedged-but-alive claimer)", () => {
  const dir = mkdtempSync(join(tmpdir(), "takeover-age-"));
  const proc = join(dir, "j.processing");
  writeFileSync(proc, "{}");
  writeFileSync(`${proc}.pid`, claimToken());              // live and authentic…
  const old = (Date.now() - 49 * 3600000) / 1000;
  utimesSync(`${proc}.pid`, old, old);                     // …but claimed 49h ago
  assert.equal(takeoverClaim(proc, { maxClaimAgeMs: 48 * 3600000 }), true, "over-age re-claims regardless of liveness");
  assert.equal(readFileSync(`${proc}.pid`, "utf8"), claimToken(), "fresh token stamped (age clock reset)");
});

test("takeoverClaim: loses cleanly when the marker is gone (a sibling holds the lock)", () => {
  const dir = mkdtempSync(join(tmpdir(), "takeover-lost-"));
  assert.equal(takeoverClaim(join(dir, "gone.processing")), false);
});

test("sweepAbandonedTakeovers: a dead takeover-er's .claimed- marker is restored; a live one is left alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "takeover-sweep-"));
  writeFileSync(join(dir, `a.processing.claimed-${await deadClaimToken()}`), "{}");   // died mid-takeover (: pid+starttime)
  writeFileSync(join(dir, `b.processing.claimed-${claimToken()}`), "{}");           // in progress (us)
  sweepAbandonedTakeovers(dir);
  assert.ok(existsSync(join(dir, "a.processing")), "the abandoned marker is restored to .processing");
  assert.equal(readdirSync(dir).filter((f) => f.startsWith("a.processing.claimed-")).length, 0);
  assert.equal(readdirSync(dir).filter((f) => f.startsWith("b.processing.claimed-")).length, 1,
    "a live takeover in progress is not touched");
});

// ── — BOTH contenders standing down, driven deterministically instead of waited for ──────────────
//
// The cross-process test below went red on a busy box roughly one run in six, with both runners
// declining:
//
//   [runner] job-race.processing was already retired by another runner — leaving job-race.json (orphan…)
//
// That first line was itself false and has since fixed it: no `.json` was created, so "leaving
// job-race.json" named a file that is not on disk. It now says the rename did NOT happen. The window
// below is unchanged — only what the runner says about it.
//   [runner] job-race takeover lost to a concurrent runner — leaving it to the winner
//
// That reads like two guards misfiring. It is one window, and this test holds it open on purpose.
//
// `takeoverClaim` uses the rename as its lock: it renames `.processing` to `.claimed-<token>`, verifies
// the claimer underneath, then restores. BETWEEN THOSE TWO RENAMES `.processing` DOES NOT EXIST. So when
// runner A has already won its own takeover and reaches its terminal rename — handing the orphan back to
// the queue as `.json` — while runner B is inside that window, A's rename gets ENOENT. A reports the
// orphan as returned to the queue; no `.json` is created. B then finds A's fresh token alive and stands
// down, correctly. Nobody owns the job, and both processes exit.
//
// Both runners really did behave correctly, which is why puts the mechanism out of scope: the queue
// is left RECOVERABLE (a `.processing` a later runner re-claims), not corrupted, and nothing was
// dispatched twice. What was wrong is that the test demanded the job finish within the lifetime of these
// two processes, which the design does not promise — so the assertion was time-bound and the box's load
// decided it.
//
// No sleeps, no spawns, no load: `isAlive` is called by B while B holds the lock, so it IS the window.
test("#491: a terminal rename inside a sibling's takeover window strands nobody — the queue stays recoverable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "takeover-standdown-"));
  const proc = join(dir, "job-race.processing");
  const queued = join(dir, "job-race.json");
  writeFileSync(proc, "{}");
  writeFileSync(`${proc}.pid`, await deadClaimToken());

  assert.equal(takeoverClaim(proc), true, "A takes over the dead claim");

  let aRenameCode = null;
  let markerVisibleToA = null;
  const bWon = takeoverClaim(proc, {
    isAlive: () => {
      // B holds the lock here. This is the whole defect: the marker is off disk.
      markerVisibleToA = existsSync(proc);
      try { renameSync(proc, queued); } catch (e) { aRenameCode = e.code; }
      return true;                       // A's freshly stamped token is alive — B must stand down
    },
  });

  assert.equal(markerVisibleToA, false, "the marker is off disk while a takeover holds the lock");
  assert.equal(aRenameCode, "ENOENT", "A's terminal rename lands in the window and fails — the flake's first log line");
  assert.equal(bWon, false, "B stands down against A's live token — the flake's second log line");

  // The property that actually matters, and the one the old assertion could not separate from a pass:
  // nothing was dispatched twice, and the job is still there to be picked up.
  assert.ok(existsSync(proc), "the marker is restored, not lost — a later runner can still find it");
  assert.ok(!existsSync(queued), "no .json was created — and since #745 the runner's own log line says so rather than claiming the orphan was returned");
  assert.equal(readdirSync(dir).filter((f) => f.includes(".claimed-")).length, 0, "no lock residue");

  // Recoverable is the claim, so prove it rather than assert the word: with the dead claimer's sidecar
  // cleaned up the way reclaimOrphanedClaims cleans it, the next runner's takeover succeeds.
  rmSync(`${proc}.pid`, { force: true });
  assert.equal(takeoverClaim(proc), true, "the next runner re-claims the stranded marker");
});

// ── cross-process: two runners race one dead claim — the job runs EXACTLY once ─────────────────────────

const job = (ref, mark) => ({
  id: `race-${ref}`, msgId: `<race-${ref}@x>`, forwarder: "lawyer-a", forwarderDomain: "example.com",
  ref, markName: mark, classes: [9], provider: "corsearch",
});
const studioFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search");
const queueFor = (root) => join(studioFor(root), "queue");
function envFor(root) {
  return {
    ...process.env,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_QUEUE_SCAN_MS: "100", CORSEARCH_SESSION_KEY: "test-offline",
  };
}
const spawnRunner = (env) => {
  const c = spawn(process.execPath, [RUNNER], { env, stdio: ["ignore", "pipe", "pipe"] });
  c.log = "";
  c.stdout.on("data", (d) => { c.log += d; });
  c.stderr.on("data", (d) => { c.log += d; });
  c.exited = new Promise((r) => c.on("exit", (code) => r(code)));
  return c;
};

test("two concurrent runners over one dead claim → exactly one dispatch, one run dir, one cold start", async () => {
  const root = mkdtempSync(join(tmpdir(), "takeover-race-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const slug = "tmp9301-race-probe";
  writeFileSync(join(Q, "job-race.processing"), JSON.stringify(job("TMP9301", "RACE PROBE")));
  writeFileSync(join(Q, "job-race.processing.pid"), await deadClaimToken());

  const a = spawnRunner(envFor(root));
  const b = spawnRunner(envFor(root));
  const [ca, cb] = await Promise.all([a.exited, b.exited]);
  assert.equal(ca, 0, a.log);
  assert.equal(cb, 0, b.log);

  // ── — why a THIRD runner, and why nothing here got weaker ──────────────────────────────────
  //
  // Both contenders can legitimately stand down: see the deterministic test above for the exact
  // window. The queue is left with a recoverable `.processing` and nothing dispatched — which in
  // production is a delay, because the next activation re-claims it, and here was a red suite,
  // because both processes had exited and there was no next activation. That is what made this
  // ~17% flake on a loaded box (, absorbing).
  //
  // So the run of the test now models what production has instead of hoping the schedule is kind.
  // Every safety assertion below is unchanged and unconditional, and they are what this test is for:
  // ONE run dir, ONE cold start, no residue — across the WHOLE episode, third runner included. A
  // genuine double dispatch still fails exactly as loudly, and now it cannot hide behind a re-run.
  const logs = [a.log, b.log];
  if (!existsSync(join(Q, "job-race.done"))) {
    const c = spawnRunner(envFor(root));
    assert.equal(await c.exited, 0, c.log);
    logs.push(c.log);
  }
  const trace = () => logs.map((l, i) => `──── runner ${"ABC"[i]} ────\n${l}`).join("\n");

  assert.ok(existsSync(join(Q, "job-race.done")),
    `the job finished — not on the first two runners, and not on a third either\n${trace()}`);
  const res = JSON.parse(readFileSync(join(Q, "job-race.done.result"), "utf8"));
  assert.equal(res.ok, true, JSON.stringify(res));
  // exactly ONE run dir across live+archive — a lost race would have minted a second
  const runs = [];
  const isRun = (n) => /^\d{4}-\d\d-\d\d-/.test(n);
  try { runs.push(...readdirSync(join(studioFor(root), slug)).filter(isRun)); } catch { /* archived */ }
  const arch = join(studioFor(root), "archive");
  try { for (const m of readdirSync(arch)) { try { runs.push(...readdirSync(join(arch, m, slug)).filter(isRun)); } catch { /* other slug */ } } } catch { /* none */ }
  //: BOTH RUNNER LOGS RIDE THE FAILURE. This assertion used to print the two codenames and nothing
  // else, so the one time it fired for real — PR, Actions run 30915100601 attempt 1 — the failure was
  // unreadable from CI and got dismissed as a flake. It was a live double dispatch.
  assert.equal(runs.length, 1, `exactly one run exists: ${runs.join(", ")}\n${trace()}`);
  // and that one run dispatched exactly once
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.event === "start").length, 1, `one cold start — never two dispatches\n${trace()}`);
  // no lock or marker residue
  assert.equal(readdirSync(Q).filter((f) => f.includes(".claimed-") || f.endsWith(".processing")).length, 0,
    `no takeover residue: ${readdirSync(Q).join(", ")}\n${trace()}`);
});

// ──: the claim and its liveness token are one operation ────────────────────────────────────────
//
// The test above races over a marker whose claimer is already DEAD. This one races over a fresh `.json`,
// which is the shape that actually failed: `claimAndPrep` renamed `.json` → `.processing` and only then
// stamped `.pid`, so between two syscalls a live claimed job sat on disk with no liveness token. Both
// takeover guards read the absent sidecar as `rec = null` and neither can tell that from "no claimer".
test("#377: two runners racing one FRESH job → one dispatch, and no .processing is ever left uncovered", async () => {
  const root = mkdtempSync(join(tmpdir(), "claim-race-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const slug = "tmp9302-claim-probe";
  writeFileSync(join(Q, "job-claim.json"), JSON.stringify(job("TMP9302", "CLAIM PROBE")));

  const a = spawnRunner(envFor(root));
  const b = spawnRunner(envFor(root));
  const [ca, cb] = await Promise.all([a.exited, b.exited]);
  assert.equal(ca, 0, a.log);
  assert.equal(cb, 0, b.log);

  assert.ok(existsSync(join(Q, "job-claim.done")), `the job finished\n${a.log}\n${b.log}`);
  const runs = [];
  const isRun = (n) => /^\d{4}-\d\d-\d\d-/.test(n);
  try { runs.push(...readdirSync(join(studioFor(root), slug)).filter(isRun)); } catch { /* archived */ }
  const arch = join(studioFor(root), "archive");
  try { for (const m of readdirSync(arch)) { try { runs.push(...readdirSync(join(arch, m, slug)).filter(isRun)); } catch { /* other slug */ } } } catch { /* none */ }
  assert.equal(runs.length, 1, `exactly one run exists: ${runs.join(", ")}\n──── runner A ────\n${a.log}\n──── runner B ────\n${b.log}`);

  // The loser must not have scribbled on the winner's sidecar path, and nothing may be left holding a lock.
  const residue = readdirSync(Q).filter((f) => f.includes(".claimed-") || f.endsWith(".processing") || f.endsWith(".pid.tmp"));
  assert.deepEqual(residue, [], `no claim residue: ${readdirSync(Q).join(", ")}\n${a.log}\n${b.log}`);
});

test("#377: a claim abandoned mid-publish is recovered by the SAME sweep takeovers use — one recovery path, not two", async () => {
  const { sweepAbandonedTakeovers, claimToken } = await import("../runner.mjs");
  const q = mkdtempSync(join(tmpdir(), "claim-lock-"));
  // A runner that died between the claim rename and the publish rename leaves the marker under its token
  // name, where no queue scan can see it. It is the same shape takeoverClaim leaves, deliberately: reusing
  // the lock name means the existing sweep already covers the new crash window.
  const dead = `${await deadPid()}:1`;
  writeFileSync(join(q, `job-x.processing.claimed-${dead}`), "{}");
  sweepAbandonedTakeovers(q);
  assert.ok(existsSync(join(q, "job-x.processing")), "the abandoned claim is restored to a scannable marker");

  // A LIVE token is a claim in progress and is left strictly alone — restoring it would republish a
  // marker its owner is about to publish itself, which is the double-claim this whole change closes.
  const q2 = mkdtempSync(join(tmpdir(), "claim-lock-live-"));
  const live = claimToken();
  writeFileSync(join(q2, `job-y.processing.claimed-${live}`), "{}");
  sweepAbandonedTakeovers(q2);
  assert.ok(!existsSync(join(q2, "job-y.processing")), "a live claim is not stolen mid-publish");
});

// ── — THE FLAKE, PROVED AT ITS MECHANISM RATHER THAN BY REPETITION ──────────────────────────────
//
// A local pass rate does not bound a CI rate, so "it passed four times" is not evidence. What IS
// evidence is the branch the fixture takes. This drives `claimerIsAlive` over the two sidecar shapes
// with a pid that IS alive — which is what a recycled pid looks like — and shows that only one of them
// can answer.
test("#665 a recycled pid defeats a bare-pid claim and cannot defeat a pid+starttime one", PROC_GATE, async () => {
  const { claimerIsAlive } = await import("../runner.mjs");
  const alive = process.pid;                       // stands in for "the OS handed this pid to someone else"

  // THE FLAKE: the bare sidecar has one signal, and its polarity is fail-safe by design — an alive pid
  // is ALIVE, because re-claiming a live run double-delivers to a lawyer. So a recycled pid reads as a
  // live claimer, both runners stand down, and the job never finishes. That is load-dependent, and a
  // loaded shared runner is where it gets exercised.
  assert.equal(claimerIsAlive({ pid: alive, starttime: null }), true,
    "THE DEFECT the fixture used to depend on: a bare-pid claim cannot tell a recycled pid from its claimer");

  // THE FIX: the birth stamp the real claimer writes. A different process on the same pid has a
  // different starttime, so the claim is dead on POSITIVE evidence — under any load.
  assert.equal(claimerIsAlive({ pid: alive, starttime: "1" }), false,
    "a recycled pid is provably not the claimer, and the takeover proceeds");
  assert.equal(claimerIsAlive({ pid: alive, starttime: procStarttime(alive) }), true,
    "…while the genuine claimer is still recognised as alive — the fail-safe direction is intact");

  // and the fixture really does write the shape that can answer
  const tok = await deadClaimToken();
  assert.match(tok, /^\d+:\S+$/, "the fixture stamps pid+starttime, not a bare pid");
});

// ── — retireMarker's ENOENT branch must report what happened, not what was wanted ───────────────
//
// The line above is the ONE an operator reads to find out where a job went, and on this branch it said
// "leaving job-race.json" while creating no such file. The rename did not happen; the destination does
// not exist; the parenthetical named the caller's intent. Everything about the state was safe and
// everything about the sentence was wrong.
//
// Driven directly rather than through the race, because the race is 's and is out of scope here:
// the branch is reached whenever the source marker is absent, for any reason.
test("#745 a lost retire says the rename did NOT happen, and never names a file it did not create", () => {
  const dir = mkdtempSync(join(tmpdir(), "retire-honesty-"));
  const proc = join(dir, "job-gone.processing");
  const dest = join(dir, "job-gone.json");

  const errs = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { errs.push(String(s)); return true; };
  let moved;
  try { moved = retireMarker(proc, dest, "orphan returned to the queue"); }
  finally { process.stderr.write = realWrite; }

  assert.equal(moved, false, "the call reports that it moved nothing — the return value is the fact");
  assert.ok(!existsSync(dest), "and nothing was created, which is what the old message denied");
  const line = errs.join("");
  assert.match(line, /did NOT create job-gone\.json/, "the note states the outcome on disk");
  assert.doesNotMatch(line, /leaving job-gone\.json/,
    "and never the wording that asserts the destination exists — that phrasing IS the defect");

  // The true branch is unchanged: it moves the marker and says so by returning true.
  writeFileSync(proc, "{}");
  assert.equal(retireMarker(proc, dest, "orphan returned to the queue"), true);
  assert.ok(existsSync(dest) && !existsSync(proc), "a successful retire really does move the marker");
});
