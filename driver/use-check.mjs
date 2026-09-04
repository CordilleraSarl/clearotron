// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// use-check.mjs — WS2 (spec 11): the deterministic enforcement substrate for the targeted use-check.
//
// The pivotal practical question for a registered-but-maybe-unused conflict is "does the owner actually USE
// the mark for these goods?" On marble-keystone the run INFERRED "no use" from the owner's profile (a music act)
// and simultaneously handed "confirm actual use" to the requester — a must-have, search-answerable question
// both asserted and deferred. The Step-3.5 use-check that should have run is mandated in the skill prose AND
// LEAKED anyway, so a stronger instruction is not the fix.
//
// Enforcement here is on the only machine-checkable substrate available: the DOCUMENT SHAPE of narrative.md.
// (There is no perplexity call ledger — unlike the Corsearch record_fetch URIs the screen-gate cross-checks —
// so the cited result inside the narrative is the only proof a query ran.) Rule: a finding at Composite ≥3
// whose mitigant depends on the ABSENCE of use must carry a "**Use-check source:**" line (a real URL, or the
// honest "perplexity_research — no result"). This is wired into validators.narrative (verify.mjs) and is FATAL
// — a violating narrative cannot pass validation, so it cannot reach report-synthesis. Pure over the narrative
// text, like screen-gate, so it tests without a gateway.

// The mitigant/verdict depends on the (absence of) actual use. Anchored on the synthesis stage's own stock
// vocabulary for a filed-but-unused conflict.
const USE_NEGATIVE_RE = new RegExp([
  "non-use",                                              // "vulnerable to non-use", "non-use cancellation/revocation"
  "not in actual use",
  "\\bunused\\b",                                         // "almost certainly unused"
  "no [^.\\n]{0,40}\\buse\\b[^.\\n]{0,24}\\b(?:found|identified)\\b", // "no marketplace use … found"
  "\\buse\\b[^.\\n]{0,14}\\b(?:unknown|unconfirmed|unclear)\\b",      // "owner's use unknown/unconfirmed"
  "filed-vs-used",
].join("|"), "i");

// A cited use-result satisfies the requirement. Loose on purpose (bold optional) — we must NOT false-flag a
// finding that already carries an honest use-result/inconclusive line.
const USE_SOURCE_RE = /use-?check source\s*:/i;

// Composite digit from a finding block, e.g. "**Composite — 3 (Medium).**" or "Composite 2 (Manageable)".
function parseComposite(block) {
  const m = block.match(/\bComposite\b[^\d\n]{0,14}(\d)/i);
  return m ? Number(m[1]) : null;
}

// A block is a rated FINDING (the only thing the use-check polices) if its heading names a Finding or its body
// carries a Composite marker. This deliberately excludes the "## Actions" / "## Bottom line" / coverage
// sections, which paraphrase the same use language but are not the finding that must carry the searched result.
function isFinding(heading, block) {
  return /\bfinding\b/i.test(heading) || /\*\*\s*composite\b/i.test(block);
}

/**
 * Find Composite ≥3 use-dependent findings that assert a use-negative without a searched use-result.
 *
 * A finding block VIOLATES when: it is a rated finding, its text matches a use-negative, it is Composite ≥3
 * (floor-safe: an unparseable Composite that still matches the use-negative is treated as ≥3 — never let a
 * format wobble drop the gate), AND it carries no "**Use-check source:**" line. Composite <3 never triggers
 * (a manageable finding doesn't justify the query). Pure: empty/missing input → no violations, never throws.
 *
 * @param {string} narrativeContent  the narrative.md text
 * @returns {Array<{finding:string, composite:number|null}>} offending findings (empty ⇒ clean)
 */
export function findUseCheckViolations(narrativeContent) {
  const lines = (narrativeContent || "").split("\n");
  const blocks = [];
  let cur = null;
  for (const ln of lines) {
    const h = ln.match(/^(#{2,4})\s+(.*)/);
    if (h) {
      if (cur) blocks.push(cur);
      cur = { heading: h[2].trim(), body: [] };
    } else if (cur) {
      cur.body.push(ln);
    }
  }
  if (cur) blocks.push(cur);

  const violations = [];
  for (const b of blocks) {
    const block = `${b.heading}\n${b.body.join("\n")}`;
    if (!isFinding(b.heading, block)) continue;
    if (!USE_NEGATIVE_RE.test(block)) continue;          // mitigant doesn't turn on the absence of use
    const composite = parseComposite(block);
    const triggers = composite === null ? true : composite >= 3; // floor-safe on an unparseable Composite
    if (!triggers) continue;
    if (USE_SOURCE_RE.test(block)) continue;             // a searched use-result (or honest "no result") is cited
    violations.push({ finding: b.heading, composite });
  }
  return violations;
}
