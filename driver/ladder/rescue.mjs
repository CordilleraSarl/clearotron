// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// rescue.mjs — when a failed attempt's own artifacts are the stage's answer after all.
//
// The stage ladder (gateway.mjs runStageLadder) asks this after a turn fails and before the failure is named
// (turn-failure.mjs nameTheFailure). Two rescues: a nonzero exit whose artifacts this attempt wrote whole, and a
// hard-wall kill whose artifacts had been quiet long enough to be complete. Each refusal is recorded with its cause.

import { statSync } from "node:fs";
import { note } from "../log.mjs";

// ── — WALL RESCUE QUIESCENCE. How long every declared artifact must have been UNTOUCHED when the
// turn settled, for its write to count as provably COMPLETE rather than possibly torn.
//
// The torn-write window is [watchdog decision, child death]: one poll tick plus the SIGTERM→SIGKILL
// escalation (engine/common.mjs killEscalateMs, default 5000ms). 60s is that window with an order of
// magnitude to spare, and the incident clears it by another: on the 2026-08-04 R1 run the
// placement artifact's last write was 13:58:46Z and the wall kill was 14:15:00Z — 974 seconds quiet.
//
// This is the ONE fact a shape validator cannot supply, and it is the entire reason this rescue may do
// what the exit-1 rescue must not. Setting it to 0 is NOT tuning — it deletes the only completeness
// evidence and would rescue post-merge audit 2's torn draft. Disarm with CLEAROTRON_WALL_RESCUE=0 instead.
const wallRescueQuiesceMs = () => 60000;   // step 3 — was a knob; no environment ever set it
const wallRescueEnabled = () => !/^(0|off|false|no)$/i.test(String(process.env.CLEAROTRON_WALL_RESCUE ?? "").trim());

// Exit-1 adapter truth (charter P1 §2): the claude CLI reports a provider error on the FINAL assistant
// message (an HTTP 500 after the work was done) as subtype:"success" + is_error:true, which the adapter
// rightly converts to a nonzero exit — but by then the turn's Write already landed the artifact, and
// re-running finished work burned ~35 min on the R-round evidence run. So before a nonzero exit is
// accepted as failure, judge the ARTIFACT exactly as the skip path does (exists + validates), with one
// extra requirement the skip path doesn't need: the file must have been WRITTEN by THIS ATTEMPT
// (differs from the attempt-start snapshot) — an inherited/stale file, and equally an EARLIER
// ATTEMPT's file, never rescues a failed turn.
//
// A KILL ANYWHERE IN THIS LADDER CLOSES THE RESCUE (post-merge audit 2, 2026-07-31). The design
// always said the rescue "never applies to a kill — a cut-down turn's artifact may be mid-write";
// testing only the CURRENT attempt's `killed` honoured that one attempt at a time, so attempt 1 =
// kill that wrote a torn partial + attempt 2 = nonzero exit shipped the partial as stage truth.
// Both legs of the fix are needed, because they refuse different things:
//   · the per-attempt snapshot refuses an EARLIER attempt's bytes outright;
//   · `killSeen` refuses this attempt's own write once a kill has torn the file underneath it —
//     freshness is `stat differs`, i.e. a MUTATION, never a proof of complete rewrite (a patch, an
//     append, or a Write killed mid-flush all satisfy it), and a stage `validate` is a SHAPE check,
//     not a completeness proof: the audit repro is a torn draft that passes its own validator.
// Only register stages carry a backstop for this (register-taint.mjs, on these very rows);
// synthesis / narrative / cards / digest have none, and synthesis is where the evidence run took its
// 137 hard-wall kill. This does NOT touch the plain retry ladder register-taint's corpus audit found
// benign (kill → fresh full redo that EXITS CLEAN): that turn reports completion and is gated on its
// final state by the normal success path above. The rescue is the opposite case by construction — the
// turn did not report completion, and completeness of its write is exactly what is unknown.
// Still never applies to a rate-limit rejection either (0 tokens, nothing written).
//
// `wroteTruth(why)` is the ladder's one judgement of this attempt's artifacts: present, written by this attempt and
// passing the stage's validator. Returns the failure after the rescues, null when one accepted the artifacts, with
// what the attempt row records about it.
export function rescueAttempt({ fail, files, killClass, killSeen, signals, validate, wall, settledAt, name, rel, wroteTruth }) {
  let rescued = null;
  let quiescentMs = null;   //: how long the artifact had been untouched when the turn settled
  let rescueRefused = null; //: WHICH of the rescue's four causes refused — on the row, not only in a note
  let rescueRefusedFile = null, rescueRefusedReason = null;   //: and which file, and on what
  if (fail && /^nonzero_exit_/.test(fail) && files.length) {
    if (killClass || killSeen) {
      note(`[${name}] ${fail} with a kill-class attempt in this ladder — the exit-1 rescue stays CLOSED (a killed turn's artifact may be torn mid-write and a validator cannot prove it whole); failing honestly instead`);
    } else if (wroteTruth()) {
      rescued = fail;
      fail = null;
      note(`[${name}] ${rescued} but every expected artifact is present, fresh and valid — accepting the artifact as stage truth (a final-message provider error must not re-run finished work)`);
    }
  }
  // ── — THE WALL RESCUE ────────────────────────────────────────────────────────────────────
  //
  // A stage SIGKILLed at its hard wall AFTER it had already written a complete, valid artifact is a
  // stage that SUCCEEDED. Measured on R1 2026-08-04: placement-inquiry walled twice (1861s/1800s and
  // 2760s/2700s, both `wrote: true`, the second `noChange: true`), parked the run — and the resume two
  // minutes later SKIPPED it, because pipeline.mjs's skip predicate found the artifact present and
  // passing its own validator. 77 minutes of dispatch, 335,782 output tokens and one park out of a
  // budget of three, all spent after the deliverable was finished.
  //
  // WHY THIS MAY DO WHAT THE EXIT-1 RESCUE ABOVE MUST NOT. That refusal is not wrong and is not being
  // reversed: post-merge audit 2 pinned a torn draft that CLEARS its own shape validator, and
  // `stat differs` is a mutation, never a proof of complete rewrite. What this arm adds is the one
  // fact neither has — QUIESCENCE. The torn-write window is [watchdog decision, child death]: a poll
  // tick plus the SIGTERM→SIGKILL escalation, single-digit seconds. An artifact that had been
  // untouched for a full minute when the turn settled was not being written when the turn was killed.
  // On the incident the margin was 974 seconds. On the audit's repro it is zero, which is why that
  // fixture still fails exactly as it did.
  //
  // AND IT ADMITS NOTHING THE RESUME WOULD REFUSE. The skip predicate accepts these same bytes minutes
  // later on the same disk; this only stops the run paying a second wall, a park and a resume to reach
  // the same answer. The resume's `!freshness.stale` arm is deliberately NOT copied: it compares
  // declared inputs against a stamp written only on success, so at kill time it is not merely
  // unnecessary but meaningless — and the stage cannot be stale against inputs it has just this moment
  // read and acted on.
  //
  // A stage with no validator, or whose artifact fails it, or which never wrote, is untouched.
  else if (fail === "timeout" && signals?.hardWall && files.length && validate && wallRescueEnabled()) {
    // — A FILE THAT COULD NOT BE STAT'ED IS NAMED, WITH WHY, rather than folded into a number. It
    // used to be a -1 in `quiescentMs` and the cause `artifact-unreadable`, and the commonest way to get
    // there is not a filesystem fault at all: the turn was killed before it wrote. Measured on two
    // stages of one run, 2026-09-10: both rows read `wrote: false`, `quiescentMs: -1`,
    // `artifact-unreadable`, for files that did not exist. An ABSENT file (ENOENT) is its own cause now;
    // `artifact-unreadable` stays for a stat that fails any other way, with its error code. Rows
    // written before this change say `artifact-unreadable` for both.
    //
    // `quiescentMs` IS A MEASUREMENT OR IT IS ABSENT. With a file unstat'able there is no quiescence of
    // the set to measure, so it stays null and the row omits it: a -1 reads as a number to anything that
    // averages or compares it. An mtime that lands after the settle instant (written in that same
    // instant, or a clock step) measures 0 rather than a negative; it is the under-quiescence case.
    let missing = null;
    const quiet = [];
    for (const f of files) {
      try { quiet.push(Math.max(0, settledAt - statSync(f).mtimeMs)); }
      catch (e) { if (!missing) missing = { file: rel(f), code: String(e?.code ?? "unknown") }; }
    }
    quiescentMs = missing || !quiet.length ? null : Math.min(...quiet);
    const bar = wallRescueQuiesceMs();
    const why = {};
    if (quiescentMs !== null && quiescentMs >= bar && wroteTruth(why)) {
      rescued = fail;
      fail = null;
      note(`[${name}] hard-wall kill at ${Math.round(wall)}s, but every expected artifact was written by this attempt, passes its validator and had been untouched for ${Math.round(quiescentMs / 1000)}s when the turn settled — the stage FINISHED and the wall is a fact about the dispatch, not a failure of the stage (the resume's skip path would accept these same bytes)`);
    } else {
      // Said out loud, because "the rescue considered it and refused" and "the rescue never looked"
      // must not be the same silence. This is the file that reads an absence as a diagnosis otherwise.
      //
      // — AND SAID ON THE ROW, not only in a note. The note goes to the operator's console; the
      // JOURNAL is what a later round reads, and `rescued: null` reads identically for all three
      // refusal causes. Measured on the 2026-08-09 R1: placement-inquiry was killed at its
      // hard wall having WRITTEN its artifact and lain quiescent for 371 s against a 60 s bar — so the
      // rescue was refused on the third cause, its validator — and 31 minutes of finished work were
      // discarded and re-run cold. `grep -c rescue run.jsonl` on that run returns 0. Nothing in the
      // record said why, and reconstructing it took a file-mtime comparison against a preserved run dir.
      rescueRefused = missing ? (missing.code === "ENOENT" ? "artifact-absent" : "artifact-unreadable")
        : quiescentMs < bar ? "under-quiescence"
        : "not-written-by-this-attempt-or-invalid";
      // — AND WHICH FILE, AND ON WHAT: an unstat'able file with its error code; under the bar, the file
      // touched last (`quiescentMs` carries the number); otherwise the first file the artifact judgement
      // failed, with its cause — `absent`, `not-written-by-this-attempt`, or the validator's own reason.
      if (missing) { rescueRefusedFile = missing.file; rescueRefusedReason = missing.code; }
      else if (quiescentMs < bar) rescueRefusedFile = rel(files[quiet.indexOf(quiescentMs)]);
      else { rescueRefusedFile = why.file ?? null; rescueRefusedReason = why.reason ?? why.cause ?? null; }
      note(`[${name}] hard-wall kill at ${Math.round(wall)}s — wall rescue REFUSED (${rescueRefused}: ${rescueRefusedFile ?? "no file named"}${rescueRefusedReason ? `, ${rescueRefusedReason}` : quiescentMs < bar ? `, touched ${Math.round(quiescentMs / 1000)}s before the kill, under the ${Math.round(bar / 1000)}s bar` : ""}); failing honestly as timeout`);
    }
  }
  return { fail, rescued, quiescentMs, rescueRefused, rescueRefusedFile, rescueRefusedReason };
}
