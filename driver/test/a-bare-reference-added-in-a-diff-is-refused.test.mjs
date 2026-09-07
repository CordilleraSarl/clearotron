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

// ── A `#` COMMENT IS A COMMENT WHEREVER THE FILE FORMAT SAYS SO (tracker issue 188) ─────────────────
//
// `isProse` read `#` as a comment for YAML alone. The same sentence was therefore refused in a .yml file
// and waved through in .env.example, a systemd unit or a shell script — and those comments are exactly
// as publicly visible as a `//` one. Measured while sizing the retirement pass: the guard flagged 359
// tokens on the tree, and `# REQUIRED — tracker issue 774 removed the code default` was sitting in .env.example the
// whole time with the guard reporting clean.
//
// The arms below pin BOTH directions, because widening a classifier is the kind of change that quietly
// starts reading code as prose.
test("a bare reference in a hash-comment file is refused, in every format that uses one", () => {
  for (const path of [".env.example", "deploy.sh", "driver/systemd/clearotron-worker.service",
                      "driver/systemd/clearotron-deploy.timer", "x.path", "app.conf", "config.toml"]) {
    assert.deepEqual(offendingTokens(path, "# REQUIRED — #774 removed the code default."), ["#774"],
      `${path} carries # comments and the guard is not reading them`);
  }
});

test("…and the source rule still governs files whose # is not a comment", () => {
  // A `#` at the start of a JS line is not a comment — it is a private field, or nothing. Reading it as
  // prose would make the guard refuse code, which is how a widened classifier gets switched off.
  assert.deepEqual(offendingTokens("driver/x.mjs", "  #count = 404"), [],
    "a JS private field was read as a comment");
  assert.deepEqual(offendingTokens("driver/x.mjs", "// see #404"), ["#404"],
    "and the real source comment rule still applies");
});

test("the classes the ruling leaves ALONE are still left alone", () => {
  // Test names and user-facing strings are a different change with a different risk — they are asserted
  // by other tests and read by clients — and widening the comment rule must not have reached them.
  assert.deepEqual(offendingTokens("driver/test/x.test.mjs", 'test("#1720 the launcher writes it", () => {'), [],
    "a test NAME was flagged; renaming 2,650 test titles is not this guard's business");
  assert.deepEqual(offendingTokens("driver/x.mjs", '  closes: "#865 — shared doctrine",'), [],
    "a string literal was flagged");
});

// ── A COLOUR IS NOT A CITATION ───────────────────────────────────────────────────────────────────────
//
// The token pattern matches digits only, so a six-digit hex colour was read as its leading digits and
// refused as a reference. An earlier sweep acted on that reading and rewrote sixteen colour literals
// as issue text — two of them live mermaid `classDef` directives, so the diagrams rendered broken, and
// thirteen comments stated a value that was no longer there. Restoring them hit this guard, whose
// refusal told the author to write the very text that had caused it.
//
// The arm below is written to fail in BOTH directions, because a rule that only ever passes colours is
// indistinguishable from having deleted the check.

test("a hex colour is passed, and the same digits in prose are still refused", () => {
  // 1. Letters settle it: an issue number is decimal, so anything carrying a-f cannot be one.
  for (const [path, line] of [
    ["docs/architecture/02-architecture.md", "    classDef product fill:#12324f,stroke:#4a90d9,color:#fff"],
    ["shared/brand.mjs", "// the pack (#17150f ground, #ece5d8 text) and error colours with no home at all."],
    ["driver/test/brand.test.mjs", "// #860F09 == --accent, so a High risk dot was pixel-identical to the button."],
    ["portal-ui/test/lockup.test.ts", "// the accent is #860F09 and the ground #17150f"],
  ]) assert.deepEqual(offendingTokens(path, line), [], `a colour was refused: ${line.trim()}`);

  // 2. The all-digit case is the one the digits CANNOT settle: three digits is both a short colour and a
  //    plausible issue number, so the SITE decides — and it must decide both ways.
  assert.deepEqual(
    offendingTokens("docs/architecture/01-product-overview.md", "    classDef note fill:none,stroke:none,color:#888,font-size:12px"),
    [], "a colour whose property names it was refused");
  assert.deepEqual(
    offendingTokens("docs/x.md", "This was decided in #888 last week."),
    ["#888"], "the same digits in prose must still be refused — otherwise the exemption is a hole");

  // 3. The check's whole purpose, unchanged: a bare reference in a comment is still caught.
  assert.deepEqual(offendingTokens("driver/x.mjs", "// see #1431 for the ruling"), ["#1431"]);
  assert.deepEqual(offendingTokens("driver/x.mjs", "// tracker issue 2038 is the right form"), []);
});
