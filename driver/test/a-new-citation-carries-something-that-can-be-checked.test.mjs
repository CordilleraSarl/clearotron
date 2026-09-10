// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NEW citation must carry something that can be checked.
//
// The guard beside this one says out loud what it cannot see: a citation pointing at the WRONG LIVE LINE,
// while that line is real code, reads as correct to every test it has. Of the line citations in this tree
// only a minority name a symbol; the rest are checked for existence and nothing more.
//
// That is not closeable on the existing corpus, and the ruling recorded in the guard's header declines a
// form guard without an allowlist for the ~800 citations already here. Judging only what a RANGE ADDS is
// that allowlist, expressed as a rule instead of a list: everything already in the tree is exempt by
// construction, and the number of uncheckable citations stops growing.
//
// Repointing the old ones by hand is not the alternative. Both hand measurements recorded in the guard's
// own blindness note found wrong lines INTRODUCED by exactly that kind of pass — three of ten, and three
// of eleven.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newBareCitations, addedLinesSince } from "../../scripts/citation-line-check.mjs";

const line = (text) => [{ file: "x.mjs", line: 1, text }];

test("a NEW citation with a line number and no symbol is refused", () => {
  const hits = newBareCitations(line("// a note pointing at driver/pipeline.mjs:875 with nothing beside it"));
  assert.equal(hits.length, 1, "the one shape that cannot be checked must be the one that is refused");
  assert.equal(hits[0].cited, "driver/pipeline.mjs");
  assert.equal(hits[0].start, 875);
});

test("the forms that CAN be checked are allowed — a refusal of everything guards nothing", () => {
  // Without this the one above is satisfied by a rule that refuses every citation, which would pass
  // it while making the ratchet unusable and getting itself removed within a week.
  for (const ok of [
    "// see driver/pipeline.mjs:875 recordsFromSearch for the refusal",   // symbol after the number
    "// recordsFromSearch at driver/pipeline.mjs:875 refuses it",         // and before it
    "// see driver/pipeline.mjs for the refusal",                          // no line number at all
    "// `toolGroupsForStage()` in `gather-config.mjs` — the documented form",
  ]) assert.equal(newBareCitations(line(ok)).length, 0, `refused a checkable form: ${ok}`);
});

test("a lowercase word beside a number is not a symbol, and does not buy an exemption", () => {
  // `SYMBOLIC` requires a capital or an underscore. Ordinary prose after a citation — "875 already
  // covers it" — would otherwise read as a named symbol and exempt exactly the citations this exists for.
  assert.equal(newBareCitations(line("// see driver/pipeline.mjs:875 already covers it")).length, 1);
});

test("a captured V8 stack frame in a fixture is not a citation", () => {
  // Its numbers describe the tree that threw and nobody maintains them. The discriminator is the column,
  // the same one the corpus scan uses; a ratchet that refused these would make every fixture holding a
  // trace unmergeable.
  assert.equal(newBareCitations(line('  at planRegisterSweeps (file:///x/driver/pipeline.mjs:2102:19)')).length, 0);
});

test("the range is read from the diff's ADDED lines, with their real line numbers", () => {
  const diff = [
    "+++ b/a.mjs",
    "@@ -0,0 +12,2 @@",
    "+// see driver/pipeline.mjs:875 with nothing beside it",
    "+const ok = 1;",
    "",
  ].join("\n");
  const r = addedLinesSince("base", () => diff);
  assert.equal(r.error, null);
  assert.deepEqual(r.lines.map((l) => l.line), [12, 13], "the hunk header's start must be honoured");
  assert.equal(r.lines[0].file, "a.mjs");
  assert.equal(newBareCitations(r.lines).length, 1);
});

test("an added line beginning with ++ is judged, and the lines after it keep their numbers", () => {
  // `git diff` glues its one "+" onto the line's own text, so an added line starting with "++" is
  // indistinguishable from a file header BY PREFIX. It is not indistinguishable in full: the header
  // carries a path, or is the bare deletion string, both matched exactly here. Dropping such a line
  // loses the citation on it AND numbers every later line in the hunk one low — and that second half
  // is the one that reports a real defect at an address it never looked at.
  //
  // Two specimens on purpose. The second begins "++" and the first begins "++ ", so the first arrives
  // as "+++ " and a prefix test widened by one space still drops it.
  const diff = [
    "--- a/gone.mjs",
    "+++ /dev/null",          // a deleted file's header adds nothing and names no file
    "@@ -1 +0,0 @@",
    "-const dead = 1;",
    "--- a/a.mjs",
    "+++ b/a.mjs",
    "@@ -2 +2,3 @@",
    "-const was = 1;",
    "+++ // see driver/pipeline.mjs:875 with nothing beside it",
    "+++concat = 2;",
    "+const ok = 1;",
    "",
  ].join("\n");
  const r = addedLinesSince("base", () => diff);
  assert.equal(r.error, null);
  assert.deepEqual(
    r.lines.map((l) => [l.file, l.line, l.text]),
    [
      ["a.mjs", 2, "++ // see driver/pipeline.mjs:875 with nothing beside it"],
      ["a.mjs", 3, "++concat = 2;"],
      ["a.mjs", 4, "const ok = 1;"],
    ],
    "both ++ lines are additions, and the line after them is 4",
  );
  assert.equal(newBareCitations(r.lines).length, 1, "the citation on the ++ line is judged, not skipped");
});

test("a range that cannot be read is reported as unread, never as an empty range", () => {
  // The two are the same value — no lines — and only one of them is a clean answer. Reported as an error
  // the caller must handle, so the CLI can exit 2 rather than announcing a range it never read as clean.
  const r = addedLinesSince("nope", () => { throw new Error("fatal: bad revision 'nope'"); });
  assert.match(String(r.error), /could not diff/);
  assert.deepEqual(r.lines, []);
});
