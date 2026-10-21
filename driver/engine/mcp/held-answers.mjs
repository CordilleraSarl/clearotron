// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// held-answers.mjs — ONE ANSWER PER QUESTION PER RUN, ACROSS EVERY WORKER AND PASS.
//
// The register workers run in parallel and do not see each other's questions, so the same question was put to the
// register again by another worker: on a test run of a crowded matter, 178 follow-up proposals held 167 distinct
// questions, and the 11 copies cost 49 calls. A question the run has already answered now gets the held answer, and
// one the run has already decided not to ask (a family withheld by judgment, or a follow-up the run's allowance
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
import { OUTSTANDING_REASON } from "../../../providers/_shared/call-allowance.mjs";

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
    }));
  } catch { blocks = []; }
  BAND_CACHE.set(path, { stamp, blocks });
  return blocks;
}

/**
 * The run's held answers and decisions, by question key. IMPURE (reads the run's register files).
 * @returns {Map<string, { qid: string, axis: string, decision: "answered"|"withheld"|"outstanding", block?: object }>}
 */
export function heldAnswers(runDir, { planRegions = [], withheld = {} } = {}) {
  const held = new Map();
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
  for (const { plan } of plans) {
    for (const e of Array.isArray(plan?.entries) ? plan.entries : []) {
      if (!e?.qid) continue;
      const key = questionKey(e, planRegions);
      if (held.has(key)) continue;
      const b = blocksByQid.get(String(e.qid));
      if (b && b.error !== true) held.set(key, { qid: e.qid, axis: e.axis, decision: "answered", block: b });
      else if (withheld?.[e.qid]) held.set(key, { qid: e.qid, axis: e.axis, decision: "withheld" });
    }
    // A follow-up the run's allowance refused is a decision too: asked again, it would be refused again.
    for (const r of Array.isArray(plan?.rejected) ? plan.rejected : []) {
      if (r?.issue !== OUTSTANDING_REASON || !r?.proposal) continue;
      const key = questionKey(r.proposal, planRegions);
      if (!held.has(key)) held.set(key, { qid: null, axis: null, decision: "outstanding" });
    }
  }
  return held;
}
