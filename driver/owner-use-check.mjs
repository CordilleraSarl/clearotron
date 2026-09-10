// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// owner-use-check.mjs — the scoped owner lookup a Knockout search owes a promoted register filing
//.
//
// THE DEFECT. When the register pass named the owner of an identical live registration, nothing ever
// searched that owner. The assessment inferred what the owner sells from the owner's NAME and its class
// numbers, then deferred the question to a document it did not have. On the run that produced this issue
// the owner's name was known 48 seconds before the sweep ran and was never searched; the conclusion
// happened to be right, and the route to it was a guess from a string. The reviewing lawyer settled it in
// one web search. That fact was decisive, free, and never fetched.
//
// It generalises badly in the other direction too, which is the real reason this is worth code: the same
// inference produces a confident WRONG answer when the owner's name is uninformative, or informative and
// misleading.
//
// ── WHY THE DRIVER RUNS THE QUERY, RATHER THAN THE SEAT BEING TOLD TO ───────────────────────────────
//
// The clearance lane enforces its use-check on the DOCUMENT SHAPE of the narrative, and `use-check.mjs`
// says plainly why: "There is no perplexity call ledger … so the cited result inside the narrative is the
// only proof a query ran." That was the best substrate available there.
//
// This lane has a better one. The driver already owns the register store, already runs the sweep, and
// already writes a receipts ledger — so it can issue the query ITSELF and record the outcome at the
// moment of the call. The cite then is a driver fact joined by `recordId`, exactly like the record link,
// and not a word the seat typed about its own sourcing. That closes the failure the issue names last:
// "Reject a fix that satisfies the check by asserting 'no result' without issuing a query." Here nothing
// can assert it — the row exists because a call was made, or it says the call did not answer.
//
// SAME CONTRACT, DIFFERENT PROOF. The literals are the clearance lane's, verbatim — the
// `**Use-check source:**` label and the honest `perplexity_research — no result`. What differs is where
// the proof lives, and it differs because this lane has a receipt the other one does not.
//
// ── OWNER RULING, 2026-09-07: THE ABSENCE OF A CITE NEVER REFUSES DELIVERY ──────────────────────────
//
// Option A. The report delivers with an honest "no result" on any row the lookup could not answer; the
// cite is enforced in that it is always PRESENT and always the driver's, never in the sense that a
// missing one can withhold a report. Nothing in this module throws. A provider outage produces rows that
// say the query did not answer, and the run publishes.
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { promotableRecords } from "./publish/render-knockout.mjs";

/** The literal the clearance lane uses for an honest non-answer. Copied, not re-worded. */
export const NO_RESULT = "perplexity_research — no result";

/** The label the report prints, and the clearance lane's own spelling. */
export const USE_CHECK_LABEL = "Use-check source:";

// The page shows at most three promoted filings per mark (REGISTER_CARDS in render-knockout.mjs), so
// querying past that would bill for a filing no reader will ever see. Same number, stated here rather
// than imported, because these two caps answer different questions and coupling them would hide the day
// one of them should move.
export const OWNER_CHECK_CAP = 3;

/**
 * The owners this run owes a lookup, bounded — one row per (mark, owner), never per filing.
 *
 * THE BOUND IS THE RULED ONE: a PROMOTED register record only. `promotableRecords` is imported rather
 * than re-derived so "promoted" cannot come to mean two things.
 *
 * TWO OWNERS ON ONE MARK ARE TWO QUESTIONS; two FILINGS by one owner are one. Deduplicating on the owner
 * is what keeps a portfolio holder with nine filings from costing nine queries on a 5–10 minute product.
 * `recordIds` carries every filing the answer covers, so the join reaches all of them.
 */
export function ownersOwedACheck(recordsDoc, { cap = OWNER_CHECK_CAP } = {}) {
  if (!recordsDoc || recordsDoc.unavailable) return [];
  const out = [];
  for (const entry of (Array.isArray(recordsDoc.marks) ? recordsDoc.marks : [])) {
    const mark = String(entry?.name ?? "").trim();
    if (!mark) continue;
    // `classesSearched` does not exist on a plan row at pipeline time — it is written by the assess
    // stage. The scope therefore comes from `entry.classes`, which register-records.mjs sets to the
    // classes it actually searched. Passing the entry's own classes as the mark's keeps the predicate
    // reading the same scope it reads at publish time instead of silently widening to every record.
    const promoted = promotableRecords(entry, { classesSearched: entry?.classes ?? [] });
    const byOwner = new Map();
    for (const r of promoted) {
      const owner = String(r?.owner ?? "").trim();
      // A filing with no proprietor on the record cannot be searched by owner. Skipping it is not a
      // silent drop: it produces no row, and a card with no row keeps the standing line that claims
      // nothing — the same shape the register read itself uses.
      if (!owner) continue;
      const key = owner.toLowerCase();
      const g = byOwner.get(key) ?? { owner, mark, recordIds: [], classes: new Set() };
      g.recordIds.push(String(r.recordId ?? "").trim());
      for (const c of (Array.isArray(r.classes) ? r.classes : [])) if (Number.isFinite(Number(c))) g.classes.add(Number(c));
      byOwner.set(key, g);
    }
    for (const g of [...byOwner.values()].slice(0, cap)) {
      out.push({ mark: g.mark, owner: g.owner, recordIds: g.recordIds.filter(Boolean), classes: [...g.classes].sort((a, b) => a - b) });
    }
  }
  return out;
}

/**
 * The scoped query — owner + mark + goods/field, which is the clearance lane's own shape
 * (`phase2-execution.md` step 3.5: "the scoped query (owner + mark + goods/field)").
 *
 * It asks what the owner SELLS, not whether they use the mark. That is deliberate and it is the question
 * the issue turns on. The reviewing lawyer settled it by learning what line of business the proprietor is
 * actually in — an answer no question phrased about the MARK returns, because the owner had never traded
 * under it.
 */
export function composeOwnerQuery({ owner, mark, classes = [] }) {
  const scope = classes.length ? ` (registered in class${classes.length === 1 ? "" : "es"} ${classes.join(", ")})` : "";
  return `What goods or services does the company "${owner}" actually sell or trade in? `
    + `It holds a trademark registration for "${mark}"${scope}. `
    + `Report what the business does today, with sources. If nothing can be established about this company, say so plainly.`;
}

/** The first http(s) URL in a payload — the receipt of WHERE the answer came from. */
export function firstSourceUrl(text) {
  const m = String(text ?? "").match(/https?:\/\/[^\s<>"')\]]+/);
  return m ? m[0].replace(/[.,;:]+$/, "") : null;
}

/**
 * Run the owner lookups and return the rows, one per owner. NEVER THROWS, and never rejects.
 *
 * `exec` is the sweep's own executor — injected, so the fixture path that makes this product testable at
 * $0 covers this call too and a test never reaches a provider.
 *
 * Each row carries `source`: a URL when the payload gave one, otherwise the clearance lane's honest
 * literal. A row is written for EVERY owner owed a check, including the ones that failed — an owner with
 * no row would be indistinguishable from an owner nobody owed a check to, which is the absence-reads-as-
 * a-pass shape this repository keeps paying for.
 */
export async function runOwnerChecks({ owners, exec, runDir, ledgerPath = null, preset = "pro-search", now = () => new Date().toISOString() }) {
  const rows = [];
  for (const o of (owners ?? [])) {
    const query = composeOwnerQuery(o);
    const started = Date.now();
    let r;
    try { r = await exec(query, { mark: o.mark, preset }); }
    catch (e) { r = { ok: false, cause: `executor threw: ${String(e?.message ?? e).slice(0, 200)}` }; }

    const ok = Boolean(r?.ok && r?.text);
    let payloadFile = null;
    if (ok && runDir) {
      // The payload lands beside the mark payloads, under a name derived from the owner rather than the
      // record, because one payload answers for every filing that owner holds.
      payloadFile = `owner-${slug(o.owner)}.md`;
      try { writeFileSync(join(runDir, "research", payloadFile), r.text); } catch { payloadFile = null; }
    }
    const source = ok ? (firstSourceUrl(r.text) ?? NO_RESULT) : NO_RESULT;
    const row = {
      mark: o.mark, owner: o.owner, recordIds: o.recordIds, classes: o.classes,
      query, ok, source, payloadFile,
      ...(ok ? {} : { cause: String(r?.cause ?? "no result").slice(0, 300) }),
      ...(r?.outage === true ? { outage: true } : {}),
      ts: now(), took_ms: r?.tookMs ?? (Date.now() - started),
    };
    rows.push(row);
    if (ledgerPath) { try { appendFileSync(ledgerPath, JSON.stringify(row) + "\n"); } catch { /* receipts best-effort, never fatal */ } }
  }
  return rows;
}

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "owner";

/**
 * The line the report prints for a filing, joined by `recordId`. `null` when this run owes that filing no
 * check — a card with no row keeps the line it always had and claims nothing.
 */
export function useCheckLineFor(ownerChecks, recordId) {
  const id = String(recordId ?? "").trim();
  if (!id) return null;
  const row = (Array.isArray(ownerChecks) ? ownerChecks : [])
    .find((c) => (Array.isArray(c?.recordIds) ? c.recordIds : []).some((x) => String(x).trim() === id));
  if (!row) return null;
  return `${USE_CHECK_LABEL} ${row.source}`;
}

/** Read the store a run wrote, tolerantly. `[]` when the lane did not run — never a throw. */
export function readOwnerChecks(path) {
  try {
    if (!existsSync(path)) return [];
    const d = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(d?.checks) ? d.checks : [];
  } catch { return []; }
}
