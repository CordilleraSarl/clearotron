// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// follow-up-searches.mjs — A SAFETY NET UNDER THE FOLLOW-UP SEARCHES A RUN'S MODEL ADDS.
//
// The engine decides it has searched enough the way a lawyer does: the required reads are done, and more searching
// would not change the advice. This is not that decision, and nothing a model reads names it. It is a net in code
// for a run that goes wrong. On a test run of a crowded matter the register workers kept proposing narrower
// searches, 178 of them, until the run was stopped from outside. The plan bounds its own questions when it
// compiles, and nothing bounded the questions a model proposes after reading an answer. Those now share one count
// per run, kept for every worker and every pass together, so parallel workers cannot each run past it.
//
// WHAT IS COUNTED: one per follow-up search the run sends to the register, whatever the register makes of it. A
// question that takes one request or several counts once, and so does one the run's memory answers, so the count
// means the same on every register. A question answered from what the run already holds is never sent and never
// counted. The plan's own questions, released families included, and the identical mark's own required read (the
// plan's question on it, and the follow-ups that narrow it keeping the client's goods) are never counted and never
// refused: a net must not starve the required read.
//
// WHEN IT IS REACHED, a follow-up is not sent. It is recorded as outstanding, any answer it already had stands, and
// the run carries on to placement and delivery with what it has. A search already sent finishes. The count is never
// reset, so a resumed gathering inherits it. It never kills, holds or discards a run, and it is never evidence that
// the search was sufficient.
//
// HOW IT IS KEPT: one line per follow-up search, appended to a file in the run's `_driver/` folder beside its
// record log, read before each follow-up is sent. Every process appends to the same file, so the count is shared.

import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { RUN_RECORD_LOG_FILE } from "./ledger-path.mjs";

/** The run's net, in follow-up searches: 120 (design, from the saved runs: proper runs needed 2 to 68). */
export const FOLLOW_UP_SEARCH_LIMIT = 120;
export const SEARCHES_FILE = "follow-up-searches.jsonl";
export const OUTSTANDING_FILE = "register-outstanding.jsonl";
/** The code an outstanding question carries: a follow-up the net did not send. A code, never a sentence. */
export const OUTSTANDING_REASON = "follow-up-not-sent";

/**
 * The run's `_driver/` folder, found from its record log: the caller's, else the one the driver handed the
 * process. A log that is not a run's (the box-wide fallback) gives null: no run, no count. PURE but for env.
 */
export function runDriverDirOf(recordLog = null, env = process.env) {
  const log = typeof recordLog === "string" && recordLog.trim()
    ? recordLog.trim() : String(env?.CLEAROTRON_REGISTER_RECORD_LOG ?? "").trim();
  if (!log || basename(log) !== RUN_RECORD_LOG_FILE) return null;
  return dirname(log);
}

export const searchesPath = (driverDir) => (driverDir ? join(driverDir, SEARCHES_FILE) : null);
export const outstandingPath = (driverDir) => (driverDir ? join(driverDir, OUTSTANDING_FILE) : null);

/**
 * The follow-up searches the run has sent, read off the file every time, because other processes add to it.
 * A file not yet written is 0. A file that exists and cannot be read counts as full, and says so: a count
 * nobody can read cannot be shown to have room.
 * @returns {{ sent: number, unreadable: boolean }}
 */
export function followUpSearchesSent(driverDir) {
  const p = searchesPath(driverDir);
  if (!p) return { sent: 0, unreadable: false };
  let text;
  try { text = readFileSync(p, "utf8"); }
  catch (e) { return e?.code === "ENOENT" ? { sent: 0, unreadable: false } : { sent: Infinity, unreadable: true }; }
  let n = 0;
  for (const line of text.split("\n")) if (line.trim()) n++;
  return { sent: n, unreadable: false };
}

/** Whether one more follow-up may be sent now. PURE but for the read. */
export function followUpRoom(driverDir, limit = FOLLOW_UP_SEARCH_LIMIT) {
  const { sent, unreadable } = followUpSearchesSent(driverDir);
  return { open: !unreadable && sent < limit, sent, limit, unreadable };
}

// One line per write, appended: each process's line lands whole, whatever the others are writing.
function appendLine(path, row) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(row) + "\n");
  } catch { /* the count must never break a search; a lost line under-counts by one */ }
}

/** Record one follow-up search, as it is sent. Called by the plan executor, never by a provider. */
export function recordFollowUpSearch(driverDir, row) {
  const p = searchesPath(driverDir);
  if (p) appendLine(p, { ts: new Date().toISOString(), ...row });
}

/** Record a follow-up the net did not send. */
export function recordOutstanding(driverDir, row) {
  const p = outstandingPath(driverDir);
  if (p) appendLine(p, { ts: new Date().toISOString(), reason: OUTSTANDING_REASON, ...row });
}

/** The questions recorded as outstanding, by qid (the latest row for each). [] when none or unreadable. */
export function readOutstanding(driverDir) {
  const p = outstandingPath(driverDir);
  if (!p) return [];
  let text;
  try { text = readFileSync(p, "utf8"); } catch { return []; }
  const byQid = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r?.qid) byQid.set(String(r.qid), r); } catch { /* a torn line is skipped */ }
  }
  return [...byQid.values()];
}

const normTerm = (s) => String(s ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const hasGoods = (e) => (Array.isArray(e?.goods_text) ? e.goods_text.some((g) => String(g ?? "").trim())
  : String(e?.goods_text ?? "").trim() !== "");

/** The identical mark's terms, from the frozen plan's own questions on it (provenance "mark"). PURE. */
export function identicalMarkTerms(frozenPlan) {
  const out = new Set();
  for (const e of Array.isArray(frozenPlan?.entries) ? frozenPlan.entries : []) {
    if (e?.provenance === "mark" && String(e?.predicate ?? "") === "exact" && typeof e?.term === "string" && e.term.trim()) out.add(normTerm(e.term));
  }
  return out;
}

/** Whether an entry asks the identical mark's own question: an exact question on one of its terms. PURE. */
export function asksIdenticalMark(e, identicalTerms = new Set()) {
  return String(e?.predicate ?? "") === "exact" && identicalTerms.has(normTerm(e?.term));
}

/**
 * How an entry stands against the net, before it is sent. PURE.
 *   "required" — the identical mark's own read: never counted, never refused.
 *   "plan" — a question of the plan, released families included: never counted, never refused.
 *   "counted" — a question a model proposed (a follow-up), from any worker and any pass.
 * @param {object} e  the plan or supplemental entry
 * @param {{ identicalTerms?: Set<string> }} ctx
 */
export function followUpClass(e, { identicalTerms = new Set() } = {}) {
  if (asksIdenticalMark(e, identicalTerms) && (e?.origin !== "supplemental" || hasGoods(e))) return "required";
  return e?.origin === "supplemental" ? "counted" : "plan";
}
