// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── WS2 (B5) — THE default register executor, as a provider-agnostic kernel ─────────────────
//
// Lifted from providers/corsearch/src/core.js. execute_plan runs the frozen register plan's entries for
// ONE axis and writes the named band ITSELF (the grid_spec_path move): the band JSON never round-trips
// the model's bounded turn output, and the qid stamping cannot be mis-typed — the transcription defect
// class dies at the source. Two-pass: guard-free entries first, then `when`-guarded entries only if their
// parent block enumerated ( crowd bound, enforced at execution as well as at compile). Called by every
// plan-mode register unit via the driver engine's MCP bridge (ONE call per axis, stages.mjs); gateway chat
// agents deliberately don't carry it — no run-dir plan artifacts to execute.
//
// LOAD-BEARING and preserved EXACTLY: the MERGE semantics (preserve un-owned blocks and no-qid judgment
// blocks, replace owned qids, drop stale skipped-fringe blocks, temp+rename write), the error:true stamp
// (a provider error is never confusable with a sanctioned crowd), and the one in-tool retry per call.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { nativeScriptIndexGap } from "./script-form.mjs";
import { entryTermIssues } from "./term-shape.mjs";
import { faultText, guardToolCall } from "./transport-guard.mjs";
import { clipProviderText } from "./provider-text.mjs";   // — keep the discriminator

// plan predicate → provider query params. "wildcard" patterns compile to the provider's anchored
// modes (trailing * → starts_with, leading * → ends_with); there is deliberately NO `contains`
// mode — a contains-style slice is the provider default (the compiler never emits `contains`).
export function planPredicateParams(entry) {
  const pred = String(entry?.predicate ?? "default");
  if (pred === "exact") return { match_mode: "exact" };
  if (pred === "phonetic") return { match_mode: "phonetic" };
  if (pred === "wildcard") {
    const t = String(entry?.term ?? "");
    if (t.endsWith("*") && !t.startsWith("*")) return { match_mode: "starts_with", __term: t.slice(0, -1) };
    if (t.startsWith("*") && !t.endsWith("*")) return { match_mode: "ends_with", __term: t.slice(1) };
    return {};   // both/neither anchored — provider default over the raw pattern
  }
  // owner sweep (copper-lattice cross-check): the entry's term is an OWNER name, not a mark — the
  // query carries {owner} instead of a name clause. Doctrine 2: a provider whose owner field is
  // missing must FAIL LOUD and defer this row — never search an owner name as mark text.
  if (pred === "owner") return { __owner: true };
  return {};
}

// ── THE CAPABILITY-GAP MARKER — the deferral lane the doctrine promised and the code did not have ──
//
// Review finding 10 caught the deeper half of the jurisdiction defect: the comments here and in
// gather-config.mjs promise that a capability the active provider lacks "becomes a deferred coverage
// row", but there was no such lane. An `unsupported` slice produced an error:true block → joinPlanToBands
// counted it MISSING → the fan-in gate threw StageFailure. So the doctrine-2 path (fail loud, defer the
// row) was in fact a RUN-KILLER, and every repair rung re-ran the identical deterministic refusal.
//
// The missing distinction is TRANSIENT vs DETERMINISTIC:
//   * a 502, a rate-limit window, a torn response — retrying is exactly right, and a clean must never
//     ship over it. That stays `error:true` → MISSING → the repair ladder → an honest StageFailure.
//   * a capability the provider genuinely does not have (a predicate with no mapping, an office outside
//     its vocabulary, a term its query language cannot express) — retrying is pointless and the answer
//     will never change. This is a GAP TO DISCLOSE. It must never be a clean negative, and it must never
//     be an executed slice, but it must also not kill a run that can still be delivered with the gap on
//     its face.
// Blocks in the second class carry `deferred: true` alongside `error: true` (the error stamp is KEPT so
// no existing consumer starts reading them as sanctioned crowds). joinPlanToBands routes them to its own
// `deferred` bucket; the coverage skeleton gives the axis its own `deferred` state, which the
// confirmed-clean gate treats exactly as strictly as `unexecuted`.
//
// Providers signal the deterministic class by prefixing their failure reason with this marker — used for
// CLIENT-SIDE REFUSALS ONLY (the request was never sent, so there is nothing a retry could change).
export const CAPABILITY_GAP_MARKER = "capability-gap:";
export const isCapabilityGap = (reason) => String(reason ?? "").includes(CAPABILITY_GAP_MARKER);

// ── A ZERO-HIT BARE-OWNER COUNT IS UNVERIFIED, NEVER THE NUMBER ZERO ──────────────────────────────
//
// A `predicate:"owner"` count descriptor asks one question — how large is this owner's portfolio in
// scope — and the answer is read as a fact about the owner: the size of a filer's estate is evidence
// of enforcement appetite, and a small one reads as a small threat. A ZERO is the most consequential
// answer the question has, because a named incumbent with no filings at all is a competitor the matter
// can stop worrying about.
//
// It is also the answer most easily manufactured by asking the wrong question. An owner field is not a
// register-wide free-text index: it matches the applicant NAME STRING the office recorded, and the
// manifest names an owner the way the world writes it, not the way the register spells it. Where the
// two disagree the query is well-formed, the provider answers HTTP 200, and the count is 0 — the same
// false-clean shape as a term an index cannot hold, with nothing anywhere saying so.
//
// A provider that can resolve a loose company name to the register's OWN applicant styling can tell
// these apart, and it is the only thing that can. So the discrimination hangs off the resolution the
// provider reports, not off a vendor name and not off the number:
//
//   * the vocabulary produced styling that backed this sweep  → the zero was asked properly. A real,
//     counted zero, and it stays a counted zero.
//   * the vocabulary produced nothing, or produced only names this provider's query language cannot
//     express so that none of them reached the wire, or the sweep degraded back to the caller's raw
//     term  → the register's own spelling of this owner was never asked. The zero is UNVERIFIED.
//
// A provider with no owner-resolution surface at all reports no note, and this predicate is not
// consulted — its blocks are byte-identical to before. That leaves the same question open there, and
// it is open ON PURPOSE rather than answered by guessing: with no resolution surface there is no
// evidence either way, and inventing an unverified stamp for every bare-owner zero on such a provider
// would defer coverage the run may well have.

const lc = (v) => String(v ?? "").trim().toLowerCase();

/**
 * Did the provider's OWN owner vocabulary stand behind this sweep? PURE.
 *
 * @param res  the provider's owner-resolution note ({raw_terms, resolved[], swept[],
 *             unsearchable_resolved?, degraded_to_unresolved_sweep?}), or null/undefined.
 * @returns true when register-side applicant styling backed the query — either because a resolved name
 *          was added to the sweep, or because the caller's own term already WAS the styling the
 *          register holds (resolution dedupes an exact match, so the swept list does not grow and the
 *          absence of growth is not evidence of failure). false when nothing register-side backed it.
 */
export function ownerNameResolved(res) {
  if (!res || typeof res !== "object") return false;
  // The documented additive-invariant fallback: the expanded stack was rejected on the wire and the
  // sweep re-ran on the caller's raw term alone. Named on the note precisely so this is visible.
  if (res.degraded_to_unresolved_sweep === true) return false;
  const resolved = Array.isArray(res.resolved) ? res.resolved : [];
  if (!resolved.length) return false;
  const raw = new Set((Array.isArray(res.raw_terms) ? res.raw_terms : []).map(lc));
  const addedToTheSweep = (Array.isArray(res.swept) ? res.swept : []).some((t) => !raw.has(lc(t)));
  const callerTermIsTheStyling = resolved.some((c) => raw.has(lc(c?.applicant_name)));
  return addedToTheSweep || callerTermIsTheStyling;
}

/**
 * The descriptor for a bare-owner count that came back 0 over an owner this provider's owner
 * vocabulary did not recognise. Kept under the 400-char reason cap that several consumers slice at;
 * the `covered_by` qids ride the block's own key as well, so the pointer survives any truncation.
 * PURE.
 */
/**
 * The descriptor for an ENUMERATE that came back with NO RECORDS over an owner this provider's own owner
 * vocabulary did not recognise (item 32, part 1).
 *
 * This is the worse half of the pair the count arm already guards, and it stayed open when closed
 * that one. `enumerated` is the ONE state the owner screen lets a negative rest on: a zero-record
 * `enumerated` block reads as "we looked at this competitor's portfolio and there is nothing there",
 * about a NAMED company, in a lawyer-facing report. If the applicant styling was never resolved, the
 * search that produced that zero was an implicit token-AND over a name the register may simply not spell
 * that way — so the honest answer is a declared gap, and a declared gap is the floor: when a name cannot
 * be resolved the answer is never a clean negative. PURE.
 */
export const unresolvedOwnerEnumerateReason = (term, coveredBy) =>
  `owner sweep returned NO RECORDS — UNVERIFIED, never a clean negative about this owner`
  + (coveredBy?.length
    ? ` (coverage is ${coveredBy[0]}${coveredBy.length > 1 ? ` +${coveredBy.length - 1} more` : ""})`
    : "")
  + `: this provider's owner vocabulary never produced a register applicant styling for ${JSON.stringify(String(term ?? "").slice(0, 80))}, `
  + `and APPLICANT_NAME EQUALS is an implicit token-AND — one token the register does not hold and the whole `
  + `conjunction is empty. An empty conjunction is not an empty portfolio. Disclosed as a coverage gap.`;

export const unresolvedOwnerCountReason = (term, coveredBy) =>
  `bare-owner portfolio count — UNVERIFIED, never the number zero`
  // the pointer sits EARLY, not in the tail: a reader who is told the number is untrustworthy has to be
  // told in the same breath where this owner IS covered, and a 400-char slice downstream must not be
  // able to take that half away. (The qids ride the block's own `covered_by` key as well.)
  + (coveredBy?.length
    ? ` (coverage is ${coveredBy[0]}${coveredBy.length > 1 ? ` +${coveredBy.length - 1} more` : ""})`
    : "")
  + `: this provider's owner vocabulary returned no applicant styling for `
  + `${JSON.stringify(String(term ?? "").slice(0, 40))}, so only the name as written was swept and it answered 0. `
  + `That is indistinguishable from an owner filing under a styling this query never named — not a `
  + `portfolio size, not a clean negative.`;

/**
 * The bare-owner portfolio descriptor's reason —.
 *
 * EXPORTED so the producer and its arm read ONE string. The previous version lived inline here and a
 * TRUNCATED copy lived in a test fixture; the arm asserted the copy, the product kept the original, and
 * the divergence went unnoticed until it was measured against real runs. A reason a test builds for
 * itself cannot see the reason the product writes.
 *
 * WHAT IT NO LONGER CLAIMS. It used to say "this owner is answered record-by-record by the owner×term
 * slice(s) …". `covered_by` is stamped at PLAN COMPILE time and names the slices that were DICTATED for
 * this owner — it says nothing about whether they enumerated. Measured across a delivered round: true
 * for 4 of 14 owners and false for 10, covering 39,302 hits (31% of the untraced total). The descriptor
 * was asserting coverage it is not in a position to observe, on the largest class in the artifact.
 *
 * The pointer is the part worth keeping, so it stays and the CLAIM around it goes: these are where the
 * records were sought, and their own state is what says whether they were found. PURE.
 */
export const ownerPortfolioDescriptorReason = (coveredBy) => (coveredBy?.length
  ? `count-only owner-portfolio descriptor (plan-dictated) — CROWD CONTEXT, never coverage. This owner's `
    + `records are SOUGHT record-by-record by the owner×term slice(s) ${coveredBy.join(", ")}; whether those `
    + `slices landed is THEIR state to read, not this descriptor's to assert — a dictated slice can itself `
    + `come back a crowd, deferred or errored. Size the crowd here; read the records, and their state, `
    + `there. "Portfolio too large, noted" is not a finding.`
  : "count-only crowd descriptor (plan-dictated)");

/**
 * THE MARK TEXT A BUILT QUERY WILL ACTUALLY CARRY — the input to the script-form guard below.
 *
 * `name`/`names` is the kernel's own shape and what both live providers' builders emit, and reading the
 * BUILT query (rather than the entry) is what lets a romanisation-index provider rescue a native-script
 * slice by substituting `romanizedTerms` before the guard ever sees it.
 *
 * But a builder is free to spell mark text some other way entirely — signa's request is a single
 * `query` string — and a query with no recognised mark field would present the guard with NOTHING to
 * check and sail straight through. That is fail-OPEN, and it would land on precisely the provider whose
 * script declaration is an undeclared `null`. So with no recognised field the guard falls back to the
 * ENTRY's own terms: the question that was asked, however a builder chose to spell it.
 *
 * `owner` slices are exempt, exactly as term-shape.mjs exempts them: owner names ride their own field
 * and their own rules, and a non-Latin owner name is a different question from a non-Latin mark.
 */
export function queryMarkTerms(e, query) {
  if (String(e?.predicate ?? "default") === "owner") return [];
  if (Array.isArray(query?.names)) return query.names;
  if (query?.name != null) return [query.name];
  return Array.isArray(e?.terms) ? e.terms : e?.term != null ? [e.term] : [];
}

export const describePlanEntry = (e) =>
  `${e.predicate} ${e.terms ? e.terms.join(" OR ") : e.term}`
  + `${typeof e.owner === "string" && e.owner.trim() && String(e.predicate ?? "") !== "owner" ? ` owner:${e.owner.trim()}` : ""}`
  + ` [cl ${(e.nice_classes ?? []).join(",")}]`;

// Compile one plan entry + its predicate params into the provider's query params (corsearch shapes by
// default: names/name/owners/owner + nice_classes + regions).
//
// F1 (owner-as-scope-field): a mark-text entry may ALSO carry `owner` — the owner×term INTERSECTION
// slice (the watchlist-coverage answer: the owner's filings, already narrowed to the dangerous term
// band). It rides the query as an additional owner filter next to the name clause; both live providers
// AND-compose them natively (corsearch: space-joined clauses; clarivate: AND-ed searchFields — where
// the owner-resolution machinery then applies to the owner value exactly as on a bare owner
// sweep, expansion and degrade-to-unresolved included). A provider that cannot intersect them declares
// `ownerTermIntersection` false and the entry is refused BEFORE the query is built (runEntry below) —
// never silently widened into an owner-less sweep.
export function defaultBuildEntryQuery(e, pp) {
  const { __term, __owner, ...modeParams } = pp;
  return {
    ...(__owner ? (e.terms ? { owners: e.terms } : { owner: e.term })
                : (e.terms ? { names: e.terms } : { name: __term ?? e.term })),
    // A non-Latin entry's Latin-script equivalent, when the minting lane knows one. Carried for the
    // provider to USE OR IGNORE: corsearch has a real native-script index and ignores it; clarivate
    // indexes non-Latin marks by their transliteration ONLY and substitutes it (see its
    // buildEntryQuery). Never a filter and never a narrowing — an absent field changes nothing.
    ...(Array.isArray(e.romanizedTerms) && e.romanizedTerms.length && !__owner
      ? { romanized_names: e.romanizedTerms } : {}),
    // F1 owner×term intersection: a mark-text entry carrying `owner` rides it as an additional
    // owner filter beside the name clause (see the doc block above defaultBuildEntryQuery).
    ...(!__owner && typeof e.owner === "string" && e.owner.trim() ? { owner: e.owner.trim() } : {}),
    ...modeParams,
    nice_classes: (e.nice_classes ?? []).map(Number).filter(Number.isFinite),
    ...(Array.isArray(e.regions) && e.regions.length ? { regions: e.regions } : {}),
  };
}

/**
 * The buildEntryQuery for a provider whose regions[] is MANDATORY (capabilities.regionsRequired).
 *
 * Review finding 7/14: several lanes mint plan entries with `regions: []` — the cross-run recall
 * probes and the common-law→register cross-check (pipeline.mjs), frame-diff remedies
 * (frame-diff-model.mjs), and model-proposed supplementals (engine/mcp/supplemental.mjs). That shape is
 * harmless on corsearch (no region clause = a worldwide sweep) and so it is the natural habit; on a
 * provider that hard-throws without regions it made every one of those lanes fail 100% of the time,
 * MISLABELLED as a provider/tool-absence coverage row ("provider error …" matches coverage-ledger's
 * TOOL_ABSENCE_RE) when in fact we simply never built the query.
 *
 * The fix is not to invent scope: it is to apply the scope the FROZEN PLAN already carries. plan.regions
 * IS the matter's territorial scope, translated into this provider's office vocabulary at compile time,
 * and an entry that declares none is asking for "the matter's territories", not "the world". Backfilling
 * from it is therefore narrower-or-equal to nothing and exactly what was asked. If the plan ALSO carries
 * no regions there is nothing honest to fall back to and the provider still fails loud — the entry never
 * silently becomes a differently-scoped search.
 */
export function makeRegionRequiredBuildEntryQuery(inner = defaultBuildEntryQuery) {
  return function buildEntryQuery(e, pp, plan) {
    const q = inner(e, pp, plan);
    if (Array.isArray(q.regions) && q.regions.length) return q;
    const planRegions = (Array.isArray(plan?.regions) ? plan.regions : []).map((r) => String(r).trim()).filter(Boolean);
    return planRegions.length ? { ...q, regions: planRegions } : q;
  };
}

/**
 * Build the execute-plan primitive for one provider.
 *
 * @param deps.search    (auth, params, tctx) => toolResult  — used for expected_kind:"count" descriptors.
 * @param deps.enumerate (auth, params, tctx) => toolResult  — the kernel enumerate for this provider.
 * @param deps.predicateParams / deps.buildEntryQuery / deps.describeEntry — shape adapters.
 * @param deps.countParams — params merged for a count-only descriptor probe (corsearch: { limit: 1 }).
 */
export function makeExecutePlan(deps) {
  const {
    search: rawSearch,
    enumerate: rawEnumerate,
    predicateParams = planPredicateParams,
    buildEntryQuery = defaultBuildEntryQuery,
    describeEntry = describePlanEntry,
    countParams = { limit: 1 },
    // The provider's declared capability contract (providers/<id>/src/capabilities.js). Used ONLY for
    // declaration-driven refusals (owner×term and script form, both below) — never to vary query
    // semantics. Optional, and the two refusals read an absent contract differently ON PURPOSE:
    //   * owner×term keeps its historical shape — no contract supplied ⇒ no refusal, because the
    //     compile/mint-time stamps are the primary guard there and were the pre-phase-3 behaviour.
    //   * script form treats an absent contract exactly like an undeclared one: it DEFERS. The whole
    //     point of that rule is that "nobody declared what this index holds" may never resolve to a
    //     silent zero, and a caller who wired an executor without a contract has declared even less
    //     than one who left the field null.
    capabilities = null,
  } = deps;

  // ── the I/O seam (see ./transport-guard.mjs) ──────────────────────────────────────────────────────
  // Guarding `enumerate` here is NOT redundant with the enumerate kernel's own guard: a provider's
  // EXPORTED enumerate may do live work outside that kernel — clarivate resolves an owner name against
  // /resolution/company before it enumerates anything — and a rejection from that call reaches this
  // layer and nothing else. That is the seam the most recent live run needed. The same is now true of
  // `search`: the count arm below dispatches through it, and that arm's owner-bearing queries resolve
  // the applicant name too, so a rejection from THAT call lands here as well.
  const search = guardToolCall(rawSearch, "search");
  const enumerate = guardToolCall(rawEnumerate, "enumerate");

  return async function executePlan(auth, params, tctx) {
    const planPath = String(params?.plan_path ?? "");
    const axis = String(params?.axis ?? "").trim();
    const outPath = String(params?.output_path ?? "");
    if (!planPath || !axis || !outPath)
      return { type: "text", text: "ERROR: plan_path, axis and output_path are all required." };
    let plan;
    try { plan = JSON.parse(readFileSync(planPath, "utf8")); }
    catch (err) { return { type: "text", text: `ERROR: cannot read the plan at ${planPath}: ${err.message}` }; }
    const entries = (Array.isArray(plan?.entries) ? plan.entries : []).filter((e) => e?.axis === axis);
    if (!entries.length) return { type: "text", text: `ERROR: the plan carries no entries for axis "${axis}".` };

    // Optional `qids` filter (repair-first): the driver's plan-direct-execute repair re-runs
    // ONLY the dictated slices that own no band block, without an agent turn. Two merge-safety rules:
    // (1) `owned` below is built from the TARGETED entries only, so untargeted entries' existing blocks
    // are never dropped by a targeted call; (2) stateByQid is SEEDED from the existing band so a
    // when-guarded entry in the subset evaluates runs_if_enumerated against its parent's PRIOR result
    // when the parent is not being re-run. Seeded states never appear in the response's `states`.
    const qidsFilter = Array.isArray(params?.qids) && params.qids.length ? new Set(params.qids.map(String)) : null;
    const targeted = qidsFilter ? entries.filter((e) => qidsFilter.has(e.qid)) : entries;
    if (!targeted.length) return { type: "text", text: `ERROR: no dictated entries on axis "${axis}" match qids [${[...qidsFilter].join(", ")}].` };

    const stateByQid = new Map();
    const seeded = new Set();
    if (qidsFilter) {
      try {
        const existing = JSON.parse(readFileSync(outPath, "utf8"));
        if (Array.isArray(existing)) {
          for (const b of existing) {
            if (b && typeof b === "object" && b.qid && typeof b.state === "string" && !qidsFilter.has(b.qid)) {
              stateByQid.set(b.qid, b.error ? "error" : b.state);
              seeded.add(b.qid);
            }
          }
        }
      } catch { /* no/unreadable prior band — when-guards fall back to skip (parent state unknown) */ }
    }
    const blocks = [];
    const dispatchEntry = async (e) => {
      const base = { qid: e.qid, query: describeEntry(e) };
      // ── phase 3: a slice the ACTIVE PROVIDER CANNOT EXECUTE never becomes a weaker query ──────────
      // The compiler stamped `unsupported` (predicate with no mapping on this provider, or a
      // jurisdiction outside its coverage — see register-plan.mjs). Defense in depth for doctrine
      // rule 2: build NOTHING, call NOTHING, and emit an error:true block so the plan join counts the
      // dictated slice as MISSING (→ the deferred coverage row) rather than an executed clean. This
      // branch is purely ADDITIVE and touches none of the merge / temp+rename semantics below.
      if (e?.unsupported === true) {
        blocks.push({ state: "incomplete", ...base, total_hits: 0, fetched: 0, sample: [], error: true, deferred: true,
          reason: String(e.unsupported_reason ?? "the active register provider does not support this slice — provider capability absent").slice(0, 400) });
        stateByQid.set(e.qid, "error");
        return;
      }
      // ── A1 defence-in-depth: a PLAN DEFECT is refused at dispatch, never searched literally ──────
      // The frozen plan is supposed to be lint-clean (validatePlanFeasibility + the proposal mint run
      // the same rules), but this executor is the LAST hands on the query: a term that disagrees with
      // its predicate (an anchored-`*` under exact) or a label/prose-shaped
      // term would dispatch as a nil search and come back a schema-level confident clean. That is a
      // FALSE CLEAN, strictly worse than no block. So the entry is refused: error:true, NOT deferred
      // (deferral is for capabilities the provider honestly lacks; this is a defect in the plan
      // itself) — the join counts it MISSING, and the "plan-defect" token classifies deterministic
      // (repairs.mjs DETERMINISTIC_RE): no park ladder grinds against an answer that cannot change.
      const planDefects = entryTermIssues(e);
      if (planDefects.length) {
        blocks.push({ state: "incomplete", ...base, total_hits: 0, fetched: 0, sample: [], error: true,
          reason: `plan-defect: ${planDefects[0].issue} — slice NOT dispatched (a literal search here would be a false clean)`.slice(0, 400) });
        stateByQid.set(e.qid, "error");
        return;
      }
      // F1 defence-in-depth: an owner×term entry on a provider whose contract does not declare the
      // intersection is a capability gap — deferred/disclosed like any unsupported stamp (retrying is
      // pointless; dropping the owner filter would be a silently different search).
      if (capabilities && capabilities.ownerTermIntersection !== true
          && typeof e?.owner === "string" && e.owner.trim() && String(e?.predicate ?? "default") !== "owner") {
        blocks.push({ state: "incomplete", ...base, total_hits: 0, fetched: 0, sample: [], error: true, deferred: true,
          reason: `owner×term intersection is not supported by the active register provider (${capabilities.id ?? "unknown"}) — the owner scope field cannot be combined with mark text there, so this slice was never searched. It is a deferred gap for judgment, never a clean negative.` });
        stateByQid.set(e.qid, "error");
        return;
      }
      // `plan` is passed as a THIRD argument so a provider whose regions[] is mandatory can backfill an
      // entry that carries none from the plan's own regions (makeRegionRequiredBuildEntryQuery). The
      // default builder ignores it — corsearch/signa behaviour is byte-identical.
      const query = buildEntryQuery(e, predicateParams(e), plan);
      // ── SCRIPT FORM, declaration-driven: a term this index cannot HOLD is refused, not sent ──────
      // The parity half of the transliteration defect. One provider refused native-script
      // mark text inside its own request builder, because its index holds the romanisation and the
      // characters would answer 0 with no error — a false clean. No other provider had any such check,
      // so the identical thirteen terms would have gone to the wire there and come back a confident
      // zero on the axis most likely to carry a real obstacle.
      //
      // The fix is NOT a blanket ban: on a register that genuinely indexes characters, native script is
      // a legitimate and evidenced query, and banning it would destroy real coverage. So the rule hangs
      // off the DECLARATION (capabilities.nativeScriptIndex) and never off the vendor name, and an
      // UNDECLARED provider takes the fail-loud reading — "nobody probed it" must cost a disclosed
      // deferral, not a silent zero. See providers/_shared/script-form.mjs.
      //
      // Checked on the BUILT query, deliberately: a romanisation-indexed provider substitutes the
      // entry's `romanizedTerms` in its own buildEntryQuery, and a slice rescued that way IS answerable.
      // Checking the entry's raw term instead would refuse exactly the slices the rescue exists to save.
      // Mark text only — owner names ride their own field and their own rules (see queryMarkTerms,
      // which also closes the fail-open corner where a builder spells mark text some other way).
      const scriptGap = nativeScriptIndexGap(capabilities, queryMarkTerms(e, query));
      if (scriptGap) {
        blocks.push({ state: "incomplete", ...base, total_hits: 0, fetched: 0, sample: [], error: true, deferred: true,
          reason: `${CAPABILITY_GAP_MARKER} ${scriptGap}` });
        stateByQid.set(e.qid, "error");
        return;
      }
      // T1 (J6): a PROVIDER ERROR is never confusable with a sanctioned crowd. Error blocks are
      // stamped `error:true` so the plan join (register-plan.mjs) counts the dictated slice as MISSING —
      // it then rides the warm-followup → honest-fail ladder instead of shipping as "executed(incomplete)".
      // Each errored call is retried ONCE in-tool first (transients die here, cheaply).
      if (e.expected_kind === "count") {
        // count-only crowd descriptor — describes the crowd for judgment, enumerates nothing.
        // F2 owner lane: a descriptor carrying `covered_by` is the bare-owner portfolio
        // count, and its reason POINTS AT the owner×term slice qids that are the owner's actual
        // record-by-record coverage — so no reader can mistake the size of the portfolio for the
        // answer, and "portfolio too large, noted" has nowhere to grow from. The number itself keeps
        // the register-count doctrine verbatim: code took it, a count we could not take is never
        // zero (error:true, total untrusted), and nothing here bands it.
        const coveredBy = Array.isArray(e.covered_by) && e.covered_by.length ? e.covered_by : null;
        // — built by the exported helper, never inlined, so a test can read the PRODUCT's sentence.
        const descriptorReason = ownerPortfolioDescriptorReason(coveredBy);
        let r = await search(auth, { ...query, ...countParams }, tctx);
        let parsed = (!r?.isError && typeof r?.text === "string" && !r.text.startsWith("ERROR")) ? (() => { try { return JSON.parse(r.text); } catch { return null; } })() : null;
        if (!parsed) {
          r = await search(auth, { ...query, ...countParams }, tctx);
          parsed = (!r?.isError && typeof r?.text === "string" && !r.text.startsWith("ERROR")) ? (() => { try { return JSON.parse(r.text); } catch { return null; } })() : null;
        }
        // The deferral lane exists on THIS arm too (audit item 5a): a count-descriptor refusal carrying
        // the capability-gap marker is a CLIENT-SIDE, deterministic no — the request was never sent and
        // no rung of the repair ladder can change the answer. It used to ride the ladder anyway (only
        // the enumerate arm below called isCapabilityGap), grinding a deliverable run toward StageFailure
        // over a refusal that re-derives identically. Same classification, same stamps as the enumerate
        // arm: error kept (never a sanctioned crowd), deferred added (joinPlanToBands' disclosed bucket).
        const countGap = !parsed && isCapabilityGap(String(r?.text ?? ""));
        // ── the UNVERIFIED bare-owner zero (see ownerNameResolved above) ─────────────────────────
        // Only a BARE-owner descriptor (the entry's own predicate, so this reads the question that was
        // asked rather than guessing from the built query), only a counted 0, and only where the
        // provider reported a resolution that did not stand behind the sweep. The stamps are the
        // executor's existing deterministic-gap pair and are chosen for exactly what each one buys:
        //   error:true    — this is not a sanctioned crowd. joinPlanToBands must never let a clean rest
        //                   on it, and owner-screen.mjs's `portfolio.counted` must read false.
        //   deferred:true — re-running the identical entry re-derives the identical zero and the
        //                   identical failed resolution. Without it the block joins MISSING, the warm
        //                   followup grinds, and a run that is perfectly deliverable-with-a-disclosed-
        //                   gap dies at the fan-in gate instead. That trade is the one the deferral
        //                   lane was built for; the gap is disclosed either way.
        // total_hits is NULL, not 0, on the same rule the count kernel states for a count that could
        // not be taken: nothing here may hand a downstream reader a number to print as a portfolio.
        // `Number.isFinite` first, deliberately: a provider that answered but could not count reports
        // total_hits NULL, and `Number(null)` is 0. Reading that as a counted zero would hang this
        // owner-styling story on a probe that counted nothing — the right stamp for the wrong reason,
        // which is how a diagnosis rots. A counted zero has to BE a number.
        const ownerUnverified = !!parsed && String(e?.predicate ?? "") === "owner"
          && Number.isFinite(parsed.total_hits) && Number(parsed.total_hits) === 0
          && parsed.owner_resolution != null && !ownerNameResolved(parsed.owner_resolution);
        const counted = !!parsed && !ownerUnverified;
        blocks.push({ state: "incomplete", ...base,
          total_hits: ownerUnverified ? null : (parsed?.total_hits ?? 0), fetched: parsed?.results?.length ?? 0,
          sample: (parsed?.results ?? []).slice(0, 5),
          ...(counted ? {} : { error: true }),
          ...(countGap || ownerUnverified ? { deferred: true } : {}),
          ...(coveredBy ? { covered_by: coveredBy } : {}),
          // the resolution the sweep actually ran on, verbatim — a reader must be able to see WHICH
          // applicant styling was asked for, on a verified zero as much as on an unverified one.
          ...(parsed?.owner_resolution ? { owner_resolution: parsed.owner_resolution } : {}),
          reason: ownerUnverified ? unresolvedOwnerCountReason(e.term ?? (e.terms ?? [])[0], coveredBy)
            : parsed ? descriptorReason
            : `provider error on the count probe (after one in-tool retry): ${clipProviderText(r?.text ?? "", 100)}` });
        stateByQid.set(e.qid, counted ? "incomplete" : "error");
        return;
      }
      // enumerate launders a provider error into a VALID {state:"incomplete", reason:"provider error…"}
      // (its own mid-loop degrade) — detect that shape too, or a 502 ships indistinguishable from a crowd.
      const providerErrored = (p) => !p || typeof p !== "object" || !p.state
        || (p.state === "incomplete" && /provider error/i.test(String(p.reason ?? "")));
      const runEnumerate = async () => {
        const rr = await enumerate(auth, { ...query, in_scope_classes: query.nice_classes }, tctx);
        try { return { r: rr, parsed: JSON.parse(rr?.text ?? "") }; } catch { return { r: rr, parsed: null }; }
      };
      let { r, parsed } = await runEnumerate();
      if (providerErrored(parsed)) ({ r, parsed } = await runEnumerate());
      if (providerErrored(parsed)) {
        const detail = parsed?.reason ?? clipProviderText(r?.text ?? "", 120);
        // A CLIENT-SIDE refusal (the provider's own query language cannot express this slice — the
        // request was never sent) is deterministic: no rung of the repair ladder can change it. Defer it
        // as a disclosed gap instead of grinding the run to a StageFailure over an answer that will
        // never differ. Everything else keeps the transient reading and rides the ladder.
        const gap = isCapabilityGap(detail);
        blocks.push({ state: "incomplete", ...base,
          total_hits: parsed?.total_hits ?? 0, fetched: parsed?.fetched ?? 0, sample: (parsed?.sample ?? []).slice(0, 5),
          error: true, ...(gap ? { deferred: true } : {}),
          reason: `provider error (after one in-tool retry): ${clipProviderText(detail, 240)}` });
        stateByQid.set(e.qid, "error");
        return;
      }
      // ── item 32 part 1 — THE FLOOR: an unresolved name never yields a clean negative ───────────────
      // The count arm above has guarded this since. The enumerate arm did not, and it is the worse
      // half: `enumerated` is the one state the owner screen lets a negative REST on, so a zero-record
      // enumerated block ships as "we looked at this named competitor's portfolio and it is empty".
      // If the provider's owner vocabulary never produced a register applicant styling, that zero came
      // out of an implicit token-AND over a name the register may not spell our way — an empty
      // conjunction, not an empty portfolio. Same discriminator, same three-valued answer: total_hits
      // null (never 0), deferred so it reads as a disclosed coverage row, and the resolution note kept
      // verbatim so a reader sees WHICH styling was asked for.
      //
      // Deliberately narrow: only an owner-predicate entry, only a genuinely EMPTY result, and only
      // when the provider actually reported a resolution attempt that produced nothing register-side.
      // A resolved-and-empty sweep is a real negative and stays one — this must not turn every quiet
      // owner into a caveat.
      const ownerEntry = Boolean(e?.predicate === "owner" || e?.owner || (Array.isArray(e?.owners) && e.owners.length));
      const emptyEnumerate = parsed.state === "enumerated"
        && !(Array.isArray(parsed.records) ? parsed.records.length : (parsed.total_hits ?? 0));
      if (ownerEntry && emptyEnumerate && parsed.owner_resolution != null && !ownerNameResolved(parsed.owner_resolution)) {
        const coveredBy = Array.isArray(e.covered_by) && e.covered_by.length ? e.covered_by : null;
        blocks.push({ ...parsed, ...base, state: "incomplete", total_hits: null, deferred: true,
          ...(coveredBy?.length ? { covered_by: coveredBy } : {}),
          reason: unresolvedOwnerEnumerateReason(e.term ?? (e.terms ?? [])[0] ?? e.owner, coveredBy) });
        stateByQid.set(e.qid, "incomplete");
        return;
      }
      blocks.push({ ...parsed, ...base, state: parsed.state });
      stateByQid.set(e.qid, parsed.state);
    };

    // ── ONE ENTRY CAN NEVER ABORT THE PLAN — the last backstop ───────────────────────────────────────
    // The dependency guards above convert the fault class that actually occurs (a network rejection out
    // of search/enumerate/screen). This catches everything else that could still throw between entries:
    // building the query for a malformed entry, describing it, a provider adapter raising on a shape it
    // did not expect. A register plan carries tens of dictated slices and they are INDEPENDENT — losing
    // the other thirty because the eleventh threw is never the right trade. The failed slice degrades
    // exactly like a provider error: error:true → the plan join counts it MISSING → the repair ladder,
    // and the remaining entries still execute and still get written.
    //
    // NOT `deferred`: deferral is for a capability the provider honestly lacks, where no retry can
    // change the answer. An unhandled fault here is an unknown of unknown durability, so it keeps the
    // transient reading. The reason names it an EXECUTOR fault so it is never read as something the
    // register said — a block that fabricated a provider response would be the worse defect.
    const runEntry = async (e) => {
      try {
        await dispatchEntry(e);
      } catch (err) {
        // `describeEntry` is itself one of the things that can throw here, so the recovery block must
        // not depend on it succeeding — a backstop that can fail is not a backstop.
        let query = String(e?.qid ?? "");
        try { query = describeEntry(e); } catch { /* keep the qid as the only honest description */ }
        blocks.push({ state: "incomplete", qid: e?.qid, query, total_hits: 0, fetched: 0, sample: [], error: true,
          reason: `provider error — unhandled executor fault on this entry, which was degraded so the rest of the plan could run: ${faultText(err, "plan entry")}`.slice(0, 400) });
        stateByQid.set(e?.qid, "error");
      }
    };

    for (const e of targeted.filter((x) => !x.when)) await runEntry(e);
    const skipped = [];
    for (const e of targeted.filter((x) => x.when)) {
      if (stateByQid.get(e.when.runs_if_enumerated) === "enumerated") await runEntry(e);
      else skipped.push(e.qid);   // crowd/failed parent is TERMINAL for the fringe — by design, never an error
    }

    // MERGE, never clobber: the call is idempotent and judgment survives it. Output = this axis's
    // fresh plan blocks (plan order) + every existing block this plan does NOT own — blocks with no
    // qid (the model's judgment additions) and blocks whose qid belongs to another axis/plan. An
    // owned qid's old block is replaced by the fresh result; an owned-but-SKIPPED qid (crowd-gated
    // fringe) gets no block and any stale one is dropped (a fringe slice must never outlive its
    // parent's crowd verdict). This makes the initial call and every warm followup the SAME call.
    const owned = new Set(targeted.map((e) => e.qid));
    let preserved = [];
    try {
      const existing = JSON.parse(readFileSync(outPath, "utf8"));
      if (Array.isArray(existing)) preserved = existing.filter((b) => b && typeof b === "object" && !owned.has(b.qid));
    } catch { /* no/unreadable prior band — fresh write */ }

    mkdirSync(dirname(outPath), { recursive: true });
    // temp+rename: a fail-closed reader sees the old complete band or the new one, never a torn write.
    writeFileSync(`${outPath}.tmp`, JSON.stringify([...blocks, ...preserved], null, 2) + "\n");
    renameSync(`${outPath}.tmp`, outPath);
    return { type: "text", text: JSON.stringify({
      written: outPath, blocks: blocks.length + preserved.length, executed: blocks.length, preserved: preserved.length, skipped,
      states: Object.fromEntries([...stateByQid].filter(([q]) => !seeded.has(q))),
    }, null, 2) };
  };
}
