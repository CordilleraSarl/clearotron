// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// variant-manifest-model.mjs — strict parser for the prelim-variants stage's machine output
// (variant-manifest.json, the structured SIBLING of variant-manifest.md).
//
// WS2 (F2 — reproducible search): the model reasons ONCE about what to search (elements,
// variants, transliterations, incumbent context) and emits this structured sibling alongside its
// prose manifest — the blind-frame-model.json precedent. CODE then compiles the deterministic
// register plan from it (register-plan.mjs): same manifest ⇒ byte-identical plan ⇒ reproducible
// recall. The prose manifest stays the human/audit surface; THIS is the machine contract.
//
// PURE (no node imports) → tests offline. Mirrors blind-frame-model.mjs / findings-model.mjs:
// strict key allowlists, closed enums, token-FIRST throws the corrective/warm ladder keys on.

// The script vocabulary the register plan and the register providers share — a non-Latin variant is
// the one that needs a romanisation, and this is the single definition of which those are. formKey is
// the compiler's own romanisation-lookup fold: the mark-restatement check below must promise exactly
// what compileRegisterPlan's lookup will find, so they share the one definition.
// script-form.mjs is itself PURE (no node imports, no vendor code), so this module stays offline.
import { formKey, isNonLatinTerm, romanizationRefusal } from "../providers/_shared/script-form.mjs";
import { termMarkupIssue, termAnnotationIssue } from "../providers/_shared/term-shape.mjs";   // PURE too — this module stays offline
import { requiredScriptsFor, isInScript } from "./registration-scripts.mjs";   // item 21 — the per-script floor's reference data
// — the search floor designates AXES, and this is the one list of them. Imported rather than
// retyped: a retyped enum drifts silently the day an axis is added, and the designation would then name
// something no ledger row can carry. coverage-ledger.mjs has no imports at all, so this module stays PURE.
import { REGISTER_AXES } from "./coverage-ledger.mjs";

// distinctive = the anchor the sweep enumerates; common = a crowd word (count-only descriptor);
// saturated-common = a common word the model already knows is a mega-crowd (still count-only —
// the kinds differ only in rationale, both compile to count probes, never enumerates).
export const ELEMENT_KINDS = ["distinctive", "common", "saturated-common"];
// core = the mark / a spacing-punctuation form of it; phonetic/visual = confusable neighbours;
// transliteration/numeric = the non-Latin / digit-substitution family (compiled to the
// transliteration-numeric axis); composite = the element inside a larger mark.
//
// — THE DOCTRINE'S FOUR UNIVERSAL TAGS ARE WRITABLE. The variants doctrine
// (prelim-variants SKILL.md, "Universal categories") tells the seat to tag rows `exact-phrase`,
// `exact-element`, `plural-root` and `formative-family`, and this enum refused every one — a manifest
// that obeyed the doctrine literally failed the stage, so seats substituted (`other` on one run,
// `composite` in the fixture corpus) and the family lane's contains-not-exact mandate had nothing to
// bind to: three root-shaped strings were dispatched exact on a measured run, and a root swept exact
// is a root not swept. The dispatch mapping for these lives in register-plan.mjs (the doctrine's own
// table states it: exact-phrase sweeps exact; the other three sweep contains, never exact-only).
export const VARIANT_CATEGORIES = ["core", "phonetic", "visual", "transliteration", "numeric", "composite", "other",
  "exact-phrase", "exact-element", "plural-root", "formative-family"];

const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const MODEL_KEYS = ["schema_version", "mark", "dominant_element", "elements", "variants", "incumbent_classes", "watchlist_owners", "search_floor"];
// The watchlist-owner seeds the register plan's OWNER LANE compiles from (F2, 2026-07-29): the
// Step-5 watchlists a run must COVER on the register (aggressive_enforcers ∪ competitors ∪ the
// matter-context watchlist-owner seeds; never the client). Bounded so a runaway list fails the
// stage loudly (the corrective ladder trims it) instead of compiling an unbounded query fan-out —
// the same 24 the supplemental lane caps an axis at; the postmortem run's fifteen owners fit with room.
export const WATCHLIST_OWNERS_MAX = 24;
const ELEMENT_KEYS = ["value", "kind"];
// `romanization` — the Latin-script form of a NON-LATIN `value`, and the whole reason the
// transliteration axis can be executed at all (see the doc block on variantRomanizationGaps below).
// Optional in the schema so a legacy manifest still parses on resume/replay; REQUIRED by verify.mjs
// of a manifest minted under the romanisation-carriage prompt (the driver-written stage-contract
// marker — never mere run freshness), which is where a missing one belongs (the corrective ladder
// re-prompts the stage).
const VARIANT_KEYS = ["value", "category", "rationale", "romanization"];

function checkKeys(obj, allowed, tokenPrefix) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new Error(`${tokenPrefix}:${short(k)} (keys are EXACTLY: ${allowed.join(", ")})`);
  }
}

/**
 * Strict-parse the variant-manifest model. Returns the normalized object
 * `{schema_version, mark, dominant_element, elements[], variants[], incumbent_classes[]}`.
 * Throws on ANY defect, offending token FIRST:
 *   variantmodel_unparseable | variantmodel_key_unknown:<key> | variantmodel_mark_missing
 *   | variantmodel_dominant_element_missing | variantmodel_element_key_unknown:<key>
 *   | variantmodel_element_kind_invalid:<kind> | variantmodel_variants_empty
 *   | variantmodel_variant_key_unknown:<key> | variantmodel_category_invalid:<cat>
 *   | variantmodel_incumbent_classes_invalid | variantmodel_romanization_invalid:<value>
 *   | variantmodel_romanization_orphan:<value> | variantmodel_search_floor_invalid:<axis>
 */
export function parseVariantManifestModel(raw) {
  let m;
  try { m = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (e) { throw new Error(`variantmodel_unparseable: ${short(e.message)}`); }
  if (!m || typeof m !== "object" || Array.isArray(m))
    throw new Error("variantmodel_unparseable: top level must be a JSON OBJECT");
  checkKeys(m, MODEL_KEYS, "variantmodel_key_unknown");

  const mark = String(m.mark ?? "").trim();
  if (!mark) throw new Error("variantmodel_mark_missing: carry the mark under search verbatim");
  const dominant_element = String(m.dominant_element ?? "").trim();
  if (!dominant_element) throw new Error("variantmodel_dominant_element_missing: name the distinctive anchor the sweep enumerates");

  const elements = Array.isArray(m.elements) ? m.elements : [];
  const outElements = elements.map((e) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("variantmodel_unparseable: every element must be a plain object");
    checkKeys(e, ELEMENT_KEYS, "variantmodel_element_key_unknown");
    const kind = String(e.kind ?? "").trim().toLowerCase();
    if (!ELEMENT_KINDS.includes(kind))
      throw new Error(`variantmodel_element_kind_invalid:${short(e.kind)} (one of: ${ELEMENT_KINDS.join(", ")})`);
    const value = String(e.value ?? "").trim();
    if (!value) throw new Error("variantmodel_unparseable: every element needs a non-empty value");
    return { value, kind };
  });

  const variants = Array.isArray(m.variants) ? m.variants : null;
  if (!variants || !variants.length)
    throw new Error("variantmodel_variants_empty: at least one variant (the mark's search family — core/phonetic/visual/…)");
  const outVariants = variants.map((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("variantmodel_unparseable: every variant must be a plain object");
    checkKeys(v, VARIANT_KEYS, "variantmodel_variant_key_unknown");
    const category = String(v.category ?? "").trim().toLowerCase();
    if (!VARIANT_CATEGORIES.includes(category))
      throw new Error(`variantmodel_category_invalid:${short(v.category)} (one of: ${VARIANT_CATEGORIES.join(", ")})`);
    const value = String(v.value ?? "").trim();
    if (!value) throw new Error("variantmodel_unparseable: every variant needs a non-empty value");
    // The romanisation is validated HERE, on the object that also carries the native value, so the
    // pair can never come apart. Two failure shapes, both the model substituting rather than answering:
    //   * a romanisation that is not plain ASCII (leftover native script, tone marks, diacritics) —
    //     it would ride the wire as a second unsearchable string;
    //   * an ORPHAN — a romanisation attached to a Latin-script value. That row's romanisation belongs
    //     to some OTHER row, and accepting it would let the compiler swap a real Latin term for a
    //     transliteration of a different string (the connotation-query look-alike, in a new place).
    const romanization = typeof v.romanization === "string" ? v.romanization.normalize("NFC").replace(/\s+/g, " ").trim() : "";
    if (romanization) {
      const refusal = romanizationRefusal(romanization);
      if (refusal) throw new Error(`variantmodel_romanization_invalid:${short(v.romanization)} (${refusal})`);
      if (!isNonLatinTerm(value))
        throw new Error(`variantmodel_romanization_orphan:${short(value)} — a romanization belongs ONLY on a non-Latin value; "${short(value)}" is already Latin script, so this romanization is the transliteration of a DIFFERENT row. Put each romanization on the row whose value it romanises, or drop it.`);
    }
    return { value, category, rationale: typeof v.rationale === "string" ? v.rationale : "",
      ...(romanization ? { romanization } : {}) };
  });

  let incumbent_classes = [];
  if (m.incumbent_classes != null) {
    if (!Array.isArray(m.incumbent_classes) || !m.incumbent_classes.every((c) => typeof c === "string" || typeof c === "number"))
      throw new Error("variantmodel_incumbent_classes_invalid (an array of Nice-class strings, or omitted)");
    incumbent_classes = m.incumbent_classes.map(String);
  }

  // Optional watchlist-owner seeds (dedup case-insensitively, order preserved — the compiler mints
  // deterministic owner-lane qids from these, so normalization lives HERE, once).
  let watchlist_owners = [];
  if (m.watchlist_owners != null) {
    if (!Array.isArray(m.watchlist_owners) || !m.watchlist_owners.every((o) => typeof o === "string"))
      throw new Error("variantmodel_watchlist_owners_invalid (an array of owner-name strings, or omitted)");
    const seen = new Set();
    for (const raw of m.watchlist_owners) {
      const o = String(raw).replace(/\s+/g, " ").trim();
      if (!o) throw new Error("variantmodel_watchlist_owners_invalid (every owner is a non-empty string)");
      const key = o.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      watchlist_owners.push(o);
    }
    if (watchlist_owners.length > WATCHLIST_OWNERS_MAX)
      throw new Error(`variantmodel_watchlist_owners_invalid (${watchlist_owners.length} owners exceed the ${WATCHLIST_OWNERS_MAX}-owner bound — keep the NAMED watchlists only: aggressive enforcers, competitors, matter-context seeds)`);
  }

  // ── — THE SEARCH FLOOR, AS A TYPED DESIGNATION ────────────────────────────────────────────────
  //
  // The axes this mark's search floor obliges: work a `coverage-limited` row may not demote. It replaces
  // the ⭐ marker retired, and it is deliberately NOT that marker in a new place.
  //
  // WHY AXES AND NOT SWEEPS. The old mechanism marked manifest LINES and joined them to coverage rows by
  // tokenising the line and matching words against the row's text. That join is why it needed the manifest
  // as free text at all, and it is what made it impossible to carry through conversion 3. A coverage row
  // is `{axis, scope, status, reason}` and only `axis` is typed — `scope` is a sentence the register seat
  // writes, which this stage cannot predict and must not try to match. So axis is not a coarser
  // compromise: it is the granularity at which BOTH sides are typed, and the only one where the join
  // cannot go quietly wrong.
  //
  // WHY IT IS DESIGNATED HERE AND JUDGED ELSEWHERE. prelim-variants designates; prelim-register writes the
  // coverage row that either honours it or does not. Different stage, earlier turn, before any outcome is
  // known — which is the whole mechanism. A floor field on the coverage row itself would let the seat that
  // missed the work also decide the work was never obliged: the self-grading loophole rebuilt inside its
  // own fix.
  //
  // ABSENT MEANS NONE, AND NONE IS THE DEFAULT. No floor designated ⇒ no breach and no disclosure. A floor
  // that defaulted to on would manufacture the hold on every run and be worse than the widening it closes.
  let search_floor = [];
  if (m.search_floor != null) {
    if (!Array.isArray(m.search_floor))
      throw new Error(`variantmodel_search_floor_invalid:${short(m.search_floor)} (an ARRAY of axis names, or omitted — omitted means this mark designates no floor)`);
    const seen = new Set();
    for (const raw of m.search_floor) {
      const a = String(raw ?? "").trim().toLowerCase();
      if (!REGISTER_AXES.includes(a))
        throw new Error(`variantmodel_search_floor_invalid:${short(raw)} (EXACTLY one of: ${REGISTER_AXES.join(", ")} — the floor designates an AXIS, because that is the only field a coverage row types)`);
      if (seen.has(a)) continue;
      seen.add(a);
      search_floor.push(a);
    }
  }

  return {
    schema_version: m.schema_version ?? 1,
    mark,
    dominant_element,
    elements: outElements,
    variants: outVariants,
    incumbent_classes,
    watchlist_owners,
    search_floor,
  };
}

/**
 * The non-Latin TERMS this manifest cannot put to a register that indexes filings by their
 * transliteration: variants that arrived without a romanisation, plus a non-Latin mark or
 * dominant_element that NO romanised variant restates. Returns the offending values (deduped, order
 * preserved — variants first, then mark/dominant); [] means every term the plan will compile from
 * this manifest is executable on either kind of register.
 *
 * WHY IT IS A GATE AND NOT A SHRUG (a clearance run, 2026-07-29): the compiled plan carried thirteen
 * raw non-Latin terms on the transliteration-numeric axis with no Latin form anywhere on the entry.
 * The active register indexes non-Latin filings by their transliteration and refused all thirteen —
 * correctly, because searching the characters there returns 0 with no error and reads as CLEAN — so
 * the axis produced zero coverage while the Latin members of the same axis ran fine. The romanisation
 * is not an enrichment: without it the term is unanswerable on half the providers we ship, and the
 * only reason it is not a false clean is a refusal we must never have to rely on.
 *
 * WHY THE MARK/DOMINANT CHECK IS CODE, NOT PROSE (2026-07-30 review round): "mark" and
 * "dominant_element" have no romanization slot of their own — the stage prompt instructs the model to
 * restate a non-Latin mark as a `core` variant carrying it, and the compiler reads every term's
 * romanisation off the variant that states it (value-keyed on formKey, the shared fold). Nothing
 * enforced that the restatement EXISTS, so a model that ignored the instruction passed the floor while
 * every primary-sweep entry for the mark itself — exact, +merch, the dominant parent — reached a
 * transliteration-indexed provider bare: the same zero-coverage shape this gate exists to close, on
 * the most important axis, guarded by prose only. The check mirrors the compiler's own lookup exactly:
 * covered means "a variant whose formKey equals the mark's carries a romanisation", which is precisely
 * when compileRegisterPlan will stamp the mark's entries.
 *
 * It is checked at the STAGE GATE (verify.mjs — gated on the driver-written stage-contract marker,
 * i.e. on the artifact having been minted under the romanisation-carriage prompt, never on run
 * freshness) rather than in the parser, because the answer is "the model must say it", which is what
 * the corrective ladder is for; making the parser throw would also kill the resume of any run minted
 * before the field existed, and replay verdicts over archived runs must never flip. PURE.
 */
export function variantRomanizationGaps(model) {
  const out = [], seen = new Set();
  const flag = (value) => { if (!seen.has(value)) { seen.add(value); out.push(value); } };
  for (const v of model?.variants ?? []) {
    const value = String(v?.value ?? "").trim();
    if (!value || !isNonLatinTerm(value)) continue;
    if (String(v?.romanization ?? "").trim()) continue;
    flag(value);
  }
  const restated = new Set((model?.variants ?? [])
    .filter((v) => String(v?.romanization ?? "").trim())
    .map((v) => formKey(String(v?.value ?? ""))));
  for (const t of [model?.mark, model?.dominant_element]) {
    const value = String(t ?? "").trim();
    if (!value || !isNonLatinTerm(value)) continue;
    if (!restated.has(formKey(value))) flag(value);
  }
  return out;
}

/**
 * — every manifest value the plan compiles into a LITERAL search term that carries markup or a
 * `, etc.` enumeration. Returns [value…] (deduped, order preserved), [] when the manifest is clean.
 *
 * WHY IT IS A STAGE GATE AND NOT ONLY A PLAN SCREEN. The fold screen and the compiler's disclosed-
 * deferred row both stop the nil search, and neither one tells the stage that AUTHORED the string.
 * A `**`-wrapped variant silently becomes a deferred row and the manifest still says the family was
 * covered — the search shrinks and nothing asks for it back. This arm hands the reason to the
 * corrective ladder in-turn, so prelim-variants restates the term while the run is still cheap: the
 * half of the issue's first acceptance criterion the plan-side screen cannot reach.
 *
 * MARKUP ARM ONLY, deliberately. The prose/long-form arm is legitimately shielded for a slogan mark
 * (manifest provenance is the term_literal authority) and already becomes a disclosed deferred row
 * for a variant, so firing the stage gate on it would refuse manifests the compiler handles correctly.
 *
 * TWO THINGS ARE NOT WALKED, and both would make this floor unremediable rather than corrective:
 *
 *   `mark` — the stage is told to emit it VERBATIM, and it arrives from the job, whose door checks
 *   the mark's presence and never its shape. So a markup-carrying mark is a value this stage CANNOT
 *   restate: the ladder would hand back the reason, the model would re-emit the dictated mark, and
 *   the stage would die with no remedy available to it. It is still screened — push()'s markupGap
 *   makes it a disclosed deferred row, and the fold screen and the executor still refuse it — but by
 *   the lane that discloses, not by the lane that re-prompts. Only model-AUTHORED values belong here,
 *   which is also where the incident string came from.
 *
 *   `watchlist_owners` — those compile to `predicate:"owner"`, exempt from every term rule because
 *   owner names are prose by nature ("Delphi Technologies (BorgWarner Inc.)").
 */
// — `termAnnotationIssue` moved to term-shape.mjs, the ONE term vocabulary, so the plan
// compiler applies the SAME predicate this gate does rather than a second copy of it.

export function variantTermShapeGaps(model) {
  const out = [], seen = new Set();
  const flag = (value) => { if (value && !seen.has(value)) { seen.add(value); out.push(value); } };
  // `dominant_element` and `elements[]` are MARKUP **and ANNOTATION**, because nothing downstream
  // shields them. Only two compiler push sites carry a `dropIssue` (register-plan.mjs primary-sweep and
  // transliteration-numeric, both from `variants`), so a prose-shaped VARIANT becomes a disclosed
  // deferred row and costs nothing. These two fields compile as BARE terms at four push sites —
  // primary-sweep, incumbent-class, the form bands and the distinctive-element loop — reach
  // validatePlanFeasibility as `unexecutable` on a freshly minted plan, and throw StageFailure. That is
  // a whole run lost at the compiler for a note the authoring stage could have deleted in one re-ask.
  {
    const value = String(model?.dominant_element ?? "").trim();
    if (value && (termMarkupIssue(value) || termAnnotationIssue(value))) flag(value);
  }
  for (const e of model?.elements ?? []) {
    const value = String(e?.value ?? "").trim();
    if (value && (termMarkupIssue(value) || termAnnotationIssue(value))) flag(value);
  }
  // `variants` stay MARKUP-ONLY, unchanged and deliberately — see the note above this function. Their
  // prose/long-form arm is legitimately shielded for a slogan variant and already becomes a disclosed
  // deferred row, so firing the stage gate on it would refuse manifests the compiler handles correctly.
  for (const v of model?.variants ?? []) {
    const value = String(v?.value ?? "").trim();
    if (value && termMarkupIssue(value)) flag(value);
  }
  return out;
}

// ── A7 — the COMPLETENESS floor: the funnel must be dumb AND complete ────────────────────────────────

// The variant categories EVERY mark's search family states, whatever the mark: `core` (the mark / its
// spacing-punctuation forms — the restatement the compiler's own lookups key on), `phonetic` (sound-alike
// neighbours) and `visual` (look-alike neighbours). The context-dependent categories are deliberately NOT
// here — `numeric` needs a digit-substitutable mark, `composite` an element inside a larger mark,
// `transliteration` is governed by the per-script arm below — because a floor that demands what a mark
// cannot have teaches the model to fabricate rows to pass a gate.
export const VARIANT_CATEGORY_FLOOR = ["core", "phonetic", "visual"];

/**
 * What this manifest FAILS to state of the search family the register plan compiles from. Returns
 * gap tokens (deduped, category arm first): `category:<cat>` for each VARIANT_CATEGORY_FLOOR member
 * with no variant, and `script:<term>` for a non-Latin mark / dominant_element / element with no
 * `transliteration`-category variant at all. [] means the family is structurally complete.
 *
 * WHY (E2E-R2 VENZY, addendum A7): parseVariantManifestModel requires ≥1 variant ONLY, so a manifest
 * carrying one row passed the parser and the plan compiled a funnel that searched almost nothing —
 * primary-sweep thinned to the mark plus one neighbour, the transliteration-numeric axis empty — with
 * no gate anywhere saying so. The funnel is DUMB by design (code compiles exactly what the manifest
 * states, no model in the loop); dumb is only safe when the input is COMPLETE, so completeness gets
 * its own floor.
 *
 * NO RANKING, NO JUDGMENT — deliberately. This floor never says which variant matters, which neighbour
 * bites, or how many rows a category deserves: one stated row satisfies each arm, and materiality stays
 * judgment's call downstream (the same division as the form-neighbourhood floor: enumerating is the
 * machine's job, reasoning about what bites is not this gate's).
 *
 * Checked at the STAGE GATE (verify.mjs), armed by the driver-written stage-contract marker exactly as
 * the romanisation floor is — its own `completeness` key, never the romanisation one and never run
 * freshness — so archived runs keep their verdicts and only an output minted under the floor-stating
 * prompt is held to it. PURE.
 */
export function variantCompletenessGaps(model, { jurisdictions = [] } = {}) {
  const out = [], seen = new Set();
  const flag = (token) => { if (!seen.has(token)) { seen.add(token); out.push(token); } };
  const have = new Set((model?.variants ?? [])
    .map((v) => String(v?.category ?? "").trim().toLowerCase()).filter(Boolean));
  for (const cat of VARIANT_CATEGORY_FLOOR) if (!have.has(cat)) flag(`category:${cat}`);
  // Per-script arm: a non-Latin term among the terms the plan compiles from (mark, dominant_element,
  // elements) puts NOTHING on the transliteration-numeric axis unless its transliteration family is
  // stated — the axis rides ONLY on transliteration/numeric-category variants, so for these marks a
  // missing category is not a thin family, it is a whole axis compiled empty, silently.
  const nonLatin = [model?.mark, model?.dominant_element, ...(model?.elements ?? []).map((e) => e?.value)]
    .map((t) => String(t ?? "").trim()).filter((t) => t && isNonLatinTerm(t));
  if (nonLatin.length && !have.has("transliteration")) for (const t of nonLatin) flag(`script:${short(t)}`);

  // ── item 21 — THE PER-SCRIPT FLOOR ────────────────────────────────────────────────────────────────
  //
  // The arm above catches a NON-LATIN mark with no transliteration family at all. It says nothing about
  // the commoner and more dangerous case: a LATIN mark searched in a territory that registers marks in
  // another script. A conflicting Chinese rendering of the same mark sits on the CN register under
  // characters this manifest never states, so the funnel never asks for it and the report reads clean.
  //
  // The requirement is per SCRIPT, not per category: `transliteration` present is not the same claim as
  // "there is a Han rendering here". A manifest can carry three Cyrillic transliterations and satisfy a
  // category floor while stating nothing at all for a Chinese-language market in scope.
  //
  // ONE RENDERING PER SCRIPT, NOT A COUNT — the floor asks whether the script is represented, never how
  // richly. Which renderings bite is judgment's, downstream.
  //
  // WHICH scripts is reference data a person maintains (registration-scripts.mjs), and it is the scripts
  // a mark could plausibly be REGISTERED in, not every script a territory uses: Japan is Latin plus
  // katakana, not four writing systems, because katakana is what a foreign word mark actually holds
  // there. A floor that demands what a mark cannot have teaches the model to fabricate rows to pass it —
  // the same reason VARIANT_CATEGORY_FLOOR leaves out the context-dependent categories.
  //
  // VALIDATES, NEVER GENERATES. This returns a gap and the stage regenerates its manifest. Nothing here
  // invents a term: the moment code mints a search term, judgment has moved into the funnel and we are
  // searching something no one can defend the provenance of.
  const required = requiredScriptsFor(jurisdictions);
  if (Object.keys(required).length) {
    const stated = [
      ...(model?.variants ?? []).map((v) => String(v?.value ?? "")),
      ...(model?.variants ?? []).map((v) => String(v?.romanization ?? "")),
      String(model?.mark ?? ""), String(model?.dominant_element ?? ""),
      ...(model?.elements ?? []).map((e) => String(e?.value ?? "")),
    ].filter(Boolean);
    for (const [script, territories] of Object.entries(required))
      if (!stated.some((v) => isInScript(v, script))) flag(`script-coverage:${script}:${territories.join("+")}`);
  }
  return out;
}
