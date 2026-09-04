// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE SIDECAR SWEEP MUST NOT OUTLIVE THE CLAIM.
//
// `reclaimOrphanedClaims` used to hand an orphan back to the queue like this:
//
//     const returned = retireMarker(procPath, `${base}.json`, "orphan returned to the queue");
//     if (!returned) note("… was NOT returned to the queue by this activation …");
//     cleanupClaimSidecars(procPath);          // ← ran whatever the rename did
//
// The rename is lost for exactly one reason: a sibling runner is inside `takeoverClaim`'s two-rename
// window, where `.processing` is renamed to a token-named lock path and is therefore off disk. That is
// the window pinned. What did not ask, and this file does, is what the LOSER does next: it
// deletes `<base>.processing.pid`, `.meta` and `.skips` — three files keyed by PATH, not by claim, and
// therefore the bookkeeping of whoever holds that path now.
//
// The first delete is the one that does the damage, and it does it by MANUFACTURING A SIGNAL: the
// sibling re-reads `.pid` under its lock to decide whether to stand down against a live claimer, and an
// absent `.pid` reads as a dead claim. So the loser's sweep does not merely erase a live claim's files,
// it can flip the sibling from standing down to taking over — and a `.processing` left with no `.meta`
// re-mints a fresh codename over a resumable run at the next activation (B1), while one left with no
// `.pid` is taken over by the next runner that scans the queue, dispatching the job twice.
//
// The fix is not a guard in front of the sweep — a "do I still hold it?" read is separated from the
// `rm` by the same window. It is the claim lock itself: retire and sweep are one locked
// operation, and the rename that acquires the lock IS the check.
//
// Fast tier on purpose: no pipeline, no spawn, no /proc dependency, no sleeps. Runner A is this
// process, so its claim token is live by construction, and the sibling's window is held open by the
// `isAlive` hook `takeoverClaim` already accepts — the callback IS the window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimToken, takeoverClaim, retireClaimAndSweep, finishReclaimedClaim, readMatterLedger, matterLedgerPath } from "../runner.mjs";

const META = JSON.stringify({ codename: "PROJECT-KESTREL", dateISO: "2026-08-13", agentId: "clawdi" }) + "\n";

// The on-disk state `takeoverClaim` leaves a winner in: the marker, the winner's liveness token, the run
// identity the reclaim scan routes by, and the wedge tally. Written directly rather than driven through
// a dead-pid fixture — the state is the fixture, and a dead pid is a source of flakes, not of
// coverage.
function claimHeldBy(dir, base, token) {
  const proc = join(dir, `${base}.processing`);
  writeFileSync(proc, `{"id":"${base}"}`);
  writeFileSync(`${proc}.pid`, token);
  writeFileSync(`${proc}.meta`, META);
  writeFileSync(`${proc}.skips`, "2\n");
  return proc;
}

const lockResidue = (dir) => readdirSync(dir).filter((f) => f.includes(".claimed-"));

// A deleted sidecar reads as null rather than throwing, so the failure an unconditional sweep produces
// is the SENTENCE below it and not a raw ENOENT stack.
const readOr = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// Capture the runner's operator lines — note() is stderr — without letting them escape into the test
// report.
function capturingStderr(fn) {
  const lines = [];
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try { return { value: fn(), log: lines.join("") }; }
  finally { process.stderr.write = real; }
}

test("#785 a retire lost inside a sibling's takeover window deletes nothing — the claim's bookkeeping survives", () => {
  const dir = mkdtempSync(join(tmpdir(), "claim-sweep-lost-"));
  const mine = claimToken();
  const proc = claimHeldBy(dir, "job-race", mine);
  const queued = join(dir, "job-race.json");

  let markerVisibleToA = null;
  let lost = null;
  // `maxClaimAgeMs: 0` disables the age arm so the liveness callback is reached whatever the deployed
  // ceiling is — the callback is the window, and the window is the whole test.
  const { value: bWon, log } = capturingStderr(() => takeoverClaim(proc, {
    maxClaimAgeMs: 0,
    isAlive: () => {
      // B holds the lock here: the marker is off disk. This is where A's terminal rename lands.
      markerVisibleToA = existsSync(proc);
      lost = retireClaimAndSweep(proc, queued, "orphan returned to the queue");
      return true;   // A's token is alive, so B must stand down — the correct outcome, and 's
    },
  }));

  assert.equal(markerVisibleToA, false, "the marker is off disk while a sibling's takeover holds the lock");
  assert.equal(lost, false, "A's retire lost the claim and reports it by returning false");
  assert.equal(bWon, false, "B stands down against A's live token");
  assert.ok(!existsSync(queued), "no .json was created — the rename did not happen (#745)");

  // THE DEFECT. Every one of these three was deleted by the unconditional sweep.
  assert.equal(readOr(`${proc}.pid`), mine,
    "the liveness token survives — deleting it is what turns a sibling's stand-down into a takeover");
  assert.equal(readOr(`${proc}.meta`), META,
    "the run identity survives — a .processing with no .meta re-mints a codename over a resumable run");
  assert.equal(readOr(`${proc}.skips`), "2\n", "the wedge tally survives");

  assert.ok(existsSync(proc), "the marker is restored — a later runner can still find it");
  assert.deepEqual(lockResidue(dir), [], "no lock residue from either runner");

  // The property the issue asks for by name: with the claim still covered, a third runner cannot take it
  // over. Strip the `.pid` — which is precisely what the old sweep did — and this returns true.
  assert.equal(takeoverClaim(proc, { maxClaimAgeMs: 0 }), false,
    "a third runner stands down: the claim is still covered by a live token");

  assert.match(log, /deleted none of its sidecars/,
    "and the operator line says the sweep was skipped, in the same breath as the lost rename");
});

test("#785 the uncontended retire still hands the orphan back and sweeps the claim it held", () => {
  const dir = mkdtempSync(join(tmpdir(), "claim-sweep-plain-"));
  const proc = claimHeldBy(dir, "job-plain", claimToken());
  const queued = join(dir, "job-plain.json");

  assert.equal(retireClaimAndSweep(proc, queued, "orphan returned to the queue"), true,
    "the marker was ours to retire, so it moved");
  assert.ok(!existsSync(proc), "the claim marker is gone");
  assert.equal(readFileSync(queued, "utf8"), '{"id":"job-plain"}', "the manifest survives both renames intact");
  for (const s of [".pid", ".meta", ".skips"])
    assert.ok(!existsSync(`${proc}${s}`), `${s} is swept — a left-behind .meta keeps its codename queue-owned forever`);
  assert.deepEqual(lockResidue(dir), [], "the lock path is not left behind");
});

test("#785 a legacy claim with no liveness token at all is still returned to the queue", () => {
  const dir = mkdtempSync(join(tmpdir(), "claim-sweep-legacy-"));
  const proc = join(dir, "job-legacy.processing");
  const queued = join(dir, "job-legacy.json");
  writeFileSync(proc, "{}");
  writeFileSync(`${proc}.meta`, META);   // identity but no `.pid` — a claim from before

  // An absent sidecar must PROCEED, not stand down: nothing covers this marker, no claim can form while
  // the lock is held, and refusing would strand exactly the orphans this path exists to recover.
  assert.equal(retireClaimAndSweep(proc, queued, "orphan returned to the queue"), true);
  assert.ok(existsSync(queued) && !existsSync(proc), "the orphan is back in the queue");
  assert.ok(!existsSync(`${proc}.meta`), "and its stale identity meta went with it");
});

// DEFENSIVE, not a reproduction: reclaimOrphanedClaims only reaches the retire after winning
// `takeoverClaim`, which stamps this process's own token, so a foreign token under the lock is not a
// reachable interleaving there. It is asserted because the primitive is exported and the next caller may
// sit somewhere it IS reachable — and because "we hold the lock" and "we hold the claim" are different
// facts.
test("#785 a marker covered by another runner's token is neither retired nor swept", () => {
  const dir = mkdtempSync(join(tmpdir(), "claim-sweep-foreign-"));
  const live = claimToken();                    // the OTHER runner's claim — live, because it is ours
  const proc = claimHeldBy(dir, "job-theirs", live);
  const queued = join(dir, "job-theirs.json");
  const stale = "999999999:1";                  // a token this process never stamped

  const { value: retired, log } = capturingStderr(() =>
    retireClaimAndSweep(proc, queued, "orphan returned to the queue", { token: stale }));

  assert.equal(retired, false, "the claim was not ours, so nothing was retired");
  assert.ok(!existsSync(queued), "and no .json was created");
  assert.equal(readOr(`${proc}.pid`), live, "the live claimer's token is untouched");
  assert.equal(readOr(`${proc}.meta`), META, "so is its run identity");
  assert.ok(existsSync(proc), "the marker is restored to the state the live claimer left it in");
  assert.deepEqual(lockResidue(dir), [], "no lock residue");
  assert.equal(takeoverClaim(proc, { maxClaimAgeMs: 0 }), false, "and a third runner still cannot take it over");
  assert.match(log, /standing down/, "the operator line names the reason: someone else's claim token");
});

// ── The two TERMINAL branches of the same reclaim scan ────────────────────────────────────────────────
//
// The arms above cover the primitive. These cover the two sites that end a job outright — the
// already-delivered `.done` and the reclaim-exhausted `.failed` branches of `reclaimOrphanedClaims` —
// because a lost retire there does more than skip a hand-back. Four side effects used to follow the
// retire unconditionally, and each is a distinct harm to whoever owns the claim now:
//
//   cleanupClaimSidecars   deletes `.meta`, which at the .failed site IS the A5 reclaim counter
//   cleanupProseParts      deletes the prose the winner's job is RE-ASSEMBLED from
//   `<base>.<state>.result` asserts a terminal that is not on disk — 's defect, one call below its fix
//   dropMatter             marks the ledger row failed, and findDuplicateMatter SKIPS failed rows, so the
//                          dedup gate re-opens against a matter the winner may be mid-resume
//
// WHAT THESE ARMS DRIVE, precisely: `finishReclaimedClaim`, which is now the whole terminal sequence at
// both call sites — not `reclaimOrphanedClaims` end to end. That function is not exported and is
// reachable only by spawning the runner (runner.reclaim-bound.test.mjs), which cannot hold a sibling's
// takeover window open; and its own `readdirSync(qdir).filter(endsWith(".processing"))` finds nothing
// while the marker is off disk under that lock. The window has to be held by the `isAlive` hook, so the
// sequence under it has to be callable. The bookkeeping each site runs BEFORE the retire —
// armUnannouncedDelivery, the failure packet — is deliberately outside it and is not exercised here.
//
// Assertion order is the order of the damage, and the follow-ons come first: they are what these arms
// add over the primitive's.

const PROSE = { ".markName.md": "KESTREL\n", ".brief.md": "the brief the job is re-assembled from\n" };
const SPENT = JSON.stringify({ codename: "PROJECT-KESTREL", dateISO: "2026-08-13", agentId: "clawdi", reclaims: 3 }) + "\n";
const LEDGER_ROW = { msgId: "msg-77", sig: "forwarder|KESTREL|9,42|acme", ts: 1_770_000_000_000, profileKey: "acme" };

// The ledger lives BESIDE the queue dir (usage-ledger.mjs), so the queue needs a parent — a bare mkdtemp
// would put it in the system temp root and dropMatter would rewrite a file shared with every other test.
function queueWithClaim(base, token, { meta = META } = {}) {
  const qdir = join(mkdtempSync(join(tmpdir(), "claim-sweep-terminal-")), "queue");
  mkdirSync(qdir);
  const proc = claimHeldBy(qdir, base, token);
  writeFileSync(`${proc}.meta`, meta);
  for (const [suffix, body] of Object.entries(PROSE)) writeFileSync(join(qdir, `${base}${suffix}`), body);
  return { qdir, proc };
}

test("#785 the ALREADY-DELIVERED terminal, lost inside a sibling's takeover window, ends nothing and deletes nothing", () => {
  const mine = claimToken();
  const { qdir, proc } = queueWithClaim("job-delivered", mine);

  let ended = null;
  const { value: bWon, log } = capturingStderr(() => takeoverClaim(proc, {
    maxClaimAgeMs: 0,
    isAlive: () => {
      // B holds the lock: `.processing` is off disk, which is where this terminal's rename lands.
      ended = finishReclaimedClaim(proc, qdir, "job-delivered", "done", "already delivered",
        { ok: true, recovered: "already-delivered", codename: "PROJECT-KESTREL", runDir: "/runs/2026-08-13-project-kestrel" });
      return true;   // A's token is alive, so B stands down — the correct outcome
    },
  }));

  assert.equal(ended, false, "the terminal reports that it did NOT end this job");
  assert.equal(bWon, false, "B stands down against A's live token");

  // The follow-ons — what this arm adds.
  assert.ok(!existsSync(join(qdir, "job-delivered.done")), "no .done marker: the rename did not happen");
  assert.ok(!existsSync(join(qdir, "job-delivered.done.result")),
    "and no .done.result — a result file for a terminal that is not on disk is exactly the lie #745 removed");
  for (const [suffix, body] of Object.entries(PROSE))
    assert.equal(readOr(join(qdir, `job-delivered${suffix}`)), body,
      `${suffix} survives — the winner's job is RE-ASSEMBLED from the prose, and this is the one deletion no marker state undoes`);

  // The claim's own bookkeeping, for the same reasons arm 1 gives.
  assert.equal(readOr(`${proc}.pid`), mine, "the liveness token survives");
  assert.equal(readOr(`${proc}.meta`), META, "so does the run identity that routes this branch");
  assert.ok(existsSync(proc), "the marker is restored");
  assert.deepEqual(lockResidue(qdir), [], "no lock residue");
  assert.equal(takeoverClaim(proc, { maxClaimAgeMs: 0 }), false,
    "and a third runner stands down — the already-delivered run is not handed back to be run again");
  assert.match(log, /left exactly as they are/, "the operator line says which side effects were skipped");
});

test("#785 the RECLAIM-EXHAUSTED terminal, lost the same way, spends no reclaim and re-opens no dedup gate", () => {
  const mine = claimToken();
  const { qdir, proc } = queueWithClaim("job-spent", mine, { meta: SPENT });
  writeFileSync(matterLedgerPath(qdir), JSON.stringify(LEDGER_ROW) + "\n");

  let ended = null;
  const { log } = capturingStderr(() => takeoverClaim(proc, {
    maxClaimAgeMs: 0,
    isAlive: () => {
      ended = finishReclaimedClaim(proc, qdir, "job-spent", "failed", "reclaim exhausted",
        { ok: false, failedStage: "queue-reclaim", terminalKind: "reclaim-exhausted", codename: "PROJECT-KESTREL" },
        { dropMsgId: "msg-77" });
      return true;
    },
  }));

  assert.equal(ended, false, "the terminal reports that it did NOT end this job");
  assert.ok(!existsSync(join(qdir, "job-spent.failed")), "no .failed marker");
  assert.ok(!existsSync(join(qdir, "job-spent.failed.result")), "and no .failed.result claiming one");
  assert.equal(readMatterLedger(qdir)[0].failed, undefined,
    "the matter-ledger row is NOT marked failed — findDuplicateMatter skips failed rows, so dropping it here " +
    "re-opens the dedup gate against a matter the winner may be mid-resume, and the second ~$40 search runs");
  for (const [suffix, body] of Object.entries(PROSE))
    assert.equal(readOr(join(qdir, `job-spent${suffix}`)), body, `${suffix} survives`);

  assert.equal(readOr(`${proc}.meta`), SPENT,
    "the reclaim counter survives — `.meta` IS where A5's count of spent reclaims lives, and sweeping it " +
    "resets the cap to 0 of 3, re-arming the every-activation resume loop the cap was added to bound");
  assert.equal(readOr(`${proc}.pid`), mine, "and the liveness token survives");
  assert.equal(readOr(`${proc}.skips`), "2\n", "so does the wedge tally");
  assert.deepEqual(lockResidue(qdir), [], "no lock residue");
  assert.match(log, /left exactly as they are/, "the operator line says which side effects were skipped");

  // ORDER MATTERS: `takeoverClaim` returns false both when it stands down AND when the marker is simply
  // absent (its first line is a rename that ENOENTs), so the stand-down is only evidence with the marker
  // proved present first.
  assert.ok(existsSync(proc), "the marker is restored, so the stand-down below is a stand-down and not an absence");
  assert.equal(takeoverClaim(proc, { maxClaimAgeMs: 0 }), false, "so a third runner still stands down");
});

// The control, and it is not optional: every assertion above passes for a `finishReclaimedClaim` that
// simply never does anything. This is the arm that says the guard gates the side effects rather than
// removing them.
test("#785 the UNCONTENDED reclaim terminal still ends the job, sweeps the prose, records the result and frees the matter", () => {
  const { qdir, proc } = queueWithClaim("job-uncontended", claimToken(), { meta: SPENT });
  writeFileSync(matterLedgerPath(qdir), JSON.stringify(LEDGER_ROW) + "\n");
  const result = { ok: false, failedStage: "queue-reclaim", terminalKind: "reclaim-exhausted", codename: "PROJECT-KESTREL" };

  assert.equal(finishReclaimedClaim(proc, qdir, "job-uncontended", "failed", "reclaim exhausted", result,
    { dropMsgId: "msg-77" }), true, "the claim was ours, so the job ended");

  assert.ok(existsSync(join(qdir, "job-uncontended.failed")) && !existsSync(proc), "the marker reached its terminal");
  assert.deepEqual(JSON.parse(readFileSync(join(qdir, "job-uncontended.failed.result"), "utf8")), result,
    "the result records what happened, beside a marker that is actually there");
  for (const s of [".pid", ".meta", ".skips"])
    assert.ok(!existsSync(`${proc}${s}`), `${s} is swept — a left-behind .meta keeps its codename queue-owned forever`);
  for (const suffix of Object.keys(PROSE))
    assert.ok(!existsSync(join(qdir, `job-uncontended${suffix}`)), `${suffix} is swept — a drained queue leaves no residue`);
  assert.equal(readMatterLedger(qdir)[0].failed, true,
    "and the matter is freed: a reclaim-terminal must never block a genuine re-send of the same matter");
  assert.deepEqual(lockResidue(qdir), [], "no lock residue");
});
