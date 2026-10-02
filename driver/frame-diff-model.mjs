// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// frame-diff-model.mjs — the pure decision logic of the reopen channel (frame-omission design, Property 2).
//
// The second framing and its diff, which used to raise most of the channel's directives, left the engine
// with the mid-run reopening; the form check (mechanicalFormGapDirectives) is the source that remains.
// CODE decides which directives fire a supplemental sweep, how each is re-searched and how each ends —
// the decision is never the model's.
//
// PURE (no node imports) → the decision helpers test offline exactly like envelopeDecision /
// parseEscalationRisk.

import { termPredicateIssue, termShapeIssue } from "../providers/_shared/term-shape.mjs";

// the severities that FIRE a supplemental sweep (Property 2). minor is logged, never swept.
export const FIRING_SEVERITIES = ["dominant-element", "material"];

const norm = (s) => String(s || "").trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase();

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
  // label is only usable as a search term when it is mark-shaped. "Reverse-order WAVO composites
  // (TROPICAL WAVO, ISLAND WAVO)" dispatched verbatim as `exact` is a nil search that reads as a
  // clean — TROPICAL WAVO and ISLAND WAVO were ONE label, never two terms. The mint would now reject
  // it (same shared lint), but the honest ending is decided HERE: no code remedy ⇒ the directive is
  // DISCLOSED (the caller's defer lane), never swept blind. A directive that knows its terms says so
  // in a structured `remedy` (precedence 1 above) — that is the documented fix (SKILL.md).
  if (termShapeIssue(item) || termPredicateIssue(item, "exact")) return null;
  return { terms: [item], nice_classes: inScopeStr, regions: [] };
}

// ---- pure decision logic (CODE owns these) -------------

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
