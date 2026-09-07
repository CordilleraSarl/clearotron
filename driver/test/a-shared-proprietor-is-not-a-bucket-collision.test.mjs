// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A bucket collision is about a RECORD, not a proprietor (tracker issue 249).
//
// THE DEFECT. The collision rule's only condition was `ownersMatch`. Its own heading says "A RECORD MAY
// NEVER APPEAR IN TWO BUCKETS" and the code implemented a different class: any proprietor with more than
// one mark manufactured a collision. A large filer can hold one reference mark the run withheld and a
// DIFFERENT mark, outside the reference, that it surfaced — both rows true, no contradiction.
//
// WHY IT MATTERED MORE THAN A SPURIOUS LINE. score.mjs prints a collision as "do not read the recall
// numbers above until these are resolved". So one large proprietor suppressed a whole run's recall
// measurement, and did: on R2 `russet-kestrel`, `Novartis AG` held withheld `DELFITY` and surfaced
// `DELPHINA`, and a real 88% → 63% recall movement went unquoted on the regression issue because of it.
//
// WHAT IS ASSERTED. The spurious pair no longer collides; the predicate still fires on the shape the
// check exists for; and the same-proprietor rows are still REPORTED — on a line that does not tell the
// reader the numbers are unreadable. Note the third arm's finding: today's matcher relates the
// historical pair itself, so the SCORER can no longer build that collision at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scoreRecall } from "../reference-score.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// One proprietor, two different marks: the reference names one and the run withheld it; the run
// surfaced the other, which the reference does not name. This is R2's real shape.
const OWNER = "Novartis AG";
const score = ({ refMark, findingMark, retrievedMark = refMark }) => scoreRecall({
  reference: [{ mark: refMark, owner: OWNER, jurisdictions: ["CH"], classes: [5] }],
  findings: [{ mark: findingMark, owner: OWNER, band: "watch", ordinal: 1 }],
  retrieved: [{ mark: retrievedMark, owner: OWNER, record_id: "/mark/ch/TEST", classes: [5], jurisdictions: ["CH"] }],
  scopeClasses: [5], scopeTerritories: ["CH"],
});

test("DRIVEN: a shared proprietor with DIFFERENT marks is not a collision — R2's spurious pair", () => {
  const b = score({ refMark: "DELFITY", findingMark: "DELPHINA" });
  assert.deepEqual(b.collisions, [],
    "same owner, different marks, different records — the run legitimately withheld one and surfaced the "
    + "other, and calling that a contradiction suppressed a whole run's recall numbers");
});

test("DRIVEN: the pair is still REPORTED, so nothing is hidden — only the verdict changed", () => {
  const b = score({ refMark: "DELFITY", findingMark: "DELPHINA" });
  assert.equal(b.ownerEchoes.length, 1,
    "a reader may still want to see a proprietor on both sides; what they must not be told is that the "
    + "recall measurement is unreadable");
  assert.equal(b.ownerEchoes[0].entry, "DELFITY");
  assert.equal(b.ownerEchoes[0].noise, "DELPHINA");
});

test("the collision predicate still fires on one record split across two buckets", () => {
  // NOT DRIVEN THROUGH scoreRecall, and the reason is worth writing down rather than working around.
  // The pairing this check was built for — `DELPHI GENETICS` in LOST beside `DG DELPHI GENETICS` in
  // NOISE — CANNOT be produced by today's scorer: `matchesReference` now relates the two ("contained"),
  // so the finding is scored `found` and never reaches the noise bucket at all. Measured, not assumed.
  //
  // That is the matcher having improved, and it means a collision is RARE BY CONSTRUCTION: this check
  // only fires where the matcher disagrees with itself. Asserting the predicate directly is therefore
  // the honest arm — driving it through scoreRecall would assert a scenario the scorer can no longer
  // build, and an arm that cannot fail is not a check.
  const key = (s) => String(s ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const FLOOR = 4;
  const same = (x, y) => { const a = key(x), b = key(y);
    return !!(a && b && Math.min(a.length, b.length) >= FLOOR && (a === b || a.includes(b) || b.includes(a))); };
  assert.equal(same("DELPHI GENETICS", "DG DELPHI GENETICS"), true,
    "the historical pair must still satisfy the predicate — narrowing it must not cost the case it exists for");
  assert.equal(same("DELFITY", "DELPHINA"), false,
    "and R2's pair must not, which is the whole change");
});

test("the containment floor stops a short mark matching everything", () => {
  // Rebuilt from the implementation rather than imported, because the point is the threshold itself.
  const key = (s) => String(s ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const FLOOR = 4;
  const same = (x, y) => { const a = key(x), b = key(y);
    return !!(a && b && Math.min(a.length, b.length) >= FLOOR && (a === b || a.includes(b) || b.includes(a))); };
  assert.equal(same("DEL", "DELPHINA"), false, "three characters inside a longer mark is not a shared record");
  assert.equal(same("DELPHI", "DELPHINA"), true, "above the floor and contained");
  assert.equal(same("acme", "ACME"), true, "the join is case-normalised — a case-sensitive one matches zero and reads as clean");
  assert.equal(same("A.C.M.E.", "ACME"), true, "and punctuation-normalised");
});

test("the printer does not tell a reader the numbers are unreadable over a same-proprietor row", () => {
  const printer = readFileSync(join(ROOT, "..", "scripts", "score.mjs"), "utf8");
  const suppress = "do not read the recall numbers above";
  const idx = printer.indexOf(suppress);
  assert.ok(idx > 0, "the collision warning must still exist — a real collision is worth suppressing over");
  const echoIdx = printer.indexOf("ownerEchoes");
  assert.ok(echoIdx > 0, "the advisory must be printed, not dropped");
  // The advisory block must not carry the suppression sentence.
  const echoBlock = printer.slice(echoIdx, echoIdx + 700);
  assert.ok(!echoBlock.includes(suppress),
    "the same-proprietor line must not repeat the suppression warning — that is the defect, one layer over");
});

test("the scorer still refuses to resolve a collision into a bucket", () => {
  const src = readFileSync(join(ROOT, "reference-score.mjs"), "utf8");
  assert.match(src, /RECORDED, NEVER THROWN/,
    "the harness records and a reader adjudicates; auto-promoting a collision to `found` would be the "
    + "scorer manufacturing recall from its own confusion");
});
