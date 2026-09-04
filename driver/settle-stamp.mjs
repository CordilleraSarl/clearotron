// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// settle-stamp.mjs — the terminal state of a run, written into the POOL copy at settle.
//
// THE PROBLEM. A pool run directory proves PUBLICATION and never DELIVERY. `publishReport` writes the
// pool copy and both pipelines write `state: "delivered"` AFTER publish returns, so at the moment
// `meta.json` is composed the terminal state does not exist yet — a `state` field there could only ever
// have recorded "published". A reader holding the pool copy alone (the archive after the workspace run
// dir is gone) therefore cannot tell a delivered run from one that published and then failed, and the
// scorer said so in its own output: "Score the workspace run dir for the settle, while it exists."
//
// THE SEAM. Both pipelines decide the terminal state with `published` IN HAND, and `published.poolRunDir`
// names the pool directory. That is the one moment where the terminal state and the pool location are
// both known, so that is where the stamp is written.
//
// WHAT THIS IS NOT. It is not a verdict inferred from a file's existence — the defect facing the other
// way. The stamp carries an EXPLICIT state and a reader that cannot find one reads "unknown", never
// "not delivered". `a-pool-copy-is-not-a-refusal.test.mjs` pins that meta.json is not read as delivery,
// and it must keep passing.
//
// IT MUST NEVER COST A DELIVERY. This runs on the delivery path, after the client's report is already
// published and the run is already settled. Every write is best-effort: it returns a result the caller
// logs and it throws nothing. A run that delivers and fails to stamp is strictly better than one that
// stamps and fails to deliver — so there is no rung, no retry and no throw in here.
//
// NO chmod ON A POOL DIRECTORY, EVER (the pool root is set-GID and a non-member chmod strips it, after
// which every report 403s). This writes a FILE and group-reads that file, exactly as publish's own
// `writeRO` does, and never touches the directory. Writing into a pool run dir after publish is already
// how the product works — pool-admin.mjs rewrites `meta.json` there long after the run settles.

import { writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

/** The stamp's filename inside the pool run directory. One name, read and written from here only. */
export const SETTLE_FILE = "settle.json";

// `schema_version`, which is the tree's majority spelling for a versioned JSON envelope (279 uses
// against 114 of the bare `schema`). status.json spells it `schema`, and this file's own first draft
// followed that neighbour — a second reader read the inconsistency as a defect, which is reason enough.
// Do not "fix" it back toward status.json.
/** The schema version, so a reader can refuse a shape it does not understand instead of guessing. */
export const SETTLE_SCHEMA_VERSION = 1;

/**
 * Stamp a pool run directory with the terminal state that was just decided.
 *
 * Returns `{ written: true, path }` or `{ written: false, reason }` — never throws, and the caller is
 * expected to log the failure and carry on. `state` is required and recorded verbatim: this function
 * decides nothing about what a run's terminal state IS, it only makes the caller's decision durable.
 *
 * `deliveredAt` IS THE DELIVERY TIME AND NEVER THE WRITE TIME. The two fields exist because they are
 * two facts: at the settle site they coincide, and on a BACKFILL they must differ by however long the
 * backfill lagged. Passing the clock here is exactly the bug the second field makes visible — a real
 * backfill wrote a stamp claiming a run delivered 20 hours after it did, and everything downstream that
 * reads a delivery date (turnaround, an SLA, a client-facing "delivered on") would have inherited it.
 * A backfiller must not compose this value at all: call `backfillSettleStamp`, which reads it.
 */
export function writeSettleStamp(poolRunDir, { state, verdict = null, deliveredAt = null, runId = null, lane = null } = {}) {
  if (!poolRunDir) return { written: false, reason: "no pool run directory — the run published nowhere" };
  if (!state) return { written: false, reason: "no terminal state given — a stamp with no state is the absence it would be mistaken for" };
  const path = join(poolRunDir, SETTLE_FILE);
  try {
    writeFileSync(path, `${JSON.stringify({ schema_version: SETTLE_SCHEMA_VERSION, state, verdict, deliveredAt, runId, lane, stampedAt: new Date().toISOString() }, null, 2)}\n`);
    // Group-read like every other pool file. Best-effort on its own: a stamp nobody can chmod is still
    // a stamp, and the set-GID pool already grants the group.
    try { chmodSync(path, 0o640); } catch { /* best-effort, exactly as publish's writeRO does */ }
    return { written: true, path };
  } catch (e) {
    return { written: false, reason: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * Read a pool copy's settle stamp, or null when there is none to read.
 *
 * NULL MEANS UNKNOWN. A run archived before this stamp existed has no file, a run whose stamp write
 * failed has no file, and neither of those is a run that was not delivered. Every caller must print
 * that distinction rather than collapsing it — which is the whole reason the scorer's delivery answer
 * has four states and not two.
 *
 * A stamp carrying no recognisable `state`, or a schema this build does not know, reads as null for the
 * same reason: an unreadable answer is not an answer, and it must not become a verdict.
 */
export function readSettleStamp(dir) {
  if (!dir) return null;
  try {
    const s = JSON.parse(readFileSync(join(dir, SETTLE_FILE), "utf8"));
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    if (s.schema_version !== SETTLE_SCHEMA_VERSION) return null;
    if (typeof s.state !== "string" || !s.state) return null;
    return s;
  } catch { return null; }
}

/**
 * Stamp an ALREADY-ARCHIVED run from its own workspace status.json.
 *
 * THIS EXISTS BECAUSE THE HAND-ROLLED VERSION OF IT GOT THE ANSWER WRONG. Backfilling by calling
 * writeSettleStamp directly means composing `deliveredAt`, and the obvious value to reach for is the
 * clock — which is the stamping time, not the delivery time. On a live settle the two coincide and the
 * error is invisible; on a backfill they differ by the whole lag, and a stamp is exactly the artifact a
 * later reader trusts for a delivery date. So the backfill does not accept a time: it reads the run's
 * own record, and refuses when it cannot.
 *
 * `runDir` is the WORKSPACE run directory (live or archived) — the pool copy is the thing being
 * stamped and by definition carries no status.json. Best-effort like its sibling: never throws.
 */
export function backfillSettleStamp(poolRunDir, runDir, { readStatus = defaultReadStatus } = {}) {
  const status = readStatus(runDir);
  if (!status) return { written: false, reason: `no readable status.json under ${runDir || "(no run dir given)"} — a backfill has nothing to read the delivery time from` };
  if (!status.state) return { written: false, reason: "status.json carries no state — the run's own record does not say how it ended" };
  // A terminal state with no delivery time is a real shape (a failed run), and it stamps honestly with
  // deliveredAt null. What is refused is a DELIVERED state with no time, because the one value this
  // function exists to preserve would then be missing and the caller would be tempted to invent it.
  if (status.state === "delivered" && !status.deliveredAt)
    return { written: false, reason: "status.json says delivered but carries no deliveredAt — the delivery time this backfill exists to preserve is not recorded" };
  return writeSettleStamp(poolRunDir, {
    state: status.state,
    verdict: status.verdict ?? null,
    deliveredAt: status.deliveredAt ?? null,
    runId: status.runId ?? null,
    lane: status.lane ?? (status.marks ? "knockout" : "clearance"),
  });
}

function defaultReadStatus(runDir) {
  if (!runDir) return null;
  try { return JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")); } catch { return null; }
}
