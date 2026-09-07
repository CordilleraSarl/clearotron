// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REFERENCE STRIP LEFT SENTENCES WITH THEIR SUBJECT REMOVED.
//
// 179 when it was filed. 181 two days later, with nobody having decided to add any: the strip's shape is
// what a later edit copies when it edits near one. The floor below is what stopped it growing.
//
// 75 NOW, AND THE DROP IS WHY THE ORIGINAL REASONING WAS WRONG. This was recorded as 181 judgements
// about surrounding code rather than a sweep, because the repair was thought to need the removed
// reference back. It did not. Measured against the frozen pre-strip tree, 610 of the recoverable lines
// had exactly ONE bare citation removed and nothing else — so the noun after the apostrophe was still
// there, still saying what the thing was, and the sentence had lost only its determiner. The reference
// is not coming back either way: it is ruled out of the tree. So the repair was a determiner, chosen by
// what stands in front of the gap, and it closed 106 of them at once.
//
// Three more are in `driver/publish/render.mjs`, which is frozen at a content hash. They are left
// alone deliberately: changing that file needs an entry in the break ledger next door, which is a
// larger decision than a punctuation sweep gets to make.
//
// WHY THE FLOOR STAYS. What is left is the residue that reasoning does not reach: lines where the strip
// took more than a citation, lines with no match in the frozen tree, and lines whose sentence needs a
// person to say what the thing was. Those are per-sentence and they are the ones the floor now guards.
// An arm asserting zero would be red from the day it landed, and a permanently red arm teaches people to
// stop reading the suite — which is how this class got to 181 in the first place.
//
// NOT THE SAME RESIDUE AS THE CITATION SWEEP, AND THE NUMBERS COLLIDE. `tracker issue NNN — ` in a
// comment is INTACT text a ruling removes; the residue here is DAMAGE — a sentence that lost its
// subject, which is a defect whether or not anyone rules on citations. The two populations happen to
// have both sat near 180, and the signature order in reference-strip-signatures.mjs puts the
// line-anchored one first, so "the anchor in the first signature" has been read as being about
// `\bpre-\s+[a-z]`, which has no anchor at all. Different residue, different repair, different floor:
// this one falls to zero as sentences are repaired, the citation one goes to zero the day its sweep
// runs and then wants a guard against reintroduction instead.
//
// THE MEASUREMENT THAT MATTERS IS NOT THIS ONE. The signature this file ships is anchored at the comment
// leader, so it counts a bare possessive that OPENS a comment and misses the identical damage mid-line.
// Widened, the same census reads 722 rather than 180. That gap is its own repair and its own number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNATURES, censusOf, isScannable, RULE_DEFINITIONS } from "../reference-strip-signatures.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";   // tracker issue 235

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TABLE = JSON.parse(readFileSync(join(ROOT, "driver/test/fixtures/reference-strip-backlog.json"), "utf8"));

const GUARD = "reference-strip-backlog";
// Through the helper (tracker issue 235): `null` is a stated skip, not an empty corpus. An empty one
// here would read as a repaired tree — every count zero, the floor satisfied — which is the precise
// failure the backlog table exists to make impossible.
const tracked = () => trackedFiles(GUARD, { root: ROOT });
const census = () => { const files = tracked(); return files === null ? null : censusOf(ROOT, files, (f) => readFileSync(join(ROOT, f), "utf8")); };

test("185 the reference-strip backlog is a FLOOR — no file may carry more than it is recorded with", (ctx) => {
  const now = census();
  if (now === null) return ctx.skip(skipReason(GUARD));
  // An empty corpus reports every absence as a repair. The census in tracker issue 1010 exists for this shape.
  assert.ok(Object.keys(now.files).length > 0 || TABLE.total === 0,
    "the census came back empty against a non-empty table — the corpus was not read, and every "
    + "'repaired' line below would be a file this arm failed to open");

  const grew = [];
  for (const [f, counts] of Object.entries(now.files)) {
    const was = TABLE.files[f];
    if (!was) { grew.push(`${f}: NEW — ${counts.join(" + ")} (this file carried none)`); continue; }
    counts.forEach((n, i) => { if (n > was[i]) grew.push(`${f}: ${SIGNATURES[i].name} went ${was[i]} → ${n}`); });
  }
  assert.deepEqual(grew, [],
    "the reference strip's two signatures grew. Neither construction occurs in written English, so this "
    + "is an edit that copied the shape of a broken sentence next to it. Repair the line; do not re-mint "
    + "the table to absorb it.");
});

test("185 the table is not stale — a repair is RECORDED, so the backlog cannot quietly stop shrinking", (ctx) => {
  // The other direction, and the one a floor alone misses: repair ten lines, leave the table at 181, and
  // ten new breaks fit underneath it silently. The table must equal the tree, both ways.
  const now = census();
  if (now === null) return ctx.skip(skipReason(GUARD));
  assert.equal(now.total, TABLE.total,
    `the committed backlog says ${TABLE.total} and the tree has ${now.total}. Re-mint with `
    + "`node scripts/mint-reference-strip-backlog.mjs` — after repairing, never instead of it.");
  assert.deepEqual(now.files, TABLE.files, "the per-file backlog disagrees with the tree; re-mint it");

  // Said out loud every run, because a backlog nobody sees is a backlog nobody finishes.
  console.error(`[185] ${TABLE.total} unfinished sentence(s) remain, in ${Object.keys(TABLE.files).length} file(s)`);
});

test("185 the signatures still FIRE — a matcher that stopped matching reports a repaired tree", () => {
  // The specimens are the real residue shapes, from the issue. If the strip's output is ever re-derived
  // and these stop matching, this arm says so instead of the census quietly reaching zero.
  const specimens = [
    [0, "// 's design ruling — \"above any fold, only a statement, a labelled row\""],
    [0, "  // 's wording, not a second copy of it. That helper already distinguishes EADDRINUSE"],
    [0, "# 's sibling. Every recording transport captures the payload"],
    [1, "// …false ⇒ the pre- section, byte-identical, for every archived run."],
    [1, "| **Deprecated, honoured for one release.** The pre- names. Unset on every deployed box"],
  ];
  for (const [i, line] of specimens) {
    assert.ok(SIGNATURES[i].re.test(line), `signature ${i} (${SIGNATURES[i].name}) no longer fires on: ${line}`);
  }

  // ✕ AND THE FALSE-POSITIVE HALF, or this arm is one broad regex away from flagging the whole tree.
  // Ordinary possessives, and hyphenated `pre-` words that the strip never touched.
  for (const innocent of [
    "// the run's own report says so, and it's the only surface a client reads",
    "// pre-flight checks run before the seat is dispatched",
    "const preFlight = true;",
    "// a pre-delivery lint pass",
  ]) {
    assert.ok(!SIGNATURES.some((s) => s.re.test(innocent)),
      `a signature fired on ordinary prose, which is how this arm gets deleted: ${innocent}`);
  }
});

test("185 the census COUNTS — driven on a synthetic tree, so it is not trusted on its own word", () => {
  // The census reads the real repository, where the right answer is whatever it says. Planted, it has to
  // agree with an answer known in advance. A helper that returned {} would pass every arm above.
  const fake = {
    "a.mjs": "// 's one\n// 's two\nreal code\n",
    "b.md": "renders the pre- section\n",
    "c.mjs": "// nothing wrong here\n",
    "d.png": "// 's ignored — not a scannable extension\n",
  };
  const got = censusOf("/synthetic", Object.keys(fake), (f) => fake[f]);
  assert.equal(got.total, 3, `planted 3 breaks across 2 files, census said ${got.total}`);
  assert.deepEqual(got.files, { "a.mjs": [2, 0], "b.md": [0, 1] });
  assert.ok(!isScannable("d.png") && !isScannable("portal-ui/dist/x.mjs"),
    "the scannable filter stopped excluding binaries or generated output");
});

test("185 the one USER-FACING instance is repaired — documentation, not a comment", () => {
  // Every other instance is a code comment, read by somebody with the repository open. This one is a row
  // in the configuration reference, which is what a deploying user reads to decide what to set.
  const doc = readFileSync(join(ROOT, "docs/architecture/04-configuration-reference.md"), "utf8");
  const broken = doc.split("\n").filter((l) => SIGNATURES[1].re.test(l));
  assert.deepEqual(broken, [],
    "the configuration reference carries an unfinished sentence. This file is user-facing: a reader "
    + "deciding what to set meets it as documentation that stops mid-clause.");
});

test("185 the rule's own definition is the ONLY exemption, and every exempt file still exists", (ctx) => {
  // An exemption keyed to a path that has been renamed away stops exempting anything, and the guard then
  // counts its own specimens as backlog — silently, because the number only goes up by two and nobody
  // reads a floor that moved. Both directions: the list is exactly these three, and all three are tracked.
  const listed = trackedFiles(GUARD, { root: ROOT });
  if (listed === null) return ctx.skip(skipReason(GUARD));
  const tracked = new Set(listed);
  for (const f of RULE_DEFINITIONS) {
    assert.ok(tracked.has(f), `the exemption names ${f}, which this tree does not track — it was renamed `
      + "or deleted, and the exemption now covers nothing");
    assert.ok(!isScannable(f), `${f} is exempt by name and the filter still scans it`);
  }
  // No path outside the rule's own three files may be exempted. An exemption list is one edit away from
  // being where inconvenient files go.
  assert.equal(RULE_DEFINITIONS.length, 3,
    "the exemption list grew. It covers the files that DEFINE the signatures and nothing else; a file "
    + "that merely carries residue belongs in the backlog, where it is counted and visible.");
});
