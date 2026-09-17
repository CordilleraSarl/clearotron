// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CENSUS MUST NOT REPORT A POPULATION IT KNOWS IT DID NOT READ.
//
// It consults HEAD rather than the index on purpose: the private overlay stages a withheld corpus over a
// clone without committing it, so the index there holds files HEAD does not, and counting them made the
// census permanently disagree with itself between the published tree and the overlaid one.
//
// What it then did with the leftovers was the defect. It printed that N tracked paths were not in HEAD and
// not counted, and reported the population as "unchanged" in the same breath. Measured twice on
// 2026-09-17, from opposite directions:
//
//   · mid-merge, it dropped every path that arrived from the other parent — a test file with 5 tests and
//     14 assertions vanished from the stamp, and the summary said nothing had changed.
//   · with a new test file merely STAGED, it dropped that — `git add` puts a file in the index and only a
//     commit puts it in HEAD. The census went out six tests and twenty-three assertions short and was
//     caught by `--check` afterwards, which is later than here and by luck.
//
// The cure is not to read the index: that would undo the reason HEAD is consulted. It is to tell the two
// situations apart, and the cut record already does — under the overlay a laid path is the withheld
// corpus and is expected; with no cut record nothing is withheld from this tree, so a tracked path missing
// from HEAD is staged work about to be left out of the stamp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { laidPathVerdict } from "../../scripts/mint-suite-census.mjs";

test("no laid path is no finding, in either mode", () => {
  // The floor. Without it every assertion below is satisfied by a rule that refuses everything, which
  // would stop the routine re-stamp working and be removed within a day.
  for (const cutRecordPresent of [true, false]) {
    const v = laidPathVerdict({ laid: 0, laidPaths: [], cutRecordPresent });
    assert.equal(v.refuse, false);
    assert.equal(v.message, null, "nothing to say when nothing was left out");
  }
});

test("with NO cut record a laid path refuses, because nothing here is withheld", () => {
  const v = laidPathVerdict({
    laid: 2,
    laidPaths: ["driver/test/a-new-one.test.mjs", "driver/test/another.test.mjs"],
    cutRecordPresent: false,
  });
  assert.equal(v.refuse, true, "a census minted here would be stamped over a population it did not read");
  assert.match(v.message, /a-new-one\.test\.mjs/, "the paths are named — a count leaves a reader to go and find them");
  assert.match(v.message, /another\.test\.mjs/);
  assert.match(v.message, /Commit them first/, "…and the message says what to do, not only what is wrong");
});

test("with a cut record present the SAME input does not refuse — that is the overlay working", () => {
  // The direction that matters most, because getting it wrong breaks the case HEAD-filtering exists for.
  // Under the overlay a laid path is the withheld corpus staged over a clone; refusing there would make
  // the private control unrunnable, and a guard that fires on the legitimate use gets switched off.
  const laidPaths = ["driver/test/a-new-one.test.mjs", "driver/test/another.test.mjs"];
  const overlay = laidPathVerdict({ laid: 2, laidPaths, cutRecordPresent: true });
  const plain = laidPathVerdict({ laid: 2, laidPaths, cutRecordPresent: false });

  assert.equal(overlay.refuse, false, "the overlay's withheld corpus is expected and must not stop the mint");
  assert.match(overlay.message, /not counted/, "…but it still says so, because a silent exclusion is the original defect");
  assert.equal(plain.refuse, true,
    "and the ONLY thing separating the two is the cut record — if both answered the same the discriminator "
    + "is not being consulted and one of the two cases is being served wrong");
});

test("the refusal names a bounded number of paths and says how many it left out", () => {
  // A withheld corpus is hundreds of files. A refusal that prints all of them buries its own instruction,
  // and the instruction is the part a reader acts on.
  const many = Array.from({ length: 50 }, (_, i) => `driver/test/f${i}.test.mjs`);
  const v = laidPathVerdict({ laid: many.length, laidPaths: many, cutRecordPresent: false });
  assert.equal(v.refuse, true);
  const named = (v.message.match(/f\d+\.test\.mjs/g) ?? []).length;
  assert.ok(named > 0 && named <= 20, `named ${named} paths — it must name some and must not name all fifty`);
  assert.match(v.message, /and 30 more/, "…and must say how many it did not name, or the list reads as the whole of it");
});
