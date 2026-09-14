// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// notice-owed.mjs — does this run still owe its requester a notice? One reading, for every caller.
//
// WHY THIS IS A MODULE AND NOT A LINE IN THE PURGE. The purge is the one tool in the repository that
// removes bytes, and nothing in it was keyed to a notice still being owed — so it would delete a run
// whose finished report or failure notice nobody had sent, and take the packet with it. The outbox then
// keeps a marker naming a run that no longer exists: a marker that can never be settled, and a thing
// that can never be delivered.
//
// A SECOND NOTION OF OWED-NESS WOULD HAVE BEEN THE SAME DEFECT WEARING A FIX. The delivery path decides
// this from two places and the purge has to decide it from those same two, or the two answers drift and
// the drift is invisible — both sides keep passing their own arms while disagreeing about a real run.
// So the reading is stated once, here, as a pure function over what a caller has already read.
//
// THE TWO SOURCES, AND WHICH ONE DECIDES.
//
//   * A `<runId>.pending` file in the outbox. This is what the courier consumes and what
//     `list_outbox_events` enumerates; it is the delivery side's own work queue.
//   * `.sent` beside the run's status.json, which is the primary settle receipt, and the run's
//     `sendPending` flag, which the delivery path's own comments call best-effort.
//
// `.sent` is therefore the only thing that CLEARS an owed notice, and `sendPending` on its own never
// establishes one against it. A marker plus a `.sent` is a settled delivery whose marker has not been
// acked yet — owed by the courier, not by us, and not a reason to keep bytes.
//
// AN UNREADABLE OUTBOX IS NOT AN EMPTY ONE. `pendingRunIds` is null, never `[]`, when the directory
// could not be read, and every caller gets `state: "unknown"` for every run. This is the whole safety
// property: "the outbox has no marker for this run" and "I could not look at the outbox" produce the
// same empty result from a careless reader, and the careless reading says DELETE. A tool that removes
// bytes must not treat its own blindness as permission.

/**
 * The run ids an outbox directory listing is holding markers for. PURE.
 *
 * @param {string[]|null} names  the directory's filenames, or null when it could not be read
 * @returns {Set<string>|null}   null propagates the could-not-look; it is never an empty set
 */
export function pendingRunIds(names) {
  if (names === null || names === undefined) return null;
  return new Set(names.filter((n) => n.endsWith(".pending")).map((n) => n.replace(/\.pending$/, "")));
}

/**
 * Does this run still owe a notice? PURE.
 *
 * @param {object}          o
 * @param {string}          o.runId
 * @param {Set<string>|null} o.pending      from `pendingRunIds`; null = the outbox could not be read
 * @param {boolean}         o.sent          is there a `.sent` receipt beside the run's status.json
 * @param {boolean}         o.sendPending   the run's own best-effort flag
 * @returns {{state: "owed"|"settled"|"unknown", why: string}}
 */
export function noticeOwed({ runId, pending, sent = false, sendPending = false }) {
  if (pending === null || pending === undefined)
    return { state: "unknown", why: "the outbox could not be read, so whether a notice is owed is not known" };
  // THE RECEIPT WINS OVER BOTH SIGNALS. A marker that outlived its delivery is the courier's to ack.
  if (sent) return { state: "settled", why: "a .sent receipt is beside this run" };
  if (pending.has(String(runId))) return { state: "owed", why: "an unsettled outbox marker names this run" };
  if (sendPending) return { state: "owed", why: "the run still has sendPending armed and carries no .sent receipt" };
  return { state: "settled", why: "no outbox marker and no armed sendPending" };
}
