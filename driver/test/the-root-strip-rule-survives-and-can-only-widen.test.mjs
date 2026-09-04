// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE ROOT STRIP APPLIES TO EVERY VARIANT, AND IT CAN ONLY WIDEN.
//
// ── THE DEFECT THE RULE FIXES ───────────────────────────────────────────────────────────────────────
//
// `prelim-variants` strips the DOMINANT ELEMENT to a formative root and sweeps that root as a
// contains-match. It dispatched each generated VARIANT as its full string. Root for the element, full
// string for the variant — and because these are contains-matches, string length decides reach: a
// family member of a variant contains the variant's ROOT and does not contain the full variant.
//
// Measured on a delivered run: `default DELPHI` (the element, as a root, 208 records) beside
// `phonetic VELTRIN` (the variant, in full). One register reference mark retrieved zero times. The
// earlier run reached it only because it happened to emit a shorter free-standing form — luck, not
// method.
//
// ── WHAT THIS FILE CAN AND CANNOT ARM, STATED PLAINLY ───────────────────────────────────────────────
//
// The ruling asked for "a property over arbitrary invented marks: given a mark with a phonetic variant,
// the dispatched query for that variant is its root and not its full form."
//
// ✕ THAT ARM CANNOT BE WRITTEN AGAINST TODAY'S TREE, and saying so is better than approximating it.
// The strip is a JUDGMENT THE SEAT MAKES: it writes `Formative root: X` into the manifest, and
// `formativeRootFromManifest` (scope-ledger.mjs) reads what the seat decided. No code derives a root
// from a variant, so there is no dispatch to assert about. An arm that constructed one would be testing
// a function this change did not add.
//
// ✓ WHAT IS ARMABLE is the rule's own INVARIANT — the claim the doctrine rests on and the acceptance
// criterion the ruling set: **it can only widen.** That is a property of contains-matching, it holds
// over arbitrary invented marks, and it is what makes the rule safe to follow. Plus the doctrine text
// itself, pinned so a sweep cannot quietly drop it, and its worked example checked against the very
// invariant it teaches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOCTRINE = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "prelim-variants", "SKILL.md");

/** The clause that CARRIES the rule. Pinned on the rule, never on its example — an example may be reworded. */
const RULE_CLAUSE = "The root strip applies to every variant you emit, not only to the dominant element.";

test("the rule is in the doctrine the variants seat actually reads", () => {
  const md = readFileSync(DOCTRINE, "utf8");
  assert.ok(md.includes(RULE_CLAUSE),
    `the root-strip rule is gone from ${DOCTRINE}. A doctrine sweep dropped it, and nothing else states it — `
    + "the variants stage reads SKILL.md and transliteration-scripts.md only, so a rule anywhere else is a rule the seat never sees.");

  // It must sit INSIDE the mandatory block, not merely somewhere in the file.
  const block = md.indexOf("**Formative-family rules**");
  assert.notEqual(block, -1, "the Formative-family rules block is gone — the rule's home no longer exists");
  const next = md.indexOf("**Visual / typographic-neighbour rules**", block);
  assert.ok(md.slice(block, next === -1 ? undefined : next).includes(RULE_CLAUSE),
    "the rule left the Formative-family rules block — that block is the one marked MANDATORY when a Formative root is named, and outside it the rule is advisory");
});

test("a shorter root can only WIDEN — the invariant the rule rests on, over arbitrary invented marks", () => {
  // The rule's safety argument, as a property: if R is a prefix of V, then every string containing V
  // also contains R. So replacing the sweep for V with a sweep for R cannot lose a record — it can only
  // add. That is why a mis-strip here is survivable and why no parallel full-form search is needed.
  //
  // Invented vocabulary only, and generated rather than fixtured: every token is built from this file's
  // own syllables, so no real mark, family or proprietor appears anywhere in this arm.
  const HEADS = ["VELTR", "QORIM", "NAVREX", "TILUND", "ZEPHRA"];
  const TAILS = ["YN", "IN", "ON", "AE", "US"];
  const SUFFIXES = ["CA", " DIAGNOSTICS", "LABS", "-PRO", "IX"];

  let checked = 0;
  for (const head of HEADS) {
    for (const tail of TAILS) {
      const variant = head + tail;                 // e.g. VELTRYN
      const root = variant.slice(0, -1);           // the strip: one weak affix character off
      assert.ok(variant.startsWith(root), "the generated root is not a prefix of its variant — this arm is testing nothing");
      for (const suffix of SUFFIXES) {
        const familyMember = root + suffix;        // e.g. VELTRYCA — contains the ROOT, not the variant
        assert.ok(familyMember.includes(root),
          `${familyMember} does not contain its root ${root} — the family construction is wrong and the property below is vacuous`);
        // THE POINT: sweeping the full variant misses this family member; sweeping the root finds it.
        assert.equal(familyMember.includes(variant), false,
          `${familyMember} contains the full variant ${variant}, so this pair cannot demonstrate the gap`);
        checked++;
      }
      // AND THE WIDENING DIRECTION: anything the full-variant sweep would have found, the root finds too.
      for (const suffix of SUFFIXES) {
        const containsVariant = variant + suffix;
        assert.ok(containsVariant.includes(root),
          `${containsVariant} matches the variant sweep but NOT the root sweep — the strip would LOSE coverage, `
          + "and the rule's whole safety argument is that it cannot");
      }
    }
  }
  assert.ok(checked >= 100, `only ${checked} pairs exercised — too few for this to be a property rather than an example`);
});

test("the doctrine's own worked example satisfies the invariant it teaches", () => {
  // A teaching example that is not true of itself teaches the wrong thing, and nothing else would catch
  // it: the example is prose, and prose is not executed.
  const md = readFileSync(DOCTRINE, "utf8");
  const idx = md.indexOf(RULE_CLAUSE);
  assert.notEqual(idx, -1);
  const bullet = md.slice(idx, idx + 1400);

  const cited = ["BIOVELTRIN", "VELTRIN", "VELTRI", "VELTRYN", "VELTRY", "VELTRYCA"];
  for (const t of cited)
    assert.ok(bullet.includes(t), `the worked example no longer cites ${t} — the example changed and this arm no longer checks it`);

  // The relationships the bullet asserts, checked as strings.
  assert.ok("BIOVELTRIN".includes("VELTRIN"), "the example's dominant element is not inside its mark");
  assert.ok("VELTRIN".startsWith("VELTRI"), "the example's root is not a strip of its dominant element");
  assert.ok("VELTRYN".startsWith("VELTRY"), "the example's variant root is not a strip of its variant");
  assert.ok("VELTRYCA".includes("VELTRY"), "the example's family member does not contain the variant's root — the example would be false");
  assert.equal("VELTRYCA".includes("VELTRYN"), false,
    "the example's family member DOES contain the full variant, so the example no longer shows the gap it is there to show");
});

test("the rule names the FIELD THE SEAT WRITES, not a downstream effect it has no field for", () => {
  // WHY THIS ARM EXISTS, and it is the whole of the change it guards.
  //
  // The first version of this rule said "the string you sweep for a variant is the variant's root".
  // That sentence names something the seat does not author. The seat authors `Value | Category |
  // Rationale` rows and nothing else — VARIANT_KEYS in variant-manifest-model.mjs is EXACTLY those
  // keys plus `romanization` — and the swept string is derived from `Value` downstream.
  //
  // Measured on the delivered run that first carried the rule: the stage READ the file (the run
  // record's `reads[]` names this doctrine and `readsTruncated` is false; methodology-read.json
  // records the sha of the version carrying the rule), and the strip reached ONE of thirty-six
  // variants — the dominant element, which was already stripped before the rule existed. The
  // variant whose root was the missing reach was dispatched as a contains sweep at FULL length and
  // returned zero records. The rule was read and could not be acted on.
  //
  // So the rule must name `Value`. An arm pinning only the rule clause passes on both wordings —
  // this one is the discriminator, and without it a revert to the ineffective phrasing is invisible.
  const md = readFileSync(DOCTRINE, "utf8");
  const idx = md.indexOf(RULE_CLAUSE);
  assert.notEqual(idx, -1);
  const bullet = md.slice(idx, idx + 1600);

  assert.match(bullet, /`Value`/,
    "the root-strip rule no longer names the `Value` column. It is back to describing a downstream effect "
    + "the seat has no field for, which is the exact shape that was read and produced nothing.");
  assert.match(bullet, /`Rationale`/,
    "the rule no longer says where the full form goes. Shortening the Value without rehoming the full form "
    + "loses it from the manifest entirely.");
  assert.equal(/the string you sweep for a variant/.test(bullet), false,
    "the superseded phrasing is back in the bullet — it names the swept string rather than the authored Value, "
    + "and it was measured read-and-not-applied on a delivered run.");
});

test("the pre-send checklist carries the strip, so the rule has a home the seat checks at submit time", () => {
  // The Formative-family block is prose the seat reads once; the **Rules:** list is what it checks its
  // own rows against before sending. A rule stated only in prose was read and not applied. Both homes,
  // or the second one is doing no work.
  const md = readFileSync(DOCTRINE, "utf8");
  const rules = md.indexOf("- Every variant gets `rationale` filled in.");
  assert.notEqual(rules, -1, "the pre-send Rules checklist is gone — the rule's submit-time home no longer exists");
  const window = md.slice(rules, rules + 700);
  assert.match(window, /is that form's \*\*root\*\*, not the full form/,
    "the checklist no longer states the strip. The rule is back to living only in prose, which is the "
    + "arrangement that was measured read-and-not-applied.");
});
