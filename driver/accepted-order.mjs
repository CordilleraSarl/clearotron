// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// accepted-order.mjs — the order a run was accepted on, kept with the run from intake, and the job a resume or a
// stage replay rebuilds from it.
//
// THE DEFECT. The queue entry carrying an order is consumed when its run starts, and the run kept only what status.json
// and the instructed scope hold: its identity, the marks by name, the goods, the applicant and the territories. A run
// repaired with `--resume` was rebuilt without the order's delivery routing, so its delivery packet named no forwarder
// address and no message to answer, and a stage replayed with `--experiment` lost the stated use, the campaign facts and
// the requester's instructions. A run that failed before delivering keeps the routing nowhere else, and that is the run
// a resume repairs.
//
// SO THE RUN KEEPS ITS ORDER WHOLE, at intake, before any stage can fail: `_driver/accepted-order.json`, written once and
// never rewritten. A resume or replay that is given no job file reconstructs the order from it. An order given again
// explicitly, by a resume with `--job`, that differs from the original is kept beside it as an amendment; the original
// stays. The file is private run data like the rest of the run directory. No stage's context lists it: no model needs
// the routing.
//
// AN OLDER RUN HAS NO SUCH FILE. For it the order is taken from the run's own queue entry where that survives, matched
// by the order's id and checked against the run's frozen scope and account: a conflict refuses the queue entry whole,
// never field by field. Taken from there, it is kept as the run's accepted order, so the run no longer depends on the
// queue entry. Where neither survives, the job is rebuilt from status as before, and the fields only the order held are
// named as unrecovered, internally: nothing is invented in their place, no address is borrowed from the account or
// another order, and a replay on such a job is not a faithful one.

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";
import { atomicWrite } from "./progress.mjs";

export const ACCEPTED_ORDER_FILE = "accepted-order.json";
export const ORDER_AMENDMENTS_FILE = "order-amendments.jsonl";
export const ORDER_RECOVERY_FILE = "order-recovery.json";

/** The fields only the order holds: what a rebuild from status cannot say. Each mark entry's own `ref` and `classes`
 *  are named as `marks[].ref` and `marks[].classes`. */
export const ORDER_ONLY_FIELDS = Object.freeze(["forwarderEmail", "msgId", "conversationId", "clientPrincipal",
  "priorUse", "campaignShape", "upfrontInstructions", "marks[].ref", "marks[].classes"]);

/** A copy of the order as it was accepted, untouched by anything the run does to its job later. null for no order. PURE. */
export function orderSnapshot(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) return null;
  try { return JSON.parse(JSON.stringify(job)); } catch { return null; }
}

const readJson = (file) => { try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; } catch { return null; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The order this run was accepted on, or null when the run holds none (an older run, or an unreadable file). */
export function readAcceptedOrder(runDir) {
  const rec = readJson(driverDir(String(runDir ?? ""), ACCEPTED_ORDER_FILE));
  return rec?.order && typeof rec.order === "object" ? rec.order : null;
}

/**
 * Keep the order with the run. The first order a run is given is written and never rewritten. A later order changes
 * nothing unless it was given explicitly (`explicit`, a job file on a resume) and differs from the original and from
 * the last amendment; then it is appended as an amendment. A job rebuilt by this run's own resume is never kept as the
 * accepted order (`rebuilt`): a reconstruction is not the order. `from` names where a written order came from.
 * Returns what it did: "written", "amended", "kept", or "not-kept".
 */
export function retainAcceptedOrder(runDir, order, { explicit = false, rebuilt = false, from = "intake", now = () => new Date().toISOString() } = {}) {
  if (!runDir || !order) return "not-kept";
  const file = driverDir(runDir, ACCEPTED_ORDER_FILE);
  const original = readAcceptedOrder(runDir);
  if (!original) {
    if (rebuilt || existsSync(file)) return "not-kept";   // an unreadable file is the run's record still: never replaced
    ensureDriverDir(runDir);
    atomicWrite(file, JSON.stringify({ ts: now(), from, order }, null, 2) + "\n");
    return "written";
  }
  if (!explicit || rebuilt || same(order, original)) return "kept";
  const amendments = driverDir(runDir, ORDER_AMENDMENTS_FILE);
  let last = null;
  try { last = readFileSync(amendments, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).pop()?.order ?? null; } catch { /* none yet */ }
  if (last && same(order, last)) return "kept";
  appendFileSync(amendments, JSON.stringify({ ts: now(), order }) + "\n");
  return "amended";
}

/** The run's retained queue entry for order `id`: a finished one (`.done`) or a failed one (`.failed`). null when
 *  neither survives or it does not hold that order. */
export function retainedQueueOrder(queueDir, id) {
  if (!queueDir || !id || /[\\/]/.test(String(id))) return null;
  for (const end of [".done", ".failed"]) {
    const order = readJson(join(queueDir, `${id}${end}`));
    if (order && typeof order === "object" && order.id === id) return order;
  }
  return null;
}

/**
 * Why a retained queue entry is not this run's order, or null when it agrees with everything the run froze of its
 * order: its identity in status, its instructed scope (read through `scopeOf`, the run's own reading of a job), and the
 * account in its frozen profile where the order named one. PURE.
 */
export function queueOrderConflict(order, { status = null, scope = null, profile = null, scopeOf } = {}) {
  for (const k of ["id", "ref", "markName"])
    if (status?.[k] != null && order?.[k] != null && String(status[k]) !== String(order[k])) return `its ${k} differs from the run's`;
  if (scope && typeof scopeOf === "function") {
    const theirs = scopeOf(order);
    for (const k of ["marks", "classes", "jurisdictions", "goods", "customer"])
      if (!same(theirs?.[k] ?? null, scope?.[k] ?? null)) return `its ${k === "customer" ? "applicant" : k} differs from the run's instructed scope`;
  }
  if (typeof order?.profileKey === "string" && order.profileKey && typeof profile?.profileKey === "string" && profile.profileKey
    && order.profileKey !== profile.profileKey) return "its account differs from the run's frozen profile";
  return null;
}

/**
 * The job a resume or replay given no job file runs on, and where it came from:
 *   - "accepted-order": the order the run kept at intake, whole;
 *   - "queue-order": an older run's retained queue entry, matched and checked, then kept as the run's accepted order;
 *   - "status": neither survives, or the queue entry conflicts; the job is `fromStatus()`, and `unrecovered` names the
 *     fields only the order held.
 * `conflict` says why a queue entry was refused. A resume (`write`) records the answer in `_driver/order-recovery.json`,
 * field names and never values, and keeps a matched queue entry as the run's order; a stage replay writes nothing into
 * the run it studies, and its receipt carries the answer instead.
 */
export function rebuildRunOrder({ runDir, status = null, scope = null, profile = null, queueDir = null, scopeOf, fromStatus, write = true, now = () => new Date().toISOString() }) {
  let out;
  const accepted = readAcceptedOrder(runDir);
  if (accepted) out = { job: accepted, source: "accepted-order", unrecovered: [], conflict: null };
  else {
    const queued = retainedQueueOrder(queueDir, status?.id);
    const conflict = queued ? queueOrderConflict(queued, { status, scope, profile, scopeOf }) : null;
    if (queued && !conflict) {
      if (write) retainAcceptedOrder(runDir, orderSnapshot(queued), { from: "queue-order", now });
      out = { job: queued, source: "queue-order", unrecovered: [], conflict: null };
    } else out = { job: fromStatus(), source: "status", unrecovered: [...ORDER_ONLY_FIELDS], conflict };
  }
  if (write) try {
    ensureDriverDir(runDir);
    atomicWrite(driverDir(runDir, ORDER_RECOVERY_FILE), JSON.stringify({ ts: now(), source: out.source,
      unrecovered: out.unrecovered, conflict: out.conflict, faithful: out.unrecovered.length === 0 }, null, 2) + "\n");
  } catch { /* the caller says where the job came from either way */ }
  return out;
}
