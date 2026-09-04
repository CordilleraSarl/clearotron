// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-han-mark-is-not-a-longer-mark.test.mjs —.
//
// THE LIVE PAIR. Gold 色度 (class 9) scored as RETRIEVED because the run held 色度花间 (class 41, a
// different proprietor). matchesReference's script rule was containment in both directions with no
// owner gate — rule 4's test without rule 4's guard, on the one path where the guard matters most: a
// Han mark carries no aliases and no consonant skeleton, so nothing further down the ladder catches the
// error. Every CJK found/withheld verdict in every R1/R6 score was decided that way, in both
// directions, which made the recall numbers unquotable rather than merely wrong.
//
// The engine's own classifier had already ruled it and said why (band-shape.mjs): equality only for a
// Han mark, because "色度計 contains 色度 and is a different mark". The scorer was the looser of the two.
//
// Run:  cd driver && node ../scripts/test-run.mjs node --test test/a-han-mark-is-not-a-longer-mark.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesReference, scoreRecall, scoreScriptTargets } from "../reference-score.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const GOLD = "色度";
const OTHER = "色度花间";          // the run's mark, class 41, a DIFFERENT proprietor
const GOLD_OWNER = "Hangzhou Chromatic Instruments Co., Ltd.";
const OTHER_OWNER = "Shanghai Blossom Interiors Co., Ltd.";

test("#1411 the fixture is the defect's own shape — void control", () => {
  assert.notEqual(GOLD, OTHER, "two different marks, or the arms below prove nothing");
  assert.ok(OTHER.includes(GOLD), "and one really does contain the other — that is what used to fire");
  assert.equal(GOLD.replace(/[a-z0-9]/gi, ""), GOLD, "…and neither side carries a Latin element to match on");
});

test("#1411 a different proprietor's longer Han mark is NOT the reference's mark", () => {
  assert.equal(matchesReference(GOLD, OTHER), null, "this is the live miss: 色度 scored off 色度花间");
  assert.equal(matchesReference(OTHER, GOLD), null, "both directions — the rule was symmetric");
  assert.equal(matchesReference(GOLD, OTHER, { sameOwner: false }), null, "explicit false, same answer");
});

test("#1411 the mark still matches itself", () => {
  assert.equal(matchesReference(GOLD, GOLD), "script", "the known-positive the fix must not cost");
  assert.equal(matchesReference("星光", "星光"), "script", "and the pre-existing one");
  assert.equal(matchesReference("星光", "星火"), null, "a near-miss glyph is still a different mark");
});

test("#1411 NFKC folds a compatibility rendering, so one mark typed two ways is one mark", () => {
  // ＡＢＣ (full-width) and ABC are the same characters; a reference typed on a CJK IME must not read as
  // a different mark from the same string typed on a Latin one. Both sides fold before comparison.
  assert.equal(matchesReference("色度／ＡＢＣ", "色度/ABC"), "script");
  assert.equal("色度／ＡＢＣ".normalize("NFKC"), "色度/ABC", "…and this is why — the fold, stated");
});

test("#1411 one proprietor rendering one record long and short still joins — under the owner, as everywhere else", () => {
  assert.equal(matchesReference(GOLD, OTHER, { sameOwner: true }), "script-contained",
    "rule 4's escape, on rule 4's condition — the caller establishes the owner, this never guesses it");
  assert.equal(matchesReference(OTHER, GOLD, { sameOwner: true }), "script-contained", "both directions");
  // And the name is distinct from an exact match, because the report says WHY two labels became one.
  assert.notEqual(matchesReference(GOLD, GOLD), matchesReference(GOLD, OTHER, { sameOwner: true }));
});

test("#1411 end to end: the gold entry lands in lost, not found, when only the other owner's mark was surfaced", () => {
  const b = scoreRecall({
    reference: [{ mark: GOLD, owner: GOLD_OWNER, classes: [9], territories: ["CN"] }],
    findings: [{ mark: OTHER, owner: OTHER_OWNER, band: "monitor" }],
    retrieved: [{ mark: OTHER, owner: OTHER_OWNER }],
    scopeClasses: [9], scopeTerritories: ["CN"],
  });
  assert.equal(b.found.length, 0, "the reference entry was never retrieved — reporting it as found is the defect");
  assert.equal(b.lost.length, 1, "it belongs in lost");
  assert.equal(b.lost[0].mark, GOLD);
  assert.equal(b.noise.length, 1, "and the other proprietor's mark is a finding the reference does not answer");
});

test("#1411 the script-lane report still DISCLOSES the neighbour it no longer scores", () => {
  // The two surfaces part company here, and the parting is the point. A recall verdict must not count a
  // different proprietor's longer mark; a script-lane target report must still show that the lane came
  // back with a neighbour rather than with nothing — that is the difference between a lane that never
  // fired and one that fired and missed. The disclosure rides with exact:false and is counted nowhere.
  const entry = { mark: GOLD, owner: GOLD_OWNER, jurisdictions: ["CN"] };
  const t = scoreScriptTargets({
    reference: [entry],
    buckets: { found: [], withheld: [], lost: [{ mark: GOLD }], excluded: [], additional: [], noise: [], uncovered: [] },
    retrieved: [{ mark: OTHER, owner: OTHER_OWNER, record_id: "/mark/cn/E2E000001" }],
  }).targets[0];
  const row = t.records.find((r) => r.record_id === "/mark/cn/E2E000001");
  assert.ok(row, "the neighbour is still listed — losing it would hide a lane that fired and missed");
  assert.equal(row.exact, false, "…and it is flagged as not being the mark");
  assert.equal(t.ownerState, "differs", "the report's own verdict: records came back, none this proprietor's");
});

test("#1411 the script branch returns a match only on equality, or under an established owner", () => {
  // The sweep the issue asks for, kept as a guard rather than a paragraph. Measured across driver/ and
  // scripts/ on 2026-08-20: reference-score.mjs was the ONLY module whose matcher branches on an empty
  // alias list — band-shape.mjs's `aliases.length > 1` asks a different question and its Han path is
  // equality-only by its own ruling. So what can regress is not a second module: it is THIS branch
  // growing a second unguarded test, which is exactly how the first one survived rule 4 being written
  // twenty lines beneath it with the owner gate spelled out.
  //
  // SCOPED TO THE BRANCH, and asserted on the CONDITION rather than on the word `includes`. A sweep for
  // containment reddens on `candAliases.includes(r)` (rule 2's whole-name membership) and on every
  // scope-membership test in the file, and a guard that cries wolf is one the next person relaxes.
  const src = readFileSync(join(ROOT, "driver", "reference-score.mjs"), "utf8");
  const open = src.indexOf("if (!refAliases.length || !candAliases.length) {");
  assert.ok(open > 0, "the script branch must stay findable, or this guard is blind");
  const branch = src.slice(open, src.indexOf("\n  }", open));
  const returns = branch.split("\n").filter((l) => /return "/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  assert.ok(returns.length >= 2, `the guard found ${returns.length} matching return(s) — it is reading the wrong text`);
  const ungated = returns.filter((l) => !/===/.test(l) && !/sameOwner/.test(l));
  assert.deepEqual(ungated, [],
    `a script match that is neither an equality nor owner-gated — #1411's exact shape:\n  ${ungated.map((l) => l.trim()).join("\n  ")}`);
});
