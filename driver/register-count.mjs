// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-count.mjs — STAGE 0.5, the register hit-count lane.
//
// A knockout (Depth 1) sweeps the open web and the marketplaces and says nothing about the registers,
// by design. Depth 2 adds ONE FACT per mark: how many filings on the register match it. Not an
// analysis, not a rating, not a clearance — a count. On a list of twenty candidate names it separates
// "nobody has filed anything like this" from "there are forty of these already" before anyone reads a
// word, and it does so at a fraction of the cost of clearing twenty names properly.
//
// ══ THE THREE RULES ════════════════════════════════════════════════════════════════════════════════
//
// 1. NO MODEL TOUCHES THE NUMBER. Code asks the register, code writes the sidecar, code renders the
//    column. Not one figure passes through a bounded turn output, so the transcription defect class
//    (execute-plan.mjs's grid_spec_path move) cannot exist here. The assess stage is not shown the
//    counts at all — it would only be able to restate or round them, and a model's "around forty"
//    beside code's "37" is a contradiction on the face of a deliverable.
//
// 2. A COUNT WE COULD NOT TAKE IS NEVER ZERO. Every failure path carries `total: null` plus a reason,
//    and the surfaces render "not available". A provider that cannot count at all
//    (capabilities.countProbe "none") does not degrade to zeroes: the lane REFUSES before spending
//    anything (see countPreflight) — that is the owner ruling, and it is the difference between a
//    degraded answer and a wrong one.
//
// 3. THE NUMBER IS NEVER BANDED. No colour, no threshold, no "high/low". The moment a count carries a
//    rating it reads as a legal opinion, and Depth 2 has done none of the work that would support
//    one — no status weighing, no goods comparison, no owner analysis, no judgment at all. A clearance
//    is lawyer judgment; this is arithmetic. The two must not be dressed alike.
//
// ══ WHAT THE NUMBERS MEAN ══════════════════════════════════════════════════════════════════════════
//
// Three counts per mark, because no one of them carries the answer: `identical` alone under-reports a
// name that is everywhere in near-miss form, a breadth count alone cannot say whether the name itself
// is taken, and neither of the two sees the near-miss that is not a substring.
//
//   identical  — the mark IS the name (the provider's exact predicate).
//   containing — the register's BROAD NAME MATCH for the name (its contains/default predicate). A
//                breadth proxy and labelled as exactly that: it is NOT "similar" and NOT
//                "confusable". Confusability is a judgment this product does not make, and a column
//                header claiming it would sell the judgment without doing it.
//   close      — filings found by running the EXACT predicate again over a bounded list of classic
//                near-forms of the name, generated in code (register-variants.mjs) and printed beside
//                the figure. It closes the gap counsel named: "containing" catches literal containment
//                only, so ALKEMIST for ALCHEMIST is invisible to both of the columns above.
//
//                IT IS AN AGGREGATE, NOT A PREDICATE THE REGISTER HAS. No provider in the wired set is
//                asked a fuzzy question — every call under this column is the same exact predicate the
//                `identical` column uses, over a different term, so the number means the same thing on
//                every deployment. A native near-miss predicate is a per-provider upgrade for later,
//                declared in a capability contract once it has been probed; it is not this.
//
//                And it is still not a similarity judgment. A form was asked about; that is all. Which
//                of the filings it found would actually block anything is lawyer work this lane does
//                not do — the same line the "containing" column has held since launch.
//
// The wording of the second one is deliberately looser than "substring", and the looseness is the
// honest part. Clarivate's default IS a literal infix (`*term*`, WORD_MARK_SPECIFICATION). Corsearch's
// unprefixed clause is described by its own contract as "contains-style" — a hedge, because whether it
// is strictly a substring or a relevance match has not been probed. Claiming the narrower meaning
// would over-specify a number on one provider, in the direction that matters (a broader match makes
// the figure larger, and a client reading "appears inside" would take that as literal). Verify it on
// the first live batch; if it is broader than a substring, declare the divergence in the capability
// contracts the way `countStatusFilter` is declared, and keep ONE wording for both.
//
// STATUS: filings of ANY status, both providers. Clarivate can narrow a count to live filings
// (queryOptions.activeOnly) and Corsearch cannot (no status clause exists in its query language), so
// using it would make one column mean "live filings" on one deployment and "all filings" on another,
// with nothing on the page to tell them apart. Both capability contracts declare the divergence
// (`countStatusFilter`) and the product ignores it. One product, one meaning.
//
// SCOPE: class-scoped when the request names classes (per-mark classes beat the batch's), and every
// row records which it was — an unscoped count across all 45 classes is a bigger, more frightening
// and less useful number than the honest one. Multi-class costs the same single call on both
// providers (capabilities.classFilter "native"). Territory scope is the run's own; a worldwide run
// counts worldwide where the provider allows it (corsearch) and is refused up front where it does not
// (clarivate requires regions[]).
//
// COST: one call per mark per SIMPLE predicate, plus one per generated variant form. The close column
// is where the multiplier lives — a 20-mark batch was 40 calls and is now 40 + (20 × forms), which at
// the ≤12 cap is at most 280. On Clarivate those are POST /count (cheap, no records fetched); on
// Corsearch each is a BILLABLE page-0 search, so a Corsearch deployment pays up to 7× what it paid for
// this lane before. That delta is the input to the pricing decision, and it is stated per call in the
// run's own receipts ledger — every variant probe writes its own line carrying `variant_form`, so the
// multiplier is read off the ledger rather than inferred from a single aggregate row.
//
// The forms are bounded by the generator's cap (VARIANT_CAP, 12) and typically well under it: a real
// mark generates 3–8. `CLEAROTRON_KNOCKOUT_VARIANT_CAP` lowers it per deployment; nothing raises it above
// the code cap, because the ceiling is a spend guarantee and a knob that can lift it is not one.

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { kebab } from "./search-policy.mjs";
import { resolveRegions } from "./register-plan.mjs";
import { reachableRegions } from "./register-availability.mjs";   // — pure; the env binding is injected
import { variantForms, VARIANT_RULES, VARIANT_CAP } from "./register-variants.mjs";
import { isCapabilityGap } from "../providers/_shared/execute-plan.mjs";

/** The three questions, in report order. `matchMode` is the provider-neutral predicate name.
 *
 *  `expansion: "variants"` marks the ONE predicate that is not a single provider call: close variations
 *  is an aggregate over N exact-predicate probes, one per generated form (register-variants.mjs). The
 *  marker exists because four consumers walk this table assuming one predicate is one call and one
 *  number — the probe loop below, the receipts ledger line, the workbook column and report-data.json —
 *  and each has to treat the aggregate deliberately rather than inherit the simple path by accident. */
export const COUNT_PREDICATES = Object.freeze([
  Object.freeze({ key: "identical",  matchMode: "exact",   label: "Identical", column: "Identical filings", glance: "identical" }),
  Object.freeze({ key: "containing", matchMode: "default", label: "Containing", column: "Filings containing the name", glance: "containing" }),
  // `glance` is not `label` lower-cased for this one, and the difference is the whole sentence: "12 close
  // variations" reads as twelve VARIATIONS, and the figure is twelve FILINGS found across them.
  Object.freeze({ key: "close",      matchMode: "exact",   label: "Close variations", column: "Filings on close variations", glance: "on close variations", expansion: "variants" }),
]);

/** What the numbers count, in one client-safe sentence. Rendered verbatim on every surface. */
export const COUNT_BASIS = "Filings on the register of any status, counted by name only — "
  + "“identical” is the name itself; “containing” is the register's broad name match for it; "
  + "“close variations” is the same exact search run again over a bounded list of classic near-forms of "
  + "the name (spelling, doubling and letter-swap variants), generated in code and listed with the figure. "
  // "RATES", NOT "WEIGHS" (owner,): weighed is not a term this product uses with a
  // client. The DISCLAIMER is what this sentence is for and it is unchanged — a count does not assess
  // and does not decide — and "rates" says it in the page's own vocabulary, since a rating is exactly
  // what the finding cards beside these numbers carry and exactly what a count is not.
  + "A count is not an assessment: it rates nothing and decides nothing.";

/**
 * May Depth 2 run AT ALL, here, now? Called before any spend — the doc-27 preflight discipline.
 * Returns null when the lane may run, else a sentence naming what is missing.
 *
 * Both refusals are STRUCTURAL: no retry, no rung of any recovery ladder and no amount of budget
 * changes them, so failing one mark at a time would be twenty identical failures and a report with an
 * empty column where the product was.
 */
export function countPreflight({ capabilities, jurisdictions, credentialPresent = true, hasAdapter = true, missing = [], unreachable = [] }) {
  const id = capabilities?.id ?? "unknown";
  if (capabilities?.countProbe === "none" || !hasAdapter)
    return `the active register provider (${id}) cannot count: it exposes no total anywhere in its responses, so every figure would be an honest UNKNOWN rather than a number. `
      + `A register hit-count screen cannot be run on it — a count nobody took must never be rendered as "no filings found". Run the plain "knockout" level, or switch the register provider.`;
  if (!credentialPresent) {
    // NAME THE VARIABLE. This used to say "the <provider-id> credential", which on a
    // multi-variable provider names the provider and not the thing that is missing. On the free tier it
    // read "the free-tier credential is absent" when EUIPO's id and secret were both present and correct
    // and the absent variable was USPTO_LOCAL_DB — so an operator with a fully configured EU half went
    // looking for an EUIPO credential fault. missingCredentials() already knows the answer; the caller
    // passes it, and an empty list keeps the old wording for a single-key provider whose name IS the
    // variable's subject.
    const named = Array.isArray(missing) && missing.length ? missing.join(" + ") : `the ${id} credential`;
    return `${named} is absent from the driver env — the register count cannot run. Set it, or run the plain "knockout" level.`;
  }
  // regions[] is mandatory on some providers (clarivate), and buildSearchRequest refuses every call
  // without it. Say so once, before the batch starts, rather than twenty identical failures deep.
  //
  // This NO LONGER catches a worldwide run. It used to, and that was the missing translation wearing a
  // refusal: resolveRegions handed every provider corsearch's shorthand for worldwide (an EMPTY region
  // filter), so a worldwide matter on clarivate had nothing to send and the only honest move left was
  // to refuse it. resolveRegions now compiles worldwide to the provider's own full office list, so the
  // count sweeps every covered register — which is what /count is built for (per-office counts in one
  // call, at any magnitude). What survives here is the case that is still genuinely unrunnable: every
  // territory the matter NAMED falls outside the provider's coverage, so regions is empty with
  // deferrals beside it, and there is no honest scope left to count in.
  //
  // — THIS ARM WAS DEAD, AND THE DEAD ARM WAS THE FREE TIER'S.
  //
  // It was gated on `capabilities.regionsRequired`, and `git grep -n regionsRequired -- providers/`
  // returns nothing: no provider in this repo declares it — not euipo, not uspto-local, not free-tier.
  // So the one refusal that catches "every territory this matter named is outside the provider's
  // coverage" could never fire on the tier a stranger runs. A matter naming Japan alone on the free tier
  // counted over the EU and the US instead and reported figures, with nothing on any rendered surface
  // saying Japan was not among them.
  //
  // The gate is now the COVERAGE, which is what the sentence was always about; `regionsRequired` is a
  // wire-protocol fact about one vendor and was never the right key. Empty coverage refuses before
  // spend, partial coverage discloses — the boundary ruled for on 2026-08-12, applied to the other
  // half of the same question.
  //
  // WORLDWIDE IS NOT EMPTY. `resolveRegions` returns `regions: []` for BOTH "no territory filter" and
  // "every named territory was deferred", and its `worldwide` flag is the only thing that tells them
  // apart. Reading the empty list alone would refuse every worldwide run on every provider — which is
  // the same conflation had to thread `worldwide` through `reachableRegions` to avoid.
  {
    const { regions, deferred, worldwide } = resolveRegions(jurisdictions, capabilities);
    if (!regions.length && !worldwide && (jurisdictions ?? []).length) {
      const named = deferred.length ? deferred.map((d) => d.jurisdiction) : (jurisdictions ?? []);
      const one = named.length === 1;
      return `this run names ${one ? "one territory" : `${named.length} territories`} (${named.join(", ")}), `
        + `${one ? `which ${id} does not cover` : `none of which ${id} covers`}, so there is no scope left to `
        + `count in. Counting over the territories it DOES cover would answer a question nobody asked and `
        + `read as though it covered the ones ordered. Name a territory ${id} covers, or switch the register provider.`;
    }
  }
  // — EMPTY COVERAGE REFUSES EARLY; PARTIAL COVERAGE DISCLOSES (owner ruling, 2026-08-12).
  //
  // The check above is about the CONTRACT: territories the provider does not cover. This one is about
  // the BOX: territories it covers and this deployment cannot reach, because a member is unconfigured.
  // The two are deliberately separate sentences — "the free tier does not search Japan" and "this
  // install cannot reach the US register" send an operator to different places, and is the report
  // of what happens when a refusal names the wrong one.
  //
  // Only the EMPTY case refuses. A scope with one reachable office left runs over it and discloses the
  // rest (countRegisterHits below) — that is the whole point of the ruling, and refusing here on a
  // partial would put back exactly the behaviour was filed about. `unreachable` empty ⇒ this block
  // cannot fire at all, so every single-source provider and every wired composite is untouched.
  //
  // BEFORE SPEND is the reason it lives in a preflight rather than in the lane: the caller throws
  // StageFailure on a non-null return, and that happens before the first paid frame turn.
  if ((unreachable ?? []).length) {
    const r = resolveRegions(jurisdictions, capabilities);
    const { regions: reachable, dropped } = reachableRegions(
      r.regions, unreachable, capabilities?.offices?.covered, r.worldwide === true);
    // `dropped.length` is load-bearing, not belt-and-braces: reachable is ALSO empty when every named
    // territory fell outside the provider's coverage, and that is a different refusal with a different
    // remedy. Refusing here would name USPTO_LOCAL_DB at someone who ordered Japan.
    if (!reachable.length && dropped.length) {
      const vars = [...new Set(dropped.flatMap((d) => d.missing ?? []))];
      return `every register this run asked for (${dropped.map((d) => d.office).join(", ")}) is covered by `
        + `${id} but unreachable on this deployment — the source that serves it `
        + `(${[...new Set(dropped.map((d) => d.memberId))].join(", ")}) is not wired up here`
        + `${vars.length ? ` (${vars.join(" + ")} unset)` : ""}. There is no office left to count in, so `
        + `every figure would be an UNKNOWN and the column would be empty. Set the variable and re-run, `
        + `order a search this deployment covers, or run the plain "knockout" level.`;
    }
  }
  return null;
}

// bounded-concurrency fan-out — the runBatched idiom, local copy (pipeline.mjs's is private and
// pipeline-knockout.mjs keeps its own for the same reason). A non-finite limit collapses to 1 worker,
// never to zero: Array.from({length: NaN}) is [], and a typo'd env var must never skip the batch.
async function runBatched(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const cap = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  const workers = Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return results;
}

/**
 * The $0 dev/e2e executor: a directory of <mark-kebab>.json files, each { identical: 3, containing: 41 }
 * (a null or absent value = a probe that could not be taken). Mirrors CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES —
 * the same guarantee, that a dev instance never bills a register.
 */
function fixtureCounter(dir) {
  return async (mark, predicate) => {
    let doc;
    try { doc = JSON.parse(readFileSync(join(dir, `${kebab(mark)}.json`), "utf8")); }
    catch (e) { return { ok: false, total: null, reason: `count fixture missing for ${kebab(mark)}: ${e.message}` }; }
    // THE KEY IS THE QUESTION ASKED, NOT THE COLUMN IT FEEDS. A variant probe asks the provider's
    // EXACT predicate about a generated form, so its fixture is that form's own file under `identical`
    // — there is no "close" figure for a single form, and looking one up would make every fixture run
    // report the close column as unavailable while the live path counted it perfectly well. A $0 lane
    // that cannot exercise a column is a lane that stops testing it.
    const key = predicate.expansion === "variants" ? "identical" : predicate.key;
    const v = doc?.[key];
    if (!Number.isFinite(v)) return { ok: false, total: null, reason: `count fixture for ${kebab(mark)} carries no ${key} figure` };
    return { ok: true, total: v, probe: "fixture" };
  };
}

/** One predicate's prior cell may be reused when it landed or is a DETERMINISTIC gap.
 *
 *  PER PREDICATE, not per entry, and that is the whole point of the split (review, 2026-08-11). This
 *  used to be an all-or-nothing test over the whole row, so ADDING a predicate re-probed every mark in
 *  every prior sidecar: on Corsearch each of those is a billable page-0 search, and nothing would have
 *  errored — a resume would simply have cost twice for two answers it already held. Reuse is now decided
 *  cell by cell, so a schema-1 sidecar keeps its identical/containing figures and pays only for the
 *  close-variation column that did not exist when it was written.
 *
 *  The expansion predicate carries a second condition: its total is an aggregate over a FORM SET, so a
 *  cell counted under a different set is not the same answer. It is reused only when the forms recorded
 *  beside it are exactly the forms this build generates today. */
function cellSettled(cell, predicate, forms = null) {
  if (!cell) return false;
  if (!(Number.isFinite(cell.total) || cell.deterministic === true)) return false;
  if (predicate.expansion === "variants") {
    const had = (cell.forms ?? []).map((f) => f.form).join("|");
    const now = (forms ?? []).map((f) => f.form).join("|");
    if (had !== now) return false;
  }
  return true;
}

/**
 * Count register hits for every mark in the batch.
 *
 * @param marks        [{ name, classes? }] — the frozen plan's rows (per-mark classes win over batch).
 * @param classes      the batch's Nice classes (fallback when a mark names none).
 * @param jurisdictions the run's territories (null/[] = worldwide).
 * @param counter      async (mark, predicate, { classes, regions }) => { ok, total, reason }
 *                     — normally driver.config's provider adapter; injected by tests and by fixtures.
 * @param prior        a previously written sidecar to resume from (settled marks are not re-billed).
 * @param unreachable — [{ office, memberId, missing }] the box cannot reach, from
 *                     register-unreachable.mjs. INJECTED, not read here, for the same reason
 *                     `requirementsFor` is injected into unavailableOffices: this module stays pure and
 *                     there stays exactly one binding of the member→variable lookup. Default [] ⇒
 *                     every existing caller and every single-source provider is byte-identical.
 * @returns the sidecar document, ready to write. It NEVER throws for one mark: a failed probe is a
 *          null with a reason. The caller decides what a batch-wide failure means.
 */
export async function countRegisterHits({
  marks, classes = null, jurisdictions = null, provider, capabilities,
  counter, concurrency = 3, ledgerPath = null, prior = null, now = () => new Date(),
  variantCap = VARIANT_CAP, unreachable = [],
}) {
  const { regions: coveredRegions, deferred, worldwide } = resolveRegions(jurisdictions, capabilities);
  // — the office split the plan lane does at compile, done here, because this lane compiles no
  // plan. Without it the composite fans every probe out to a member that is not configured, that member
  // refuses, and the composite correctly declines to return a partial sum — so a box with a working EU
  // half reports every count as unavailable. countPreflight already refused the case where NOTHING is
  // reachable, so a non-empty `dropped` here means real coverage survives and rides the disclosure.
  const { regions, dropped } = reachableRegions(coveredRegions, unreachable, capabilities?.offices?.covered, worldwide === true);
  // What every mark row carries so `countLine` can say it. Per-mark rather than doc-level because the
  // renderers call `countLine(countsForMark(doc, name))` and see one row — the same reason `classScope`
  // and `classes` are already copied onto every row. ABSENT when nothing was dropped, so an archived
  // doc and a fully wired box render byte-identical.
  const officeScope = dropped.length
    ? { counted: regions, uncounted: dropped.map((d) => ({ office: d.office, memberId: d.memberId, missing: [...(d.missing ?? [])] })) }
    : null;
  const priorByName = new Map((prior?.marks ?? []).map((m) => [String(m.name), m]));
  const batchClasses = (Array.isArray(classes) ? classes : []).filter((n) => Number.isInteger(n));

  const rows = await runBatched(marks ?? [], concurrency, async (m) => {
    const name = String(m?.name ?? "").trim();
    const own = (Array.isArray(m?.classes) ? m.classes : []).filter((n) => Number.isInteger(n));
    const scoped = own.length ? own : batchClasses;
    const reused = priorByName.get(name);
    const variants = variantForms(name, { cap: variantCap });

    // ONE PROBE = ONE PROVIDER CALL = ONE LEDGER LINE. Extracted so the aggregate predicate below bills,
    // records and degrades through exactly the same path as the two simple ones — a second copy of this
    // for the variant loop is how the two would come to disagree about what a failure means.
    const probe = async (term, p, { form = null } = {}) => {
      const started = Date.now();
      let r;
      try { r = await counter(term, p, { classes: scoped, regions }); }
      catch (e) { r = { ok: false, total: null, reason: `count threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
      const ok = Boolean(r?.ok) && Number.isFinite(r?.total);
      // A CLIENT-SIDE refusal (the provider's query language cannot express this question — a term
      // carrying parentheses, an office outside its vocabulary) is
      // deterministic: no retry and no resume can change it, so it settles rather than re-billing.
      const deterministic = !ok && (isCapabilityGap(r?.reason) || Boolean(r?.unsupported));
      if (ledgerPath) {
        try {
          appendFileSync(ledgerPath, JSON.stringify({
            ts: now().toISOString(), mark: name, predicate: p.key, match_mode: p.matchMode,
            // THE BILLABLE UNIT IS THE FORM, so the form is on the line. A close-variation row costs N
            // calls, not one, and the receipts ledger is where that multiplier is read off — a single
            // aggregate line would report one call and understate the bill by a factor of N.
            ...(form ? { term, variant_form: form } : {}),
            classes: scoped, regions, provider, probe: r?.probe ?? null,
            ok, total: ok ? r.total : null, took_ms: Date.now() - started,
            ...(ok ? {} : { cause: String(r?.reason ?? "unknown").slice(0, 300) }),
          }) + "\n");
        } catch { /* receipts are best-effort, never fatal — same as the sweep ledger */ }
      }
      return ok
        ? { total: r.total }
        : { total: null, unavailable: String(r?.reason ?? "the count could not be taken").slice(0, 300), ...(deterministic ? { deterministic: true } : {}) };
    };

    // The aggregate: the provider's EXACT predicate, once per generated form, summed.
    //
    // A PARTIAL SUM IS NOT AN ANSWER. If any form's probe failed, the sum is a lower bound wearing the
    // clothes of a total — a smaller, confident-looking number over a name that may be everywhere. That
    // is the same defect as a zero for an untaken count, one step along, so it lands the same way: total
    // null, the reason names how many forms went missing, and every form that DID land keeps its own
    // figure in the artifact so nothing measured is thrown away.
    const probeVariants = async (p) => {
      if (!variants.forms.length) {
        // TWO WAYS TO GET HERE, and they are not the same fact. The name genuinely has no near-form
        // under any rule (a bare number, a single letter) — or the CAP was unusable and zeroed the set,
        // which on a typo'd `CLEAROTRON_KNOCKOUT_VARIANT_CAP` would otherwise disable the whole column while
        // reporting it as a property of the client's name. `generated` counts the forms the rule table
        // produced BEFORE the cap, so the two are distinguishable and the reason says which.
        const capped = variants.generated > 0;
        return { total: null, forms: [], generated: variants.generated, counted: 0, truncated: variants.truncated,
          // OMITTED rather than `false` when the cap is at fault, matching every other cell on this
          // lane: a deterministic gap settles and is never re-billed, and a misconfigured cap is the one
          // "empty set" a resume MUST re-take once the variable is fixed.
          ...(capped ? {} : { deterministic: true }),
          unavailable: capped
            ? `the close-variation form cap is set to ${variantCap}, which admits no forms — the rule table generated ${variants.generated} for "${name}" and every one was cut. Check ${VARIANT_CAP_ENV}; this is a configuration fault, not a property of the name`
            : `no close-variation forms could be generated from "${name}" — the name has no near-form under any rule in the table, so there was nothing to count` };
      }
      // SERIAL, deliberately — the parallelism is the outer per-mark batch's, and it stays the outer
      // batch's. Fanning out here too would multiply: `concurrency` marks × up to 12 forms is 36 calls
      // in flight against a register sized for 3, and the way that fails is not an error — a rate-limited
      // provider returns transient failures, a transient failure nulls the whole close column, and the
      // product silently loses the number it was rebuilt to add. Peak in-flight is unchanged from the
      // two-predicate lane; only the wall-clock of the count step grows.
      const results = await runBatched(variants.forms, 1, async (f) => ({
        form: f.form, rules: [...f.rules], ...(await probe(f.form, p, { form: f.form })),
      }));
      const landed = results.filter((f) => Number.isFinite(f.total));
      const missed = results.filter((f) => !Number.isFinite(f.total));
      const base = { forms: results, generated: variants.generated, counted: landed.length, truncated: variants.truncated };
      if (missed.length) {
        return { ...base, total: null,
          // Deterministic only when EVERY miss was deterministic — one retryable failure in the set
          // means a resume can still complete this cell, and settling it would freeze the gap in.
          ...(missed.every((f) => f.deterministic === true) ? { deterministic: true } : {}),
          unavailable: `${missed.length} of ${results.length} variant form(s) could not be counted, so the total would understate — ${missed.slice(0, 3).map((f) => `${f.form}: ${f.unavailable}`).join(" · ")}` };
      }
      return { ...base, total: landed.reduce((n, f) => n + f.total, 0) };
    };

    const counts = {};
    let reusedCells = 0;
    for (const p of COUNT_PREDICATES) {
      // A settled prior cell is REUSED, never re-probed: on a billing provider a resume would otherwise
      // pay twice for the same answer (the sweep's per-mark payload resume, applied to counts).
      const prev = reused?.counts?.[p.key];
      if (cellSettled(prev, p, variants.forms)) { counts[p.key] = prev; reusedCells++; continue; }
      const cell = p.expansion === "variants" ? await probeVariants(p) : await probe(name, p);
      // WHY A SETTLED CELL WAS BOUGHT AGAIN. The only way a landed aggregate is re-probed is a changed
      // form set — a lowered cap, or an edited rule table — and on a billing provider that is a second
      // full fan-out with nothing on the artifact to explain the charge. A re-bill nobody can account
      // for is the same defect class as a figure nobody can audit, so it says so here.
      if (p.expansion === "variants" && Number.isFinite(prev?.total))
        cell.reprobedBecause = `the generated form set changed since the prior run (was ${(prev.forms ?? []).length} form(s), now ${variants.forms.length}) — a total counted over a different set is a different answer, so it was re-taken rather than carried forward`;
      counts[p.key] = cell;
    }
    return {
      name,
      classes: scoped.length ? scoped : null,
      classScope: scoped.length ? (own.length ? "mark" : "batch") : "all-classes",
      counts,
      // — which registers these figures cover, present ONLY when one was dropped. countLine renders
      // it; the scope block below records it. Both, deliberately: `scope.deferredJurisdictions` has sat
      // on this artifact since it was written and NOTHING reads it, which is the same shape as 's
      // `deferred_coverage` riding the plan with no consumer and shipping a false clean. A field a
      // reader never sees is not a disclosure, so this one lands on the rendered line first.
      ...(officeScope ? { officeScope } : {}),
      // — territories the matter ordered that this provider does not cover AT ALL. Present only
      // when there are some, and carried per mark for the same reason officeScope is: countLine is the
      // one surface the client reads these figures on, and it is handed an entry, not the document.
      //
      // NOT the same fact as officeScope above, and the two must never be fused. That one is a register
      // this provider covers and this BOX cannot reach; this one is a register the provider never
      // covered. An operator sent to the wrong one looks for a fault that is not there — is the
      // report of exactly that.
      ...(deferred.length ? { deferredScope: deferred.map((d) => d.jurisdiction) } : {}),
      // The generated set, recorded whether or not the aggregate landed: the report prints WHICH forms
      // were checked, and a number whose forms are not on the page is unauditable (owner ruling).
      variants: { cap: variantCap, generated: variants.generated, truncated: variants.truncated, forms: variants.forms.map((f) => f.form) },
      ...(reusedCells === COUNT_PREDICATES.length ? { reused: true } : {}),
    };
  });

  return {
    schema: 1,
    provider, providerLabel: capabilities?.label ?? provider,
    takenAt: now().toISOString(),
    basis: COUNT_BASIS,
    predicates: COUNT_PREDICATES.map((p) => ({ key: p.key, label: p.label, column: p.column, matchMode: p.matchMode, ...(p.expansion ? { expansion: p.expansion } : {}) })),
    // The rule table this build generated forms from, stamped into the artifact. A form set is only
    // auditable against the rules that produced it, and those rules will change — an archived run must
    // re-render against the table it was counted under, not against today's.
    variantRules: VARIANT_RULES.map((r) => ({ id: r.id, label: r.label })),
    variantCap,
    scope: {
      jurisdictions: (jurisdictions ?? []).length ? jurisdictions : null,
      regions: regions.length ? regions : null,          // [] = no territory filter (worldwide)
      deferredJurisdictions: deferred.length ? deferred.map((d) => d.jurisdiction) : null,
      // — covered by the provider, unreachable on this box. NOT the same fact as the line above:
      // that one is territories the provider does not cover at all, this one is territories it covers
      // and this install cannot reach. An operator sent to the wrong one of those looks for a fault
      // that is not there, which is exactly what was reported as.
      ...(officeScope ? { unreachableOffices: officeScope.uncounted } : {}),
      classes: batchClasses.length ? batchClasses : null,
    },
    marks: rows,
  };
}

/** How many marks got at least ONE number. Zero of them means the product did not happen. */
export function countedMarks(doc) {
  return (doc?.marks ?? []).filter((m) => COUNT_PREDICATES.some((p) => Number.isFinite(m?.counts?.[p.key]?.total))).length;
}

/** The counts for one mark, by name — the publisher's join. Absent mark ⇒ null, never zeroes. */
export function countsForMark(doc, name) {
  const key = String(name ?? "").trim().toLowerCase();
  return (doc?.marks ?? []).find((m) => String(m.name).trim().toLowerCase() === key) ?? null;
}

/**
 * The one-line, client-safe rendering of a mark's counts. Code-owned wording, used by the report and
 * the email so they can never phrase the same fact two ways.
 *
 * Deliberately plain: figures and what they counted, no adjective anywhere. "3 identical, 41
 * containing the name" is the whole sentence. A number that could not be taken says so.
 *
 * — AND A NUMBER TAKEN OVER PART OF THE ORDERED SCOPE SAYS THAT. Since the count lane started
 * splitting off registers this deployment cannot reach, a free tier with no US index returns a real EU
 * figure where it used to return "not available". That is the improvement, and on its own it would be a
 * worse lie than the refusal it replaces: a confident number, smaller than the truth, reading as though
 * it covered everything ordered. The two ship together or not at all. This is the only surface the
 * client sees the figures on, so it is the only place the qualification can honestly go — the artifact
 * fields beside it are for the operator and are demonstrably not read.
 *
 * Office CODES, not names: `scope.regions` on the same artifact is already codes, and the alternative
 * is inventing a display layer that has to stay in step with the office vocabulary of six providers.
 */
export function countLine(entry) {
  if (!entry?.counts) return null;
  const parts = COUNT_PREDICATES.map((p) => {
    const c = entry.counts[p.key];
    const word = p.glance ?? p.label.toLowerCase();
    if (Number.isFinite(c?.total)) return `${c.total} ${word}`;
    return `${word}: not available`;
  });
  const scope = entry.classScope === "all-classes"
    ? "all classes"
    : `class${(entry.classes ?? []).length === 1 ? "" : "es"} ${(entry.classes ?? []).join(", ")}`;
  const uncounted = entry.officeScope?.uncounted ?? [];
  const counted = entry.officeScope?.counted ?? [];
  // Only when a register was actually dropped. `counted` can be empty here only on a doc written before
  // countPreflight's empty-coverage refusal existed, so it is worded to stay true either way rather than
  // printing "counted in :" — an archived artifact must not render a sentence with a hole in it.
  const one = uncounted.length === 1;
  const officeNote = uncounted.length
    ? ` ${counted.length ? `Counted in ${counted.join(", ")} only` : "Counted in no register"} — `
      + `${uncounted.map((u) => u.office).join(", ")} ${one ? "is" : "are"} covered by this register but `
      + `${one ? "was" : "were"} not searched on this system, so ${one ? "its" : "their"} filings are not `
      + `in these figures. It is a gap in the count, never a finding of none.`
    : "";
  // — the territories the matter ORDERED that this register does not cover at all. Its own
  // sentence, never merged with the one above: "the free tier does not search Japan" and "this install
  // cannot reach the US register" are different facts with different remedies, and a reader given the
  // wrong one goes looking for a fault that is not there.
  //
  // On the rendered line rather than only in `scope.deferredJurisdictions`, which has been written by
  // both Depth 2 lanes since they were built and which `git grep` finds no reader for. A field nobody
  // sees is not a disclosure — that is 's defect exactly, where `deferred_coverage` rode the plan
  // and the run shipped an EU-only clean with no row saying the US register was never searched.
  const deferred = entry.deferredScope ?? [];
  const oneDeferred = deferred.length === 1;
  const coverageNote = deferred.length
    ? ` ${deferred.join(", ")} ${oneDeferred ? "was" : "were"} ordered for this matter and ${oneDeferred ? "is" : "are"} `
      + `outside this register's coverage entirely, so ${oneDeferred ? "it was" : "they were"} not counted `
      + `and no filing from ${oneDeferred ? "it" : "them"} could appear here. Counting ${oneDeferred ? "that territory" : "those territories"} `
      + `needs a register that covers ${oneDeferred ? "it" : "them"}.`
    : "";
  return `Register filings (${scope}): ${parts.join(", ")}.${officeNote}${coverageNote}`;
}

/** The counted variant forms for one mark, as one line — code-owned wording so the report, the workbook
 *  and report-data.json can never describe the same set three ways.
 *
 *  It says how many forms and names them, and it says when the cap TRUNCATED the set: a figure counted
 *  over 12 of 19 possible forms is a different fact from one counted over all of them, and the reader
 *  who can see the forms is the only one who can tell.
 *
 *  Null when the mark has no expansion cell at all (an archived schema-1 run) — an absent set renders
 *  nothing rather than "0 forms", which would read as a name with no near-forms. */
export function variantFormsLine(entry) {
  const cell = entry?.counts?.close;
  if (!cell || !Array.isArray(cell.forms)) return null;
  if (!cell.forms.length) {
    // TWO WAYS TO HAVE NO FORMS, and only one of them is a fact about the client's name. The cell has
    // separated them since the column shipped — `generated` counts what the rule table produced BEFORE
    // the cap, and `unavailable` says which case this is — but that guard stopped at the artifact. This
    // line is the half a reader sees, on the report, in the workbook and in report-data.json, and it
    // rendered BOTH as "this name has no near-forms": on a misconfigured cap, a false statement about
    // the mark, while the only true account of it sat in a hover title over the "not available" cell.
    //
    // An absence must not read as a finding — the rule the whole column is built on. "No near-forms
    // exist for this name" IS a finding, and a run that generated seven of them has not made it.
    return cell.generated > 0
      ? `Close variations: none were searched — the rule table produced ${cell.generated} near-form`
        + `${cell.generated === 1 ? "" : "s"} for this name and this run's form cap admitted none of them. `
        + "A fault in this run's configuration, not a property of the name; the reason is in the audit workbook."
      : "Close variations: no near-forms could be generated from this name, so nothing was counted.";
  }
  const forms = cell.forms.map((f) => f.form).join(" · ");
  const truncated = entry?.variants?.truncated
    ? ` (the ${entry.variants.generated} generated forms were capped at ${entry.variants.cap})`
    : "";
  // ASKED IS NOT COUNTED. A partial sweep nulls the total on purpose (a sum over a half-answered set is
  // a lower bound wearing the clothes of a total), so this line sits beside a column reading "not
  // available" — and calling the forms "counted" there tells the reader the searches ran and only the
  // arithmetic went missing. Some of them never ran, and the line that lists the forms is the only
  // place that can say which. Keyed off the cell's own total, so the sentence and the column can never
  // disagree about whether there is a figure.
  if (Number.isFinite(cell.total)) return `Close variations counted${truncated}: ${forms}.`;
  const missed = cell.forms.filter((f) => !Number.isFinite(f.total));
  // The missing forms are NAMED only when naming them adds something. On a capability gap every form
  // misses, and repeating the list it has just printed makes the one sentence a reader has to parse
  // twice as long and no more informative.
  const which = missed.length === cell.forms.length
    ? `None of the ${cell.forms.length} could be counted, so no total is shown`
    : `${missed.length} of ${cell.forms.length} could not be counted (${missed.map((f) => f.form).join(" · ")}), so no total is shown`;
  return `Close variations searched${truncated}: ${forms}. `
    + (missed.length ? which : "No total is shown for them on this run")
    + " — the per-form reason is in the audit workbook.";
}

/** The env knob that narrows the variant cap — named here so a refusal can quote it rather than
 *  describing "the cap" and leaving an operator to grep for which variable that is. */
export const VARIANT_CAP_ENV = "CLEAROTRON_KNOCKOUT_VARIANT_CAP";

// THE FIXTURE SEAM IS A PARAMETER, NOT THE ENVIRONMENT. It was
// `process.env.CLEAROTRON_KNOCKOUT_COUNT_FIXTURES`, read here, in shipped code — so whether a run called a
// real register was decided by ambient state with nothing on the artifact to say so. The job declares it
// now, and a fixture run carries that fact on its own record.
//
// THIS LANE HAD NO PARAMETER AT ALL while its sibling in register-records.mjs already had one that
// nobody passed. The asymmetry was the work: the two lanes are composed together and read as a pair.
// `recordLog` — passed even though no core writes a record BODY from a count today. The address
// travels with the call on every adapter method for one reason: a core that starts writing one would
// otherwise write it to the box-global fallback, where the run-dir reader never looks and nothing throws.
export function resolveCountExecutor({ counter = null, adapter = null, agentId = null, sessionKey = null, recordLog = null, fixtureDir = null } = {}) {
  if (typeof counter === "function") return { count: counter, source: "injected" };
  if (fixtureDir) return { count: fixtureCounter(fixtureDir), source: `fixtures:${fixtureDir}` };
  if (typeof adapter?.countHits !== "function") return { count: null, source: "none" };
  return {
    source: "provider",
    count: (mark, predicate, { classes, regions }) =>
      adapter.countHits({ name: mark, matchMode: predicate.matchMode, classes, regions }, { agentId, sessionKey, recordLog }),
  };
}
