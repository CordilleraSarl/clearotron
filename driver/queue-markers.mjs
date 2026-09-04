// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The queue's LIVE-STATE vocabulary — one definition, because it has now been written down three times
// and the copies disagreed.
//
// A queue entry is LIVE when something will still happen to it. That is not the same as "a runner is
// executing it right now", and the difference is exactly what cost a run:
//
//   .json                        queued, not yet claimed
//   .processing                  claimed and executing
//.processing.claimed-<token>  claimed, mid-publish — the atomic-claim window  and the
//                                mid-flight takeover window; sweepAbandonedTakeovers owns both
//   .postponed                   PARKED AND RESUMING. A rate-limit park auto-resumes at resetsAt; a
//                                recovery park auto-resumes in ~2 minutes. Both have state on disk and
//                                both continue.
//
// The terminal states — .done, .failed, .cancelled, .duplicate — are absent on purpose: nothing further
// happens to them.
//
// `.postponed` is the one that was missing from the test deploy guard, and a park is the very moment a
// deploy looks safe: the count drops to zero ten seconds after the park and the run resumes 110 seconds
// later, into restarted services and a different commit. R1 PROJECT SABLE on 2026-08-04 executed
// matter-frame through its first delivery attempt on 820ca600 and everything after the resume on
// 7f010768, and nothing in the run record says so.
//
// PURE — no node imports, so a shell guard can ask for this through one tiny script rather than
// restating the pattern and drifting again.
export const LIVE_QUEUE_MARKER_RE = /(\.(json|processing|postponed)|\.processing\.claimed-\S+)$/;

/** Is this queue filename a live entry? Names only — never reads the file. */
export function isLiveQueueMarker(name) {
  return LIVE_QUEUE_MARKER_RE.test(String(name ?? ""));
}

/** The three live states, as the words a marker's suffix spells. */
export const LIVE_QUEUE_STATES = ["json", "processing", "postponed"];

/**
 * WHICH live state, or null when the name is not live. The claim lock is the `.processing` marker
 * renamed while its liveness token is written, so it reports "processing" — the state the job is in.
 */
export function liveQueueState(name) {
  const m = LIVE_QUEUE_MARKER_RE.exec(String(name ?? ""));
  if (!m) return null;
  return m[2] ?? "processing";   // m[2] is the plain suffix; the claim-lock alternative has none
}

// ── the rest of the queue's filename vocabulary ───────────────────────────────────────────────
//
// Same rule as above, extended to the names this module did not yet own. It gained them because a
// harness check retyped four of them from memory, missed nine, and printed "SUFFIX THE RUNNER DOES NOT
// DRAIN — this job is invisible to it" beside every prose sidecar of every live job. That is this
// module's founding failure — a vocabulary written down more than once and the copies disagreeing —
// re-run one file over, so the vocabulary moves here rather than being retyped a fourth time.
//
// Still PURE: object and array literals only, no node imports, so scripts/queue-inflight.mjs stays a
// zero-dependency shell entry point.

/** The states nothing further happens to. `.done`, `.failed`, `.cancelled`, `.duplicate` — never live. */
export const TERMINAL_QUEUE_SUFFIXES = ["done", "failed", "cancelled", "duplicate"];

// Prose fields are carried as raw plain-text SIDECAR files (never inside the JSON manifest) so the
// forwarding agent — which can only `write` files, not `exec` a serializer — never has to escape verbatim
// legal/email prose. A single unescaped `"` in `brief` was the "unparseable job file" intake failure
// (observed live, 2026-06-16). The manifest carries ONLY scalars the agent can't fumble; each prose field
// lives in `<base><suffix>` and is read RAW (no JSON.parse, no unescape). markName is prose-carried too
// (can hold `"`/`&`). runner.mjs assembleJob reads these by name; cleanupProseParts removes them at the
// terminal — so one of these sitting beside a live job is the CONVENTION WORKING, not a stranded file.
export const PROSE_PARTS = {
  markName: ".markName.md",
  brief: ".brief.md",
  rawRequest: ".rawRequest.txt",
  upfrontInstructions: ".upfrontInstructions.txt",
  goods: ".goods.txt",
  deliverableSpec: ".deliverableSpec.txt",
  commercialFlexibility: ".commercialFlexibility.txt",
  priorUse: ".priorUse.txt",
  campaignShape: ".campaignShape.txt",   // P2-C (Round-2 §8a): campaign-shape facts — stated launch shape
};

/** A consumed claim's sidecars, swept together by runner.mjs cleanupClaimSidecars. */
export const CLAIM_SIDECAR_SUFFIXES = [".pid", ".meta", ".skips"];

// Everything a queue dir holds that is NOT a job in a state: the prose a job is assembled from, the
// claim's liveness/identity/tally files, the `.reason` an intake park writes and the `.result` a run
// terminal writes, and the half of an atomic write. A file whose name ends in one of these is beside a
// job, not one.
export const QUEUE_SIDECAR_SUFFIXES = [
  ...Object.values(PROSE_PARTS),
  ...CLAIM_SIDECAR_SUFFIXES,
  ".reason",   // intake park: why the requester was refused (failAtIntake / parkDuplicate)
  ".result",   // run terminal: the pipeline's own {ok, failedStage, runDir, …} record
  ".tmp",      // `<…>.meta.tmp` — the tmp+rename half, present only inside the write
];

/** Is this queue filename a sidecar rather than a job in a state? Names only — never reads the file. */
export function isQueueSidecar(name) {
  const n = String(name ?? "");
  return QUEUE_SIDECAR_SUFFIXES.some((s) => n.endsWith(s));
}
