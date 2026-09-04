// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// supplemental.mjs — the mint-and-execute seam for MODEL-PROPOSED register queries (the re-route that
// closes the last hand-transcription lane; copper-lattice 2026-07-08).
//
// Before this, the register-unit funnel ran "judgment additions" by hand: free register_enumerate
// calls, results hand-appended as qid-less band blocks — the lane where a SIGKILLed pass's false
// 0/clean shipped. Now the model PROPOSES queries and this module, in ONE synchronous tool call:
//   1. MINTS each proposal as a qid'd plan entry (deterministic qid ⇒ a retried session re-proposing
//      the same query mints the same entry — idempotent), validated against the same feasibility
//      rules the compiler enforces (predicate vocabulary, OR-width ≤ PLAN_MAX_OR_WIDTH — reject wide,
//      never chunk-rescue a proposal; non-empty numeric classes; no `when` guards on supplementals);
//   2. PERSISTS them to the PER-AXIS supplemental plan (register-units/<axis>-supplemental-plan.json —
//      axes run in parallel, one writer per file; the frozen shared plan is NEVER touched from a tool);
//   3. EXECUTES them through doExecutePlan pointed at that file (zero executor fork: count-first,
//      chunking, ceiling, in-tool retry, error:true stamping, merge-never-clobber all inherited —
//      CODE writes the band, qids stamped);
//   4. RETURNS a reasoning payload READ BACK FROM THE BAND (never model-transcribed): per-qid state,
//      counts, term_counts, and a bounded records preview — enough to iterate (propose → read counts →
//      propose narrower) inside the same turn.
// The driver folds the supplemental files into the run plan at fan-in (foldSupplementalProposals), so
// every supplemental is skeleton-tracked and receipt-durable like a dictated entry.
//
// Caps: 12 per call, 24 per axis — overflow is REJECTED loudly in the response, never silently dropped.
// Both were settable and nothing ever set them; step 3 made them constants.
//
// Pure orchestration with injected IO/executor (deps) so it tests offline; the corsearch-server handler
// binds the live doExecutePlan.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { driverDir } from "../../../shared/driver-dir.mjs";   //
import { PLAN_PREDICATES, PLAN_MAX_OR_WIDTH, PLAN_MAX_NAME_LENGTH, fingerprint, ownerIntersectionGap, resolveRegions } from "../../register-plan.mjs";
import { entryTermIssues } from "../../../providers/_shared/term-shape.mjs";
import { isNonLatinTerm, romanizationRefusal, romanizationSpellings, nativeScriptIndexGap } from "../../../providers/_shared/script-form.mjs";

const slug = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "q";

const PREVIEW_FIELDS = ["record_id", "mark_text", "classes", "status", "owner_name", "owner_country", "screen_verdict"];
const preview = (records) => (Array.isArray(records) ? records : []).slice(0, 25)
  .map((r) => Object.fromEntries(PREVIEW_FIELDS.map((k) => [k, r?.[k] ?? (k === "screen_verdict" ? r?.screen?.screen_verdict ?? null : null)])));

/** Compact copy of a proposal for the rejected[] rows — enough to reconstruct WHAT was asked
 *  (the ask ledger renders it), never the whole object. PURE. */
const compactProposal = (p) => ({
  ...(p?.predicate != null ? { predicate: String(p.predicate).slice(0, 40) } : {}),
  ...(typeof p?.term === "string" ? { term: p.term.slice(0, 120) } : {}),
  ...(Array.isArray(p?.terms) ? { terms: p.terms.map((t) => String(t ?? "").slice(0, 120)).slice(0, 12) } : {}),
  ...(Array.isArray(p?.nice_classes) ? { nice_classes: p.nice_classes.map(String).slice(0, 20) } : {}),
  ...(typeof p?.owner === "string" ? { owner: p.owner.slice(0, 80) } : {}),
  ...(typeof p?.rationale === "string" && p.rationale.trim() ? { rationale: p.rationale.trim().slice(0, 200) } : {}),
});

/** C3 (the postmortem cap-ordering miss): does a proposal intersect the priority (in-scope) classes? PURE. */
const inPriority = (p, prio) =>
  (Array.isArray(p?.nice_classes) ? p.nice_classes : []).some((c) => prio.has(String(c).trim()));

export function mintSupplementalEntries(axis, proposals, { existingQids = new Set(), perCall = 12, axisMax = 24, existingCount = 0, capabilities = null, priorityClasses = [] } = {}) {
  const minted = [], reused = [], rejected = [], enriched = [], narrowed = [];
  let budget = Math.max(0, axisMax - existingCount);
  // C3 — the Cl.30 SLUSH lesson: the per-axis cap rejected a coverage-relevant retry while earlier
  // out-of-priority proposals held the budget. STABLE-sort the batch by intersection with the
  // priority (in-scope) classes BEFORE budget assignment — priority proposals compete for the caps
  // first, non-priority ones keep their relative order behind them. The cap VALUES are unchanged
  // (no count threshold moves), and with no priorityClasses the order is byte-identical to before.
  const prio = new Set((priorityClasses ?? []).map((c) => String(c).trim()).filter(Boolean));
  const indexed = (proposals ?? []).map((p, i) => ({ p: p ?? {}, i }));
  const ordered = prio.size
    ? [...indexed.filter(({ p }) => inPriority(p, prio)), ...indexed.filter(({ p }) => !inPriority(p, prio))]
    : indexed;
  for (const { p, i } of ordered) {
    const issue = (msg) => rejected.push({ index: i, issue: msg, proposal: compactProposal(p) });
    if (minted.length >= perCall) { issue(`per-call cap ${perCall} reached`); continue; }
    const predicate = String(p.predicate ?? "default");
    if (!PLAN_PREDICATES.includes(predicate)) { issue(`unknown predicate "${predicate.slice(0, 20)}" (one of: ${PLAN_PREDICATES.join(", ")})`); continue; }
    const terms = Array.isArray(p.terms) ? p.terms.map((t) => String(t ?? "").trim()).filter(Boolean) : null;
    const term = typeof p.term === "string" ? p.term.trim() : "";
    if ((terms && term) || (!terms && !term)) { issue("exactly one of term|terms is required"); continue; }
    if (terms && terms.length > PLAN_MAX_OR_WIDTH) { issue(`OR-stack ${terms.length} exceeds the ${PLAN_MAX_OR_WIDTH}-name bound — split the proposal, never rely on chunk-rescue`); continue; }
    if (terms && terms.some((t) => t.length > PLAN_MAX_NAME_LENGTH)) { issue(`a term exceeds ${PLAN_MAX_NAME_LENGTH} chars`); continue; }
    if (!terms && term.length > PLAN_MAX_NAME_LENGTH) { issue(`term exceeds ${PLAN_MAX_NAME_LENGTH} chars`); continue; }
    const nice = (Array.isArray(p.nice_classes) ? p.nice_classes : []).map((c) => String(c).trim()).filter((c) => /^\d+$/.test(c));
    if (!nice.length) { issue("nice_classes must be a non-empty numeric list (an unscoped all-class sweep is forbidden)"); continue; }
    if (p.when != null) { issue("supplemental entries never carry `when` guards"); continue; }
    // F1 — `owner` is a SCOPE FIELD on a mark-text proposal (the owner×term intersection slice, the
    // watchlist-coverage answer). A bare owner sweep stays predicate:"owner" with the owner name as
    // its term — an owner field ON that predicate would be the same value twice, so it is rejected
    // rather than guessed about.
    const owner = typeof p.owner === "string" ? p.owner.trim() : "";
    if (p.owner != null && !owner) { issue("owner, when present, must be a non-empty string"); continue; }
    if (owner && predicate === "owner") { issue(`predicate "owner" carries the owner name as its term — the owner scope field rides a MARK-TEXT predicate ({predicate:"default", term:"TIKI", owner:"…"})`); continue; }
    // ── romanization (2026-07-30 review round — the enforcement-without-invitation fix) ────────────
    // Half the live incident's non-Latin deferrals were supp: entries, because the guard's remediation
    // ("supply the romanisation on the entry's romanizedTerms") pointed at a field this proposing
    // surface could not set. The proposal now states it, validated by the SAME vocabulary as the
    // manifest's (script-form.mjs): plain ASCII, on a single non-Latin term only — an OR-stack is
    // chunked, never substituted, and an owner name rides its own rules. Rejections teach in-turn
    // (deterministic qids make the corrected re-proposal free).
    const romanRaw = typeof p.romanization === "string" ? p.romanization.trim() : "";
    if (p.romanization != null && !romanRaw) { issue("romanization, when present, must be a non-empty string"); continue; }
    let romanizedTerms = null;
    if (romanRaw) {
      if (terms) { issue("an OR-stack proposal cannot carry a romanization — one member's Latin form must never substitute a whole chunk's names; propose the non-Latin member as its own single-term entry"); continue; }
      if (predicate === "owner") { issue("a romanization never rides an owner sweep — owner names ride their own field and their own rules"); continue; }
      const refusal = romanizationRefusal(romanRaw);
      if (refusal) { issue(`romanization rejected: ${refusal}`); continue; }
      if (!isNonLatinTerm(term)) { issue(`a romanization belongs ONLY on a non-Latin term — "${term.slice(0, 40)}" is already Latin script, so this romanization transliterates a DIFFERENT string; drop it or fix the term`); continue; }
      romanizedTerms = romanizationSpellings(romanRaw);
    }
    const term_literal = p.term_literal === true;
    // A1 — the same term-shape/term-predicate lint the plan freeze enforces, at the PROPOSAL seam:
    // the model gets the reason IN-TURN (rejected[]) and can re-propose the mark-shaped term — a
    // label or a wildcard-under-exact never becomes a frozen qid in the first place.
    const shapeIssues = entryTermIssues({ predicate, ...(terms ? { terms } : { term }), term_literal });
    if (shapeIssues.length) { issue(shapeIssues[0].issue); continue; }
    // ── A5 (addendum 2026-07-30): SCREEN BEFORE DISPATCH, against the test that produced the
    // original deferral ───────────────────────────────────────────────────────────────────────────
    //
    // The corrective cycle exists to REMOVE deferrals. On the 2026-07-30 evidence run it produced
    // them: six of the eight qids still deferred at the end had been proposed by the corrective cycle
    // itself, every one refused for the identical reason the deferral it was answering had been
    // refused for — the provider's index cannot hold that script. 277 seconds and a paid turn spent
    // manufacturing more of the thing the pass was there to clear.
    //
    // The refusal is DETERMINISTIC and client-side: the executor's own `nativeScriptIndexGap` decides
    // it from the declared capability contract, before any request is built. So the mint runs the SAME
    // test here, one seam earlier, and the answer arrives IN-TURN in rejected[] where the model can act
    // on it — instead of one paid dispatch later as a band block nobody can fix.
    //
    // Screen, then ENRICH: this fires only when no usable `romanization` was supplied. gave the
    // proposal surface that field (the enforcement-without-invitation fix), so the rejection names the
    // remedy the proposer can actually apply, and a re-proposal carrying it mints and executes — the
    // rescue path stays wide open. It is never "reject non-Latin proposals": on a provider that
    // declares a native-script index the gap is null and nothing here fires at all.
    //
    // Deliberately NOT extended to the owner×term gap: that one is minted `unsupported` on purpose
    // (below), because there the gap itself is the finding and it belongs on the coverage record.
    //
    // Mark text only, exactly like queryMarkTerms at the executor seam: owner names ride their own
    // field and their own rules, and a non-Latin owner name is a different question from a non-Latin mark.
    // With NO capability contract in hand there is no deterministic answer to screen against, so the
    // mint stays out of it and the executor's own guard decides (fail-loud, unchanged).
    const screenTerms = (!capabilities || predicate === "owner") ? [] : (romanizedTerms?.length ? romanizedTerms : (terms ?? [term]));
    const scriptGap = nativeScriptIndexGap(capabilities, screenTerms);
    if (scriptGap) {
      // THE REMEDY MUST BE FOLLOWABLE (2026-07-31 review round). "Supply it as this proposal's
      // `romanization` field and re-propose" is a DEAD END on an OR-stack: the romanization guard
      // above refuses a `terms` proposal outright ("an OR-stack proposal cannot carry a
      // romanization"), so a model that does exactly what it was told earns a second, guaranteed
      // rejection — and on a mixed stack the Latin members the provider WOULD have answered are
      // lost with it. The stack's remedy is the SPLIT the other guard already names, given here
      // directly, so one corrected re-proposal clears it.
      if (terms) {
        const native = terms.filter((t) => isNonLatinTerm(t));
        const latin = terms.filter((t) => !isNonLatinTerm(t));
        issue(`${scriptGap} This is an OR-stack, so the romanisation cannot ride it — one member's Latin form must never substitute a whole chunk's names. SPLIT it instead, in one re-proposal: ` +
          (latin.length ? `keep ${JSON.stringify(latin)} as ${latin.length > 1 ? "this OR-stack" : "a single-term entry"} (the provider answers ${latin.length > 1 ? "them" : "it"} as-is), and ` : "") +
          `propose ${native.map((t) => JSON.stringify(t.slice(0, 40))).join(", ")} as ${native.length > 1 ? "their own single-term entries, each" : "its own single-term entry"} carrying the "romanization" field. Re-proposing the stack unchanged, or with a romanization added to it, would only re-derive a refusal.`);
        continue;
      }
      issue(`${scriptGap} Supply it as this proposal's "romanization" field and re-propose — the identical query then mints and executes. Proposing it again unchanged would only re-derive the same refusal.`);
      continue;
    }
    const regions = (Array.isArray(p.regions) ? p.regions : []).map((r) => String(r).trim()).filter(Boolean);
    // ── item 19 — SCREEN AGAINST EVERY DETERMINISTIC REFUSAL, not just the script one ───────────────
    //
    // The A5 screen above proved the principle on one class: a refusal the executor will reach
    // client-side, from the declared capability contract, before any request is built, can be reached
    // here instead — one seam earlier, in-turn, where the model can act on it. The corrective cycle
    // exists to REMOVE deferrals and was manufacturing them, six of eight on the evidence run.
    //
    // But the script gap was never the only such class. A region the provider's office vocabulary does
    // not hold is refused by exactly the same kind of test (resolveRegions → uncoveredJurisdictionReason),
    // reaches the same dead end, and costs the same paid turn to discover. Screening it here closes the
    // class rather than the instance, which is what the A5 finding taught.
    //
    // The bound is unchanged and it is what keeps this honest: only refusals that are DETERMINISTIC and
    // CLIENT-SIDE may be screened. A transient provider error must still ride the repair ladder — a
    // screen that pre-empted those would turn a retryable failure into a permanent gap. And with no
    // capability contract in hand there is nothing to screen against, so the mint stays out of it and
    // the executor's own guard decides, exactly as before.
    //
    // Still deliberately NOT screened: the owner×term composition gap, which is minted `unsupported` on
    // purpose because there the gap itself is the finding and belongs on the coverage record.
    if (capabilities && regions.length) {
      const { deferred: uncovered } = resolveRegions(regions, capabilities);
      if (uncovered.length === regions.length) {
        issue(`every region on this proposal is outside the active register provider's office vocabulary `
          + `(${uncovered.map((d) => d.jurisdiction).join(", ")}), so the query cannot be expressed at all and would be `
          + `deferred unexecuted one dispatch from now. Propose it against a region the provider covers, or leave the `
          + `territory to the coverage ledger as a disclosed gap — re-proposing it unchanged would only re-derive this refusal.`);
        continue;
      }
      if (uncovered.length) {
        // A PARTIAL gap is not a refusal: the covered regions are a real query and the uncovered ones
        // are a coverage row. Narrow rather than reject — rejecting would lose the searchable half,
        // which is the same "one member takes the whole stack down" failure the OR-stack split above fixes.
        const covered = regions.filter((r) => !uncovered.some((d) => d.jurisdiction === String(r).toUpperCase()));
        narrowed.push({ index: i, kept: [...covered], dropped: uncovered.map((d) => d.jurisdiction),
          issue: `narrowed to ${JSON.stringify(covered)} — ${uncovered.map((d) => d.jurisdiction).join(", ")} `
            + `${uncovered.length > 1 ? "are" : "is"} outside the active register provider's office vocabulary and `
            + `${uncovered.length > 1 ? "stay" : "stays"} a disclosed coverage gap. The proposal still runs on what the provider covers.`,
          proposal: compactProposal(p) });
        regions.length = 0;
        for (const r of covered) regions.push(r);
      }
    }
    const anchor = terms ? terms[0] : term;
    // The fingerprint (⇒ the qid) deliberately EXCLUDES the romanization: the qid names the QUESTION
    // (which term, which predicate, which scope) and the romanisation is carriage, not a different
    // question. Including it would mint a DUPLICATE entry when the model re-proposes the same term
    // with the Latin form added — the exact wedge shape the regions inheritance above exists to kill.
    // Instead a re-proposal that adds a romanisation to a stored bare qid ENRICHES it (below), the
    // same field-level, never-term-changing merge extendRegisterPlan applies to the dictated plan.
    const fp = String(fingerprint({ predicate, term: term || null, terms: terms || null, nice_classes: nice, regions, ...(owner ? { owner } : {}) })).replace(/^fnv1a:/, "");
    const qid = `supp:${axis}:${predicate}:${slug(anchor)}:${fp.slice(0, 8)}`;
    if (existingQids.has(qid) || minted.some((e) => e.qid === qid)) {
      reused.push(qid);
      if (romanizedTerms && existingQids.has(qid)) enriched.push({ qid, term, romanizedTerms });
      continue;
    }
    if (budget <= 0) { issue(`per-axis cap ${axisMax} reached — assess whether an existing supplemental already covers this`); continue; }
    budget -= 1;
    const entry = {
      qid, axis, predicate,
      ...(terms ? { terms } : { term }),
      ...(romanizedTerms ? { romanizedTerms } : {}),
      ...(owner ? { owner } : {}),
      ...(term_literal ? { term_literal: true } : {}),
      nice_classes: nice, regions,
      expected_kind: "enumerate",
      origin: "supplemental",
      ...(typeof p.rationale === "string" && p.rationale.trim() ? { rationale: p.rationale.trim().slice(0, 200) } : {}),
    };
    // F1 — an owner×term slice on a provider that cannot intersect them is minted as an UNSUPPORTED
    // entry (→ the executor's deferred lane → a disclosed coverage row), exactly like a missing
    // predicate at compile time. Never rejected (the gap belongs on the record) and never silently
    // widened into an owner-less sweep.
    const ownerGap = ownerIntersectionGap(entry, capabilities);
    if (ownerGap) { entry.unsupported = true; entry.unsupported_reason = ownerGap; }
    minted.push(entry);
  }
  return { minted, reused, rejected, enriched, narrowed };
}

/**
 * Append mint-rejection rows to a supplemental-plan doc's `rejected[]` (append-only, beside
 * entries[] — one sidecar per axis holds BOTH what folded into the plan and what died at the seam,
 * so no proposal ever evaporates in a tool response again). Returns a NEW doc. PURE.
 */
export function withRejected(supp, rejected, { ts = null, origin = "propose-tool" } = {}) {
  if (!rejected?.length) return supp;
  const rows = rejected.map((r) => ({
    ts, origin, issue: String(r?.issue ?? "rejected").slice(0, 300),
    ...(r?.proposal ? { proposal: r.proposal } : {}),
  }));
  return { ...supp, rejected: [...(Array.isArray(supp?.rejected) ? supp.rejected : []), ...rows] };
}

// — NO CREDENTIAL PARAMETER. This took a credential first and threaded it, untouched, into the
// injected `executePlan` below. Every caller passed a secret into it: AUTH objects (euipo, free-tier,
// uspto-local), a raw API key (clarivate, signa), a session cookie (corsearch). Five discarded it in a
// `_auth` wrapper and corsearch did NOT — so one live cookie really did travel through this kernel, in
// a parameter whose name said session key, and a future `log(...)` here would have leaked it.
//
// DROPPED rather than renamed: a parameter named `auth` still accepts a credential from whoever wires
// the seventh provider. The executor is now bound at each server, where the secret already lives and
// never leaves. driver/test/no-credential-rides-the-supplemental-mint.test.mjs holds the line.
export async function proposeSupplemental(params, tctx, deps) {
  const { executePlan } = deps;
  const axis = String(params?.axis ?? "").trim();
  const outPath = String(params?.output_path ?? "");
  const proposals = Array.isArray(params?.proposals) ? params.proposals : null;
  if (!axis || !outPath || !proposals || !proposals.length)
    return { type: "text", text: "ERROR: axis, output_path and a non-empty proposals[] are all required." };

  const suppPath = join(dirname(outPath), `${axis}-supplemental-plan.json`);
  // ── the supplemental plan INHERITS the frozen plan's regions (review findings 4/12) ───────────────
  // `regions` is optional on a proposal, and on corsearch omitting it is a harmless worldwide sweep —
  // so omitting it is the model's natural habit and neither the tool schema nor the skill said
  // otherwise. On a provider whose regions[] is MANDATORY, every such proposal became a permanent
  // error:true / MISSING band block: the qid is persisted to this file, folded into the run plan at
  // fan-in, preserved by the executor's merge (no later call owns it), and a corrected re-proposal
  // mints a DIFFERENT qid because regions are part of the fingerprint — so one reasonable model call
  // wedged the whole axis into the honest-fail ladder, permanently.
  // The plan-level `regions` here is the matter's territorial scope, read from the run's own FROZEN
  // plan (siblings by construction: <run>/register-units/<axis>-band.json and
  // <run>/_driver/register-plan.json — the same relative resolution driver/verify.mjs uses). The
  // execute-plan kernel hands it to the provider's buildEntryQuery, which backfills only entries that
  // declare none (makeRegionRequiredBuildEntryQuery). A proposal that DOES declare regions is
  // untouched, qid fingerprints are unchanged, and providers that do not require regions ignore it.
  let planRegions = [], planClasses = [];
  try {
    const frozen = JSON.parse(readFileSync(driverDir(dirname(dirname(outPath)), "register-plan.json"), "utf8"));
    planRegions = (Array.isArray(frozen?.regions) ? frozen.regions : []).map((r) => String(r).trim()).filter(Boolean);
    // C3 — the frozen plan's own class list is the priority set: proposals intersecting it compete
    // for the per-call/per-axis caps first (mintSupplementalEntries stable-sorts; values unchanged).
    planClasses = (Array.isArray(frozen?.nice_classes) ? frozen.nice_classes : []).map((c) => String(c).trim()).filter(Boolean);
  } catch { /* no frozen plan (a bare-band test/legacy layout) — proposals then supply their own regions */ }

  let supp = { schema: "register-plan/1", plan_version: 1, derived_from: { job_key: `supplemental:${axis}`, variants_fingerprint: "supplemental" }, regions: planRegions, entries: [] };
  if (existsSync(suppPath)) {
    try {
      const prior = JSON.parse(readFileSync(suppPath, "utf8"));
      if (prior && Array.isArray(prior.entries)) supp = { ...prior, regions: (Array.isArray(prior.regions) && prior.regions.length) ? prior.regions : planRegions };
    } catch { /* a torn supplemental file is rebuilt — minted qids are deterministic, nothing is lost */ }
  }
  const perCall = 12;   // step 3 — was a knob; no environment ever set it
  const axisMax = 24;   // step 3 — was a knob; no environment ever set it
  const existingQids = new Set(supp.entries.map((e) => e.qid));
  const { minted, reused, rejected, enriched, narrowed } = mintSupplementalEntries(axis, proposals,
    { existingQids, perCall, axisMax, existingCount: supp.entries.length, capabilities: deps.capabilities ?? null, priorityClasses: planClasses });

  // Field-level romanisation enrichment of a REUSED qid (2026-07-30 review round): the natural retry —
  // a bare non-Latin proposal deferred at the wire, the model re-proposes it WITH the romanisation —
  // reuses the same deterministic qid, and without this the stored bare entry re-executed verbatim and
  // deferred again, permanently (the regions-wedge shape). Strictly additive and never term-changing:
  // only an entry that LACKS the field, for the exact same single term, gains it — then the re-execution
  // below reads the persisted file and the slice becomes answerable.
  let enrichedQids = [];
  const conflicts = [];
  for (const en of enriched ?? []) {
    const i = supp.entries.findIndex((x) => x?.qid === en.qid);
    if (i === -1) continue;
    const e = supp.entries[i];
    if (Array.isArray(e.romanizedTerms) && e.romanizedTerms.length) {
      // NEVER re-rolled (monotone) — but never SILENT either (post-merge audit 2 (b)): a re-proposal
      // carrying a DIFFERENT romanisation for this reused qid is the model correcting — or
      // contradicting — the stored Latin form, and swallowing it here left the wrong-form
      // substitution invisible for the rest of the run: the stored spelling keeps executing, the
      // response says only `reused`, and no surface records that the model now believes another
      // form. The stored form still wins (a tool response must not re-roll a frozen carriage), but
      // the disagreement surfaces in the response (`conflict[]`) AND persists in the sidecar
      // (conflicts[], append-only beside rejected[]) so judgment can weigh the substitution.
      if (JSON.stringify(en.romanizedTerms) !== JSON.stringify(e.romanizedTerms))
        conflicts.push({ qid: en.qid, stored: e.romanizedTerms, proposed: en.romanizedTerms });
      continue;
    }
    if (e.term !== en.term || Array.isArray(e.terms) || e.predicate === "owner") continue;
    supp = { ...supp, entries: supp.entries.map((x, j) => (j === i ? { ...x, romanizedTerms: en.romanizedTerms } : x)) };
    enrichedQids.push(en.qid);
  }

  // Persist when there is something new to persist OR when the file on disk predates the regions
  // inheritance above — the executor reads suppPath FROM DISK, so an in-memory-only backfill would
  // leave a reused-qid re-execution running region-less again.
  const staleOnDisk = existsSync(suppPath) && planRegions.length && !(() => {
    try { const d = JSON.parse(readFileSync(suppPath, "utf8")); return Array.isArray(d?.regions) && d.regions.length; }
    catch { return false; }
  })();
  // PR-6 (C1 — persist what evaporates): rejections used to live ONLY in this tool's response text.
  // They are questions the run asked itself that never ran — the ask ledger needs the record, so the
  // sidecar carries an append-only rejected[] beside entries[] (foldSupplementalProposals reads only
  // entries[]; the fold/executor path is untouched).
  if (minted.length || rejected.length || staleOnDisk || enrichedQids.length || conflicts.length) {
    const ts = new Date().toISOString();
    supp = withRejected({ ...supp, plan_version: (supp.plan_version ?? 1) + (minted.length || enrichedQids.length ? 1 : 0), entries: [...supp.entries, ...minted] },
      rejected, { ts, origin: "propose-tool" });
    // Romanisation-conflict notes (audit 2 (b)) are append-only beside rejected[], same doctrine: a
    // question the run asked itself (which Latin form IS this term?) must never live only in one tool
    // response. entries[] is untouched — the fold/executor path reads only entries[].
    if (conflicts.length)
      supp = { ...supp, conflicts: [...(Array.isArray(supp.conflicts) ? supp.conflicts : []),
        ...conflicts.map((c) => ({ ts, origin: "propose-tool", ...c }))] };
    mkdirSync(dirname(suppPath), { recursive: true });
    writeFileSync(`${suppPath}.tmp`, JSON.stringify(supp, null, 2) + "\n");
    renameSync(`${suppPath}.tmp`, suppPath);
  }

  const qids = [...minted.map((e) => e.qid), ...reused];
  let summary = null;
  if (qids.length) {
    const r = await executePlan({ plan_path: suppPath, axis, output_path: outPath, qids }, tctx);
    const text = r && typeof r === "object" ? (r.text ?? "") : String(r ?? "");
    if (!text || text.startsWith("ERROR")) {
      return { type: "text", text: JSON.stringify({ minted: minted.map((e) => e.qid), reused, ...(enrichedQids.length ? { enriched: enrichedQids } : {}), ...(conflicts.length ? { conflict: conflicts } : {}), rejected, ...(narrowed.length ? { narrowed } : {}), executed: false, error: text.slice(0, 300) || "executor returned nothing" }, null, 2) };
    }
    try { summary = JSON.parse(text); } catch { summary = { raw: text.slice(0, 300) }; }
  }

  // read the results BACK FROM THE BAND — the reasoning payload is never model-transcribed
  const results = {};
  try {
    const band = JSON.parse(readFileSync(outPath, "utf8"));
    const blocks = Array.isArray(band) ? band : [];
    for (const b of blocks) {
      if (!b || typeof b !== "object" || !b.qid || !qids.includes(b.qid)) continue;
      results[b.qid] = {
        state: b.state ?? null,
        total_hits: b.total_hits ?? null,
        count: b.count ?? (Array.isArray(b.records) ? b.records.length : null),
        ...(b.term_counts ? { term_counts: b.term_counts } : {}),
        ...(b.class_counts ? { class_counts: b.class_counts } : {}),
        ...(b.reason ? { reason: String(b.reason).slice(0, 300) } : {}),
        ...(b.error ? { error: true } : {}),
        records_preview: preview(b.records),
      };
    }
  } catch { /* band unreadable — the executor summary still crosses */ }

  return { type: "text", text: JSON.stringify({ minted: minted.map((e) => e.qid), reused, ...(enrichedQids.length ? { enriched: enrichedQids } : {}), ...(conflicts.length ? { conflict: conflicts } : {}), rejected, ...(narrowed.length ? { narrowed } : {}), executed: qids.length > 0, summary, results }, null, 2) };
}
