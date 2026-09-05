// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// findings-model.mjs — the machine contract for the per-finding clearance record.
//
// Findings used to live as forgiving labelled markdown: the Excel mapped single scalars (with ORPHAN
// composite/risk_level/dispute_type columns nothing populated), and risk level/composite/dispute-type
// existed only as a PACKED STRING in a card label. The report + Excel are DATA-DRIVEN — every value
// comes from the finding records — so they could not be built against that flat markdown. This module
// is the spine: synthesis POPULATES it, the report/Excel render CONSUMES it, and the verify.mjs
// validators.findings slot strict-checks it. It carries what the flat markdown could not:
//   - owner.registrations[]  — A3: one owner with several registrations never transposes another's
//     facts (a live number/date swap was exactly this).
//   - decomposed composite (1-5) / level (A-E) / dispute_type — no more packed label string.
//   - the four meters (mark_similarity / goods_proximity / use / enforcer) as CLOSED tokens, each with
//     a per-claim basis enum (B1: verified-from-record vs inferred-from-signal — never present inferred
//     as fact).
//   - quadrant {x,y} + a per-finding ordinal — the F1/F2 landscape drill-through.
//   - typed source_type (E2 — labels constrained to a finding's source) + resolved_link (E1 — the link
//     ACTUALLY fetched).
//   - a per-coverage-AREA record with the redesigned 5 states.
//
// Modeled EXACTLY on coverage-ledger.mjs: a PURE module (its only import is framework.mjs's pure band
// vocabulary helpers; tests offline); strict, with
// the OFFENDING TOKEN FIRST in every throw message so the gateway.mjs correctionHint / WARM_ELIGIBLE_RE
// retry ladder can key on it; `additionalProperties:false` by hand (a key allowlist loop — the driver
// has no JSON-schema library). The CALLER (validators.findings in verify.mjs) converts the throw to a
// validator fail — a parse miss must never pass, and a validator must never throw (runStage calls
// validate() bare, so an escaped throw would crash the run past the whole corrective ladder).
//
// Every throw token is prefixed `findings_` (top-level shape) or `finding_` (a specific finding/field),
// so the gateway's single `/findings?_/` branch routes the whole family. Closed-enum const names mirror
// coverage-ledger.mjs (REGISTER_AXES / COVERAGE_STATUSES) so the vocabulary lives in one place.

// ── closed vocabularies (owned here; exported for the render/Excel + tests) ───────────────────────────
// Reconciled to the real domain vocabulary at Phase-1 population (the Phase-0 placeholders were a guess):
// dispute_type = the five risk-framework.md §Dispute Types; meters = the REPORT-DESIGN-SPEC §5 3-pip model
// (high/medium/low for the risk meters; the FINE position lives in quadrant.{x,y}, the meter is the coarse
// pip). use is confirmed/green per the spec. enforcer keeps the verified/inferred basis (B1).
export const LEVELS = ["A", "B", "C", "D", "E"];                                   // legal exposure, net of merits defences
export const DISPUTE_TYPES = ["classic", "horse-trade", "paper-conflict", "descriptive-terms", "nuisance-claim"];
export const METERS = ["mark_similarity", "goods_proximity", "use", "enforcer"];   // the four strength meters
export const METER_TOKENS = {
  mark_similarity: ["high", "medium", "low"],
  goods_proximity: ["high", "medium", "low"],
  use: ["confirmed", "not-confirmed", "unknown"],
  enforcer: ["high", "medium", "low", "unknown"],
};
export const BASIS_VALUES = ["verified-from-record", "inferred-from-signal"];       // B1
export const SOURCE_TYPES = ["register-vendor", "register-euipo", "common-law-marketplace", "common-law-web", "case-law"]; // E2
export const COVERAGE_AREA_STATES = ["confirmed-clean", "coverage-limited", "open", "not-searched", "note"]; // the redesigned 5
// CHANGE 2 (banding) — an OPTIONAL per-finding PLACEMENT token. It moves a card between report BANDS only; it
// NEVER recomputes composite/level (a Composite-3 coexistence-partner renders in band 2, a Composite-3
// adversarial leads band 1). ABSENT is allowed: a legacy/archived findings.json with no disposition falls back
// to the composite-based banding so it renders byte-identically. The four values map to the three render bands:
//   adversarial → band 1 (On-field conflicts, drives the verdict);
//   coexistence-partner / distinguished → band 2 (Notable but manageable);
//   off-field → band 3 (Commercial awareness).
// A1: "withdrawn" = a finding the corrective (reviewer-driven) pass KILLED. It stays in
// findings.json for the forensic/audit surface but renders NOWHERE (render + card generation +
// client summary all exclude it) — a killed card can never resurrect (the VENZY Kestrel case).
export const DISPOSITIONS = ["adversarial", "coexistence-partner", "distinguished", "off-field", "withdrawn"];
// ── — the schema version this driver DICTATES, and the contract it turns on ──────────────────────
// v6 = "no disposition is structurally exempt". Every disposition that reaches a reader carries
// legal_position AND practical_position; `off-field` additionally declares WHICH of its two sanctioned
// grounds it rests on. Version-gated because parseFindingsJson is on the ARCHIVE REPUBLISH path
// (publish/index.mjs, render.mjs, pool-admin doRepublish): a gate applied at v5 would make every
// delivered run un-republishable. Archived v≤5 documents parse byte-identically, forever.
//
// ── — v7, ARMED 2026-08-06 with the render freeze-break. ──────────────────────────────────
//
// v7 = "the finding sentence is a conclusion, not a chain": the same per-finding record as v6, with the
// chain punctuation refused on `net` (validateNetShape / findings_net_chained). It adds no top-level key
// and no per-finding key — TOP_KEYS_V7 / FINDING_KEYS_V7 are v6's lists, exactly as V6 was V5's.
//
// IT SHIPPED INERT FIRST, and the reason is worth keeping because the same trap is waiting for v8.
// `driver/publish/render.mjs` used to read
//
//     NEGATIVES_GROUPED = DISPOSITION_MODE && Number(opts.findingsSchemaVersion) >= FINDINGS_SCHEMA_VERSION;
//
// while its own comment said it "fires only on a record that declares the v6 contract". It meant the
// FLOOR 6 and was written as this MOVING constant, which was the same number on the day it was written.
// Bumping here alone would have made every archived v6 run — v6 shipped 2026-08-03, so real delivered
// matters carry it — republish through pool-admin doRepublish with the ground-grouped reasoned
// negatives silently replaced by the pre- region-grouped section. Not a crash: a substance change to
// a report already sent to a client, which is what the render freeze exists to catch. MEASURED at the
// break: 34,722 → 36,466 body bytes on a three-negative v6 fixture. That line now reads `>= 6`.
//
// THE ARMING, DONE — the checklist this block carried before the bump, kept as the record of what it
// took, because the same three questions come back at v8. `= 7` alone took the driver suite from 3660
// passing to 3649, and the failures named the work:
//
//   1. driver/publish/render.mjs — the NEGATIVES_GROUPED comparison above. Pinned to the literal `>= 6`.
//      Three render.test.mjs failures were this, and they were the archived-v6 republish silently losing
//      its ground-grouped reasoned negatives. It is a frozen file, which is why the bump waited for the
// break rather than taking one of its own.
//   2. driver/predelivery-lint.mjs — schemaVersionChecks compares the same way and there the comparison
//      is CORRECT ("declares the current version"), so it was left. Its DETAIL STRING was wrong: it
//      interpolated this constant while naming v6's gates by hand, so at 7 it told a reader that "the v7
//      parser gates (positions on every disposition, the off-field ground)" did not engage, which are
//      v6's gates. NO TEST FAILED ON IT — it is prose inside a message. It now names the rungs the file
//      is below, from a laddered list, so it cannot go stale at v8.
//   3. driver/test/framework-prompt.test.mjs pinned the dictated version. One expected value, plus its
//      anti-resurrection class, which v6 joined: dictating 6 would disengage validateNetShape.
//
// SO: NEVER BIND A FLOOR TO THIS CONSTANT. It is "the version this driver dictates" and nothing else.
// A comparison that means "v6 or later" writes the literal 6, because the floor stops moving when the
// contract it names is satisfied, and this number does not. Anything reading it as a floor breaks
// silently on the next bump, in the direction of rewriting delivered documents.
export const FINDINGS_SCHEMA_VERSION = 7;
// requirement 1 — the dispositions that must carry both positions. FOUR of the five, and the
// omission is reasoned, not an exemption: `withdrawn` is not a withdrawn APPLICATION, it is a finding the
// reviewer's corrective pass KILLED ( A1). It renders nowhere, and it already carries a mandatory
// withdrawn_reason — the ground for the one label no reader ever sees. Requiring positions on it would
// also mean the corrective pass could no longer kill an unrated finding: the killer edits `disposition`
// and re-saves, the file is re-validated, and the model would have to author a legal read for a card it
// is deleting. See issue comment 2026-08-03.
export const POSITION_REQUIRED_DISPOSITIONS = ["adversarial", "coexistence-partner", "distinguished", "off-field"];
// requirement 2 — off-field's TWO sanctioned grounds, made to declare themselves.
//
// `off-field` had been carrying two different claims under one token: "the same token in a different
// commercial field" (a GOODS claim) and doc-50's "a conflict the client clearly wins with no material
// risk" (NOT a goods claim). The 08-02 VENZY run is what that costs: BRUVENZA conceded the Australian
// goods wording was unrestricted "pharmaceutical preparations", said the distance "is carried by the mark
// rather than by the goods", and was labelled NOT IN OUR FIELD anyway.
//
// So the author declares which ground, and each is gated on its own terms:
//   different-field   — a claim ABOUT THE GOODS. The finding's own goods_proximity meter must read `low`.
//                       A record cannot say "different commercial field" and "the goods are proximate" at
//                       once; that is a contradiction inside one record, and code can see it without
//                       re-judging anything (spec 64's rule: code partitions a closed enum, it never
//                       greps prose for legal meaning).
//   no-material-risk  — doc-50's clear win. Carries NO field claim, so the renderer may never group it
//                       under "a different commercial field"; it groups under its own ground, in its own
//                       words. Kept reachable deliberately: narrowing off-field to the goods claim alone
//                       would leave a mark-based clear win un-typeable (distinguished demands a band, and
//                       the framework's lowest band is "never for clear wins").
// What this does NOT do: stop a mark-similarity argument being WRITTEN into a no-material-risk item. Code
// cannot read an argument. That half is prompt-instructed — see stages.mjs.
export const OFF_FIELD_GROUNDS = ["different-field", "no-material-risk"];
// Context notes (A1) — the valid HOME for a knowledge-cited reference that is NOT a fetched-record finding:
// a famous one-keystroke neighbour kept for diligence per digest.md's "never dropped" rule but with NO
// register record to ground a finding (e.g. CHROME on a NOVAPULSE clearance). A context note is NEVER a finding
// (no composite/level/meters/registration), never drives the rating, and carries no uri — so it cannot
// launder an ungrounded mark into the findings contract: the F-14 URI guard (validateOwner) stays whole, and
// "the famous neighbour is never dropped" is honoured HERE rather than via a broken empty-uri finding.
export const CONTEXT_NOTE_TYPES = ["famous-neighbour-ungrounded"];
// ── spec 64 — typed forward actions: the machine register of "things a human must still do" ───────────
// The opinion's named forward steps live HERE as data, not only as prose: synthesis POPULATES actions[]
// (the report's "# Actions → Only you can close these" renders FROM it), and the run disposition is
// DERIVED from it — findings carrying a live CONDITION-kind action can never deliver CLEAR (the
// legalActions arm of pipeline applyCoverageFloor). The AUTHOR declares the kind from their legal read;
// code only partitions the closed enum — a keyword grep over prose is the failure mode spec 64 forbids.
//   CONDITION_KINDS — a forward legal act must happen before the client can rely on a clean result;
//   ADVISORY_KINDS  — never gates a clean result: facts only the client holds (client-fact), commercial
//   calls (commercial-decision), watch items (monitoring), and ordinary filing mechanics (filing-routine
//   — the "nothing beyond ordinary filing" home). Senior-lawyer ruling 2026-07-11: an unanswered client question alone
//   stays CLEAR and renders as a labelled open item, never a block.
export const CONDITION_KINDS = [
  "consent", "coexistence-agreement", "territorial-delimitation", "goods-amendment",
  "mark-modification", "senior-clearance", "proceeding-response", "counsel-opinion-required",
];
export const ADVISORY_KINDS = ["client-fact", "commercial-decision", "monitoring", "filing-routine"];
export const ACTION_KINDS = [...CONDITION_KINDS, ...ADVISORY_KINDS];
// A2 — the canonical composite→client-tier map. LEGACY-ONLY since doc 50 (schema_version ≤ 3):
// archived runs keep rendering/validating byte-identically off this table. On schema_version 4 the
// client-facing risk word is the finding's `band` — a word from the FRAMEWORK IN FORCE's own manifest
// (frozen per run) — and this table plays no part. Do not extend it; it exists for the archive.
export const CLIENT_TIER_BY_COMPOSITE = { 1: "LOW", 2: "MANAGEABLE", 3: "MEDIUM", 4: "HIGH", 5: "VERY HIGH" };

// ── doc 50 — band mode (schema_version 4): the framework in force rates the matter ────────────────────
// A v4 finding carries `band` — one of the frozen framework manifest's ordered band words (zephyr says
// "Medium", the Generic default says "Moderate", aurora has a "Low") — and NO composite/level/
// dispute_type (one rating authority; the retired scale is FORBIDDEN, not just optional). Presentation
// joins on the band's TONE (a closed enum in the manifest) so 4-band and 5-band ladders both land on the
// existing badge/gauge ramps without any per-framework code.
import { bandIndex, bandTone, worstBand, aboveLowestBand, normalizeBand } from "./framework.mjs";
const BADGE_BY_TONE = { severe: "l4", high: "l4", medium: "l3", low: "l2", minimal: "l2" };
const GAUGE_BY_TONE = { severe: 4, high: 3, medium: 2, low: 1, minimal: 1 };
/** The zero-banded-findings display word: a clean v4 run has NO rated conflicts — "Low" is not a band. */
export const NO_RATED_CONFLICTS = "No rated conflicts";

/** Worst (most severe) band label across LIVE findings, by the manifest's order; null when none. PURE. */
export function worstLiveBand(findings, manifest) {
  return worstBand(manifest, (findings ?? []).filter((f) => f && f.disposition !== "withdrawn").map((f) => f.band));
}

// ── T2 — THE single display-verdict derivation (H5) ─────────────────────────────────────────────
// copper-spire shipped THREE contradicting labels because three surfaces owned three authorities: the
// reviewer verdict (verdict.json), a model-authored fm.overall_label on the report hero, and a haiku
// re-voicing on the client summary. The model owns exactly TWO judgments — the per-finding composites
// and the reviewer verdict; EVERY display label is now derived from those two HERE, once, and every
// surface joins the derivation (report hero/gauge, meta.json, client summary, email). Code never stamps
// a legal verdict — it only formats the model's own.
// Badge/gauge vocabulary matches the shipped surfaces: badge l1(⚪ clear)/l2(🟢)/l3(🟠)/l4(🔴)
// (publish/index.mjs BADGE_EMOJI); gaugeIndex 0-4 = the hero dial's five stops (render.mjs RISK_STOPS).
const BADGE_BY_COMPOSITE = { 0: "l1", 1: "l2", 2: "l2", 3: "l3", 4: "l4", 5: "l4" };
const GAUGE_BY_COMPOSITE = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 };

/** Max composite across LIVE (non-withdrawn) findings; 0 when none. PURE. */
export function maxLiveComposite(findings) {
  return (findings ?? []).reduce((m, f) => (f && f.disposition !== "withdrawn")
    ? Math.max(m, Number(f.composite) || 0) : m, 0);
}

/**
 * Derive every display field from the two model judgments. verdict/reasons/kinds = the reviewer verdict
 * sidecar (post-clamp); findings = the FINAL findings set (post-corrections/consolidation).
 * Returns { verdict, tier, badge, gaugeIndex, maxComposite, band, conditions } — tier is the canonical
 * client word for the WORST live finding.
 *
 * BAND MODE (doc 50): pass the run's frozen framework `manifest` and the tier is the worst live BAND
 * word — or NO_RATED_CONFLICTS at zero banded findings (never "LOW"; there is no Low). FAIL-LOUD RULE:
 * findings that carry bands with NO manifest supplied THROW — deriving would silently mis-badge a
 * Very High matter as the zero-composite "LOW", which is the one catastrophic path this guards.
 * LEGACY (no manifest, composite findings): byte-identical to the pre-doc-50 derivation.
 */
export function deriveDisplayVerdict({ verdict, reasons, kinds, findings, manifest }) {
  const base = {
    verdict: String(verdict || "").toUpperCase() || null,
    conditions: Array.isArray(reasons) ? reasons.filter(Boolean) : [],
    kinds: kinds && typeof kinds === "object" ? kinds : {},
  };
  const banded = (findings ?? []).some((f) => f && f.band != null && f.disposition !== "withdrawn");
  if (banded && !manifest)
    throw new Error("findings_band_without_manifest: band-rated findings need the run's frozen framework manifest (_driver/framework.json) — refusing to default a rated matter to LOW");
  if (manifest) {
    const worst = worstLiveBand(findings, manifest);
    const tone = worst ? bandTone(manifest, worst) : null;
    return {
      ...base,
      tier: worst ?? NO_RATED_CONFLICTS,
      badge: (tone && BADGE_BY_TONE[tone]) || "l1",
      gaugeIndex: (tone && GAUGE_BY_TONE[tone]) || 0,
      maxComposite: maxLiveComposite(findings),   // 0 on a pure v4 set — kept for shape compatibility
      band: worst ? { label: worst, rankFromTop: bandIndex(manifest, worst) + 1, scale: manifest.bands.length } : null,
    };
  }
  const maxComposite = maxLiveComposite(findings);
  return {
    ...base,
    tier: CLIENT_TIER_BY_COMPOSITE[maxComposite] ?? "LOW",
    badge: BADGE_BY_COMPOSITE[Math.min(maxComposite, 5)] ?? "l1",
    gaugeIndex: GAUGE_BY_COMPOSITE[Math.min(maxComposite, 5)] ?? 0,
    maxComposite,
  };
}

// ── wp50 — THE deterministic client-summary-block → finding join ────────────────────────────────────────
// The old first-match substring-containment join mis-bound "DEMVENZY — Novartis" to the VENZY finding
// (the head CONTAINS "venzy"), so the validator and the lint auto-correct VALIDATED — and would have
// ENFORCED — the wrong finding's tier, rating two Composite-3 conflicts at the top band. One join,
// used by the validator, the auto-correct and the email
// compose. Resolution order: (1) an explicit `- ord:` line (exact ordinal); (2) exact normalized-mark
// equality on the head's mark segment (before the first " — "), if exactly one live candidate carries
// that mark; (3) the old containment rule, but only when it is UNIQUE. Ambiguity → null: an unjoined
// block is an honest skip the shape checks own — never a guess that enforces a neighbour's tier.
export function joinFindingToBlock({ ord, head }, findings) {
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const live = (findings ?? []).filter((f) => f?.disposition !== "withdrawn");
  if (Number.isInteger(ord)) return live.find((f) => f?.ordinal === ord) ?? null;
  const headN = norm(head);
  if (!headN) return null;
  const markSeg = norm(String(head ?? "").split(/\s+[—–-]\s+/)[0]);
  const exact = markSeg ? live.filter((f) => { const m = norm(f.mark); return m && m === markSeg; }) : [];
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const contains = live.filter((f) => { const m = norm(f.mark); return m && (headN.includes(m) || m.includes(headN)); });
  return contains.length === 1 ? contains[0] : null;
}

/** Parse the optional `- ord: N` line from a client-summary block body. null when absent/invalid. */
export function parseBlockOrd(body) {
  const m = String(body ?? "").match(/^-\s*ord:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

// ── T6 (H8) — adversarial ordering: who can actually BLOCK first, not raw tier ─────────────────
// THE one banding map (moved here from render.mjs so ordering and sectioning share one source):
// placement is by DISPOSITION when the run carries it, else by composite (legacy).
export const DISPOSITION_BAND = { adversarial: 1, "coexistence-partner": 2, distinguished: 2, "off-field": 3 };
// WP-56 A4 — THE one disposition→group map (the report card's `- group:` meta line): group is the
// commercial-field reality, never a re-expression of disposition or band — every RATED disposition is
// on-field; off-field stays off-field. `withdrawn` never reaches a card (fullProseOrdinals filters it);
// mapped to out-of-scope for totality so a stamp over a stale card is still deterministic. The driver
// stamps the line from this map at assembly (a model mislabel — VIBRANTE's `group: off-field` on a rated
// same-field conflict — must never survive), and client-summary inclusion is dictated on the rating.
export const DISPOSITION_GROUP = {
  adversarial: "on-field", "coexistence-partner": "on-field", distinguished: "on-field",
  "off-field": "off-field", withdrawn: "out-of-scope",
};
export const bandOf = (f) => {
  const d = f && f.disposition;
  if (d && DISPOSITION_BAND[d]) return DISPOSITION_BAND[d];
  return (Number(f?.composite) || 0) >= 3 ? 1 : 3;   // disposition absent (or unknown) ⇒ composite fallback
};
const ENFORCER_RANK = { high: 3, medium: 2, unknown: 1, low: 0 };
/**
 * Sort comparator: the finding that can actually block FIRST leads. In DISPOSITION mode (some finding
 * carries a disposition) the key is: band (adversarial → manageable → awareness) → composite desc →
 * level desc (E→A) → enforcer appetite desc → deadline-bearing first → ordinal. In LEGACY mode
 * (no dispositions anywhere — archived runs) it is byte-identical to the old composite-desc/ordinal
 * sort, so replays and archived re-publishes never re-order. PURE.
 */
export function compareBlockingPower(a, b, dispositionMode, manifest = null) {
  const comp = (Number(b?.composite) || 0) - (Number(a?.composite) || 0);
  if (!dispositionMode) return comp || (a?.ordinal || 0) - (b?.ordinal || 0);
  // doc 50 — with the run's frozen manifest, severity WITHIN a render band is the framework's own band
  // order (lower manifest index = more severe; an unbanded/off-field or unknown-word finding sorts last
  // in its band). Legacy runs have no manifest and no bands, so this key is 0 there — byte-identical.
  const bandRank = (f) => {
    if (!manifest || f?.band == null) return Number.MAX_SAFE_INTEGER;
    const i = bandIndex(manifest, f.band);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return (bandOf(a) - bandOf(b))
    || (manifest ? bandRank(a) - bandRank(b) : 0)
    || comp
    || String(b?.level || "").localeCompare(String(a?.level || ""))
    || ((ENFORCER_RANK[b?.meters?.enforcer?.token] ?? 1) - (ENFORCER_RANK[a?.meters?.enforcer?.token] ?? 1))
    || ((b?.deadline ? 1 : 0) - (a?.deadline ? 1 : 0))
    || (a?.ordinal || 0) - (b?.ordinal || 0);
}
/** True when at least one finding carries an explicit disposition — the mode switch both sort sites use. */
export function inDispositionMode(findings) {
  return (findings ?? []).some((f) => f && f.disposition && DISPOSITION_BAND[f.disposition]);
}

// The unconditional-proceed shape the client-summary validator rejects on a CONDITIONAL run — ONE
// predicate shared by verify.mjs checkClientSummaryJoin and the deterministic bound below (the
// validator and the auto-correct must judge with the same eyes, or the ladder can never converge).
export function isUnconditionalProceed(rec) {
  const r = String(rec ?? "");
  return /\bproceed\b/i.test(r) && !/(condition|subject to|provided|pending|unless|after|once)/i.test(r);
}

/**
 * Deterministically BIND a recommendation line to the verdict: on a CONDITIONAL verdict an
 * unconditional "proceed" is rewritten to carry the conditions; on BLOCKING any recommendation is
 * replaced (a BLOCKING run does not reach delivery post- — belt-and-braces for legacy paths).
 * Code derives the bound from the model's OWN verdict + reasons; it never invents a verdict. PURE.
 */
export function bindRecommendation(rec, verdict, reasons = [], { maxReasons, maxLen } = {}) {
  const r = String(rec ?? "").trim();
  const v = String(verdict || "").toUpperCase();
  if (v === "BLOCKING") return "On hold — the reviewing lawyer's open questions must be resolved before any recommendation.";
  if (v !== "CONDITIONAL" || !r || !isUnconditionalProceed(r)) return r;
  const conds = (reasons ?? []).filter(Boolean);
  if (!conds.length) return r;
  return `${r.replace(/[.\s]+$/, "")} — subject to: ${capConditions(conds, maxReasons, maxLen)}`;
}

// client-summary-bound — CLIENT-surface cap for the auto-bind. The report hero wants every verdict
// reason verbatim, but on the CLIENT summary the full join has shipped a ~2,300-char run-on. When the
// client caller passes a cap, keep the top `maxReasons` reasons and hold the join under `maxLen` chars,
// marking any elision with "…" (the complete condition set stays on the internal report + actions list).
// Uncapped callers (the report hero) pass neither and get the full verbatim join unchanged. PURE.
function capConditions(conds, maxReasons, maxLen) {
  let kept = Number.isFinite(maxReasons) ? conds.slice(0, Math.max(1, maxReasons)) : conds.slice();
  if (Number.isFinite(maxLen)) while (kept.length > 1 && kept.join("; ").length > maxLen) kept = kept.slice(0, -1);
  let out = kept.join("; ");
  if (Number.isFinite(maxLen) && out.length > maxLen) out = `${out.slice(0, Math.max(1, maxLen - 1)).replace(/[\s;,.]+$/, "")}…`;
  else if (kept.length < conds.length) out = `${out}; …`;
  return out;
}

// ── spec 64 — derive the disposition's condition set from the typed actions ────────────────────────────
/**
 * Partition the LIVE actions into conditions (CONDITION_KINDS — the opinion demands a forward legal act)
 * and advisories (ADVISORY_KINDS). An action is DEAD when every finding it references is withdrawn
 * (mirrors the withdrawn-renders-nowhere rule); [] ordinals = a run-level action = always live. PURE.
 * Returns { conditions, advisories, conditionActions, advisoryActions } — the texts plus the objects.
 */
export function deriveActionConditions(actions, findings) {
  const withdrawn = new Set((findings ?? []).filter((f) => f?.disposition === "withdrawn").map((f) => f.ordinal));
  const live = (Array.isArray(actions) ? actions : []).filter((a) => {
    const ords = Array.isArray(a?.ordinals) ? a.ordinals : [];
    return ords.length === 0 || ords.some((n) => !withdrawn.has(n));
  });
  const conditionActions = live.filter((a) => CONDITION_KINDS.includes(a?.kind));
  const advisoryActions = live.filter((a) => ADVISORY_KINDS.includes(a?.kind));
  const conditions = conditionActions.map((a) => String(a.text ?? "").trim()).filter(Boolean);
  return {
    conditions,
    // PR-3 (report voice) — the FACTUAL open-state clause per condition, index-aligned with
    // `conditions`: the author's optional `condition` field ("Consent from X is not yet in hand")
    // where typed, else the ask text itself. riskStatement prefers these for its "conditional on:"
    // lede — the statement states the fact that conditions reliance, never an instruction.
    conditionClauses: conditionActions.map((a) => String(a.condition ?? a.text ?? "").trim()).filter(Boolean),
    advisories: advisoryActions.map((a) => String(a.text ?? "").trim()).filter(Boolean),
    conditionActions,
    advisoryActions,
  };
}


// ── — THE RUN'S OWN PARTY INDEX, AND WHAT IT CAN AND CANNOT SEE ──────────────────────────────
//
// `buildOnlyYouSection` carried this promise for months:
//
//     "an ask can never name an entity no finding identifies — the reference-integrity property holds
//      by construction"
//
// It does not hold. The subject join reads `action.ordinals`, resolves each to a finding, and appends
// that finding's label when the ask text does not already contain it. NOTHING reads the OTHER names in
// the text. So an action bound to a live finding whose text names a different party renders as
//
//     Obtain consent from PARTY-B before launch. (re: PARTY-A (Party A Ltd))
//
// and the delivered sentence reads as though the two parties were connected. The mechanism whose
// comment promises it prevents misattribution is what manufactures that one.
//
// ── WHAT THIS INDEX CAN DECIDE, AND WHAT IT HONESTLY CANNOT ─────────────────────────────────────────
//
// Extracting arbitrary party names out of free prose is not decidable here, and pretending otherwise
// would put a second false guarantee where the first one was. What IS decidable is the run's own
// vocabulary: every mark and owner name the findings carry, live or withdrawn. Against that:
//
//   · an ask naming ANOTHER carded party — caught, and the join is suppressed rather than manufacturing
//     an association between two parties the run knows are different.
//   · an ask naming a WITHDRAWN party — caught, and reported. That card renders nowhere, so the reader
//     is sent to a party the document does not identify: the same reference-integrity hole with the
//     opposite symptom, and previously silent (`if (!f) continue`).
//   · an ask naming a party THE RUN NEVER SAW — NOT caught. A supplier, a licensee, a distributor the
//     sweep never surfaced is outside every index this code can build. It is stated here rather than
//     covered by a wider claim, because the last wider claim is what this comment is replacing.
//
// PURE — no pipeline dependency, so the producer calls it and the tests do not need a run.
const softNormName = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Every party name this run identifies, split by whether a reader can still look it up.
 *
 * `live` is what a delivered card names. `withdrawn` is what the run knew and then removed — a name in
 * an ask's text that only appears here points at a card that renders nowhere.
 * @returns {{live: Map<string, object>, withdrawn: Map<string, object>}} normalized name → its finding
 */
export function cardedParties(findings) {
  const live = new Map(), withdrawn = new Map();
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f) continue;
    const into = f.disposition === "withdrawn" ? withdrawn : live;
    for (const raw of [f.mark, f.owner?.name]) {
      const k = softNormName(raw).trim();
      // A one- or two-character "name" would match inside ordinary words and turn every ask into a
      // false positive. The floor is the same reason `softNorm` folds rather than compares raw.
      if (k.length >= 3 && !into.has(k)) into.set(k, f);
    }
  }
  // A name that is both live and withdrawn (two findings, one owner) is LIVE: the reader can look it up.
  for (const k of live.keys()) withdrawn.delete(k);
  return { live, withdrawn };
}

/**
 * What an action's text asserts about parties, measured against the run's index.
 *
 * @returns {{names: string[], withdrawnNames: string[], boundLost: boolean}}
 *   names          — carded parties the text names, live or withdrawn, in the run's own spelling
 *   withdrawnNames — those of them whose only card is withdrawn: named in an ask, identified nowhere
 *   boundLost      — the action cites ordinals and NONE of them resolves to a live finding. Previously
 *                    this rendered as an ask with no subject at all, indistinguishable from a run-level
 *                    one, which is how a broken reference read as a deliberate absence.
 * PURE.
 */
export function actionPartyReferences(action, index) {
  const t = softNormName(action?.text);
  const names = [], withdrawnNames = [];
  for (const [k, f] of [...(index?.live ?? new Map()), ...(index?.withdrawn ?? new Map())]) {
    if (!t.includes(k)) continue;
    const shown = String(f?.mark ?? "").trim() || String(f?.owner?.name ?? "").trim() || k;
    if (!names.includes(shown)) names.push(shown);
    if (index?.withdrawn?.has(k) && !withdrawnNames.includes(shown)) withdrawnNames.push(shown);
  }
  const ords = Array.isArray(action?.ordinals) ? action.ordinals : [];
  const boundLost = ords.length > 0 && !ords.some((n) => [...(index?.live ?? new Map()).values()].some((f) => f.ordinal === n));
  return { names, withdrawnNames, boundLost };
}

// ── — THE CONDITIONS THAT ARE NOT IN THE LIST ────────────────────────────────────────────────
/**
 * The quarantined action rows that must be READ AS CONDITIONS. Companion to `deriveActionConditions`
 * above, and it exists because that function can only see what SURVIVED validation.
 *
 * The failure this closes: a condition action that fails `validateAction` is dropped by the lenient
 * parser, so the deliver-conditional floor — which reads that parser's output — sees one fewer
 * condition and does not clamp. The defect and the relaxation are the SAME EVENT: a malformed
 * condition does not fail loudly, it stops conditioning the verdict. Measured on `289e0245`, one
 * unknown key on a `senior-clearance` row took a run from CLEAR→CONDITIONAL to CLEAR.
 *
 * THE DIRECTION IS THE DESIGN. A row is condition-suspect when its raw kind is a CONDITION kind OR
 * when the kind cannot be read at all — absent, non-string, or not a kind this build knows. An
 * unreadable kind is the state where we know LEAST about what was demanded, so it is the last state
 * that may read as "advisory, nothing to disclose". Only a kind we can read AND recognise as advisory
 * clears. (`kind` here comes off an object the validator has already rejected, so it is untrusted
 * input by construction — a string compare against the closed enum is the whole of the trust placed
 * in it.)
 *
 * PURE. Returns the suspect rows themselves, so a caller can name ids and defect tokens.
 */
// ── — WHAT THE SALVAGE LANE CAN ACTUALLY NAME ────────────────────────────────────────────────
/**
 * The repair material a lenient parse yields, as counts, in ONE place.
 *
 * The synthesis salvage lane admits a failure by regex over its token (`/:finding_[a-z]/`) and repairs
 * it out of the quarantine lists. **Those are two different populations, and when they disagree the
 * lane accepts a defect it cannot describe to anybody** — which is how `finding_action_*` and
 * `finding_ask_answer_*` each reached it and exhausted a paid run with the defect nameable and the
 * seat never asked.
 *
 * Exported so the disagreement is assertable in a unit test rather than only reachable by driving a
 * whole run: `total === 0` on a doc whose parse FAILED is precisely the state that must be loud.
 * PURE.
 */
export function salvageRepairTargets(lenient) {
  const findings = (lenient?.quarantined ?? []).length;
  const actions = (lenient?.actionsQuarantined ?? []).length;
  const askAnswers = (lenient?.askAnswersQuarantined ?? []).length;
  return { findings, actions, askAnswers, total: findings + actions + askAnswers };
}

export function quarantinedConditionRows(quarantined) {
  return (Array.isArray(quarantined) ? quarantined : []).filter((q) => {
    const kind = q?.kind;
    if (typeof kind !== "string") return true;              // unreadable ⇒ suspect
    if (CONDITION_KINDS.includes(kind)) return true;        // readable and conditioning
    return !ADVISORY_KINDS.includes(kind);                  // readable but unknown to this build ⇒ suspect
  });
}

/**
 * Sentence-case a lead: upper-case the FIRST letter, skipping markdown/quote/bracket openers so
 * `**the legal risk…`, `"the practical…` and plain `the…` all read as sentences. A lead already
 * capitalized, or opening with a digit/proper token, is returned byte-identical. PURE.
 */
export function sentenceCaseLead(s) {
  const str = String(s ?? "");
  const m = str.match(/^([\s*_`"'([{«‘’‚‛“”„-]*)(\p{Ll})/u);
  if (!m) return str;
  return str.slice(0, m[1].length) + m[2].toUpperCase() + str.slice(m[1].length + m[2].length);
}

// ── #601 — THE ONE BOUND AN ASK STILL HAS, AND THE ONLY ONE ─────────────────────────────────────────
// The verdict statement renders in index cells, run status, the report hero, the email headline and the
// xlsx Verdict row — one row each, so an unbounded first condition would swallow the row. This is the
// last surface in the product that shortens an ask, and it is the honest one: `clipClause` marks the cut
// with an ellipsis, so the reader can tell there is more.
//
// It is exported because the ask that lands here is AUTHORED, and an author who cannot see the bound
// keeps crossing it: predelivery-lint measures every condition action against this constant and the
// synthesis dictation states it as a fact. Nobody has to defend the number — the statement decided it,
// and one definition means the check and the clip can never disagree.
//
// It takes `action.condition ?? action.text` (deriveActionConditions.conditionClauses), so an action
// with no typed `condition` puts its ask text straight into the clip.
export const STATEMENT_CLAUSE_MAX = 170;

// Clip a statement clause on a word boundary. Trailing period stripped; the caller re-punctuates. PURE.
const clipClause = (s, max) => {
  const t = String(s ?? "").trim().replace(/[.\s]+$/, "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  // trailing lone-high-surrogate strip: a code-unit cut can split an astral pair, and the mangled
  // char would persist into verdict.json.statement and every surface that renders it.
  return `${cut.slice(0, at > 40 ? at : max).trimEnd().replace(/[\uD800-\uDBFF]$/, "")}…`;
};

/**
 * spec 64 — THE one risk-statement assembler. Every surface (archive index, run status, report hero,
 * email, xlsx Verdict row) renders THIS sentence, so severity and disposition can never contradict
 * across pages: the tier is the framework's own band word (from deriveDisplayVerdict — already
 * manifest-cased) and the stance clause is derived from the verdict + its reasons (the condition
 * actions' own client-plain texts). PR-3 (report voice, user decision 2026-07-28): the product never
 * self-caveats — the retired "do not rely on this as-is" wording is GONE. A conditional verdict
 * states the FACT that conditions reliance: "<Tier> — conditional on: <factual open-state> (and N
 * more)." — `clauses` (deriveActionConditions.conditionClauses, index-aligned with `reasons`)
 * carries those factual open-states and is preferred for the lede; `reasons` (the ask texts) is the
 * count authority and the fallback. Returns null when either axis is missing (legacy sidecars —
 * callers fall back to today's bare word). PURE.
 */
export function riskStatement({ tier, verdict, reasons, basis, clauses } = {}) {
  const v = String(verdict || "").toUpperCase();
  const t = String(tier || "").trim();
  if (!v || !t) return null;
  // A register-only run searched half the surface. Because THIS sentence is the one every page joins,
  // stating the basis here is the whole "flag it as such" requirement — no surface can render the bare
  // band word without it, and no second flag has to be kept in sync (a register-only run may deliver
  // CLEAR, so long as it is clear on register findings ALONE).
  const registerOnly = basis === "register-only";
  const basisNote = registerOnly ? " Register findings only — no common-law or marketplace search was run." : "";
  if (v === "BLOCKING") return `On hold — the reviewing lawyer's open questions must be resolved before any recommendation.${basisNote}`;
  if (v === "CONDITIONAL") {
    const conds = (Array.isArray(reasons) ? reasons : []).map((r) => String(r ?? "").trim()).filter(Boolean);
    const cls = (Array.isArray(clauses) ? clauses : []).map((c) => String(c ?? "").trim()).filter(Boolean);
    const lede = cls[0] ?? conds[0] ?? "the open conditions carried in the report";
    const first = clipClause(sentenceCaseLead(lede), STATEMENT_CLAUSE_MAX);
    const n = conds.length || cls.length;
    const more = n > 1 ? ` (and ${n - 1} more)` : "";
    return `${t} — conditional on: ${first}${more}${first.endsWith("…") ? "" : "."}${basisNote}`;
  }
  // CLEAR replaces its lead rather than appending: "clear to proceed" followed by a caveat still says
  // "clear to proceed" first, and that is the exact word this product must never say unqualified.
  if (registerOnly) return `${t} — clear on register findings alone: no common-law or marketplace search was run.`;
  return `${t} — clear to proceed: no conditions beyond ordinary filing.`;
}

/**
 * PR-3 (report voice) — the STRUCTURED stance behind the composed statement. verdict.json carries it
 * so no consumer (lint, portal, courier) ever has to regex the statement's wording to know whether
 * the run is conditional — the string-coupling the retired "do not rely on this as-is" magic string
 * created. One value per verdict; null on anything unknown (legacy sidecars never carry it). PURE.
 */
export function verdictStance(verdict) {
  const v = String(verdict || "").toUpperCase();
  if (v === "BLOCKING") return "on-hold";
  if (v === "CONDITIONAL") return "conditional";
  if (v === "CLEAR") return "clear";
  return null;
}

// Key allowlists — `additionalProperties:false` by hand, exactly like coverage-ledger.mjs ROW_KEYS.
// A1 additions (schema_version 3, all OPTIONAL so v2/archived runs parse unchanged):
//   top-level `corrections` — the corrective pass's machine attestation {applied, note};
//   per-finding `withdrawn_reason` — required non-empty only when disposition === "withdrawn".
// WP-56 B2: top-level `mark_assessment` — the standing "mark itself" read (distinctiveness + connotation,
// EN and non-EN), typed field → code-rendered at the TOP of the report. OPTIONAL so archived/legacy runs
// parse unchanged (render falls back to no section); presence on fresh runs is a predelivery-lint flag,
// never a validator throw (validator-brittleness lesson).
// spec 64: top-level `actions` — the typed forward-action register (OPTIONAL so archived runs parse
// unchanged; presence on fresh runs is a predelivery-lint flag, never a validator throw).
const TOP_KEYS = ["schema_version", "findings", "coverage", "context_notes", "coverage_judgment", "corrections", "mark_assessment", "actions"];
// doc 50 (schema_version 4): `rated_under_framework` is REQUIRED at top level — the one-string tripwire
// that the model actually rated under the framework the run froze (checked against the frozen manifest's
// framework_key where the caller supplies it). Per finding: `band` replaces the retired legacy scale —
// composite/level/dispute_type are FORBIDDEN on v4 (checked with a dedicated token BEFORE the key
// allowlist so the corrective ladder gets an instructive message, not a bare unknown-key).
const TOP_KEYS_V4 = [...TOP_KEYS, "rated_under_framework"];
// PR-9 (schema_version 5, E9 + the ask join): `ask_answers` joins the top level — one answer object per
// requester instruction, authored by synthesis (BARE since D1 — the label is the driver's, added at
// assembly, and an answer that carries its own printed twice); the driver code-builds the report's
// "Answers to your instructions" section FROM it (the only-you pattern), so the answer the client sees
// and the answer the lint verifies are one record, never two proses. v5 is otherwise v4: every >=4 gate
// (band mode, rated_under_framework, the legacy-scale ban) applies unchanged.
// P5 (charter 2026-07-30 + Round-2 §4): `four_answers` joins the top level — the four questions a
// clearance opinion answers, as DATA where computable: strength of third-party rights / likelihood of
// objection / registrability / the client's own enforceability. OPTIONAL (archived v5 runs parse
// unchanged); each answer OPTIONAL too — an answer the run cannot ground is OMITTED, never faked.
// Judgment tokens are lawyer-authored with basis fields, never a computed score (ROUND2-FINDINGS B11);
// the answers never mint a second risk statement — riskStatement() stays the one assembler.
const TOP_KEYS_V5 = [...TOP_KEYS_V4, "ask_answers", "four_answers"];
// (schema_version 6): no new TOP-level key — v6 tightens the PER-FINDING contract only (positions
// required on every disposition that reaches a reader; off_field_ground declared on off-field).
const TOP_KEYS_V6 = [...TOP_KEYS_V5];
// (schema_version 7): no new key at either level — v7 tightens what the EXISTING `net` field may
// CONTAIN (a conclusion, not a semicolon/arrow chain). Listed explicitly rather than folded into V6 so
// the ladder reads the same at every rung and a future key lands in one obvious place.
const TOP_KEYS_V7 = [...TOP_KEYS_V6];
const LEGACY_SCALE_KEYS = ["composite", "level", "dispute_type"];
// doc-52 (OPTIONAL, back-compatible): `ruled_out` marks a concept/genre neighbour that shares no
// word/sound with the mark — a name that surfaced but is not a conflict; render routes it to the quiet
// "Also considered — ruled out" list instead of a conflict band. `ruled_out_reason` is a short plain
// note. Both optional so archived/v2 runs parse unchanged; render treats ruled_out === true strictly.
const FINDING_KEYS = ["ordinal", "mark", "owner", "composite", "level", "dispute_type", "disposition", "meters", "quadrant", "source", "use_check", "own_rights", "bears_on", "impact", "deadline", "withdrawn_reason", "ruled_out", "ruled_out_reason"];
// P5 (charter 2026-07-30, Reviewer §L): `legal_position` / `practical_position` — the legal read and the
// practical read on every rated finding, SEPARATED (high similarity + high goods proximity = HIGH
// legal risk; a delisted retailer / no revenue = practical, stated ALONGSIDE, never averaged into the
// band). `manageable` — the required category + reason on a notable-but-manageable finding
// (promote-or-omit: no category ⇒ the finding is promoted to adversarial or omitted, no third state).
// All OPTIONAL in the parser (archived v4/v5 runs parse unchanged); presence on fresh runs is a
// predelivery-lint flag, never a validator throw (validator-brittleness lesson).
// `borderline_between` (item 10, OPTIONAL, back-compatible) is v4-only by construction: it names two of
// the framework's band words, and bands are the v4 scale. Absent means the framework's own criteria
// decided this finding cleanly — which is the common case and the one that needs no ceremony.
const FINDING_KEYS_V4 = ["ordinal", "mark", "owner", "band", "borderline_between", "net", "disposition", "meters", "quadrant", "source", "use_check", "own_rights", "bears_on", "impact", "deadline", "withdrawn_reason", "ruled_out", "ruled_out_reason", "legal_position", "practical_position", "manageable"];
// (v6) — `off_field_ground` joins the per-finding keys: WHICH of off-field's two sanctioned grounds
// this negative rests on (see OFF_FIELD_GROUNDS). Required on off-field, forbidden everywhere else — a
// field ground on a rated conflict is a mis-typed disposition, not extra colour.
const FINDING_KEYS_V6 = [...FINDING_KEYS_V4, "off_field_ground"];
// (v7) — no new per-finding key either. The change is to `net`'s permitted CONTENT, not the shape.
const FINDING_KEYS_V7 = [...FINDING_KEYS_V6];
// which dispositions carry a band on v4: a rated conflict needs one; off-field IS the unrated
// commercial-awareness home ("a conflict the entity clearly wins with no material risk is not a rated
// conflict" — doc 50); withdrawn tolerates a stale band (forensic record, renders nowhere).
const BAND_REQUIRED_DISPOSITIONS = ["adversarial", "coexistence-partner", "distinguished"];
// P5 (Reviewer §L) — the manageable-category closed enum: WHY a notable finding is manageable. A finding
// in the manageable band that fits none of these is either relevant enough to promote (disposition
// adversarial → section 02) or is omitted — never a third state. The category is meaningful only on
// the manageable dispositions below; on adversarial/off-field it is a mis-typed disposition.
export const MANAGEABLE_CATEGORIES = ["large-competitor", "commercial-partner", "troll", "well-known-enforcer"];
const MANAGEABLE_DISPOSITIONS = ["coexistence-partner", "distinguished"];
const MANAGEABLE_KEYS = ["category", "reason"];
// P5 — the four answers (charter: strength of third-party rights / likelihood of objection /
// registrability / client's own enforceability). Tokens are lawyer-authored judgment words (closed
// enums, with a stated basis) — never a computed score. `obstacles` rows are registrability-only
// (the per-class obstacle read, same row shape as mark_assessment.per_class).
const FOUR_ANSWERS_KEYS = ["third_party_rights", "objection_likelihood", "registrability", "client_enforceability"];
const FOUR_ANSWER_ENTRY_KEYS = ["read", "token", "basis", "ordinals", "obstacles"];
export const FOUR_ANSWER_TOKENS = {
  third_party_rights: ["strong", "moderate", "weak"],
  objection_likelihood: ["likely", "possible", "unlikely"],
  registrability: ["registrable", "registrable-with-conditions", "obstructed"],
  client_enforceability: ["strong", "moderate", "weak"],
};
// PR-9 (E9): corrections may carry structured `entries[]` beside the prose note — one row per flagged
// entity with its disposition, so the audit workbook renders a table instead of a re-typed paragraph.
const CORRECTIONS_KEYS = ["applied", "note", "entries"];
const CORRECTION_ENTRY_KEYS = ["entity", "disposition", "note"];
// PR-9 (E9): the mark_assessment fields accept a STRING (legacy/simple) or this structured object —
// the per-class / per-market / counter-registration rows that used to live inside a ~1,900-char prose
// blob. The frozen renderer receives a deterministic STRING PROJECTION (projectAssessmentField); the
// structured rows render in the audit workbook + report-data, both unfrozen.
// spec 2026-07-30 §3: `read` — the one-to-two-sentence consequence the reader sees ("A weak name to
// own. SLUSH is simply what the product is, so the whole mark rests on TIKI."). The renderer shows it
// as the visible prose and collapses the typed rows behind toggles; absent (archived structured runs)
// the renderer falls back to spectrum/acquired/note.
const ASSESSMENT_FIELD_KEYS = ["spectrum", "read", "per_class", "per_market", "counter_registrations", "acquired", "note"];
const ASSESSMENT_CLASS_ROW_KEYS = ["class", "note"];
const ASSESSMENT_MARKET_ROW_KEYS = ["market", "note"];
const ASSESSMENT_COUNTER_REG_KEYS = ["uri", "mark", "owner", "note"];
// PR-9 (E9): coverage_judgment may carry structured `rows[]` beside its reason — one {area, note} row
// per open slice. — THE DRIVER WRITES THAT REGISTER, NOT THE LAWYER: `stampCoverageJudgmentRows`
// derives the rows from the coverage ledger and the plan-execution receipt at the post-synthesis
// mutator seam and replaces anything authored, wholesale. The lawyer supplies `sufficient` and
// `reason`. This comment said "per slice the lawyer weighed", which named the wrong author for the one
// field this build moved off the model — in the file an agent opens to learn who owns a findings.json
// field, and on the archive-republish path. The validation below is unchanged and still applies:
// archived documents carry model-authored rows and must keep parsing. The rest of the object stays
// deliberately unvalidated (it always was), but a present-and-malformed rows[] throws token-first.
// — `areaLabel` is the reader's name for the same slice, emitted by the DRIVER beside the machine
// identifier (coverage-ledger.coverageUnitLabel). OPTIONAL and driver-owned: an archived row has none,
// a row whose area is already plain English has none, and the seat never writes one. The page prints
// it; every gate still joins on `area`. It exists so no client-facing string is ever rewritten by
// pattern —, where a find-and-replace over the rendered report ate the mark AXIS.
const COVERAGE_JUDGMENT_ROW_KEYS = ["area", "areaLabel", "note"];
// PR-9 — one ask_answers[] entry: the requester's instruction (verbatim, so the deterministic join to
// the frozen _driver/intake-asks.json rows can key on it) and the answer the report carries. D1 —
// the answer is BARE. The `- You asked: <ask> → ` label is code-owned and added at assembly.
const ASK_ANSWER_KEYS = ["ask", "answer", "ordinals"];
// — `name` is what a lawyer reads; `nameRaw` is the register's own string, kept as provenance
// rather than as the display value; `nameNative` is the original script when the record draws that
// distinction. The pair exists because a provider's Latin field is a ROMANISATION for a CJK owner.
const OWNER_KEYS = ["name", "nameRaw", "nameNative", "country", "registrations"];
const REGISTRATION_KEYS = ["uri", "classes", "status", "filed", "expiry", "jurisdiction"];
// A4 — optional per-meter `source`: the uri/URL backing the claim (a /mark/… record URI or
// an http(s) URL for web evidence). Shape-only here; the v3 "verified needs a source" gate lives in
// verify.mjs checkFindingsSibling, and the machine JOIN to actual fetch receipts lives in
// registry-fidelity.joinEvidenceStatus (a self-declared enum is never trusted on its own).
const METER_ENTRY_KEYS = ["token", "basis", "source"];
const QUADRANT_KEYS = ["x", "y"];
const SOURCE_KEYS = ["source_type", "resolved_link"];
// — `areaLabel` is DELIBERATELY NOT HERE, and the reason is a measurement. Across the nine
// delivered runs in the test pool, `coverage[]` carries ZERO axis identifiers — every one of the eighty
// on record is in `coverage_judgment.rows`, which is 100% driver-written. Adding an optional key here
// would buy nothing and cost something real: the LENIENT parser DROPS a coverage row whose keys it does
// not recognise (see parseFindingsJsonLenient), so a revert of this commit would silently delete client
// disclosures from every republished run. An absence reading as a pass, bought for no measured gain.
const COVERAGE_KEYS = ["area", "state", "note"];
const CONTEXT_NOTE_KEYS = ["type", "mark", "owner", "context"]; // A1 — owner OPTIONAL (display only)
const MARK_ASSESSMENT_KEYS = ["distinctiveness", "connotation"]; // WP-56 B2 — both required when the field is present
// spec 64 — deadline reuses DEADLINE_KEYS. PR-3 (report voice): `condition` is the OPTIONAL factual
// open-state clause on CONDITION-kind actions ("Consent from X is not yet in hand") — the verdict
// statement's "conditional on:" lede prefers it over the imperative ask text.
const ACTION_KEYS = ["id", "kind", "text", "ordinals", "deadline", "condition"];
// Per-finding use-check / own-rights cite-of-record (Instance #5). Both OPTIONAL — a legacy findings.json
// without them parses clean. The parser is SHAPE-only here (object / key-allowlist / source-is-a-string);
// the composite>=3 NON-EMPTY-source gate lives in verify.mjs checkFindingsSibling (it carries the ordinal
// context and is a validator-fail, not a parser-throw, on the offline unit path).
const USE_CHECK_KEYS = ["source", "quality"];   // A4 — optional model-attested source class, code-audited
export const USE_SOURCE_QUALITY = ["owner-site", "independent", "register-mirror"];
const OWN_RIGHTS_KEYS = ["source"];
const DEADLINE_KEYS = ["kind", "date"]; // #6 — a CLIENT-facing time-critical date (opposition / SOU / renewal)

const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
// The version-laddered key allowlists, in ONE place — both parsers (strict + lenient) read it, so a new
// version can never tighten one path and leave the other on the old list.
const topKeysFor = (mode) => (mode.v7 ? TOP_KEYS_V7 : mode.v6 ? TOP_KEYS_V6 : mode.v5 ? TOP_KEYS_V5 : mode.v4 ? TOP_KEYS_V4 : TOP_KEYS);
const findingKeysFor = (mode) => (mode.v7 ? FINDING_KEYS_V7 : mode.v6 ? FINDING_KEYS_V6 : mode.v4 ? FINDING_KEYS_V4 : FINDING_KEYS);

/**
 * THE KEYS A FINDING ROW CARRIES AT THE CURRENT SCHEMA VERSION —.
 *
 * Exported so the typed transport's schema can DECLARE them instead of carrying a second list. The
 * record's shape is defined here and nowhere else; `record_synthesis` used to describe its patch rows as
 * "one complete finding object" while declaring `ordinal` alone, so twelve keys seats correctly send were
 * undeclared — measured across 294 captured calls.
 *
 * A hand-written copy in the server would be a second definition of the record, and the two would drift
 * the first time this ladder gains a key. It is derived, so they cannot.
 */
export const FINDING_KEYS_CURRENT = Object.freeze([...FINDING_KEYS_V7]);
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (obj, allowed, tokenFor) => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new Error(`${tokenFor(k)} (keys are EXACTLY: ${allowed.join(", ")})`);
};

/**
 * Parse + strictly validate the saved findings.json. Returns `{ schemaVersion, findings, coverage }`
 * (findings/coverage are the validated arrays, normalised only where noted). Throws on ANY defect,
 * offending token FIRST:
 *   findings_unparseable | findings_empty | findings_key_unknown:<key> | findings_coverage_invalid
 *   | findings_coverage_key_unknown:<key> | findings_coverage_state_invalid:<state>
 *   | finding_invalid:<idx> | finding_key_unknown:<key> | finding_ordinal_invalid:<v>
 *   | finding_ordinal_duplicate:<v> | finding_mark_missing:<ordinal> | finding_composite_invalid:<v>
 *   | finding_level_invalid:<v> | finding_dispute_type_invalid:<v> | finding_disposition_invalid:<v> | finding_owner_invalid:<ordinal>
 *   | finding_owner_key_unknown:<key> | finding_registration_invalid:<...>
 *   | finding_registration_key_unknown:<key> | finding_meter_missing:<meter>
 *   | finding_meter_unknown:<key> | finding_meter_token_invalid:<meter>:<v> | finding_basis_invalid:<meter>:<v>
 *   | finding_quadrant_invalid:<...> | finding_source_invalid:<ordinal>
 *   | finding_source_key_unknown:<key> | finding_source_type_invalid:<v>
 *   | finding_use_check_invalid:<ordinal> | finding_use_check_key_unknown:<key>
 *   | finding_use_check_source_missing:<ordinal> | finding_own_rights_invalid:<ordinal>
 *   | finding_own_rights_key_unknown:<key> | finding_own_rights_source_missing:<ordinal>
 *   | finding_bears_on_invalid:<ordinal> | finding_disposition_invalid:<v> | finding_impact_invalid:<ordinal>
 *   | finding_deadline_invalid:<ordinal> | finding_deadline_key_unknown:<key> | finding_deadline_date_missing:<ordinal>
 *   | findings_context_note_invalid | findings_context_note_key_unknown:<key> | findings_context_note_type_invalid:<v>
 *   | findings_net_chained:<ordinal>   (, v7 only — PLURAL on purpose; see validateNetShape)
 * (the composite>=3 NON-EMPTY-source gate for use_check/own_rights is raised by the caller in verify.mjs —
 *  this parser only enforces SHAPE: object / key-allowlist / source-is-a-string. Both fields are OPTIONAL.)
 *
 * @param {string} raw — the file contents.
 * @param {{ manifest?: object }} [opts] — doc 50: the run's FROZEN framework manifest. When supplied, a
 *   v4 finding's band must be one of its words (normalised to the manifest casing) and the top-level
 *   rated_under_framework must equal its framework_key. Without it (offline/unit paths) band checks are
 *   shape-only. v≤3 documents ignore it entirely — archived parsing is byte-identical.
 */
export function parseFindingsJson(raw, opts = {}) {
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { throw new Error(`findings_unparseable: ${short(e.message)}`); }
  if (!isPlainObject(doc)) throw new Error("findings_unparseable: top level must be a JSON OBJECT { schema_version, findings, coverage }");
  const schemaVersion = typeof doc.schema_version === "number" ? doc.schema_version : 1;
  const mode = { v4: schemaVersion >= 4, v5: schemaVersion >= 5, v6: schemaVersion >= 6, v7: schemaVersion >= 7, manifest: opts.manifest ?? null,
    // — null means the caller named no provider, and the record-URL gate stays inactive. An empty
    // ARRAY is a real answer ("this provider publishes no per-record page") and is not the same thing.
    recordOrigins: Array.isArray(opts.recordOrigins) ? opts.recordOrigins : null };
  onlyKeys(doc, topKeysFor(mode), (k) => `findings_key_unknown:${short(k)}`);
  if (mode.v4) {
    if (typeof doc.rated_under_framework !== "string" || !doc.rated_under_framework.trim())
      throw new Error("findings_rated_under_missing: schema_version 4 requires rated_under_framework — the framework_key of the framework this rating reasoned with");
    if (mode.manifest && doc.rated_under_framework !== mode.manifest.framework_key)
      throw new Error(`findings_rated_under_mismatch:${short(doc.rated_under_framework)} (this run's frozen framework is "${mode.manifest.framework_key}" — rate with the framework the run froze)`);
  }

  const findings = doc.findings;
  if (!Array.isArray(findings)) throw new Error("findings_unparseable: \"findings\" must be a JSON ARRAY of finding objects");
  const coverage = doc.coverage ?? [];
  if (!Array.isArray(coverage)) throw new Error("findings_coverage_invalid: \"coverage\" must be a JSON ARRAY of coverage-area objects");
  const contextNotes = doc.context_notes ?? [];
  if (!Array.isArray(contextNotes)) throw new Error("findings_context_note_invalid: \"context_notes\" must be a JSON ARRAY of context-note objects");
  // A clean matter legitimately has ZERO findings — but a record carrying NOTHING (no findings AND no
  // coverage) is meaningless and almost always a write miss; reject it like coverage_ledger_empty.
  if (findings.length === 0 && coverage.length === 0)
    throw new Error("findings_empty: the record carries no findings AND no coverage areas — at least one is required");

  const seenOrdinals = new Set();
  const outFindings = findings.map((f, idx) => validateFinding(f, idx, seenOrdinals, mode));
  const outCoverage = coverage.map((c) => validateCoverage(c));
  const outContextNotes = contextNotes.map((n) => validateContextNote(n));
  const outActions = validateActionsList(doc.actions, outFindings);

  return {
    schemaVersion,
    ratedUnderFramework: mode.v4 ? doc.rated_under_framework : null,
    findings: outFindings,
    coverage: outCoverage,
    contextNotes: outContextNotes,
    // coverage_judgment is a run-level rollup {sufficient, reason} the lawyer emits (the coverage reasoning
    // behind the verdict clamp). It was validated by onlyKeys above but previously DROPPED here — so the reason
    // never reached the reader (report/audit). Carry it through as the single source of truth; the raw shape is
    // re-checked defensively by the pipeline's readCoverageJudgment / the reader before use.
    coverageJudgment: validateCoverageJudgmentRows(doc.coverage_judgment),
    corrections: validateCorrections(doc.corrections),
    markAssessment: validateMarkAssessment(doc.mark_assessment),
    actions: outActions,
    askAnswers: validateAskAnswersList(doc.ask_answers),
    fourAnswers: validateFourAnswers(doc.four_answers),
  };
}

// PR-9 — coverage_judgment stays a deliberately-loose passthrough object (archived shapes must keep
// parsing forever), EXCEPT its new structured rows[]: present-and-malformed throws token-first so the
// corrective ladder can route it. Each row is {area, note}, both non-empty strings.
function validateCoverageJudgmentRows(cj) {
  if (!cj || typeof cj !== "object" || Array.isArray(cj)) return null;
  if (cj.rows == null) return cj;
  if (!Array.isArray(cj.rows))
    throw new Error("findings_coverage_judgment_rows_invalid (coverage_judgment.rows, when present, must be a JSON ARRAY of { area, note } objects)");
  for (const r of cj.rows) {
    if (!isPlainObject(r)) throw new Error("findings_coverage_judgment_rows_invalid (each coverage_judgment row must be a plain object { area, note })");
    onlyKeys(r, COVERAGE_JUDGMENT_ROW_KEYS, (k) => `findings_coverage_judgment_row_key_unknown:${short(k)}`);
    if (typeof r.area !== "string" || !r.area.trim()) throw new Error("findings_coverage_judgment_rows_invalid (row.area must be a non-empty string — the slice this row weighs)");
    if (typeof r.note !== "string" || !r.note.trim()) throw new Error("findings_coverage_judgment_rows_invalid (row.note must be a non-empty string — what was seen of that slice)");
    if (r.areaLabel != null && (typeof r.areaLabel !== "string" || !r.areaLabel.trim()))
      throw new Error("findings_coverage_judgment_rows_invalid (row.areaLabel, when present, must be a non-empty string — the reader's name for the same slice)");
  }
  return cj;
}

// PR-9 — the top-level ask_answers register. OPTIONAL (v≤4 and archived runs parse clean); when present
// it must be an ARRAY of { ask, answer, ordinals? } — the driver builds the report's "Answers to your
// instructions" section FROM it and the lint judges the ask join on it, so a malformed entry throws
// token-first rather than silently dropping an answered instruction.
function validateAskAnswersList(list) {
  if (list == null) return null;
  if (!Array.isArray(list)) throw new Error("findings_ask_answers_invalid (ask_answers must be a JSON ARRAY of { ask, answer } objects — one per requester instruction)");
  return list.map((a, idx) => validateAskAnswer(a, idx));
}

/** PR-9 — validate ONE ask_answers entry. Exported for the lenient path + offline unit tests. */
export function validateAskAnswer(a, idx) {
  if (!isPlainObject(a)) throw new Error(`finding_ask_answer_invalid:${idx} (every ask_answers entry must be a plain object { ask, answer })`);
  onlyKeys(a, ASK_ANSWER_KEYS, (k) => `finding_ask_answer_key_unknown:${short(k)}`);
  if (typeof a.ask !== "string" || !a.ask.trim())
    throw new Error(`finding_ask_answer_ask_missing:${idx} (ask must be the requester's instruction, verbatim — the join to the frozen intake asks keys on it)`);
  if (typeof a.answer !== "string" || !a.answer.trim())
    // D1 — "one LABELLED line" is what this said, and this message reaches the model through the
    // corrective ladder. So a run that tripped any ask_answers error was told to write the label back,
    // re-creating the doubling the same commit removes at the dictation: the driver prints
    // `- You asked: <ask> → ` itself (pipeline.mjs buildAskAnswersSection). The ANSWER ALONE belongs here.
    throw new Error(`finding_ask_answer_answer_missing:${idx} (answer must be the ANSWER ALONE — what was found / "nothing found" / "not completed this run — <reason>". Never prefix it with "You asked: … →"; the driver adds that label when it builds the section)`);
  if (a.ordinals != null && !(Array.isArray(a.ordinals) && a.ordinals.every((n) => Number.isInteger(n) && n >= 1)))
    throw new Error(`finding_ask_answer_ordinals_invalid:${idx} (ordinals, when present, must be an array of integer finding ordinals)`);
  // — the label comes off HERE, at the register read, and therefore exactly once. See stripAskLabel.
  return a.answer === stripAskLabel(a.answer) ? a : { ...a, answer: stripAskLabel(a.answer) };
}

// ── — THE `You asked:` LABEL COMES OFF AT THE REGISTER READ ──────────────────────────────────────
//
// TWO SURFACES PROJECT ask_answers[] AND THEY DISAGREED. pipeline.mjs's buildAskAnswersSection prints the
// code-owned `- You asked: <ask> → ` label and stripped that same label off the answer if the register
// carried one ( D1 — archived registers do; demo/multi-country-focus-search/run/findings.json carries the doubled
// form on disk today). publish/report-data.mjs projects the SAME register into report-data.json through
// its client-scrub choke point, which does not touch the label. So one answer shipped two ways:
//
//   report.md         Satisfied. Every record in the band is an EUTM …
//   report-data.json  You asked: "EU register only." → Satisfied. Every record in the band is an EUTM …
//
// THE FIX IS NEITHER CONSUMER, and says so: "the label is removed once rather than in two places
// that can drift. The natural home is the register read itself." validateAskAnswer is that read — both
// parseFindingsJson and parseFindingsJsonLenient route every entry through it, and every consumer
// (report.md, report-data.json, the intake-ask lint) takes its answers from one of those two. Removing it
// at the choke point means report-data.mjs gains no fourth transform: that file rules itself the client
// cut "by construction", and adding a rule there would have been a decision about the choke point rather
// than a fix for a register that arrived doubled.
//
// THIS IS NOT THE SUBSTITUTION FORBIDS, for the reason already wrote down at the print site: it
// is an ANCHORED prefix in the shape of the driver's OWN label — the words "You asked" at position 0,
// through the first arrow. A position, not a vocabulary. It cannot fire mid-sentence, it never touches
// `ask`, and a mark named "You asked" would still have to open the answer AND be followed by an arrow.
//
// THE FILE ON DISK IS NOT REWRITTEN. Normalisation happens on READ, so findings.json keeps whatever
// synthesis wrote — forensics, replay and the quarantine path all still see the original bytes.
export function stripAskLabel(s) {
  const t = String(s ?? "").trim();
  const cut = t.replace(/^You asked:?\s*[^\n→]*?→\s*/i, "");
  return cut.trim() || t;                                      // an answer that is ONLY the label keeps its bytes
}

// WP-56 B2 — the standing "mark itself" read. OPTIONAL (legacy runs parse clean); when present it must be
// { distinctiveness, connotation }. Advisory only: it carries no band and never moves one — render places
// it at the top of the report on both variants.
// PR-9 (E9): each field accepts a non-empty STRING (legacy/simple) OR the structured object
// { spectrum, per_class[], per_market[], counter_registrations[], acquired, note } — typed rows instead
// of the ~1,900-char prose blob. The frozen renderer never sees the object: publish projects it to a
// deterministic string (projectAssessmentField); the rows themselves render in the audit workbook +
// report-data. The object must project non-empty (spectrum or note), so no field can validate to silence.
function validateMarkAssessment(m) {
  if (m == null) return null;
  if (!isPlainObject(m)) throw new Error("findings_mark_assessment_invalid (mark_assessment must be an object { distinctiveness, connotation })");
  onlyKeys(m, MARK_ASSESSMENT_KEYS, (k) => `findings_mark_assessment_key_unknown:${short(k)}`);
  validateAssessmentField(m.distinctiveness, "distinctiveness", "the spectrum read incl. the per-market translated/transliterated forms");
  validateAssessmentField(m.connotation, "connotation", "the meaning read, English AND non-English");
  return m;
}

// PR-9 — one mark_assessment field: string or structured object (see validateMarkAssessment). Token
// family stays findings_mark_assessment_* so the gateway's /findings?_/ corrective branch routes it.
function validateAssessmentField(v, field, what) {
  if (typeof v === "string") {
    if (v.trim()) return;
    throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field} must be a non-empty string — ${what} — or the structured { spectrum, read, per_class[], per_market[], counter_registrations[], acquired, note } object)`);
  }
  if (!isPlainObject(v))
    throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field} must be a non-empty string or the structured { spectrum, read, per_class[], per_market[], counter_registrations[], acquired, note } object)`);
  onlyKeys(v, ASSESSMENT_FIELD_KEYS, (k) => `findings_mark_assessment_key_unknown:${field}.${short(k)}`);
  const hasSpectrum = typeof v.spectrum === "string" && v.spectrum.trim();
  const hasNote = typeof v.note === "string" && v.note.trim();
  const hasRead = typeof v.read === "string" && v.read.trim();
  if (v.spectrum != null && typeof v.spectrum !== "string")
    throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.spectrum must be a string — the one-word/one-line placement, e.g. "suggestive")`);
  if (v.read != null && typeof v.read !== "string")
    throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.read must be a string — the 1-2 sentence consequence the reader sees)`);
  if (v.note != null && typeof v.note !== "string")
    throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.note must be a string)`);
  if (v.acquired != null && typeof v.acquired !== "string")
    throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.acquired must be a string — the acquired-distinctiveness read)`);
  if (!hasSpectrum && !hasNote && !hasRead)
    throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field} structured form needs at least a non-empty read, spectrum or note — an all-rows object would render to silence)`);
  const rows = (key, keys, req) => {
    if (v[key] == null) return;
    if (!Array.isArray(v[key])) throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.${key} must be a JSON ARRAY)`);
    for (const r of v[key]) {
      if (!isPlainObject(r)) throw new Error(`findings_mark_assessment_invalid (each mark_assessment.${field}.${key} row must be a plain object { ${keys.join(", ")} })`);
      onlyKeys(r, keys, (k) => `findings_mark_assessment_key_unknown:${field}.${key}.${short(k)}`);
      req(r);
    }
  };
  rows("per_class", ASSESSMENT_CLASS_ROW_KEYS, (r) => {
    if ((typeof r.class !== "string" && typeof r.class !== "number") || !String(r.class).trim())
      throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.per_class rows need a non-empty class)`);
    if (typeof r.note !== "string" || !r.note.trim())
      throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.per_class rows need a non-empty note)`);
  });
  rows("per_market", ASSESSMENT_MARKET_ROW_KEYS, (r) => {
    if (typeof r.market !== "string" || !r.market.trim())
      throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.per_market rows need a non-empty market)`);
    if (typeof r.note !== "string" || !r.note.trim())
      throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.per_market rows need a non-empty note)`);
  });
  rows("counter_registrations", ASSESSMENT_COUNTER_REG_KEYS, (r) => {
    const hasMark = typeof r.mark === "string" && r.mark.trim();
    const hasUri = typeof r.uri === "string" && r.uri.trim();
    if (!hasMark && !hasUri)
      throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.counter_registrations rows need a mark or a uri)`);
    for (const k of ["uri", "mark", "owner", "note"]) if (r[k] != null && typeof r[k] !== "string")
      throw new Error(`findings_mark_assessment_invalid (mark_assessment.${field}.counter_registrations.${k} must be a string)`);
  });
}

// spec 64 — typed forward actions. OPTIONAL (legacy/archived runs parse clean); when present it must be
// an ARRAY validated per entry by validateAction. Ordinal references are cross-checked against the
// document's OWN findings (the parser has them in hand — an action naming a finding that does not exist
// is a half-applied correction, exactly like withdrawn_reason on a live finding).
function validateActionsList(actions, findings) {
  if (actions == null) return null;
  if (!Array.isArray(actions)) throw new Error("findings_actions_invalid (actions must be a JSON ARRAY of { id, kind, text, ordinals } objects)");
  const knownOrds = new Set((findings ?? []).map((f) => f.ordinal));
  const seenIds = new Set();
  return actions.map((a, idx) => validateAction(a, idx, seenIds, knownOrds));
}

/**
 * spec 64 — validate ONE action { id, kind, text, ordinals, deadline?, condition? }. id = unique integer >= 1 (the
 * lint/render anchor); kind = EXACTLY one of ACTION_KINDS — the author's own legal classification, and
 * the field the disposition derivation partitions on, so an unknown kind throws token-FIRST rather than
 * silently defaulting either way; text = ONE client-plain sentence (it renders verbatim on the bound
 * line, the email conditions box and verdict.json.reasons); ordinals = the findings this action closes
 * ([] = run-level); deadline = the same { kind, date } shape as a finding deadline. Exported for the
 * lenient path and offline unit tests. Throws token-first.
 */
export function validateAction(a, idx, seenIds = new Set(), knownOrdinals = null) {
  if (!isPlainObject(a)) throw new Error(`finding_action_invalid:${idx} (every action must be a plain object { id, kind, text, ordinals })`);
  onlyKeys(a, ACTION_KEYS, (k) => `finding_action_key_unknown:${short(k)}`);
  if (!Number.isInteger(a.id) || a.id < 1) throw new Error(`finding_action_id_invalid:${short(a.id)} (action.id must be an integer >= 1)`);
  if (seenIds.has(a.id)) throw new Error(`finding_action_id_duplicate:${a.id} (each action's id must be unique)`);
  seenIds.add(a.id);
  if (!ACTION_KINDS.includes(a.kind))
    throw new Error(`finding_action_kind_invalid:${short(a.kind)} (kind must be EXACTLY one of — conditions: ${CONDITION_KINDS.join(", ")}; advisory: ${ADVISORY_KINDS.join(", ")})`);
  if (typeof a.text !== "string" || !a.text.trim())
    throw new Error(`finding_action_text_missing:${a.id} (action.text must be one non-empty client-plain sentence)`);
  if (!Array.isArray(a.ordinals) || a.ordinals.some((n) => !Number.isInteger(n) || n < 1))
    throw new Error(`finding_action_ordinals_invalid:${a.id} (action.ordinals must be an array of integer finding ordinals — [] for a run-level action)`);
  // PR-3 (report voice) — the optional factual open-state clause: a fact ("Consent from X is not yet
  // in hand"), never an instruction; CONDITION kinds only (an advisory never conditions reliance, so
  // a clause there is a mis-typed kind, caught token-first for the corrective ladder).
  if (a.condition != null) {
    if (typeof a.condition !== "string" || !a.condition.trim())
      throw new Error(`finding_action_condition_invalid:${a.id} (action.condition must be a non-empty string — the factual open-state this action closes, stated as a fact)`);
    if (!CONDITION_KINDS.includes(a.kind))
      throw new Error(`finding_action_condition_on_advisory:${a.id} (action.condition belongs on CONDITION kinds only — an advisory never conditions reliance; re-type the kind or drop the clause)`);
  }
  if (knownOrdinals) for (const n of a.ordinals) if (!knownOrdinals.has(n))
    throw new Error(`finding_action_ordinal_unknown:${n} (action ${a.id} references finding ordinal ${n}, which does not exist in this document)`);
  if (a.deadline != null) {
    if (!isPlainObject(a.deadline)) throw new Error(`finding_action_deadline_invalid:${a.id} (deadline must be an object { kind, date })`);
    onlyKeys(a.deadline, DEADLINE_KEYS, (k) => `finding_action_deadline_key_unknown:${short(k)}`);
    if (a.deadline.kind != null && typeof a.deadline.kind !== "string")
      throw new Error(`finding_action_deadline_invalid:${a.id} (deadline.kind must be a string — e.g. opposition / statement-of-use / renewal)`);
    if (typeof a.deadline.date !== "string" || !a.deadline.date.trim())
      throw new Error(`finding_action_deadline_invalid:${a.id} (deadline.date must be a non-empty string — the ISO date the action is due)`);
  }
  return a;
}

// A1 — the corrective pass's machine attestation. OPTIONAL (legacy runs parse clean);
// when present it must be { applied: boolean, note: string } — the note names each flagged entity
// and its disposition (corrected / withdrawn / no-change-because-…). Malformed ⇒ token-first throw.
// PR-9 (E9): optional structured `entries[]` beside the note — one { entity, disposition, note? } row
// per flagged entity, so the audit workbook renders the attestation as rows rather than a prose blob.
function validateCorrections(c) {
  if (c == null) return null;
  if (!isPlainObject(c)) throw new Error("findings_corrections_invalid (corrections must be an object { applied, note })");
  onlyKeys(c, CORRECTIONS_KEYS, (k) => `findings_corrections_key_unknown:${short(k)}`);
  if (typeof c.applied !== "boolean") throw new Error("findings_corrections_invalid (corrections.applied must be a boolean)");
  if (typeof c.note !== "string" || !c.note.trim()) throw new Error("findings_corrections_invalid (corrections.note must be a non-empty string naming each flagged entity and its disposition)");
  if (c.entries != null) {
    if (!Array.isArray(c.entries)) throw new Error("findings_corrections_invalid (corrections.entries, when present, must be a JSON ARRAY of { entity, disposition, note? } rows)");
    for (const r of c.entries) {
      if (!isPlainObject(r)) throw new Error("findings_corrections_invalid (each corrections entry must be a plain object { entity, disposition, note? })");
      onlyKeys(r, CORRECTION_ENTRY_KEYS, (k) => `findings_corrections_key_unknown:entries.${short(k)}`);
      if (typeof r.entity !== "string" || !r.entity.trim()) throw new Error("findings_corrections_invalid (corrections entry.entity must be a non-empty string — the flagged mark/owner)");
      if (typeof r.disposition !== "string" || !r.disposition.trim()) throw new Error("findings_corrections_invalid (corrections entry.disposition must be a non-empty string — corrected / withdrawn / no-change-because-…)");
      if (r.note != null && typeof r.note !== "string") throw new Error("findings_corrections_invalid (corrections entry.note must be a string)");
    }
  }
  return c;
}

// A3 — LENIENT parse for the LAST-RESORT quarantine path. Used ONLY after the strict validator + the whole
// corrective-retry ladder have already failed — NEVER on the normal validation path (that stays strict so the
// retries fire). Validates each finding INDEPENDENTLY: the valid ones are kept, the malformed ones are DROPPED
// and RECORDED in `quarantined` (never silent) so one bad object can't sink an otherwise-deliverable ~$40 run.
// Top-level shape defects (unparseable JSON, unknown top key) still throw — those are not a single-finding
// problem. Coverage / context notes are best-effort (drop the invalid, keep the rest). The caller decides
// whether the surviving set is deliverable (it requires >= 1 valid finding) and surfaces the drop LOUDLY.
export function parseFindingsJsonLenient(raw, opts = {}) {
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { throw new Error(`findings_unparseable: ${short(e.message)}`); }
  if (!isPlainObject(doc)) throw new Error("findings_unparseable: top level must be a JSON OBJECT { schema_version, findings, coverage }");
  const schemaVersion = typeof doc.schema_version === "number" ? doc.schema_version : 1;
  // — the lenient path skips the v6 gates DELIBERATELY. This parser DROPS whatever fails, and
  // dropping an off-field finding because it lacks a position string would delete the very negative the
  // requirement exists to make visible: silence, arrived at by enforcing a rule against silence. The
  // strict path throws (and the corrective ladder repairs); here the predelivery lint names it instead,
  // version-independently, so nothing is lost — see contentModelChecks.
  const mode = { v4: schemaVersion >= 4, v5: schemaVersion >= 5, v6: schemaVersion >= 6, v7: schemaVersion >= 7, lenient: true, manifest: opts.manifest ?? null };
  onlyKeys(doc, topKeysFor(mode), (k) => `findings_key_unknown:${short(k)}`);
  const findings = Array.isArray(doc.findings) ? doc.findings : [];
  const coverage = Array.isArray(doc.coverage) ? doc.coverage : [];
  const contextNotes = Array.isArray(doc.context_notes) ? doc.context_notes : [];
  const seenOrdinals = new Set();
  const outFindings = [], quarantined = [];
  findings.forEach((f, idx) => {
    try { outFindings.push(validateFinding(f, idx, seenOrdinals, mode)); }
    catch (e) { quarantined.push({ index: idx, mark: (f && typeof f.mark === "string" && f.mark.trim()) ? f.mark : `#${idx}`, error: e.message }); }
  });
  const outCoverage = [], outContextNotes = [];
  for (const c of coverage) { try { outCoverage.push(validateCoverage(c)); } catch { /* advisory — drop the malformed area */ } }
  for (const n of contextNotes) { try { outContextNotes.push(validateContextNote(n)); } catch { /* advisory — drop the malformed note */ } }
  // spec 64 — actions are per-entry best-effort BUT never silent: a dropped CONDITION action can flip
  // the derived disposition, so every drop is RECORDED in actionsQuarantined for the caller to surface
  // (the strict path repairs these via the normal corrective ladder; this path only runs post-ladder).
  //
  // — THE ROW CARRIES THE RAW `kind`, and it is the whole reason the caller can act. Until this
  // field existed the record was { index, id, error }: enough to log, never enough to say whether what
  // was dropped CONDITIONED THE VERDICT. The floor and the sidecar's own coherence check both read the
  // post-quarantine actions list, so both were blind to the same drop for the same reason, and a
  // malformed condition delivered as CLEAR. The kind is read RAW off the rejected object — it is not
  // trustworthy input, which is exactly why the consumer below treats an unreadable one as a condition
  // rather than as an advisory.
  const outActions = [], actionsQuarantined = [];
  if (Array.isArray(doc.actions)) {
    const knownOrds = new Set(outFindings.map((f) => f.ordinal));
    const seenIds = new Set();
    doc.actions.forEach((a, idx) => {
      try { outActions.push(validateAction(a, idx, seenIds, knownOrds)); }
      catch (e) { actionsQuarantined.push({ index: idx, id: (a && Number.isInteger(a.id)) ? a.id : null, kind: (a && typeof a.kind === "string") ? a.kind : null, error: e.message }); }
    });
  } else if (doc.actions != null) {
    // The whole field is malformed, so nothing is known about what it held — `kind: null` is the
    // honest record and reads as condition-suspect below.
    actionsQuarantined.push({ index: -1, id: null, kind: null, error: "findings_actions_invalid (actions must be a JSON ARRAY of { id, kind, text, ordinals } objects)" });
  }
  return {
    schemaVersion,
    ratedUnderFramework: mode.v4 && typeof doc.rated_under_framework === "string" ? doc.rated_under_framework : null,
    findings: outFindings,
    coverage: outCoverage,
    contextNotes: outContextNotes,
    coverageJudgment: (() => { try { return validateCoverageJudgmentRows(doc.coverage_judgment); } catch { return (doc.coverage_judgment && typeof doc.coverage_judgment === "object" && !Array.isArray(doc.coverage_judgment)) ? { ...doc.coverage_judgment, rows: null } : null; } })(),   // best-effort — malformed rows are dropped, the judgment itself survives
    corrections: (() => { try { return validateCorrections(doc.corrections); } catch { return null; } })(),   // best-effort on the quarantine path
    markAssessment: (() => { try { return validateMarkAssessment(doc.mark_assessment); } catch { return null; } })(),   // best-effort — a malformed block never sinks the quarantine path
    actions: Array.isArray(doc.actions) ? outActions : null,
    actionsQuarantined,
    quarantined,
    // PR-9 — per-entry best-effort: a malformed answer is dropped (the join check then names the ask it
    // left unanswered — the drop is never silent because the lint row fires on the missing join).
    // — RECORDED, not just dropped. The drop itself stays (an advisory block must never sink the
    // quarantine path), but a dropped ask_answer used to leave NO trace in any list, while its throw
    // token `finding_ask_answer_*` matched the salvage lane's `finding_[a-z]` admission test. So the
    // lane admitted a defect nothing could name and the run exhausted. `ask_answers` is the join to the
    // FROZEN intake asks: a dropped one ships a question the client committed at intake unanswered,
    // which is worth a repair turn, not a shrug.
    askAnswers: Array.isArray(doc.ask_answers)
      ? doc.ask_answers.map((a, idx) => { try { return validateAskAnswer(a, idx); } catch { return null; } }).filter(Boolean)
      : null,
    askAnswersQuarantined: Array.isArray(doc.ask_answers)
      ? doc.ask_answers.flatMap((a, idx) => {
        try { validateAskAnswer(a, idx); return []; }
        // `ask` is echoed because it is the join key the seat can find its own row by — truncated,
        // because it is the requester's own instruction and can be long.
        catch (e) { return [{ index: idx, ask: (a && typeof a.ask === "string") ? a.ask.slice(0, 80) : null, error: e.message }]; }
      })
      : [],
    // P5 — best-effort on the quarantine path (advisory data block; a malformed block never sinks it).
    fourAnswers: (() => { try { return validateFourAnswers(doc.four_answers); } catch { return null; } })(),
  };
}

// C2 — consolidate genuinely near-duplicate findings. The SAME owner filing the SAME mark more than once
// (e.g. two filing dates, or one mark filed in several classes) is ONE conflict, not N cards — and emitting
// it as N findings is what let render.mjs print the same card text repeatedly. Group by (normalized
// owner.name, normalized mark); for each group of >1 keep the highest-composite finding as the base, UNION
// its owner.registrations[] with the rest (dedup by lowercased uri), and drop the others. Ordinals are
// renumbered 1..N — every delivered surface (report cards, the landscape, the published findings.json the
// the MCP reads) keys off findings.json, so the post-merge numbering is the single source of truth; the
// raw spine (register-findings.md) still lists every filing, so the audit trail loses nothing. Order is the
// group's first appearance. PURE (no IO). Returns { findings, merges:[{mark, owner, kept, dropped:[ord]}] }.
// A1: a withdrawn finding is a non-mergeable singleton — folding a LIVE filing into a
// withdrawn base (or vice versa) would either resurrect a killed conflict or silently kill a live
// one. The `~withdrawn~` suffix keeps it in its own group without touching live-group keys.
// ── A LATIN NORMALISER STANDING WHERE A COMPARISON SHOULD BE ('s class, third site) ─────────────
//
// `[^a-z0-9]` folds a CJK, Cyrillic or Arabic value to the EMPTY STRING, and this key is built from two
// of them. Measured on origin/main before the fix:
//
//   Shanghai Xiangjin + 色度   →  "shanghai xiangjin|"     ┐ same key: two DIFFERENT marks, one owner,
//   Shanghai Xiangjin + 色彩   →  "shanghai xiangjin|"     ┘ consolidated, and the loser's prose dropped
//   上海翔金          + 色度   →  "|"                       ← BOTH halves empty
//
// The second line is the severe one and it is not what I expected to find. A Chinese owner with a
// Chinese mark keys to the empty string, so EVERY such finding in a run — across unrelated owners —
// shares one key and merges into a single card. `consolidateFindings` keeps the highest-severity member
// and drops the others, so a run's entire non-Latin field can collapse into one finding whose prose
// describes one of them.
//
// The fix is 's, at a third site: keep the Latin normalisation exactly as it was where it produces
// anything, and fall back to the RAW value (NFKC-folded, so full-width and compatibility forms of the
// same characters still key alike) where it does not. Latin keys are byte-identical to before — pinned
// by test, because a consolidation key that moved would re-merge every archived finding differently.
const foldKey = (s) => {
  const t = String(s ?? "").trim();
  const latin = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return latin || (t ? `raw:${t.normalize("NFKC").toLowerCase()}` : "");
};

const consolidationKey = (f) =>
  `${foldKey(f?.owner?.name)}` +
  `|${foldKey(f?.mark)}` +
  (f?.disposition === "withdrawn" ? `|~withdrawn~${f?.ordinal ?? ""}` : "");

export function consolidateFindings(findings, manifest = null) {
  const order = [];
  const groups = new Map();
  for (const f of findings ?? []) {
    const k = consolidationKey(f);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k).push(f);
  }
  // base = most exposure: worst band by the frozen manifest's order (doc 50), else highest composite
  // (legacy). An unbanded member ranks least severe. Tie → earliest ordinal, for stability.
  const severity = (f) => {
    if (manifest && f?.band != null) {
      const i = bandIndex(manifest, f.band);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    }
    return manifest ? Number.MAX_SAFE_INTEGER : -(Number(f?.composite) || 0);
  };
  const merges = [];
  const out = order.map((k) => {
    const members = groups.get(k);
    if (members.length === 1) return { ...members[0] };
    const base = members.slice().sort((a, b) =>
      severity(a) - severity(b) || (Number(a.ordinal) || 0) - (Number(b.ordinal) || 0))[0];
    const seen = new Set();
    const registrations = [];
    for (const m of members) for (const r of (m?.owner?.registrations ?? [])) {
      const u = String(r?.uri ?? "").toLowerCase();
      if (u && seen.has(u)) continue;
      if (u) seen.add(u);
      registrations.push(r);
    }
    merges.push({ mark: base.mark, owner: base.owner?.name ?? "", kept: base.ordinal,
      dropped: members.filter((m) => m !== base).map((m) => m.ordinal) });
    // review fix: a merged-away member's structured deadline must survive the fold (the
    // earliest date wins when several members carry one) — losing it would silently drop an
    // enriched opposition window between the deadline-carry check and delivery.
    const memberDeadline = members.map((m) => m?.deadline).filter((d) => d && typeof d.date === "string" && d.date.trim())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    return { ...base, ...(base.deadline?.date ? {} : (memberDeadline ? { deadline: memberDeadline } : {})), owner: { ...base.owner, registrations } };
  });
  out.forEach((f, i) => { f.ordinal = i + 1; });   // contiguous renumber — the single source for cards + MCP
  // spec 64 — old→new ordinal map, so actions[].ordinals survive the renumber. A merged-away member maps
  // to its group's KEPT finding's NEW ordinal (the action still applies to the consolidated conflict —
  // dropping the reference would silently un-condition a live demand).
  const ordinalMap = new Map();
  order.forEach((k, i) => {
    for (const m of groups.get(k)) if (Number.isInteger(m?.ordinal)) ordinalMap.set(m.ordinal, i + 1);
  });
  return { findings: out, merges, ordinalMap };
}

/**
 * spec 64 — remap actions[].ordinals through consolidateFindings' ordinalMap (dedup; a reference the map
 * does not know is DROPPED — it never existed in the consolidated set). PURE; null-safe passthrough.
 */
export function remapActionOrdinals(actions, ordinalMap) {
  if (!Array.isArray(actions)) return actions ?? null;
  // review fix: an action whose EVERY reference dangles is DROPPED, never promoted — turning
  // a fully-unknown-ordinal action into ordinals:[] would make it run-level (always-live) and could
  // resurrect a lenient-quarantined condition as a verdict input after consolidation.
  return actions.map((a) => {
    const orig = Array.isArray(a?.ordinals) ? a.ordinals : [];
    const mapped = [...new Set(orig.map((n) => ordinalMap?.get?.(n)).filter((n) => Number.isInteger(n)))];
    if (orig.length && !mapped.length) return null;
    return { ...a, ordinals: mapped };
  }).filter(Boolean);
}

function validateFinding(f, idx, seenOrdinals, mode = { v4: false, manifest: null }) {
  if (!isPlainObject(f)) throw new Error(`finding_invalid:${idx} (every finding must be a plain object)`);
  // doc 50 — on v4 the legacy scale is FORBIDDEN, with its own token BEFORE the key allowlist so the
  // corrective ladder repairs a model that reverts to years of Composite/Level habit instructively.
  if (mode.v4) {
    for (const k of LEGACY_SCALE_KEYS) if (k in f)
      throw new Error(`finding_legacy_scale_forbidden:${k} (schema_version 4 rates with the framework's band WORD — the composite/level/dispute_type scale is retired; put the reasoning in the narrative)`);
  }
  onlyKeys(f, findingKeysFor(mode), (k) => `finding_key_unknown:${short(k)}`);

  // ordinal — 1-based, integer, unique (the F1/F2 drill-through id; markers and cards share it).
  const ord = f.ordinal;
  if (!Number.isInteger(ord) || ord < 1) throw new Error(`finding_ordinal_invalid:${short(ord)} (ordinal must be an integer >= 1)`);
  if (seenOrdinals.has(ord)) throw new Error(`finding_ordinal_duplicate:${ord} (each finding's ordinal must be unique)`);
  seenOrdinals.add(ord);

  if (typeof f.mark !== "string" || !f.mark.trim()) throw new Error(`finding_mark_missing:${ord} (every finding needs a non-empty mark)`);

  if (mode.v4) {
    // the framework in force rates the matter: disposition is REQUIRED (placement can never fall back to
    // a composite that no longer exists), and the band-by-disposition matrix decides who carries a band.
    if (f.disposition == null)
      throw new Error(`finding_disposition_missing:${ord} (schema_version 4 requires a disposition on every finding)`);
    if (!DISPOSITIONS.includes(f.disposition))
      throw new Error(`finding_disposition_invalid:${short(f.disposition)} (disposition must be one of: ${DISPOSITIONS.join(", ")})`);
    validateBand(f, ord, mode);
  } else {
    if (!Number.isInteger(f.composite) || f.composite < 1 || f.composite > 5)
      throw new Error(`finding_composite_invalid:${short(f.composite)} (composite must be an integer 1-5)`);
    if (!LEVELS.includes(f.level)) throw new Error(`finding_level_invalid:${short(f.level)} (level must be one of: ${LEVELS.join(", ")})`);
    if (!DISPUTE_TYPES.includes(f.dispute_type))
      throw new Error(`finding_dispute_type_invalid:${short(f.dispute_type)} (dispute_type must be one of: ${DISPUTE_TYPES.join(", ")})`);

    // CHANGE 2 — OPTIONAL placement token. ABSENT is allowed (legacy/archived runs fall back to composite
    // banding). When present it must be a closed-enum value; an unknown value throws token-FIRST so the
    // gateway corrective ladder can key on it. It sets render BAND only — it NEVER touches composite/level.
    if (f.disposition != null && !DISPOSITIONS.includes(f.disposition))
      throw new Error(`finding_disposition_invalid:${short(f.disposition)} (disposition, when present, must be one of: ${DISPOSITIONS.join(", ")})`);
  }
  // A1 — a withdrawn finding must say WHY (the reviewer's kill reason travels with the
  // forensic record); withdrawn_reason on a live finding is a shape error (it implies a half-applied
  // correction). Token-FIRST so the corrective ladder can key on it.
  if (f.disposition === "withdrawn" && !(typeof f.withdrawn_reason === "string" && f.withdrawn_reason.trim()))
    throw new Error(`finding_withdrawn_reason_missing:${ord} (a withdrawn finding must carry withdrawn_reason — the review flag that killed it)`);
  if (f.withdrawn_reason != null && f.disposition !== "withdrawn")
    throw new Error(`finding_withdrawn_reason_orphan:${ord} (withdrawn_reason is only valid when disposition is "withdrawn")`);

  validateOwner(f.owner, ord, mode?.recordOrigins ?? null);
  validateMeters(f.meters);
  validateQuadrant(f.quadrant);
  validateSource(f.source, ord, mode?.recordOrigins ?? null);

  // Instance #5 — per-finding use-check / own-rights cite. SHAPE-ONLY here (present ⇒ a { source } object
  // whose source is a string). The composite>=3 NON-EMPTY-source enforcement lives in verify.mjs
  // checkFindingsSibling so it carries the ordinal context and is a validator-fail (not a parser-throw) on
  // the offline unit path; both layers emit the SAME finding_use_check_source_missing / _own_rights_ family.
  if (f.use_check != null) {
    if (!isPlainObject(f.use_check)) throw new Error(`finding_use_check_invalid:${ord} (use_check must be an object { source })`);
    onlyKeys(f.use_check, USE_CHECK_KEYS, (k) => `finding_use_check_key_unknown:${short(k)}`);
    if (typeof f.use_check.source !== "string")
      throw new Error(`finding_use_check_source_missing:${ord} (use_check.source must be a string — a result URL or "perplexity_research — no result")`);
    // A4 — OPTIONAL model-attested source class; closed enum when present (token-first).
    // Consumed by registry-fidelity.joinEvidenceStatus: an attested register-mirror DEMOTES the use
    // meter even when the URL host list misses it; an attestation never upgrades a classified mirror.
    if (f.use_check.quality != null && !USE_SOURCE_QUALITY.includes(f.use_check.quality))
      throw new Error(`finding_use_check_quality_invalid:${short(f.use_check.quality)} (quality, when present, must be one of: ${USE_SOURCE_QUALITY.join(", ")})`);
  }
  if (f.own_rights != null) {
    if (!isPlainObject(f.own_rights)) throw new Error(`finding_own_rights_invalid:${ord} (own_rights must be an object { source })`);
    onlyKeys(f.own_rights, OWN_RIGHTS_KEYS, (k) => `finding_own_rights_key_unknown:${short(k)}`);
    if (typeof f.own_rights.source !== "string")
      throw new Error(`finding_own_rights_source_missing:${ord} (own_rights.source must be a string — record URI(s) or "no applicant-owned registrations in the searched register material")`);
  }
  // U3 (probative grading) — OPTIONAL one-line "why this fact bears on THIS conflict" rationale attached
  // when a risk-raising signal (notably enforcer = high) moves the finding. SHAPE-ONLY here (a string);
  // the "enforcer-high needs a bears_on" tripwire lives in reasoning-tripwires.mjs (flag, not parser-throw).
  // A legacy findings.json without it parses clean (mirrors use_check / own_rights).
  if (f.bears_on != null && typeof f.bears_on !== "string")
    throw new Error(`finding_bears_on_invalid:${ord} (bears_on must be a string — one line on what the risk-raising fact proves about this conflict)`);
  // Three-tier risk (2026-06-19) — OPTIONAL per-finding IMPACT note: the consequences IF the rights-holder
  // enforced (injunction / damages / account of profits / reputational / costs), surfaced for the client to
  // weigh. SHAPE-ONLY here (a string). Impact is client-specific and is surfaced BESIDE the rating; it never
  // carries or moves a Level/Composite (those are the same for every client). Legacy findings.json without it
  // parses clean (mirrors bears_on / use_check / own_rights).
  if (f.impact != null && typeof f.impact !== "string")
    throw new Error(`finding_impact_invalid:${ord} (impact must be a string — one line on the consequences if enforced, surfaced for the client to weigh; it never moves the Level/Composite)`);
  // #6 (deadline urgency) — OPTIONAL time-critical date a conflict imposes on the CLIENT to ACT (an opposition
  // window, a statement-of-use deadline, a renewal the client must contest/file). SHAPE-ONLY here (an object
  // { kind, date } with string fields, date non-empty); the "a near-term deadline must surface as a time-critical
  // ACTION, not be buried in the risk letter" check lives in reasoning-tripwires.mjs (a flag, not a parser-throw).
  // Legacy findings.json without it parses clean (mirrors use_check / own_rights / bears_on).
  if (f.deadline != null) {
    if (!isPlainObject(f.deadline)) throw new Error(`finding_deadline_invalid:${ord} (deadline must be an object { kind, date })`);
    onlyKeys(f.deadline, DEADLINE_KEYS, (k) => `finding_deadline_key_unknown:${short(k)}`);
    if (f.deadline.kind != null && typeof f.deadline.kind !== "string")
      throw new Error(`finding_deadline_invalid:${ord} (deadline.kind must be a string — e.g. opposition / statement-of-use / renewal)`);
    if (typeof f.deadline.date !== "string" || !f.deadline.date.trim())
      throw new Error(`finding_deadline_date_missing:${ord} (deadline.date must be a non-empty string — the ISO date the action is due)`);
  }
  // P5 (Reviewer §L) — legal vs practical, SEPARATED on the record. OPTIONAL strings (archived runs parse
  // clean); presence on fresh rated findings is a predelivery-lint flag, never a parser throw. The
  // band already follows the framework's method; these carry the two reads the reader must never see
  // blurred — legal (similarity × proximity under the framework's own definitions) and practical
  // (enforcement reality: owner posture, market presence, delisted-retailer/no-revenue facts) —
  // stated alongside, never averaged.
  if (f.legal_position != null && !(typeof f.legal_position === "string" && f.legal_position.trim()))
    throw new Error(`finding_legal_position_invalid:${ord} (legal_position, when present, must be a non-empty string — the LEGAL read alone, the one the band's legal letter follows)`);
  if (f.practical_position != null && !(typeof f.practical_position === "string" && f.practical_position.trim()))
    throw new Error(`finding_practical_position_invalid:${ord} (practical_position, when present, must be a non-empty string — the practical/enforcement-reality read, stated alongside the legal read, never averaged into the band)`);
  // — v6: PRESENCE, not just shape. Every disposition that reaches a reader carries both reads.
  validatePositionsRequired(f, ord, mode);
  // — v6: the one-clause net is now the ONLY authored per-finding summary, so its absence is loud.
  validateNetRequired(f, ord, mode);
  // — v6: off-field declares WHICH ground it rests on, and a field claim is checked against the
  // finding's own goods meter.
  validateOffFieldGround(f, ord, mode);
  // P5 (Reviewer §L) — the manageable category + reason. OPTIONAL (legacy runs parse clean); when present
  // it must be well-formed AND sit on a manageable disposition — on adversarial/off-field it marks a
  // mis-typed disposition (promote-or-omit has no third state), caught token-first for the corrective
  // ladder. Withdrawn tolerates a stale one (forensic record, renders nowhere).
  if (f.manageable != null) {
    if (!isPlainObject(f.manageable)) throw new Error(`finding_manageable_invalid:${ord} (manageable must be an object { category, reason })`);
    onlyKeys(f.manageable, MANAGEABLE_KEYS, (k) => `finding_manageable_key_unknown:${short(k)}`);
    if (!MANAGEABLE_CATEGORIES.includes(f.manageable.category))
      throw new Error(`finding_manageable_category_invalid:${short(f.manageable.category)} (category must be EXACTLY one of: ${MANAGEABLE_CATEGORIES.join(" / ")} — a notable finding fitting none is promoted to adversarial or omitted, never parked)`);
    if (typeof f.manageable.reason !== "string" || !f.manageable.reason.trim())
      throw new Error(`finding_manageable_reason_missing:${ord} (manageable.reason must state WHY this finding is manageable — the category alone is a label, not a reason)`);
    if (["adversarial", "off-field"].includes(f.disposition))
      throw new Error(`finding_manageable_on_unmanageable:${ord} (manageable belongs on ${MANAGEABLE_DISPOSITIONS.join("/")} findings only — an adversarial finding is not manageable, and an off-field awareness item is not rated; re-type the disposition or drop the field)`);
  }
  return f;
}

// ── requirement 1 — no disposition is structurally exempt ────────────────────────────────────────
//
// A negative with no structured position is silence with a label. On the 08-02 VENZY run all four
// off-field findings carried `net` and neither position, while every adversarial and distinguished
// finding carried both — so the class of finding most likely to be challenged (a negative about a major
// proprietor) was the only class shipping with no reasoning structure.
//
// WHY A THROW AND NOT A FLAG. This is a synthesis-time contract miss, so it rides the corrective retry
// ladder and gets REPAIRED — it is not a delivery gate, and it cannot strand a finished matter at the
// door. A flag here would ship the defect with a banner on it. The lint keeps its own version-independent
// check (contentModelChecks) for the paths a throw cannot reach: the lenient/quarantine parse, and a
// down-level `schema_version` that would otherwise disengage this gate silently.
//
// RULED-OUT IS NOT AN EXEMPTION (doc-52). A `ruled_out` finding shares no word or sound with the mark —
// it is a name that surfaced, not a close match, and it renders in the quiet "Also considered" list
// rather than as a reasoned negative. Its ground is `ruled_out_reason`, which v6 makes structural rather
// than merely instructed, so the escape hatch cannot be used to reach silence.
function validatePositionsRequired(f, ord, mode) {
  if (!mode.v6 || mode.lenient) return;
  if (f.ruled_out === true) {
    if (!(typeof f.ruled_out_reason === "string" && f.ruled_out_reason.trim()))
      throw new Error(`finding_ruled_out_reason_missing:${ord} (a ruled-out name must NAME the specific point that settled it — the word or sound it does not share, the field it sits in, the register entry that decides it; a ruled-out flag with no reason is a dismissal, not a finding)`);
    return;
  }
  if (!POSITION_REQUIRED_DISPOSITIONS.includes(f.disposition)) return;   // withdrawn — see the const's doc block
  for (const [key, what] of [
    ["legal_position", "the LEGAL read alone: mark similarity × goods/services proximity × the senior right's scope, under the framework's own definitions"],
    ["practical_position", "the enforcement REALITY: owner posture and capability, marketplace presence, coexistence history"],
  ]) {
    if (!(typeof f[key] === "string" && f[key].trim()))
      throw new Error(`finding_${key}_missing:${ord} (EVERY disposition carries both positions — a ${f.disposition} finding included; ${what}. A negative with no structured position is silence with a label)`);
  }
}

// ── — the net is REQUIRED, because it is now the only summary there is ───────────────────────────
//
// Until this issue a finding with no `net` still had a sentence: the report card carried a separately
// AUTHORED `- one:` line and the renderer fell back to it. That fallback is what made the field optional
// and what the ruling deletes — one finding was being summarised three times (card `one:`, `### The read`,
// and the typed `net`), and nothing made the three agree.
//
// With the other two gone, an absent `net` is not a degraded card — it is a finding with NO summary on any
// surface. So the absence has to be loud, and this is the seventh place in this file family where an
// absence used to read as a pass.
//
// WHY A THROW, and not a delivery flag — the answer, unchanged: this is a synthesis-time contract
// miss, so it rides the CORRECTIVE RETRY LADDER and gets repaired. validators.narrative strict-parses
// findings.json through this parser (verify.mjs checkFindingsSibling) and converts the throw into a
// fail() token at the SYNTHESIS stage — long before the delivery phase reads the file — so a missing net
// costs a retry, never a stranded matter. A flag here would ship a summary-less card with a banner on it.
//
// THE EXEMPTIONS ARE THE SAME TWO, for the same reasons:
//   · withdrawn — a review-killed finding gets no card call at all ( A1), so it has no surface to
//     be silent on. POSITION_REQUIRED_DISPOSITIONS is the shared list.
//   · ruled_out — renders in the quiet "Also considered — ruled out" list off `ruled_out_reason`, never
//     off `net`. Demanding a net there would ask for a summary of a name that is not a conflict.
// The lint keeps its own version-independent twin (contentModelChecks) for the paths a throw cannot
// reach: the lenient/quarantine parse, and a down-level schema_version that would disengage this gate.
function validateNetRequired(f, ord, mode) {
  if (!mode.v6 || mode.lenient) return;
  if (f.ruled_out === true) return;                                      // its ground is ruled_out_reason
  if (!POSITION_REQUIRED_DISPOSITIONS.includes(f.disposition)) return;   // withdrawn — see the const's doc block
  if (typeof f.net === "string" && f.net.trim()) return;
  throw new Error(`finding_net_missing:${ord} (EVERY finding a reader sees carries the one-clause net — it is the ONLY per-finding summary the report has: the card leads with it, the grouped-negative line states it, the MCP brief lists the finding by it. Name the legal risk driver, then the FACT that conditions it. Length is the renderer's problem, not yours)`);
}

// ── requirement 2 — the label follows the argument ───────────────────────────────────────────────
//
// See OFF_FIELD_GROUNDS for the two grounds and why both stay reachable. The enforceable half is here:
// a `different-field` claim is a claim ABOUT THE GOODS, and the finding's own goods_proximity meter has
// to agree with it. Nothing in this function reads prose or re-judges a conflict — it compares two
// declarations the author made in the same record.
function validateOffFieldGround(f, ord, mode) {
  const g = f.off_field_ground;
  if (g != null && f.disposition !== "off-field")
    throw new Error(`finding_off_field_ground_orphan:${ord} (off_field_ground states which ground an OFF-FIELD negative rests on — on a ${f.disposition} finding it is a mis-typed disposition, not extra colour)`);
  if (g != null && !OFF_FIELD_GROUNDS.includes(g))
    throw new Error(`finding_off_field_ground_invalid:${short(g)} (off_field_ground must be EXACTLY one of: ${OFF_FIELD_GROUNDS.join(" / ")})`);
  if (!mode.v6 || mode.lenient || f.disposition !== "off-field" || f.ruled_out === true) return;
  if (g == null)
    throw new Error(`finding_off_field_ground_missing:${ord} (an off-field negative must declare its ground: "different-field" = the goods/sector do not meet (the finding's goods_proximity must then read low), or "no-material-risk" = the conflict is clearly won on no material risk. If the distance is carried by the MARK — sound, rhythm, orthography, connotation — the disposition is "distinguished", not off-field)`);
  if (g === "different-field" && f.meters?.goods_proximity?.token !== "low")
    throw new Error(`finding_off_field_goods_proximate:${ord} (this finding claims a DIFFERENT COMMERCIAL FIELD while its own goods_proximity meter reads "${short(f.meters?.goods_proximity?.token)}" — one record cannot say both. Either the goods genuinely do not meet (score the meter low) or they do: a mark argued apart on sound/rhythm/orthography with overlapping goods is "distinguished", and a conflict clearly won on no material risk is off_field_ground "no-material-risk")`);
}

// P5 — the four answers. OPTIONAL top level (archived runs parse clean); each of the four answers is
// itself OPTIONAL — an answer the run cannot ground is OMITTED, never faked (what cannot be computed
// is authored prose under the P6 rules, in the narrative). When an answer is present: `read` is the
// required 1-2 sentence consequence; `token` is the optional lawyer-authored judgment word (closed
// enum per answer); `basis` names what the token/read rests on; `ordinals` joins the findings it
// rests on; `obstacles` (registrability only) carries the per-class obstacle rows. Token-first.
function validateFourAnswers(fa) {
  if (fa == null) return null;
  if (!isPlainObject(fa)) throw new Error("findings_four_answers_invalid (four_answers must be an object with any of: " + FOUR_ANSWERS_KEYS.join(", ") + ")");
  onlyKeys(fa, FOUR_ANSWERS_KEYS, (k) => `findings_four_answers_key_unknown:${short(k)}`);
  for (const key of FOUR_ANSWERS_KEYS) {
    const a = fa[key];
    if (a == null) continue;
    if (!isPlainObject(a)) throw new Error(`findings_four_answers_invalid:${key} (each answer must be a plain object { read, token?, basis?, ordinals?${key === "registrability" ? ", obstacles?" : ""} })`);
    onlyKeys(a, FOUR_ANSWER_ENTRY_KEYS, (k) => `findings_four_answers_key_unknown:${key}.${short(k)}`);
    if (typeof a.read !== "string" || !a.read.trim())
      throw new Error(`findings_four_answers_read_missing:${key} (read must be 1-2 short sentences — the consequence for the client; an answer the run cannot ground is omitted, never faked)`);
    if (a.token != null && !FOUR_ANSWER_TOKENS[key].includes(a.token))
      throw new Error(`findings_four_answers_token_invalid:${key}.${short(a.token)} (token, when present, must be EXACTLY one of: ${FOUR_ANSWER_TOKENS[key].join(" / ")})`);
    if (a.basis != null && !(typeof a.basis === "string" && a.basis.trim()))
      throw new Error(`findings_four_answers_basis_invalid:${key} (basis, when present, must be a non-empty string naming what the answer rests on)`);
    if (a.ordinals != null && !(Array.isArray(a.ordinals) && a.ordinals.every((n) => Number.isInteger(n) && n >= 1)))
      throw new Error(`findings_four_answers_ordinals_invalid:${key} (ordinals, when present, must be an array of integer finding ordinals)`);
    if (a.obstacles != null) {
      if (key !== "registrability")
        throw new Error(`findings_four_answers_key_unknown:${key}.obstacles (obstacles rows belong on registrability only)`);
      if (!Array.isArray(a.obstacles)) throw new Error("findings_four_answers_invalid:registrability (obstacles must be a JSON ARRAY of { class, note } rows)");
      for (const r of a.obstacles) {
        if (!isPlainObject(r)) throw new Error("findings_four_answers_invalid:registrability (each obstacles row must be a plain object { class, note })");
        onlyKeys(r, ASSESSMENT_CLASS_ROW_KEYS, (k) => `findings_four_answers_key_unknown:registrability.obstacles.${short(k)}`);
        if ((typeof r.class !== "string" && typeof r.class !== "number") || !String(r.class).trim())
          throw new Error("findings_four_answers_invalid:registrability (obstacles rows need a non-empty class)");
        if (typeof r.note !== "string" || !r.note.trim())
          throw new Error("findings_four_answers_invalid:registrability (obstacles rows need a non-empty note)");
      }
    }
  }
  return fa;
}

// doc 50 — the v4 band field. Required for rated dispositions, forbidden on off-field (the unrated
// commercial-awareness home), tolerated on withdrawn (forensic record). With a manifest the word must be
// one of the framework's, normalised in place to its casing (every downstream surface then prints the
// deck's own word). Without a manifest (offline/unit paths) shape-only: non-empty, never numeric.
function validateBand(f, ord, mode) {
  // — `mode` replaced the bare `manifest` argument so validateNet can reach the version ladder from
  // here; the manifest is read off it. Both call sites are inside this module.
  const manifest = mode?.manifest ?? null;
  if (f.band == null) {
    if (BAND_REQUIRED_DISPOSITIONS.includes(f.disposition))
      throw new Error(`finding_band_missing:${ord} (a ${f.disposition} finding is a RATED conflict — band must be EXACTLY one of the framework's band words)`);
    // still checked on the unrated path: a declaration about two bands, on a finding that has no band,
    // is the one shape the field must never be allowed to take (item 10). `net` is checked here too —
    // an off-field awareness item carries the sentence like any other card.
    validateBorderlineBetween(f, ord, manifest);
    validateNet(f, ord, mode);
    return;
  }
  if (f.disposition === "off-field")
    throw new Error(`finding_band_forbidden:${ord} (off-field means NOT a rated conflict — commercial awareness carries no band; drop the band or change the disposition)`);
  if (typeof f.band !== "string" || !f.band.trim() || /\d/.test(f.band))
    throw new Error(`finding_band_invalid:${short(f.band)} (band must be the framework's band WORD — never a number or code)`);
  if (manifest) {
    const canonical = normalizeBand(manifest, f.band);
    if (!canonical)
      throw new Error(`finding_band_invalid:${short(f.band)} (this run's framework "${manifest.framework_key}" rates in EXACTLY these words: ${manifest.bands.map((b) => b.label).join(" / ")})`);
    f.band = canonical;
  }
  validateBorderlineBetween(f, ord, manifest);
  validateNet(f, ord, mode);
}

// ── item 10 — the band DECLARATION, and deliberately not a band criterion ─────────────────────────────
//
// The rule this implements: where the framework's OWN criteria do not cleanly decide between two of its
// bands for a conflict, the finding says so instead of silently picking one. It is the same discipline
// gave placement's promotion question, one level up — and it is emphatically NOT a rule for deciding
// between two bands. Writing a question that decides Very High from High would overwrite the customer's
// own rating doctrine with ours, which is the rules-engine failure in its most damaging form because it
// would look like consistency.
//
// TWO-VALUED, not a boolean. Placement's `borderline` is a bool because headline/sheet-2 is binary; a band
// ladder is not, so the declaration has to name WHICH TWO bands it sits between or it says nothing a
// reader or a later run can act on.
//
// `band` STAYS MANDATORY. The declaration never replaces the answer — the finding still gives its best
// band, and that band must be one of the two named, otherwise the declaration is about some other
// judgment than the one that was made.
//
// INTERNAL. `driver/publish/report-data.mjs` projects findings through a strict named whitelist with no
// object spread anywhere in driver/publish/, so this field cannot reach the client cut unless someone
// deliberately adds it — checked, not assumed. See BAND_BORDERLINE_NOTE (stages.mjs) for the rule that
// travels with the field into every prompt that names it.
// ── item 9a — THE ONE-CLAUSE NET, as a typed field ───────────────────────────────────────────────────
//
// It is the only ALWAYS-VISIBLE per-finding sentence: the report card leads with it and the MCP brief
// lists it, and until now each surface authored its own version of the same finding — the card parsed a
// `- one:` line out of model markdown, the brief re-read that same line, and anything else that needed
// the sentence would have had to write a third. Two surfaces separately summarising one finding is how
// they end up disagreeing about it.
//
// So it is written ONCE, in synthesis, beside the finding it is about — and rendered everywhere.
//
// FINISHED THE JOB. Item 9a typed the field and pointed two of three surfaces at it, but report.md
// kept authoring its own `- one:` line AND a third condensation under `### The read`. Both are deleted:
// the report-card stage no longer writes either, and assembleReportMd STAMPS `- net:` from this field.
// The field is therefore REQUIRED at v6 (validateNetRequired) — with nothing else authoring a summary,
// an absent net is a finding with no sentence anywhere, not a card that degrades gracefully.
//
// IT STAYS MODEL-WRITTEN, and it must. This is a judgment sentence: which fact conditions the risk is
// exactly the thing a lawyer is paid to pick. Nothing here composes it, and nothing here shortens it.
//
// THREE CONSTRAINTS, and they are the reason it is typed rather than free:
//   · FACTS AND ASSESSMENT, NEVER AN ACTION PRESCRIPTION. The reader is a lawyer who layers their own
//     advice on top. The house prose contract already rules prescriptions out everywhere; on this field
//     it is checked, because it is the sentence most likely to drift into advice.
//   · A CONCLUSION, NEVER A CHAIN (, 2026-08-06). See validateNetShape below for the ruling, the two
//     mechanical markers it refuses, and why it is the one net rule that had to be version-gated.
//   · STILL NO LENGTH MAXIMUM, and now for a second reason. It never came from the validator (a model
//     told to be brief writes a shorter sentence and drops a fact), and build 1.3 deletes the renderer's
//     240-character fold that used to stand in its place. The conclusion contract is what bounds the
//     sentence now: a conclusion is short because it is a conclusion. Nothing here counts characters.
const PRESCRIPTION_RE = /\b(we recommend|we advise|we suggest|you should|should be (?:filed|sought|obtained|considered)|it would be prudent|consider (?:filing|seeking|obtaining|adopting|re-?branding)|the (?:practical|realistic|sensible) path is|next steps?:)\b/i;

// ── — the chain markers, and why they are the ONLY thing this gate looks at ───────────────────────
//
// synthesis-rules.md § "The finding sentence" used to MANDATE a semicolon-chained rights → facts →
// consequence sentence with "No length cap … folding is the renderer's problem", and render.mjs then
// folded it at 240 characters. On a real crowded run 13 of 13 published summaries opened "The legal risk
// is …" and ran 158-261 characters, and the longest folded mid-thought. No cap value repairs a source
// whose sentences are unfoldable by construction, so the ruling (2026-08-06) changed the SOURCE: one
// sentence, a conclusion answering "is this a problem for me", and the reasoning relocates — whole — to
// legal_position / practical_position.
//
// TWO MARKERS, BOTH PUNCTUATION, AND NOTHING ELSE. A semicolon and an arrow are the two things the
// retired contract required BY NAME, so their presence is a mechanical statement that the sentence is
// still built to the old shape. That is the whole test.
//
//   · NOT A LENGTH. This gate REPLACED a character cap —  deleted render.mjs's NET_BUDGET fold on
//     2026-08-06. A gate that counted characters would be the same cap wearing a gate's clothes, and it
//     would earn the same defect: a model told to be brief writes a shorter sentence and drops a fact.
//   · NOT A QUALITY JUDGMENT. "Does this read as a conclusion" is the lawyer's call and the reviewer
//     stage's; code cannot make it without re-judging the finding, which is the rules-engine failure
//     this codebase keeps refusing.
//   · NOT THE WORD "so". 's prose names "a semicolon, an arrow, or the word so", but a word match is
//     not mechanical: it fires on "also", "so-called", "so long as the owner". Punctuation cannot be
//     mistaken for anything else, and the prose rule survives in synthesis-rules.md where a reader
//     applies judgment to it.
//
// WHY EVERY SEMICOLON, RATHER THAN A CHAIN PATTERN. Under the new contract a net names the parties, the
// territory and the outcome; goods are paraphrased to the worst overlap, never quoted, so the one honest
// reason to semicolon-list inside this field is gone with the chain that required it. A sentence that
// still wants one is the chain, and its clauses belong in the positions.
//
// ASCII "->" counts with "→". The retired contract wrote the arrow as U+2192, but a model reproducing
// the shape from habit types either, and a gate that saw only one of them would read a chain as a pass.
const NET_ARROW_RE = /→|->/;
const NET_SEMICOLON_RE = /;/;
/**
 * — the mechanical chain markers present in a finding sentence, as stable tokens. ONE definition,
 * two callers: the parser throw below and predelivery-lint's `net-conclusion-form` row, which judges the
 * same field on the paths a version-gated throw cannot reach. Returns [] for a clean conclusion. PURE.
 */
export function netChainMarkers(s) {
  const str = String(s ?? "");
  const out = [];
  if (NET_SEMICOLON_RE.test(str)) out.push("semicolon");
  if (NET_ARROW_RE.test(str)) out.push("arrow");
  return out;
}

// SHAPE only. PRESENCE is validateNetRequired's (v6,) — split so an archived v4/v5 record, which
// legitimately predates the field, still parses clean here.
function validateNet(f, ord, mode) {
  if (f.net == null) return;   // absent ⇒ v6 has already thrown; below v6 the card falls back as it always did
  if (typeof f.net !== "string" || !f.net.trim())
    throw new Error(`finding_net_invalid:${ord} (net is the one-clause read — a non-empty string, or omit it)`);
  if (PRESCRIPTION_RE.test(f.net))
    throw new Error(`finding_net_prescriptive:${ord} (the one-clause read carries FACTS AND ASSESSMENT, never an action prescription — the reader is a lawyer who layers their own advice on top; state the risk and the fact that conditions it, and let the typed actions register carry what a human must do)`);
  validateNetShape(f, ord, mode);
  f.net = f.net.trim();
}

// ── — the conclusion contract, and why it is the ONE net rule that had to be version-gated ────────
//
// PRESCRIPTION_RE above is deliberately version-FREE: a prescriptive net was forbidden at every version,
// so applying it to an archived record can only find a defect that was always a defect. This rule is the
// opposite shape. Until 2026-08-06 the chain was MANDATED — every archived v4/v5/v6 net was written to
// produce exactly the punctuation this refuses. Ungated, it would throw on the archive-republish path
// (publish/index.mjs strict-parses the archived findings.json), and a delivered matter would stop
// republishing. So it engages at v7 and archived records parse byte-identically, forever.
//
// THE LENIENT PATH IS EXEMPT, for validateNetRequired's reason (/) and one of its own. Dropping a
// finding because its sentence is shaped wrong would delete a real conflict over a punctuation mark —
// silence arrived at by enforcing a rule about clarity. It also keeps the token out of pipeline.mjs's A3
// per-finding salvage lane, which has nothing to salvage here (see the token's own note below).
//
// WHY A THROW AND NOT A FLAG — unchanged from /: this is a synthesis-time contract miss, so it
// rides the CORRECTIVE RETRY LADDER and gets repaired long before delivery. The lint keeps a
// version-independent twin (`net-conclusion-form`) for the two paths a throw cannot reach: the
// lenient/quarantine parse, and a down-level schema_version that would disengage this gate silently.
//
// ── THE TOKEN IS PLURAL, AND THAT IS NOT THE USUAL CONVENTION ─────────────────────────────────────────
// This file's header says `findings_` = a top-level shape defect, `finding_` = a specific finding/field,
// and by that rule this token would be `finding_net_chained` alongside finding_net_missing /
// finding_net_invalid / finding_net_prescriptive. It is `findings_net_chained` instead, because the
// convention is about ROUTING and routing disagrees. pipeline.mjs:3161 reads:
//
//     const eligible = /^invalid_file:/.test(fail) && /:finding_[a-z]/.test(fail) && !/:findings_/.test(fail);
//
// A SINGULAR token enrols in quarantineSynth's A3 lane, whose salvage is driven by
// parseFindingsJsonLenient's quarantined[] — and the lenient path is exempt from this rule, so that array
// is EMPTY. The lane would run its lenient re-parse, find nothing to name in the re-emit, and fall
// straight through to a terminal StageFailure carrying the raw token: per-finding salvage machinery with
// nothing to salvage, reached after the whole ladder has already burned. The plural family is explicitly
// excluded by that `!/:findings_/` clause, so the normal corrective ladder handles it instead.
//
// The name also has to satisfy the two conditions the gateway imposes, both verified in
// findings-gate-token.test.mjs rather than assumed:
//   · lowercase-and-underscore after the prefix, or gateway.mjs:2833's WARM_ELIGIBLE_RE
//     (`findings?_[a-z_]+`) does not admit it and the failure goes cold instead of warm;
//   · no `coverage_ledger` / `coverage_axis` / `coverage_key` / `coverage_mirror` /
//     `coverage_status_invalid` substring, because repairSiblingName's ternary tests `coverage_*` BEFORE
//     `findings?_` and would aim the repair turn at register-coverage-ledger.json — forbidding the model
//     to rewrite the only file that could fix it.
// It reaches the wire as a validator `reason` (verify.mjs checkFindingsSibling), which is the only shape
// gateway.mjs:525 mints as `invalid_file:<path>:<token>`; a bespoke throw would match nothing.
// The precedent is one line up the file: findings_mark_assessment_* was named plural for the same
// routing reason.
//
// THE EXEMPTIONS ARE THE SAME TWO AS ITS SIBLINGS, and they are shared through the same const so the
// three gates cannot drift apart — validatePositionsRequired and validateNetRequired open on this exact
// pair, and so does the lint row that mirrors this one. Each earns it twice over:
//   · withdrawn — a review-killed finding renders NOWHERE ( A1), so it has no surface to carry a
//     badly-shaped sentence on. The second reason is the one recorded in POSITION_REQUIRED_DISPOSITIONS'
//     doc block and it is the sharper one: judging content on a withdrawn finding means THE CORRECTIVE
//     PASS CAN NO LONGER KILL ONE. The killer sets disposition:"withdrawn" and re-saves, the file is
//     re-validated, and the model would have to repair the punctuation of a sentence it is deleting —
//     over a `net` written under the chain contract that was mandatory when the finding was authored.
//   · ruled_out — it renders in the quiet "Also considered — ruled out" list off `ruled_out_reason`,
//     never off `net`. Judging a sentence no reader is shown is a gate with no reader behind it.
function validateNetShape(f, ord, mode) {
  if (!mode?.v7 || mode.lenient) return;
  if (f.ruled_out === true) return;                                      // its ground is ruled_out_reason
  if (!POSITION_REQUIRED_DISPOSITIONS.includes(f.disposition)) return;   // withdrawn — see above
  const markers = netChainMarkers(f.net);
  if (!markers.length) return;
  throw new Error(`findings_net_chained:${ord} (the finding sentence is a CONCLUSION, not a chain — this net carries ${markers.join(" and ")}. Answer the one question a reader asks of this finding: is this a problem for me. Name the parties and the territory and state the outcome as a likelihood ("Veltra Labs' registered VELTRA is more likely than not to prevail against VELTRA PHARMA in the United States."). Then MOVE the chain's clauses — territories, the goods paraphrase, the owner's business, status and use history — into legal_position and practical_position, in full: this is a relocation, never a compression, and a net that got shorter because the reasoning got thinner is the wrong fix. There is no length cap)`);
}

function validateBorderlineBetween(f, ord, manifest) {
  const v = f.borderline_between;
  if (v == null) return;   // absent means "the framework's criteria decided this cleanly" — the common case
  if (!Array.isArray(v) || v.length !== 2)
    throw new Error(`finding_borderline_between_invalid:${ord} (borderline_between declares WHICH TWO bands the framework's criteria do not decide between — exactly two band words, or omit it)`);
  if (v.some((b) => typeof b !== "string" || !b.trim()))
    throw new Error(`finding_borderline_between_invalid:${ord} (both entries must be band WORDS, exactly as the framework writes them)`);
  if (f.band == null)
    throw new Error(`finding_borderline_between_unrated:${ord} (only a RATED finding can sit between two bands — an off-field awareness item carries no band and no declaration)`);
  if (manifest) {
    const canon = v.map((b) => normalizeBand(manifest, b));
    if (canon.some((b) => !b))
      throw new Error(`finding_borderline_between_invalid:${ord} (this run's framework "${manifest.framework_key}" rates in EXACTLY these words: ${manifest.bands.map((b) => b.label).join(" / ")})`);
    if (canon[0] === canon[1])
      throw new Error(`finding_borderline_between_invalid:${ord} (the two bands must be DIFFERENT — a band is not borderline with itself)`);
    if (!canon.includes(f.band))
      throw new Error(`finding_borderline_between_mismatch:${ord} (the declared band "${f.band}" must be ONE of the two it sits between (${canon.join(" / ")}) — the declaration is about the judgment actually made, never about a third band)`);
    f.borderline_between = canon;   // normalise to the deck's own casing, like band itself
  } else if (String(v[0]).trim().toLowerCase() === String(v[1]).trim().toLowerCase()) {
    throw new Error(`finding_borderline_between_invalid:${ord} (the two bands must be DIFFERENT — a band is not borderline with itself)`);
  }
}

/**
 * The findings that declared themselves borderline between two bands — the internal routing/measurement
 * surface, count and marks only. Its first consumer is the round's own revert criterion: "a record the
 * criterion decides clearly" is only a meaningful phrase once the records it does NOT decide are marked
 * as such.
 */
export function bandBorderlineDeclarations(findings) {
  return (findings ?? []).filter((f) => f && Array.isArray(f.borderline_between) && f.borderline_between.length === 2);
}

// ── requirement 3 — reasoned negatives grouped by the ground they share ───────────────────────────
//
// THE READING SHAPE. A reader working through eight negatives one card at a time re-reads the same
// clearing argument eight times, because each card re-derives it. Grouped, the shared ground is stated
// ONCE in the heading, and each member carries only what is its own: its jurisdictions, its goods, its
// specific reason. Three words where the reason repeats; never a re-derivation.
//
// THE GROUND IS TYPED, NOT GUESSED. The key comes from fields the author declared — `disposition`,
// `off_field_ground`, `manageable.category` — so two findings share a heading only where the record says
// they share a ground. Nothing here reads prose, and nothing infers a ground from one.
//
// STRUCTURE HERE, PROSE ELSEWHERE. This returns the grouping and the ground's short label; the
// SHAPE of a member line — the goods paraphrase, the three-word repeat — is the prose standard's, and it
// is written by the model into `net`, not composed here.
//
// ZERO IS NOT ABSENCE. The return always carries `total` and a `groups` array, so a caller can tell
// "grouped, and there were none" (total 0) from "never grouped" (no call / null). An empty group is
// unrepresentable: groups are built FROM members, so a heading with nothing under it cannot be produced.
const NEGATIVE_DISPOSITIONS = ["coexistence-partner", "distinguished", "off-field"];
const GROUND_ORDER = ["distinguished", "coexistence-partner", "off-field:different-field", "off-field:no-material-risk", "off-field:unstated"];
const GROUND_LABEL = {
  distinguished: "distinguished on the mark itself",
  "coexistence-partner": "coexistence or a partner relationship on the record",
  "off-field:different-field": "the same name in a different commercial field",
  "off-field:no-material-risk": "clearly won — no material risk on the record",
  // an archived v5 off-field finding predates off_field_ground. Named as unstated rather than folded
  // into the field claim: assuming the ground is how "not in our field" got said about a mark that was.
  "off-field:unstated": "ground not stated on the record",
};
/** The typed ground key for ONE finding, or null when it is not a reasoned negative. PURE. */
export function reasonedNegativeGround(f) {
  if (!f || !NEGATIVE_DISPOSITIONS.includes(f.disposition) || f.ruled_out === true) return null;
  if (f.disposition !== "off-field") return f.disposition;
  return `off-field:${OFF_FIELD_GROUNDS.includes(f.off_field_ground) ? f.off_field_ground : "unstated"}`;
}
/**
 * Group the LIVE reasoned negatives by the ground they share. Member order is the caller's (the render
 * passes them already sorted by blocking power); group order is GROUND_ORDER. PURE.
 * @returns {{ total: number, groups: Array<{ key: string, ground: string, disposition: string, findings: object[] }> }}
 */
export function reasonedNegativeGroups(findings) {
  const by = new Map();
  for (const f of findings ?? []) {
    if (!f || f.disposition === "withdrawn") continue;
    const key = reasonedNegativeGround(f);
    if (!key) continue;
    if (!by.has(key)) by.set(key, { key, ground: GROUND_LABEL[key] ?? key, disposition: f.disposition, findings: [] });
    by.get(key).findings.push(f);
  }
  const groups = [...by.values()].sort((a, b) => GROUND_ORDER.indexOf(a.key) - GROUND_ORDER.indexOf(b.key));
  return { total: groups.reduce((n, g) => n + g.findings.length, 0), groups };
}

/**
 * — A RECORD URL MUST NAME A HOST THE ACTIVE PROVIDER DECLARES.
 *
 * The URL column is model-written and the driver passes it through verbatim — `audit-from-spine.mjs`,
 * `xlsx.mjs` and `render.mjs` all forward the value untouched, and nothing composed or checked it. So a
 * run against clarivate could deliver `https://tm.corsearch.com/mark/...` links, to a register it never
 * searched, and the only thing that would ever notice is a lawyer clicking a dead one.
 *
 * `origins` is the allow-list from driver.config's recordOriginsFor(), which resolves a composite
 * through its members. Three cases, and the third is the one to read twice:
 *
 *   null       the gate is INACTIVE — the caller did not supply origins. Offline unit paths and replay
 *              parse findings with no provider in hand, and refusing there would fail archived runs on a
 *              fact about today's deployment. verify.mjs supplies them on the live path.
 *   [...]      an absolute URL must match one of these origins.
 *   []         this provider publishes NO per-record page (clarivate, signa). An absolute record URL is
 *              therefore never legitimate — cite the office register. Not the same as "no opinion".
 *
 * RELATIVE VALUES PASS. `uri` is canonically a `/mark/<cc>/<number>` path fragment, and that is the
 * record identity this system stores; only something that parses as an absolute http(s) URL is making a
 * host claim worth checking.
 */
function recordUrlOrigin(value) {
  const s = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return null;          // a path fragment claims no host
  try { return new URL(s).origin; } catch { return null; }
}

/**
 * A register `resolved_link` that is PRESENT but is not a link. PURE.
 *
 *. `checkRecordUrlHost` asks whether a link points at the wrong register, and `recordUrlOrigin`
 * returns null for anything with no host — so the host gate returns CLEAN for `#`. That is right for its
 * own purpose and it means nothing in the findings path was asking whether the link is a link. A value of
 * `#` then composes `- Source: [EUIPO · 018575624](#)` — the delivered R5 shape is about, byte for
 * byte, reached through a path nothing rejected.
 *
 * ABSENT IS NOT DEAD, and the distinction is the whole predicate. `null` and `""` are the sanctioned way
 * to say "this provider publishes no per-record page" — validateSource documents `""` in its own message
 * and renderSourceBullet composes nothing for it. Rejecting those would break the legitimate case this
 * issue exists to protect. Anything else that is not an http(s) URL is a value a seat typed in place of a
 * link: `#`, `#details/trademarks/018575624`, a bare path, or whitespace that only looks like a value.
 *
 * IT ENUMERATES RATHER THAN ASKING "IS THIS AN http(s) URL", and a shipped test is why. ` an
 * unparseable or non-http value is not a host claim and is left to the shape rules` deliberately ACCEPTS
 * `"not a url"` and `mailto:…` at this site — a documented decision that the host gate does not judge
 * them. A blanket not-a-URL rule refutes it silently. So this refuses exactly the shapes names:
 * a fragment (addresses THIS document, never a record), a bare path (names no host), and whitespace
 * (a value that is only shaped like one). Anything else is still 's to rule on.
 *
 * That leaves `mailto:…` and free text composing a live-but-wrong href rather than a dead anchor. It is
 * a real gap and it is NOT this issue's class; recorded on rather than widened into here.
 */
export function isDeadRecordLink(value) {
  if (value == null) return false;
  const s = String(value);
  if (s === "") return false;
  const t = s.trim();
  return t === "" || t.startsWith("#") || t.startsWith("/");
}

function checkRecordUrlHost(value, origins, ord, what) {
  if (origins == null) return;                        // gate inactive — see the header
  const origin = recordUrlOrigin(value);
  if (origin == null) return;
  if (origins.includes(origin)) return;
  throw new Error(
    `finding_record_url_foreign_host:${ord} (${what} points at ${origin}, which is not a register this run searched — `
    + (origins.length
      ? `this provider's record host is ${origins.join(" or ")}. Compose the URL from the record's own uri and THIS provider's base host, per providers/<name>.md.`
      : "this provider publishes no per-record page at all — cite the office register in the text and leave the URL as the record's own uri path.")
    + ")",
  );
}

function validateOwner(owner, ord, origins = null) {
  if (!isPlainObject(owner)) throw new Error(`finding_owner_invalid:${ord} (owner must be an object { name, country, registrations })`);
  onlyKeys(owner, OWNER_KEYS, (k) => `finding_owner_key_unknown:${short(k)}`);
  if (typeof owner.name !== "string" || !owner.name.trim()) throw new Error(`finding_owner_invalid:${ord} (owner.name must be a non-empty string)`);
  for (const k of ["nameRaw", "nameNative"]) {
    if (owner[k] != null && typeof owner[k] !== "string") throw new Error(`finding_owner_invalid:${ord} (owner.${k} must be a string)`);
  }
  if (owner.country != null && typeof owner.country !== "string") throw new Error(`finding_owner_invalid:${ord} (owner.country must be a string)`);
  // A3 — the list that stops registrations transposing. May be EMPTY (a common-law finding has none),
  // but every entry is a distinct registration with its own facts.
  const regs = owner.registrations ?? [];
  if (!Array.isArray(regs)) throw new Error(`finding_registration_invalid:${ord} (owner.registrations must be an array)`);
  for (const r of regs) {
    if (!isPlainObject(r)) throw new Error(`finding_registration_invalid:${ord} (each registration must be a plain object)`);
    onlyKeys(r, REGISTRATION_KEYS, (k) => `finding_registration_key_unknown:${short(k)}`);
    if (typeof r.uri !== "string" || !r.uri.trim()) throw new Error(`finding_registration_invalid:${short(r.uri)} (registration.uri must be a non-empty string)`);
    checkRecordUrlHost(r.uri, origins, ord, `registration.uri "${short(r.uri)}"`);
    if (r.classes != null && !(Array.isArray(r.classes) && r.classes.every((c) => typeof c === "string")))
      throw new Error(`finding_registration_invalid:${short(r.uri)} (registration.classes must be an array of strings)`);
  }
}

function validateMeters(meters) {
  if (!isPlainObject(meters)) throw new Error("finding_meter_unknown:(meters must be an object of the four meters)");
  onlyKeys(meters, METERS, (k) => `finding_meter_unknown:${short(k)}`);
  for (const m of METERS) {
    const entry = meters[m];
    // — THIS MESSAGE USED TO ORDER THE TOKEN THAT KILLS THE RUN. It read "use the \"unknown\" token
    // when there is no signal" for ALL FOUR meters, and two of them have no such token: mark_similarity
    // and goods_proximity are high|medium|low, closed. A model reaching for the honest word on an
    // indeterminate meter was being told to by the validator itself. It names each meter's own set now.
    if (entry == null) throw new Error(`finding_meter_missing:${m} (all four meters must be present; ${m} is one of: ${METER_TOKENS[m].join(", ")}${METER_TOKENS[m].includes("unknown") ? "" : ` — it has NO indeterminate value, so pick the closest band and state the uncertainty in the finding's own prose`})`);
    if (!isPlainObject(entry)) throw new Error(`finding_meter_token_invalid:${m}:${short(entry)} (each meter is { token, basis })`);
    onlyKeys(entry, METER_ENTRY_KEYS, (k) => `finding_meter_unknown:${m}.${short(k)}`);
    // — the closed set stated POSITIVELY is what produced the failure it is reporting. R2 lost 654
    // seconds of opus on the serial critical path to `goods_proximity:"unknown"`, and the retry that
    // fixed it was a 50-second warm patch: the analysis was never in question, one word was. A meter with
    // no indeterminate value says so, and says what to do instead — this is the message the retry reads.
    if (!METER_TOKENS[m].includes(entry.token))
      throw new Error(`finding_meter_token_invalid:${m}:${short(entry.token)} (must be one of: ${METER_TOKENS[m].join(", ")}${METER_TOKENS[m].includes("unknown") ? "" : `. ${m} has NO indeterminate value: never write "unknown", "n/a", "unclear", "tbd" or "none" here. Where it is genuinely indeterminate, pick the closest band — "medium" is the honest middle — and say in that finding's own reason/prose why the record leaves it open`})`);
    if (!BASIS_VALUES.includes(entry.basis))
      throw new Error(`finding_basis_invalid:${m}:${short(entry.basis)} (basis must be one of: ${BASIS_VALUES.join(", ")})`);
    // A4 — source is OPTIONAL (v2 immune) but when present it is a string (a /mark/… record
    // URI or an http(s) URL); the non-empty gate for v3 verified meters lives in verify.mjs.
    if (entry.source != null && typeof entry.source !== "string")
      throw new Error(`finding_meter_source_invalid:${m}:${short(entry.source)} (meter source, when present, must be a string — a record URI or URL)`);
  }
}

function validateQuadrant(q) {
  if (!isPlainObject(q)) throw new Error("finding_quadrant_invalid:(quadrant must be { x, y })");
  onlyKeys(q, QUADRANT_KEYS, (k) => `finding_quadrant_invalid:${short(k)}`);
  for (const axis of QUADRANT_KEYS) {
    const v = q[axis];
    if (typeof v !== "number" || Number.isNaN(v) || v < 0 || v > 1)
      throw new Error(`finding_quadrant_invalid:${axis}=${short(v)} (x and y must be numbers in [0,1])`);
  }
}

function validateSource(source, ord, origins = null) {
  if (!isPlainObject(source)) throw new Error(`finding_source_invalid:${ord} (source must be { source_type, resolved_link })`);
  onlyKeys(source, SOURCE_KEYS, (k) => `finding_source_key_unknown:${short(k)}`);
  if (!SOURCE_TYPES.includes(source.source_type))
    throw new Error(`finding_source_type_invalid:${short(source.source_type)} (source_type must be one of: ${SOURCE_TYPES.join(", ")})`);
  if (source.resolved_link != null && typeof source.resolved_link !== "string")
    throw new Error(`finding_source_invalid:${ord} (source.resolved_link must be a string — the link ACTUALLY fetched, or "")`);
  // Only the REGISTER-sourced link is a record URL. A common-law finding's resolved_link is a marketplace
  // or a company site by definition, and refusing those would be the gate misreading its own subject.
  if (String(source.source_type ?? "").startsWith("register")) {
    // ITS OWN REASON, never folded into the foreign-host message: that one tells a seat to fix a host,
    // and a value with no host at all does not have the problem it describes.
    if (isDeadRecordLink(source.resolved_link))
      throw new Error(
        `finding_record_url_not_a_link:${ord} (source.resolved_link is ${short(source.resolved_link)}, `
        + "which is not a link — a fragment, a bare path or whitespace cannot be fetched and composes a "
        + "dead anchor in the report. Give the record's real URL, or — if this provider publishes no "
        + 'per-record page — leave it "" and cite the office register in the text.)',
      );
    checkRecordUrlHost(source.resolved_link, origins, ord, "source.resolved_link");
  }
}

function validateCoverage(c) {
  if (!isPlainObject(c)) throw new Error("findings_coverage_invalid: each coverage area must be a plain object { area, state, note }");
  onlyKeys(c, COVERAGE_KEYS, (k) => `findings_coverage_key_unknown:${short(k)}`);
  if (typeof c.area !== "string" || !c.area.trim()) throw new Error("findings_coverage_invalid: coverage.area must be a non-empty string");
  // CHANGE 5d — normalize THEN validate the controlled vocabulary: trim + lowercase a near-miss token
  // ("Confirmed-Clean", " open ", "NOT-SEARCHED") so a cosmetic case/whitespace slip is REPAIRED in place
  // rather than dropped/failed. The repaired value is written back to c.state, so every downstream surface
  // (render COV_STATE map, the open-items count, the xlsx) keys off the canonical token. A genuinely-unknown
  // token still throws token-FIRST (offending token first) so the corrective ladder can route it.
  if (typeof c.state === "string") {
    const norm = c.state.trim().toLowerCase();
    if (COVERAGE_AREA_STATES.includes(norm)) c.state = norm;
  }
  if (!COVERAGE_AREA_STATES.includes(c.state))
    throw new Error(`findings_coverage_state_invalid:${short(c.state)} (state must be one of: ${COVERAGE_AREA_STATES.join(", ")})`);
  return c;
}

// A1 — a context note (NOT a finding): a knowledge-cited reference kept for diligence (digest.md's "famous
// neighbour is never dropped") that has no fetched register record to ground a finding. Strict SHAPE only,
// offending token FIRST, prefixed `findings_context_note_` so gateway's /findings?_/ corrective branch routes
// it. It carries NO uri/composite/level/meters by construction, so it can never launder an ungrounded mark
// past the F-14 URI guard.
function validateContextNote(n) {
  if (!isPlainObject(n)) throw new Error("findings_context_note_invalid: each context note must be a plain object { type, mark, context }");
  onlyKeys(n, CONTEXT_NOTE_KEYS, (k) => `findings_context_note_key_unknown:${short(k)}`);
  if (!CONTEXT_NOTE_TYPES.includes(n.type))
    throw new Error(`findings_context_note_type_invalid:${short(n.type)} (type must be one of: ${CONTEXT_NOTE_TYPES.join(", ")})`);
  if (typeof n.mark !== "string" || !n.mark.trim()) throw new Error("findings_context_note_invalid: context note mark must be a non-empty string");
  if (n.owner != null && typeof n.owner !== "string") throw new Error("findings_context_note_invalid: context note owner must be a string");
  if (typeof n.context !== "string" || !n.context.trim()) throw new Error("findings_context_note_invalid: context note context must be a non-empty string");
  return n;
}

// ── PR-9 (E9) — deterministic STRING PROJECTIONS for the hash-frozen renderer ─────────────────────────
// The frozen render.mjs consumes mark_assessment as two strings and coverage_judgment.reason as one
// string. The structured v5 forms are projected HERE — pure, deterministic, no IO — so the renderer
// stays untouched and a structured record renders the same sentence every time. The rows themselves
// render in the audit workbook + report-data (both unfrozen); the projection is the READER'S text,
// never a second store.
const endSentence = (s) => {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return /[.!?…]$/.test(t) ? t : `${t}.`;
};
const trimDot = (s) => String(s ?? "").trim().replace(/[.\s]+$/, "");

/** Project ONE mark_assessment field (string passes through; structured object → deterministic prose). PURE. */
export function projectAssessmentField(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (!isPlainObject(v)) return "";
  const parts = [];
  // spec 2026-07-30 §3 — the reader-facing `read` sentence leads the projection (workbook/email/legacy
  // surfaces); the typed rows follow as before.
  if (typeof v.read === "string" && v.read.trim()) parts.push(endSentence(v.read));
  if (typeof v.spectrum === "string" && v.spectrum.trim()) parts.push(endSentence(v.spectrum));
  const pc = Array.isArray(v.per_class) ? v.per_class : [];
  if (pc.length) parts.push(endSentence(`By class: ${pc.map((r) => `Class ${String(r.class).trim()} — ${trimDot(r.note)}`).join("; ")}`));
  const pm = Array.isArray(v.per_market) ? v.per_market : [];
  if (pm.length) parts.push(endSentence(`By market: ${pm.map((r) => `${trimDot(r.market)} — ${trimDot(r.note)}`).join("; ")}`));
  const cr = Array.isArray(v.counter_registrations) ? v.counter_registrations : [];
  if (cr.length) parts.push(endSentence(`Coexisting registrations considered: ${cr.map((r) => {
    const head = [trimDot(r.mark), r.uri ? `(${trimDot(r.uri)})` : ""].filter(Boolean).join(" ") || trimDot(r.uri);
    const tail = [r.owner ? trimDot(r.owner) : "", r.note ? trimDot(r.note) : ""].filter(Boolean).join(" — ");
    return tail ? `${head} — ${tail}` : head;
  }).join("; ")}`));
  if (typeof v.acquired === "string" && v.acquired.trim()) parts.push(endSentence(`Acquired distinctiveness: ${trimDot(v.acquired)}`));
  if (typeof v.note === "string" && v.note.trim()) parts.push(endSentence(v.note));
  return parts.join(" ");
}

/** Project the whole mark_assessment to the { distinctiveness, connotation } STRINGS the frozen renderer reads. PURE. */
export function projectMarkAssessment(ma) {
  if (!isPlainObject(ma)) return ma ?? null;
  const dist = projectAssessmentField(ma.distinctiveness);
  const conn = projectAssessmentField(ma.connotation);
  if (typeof ma.distinctiveness === "string" && typeof ma.connotation === "string") return ma;   // legacy — byte-identical passthrough
  return { distinctiveness: dist, connotation: conn };
}

/**
 * — THE CAP, AND IT IS DERIVED FROM THE DELIVERED CORPUS RATHER THAN PICKED.
 *
 * Row counts across the 17 delivered runs in the pool: 3 5 6 6 6 7 7 8 9 9 10 11 13 13 14 18 — and one
 * run at **1,278**. Swept: a cap of 12 clips five runs; anything at or above 18 clips exactly one, the
 * pathological tail. 24 sits clear of the observed maximum with headroom for a denser matter, and still
 * clips only that one.
 *
 * WHY A CAP AND NOT A REMOVAL: the rows are on the page deliberately ( — the reader's own name for
 * the axis leads, so the paragraph reads as coverage rather than as identifiers), and the staff reader
 * this paragraph is written for wants them. What nobody wants is 1,278 of them welded into one <p>.
 */
export const COVERAGE_JUDGMENT_ROW_CAP = 24;

/**
 * Project coverage_judgment: rows[] fold into the reason string; { sufficient, reason } out. PURE.
 *
 * — THE FOLD USED TO BE UNBOUNDED, and the row count is not a property of the matter: rows are
 * emitted per SEARCH CELL, so a run whose register cannot reach a whole territory emits one per cell.
 * On one delivered run in the pool that was 1,278 rows carrying 108 distinct notes — the register could
 * not reach a whole territory, so it emitted one row per unreachable cell and most of them said the same
 * thing. This function welded them into a single 287,233-character paragraph, **68% of the rendered
 * report.html**, in every byte of that artifact anyone stores, copies or transfers.
 *
 * The overflow is STATED rather than silently dropped, and it names where the rest live: a reader who
 * cannot tell "24 rows" from "24 of 1,278" has been handed the same absence-reads-as-complete this
 * repository keeps paying for.
 */
export function projectCoverageJudgment(cj) {
  if (!isPlainObject(cj)) return cj ?? null;
  const rows = Array.isArray(cj.rows) ? cj.rows : [];
  if (!rows.length) return cj;
  // — the READER's name leads, and falls back to the identifier when the driver had nothing to
  // add. This string is printed on report.html ("Coverage read"), which is why it reads the label.
  const shown = rows.slice(0, COVERAGE_JUDGMENT_ROW_CAP);
  const hidden = rows.length - shown.length;
  const rowText = shown.map((r) => `${trimDot(r.areaLabel || r.area)}: ${trimDot(r.note)}`).join("; ");
  const overflow = hidden
    ? `and ${hidden} further coverage row(s) are not listed here — the complete set is findings.json coverage_judgment.rows`
    : "";
  const reason = [trimDot(cj.reason), rowText, overflow].filter(Boolean).join(" — ");
  return { sufficient: cj.sufficient, reason: endSentence(reason) };
}

/** Project corrections: entries[] fold into the note string; { applied, note } out. PURE. */
export function projectCorrections(c) {
  if (!isPlainObject(c)) return c ?? null;
  const entries = Array.isArray(c.entries) ? c.entries : [];
  if (!entries.length) return c;
  const rowText = entries.map((r) => `${trimDot(r.entity)}: ${trimDot(r.disposition)}${r.note ? ` (${trimDot(r.note)})` : ""}`).join("; ");
  return { applied: c.applied, note: endSentence([trimDot(c.note), rowText].filter(Boolean).join(" — ")) };
}

// ── PR-9 — THE deterministic intake-ask → ask_answers join ────────────────────────────────────────────
// One join, three consumers: the code-built "Answers to your instructions" section (assembleReportMd),
// the intake-ask lint (which now judges the JOIN, not fuzzy surface containment), and report-data.
// Resolution order mirrors joinFindingToBlock: (1) exact normalized equality (synthesis is dictated to
// copy the ask verbatim); (2) majority word-set match (≥60% of the ask's distinctive words, ≥4 chars,
// up to 5 — the same paraphrase tolerance intakeAskChecks always used), but only when UNIQUE.
// Ambiguity → null: an unjoined ask is an honest lint failure, never a guessed answer. PURE.
export function joinAskToAnswer(ask, askAnswers) {
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const entries = (askAnswers ?? []).filter((a) => a && typeof a.ask === "string");
  const askN = norm(ask);
  if (!askN || !entries.length) return null;
  const exact = entries.filter((a) => norm(a.ask) === askN);
  if (exact.length) return exact[0];   // duplicates of a verbatim ask: first entry wins, deterministically
  const words = askN.split(" ").filter((w) => w.length >= 4).slice(0, 5);
  if (!words.length) return null;
  const need = Math.max(1, Math.ceil(words.length * 0.6));
  const fuzzy = entries.filter((a) => {
    const text = ` ${norm(a.ask)} `;
    return words.filter((w) => text.includes(` ${w} `)).length >= need;
  });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

// ── — THE KNOCKOUT TYPED FINDING: the shape, defined here, emitted by the stage build ────────────
//
// THE DEFECT IT CLOSES. The knockout stage writes structured rows with free-prose cells: per name it
// emits `{name, rating, ratingQualifier, classesSearched, classesDriving, degraded, bullets[], findings[]
// {name, type, url, description, impact}}` — and the analysis lives in `bullets[]`, unranked and untyped.
// So `render-knockout.mjs` contains no sort at all: every section renders in input order, conflicts
// appear as written rather than as ranked, and there is no card, no per-conflict verdict and no evidence
// display, because prose is all the stage gives it. Nothing downstream can rank, bucket or display
// evidence for something that has no rank, bucket or typed evidence in it.
//
// WHY THE SHAPE LIVES IN THIS MODULE AND NOT BESIDE THE KNOCKOUT STAGE. Two products, one spine: the
// knockout finding is the clearance finding's triage-weight sibling, and the two must never drift into
// separate answers to "what is a finding". `net` is literally the same field under the same contract and
// the same gate (netChainMarkers), and the band is validated by the same framework.mjs helpers against
// the same frozen manifest. Defining it anywhere else would be the second definition that guarantees the
// drift.
//
// ── THE VERDICT VOCABULARY: THE FRAMEWORK'S BAND WORDS (ruled, 2026-08-06) ───────────────────
// The issue offered a dedicated pair (Blocking / Crowd) as the working default and asked for the
// framework words to be raised first if they could be applied honestly. They can, because THE KNOCKOUT
// REPORT IS ALREADY BAND-RATED — it is only the per-FINDING grain that is not:
//   · skills/knockout-assess/SKILL.md dictates the per-name row as `"rating": "<band word>"` and states
//     "rating must be a band from the frozen ladder";
//   · knockout-findings.json carries `framework: {source, ladder}` at chunk 0, so the frozen ladder
//     travels WITH the artifact and a per-finding word is checkable by normalizeBand, with no new
//     plumbing;
//   · publish/knockout.mjs renders that rating through bandTier(framework, …) already.
// A dedicated pair would therefore put a SECOND rating vocabulary on the SAME page — the per-name row in
// band words, the cards beneath it in Blocking/Crowd — which is the one thing rules out. And
// "Crowd" is a GROUND, not a severity: crowding is a per-market ceiling in this engine (synthesis-rules
// "Volume is not a risk multiplier"), so minting it as a verdict word would make a reason look like a
// rating. A pair hardcoded here would also be OUR doctrine wearing the customer's report, which is what
// doc-50 exists to prevent — the framework is per-customer and frozen per run.
//
// `impact` (HIGH/MEDIUM/LOW, on today's knockout findings) is REPLACED by the band and is absent from
// the key list below. Carrying both would rebuild the two-vocabulary defect inside one record.
// `type` STAYS: it names what a finding IS, not how bad it is, so it is not a rating and does not
// compete with the band.
export const KNOCKOUT_FINDING_TYPES = [
  "Famous Brand", "Active Business", "Cultural Reference", "Domain", "Descriptive Use",
  "Negative Association", "Competitor Intelligence",
];
const KNOCKOUT_FINDING_KEYS = ["ordinal", "name", "owner", "band", "net", "type", "evidence", "basis"];
// The throw family is `knockout_`, NOT `findings_`, and that is deliberate: gateway.mjs's
// repairSiblingName routes every `/findings?_/` token to **findings.json**, which is the clearance
// artifact and does not exist on a knockout run. A knockout token borrowing that family would aim its
// repair turn at a file the stage never writes. `knockout_` matches no branch, so the repair falls
// through to the generic invalid_file arm and targets the stage's own output, which is correct.
// ABSENCE, RECORDED: `knockout_` is in neither WARM_ELIGIBLE_RE nor repairSiblingName on origin/main, so
// a knockout validator failure goes COLD today (verify-knockout.mjs's knockout_url_unreceipted already
// does). Extending them is the stage build's call, not this schema PR's — it changes retry behaviour for
// tokens that already ship.
const kshort = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

/**
 * — validate ONE knockout typed finding. Throws token-first; returns the finding with its band
 * normalised to the manifest's own casing (exactly like the clearance's validateBand).
 *
 * The ordinal it checks here is the AUTHOR'S, and it is checked for shape and uniqueness only —
 * validateKnockoutFindings below overwrites it with the machine's contiguous one. See the ruling there.
 *
 * @param {object} f
 * @param {number} idx — position in the mark's findings[], for the token when there is no usable ordinal.
 * @param {Set<number>} seenOrdinals — per MARK, not per run: one report is one name ( assumes it).
 * @param {{ manifest?: object }} [opts] — the run's frozen framework manifest. Supplied, the band must be
 *   one of its words; absent (offline/unit paths) the band is shape-checked only, as parseFindingsJson does.
 */
export function validateKnockoutFinding(f, idx, seenOrdinals = new Set(), opts = {}) {
  const manifest = opts.manifest ?? null;
  if (!isPlainObject(f)) throw new Error(`knockout_finding_invalid:${idx} (every knockout finding must be a plain object)`);
  onlyKeys(f, KNOCKOUT_FINDING_KEYS, (k) => `knockout_finding_key_unknown:${kshort(k)}`);
  const ord = f.ordinal;
  if (!Number.isInteger(ord) || ord < 1)
    throw new Error(`knockout_finding_ordinal_invalid:${kshort(ord)} (ordinal must be an integer >= 1 — YOUR blocking order for this mark, most blocking first; the machine renumbers 1…N after ranking and your number then breaks ties inside a band)`);
  if (seenOrdinals.has(ord)) throw new Error(`knockout_finding_ordinal_duplicate:${ord} (each finding's ordinal is unique within the mark — two findings sharing one number is a mark you did not rank, and the tie-break inside a band would be arbitrary)`);
  seenOrdinals.add(ord);
  if (typeof f.name !== "string" || !f.name.trim())
    throw new Error(`knockout_finding_name_missing:${ord} (the CONFLICTING name, verbatim as the evidence carries it)`);
  // OWNER IS REQUIRED, AND ITS HONEST NEGATIVE IS A VALUE. synthesis-rules "Common-law source attribution
  // — never confabulate the owner/seller" is the rule this must not break: a required field that cannot
  // be left out is a field a model will invent. So the requirement is that the author SAY something, and
  // "not established on the searched material" is an accepted answer — the same idiom use_check.source
  // uses for "perplexity_research — no result". A blank is refused; a guess is a doctrine breach the
  // parser cannot see, and the prose rule owns that half.
  if (typeof f.owner !== "string" || !f.owner.trim())
    throw new Error(`knockout_finding_owner_missing:${ord} (name the party behind the conflicting name, or say "not established on the searched material" — never guess one: an invented seller/owner is the attribution breach the doctrine forbids)`);
  if (f.type != null && !KNOCKOUT_FINDING_TYPES.includes(f.type))
    throw new Error(`knockout_finding_type_invalid:${kshort(f.type)} (type must be EXACTLY one of: ${KNOCKOUT_FINDING_TYPES.join(" / ")})`);
  // THE VERDICT WORD. Same authority, same helper, same frozen manifest as the clearance — see the ruling
  // above. Numeric or coded values are refused for doc-50's reason: the band is the deck's own WORD.
  if (typeof f.band !== "string" || !f.band.trim() || /\d/.test(f.band))
    throw new Error(`knockout_finding_band_invalid:${kshort(f.band)} (band must be the framework's band WORD — never a number or code; the knockout rates in the same ladder its per-name rows already use)`);
  if (manifest) {
    const canonical = normalizeBand(manifest, f.band);
    if (!canonical)
      throw new Error(`knockout_finding_band_invalid:${kshort(f.band)} (this run's framework "${manifest.framework_key}" rates in EXACTLY these words: ${manifest.bands.map((b) => b.label).join(" / ")})`);
    f.band = canonical;
  }
  // THE CONCLUSION SENTENCE — 's contract, unchanged, on the other product. One rule, one gate: a
  // knockout card and a clearance card are read by the same lawyer in the same week.
  if (typeof f.net !== "string" || !f.net.trim())
    throw new Error(`knockout_finding_net_missing:${ord} (every knockout finding carries the one conclusion sentence the card leads with — see synthesis-rules.md "The finding sentence")`);
  if (PRESCRIPTION_RE.test(f.net))
    throw new Error(`knockout_finding_net_prescriptive:${ord} (the finding sentence carries FACTS AND ASSESSMENT, never an action prescription)`);
  const markers = netChainMarkers(f.net);
  if (markers.length)
    throw new Error(`knockout_finding_net_chained:${ord} (the finding sentence is a CONCLUSION, not a chain — this one carries ${markers.join(" and ")}. Answer "is this a problem for me" in one sentence and put the reasoning in basis, whole and untrimmed)`);
  f.net = f.net.trim();
  // EVIDENCE IS A LIST AND IT IS REQUIRED. "every card must open to its evidence" is the issue's test, and
  // an empty array would let a typed finding assert a conflict with nothing behind it — the exact defect
  // the prose bullets had. verify-knockout.mjs gates cited URLs against the mark's research payload on
  // disk — it reads `evidence[]` AND the prose row's `url`, and it had to be taught the first of those:
  // when this shape landed it still read `url` alone, so every typed finding fell through its loop and
  // the gate returned ok having receipted nothing. Do not read this line as "receipting is handled"
  // without opening that file; the sentence was true of the prose row and false of this record for the
  // length of one merge.
  //
  // WHAT THIS CHECK DOES NOT DO, stated because its own message oversells it: it requires a non-empty
  // array of non-empty strings. It does not check URL shape and it does not check heldness — heldness is
  // verify-knockout's, and it is the only place that can do it, because only the run dir has the payload.
  if (!Array.isArray(f.evidence) || !f.evidence.length)
    throw new Error(`knockout_finding_evidence_missing:${ord} (evidence must be a non-empty ARRAY of URLs actually held for this mark — a typed finding that cannot be opened is the untyped bullet with a shape around it)`);
  for (const u of f.evidence) if (typeof u !== "string" || !u.trim())
    throw new Error(`knockout_finding_evidence_invalid:${ord} (each evidence entry is a non-empty URL string)`);
  // THE BASIS IS WHAT MAKES THE RANK HONEST.: "reject a version that ranks by heuristic at the
  // renderer over prose — the rank must come from the stage's typed basis." The band is the machine key
  // the comparator sorts on; `basis` is the author's ground FOR that band, so a rank can be argued with
  // rather than merely observed. It is the clearance's legal_position/practical_position pair compressed
  // to one field, because a knockout is triage on common-law material, not a clearance.
  if (typeof f.basis !== "string" || !f.basis.trim())
    throw new Error(`knockout_finding_basis_missing:${ord} (state the ground the band rests on — what the evidence shows about use, reach and the owner. The rank is read off the band, so a band with no stated basis is an unarguable ranking)`);
  return f;
}

/**
 * — validate a mark's knockout findings, then RANK AND RENUMBER them. Returns the ranked array
 * ([] is legitimate — a clean mark). Mutates each finding's `ordinal` in place, so a caller that
 * discards the return still gets contiguous numbering; a caller that keeps it also gets the artifact
 * in the order the surfaces print.
 *
 * WHY THE MACHINE WRITES THE ORDINAL (review finding, 2026-08-07). The ordinal is the drill-through
 * key: `<MARK> #<ordinal>` on the report, in the Findings sheet, and — as a RANGE — in the Audit
 * Trail's "Finding Reference". The validator above only ever required an integer >= 1, unique within
 * the mark, and nothing renumbered. Two findings the model numbered 3 and 7 therefore printed as
 * `<MARK> #3–#7` in the trail: a cell asserting FIVE findings where the run held two. "ordinal: 1…N"
 * lived in the prompt and in SKILL.md, and an instruction is not enforcement — a model that skips a
 * number produces a document that lies about its own size, silently, in the one artifact an auditor
 * opens to count. So the model supplies the judgment (which conflict blocks hardest) and the machine
 * supplies the number.
 *
 * RENUMBERED AFTER THE SORT, exactly as consolidateFindings does at :1009 on the clearance side, so
 * #1 is the most blocking conflict and the page reads #1, #2, #3 down the mark. The author's own
 * numbering is not discarded: compareKnockoutBlockingPower ranks on the band first and falls back to
 * the ordinal, so within one band the order the author chose is the order that ships.
 */
export function validateKnockoutFindings(list, opts = {}) {
  if (list == null) return [];
  if (!Array.isArray(list))
    throw new Error("knockout_findings_invalid (findings must be a JSON ARRAY of typed finding objects — a clean mark carries [], never a prose note)");
  const seen = new Set();
  const validated = list.map((f, idx) => validateKnockoutFinding(f, idx, seen, opts));
  const ranked = validated
    .map((f, i) => [f, i])
    .sort((a, b) => compareKnockoutBlockingPower(a[0], b[0], opts.manifest ?? null) || (a[1] - b[1]))
    .map(([f]) => f);
  ranked.forEach((f, i) => { f.ordinal = i + 1; });
  return ranked;
}

/**
 * — rank knockout findings by blocking power: the framework's OWN band order (lower manifest index
 * = more severe), then ordinal for stability. The rank comes from the stage's typed band and nothing
 * else — no keyword pass over prose, no evidence COUNT (volume is not a risk multiplier). A finding whose
 * band the manifest does not know sorts last rather than first, so an unrecognised word can never lead a
 * report. Without a manifest the order is ordinal, i.e. unchanged. PURE.
 */
export function compareKnockoutBlockingPower(a, b, manifest = null) {
  const rank = (f) => {
    if (!manifest || f?.band == null) return Number.MAX_SAFE_INTEGER;
    const i = bandIndex(manifest, f.band);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return (rank(a) - rank(b)) || ((a?.ordinal || 0) - (b?.ordinal || 0));
}

// ── — THE SURFACE VIEW, and the ONE place a delivery surface reads a knockout finding ───────────
//
// KNOCKOUT PROSE ARM 2026-08-06. This function and knockoutCitedUrls (verify-knockout.mjs) are the two
// sites that read BOTH shapes — the typed record above and the prose row `{name, type, url, description,
// impact}` that archived runs still carry into publish/report-registry.mjs's republish. Grep the marker
// to find both; delete the prose halves together, and only once no archived run republishes.
//
// WHY A VIEW RATHER THAN A DUAL READ AT EACH SURFACE. The renderer, the report-data writer and the
// workbook each read the finding, and the defect this build closes is what happens when one of them
// reads a field the shape no longer has: `render-knockout.mjs` filtered on `f.url`, so a typed finding
// was dropped from the client page ENTIRELY and a mark with conflicts rendered as "No adverse signals
// recorded for this name on this screen." Three copies of a dual read is three chances to write that
// filter again. This projection drops nothing: every field of both shapes lands somewhere, and a surface
// that wants less takes less.
//
// It is deliberately NOT a validator and it classifies nothing: `shape` is a stamp for the reader, never
// a branch a gate takes. The gates (verify-knockout.mjs) require the typed record unconditionally — they
// only ever see this run's own fresh stage output, so a shape test there could only ever be a way to
// skip one.
export function knockoutFindingView(f, idx = 0) {
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const evidence = [
    ...(Array.isArray(f?.evidence) ? f.evidence : []),
    ...(f?.url ? [f.url] : []),                      // KNOCKOUT PROSE ARM 2026-08-06
  ].map((u) => String(u ?? "").trim()).filter(Boolean);
  return {
    // The typed record's ordinal is the drill-through key and it is PER MARK. A prose row has none, so
    // its position is the key — which is what the workbook's retired global counter was measuring
    // anyway, one mark at a time.
    ordinal: Number.isInteger(f?.ordinal) && f.ordinal >= 1 ? f.ordinal : idx + 1,
    name: str(f?.name),
    owner: str(f?.owner),
    band: str(f?.band),
    type: str(f?.type),
    // The sentence the card leads with: `net` on the typed record, `description` on the prose row.
    lead: str(f?.net) ?? str(f?.description),        // KNOCKOUT PROSE ARM 2026-08-06
    // The ground under the band. The prose row had none — that absence is the reason `basis` exists.
    detail: str(f?.basis),
    evidence: [...new Set(evidence)],
    // — THE SOURCE CHIP IS DERIVED FROM THIS, so it has to survive the projection.
    // A key the view drops is invisible to every renderer while every arm that tests the MODEL's shape
    // still passes, which is a green suite over an unchanged page.
    weighedFilings: [...new Set((Array.isArray(f?.weighedFilings) ? f.weighedFilings : [])
      .map((r) => String(r ?? "").trim()).filter(Boolean))],
    shape: (f?.net != null || f?.basis != null || Array.isArray(f?.evidence)) ? "typed" : "prose",
  };
}

/**
 * — a mark's findings as ranked views, plus the drill-through key each surface prints.
 *
 * THE KEY IS `<MARK> #<ordinal>`, per mark, and it is the only one. publish/knockout.mjs used to run a
 * GLOBAL counter across the batch for the workbook's "Finding Reference" while the typed record numbered
 * per mark, so the report and the workbook offered a reader two different #3. One key, one story: the
 * report prints it beside every conflict, the workbook's Findings sheet carries it in its own column,
 * and the Audit Trail names the mark's range.
 *
 * The rank is compareKnockoutBlockingPower — the stage's typed band, never a keyword pass over prose.
 * An archived prose row has no band, so it sorts by ordinal, which is its input order: a republished
 * archived report keeps the order it was delivered in.
 */
export function knockoutFindingViews(mark, { manifest = null } = {}) {
  const list = Array.isArray(mark?.findings) ? mark.findings : [];
  const markName = String(mark?.name ?? "").trim();
  return list
    .map((f, i) => [knockoutFindingView(f, i), i])
    .sort((a, b) => compareKnockoutBlockingPower(a[0], b[0], manifest) || (a[1] - b[1]))
    .map(([v]) => ({ ...v, ref: markName ? `${markName} #${v.ordinal}` : `#${v.ordinal}` }));
}

/**
 * — the mark's whole finding block as one drill-through reference ("MARK #1" / "MARK #1–#4").
 *
 * A SPAN IS A COUNT CLAIM, so the numbers it spans have to be contiguous, and they are: the ordinal a
 * typed finding carries is written by validateKnockoutFindings (1…N, at the merged gate, before the
 * artifact is written), and a prose row has no ordinal at all, so the view gives it its position.
 * Derived through knockoutFindingViews rather than re-deriving that fallback here — one projection
 * decides what a finding's number is, and this cell cannot disagree with the sheet it points into.
 */
export function knockoutFindingRange(mark) {
  const ords = knockoutFindingViews(mark).map((v) => v.ordinal).sort((a, b) => a - b);
  const markName = String(mark?.name ?? "").trim();
  if (!ords.length || !markName) return "";
  return ords.length === 1 ? `${markName} #${ords[0]}` : `${markName} #${ords[0]}–#${ords[ords.length - 1]}`;
}
