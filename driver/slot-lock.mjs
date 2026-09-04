// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// slot-lock.mjs — the cross-process counting-slot lock.
//
// ONE user today: the RUN-slot cap (pipeline.acquireRunSlot, V4-7). It had a second — a TURN cap over
// the command lanes of an agent gateway, where manual CLI relaunches were the documented June-12
// trigger, which is why this is slot-FILE based and an in-memory semaphore can never work. That gateway
// left the product with the delivery mode it served, so the turn cap went with it. The
// cross-process design stays for the reason it was built: two runner processes must agree on the count.
//
// Slot file content is "<pid>:<nonce>[:<tag>]":
//   - the nonce makes release OWNERSHIP-VERIFIED (a reclaimed/rotated slot is someone else's lock);
//   - the optional tag carries the run's AGENT for the per-agent admission rule (one run per agent —
//     Goal 1 is cross-agent parallelism; a same-agent manual relaunch queues exactly like today,
//     keeping the deferred M2 within-agent session-lock risk fenced off);
//   - deploy.sh's in-flight guard parses the pid with `cut -d: -f1` — keep the pid first.
//
// Stale reclaim is MUTEX-GATED, not rename-based: a bare read→rename could steal a freshly
// re-created LIVE lock (reader saw a dead pid, a competitor reclaimed + a new holder wx-created,
// the stale reader's rename then moved the live file — cap violated in exactly the post-crash
// thundering-herd window). Under the per-slot `.reclaim` mutex the holder RE-READS the slot and
// removes it only if the holder is still dead; fresh wx-creates can't slip in while the slot file
// exists, so verify-then-unlink has no steal window. A dead reclaimer's mutex is itself reclaimed
// (it is held only across synchronous ops).
//
// Every acquire pass scans ALL "<prefix>-*.lock" files — not just indexes 0..cap-1 — so live
// holders above a lowered/divergent cap still count against admission (two processes started with
// different env caps can otherwise overcommit) and dead high-index slots still get reclaimed.
//
// Known accepted limits: a SIGSTOPped (T-state) holder counts as live (kill-0 semantics) and pins
// its slot until resumed/killed; pid reuse can make a dead holder look live until that pid exits.
// Both need operator action anyway and fail SAFE (under-admission, never overcommit).

import { writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

// EPERM proves the pid EXISTS (owned by another user — e.g. a forgotten `sudo -u <service-account>`);
// only ESRCH proves death. Treating EPERM as dead would let a cross-user racer reclaim a live lock.
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const newNonce = () => `${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

const fieldsOf = (raw) => String(raw).split(":");
const pidOf = (raw) => Number(fieldsOf(raw)[0]) || 0;
const tagOf = (raw) => fieldsOf(raw).slice(2).join(":") || null;

// Remove `slot` iff its holder is (still) dead — under the per-slot reclaim mutex (see header).
function tryReclaim(slot) {
  const mutex = `${slot}.reclaim`;
  try { writeFileSync(mutex, `${process.pid}:${newNonce()}`, { flag: "wx" }); }
  catch (e) {
    if (e.code !== "EEXIST") throw e;
    // a crashed reclaimer's mutex is itself stale — clear it; the slot is retried next pass
    try { if (!pidAlive(pidOf(readFileSync(mutex, "utf8")))) rmSync(mutex, { force: true }); } catch { /* gone */ }
    return;
  }
  try {
    let raw = null;
    try { raw = readFileSync(slot, "utf8"); } catch { return; }   // already reclaimed/released
    if (!pidAlive(pidOf(raw))) rmSync(slot, { force: true });     // re-verified under the mutex
  } finally {
    try { rmSync(mutex, { force: true }); } catch { /* best-effort */ }
  }
}

// ONE census pass over every slot file: count LIVE holders (at any index — see the header on why
// the scan is not bounded by cap), reclaim dead ones, and report whether `tag` is currently held.
// Shared by acquireSlot's poll loop and freeSlots so the arithmetic that DECIDES admission and the
// arithmetic that REPORTS capacity can never drift apart.
function census(dir, prefix, tag) {
  let live = 0;
  let tagHeld = false;
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.startsWith(`${prefix}-`) && n.endsWith(".lock")); } catch { /* dir vanished — recreated by the caller */ }
  for (const n of names) {
    const slot = join(dir, n);
    let raw = null;
    try { raw = readFileSync(slot, "utf8"); } catch { continue; }   // released mid-scan
    if (pidAlive(pidOf(raw))) {
      live++;
      if (tag && tagOf(raw) === tag) tagHeld = true;
    } else {
      tryReclaim(slot);
    }
  }
  return { live, tagHeld };
}

/**
 * How many of `cap` slots are free RIGHT NOW. Non-blocking; never takes one. Also reclaims
 * dead-PID slots in passing, exactly as an acquire pass does.
 *
 * ADVISORY, AND THE CALLER MUST TREAT IT AS ADVISORY. Two processes reading this concurrently see
 * the same free count and can both act on it, so the sum of what they admit may exceed `cap`. That
 * is safe here only because acquireSlot remains the sole thing that GRANTS a slot: an over-admitted
 * caller just blocks inside it, exactly as every caller did before this function existed. Use it to
 * decide how much work to START, never as a guarantee about how much will RUN.
 */
export function freeSlots({ dir, cap, prefix = "slot" }) {
  // The same refusal as acquireSlot, and this one is not symmetry for its own sake — it fails in the
  // OPPOSITE direction, which is worse. `Math.max(0, NaN - live)` is NaN, `NaN <= 0` is false, and the
  // runner's admission loop breaks on `budget <= 0`: a NaN budget never runs out, so a misconfigured cap
  // would make the runner claim EVERY queued job rather than none of them. A cap that cannot be read is
  // not a licence to admit without one.
  if (!Number.isInteger(cap) || cap < 1)
    throw new Error(`[slot-lock] cap must be a positive integer; got ${JSON.stringify(cap)}. `
      + `A budget computed from an unreadable cap never runs out, so the caller admits everything.`);
  return Math.max(0, cap - census(dir, prefix, null).live);
}

/**
 * Acquire one of `cap` slots in `dir`. Returns a handle {slot, token} for releaseSlot. Blocks
 * (polling every pollMs) until admitted; reclaims dead-PID slots (mutex-gated); refuses ONLY a `cap`
 * that cannot admit anything ( — see below) and a real fs error.
 *  - tag: per-tag admission cap of ONE — the acquire also waits while any LIVE holder carries the
 *    same tag (the run-slot per-agent rule). Untagged acquires ignore tags entirely.
 *  - onWait(elapsedMs): fires when the caller first waits and roughly once a minute after, so a
 *    long-starved acquisition stays diagnosable from the journal.
 * Non-contention fs errors (ENOSPC/EACCES/EROFS…) THROW — a misconfigured lock dir must fail
 * loudly, never poll forever looking like contention. A misconfigured `cap` is that same class and now
 * gets the same answer: `NaN` (from `Number("two")`) makes `live < cap` false forever AND makes the
 * grant loop `for (let i = 0; i < cap; i++)` execute zero times, so the acquirer waited in the poll
 * loop with no error, no log line and no timeout — indistinguishable from ordinary contention, which is
 * exactly what the fs rule above exists to prevent. Zero and negatives are refused with it: a cap that
 * can never admit anyone is not a cap, it is a deadlock with a friendly name.
 *
 * The engine's own callers can no longer reach this refusal — `config.maxConcurrentRuns` refuses a
 * non-numeric value by name at the read and floors the rest at 1 — so this is defence for the module,
 * which is shared and takes `cap` from whoever calls it. It is not the fix for the wedge; the fix is at
 * the read. This is what stops the next caller reintroducing it.
 */
export async function acquireSlot({ dir, cap, pollMs = 250, prefix = "slot", tag = null, onWait = null }) {
  if (!Number.isInteger(cap) || cap < 1)
    throw new Error(`[slot-lock] cap must be a positive integer; got ${JSON.stringify(cap)}. `
      + `A cap that cannot admit anyone is not a cap — waiting on it would look exactly like `
      + `contention and never end.`);
  mkdirSync(dir, { recursive: true });
  const token = `${process.pid}:${newNonce()}${tag ? `:${tag}` : ""}`;
  const notifyEvery = Math.max(1, Math.round(60000 / pollMs));
  const t0 = Date.now();
  for (let polls = 0; ; polls++) {
    // census pass over EVERY slot file: count live holders (any index), reclaim dead ones,
    // and detect a live same-tag holder (per-agent admission).
    const { live, tagHeld } = census(dir, prefix, tag);
    if (live < cap && !tagHeld) {
      for (let i = 0; i < cap; i++) {
        const slot = join(dir, `${prefix}-${i}.lock`);
        try {
          writeFileSync(slot, token, { flag: "wx" });   // atomic exclusive create
          return { slot, token };
        } catch (e) {
          if (e.code !== "EEXIST") throw e;             // real fs trouble — fail loudly
        }
      }
    }
    if (polls % notifyEvery === 0) onWait?.(Date.now() - t0);
    await sleepMs(pollMs);
  }
}

/** Free the slot ONLY if it still holds OUR token — a reclaimed/rotated slot belongs to someone
 *  else and must never be unlinked by a stale holder. (Safe read-then-rm: only a DEAD holder's
 *  slot is ever reclaimed, and we are demonstrably alive while releasing.) */
export function releaseSlot(handle) {
  if (!handle?.slot) return;
  try {
    if (readFileSync(handle.slot, "utf8") === handle.token) rmSync(handle.slot, { force: true });
  } catch { /* already gone */ }
}
