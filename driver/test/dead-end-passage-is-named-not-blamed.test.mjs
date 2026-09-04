// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A PASSAGE NOTHING CAN BE QUOTED FROM IS A DEAD END, AND SAYING SO IS THE FIX.
//
// `snippetSegments` splits on newlines, so a snippet's elision markers become pointable passages. On the
// receipt that killed a production run, passages 2, 4, 6, 8 and 10 were the literal string "..." — five
// of twelve. No fragment copied out of one can ever clear `FRAGMENT_MIN`, so pointing at one was an
// automatic dead end, and the refusal said `fragment_too_short`: "copy a few more characters out of it",
// an act that passage cannot support. Measured across two independent runs, this is the ~4-7% tail, not
// the mass — the blocking defect is and this does not pretend otherwise.
//
// ── THE UNIFORMITY CONSTRAINT, ASSERTED HERE IN WORDS AS WELL AS IN CODE ───────────────────────
//
// (eb959e72) removed a per-script satisfiability partition and the doctrine is ONE ordered shape,
// no threshold that sorts seats by the script they are reading. Excluding structurally-unsatisfiable
// passages is uniform — a "..." passage is a dead end for every seat alive — but ONLY if the test for it
// is the gate's own.
//
// THE TRAP, AND IT IS THE OBVIOUS IMPLEMENTATION: the bar is not `passage.length`. It is
// `quoteWeight(frag) < FRAGMENT_MIN`, and `quoteWeight` already weights scripts. Measured below: a
// five-character CJK passage BINDS where a five-character Latin one does not. So a `.length` exclusion
// would drop satisfiable CJK passages and re-mint the exact partition removed — inside the fix
// written to honour it. `livePassages` therefore derives from `quoteWeight` against `FRAGMENT_MIN`,
// beside the bar, and no caller is allowed its own copy of that arithmetic.
//
// AND IT REFUSES RATHER THAN EXCLUDES. Removing dead ends from the pointable set would renumber the
// passages the seat is reading, which is a fresh way to point at the wrong thing. The passage numbering
// the seat sees never changes; pointing at a dead end costs one refusal that names it and lists the
// passages that do carry text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { snippetSegments, segmentBinding, livePassages, connotationObligations, obligationRows } from "../connotation-search.mjs";
import { validateDispositionCall, CALL_REFUSALS } from "../disposition-call.mjs";

// The live receipt's own shape: 12 passages, five of them the elision marker. Reproduced from the
// forensics and independently corroborated by the deployed-binder replay, which found 7 of 12 binding.
const SNIP = [
  "**a ** : correct according to social rules", "...",
  "**b ** : behaving in a way that is correct", "...",
  "always used before a noun", "...",
  "always used with this sense", "...",
  "always used in this position", "...",
  "**5 **", "always used b",
].join("\n");
const DEAD = [2, 4, 6, 8, 10];
const LIVE = [1, 3, 5, 7, 9, 11, 12];
const CAND = { snippet: SNIP };
const RECORDED = [{ query: "a meaning query", results: [
  { id: "R-AAAA1111", title: "first", url: "https://e.test/1", snippet: SNIP }] }];
const ROW = () => obligationRows(connotationObligations(RECORDED))[0];
// — a call row is addressed by its POSITION in the driver's obligation list; ROW is the first.
const call = (over) => validateDispositionCall([{ row_index: 1, ruling: "benign", note: "n",
  receipt_index: 1, ...over }], RECORDED);

test("#1236 THE FIXTURE IS THE LIVE RECEIPT: 12 passages, 5 dead, 7 live", () => {
  const segs = snippetSegments(SNIP);
  assert.equal(segs.length, 12, "the splitter no longer produces the shape this file is about");
  assert.deepEqual(DEAD.map((i) => segs[i - 1]), Array(5).fill("..."),
    "the five elision markers moved — the fixture stopped being the receipt it was taken from");
  assert.deepEqual(livePassages(SNIP), LIVE, "the live set is not the seven the deployed replay found binding");
});

test("#1236 the five dead ends are NAMED, instantly, and not blamed on the seat's fragment", () => {
  for (const i of DEAD) {
    const b = segmentBinding({ segment_index: i, fragment: "..." }, CAND);
    assert.equal(b.state, "segment_dead_end",
      `passage ${i} still reports \`${b.state}\` — a remedy about the seat's fragment on a passage that has none to give`);
  }
});

test("#1236 the seven live ones bind exactly as the deployed replay showed", () => {
  for (const i of LIVE) {
    const seg = snippetSegments(SNIP)[i - 1];
    const b = segmentBinding({ segment_index: i, fragment: seg.slice(0, 12) }, CAND);
    assert.equal(b.state, "bound", `passage ${i} stopped binding — the fix narrowed what was already working`);
  }
});

test("#1236 UNIFORMITY: the bar is quoteWeight, so a five-character CJK passage still binds", () => {
  // The measurement that makes a `.length` implementation provably wrong. If this ever fails, the fix has
  // acquired a per-script partition and 's defect is back inside its own cure.
  assert.equal(segmentBinding({ segment_index: 1, fragment: "意味アザミ" }, { snippet: "意味アザミ" }).state, "bound",
    "a five-character CJK passage is being treated as a dead end — this is the per-script partition #1118 removed");
  assert.equal(segmentBinding({ segment_index: 1, fragment: "abcde" }, { snippet: "abcde" }).state, "segment_dead_end",
    "a five-character Latin passage stopped being a dead end — the bar moved");
  // …and the two are decided by ONE function, so they cannot drift apart.
  assert.deepEqual(livePassages("意味アザミ"), [1]);
  assert.deepEqual(livePassages("abcde"), []);
});

test("#1236 the refusal names the passages that DO carry text — an act the seat can perform", () => {
  const r = call({ segment_index: 2, fragment: "..." });
  assert.equal(r.refused[0]?.reason, "segment_dead_end");
  assert.match(r.refused[0].detail, /ELISION MARKER or stub/);
  assert.match(r.refused[0].detail, new RegExp(LIVE.join(", ")),
    "the refusal does not list the live passages — it names the problem and no act");
  assert.doesNotMatch(r.refused[0].detail, /copy a few more characters/,
    "still telling the seat to lengthen a fragment on a passage that cannot support one");
  assert.ok(CALL_REFUSALS.includes("segment_dead_end"), "the token is emitted but not declared");
});

test("#1236 a receipt with NO live passage routes to the obstacle, not to another re-point", () => {
  // The row-level corollary, and the boundary: when every passage is a dead end, "point
  // somewhere else" is itself an impossible instruction, so this is the ONE case that belongs to the
  // honest exit rather than to a re-point.
  //
  // GETTING THE FIXTURE RIGHT MATTERS, and my first one was wrong in an instructive way. A snippet that
  // is ALL elision markers is not quote_required at all — `usableSnippet` is false, so the row never owes
  // proof and can never reach this branch. The reachable shape is a snippet that IS usable overall while
  // every INDIVIDUAL passage sits under the bar: many short lines. Total weight high, each passage tiny.
  const SHORT_LINES = Array.from({ length: 14 }, () => "abc").join("\n");
  const recorded = [{ query: "q", results: [{ id: "R-CCCC3333", title: "t", url: "https://e.test/3", snippet: SHORT_LINES }] }];
  const row = obligationRows(connotationObligations(recorded))[0];
  assert.equal(row.quote_required, true, "the fixture owes no proof of reading — it cannot reach the branch this test is about");
  assert.deepEqual(livePassages(SHORT_LINES), [], "the fixture has a live passage — it is not the unsatisfiable case");

  const r = validateDispositionCall([{ row_index: 1, ruling: "benign", note: "n", receipt_index: 1,
    segment_index: 1, fragment: "abc" }], recorded);
  assert.equal(r.refused[0]?.reason, "segment_dead_end");
  assert.match(r.refused[0].detail, /obstacle/,
    "a receipt nothing can be quoted from is telling the seat to point elsewhere — there is nowhere else");
  assert.doesNotMatch(r.refused[0].detail, /Point at one of the passages/,
    "it is offering live passages on a receipt that has none");
});

test("#1236 an ALL-ELISION receipt is safe for a different reason, and that reason must hold", () => {
  // Recorded because it is the fixture I reached for first: it is safe because `usableSnippet` refuses it
  // upstream, NOT because of anything this issue adds. If that ever changes, the branch above becomes the
  // only thing standing between such a receipt and a live-lock, so the property is pinned here rather
  // than assumed to be somebody else's.
  const allElision = ["...", "...", "..."].join("\n");
  assert.deepEqual(livePassages(allElision), []);
  const recorded = [{ query: "q", results: [{ id: "R-BBBB2222", title: "t", url: "https://e.test/2", snippet: allElision }] }];
  assert.equal(obligationRows(connotationObligations(recorded))[0].quote_required, false,
    "an all-elision receipt now DEMANDS proof of reading it cannot supply — the dead-end branch is now load-bearing for it");
});

test("#1236 the live-passage arithmetic has ONE home", () => {
  // A second copy with its own threshold is how the gate and its advice drift apart, and drift here means
  // telling a seat to point at a passage the validator will refuse.
  const src = readFileSync(fileURLToPath(new URL("../disposition-call.mjs", import.meta.url)), "utf8");
  assert.match(src, /livePassages/, "the refusal stopped deriving its advice from the gate's own function");
  // Asserted on the IMPORT, not on the token: `FRAGMENT_MIN` appears twice in that file's comments, and a
  // bare token grep cannot tell a mention from a use. The defect would be importing or re-declaring the
  // bar, so that is what is checked.
  assert.doesNotMatch(src, /import\s*\{[^}]*\bFRAGMENT_MIN\b/,
    "disposition-call.mjs imported the bar — it must ask `livePassages`, not compare against the threshold itself");
  assert.doesNotMatch(src, /(const|let|var)\s+FRAGMENT_MIN/,
    "disposition-call.mjs declared its own copy of the bar");
});
