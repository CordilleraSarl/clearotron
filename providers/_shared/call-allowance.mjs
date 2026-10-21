// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// call-allowance.mjs — THE RUN'S ALLOWANCE OF PAID FOLLOW-UP REGISTER CALLS.
//
// The plan bounds its own questions when it compiles, released families included. What it does not bound is the
// questions a model proposes after reading an answer: on a test run of a crowded matter, one run's follow-ups made
// 717 calls, 555 of them paid, before it was stopped. Those follow-ups now draw on one allowance per run, shared by
// every worker and every pass, so parallel workers cannot each spend it. Ruled 2026-10-21: 250 paid follow-up
// register calls.
//
// HOW IT IS KEPT. Each paid call a follow-up makes appends one line to the run's allowance file, beside the run's
// record log in its `_driver/` folder. Before each follow-up runs, the file is read. A follow-up met with the
// allowance spent is not run: it is recorded as outstanding, with its reason, and the run carries on to placement
// and delivery. A search already running finishes, so the count can pass the limit by what was in flight. Calls the
// run's memory answers cost nothing and are not counted. The file is never reset, so a resumed gathering inherits
// what the run has spent.
//
// The limit stops further follow-ups. It is never evidence that the search was sufficient, and it never kills,
// holds or discards a run.
//
// WHAT IS NEVER COUNTED AND NEVER REFUSED. The plan's own questions, and the identical mark's own required read: the
// plan's question on the identical mark (provenance "mark"), and the follow-ups that narrow it while keeping the
// client's goods (the goods cut, then one class or one market at a time within it). A limit must not starve the
// required read; those steps are bounded by the steps themselves. A follow-up on the identical mark that drops the
// goods cut is a wider read, and it counts like any other.

import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { RUN_RECORD_LOG_FILE } from "./ledger-path.mjs";

/** The run's allowance, in paid follow-up register calls (ruled 2026-10-21, 250). */
export const RUN_CALL_LIMIT = 250;
export const ALLOWANCE_FILE = "register-call-allowance.jsonl";
export const OUTSTANDING_FILE = "register-outstanding.jsonl";
/** The reason an outstanding question carries. A code, not a sentence: the words the model reads are separate. */
export const OUTSTANDING_REASON = "run-call-limit";

/**
 * The run's `_driver/` folder, found from its record log: the caller's, else the one the driver handed the
 * process. A log that is not a run's (the box-wide fallback) gives null: no run, no allowance. PURE but for env.
 */
export function runDriverDirOf(recordLog = null, env = process.env) {
  const log = typeof recordLog === "string" && recordLog.trim()
    ? recordLog.trim() : String(env?.CLEAROTRON_REGISTER_RECORD_LOG ?? "").trim();
  if (!log || basename(log) !== RUN_RECORD_LOG_FILE) return null;
  return dirname(log);
}

export const allowancePath = (driverDir) => (driverDir ? join(driverDir, ALLOWANCE_FILE) : null);
export const outstandingPath = (driverDir) => (driverDir ? join(driverDir, OUTSTANDING_FILE) : null);

/**
 * The counted paid calls the run has made, read off the file every time, because other processes add to it.
 * A file not yet written is 0. A file that exists and cannot be read counts as spent, and says so: an allowance
 * nobody can read cannot be shown to have room.
 * @returns {{ spent: number, unreadable: boolean }}
 */
export function spentCalls(driverDir) {
  const p = allowancePath(driverDir);
  if (!p) return { spent: 0, unreadable: false };
  let text;
  try { text = readFileSync(p, "utf8"); }
  catch (e) { return e?.code === "ENOENT" ? { spent: 0, unreadable: false } : { spent: Infinity, unreadable: true }; }
  let n = 0;
  for (const line of text.split("\n")) if (line.trim()) n++;
  return { spent: n, unreadable: false };
}

/** Whether a counted question may run now. PURE but for the read. */
export function allowanceOpen(driverDir, limit = RUN_CALL_LIMIT) {
  const { spent, unreadable } = spentCalls(driverDir);
  return { open: !unreadable && spent < limit, spent, limit, unreadable };
}

// One line per write, appended: each process's line lands whole, whatever the others are writing.
function appendLine(path, row) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(row) + "\n");
  } catch { /* the count must never break a search; a lost line under-counts by one */ }
}

/** Record one counted paid call. Called from the shared call ledger, never by a provider directly. */
export function recordCountedCall(driverDir, row) {
  const p = allowancePath(driverDir);
  if (p) appendLine(p, { ts: new Date().toISOString(), ...row });
}

/** Record a question the allowance did not let run. */
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
 * How an entry stands against the allowance, before it runs. PURE.
 *   "required" — the identical mark's own read: never counted, never refused.
 *   "plan" — a question of the plan, released families included: never counted, never refused.
 *   "counted" — a question a model proposed (a follow-up), from any worker and any pass.
 * @param {object} e  the plan or supplemental entry
 * @param {{ identicalTerms?: Set<string> }} ctx
 */
export function allowanceClass(e, { identicalTerms = new Set() } = {}) {
  if (asksIdenticalMark(e, identicalTerms) && (e?.origin !== "supplemental" || hasGoods(e))) return "required";
  return e?.origin === "supplemental" ? "counted" : "plan";
}
