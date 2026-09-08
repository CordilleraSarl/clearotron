// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The last gate before a package is published — tracker issue 264.
//
// Three invented account names, and the fixture files that use them, shipped in every published version
// and nothing went red. The two checks that stood between them and the registry each answered a
// different question: `files[]` excludes paths and these were mentions, and `verify-publishable` proves
// the package runs without reading what it says.
//
// These arms hold the one that asks. The pure halves take injected entries and an injected list, because
// a publish gate that can only be driven by publishing cannot be shown to fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { namesFor, scanEntries, fixtureFilesIn, missingFrom, MUST_SHIP } from "../../scripts/no-test-account-reaches-the-package.mjs";
import { TEST_ACCOUNT_NAMES, ALLOWED_CONTEXTS } from "../../scripts/test-account-names.mjs";

test("264 a name in a member's TEXT is found, wherever in the tree it sits", () => {
  const hits = scanEntries([{ path: "docs/E2E.md", text: "the run for Vantablack Corp is the example" }], ["Vantablack"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, "docs/E2E.md");
});

test("264 a name in the PATH is found even when the bytes are unreadable", () => {
  // A binary member reads as empty text; the path is still the disclosure.
  const hits = scanEntries([{ path: "driver/profiles/vantablack.json", text: "" }], ["Vantablack"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 0);
});

test("264 WHOLE-WORD: a name inside a longer word is not a hit", () => {
  assert.deepEqual(scanEntries([{ path: "x.md", text: "the vantablackbird sings" }], ["Vantablack"]), []);
});

test("264 CASE-INSENSITIVE: the lowercase form in a path is the same disclosure", () => {
  assert.equal(scanEntries([{ path: "a/vantablack/b.json", text: "" }], ["Vantablack"]).length, 1);
});

test("264 a clean package is CLEAN — the refusals are not universal", () => {
  const entries = [{ path: "README.md", text: "nothing to see" }, { path: "lib/a.mjs", text: "export const a = 1;" }];
  assert.deepEqual(scanEntries(entries, ["Vantablack"]), []);
  assert.deepEqual(fixtureFilesIn(entries), []);
});

test("264 the manifest's own EXCLUSION line is not a mention of what it excludes", () => {
  // `files[]` carries `"!driver/profiles/<name>.json"` whose whole job is to remove the file. Reading it
  // as an occurrence makes the gate refuse the rule that fixes the problem.
  const entries = [{ path: "package.json", text: '  "files": [\n    "!driver/profiles/vantablack.json"\n  ]' }];
  assert.deepEqual(scanEntries(entries, ["Vantablack"]), []);
  // But a name anywhere else in the manifest is still a hit, or the exemption is a hole.
  const named = [{ path: "package.json", text: '  "author": "Vantablack"' }];
  assert.equal(scanEntries(named, ["Vantablack"]).length, 1);
});

test("264 a list that cannot be used is a COULD-NOT-LOOK, never an empty list", () => {
  // Each yields "no names", and none of them means the package is clean. The blank entry is the one
  // measured elsewhere: escaped and matched, it matches every line.
  for (const [why, list] of [
    ["not a list", null],
    ["an empty list", []],
    ["a blank entry", ["aurora", "  "]],
  ]) {
    const { error, names } = namesFor(list);
    assert.ok(error, `${why} must be an error rather than an empty list`);
    assert.deepEqual(names, [], why);
  }
});

test("264 the real shipped list loads and is usable, so the could-not-looks are not the only outcome", () => {
  // Without this every arm above is satisfied by a list that never loads.
  const { error, names } = namesFor(TEST_ACCOUNT_NAMES);
  assert.equal(error, null);
  assert.ok(names.length >= 3, "the shipped list must carry the fixture account names");
  assert.equal(scanEntries([{ path: "docs/x.md", text: `the ${names[0]} matter` }], names).length, 1);
});

test("264 AN ORDINARY USE OF THE WORD is exempt by its CONTEXT, not by its file", () => {
  // One of the three is also an ordinary English word, and the shipped register reference data carries
  // it as a goods term. Without the exemption the gate refuses every release on correct data.
  const line = '{"basic_no":"240094","nice_class":24,"name_en":"zephyr [cloth]","name_zh_tw":"薄織布"}';
  const path = "providers/jx-subclass/public/goods.jsonl";
  assert.deepEqual(scanEntries([{ path, text: line }], ["zephyr"], ALLOWED_CONTEXTS), []);
});

test("264 the exemption clears the LINE and not the FILE", () => {
  // Without this the arm above is satisfied by exempting the whole file, and a genuine leak into the
  // same file would ride out behind the legitimate line.
  const path = "providers/jx-subclass/public/goods.jsonl";
  const entries = [{ path, text: '{"name_en":"zephyr [cloth]"}\n{"account":"zephyr","owner":"x"}' }];
  const hits = scanEntries(entries, ["zephyr"], ALLOWED_CONTEXTS);
  assert.equal(hits.length, 1, "the second line is an account name and must still refuse");
  assert.equal(hits[0].line, 2);
});

test("264 a FIXTURE FILE is refused even when nothing in it writes an account name", () => {
  // The second clause, and it fails for a different reason: a fixture whose body never names its account
  // is invisible to the name scan and is still a file no installer can use.
  const entries = [
    { path: "driver/test/a-thing.test.mjs", text: "export const x = 1;" },
    { path: "mcp-server/test/fixtures/run.json", text: "{}" },
    { path: "shared/helper.mjs", text: "export const y = 2;" },
  ];
  assert.deepEqual(scanEntries(entries, TEST_ACCOUNT_NAMES), [], "no account name anywhere in these");
  assert.deepEqual(fixtureFilesIn(entries).sort(), [
    "driver/test/a-thing.test.mjs",
    "mcp-server/test/fixtures/run.json",
  ]);
});

test("264 a BUNDLED DEPENDENCY's own tests are not ours, and refusing on them refuses every release", () => {
  // `files[]` does not filter a bundled dependency — npm packs each one's published tree entire — so a
  // third-party `test/` directory is not something this repository can remove. Measured on the packed
  // bytes: 71 such members and not one of ours. Without this the clause is permanently red.
  const entries = [
    { path: "node_modules/binary/test/bu.js", text: "" },
    { path: "node_modules/a/b/fixtures/x.json", text: "{}" },
    { path: "driver/test/ours.test.mjs", text: "" },
  ];
  assert.deepEqual(fixtureFilesIn(entries), ["driver/test/ours.test.mjs"],
    "a dependency's own tests are out of scope; ours are still caught");
});

test("157 the package is refused when it carries no house risk framework to rate under", () => {
  // Every other assertion here is an absence, and an absence check cannot tell a clean package from one
  // missing half of itself. These four ship today only because the exclusion patterns carry a hyphen
  // (`risk-framework-*`) and the house defaults carry a dot — they survive by not matching. A pattern
  // widened to `risk-framework*` would drop the framework every fresh install rates its first clearance
  // under, and would pass every other line in this file.
  const full = MUST_SHIP.map((path) => ({ path: `package/${path}`, text: "" }));
  assert.deepEqual(missingFrom(full), [], "a package carrying all four is not refused");

  const withoutFramework = full.filter((e) => !e.path.endsWith("risk-framework.manifest.json"));
  assert.deepEqual(missingFrom(withoutFramework), ["driver/skills/prelim-search/risk-framework.manifest.json"]);

  assert.equal(missingFrom([]).length, MUST_SHIP.length, "an empty package is missing all of them");
});

test("157 a FIXTURE framework is not the house default — the match is exact, not a substring", () => {
  // Without this the arm above is satisfied by a check that accepts risk-framework-demo.manifest.json
  // in place of the default, which is the shape the hyphen/dot accident produces in the first place.
  const decoys = [
    { path: "package/driver/skills/prelim-search/risk-framework-demo.md", text: "" },
    { path: "package/driver/skills/prelim-search/risk-framework-demo.manifest.json", text: "" },
    { path: "package/driver/skills/prelim-search/worked-examples-demo.md", text: "" },
    { path: "package/driver/profiles/demo-brand-owner.json", text: "" },
  ];
  assert.deepEqual(missingFrom(decoys), [...MUST_SHIP], "the fixtures satisfy none of the four");
});

test("264 a path that merely CONTAINS the word test is not a fixture", () => {
  // Without this the clause above is satisfied by a substring match, which would refuse ordinary code.
  assert.deepEqual(fixtureFilesIn([
    { path: "driver/latest-run.mjs", text: "" },
    { path: "docs/testing.md", text: "" },
    { path: "shared/contest.mjs", text: "" },
  ]), []);
});
