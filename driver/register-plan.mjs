// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-plan.mjs — the deterministic register-search plan: "the model reasons once, code
// compiles and freezes" ( WS2, THE F2 fix).
//
// Register recall was non-reproducible (fact-set Jaccard 0.04 across re-runs of the same matter)
// because every run RE-IMPROVISED its queries from prose. This module compiles the structured
// variant manifest (variant-manifest-model.mjs) + code-authoritative job fields + the machine FORM
// band (form-neighbourhood.json) into a versioned, qid-keyed `register-plan.json`:
//
//   { schema_version, plan_version, derived_from: { job_key, variants_fingerprint, skill_version },
//     nice_classes, regions, entries: [ { qid, axis, predicate, term|terms, nice_classes, regions,
//     expected_kind: "enumerate"|"count", when? } ] }
//
// Properties the contract guarantees:
//   - DETERMINISTIC: same manifest + job + form band ⇒ byte-identical plan (stable ordering, no
//     Date/random). Re-running a matter re-USES the frozen plan (attach step, pipeline) — recall
//     becomes reproducible by construction.
//   - APPEND-ONLY EXTENSION: new variants extend the plan (new qids appended, plan_version+1);
//     existing entries are NEVER re-rolled — recall is monotone across plan versions.
//     *** NO LONGER USED ACROSS RUNS (2026-07-19). *** The pipeline stopped consulting the per-slug
//     store: append-only across runs made every defect that ever reached a plan immortal for that
//     matter, which is how the Drivers Haven re-run dispatched a fixed-and-redeployed form band's
//     stale diacritic stack and failed identically. `resolvePlanAgainstStore`/`extendRegisterPlan`
//     remain here, exported and unit-tested, as the monotone-recall primitive — but nothing calls
//     them with a non-null store today, and re-introducing one must be explicit and diffed, never a
//     silent default. Determinism is unaffected: it comes from this compiler being PURE (same
//     manifest + job + form band ⇒ byte-identical plan), not from reusing a stored artifact.
//   - CLASS-SCOPED ALWAYS: every entry carries nice_classes (the NOVA PULSE/VELTRIPHEN all-class-flood
//     lesson is structural here, not prose). The only cross-class entry is the exact-identical
//     merch check (Nice 25), per the recipes' single sanctioned exception.
//   - CROWD-GATED FAN-OUT: fringe slices (the wildcard/phonetic family of the dominant
//     token) carry `when: { runs_if_enumerated: <parent qid> }` — they run ONLY if the parent
//     contains-slice proved tractable. A crowd parent is TERMINAL for its children, encoded, not
//     remembered.
//   - JUDGMENT EXTRAS ARE BAND BLOCKS, NOT PLAN ENTRIES: skeptic/frame-reopen/escalation-driven
//     additions land as qid-less blocks in the band (the executor's merge preserves them); the
//     compiled plan is never hand-edited.
//
// Execution: Phase A — the register-unit message dictates each axis's qid list and the band blocks
// carry `qid` (named-band.mjs tolerates the extra key). Phase B — register_execute_plan runs the
// dictated entries and writes the band itself. Fan-in: joinPlanToBands() identity-joins qids to
// band blocks; a missing qid is a StageFailure upstream. deriveCoverageSkeleton() +
// findUnexecutedCleanClaims() make a `confirmed-clean` claim over an unexecuted slice IMPOSSIBLE
// (token `coverage_clean_unexecuted:<axis>` — kills F3).
//
// PURE (no node imports) → tests offline. Mirrors named-band.mjs / coverage-ledger.mjs.

import { REGISTER_AXES } from "./coverage-ledger.mjs";
import { canonicalJurisdictionCode, isKnownJurisdictionCode } from "./jurisdiction-codes.mjs";   // item 13 — a searched territory traces to an executed query
import { normalizeTerritory } from "../providers/_shared/territory-codes.mjs";
import { bindingLayersFor, layerCoverageFor } from "./binding-layers.mjs";
import { entryTermIssues, hasAnchoredWildcard, termAnnotationIssue, termMarkupIssue, termShapeIssue, termSubstanceIssue } from "../providers/_shared/term-shape.mjs";
import { formKey, romanizationSpellings, isNonLatinTerm } from "../providers/_shared/script-form.mjs";

export const PLAN_SCHEMA_VERSION = 1;
export const EXPECTED_KINDS = ["enumerate", "count"];
// Repair-first D (plan-side guard): the widest OR-stack (`terms`) a single dictated entry may carry —
// MIRRORS the executor's chunk bound (providers/corsearch ENUMERATE_NAMES_CHUNK_DEFAULT; the
// agreement test pins them together). The Open Country 414 was ONE ~565-name form band dictated
// as a single entry: the planner must never order what the tool would have to chunk-rescue.
export const PLAN_MAX_OR_WIDTH = 80;
// Per-name length budget for feasibility (a pathological variant must fail the plan loudly at compile,
// never the provider mid-run). Generous: real marks/variants are far shorter.
export const PLAN_MAX_NAME_LENGTH = 120;
// The predicate vocabulary mirrors the provider's match modes (corsearch core.js MATCH_MODE_PREFIX):
// "default" = contains-style provider default; "wildcard" = a `name:"<x> *"`-shaped pattern.
// "owner" (copper-lattice recovery net #3): term = an OWNER name, executed as an owner-field sweep —
// the common-law→register cross-check dictates these (a verified-use owner's register filings in the
// target classes), mapped in the executor's planPredicateParams to {owner: term}.
export const PLAN_PREDICATES = ["exact", "default", "wildcard", "phonetic", "owner"];
// — WHO PUT THIS TERM IN THE PLAN. `floor` = a deterministic generator did (form-neighbourhood.mjs;
// no model turn can shrink or reorder it); `model` = the variant manifest proposed it; `mark` = it is the
// ratified mark or its dominant element, i.e. run input. Until now the only marking was a `+form` suffix
// inside a qid string, and the wildcard fringe carried none at all — so nothing downstream could tell a
// generated term from an imagined one without re-deriving the band. OPTIONAL on the entry: a frozen
// pre- plan carries none and resumes byte-identical, and replay verdicts over archived runs never flip.
/**
 * THE ROMANISATION THE PLAN ALREADY HOLDS FOR A TERM — (cause 2).
 *
 * The compiler stamps `romanizedTerms` on every single-term entry it mints, from the manifest's own
 * romanisation of that value (`romanStamp`). Lanes that mint entries LATER — the cross-check lane in
 * pipeline.mjs — never enter that funnel, so an identical non-Latin term arrived with no romanisation
 * and was refused by the capability gap: the active register indexes non-Latin filings by
 * transliteration, so bare characters would return a silent zero and the refusal is correct.
 *
 * What was wrong is that the refusal was avoidable. The SAME PLAN already carried the romanisation for
 * that identical term, on the entries that answered it — one delivered report told a client a
 * jurisdiction had not been searched in its own script while the plan held both the query and its
 * romanisation.
 *
 * Derived from the plan rather than re-derived from the manifest deliberately: the plan is what the
 * late lane has, one source stays one source, and a term the plan never romanised still gets nothing
 * rather than a guess. Matching is by `formKey`, the same key `romanStamp` uses — never raw text, or a
 * fullwidth/halfwidth pair reads as two different terms.
 */
export function romanizedTermsFromPlan(plan, term) {
  const key = formKey(String(term ?? ""));
  if (!key) return null;
  for (const e of plan?.entries ?? []) {
    if (Array.isArray(e?.terms)) continue;             // an OR-stack never carries the field — see romanStamp
    if (!Array.isArray(e?.romanizedTerms) || !e.romanizedTerms.length) continue;
    if (formKey(String(e.term ?? "")) === key) return [...e.romanizedTerms];
  }
  return null;
}

export const PLAN_PROVENANCE = ["floor", "model", "mark"];

// ── PROVIDER CAPABILITIES AT COMPILE TIME (phase 3) ──────────────────────────────────────────────
//
// The frozen plan must be executable BY CONSTRUCTION by whichever provider is active. Three knobs,
// all fed from providers/<id>/src/capabilities.js (resolved by driver/register-capabilities.mjs — this
// module stays PURE and never imports a vendor):
//
//   1. OR-WIDTH  — PLAN_MAX_OR_WIDTH is the corsearch-shaped DEFAULT; the effective width is
//      capabilities.maxOrWidth (clarivate 500 JSON-nesting, signa 1 — no OR surface at all).
//   2. PREDICATES — a predicate with NO mapping on the active provider does NOT compile into a wrong
//      query. The entry is emitted with `unsupported:true` + a plain-English `unsupported_reason`, and
//      the executor turns that into an error:true block (→ joins MISSING) instead of a silently weaker
//      search. Doctrine rule 2: a missing capability FAILS LOUDLY and becomes a deferred coverage row.
//   3. OFFICES — jurisdictions are TRANSLATED into the provider's vocabulary first (EU→EM on clarivate,
//      US→uspto on signa) and only THEN membership-checked against capabilities.offices.covered
//      (null = no declared restriction). Order matters: checking the raw ISO code against a vocabulary
//      that spells the EUIPO "EM" would defer every EU matter.
//
// The reason strings are EXPORTED CONSTANTS because driver/coverage-ledger.mjs's TOOL_ABSENCE_RE keys
// on their phrasing to relabel a `coverage-limited` row → `deferred` (a closeable gap that escalates and
// is disclosed, not an accepted saturation limit). Change a phrase here and the relabel test breaks —
// that is the point.
export const unsupportedPredicateReason = (predicate, providerId) =>
  `predicate "${predicate}" is not supported by the active register provider (${providerId}) — that capability is absent, `
  + `so this slice was never searched. It is a deferred gap for judgment, never a clean negative.`;

export const uncoveredJurisdictionReason = (jurisdictions, providerId) =>
  `jurisdiction ${[...jurisdictions].join(", ")} is not covered by the active register provider (${providerId}) — `
  + `the office is outside the provider's coverage, so this slice was never searched. It is a deferred gap for `
  + `judgment, never a clean negative.`;

// ──: an office the provider COVERS but this deployment cannot reach ─────────────────────────────
//
// A DIFFERENT fact from the one above, and the difference is the whole reason this builder exists.
// `uncoveredJurisdictionReason` says the register never reaches that office on any box. This one says
// the register reaches it, and THIS INSTALL is not configured to — the free tier covers EU+US, and a
// deployment with no USPTO_LOCAL_DB reaches only the EU half. Telling a lawyer "the US is outside this
// provider's coverage" when the fix is one environment variable is a false statement about the product.
//
// It deliberately REUSES the "is not covered by the active register provider" phrasing, because two
// regexes key on it and both must fire:
//   · coverage-ledger TOOL_ABSENCE_RE   → relabels the row `coverage-limited` → `deferred` (disclosed,
//     escalatable), rather than an accepted saturation limit.
//   · coverage-ledger CAPABILITY_GAP_REASON_RE → HELD, never closed by the clock. That is the right
//     bucket: re-running the same entry on the same box meets the same absent index and spends a paid
//     unit to re-derive a deterministic no. What closes this row is an operator setting the variable,
//     not time — which is exactly what "held" means there.
// Neither regex needed widening, and the tests that pin their phrasing keep pinning it.
//
// What the tail adds is the part a reader can ACT on: which member is missing, which variable is unset,
// and that configuring it closes the gap.
export const officeUnavailableReason = (jurisdictions, providerId, { memberId, missing = [] } = {}) =>
  `jurisdiction ${[...jurisdictions].join(", ")} is not covered by the active register provider (${providerId}) `
  + `AS THIS DEPLOYMENT IS CONFIGURED — the source that serves it (${memberId ?? "unknown"}) is not wired up here`
  + `${missing.length ? ` (${missing.join(" + ")} unset)` : ""}, so this slice was never searched. The provider `
  + `does cover this office: set the variable and re-run to close it. It is a deferred gap for judgment, `
  + `never a clean negative.`;

// F1 (owner-as-scope-field): an entry carrying BOTH mark term(s) and an `owner` scope field asks for
// the owner×term INTERSECTION in one call. Both corsearch (space-joined clauses = AND) and clarivate
// (AND-ed searchFields) express it natively, and signa does too as of (`filters.owner_name`
// composes with the query in one request). A provider that declares `ownerTermIntersection` false or
// absent gets the same deferred-row treatment as a missing predicate — the slice is disclosed, never
// silently widened into an owner-less sweep. No shipped provider declares false today; the lane is
// what a new one lands in, and the reason below is the sentence it lands with.
export const ownerIntersectionUnsupportedReason = (providerId) =>
  `owner×term intersection is not supported by the active register provider (${providerId}) — the owner scope `
  + `field cannot be combined with mark text there, so this slice was never searched. It is a deferred gap for `
  + `judgment, never a clean negative.`;

/** Is an owner×term entry executable on the provider? null when it is (or when no contract/owner). */
export function ownerIntersectionGap(entry, capabilities) {
  if (!capabilities) return null;
  const owner = typeof entry?.owner === "string" ? entry.owner.trim() : "";
  if (!owner) return null;
  const hasMarkTerms = String(entry?.predicate ?? "default") !== "owner"
    && ((Array.isArray(entry?.terms) && entry.terms.length > 0) || (typeof entry?.term === "string" && entry.term.trim() !== ""));
  if (!hasMarkTerms) return null;
  if (capabilities.ownerTermIntersection === true) return null;
  return ownerIntersectionUnsupportedReason(capabilities.id ?? "unknown");
}

/**
 * 2026-07-29 hardening — is a VARIANTS-MODEL value un-searchable as a mark term? Returns the
 * plain-English reason, or null. Two classes shipped as silent nil "cleans" on the 2026-07-28 run
 * family (BUILD-NOTES, PR-1 review round):
 *   - a SPACE-FLANKED infix star ("PLAY * WAY" — the slogan archetype's family probe): a standalone
 *     `*` token is wildcard INTENT the plan language cannot express (only ANCHORED stars map to the
 *     provider wildcard modes; corsearch has no native infix mode at all), so under a literal
 *     predicate the star dispatches as a CHARACTER — enumerates ~0 and reads as a searched slice.
 *     A mark's own star is tight (E*TRADE) and never fires this; anchored stars are the wildcard
 *     lane's business, not this check's.
 *   - a PROSE/LABEL shape (>4 words, or label punctuation — parenthetical, em-dash/semicolon, a
 *     space-flanked slash): a directive label dispatched verbatim is the same nil search. Never
 *     fires on ≤2 words, so no genuine short mark is collateral.
 * The drop is LOUD, never silent and never a run-killer: the compiler stamps the entry
 * `unsupported` (see compileRegisterPlan), so the executor refuses it deterministically, the
 * fan-in join routes it to the `deferred` bucket, and the coverage skeleton discloses the gap to
 * judgment — a disclosed row instead of a dead run OR a false clean.
 */
export function variantTermIssue(value) {
  const t = String(value ?? "").trim();
  if (!t) return null;                        // emptiness is the existing feasibility rule's business
  // — markup FIRST, and above the ≤2-word floor below. A one-word `**BIOVELTRIN**` is prose by
  // no measure the word count can see, and without this arm it compiles as a BARE entry: the freeze
  // lint (which does see markup now) calls it unexecutable and a fresh mint throws. Both detectors
  // move together or the fix trades a silent false clean for a dead run at plan mint.
  const markup = termMarkupIssue(t);
  if (markup) return markup;
  if (/\s\*\s/.test(t))
    return `infix-star pattern "${t.slice(0, 60)}" — a space-flanked \`*\` is wildcard intent the plan language cannot express, and a literal dispatch is a nil search that reads as a clean`;
  const words = t.split(/\s+/).filter(Boolean);
  // — THE MESSAGE NAMES A ROUTE FOR BOTH READINGS, because the old one had a dead end in it.
  // "author the mark-shaped term(s) it stands for" is the right instruction for a LABEL, and no
  // instruction at all for a value that genuinely IS a mark carrying a bracketed element. That case has
  // an escape and it is one lane over: this refusal becomes `unsupported: true` → a disclosed deferred
  // coverage row, which judgment reads and may re-propose through register_propose_supplemental with
  // `term_literal: true`.
  //
  // The escape deliberately does NOT live on the variant manifest. `term_literal` is stamped here only
  // by `literalStamp`, and only for manifest-provenance values — "manifest provenance is the
  // term_literal authority: the manifest is the matter's RATIFIED mark". A variant is model-authored,
  // so letting it carry the flag would let the earliest and cheapest stage self-certify a bypass of the
  // very lint that catches its own mistakes, which is what the flag's own description forbids: "Never
  // use it to push a label through."
  const label = (why) => `label/prose-shaped value "${t.slice(0, 60)}" (${why}) — dispatching it verbatim as a mark term is a nil search that reads as a clean. If it is a LABEL, author the mark-shaped term(s) it stands for. If it genuinely IS a mark carrying that punctuation, it is not the variants stage's to certify: this becomes a disclosed deferred row, and judgment re-proposes it via register_propose_supplemental with term_literal:true`;
  // LENGTH first, so every value this function already refused keeps the reason it already gave.
  if (words.length > 4) return label(`${words.length} words`);
  // — THE ANNOTATION ARM SITS ABOVE THE ≤2-WORD FLOOR, exactly as put the markup arm
  // above it. `ORVELLA (root)` and `FOO (bar)` are two words, so the floor returned null before this
  // line was ever reached: the term compiled bare, dispatched verbatim, and returned a confident zero
  // over marks that may exist. Worse, the disclosure rides on THIS verdict — a null here means no
  // deferred row either, so the nil search shipped as a clean with nothing saying otherwise.
  //
  // The floor is still doing real work and stays: `DOLPHIN DEVICE` is two words and a perfectly good
  // term, and refusing ordinary two-word marks is the failure this arm must not cause. What separates
  // them is not length, it is the ANNOTATION — and an annotation always has a remedy (delete the
  // note, keep the term), which is why hoisting THIS arm is safe where hoisting the length arm above
  // would not be. Measured before landing: of 4,280 variant terms across 589 archived manifests, 0
  // are newly refused by this line; 30 already-annotated terms above the floor prove the predicate
  // fires, so the zero is a result rather than a blind instrument.
  const annotation = termAnnotationIssue(t);
  if (annotation) return label(annotation);
  return null;
}

/** The effective OR-stack width for a provider (falls back to the corsearch-shaped default). */
export const planMaxOrWidth = (capabilities) =>
  Number.isFinite(capabilities?.maxOrWidth) && capabilities.maxOrWidth >= 1
    ? Math.floor(capabilities.maxOrWidth) : PLAN_MAX_OR_WIDTH;

// The plan emits ONE `wildcard` predicate; the provider contract splits it into three sub-capabilities.
// Mirrors the executor's planPredicateParams anchoring exactly (trailing * → prefix/starts-with,
// leading * → suffix/ends-with, both/neither → infix over the raw pattern).
export function wildcardCapabilityKey(term) {
  const t = String(term ?? "");
  if (t.endsWith("*") && !t.startsWith("*")) return "wildcardPrefix";
  if (t.startsWith("*") && !t.endsWith("*")) return "wildcardSuffix";
  return "wildcardInfix";
}

export const predicateCapabilityKey = (predicate, term) =>
  predicate === "wildcard" ? wildcardCapabilityKey(term) : predicate;

/**
 * Is this plan predicate executable on the provider? Returns null when it is, or the plain-English
 * reason when it is not. `capabilities === null` ⇒ no contract supplied ⇒ never marks anything
 * unsupported (the pre-phase-3 behaviour, byte-identical).
 */
export function predicateGap(predicate, term, capabilities) {
  if (!capabilities?.predicates) return null;
  const key = predicateCapabilityKey(predicate, term);
  const mode = capabilities.predicates[key];
  if (typeof mode === "string" && mode) return null;
  return unsupportedPredicateReason(predicate === "wildcard" ? `wildcard (${key})` : predicate, capabilities.id ?? "unknown");
}

/**
 * Translate the matter's jurisdictions into the provider's office vocabulary and split off the ones the
 * provider genuinely does not cover. TRANSLATE FIRST, THEN membership-check.
 * Returns { regions: [translated…], deferred: [{ jurisdiction, reason }] }.
 * With no capabilities the input passes through untouched.
 */
export function resolveRegions(jurisdictions, capabilities) {
  const raw = (jurisdictions ?? []).map((r) => String(r).trim()).filter(Boolean);
  const offices = capabilities?.offices;
  const covered = Array.isArray(offices?.covered) ? new Set(offices.covered) : null;
  const regions = [];
  const deferred = [];
  const resolvedTerritories = [];
  let worldwide = false;
  for (const j of raw) {
    // Display names → ISO codes FIRST (copper-bastion incident: the portal composer submits
    // "United States"/"European Union" and corsearch's ISO-passthrough translate sent them to the
    // wire verbatim — Corsearch 500s on them, and recovery burned its park budget on a query that
    // could never succeed). The wire vocabulary is codes; an unrecognized name becomes a deferred
    // gap (disclosed, escalatable) — the reason phrasing is shared with true coverage gaps because
    // coverage-ledger's TOOL_ABSENCE_RE keys on it to relabel the row `deferred`.
    const code = normalizeTerritory(j);
    if (code === "") { worldwide = true; continue; }   // Worldwide: no region restriction, not a gap
    if (code === null) {
      deferred.push({ jurisdiction: String(j).toUpperCase(), reason: uncoveredJurisdictionReason([String(j).toUpperCase()], capabilities?.id ?? "unknown") });
      continue;
    }
    const t = typeof offices?.translate === "function" ? offices.translate(code) : code;
    if (!t || (covered && !covered.has(t))) {
      deferred.push({ jurisdiction: String(j).toUpperCase(), reason: uncoveredJurisdictionReason([String(j).toUpperCase()], capabilities?.id ?? "unknown") });
      continue;
    }
    if (!regions.includes(t)) regions.push(t);
    resolvedTerritories.push(code);
  }

  // ── A TERRITORY IS A STACK OF REGISTERS, AND THE PLAN MUST REACH ALL OF THEM ─────────────
  //
  // The loop above is one-to-one: France resolves to the French national register and stops. But an EU
  // trade mark blocks use in France without appearing in the French register, and so does a Madrid
  // registration designating France or the EU. Both were searched only if the client happened to list
  // the EU separately — and the report presented the territory as covered either way, which is what
  // made this a compliance defect rather than a coverage one.
  //
  // `bindingLayersFor` already holds which registers bind a territory (a fact about the territory), and
  // `layerCoverageFor` already holds what a provider's office code returns (a fact about the provider).
  // This pass is the join: for each ordered territory, add the register for any binding layer the plan
  // does not already reach. Nothing new is declared — the two facts were both in the tree, and only the
  // COVERAGE FORM consulted them. The plan itself never did, so it never searched the layers it then
  // disclosed as unsearched.
  //
  // WHY IT SUBTRACTS NOTHING. A provider whose office already returns a layer adds no second register:
  // signa's `territory_match: "protection"` makes one France query return the EU and Madrid rights that
  // protect France, its contract says so, and this pass reads that and stays out of the way. Clarivate
  // takes registrationOfficeCodes as an ARRAY, so FR+EM+WO is ONE request, not three — and its own
  // `limitWOresultsToDesignated` then scopes the Madrid leg to designations of the ordered territories.
  //
  // TWO DELIBERATE RESTRAINTS, both of which keep a loud failure loud:
  //
  //   · DEFERRED TERRITORIES ARE SKIPPED. A jurisdiction the provider does not cover contributes no
  //     layers. Otherwise an order for a territory outside the provider's reach would quietly acquire a
  //     non-empty region list, and `compileRegisterPlan`'s allJurisdictionsDeferred — which exists to
  //     fail loudly when every named territory was unreachable — would stop firing. Widening a
  //     deferred territory to its regional register may well be right; it is a doctrine question, and
  //     this is not the change that answers it.
  //   · NO CONTRACT ⇒ NO PASS. With `capabilities === null` the caller has declared nothing, and the
  //     documented behaviour of this function is that the input passes through untouched. A layer model
  //     driven by contracts must do nothing when there is no contract to drive it.
  if (capabilities) {
    for (const territory of resolvedTerritories) {
      for (const b of bindingLayersFor(territory)) {
        const t = typeof offices?.translate === "function" ? offices.translate(b.office) : b.office;
        // Out of the provider's reach: leave it to the coverage form, which discloses the unsearched
        // layer per territory. Silently dropping it here is what this pass exists to stop.
        if (!t || (covered && !covered.has(t))) continue;
        // ── "REACHED" IS ASKED EXACTLY AS coverage-form ASKS IT ────────────────────────────────────
        // The national layer belongs to ONE office — this territory's own — so it is matched by office
        // and not by "some office returns a national layer". Everything else is any-office: an EUIPO
        // search reaches the EU regional layer for every member state at once.
        //
        // The two must agree or the plan and the disclosure describe different searches. They already
        // diverged once here: for the Netherlands the national register is BENELUX, and an any-office
        // test saw `NL` returning a national layer, skipped the expansion, and left the form correctly
        // reporting that BX had not been searched — a limitation on a plan that believed it was
        // complete. `unestablished` never counts as reached, in either place, for the same reason.
        const reached = b.layer === "national"
          ? regions.includes(t) && layerCoverageFor(capabilities, t, "national") === "returns"
          : regions.some((o) => layerCoverageFor(capabilities, o, b.layer) === "returns");
        if (reached) continue;
        if (!regions.includes(t)) regions.push(t);
      }
    }
  }

  // ── UNRESTRICTED SCOPE: "every office", said in the provider's own vocabulary ────────────────────
  // An unrestricted matter is either an express Worldwide instruction, or no territories at all
  // (enqueue-schema DELETES jurisdictions when Worldwide is the only entry — "Worldwide is the
  // DEFAULT, never a list entry" — so the live shape is `null`, and `worldwide` above never even
  // gets set). Both mean the same thing and must resolve the same way.
  //
  // On corsearch that thing is an EMPTY region filter: an absent region clause sweeps the vendor's
  // whole database. The driver used to treat that as the meaning of worldwide for EVERY provider —
  // but it is corsearch's SHORTHAND, not a universal. Clarivate requires registrationOfficeCodes on
  // every request path (swagger: SearchRequest.required, "One or more registration office codes"),
  // so the empty list reached buildSearchRequest and threw `regions[] is required` on every single
  // register call. And because the clearance lane has no equivalent of countPreflight, the run
  // admitted, spent its whole budget, and relabelled each failure a `deferred` coverage row — a
  // report with an empty register layer wearing the costume of disclosed coverage.
  //
  // A worldwide search IS available there: the RegistrationOfficeCode enum is the vendor's entire
  // coverage, the spec sets no maxItems, and /count is documented as returning counts PER REGISTER
  // (multi-office in one call probe-verified 2026-07-21). So worldwide = every office it covers.
  //
  // The guard is `deferred.length === 0`, deliberately. regions empty WITH deferrals is the opposite
  // case — every named territory fell outside the provider's coverage — and compileRegisterPlan's
  // allJurisdictionsDeferred must keep failing it loudly. Sweeping the world because the requested
  // countries were unreachable would be the exact inversion of what was asked.
  const unrestricted = regions.length === 0 && deferred.length === 0;
  if (unrestricted && capabilities?.regionsRequired && Array.isArray(offices?.covered))
    return { regions: [...offices.covered], deferred, worldwide: true };
  if (worldwide) return { regions: [], deferred, worldwide: true };
  return { regions, deferred, ...(unrestricted ? { worldwide: true } : {}) };
}

const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

// ── deterministic identity ───────────────────────────────────────────────────────────────────────

// FNV-1a over a stable serialization — a dependency-free content fingerprint (identity, not crypto).
export function fingerprint(value) {
  const s = stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16).padStart(8, "0")}:${s.length}`;
}

// key-sorted JSON so object-key insertion order can never change the fingerprint
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

export function variantsFingerprint(manifest) {
  return fingerprint({
    mark: manifest.mark,
    dominant: manifest.dominant_element,
    elements: manifest.elements.map((e) => [e.value, e.kind]),
    variants: manifest.variants.map((v) => [v.value, v.category]),
    incumbent: manifest.incumbent_classes,
    // Only when SEEDED, so every owner-less manifest keeps its historical fingerprint byte-identical
    // (nothing compares fingerprints across code versions today, but the cheap invariant costs nothing).
    ...(manifest.watchlist_owners?.length ? { watchlist_owners: manifest.watchlist_owners } : {}),
    // Same rule for the romanisations: a manifest that carries none fingerprints exactly as it always
    // did, and one that gains them is a DIFFERENT manifest, so a stored plan minted before the
    // romanisations existed is never REUSED byte-identical for a manifest that now carries them.
    // The moved fingerprint alone is NOT the fix (2026-07-30 review, proven): it only routes the
    // store decision to extendRegisterPlan, which appends BY QID — and the romanisation changes no
    // qid, so the stored bare entries rode through verbatim and the matter kept its un-executable
    // form for life. The extension's field-level romanisation merge (extendRegisterPlan below) is
    // what actually carries the value onto the stored entries; this fingerprint's job is only to
    // make sure that path RUNS instead of the byte-identical reuse.
    ...(manifest.variants.some((v) => v.romanization)
      ? { romanizations: manifest.variants.map((v) => v.romanization ?? "") } : {}),
  });
}

const latinFold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const slug = (s) => latinFold(s) || "q";

// ── — AN IDENTITY, NOT AN ORDINAL ─────────────────────────────────────────────────
//
// `slug` folds to [a-z0-9] and falls back to the literal "q" when nothing survives. Every non-Latin
// term therefore produced the SAME slug, and the mint below disambiguated POSITIONALLY:
//
//     Чертополох          -> mark-exact:exact:q
//     Расторопша          -> mark-exact:exact:q#2
//     Молочный чертополох -> mark-exact:exact:q#3
//     Silybum             -> mark-exact:exact:silybum      ← a Latin term keeps a self-describing id
//
// So a non-Latin term's identity carried nothing about WHICH TERM IT IS. It was its position in the
// compile order — and the counter is per-plan, not per-script, so adding a Devanagari term renumbers
// the Cyrillic ones. Fourth site of a Latin normaliser standing where an identity should be, after
// 's fold key, 's script-exact arm and 's term-substance check.
//
// ── WHAT IT COSTS, MEASURED ON THE SHIPPED extendRegisterPlan RATHER THAN REASONED ────────────
//
// The issue recorded this as latent: "whether any live path actually re-derives qids in a different
// order" was the step nobody had taken. `extendRegisterPlan` is that path — it meets a FROZEN plan
// with a FRESHLY COMPILED one whenever new variants arrive, and matches by exact qid string. Driven
// with two Cyrillic terms frozen and a third arriving FIRST in the fresh compile order:
//
//     added: ["mark-exact:exact:q#3"]
//     after extend:  q -> Чертополох | q#2 -> Расторопша | q#3 -> Расторопша
//     the NEW term "Молочный чертополох" searched?  false
//
// The arriving term is never searched and an existing one is DUPLICATED — billed twice, and recall is
// not monotone after all. The identical shape in Latin adds the new term correctly. Nothing exotic
// shook the ordinals: a term entered ahead of the others, which is how a manifest grows.
//
// ── THE FIX IS THE SUPPLEMENTAL PATH'S OWN, so the plan stops carrying two identity schemes ────
//
// `supplemental.mjs` already mints `supp:<axis>:<predicate>:<slug>:<fp8>` off `fingerprint`. Reusing
// it here leaves ONE scheme rather than a hash-only half and an ordinal half — the second of the three
// edges the issue's live-run comment recorded. Latin terms are BYTE-UNCHANGED: the fold is non-empty,
// so the fallback never fires and no existing Latin qid moves.
//
// `q-` keeps the old sentinel visible at the front so a reader who greps the family still finds it,
// and a mark actually named "q" folds to a non-empty "q" and keeps the bare form — the two cannot
// collide.
// EXPORTED because the mid-run mint sites need the same identity the compiler uses. The cross-check
// lane minted with `kebab()` — the display slug — which NFKD-decomposes and turns every combining mark
// into a hyphen, so distinct non-Latin marks collapsed to one qid and the fold downstream deduped the
// survivors away in silence. One identity scheme, one place.
export const termIdentity = (s) => {
  const folded = latinFold(s);
  if (folded) return folded;
  return `q-${String(fingerprint(String(s ?? ""))).replace(/^fnv1a:/, "").slice(0, 8)}`;
};

/**
 * Mint a qid for a MID-RUN entry: `<prefix>-<identity>`, unique within the batch being minted.
 *
 * ONE helper for both late lanes, because they had the same defect independently and a rule kept in two
 * places is kept in one of them. Both derived identity from `kebab()` — a DISPLAY slug, which
 * NFKD-decomposes and turns every combining mark into a hyphen — so distinct non-Latin marks collapsed
 * to one qid and every sibling after the first was dropped in silence.
 *
 * TWO CLASSES, AND THE SECOND IS WHY THE SET IS A PARAMETER. `termIdentity` falls back to the
 * fingerprint only when the Latin fold is EMPTY, so a Latin term returns its long fold and the 40-char
 * truncation below can still collide — two corporate names sharing a long prefix do it today. The
 * suffix is the net for that, and it is the same `#N` shape the compiler already uses.
 *
 * MUTATES `used`, deliberately: the caller mints in a loop and the next call must see this one.
 *
 * @param {object} o
 * @param {string} o.prefix  the lane's family prefix, e.g. `xcheck-mark`
 * @param {string} o.term    the term this entry searches
 * @param {Set<string>} o.used  qids already minted in this batch
 * @returns {string} a qid no other entry in the batch holds
 */
export function mintSupplementalQid({ prefix, term, used }) {
  const base = `${prefix}-${termIdentity(term).slice(0, 40)}`;
  let qid = base;
  for (let n = 2; used.has(qid); n++) qid = `${base}#${n}`;
  used.add(qid);
  return qid;
}

// ── the compiler ─────────────────────────────────────────────────────────────────────────────────

/**
 * Compile the deterministic register plan. PURE — same inputs ⇒ byte-identical output.
 *
 * @param manifest  parsed variant-manifest model (variant-manifest-model.mjs)
 * @param job       { jobKey, classes[], jurisdictions[] } — classes MANDATORY (code-authoritative
 *                  scope; an empty class set is a compile error, never an all-class plan)
 * @param form      OPTIONAL parsed form-neighbourhood.json ({ elements:[{ element, band:{
 *                  exactQueries[], wildcardPatterns[] } }] }) — the machine FORM floor
 * @param skillVersion  provenance string (e.g. the register skill's version marker)
 * @param capabilities  OPTIONAL provider capability contract (providers/<id>/src/capabilities.js, via
 *                  driver/register-capabilities.mjs). Omitted ⇒ the pre-phase-3 corsearch-shaped
 *                  behaviour, byte-identical (no entry gains a key, no jurisdiction is translated).
 */
export function compileRegisterPlan({ manifest, job, form = null, skillVersion = "", capabilities = null, unavailableOffices = [] }) {
  const classes = (job?.classes ?? []).map(String).filter(Boolean);
  if (!classes.length) throw new Error("register_plan_classes_missing: a plan is always class-scoped — compile with the matter's in-scope Nice classes");
  const caps = capabilities ?? null;
  const maxOrWidth = planMaxOrWidth(caps);
  const resolved = resolveRegions(job?.jurisdictions, caps);
  const scopeIsWorldwide = resolved.worldwide;
  const deferredJurisdictions = [...resolved.deferred];

  // ── · offices the provider covers that THIS DEPLOYMENT cannot reach ─────────────────────────
  //
  // resolveRegions ran against the FULL declared coverage, deliberately (see register-availability.mjs).
  // What it returns is therefore the scope the provider could serve if it were fully wired. Here the
  // offices it is not wired for are split off — moved out of `regions` and into the disclosed deferral
  // list — so the EU half of a free tier with no US index still executes, and the US half rides the plan
  // as a `deferred_coverage` row instead of vanishing.
  //
  // THE WORLDWIDE CASE IS THE ONE THAT MATTERS, and it is why the split cannot live inside
  // resolveRegions' loop. An unrestricted scope names no territories at all, so that loop produces NO
  // deferrals and `regions` comes back as the provider's whole office list. Narrowing coverage upstream
  // would then have handed back ["EU"] with an empty deferral list — a worldwide free-tier run that
  // searched the EU only and disclosed nothing. That is a false clean, and it is exactly doctrine
  // rule 2. Splitting here catches the named case and the worldwide case with the same three lines,
  // because by this point both have become the same thing: a region list.
  const unreachable = new Map((unavailableOffices ?? []).map((u) => [String(u?.office), u]));
  const regions = [];
  if (unreachable.size) {
    // WORLDWIDE COMPILES TO AN EMPTY REGION FILTER, and that is what made this the dangerous case.
    // resolveRegions returns `regions: []` for an unrestricted scope on a provider that does not require
    // regions — the empty filter MEANS "every office this provider covers", and the provider expands it
    // at the wire. So a worldwide free-tier run with no US index had no "US" in `regions` for the loop
    // below to catch: it searched the EU, disclosed nothing, and returned a whole-world clean over half
    // a world. Doctrine rule 2, arrived at by an omission rather than a claim.
    //
    // So when — and ONLY when — an office is unreachable, an unrestricted scope is made EXPLICIT first:
    // the empty filter is expanded to the provider's declared coverage, and the split below then treats
    // it exactly like a named one. The guard matters. On a fully wired box `unreachable` is empty, this
    // branch never runs, and the plan keeps the empty filter byte-for-byte — expanding it unconditionally
    // would rewrite every worldwide plan on every provider to chase a case that cannot arise there.
    const scope = resolved.regions.length || !scopeIsWorldwide
      ? resolved.regions
      : [...(Array.isArray(caps?.offices?.covered) ? caps.offices.covered : [])];
    for (const r of scope) {
      const u = unreachable.get(String(r));
      if (!u) { regions.push(r); continue; }
      deferredJurisdictions.push({
        jurisdiction: String(r),
        reason: officeUnavailableReason([String(r)], caps?.id ?? "unknown", { memberId: u.memberId, missing: u.missing }),
      });
    }
  } else {
    regions.push(...resolved.regions);
  }

  // Every requested jurisdiction fell outside the provider's coverage: the plan cannot be executed at all
  // in the matter's scope. Every entry is marked unsupported for that reason (a plan with an EMPTY region
  // filter would silently sweep the world instead — the opposite of what was asked).
  //
  // An unreachable-office deferral counts here too: a US-only matter on a free tier with no index has
  // nothing left to search, and must fail the whole plan loudly rather than compile entries with an
  // empty region filter.
  //
  // WHICH sentence it fails with is not cosmetic. When every surviving deferral is an unreachable
  // office, the honest reason is "this deployment is not configured for it — set the variable", and
  // saying "outside the provider's coverage" instead would tell a lawyer the product cannot do
  // something it can. When the deferrals are mixed (or none are configuration), the coverage sentence
  // is the accurate one. `every` rather than a count, so one true coverage gap in the list keeps the
  // coverage wording.
  const allDeferredAreUnreachable = deferredJurisdictions.length > 0
    && deferredJurisdictions.every((d) => unreachable.has(String(d.jurisdiction)));
  const allJurisdictionsDeferred = deferredJurisdictions.length > 0 && regions.length === 0
    ? (allDeferredAreUnreachable
      ? officeUnavailableReason(deferredJurisdictions.map((d) => d.jurisdiction), caps?.id ?? "unknown",
        unreachable.get(String(deferredJurisdictions[0].jurisdiction)))
      : uncoveredJurisdictionReason(deferredJurisdictions.map((d) => d.jurisdiction), caps?.id ?? "unknown"))
    : null;

  // ── THE ENTRY CARRIES BOTH FORMS (2026-07-30) ────────────────────────────────────────────────────
  // A non-Latin term compiles to an entry that states the question in the native characters AND in the
  // manifest's romanisation of them, because the two register providers we ship index non-Latin marks
  // in OPPOSITE ways and the plan is provider-neutral — it states the question, the provider expresses
  // it (probed live 2026-07-29 on both; the same table drives the jx lane, driver/jx.mjs):
  //
  //                       小米        华威豹      스타벅스
  //     one provider       553          6          15      ← a real native-script index
  //     the other            0          0           0      ← indexes the TRANSLITERATION only
  //     …with romanisation 57632        32          18      ← HUA WEI BAO returns 华威豹 itself
  //
  // So the native term stays the searched term and the predicate is unchanged — that is what the
  // native-script index answers correctly, and widening it there is not free (`default` takes 小米 from
  // 553 to 127414, past that provider's own result ceiling, turning a usable slice into an unusable
  // crowd). `romanizedTerms` rides ALONGSIDE for the provider that needs it, which substitutes it (and
  // relaxes its own predicate, because `exact` on a transliteration is a silent zero) in its own
  // buildEntryQuery, where the reason lives. A provider that ignores the field keeps exactly its
  // current behaviour: an extra key is never a filter and never a narrowing.
  //
  // Before this, the plan carried the characters and nothing else, so on the transliteration-indexed
  // provider every non-Latin entry was refused at the wire and the axis produced no coverage at all.
  //
  // The lookup is BY VALUE and the stamp lives inside push(), deliberately. Keying it to the variant
  // OBJECT and stamping at the call sites is how the first cut of this dropped the romanisation of the
  // MARK: the mark's own entries are pushed from `manifest.mark`, and the variant loop `continue`s past
  // the variant that carries the mark's romanisation ("the exact entry already carries it") — so a
  // non-Latin mark reached the wire bare even though the manifest stated the answer. Keyed by value and
  // stamped in one place, every term the manifest has a romanisation for gets it, on every axis it
  // compiles to, and no call site can forget.
  //
  // The key is formKey (providers/_shared/script-form.mjs), and its history is BOTH collision classes:
  //   - norm() strips everything outside [a-z0-9], so every non-Latin value keys to "" — the whole
  //     lookup collapses to one entry and hands every term the first romanisation in the manifest.
  //   - the PREVIOUS formKey (NFKD + strip ALL combining marks) was subtler and worse (2026-07-30
  //     review, proven by repro): in most non-Latin scripts a combining mark selects WHICH LETTER
  //     this is, so mark-distinguished siblings — ティキスラッシュ (TIKI SURASSHU) and ディキスラッシュ
  //     (DIKI SURASSHU), Thai vowel signs, Devanagari matras, Arabic diacritics — keyed identically
  //     and a variant silently received its SIBLING's romanisation. The provider then executed a
  //     look-alike query and recorded state:enumerated while the dictated form was never searched
  //     anywhere: the exact silent-wrong-query false-clean class this carriage fix exists to kill,
  //     quieter than the loud deferral it replaced. formKey now strips accents from LATIN bases only
  //     and preserves every non-Latin combining mark (width still folds via NFKD).
  //   - and if two variants STILL share a key while dictating different romanisations (the model
  //     contradicting itself about one term), the key is poisoned rather than resolved by position:
  //     those entries compile BARE, and the romanisation-index provider's refusal turns the
  //     contradiction into a loud disclosed deferral — never into whichever answer came first.
  const romanByValue = new Map();
  for (const v of manifest.variants) {
    if (!v.romanization) continue;
    const key = formKey(v.value);
    const prior = romanByValue.get(key);
    if (prior === undefined) romanByValue.set(key, v.romanization);
    else if (prior !== null && romanizationSpellings(prior)[0] !== romanizationSpellings(v.romanization)[0])
      romanByValue.set(key, null);   // conflicting dictates ⇒ stamp NOTHING for this key (loud backstop)
  }
  const romanStamp = (e) => {
    // An owner NAME is not mark text and rides its own field (the executor drops the carrier on an
    // owner query anyway). An OR-stack is chunked, not substituted — one non-Latin member must never
    // silently replace a whole chunk's names, so a `terms[]` entry never carries the field.
    if (e.predicate === "owner" || Array.isArray(e.terms)) return {};
    const roman = romanByValue.get(formKey(e.term));
    const spellings = roman ? romanizationSpellings(roman) : [];
    return spellings.length ? { romanizedTerms: spellings } : {};
  };

  const entries = [];
  const seen = new Set();
  const push = (e) => {
    // — termIdentity, not slug. The `#N` loop STAYS: it is the net for a genuine duplicate
    // question, and `register_plan_qid_duplicate` throws only on entries that reach it already
    // identical. What changes is that it stops firing for terms that merely share a script — it was
    // masking that collision rather than surfacing it, which is why the ordinals existed at all.
    let qid = `${e.axis}:${e.predicate}:${termIdentity(e.term ?? e.terms?.[0])}${e.qidSuffix ?? ""}`;
    let n = 2;
    while (seen.has(qid)) qid = `${e.axis}:${e.predicate}:${termIdentity(e.term ?? e.terms?.[0])}${e.qidSuffix ?? ""}#${n++}`;
    seen.add(qid);
    const { qidSuffix, dropIssue, ...rest } = e;
    // — the markup screen sits HERE, in the one funnel every compiler emission goes through,
    // rather than at each push site. The mark, the merch cross-class probe and the form band carry
    // no dropIssue of their own: their only shield was literalStamp, and once that stops shielding
    // markup (it must — see below) a `**`-wrapped MARK would compile bare, and the freeze lint would
    // throw on it as a fresh-mint compiler bug. A funnel cannot be forgotten by the next push site.
    // `owner` rows are exempt, as everywhere: the term rules do not apply to owner names.
    const markupGap = String(e.predicate ?? "default") === "owner" ? null
      : (Array.isArray(e.terms) ? e.terms : [e.term]).map((t) => termMarkupIssue(t)).find(Boolean) ?? null;
    // — SUBSTANCE IS NOT EXEMPT, and it is the only rule in this chain that owner rows see. The
    // markup line above is owner-exempt "as everywhere", which is right for shape and wrong for a term
    // carrying no letter or digit: a measured run compiled `owner: "."` and shipped two HTTP 400
    // APPLICANT_NAME deferrals as an honestly-disclosed coverage gap. Stamped here as well as screened
    // in foldSupplementalEntries because the two doors are different: the fold guards MINTED rows
    // (recall probes, cross-check probes), this guards the COMPILER'S OWN emissions, and a funnel one
    // of them bypasses is a funnel that can be forgotten.
    const substanceGap = (Array.isArray(e.terms) ? e.terms : [e.term]).map((t) => termSubstanceIssue(t)).find(Boolean) ?? null;
    // A capability the active provider LACKS is stamped on the entry, never compiled into a wrong query.
    // A dropIssue (variantTermIssue — an un-searchable variants-model value) rides the SAME lane: the
    // deferred coverage row is the loud form of "this was never really searchable", and stamping it
    // here keeps the plan byte-identical across compiles (a pure function of the value).
    const gap = allJurisdictionsDeferred ?? substanceGap ?? dropIssue ?? markupGap ?? predicateGap(e.predicate, e.term ?? e.terms?.[0], caps)
      ?? ownerIntersectionGap(e, caps);
    entries.push({ qid, nice_classes: classes, regions, ...romanStamp(e), ...rest,
      ...(gap ? { unsupported: true, unsupported_reason: gap } : {}) });
    return qid;
  };

  // ── A1, fixed at the EMITTER (the freeze-lint below must never refuse the compiler's own output) ──
  // The 2026-07-28 plan carried {predicate:"exact", term:"TIKI*"} ×4: wildcard-shaped VARIANT values
  // (`TIKI*`, `*TIKI`, `SLUSH*`, `*SLUSH`) paired with the hardcoded exact — dispatched literally,
  // returned 0, shipped as schema-level confident cleans. A manifest value with an ANCHORED star is a
  // wildcard pattern and compiles to the wildcard predicate (whose per-anchor capability check then
  // stamps `unsupported` on a provider that lacks that anchor — the honest deferred row, decided by the
  // capability contract, never by the lint). An INFIX star stays literal — E*TRADE is a mark.
  const markPredicate = (t) => (hasAnchoredWildcard(t) ? "wildcard" : "exact");
  // ── A STRIPPED VARIANT'S VALUE IS A ROOT, AND A ROOT IS SWEPT CONTAINS — ────────
  //
  // The variants doctrine tells the seat to write a generated variant's ROOT as its `Value` for the
  // branches whose family members incorporate that root — a phonetic, transliteration or
  // visual-substitution form. A root's whole purpose is the contains match: it reaches the family
  // members that contain it and do NOT contain the full form. Dispatched `exact`, it matches the root
  // and nothing that incorporates it, which is the inverse of what it is for.
  //
  // Measured on the first run carrying the re-worded doctrine: the seat emitted the phonetic root, the
  // compiler sent it exact, it returned 5 records that all read as the root itself, and the register
  // reference mark that CONTAINS that root was retrieved zero times.
  //
  // KEYED ON THE SCHEMA SPELLING, NOT THE DOCTRINE'S PROSE. The doctrine says "visual-substitution";
  // `VARIANT_CATEGORIES` says `visual`. A predicate keyed on the prose covers two of the three branches
  // and drops the third silently, which is the dictated-shape class this repo keeps paying for.
  //
  // `numeric` IS EXCLUDED BY DECISION, NOT OMISSION: the strip rule names the phonetic, transliteration
  // and visual branches only, so a digit-substitution form is still a full form and keeps exact.
  //
  // This ADDS NO ENTRY. It widens the predicate of a sweep already dispatched for that term, and a
  // contains match is a strict superset of the exact one it replaces — so it can only widen, which is
  // the same safety argument the doctrine's own rule rests on. An anchored-star value stays the
  // wildcard lane's business, exactly as before.
  // The doctrine's three stripped branches. `transliteration` is listed because the doctrine strips it,
  // and it DOES NOT REACH THIS SITE: transliteration and numeric variants compile to their own axis
  // below, never to the primary sweep. That axis is not widened here — see the note on it — so this
  // change covers TWO of the doctrine's three branches, and the set says which three so the gap is
  // visible from the definition rather than inferred from an absence.
  const STRIPPED_CATEGORIES = new Set(["phonetic", "transliteration", "visual"]);
  // — THE DOCTRINE'S OWN DISPATCH TABLE, NOW BINDABLE. The universal-categories table
  // (prelim-variants SKILL.md) states the mode per tag: `exact-element` sweeps default, `plural-root`
  // is a root (the contains match is its whole purpose), and `formative-family` is "never exact-only".
  // Until the enum accepted these tags the mandate bound to nothing — measured: three root-shaped
  // strings dispatched exact, 4/2/4 records, the family they exist to reach retrieved zero times.
  // Same safety argument as the strip rule above: contains is a strict superset of exact, so this can
  // only widen. `exact-phrase` is deliberately NOT here — the doctrine sends it exact, which is what
  // markPredicate already derives; an anchored-star family value (`<root>*`) stays the wildcard
  // lane's, decided first.
  const FAMILY_CATEGORIES = new Set(["exact-element", "plural-root", "formative-family"]);
  const variantPredicate = (v) => (hasAnchoredWildcard(v?.value) ? "wildcard"
    : STRIPPED_CATEGORIES.has(String(v?.category ?? "")) || FAMILY_CATEGORIES.has(String(v?.category ?? "")) ? "default"
    : markPredicate(v?.value));
  // Manifest provenance is the term_literal authority: the manifest is the matter's RATIFIED mark
  // vocabulary, so a manifest value the shape lint would read as prose (a genuine >4-word slogan mark)
  // is stamped literal by the compiler — deterministically (a pure function of the value), so the plan
  // stays byte-identical across compiles. Minted/hand-authored entries never inherit this shield.
  // — and MARKUP NEVER EARNS IT. The stamp says "this string IS the mark, verbatim". Manifest
  // provenance can vouch for a 6-word slogan; it cannot make `**BIO VELTRIN FRESH DAILY**` a mark,
  // and stamping it would carry the shield all the way to the executor, which runs the same walk.
  // The row instead falls to push()'s markupGap and becomes a disclosed deferred row.
  const literalStamp = (t) => (!termMarkupIssue(t) && termShapeIssue(t) ? { term_literal: true } : {});

  // saturation-probe — count-only crowd descriptors for every common/saturated element. These
  // enumerate NOTHING (limit:1 probes); they describe the crowd for judgment. Never the anchor.
  for (const el of manifest.elements) {
    if (el.kind === "common" || el.kind === "saturated-common")
      push({ axis: "saturation-probe", predicate: "default", term: el.value, expected_kind: "count", provenance: "model" });
  }

  // primary-sweep — the dangerous NAMED band, all enumerates:
  //   exact mark, each non-transliteration variant (core/phonetic/visual/composite/other),
  //   the dominant-element contains slice (the crowd-gate PARENT), the machine FORM band
  //   (exact OR-stack + when-guarded wildcard fringe), and the cross-class merch check.
  push({ axis: "primary-sweep", predicate: markPredicate(manifest.mark), term: manifest.mark, expected_kind: "enumerate", provenance: "mark", ...literalStamp(manifest.mark) });
  // — the floor's `spacing-punctuation` family is deliberately NOT pushed here, and the reason is
  // this compiler's own equivalence: `norm` and `formKey` both strip separators, so "BIO VELTRIS",
  // "BIOVELTRIS", "BIO-VELTRIS" and "BIO.VELTRIS" are ONE key. The variant loop below already drops a
  // model variant that restates the mark that way, on exactly that test. Dispatching the generated set
  // would send the mark's own exact entry three more times under a different spelling — the PARADISE
  // shape (five diacritic terms, same 424 hits, the run's record budget gone), re-imported. The family
  // is enumerated and marked in form-neighbourhood.json because it is genuinely mechanical and the
  // surfaces that do NOT fold spacing are real; wiring it to those is not this change.
  for (const v of manifest.variants) {
    if (v.category === "transliteration" || v.category === "numeric") continue;   // its own axis below
    // "the exact entry already carries it" — but only when it really does. norm() strips everything
    // outside [a-z0-9], so under a NON-LATIN mark every non-Latin variant keyed to "" and matched it:
    // a Cyrillic or Han mark silently lost its ENTIRE variant set from the primary sweep (the owner
    // lane already named this collision, and asserted the primary sweep still searches them — which
    // was true only for a Latin mark). Requiring BOTH keys to agree can only skip FEWER variants than
    // before, never more: an accented Latin pair that norm already told apart is untouched, and a
    // genuine restatement of the mark still folds into the exact entry. formKey preserving non-Latin
    // combining marks matters HERE too: under the old mark-stripping fold a dakuten/vowel-sign SIBLING
    // of the mark keyed as "the mark restated" and vanished from the sweep — mark-distinguished
    // siblings are different marks and each compiles its own entry.
    if (norm(v.value) === norm(manifest.mark) && formKey(v.value) === formKey(manifest.mark)) continue;
    // variants-model values are screened (variantTermIssue): an infix-star family probe or a
    // prose/label value compiles as a DISCLOSED deferred row, never as a literal nil search — a
    // model-authored variant never inherits the manifest literal shield (only the ratified mark does).
    // Anchored-star variants stay the wildcard lane's business (markPredicate — the A1 emitter fix).
    push({ axis: "primary-sweep", predicate: variantPredicate(v), term: v.value, expected_kind: "enumerate", provenance: "model", dropIssue: variantTermIssue(v.value) });
  }
  // THE COMPILER DESIGNATES ITS OWN STEP 2 —. `crowd_gate_parent` is carried in the
  // plan because a consumer that re-derives this entry by POSITION is correct only while nothing else
  // mints a scope-covering `default` on this axis ahead of it. reference-score.mjs folded the depth
  // axis that way and said so in its own comment, naming this stamp as the remedy. Optional and
  // closed when present, like `provenance`: a frozen pre-2050 plan carries none and its reader falls
  // back to the old rule, so a resumed run does not change its answer because a field arrived.
  const parentQid = push({ axis: "primary-sweep", predicate: "default", term: manifest.dominant_element, expected_kind: "enumerate", provenance: "mark", crowd_gate_parent: true });
  // — EVERY seeded band, not just the dominant element's (see bandsFor). The wildcard fringe stays
  // on the dominant band alone: it is crowd-gated on the dominant's own contains parent, and no other
  // seed has one to gate against. The oracle does not ask for more — coverageGaps' family arm counts ANY
  // dispatched wildcard as the family being reached, so the dominant's fringe answers it for all seeds.
  for (const formBand of bandsFor(form, manifest.dominant_element).map((e) => e.band)) {
  if (formBand?.exactQueries?.length) {
    // Repair-first D: split the form OR-stack into ≤PLAN_MAX_OR_WIDTH entries at COMPILE time — the
    // 414 class dies at both ends (the executor chunks defensively too). Stored plans are reused
    // byte-identical (resolvePlanAgainstStore), so existing matters keep their unsplit shape; only
    // fresh compiles get the split entries. Chunk qids differ naturally (slug of each chunk's first
    // term); the #n dedup above covers collisions.
    // The split width is PROVIDER-DERIVED (capabilities.maxOrWidth): 80 on corsearch's URI budget, 500
    // on clarivate's JSON nesting cap, 1 on signa (no OR surface at all — one term per call).
    // Post-merge audit 2 (e): the partition is BY SCRIPT before it is by width. An OR-stack never
    // carries romanizedTerms (one member's Latin form must never substitute a whole chunk's names —
    // romanStamp), so ONE non-Latin member inside a Latin chunk made the wire guard
    // (nativeScriptIndexGap reads every name of the built query) defer the ENTIRE chunk on a
    // transliteration-indexed provider: a live run lost a 238-term chunk's 236 Latin names, disclosed
    // as "1 could not be searched". Latin members keep their coverage as their own chunks; each
    // non-Latin member compiles INDIVIDUALLY, so it romanises on its own (push()'s romanStamp rides
    // single-term entries) or defers on its own — one disclosed row per term, and scope-facts'
    // script-form read (entryIsNonLatinScript: EVERY term non-Latin) classifies each correctly.
    // Stored plans are reused byte-identical (resolvePlanAgainstStore) exactly as with the width
    // split above; only fresh compiles partition.
    const formTerms = [...formBand.exactQueries];
    const latinFormTerms = formTerms.filter((t) => !isNonLatinTerm(t));
    const nativeFormTerms = formTerms.filter((t) => isNonLatinTerm(t));
    for (let i = 0; i < latinFormTerms.length; i += maxOrWidth)
      push({ axis: "primary-sweep", predicate: "exact", terms: latinFormTerms.slice(i, i + maxOrWidth), expected_kind: "enumerate", provenance: "floor", qidSuffix: "+form" });
    for (const t of nativeFormTerms)
      push({ axis: "primary-sweep", predicate: "exact", term: t, expected_kind: "enumerate", provenance: "floor", qidSuffix: "+form" });
  }
  }
  for (const w of bandFor(form, manifest.dominant_element)?.wildcardPatterns ?? []) {
    // fringe of the dominant token — crowd-gated on the contains parent: a crowd parent is terminal
    push({ axis: "primary-sweep", predicate: "wildcard", term: w, expected_kind: "enumerate", provenance: "floor", when: { runs_if_enumerated: parentQid } });
  }
  push({ axis: "primary-sweep", predicate: markPredicate(manifest.mark), term: manifest.mark, expected_kind: "enumerate",
    nice_classes: ["25"], qidSuffix: "+merch", provenance: "mark", ...literalStamp(manifest.mark) });

  // ✕ THIS AXIS IS NOT WIDENED BY, AND THAT IS THE KNOWN REMAINDER. The doctrine's
  // strip rule covers the transliteration branch, so a transliteration variant's Value is a root too —
  // but it compiles HERE, where `exact enumerates` is the axis's stated design and the provider indexes
  // non-Latin filings by transliteration rather than by native script. Widening it is not a predicate
  // flip: it interacts with the romanisation stamp below and with how a contains match behaves against a
  // transliteration index, and neither is measured. Left exact deliberately, stated in the PR, and armed
  // as the CURRENT contract so that closing it reds this arm and somebody decides rather than drifts.
  //
  // transliteration-numeric — the non-Latin / digit-substitution family, exact enumerates. push()
  // stamps each non-Latin term with the manifest's romanisation of it (romanStamp, above); a `numeric`
  // variant is Latin and the manifest carries none for it, so the axis is unchanged for that member.
  for (const v of manifest.variants) {
    if (v.category !== "transliteration" && v.category !== "numeric") continue;
    push({ axis: "transliteration-numeric", predicate: markPredicate(v.value), term: v.value, expected_kind: "enumerate", provenance: "model", dropIssue: variantTermIssue(v.value) });
  }

  // incumbent-class — the industry-incumbent shadow: the anchor enumerated in the incumbent's classes.
  if (manifest.incumbent_classes.length) {
    push({ axis: "incumbent-class", predicate: "default", term: manifest.dominant_element, expected_kind: "enumerate",
      nice_classes: manifest.incumbent_classes.map(String), provenance: "model", qidSuffix: "+incumbent" });
  }

  // ── the COUNT-FIRST OWNER LANE (F2, 2026-07-29 — the TIKI-class fix, compiled) ──────────────────
  // The postmortem shape: fifteen watchlist owners shipped as count-only crowds ("one mega-owner
  // portfolio: 41k records, noted") because the only owner move the plan knew was the bare portfolio
  // sweep, and every mega-owner portfolio crowds over any ceiling. Both wire vocabularies compose
  // owner × mark-text × class in ONE call (capabilities.ownerTermIntersection), so a watchlist owner
  // is answerable record-by-record: per seed, the plan dictates
  //   1. the owner × formative ENUMERATE slices — the owner's portfolio intersected with the
  //      dangerous band (the dominant element + every distinctive element, contains predicate,
  //      in-scope classes). THESE are the coverage: the postmortem run's six mega-owners all collapse
  //      below any ceiling once intersected with the mark's formatives.
  //   2. ONE bare-owner COUNT probe (the existing predicate:"owner" count shape) — CROWD CONTEXT
  //      that sizes the portfolio, stamped `covered_by` with the slice qids so the descriptor's
  //      reason points at the records that actually answer the owner. Register-count doctrine holds
  //      verbatim downstream: no model touches the number, a count we could not take is never zero,
  //      the number is never banded. "Portfolio too large, noted" is not a finding anywhere.
  // A wide-class owner slice that still crowds is rescued at the EXECUTOR by the per-class split
  // (providers/_shared/enumerate.mjs classSplitRescue — the per-class rescue: per-class counts make
  // each leg enumerable). On a provider without ownerTermIntersection the slices are stamped
  // `unsupported` by push()'s ownerIntersectionGap (→ deferred coverage rows, disclosed, never a
  // silently widened mark-only search); a provider with no owner field at all defers the count too.
  if (manifest.watchlist_owners?.length) {
    const formatives = [];
    const seenForm = new Set();
    // Dedup key is SCRIPT-PRESERVING (formKey, not norm): norm() strips everything outside [a-z0-9],
    // so a Chinese/Cyrillic dominant or distinctive element would key to "" and be silently DROPPED
    // from every owner's slices — undisclosed recall narrowing on the owner lane only (the primary
    // sweep still searches them), and a fully non-Latin manifest would compile zero slices. The
    // pipeline carries 8 transliteration scripts and a Chinese jx lane; non-Latin formatives are a
    // real shape, not an edge case.
    for (const t of [manifest.dominant_element, ...manifest.elements.filter((e) => e.kind === "distinctive").map((e) => e.value)]) {
      const k = formKey(t);
      if (!k || seenForm.has(k)) continue;
      seenForm.add(k);
      formatives.push(t);
    }
    for (const owner of manifest.watchlist_owners) {
      const sliceQids = formatives.map((t) =>
        push({ axis: "incumbent-class", predicate: "default", term: t, owner, expected_kind: "enumerate", provenance: "model", // — the SAME collapse rode this suffix and the issue did not name it: two different
        // non-Latin owner names both folded to `+owner-q`, so the incumbent-class rows for two separate
        // proprietors collided and were told apart by position, exactly as the terms were.
        qidSuffix: `+owner-${termIdentity(owner)}` }));
      // No formatives at all (defensive — the manifest model requires a dominant element, but honesty
      // beats assumption): the bare-owner count compiles WITHOUT covered_by. An empty covered_by array
      // is a plan the compiler's own parser refuses (register_plan_covered_by_invalid) — a deterministic
      // freeze kill, the exact class 2becf12 exists to prevent. Absent = honest: no slices exist.
      push({ axis: "incumbent-class", predicate: "owner", term: owner, expected_kind: "count", provenance: "model",
        qidSuffix: "+watch", ...(sliceQids.length ? { covered_by: sliceQids } : {}) });
    }
  }

  // stable ordering: axis (REGISTER_AXES order) then insertion order within the axis
  const axisRank = new Map(REGISTER_AXES.map((a, i) => [a, i]));
  const ordered = entries.map((e, i) => [e, i]).sort((a, b) =>
    (axisRank.get(a[0].axis) ?? 99) - (axisRank.get(b[0].axis) ?? 99) || a[1] - b[1]).map(([e]) => e);

  return {
    schema_version: PLAN_SCHEMA_VERSION,
    plan_version: 1,
    derived_from: {
      job_key: String(job?.jobKey ?? ""),
      variants_fingerprint: variantsFingerprint(manifest),
      skill_version: String(skillVersion ?? ""),
    },
    nice_classes: classes,
    // THE TERRITORIES THE MATTER ORDERED, before translation into the provider's office vocabulary
    //. `regions` below is the post-translate result and cannot stand in for this: on a
    // regions-required provider a France order and an EU order both arrive as office codes, and the
    // binding-layer disclosure has to know which territory was ORDERED to know which registers bind it.
    //
    // Recorded rather than re-derived, because the alternative is inferring the order back out of the
    // office codes — which is exactly the one-to-one assumption exists to remove.
    ordered_jurisdictions: (job?.jurisdictions ?? []).map((j) => String(j).trim()).filter(Boolean),
    regions,
    // WHY `regions` looks the way it does. On a regions-required provider a worldwide matter compiles
    // to the provider's full office list, which is indistinguishable — by shape alone — from a matter
    // that hand-picked 186 territories. Publish needs to tell them apart: the first must still READ as
    // "worldwide" (one chip + the sweep disclosures), the second as a named list. Recorded as data so
    // no downstream reader has to infer scope from prose. Absent unless the matter was unrestricted,
    // so corsearch plans stay byte-identical.
    ...(scopeIsWorldwide ? { scope_basis: "worldwide" } : {}),
    // Only present when the active provider genuinely does not cover a requested jurisdiction — a
    // DEFERRED coverage row for the ledger, never a dropped filter. Absent on a fully-covered plan, so
    // corsearch plans stay byte-identical to the pre-phase-3 compiler.
    ...(deferredJurisdictions.length ? { deferred_coverage: deferredJurisdictions } : {}),
    ...(caps ? { provider: caps.id } : {}),
    entries: ordered,
  };
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// The script-preserving dedup/lookup fold (owner-lane formatives, mark/variant restatement, the
// romanisation lookup) now lives in providers/_shared/script-form.mjs as `formKey`, next to the script
// detector and the romanisation vocabulary — because the manifest floor (variant-manifest-model.mjs
// variantRomanizationGaps) must promise exactly what the compiler's lookup will find, and two private
// folds is how they drift. Its earlier local shape here (NFKD + strip ALL \p{M}) collapsed
// mark-distinguished non-Latin siblings (dakuten pairs, Thai vowel signs, Devanagari matras, Arabic
// diacritics) into one key — see the defect note on the export.

function bandFor(form, element) {
  const els = Array.isArray(form?.elements) ? form.elements : [];
  const hit = els.find((e) => norm(e?.element) === norm(element)) ?? els[0];
  return hit?.band ?? null;
}

/**
 * EVERY seeded band, the dominant one first..
 *
 * `bandFor` returned ONE band and the compiler dispatched only that one — but the form artifact has
 * carried a second element since 2026-07-18 (the formative root) and now carries every distinctive
 * element the manifest names. Those bands were generated and never searched, which is worse than not
 * generating them: `formGapDirectives` walks EVERY element in the artifact, so each undispatched band
 * fired a systemic `material` variant directive ("N of the deterministic form near-forms of X were
 * never dispatched") on every run that had a formative root — the oracle correctly reporting a gap the
 * compiler was creating. Dispatching all of them closes the gap at the end that was actually wrong.
 *
 * Deduped on the normalized element so the same seed reaching the artifact twice compiles once. PURE.
 */
export function bandsFor(form, element) {
  const els = (Array.isArray(form?.elements) ? form.elements : []).filter((e) => e?.band);
  if (!els.length) return [];
  const rank = (e) => (norm(e?.element) === norm(element) ? 0 : 1);
  const ordered = els.map((e, i) => [e, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([e]) => e);
  const seen = new Set(), out = [];
  for (const e of ordered) {
    const k = norm(e.element);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// ── versioned extension (append-only; recall monotone) ──────────────────────────────────────────

/**
 * Extend a frozen plan with a freshly compiled one (new variants arrived). Existing entries are
 * preserved in their original order; genuinely new qids are APPENDED; nothing is ever re-rolled or
 * removed (recall is monotone). Returns { plan, added, enriched } — added = [] AND enriched = []
 * means the compile introduced nothing new and the ORIGINAL object is returned (reuse, not a re-roll).
 *
 * FIELD-LEVEL ROMANISATION MERGE (2026-07-30 review round). Append-by-qid alone made the carriage
 * fix inert for any matter with a stored plan: the romanisation stamp changes no qid (qid = axis:
 * predicate:slug(term), and every non-Latin term slugs to "q"), so a stored BARE entry matched the
 * freshly compiled romanised one by qid and rode through verbatim — the same matter re-ran the same
 * un-executable queries forever, deferring the whole axis on a transliteration-indexed provider
 * every time. So a stored entry that LACKS `romanizedTerms` while the fresh compile of the SAME qid
 * (same single term, not an OR-stack, not an owner sweep) carries it, gains exactly that one field.
 * Strictly additive and never term-changing — the searched question is untouched, an entry that
 * already carries the field is never re-rolled (the fresh value never overwrites), so recall stays
 * monotone: the merge can only convert a wire-refused slice into an answerable one.
 */
export function extendRegisterPlan(prev, next) {
  // — MATCHED ON THE QUESTION, WITH THE QID AS THE FAST PATH, and this is the half that makes the
  // identity change safe to land rather than a migration hazard of its own.
  //
  // A qid is supposed to name a question: which axis, which predicate, which term. While non-Latin terms
  // were identified POSITIONALLY that was false for them, and this function is where the falsehood was
  // paid for — it meets a FROZEN plan with a FRESH compile and matched by exact string, so an ordinal
  // that shifted made a new term collide with an old one (the arriving term dropped, an existing one
  // duplicated; the header on termIdentity carries the measurement).
  //
  // It is also what a stored plan needs NOW. A plan minted before this change carries `q`, `q#2`; a
  // fresh compile of the same terms mints `q-<fp8>`. Keyed on the qid alone, NOTHING would match and
  // every non-Latin entry would be appended a second time — the same duplication, arriving through the
  // fix. Keyed on the question, an old-scheme entry and its new-scheme recompile are recognised as the
  // same question, so a stored plan is carried forward untouched and only genuinely new questions are
  // appended. Old qids are never rewritten: the frozen plan is the executor's contract and everything
  // downstream (receipts, coverage rows, the band join) keys on the strings it already has.
  //
  // The key is the question and nothing else — axis, predicate, the term or the OR-stack, and the owner
  // that rides the incumbent-class suffix. Not classes or regions: those are run scope, identical across
  // one compile, and folding them in would make a rescoped re-run duplicate every entry it already had.
  const questionKey = (e) => [e.axis, e.predicate,
    Array.isArray(e.terms) ? `terms:${e.terms.join("\u0000")}` : `term:${e.term ?? ""}`,
    e.owner ?? ""].join("\u0001");
  // THE QUESTION ALONE DECIDES WHAT IS NEW, and the qid deliberately does NOT get a vote here. Keeping
  // `!have.has(e.qid)` as an additional guard looks conservative and re-creates the whole defect: under
  // the old scheme a fresh term and a stored one collide on `q#2` while asking DIFFERENT questions, and
  // a qid-keyed suppression drops the arriving term for no reason but a shared ordinal. Measured on the
  // scenario in termIdentity's header, that leg alone still lost "Молочный чертополох". A qid is a
  // NAME for a question; when the two disagree the question is what is true.
  const haveQuestion = new Set(prev.entries.map(questionKey));
  const added = next.entries.filter((e) => !haveQuestion.has(questionKey(e)));
  const nextByQid = new Map(next.entries.map((e) => [e.qid, e]));
  // The enrich lookup needs the same two-key treatment for the same reason: across the scheme change a
  // stored entry's qid is absent from the fresh compile, and the romanisation carriage fix would go
  // inert again — which is the exact regression the field-level merge above was written to end.
  const nextByQuestion = new Map(next.entries.map((e) => [questionKey(e), e]));
  const enriched = [];
  const entries = prev.entries.map((e) => {
    if (Array.isArray(e.romanizedTerms) && e.romanizedTerms.length) return e;   // never re-rolled
    const n = nextByQid.get(e.qid) ?? nextByQuestion.get(questionKey(e));
    if (!n || !Array.isArray(n.romanizedTerms) || !n.romanizedTerms.length) return e;
    // additive only, and only when the fresh entry asks the EXACT same single-term question — a
    // romanisation must never ride onto a different term, an OR-stack, or an owner sweep.
    if (e.term !== n.term || Array.isArray(e.terms) || e.predicate === "owner") return e;
    enriched.push(e.qid);
    return { ...e, romanizedTerms: n.romanizedTerms };
  });
  if (!added.length && !enriched.length) return { plan: prev, added: [], enriched: [] };
  // A QID IS UNIQUE WITHIN A PLAN, and appending is the one place this function can break that. Once
  // `added` is decided by the question, a genuinely new entry can still arrive carrying a qid the
  // stored plan already uses — that is precisely what an ordinal-named entry does, and it is how the
  // old scheme's collisions would otherwise be re-created at the join rather than at the mint. Everything
  // downstream (joinPlanToBands, the receipts, the coverage rows) matches qids by exact string and would
  // silently pair the wrong pair; `register_plan_qid_duplicate` would throw on the plan.
  //
  // So a colliding append is renamed, never dropped and never allowed to shadow: the suffix is the
  // question's own fingerprint, so it is stable across recompiles rather than another ordinal.
  const taken = new Set(entries.map((e) => e.qid));
  const appended = added.map((e) => {
    if (!taken.has(e.qid)) { taken.add(e.qid); return e; }
    const fp = String(fingerprint(questionKey(e))).replace(/^fnv1a:/, "").slice(0, 8);
    let qid = `${e.qid}~${fp}`;
    for (let n = 2; taken.has(qid); n++) qid = `${e.qid}~${fp}-${n}`;
    taken.add(qid);
    return { ...e, qid };
  });
  return {
    plan: {
      ...prev,
      plan_version: (prev.plan_version ?? 1) + 1,
      derived_from: { ...prev.derived_from, variants_fingerprint: next.derived_from.variants_fingerprint },
      entries: [...entries, ...appended],
    },
    added: appended.map((e) => e.qid),
    enriched,
  };
}

/**
 * — the message a refused plan row carries. Exported so the four fold sites and the ask ledger
 * all say the same thing, and so it says WHERE the refusal happened: the whole point of this change
 * is that the row never reaches the freeze, the dispatch or the fan-in, so a reader who finds it in
 * a sidecar needs to know it was stopped at the fold rather than lost somewhere downstream.
 */
export function planRowRefusal({ qid = "", issue = "" } = {}) {
  return `plan row "${qid}" refused AT THE FOLD — never frozen into the plan, never dispatched: ${issue}`;
}

/**
 * — split a fold lane's directive rows by what the screen did with them. Both the cross-check
 * and the recall lane keep a `directives[]` beside their entries (the audit trail the ask ledger and
 * the demotion tripwire read), and a refused entry's directive must move OUT of it: left there it
 * claims a query that no longer exists, and dropped entirely it is a common-law signal that stopped
 * being cross-checked with nothing anywhere saying so.
 *
 * Returns { kept, refused } — `refused` rows carry the reason, so the receipt is self-explaining.
 * PURE, and one function rather than two copies, because the two lanes must not drift.
 */
/**
 * — TAKE THE CAP FROM WHAT SURVIVES THE SCREEN, not from what arrived.
 *
 * A supplemental lane mints more candidates than its budget allows and the duplicate screen refuses
 * some of them. Filling the budget first spends slots on rows the screen then discards, and pushes real
 * terms into the over-cap list behind them. Measured on a live run: cap 10, six queries kept, FOUR
 * slots spent on entries this very fold discarded, six genuinely new terms logged "assess manually".
 *
 * AND THAT COLLISION IS THE EXPECTED CASE. The terms most likely to be refused as duplicates are the
 * mark itself and its nearest forms — exactly what the common-law pass surfaces first — so they arrive
 * at the FRONT of the candidate list and take the earliest slots. It is not a rare ordering accident.
 *
 * PURE, and it screens with the caller's own fold so there is one definition of "duplicate": the fold
 * derives its sets from `plan.entries` on each call and returns a new plan rather than mutating one,
 * which is what makes probing free. Nothing here decides WHETHER a row is refused — the fold does, it
 * is right about every row it refuses, and only the order of screening and counting moves.
 *
 * @returns {{entries, overflow, refused}} — `entries` is what to fold for real (at most `cap`),
 *          `overflow` is GENUINE excess (real queries were minted ahead of it, not slots burned on
 *          rows nobody dispatched), and `refused` is the screen's verdict over the WHOLE candidate
 *          list, because a fix that searched more while disclosing less would be a bad trade.
 */
export function screenThenCap(plan, candidates, cap) {
  const all = Array.isArray(candidates) ? candidates : [];
  const probe = foldSupplementalEntries(plan, all);
  // KEYED ON WHAT THE FOLD ADDED, not on what it refused — and the difference is a second slot-waster.
  // The fold produces no query by TWO routes: an explicit refusal, and a silent `continue` for a row
  // whose qid the plan already holds ("a re-proposal, expected and quiet"). Only the first lands in
  // `refused`, so filtering on refusals alone would still spend a slot on the quiet one. `added` is the
  // one answer to "would this have become a query", which is the only question the cap should count.
  const survived = new Set(probe.added ?? []);
  const survivors = all.filter((e) => survived.has(e?.qid));
  return { entries: survivors.slice(0, cap), overflow: survivors.slice(cap), refused: probe.refused };
}

export function partitionFoldDirectives(directives, refused) {
  const byQid = new Map((refused ?? []).map((r) => [r?.qid, r]));
  const kept = [], out = [];
  for (const d of directives ?? []) {
    const r = d?.qid != null ? byQid.get(d.qid) : undefined;
    if (r) out.push({ ...d, issue: r.issue ?? null }); else kept.push(d);
  }
  return { kept, refused: out };
}

/**
 * — THE QUESTION AN ENTRY ASKS, as a comparable key. This is NOT the qid, and the difference
 * is the whole defect.
 *
 * A supplemental qid is `supp:<axis>:<predicate>:<slug>:<fp8>` where the fingerprint is taken over
 * the proposal's fields AS WRITTEN, `regions` among them. But `regions: []` does not mean "no
 * offices" — resolveRegions above defines the empty list as UNRESTRICTED, every office the provider
 * covers. So one slice has two spellings: the plan's region list enumerated, and the empty list that
 * expands to it. They hash differently, they mint two qids, and a fold that compares qids sees two
 * questions where the provider will see one.
 *
 * On the 2026-08-14 register round that produced this, measured from the archived run:
 *   · the model narrowed a refused large-portfolio owner slice to 185 offices — the plan's 186 minus
 *     exactly `IL`, the office that had refused it — and said so in its own rationale;
 *   · three later "deferred re-run" proposals of the same slice carried `regions: []`, which
 *     resolves back to all 186, `IL` included;
 *   · the 185-office entries were refused by `AO`; the `regions: []` entries were refused by `IL`.
 * The narrowing was discarded and the already-refused query was re-sent to the office that refused
 * it — as new plan rows, with their own count probes, their own `error:true` blocks and their own
 * deferral rows. The IL/AO split across those blocks is what proves an empty list reached IL; it is
 * behavioural, not inferred.
 *
 * What is in the key, and why each:
 *   · axis, predicate, term(s), owner, nice_classes — the question itself.
 *   · regions RESOLVED against the plan, so the empty spelling and the enumerated one compare EQUAL,
 *     and a genuine narrowing (185 ≠ 186) still compares UNEQUAL. Narrowing is the model correcting
 *     itself and must keep working; that is the case this must not break.
 *   · term_literal, because it changes what is sent to the wire. Two rows that differ only in whether
 *     the term is searched literally are two queries, not one.
 *   · arrays sorted — an OR-stack over the same set in a different order is the same query, and
 *     stableStringify preserves array order, so order-insensitivity has to be done here.
 *   · terms trimmed, NOT case-folded. A false refusal costs a real slice; a missed duplicate costs a
 *     probe. Where those trade off, miss the duplicate.
 *
 * What is deliberately NOT in the key:
 *   · `expected_kind`. The minter hardcodes `expected_kind: "enumerate"` on every supplemental entry
 *     (driver/engine/mcp/supplemental.mjs), so it carries nothing about what the model asked for —
 *     including it would make this screen blind to every re-proposal of a compiler `count` slice,
 *     which is two of the three rows above.
 *   · `romanizedTerms`, for the reason the minter gives for leaving it out of the qid fingerprint:
 *     the romanisation is carriage, not a different question.
 *   · qid, origin, provenance, rationale, covered_by. Bookkeeping about the row, not the question.
 *
 * Returns null for a row that states NO term. Such a row asks nothing, so there is nothing to
 * compare, and it is the term screen's business rather than this one's — abstaining is the honest
 * answer, and guessing would make every contentless row a duplicate of every other.
 *
 * PURE. Exported so the screen below and its test call exactly the same function.
 */
export function entryQuestionKey(entry, plan) {
  const e = entry ?? {};
  const sorted = (v) => (Array.isArray(v) ? [...v].map((x) => String(x)).sort() : []);
  const terms = (Array.isArray(e.terms) && e.terms.length ? e.terms : [e.term])
    .map((t) => String(t ?? "").trim()).filter(Boolean);
  if (!terms.length) return null;
  const own = Array.isArray(e.regions) && e.regions.length ? e.regions : (plan?.regions ?? []);
  return fingerprint({
    axis: String(e.axis ?? ""),
    predicate: String(e.predicate ?? ""),
    terms: [...terms].sort(),
    owner: String(e.owner ?? ""),
    nice_classes: sorted(e.nice_classes),
    regions: sorted(own),
    term_literal: e.term_literal === true,
  });
}

/**
 * Fold DRIVER/MODEL-minted supplemental entries into a plan (copper-lattice: the cross-check
 * directives now, the propose-supplemental lane next). Append-only by qid + plan_version bump, like
 * extendRegisterPlan — but derived_from is PRESERVED verbatim: a supplemental fold is not a manifest
 * change, and overwriting variants_fingerprint would break the store's byte-identical reuse (F2). PURE.
 *
 * — AND IT SCREENS. This is the single funnel all five non-compiler writers already call
 * (pipeline's proposal fold, recall fold, cross-check fold and frame-reopen fold; jx's candidate
 * fold), which is why the screen belongs here rather than at each site: the compiler's own rows are
 * caught by the freeze lint, and before this, two of the five folded entries in AFTER that lint with
 * no term screen of any kind. The cross-check fold is the one that mints `predicate:"default"` rows
 * straight out of model-authored common-law markdown, and it is where R2b's two heading
 * rows entered a plan that had already been declared clean.
 *
 * — AND IT SCREENS FOR THE QUESTION, not just the qid. Same argument as 's term screen and
 * the same funnel: an entry whose resolved question is already in the plan is refused here, because
 * this is the one place that holds both the plan and the incoming row. See entryQuestionKey above
 * for what "the same question" means and why `regions` is the field that hides it.
 *
 * Refused rows are RETURNED, never dropped: a common-law signal that stopped being cross-checked is
 * an absence, and an absence reported as success is the failure this whole issue is about. Every
 * caller writes them somewhere a reader will meet them.
 *
 * Returns { plan, added: [qid], refused: [{qid, term, issue}] }.
 */
export function foldSupplementalEntries(plan, entries) {
  const have = new Set(plan.entries.map((e) => e.qid));
  // — first qid wins, so the refusal names the row already IN the plan rather than a later
  // arrival. The compiler's own rows are in here too: a supplemental re-proposal of a compiler slice
  // is the case that actually fired on the round in evidence.
  //
  // An `unsupported` row does NOT claim its question. It is on its way to the deferred lane as a
  // disclosed coverage gap, so letting it block a later executable row asking the same thing would
  // turn a gap that could still be closed into one that never is.
  const asked = new Map();
  for (const e of plan.entries) {
    if (e?.unsupported === true) continue;
    const k = entryQuestionKey(e, plan);
    if (k && !asked.has(k)) asked.set(k, e.qid);
  }
  const added = [];
  const refused = [];
  // A BATCH COLLISION IS NAMED, NOT SWALLOWED. This condition used to cover three different things with
  // one silent `continue`: a malformed entry, a re-proposal of a row the PLAN already holds, and two
  // entries in the SAME batch minting one qid. The third is the one that loses coverage — the mid-run
  // lanes derived identity from a display slug, so distinct non-Latin marks collapsed to one qid and
  // every sibling after the first vanished here, not refused, not recorded, nothing on the receipt.
  //
  // The mint sites no longer produce it. This is the second half: if a collision is ever constructed
  // again, from anywhere, it says so. The plan re-proposal stays quiet deliberately — it is an expected,
  // legitimate case, and refused rows render to the client as OPEN asks; turning a normal event into
  // client-visible noise is not this fix's business.
  //
  // THE DISCRIMINATOR IS THE TERM, not the qid. The same row offered twice is ONE question asked twice
  // and stays one refusal — the contract pins. A collision is two DIFFERENT terms arriving under
  // one identity, which is the fault. Keyed on the qid alone this refused the harmless case too, and
  // the suite's own arm said so.
  const inBatch = new Map();   // qid -> the term that claimed it
  for (const e of entries ?? []) {
    if (!e || typeof e.qid !== "string" || !e.qid) continue;
    const eTerm = String(e.term ?? e.terms?.[0] ?? "");
    if (inBatch.has(e.qid) && inBatch.get(e.qid) === eTerm) continue;   // the same row twice — one refusal
    if (inBatch.has(e.qid)) {
      refused.push({ qid: e.qid, term: String(e.term ?? e.terms?.[0] ?? ""),
        issue: planRowRefusal({ qid: e.qid, issue:
          `a different term ("${inBatch.get(e.qid)}") already minted this identity in the same batch, so `
          + `one of the two would be dropped with nothing recorded. Two DIFFERENT terms sharing one qid is `
          + `an identity fault at the mint site, not a duplicate question: derive the qid with `
          + `termIdentity and give a collision its own suffix, so both terms are searched.` }) });
      continue;
    }
    inBatch.set(e.qid, eTerm);
    if (have.has(e.qid)) continue;   // already in the PLAN — a re-proposal, expected and quiet
    have.add(e.qid);            // a refused qid is claimed too — the same row twice is one refusal
    const issues = entryTermIssues(e);
    if (issues.length) {
      refused.push({ qid: e.qid, term: String(e.term ?? e.terms?.[0] ?? ""),
        issue: planRowRefusal({ qid: e.qid, issue: issues[0].issue }) });
      continue;
    }
    // The term screen stays FIRST: a malformed term is refused as malformed whether or not it also
    // duplicates something, because that is the reason a reader needs.
    const key = entryQuestionKey(e, plan);
    const twin = key ? asked.get(key) : undefined;
    if (twin) {
      refused.push({ qid: e.qid, term: String(e.term ?? e.terms?.[0] ?? ""),
        issue: planRowRefusal({ qid: e.qid, issue:
          `it asks the same question as plan row "${twin}" once regions are resolved (an entry with no `
          + `regions of its own inherits the plan's, so an empty list is the WIDEST scope, not a narrower `
          + `one). A plan states the questions asked, not the attempts made — retrying is the repair `
          + `ladder's job, and a second plan row for one question double-counts it in the coverage `
          + `ledger. Narrow it to a scope the plan does not already cover, or leave the existing row to `
          + `carry the coverage.` }) });
      continue;
    }
    if (key && e.unsupported !== true) asked.set(key, e.qid);   // dedupes the batch too, on the question
    added.push(e);
  }
  if (!added.length) return { plan, added: [], refused };
  return {
    plan: { ...plan, plan_version: (plan.plan_version ?? 1) + 1, entries: [...plan.entries, ...added] },
    added: added.map((e) => e.qid),
    refused,
  };
}

/**
 * The store decision (pure — the attach step does only IO around this): given the slug store's
 * latest plan (or null) and a fresh compile, decide reuse / extend / mint.
 *   { plan, action: "reused" | "extended" | "minted", added: [qid] }
 * Same job_key + same variants_fingerprint ⇒ the STORED object verbatim (byte-identical reuse —
 * THE F2 property). Same key, new fingerprint ⇒ append-only extension. Different/absent key ⇒ the
 * fresh compile (a different matter never inherits another matter's plan).
 */
// Repair-first D — plan feasibility at accept time, SEVERITY-CLASSED (hotfix 2026-07-06, The Unbeaten
// Path e2e failure): a REPAIRABLE condition never terminates a run — that is the round's own doctrine
// applied to this gate.
//   - `repairable`   — width/length overruns: the executor CHUNKS oversized OR-stacks at runtime
//                      (doEnumerate, the  guard, proven live on copper-spire). Log-only from ANY
//                      provenance. The compile-time split keeps fresh output clean; legacy store
//                      entries (pre-split mints, inherited byte-identical by the recall-monotone
//                      extension) execute chunked — they are history, never a bug to die on.
//   - `unexecutable` — unknown predicate, empty terms, non-numeric classes, dangling when-guards:
//                      nothing downstream can run these. Loud ONLY for freshly-authored entries
//                      (a compiler bug must surface in dev/tests); inherited entries log-only.
//
// A1 freeze-lint (PR-1, 2026-07-29 — the 2026-07-28 wildcard-under-exact class): the term must AGREE
// with its predicate and must be mark-shaped (providers/_shared/term-shape.mjs — anchored-`*` under a
// literal predicate, a `wildcard` predicate with no star, a label/prose-shaped term). These are
// `unexecutable`: the provider WOULD run them, but the result is a schema-level false clean — worse
// than a query that cannot run. REJECT LOUDLY, NEVER AUTO-PROMOTE: silently rewriting exact→wildcard
// here would, on a provider lacking that anchor capability, convert a searched slice into a deferred
// one — a lint making a coverage decision. The emitter owns emitting the right predicate
// (compileRegisterPlan markPredicate); the lint only refuses. `term_literal: true` is the escape
// hatch for a genuine mark whose shape trips the rules.
// Returns [{ entry: qid, issue, severity }]. `feasibilityMessages` flattens for logs.
export function validatePlanFeasibility(plan, { capabilities = null, maxOrWidth = planMaxOrWidth(capabilities), maxNameLength = PLAN_MAX_NAME_LENGTH } = {}) {
  const issues = [];
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  const qids = new Set(entries.map((e) => e?.qid).filter(Boolean));
  for (const e of entries) {
    const tag = e?.qid ?? "(no qid)";
    const add = (severity, issue) => issues.push({ entry: tag, issue, severity });
    if (!PLAN_PREDICATES.includes(e?.predicate)) add("unexecutable", `unknown predicate "${e?.predicate}"`);
    const names = Array.isArray(e?.terms) ? e.terms : e?.term != null ? [e.term] : [];
    if (!names.length || names.some((t) => !String(t ?? "").trim())) add("unexecutable", "empty term(s)");
    if (Array.isArray(e?.terms) && e.terms.length > maxOrWidth) add("repairable", `OR-stack of ${e.terms.length} names exceeds the executor bound (${maxOrWidth}) — the executor runs it chunked`);
    for (const t of names) if (String(t).length > maxNameLength) add("repairable", `name exceeds ${maxNameLength} chars ("${String(t).slice(0, 40)}…") — provider-side truncation risk only`);
    if ((e?.nice_classes ?? []).some((c) => !Number.isFinite(Number(c)))) add("unexecutable", "non-numeric nice_class");
    if (e?.when && !qids.has(e.when.runs_if_enumerated)) add("unexecutable", `when-guard targets unknown qid "${e.when?.runs_if_enumerated}"`);
    // An entry the compiler already stamped `unsupported` (variantTermIssue / capability gap) is a
    // DISCLOSED deferred row, never dispatched — the shape lint must not re-flag it as unexecutable
    // (the ownerGap check below models the same exemption).
    if (e?.unsupported !== true) for (const { issue } of entryTermIssues(e)) add("unexecutable", issue);
    // F1: an owner×term entry the active provider cannot intersect should have been stamped
    // `unsupported` at its mint (→ the deferred row). Un-stamped, it would dispatch as SOMETHING ELSE
    // than what the plan says — flag it as a wiring bug, never let it ride.
    const ownerGap = ownerIntersectionGap(e, capabilities);
    if (ownerGap && e?.unsupported !== true) add("unexecutable", ownerGap);
    // covered_by (the owner lane's count→slice pointer): a descriptor claiming coverage that the plan
    // does not carry would point the lawyer at records that were never dictated — a compiler bug.
    if (e?.covered_by != null && (!Array.isArray(e.covered_by) || !e.covered_by.length || e.covered_by.some((q) => typeof q !== "string" || !q.trim())))
      add("unexecutable", "covered_by must be a non-empty array of qid strings when present");
    else if (Array.isArray(e?.covered_by)) for (const q of e.covered_by) {
      if (!qids.has(q)) add("unexecutable", `covered_by targets unknown qid "${q}"`);
    }
  }
  return issues;
}

/**
 * A1 — the axes the frozen plan will not dispatch AT ALL: every entry carries `unsupported: true`
 * (capability gaps — predicate/office/owner×term the active provider lacks). Deferral is the honest
 * lane, so this is a LOUD EVENT for the caller to log (`register-plan-axis-deferred`), NEVER a
 * rejection: refusing the plan would turn a disclosed gap into an undelivered run. PURE.
 * Returns [{ axis, entries, reason }] (reason = the first entry's unsupported_reason).
 */
export function fullyDeferredAxes(plan) {
  const byAxis = new Map();
  for (const e of (Array.isArray(plan?.entries) ? plan.entries : [])) {
    if (!e || typeof e !== "object") continue;
    const a = byAxis.get(e.axis) ?? { axis: e.axis, entries: 0, deferred: 0, reason: null };
    a.entries += 1;
    if (e.unsupported === true) { a.deferred += 1; a.reason = a.reason ?? String(e.unsupported_reason ?? "capability absent"); }
    byAxis.set(e.axis, a);
  }
  return [...byAxis.values()].filter((a) => a.entries > 0 && a.deferred === a.entries)
    .map((a) => ({ axis: a.axis, entries: a.entries, reason: a.reason }));
}

export const feasibilityMessages = (issues) => (issues ?? []).map((i) => `${i.entry}: ${i.issue}`);

export function resolvePlanAgainstStore(stored, compiled) {
  if (stored && stored.derived_from?.job_key === compiled.derived_from.job_key) {
    if (stored.derived_from.variants_fingerprint === compiled.derived_from.variants_fingerprint)
      return { plan: stored, action: "reused", added: [] };
    // A field-level romanisation merge with no new qids is still an EXTENSION, never a reuse: the
    // returned plan is a new object and the caller must persist it (2026-07-30 review round — the
    // "reused" label here was how a stored bare plan defeated the fingerprint move).
    const ext = extendRegisterPlan(stored, compiled);
    return { plan: ext.plan, action: ext.added.length || ext.enriched.length ? "extended" : "reused",
      added: ext.added, ...(ext.enriched.length ? { enriched: ext.enriched } : {}) };
  }
  return { plan: compiled, action: "minted", added: compiled.entries.map((e) => e.qid) };
}

// ── strict artifact parser (the frozen _driver/register-plan.json; token-first, replay-safe) ────

export function parseRegisterPlan(raw) {
  let p;
  try { p = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (e) { throw new Error(`register_plan_unparseable: ${short(e.message)}`); }
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("register_plan_unparseable: top level must be a JSON OBJECT");
  if (!Array.isArray(p.entries) || !p.entries.length) throw new Error("register_plan_entries_empty");
  const seen = new Set();
  for (const e of p.entries) {
    if (!e || typeof e !== "object") throw new Error("register_plan_entry_invalid: every entry must be an object");
    if (!e.qid || typeof e.qid !== "string") throw new Error("register_plan_qid_missing");
    if (seen.has(e.qid)) throw new Error(`register_plan_qid_duplicate:${short(e.qid)}`);
    seen.add(e.qid);
    if (!REGISTER_AXES.includes(e.axis)) throw new Error(`register_plan_axis_invalid:${short(e.axis)}`);
    if (!PLAN_PREDICATES.includes(e.predicate)) throw new Error(`register_plan_predicate_invalid:${short(e.predicate)}`);
    if (!EXPECTED_KINDS.includes(e.expected_kind)) throw new Error(`register_plan_kind_invalid:${short(e.expected_kind)}`);
    if (!Array.isArray(e.nice_classes) || !e.nice_classes.length)
      throw new Error(`register_plan_classes_missing:${short(e.qid)} (every entry is class-scoped — no all-class plans)`);
    const hasTerm = typeof e.term === "string" && e.term.trim();
    const hasTerms = Array.isArray(e.terms) && e.terms.length && e.terms.every((t) => typeof t === "string" && t.trim());
    if (!hasTerm && !hasTerms) throw new Error(`register_plan_term_missing:${short(e.qid)}`);
    if (e.when != null && (typeof e.when !== "object" || typeof e.when.runs_if_enumerated !== "string"))
      throw new Error(`register_plan_when_invalid:${short(e.qid)}`);
    // F1: `owner` is an optional SCOPE FIELD on a mark-text entry (the owner×term intersection slice);
    // a bare owner sweep stays predicate:"owner" with the owner name as its term. A present-but-empty
    // owner is a defect, never a silent no-op filter.
    if (e.owner != null && (typeof e.owner !== "string" || !e.owner.trim()))
      throw new Error(`register_plan_owner_invalid:${short(e.qid)} (owner must be a non-empty string when present)`);
    //: optional (a frozen pre- plan has none), closed when present — an off-enum value would
    // make the floor/model marking unreadable exactly where it is load-bearing.
    //: optional (a frozen pre-2050 plan has none), and closed to the single value `true` when
    // present — a falsy or string-shaped stamp would make the depth fold's designation unreadable
    // exactly where it is load-bearing, and would do it silently.
    if (e.crowd_gate_parent != null && e.crowd_gate_parent !== true)
      throw new Error(`register_plan_crowd_gate_parent_invalid:${short(e.qid)} (present means exactly true)`);
    if (e.provenance != null && !PLAN_PROVENANCE.includes(e.provenance))
      throw new Error(`register_plan_provenance_invalid:${short(e.provenance)} (one of: ${PLAN_PROVENANCE.join(", ")})`);
    // F2 owner lane: `covered_by` on a count descriptor names the owner×term slice qids that ARE the
    // owner's coverage — the executor writes them into the descriptor's reason so a bare-owner count
    // can never read as "portfolio too large, noted" with nothing to point at.
    if (e.covered_by != null && (!Array.isArray(e.covered_by) || !e.covered_by.length
        || e.covered_by.some((q) => typeof q !== "string" || !q.trim())))
      throw new Error(`register_plan_covered_by_invalid:${short(e.qid)} (covered_by is a non-empty array of qid strings when present)`);
  }
  for (const e of p.entries) {
    if (e.when && !seen.has(e.when.runs_if_enumerated))
      throw new Error(`register_plan_when_orphan:${short(e.qid)} (guard names a qid the plan does not carry)`);
    if (Array.isArray(e.covered_by)) for (const q of e.covered_by) {
      if (!seen.has(q)) throw new Error(`register_plan_covered_by_orphan:${short(e.qid)} (covered_by names qid "${q.slice(0, 60)}" which the plan does not carry)`);
    }
  }
  return { ...p };
}

// ── fan-in: identity join plan ⇄ band blocks ────────────────────────────────────────────────────

/**
 * Join a plan's entries to the band blocks that executed them (blocks carry `qid` — the unit
 * message / plugin executor stamps it). Returns:
 *   { executed: [{qid, state, records, total_hits}], missing: [qid], skipped: [{qid, guard}],
 *     unplanned: [{qid|query}] }
 * `records` and `total_hits` are each a number or null, and BOTH KEYS ARE ALWAYS WRITTEN.
 * That is load-bearing, not tidiness: `planJoinFrom` tells a pre- receipt from a count the
 * provider could not take by whether the keys are PRESENT, because `null` and absent are the same
 * value once read. Omit a key here and every new receipt silently reads as legacy — the arm named
 * "the discriminator's PREMISE" fails if this stops holding.
 * An entry whose `when` guard resolves FALSE (parent crowd/absent) is `skipped`, never `missing`.
 * Blocks with no qid join nothing (legacy bands) and surface as unplanned only when they carry one.
 */
export function joinPlanToBands(plan, bandBlocksByAxis) {
  const blocks = [];
  for (const [axis, arr] of Object.entries(bandBlocksByAxis ?? {})) {
    for (const b of arr ?? []) if (b && typeof b === "object") blocks.push({ ...b, _axis: axis });
  }
  const byQid = new Map();
  for (const b of blocks) if (typeof b.qid === "string" && b.qid) byQid.set(b.qid, b);

  const executed = [], missing = [], skipped = [], deferred = [];
  for (const e of plan.entries) {
    if (e.when) {
      const parent = byQid.get(e.when.runs_if_enumerated);
      const parentState = String(parent?.state ?? "").toLowerCase();
      if (parentState !== "enumerated") { skipped.push({ qid: e.qid, guard: e.when.runs_if_enumerated }); continue; }
    }
    const b = byQid.get(e.qid);
    if (!b) { missing.push(e.qid); continue; }
    // A DETERMINISTIC CAPABILITY GAP (providers/_shared/execute-plan.mjs stamps `deferred:true` next to
    // `error:true`): the active provider genuinely cannot express this slice — a predicate it lacks, an
    // office outside its vocabulary, a term its query language cannot state. Retrying is pointless: the
    // repair ladder would re-run the identical refusal and the fan-in gate would kill a run that can
    // still be delivered with the gap on its face. So it is its OWN bucket: never `executed` (a clean can
    // never rest on it — the coverage skeleton gives the axis a `deferred` state the confirmed-clean gate
    // treats as strictly as `unexecuted`) and never `missing` (nothing is left to run). This is the
    // deferred coverage row doctrine 2 has always promised; before this it did not exist.
    if (b.error === true && b.deferred === true) { deferred.push({ qid: e.qid, reason: String(b.reason ?? "").slice(0, 300) }); continue; }
    // T1 (J6): an executor block stamped `error:true` is a PROVIDER ERROR wearing the
    // incomplete shape — the dictated slice never really ran. It joins as MISSING (→ the warm
    // followup re-invokes the executor; exhaustion is an honest StageFailure), never as an
    // "executed" crowd — a transient must not ship indistinguishable from a sanctioned descriptor.
    if (b.error === true) { missing.push(e.qid); continue; }
    // — WHAT THE SLICE RETURNED RIDES WITH THE FACT THAT IT RAN.
    //
    // "executed" answers "did the query run". It has never answered "did anything come back", and the
    // ask ledger ends a probe on the first question alone — so a recall probe that ran and returned a
    // live in-scope right is, in every archived run, byte-identical to one that ran and returned
    // nothing. `_driver/register-recall.json` holds the difference and is purged with the run dir, so
    // on 19 delivered runs the population that a rule would key on is not derivable at all.
    //
    // THREE-VALUED, and that is the whole point rather than a nicety. close-verify.mjs already records
    // why: "the executor writes total_hits NULL for a count it could not take, and `Number(null)` is 0".
    // A two-valued count would read an untaken count as "returned nothing" and re-create the exact
    // confusion this exists to remove — a probe whose count failed is not a probe that found nothing.
    // So each field is a number or NULL, never a zero standing in for an absence.
    // THE NULLISH CHECK COMES FIRST, and it is not defensive habit. `Number(null)` is 0 and
    // `Number.isFinite(0)` is true, so coercing before testing turns "no count could be taken" into
    // "counted zero" — the precise confusion this block exists to remove, re-created inside the fix.
    // Written the wrong way round first and caught by its own arm, which is why that arm exists.
    // (close-verify.mjs coerces the same field safely, because it only ever asks `> 0`.)
    const recs = Array.isArray(b.records) ? b.records.length : null;
    const rawHits = b?.total_hits;
    const hits = rawHits === null || rawHits === undefined ? NaN : Number(rawHits);
    executed.push({
      qid: e.qid,
      state: String(b.state ?? "").toLowerCase(),
      records: recs,
      total_hits: Number.isFinite(hits) ? hits : null,
    });
  }
  const planQids = new Set(plan.entries.map((e) => e.qid));
  const unplanned = blocks.filter((b) => typeof b.qid === "string" && b.qid && !planQids.has(b.qid))
    .map((b) => ({ qid: b.qid, query: String(b.query ?? "").slice(0, 80) }));
  return { executed, missing, skipped, deferred, unplanned };
}

// ──: the slice the provider ACCEPTED and then hard-errored at RUN time ──────────────────────────
//
// joinPlanToBands has two exits for a slice that did not produce a band block, and a whole class of
// failure fits neither:
//
//   `deferred`  the executor refused it CLIENT-SIDE, before the wire — a predicate it lacks, an office
//               outside its vocabulary. Known at plan time, disclosed, never retried.
//   `missing`   no block, or a block stamped `error:true`. Rides the repair ladder; survives it ⇒ the
//               fan-in throws, because a clean can never ship over a slice nothing ran.
//
// A slice the provider ACCEPTS and then hard-errors on — an HTTP 500 from one jurisdiction's index —
// lands in `missing` and stays there however many times it is tried. R5 (`8098215`, worldwide Global
// preliminary) died on exactly that: two slices took an "HTTP 500 … Count Failed - IL - Near/Adj" through
// the in-tool retry, the direct dispatch, the followup and FOUR recovery parks, and 140 minutes of a
// worldwide run were thrown away over one jurisdiction index having a bad day. A worldwide run carries
// the most slices, so it has the most exposure to any single index — the run class that most needs this
// exit is the one that had none.
//
// The engine already has the right vocabulary: the contract says a slice the provider cannot serve
// is DEFERRED — disclosed, never marked closed. This routes the run-time hard error to that same bucket,
// under two conditions that keep the gate exactly as strong as it was:
//
//   1. THE PROVIDER MUST HAVE ANSWERED. Deferral is earned by a band block stamped `error:true` with the
//      provider's own reason on it. A qid with NO block ran nothing and recorded nothing — an absence,
//      not a finding — and still throws. That is 's condition, untouched: a genuinely-unrun,
//      undisclosed slice fails the run.
//   2. THE LADDER MUST BE SPENT, WHERE THE LADDER CAN DO ANYTHING. Only a qid the run has ALREADY
//      recorded as missing (or already deferred this way) converts. On its first fan-in a hard-errored
//      slice throws exactly as it does today, so the recovery ladder keeps every chance to close a
//      provider having a bad minute. Deferring is a real cost — the deliverable ships CONDITIONAL with a
//      named gap — so it is not spent early.
//
// CONDITION 2 HAS AN EXCEPTION, AND IT IS THE WHOLE OF THE REGRESSION (E2E 2026-08-12).
//
// R1 PROJECT SABLE died at fan-in on both engines over one slice: Clarivate answered
// `HTTP 400: APPLICANT_NAME - The system did not recognize the syntax`. A 400 is not transient, so the
// fan-in stamps the StageFailure `deterministic`, and a deterministic failure DOES NOT RIDE THE LADDER.
// There is never a second fan-in, so "already recorded as missing" is never true, so the conversion
// above can never fire. The run dies — the one outcome this whole mechanism exists to prevent, on the
// error class that most deserves the exit. A permanent rejection is MORE deferrable than the transient
// 500 that prompted the issue, not less: retrying it is provably futile.
//
// So condition 2 asks the right question the wrong way round. Its purpose is "has the provider had every
// chance a retry can buy it?" — and for an error the run cannot classify as transient the honest answer
// is "the ladder has nothing to offer, so yes, immediately". Such a qid converts on its FIRST fan-in,
// still under condition 1, with a reason that says which of the two paths it took.
//
// `retryCannotHelp` is a NEGATIVE classification and the wording says so. It is "the run does not
// recognise this as transient" (the caller passes `!TRANSIENT_RE.test`), not positive knowledge that the
// far end will never serve the slice. That is the same test the fan-in already uses to stamp
// `deterministic` and refuse the ladder, so this cannot defer anything the old code would have retried:
// every qid it newly converts is one the old code killed the run over.
//
// Neither reason text matches `isCapabilityGapReason`: this is not a capability the provider lacks, so
// `partitionReceiptDeferrals` files it `suspect` and the envelope spends one code executor attempt on it.
// If the index has recovered, the slice closes and no gap is disclosed at all; if it fails again,
// `close_failed` records it as tried and it stays disclosed. One bounded retry, not a loop, and never a
// silent drop. That one attempt is kept for the permanent path too, deliberately: `retryCannotHelp` is a
// negative test, so the cheapest possible hedge against having classified it wrong is to let the
// envelope try exactly once and record what happened.

export const PROVIDER_HARD_ERROR_PREFIX = "provider hard error after the full recovery ladder — the slice was accepted and then failed, so it was never searched and cannot be read as clean: ";
export const PROVIDER_PERMANENT_ERROR_PREFIX = "provider hard error the recovery ladder cannot help — the slice was accepted and then failed with an error this run cannot classify as transient, so it was never searched and cannot be read as clean: ";

/** Is this deferral row one of ours (either path)? The stem both carry-forward and the fan-in key off. PURE. */
export const isProviderHardErrorReason = (reason) => {
  const s = String(reason ?? "");
  return s.startsWith(PROVIDER_HARD_ERROR_PREFIX) || s.startsWith(PROVIDER_PERMANENT_ERROR_PREFIX);
};

/** Every qid this run has already taken through the fan-in ladder, per its own last receipt. PURE. */
export function ladderExhaustedQids(receipt) {
  const out = new Set();
  for (const q of receipt?.missing ?? []) if (typeof q === "string" && q) out.add(q);
  // Both prefixes, or a permanent deferral would be forgotten on the next re-join and land back in
  // `missing` — break 3 in the matrix, a slice disclosed as a gap on one line and closed on the next.
  for (const d of receipt?.deferred ?? [])
    if (d?.qid && isProviderHardErrorReason(d.reason)) out.add(String(d.qid));
  return out;
}

/**
 * Move ladder-spent, provider-hard-errored qids out of `missing` and into `deferred`.
 *
 * @param joinRes           joinPlanToBands output
 * @param bandBlocksByAxis  the same bands that join read — the block is the evidence
 * @param exhausted         qids already through the ladder (ladderExhaustedQids of the PRIOR receipt)
 * @param retryCannotHelp   (reason) => bool — the run cannot classify this provider error as transient,
 *                          so the ladder has nothing to offer it and condition 2 is satisfied at once.
 *                          Defaults to never, which is byte-for-byte the pre--regression behaviour.
 * @returns {{join, converted: [{qid, reason, cause, path}]}} — `join` is the input untouched when
 *          nothing converts, so a run with no hard-errored slice is byte-identical to today. The
 *          deferral ROWS written into `join` carry only {qid, reason}; `cause` and `path` are for the
 *          caller's log line and never reach the receipt.
 * PURE.
 */
export function deferExhaustedProviderErrors(joinRes, bandBlocksByAxis, exhausted = new Set(), retryCannotHelp = () => false) {
  const spent = exhausted instanceof Set ? exhausted : new Set([...(exhausted ?? [])].map(String));
  if (!joinRes?.missing?.length) return { join: joinRes, converted: [] };
  const errByQid = new Map();
  for (const arr of Object.values(bandBlocksByAxis ?? {}))
    for (const b of arr ?? [])
      if (b && typeof b.qid === "string" && b.qid && b.error === true && b.reason) errByQid.set(b.qid, String(b.reason));
  const missing = [], converted = [], rows = [];
  for (const qid of joinRes.missing) {
    // CONDITION 1 is absolute and is tested first: no answer from the provider, no deferral, ever.
    const cause = errByQid.get(qid);
    if (cause === undefined) { missing.push(qid); continue; }
    // CONDITION 2, either way it can be satisfied: the ladder was spent, or the ladder is a no-op here.
    const permanent = !spent.has(qid) && retryCannotHelp(cause);
    if (!spent.has(qid) && !permanent) { missing.push(qid); continue; }
    const prefix = permanent ? PROVIDER_PERMANENT_ERROR_PREFIX : PROVIDER_HARD_ERROR_PREFIX;
    rows.push({ qid, reason: prefix + cause.slice(0, 240) });
    converted.push({ qid, reason: prefix + cause.slice(0, 240), cause, path: permanent ? "permanent" : "ladder-spent" });
  }
  if (!rows.length) return { join: joinRes, converted: [] };
  return { join: { ...joinRes, missing, deferred: [...(joinRes.deferred ?? []), ...rows] }, converted };
}

// ── coverage skeleton: confirmed-clean over an unexecuted slice is IMPOSSIBLE ───────────────────

/**
 * Code-derived per-axis coverage truth from the plan + join result. An axis is:
 *   "executed"    — every guard-active entry has a band block, none missing;
 *   "incomplete"  — executed but ≥1 block came back a crowd (incomplete state);
 *   "unexecuted"  — ≥1 guard-active entry has NO band block (the F3 hole).
 * The skeleton is the floor the digest's ledger claims are checked against — it never makes a
 * sufficiency judgment (that stays Layer B), it only states what RAN.
 */
// ── which territories were actually SEARCHED (item 13) ───────────────────────────────────────────────
//
// A territory may be claimed as searched only when an EXECUTED query names it. Not when a two-letter
// token that happens to look like an office code appears somewhere in the coverage ledger's prose.
//
// The old derivation ran a `\b[A-Z]{2}\b` scan over ledger text, and narrowed it to tokens that ARE
// known jurisdiction codes. That fixed the mark-fragment case ("KIN ZY" → ZY) and left the worse half
// standing, because the collision is not in the tokens: SA, AG, KG, SL and SE are all real jurisdiction
// codes AND all ordinary European company suffixes. An owner written "Boehringer Ingelheim Pharma GmbH &
// Co. KG" put Kyrgyzstan in the searched set, and there is no token list that separates those two
// readings — they are the same token.
//
// The consequence is not cosmetic. `jurisdictionScopeFlags`'s underCoverage arm is the disclosure that an
// IN-SCOPE territory went unsearched, so a junk token matching a scoped territory MARKS IT SEARCHED and
// the disclosure never fires: absence reading as coverage, out of a fragment of an owner's name.
//
// So the derivation moves to the machine record, which has carried the answer all along:
// `register-plan.json` entries each carry `regions[]` (the matter's jurisdictions already translated into
// the provider's office vocabulary), and `plan-execution.json` carries `executed[].qid`. Join them and a
// searched territory is one an executed query actually reached. Same compute-don't-author move as the
// rest of this batch: read the machine record, do not re-parse prose.
//
// UNRESOLVABLE MEANS UNSEARCHED, deliberately. With no plan or no execution receipt, this returns the
// empty set rather than falling back to the prose scan — which leaves every in-scope territory eligible
// for the underCoverage disclosure. That is the conservative direction: the failure becomes
// over-disclosure, which a reader resolves, rather than a silent clean over a territory nobody queried.
// PURE.
export function searchedJurisdictionsFromPlan(plan, execution) {
  const out = new Set();
  const executed = new Set((execution?.executed ?? []).map((e) => (typeof e === "string" ? e : e?.qid)).filter(Boolean));
  if (!executed.size) return { jurisdictions: [], resolved: false };
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  if (!entries.length) return { jurisdictions: [], resolved: false };
  for (const e of entries) {
    if (!executed.has(e?.qid)) continue;
    for (const r of (Array.isArray(e?.regions) ? e.regions : [])) {
      const c = canonicalJurisdictionCode(r);
      if (isKnownJurisdictionCode(c)) out.add(c);
    }
  }
  return { jurisdictions: [...out].sort(), resolved: true };
}

// ── HOW THE RECEIPT'S STATES ARE READ — ONE STATEMENT, THREE READERS ─────────────────────────
//
// The skeleton below assigns a state to every planned slice. Three surfaces then tell a model what
// those states MEAN: the reviewer's dispatch block, synthesis's dispatch block, and the
// corrective hint the gateway issues when a review comes back without the audit section. All three were
// separate prose, saying the same three things in three vocabularies — and the grading is the part that
// must never drift, because class (1) is the blocking condition on one surface and the unwriteable
// condition on another.
//
// They live HERE, with the derivation, rather than in pipeline.mjs: `pipeline.mjs` imports
// `gateway.mjs`, so the gateway cannot import back from it, and this module is already imported by both.
export const PLAN_AUDIT_HEAD =
  `DETERMINISTIC PLAN-EXECUTION CHECK (spec-48 WS2 / spec-49 doctrine): this run executed a FROZEN register plan; the code-derived receipt below states what actually ran.`;
// T8 (G5, doctrine): the old directive graded EVERY crowd/incomplete/skipped slice under a clean
// claim as a mechanical BLOCKING flag — the rejected PR- shape (a state label driving the verdict).
// Graded: only a slice that NEVER RAN blocks; a sanctioned skip and a crowd descriptor are JUDGMENT
// inputs — the seat reasons over them, it never manufactures a verdict from a label.
export const PLAN_AUDIT_CLASSES =
  `THE THREE CLASSES, GRADED: (1) a slice listed MISSING NEVER RAN — nothing resting on it may be stated as searched-clean, and nothing may describe what such a search would have shown; (2) a crowd-gated SKIPPED fringe is SANCTIONED (#361 — its parent proved intractable): the parent crowd is dilution context, never a searched-clean slice; (3) a CROWD/INCOMPLETE descriptor is a signal FOR JUDGMENT and never a verdict input — the lawyer's materiality reasoning over it STANDS (off-field, dilution evidence), and a state label never manufactures a CONDITIONAL by itself.`;

export function deriveCoverageSkeleton(plan, join) {
  const missing = new Set(join.missing);
  const stateByQid = new Map(join.executed.map((x) => [x.qid, x.state]));
  const skippedQids = new Set(join.skipped.map((x) => x.qid));
  const deferredQids = new Set((join.deferred ?? []).map((x) => x.qid));
  const axes = new Map();
  for (const e of plan.entries) {
    if (!axes.has(e.axis)) axes.set(e.axis, { axis: e.axis, entries: 0, executed: 0, crowds: 0, missing: [], skipped: 0, deferred: [] });
    const a = axes.get(e.axis);
    a.entries++;
    if (skippedQids.has(e.qid)) { a.skipped++; continue; }
    if (missing.has(e.qid)) { a.missing.push(e.qid); continue; }
    // a capability gap is NOT executed — it is a disclosed hole in the axis
    if (deferredQids.has(e.qid)) { a.deferred.push(e.qid); continue; }
    a.executed++;
    if (stateByQid.get(e.qid) === "incomplete") a.crowds++;
  }
  return [...axes.values()].map((a) => ({
    axis: a.axis,
    // `deferred` ranks BELOW `unexecuted` in urgency (nothing is left to run) but is just as far from
    // clean — findUnexecutedCleanClaims treats the two identically, so a `confirmed-clean` claim over an
    // axis holding a capability gap is still an impossible claim.
    // PR-11: an axis whose guard-active entries were ALL skipped (every `when` parent came back a crowd,
    // so nothing on the axis was ever dispatched) is its OWN state. It used to fall through to "executed"
    // — the arithmetic reads "0 missing, 0 crowds" and the honest reading of that is "nothing ran", not
    // "everything ran clean". Held to the same standard as `deferred` below: a clean cannot rest on it.
    state: a.missing.length ? "unexecuted"
      : (a.deferred.length ? "deferred"
        : (a.crowds ? "incomplete"
          : (a.executed === 0 && a.skipped > 0 ? "skipped" : "executed"))),
    entries: a.entries, executed: a.executed, crowds: a.crowds, skipped: a.skipped, missing: a.missing,
    ...(a.deferred.length ? { deferred: a.deferred } : {}),
  }));
}

/**
 * The F3 gate: `confirmed-clean` claimed over an axis the skeleton says did not fully execute.
 * `claimedRows` = the coverage rows [{axis, status}] (coverage-ledger.mjs shapes — on a fresh run they
 * are the coverage FORM's settled rows, on an archived run the prose table). Returns violations
 * [{axis, token}] with token `coverage_clean_unexecuted:<axis>` — a validator fail, never a silent flag.
 *
 * The invariant this gate protects is that a never-searched slice must not be SILENTLY SWALLOWED by a
 * clean claim — NOT that no clean claim may coexist with one.
 *
 * — THE `deferred` BRANCH LEFT THIS FUNCTION, AND IT IS FOLDED INTO findUnaccountedDeferredSlices
 * RATHER THAN DELETED. That branch was the one arm here carrying a DISCLOSURE JOIN
 * (undisclosedDeferredQids: every deferred qid had to appear verbatim in a non-clean row on its own
 * axis), and it fired ONLY where findUnaccountedDeferredSlices — same skeleton walk, same haystack, same
 * predicate, no clean-claim precondition — had already fired and returned first. Main's own doc block
 * called that pair a deliberate superset/subset. So the fold removes a token the validator could not
 * reach, not a check. THE FOLD IS PROVED BY THE REPLAY CORPUS, not by that argument: the corpus flips
 * only where the SUPERSET stops firing, and it comes back to 's 9 with the superset alone restored.
 * (The argument alone has a hole — this function keys its skeleton map on raw `s.axis` and the superset
 * trims, so an untrimmed skeleton axis would separate them. Degenerate, and no preserved run carries it.)
 *
 * `unexecuted` and `skipped` never had a disclosure join and are UNTOUCHED: `unexecuted` keeps its live
 * remedy (the hint itself offers "or the coverage actually ran"), and `skipped` means executed === 0, so
 * no clean row on that axis has any foundation at all. Both stay strict, and both are era-independent —
 * this is the ONE F3 function the stamped FORM path calls, because neither branch reads prose.
 */
export function findUnexecutedCleanClaims(claimedRows, skeleton) {
  const byAxis = new Map((skeleton ?? []).map((s) => [s.axis, s]));
  const out = [];
  for (const r of claimedRows ?? []) {
    if (String(r?.status ?? "").trim() !== "confirmed-clean") continue;
    const s = byAxis.get(String(r?.axis ?? "").trim());
    if (s && s.state === "unexecuted")
      out.push({ axis: s.axis, token: `coverage_clean_unexecuted:${s.axis}`, missing: s.missing });
    // PR-11: every entry gated out by its `when` parent (the parent slice came back a crowd) ⇒ the axis
    // never ran. Same standard as the two above — the slice was not searched, so a clean cannot rest on it.
    else if (s && s.state === "skipped")
      out.push({ axis: s.axis, token: `coverage_clean_skipped:${s.axis}`, missing: [] });
  }
  return out;
}

/**
 * THE OPEN CROWD BLOCKS, per axis — the discriminated `incomplete` calculation (copper-lattice
 * 2026-07-08), and the whole of what the coverage form's block rows are built from.
 *
 * An `incomplete` axis is USUALLY sanctioned (a plan-dictated count descriptor, a single saturated
 * slice — crowd = dilution for judgment, the settled doctrine), so a block is OPEN only on the
 * unverified shape: a plan-joined ENUMERATE entry whose multi-term OR-stack crowd lacks full per-term
 * accounting — some term neither verified-zero nor individually enumerated nor itself a crowd
 * (`term_counts`, the count-first truth from doEnumerate) — or, after the class split, a class leg whose
 * disposition is `unenumerated` / `error`. That is exactly the FROSTBERRY shape (a populated tractable
 * term nobody enumerated) and exactly not the shape (a 28k crowd, disposition "crowd", accounted).
 * Never open: count-kind entries, single-term crowds with no class truth, error:true blocks (they join
 * MISSING → the unexecuted gate), or qid-less judgment descriptors (the taint lane owns those).
 *
 * — THIS IS C2..C7, LIFTED OUT WHOLE AND SHARED BY BOTH ERAS. The conditions below are
 * byte-for-byte the ones findUnverifiedIncompleteCleanClaims applied; that function still exists,
 * directly below, and is now a thin C1 ∧ C8 wrapper around THIS call. ONE CALCULATION, NOT TWO: the
 * coverage form's block rows, the archived-run prose gate and the differential test all read this
 * function, so no copy of the firing predicate can drift from another.
 *
 * What the FORM path does differently is only what it no longer has to READ:
 *   · the `confirmed-clean` PRECONDITION (C1) moves to the filled form — the form is written BEFORE the
 *     stage dispatches, so it cannot be conditioned on an answer that does not exist yet. A block is
 *     open or it is not; whether a clean claim is being made over it is decided by rowIsSettled at the
 *     gate, per block row.
 *   · the DISCLOSURE JOIN (C8) is replaced by IDENTITY, not dropped. `blockIsDisclosed` (below) asks
 *     whether the model's prose CONTAINED this block's qid or its exact `total_hits` as a standalone
 *     number — two substring matches against text the model typed, one of which the skill taught in a
 *     shape (`~N,NNN hits`) neither could match. The driver writes that block its OWN form row now, so
 *     "a non-clean row naming this block" becomes "this block's row is non-clean". BLOCK-SPECIFIC
 *     EITHER WAY. What is deleted is the string matching, never the block specificity.
 *
 * @returns {{[axis: string]: Array<{qid, total_hits?, unaccounted?, unaccounted_classes?}>}} — axes with
 *   no open block are ABSENT from the object, never present-and-empty. PURE.
 */
export function openBlocksByAxis(skeleton, bandBlocksByAxis, plan) {
  const RESOLVED = new Set(["verified-zero", "enumerated", "crowd"]);
  const entriesByQid = new Map((plan?.entries ?? []).map((e) => [e.qid, e]));
  const out = {};
  for (const s of (skeleton ?? [])) {
    const axis = String(s?.axis ?? "").trim();
    if (!axis || s.state !== "incomplete") continue;
    const blocks = (bandBlocksByAxis?.[axis] ?? []).filter((b) => b && typeof b === "object");
    const unverified = [];
    for (const b of blocks) {
      if (String(b.state ?? "").toLowerCase() !== "incomplete") continue;
      if (b.error === true) continue;                       // joins MISSING → the unexecuted gate owns it
      const e = typeof b.qid === "string" ? entriesByQid.get(b.qid) : null;
      if (!e) continue;                                     // qid-less judgment descriptors: the taint lane owns those
      if (e.expected_kind === "count") continue;            // plan-dictated count crowd — sanctioned by doctrine
      // ── the per-CLASS sibling (F2 owner lane, 2026-07-29) — same replay purity as term_counts:
      // a pre-class-split band CANNOT carry class_counts, so absent means legacy, never unverified.
      // When the classSplitRescue ran, a class leg whose disposition is `unenumerated` (populated,
      // tractable, budget-cut — nobody enumerated it) or `error` is the FROSTBERRY shape one axis
      // over: a confirmed-clean claim swallowing a populated leg the descriptor itself says stayed
      // open. Fires on single-term entries too (the owner×formative slice is single-term + owner
      // scope) — the single-term carve-out below is about honest SATURATED slices, and a rescued
      // block carrying per-class truth is exactly not that.
      const cc = b.class_counts && typeof b.class_counts === "object" && !Array.isArray(b.class_counts) ? b.class_counts : null;
      const unaccountedClasses = cc
        ? Object.keys(cc).filter((c) => !RESOLVED.has(String(cc[c]?.disposition ?? ""))) : [];
      // count-first-gated (replay purity): a pre-count-first band CANNOT carry term_counts — absent
      // means legacy, not unverified (the 2026-07-10 corpus audit: marble-spire/copper-spire would
      // flip otherwise). Post-count-first every multi-term crowd carries it (the rescue attaches it
      // on the crowd path), so PARTIAL accounting — a term missing from the map, or a budget-cut
      // `unenumerated` / `error` disposition — is the live unverified shape this gate exists for.
      const terms = Array.isArray(e.terms) ? e.terms : null;
      const tc = terms && terms.length > 1
        && b.term_counts && typeof b.term_counts === "object" && !Array.isArray(b.term_counts) ? b.term_counts : null;
      const unaccounted = tc ? terms.filter((t) => !RESOLVED.has(String(tc?.[t]?.disposition ?? ""))) : [];
      if (!unaccounted.length && !unaccountedClasses.length) continue;
      // `total_hits` rides along because it was one of the TWO things that could DISCLOSE this block
      // under the deleted prose join (the qid, or this number standalone). Both are now written INTO the
      // form's row by the driver, so the equivalence the join had to test for is structural — see
      // coverage-form.mjs. The field stays because the row, the render and the failure token all carry it.
      unverified.push({ qid: e.qid,
        ...(Number.isInteger(Number(b.total_hits)) ? { total_hits: Number(b.total_hits) } : {}),
        ...(unaccounted.length ? { unaccounted: unaccounted.slice(0, 8) } : {}),
        ...(unaccountedClasses.length ? { unaccounted_classes: unaccountedClasses.slice(0, 8) } : {}) });
    }
    if (unverified.length) out[axis] = unverified;
  }
  return out;
}

// ── THE ARCHIVED-RUN PROSE JOINS ─────────────────────────────────────────────────────────────
//
// EVERYTHING BELOW JUDGES A MODEL-AUTHORED `## Coverage ledger` TABLE, AND NOTHING BELOW RUNS ON A RUN
// THAT HAS A COVERAGE FORM. verify.mjs branches ONCE, at the top of registerFindings, on the era stamp
// (`_driver/coverage-enum.json`.form_required): stamped ⇒ the form gate; unstamped ⇒ these.
//
// WHY THEY ARE BACK. The first cut of deleted them outright while arming the form CONDITIONALLY.
// `readCoverageFormInput` returns null on any run without BOTH a plan-execution receipt and a frozen
// plan — every archived run, every replay, and any live run whose plan apparatus was out of reach or
// whose arming write failed. On all of those the disclosure floor simply stopped existing. That is not
// an argument, it is a MEASUREMENT: the replay corpus flipped three preserved runs from
// `coverage_deferred_unaccounted` to ok — undisclosed deferred qids, slices the digest never named at
// all. Not one is a transcription failure, so each is the gate going quiet, which the design of record
// names as the one outcome that fails this build.
//
// A FLOOR IS NEVER DELETED UNCONDITIONALLY WHILE ITS REPLACEMENT IS CONDITIONAL. The old floor and the
// new gate are armed by the SAME condition, or the old one stays until the new one is unconditional.
//
// THE PRECEDENT IS ALREADY IN THIS BUILD. `parseCoverageLedgerFull` survives "with exactly one job —
// reading an ARCHIVED run's table". These are the joins that JUDGE what it reads: same standing, same
// single job. No form-armed run reaches them, so this is an ERA READER, not a legacy path kept alive
// beside a live one.
//
// COPIED VERBATIM from origin/main — the replay corpus compares verdict STRINGS, so a re-derivation
// differing by one character reads as a flip.

/**
 * Per-axis concatenation of every `coverage-limited` / `deferred` ledger row's unit + reason text —
 * the material a crowd block can be DISCLOSED in. `confirmed-clean` rows never contribute: a clean
 * claim is the thing being checked, so letting it supply its own disclosure would be circular. PURE.
 */
function disclosureTextByAxis(rows) {
  const byAxis = new Map();
  for (const r of rows ?? []) {
    const status = String(r?.status ?? "").trim().toLowerCase();
    if (status !== "coverage-limited" && status !== "deferred") continue;
    const axis = String(r?.axis ?? "").trim();
    if (!axis) continue;
    byAxis.set(axis, `${byAxis.get(axis) ?? ""} ${r?.unit ?? ""} ${r?.reason ?? ""}`);
  }
  return byAxis;
}

/**
 * Does `text` (an axis's disclosure material) identify THIS crowd block? Block-specific evidence only:
 *   - the plan qid, verbatim — the strongest join, and the one a machine-written row carries; or
 *   - the block's `total_hits` as a standalone number, bare (`6862`) or thousands-grouped with a comma,
 *     period, apostrophe, space or NBSP (`6,862` / `6 862` / `6'862`) — the form digests actually write.
 * Bounded by a standalone-number check on both sides so `774` never matches inside `67740` or a date.
 * A block with neither qid nor a positive total_hits is never disclosable ⇒ the gate fires (fail-closed).
 * PURE.
 */
function blockIsDisclosed(block, entry, text) {
  const hay = String(text ?? "");
  if (!hay.trim()) return false;
  const qid = typeof entry?.qid === "string" ? entry.qid.trim() : "";
  if (qid && hay.includes(qid)) return true;
  const hits = Number(block?.total_hits);
  if (!Number.isInteger(hits) || hits <= 0) return false;
  const SEP = "[,.'\\u00a0\\u202f ]";                        // comma, period, apostrophe, NBSP, narrow NBSP, space
  const digits = String(hits);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, SEP);
  return new RegExp(`(?<!\\d)(?<!${SEP}\\d)(?:${grouped}|${digits})(?!${SEP}?\\d)`).test(hay);
}

/**
 * Which of a deferred axis's qids does its own disclosure material NOT name? The F3 `deferred` branch's
 * disclosure join (see findUnexecutedCleanClaims).
 *
 * Evidence is the plan qid VERBATIM, and only that. A deferred entry never dispatched, so unlike the
 * incomplete gate there is no band block and no `total_hits` to fall back on — a number in the prose
 * could only ever be a coincidence.
 *
 * Returns `null` when the axis is FULLY disclosed (⇒ do not fire), otherwise the array of qids to name
 * in the violation. The two are distinguished deliberately: an empty array still fires. An axis whose
 * state is `deferred` carrying no `deferred` qids is a skeleton contradiction the builder cannot
 * produce, and the pre-join code fired on it with `missing: []` — silently passing it would be the one
 * way this join could turn a gate into a hole.
 *
 * Fail-closed otherwise: empty/absent disclosure text ⇒ every qid comes back undisclosed ⇒ the gate
 * fires exactly as it did before this join existed.
 * PURE.
 */
function undisclosedDeferredQids(skeletonAxis, text) {
  const qids = Array.isArray(skeletonAxis?.deferred) ? skeletonAxis.deferred.filter((q) => typeof q === "string" && q.trim()) : [];
  if (!qids.length) return [];                              // contradiction ⇒ fire, as the pre-join code did
  const hay = String(text ?? "");
  if (!hay.trim()) return qids;
  const undisclosed = qids.filter((q) => !hay.includes(q.trim()));
  return undisclosed.length ? undisclosed : null;           // null ⇒ fully disclosed ⇒ do not fire
}

/**
 * — A DEFERRED SLICE IS A ROW THE DIGEST OWES, NOT A DISCLOSURE IT MAY OFFER.
 *
 * findUnexecutedCleanClaims (below) fires only where a `confirmed-clean` row already exists on the axis.
 * That made the accounting conditional on the digest volunteering a claim: a ledger that simply said
 * nothing about a deferred slice — no clean row, no disclosure row, the slice absent from the file
 * entirely — passed every gate in the run. The reasons were on disk before the stage dispatched, and
 * the run's own output was allowed not to mention them.
 *
 * This is the same requirement `coverage_axis_missing` already imposes one field over (an activated axis
 * MUST own a row) applied to the unit the plan actually recorded as unsearchable. The question "what
 * happened to this slice?" is asked by the plan; the ledger row is the answer, and a stage does not get
 * to leave it blank. Every deferred qid must be named, verbatim, by a non-clean row on its own axis.
 *
 * WHY THIS AND NOT A LOUDER HINT. The doctrine already reached the stage as advice on the first dispatch
 * (deferredSlicesRequiredRows, formerly the A8 "hint") and the stage claimed clean anyway, then complied
 * the moment the identical fact came back as a validator failure — R1 681s→202s, R2 515s→77s, every
 * prelim run that reaches the digest. A fact that is obeyed as a failure and ignored as an input is not
 * being said too quietly; it is being offered rather than required. So it is required here.
 *
 * DELIBERATELY A SUPERSET of the deferred branch below, and the older gate is kept rather than folded
 * in: it still owns `unexecuted` and `skipped`, and it stays the backstop for any ledger this check
 * cannot see (no receipt, replay, archived run). Same join helpers as that gate — disclosureTextByAxis
 * and undisclosedDeferredQids — so the two can never drift into disagreeing about what "accounted for"
 * means. That is the failure names in a different file: one rule, written down twice.
 *
 * Returns violations [{axis, token: `coverage_deferred_unaccounted:<axis>`, missing: qids[]}].
 * Fail-closed: no disclosure material ⇒ every qid comes back unaccounted. Inactive with no skeleton.
 * PURE.
 */
export function findUnaccountedDeferredSlices(claimedRows, skeleton) {
  const disclosedByAxis = disclosureTextByAxis(claimedRows);
  const out = [];
  for (const s of skeleton ?? []) {
    if (String(s?.state ?? "").trim() !== "deferred") continue;
    const axis = String(s?.axis ?? "").trim();
    if (!axis) continue;
    const missing = undisclosedDeferredQids(s, disclosedByAxis.get(axis));
    // null ⇒ every deferred qid is named by a non-clean row on this axis ⇒ the slice is accounted for.
    if (missing) out.push({ axis, token: `coverage_deferred_unaccounted:${axis}`, missing });
  }
  return out;
}

/**
 * The discriminated `incomplete` gate (copper-lattice 2026-07-08) for a run with NO coverage form —
 * C1 ∧ openBlocksByAxis ∧ C8, and a WRAPPER rather than a second copy. openBlocksByAxis above is
 * C2..C7 verbatim; this restores the two conditions the form expresses structurally instead:
 *
 *   C1  the row claiming clean — the old gate iterated the model's ledger rows and looked at an axis
 *       only where some row already said `confirmed-clean`.
 *   C8  blockIsDisclosed — the block's own qid, or its `total_hits` as a standalone number, inside the
 *       axis's non-clean disclosure text. BLOCK-SPECIFIC. A row about slice A discharges block B only
 *       where A's text happens to name B; the mere presence of a non-clean row discharged nothing, and
 *       reading it as if it did reopens the FROSTBERRY hole through an unrelated slice's disclosure.
 *
 * The old body iterated blocks inline and pushed one violation per clean ROW; this pushes the same,
 * with the same token, so verify.mjs's axis-dedupe sees the same input. PURE.
 */
export function findUnverifiedIncompleteCleanClaims(claimedRows, skeleton, bandBlocksByAxis, plan) {
  const open = openBlocksByAxis(skeleton, bandBlocksByAxis, plan);
  const entriesByQid = new Map((plan?.entries ?? []).map((e) => [e.qid, e]));
  const disclosedByAxis = disclosureTextByAxis(claimedRows);
  const out = [];
  for (const r of claimedRows ?? []) {
    if (String(r?.status ?? "").trim() !== "confirmed-clean") continue;            // C1
    const axis = String(r?.axis ?? "").trim();
    const undisclosed = (open[axis] ?? [])
      .filter((b) => !blockIsDisclosed(b, entriesByQid.get(b.qid), disclosedByAxis.get(axis)));   // C8
    if (undisclosed.length)
      out.push({ axis, token: `coverage_clean_unverified_incomplete:${axis}`, blocks: undisclosed });
  }
  return out;
}
