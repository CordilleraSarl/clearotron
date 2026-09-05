// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE DIFF GUARD READS WHAT IT CLAIMS TO READ.
//
// scripts/added-reference-check.mjs refuses a bare `#NNN` added in a diff, in comments and prose only.
// Every arm here drives the guard's own functions over lines it would meet, because the property is
// about which lines it reads and which it leaves alone — and the way that check fails is by quietly
// reading none of them and reporting the same clean exit as a tree with nothing to find.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isProse, withoutLinkTargets, offendingTokens, addedLines } from "../../scripts/added-reference-check.mjs";

test("a bare reference in a source comment is refused", () => {
  assert.deepEqual(offendingTokens("driver/x.mjs", "  // see #1234 for the ruling"), ["#1234"]);
  assert.deepEqual(offendingTokens("driver/x.mjs", "   * carried over from #987"), ["#987"]);
});

test("markdown is prose throughout, not only its comment lines", () => {
  assert.deepEqual(offendingTokens("docs/x.md", "The reason is recorded in #4321."), ["#4321"]);
});

test("a workflow comment is read; a workflow value is not", () => {
  assert.deepEqual(offendingTokens(".github/workflows/ci.yml", "  # replaces the job from #777"), ["#777"]);
  assert.deepEqual(offendingTokens(".github/workflows/ci.yml", "  name: build #777"), []);
});

// CONTROL — the arms that keep the guard usable. Each of these fired as a false refusal at some point
// in something this project has shipped, which is why they are pinned rather than assumed.
test("CONTROL — code is not read, so a CSS colour and a composite key are never references", () => {
  assert.deepEqual(offendingTokens("portal-ui/x.ts", "  const accent = \"#850\";"), []);
  assert.deepEqual(offendingTokens("driver/x.mjs", "  const key = `#1503-${stage}`;"), []);
});

test("CONTROL — a link target is an address, not a reference", () => {
  assert.deepEqual(offendingTokens("docs/x.md", "See [the note](https://example.test/a#1234)."), []);
  assert.deepEqual(offendingTokens("docs/x.md", "Jump to [the section](#1234)."), []);
  assert.deepEqual(offendingTokens("docs/x.md", "Read <https://example.test/b#1234> first."), []);
});

test("CONTROL — the form this project writes passes, because it carries no hash at all", () => {
  assert.deepEqual(offendingTokens("driver/x.mjs", "  // ruled on tracker issue 1234"), []);
  assert.deepEqual(offendingTokens("docs/x.md", "Ruled on tracker issue 1234."), []);
});

test("CONTROL — two digits is not a reference, and the boundary is asserted rather than assumed", () => {
  assert.deepEqual(offendingTokens("driver/x.mjs", "  // ticket #99 is not this shape"), []);
  assert.deepEqual(offendingTokens("driver/x.mjs", "  // ticket #100 is"), ["#100"]);
});

test("isProse says no to a source line that is not a comment", () => {
  assert.equal(isProse("driver/x.mjs", "const a = 1; // #1234"), false,
    "a trailing comment on a code line is not read — the line's leading token decides, and widening "
    + "that is a decision about CSS and composite keys, not a tweak here");
  assert.equal(isProse("driver/x.mjs", "  // #1234"), true);
});

test("withoutLinkTargets removes the address and keeps the prose around it", () => {
  const out = withoutLinkTargets("before [x](https://e.test/y#111) after #222");
  assert.match(out, /before/);
  assert.match(out, /after #222/, "the reference outside the link must survive, or the exemption swallows the finding");
});

test("addedLines reads ONLY added lines, and attributes each to its file", () => {
  const diff = [
    "diff --git a/driver/a.mjs b/driver/a.mjs",
    "--- a/driver/a.mjs",
    "+++ b/driver/a.mjs",
    "@@ -1,0 +2 @@",
    "+// added, mentions #1234",
    "-// removed, mentions #5678",
    "diff --git a/docs/b.md b/docs/b.md",
    "--- a/docs/b.md",
    "+++ b/docs/b.md",
    "@@ -1,0 +2 @@",
    "+prose adding #4321",
  ].join("\n");
  const added = addedLines(diff);
  assert.deepEqual(added.map((a) => a.path), ["driver/a.mjs", "docs/b.md"]);
  assert.ok(added.every((a) => !a.line.includes("5678")), "a REMOVED line must never be read as added");
  assert.ok(!added.some((a) => a.line.startsWith("++")), "the +++ header is not an added line");
});

// AN ABSENCE IS A FINDING. If the parse silently returned nothing, every arm above that asserts an
// empty result would still pass, and so would the guard on every pull request forever.
test("the parse has a floor — a diff that adds lines must yield lines", () => {
  const added = addedLines("--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+one\n+two\n");
  assert.equal(added.length, 2, "the added-line parse returned nothing over a diff that adds two lines");
});
