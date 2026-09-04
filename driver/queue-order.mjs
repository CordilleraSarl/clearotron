// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// queue-order.mjs — the order queued jobs are admitted in, and the order the portal shows.
//
// A ZERO-IMPORT LEAF on purpose: both the runner (which admits in this order) and portal-service
// (which displays and rewrites it) need it, and portal-service must never pull in runner.mjs — that
// module raises undici timeouts on import and drags in the whole pipeline.
//
// Before this existed the queue had NO order. drainQueue scanned with a bare readdirSync (ext4 hash
// order, arbitrary), and `enqueuedAt` — stamped by enqueue.mjs since the beginning — was read by
// nothing. A portal that showed "3rd in line" would have been inventing it.
//
// ADVISORY BY CONSTRUCTION. The file names ids; it does not own them. An id that is listed but gone
// (cancelled through the portal, rm'd by `stop_run`'s bare rmSync) is skipped; an id that is present
// but unlisted (the email door enqueued it a second ago) sorts after everything listed, oldest first.
// So there is no consistency to maintain and nothing to interlock with — a stale entry costs one
// skipped array slot and self-heals on the next write.
//
// The file lives OUTSIDE the queue dir, beside the matter ledger, for that file's own stated reason:
// out there it can never match the `*.json` claim glob, checkRunCaps's `*.{json,processing,postponed}`
// parse set, or prelim-driver.path's watch — and reordering must NOT wake the runner.

import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

export function queueOrderPath(qdir) { return join(dirname(qdir), ".queue-order.json"); }

export function readQueueOrder(qdir) {
  try {
    const j = JSON.parse(readFileSync(queueOrderPath(qdir), "utf8"));
    return Array.isArray(j?.order) ? j.order.filter((s) => typeof s === "string" && s) : [];
  } catch { return []; }   // absent, unreadable or corrupt ⇒ assert nothing, fall through to enqueuedAt
}

export function writeQueueOrder(qdir, order) {
  const p = queueOrderPath(qdir);
  const tmp = `${p}.tmp`;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(tmp, JSON.stringify({ order: [...order], updatedAt: new Date().toISOString() }, null, 2) + "\n");
  renameSync(tmp, p);   // atomic publish — a reader never sees a half-written order
}

/**
 * Sort claimable `<id>.json` filenames into admission order: whatever the order file asserts, then
 * everything else oldest-first by enqueuedAt, then by filename so the result is TOTAL and
 * deterministic — two jobs enqueued in the same millisecond must not swap between passes, or the
 * ordinals the portal shows would flicker for no reason.
 *
 * A job whose manifest will not parse sorts last rather than throwing: the claim is where a bad
 * manifest gets a real answer, and a queue must not be un-drainable because one file is corrupt.
 */
export function orderedQueueFiles(qdir, files) {
  const rank = new Map(readQueueOrder(qdir).map((id, i) => [id, i]));
  const keyed = [...files].map((f) => {
    const listed = rank.get(f.replace(/\.json$/, ""));
    if (listed !== undefined) return { f, tier: 0, pos: listed, at: "" };
    let at = "";
    try { at = String(JSON.parse(readFileSync(join(qdir, f), "utf8")).enqueuedAt ?? ""); } catch { /* sorts by name */ }
    return { f, tier: 1, pos: 0, at };
  });
  keyed.sort((a, b) => a.tier - b.tier || a.pos - b.pos || a.at.localeCompare(b.at) || a.f.localeCompare(b.f));
  return keyed.map((k) => k.f);
}

/** Every queue directory under a workspace root. Mirrors driver.config.queueDirs without importing it. */
export function queueDirsUnder(workspaceRoot) {
  const out = [];
  let names = [];
  try { names = readdirSync(workspaceRoot); } catch { return out; }
  for (const n of names) {
    if (!n.startsWith("workspace-")) continue;
    const q = join(workspaceRoot, n, "studio", "prelim-search", "queue");
    try { readdirSync(q); out.push(q); } catch { /* no queue in this workspace */ }
  }
  return out.sort();
}

/**
 * Apply a caller's requested order to the queue.
 *
 * ── THE RULE: YOU REORDER YOUR OWN WORK, AND NOBODY ELSE MOVES ───────────────────────────────────
 * The caller sees a dense list of only their own jobs and drags within it. So this permutes ONLY the
 * positions their jobs already occupy and leaves every other job's absolute position exactly where it
 * was. Concatenating "their new order, then everyone else" would look identical on their screen and
 * would silently promote them past another tenant's queued work — a reorder control that quietly
 * jumps the queue is worse than no reorder control.
 *
 * `allowed` is the set of ids the caller may move; anything outside it is immovable furniture.
 *
 * Order is per LANE. The lanes are per-agent, drain concurrently against one shared pair of slots, and
 * have no defined order between them — so a request spanning lanes applies the caller's relative order
 * within each. That is honest degradation rather than a cross-lane order this system does not have.
 */
export function reorderQueue({ workspaceRoot, order, allowed }) {
  const want = order.filter((id) => allowed.has(id));
  const lanes = [];
  for (const qdir of queueDirsUnder(workspaceRoot)) {
    let files = [];
    try { files = readdirSync(qdir).filter((f) => f.endsWith(".json") && !f.startsWith(".")); } catch { continue; }
    const current = orderedQueueFiles(qdir, files).map((f) => f.replace(/\.json$/, ""));
    const here = want.filter((id) => current.includes(id));
    if (!here.length) continue;
    // The slots the caller's jobs occupy, refilled in the requested sequence. Everything else is copied
    // across untouched, at the same index it already had.
    const slots = current.map((id, i) => (here.includes(id) ? i : -1)).filter((i) => i >= 0);
    const next = [...current];
    slots.forEach((slot, n) => { next[slot] = here[n]; });
    writeQueueOrder(qdir, next);
    lanes.push({ lane: qdir, moved: here.length });
  }
  return { lanes: lanes.length, detail: lanes };
}
