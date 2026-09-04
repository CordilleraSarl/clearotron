// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-acks.mjs — "I have seen that one", per viewer, and nothing else.
//
//: the Home dashboard's In-flight area accumulates failed runs and there is no way to clear them.
// On the test instance they are the dominant content — a wall of dead runs crowding out the work
// actually running, which is the one thing that section exists to show.
//
// WHAT THIS IS NOT. It is not a state change on the run, not a delete, and NOT 's retire. Retiring
// writes `archive-tags.json`, which is pool-wide: it hides a run from everyone, including the brand
// owner. Dashboard clutter is one person's annoyance, so it gets one person's store. Giving both to one
// control would mean a staff member tidying their own dashboard silently hiding a client's run.
//
// ONE FILE PER VIEWER, and that is the design rather than a layout detail. A single `viewer-acks.json`
// would put every reader's dismissals in one blob on a request path with real concurrency — the exact
// lost update had to engineer around, except here two people acknowledging at the same moment is
// ordinary Tuesday behaviour rather than a rare collision. Per-viewer files mean the only writer of a
// file is that viewer's own requests, and a same-viewer double-click is last-write-wins over one entry.
//
// THE FILENAME IS A HASH, never the email. An address is not a path component — it carries '/', '..'
// and case — and a directory listing of the pool should not enumerate who reads it.
//
// KEYED ON (runId, state), never on runId alone. A run that leaves the state you dismissed it in is a
// different fact: an id-only key would hide a paused run for ever the moment it briefly read as failed,
// and hiding a live run is the failure this whole feature is meant to avoid.
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const ACKS_DIR = 'viewer-acks';

/** The states a run can be acknowledged in. Terminal and NOT delivered: a paused or recovering run is
 *  one somebody still needs to see, and a delivered one never reaches the in-flight area at all. */
export const ACKNOWLEDGEABLE = Object.freeze(['failed', 'cancelled']);

/** How many dismissals one viewer's file keeps, oldest dropped first. A cap rather than a cleanup pass:
 *  an ack for a run that no longer exists costs one line and matches nothing, and walking the pool to
 *  prove a run is gone would put a directory scan on a write path to save bytes. */
const MAX_ACKS = 500;

const fileFor = (poolDir, email) =>
  join(poolDir, ACKS_DIR, `${createHash('sha256').update(String(email ?? '').trim().toLowerCase()).digest('hex').slice(0, 32)}.json`);

/** This viewer's dismissals as runId → state. Missing or unreadable ⇒ nothing is dismissed, never an
 *  error: the file is optional by design and a reader who has dismissed nothing has none. */
export function readAcks(poolDir, email) {
  try {
    const j = JSON.parse(readFileSync(fileFor(poolDir, email), 'utf8'));
    const out = new Map();
    for (const a of Array.isArray(j?.acks) ? j.acks : []) {
      if (a && typeof a.run === 'string' && typeof a.state === 'string') out.set(a.run, a.state);
    }
    return out;
  } catch { return new Map(); }
}

/**
 * Acknowledge a run, or take the acknowledgement back. Returns the resulting map.
 *
 * `state` is the state the viewer is dismissing it IN. A body that lies about it is inert rather than
 * dangerous — the stamp only matches when the run still reads that way — but it is refused anyway, so
 * the rule lives at the door as well as in the key.
 *
 * Written by rename, like the retired sidecar: a reader never sees a half-file, and a crash leaves the
 * previous one intact.
 */
export function setAck(poolDir, email, { runId, state, acknowledged = true }) {
  const current = readAcks(poolDir, email);
  if (acknowledged) {
    if (!ACKNOWLEDGEABLE.includes(state)) throw new Error(`not acknowledgeable: ${state}`);
    current.delete(runId);            // re-inserting moves it to the newest end of the cap
    current.set(runId, state);
  } else {
    current.delete(runId);
  }
  const acks = [...current].slice(-MAX_ACKS).map(([run, s]) => ({ run, state: s }));
  const target = fileFor(poolDir, email);
  const tmp = `${target}.tmp-${process.pid}`;
  mkdirSync(join(poolDir, ACKS_DIR), { recursive: true });
  try {
    writeFileSync(tmp, JSON.stringify({ acks }, null, 2) + '\n');
    renameSync(tmp, target);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the rename already consumed it, or it was never created */ }
    throw e;
  }
  return new Map(acks.map((a) => [a.run, a.state]));
}

/** Stamp `acked` on the rows this viewer has dismissed. The state must still match — see the header. */
export function withAcks(runs, acks) {
  if (!acks || !acks.size) return runs;
  return runs.map((r) => (acks.get(r.runId) === r.state ? { ...r, acked: true } : r));
}
