// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — IS ANY RUN QUEUED, CLAIMED OR IN FLIGHT RIGHT NOW?
//
// Test refuses to deploy over a live run mechanically. Prod's equivalent is a HUMAN pre-flight line in
// the deploy skill, and a human step that can be skipped under exactly the conditions where it matters
// — urgency — is not a guard. Deploying mid-run feeds one expensive run two different skill versions.
//
// WHY THIS LIVES HERE AND NOT IN THE DEPLOY SCRIPT. This repository does not ship the script that
// installs the units; the operations runbook says so, and then lists the properties "whatever plays
// that role on your host" owes — the in-flight guard first among them. A property a document asks for
// and no code supplies is a human pre-flight line by another name. So the repo supplies the ANSWER as
// one command with an exit status, and the deploy script's obligation shrinks to calling it.
//
// READ-ONLY, AND THAT IS LOAD-BEARING RATHER THAN TIDY. `slot-lock.mjs`'s own census RECLAIMS dead-pid
// slots as it counts them, which is right for an acquire pass and wrong for a pre-flight: a check that
// mutates the thing it is inspecting changes the state the deploy is about to be judged against, and on
// the one path where it matters it would be deleting another process's lock. Nothing here writes.
//
// THE LIVENESS PREDICATE IS THE DRAIN'S OWN. `claimerIsAlive` is what the runner uses to decide whether
// a claim may be taken over, and acceptance 1 asks for the same predicate the queue reads use — a guard
// that answered "live" differently from the runner would refuse deploys the runner considers finished,
// or worse, pass ones it does not. It is fail-safe by design: an unreadable /proc stat on a live pid
// reads as ALIVE, never as gone.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claimerIsAlive, parseClaimSidecar } from "./claim-liveness.mjs";

/** A directory that is not there yet holds nothing; one we may not READ is a different answer entirely. */
function listDir(dir) {
  try { return { names: readdirSync(dir), error: null }; }
  catch (e) { return { names: [], error: e?.code === "ENOENT" ? null : String(e?.code ?? e?.message ?? e) }; }
}

/**
 * Everything holding this deployment open, named.
 *
 * @param {object} a
 * @param {string} a.queueDirs  EVERY queue tree, not the one this box thinks it uses. 's lesson:
 *                                a headless CLEAROTRON_QUEUE_DIR and the agent workspace queues are both
 *                                real, and a guard that reads one of them passes over work sitting in
 *                                the other.
 * @param {string}   a.lockDir    the run-slot lock dir — a slot file is held for the life of a pipeline.
 * @returns {{queued, claimed, stale, slots, unreadable}} — plain arrays, safe to print.
 */
export function liveRunHolds({ queueDirs = [], lockDir = null, isAlive = claimerIsAlive } = {}) {
  const queued = [], claimed = [], stale = [], slots = [], unreadable = [];

  for (const q of (Array.isArray(queueDirs) ? queueDirs : []).filter(Boolean)) {
    const { names, error } = listDir(q);
    if (error) { unreadable.push({ path: q, error }); continue; }
    for (const n of names) {
      if (n.endsWith(".json") && !n.endsWith(".tmp")) { queued.push({ queue: q, id: n.replace(/\.json$/, "") }); continue; }
      if (!n.endsWith(".processing")) continue;
      const id = n.replace(/\.processing$/, "");
      let rec = null;
      try { rec = parseClaimSidecar(readFileSync(join(q, `${n}.pid`), "utf8")); } catch { /* legacy claim, no sidecar */ }
      // NO SIDECAR IS NOT "GONE". A claim with no `.pid` is re-claimable regardless of age, so the run
      // it belongs to is still going somewhere — treated as held, not as debris.
      (rec && !isAlive(rec) ? stale : claimed).push({ queue: q, id, pid: rec?.pid ?? null });
    }
  }

  if (lockDir) {
    const { names, error } = listDir(lockDir);
    if (error) unreadable.push({ path: lockDir, error });
    for (const n of names) {
      if (!n.startsWith("slot-") || !n.endsWith(".lock")) continue;
      let raw = null;
      try { raw = readFileSync(join(lockDir, n), "utf8"); } catch { continue; }   // released mid-scan
      const pid = Number(String(raw).split(":")[0]);
      if (!Number.isFinite(pid)) continue;
      if (isAlive({ pid, starttime: null })) slots.push({ file: n, pid });
    }
  }

  return { queued, claimed, stale, slots, unreadable };
}

/**
 * Does this deployment refuse, and in one sentence, why.
 *
 * A STALE CLAIM REFUSES TOO, and that is a decision rather than an oversight. A `.processing` whose
 * claimer is dead is not debris: the next runner TAKES IT OVER and resumes that run, so deploying
 * across it produces exactly the harm this guard exists for — one expensive run, two skill versions —
 * with the added twist that nobody was watching when it happened. The remedy is to let it finish or to
 * clear it deliberately, both of which are visible acts; the override below is for neither.
 *
 * AN UNREADABLE QUEUE REFUSES. A privilege-limited read that answers "nothing here" is the failure this
 * family of checks exists to refuse, and on a deploy it is the expensive direction: a queue we cannot
 * see is not a queue we know is empty. A queue that does not exist YET is silent — that is a fresh box,
 * not a hidden one.
 *
 * PURE. The override is a caller's decision and is recorded, never inferred. acceptance 2: it
 * must be deliberate, named, and in the output — an override nobody can see in the log is a guard that
 * was never there.
 */
export function deployRefusal(holds, { override = "" } = {}) {
  const h = holds ?? {};
  const parts = [];
  const name = (rows, what) => rows?.length
    ? `${rows.length} ${what}: ${rows.slice(0, 6).map((r) => r.id ?? r.file ?? r.path).join(", ")}${rows.length > 6 ? `, +${rows.length - 6} more` : ""}`
    : null;
  for (const [rows, what] of [[h.queued, "QUEUED"], [h.claimed, "CLAIMED and live"], [h.stale, "CLAIMED by a dead pid (a takeover will resume it)"], [h.slots, "run slot(s) held by a live pid"]]) {
    const s = name(rows, what);
    if (s) parts.push(s);
  }
  if (h.unreadable?.length) {
    parts.push(`${h.unreadable.length} queue/lock location(s) could NOT be read, so this box cannot say they are empty: `
      + h.unreadable.map((u) => `${u.path} (${u.error})`).join(", "));
  }
  if (!parts.length) return { refuse: false, override: null, reason: "no run is queued, claimed or in flight" };

  const found = parts.join(" · ");
  if (String(override ?? "").trim()) {
    return { refuse: false, override: String(override).trim(),
      reason: `OVERRIDDEN — deploying anyway over: ${found}` };
  }
  return { refuse: true, override: null,
    reason: `REFUSED — a deploy now would land inside live work: ${found}. `
      + "Deploying mid-run feeds one expensive run two different skill versions. Wait for the drain, or "
      + "re-run with an explicit named override if this is owner-ordered." };
}
