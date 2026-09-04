// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// search-policy.mjs — the PRODUCT selection registry (the "config spine").
//
// One registry answers "WHICH machinery does this job run?" for every door (email intake, ops-MCP
// start_run, the portal, the CLI) and every consumer (runner admission gate, pipeline freeze, publish
// stamps, the recipe service, the composer UI). Two dimensions:
//   - a PRODUCT (one of the four in the offering — products.mjs) picks the pipeline SHAPE;
//   - COMPONENTS are the closed, pipeline-scoped toggles a product (or a saved customer recipe) carries.
// The golden rule: a product/recipe selects MACHINERY — how wide and deep we
// search. It never overrides customer config and can never touch rating authority (framework, appetite,
// delivery). That boundary is structural here: RECIPE_KEYS ∩ KNOWN_PROFILE_KEYS = ∅ (unit-tested), so a
// recipe file physically cannot name a rating-adjacent knob.
//
// ── THE DEPTH LADDER IS GONE ─────────────────────────────────────────────────────────────────────────────────
//
// There used to be a second vocabulary here: a closed set of LEVELS (`knockout`, `knockout-register`,
// `prelim`, `prelim-jx`) with a display face reading "Depth 1"…"Depth 5", ordered by effort. A client
// bought a level; the thing they were sold — a knockout, a worldwide preliminary, a single-country deep
// dive — was a different word that appeared on no wire. The two disagreed in the one place it mattered:
// `prelim` named THREE products depending on where it pointed, and the composer's own footer had to
// invent labels ("Deep dive — United States", "Full clearance") for distinctions "the registry has no
// word for". The registry now has the word. The level menu, its numbering, its ordering and the
// `searchLevel` wire field are DELETED — not deprecated, not hidden behind the product name.
//
// What a product IS, is products.mjs (the offering: geography, case law, native language, name count).
// What a product RUNS, is here. The split is the same one that has always separated "which product is
// this" from "may it run HERE, NOW", and it is why this file can stay a leaf: products.mjs is pure data
// and pure functions, so the arrow runs one way and there is no cycle.
//
// PURE LEAF: node builtins plus products.mjs (itself pure). profiles.mjs, enqueue-schema.mjs, runner.mjs,
// pipeline.mjs and the mcp-server all import THIS module, never the reverse.
//
// BETA POSTURE: runs delivered under the old numbering KEEP it — an archived run re-renders through
// RETIRED_POLICIES below, which still carries "Depth 4" for the level it was sold as.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PRODUCT_IDS, productSpec, productFor, maxNamesFor, productName, checkProductScope, checkNativeLanguage, unknownProductMessage } from "./products.mjs";
// — the geography-vs-coverage rule. Deliberately a light import: register-coverage.mjs keeps its
// own static graph to compose-read + territory-tiers for exactly this reason (see its header).
import { registerCoverageCause, offerableTerritories } from "./register-coverage.mjs";
import { PROMPT_TERRITORIES } from "./compose-read.mjs";   // — the names a reader can choose from, which is the universe the disclosure counts against

// ── The closed product registry ──────────────────────────────────────────────────────────────────────
//
// THE ORDERABLE SET IS THE OFFERING, and there is no second list to drift from it. It used to be a local
// array (`SEARCH_LEVELS`) that had to be kept in step with the rows below by hand; the offering is now
// the source and a unit test asserts the row keys ARE `PRODUCT_IDS`, exactly.
//
// Order is the offering's order — lightest first, which is the order a menu reads down.
export const ORDERABLE_PRODUCTS = PRODUCT_IDS;

// Rows this build still NAMES but will never run again: the retired depth ladder, plus the register-only
// level retired. Kept for exactly one reason — a report is re-rendered from the registry
// (reportIdentityFor), and a row deleted here would re-render an ARCHIVED run under a blank identity
// instead of the name it was sold under. Nothing can be ordered at one: `policyFor` answers for them,
// the orderability wall (:orderable below) refuses them, and no menu is built from them.
//
// This is the reading that squares "no old mechanism survives its replacement" with an archive: the
// delete rule governs the ORDERABLE path, and naming a run that already happened is not that path.
export const RETIRED_PRODUCTS = ["knockout", "knockout-register", "prelim-register-only", "prelim", "prelim-jx"];

/** Saved searches dropped by the last `loadRecipes` because their base is a retired product. Rewritten on
 *  every load, so it describes the CURRENT store and never accumulates. Read it to tell a reader why a
 *  saved search is not in the menu; an empty array is the normal case and means nothing was dropped. */
export const retiredBaseSkips = [];

// Components are CLOSED and pipeline-scoped — the structural encoding of "Stage 0 never grows register
// machinery / jx deepening never leaks into a knockout" (both design specs' tripwires, made a validator).
//
// `commonLawGrid` is the one SUBTRACTIVE component: the other two default off and ADD machinery, this one
// defaults ON and its absence is the product. It is stated explicitly on every level rather than defaulted
// so the subtraction is visible to gateResolvedPolicy — a level that merely omitted the grid would make
// "register-only" invisible to the gate, and this file exists precisely so a product cannot silently
// become a different product.
//
// NAMED FOR THE MACHINERY, NOT THE CONCEPT, and deliberately: it is the deterministic grid sweep, which
// the knockout pipeline genuinely does not have (pipeline-knockout.mjs carries zero grid references) even
// though a knockout IS the marketplace product. Calling this `commonLaw` or `marketplace` would re-lay the
// exact trap that produced the 2026-07-21 composer off-by-one — reading `false` on a knockout as "does not
// search marketplaces" and routing a 20-name knockout request into a one-name clearance.
export const COMPONENTS = {
  registerProbe: { pipelines: ["knockout"],  desc: "code-side exact/near-exact live-filing counts per mark (Stage 0.5)" },
  jxLanes:       { pipelines: ["clearance"], desc: "jurisdiction-routed deepening — native-script candidates, sub-class scoping, platform evidence (Stage 1.5)" },
  commonLawGrid: { pipelines: ["clearance"], desc: "the deterministic common-law / marketplace grid sweep — the clearance's unregistered-use half (ON for every clearance this build runs; a saved search cannot switch it off)" },
};

// ── WHAT EACH PRODUCT RUNS ───────────────────────────────────────────────────────────────────────────
//
// `pipeline` names the orchestration shape ("clearance" = pipelineInner; "knockout" = the slim path).
// `report` is the product's REPORT IDENTITY, and it lives on the same row as the machinery on purpose:
// `template` names the publisher that renders it, `identity` is the line the reader sees at the top of
// the document. Both come off this row so a report cannot describe work other than the work that ran.
//
// `stageLabel` IS THE PRODUCT'S NAME NOW, not a rung on a ladder — and on an ORDERABLE row it is the
// same string as `report.identity`, so a masthead can be redundant but never wrong.
//
// IT REACHES NO CLIENT STRING ANY MORE. Every renderer prints `.identity`; render.mjs says so at
// its own derivation site. What keeps the field is the FROZEN SIDECAR and the RETIRED rows below: a
// delivered run's sidecar carries the label it was sold under, and that is the only face an archived
// Depth-N run has. It is the run's internal face, never a client's — see reportIdentityFor.
//
// THERE IS NO `maxMarks` HERE. The name count is the OFFERING's figure (products.mjs `maxNames`: eight
// for a Knockout search, one for every clearance) and `checkMarkBudget` reads it from there. Two numbers
// where the wrong one enforces is exactly what shipped before this: the registry said 20, the offering
// said 8, and a twelve-name knockout passed. `warnMarks` went with it rather than being renumbered under
// an 8 cap — a soft cap of 15 below a hard cap of 8 is a rule that can never fire.
//
// This is deliberately NOT a section manifest. Which sections render is decided by the ARTIFACTS the run
// produced — a list here saying which sections a product "has" would be a second source of truth for
// facts the run already states, and the two would disagree the first time a lane half-completed.
// ── THE DEPTH LADDER — breadth for depth, keyed on JUDGMENT ───────────────────────────────
//
// Owner, verbatim: "on a worldwide search you go deep on what's genuinely in the way, and you record the
// rest properly. Same judgment, different threshold — which is what a lawyer actually does."
//
// EVERY MARK IS STILL retrieved, screened, mechanically classified, given a placement tier and a row in
// placements.json, judged into findings.json with its complete typed field set, and printed. In all four
// products. Nothing is filtered and no scoring changes. What varies is HOW MUCH PROSE IS WRITTEN about a
// mark and HOW MANY TIMES a stage comes back to it.
//
// ── WHY THE ONE-COUNTRY COLUMN IS SPELLED OUT RATHER THAN OMITTED ─────────────────────────────────
//
// Every `full-country-search` value below is today's behaviour, written down. That is the byte-identical
// guard, and it is mechanical rather than a review opinion: the dispatch reads this table for every
// category, so category 4 taking today's path is a property of the DATA, not of a branch somebody
// remembered to leave alone. A row that said "product 4 is special, skip the table" would be a branch,
// and branches are what drift.
//
// ── WHAT IS DELIBERATELY NOT GRADED, AND WHY IT MUST STAY THAT WAY ────────────────────────────────
//
// · The typed `findings[]` register — every downstream surface reads it (cards, report.html, the xlsx,
//   reference-score.mjs). Grading it would be filtering, not shortening.
// · The cross-finding read in synthesis — that IS the product.
// · `escalation` (the skeptic's re-walk). Gating a RECALL check on the marks we already found is
//   circular: an axis holding nothing on the obligation list is exactly where a missed floor row hides.
//   Do not "improve" this later by adding a gate.
// · `frame-reopen`. If the matter changed mid-run, searching the old one was wrong — correctness, not
//   depth.
// · Every repair round (`corrective`, `verdict-recheck`, `degenerate-reask`, `stale-repair`, form
//   repairs, `plan-join-fresh`). They fire because something is WRONG, and grading them is grading
//   quality.
//
// ── AND NEVER KEYED ON THE MECHANICAL TIERS ───────────────────────────────────────────────────────
//
// Treatment keys on the two JUDGMENTS (placement, disposition), never on band-shape.mjs's tiers — in
// that module's own words "mechanical string classes, never a relevance or materiality judgment". They
// are the obligation list, not a priority list. (`classifyRecord` returns the FIRST basis that matched,
// so `basis` under-reports and could not carry the distinction even if we wanted it to.)
//
// The one mechanical set that stays load-bearing is the FLOORS — a tier-`identical` floor row, live and
// in an instructed class, gets a full card in EVERY product. That is an obligation (/), not a
// priority, and the ladder does not grade it.
//
// `graded` means: the stage is told what kind of report it is writing and grades ITS OWN written output.
// NO COUNT EVER REACHES AN INSTRUCTION — a number turns judgment back into a rule, and an arithmetic cut
// is what re-opens.
export const PRODUCT_POLICIES = {
  // ONE knockout, and it carries the register hit-counts. There used to be two levels here — a plain
  // screen and the same screen plus a filing count per name — and the offering has one Knockout search.
  // The counts are IN it: the probe is two register calls per name against a sweep that costs far more,
  // and giving a client the lesser of two things they used to be able to choose is a downgrade nobody
  // ordered. The consequence is real and stays visible rather than being smoothed over: a deployment
  // whose wired register cannot COUNT has no Knockout search at all, and `productAvailability` says so in
  // those words ("register-cannot-count") instead of the release-note sentence that would be a lie.
  "knockout-search": {
    product: "knockout-search", stageLabel: "Knockout search", pipeline: "knockout",
    report: { template: "knockout", identity: "Knockout search" },
    components: { registerProbe: true, jxLanes: false, commonLawGrid: false },
    // — NO DEPTH ROW ON PURPOSE. Product 1 is out of scope by the spec: the knockout lane has its
    // own machinery and reaches none of the graded stages, and a row here would invite a consumer to
    // grade it. It is still told apart from an unrecognised product — depthFor() names it in `source`.
  },
  "global-preliminary-search": {
    product: "global-preliminary-search", stageLabel: "Global preliminary search", pipeline: "clearance",
    report: { template: "clearance", identity: "Global preliminary search" },
    // WORLDWIDE — the higher bar everywhere it is graded.
    depth: {
      narrativeProse: "adversarial",       // per-finding prose in narrative.md: `adversarial` findings only
      // — owner-ruled. A prose write-up is for a finding at band RANK 1-3 against this run's own
      // manifest (rank 1 = the framework's first band), at most 270 words. Rank, not band names: the
      // frameworks carry different vocabularies and different lengths.
      narrativeKeptBandRank: 3,
      narrativeWriteUpWords: 270,
      profileKeptBandRank: 3,              // lever 3 — the driver lists these ordinals to profile
      // — PARKED, AND NOTHING READS IT. The inquiry directive and its check were deferred:
      // measurement showed full traces already confined to the kept tier, so a rule would instruct what
      // the seat already does. The cap stays in the table because the table is the single source for a
      // product's parameters, and a decision recorded anywhere else is one that gets re-litigated.
      // An arm asserts nothing consumes it — so if a consumer is ever wired, that arm fires and whoever
      // wired it takes this off the parked list deliberately rather than by accident.
      inquiryWriteUpWords: 80,             // pooled p90 75, worldwide (e2e measurement)
      inquiryTrace: "graded-high",         // placement-inquiry's WRITTEN trace; every candidate still gets a tier + row
      skepticFlagging: "graded-high",      // what is worth flagging; the escalation re-walk itself is NOT graded
      variantManifest: "graded-high",      // the manifest grades itself; the register plan shrinks with it
      groundedProfiles: "adversarial",     // narrative-refutation: which findings earn a grounded profile
      // WAS UNGRADED, and this branch proposes the first cut. The reason it was ungraded had already
      // CHANGED once. It read "no OPEN doubt carries a disposition", which is
      // still true and is still why the owner table's `bands 1+2 / band 1` cut for this stage cannot be
      // written here — stitchDoubts settles every finding-joining doubt first, so what reaches
      // doubt-closure has no band (doubt-closure-grading-cannot-bind.test.mjs; measured 0 of 420 open
      // doubts on 28 delivered runs). What is NEW is that a second key exists: the PLACEMENT TIER, which
      // comes from the carry artifact rather than a finding, so the stitch cannot have consumed it —
      // 199 of those same 420 carry one. The driver now reads this row and can cut on that tier
      // (doubt-selection.mjs).
      //
      //, owner-ruled 2026-08-23, product by product (reached this branch as an overwatch relay on
      // that thread, not as a comment from the owner's own hand — the box has one `gh` identity).
      // It is the P2 column of that table's `placement-inquiry trace` row — the row whose typed key is
      // the placement tier. This stage's OWN row reads `bands 1+2 / band 1` on FINDING CLASS, which is
      // the cut measured at 0 of 420 and the reason the key moved at all. The words were borrowed from
      // the row that shares the new key; the ruling adopted them rather than leaving them an inference.
      // Pinned with the same provenance in the-doubt-carries-its-placement-tier.test.mjs (RULED_CUTS).
      doubtClosure: "headline-candidate",
      recallFollowupMax: 1,
      envelopeRounds: "one",               // one closing round, not to exhaustion
      coverageClosureRounds: "one",
    },
    components: { registerProbe: false, jxLanes: false, commonLawGrid: true },
  },
  // jxLanes FALSE on the row and TRUE only when the toggle is on — this is the one product where the
  // native-language investigation is a choice, so the row states the product without it and
  // resolveSearchPolicy adds it. A row that carried it would price and label the deepening on every
  // multi-country search whether or not anybody bought one.
  "multi-country-focus-search": {
    product: "multi-country-focus-search", stageLabel: "Multi-country focus search", pipeline: "clearance",
    report: { template: "clearance", identity: "Multi-country focus search" },
    // MULTI-COUNTRY — the same instructions, a lower bar than worldwide.
    depth: {
      narrativeProse: "adversarial+floors",   // `adversarial` findings plus tier-`identical` floor marks
      // — same rank cut as worldwide, a looser cap. The tier-`identical` floor half is DRIVER-SIDE:
      // no floor field reaches the seat, so it cannot be named in the directive (measured, on).
      narrativeKeptBandRank: 3,
      narrativeWriteUpWords: 330,
      profileKeptBandRank: 3,              // lever 3 — same rank cut as worldwide
      // PARKED, as worldwide above, and insurance against densification rather than a saving — it must
      // not be described as one.
      //
      // 80, THE SAME AS WORLDWIDE, AND THE 60 THAT SHIPPED HERE FIRST WAS WRONG. It was read off
      // PER-RUN p90s (63 and 68 on two runs) rather than the pooled distribution. Pooled across every
      // preserved run the two products are level, with multi-country marginally the LONGER: p90 78
      // against 75, over 39 and 38 traces. A cap of 60 clips 18% of multi-country traces against the
      // 3% a p90-shaped cap should clip — so whoever wires the first consumer would wire a rule that
      // violates on day one, and an 18% violation rate reads as a defect in the seat rather than a cap
      // set too low.
      //
      // The claim that used to sit here — that multi-country traces are ALREADY the shorter of the two
      // — was the inverted reading of the same per-run numbers. The narrative caps do invert (270/330);
      // the inquiry traces do not follow them, and nothing required that they should.
      inquiryWriteUpWords: 80,             // pooled p90 78, multi-country (e2e measurement — see below)
      inquiryTrace: "graded",
      skepticFlagging: "graded",
      variantManifest: "graded",
      groundedProfiles: "adversarial+partner",  // + `coexistence-partner` / `distinguished`
      //, owner-ruled 2026-08-23 — P3 column of the same `placement-inquiry trace` row, ruled in the
      // same pass as the P2 row above.
      doubtClosure: "headline-candidate+sheet-2",
      //, owner-ruled: raised 1 → 2, level with the one-country row. The recall gap this closes is a
      // register-invisible mark that the follow-up had one chance to reach and did not. A round that does
      // not run is a search that did not happen, and this row was the shortest of the three.
      //
      // WORLDWIDE (global-preliminary-search) IS DELIBERATELY LEFT AT 1 and that is now an inversion: the
      // broader product gets the weaker recall follow-up. The ruling named this product, and widening an
      // owner ruling to the most expensive product is not mine to do. Raised as a question rather than
      // assumed —.
      recallFollowupMax: 2,
      envelopeRounds: "as-today",
      coverageClosureRounds: "as-today",
    },
    components: { registerProbe: false, jxLanes: false, commonLawGrid: true },
  },
  // jxLanes TRUE on the row: automatic, never a toggle. It is not a promise a lane RUNS — the lanes route
  // on jurisdiction and a country with no adapter has nothing to route — it is a statement that the
  // client neither chooses it nor is charged a toggle for it. scope-rules.mjs refuses an UNROUTED lane
  // only where one was asked for, so this can never refuse a request we ourselves shaped.
  "full-country-search": {
    product: "full-country-search", stageLabel: "Full country search", pipeline: "clearance",
    report: { template: "clearance", identity: "Full country search" },
    // ONE COUNTRY — every value is TODAY'S BEHAVIOUR, declared. This row is the byte-identical guard.
    depth: {
      narrativeProse: "every-finding",
      inquiryTrace: "full",
      skepticFlagging: "as-today",
      variantManifest: "as-today",
      groundedProfiles: "every-finding",
      doubtClosure: "every-doubt",
      recallFollowupMax: 2,                // RECALL_FOLLOWUP_MAX
      envelopeRounds: "as-today",
      coverageClosureRounds: "as-today",
    },
    components: { registerProbe: false, jxLanes: true, commonLawGrid: true },
  },
};

// The retired rows. NOT orderable (the wall below), NOT in any menu, and kept only so an archived run
// re-renders under the name it was sold under. `stageLabel` keeps the Depth numbering for exactly that
// reason: a run delivered as "Depth 4 — Preliminary clearance" says so forever.
export const RETIRED_POLICIES = {
  "knockout":             { product: "knockout",             stageLabel: "Depth 1", pipeline: "knockout",  report: { template: "knockout",  identity: "Knockout review" },                                            components: { registerProbe: false, jxLanes: false, commonLawGrid: false } },
  "knockout-register":    { product: "knockout-register",    stageLabel: "Depth 2", pipeline: "knockout",  report: { template: "knockout",  identity: "Knockout review with register hit-counts" },                    components: { registerProbe: true,  jxLanes: false, commonLawGrid: false } },
  // Retired 2026-08-06: the clearance shape with its unregistered-use half removed. That basis
  // still composes into riskStatement, and the workbook's own gate still inverts on it, because an
  // archived run of it must not re-render claiming a sweep that never ran.
  "prelim-register-only": { product: "prelim-register-only", stageLabel: "Depth 3", pipeline: "clearance", report: { template: "clearance", identity: "Preliminary clearance — register only" },                       components: { registerProbe: false, jxLanes: false, commonLawGrid: false } },
  "prelim":               { product: "prelim",               stageLabel: "Depth 4", pipeline: "clearance", report: { template: "clearance", identity: "Preliminary clearance" },                                       components: { registerProbe: false, jxLanes: false, commonLawGrid: true } },
  "prelim-jx":            { product: "prelim-jx",            stageLabel: "Depth 5", pipeline: "clearance", report: { template: "clearance", identity: "Preliminary clearance with jurisdiction deep-dive" },           components: { registerProbe: false, jxLanes: true,  commonLawGrid: true } },
};

/** The report identity to print on a run's document: `{ template, identity, stageLabel, banner }`.
 *
 *  Resolved from the run's FROZEN policy sidecar when it has one, else from the level word in meta.json —
 *  an archived run predating the sidecar still gets its true identity on a re-render rather than a blank.
 *  A level this build has never heard of degrades to the bare stage label (or nothing) instead of guessing:
 *  a report that says less is recoverable, a report that says the wrong stage is not.
 *
 *  `banner` is the joined line the renderers print: "Stage 0.5 — Knockout review with register hit-counts".
 */
export function reportIdentityFor(levelOrPolicy) {
  const policy = typeof levelOrPolicy === "string" || levelOrPolicy == null
    ? policyFor(levelOrPolicy)
    : levelOrPolicy;
  const frozen = typeof levelOrPolicy === "object" && levelOrPolicy !== null ? levelOrPolicy : null;
  // THE REGISTRY IS THE ONLY SOURCE OF A LABEL. A frozen sidecar's own stageLabel used to win here, so
  // that an archived run re-rendered as what it was SOLD as. That kept two numbering systems alive at
  // once, and the Depth 1-5 renumbering (2026-07-30) is the point at which that stopped being worth
  // it: one system, no legacy. A run delivered under Stage 0.5 now re-renders as
  // Depth 2 — the same product, named the way the product is named today. The sidecar still decides
  // WHICH level ran (below); it no longer decides what that level is called.
  const fromLevel = frozen ? policyFor(frozen.level) : policy;
  // Registry FIRST, sidecar only as a LAST RESORT. The order is the whole point: a level the registry
  // still knows is always named the way the product names it TODAY, so there is one numbering system.
  // A level this build has never heard of — a row retired since the run — has no registry answer at
  // all, and the sidecar's own label is better than a blank there. That is not a second numbering
  // system, it is the last thing anyone recorded about a level that no longer exists.
  const stageLabel = fromLevel?.stageLabel ?? frozen?.stageLabel ?? null;
  const identity = fromLevel?.report?.identity ?? null;
  const template = fromLevel?.report?.template ?? (frozen?.pipeline === "knockout" ? "knockout" : null);
  return {
    template,
    identity,
    stageLabel,
    // DEDUPED, because the two halves are now the same string for every product this build offers: the
    // label was a rung on a ladder ("Depth 4") and is the product's own name. A banner reading
    // "Full country search — Full country search" is not a second fact, it is the same one twice.
    banner: [...new Set([stageLabel, identity].filter(Boolean))].join(" — ") || null,
  };
}

/** The product's coverage note for the report masthead (charter ruling 1, 2026-07-30: what was bought
 *  must be VISIBLY clear on the page — a reader must never confuse "the same section" in two different
 *  searches). One plain sentence, NAME-LED per the ruling (match 's registry-name pills: the
 *  product's name leads, never a rung on our ladder), stating what THIS search covers and the material
 *  thing it does not. The name comes from the registry join (reportIdentityFor — today's name for what
 *  ran, exactly the  doctrine); the coverage clauses come from the run's own frozen COMPONENTS
 *  (never the product word alone, so a recipe with overridden components speaks the truth — the name
 *  says what was sold, the clauses say what actually ran). A retired row with no registry name degrades
 *  to the nameless "This search …" form rather than inventing one. Unknown/absent policy ⇒ null — an
 *  archived run with no sidecar renders exactly as before rather than guessing.
 */
export function productCoverageNote(productOrPolicy) {
  const levelOrPolicy = productOrPolicy;
  const policy = typeof levelOrPolicy === "string" || levelOrPolicy == null
    ? policyFor(levelOrPolicy)
    : levelOrPolicy;
  if (!policy || !policy.pipeline) return null;
  const name = reportIdentityFor(levelOrPolicy).identity;
  const lead = (rest) => (name ? `${name} — ${rest}` : `This search ${rest}`);
  const c = policy.components ?? {};
  if (policy.pipeline === "knockout") {
    // wrote "those filings are not weighed or analysed in this search", and it was true: the
    // register half was three numbers, then a list, and the rater was GAGGED from the filings on disk.
    //
    // MAKES THAT SENTENCE FALSE, not merely unhelpful. The rater is handed the run's
    // fetched records and weighs them — that is the whole point of the change — so a masthead still
    // saying they are not weighed tells a client the opposite of what the report below it does. Owner,
    // reading a per-mark report on test: "it is misleading; our work is weighing and analysing findings.
    // Clarify, update or remove it — keep it simple and short."
    //
    // One clause per half, and each is true of the run it heads: what was searched, and what happens to
    // the filings. No clause about what the product does NOT do — that is what went false.
    //
    // "READS", NOT "WEIGHS" (owner,): weighed and not weighed are not terms we use
    // with a client. The clause added is still here and still true — the rater IS
    // handed the fetched records — it just says so in a word a client uses.
    //
    // THE COUNTS STAY IN THE SENTENCE, and the first cut of this change dropped them. Only the "not
    // weighed" clause went false; "takes register hit-counts" is true, is what the customer paid for,
    // and is the phrase report-registry.test.mjs keys on because the masthead is where a client learns
    // what this product covers. Removing a true clause while removing a false one is a second, silent
    // change — and the arm that caught it is the one asserting adjacent depths never read identically.
    return lead(c.registerProbe
      ? "screens each name against marketplace and common-law use, takes register hit-counts, and reads the filings it retrieves."
      : "screens each name against marketplace and common-law use; registers are not searched in this search.");
  }
  if (policy.pipeline !== "clearance") return null;
  const covers = ["registered rights"];
  // JOINED ON THE PREDICATE, not on the component. This function used to read `commonLawGrid` directly
  // and say so in a comment, which made "is this register-only" answerable in three places (here, the
  // function below, and publish/index.mjs's hand copy) — the exact thing the predicate's own doc comment
  // claims cannot happen. Absent key ⇒ the grid ran, which is what isRegisterOnly already encodes for
  // the archived runs that froze a policy from before the component existed.
  const registerOnly = isRegisterOnly(policy);
  if (!registerOnly) covers.push("unregistered (common-law) use");
  if (c.jxLanes === true) covers.push("searches for the mark's native-script renderings in the jurisdictions whose lanes cover them");
  const omits = registerOnly
    ? "unregistered (common-law) use is not covered in this search"
    : (c.jxLanes !== true ? "the per-jurisdiction native-script deep dive is not part of this search" : null);
  const list = covers.length > 2 ? `${covers.slice(0, -1).join(", ")}, and ${covers.at(-1)}` : covers.join(" and ");
  return lead(`covers ${list}${omits ? `; ${omits}` : ""}.`);
}

/** True when this resolved policy runs the clearance shape with the grid sweep removed. The ONE predicate
 *  every consumer joins on — pipeline fan-out, stage prompts, publish, and the risk statement's basis —
 *  so "is this register-only" can never be answered two different ways. Absent key ⇒ grid ran (archived
 *  runs froze a policy from before this component existed).
 *
 *  THE CLAIM ABOVE WAS FALSE UNTIL  and is now true: depthCoverageNote read the component by hand,
 *  and publish/index.mjs re-implemented the whole expression without importing this at all. Both now
 *  call it. It answers about a run that ALREADY RAN — no level this build offers resolves to it since
 *  the register-only level was retired — so it is read off a FROZEN sidecar, never off a menu. */
/**
 * The depth row a run is graded by, and what it does when it does not know.
 *
 * FAILS TOWARD DEPTH, NEVER TOWARD BREVITY. A product with no row — the knockout, a retired key, an
 * archived run whose policy predates this table — resolves to the ONE-COUNTRY row, which is today's
 * behaviour everywhere. Being wrong in that direction costs time on a run that did not need it. Being
 * wrong the other way silently shortens a report somebody paid for, and the symptom is prose that is
 * missing rather than an error anybody sees.
 *
 * The default is the one-country row BY REFERENCE, not a second copy of its values: two copies drift,
 * and a drifted default would ungrade a product while the table still read correctly.
 *
 * `source` travels with the row so the run record can show WHICH row was used. A graded product that
 * quietly fell back to the default would otherwise look exactly like a ladder that did nothing — the
 * failure `depth-ladder-table.test.mjs` guards the table against, arriving through the resolver instead.
 */
export function depthFor(policy) {
  // THE RESOLVED POLICY NAMES THE PRODUCT `level`, NOT `product`. attachSearchPolicy freezes a sidecar
  // whose shape is {schema, level, pipeline, stageLabel, …} with `origins.level: "job.product"` — the
  // product key lands in `level`, and `product` is the field name PRODUCT_POLICIES' own entries carry.
  // Reading only `product` meant ctx.searchPolicy resolved to `default-ungraded` on EVERY run: the whole
  // ladder ran at one-country depth, every rung returned "", and nothing anywhere failed. Both names are
  // accepted because both shapes reach this function — the frozen policy and a bare {product} selector.
  const key = String(policy?.level ?? policy?.product ?? "").trim();
  const row = PRODUCT_POLICIES[key]?.depth;
  if (row) return Object.freeze({ ...row, source: key });
  // A product this build KNOWS but does not grade is not the same thing as one it does not recognise.
  // Both run at one-country depth, and only one of them is a bug — so they must not share a name in the
  // run record, or the bug hides in the population of the deliberate case.
  const known = Object.prototype.hasOwnProperty.call(PRODUCT_POLICIES, key);
  return Object.freeze({ ...PRODUCT_POLICIES["full-country-search"].depth,
    source: known ? `ungraded:${key}` : "default-ungraded" });
}

export function isRegisterOnly(policy) {
  return policy?.pipeline === "clearance" && policy?.components?.commonLawGrid === false;
}

/** The registry row for a product key — orderable OR retired. A NAMING lookup: it answers for a retired
 *  row too, because that is what re-renders an archived report and what names the product a stale saved
 *  search asked for. Asking it "does this exist" is asking the wrong question — the orderability test is
 *  always `ORDERABLE_PRODUCTS.includes(...)`, and a typo must fail closed against that positive list. */
export function policyFor(product) {
  const k = String(product ?? "").trim().toLowerCase();
  return PRODUCT_POLICIES[k] ?? RETIRED_POLICIES[k] ?? null;
}

// What THIS build can actually execute. A resolution onto machinery a build does not carry must CLARIFY
// at admission (never silently run the wrong-priced product — a knockout request running as a $40
// prelim, or a 1.5 request running as a plain Stage 1, is the exact silent-substitution this file exists
// to forbid). These flags are flipped in CODE as each lane lands, never from the environment: there are
// no runtime env kill switches — see the note below.
// EXPORTED because availability is now asked about in two places, not one. The runner asks "may this
// run", at the moment of running, in a process that has the engine's environment. The portal asks "may
// a user even PICK this", before anything is spent, from a process that deliberately has no engine
// environment at all — so it cannot answer from env and must be told. `built` is half that answer;
// the flag snapshot is the other half. Env alone is meaningless without this map: a level can be
// switched on and still not exist.
// NOTE on registerProbe: unlike the other two, this one is not a property of the build ALONE — Stage
// 0.5 is a count, and a register provider that cannot count (capabilities.countProbe "none") cannot
// run it however complete the build is. `true` here means the machinery exists; the ACTIVE provider's
// ability is reconciled in the flag snapshot (driver/flag-snapshot.mjs), which is written by a process
// that knows which provider is wired — knowledge this pure leaf cannot have. The engine's own refusal
// is driver/register-count.mjs's preflight, before any spend.
export const BUILT = { knockout: true, jxLanes: true, registerProbe: true };

// RUNTIME KILL SWITCHES: RETIRED 2026-07-27. There are none.
//
// `CLEAROTRON_KNOCKOUT_MODE`, `CLEAROTRON_JX_LANES` and `CLEAROTRON_RECIPES_MODE` used to gate admission here. All
// three sat over machinery that is BUILT and shipped, so each could only ever read `true` on a correct
// deployment — which is the dead branch this file already refused to add for register-only and for
// Stage 0.5's count probe ("a toggle nobody ever flips is the dead branch that outlives the reason for
// it"). Availability is now a property of the BUILD and of the wired provider, and of nothing else.
//
// They were not merely dead, they were actively harmful, and in exactly the way the old comment here
// predicted: a caller outside the engine's environment reads every switch as unset, and unset was
// indistinguishable from off. The portal was given a snapshot to work around it. The ops-MCP was not,
// so `describe_options` and `plan_run` told clients that knockout, knockout-register and prelim-jx were
// "Not switched on for this account yet" while the engine would have run all three (2026-07-27). That is
// the second time this service has lied for want of an environment variable — the first was the profiles
// dir answering with a demo roster. Deleting the switch is the fix that cannot recur; plumbing a
// snapshot into each new caller is the one that waits for the next caller.
//
// An incident kill did not go away with them: `CLEAROTRON_NATIVE_LANGUAGE_<code>` is fail-OPEN by construction
// (`?? "1"` — on unless explicitly "0"), so a lane can still be silenced without a deploy, and it works
// the same in every process whether or not it has an environment. That is the shape to copy if another
// one is ever genuinely needed. `BUILT` remains one edit away for machinery that truly is unfinished.

// Admission gate over a RESOLVED policy: null = runnable, else a clarify message. Split from resolution so
// the runner can distinguish "which product is this" (resolveSearchPolicy) from "may it run HERE, NOW".
//
// There is deliberately NO `flags` parameter. It existed only to feed the retired switches, and an
// ignored-but-accepted `flags` key would let a caller believe it still decided something — the same
// class of quiet wrongness the switches themselves were.
//
// `built` remains an injection point, and it is the only one. The engine's own BUILT map is the right
// answer inside the engine, and it is the default. It is not the right answer everywhere: Stage 0.5
// needs a register that can COUNT, which is a property of the deployment's provider rather than of the
// build, so the portal and the MCP are TOLD (the flag snapshot reconciles the two — flag-snapshot.mjs).
export function gateResolvedPolicy(resolved, { built = BUILT, registerTerritories = undefined } = {}) {
  if (!resolved || resolved.clarify) return resolved?.clarify ?? "search-policy resolution failed";
  const at = `${resolved.stageLabel ?? resolved.level ?? "that search"}`;
  // — LEADS, like its cause twin, because it is the more specific truth. Staff prose here, so it
  // may name the mechanism the client-facing sentence must not: which territories the register reaches.
  // Its null-equivalence with gateCause is what search-policy.test.mjs pins over the whole matrix, so
  // this arm has to exist on both sides or that assertion is what breaks.
  {
    const geo = productSpec(resolved.product)?.geography ?? null;
    const cause = geo ? registerCoverageCause(geo, registerTerritories) : null;
    // ── — THE ORDER PATH FOLLOWS THE MENU, and it has to ────────────────────
    //
    // This gate and `productAvailability` are one fact stated twice — the null-equivalence over the
    // whole matrix is pinned by search-policy.test.mjs and by register-coverage-wire.test.mjs, and it
    // exists because a product the menu offers and the door refuses is worse than one that is simply
    // greyed out: the client composes a whole request and meets the wall at the moment of spending.
    //
    // The owner's ruling makes a worldwide search on a partial register ORDERABLE, so this arm has to
    // stop firing on the same cause, in the same shape, or the equivalence breaks and the wall becomes
    // invisible on one side. `register-coverage` still refuses here for the same reason it still
    // refuses there.
    // D6 — NEITHER coverage cause refuses now, on either side. These two gates
    // are one fact stated twice and their null-equivalence is pinned over the whole matrix; a product the
    // menu offers and the door refuses is worse than one that is greyed out, because the client composes
    // the whole request and meets the wall at the moment of spending.
    if (cause) void cause;
  }
  if (resolved.pipeline === "knockout") {
    if (!built.knockout) return `a ${at} is not available in this build yet — the knockout pipeline ships in a later release; order a preliminary search instead`;
  }
  // The register count-probe is its own machinery, and it never had a kill switch of its own. This
  // branch is not a switch: it is how an unfinished (or uncountable-provider) component refuses
  // honestly, and BUILT is one edit away.
  if (resolved.components?.registerProbe && !built.registerProbe)
    return `a ${at} is not available in this build yet — its register filing counts ship in a later release; order a preliminary search instead`;
  if (resolved.components?.jxLanes) {
    if (!built.jxLanes) return `a ${at} is not available in this build yet — the native-language investigation ships in a later release; order a search without it`;
  }
  return null;
}

/**
 * Why a product cannot be picked, as a CODE rather than a sentence.
 *
 * The composer needs the same knowledge gateResolvedPolicy has, but it must never render the same
 * words: every message above names its kill switch on purpose, for staff and for logs. Returning prose
 * to the portal and trusting it to strip the switch name would put a client-facing leak one careless
 * edit away — a new message with a different shape, and a regex that used to catch it silently stops.
 *
 * So the split is structural. This returns a cause, the portal owns the wording, and no path exists by
 * which a CLEAROTRON_* name reaches a browser.
 *
 *   null       — the product is pickable
 *   'unbuilt'  — the machinery does not exist in this build (or the wired register cannot count, for
 *                the Knockout search's filing counts). No switch will change that; only a release, or a
 *                different provider, will.
 *
 * Since the kill switches were retired (2026-07-27) those are the ONLY two answers, and neither depends
 * on the environment — which is the whole point. A product that is built is pickable from every surface,
 * whether or not the process asking has an engine environment. There is no `flags` parameter, and
 * `'disabled'` is no longer a reachable cause.
 */
export function productAvailability(policy, { built = BUILT, registerCanCount = null, registerTerritories = undefined, geography = null, demo = false } = {}) {
  if (!policy) return "unbuilt";
  // ── — A DEMO NO LONGER REFUSES A PRODUCT (owner ruling, 2026-08-31) ──────
  //
  // `demo` used to return FIRST, before every other cause, and greyed all four products with a sentence
  // about credentials. That implemented the ruling of 14:44 that day, which the owner superseded at
  // 14:47 on his own reading of it:
  //
  //   "i think its OK for someone to be able to press New Clearance in demo mode and see it work and
  //    get the static results, right?"
  //
  // The reasoning he gave for reversing himself is the reasoning for this arm's deletion: a demo that
  // shows four finished reports and a dead button "demonstrates the output and hides the thing a buyer
  // is deciding about", and a disabled control is "a viewer creeping back in" — the exact thing the
  // whole demo-is-the-product track exists to retire.
  //
  // SO WHAT STOPS A DEMO SPENDING ANYTHING IS NO LONGER HERE. It is the run route, which resolves a
  // demo confirmation to a finished run that already exists instead of dispatching one — and an arm
  // there counts calls to the trigger seam rather than reading a status code, because "nothing was
  // dispatched" is the one claim a 200 cannot carry. The parameter stays in the signature: every caller
  // passes it, and removing it would silently un-thread the demo from the one place that still needs to
  // know, which is the sentence a product row shows.
  void demo;
  // — CHECKED FIRST, before `built`, for the reason the count arm gives below: it is the more
  // specific truth, and it is the one a client can act on. "Not part of the current release" told a
  // client to wait for a version that will never help; the register wired here does not reach the
  // territories this product needs, and only a different register changes that.
  //
  // Territory coverage is the product's OWN geography requirement answered against the deployment, so
  // the rule lives in register-coverage.mjs where it can be tested over synthetic covered sets. Absent
  // or unrestricted coverage returns null there — this arm cannot fire on a snapshot that says nothing.
  if (geography) {
    const cause = registerCoverageCause(geography, registerTerritories);
    // ── — COVERAGE IS DISCLOSED, NEVER REFUSED (owner ruling, 2026-08-31) ──
    //
    // "A user could still run global and just be aware of the limitations — I prefer that than switch
    // it off." The gate removed the product instead, and it was the ONE place in this system that
    // answered partial coverage that way. INSTALL.md states the opposite for every tier: "whatever the
    // chosen register does not reach becomes a disclosed deferred coverage row rather than a silent
    // gap". The pipeline already does exactly that — `resolveRegions` returns the uncovered
    // jurisdictions as `deferred` rows with a reason, and the coverage ledger publishes them — so this
    // arm was refusing to SELL what the engine would happily RUN and disclose.
    //
    // `register-coverage` STAYS A REFUSAL and is not covered by the ruling, which named only the
    // worldwide cause. It is also a different fact: it fires when the register reaches no country at
    // all for the shape asked for, so the run would defer everything and the report would carry no
    // register content whatsoever. Raised on the issue rather than decided here.
    //
    // `register-cannot-count` is ruled explicitly out of scope on that issue: a register that cannot
    // return counts cannot produce the search's core output, which is a capability gap.
    // ── D6 (owner ruling, 2026-09-02) — AND THE OTHER COVERAGE CAUSE TOO ────
    //
    // "Disclosure yes, in line with the picker." The picker offers a territory the register cannot
    // reach and says so at the control; a product refused for the same fact was the last place the two
    // controls could still disagree, which is what the ruling on this issue forbids.
    //
    // So NEITHER coverage cause refuses now. `register-cannot-count` is a different fact and still does:
    // a register that cannot return counts cannot produce the search's core output, which is a
    // capability gap rather than a coverage one, and the issue rules it out of scope in as many words.
    if (cause) void cause;
  }
  // CHECKED BEFORE `built`, because it is the more specific truth. `built.registerProbe` goes false for
  // two unrelated reasons — the machinery is not in this build, or the register wired HERE cannot count
  // (flag-snapshot folds capabilities.countProbe into it) — and collapsing both into "unbuilt" told a
  // client to wait for a release that will never fix their case. The fix is a different provider, not a
  // newer version. Same class as the 2026-07-27 incident where three switched-on depths were reported
  // as "not switched on": the system stated a cause it had not established.
  if (policy.components?.registerProbe && registerCanCount === false) return "register-cannot-count";
  if (policy.components?.registerProbe && !built.registerProbe) return "unbuilt";
  if (policy.pipeline === "knockout" && !built.knockout) return "unbuilt";
  if (policy.components?.jxLanes && !built.jxLanes) return "unbuilt";
  return null;
}

/**
 * The client-facing wording for an unavailable product. MOVED here from portal-service.mjs (2026-07-27),
 * byte-identical, because the portal is no longer the only surface that owes a client an honest
 * sentence: an agent driving the product over MCP gets the same answer, and two copies of these two
 * strings is one edit away from two different products saying different things about the same state.
 *
 * The engine hands over a CAUSE, never a sentence; these are the only words a client-facing surface
 * ever sees, and no CLEAROTRON_* name can reach them because none is in scope in this map. (CI greps the
 * built portal bundle for `CLEAROTRON_` as the backstop; the MCP side greps the whole JSON response.)
 *
 * ONE cause remains since the kill switches were retired (2026-07-27). The `disabled` key is gone with
 * them, and so is RECIPES_DISABLED_NOTE: "Not switched on for this account yet — Cordillera can enable
 * it" was the sentence a client was told about three depths that were switched on, so keeping it as a
 * reachable string would keep the lie one wiring mistake away.
 *
 * BOTH CAUSES ARE REACHABLE AGAIN, and by the same product. The Knockout search carries the register
 * count probe (PRODUCT_POLICIES), so a deployment whose register cannot count hears the second sentence
 * about the one product it cannot run — the arm that existed for Stage 0.5 and had no orderable product
 * left to fire on once the two knockout levels became one.
 */
export const UNAVAILABLE_NOTE = {
  unbuilt: "Not part of the current release.",
  // `demo` IS DELETED FROM THIS MAP (, owner ruling 2026-08-31 14:47), and
  // deleting it is what makes the reversal structural rather than a filter somebody can undo by
  // accident. Every client-facing surface renders a product's refusal as `UNAVAILABLE_NOTE[cause]`;
  // while a sentence sat here for a demo, the greyed control was one `return "demo"` away from coming
  // back — and it had already come back once, because the ruling it implemented was superseded three
  // minutes after it was made and the handover carried the first one. With no sentence there is nothing
  // for a door to render.
  // Names no vendor (one register, never a baked-in provider name) and no switch. It says the one thing
  // a reader can act on: this is not a version problem, so waiting will not fix it.
  "register-cannot-count": "The trademark register wired to this deployment cannot return filing counts, so this search cannot run here.",
  // — the SAME construction as the count arm above, and for the same reasons: one register, never
  // a baked-in provider name, no CLEAROTRON_* string in scope here, and it says the one thing a reader can
  // act on — this is a coverage limit, so a newer version will not fix it.
  //
  // `register-not-worldwide` IS DELETED FROM THIS MAP (, owner ruling
  // 2026-08-31), and deleting it is what makes the ruling structural rather than a filter somebody can
  // reverse by accident. Every client-facing surface renders a product's refusal as
  // `UNAVAILABLE_NOTE[cause]`; while a sentence sat here for that cause, the ruling held only as long as
  // `productAvailability` remembered not to return it. There is now no sentence for a door to render,
  // so a coverage limit cannot become a refusal again without somebody writing one back — which is a
  // visible edit to a map with this paragraph above it. The cause itself still exists and is still
  // computed: `coverageDisclosure` below keys on it, and says what the register DOES reach.
  //
  // `register-coverage` IS DELETED TOO (owner ruling D6, 2026-09-02: "disclosure yes, in line with the
  // picker"). It was the last place a coverage fact could still refuse a product, which is the
  // disagreement between the two controls that the ruling on this issue forbids. Same structural move
  // as its sibling and for the same reason: with no sentence here there is nothing for a door to
  // render, so a coverage limit cannot become a refusal again without somebody writing one back.
  //
  // Both causes are still COMPUTED, and they are still two facts with two sentences —
  // `coverageDisclosure` keys on them. What is gone is their ability to remove a product.
};

/**
 * ── — WHAT THIS DEPLOYMENT'S REGISTER REACHES, said at the point of choosing ─
 *
 * A SIBLING of `UNAVAILABLE_NOTE`, deliberately NOT an entry in it, for the reason `CAPABILITY_SKIPPED_NOTE`
 * gives below: every cause in that map makes a product UNORDERABLE, and every caller of
 * `productAvailability` reads a key found there as a refusal. This one rules the opposite — the product
 * is orderable, and what the register cannot reach is disclosed here and again as deferred coverage rows
 * in the delivered report.
 *
 * IT SAYS WHAT IS COVERED, NOT ONLY WHAT IS NOT, which is the issue's own requirement: "a reader
 * choosing Signa should see the eleven offices, not a sentence about the world." So it is a FUNCTION
 * rather than a string — the covered set is a deployment fact and no fixed sentence can carry it.
 *
 * NAMES NO VENDOR and carries no `CLEAROTRON_*` string, the same two construction rules
 * every other client-facing sentence in this file follows. The names it lists are composer display
 * names, which are provider-independent by design (register-coverage.mjs's whole split).
 *
 * THE PROMISE IS CHECKED. It says the places the register does not reach are disclosed rather than
 * searched, and that is what the engine does: `resolveRegions` (register-plan.mjs) returns an uncovered
 * jurisdiction in `deferred` with a reason, `coverage-ledger.mjs` writes the row, and the report
 * publishes it. A hint promising behaviour the engine lacks would be worse than the refusal it replaces.
 *
 * @param territories what `coveredTerritoryNames` returned — `null`/`undefined` mean no declared
 *                    restriction and no unknown, so there is nothing to disclose and this returns null.
 */
export function coverageDisclosure(geography, territories, all = PROMPT_TERRITORIES) {
  if (!Array.isArray(territories)) return null;
  const cause = registerCoverageCause(geography, territories, all);
  if (!cause) return null;
  // ── D6 — BOTH COVERAGE CAUSES DISCLOSE NOW ────────────────────────────────
  //
  // `register-coverage` joined `register-not-worldwide` here when the owner ruled "disclosure yes, in
  // line with the picker" (2026-09-02). They are still two FACTS and get two sentences — "not
  // worldwide" and "does not reach the places this search needs" would give a reader the wrong answer
  // to "why" if collapsed — but neither is a refusal any more.
  //
  // COUNTED AGAINST THE PRODUCT'S OWN VOCABULARY, not the form's. A Full country search offers no
  // regions, so "3 of 37" would count a denominator that product cannot use, and the thing its rule
  // actually tests is whether the register reaches any COUNTRY at all.
  const universe = offerableTerritories(geography, all);
  const reached = universe.filter((n) => territories.includes(n));
  const missing = universe.filter((n) => !territories.includes(n));
  // WHAT IS COVERED, LEADING — a count then the names, because the count is what a reader weighs the
  // choice on and the names are what they check their own market against. Not truncated: a reader
  // deciding whether to spend needs the whole list, and eleven names is a line and a half.
  //
  // AND THE EMPTY CASE IS ITS OWN SENTENCE. "reaches 0 of 25 territories you can name here — " with
  // nothing after the dash is the shape a list-building sentence fails in, and it is reachable on a
  // real deployment: an EU-only register reaches no COUNTRY, which is exactly when a one-country search
  // discloses. A reader is owed the plain form of that rather than a sentence with a hole in it.
  const opening = cause === "register-not-worldwide"
    ? "This search covers the whole world. "
    : "";
  const note = reached.length === 0
    ? `${opening}The trademark register wired to this deployment reaches none of the territories this `
      + `search can be pointed at. It can still be ordered: the register half is disclosed in the report `
      + `as deferred coverage rather than reported as clear, and the marketplace and common-law half is `
      + `unaffected.`
    : `${opening}The trademark register wired to this deployment reaches ${reached.length} of the `
      + `${universe.length} territories you can name here — ${reached.join(", ")}. The rest are not `
      + `searched at the register: they are disclosed in the report as deferred coverage rather than `
      + `reported as clear.`;
  return { cause, reached, missing, note };
}

/**
 * The client-facing wording for a capability that DID NOT RUN on a screen that still delivered.
 *
 * A SIBLING of UNAVAILABLE_NOTE, deliberately NOT an entry in it, and the distinction is the whole
 * point of acceptance 6. Every cause in that map makes a product UNORDERABLE — `productAvailability`
 * returns it and the doors refuse. This one rules the opposite: the screen launches, delivers the half
 * it can, and says what it skipped. A key added to the map above would have been read by every caller
 * of `productAvailability` as a refusal, which is the behaviour the ruling exists to remove.
 *
 * ADR-0003 is what makes this a choice rather than an invention: "Refusing at preflight and degrading
 * with a disclosure are both acceptable; degrading in silence is not. Which one applies is per
 * component." This moves the research sweep from the first column to the second, and the ADR's table
 * carries the row.
 *
 * SAME CONSTRUCTION RULES as its sibling, for the same reasons: it names no vendor (the research
 * provider is a deployment's choice, never a baked-in name), it carries no `CLEAROTRON_*` string
 * (CI greps the built portal bundle and the MCP response for exactly that), and it states the
 * one thing a reader can act on — a credential this deployment does not hold, so neither a newer
 * version nor a re-run will change it.
 *
 * IT SAYS WHAT IS STILL TRUE, not only what is missing. A screen that reports "something did not run"
 * and stops there reads as a broken run; the register half is unaffected and the reader needs to know
 * which half they are holding.
 */
export const CAPABILITY_SKIPPED_NOTE = {
  "common-law-no-credential":
    "The open-web and marketplace search did not run on this screen — this deployment holds no research "
    + "credential for it. The register filing counts are unaffected. Treat every name here as unscreened "
    + "for unregistered use.",
};

/** The short internal cause a skipped capability records per mark, for the assess stage and the ledger. */
export const CAPABILITY_SKIPPED_CAUSE = {
  "common-law-no-credential": "open-web research did not run — no research credential on this deployment",
};

/**
 * WHY this resolved policy cannot run, as a CODE rather than a sentence — gateResolvedPolicy's twin.
 *
 * gateResolvedPolicy answers the same question in staff prose (for the runner's clarify path and for
 * logs), and those exact strings are pinned by test, so this lives BESIDE it rather than refactoring it.
 * It is the same split productAvailability already makes for the composer, one rung up: productAvailability
 * judges a LEVEL a user might pick, this judges a RESOLUTION (which may be a saved search over a level).
 *
 * Returns null when the policy is runnable, else { cause, product, stageLabel }:
 *   'unresolved'       — there is no policy to judge (resolution failed or clarified). The caller owns
 *                        the wording: a clarify string is already actionable prose and must be relayed
 *                        verbatim rather than flattened into a cause.
 *   'unbuilt'          — the machinery does not exist in this build (see productAvailability).
 *
 * `recipes-disabled` and `disabled` were retired with the kill switches (2026-07-27): a saved search is
 * now honoured wherever it resolves, and built machinery is never "off".
 *
 * The RESOLVED policy is measured, never `policyFor(resolved.level)`: a recipe can turn jxLanes on over a
 * base of `prelim`, and the base registry entry would answer "available" for a resolution that is not.
 * Delegating the built arms to productAvailability is what makes the null-equivalence with
 * gateResolvedPolicy structural rather than a coincidence two edits can break (search-policy.test.mjs
 * pins it over the whole matrix).
 */
export function gateCause(resolved, { built = BUILT, registerCanCount = null, registerTerritories = undefined } = {}) {
  const at = { product: resolved?.product ?? null, stageLabel: resolved?.stageLabel ?? null };
  if (!resolved || resolved.clarify) return { cause: "unresolved", ...at };
  // `registerCanCount` threads through to productAvailability (audit item 3): without it, a deployment
  // whose wired register cannot count reached this gate as built.registerProbe=false only (the flag
  // snapshot folds canCount into the build map), so plan_run answered the retired "Not part of the
  // current release." while describe_options — which passes the snapshot's canCount — answered the true
  // cause. Same question, same answer, whichever door asked.
  // — `registerTerritories` threads the same way and for the same reason. The geography comes from
  // the PRODUCT SPEC rather than the caller, so no door can answer this question about a different
  // product than the one it resolved.
  const cause = productAvailability(resolved, {
    built, registerCanCount, registerTerritories,
    geography: productSpec(resolved.product)?.geography ?? null,
  });
  return cause ? { cause, ...at } : null;
}

// ── Saved recipes (customer-composed searches) ──────────────────────────────────────────────────────
// A recipe is a small named bundle a customer (or staff acting for one) saved: a base PRODUCT + component
// toggles + instruction-shaped extras. Stored one file per recipe at <recipesDir>/<customer>/<slug>.json
// (dev: driver/recipes/ synthetic demos; prod: CLEAROTRON_RECIPES_DIR under the external config store — the
// structural no-client-data-in-repo rule). The file key set is CLOSED (deny-unknown, the F7 discipline)
// and — the invariant — shares NOTHING with the profile key set: extras are instruction-shaped only.
// NOTE: the display field is `label`, deliberately NOT `name` — `name` is a PROFILE key (the customer's
// legal identity, the self-exclusion anchor) and the disjointness invariant below is strict.
// `caseLaw` is STILL LISTED and can no longer be SAVED, and the split is the emailTable precedent
// exactly. Case law is a product now (the Full country search carries it; nothing else offers it), so
// saving one is asking for a setting that no longer exists — refused at the save door below, where
// somebody is present to read the reason. Refusing to LOAD one would be a different and much worse
// thing: loadRecipes throws on any error, so one stored file carrying a key nobody has touched since
// would take down every saved search of every customer, and with them the searches route,
// describe_options, plan_run and start_run. It is dropped on load instead, silently, because the value
// is inert by construction — the product decides.
export const RECIPE_KEYS = [
  "version", "label", "base", "components", "extras", "archived", "scope", "caseLaw", "nativeLanguage",
  "notes", "createdBy", "createdAt", "updatedBy", "updatedAt",
];
/**
 * The saved-search SCOPE block — where the machinery points, as against `base`/`components`, which
 * choose which machinery runs.
 *
 * This is what makes a saved search a saved SEARCH rather than a saved depth. "Zephyr Beverages knockouts — US
 * focus" is a label over exactly this: base `knockout`, scope `{jurisdictions:["US"]}`. Without it a
 * saved search could only ever restate a level that is already one click away, which is why the recipe
 * store existed for weeks with nothing worth putting in it.
 *
 * NESTED, deliberately. The structural invariant RECIPE_KEYS ∩ KNOWN_PROFILE_KEYS = ∅ is what proves a
 * saved search can never name a rating-adjacent knob, and it is asserted by a unit test. Flattening
 * these three into top-level keys would collide with `platforms` and `defaultClasses` on the profile
 * side and break that proof; one nested key keeps it true by construction.
 */
export const RECIPE_SCOPE_KEYS = ["jurisdictions", "platforms", "classes"];
const RECIPE_MAX_JURISDICTIONS = 20;   // mirrors enqueue-schema's per-run cap: a saved search is a job template
const RECIPE_MAX_PLATFORMS = 10;
// The extras a saved search may carry. standingInstructions rides the report-overview prompt on the
// context lane.
//
// emailTable is INERT as of 2026-07-28: the results-table email it used to switch on is deleted (every
// run's mail is a cover note pointing at the one report). It stays in this list, and stays validated,
// only so that saved searches written while it worked keep loading — a stored recipe must not brick on
// a change it never asked for. Nothing offers it any more: the compose form's checkbox is gone, which is
// the half that matters. An option still on screen is an option the product is still promising.
//
// `defaultDeadlineDays` is deliberately NOT here. It was ruled out on 2026-07-27 — a deadline is temporal
// and belongs to the request, not to a template that outlives it; a saved search quietly re-dating every
// future run from a number set months ago is a worse outcome than typing the date. It is named in the
// refusal below rather than silently falling into "unknown extra", so anyone who tries reads the reason.
export const RECIPE_EXTRA_KEYS = ["emailTable", "standingInstructions"];
const RECIPE_RETIRED_EXTRAS = {
  defaultDeadlineDays: "a deadline is temporal — it belongs to the request, not to a saved search that outlives it. Set the needed-by date on the run instead",
};
/** Top-level keys a stored recipe may still CARRY and can no longer SET. Dropped on load (see loadRecipes),
 *  refused on save (see validateRecipe). One list, so the two doors cannot disagree about which is which. */
const RECIPE_RETIRED_TOP = ["caseLaw"];
const RECIPE_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const RECIPE_FREETEXT_MAX = 2000;

// Structural validation, shared by the recipe service (save-time) and the loader (load-time) so the UI can
// never persist a recipe the driver would later reject. `proseGuard` is an optional injection point for the
// profiles.mjs anti-rule guards (assertContextPackShape) — the service wires it; the default enforces the
// size cap only (this module stays a pure leaf and cannot import profiles.mjs).
export function validateRecipe(customerKey, slug, r, { proseGuard = null, platformEntryErrors = null } = {}) {
  const errs = [];
  const die = (why) => errs.push(`recipes/${customerKey}/${slug}.json: ${why}`);
  if (!RECIPE_SLUG_RE.test(String(slug ?? ""))) die(`slug "${slug}" must be a lowercase slug [a-z0-9-], 2–39 chars (it becomes a filename + the trigger key)`);
  if (!r || typeof r !== "object" || Array.isArray(r)) { die("must be a JSON object"); return { ok: false, errors: errs }; }
  for (const k of Object.keys(r)) if (!RECIPE_KEYS.includes(k)) die(`unknown key "${k}" — the recipe key set is closed (a recipe selects machinery; it can never carry profile/rating config)`);
  if (typeof r.label !== "string" || !r.label.trim()) die("label (string) is required — the display name of the saved search");
  // ORDERABILITY, not existence. `policyFor` answers for a RETIRED row too (it is the naming lookup an
  // archived report re-renders through), so testing the base with it alone let a saved search be written
  // on a product nobody can order — the invitation surviving its own retirement, one layer down from the
  // menus. The membership test is the same one the run doors apply, so a base that saves is a base that
  // runs. `base` below stays the ROW, because the component rules need its pipeline.
  const baseKey = String(r.base ?? "").trim().toLowerCase();
  const base = policyFor(r.base);
  if (!ORDERABLE_PRODUCTS.includes(baseKey))
    die(base
      ? `base "${r.base}" names a retired search — it cannot be ordered any more (one of: ${ORDERABLE_PRODUCTS.join(", ")})`
      : `base "${r.base}" is not a known product — one of: ${ORDERABLE_PRODUCTS.join(", ")}`);
  if (r.components != null) {
    if (typeof r.components !== "object" || Array.isArray(r.components)) die("components must be an object of {componentKey: boolean}");
    else for (const [ck, cv] of Object.entries(r.components)) {
      const spec = COMPONENTS[ck];
      if (!spec) { die(`component "${ck}" is not a known component — one of: ${Object.keys(COMPONENTS).join(", ")}`); continue; }
      if (typeof cv !== "boolean") die(`component "${ck}" must be a boolean`);
      // A recipe may ADD machinery to its base product; it may not SUBTRACT the common-law half. Recipe
      // components override the product's (see resolveSearchPolicy), but the NAME comes from the product
      // — so `components: {commonLawGrid: false}` would plan as a Global preliminary search while running
      // a register-only one. That is exactly the trap: a saved search's own label making a narrower
      // product read as a full one, at the moment someone approves the spend.
      //
      // The refusal used to point at the level that DID sell that product. retired it, so there is
      // nowhere to point: every clearance this build runs searches the common-law half, and this is now
      // the only door that could have re-minted the retired product under another name.
      if (ck === "commonLawGrid")
        die(`component "commonLawGrid" cannot be set on a saved search — every clearance searches the common-law / marketplace half, and the register-only level that used to be the way to buy one without it is retired. A saved search cannot subtract it: the run would carry its product's name while searching less than that name promises`);
      // jxLanes IS the native-language investigation, and it is now the product's answer rather than a
      // component a saved search may set: automatic on a Full country search, the one toggle on a
      // Multi-country focus search (`nativeLanguage` below), and not offered anywhere else. A component
      // that could switch it on over any base would put it back on the two products the offering says
      // do not carry it.
      if (ck === "jxLanes")
        die(`component "jxLanes" cannot be set on a saved search — the native-language investigation follows the product: it runs automatically on a ${productName("full-country-search")} and is the one toggle on a ${productName("multi-country-focus-search")} (save "nativeLanguage": true for that). Set the base product instead`);
      if (cv && base && !spec.pipelines.includes(base.pipeline))
        die(`component "${ck}" is not legal for base "${r.base}" (pipeline "${base.pipeline}") — ${ck} runs only on: ${spec.pipelines.join(", ")}`);
    }
  }
  if (r.extras != null) {
    if (typeof r.extras !== "object" || Array.isArray(r.extras)) die("extras must be an object");
    else for (const [ek, ev] of Object.entries(r.extras)) {
      if (RECIPE_RETIRED_EXTRAS[ek]) { die(`extras.${ek} is no longer a saved-search setting — ${RECIPE_RETIRED_EXTRAS[ek]}`); continue; }
      if (!RECIPE_EXTRA_KEYS.includes(ek)) { die(`extras.${ek} is not a known extra (${RECIPE_EXTRA_KEYS.join(" | ")}) — extras are instruction-shaped delivery preferences only`); continue; }
      if (ek === "emailTable" && typeof ev !== "boolean") die("extras.emailTable must be a boolean");
      if (ek === "standingInstructions" && (typeof ev !== "string" || !ev.trim())) die("extras.standingInstructions must be a non-empty string when present");
    }
  }
  // Free text entering run context gets the anti-rule treatment: size-capped here; the service additionally
  // runs the profiles.mjs D1 guards via proseGuard (a recipe must never smuggle a rating rule in as prose).
  for (const [field, text] of [["label", r.label], ["notes", r.notes], ["extras.standingInstructions", r.extras?.standingInstructions]]) {
    if (typeof text !== "string" || !text) continue;
    if (text.length > RECIPE_FREETEXT_MAX) die(`${field} exceeds the ${RECIPE_FREETEXT_MAX}-char budget`);
    if (proseGuard) { try { proseGuard(text, `recipes/${customerKey}/${slug}.json ${field}`); } catch (e) { die(String(e.message)); } }
  }
  // ── scope: where the machinery points ─────────────────────────────────────────────────────────────
  // Validated against the SAME rules the job door applies, because a saved search is a job template and
  // the two must not be able to disagree — a scope that saves cleanly and then clarifies at intake would
  // be a trap laid weeks earlier. `platformEntryErrors` is injected for the same reason `proseGuard` is:
  // this module is a pure leaf and cannot import profiles.mjs, where that rule lives.
  if (r.scope != null) {
    if (typeof r.scope !== "object" || Array.isArray(r.scope)) die("scope must be an object { jurisdictions?, platforms?, classes? }");
    else {
      for (const k of Object.keys(r.scope)) if (!RECIPE_SCOPE_KEYS.includes(k)) die(`scope.${k} is not a known scope field (${RECIPE_SCOPE_KEYS.join(" | ")}) — scope says WHERE to search; the base product and its components say what runs`);
      const { jurisdictions: jx, platforms: pf, classes: cl } = r.scope;
      if (jx != null) {
        if (!Array.isArray(jx)) die("scope.jurisdictions must be an array of territories (e.g. [\"US\",\"EU\"])");
        else if (jx.length > RECIPE_MAX_JURISDICTIONS) die(`scope.jurisdictions names ${jx.length} territories (max ${RECIPE_MAX_JURISDICTIONS})`);
        // prose-tolerant on purpose: "US" and "United Kingdom" both read downstream, and imposing an ISO
        // vocabulary here would reject requests the engine runs happily (enqueue-schema makes the same call)
        else for (const t of jx) if (typeof t !== "string" || t.trim().length < 2 || t.trim().length > 40) die(`scope.jurisdictions ${JSON.stringify(t)} must be a territory name or code (2–40 characters)`);
      }
      if (pf != null) {
        if (!Array.isArray(pf)) die("scope.platforms must be an array of bare store domains (e.g. [\"gnc.com\"])");
        else if (pf.length > RECIPE_MAX_PLATFORMS) die(`scope.platforms names ${pf.length} marketplaces (max ${RECIPE_MAX_PLATFORMS}) — every extra platform raises the grid floor for every variant`);
        else if (platformEntryErrors) for (const e of platformEntryErrors(pf, { label: "scope.platforms" })) die(e);
      }
      if (cl != null) {
        if (!Array.isArray(cl)) die("scope.classes must be an array of Nice class numbers");
        else for (const c of cl) if (!Number.isInteger(c) || c < 1 || c > 45) die(`scope.classes ${JSON.stringify(c)} — Nice classes are whole numbers 1–45 (1–34 goods, 35–45 services)`);
      }
      // The scope-vs-machinery rule, applied at SAVE time rather than only at run time. A saved search
      // naming marketplaces over a knockout base would validate today and clarify on every future run —
      // the failure would surface far from the edit that caused it, to someone who did not make it.
      if (base && base.pipeline === "knockout" && Array.isArray(pf) && pf.length)
        die(`scope.platforms cannot be saved against base "${r.base}" (${base.stageLabel}) — that screen has no marketplace grid for a store to be swept in; save it against a preliminary search, or drop the platforms`);
      // THE PRODUCT'S OWN GEOGRAPHY RULE, at SAVE time. A saved search is a job template, so a scope its
      // base product does not accept is a trap laid weeks before anyone meets it — the same argument the
      // platforms rule above makes. One module writes the sentence (products.mjs) and every door quotes
      // it, so what a lawyer reads when a save is refused is what a client reads when a run is.
      if (ORDERABLE_PRODUCTS.includes(baseKey) && Array.isArray(jx)) {
        const verdict = checkProductScope({ product: baseKey, territories: jx });
        if (!verdict.ok) die(`scope.jurisdictions — ${verdict.message}`);
      }
    }
  }
  // caseLaw: NO LONGER A SAVED SETTING. It is a product — the Full country
  // search carries the case-law and opposition reading, and nothing else in the offering offers it — so
  // a saved `caseLaw: true` over any other base would sell a search that does not exist, and over a Full
  // country search it would restate what the base already decides.
  //
  // Refused HERE, at the save door, where somebody is present to read why and change the base. NOT at
  // the load door: `loadRecipes` throws on any error, so refusing to load one stale file would take down
  // every saved search of every customer. It is dropped there instead — see RECIPE_RETIRED_TOP.
  if (r.caseLaw != null)
    die(`caseLaw is no longer a saved-search setting — the case-law and opposition reading is what a ${productName("full-country-search")} IS, and no other product offers it. Save this against base "full-country-search" over exactly one country, or drop caseLaw`);
  // nativeLanguage: the ONE toggle in the offering, and it belongs to one product. Same shape as the job
  // field so a saved search stays a job template all the way down.
  if (r.nativeLanguage != null && typeof r.nativeLanguage !== "boolean") die("nativeLanguage must be a boolean (true adds the native-language investigation to a Multi-country focus search)");
  else if (r.nativeLanguage === true && ORDERABLE_PRODUCTS.includes(baseKey)) {
    const verdict = checkNativeLanguage({ product: baseKey });
    if (!verdict.ok) die(`nativeLanguage — ${verdict.message}`);
  }
  // PRESENT-AND-NOT-A-BOOLEAN, not `!= null` — the same hole profiles.mjs closed for projects, still
  // open in this copy: `archived: null` passed the loose check, then the stickiness guard (which only
  // re-applies on `undefined`) skipped it and every consumer read it as falsy, silently UN-ARCHIVING a
  // retired saved search. Only an explicit `false` may bring one back.
  if ("archived" in r && typeof r.archived !== "boolean") die("archived must be a boolean");
  if (r.version != null && !Number.isInteger(r.version)) die("version must be an integer");
  return { ok: errs.length === 0, errors: errs };
}

// sha over canonical (key-sorted) JSON — the freeze identity: a run records WHICH recipe content it ran
// (profileShaOf's discipline), so editing a recipe mid-run is provably irrelevant to a live run.
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export function recipeShaOf(recipe) { return createHash("sha256").update(canonicalJson(recipe)).digest("hex"); }

const HERE = dirname(fileURLToPath(import.meta.url));
let recipeCache = null;

/**
 * Load every <dir>/<customer>/<slug>.json → Map("customer/slug" → recipe). A missing dir is an empty map
 * (recipes are optional everywhere); an INVALID recipe file hard-fails loudly (config error — the same
 * load discipline as profiles.mjs; intake callers wrap and fail OPEN so infra trouble never blocks a run).
 *
 * THE STORE IS NAMED, NEVER GUESSED. `CLEAROTRON_RECIPES_DIR` unset means this deployment has no saved
 * searches — not that it should use the ones bundled with the source.
 *
 * `driver/recipes/` ships synthetic demos for two FICTIONAL customers (aurora, zephyr) so the dev
 * cockpit and the tests have something to render. It used to be the fallback when the env var was
 * unset, which is a foot-gun that only fires in production: the real deployment does not set the
 * variable, so switching saved searches on there would have surfaced invented customers inside the
 * product. Fixture data must be asked for by name — a deployment that has not named a store has none.
 */
export function loadRecipes({ dir = process.env.CLEAROTRON_RECIPES_DIR || null, force = false, proseGuard = null, platformEntryErrors = null } = {}) {
  if (!dir) return new Map();   // no store configured ⇒ no saved searches (never the bundled demos)
  if (recipeCache && !force && recipeCache.dir === dir) return recipeCache.recipes;
  const recipes = new Map();
  retiredBaseSkips.length = 0;
  let customers = [];
  try { customers = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { recipeCache = { dir, recipes }; return recipes; }   // no recipe store ⇒ empty (not an error)
  for (const customer of customers) {
    let files = [];
    try { files = readdirSync(join(dir, customer)).filter((f) => f.endsWith(".json")); } catch { continue; }
    for (const f of files) {
      const slug = f.replace(/\.json$/, "");
      const r = JSON.parse(readFileSync(join(dir, customer, f), "utf8"));   // parse error = loud (config bug)
      // A RETIRED extra is dropped here, not refused. Refusing to SAVE one is right — that is the door
      // where somebody is asking for a behaviour that no longer exists. Refusing to LOAD one would be a
      // different and much worse thing: a key that has never done anything would take out every run that
      // names the saved search carrying it, turning a tidy-up into an outage on config nobody has touched.
      // Dropped rather than kept, because leaving it in the store means it reappears in the editor and
      // gets saved back. Silent because the value was inert by definition: nothing observable changes.
      if (r?.extras) for (const k of Object.keys(RECIPE_RETIRED_EXTRAS)) delete r.extras[k];
      // A RETIRED TOP-LEVEL SETTING, same rule for the same reason. `caseLaw` was a saved lever until the
      // offering made case law a PRODUCT; validateRecipe refuses to save one, and dropping it here is what
      // stops a store written last week from taking every tenant's saved searches down today. Silent
      // because it is inert by construction: the product decides, and this key can no longer change it.
      if (r && typeof r === "object") for (const k of RECIPE_RETIRED_TOP) delete r[k];
      // A RETIRED BASE IS DROPPED HERE FOR THE SAME REASON, and it is the reason nearly shipped an
      // outage. validateRecipe refuses a retired base — right at the SAVE door, where somebody is asking
      // to order a product that no longer exists. But validateRecipe is shared with this LOAD door, and
      // this door throws on any error, so one stale file anywhere in the store would take the whole store
      // down: the valid recipes of every unrelated customer, and with them GET /portal/api/searches,
      // describe_options, plan_run and start_run, for every tenant. That is the tidy-up-becomes-an-outage
      // shape the retired-extras note above was written against, one level up — and worse, because a
      // recipe is not inert.
      //
      // NOT SILENT, because unlike a retired extra this one is observable: a saved search disappears. The
      // skip is recorded so a caller can say why rather than leaving a lawyer's saved search gone with no
      // reason. Everything else still throws — a config error is still load-blocking.
      if (RETIRED_PRODUCTS.includes(String(r?.base ?? "").trim().toLowerCase())) {
        retiredBaseSkips.push({ customer, slug, base: String(r.base), why: "base names a retired search — the saved search cannot be ordered" });
        continue;
      }
      // proseGuard (review 2026-07-18): the driver doors pass the D1 anti-rule guards so a recipe that
      // BYPASSED the service (hand-committed to the store) still cannot smuggle rating prose into a run
      // — the same load-time discipline profiles get. The service saves with the guard too; a guard
      // throw here is a loud config error, exactly like an invalid recipe file.
      const v = validateRecipe(customer, slug, r, { proseGuard, platformEntryErrors });
      if (!v.ok) throw new Error(v.errors.join("; "));
      recipes.set(`${customer}/${slug}`, r);
    }
  }
  recipeCache = { dir, recipes };
  return recipes;
}

// ── Mark budget (knockout batches) ──────────────────────────────────────────────────────────────────
export function countJobMarks(job) {
  const names = Array.isArray(job?.marks) ? job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean) : [];
  return names.length || ((job?.markName || job?.name) ? 1 : 0);
}
// The mark → filesystem-key derivation (research payloads, fixtures). ONE definition — the knockout
// lane keys per-mark artifacts on it, so two batch marks that collide here ("MOTO X" / "MOTO-X") would
// silently share a research payload; every door checks collisions with THIS function.
export const kebab = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "mark";
export function kebabCollisions(names) {
  const seen = new Map(); const out = [];
  for (const n of names ?? []) {
    const k = kebab(n);
    if (seen.has(k)) out.push([seen.get(k), String(n)]);   // exact duplicates collide too — same key
    else seen.set(k, String(n));
  }
  return out;
}
/**
 * Per-run SCOPE against the machinery that would run it. The twin of checkMarkBudget, and called at the
 * same two doors for the same reason: validateJob can only see an EXPLICIT selector, so a profile-default
 * product is only knowable at the runner's admission gate.
 *
 * A knockout is deliberately a different product: "no register machinery, no grid, no coverage ledger —
 * the sweep is ONE broad question per mark" (pipeline-knockout.mjs).
 *
 * TERRITORIES ARE ACCEPTED (2026-07-20). They were once refused here on the grounds that a knockout is
 * global by design, but that mistook a DEFAULT for a property of the product. Scope and depth are two
 * axes of one scale — a search gets more expensive as it goes deeper AND as it narrows onto specific
 * places — so "global" is the widest setting of a knob, not a fact about Stage 0. The machinery already
 * agreed: pipeline-knockout.mjs freezes job.jurisdictions into the instructed-scope sidecar, and only
 * the sweep prompt ignored them. It no longer does (stages-knockout.mjs renders the named territories).
 *
 * MARKETPLACES ARE STILL REFUSED, and the asymmetry is real rather than an oversight. A knockout has no
 * marketplace grid for a store to be added to: its sweep is one broad question per mark, not a per-store
 * grid, so a named platform would be recorded in the sidecar and swept by nothing. That is the
 * accept-and-ignore shape — the deliveryRoute:"portal" rule exactly: an unavailable request CLARIFIES,
 * it is never a silent no-op. The fix is to run the level whose grid does sweep stores.
 */
export function checkScopeAgainstPolicy(job, policy) {
  const errors = [], warnings = [];
  if (!policy || policy.pipeline !== "knockout") return { errors, warnings };
  const has = (k) => Array.isArray(job?.[k]) && job[k].length > 0;
  if (has("platforms"))
    errors.push(`a ${policy.stageLabel} screen has no marketplace grid to add platforms to — its sweep is one broad question per mark, not a per-store grid. Drop platforms to run the quick screen, or ask for a preliminary search, whose common-law grid sweeps the account's marketplaces plus any named here`);
  return { errors, warnings };
}

/**
 * How many names this search may carry, against THE OFFERING's figure — not the registry's.
 *
 * There were two numbers until and the wrong one enforced: the level registry said 20 marks for both
 * knockout rows while the offering said "up to 8 names", so a twelve-name knockout passed every door.
 * `maxNamesFor` (products.mjs) is now the only figure, and it is the same one every menu, every tagline
 * and every refusal is computed from — nothing about the count is hand-typed anywhere.
 *
 * The soft cap went with the second number rather than being renumbered: a warning at 15 under a hard
 * refusal at 8 is a branch that can never run, and a rule that cannot fire is worse than no rule because
 * it reads as coverage.
 *
 * EVERY PRODUCT IS BUDGETED, not only the knockouts. The clearances say one name and always have; they
 * were simply never enforced ("an intake convention, not a schema rule"), which meant a three-name
 * clearance was accepted at the door and then ran as one search over one name with the other two
 * silently dropped. A retired row has no offering figure and is not budgeted — nothing can be ordered at
 * one, so the only jobs that reach here carrying one are archived.
 */
export function checkMarkBudget(job, policy) {
  const errors = [], warnings = [];
  const max = maxNamesFor(policy?.product);
  if (!Number.isInteger(max)) return { errors, warnings };
  const n = countJobMarks(job);
  if (n > max)
    errors.push(`${n} names exceeds the ${max}-name limit for a ${policy.stageLabel} — ${max === 1
      ? "a clearance reads one name at a time; send one search per name, or order a Knockout search to screen them together"
      : "split the request"}`);
  return { errors, warnings };
}

// ── Resolution ──────────────────────────────────────────────────────────────────────────────────────
// Order (first hit wins): job.recipeKey → job.product → the profile's defaultProduct (the
// EFFECTIVE profile already merged project-over-customer, so one field read covers both, with origins) →
// THE SCOPE ITSELF.
//
// THAT LAST RUNG IS THE OFFERING, AND IT IS NOT A CONSTANT. The Generic default used to be the literal
// level `prelim`, which named three different products depending on where it pointed. A clearance that
// names no product IS whichever product its territories make it — `productFor(pipeline, scope)`, the one
// function that answers that question anywhere — so the default is derived, not picked. The caller hands
// in the RESOLVED scope (`territories`) because resolving it needs the profile and the project overlay,
// which are effective-scope.mjs's business and not this leaf's; `resolveRequest` (resolve-request.mjs)
// is the one place that sequences the two, so no door has to know the order.
//
// ANY unknown token → { clarify } — a typo must never silently run a different-priced product.
//
// `profile` may be the raw resolved profile, the effective profile, or the frozen run sidecar —
// only `key`/`profileKey`, `defaultProduct`, `allowedRecipes` and `origins` are consulted.
// `allowedRecipes` (customer-only, optional): when PRESENT, the resolved selection — whatever its source,
// including a staff-set default — must be listed (product key, recipe slug, or full recipe key), else
// clarify: a contradiction between defaults and entitlements is surfaced, never silently re-picked.
export function resolveSearchPolicy(job, { profile = null, recipes = null, territories = [] } = {}) {
  const customerKey = String(profile?.key ?? profile?.profileKey ?? "generic");
  const explicitProduct = String(job?.product ?? "").trim().toLowerCase();
  const explicitRecipe = String(job?.recipeKey ?? "").trim().toLowerCase();
  // Untrusted tokens are ALWAYS echoed JSON-stringified (review 2026-07-17): clarify messages ride reason
  // files, outbox packets and log lines — a newline-bearing selector must never inject rows into them.
  const echo = (s) => JSON.stringify(String(s ?? ""));
  if (explicitProduct && explicitRecipe)
    return { clarify: `both product (${echo(explicitProduct)}) and recipeKey (${echo(explicitRecipe)}) are set — name ONE selector (a saved search already carries its product)` };

  let product, origins, recipeInfo = null, components = null, extras = null, recipeScope = null, recipeNative = false;
  if (explicitRecipe) {
    const key = explicitRecipe.includes("/") ? explicitRecipe : `${customerKey}/${explicitRecipe}`;
    const [owner] = key.split("/");
    if (owner !== customerKey)
      return { clarify: `recipeKey ${echo(explicitRecipe)} belongs to "${owner}" but this run is for "${customerKey}" — a recipe can only run for its own customer` };
    const r = recipes?.get?.(key);
    if (!r) return { clarify: `recipeKey ${echo(explicitRecipe)} names no saved search for ${customerKey} — check the recipe list, or name a product instead` };
    if (r.archived) return { clarify: `saved search ${echo(explicitRecipe)} is archived — un-archive it or name a product` };
    product = String(r.base).toLowerCase();
    components = { ...policyFor(product)?.components, ...(r.components ?? {}) };
    extras = r.extras ?? null;
    // The saved WHERE, carried out for the effective-scope resolver to place in the ladder. Returned
    // rather than merged here: this function resolves MACHINERY, and a scope needs the profile and the
    // project overlay to be resolved against, neither of which is this function's business.
    recipeScope = r.scope ?? null;
    // Only true travels — see validateRecipe. A saved `false` resolves to the same "not requested" the
    // absence of the key means, because the toggle can add the investigation and never take one away.
    recipeNative = r.nativeLanguage === true;
    recipeInfo = { key, version: r.version ?? 1, sha: recipeShaOf(r) };
    origins = { level: "job.recipeKey" };
  } else if (explicitProduct) {
    // THE SAME SENTENCE THE DOORS REFUSE WITH, from products.mjs, quoting the token AS WRITTEN. This arm
    // is the requester's own typo — the same fact enqueue-schema refuses at the door — so it must not be
    // a second wording, and it must carry the remedy clause that says the field is optional. The other
    // two "names no search we offer" sentences below are different audiences and stay where they are.
    if (!ORDERABLE_PRODUCTS.includes(explicitProduct))
      return { clarify: unknownProductMessage(job?.product) };
    product = explicitProduct;
    origins = { level: "job.product" };
  } else {
    const dflt = String(profile?.defaultProduct ?? "").trim().toLowerCase();
    if (dflt) {
      if (!ORDERABLE_PRODUCTS.includes(dflt))
        return { clarify: `profile defaultProduct ${echo(dflt)} names no search we offer — fix the ${customerKey} profile (one of: ${ORDERABLE_PRODUCTS.join(", ")})` };
      product = dflt;
      origins = { level: profile?.origins?.defaultProduct === "project" ? "project.defaultProduct" : "profile.defaultProduct" };
    } else {
      // THE SCOPE NAMES THE PRODUCT. A clearance is the house shape (a knockout is never defaulted into
      // — it is a different product and has to be asked for), and which clearance it is follows from
      // where it points. `productFor` is total over the clearance pipeline, so this always names one.
      product = productFor({ pipeline: "clearance", territories });
      origins = { level: "the-scope" };
    }
  }

  const policy = policyFor(product);
  if (!policy) return { clarify: `product ${echo(product)} names no search we offer` };   // recipe base drifted past the registry
  // THE ORDERABILITY WALL, and it is here rather than in each branch on purpose: the explicit and
  // profile-default branches check ORDERABLE_PRODUCTS as they read, but a RECIPE base arrives already
  // resolved to a row by `policyFor` — which answers for a retired row, because that is what re-renders
  // an archived report. Without this, a saved search written before the retirement kept ordering a
  // product that no menu offers and no door refuses. Every selector now passes exactly one test.
  if (!ORDERABLE_PRODUCTS.includes(product))
    return { clarify: `product ${echo(product)} is retired and can no longer be ordered — one of: ${ORDERABLE_PRODUCTS.join(", ")}` };
  // Entitlement (allowedRecipes present ⇒ closed menu; absent ⇒ everything allowed — no behavior change
  // for every existing profile). A RECIPE selection matches only by its own identity (slug or full key) —
  // listing a bare product entitles that bare product, never every recipe based on it (review
  // 2026-07-17); a PRODUCT selection matches the product key.
  const allowed = Array.isArray(profile?.allowedRecipes) ? profile.allowedRecipes.map((s) => String(s).toLowerCase()) : null;
  if (allowed) {
    const names = recipeInfo ? [recipeInfo.key, recipeInfo.key.split("/")[1]] : [product];
    if (!names.some((n) => allowed.includes(n)))
      return { clarify: `search "${recipeInfo?.key ?? product}" is not in ${customerKey}'s allowed searches (${allowed.join(", ")}) — pick an allowed search, or ask staff to widen allowedRecipes` };
  }
  const spec = productSpec(product);
  // ── THE NATIVE-LANGUAGE INVESTIGATION, decided by the product and never by a component ──────────────
  // "automatic" means the client neither chooses it nor is charged a toggle for it — it is what a Full
  // country search IS. "offered" is the one toggle in the offering (Multi-country focus). "absent" is
  // both other products, and a request that asked for it there was already refused at the door.
  //
  // NOT a promise a lane RUNS: the lanes route on jurisdiction and a country with no adapter has nothing
  // to route. scope-rules.mjs refuses an unrouted lane only where one was ASKED for, which is why the
  // automatic arm can never produce a refusal we inflicted on ourselves.
  const nativeLanguage = spec?.nativeLanguage ?? "absent";
  const nativeRequested = job?.nativeLanguage === true || recipeNative;
  const jxLanes = nativeLanguage === "automatic" ? true : (nativeLanguage === "offered" ? nativeRequested : false);
  return {
    // `level` is the FROZEN SIDECAR's key for this same value, and its VALUE is a product id. The key
    // name survives because pipeline.mjs writes `level: resolved.level` into _driver/search-policy.json
    // and every archived run already carries it — and that file belongs to another in-flight build, so
    // renaming it there is that build's edit and not this one's. One value, two readers, never two
    // answers. See the commit body.
    product, level: product,
    pipeline: policy.pipeline, stageLabel: policy.stageLabel,
    components: { ...(components ?? policy.components), jxLanes },
    maxNames: maxNamesFor(product),
    nativeLanguage, nativeRequested,
    recipe: recipeInfo, extras, origins, recipeScope,
    // CASE LAW IS THE PRODUCT. It used to be a job flag ORed with a saved
    // search's own copy, and `decideCaseLaw` still reads `policy.caseLaw` — so setting it from the
    // product here is what ties the stage to the thing that was sold, with no flag left to disagree.
    // The other arm of decideCaseLaw is untouched: a run whose own reading turns up an opposition or a
    // precedent still grounds the stage mid-flight, unordered. This says what was BOUGHT.
    caseLaw: spec?.caseLaw === true,
  };
}
