// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scope-facts.mjs — the per-class scope truth the masthead never had (compute-don't-author core).
//
// The 2026-07-28 postmortem run shipped a masthead whose `classes:` line said "searched as advisory adds" while three
// machine stores (coverage[].state:"open", coverage_judgment.sufficient:false, the frozen plan's own
// join) said dispatched-but-not-enumerated. The defect was never the stores — it was that NOTHING
// JOINED THEM: the front-matter classes line was model-typed (stages.mjs dictation) and nothing
// validated it. This module IS that join, and _driver/scope-facts.json is its sidecar: every scope
// number a delivered surface shows is computed here from the run record, then stamped into the
// report front-matter by applyScopeFrontMatter (pipeline) — the model authors none of it.
// Delivered consumers of `coverage_line:` (the frozen report renderer renders only KNOWN keys, so
// the fm field alone reaches no reader): the email cover note (publish/index.mjs composeEmailHtml)
// and the audit workbook Summary (publish/xlsx.mjs summaryRows) both render it.
//
// PURE (no node imports — tests offline). Inputs are the four machine stores, already parsed:
//   instructedScope — _driver/instructed-scope.json (what the JOB said, written before any model)
//   plan            — _driver/register-plan.json (the frozen deterministic plan; entries carry
//                     qid + nice_classes + regions; provider-NEUTRAL by construction)
//   planExecution   — _driver/plan-execution.json (joinPlanToBands: executed[{qid,state}] /
//                     missing[] / skipped[] / deferred[{qid,reason}] — the band states)
//   coverageRows    — loadCoverageLedger(...).rows (axis/scope/status/reason [+ optional classes[]])
//
// Never a sufficiency judgment: like deriveCoverageSkeleton this states what RAN, per instructed
// Nice class — judgment (coverage_judgment) stays Layer B. Provider-agnostic by construction: it
// keys only on the neutral plan/band vocabulary, never a vendor name or vendor-shaped field.

import { classTokensFromScopeText } from "./coverage-ledger.mjs";

const clsStr = (c) => String(c ?? "").trim();

// Per-class execution state, mirroring deriveCoverageSkeleton's vocabulary (missing ⇒ unexecuted
// outranks deferred outranks incomplete outranks executed), plus "unplanned" for an instructed class
// no plan entry carries — the honest word for "the register layer never aimed at it". SIDECAR
// vocabulary only: the reader-facing coverage_line is built from the COUNTS (buildCoverageLine),
// never from this word, so a state label never reaches a delivered surface.
function classState(a) {
  if (!a.entries) return "unplanned";
  if (a.missing.length) return "unexecuted";
  if (a.deferred.length) return "deferred";
  if (a.incomplete) return "incomplete";
  if (a.enumerated) return "executed";
  // PR-11: a class whose entries were ALL guard-skipped (nothing dispatched, nothing enumerated) is
  // "skipped", not "executed" — the same fail-closed reading deriveCoverageSkeleton now takes. It used
  // to claim "searched" on the masthead for a class the register layer never actually queried.
  // A taken crowd-context count is DISPATCHED work (audit 2 (d)) — a count-only class must not read
  // "unexecuted" — but it is never "executed": a count enumerates nothing.
  return a.dispatched_qids.length || a.counts_taken ? "dispatched" : (a.skipped ? "skipped" : "unexecuted");
}

// A slice term written in a script other than Latin (Chinese, Cyrillic, Arabic, …) — detected from
// the plan entry's own term, never from a vendor field, so the coverage line can say WHAT the
// unsearched remainder is ("non-Latin script forms") in the reader's language.
const NON_LATIN_LETTER_RE = /(?!\p{Script=Latin})\p{L}/u;
const entryTerms = (e) => (Array.isArray(e?.terms) ? e.terms : [e?.term]).map((t) => String(t ?? "")).filter((t) => t);
const entryIsNonLatinScript = (e) => {
  const ts = entryTerms(e);
  return ts.length > 0 && ts.every((t) => NON_LATIN_LETTER_RE.test(t));
};

/**
 * The join: instructed classes × the frozen plan × band states × coverage-ledger reasons.
 * Returns { instructed, per_class, searched_jurisdictions, scope_basis?, classes_line, coverage_line }.
 * Missing inputs degrade honestly (a null plan yields per_class states "unplanned", never a claim);
 * `classes_line`/`coverage_line` are null when there is genuinely nothing to compute — the caller
 * (applyScopeFrontMatter) then leaves the surface untouched rather than stamping an empty claim.
 */
export function deriveScopeFacts({ instructedScope = null, plan = null, planExecution = null, coverageRows = [] } = {}) {
  const instructedClasses = (Array.isArray(instructedScope?.classes) ? instructedScope.classes : (plan?.nice_classes ?? []))
    .map(clsStr).filter((c) => c);
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];

  const stateByQid = new Map((planExecution?.executed ?? []).map((x) => [x.qid, String(x.state ?? "").toLowerCase()]));
  const missingSet = new Set(planExecution?.missing ?? []);
  const skippedSet = new Set((planExecution?.skipped ?? []).map((x) => x.qid));
  const deferredByQid = new Map((planExecution?.deferred ?? []).map((x) => [x.qid, String(x.reason ?? "")]));

  // ledger rows joined per class: structured classes[] wins; a legacy free-text row falls back to the
  // conservative class-token scan over its scope+reason cells. A gap row naming NO class is run-level
  // (open_gaps below), never smeared across every class.
  const rowClasses = (r) => (Array.isArray(r?.classes) && r.classes.length
    ? r.classes.map(clsStr)
    : classTokensFromScopeText(`${r?.scope ?? r?.unit ?? ""} ${r?.reason ?? ""}`));
  const gapRows = (coverageRows ?? []).filter((r) => r && (r.status === "coverage-limited" || r.status === "deferred"));

  const per_class = {};
  for (const c of instructedClasses) {
    const a = { entries: 0, dispatched_qids: [], enumerated: 0, incomplete: 0, deferred: [], missing: [], skipped: 0, deferred_script: 0,
      count_slices: 0, counts_taken: 0, count_deferred: [] };
    for (const e of entries) {
      if (!(e?.nice_classes ?? []).map(clsStr).includes(c)) continue;
      a.entries++;
      // F2 doctrine (post-merge audit 2 (d)): an expected_kind:"count" descriptor is CROWD CONTEXT,
      // not coverage — it enumerates nothing by construction, so its band state is "incomplete" on
      // every run that ever takes it. Pooled with the enumerate slices it made bare "searched"
      // unreachable for any class carrying a count probe, and its by-construction incomplete rode the
      // enumerate bucket's phrasing ("returned more records than could be listed in full" — false for
      // a probe whose whole job is the number). Counts are tallied on their own: taken, or not — a
      // deferred count keeps its reason for the sidecar's open_reasons (info preserved, never quieter).
      if (String(e?.expected_kind ?? "") === "count") {
        a.count_slices++;
        if (deferredByQid.has(e.qid)) { a.count_deferred.push(e.qid); continue; }
        if (stateByQid.has(e.qid)) a.counts_taken++;
        continue;
      }
      if (skippedSet.has(e.qid)) { a.skipped++; continue; }
      if (missingSet.has(e.qid)) { a.missing.push(e.qid); continue; }
      if (deferredByQid.has(e.qid)) { a.deferred.push(e.qid); if (entryIsNonLatinScript(e)) a.deferred_script++; continue; }
      if (stateByQid.has(e.qid)) {
        a.dispatched_qids.push(e.qid);
        const s = stateByQid.get(e.qid);
        if (s === "enumerated") a.enumerated++;
        else if (s === "incomplete") a.incomplete++;
      } else {
        // a plan entry in NO execution bucket is UNACCOUNTED — the fail-closed reading is "missing"
        // (joinPlanToBands puts block-less qids there; a torn receipt must not upgrade a class to
        // "searched" on absence of evidence).
        a.missing.push(e.qid);
      }
    }
    const open_reasons = [
      ...a.deferred.map((qid) => `${qid}: ${deferredByQid.get(qid)}`.trim().replace(/:\s*$/, ": capability gap")),
      ...a.count_deferred.map((qid) => `${qid}: ${deferredByQid.get(qid)}`.trim().replace(/:\s*$/, ": capability gap")),
      ...gapRows.filter((r) => rowClasses(r).includes(c))
        .map((r) => `${r.axis}: ${r.status}${r.reason ? ` — ${String(r.reason).slice(0, 200)}` : ""}`),
    ];
    per_class[c] = {
      // `total` stays every planned slice (counts included) — the sidecar's planned-work denominator.
      // The searched-denominator the coverage line renders is total − count_slices (classClause).
      total: a.entries,
      dispatched_qids: a.dispatched_qids,
      enumerated: a.enumerated,
      incomplete: a.incomplete,
      deferred: a.deferred.length,
      deferred_script_forms: a.deferred_script,
      missing: a.missing.length,
      skipped: a.skipped,
      count_slices: a.count_slices,
      counts_taken: a.counts_taken,
      state: classState(a),
      open_reasons,
    };
  }

  const searched_jurisdictions = Array.isArray(plan?.regions) ? plan.regions.map(String) : [];
  const scope_basis = plan?.scope_basis === "worldwide" ? "worldwide" : null;

  const classes_line = instructedClasses.length ? instructedClasses.join(", ") : null;
  const coverage_line = instructedClasses.length && entries.length
    ? buildCoverageLine(instructedClasses, per_class, { searched_jurisdictions, scope_basis, instructedScope })
    : null;

  return {
    instructed: {
      marks: instructedScope?.marks ?? null,
      classes: instructedClasses,
      jurisdictions: instructedScope?.jurisdictions ?? null,
    },
    per_class,
    searched_jurisdictions,
    ...(scope_basis ? { scope_basis } : {}),
    classes_line,
    coverage_line,
  };
}

// The single-line register-coverage disclosure the front-matter carries (coverage_line:). Facts that
// state what was bought, never doubt about what was delivered — per user decision 2 these disclosure
// rows are NOT caveats. Deterministic; numeric class order; jurisdictions tail capped for readability.
//
// Plain language, spec B4 (2026-07-30): the line carries the PROPORTION the join already computed —
// "Class 5: 76 of 99 slices fully searched — the remaining 23 are non-Latin script forms" — instead
// of one worst-state-wins word per class. THE CONSTRAINT HOLDS: more accurate, never less alarming.
// "Searched" with no qualifier is claimable ONLY when every planned ENUMERATE slice fully enumerated
// (stricter than before: a class that also carried skipped/unjoined slices used to read bare
// "searched"); every other planned class states how many of its slices completed and, in one clause,
// what the remainder is. Crowd-context count descriptors ride their own per-class trailing clause
// (classClause — audit 2 (d)), never the searched denominator. An untouched class (nothing planned,
// or every slice guard-skipped) keeps fail-closed "not searched" wording. Engine and vendor
// vocabulary stay in the sidecar: no "enumerated", "dispatched", "deferred", "provider" or "gap" on
// the line a reader sees.
// — THE SAME SENTENCE FOUR TIMES IS NOT FOUR FACTS. A delivered cover note carried the identical
// 20-word clause once per class, because the numbers behind them were identical per class. Classes whose
// clause is word-for-word the same are stated ONCE, over the classes they are about. Nothing is pooled
// and no number moves: the grouping is on the rendered text, so two classes only share a line when the
// line they would each have printed is already the same string.
function buildCoverageLine(classes, per_class, { searched_jurisdictions = [], scope_basis = null, instructedScope = null } = {}) {
  const sorted = [...classes].sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  const byBody = new Map();
  for (const c of sorted) {
    const body = classClause(c, per_class[c]).replace(/^Class [^:]*: /, "");
    if (byBody.has(body)) byBody.get(body).push(c);
    else byBody.set(body, [c]);
  }
  // Map preserves insertion order, so the groups come out in the numeric order of their FIRST class and
  // the class list inside each group is numeric. Non-adjacent duplicates group too — 5, 9, 32 with
  // bodies A, B, A renders "Classes 5 and 32: A; Class 9: B", not A twice.
  const groups = [...byBody.entries()].map(([body, classes]) => ({ body, classes }));
  const head = (cs) => (cs.length === 1 ? `Class ${cs[0]}` : `Classes ${joinAnd(cs.map(String))}`);
  return `${groups.map((g) => `${head(g.classes)}: ${g.body}`).join("; ")}${jurisdictionTail({ searched_jurisdictions, scope_basis, instructedScope })}`;
}

// One plain-language clause per class, routed on the COUNTS (state-agnostic), not on the state label.
// Crowd-context count descriptors (audit 2 (d)) leave the fully-searched denominator — they are
// 'incomplete' by construction, so pooling them made bare "searched" unreachable and mis-narrated a
// small-total probe as "returned more records than could be listed in full". They get their own
// honest trailing clause instead: taken in full ("N crowd-context counts taken") or short ("N of M…")
// — more accurate, never quieter: every planned count is still on the line.
function classClause(c, pc) {
  const countSlices = pc?.count_slices ?? 0;
  const countsTaken = pc?.counts_taken ?? 0;
  // — "crowd-context counts" is engine vocabulary. What it means to the reader is a result set too
  // large to list, which was sized instead. Same fact, same numbers, said in the reader's words.
  const countsTail = countSlices
    ? ` · ${countsTaken === countSlices
      ? `${countSlices} oversized result ${countSlices === 1 ? "set was" : "sets were"} counted rather than listed`
      : `${countsTaken} of ${countSlices} oversized result sets were counted rather than listed`}`
    : "";
  const total = Math.max(0, (pc?.total ?? 0) - countSlices);
  const done = pc?.enumerated ?? 0;
  // Untouched — the register plan never aimed at this class. Fail-closed, as before.
  if (!pc || (!total && !countSlices)) return `Class ${c}: not searched on the registers`;
  // Counts only — a class the plan sized but never searched record-by-record: never a searched claim.
  if (!total) return `Class ${c}: not searched on the registers${countsTail}`;
  // Complete — every planned enumerate slice fully enumerated. The only shape that may read as a bare claim.
  if (done === total) return `Class ${c}: searched${countsTail}`;
  // Untouched — planned, but every slice was guard-skipped: nothing was ever dispatched (PR-11).
  if (!done && (pc.skipped ?? 0) === total)
    return `Class ${c}: not searched — every planned search was skipped after a broader search came back crowded${countsTail}`;
  // Partial — the proportion plus the one-line reason for the remainder, worst bucket first.
  const remaining = Math.max(0, total - done);
  const buckets = remainderBuckets(pc, remaining);
  const reason = buckets.length === 1
    ? `the remaining ${buckets[0]}`
    : `of the remaining ${remaining}, ${joinAnd(buckets)}`;
  return `Class ${c}: ${done} of ${total} searches completed — ${reason}${countsTail}`;
}

// Counted plain-language fragments for the not-fully-searched remainder of a class, fail-closed rank
// first (never-ran outranks could-not-run outranks ran-but-crowded). Arithmetic identity with the
// join, over the ENUMERATE slices (count descriptors carry their own clause): unfinished + deferred +
// skipped + incomplete === remaining; a shape the join never produces still degrades to "did not
// complete", never to silence. "Returned more records than could be listed in full" is now true by
// construction — only an enumerate slice that genuinely overflowed its listing can reach it.
function remainderBuckets(pc, remaining) {
  const dispatched = Array.isArray(pc.dispatched_qids) ? pc.dispatched_qids.length : 0;
  const unfinished = Math.max(0, dispatched - (pc.enumerated ?? 0) - (pc.incomplete ?? 0)) + (pc.missing ?? 0);
  const script = Math.min(pc.deferred ?? 0, pc.deferred_script_forms ?? 0);
  const deferredOther = Math.max(0, (pc.deferred ?? 0) - script);
  const parts = [];
  if (unfinished) parts.push(`${unfinished} did not complete`);
  if (deferredOther) parts.push(`${deferredOther} could not be searched`);
  if (script) parts.push(script === 1 ? "1 is a non-Latin script form" : `${script} are non-Latin script forms`);
  if (pc.skipped) parts.push(`${pc.skipped} ${pc.skipped === 1 ? "was" : "were"} skipped after a broader search came back crowded`);
  if (pc.incomplete) parts.push(`${pc.incomplete} returned more records than could be listed in full`);
  if (!parts.length && remaining) parts.push(`${remaining} did not complete`);
  return parts;
}

const joinAnd = (parts) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

// §L jurisdiction ruling (Reviewer, 2026-07-30): a specific list OR worldwide, NEVER both — "worldwide +
// EU US CH WO doesn't make sense". A worldwide-scoped plan (scope_basis, or a worldwide token riding
// an instructed list) collapses the tail to the one word; only a genuinely named list is listed.
const WORLDWIDE_TOKEN_RE = /^(worldwide|world|ww|global)$/i;
function jurisdictionTail({ searched_jurisdictions = [], scope_basis = null, instructedScope = null } = {}) {
  const list = (searched_jurisdictions.length
    ? searched_jurisdictions
    : (Array.isArray(instructedScope?.jurisdictions) ? instructedScope.jurisdictions : [])).map((j) => String(j).trim()).filter((j) => j);
  if (scope_basis === "worldwide" || list.some((j) => WORLDWIDE_TOKEN_RE.test(j))) return " · registers: worldwide";
  if (!list.length) return "";
  // 2–3-letter office codes display uppercase ("us" reads as a pronoun, "US" as a jurisdiction);
  // longer names pass through untouched.
  const named = list.map((j) => (/^[a-z]{2,3}$/i.test(j) ? j.toUpperCase() : j));
  const shown = named.slice(0, 12);
  return ` · registers: ${shown.join(", ")}${named.length > shown.length ? ` +${named.length - shown.length} more` : ""}`;
}
