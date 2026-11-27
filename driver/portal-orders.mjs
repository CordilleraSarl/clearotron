// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-orders.mjs — the orders the portal's Start accepted that have no run yet, for Clearances to list.
//
// An accepted order shows in Clearances as a queued row while its `<id>.json` waits, and as its run's row once the run
// exists. Between and beside those two it showed nowhere: while a worker checked it, and for good once a worker refused
// it before any run. This reads those two states, one row per order, so the person who pressed Start can find it again.
//
// WHICH ORDERS: THE PORTAL'S OWN STARTS (design, 2026-11-27). Each accepted Start is recorded here, per company, by the
// reference it was filed under. The queue's history is not swept: an order placed through a connector is reached by its
// reference and enters the run list once it starts. Every reference is answered through the receipt, inside the
// reader's own visibility, from one listing of the queues per request.
//
// THE RECORD LIVES IN THE WORKSPACE, beside the queue it names, and never in the pool, which is served.
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { markersByReference, orderInScope, receiptIn, stateFromNames } from "./order-receipt.mjs";

export const STARTS_DIR = "portal-starts";

/** One file per company, and per organisation for Generic: the key is hashed so a file name says nothing of whose it is. */
const fileFor = (workspaceRoot, account, organisation) => join(workspaceRoot, STARTS_DIR,
  `${createHash("sha256").update(`${account}\0${account === "generic" ? (organisation ?? "") : ""}`).digest("hex").slice(0, 32)}.jsonl`);

/** Record an order the portal's Start accepted. Best-effort: a record that cannot be written never fails the Start. */
export function recordStart(workspaceRoot, { account, organisation = null, reference, at = new Date().toISOString() } = {}) {
  if (!workspaceRoot || !account || !reference) return false;
  try {
    mkdirSync(join(workspaceRoot, STARTS_DIR), { recursive: true });
    appendFileSync(fileFor(workspaceRoot, account, organisation),
      `${JSON.stringify({ at, reference, account, ...(account === "generic" ? { organisation } : {}) })}\n`);
    return true;
  } catch { return false; }
}

/** The references one record file holds, each once. */
function referencesIn(path) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return []; }
  const seen = new Set();
  for (const line of text.split("\n")) {
    try { const r = JSON.parse(line); if (typeof r?.reference === "string" && r.reference) seen.add(r.reference); } catch { /* a torn line */ }
  }
  return [...seen];
}

/**
 * The record files a request reads. `scopes` is a list of `{ account, organisation }`, one per company the reader is
 * listing; `everything` reads every company's record, for someone who sees everything.
 */
function recordFiles(workspaceRoot, { scopes = [], everything = false }) {
  if (!workspaceRoot) return [];
  if (everything) {
    try { return readdirSync(join(workspaceRoot, STARTS_DIR)).filter((n) => n.endsWith(".jsonl")).map((n) => join(workspaceRoot, STARTS_DIR, n)); }
    catch { return []; }
  }
  return [...new Set(scopes.map((s) => fileFor(workspaceRoot, s.account, s.organisation ?? null)))];
}

const STATES = new Set(["checking", "refused"]);

/**
 * The portal's accepted orders that have no run, as Clearances rows: those a worker is checking, and those refused
 * before any run. A waiting order already has its queued row and an order with a run has the run's row, so neither is
 * here, and each order is one row at any moment. Each is held to the reader's visibility: `scopes` (one
 * `{ account, organisation }` per company being listed) or `everything`. Newest first.
 *
 * BOUNDED BY THE ORDERS THAT CAN BE ROWS (review, 2026-11-27). Clearances calls this on every
 * open, synchronously, so its cost is paid by everyone on the portal process. Each queue listing is indexed by
 * reference in one pass, and an order whose names already settle it (delivered, cancelled, waiting, parked) is passed
 * over without opening a file: only an order a worker may be checking, or one that stopped, is read. Measured before
 * this: 4.6 to 5.7 s at 4,000 delivered orders.
 */
export function preRunOrders({ workspaceRoot, queueDirs = [], scopes = [], everything = false } = {}) {
  const listings = [];
  for (const d of [...new Set((Array.isArray(queueDirs) ? queueDirs : []).filter((x) => typeof x === "string" && x).map((x) => resolve(x)))]) {
    try { listings.push({ qdir: d, names: readdirSync(d) }); } catch { /* a queue that will not open answers nothing here */ }
  }
  const sees = (job) => everything || scopes.some((s) => orderInScope(job, { account: s.account, organisation: s.organisation ?? null }));
  const references = [];
  const done = new Set();
  for (const file of recordFiles(workspaceRoot, { scopes, everything })) {
    for (const reference of referencesIn(file)) {
      if (done.has(reference)) continue;
      done.add(reference);
      references.push(reference);
    }
  }
  for (const l of listings) l.byRef = markersByReference(l.names, done);
  const rows = [];
  for (const reference of references) {
    for (const { qdir, names, byRef } of listings) {
      const own = byRef.get(reference);
      if (!own) continue;
      const named = stateFromNames(reference, own);
      if (named === null) continue;
      if (named !== "open") break;   // its names settle it, and as no row of this list
      const r = receiptIn(qdir, reference, names, { own });
      if (!r) continue;
      if (sees(r.job) && STATES.has(r.state)) {
        const j = r.job ?? {};
        const account = j.profileKey ?? "generic";
        rows.push({
          reference, state: r.state, reasonKind: r.state === "refused" ? (r.reasonKind ?? "other") : null,
          account, ...(account === "generic" ? { organisation: j.tenant ?? null } : {}),
          markName: (j.markName ?? j.name ?? j.marks?.[0]?.name) || null,
          marks: (Array.isArray(j.marks) ? j.marks : []).map((m) => m?.name).filter((n) => typeof n === "string" && n),
          product: j.product ?? null, updatedAt: r.updatedAt ?? null,
        });
      }
      break;
    }
  }
  return rows.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}
