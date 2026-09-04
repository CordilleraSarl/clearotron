// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// frame-diff-model.mjs — strict parser + pure decision logic for the frame-diff stage
// (frame-omission design, Property 1: the omission detector; Property 2: the reopen channel).
//
// frame-diff reads the blind-frame model (blind-frame-model.json) and what the run ACTUALLY scoped /
// searched (scope-ledger.json + variant-manifest.md + the coverage ledgers), and emits STRUCTURED
// reopen directives — one per layer (variant / field / source) omission worth acting on, each carrying
// the observation that should reopen it and a severity. CODE (not the model) decides which directives
// fire a supplemental sweep and whether the dominant-element gap clamps the verdict — the decision is
// never the model's (the "code gates over prompt prose" rule).
//
// PURE (no node imports) → the decision helpers test offline exactly like envelopeDecision /
// parseEscalationRisk.

import { termPredicateIssue, termShapeIssue } from "../providers/_shared/term-shape.mjs";
import { canonicalJurisdictionCode } from "./jurisdiction-codes.mjs";

export const DIFF_LAYERS = ["variant", "field", "source"];
// dominant-element = an omission ON the spine (always fires + can block a clean finding); material = a
// real omission worth a supplemental sweep; minor = noted, never fires (presentation / already-covered).
export const DIFF_SEVERITIES = ["dominant-element", "material", "minor"];
// the severities that FIRE a supplemental sweep (Property 2). minor is logged, never swept.
export const FIRING_SEVERITIES = ["dominant-element", "material"];

const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const norm = (s) => String(s || "").trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase();
const DIFF_KEYS = ["schema_version", "dominant_element", "directives", "dominant_element_gap"];
// Fix 2 (Part A) — `remedy` is OPTIONAL and structured: {terms[], nice_classes[], regions[]}. It lets a
// source that KNOWS the exact re-search (a field/class-gap naming Cl. 35/38 on the dominant element)
// dictate it to the register mint instead of the mint guessing term:d.item + nice_classes:inScope (the
// RUN1 project-halcyon false-close — the English class LABEL searched as a mark in the matter's OWN
// classes → 0/0 → falsely swept). Absent ⇒ the driver derives one (deriveDirectiveRemedy) or falls back.
const DIRECTIVE_KEYS = ["layer", "item", "observation", "severity", "remedy"];
const REMEDY_KEYS = ["terms", "nice_classes", "regions"];

/**
 * Strict-parse frame-diff.json. Returns `{schema_version, dominant_element, directives[],
 * dominant_element_gap}`. An EMPTY directives[] is valid (a clean diff — the blind model matched the
 * actual scope). Throws on ANY defect, offending token FIRST:
 *   framediff_unparseable | framediff_key_unknown:<key> | framediff_directives_invalid
 *   | framediff_directive_key_unknown:<key> | framediff_layer_invalid:<layer>
 *   | framediff_severity_invalid:<sev> | framediff_gap_invalid
 *   | framediff_directive_undispatchable:<item> | <item> | … (ALL offenders in ONE throw)
 */
export function parseFrameDiff(raw) {
  let m;
  try { m = JSON.parse(raw); }
  catch (e) { throw new Error(`framediff_unparseable: ${short(e.message)}`); }
  if (!m || typeof m !== "object" || Array.isArray(m))
    throw new Error("framediff_unparseable: top level must be a JSON OBJECT");
  for (const k of Object.keys(m)) {
    if (!DIFF_KEYS.includes(k)) throw new Error(`framediff_key_unknown:${short(k)} (keys are EXACTLY: ${DIFF_KEYS.join(", ")})`);
  }
  if (!Array.isArray(m.directives)) throw new Error("framediff_directives_invalid: directives must be a JSON ARRAY (use [] for a clean diff)");
  // ONE throw for ALL of them (2026-07-31 review round — the cardinality half of the ask contract).
  // See undispatchableThrow below: the ladder is 3 attempts, and a per-directive throw spends one of
  // them per directive.
  const undispatchable = [];
  const directives = m.directives.map((d) => {
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("framediff_unparseable: every directive must be a plain object");
    for (const k of Object.keys(d)) {
      if (!DIRECTIVE_KEYS.includes(k)) throw new Error(`framediff_directive_key_unknown:${short(k)} (keys are EXACTLY: ${DIRECTIVE_KEYS.join(", ")})`);
    }
    const layer = String(d.layer ?? "").trim().toLowerCase();
    if (!DIFF_LAYERS.includes(layer)) throw new Error(`framediff_layer_invalid:${short(d.layer)} (not in: ${DIFF_LAYERS.join(", ")})`);
    const severity = String(d.severity ?? "").trim().toLowerCase();
    if (!DIFF_SEVERITIES.includes(severity)) throw new Error(`framediff_severity_invalid:${short(d.severity)} (not in: ${DIFF_SEVERITIES.join(", ")})`);
    const out = { layer, item: String(d.item ?? "").trim(), observation: typeof d.observation === "string" ? d.observation : "", severity };
    if (d.remedy != null) out.remedy = parseRemedy(d.remedy);
    // ── THE ASK CONTRACT AT ASK-RAISE (charter P2e) ───────────────────────────────────────────────
    // A firing directive is a REQUEST TO SEARCH SOMETHING. Until now the parser accepted one whose
    // item was a display label ("TAKIS (famous cpg snack, …)") with no remedy, and the refusal came
    // hours later at reopen — by which time the session that could have restated it had exited. Four
    // of the five directives on the 2026-07-29 run died exactly there: loud (coverage rows, the clamp,
    // the audit trail) but terminal, with the head noun of a perfect one-query term sitting in the
    // label the whole time.
    //
    // So the refusal moves to the seam where a rephrase is still free. The rule is the ask contract in
    // one line: at ask-raise the LABEL must dictate terms + classes. A firing VARIANT directive must
    // be dispatchable — a lint-clean remedy or a mark-shaped item — and if it is not, the parse
    // throws, the stage's own defect-repair retry hands the reason back IN-TURN (the token is
    // warm-eligible), and the proposing session restates it. That is the mint seam's proven rephrase
    // loop (supplemental.mjs rejected[] → re-propose → executed) moved to the frame seat. Field and
    // source directives keep today's behaviour exactly — see directiveUndispatchableReason for why.
    //
    // `minor` is untouched: a minor directive is a DEFENDED DROP, never swept, and nothing dispatches
    // from it. And dispatch-side translation stays forbidden — code still never guesses `term: d.item`
    // (the RUN1 false-close); it demands that the ASKER say what to search.
    //
    // CARDINALITY: every offender is COLLECTED and thrown ONCE (below), never one per parse. A
    // per-directive throw makes the repair ladder count directives instead of attempts — the
    // 2026-07-29 artifact carries four undispatchable firing directives against a 3-attempt ladder,
    // so a compliant model fixing "the one the hint quoted" exhausts the ladder and the whole reopen
    // pass is lost. One throw naming all of them is one corrective turn.
    if (FIRING_SEVERITIES.includes(severity)) {
      const why = directiveUndispatchableReason(out);
      if (why) undispatchable.push({ item: out.item, layer, severity, why });
    }
    return out;
  });
  if (undispatchable.length) throw new Error(undispatchableThrow(undispatchable));
  if (typeof m.dominant_element_gap !== "boolean")
    throw new Error("framediff_gap_invalid: dominant_element_gap must be a JSON boolean");
  return {
    schema_version: m.schema_version ?? 1,
    dominant_element: String(m.dominant_element ?? "").trim(),
    directives,
    dominant_element_gap: m.dominant_element_gap,
  };
}

/**
 * The ONE `framediff_directive_undispatchable` message for a whole artifact's offenders.
 *
 * The message is written for a HARD BUDGET it cannot see: verify.mjs's checkSiblingJson slices a
 * parse error to 160 characters before it becomes the stage's fail string, so nothing past that
 * reaches the gateway hint or the journal. The layout answers that budget:
 *   * the token FIRST (the warm allowlist and every hint branch key on it);
 *   * then the offending ITEMS, pipe-separated and short(), so the first ~3 survive the cut and a
 *     scraper can split them back out;
 *   * then the COUNT and the one-re-save instruction;
 *   * then the per-item reasons, which are the part that gets cut — and which the gateway therefore
 *     re-derives from the artifact ON DISK (frameDiffUndispatchable) rather than from this string.
 * PURE.
 */
export function undispatchableThrow(offenders) {
  const list = (offenders ?? []).map((o) => ({ item: String(o?.item ?? "").trim(), why: String(o?.why ?? "").trim() }));
  const n = list.length;
  const head = [];
  let budget = 120;                                    // leaves room for the token itself inside the 160-char cut
  for (const o of list) {
    const s = short(o.item) || "(unnamed directive)";
    if (head.length && budget - s.length < 0) { head.push(`+${n - head.length} more`); break; }
    head.push(s); budget -= s.length + 3;
  }
  return `framediff_directive_undispatchable:${head.join(" | ")} — ${n} FIRING directive(s) ask for a search the driver cannot dispatch; ` +
    `restate ALL ${n} in ONE re-save of frame-diff.json. ` +
    list.map((o, i) => `[${i + 1}] "${short(o.item)}": ${o.why}`).join(" ");
}

/**
 * Every FIRING directive in a frame-diff document that cannot be dispatched — read LENIENTLY, from
 * raw text or an already-parsed object. This is the enumeration the gateway hint and the pipeline's
 * exhausted-ladder disclosure both run against the artifact ON DISK, because the fail string they
 * would otherwise scrape is cut at 160 characters (verify.mjs:381) and cannot carry more than the
 * first offender. Lenient on purpose: the artifact reaching these two callers has ALREADY failed
 * validation, so it may also carry an unknown key or a bad gap flag — refusing to enumerate then
 * would lose exactly the disclosures this exists to keep. Returns [{item, layer, severity, why}].
 * PURE.
 */
export function undispatchableFiringDirectives(rawOrDoc) {
  return firingDirectivesLenient(rawOrDoc).filter((d) => d.why);
}

/**
 * EVERY firing directive in a frame-diff document, read leniently, each stamped with `why` when it
 * cannot be dispatched (null when it can). The exhausted-ladder disclosure needs the whole firing
 * set, not just the offenders: on the 2026-07-29 artifact four of five fire-and-fail the ask
 * contract, but the fifth was dispatchable all along — and on a failed stage `parsed` stays null and
 * the reopen block never runs, so that one would vanish with no row at all. Two different endings,
 * both disclosed, is the point: "could not be stated as a search" and "never got dispatched" are not
 * the same fact about a run. PURE.
 */
export function firingDirectivesLenient(rawOrDoc) {
  let m = rawOrDoc;
  if (typeof rawOrDoc === "string") { try { m = JSON.parse(rawOrDoc); } catch { return []; } }
  if (!m || typeof m !== "object" || !Array.isArray(m.directives)) return [];
  const out = [];
  for (const d of m.directives) {
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    const severity = String(d.severity ?? "").trim().toLowerCase();
    if (!FIRING_SEVERITIES.includes(severity)) continue;
    const layer = String(d.layer ?? "").trim().toLowerCase();
    const item = String(d.item ?? "").trim();
    // coerce the remedy defensively — an un-parsed remedy is exactly what a failed validate leaves behind
    let remedy;
    if (d.remedy && typeof d.remedy === "object" && !Array.isArray(d.remedy)) {
      remedy = { terms: (Array.isArray(d.remedy.terms) ? d.remedy.terms : []).map((t) => String(t ?? "").trim()).filter(Boolean) };
    }
    out.push({ item, layer, severity, why: directiveUndispatchableReason({ layer, item, remedy }) });
  }
  return out;
}

/**
 * Why a FIRING directive cannot be dispatched — or null when it can. The identity check behind the
 * ask contract: whatever the directive dictates must survive the SAME term lint the plan freeze and
 * the supplemental mint enforce, so nothing can reach the wire as gibberish.
 *
 * SCOPE IS DELIBERATELY THE VARIANT LAYER (plus any layer's own remedy):
 *   * VARIANT — the evidenced class. The directive says "search this near-form", so its item stands
 *     where a mark term stands, and a label there ("TAKIS (famous cpg snack, …)") is the whole defect:
 *     it dispatches as a nil search that reads CLEAN, or it dies unasked at reopen.
 *   * FIELD — untouched. A class-gap directive whose item names no parseable class already has a
 *     principled ending: deriveDirectiveRemedy returns null and the directive is DISCLOSED rather
 *     than swept blind. Forcing a repair cycle on every un-classed field observation would widen a
 *     label defect into a cost regression, and the Round-2 finding is explicit that genuinely
 *     un-termable directives may still defer — just never with the "label" reason for a directive
 *     naming a searchable thing.
 *   * SOURCE — untouched, and must be: a source directive names a CHANNEL for the common-law lane
 *     (a store, a distributor, a domain). It never mints a register query, so a mark-term lint over
 *     it would refuse correct work.
 * A `remedy` is checked on EVERY layer, because a remedy IS a dispatch instruction wherever it rides.
 *
 * NO SECOND PARAMETER. It used to take `dominantElement` and both call sites passed the
 * document's field, but the body never read it — so the signature advertised that dispatchability
 * depends on the spine, which it does not. Removed rather than left declared: a parameter that lies
 * about what a function reads is how a later change comes to depend on a value nothing supplies.
 * PURE.
 */
export function directiveUndispatchableReason(directive) {
  const d = directive ?? {};
  const layer = String(d.layer ?? "").toLowerCase();
  const item = String(d.item ?? "").trim();
  const r = d.remedy;
  const remedyTerms = (r?.terms ?? []).map((t) => String(t ?? "").trim()).filter(Boolean);
  if (remedyTerms.length) {
    // a remedy that names a LABEL is no better than an item that does — same lint, same refusal.
    const bad = remedyTerms.find((t) => termShapeIssue(t) || termPredicateIssue(t, "exact"));
    return bad
      ? `remedy.terms carries a value that is not a searchable mark term (${short(bad)}): ${termShapeIssue(bad) ?? termPredicateIssue(bad, "exact")}. Restate it as the mark-shaped term(s) to search.`
      : null;
  }
  if (layer !== "variant") return null;
  const shape = termShapeIssue(item) ?? termPredicateIssue(item, "exact");
  if (!shape) return null;
  return `the item is a display LABEL, not a searchable mark term: ${shape}. A literal dispatch would be a nil search that reads as CLEAN, so it is refused here. Restate the directive with remedy: {terms:["<the mark-shaped term>"], nice_classes:["<class>", …]} — say WHAT to search, not what the omission is called.`;
}

// ---- Part A: the structured remedy (CODE owns the re-search scope; the mint no longer guesses) ------

// Strict-parse an OPTIONAL directive `remedy` object. Throws `framediff_remedy_invalid:<why>` (token
// first) — never silently drops a mis-shaped remedy, since a wrong re-search is exactly the failure
// mode. Normalizes to {terms:string[], nice_classes:string[], regions:string[]} (nice_classes as
// numeric strings — the mint/executor key on strings). Every sub-field is optional; {} is valid.
export function parseRemedy(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("framediff_remedy_invalid: remedy must be a JSON object");
  for (const k of Object.keys(r)) if (!REMEDY_KEYS.includes(k)) throw new Error(`framediff_remedy_invalid: key "${short(k)}" (keys are EXACTLY: ${REMEDY_KEYS.join(", ")})`);
  const arr = (v, name) => {
    if (v == null) return [];
    if (!Array.isArray(v)) throw new Error(`framediff_remedy_invalid: ${name} must be a JSON array`);
    return v;
  };
  const terms = arr(r.terms, "terms").map((t) => String(t ?? "").trim()).filter(Boolean);
  const nice_classes = [...new Set(arr(r.nice_classes, "nice_classes").map((c) => String(c).trim()).filter((c) => /^\d{1,2}$/.test(c) && Number(c) >= 1 && Number(c) <= 45))];
  const regions = arr(r.regions, "regions").map((x) => String(x ?? "").trim()).filter(Boolean);
  return { terms, nice_classes, regions };
}

// Parse Nice class numbers from a directive's terse ITEM label ONLY — never the observation. The item is
// the label ("Cl. 35 (retail…) and Cl. 38 (…)") and parses cleanly to {35,38}; the observation cites the
// WRONG co-classification classes ("…never class-pinned to 35 or 38 — surfaced only via 9/28/41/42…"), so
// a number-scan over it re-injects the exact classes the miss is about. Anchored on a class-word prefix so
// a stray number in prose is never mistaken for a class. Returns numeric strings, deduped, valid 1–45.
export function parseFieldClasses(item) {
  const s = String(item ?? "");
  const found = new Set();
  const re = /\b(?:cl|class(?:es)?)\b\.?\s*((?:\d{1,2})(?:\s*(?:,|and|&|\/|\+|or)\s*\d{1,2})*)/gi;
  let m;
  while ((m = re.exec(s))) {
    for (const n of m[1].match(/\d{1,2}/g) ?? []) {
      const c = Number(n);
      if (c >= 1 && c <= 45) found.add(String(c));
    }
  }
  return [...found];
}

/**
 * Derive the structured re-search for a firing register directive (Part A). Precedence:
 *   1. an explicit directive.remedy (a source that dictated the exact terms×classes) — used verbatim;
 *   2. a FIELD (class-gap) directive → the DOMINANT ELEMENT searched in the classes named in its ITEM
 *      label (RUN1: HALCYON × Cl.35/38 — never the item STRING × the matter's own classes, which is what
 *      guessing term:d.item + nice_classes:inScope did). No parseable classes ⇒ null: searching the
 *      dominant element in the matter's OWN classes just re-runs the primary sweep, closing nothing, so
 *      the directive is DISCLOSED, never swept blind;
 *   3. a variant near-form → the near-form searched in the in-scope classes (today's mint behaviour).
 * PURE. Returns {terms, nice_classes, regions} or null (not code-closeable — disclose).
 */
export function deriveDirectiveRemedy(directive, { dominantElement = "", inScope = [] } = {}) {
  const d = directive ?? {};
  const r = d.remedy;
  if (r && (r.terms?.length || r.nice_classes?.length)) {
    // parseRemedy already normalized it when it came through the parser; coerce defensively for code callers.
    return {
      terms: (r.terms ?? []).map((t) => String(t ?? "").trim()).filter(Boolean),
      nice_classes: [...new Set((r.nice_classes ?? []).map((c) => String(c).trim()).filter((c) => /^\d{1,2}$/.test(c)))],
      regions: (r.regions ?? []).map((x) => String(x ?? "").trim()).filter(Boolean),
    };
  }
  const inScopeStr = [...new Set((inScope ?? []).map((c) => String(c).trim()).filter(Boolean))];
  if (String(d.layer ?? "").toLowerCase() === "field") {
    const classes = parseFieldClasses(d.item);
    const term = String(dominantElement ?? "").trim();
    if (classes.length && term) return { terms: [term], nice_classes: classes, regions: [] };
    return null;
  }
  const item = String(d.item ?? "").trim();
  if (!item || !inScopeStr.length) return null;
  // A2 (PR-1, the 2026-07-28 label-as-term class): the item is the directive's display LABEL, and a
  // label is only usable as a search term when it is mark-shaped. "Reverse-order TIKI composites
  // (TROPICAL TIKI, ISLAND TIKI)" dispatched verbatim as `exact` is a nil search that reads as a
  // clean — TROPICAL TIKI and ISLAND TIKI were ONE label, never two terms. The mint would now reject
  // it (same shared lint), but the honest ending is decided HERE: no code remedy ⇒ the directive is
  // DISCLOSED (the caller's defer lane), never swept blind. A directive that knows its terms says so
  // in a structured `remedy` (precedence 1 above) — that is the documented fix (SKILL.md).
  if (termShapeIssue(item) || termPredicateIssue(item, "exact")) return null;
  return { terms: [item], nice_classes: inScopeStr, regions: [] };
}

// ---- pure decision logic (CODE owns these; the model only supplies the structured diff) -------------

/**
 * Dictate-don't-infer backstop (mirrors parseEscalationRisk's fail-safe posture): never trust the
 * model's `dominant_element_gap` flag alone. Force it TRUE when any FIRING directive's item names
 * the dominant element (from blind-frame-model.json or the manifest), AND upgrade that directive's
 * severity to "dominant-element" so it always fires. Returns a NEW {directives, dominant_element_gap}.
 *
 * Two guards (quality item 9 — the postmortem promotion bug):
 *   - TOKEN-BOUNDARY anchor, never a bare substring: an unanchored lowercase includes() promoted a
 *     directive whose item merely CONTAINED the dominant element inside another word (a domain/handle
 *     label). The dominant element must appear as (a) whole token(s) in the item, or the item as
 *     whole token(s) in the element — exact containment at word boundaries, never fuzzy.
 *   - NEVER promote `minor`: a minor directive is a DEFENDED DROP — the diff already judged it, with
 *     a reasoned rationale (and often a stated reopen trigger). Promoting it re-opens a decision the
 *     model defended and converts a non-firing note into a verdict-clamp input. Minor stays minor
 *     and never forces the gap.
 */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenBounded = (hay, needle) =>
  !!hay && !!needle && new RegExp(`(?:^|[^a-z0-9])${escapeRe(needle)}(?:$|[^a-z0-9])`).test(hay);

export function applyDominantBackstop(parsed, dominantElement) {
  const dom = norm(dominantElement);
  let gap = parsed.dominant_element_gap === true;
  const directives = parsed.directives.map((d) => {
    if (d.severity === "minor") return d;   // a defended drop is never promoted (quality item 9)
    const item = norm(d.item);
    const onSpine = dom && (item === dom || tokenBounded(item, dom) || tokenBounded(dom, item));
    if (onSpine) { gap = true; return { ...d, severity: "dominant-element" }; }
    return d;
  });
  return { directives, dominant_element_gap: gap };
}

/** Directives that fire a supplemental sweep (dominant-element + material); minor is excluded. */
export function firingDirectives(directives) {
  return (directives ?? []).filter((d) => FIRING_SEVERITIES.includes(d.severity));
}

/** Stable idempotency key for a directive (layer + normalized item) — drives alreadyAttempted. */
export function reopenKey(d) {
  return `${d.layer}:${norm(d.item)}`;
}

/**
 * True when the prior frame-reopen receipt already attempted EXACTLY this firing set (set-equality on
 * reopenKeys) — mirrors the coverage-closure `alreadyAttempted` guard so a resume never re-spends.
 */
export function alreadyAttemptedReopen(priorReceipt, firing) {
  if (!priorReceipt) return false;
  const a = JSON.stringify((priorReceipt.requested ?? []).map((d) => (typeof d === "string" ? d : reopenKey(d))).sort());
  const b = JSON.stringify((firing ?? []).map(reopenKey).sort());
  return a === b;
}

/**
 * A1 (closure-first): partition the firing directives into SWEPT (genuinely closed — for the dominant
 * element that means the register crowd was ENUMERATED, read from the coverage ledger, NOT a file
 * byte-change) vs DEFERRALS (genuinely uncloseable this run, each with a documented reason). `isClosed(d)`
 * decides closure; `reasonFor(d)` supplies the deferral reason. Guarantees `swept ∪ deferrals === firing`
 * (every firing directive ends recorded — never silently dropped, the ashen-lattice failure). PURE.
 * @returns {{swept: string[], deferrals: {directive:string, layer:string, reason:string}[]}}
 */
export function partitionFiring(firing, isClosed, reasonFor) {
  const swept = [], deferrals = [];
  for (const d of (firing ?? [])) {
    if (isClosed(d)) swept.push(reopenKey(d));
    else deferrals.push({ directive: reopenKey(d), layer: d.layer, reason: String((reasonFor && reasonFor(d)) || "uncloseable") });
  }
  return { swept, deferrals };
}

/**
 * A2/A3: the frame residual as coverage pseudo-rows for the status-honesty signal + the verdict clamp. An
 * unclosed dominant-element gap and every deferred directive become `{unit, status:"frame-gap", reason}`
 * rows the caller unions into `materialGaps` (so the delivered status/headline cannot read clean while the
 * dominant-element crowd is unfinished). PURE — reads a frame-reopen receipt `{deferrals[], remaining[],
 * dominant_element_gap, domClosed}`.
 */
export function frameResidualGaps(receipt) {
  if (!receipt) return [];
  const rows = [];
  if (receipt.dominant_element_gap === true && receipt.domClosed !== true)
    rows.push({ unit: "dominant-element crowd", status: "frame-gap", reason: "the blind frame-diff flagged a dominant-element omission the reopen pass did not close" });
  const deferrals = Array.isArray(receipt.deferrals) ? receipt.deferrals
    : (receipt.remaining ?? []).map((d) => (typeof d === "string" ? { directive: d, reason: "" } : d));
  for (const d of deferrals)
    rows.push({ unit: d.directive ?? "frame directive", status: "frame-gap", reason: d.reason || "left unswept" });
  return rows;
}

// ── Round 2 Change 1 — jurisdictional scope (legal effect in the instructed territories) ──────────────────
// Matter-AGNOSTIC reference data only: the EU membership is byte-identical for every matter (general reference,
// never a matter's answer). EUTM ⇔ every member; a member-state right sits inside the EU territory. Madrid/IR
// designations + treaty/priority routes are NOT mechanical — the digest reasons those and tags `in-scope-by-reach`;
// these helpers only settle the certain cases and NEVER drop a reaching hit on their own.
const EU_MEMBERS = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);
// A12: EM/EUTM/EUIPO now fold to EU in juris() (the canonical map) — this set keeps the aliases only
// for any un-folded token that reaches the EU checks through a path juris() does not touch.
const EU_TOKENS = new Set(["EU", "EM", "EUTM", "EUIPO"]);
// A12 (addendum 2026-07-30): the canonical fold IS the normalization — UK/GB and EU/EM/EUTM/EUIPO are
// one territory each, so a scope of "UK" against a searched "GB" (or "EU" vs a band's "EM") can no
// longer read as under-coverage/over-reach. One map, driver/jurisdiction-codes.mjs, every consumer.
const juris = (s) => canonicalJurisdictionCode(s);

/**
 * Change 1b — is a right effective in `hit` IN SCOPE by a MECHANICAL route? True iff hit is an instructed
 * jurisdiction (exact); or hit is an EU-wide right (EUTM) and scope names EU or any EU member (the EUTM reaches
 * it); or hit is an EU member and scope names EU (the member is inside the scoped EU territory). Returns FALSE
 * for routes needing legal judgement (Madrid/IR designation, treaty, priority) — the digest reasons those and
 * tags in-scope-by-reach; FALSE means "not auto-confirmed", NEVER "drop it". PURE.
 */
export function effectiveInScope(hit, scopeJurisdictions = []) {
  const h = juris(hit);
  const scope = new Set((scopeJurisdictions ?? []).map(juris));
  if (!h || !scope.size) return false;
  if (scope.has(h)) return true;                                          // exact instructed territory
  const scopeHasEU = [...scope].some((s) => EU_TOKENS.has(s));
  const scopeHasMember = [...scope].some((s) => EU_MEMBERS.has(s));
  if (EU_TOKENS.has(h) && (scopeHasEU || scopeHasMember)) return true;    // an EUTM reaches an in-scope EU territory
  if (EU_MEMBERS.has(h) && scopeHasEU) return true;                       // a member-state right is inside the scoped EU
  return false;
}
// does a SEARCHED token mechanically cover a scoped jurisdiction j? (exact, or an EU search covering EU-scope).
// A member scoped but only EU searched is NOT covered (national rights need a national search) → stays a gap.
function searchedCovers(j, searchedSet) {
  if (searchedSet.has(j)) return true;
  if (EU_TOKENS.has(j) && [...searchedSet].some((s) => EU_TOKENS.has(s))) return true;
  return false;
}

/**
 * Change 1d — diff the run's jurisdiction scope vs what it actually searched/surfaced, BOTH directions.
 *   overReach     = a searched/surfaced jurisdiction OUTSIDE scope and not effective-in-scope (wandered → drop or justify)
 *   underCoverage = an in-scope jurisdiction never searched (a recall gap)
 * `effectiveByReach` lists hits the digest tagged in-scope-by-reach, so a legitimately-reaching jurisdiction is
 * not mis-flagged as over-reach. Both lists feed frame-diff.json / the reopen. PURE.
 */
export function jurisdictionScopeFlags({ scopeJurisdictions = [], searched = [], effectiveByReach = [] } = {}) {
  const scope = (scopeJurisdictions ?? []).map(juris).filter(Boolean);
  const scopeSet = new Set(scope);
  const reach = new Set((effectiveByReach ?? []).map(juris));
  const searchedSet = new Set((searched ?? []).map(juris).filter(Boolean));
  const overReach = [...searchedSet].filter((j) => !scopeSet.has(j) && !effectiveInScope(j, scope) && !reach.has(j));
  const underCoverage = scope.filter((j) => !searchedCovers(j, searchedSet));
  return { overReach, underCoverage };
}
