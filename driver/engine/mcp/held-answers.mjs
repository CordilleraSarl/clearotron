// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// held-answers.mjs — ONE ANSWER PER QUESTION PER RUN, ACROSS EVERY WORKER AND PASS.
//
// The register workers run in parallel and do not see each other's questions, so the same question was put to the
// register again by another worker: on a test run of a crowded matter, 178 follow-up proposals held 167 distinct
// questions, and the 11 copies cost 49 calls. A question the run has already answered now gets the held answer, and
// one the run has already decided not to ask (a family withheld by judgment, or a follow-up the run's safety net
// refused) gets that decision. Nothing is asked again and no call is made.
//
// WHAT MAKES TWO QUESTIONS THE SAME: every field that changes what the register is asked — the predicate, the term
// or terms, their romanised forms, the classes, the markets, the goods words, the owner and the kind of answer —
// and none that only records where a question came from. A question with no markets is asked to the plan's, so it
// is the same as one naming them. Owner names are compared as written, never merged. A different scope is a
// different question, and an earlier answer that failed is no answer: both are asked again.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../../shared/driver-dir.mjs";
import { OUTSTANDING_REASON } from "../../../providers/_shared/follow-up-searches.mjs";
import { awaitsReadingTurn } from "../../../providers/_shared/plan-guards.mjs";
import { releasedFamilyQids } from "../../withheld-families.mjs";

const QUESTION_FIELDS = ["predicate", "term", "terms", "romanizedTerms", "term_literal", "nice_classes", "regions", "goods_text", "owner", "expected_kind"];
const sorted = (v) => [...v].map((x) => String(x)).sort();

/** The question an entry asks, as a key. `planRegions` fills an entry that names no markets. PURE. */
export function questionKey(e, planRegions = []) {
  const o = {};
  for (const k of QUESTION_FIELDS) {
    let v = e?.[k];
    if (k === "predicate") v = String(v ?? "default");
    if (k === "expected_kind") v = String(v ?? "enumerate");
    if (k === "regions" && !(Array.isArray(v) && v.length)) v = planRegions;
    if (v === undefined || v === null || v === false || (Array.isArray(v) && !v.length) || v === "") continue;
    o[k] = Array.isArray(v) ? (k === "terms" || k === "romanizedTerms" ? v.map(String) : sorted(v)) : v;
  }
  return JSON.stringify(o);
}

// A band file is read once per change: the propose tool is called many times in a turn, and a primary sweep's band
// runs to tens of megabytes. Keyed on the path, its size and its modification time. Only what a held answer hands
// back is kept, the first records among it, so a worker's process does not hold every band whole.
const BAND_CACHE = new Map();
const HELD_RECORDS = 25;
const spelling = (t) => String(t ?? "").normalize("NFC").trim().toLowerCase();
function readBlocks(path) {
  let st;
  try { st = statSync(path); } catch { return []; }
  const stamp = `${st.size}:${st.mtimeMs}`;
  const hit = BAND_CACHE.get(path);
  if (hit && hit.stamp === stamp) return hit.blocks;
  let blocks = [];
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    blocks = (Array.isArray(j) ? j : []).filter((b) => b?.qid).map((b) => ({
      qid: b.qid, state: b.state ?? null, error: b.error === true, total_hits: b.total_hits ?? null,
      count: b.count ?? (Array.isArray(b.records) ? b.records.length : null),
      records: Array.isArray(b.records) ? b.records.slice(0, HELD_RECORDS) : [],
      // the names a list's answer counted one by one: only their spellings are kept
      ...(b.term_counts && typeof b.term_counts === "object" ? { counted_terms: Object.keys(b.term_counts).map(spelling) } : {}),
    }));
  } catch { blocks = []; }
  BAND_CACHE.set(path, { stamp, blocks });
  return blocks;
}

/**
 * Refuse the minted entries whose question the run has already answered on another row, the way the fold refuses a
 * question the plan already holds: `duplicate-question`, with the row that answered it as the twin. Second framing's
 * re-sweep calls this before its fold, because the fold sees only the plan's rows on the re-sweep's own axis, and a
 * question another worker answered is not asked again. Only an answer settles: a withheld family has its own refusal,
 * and a follow-up the safety net did not send would not be sent again. PURE.
 * @returns {{ kept: object[], refused: {qid: string, term: string, kind: "duplicate-question", twin: string}[] }}
 */
export function refuseHeldQuestions(entries, held, planRegions = []) {
  const kept = [], refused = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const h = held?.get?.(questionKey(e, planRegions));
    if (e?.qid && h?.decision === "answered" && h.qid && String(h.qid) !== String(e.qid))
      refused.push({ qid: e.qid, term: String(e.term ?? e.terms?.[0] ?? ""), kind: "duplicate-question", twin: String(h.qid) });
    else kept.push(e);
  }
  return { kept, refused };
}

// The run's questions and answers as its files hold them: the frozen plan, each worker's supplemental plan, and every
// band's blocks by qid. IMPURE.
function readRunQuestions(runDir) {
  const units = join(runDir, "register-units");
  const blocksByQid = new Map();
  const plans = [];
  try { plans.push({ axis: null, plan: JSON.parse(readFileSync(driverDir(runDir, "register-plan.json"), "utf8")) }); } catch { /* no frozen plan */ }
  let files = [];
  try { files = readdirSync(units); } catch { files = []; }
  for (const f of files) {
    if (f.endsWith("-band.json")) for (const b of readBlocks(join(units, f))) if (b?.qid) blocksByQid.set(String(b.qid), b);
    if (f.endsWith("-supplemental-plan.json")) {
      try { plans.push({ axis: f.slice(0, -"-supplemental-plan.json".length), plan: JSON.parse(readFileSync(join(units, f), "utf8")) }); } catch { /* torn: skipped */ }
    }
  }
  return { plans, blocksByQid };
}

/**
 * The run's held answers and decisions, by question key. IMPURE (reads the run's register files).
 * @returns {Map<string, { qid: string, axis: string, decision: "answered"|"withheld"|"outstanding", block?: object }>}
 */
export function heldAnswers(runDir, { planRegions = [], withheld = {}, released = null } = {}) {
  // A FAMILY WAITING FOR THE READING TURN IS ANSWERED ONLY ONCE IT IS RELEASED AND RUN, the plan join's own rule: until
  // then it was not asked, whatever block its qid may carry, and a question repeating it is asked as the join expects.
  let releasedQids = released;
  if (!(releasedQids instanceof Set)) { try { releasedQids = releasedFamilyQids(runDir); } catch { releasedQids = new Set(); } }
  const held = new Map();
  const { plans, blocksByQid } = readRunQuestions(runDir);
  for (const { plan } of plans) {
    for (const e of Array.isArray(plan?.entries) ? plan.entries : []) {
      if (!e?.qid) continue;
      const key = questionKey(e, planRegions);
      if (held.has(key)) continue;
      if (awaitsReadingTurn(e.when) && !releasedQids.has(String(e.qid))) {
        if (withheld?.[e.qid]) held.set(key, { qid: e.qid, axis: e.axis, decision: "withheld" });
        continue;
      }
      const b = blocksByQid.get(String(e.qid));
      if (b && b.error !== true) held.set(key, { qid: e.qid, axis: e.axis, decision: "answered", block: b });
      else if (withheld?.[e.qid]) held.set(key, { qid: e.qid, axis: e.axis, decision: "withheld" });
    }
    // A follow-up the run's safety net did not send is a decision too: proposed again, it would not be sent again.
    for (const r of Array.isArray(plan?.rejected) ? plan.rejected : []) {
      if (r?.issue !== OUTSTANDING_REASON || !r?.proposal) continue;
      const key = questionKey(r.proposal, planRegions);
      if (!held.has(key)) held.set(key, { qid: null, axis: null, decision: "outstanding" });
    }
  }
  return held;
}

// ── A SPELLING COUNTED ON A LIST THE READING TURN READ IS LEFT AS THE TURN LEFT IT ──
//
// The plan asks the mark's spellings as exact lists, and a crowded list comes back with a count for each name on it.
// The reading turn reads that list before second framing runs. A spelling it neither narrowed nor asked on its own it
// left on the list's row with its count: a crowd it set aside. On a test run of a crowded matter, second framing's
// re-sweep asked seven such spellings again, each exact and as contains: fourteen questions, each spelling counted at
// 100 or more on the list. The re-sweep already keeps a family the reading turn withheld, and it now keeps these too.
// A re-sweep question on a spelling counted on such a list, and asked nowhere on its own, is not asked: it is refused
// as `counted-on-list`, with the list as its twin, and checked on the list's row. A list whose answer failed, a name
// it did not count, a spelling the plan asks on its own anywhere, and a question beyond the list's classes or markets
// are asked as before.

/**
 * The spellings the run counted on an exact list it read and asked nowhere on their own, by spelling: each list that
 * counted it, with its classes and markets (a list naming none is asked to the plan's). PURE.
 * @returns {Map<string, {qid: string, classes: string[], regions: string[]}[]>}
 */
export function countedOnListsOf(plans, blocksByQid, planRegions = []) {
  const askedAlone = new Set();
  const lists = [];
  for (const { plan } of Array.isArray(plans) ? plans : []) {
    for (const e of Array.isArray(plan?.entries) ? plan.entries : []) {
      if (!e?.qid) continue;
      if (typeof e.term === "string" && e.term.trim()) askedAlone.add(spelling(e.term));
      if (Array.isArray(e.terms) && e.terms.length > 1 && String(e.predicate ?? "") === "exact" && !e.goods_text && !e.owner) lists.push(e);
    }
  }
  const counted = new Map();
  for (const l of lists) {
    const b = blocksByQid?.get?.(String(l.qid));
    if (!b || b.error === true || !Array.isArray(b.counted_terms)) continue;
    const onList = new Set(l.terms.map(spelling));
    const regions = (Array.isArray(l.regions) && l.regions.length ? l.regions : planRegions).map(String);
    for (const t of new Set(b.counted_terms)) {
      if (!onList.has(t) || askedAlone.has(t)) continue;
      if (!counted.has(t)) counted.set(t, []);
      counted.get(t).push({ qid: String(l.qid), classes: (l.nice_classes ?? []).map(String), regions });
    }
  }
  return counted;
}

/** The same, read off the run's files. IMPURE. */
export function countedOnLists(runDir, { planRegions = [] } = {}) {
  const { plans, blocksByQid } = readRunQuestions(runDir);
  return countedOnListsOf(plans, blocksByQid, planRegions);
}

/**
 * Refuse the minted entries that ask, on its own and within a list's classes and markets, a spelling that list
 * counted (`countedOnListsOf`): `counted-on-list`, with the list as the twin. PURE.
 * @returns {{ kept: object[], refused: {qid: string, term: string, kind: "counted-on-list", twin: string}[] }}
 */
export function refuseCountedOnList(entries, counted, planRegions = []) {
  const kept = [], refused = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const alone = typeof e?.term === "string" && !(Array.isArray(e.terms) && e.terms.length) && !e.goods_text && !e.owner;
    const classes = (e?.nice_classes ?? []).map(String);
    const regions = (Array.isArray(e?.regions) && e.regions.length ? e.regions : planRegions).map(String);
    const list = alone && classes.length
      ? (counted?.get?.(spelling(e.term)) ?? []).find((l) => classes.every((c) => l.classes.includes(c)) && regions.every((r) => l.regions.includes(r)))
      : null;
    if (e?.qid && list) refused.push({ qid: e.qid, term: String(e.term), kind: "counted-on-list", twin: list.qid });
    else kept.push(e);
  }
  return { kept, refused };
}
