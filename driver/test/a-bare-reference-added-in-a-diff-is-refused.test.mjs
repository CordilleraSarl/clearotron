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
import { CLASSES, isProse, isScannable, withoutLinkTargets, offendingTokens, addedLines } from "../../scripts/added-reference-check.mjs";

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

// THE SPELLED FORM WAS THIS CHECK'S OWN REMEDY, AND THAT IS WHY THE FLIP NEEDS SAYING OUT LOUD. The
// two assertions here used to require `tracker issue NNN` to pass, because it carries no hash and
// GitHub cannot linkify it. That was right about the linkifying and beside the point: the tree carries
// the reason for a decision, never its address, and a reader outside this project cannot open the
// number in either spelling. The citation belongs in the commit message and the pull request body.
//
// Anyone reading a blame here will find the guard telling authors to write the exact form it now
// refuses. Both directions are asserted below so neither reading can be inferred from silence.
test("the spelled citation form is refused too — the hash was never the whole problem", () => {
  assert.deepEqual(offendingTokens("driver/x.mjs", "  // ruled on tracker issue 1234"), ["tracker issue 1234"]);
  assert.deepEqual(offendingTokens("docs/x.md", "Ruled on tracker issue 1234."), ["tracker issue 1234"]);
  assert.deepEqual(offendingTokens("driver/x.mjs", "  // see tracker issues 1234 and 1235"), ["tracker issues 1234"],
    "the plural is the same citation and must not be a way around it");

  // AND THE REASON STILL PASSES. The remedy is to say why, not to find an unbanned spelling of where,
  // so a comment that explains itself with no number in it has to survive — otherwise the guard is
  // teaching authors to delete the explanation.
  assert.deepEqual(offendingTokens("driver/x.mjs", "  // the register answers twice, so the second read wins"), []);
  assert.deepEqual(offendingTokens("docs/x.md", "The issue was that two reads disagreed."), [],
    "`issue` as an ordinary noun is not a citation");
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
  assert.deepEqual(offendingTokens("driver/x.mjs", "// tracker issue 2038 is the right form"), ["tracker issue 2038"],
    "the spelled form is a class of its own now — see the arm above for why the comment it replaced was wrong");
});

// ── THE CLASSES ADDED BEYOND THE REFERENCE ──────────────────────────────────────────────────────
//
// A guard reads what it is given, so every arm below is written as a PAIR: the thing that must be
// refused, and the nearest thing to it that must pass. The refusals are cheap to get right and the
// passes are where a widened pattern gets found — each of the three false positives asserted here was
// live in the tree while the pattern that would have refused it was being written.

test("an account name from the build machines is refused, and the documented placeholder is not", () => {
  assert.deepEqual(offendingTokens("driver/x.mjs", "// driven on testuser, 2026-09-05"), ["testuser"]);
  assert.deepEqual(offendingTokens("docs/x.md", "The timer runs as azureuser."), ["azureuser"]);
  assert.deepEqual(offendingTokens("driver/test/README.md", "root      devuser1"), ["devuser1"],
    "the numbered form is the same account family, and it is how the logins actually appear");

  // THE PLACEHOLDER IS WHAT A STRANGER COPIES FIRST. `/home/you/...` is what INSTALL.md and docs/E2E.md
  // tell a reader to write, so a `/home/<anything>/` rule would refuse the install instructions on the
  // page the guard exists to protect. This is the pass that decided the pattern names the accounts.
  assert.deepEqual(offendingTokens("INSTALL.md", "CLEAROTRON_REPORTS_DIR=/home/you/trademark/pool"), []);
  assert.deepEqual(offendingTokens("docs/E2E.md", "CLEAROTRON_WORK_DIR=/home/you/trademark-dev/workspace"), []);
  assert.deepEqual(offendingTokens("docs/x.md", "A user directory is not a finding."), [],
    "`user` on its own is an ordinary word");
});

test("a home directory on a build machine is refused", () => {
  // ONE CLASS, NOT TWO. `clearotron` is the product's own name and the account the package installs
  // as; it is not in the login class, because a tree that could not say `clearotron` could not
  // document itself. It is the PATH that is private, so only the path class fires.
  assert.deepEqual(offendingTokens("bin/start.mjs", "// /home/clearotron/trademark/pool — the published directory"),
    ["/home/clearotron"]);
  assert.deepEqual(offendingTokens("docs/x.md", "Reports land under /home/testuser/trademark/pool."),
    ["testuser", "/home/testuser"]);
});

// THE ONE CLASS THIS TREE CANNOT SPELL, and the arm says so rather than leaving an absence.
//
// The class had a pattern naming two private repositories as literals, in a file that ships in the
// tree it protects — the guard publishing exactly what it refuses. The literals belong with the
// personal names in the private table; what is left here is the declaration and the reason.
//
// ASSERTED IN BOTH DIRECTIONS, because "it does not fire" is also what a broken class looks like. The
// entry must still be in the table with a `why` a reader can act on, and it must genuinely not match.
test("the private-repo-name class is DECLARED and deliberately unspellable here", () => {
  const entry = CLASSES.find((c) => c.id === "private-repo-name");
  assert.ok(entry, "the class is gone from the table, so the census lost a column and the reason went with it");
  assert.equal(entry.pattern, null,
    "this class has a pattern again. A repository name is a unique identifier of a private asset, and a "
    + "pattern here spells it in the public tree — which is this class's own `why`, applied to itself");
  assert.match(entry.why, /private merge scan/,
    "the entry does not say where the class IS enforced, so its absence here reads as nothing to check");

  // AND IT DOES NOT FIRE. A declared class with no pattern must be skipped, not crash and not match
  // everything — both of which a `null` reaching a regex call would produce.
  assert.deepEqual(offendingTokens("docs/x.md", "Some repository name goes here."), []);
  assert.deepEqual(offendingTokens("driver/x.mjs", "// see the other repository for the ruling"), []);

  // The other seven still fire, so the skip did not take the loop with it.
  assert.deepEqual(offendingTokens("driver/x.mjs", "// driven on testuser"), ["testuser"]);
});

test("our own word for how this is built is refused, and product prose that looks like it is not", () => {
  assert.deepEqual(offendingTokens("driver/x.mjs", "// relayed by role-overwatch"), ["role-overwatch"]);
  assert.deepEqual(offendingTokens("driver/x.mjs", "// the defect role-e2e measured is one of two"), ["role-e2e"]);
  assert.deepEqual(offendingTokens("shared/x.mjs", "// Overwatch ruled on this the same day."), ["Overwatch"]);
  assert.deepEqual(offendingTokens("docs/x.md", "See the clearance-runs notes."), ["clearance-runs"]);

  // `role-shaping` IS PRODUCT PROSE AND IT IS LIVE. driver/portal-service.mjs describes what the report
  // does with a party's role in exactly these words. A `role-\w+` rule refuses it, which would put the
  // guard's first false positive on the engine's own comments — so the four are spelled out.
  assert.deepEqual(offendingTokens("driver/portal-service.mjs", "// role-shaping left: the held-run suppression is retired"), []);
  assert.deepEqual(offendingTokens("driver/x.mjs", "// the owner's role in the mark is what decides"), []);

  // `deploy` IS A SKILL NAME AND IS DELIBERATELY NOT BANNED — an ordinary English word whose paragraph
  // would be refused line by line.
  assert.deepEqual(offendingTokens("docs/x.md", "Deploy the package, then confirm health."), []);
});

test("an attribution trailer is refused in either spelling", () => {
  // TWO CLASSES ON ONE LINE, reported in table order: the trailer carries a role name, so the role
  // class fires as well. Both are said, because a reader who removes only the trailer has left half.
  assert.deepEqual(offendingTokens("docs/x.md", "Agent: role-dev · someone"), ["role-dev", "Agent: role-dev"]);
  assert.deepEqual(offendingTokens("driver/x.mjs", "// Agent: role-design"), ["role-design", "Agent: role-design"]);

  // THE MACHINE-WRITTEN ONE IS THE ONE THAT LANDS, because nobody reads it as prose — it arrives in a
  // template and survives review by looking like machinery.
  assert.deepEqual(offendingTokens("docs/x.md", "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"),
    ["Co-Authored-By: Claude"]);
  assert.deepEqual(offendingTokens("docs/x.md", "Generated with [Claude Code](https://claude.com/claude-code)"),
    ["Generated with [Claude"]);
  assert.deepEqual(offendingTokens("driver/x.mjs", "// Claude-Session: https://example.test/x"), ["Claude-Session:"]);

  // NAMING THE TOOL IS NOT THE TRAILER. Prose about the CLI is ordinary documentation and the guard
  // must not refuse it, or the first thing it costs is the ability to write about the tooling.
  assert.deepEqual(offendingTokens("docs/x.md", "Run the claude CLI from the project root."), []);
  assert.deepEqual(offendingTokens("docs/x.md", "An agent role is not a trailer."), []);
});

test("the two trees this guard does not read stay unread, in both directions", () => {
  // A hit in either tree must come back empty — not because the line is clean, but because the path is
  // not read. The same line under a read path is asserted beside it, so an empty result cannot be the
  // pattern having quietly stopped matching.
  const line = "// driven on testuser against tracker issue 1234";
  assert.deepEqual(offendingTokens("demo/full-country-search/x.mjs", line), []);
  assert.deepEqual(offendingTokens("driver/skills/matter-frame/SKILL.md", line), []);
  assert.deepEqual(offendingTokens("driver/x.mjs", line), ["tracker issue 1234", "testuser"],
    "the same line under a read path must fire — otherwise the exclusion above proves nothing");

  assert.equal(isScannable("demo/x.json"), false);
  assert.equal(isScannable("driver/skills/x.md"), false);
  assert.equal(isScannable("driver/demo-notes.mjs"), true,
    "the exclusion is a directory, not a prefix — `demo` inside a filename is not the demo tree");
});
