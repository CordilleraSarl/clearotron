// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// write-up-form.mjs — §8/§9: which of the three write-up forms a finding earns.
//
// PURE. No imports, no IO — it takes the depth row the run resolved and one finding, and returns a form.
//
// ── WHY THIS READS THE DEPTH TABLE RATHER THAN A CATEGORY NAME ────────────────────────────────────
//
// The spec writes the predicate as `form(category, judgment)`. Taking the category literally would mint a
// SECOND vocabulary for the same decision — one table saying a product grades its prose, another saying
// which findings earn a card — and the two would drift the first time a product was added. The depth row
// already carries the graded/ungraded answer per product, and the ladder already resolves it once per run
// through `depthFor`. So the category arrives as the row it produced.
//
// ── TWO RULES FROM TWO SECTIONS, AND THEY MUST NOT BE CONFLATED ───────────────────────────────────
//
// §3's table narrows per-finding NARRATIVE PROSE to `adversarial` findings on worldwide. The CARD rule is
// separate and stricter: the floors are "one mechanical set [that] stays load-bearing and is not a
// priority judgment", and the owner's standing non-negotiable is that **a tier-`identical` floor row gets
// a full card in EVERY product** — the / class (`script-exact`, `alias-exact`, `normalized-equal`
// all ride inside `identical`). Reading the prose row as the card rule would drop those on worldwide,
// which is the one outcome this ladder is forbidden to produce.
//
// So the full-card predicate is the same on multi-country and worldwide: `adversarial`, plus any
// tier-`identical` floor. §3's "same, tighter" for worldwide is about how aggressively the remainder
// GROUPS, not about a different card predicate.
//
// ── WHAT THIS DOES NOT DECIDE ─────────────────────────────────────────────────────────────────────
//
// Short entry vs grouped row. That cannot be answered per finding: §8 sets a minimum group size of two
// and renders a single-member group as a short entry, so it is a property of the population. This returns
// `full` or `entry`, and the grouping pass turns `entry` into one or the other.

/** The two answers this function can give. `entry` becomes a short entry or a grouped line downstream. */
export const WRITE_UP_FORMS = Object.freeze(["full", "entry"]);

/**
 * The form one finding earns.
 *
 * @param {object|null} depth        the resolved depth row (`depthFor`'s output), or null
 * @param {object|null} finding      a findings.json finding
 * @param {{floorTier?: string|null}} opts  the mark's band-shape floor tier, when it has one
 * @returns {"full"|"entry"}
 */
/**
 * Is this depth row one of the GRADED rungs — the ones on which a finding can render below a full card?
 *
 * The same test `writeUpForm` opens with, named once so the two callers cannot state it differently. The
 * other caller is the `write-up-forms` journal row, which is owed on exactly the products where the
 * distinction between "full" and "entry" is a fact about the run rather than a constant: on one country
 * every form is `full` by construction, so a row there would report the product's own definition back.
 *
 * FAIL-SAFE DIRECTION, and it is the same one `writeUpForm` uses: an unrecognised or missing rung answers
 * NO. Every consequence downstream of a `true` here can only shorten a report.
 *
 * @param {object|null} depth  the resolved depth row (`depthFor`'s output), or null
 */
export function gradedWriteUpRung(depth) {
  const rung = String(depth?.narrativeProse ?? "every-finding");
  return rung === "adversarial" || rung === "adversarial+floors";
}

export function writeUpForm(depth, finding, { floorTier = null } = {}) {
  // UNGRADED IS FULL, and it is the first test on purpose: a run whose depth is missing, malformed, or
  // from a product this build has no row for renders exactly as it does today. Every other branch below
  // can only REMOVE a card, so an unrecognised ladder must never reach them.
  if (!gradedWriteUpRung(depth)) return "full";

  // The owner's standing non-negotiable, and it is tested BEFORE the disposition so that no future
  // judgment vocabulary can route around it.
  if (String(floorTier ?? "") === "identical") return "full";

  // `adversarial` is band 1 — the conflicts genuinely in the way. §8: "A mark judged `adversarial` never
  // renders below a short entry, in any product", and it earns the full card in every graded product.
  if (String(finding?.disposition ?? "") === "adversarial") return "full";

  // A withdrawn finding never reaches a card at all (fullProseOrdinals filters it upstream); it is not
  // this function's business, and returning `entry` for one would be answering a question nobody asked.
  return "entry";
}
