// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SWEEP THAT TAKES A NUMBER OFF A TEST TITLE AND A PERSON OFF A RULING, DRIVEN OVER A PLANTED TREE.
//
// It rewrites thousands of lines in one pass, so what matters is what it does to a line it must not touch.
// Every case is planted rather than read off the repository — "it produced no diff on the files I looked
// at" is not a property. The ways this class of sweep fails, each pinned below:
//   · it eats part of a label, or more than one separator, and leaves a title reading wrong
//   · it strips a number that is the title's own subject, or a numbered string that is somebody's data
//   · it makes two titles in one file the same, so a report can no longer tell them apart
//   · it rewrites a string a user reads, or leaves "the ordered" where "the owner ordered" stood
//   · it breaks the article in front of the word it now stands before, or a phrase wrapped over two lines
//   · it adds or removes a line, and every line citation into the file lands somewhere else
//
// Specimen labels and line citations are BUILT, not written: this file carries no reference and no
// citation of its own for the tree's reference and citation guards to count.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripTitle, stripAttribution, dropOwner, lineKinds, surveyOf, inPopulation, OWN_SPECIMENS, accountFor,
} from "../../scripts/strip-titles-and-attributions.mjs";
import { EXCLUDED } from "../../scripts/strip-tracker-citations.mjs";

const ref = (n) => `#${n}`;
const at = (file, n) => [file, n].join(":");
const title = (src, opts) => stripTitle(src, opts).line;

// ── TITLES ─────────────────────────────────────────────────────────────────────────────────────────

test("the number and one separator go; the title and its quote stay, in every call and quote form", () => {
  assert.equal(title(`test("${ref(1223)} with no research credential the sweep skips", () => {`), 'test("with no research credential the sweep skips", () => {');
  assert.equal(title("test('2087 arm 1 — the sources are the ones spawned', () => {"), "test('arm 1 — the sources are the ones spawned', () => {");
  assert.equal(title(`  test(\`${ref(773)} \${site} on a taken port\`, async () => {`), "  test(`${site} on a taken port`, async () => {");
  assert.equal(title(`it("${ref(300)} a thing happens", () => {`), 'it("a thing happens", () => {');
  assert.equal(title(`describe("${ref(300)} a group", () => {`), 'describe("a group", () => {');
  assert.equal(title(`test.skip("${ref(300)} a skipped arm", () => {`), 'test.skip("a skipped arm", () => {');
});

test("a label is taken WHOLE — a workstream letter, an item suffix or a second number is part of it", () => {
  assert.equal(title(`test("${ref("1957F")} no unparked prose", () => {`), 'test("no unparked prose", () => {');
  assert.equal(title('test("2191-F54 the port is named", () => {'), 'test("the port is named", () => {');
  assert.equal(title(`test("${ref("1135-12")} the walk starts at the root", () => {`), 'test("the walk starts at the root", () => {');
  assert.equal(title(`test("${ref("600.3")} arm 1 — a territory is never a candidate", () => {`), 'test("arm 1 — a territory is never a candidate", () => {');
  assert.equal(title(`test("${ref(526)}/${ref(1067)} a finding that APPEARED is a change", () => {`), 'test("a finding that APPEARED is a change", () => {');
  assert.equal(title('test("193/109 a process belonging to another account", () => {'), 'test("a process belonging to another account", () => {');
  assert.equal(title('test("274/1935: a BANDED card", () => {'), 'test("a BANDED card", () => {');
  assert.equal(title(`test("${ref("1227-10")}/12 no per-country branch decides", () => {`), 'test("no per-country branch decides", () => {');
});

test("exactly ONE separator goes with it — a colon or a dash, never the words after", () => {
  assert.equal(title(`test("${ref(236)}: the arm runs at all", () => {`), 'test("the arm runs at all", () => {');
  assert.equal(title(`test("${ref(1913)} — the refusal names the file", () => {`), 'test("the refusal names the file", () => {');
  assert.equal(title(`test("${ref(1913)} — a — b", () => {`), 'test("a — b", () => {', "a dash inside the title is the title's");
});

test("a remainder opening with a CLI flag or a code span is ordinary, and is rewritten", () => {
  assert.equal(title('test("1911 --dry-run writes nothing", () => {'), 'test("--dry-run writes nothing", () => {');
  assert.equal(title(`test("${ref(1209)} \`enqueue\` refuses", () => {`), 'test("`enqueue` refuses", () => {');
});

test("a number that is not at the front, or a numbered string outside a title, is left alone", () => {
  for (const src of ['test("the 404 page is named", () => {', 'test("a run of 300 rows", () => {',
    `const why = "${ref(850)} rules the envelope";`, `  expected: "${ref(300)} a thing",`, `// ${ref(300)} a comment`])
    assert.deepEqual(stripTitle(src), { line: src, changed: false });
});

test("a number with nothing after it to separate — a possessive, a compound word — is handed off", () => {
  for (const src of [`test("${ref(1340)}'s contract survives the conversion", () => {`, 'test("404-card caveat: a finding carries the line", () => {']) {
    const r = stripTitle(src);
    assert.equal(r.changed, false, src); assert.match(r.handoff, /no separator/);
  }
});

test("a second reference after the label is the title's SUBJECT — handed off whole, so a second run cannot take it", () => {
  for (const src of [`test("${ref(2018)} ${ref(1010)} still fires when the walk finds nothing", () => {`,
    `test("${ref(1564)} ${ref(1556)}'s fetch-lane prohibition is still there", () => {`]) {
    const r = stripTitle(src);
    assert.equal(r.changed, false, src); assert.match(r.handoff, /another reference/);
  }
});

test("a title that opens with a DATE is dated, not labelled, and is handed off", () => {
  const r = stripTitle('test("2026-09-05 the release carries the cut", () => {');
  assert.equal(r.changed, false); assert.match(r.handoff, /date/);
});

test("a bare number the file USES AS A VALUE is the title's subject; the same number only in a string is a label", () => {
  const plant = (body) => ({ "portal-ui/test/http.test.ts": ['test("409 splits: the gate is rendered verbatim", async () => {', ...body, "});"].join("\n") });
  const run = (tree) => surveyOf(Object.keys(tree), (f) => tree[f]);
  const asValue = run(plant(["  const r = await withFetch(409, { error: 'x' });"]));
  assert.equal(asValue.titles.handoff.length, 1, "409 is passed as a value, so the title is about 409");
  assert.match(asValue.titles.handoff[0].why, /value/);
  for (const body of [['  assert.ok(r, "the 409 above is the one");'], ["  // 409 is only mentioned here"], ["  const n = 4090;"]]) {
    const s = run(plant(body));
    assert.deepEqual(s.titles.handoff, [], `a mention that is not a value made the label content: ${body[0]}`);
    assert.match(s.writes["portal-ui/test/http.test.ts"], /^test\("splits: the gate/);
  }
});

test("a title that would open with punctuation, or be empty, is handed off and not rewritten", () => {
  const punct = stripTitle(`test("${ref(300)} , then a clause", () => {`);
  assert.equal(punct.changed, false); assert.match(punct.handoff, /punctuation/);
  const empty = stripTitle(`test("${ref(300)} ", () => {`);
  assert.equal(empty.changed, false); assert.match(empty.handoff, /empty/);
});

// ── ATTRIBUTIONS ───────────────────────────────────────────────────────────────────────────────────

test("the person goes and the ruling and its date stay, in the case it was written in, singular or plural", () => {
  assert.equal(dropOwner("// Owner ruling, 2026-08-29: the file stays private"), "// Ruling, 2026-08-29: the file stays private");
  assert.equal(dropOwner("per owner ruling 2026-08-13"), "per ruling 2026-08-13");
  assert.equal(dropOwner("OWNER RULING S2"), "RULING S2");
  assert.equal(dropOwner("//, owner rulings 2026-08-31 (on demand)"), "//, rulings 2026-08-31 (on demand)");
  assert.equal(dropOwner("an owner steer on the page"), "a steer on the page");
});

test("the article follows the word it now stands before", () => {
  assert.equal(dropOwner("an owner ruling of 2026-08-20"), "a ruling of 2026-08-20");
  assert.equal(dropOwner("An owner ruling"), "A ruling");
  assert.equal(dropOwner("an owner order to stop"), "an order to stop", "'order' takes 'an' — the article is chosen, not deleted");
  assert.equal(dropOwner("a owner order"), "an order");
});

test("where the word after 'owner' is a verb, dropping the person would break the sentence — handed off", () => {
  const r = stripAttribution("// The owner ordered the one product carrying case law", "comment");
  assert.equal(r.changed, false); assert.match(r.handoff, /verb/);
  assert.equal(stripAttribution("// the owner steers it", "comment").changed, false);
});

test("only where a person reads it: a comment or markdown prose is rewritten; a string is handed off", () => {
  assert.equal(stripAttribution("  // Owner ruling, 2026-08-29: x", "comment").line, "  // Ruling, 2026-08-29: x");
  assert.equal(stripAttribution("The owner ruling stands.", "prose").line, "The ruling stands.");
  const inString = stripAttribution('  + "There is one suite (owner ruling 2026-08-07). Point the variable at it"', "code");
  assert.equal(inString.changed, false); assert.match(inString.handoff, /string/);
});

test("an escape in front — the \\n that opens a message string — does not hide the phrase from the rule", () => {
  const r = stripAttribution('  console.error("\\nOwner rulings 2026-09-04: publishing happens in CI");', "code");
  assert.equal(r.changed, false); assert.match(r.handoff ?? "", /string/, "the phrase was not seen at all");
});

test("a possessive in front is a label's, and the line is rewritten like any other", () => {
  assert.equal(stripAttribution("// and — by T3b's owner ruling, deliberately — the run delivers", "comment").line,
    "// and — by T3b's ruling, deliberately — the run delivers");
});

test("line kinds: fences are code; JS, JSX and block comments are comment throughout; .env.example uses #", () => {
  assert.deepEqual(lineKinds("docs/x.md", ["prose", "```", "owner ruling in a fence", "```", "prose again"]),
    ["prose", "code", "code", "code", "prose"]);
  assert.deepEqual(lineKinds("driver/x.mjs", ["// c", " * c", "/* c */", "const x = 1; // trailing"]), ["comment", "comment", "comment", "code"]);
  assert.deepEqual(lineKinds("driver/x.mjs", ["/* opens", "a continuation with no leader", "closes */", "const y = 2;"]),
    ["comment", "comment", "comment", "code"]);
  assert.deepEqual(lineKinds("portal-ui/src/X.tsx", ["      {/* A HEADING — owner ruling", "      the sentence goes on. */}", "      <p>{'owner ruling'}</p>"]),
    ["comment", "comment", "code"]);
  assert.deepEqual(lineKinds("ops/x.sh", ["# c", "echo hi"]), ["comment", "code"]);
  assert.deepEqual(lineKinds(".env.example", ["# c", "X=1"]), ["comment", "code"]);
});

// ── THE SURVEY, OVER A PLANTED TREE ────────────────────────────────────────────────────────────────

const TREE = {
  "driver/test/a.test.mjs": [
    "// Owner ruling, 2026-08-29: the file stays private",
    `test("${ref(300)} a thing happens", () => {});`,
    `test("${ref(301)} another thing", () => {});`,
    'const why = "Owner ruling S1";',
  ].join("\n"),
  // two different titles that become the same — neither may be rewritten, both go to a reader
  "driver/test/collide.test.mjs": [`test("${ref(773)} on a taken port", () => {});`, `test("${ref(808)} on a taken port", () => {});`].join("\n"),
  "docs/notes.md": ["An owner ruling of 2026-08-20 stands.", "```", "owner ruling in a fence", "```",
    "**Two shapes, and the line is what it can do.** Owner", "ruling 2026-09-03, on the vendor's own behaviour:"].join("\n"),
  "driver/wrapped.mjs": [
    "  // a fresh install resolves generic alone (owner",
    "  // ruling, 2026-09-08), so the demo account is refused",
    "      // widening an",
    "      // owner ruling to the most expensive product",
    "const s = `resolves alone (owner",
    "ruling, 2026-09-08)`;",
  ].join("\n"),
  "driver/test/double.test.mjs": [`test("${ref(2018)} ${ref(1010)} still fires", () => {});`].join("\n"),
  "scripts/guard.mjs": ['  console.error("\\nOwner rulings 2026-09-04: publishing happens in CI");'].join("\n"),
  ".env.example": ["# better than never-set-one. Owner ruling, 2026-08-30.", "CLEAROTRON_X="].join("\n"),
  [EXCLUDED[0]]: ["// Owner ruling, 2026-08-29", `test("${ref(300)} excluded", () => {});`].join("\n"),
  [OWN_SPECIMENS[0]]: ["// Owner ruling, 2026-08-29: a specimen this sweep quotes"].join("\n"),
};
const read = (f) => { if (!(f in TREE)) throw new Error("ENOENT"); return TREE[f]; };
const survey = () => surveyOf(Object.keys(TREE), read);

test("the survey rewrites what it should, hands off the rest, and says which is which", () => {
  const s = survey();
  assert.deepEqual(s.titles.rewritten, { "driver/test/a.test.mjs": 2 });
  assert.equal(s.titles.handoff.filter((h) => h.file === "driver/test/collide.test.mjs").length, 2, "both colliding titles are handed off");
  assert.ok(!("driver/test/collide.test.mjs" in s.writes), "and the file is not written at all");
  assert.equal(s.attributions.rewritten["driver/test/a.test.mjs"], 1);
  assert.ok(s.attributions.handoff.some((h) => h.file === "driver/test/a.test.mjs" && /string/.test(h.why)), "the string is handed off");
  assert.ok(s.writes["docs/notes.md"].includes("A ruling of 2026-08-20 stands."));
  assert.ok(s.writes["docs/notes.md"].includes("owner ruling in a fence"), "a code fence is left exactly as it was");
  assert.equal(s.writes[".env.example"].split("\n")[0], "# better than never-set-one. Ruling, 2026-08-30.");
});

test("THE FLOOR: on the planted tree every line an instrument still counts is on a hand-off list", () => {
  assert.deepEqual(survey().unaccounted, []);
});

test("THE FLOOR reports a line no rule saw — neither rewritten nor listed — by file, line and class", () => {
  const lines = ["// a line the rules missed: OWNER RULING, 2026-08-29", `test("${ref(300)} a title the rules missed", () => {});`];
  assert.deepEqual(accountFor("driver/test/x.test.mjs", lines, [], []).map((u) => `${u.line}:${u.class}`), ["1:attribution", "2:title"]);
  assert.deepEqual(accountFor("driver/test/x.test.mjs", lines, [{ file: "driver/test/x.test.mjs", line: 2 }], [{ file: "driver/test/x.test.mjs", line: 1 }]), [],
    "a listed hand-off is accounted for");
});

test("a phrase wrapped over two lines is taken as one, and an article left at a line's end agrees", () => {
  const s = survey();
  assert.deepEqual(s.writes["docs/notes.md"].split("\n").slice(4), [
    "**Two shapes, and the line is what it can do.** Ruling", "2026-09-03, on the vendor's own behaviour:"]);
  assert.deepEqual(s.writes["driver/wrapped.mjs"].split("\n").slice(0, 4), [
    "  // a fresh install resolves generic alone (ruling,",
    "  // 2026-09-08), so the demo account is refused",
    "      // widening a",
    "      // ruling to the most expensive product",
  ]);
  assert.deepEqual(s.writes["driver/wrapped.mjs"].split("\n").slice(4), ["const s = `resolves alone (owner", "ruling, 2026-09-08)`;"],
    "wrapped inside a string, it is left alone");
  assert.ok(s.attributions.handoff.some((h) => h.file === "driver/wrapped.mjs" && h.line === 5));
});

test("no line is added or removed, so a line citation into a swept file still lands", () => {
  const s = survey();
  for (const [f, text] of Object.entries(s.writes))
    assert.equal(text.split("\n").length, TREE[f].split("\n").length, `${f} changed its line count`);
});

test("the opener sweep's excluded files, and this sweep's own specimens, are never swept", () => {
  const s = survey();
  for (const f of [EXCLUDED[0], OWN_SPECIMENS[0]]) {
    assert.ok(!(f in s.writes), `${f} was written`);
    assert.ok(![...s.titles.handoff, ...s.attributions.handoff].some((h) => h.file === f), `${f} was surveyed`);
  }
  assert.equal(inPopulation(".env.example"), true, ".env.example carries the class and must be scanned");
  for (const f of OWN_SPECIMENS) assert.equal(inPopulation(f), false);
});

test("the sweep is a fixed point: run over its own output, it changes nothing", () => {
  const first = survey();
  const swept = { ...TREE, ...first.writes };
  const again = surveyOf(Object.keys(swept), (f) => swept[f]);
  assert.deepEqual(again.writes, {}, "a second pass rewrote something the first pass left");
});

test("a file that cannot be read is REPORTED, not skipped into silence", () => {
  const s = surveyOf(["driver/test/missing.test.mjs", ...Object.keys(TREE)], read);
  assert.deepEqual(s.unreadable.map((u) => u.file), ["driver/test/missing.test.mjs"]);
});

// ── A TITLE ANOTHER LINE QUOTES BY NAME ─────────────────────────────────────────────────────────────

// A table that anchors on a test's full name, the way a guard over discovered loops does: the title, then
// the separator — written as the character, or as its escape in source — then the function inside it.
const REF_TREE = {
  "driver/test/disk.test.mjs": [
    `test("${ref(773)} a disk that cannot hold the run refuses early", () => {});`,
    `test("${ref("2179-F47")} the population this walks is real", () => {});`,
  ].join("\n"),
  "driver/test/table.test.mjs": [
    `  symbol: "${ref(773)} a disk that cannot hold the run refuses early \\u203a walk",`,
    `  proof: "${ref("2179-F47")} the population this walks is real",`,
    `  other: "${ref(773)} a disk that cannot hold the run refuses early › walk",`,
    `  unrelated: "${ref(773)} a disk that cannot hold the run",`,
  ].join("\n"),
};
const refSurvey = (tree) => surveyOf(Object.keys(tree), (f) => { if (!(f in tree)) throw new Error("ENOENT"); return tree[f]; });

test("a title another line quotes by name moves with it — the quote is rewritten in the same pass", () => {
  const s = refSurvey(REF_TREE);
  assert.deepEqual(s.titles.rewritten, { "driver/test/disk.test.mjs": 2 });
  assert.deepEqual(s.writes["driver/test/table.test.mjs"].split("\n"), [
    '  symbol: "a disk that cannot hold the run refuses early \\u203a walk",',
    '  proof: "the population this walks is real",',
    '  other: "a disk that cannot hold the run refuses early › walk",',
    `  unrelated: "${ref(773)} a disk that cannot hold the run",`,
  ], "only a part that IS the title moves; a string that merely starts like it is somebody's data");
  assert.deepEqual(s.references.rewritten, { "driver/test/table.test.mjs": 3 });
  assert.deepEqual(s.unaccounted, []);
});

test("a quote in a file this sweep may not touch keeps the title as it is, and hands the title to a reader", () => {
  const tree = { ...REF_TREE, [EXCLUDED[0]]: `  proof: "${ref(773)} a disk that cannot hold the run refuses early",` };
  const s = refSurvey(tree);
  assert.equal(s.writes["driver/test/disk.test.mjs"].split("\n")[0], REF_TREE["driver/test/disk.test.mjs"].split("\n")[0],
    "the quoted title was renamed anyway");
  assert.ok(s.titles.handoff.some((h) => h.file === "driver/test/disk.test.mjs" && h.line === 1 && /may not touch/.test(h.why)));
  assert.ok(!(EXCLUDED[0] in s.writes), "the excluded file was written");
  assert.ok(s.writes["driver/test/table.test.mjs"].includes(`  symbol: "${ref(773)} a disk that cannot hold the run refuses early \\u203a walk",`),
    "and the population's own quotes of it stay in step with the title that stayed");
  assert.deepEqual(s.unaccounted, []);
});

test("THE FLOOR also reports a quote that still names a title as it was before the rename", () => {
  const rename = (p) => (p === `${ref(773)} a disk` ? "a disk" : undefined);
  assert.deepEqual(accountFor("driver/test/t.mjs", [`  proof: "${ref(773)} a disk",`], [], [], rename).map((u) => u.class), ["reference"]);
});

test("the reference pass is a fixed point too", () => {
  const first = refSurvey(REF_TREE);
  const swept = { ...REF_TREE, ...first.writes };
  assert.deepEqual(refSurvey(swept).writes, {});
});

// ── A LINE THE CITATION RATCHET WOULD READ AS NEW ───────────────────────────────────────────────────

test("a line carrying a bare line citation is handed off — the ratchet reads any rewrite of it as adding one", () => {
  const tree = {
    "driver/cite.mjs": [
      `  // with the form path (owner ruling 2026-08-17, recorded at ${at("vocabulary.mjs", 85)}) and`,
      `  // with the form path (owner ruling 2026-08-17, recorded at ${at("vocabulary.mjs", 85)} recordsFromSearch) and`,
      "  // a fresh install resolves generic alone (owner",
      `  // ruling, 2026-09-08, see ${at("vocabulary.mjs", 85)}), so the demo account is refused`,
    ].join("\n"),
    "driver/test/cite.test.mjs": [`test("${ref(300)} the refusal names ${at("pipeline.mjs", 875)} as the site", () => {});`].join("\n"),
  };
  const s = surveyOf(Object.keys(tree), (f) => tree[f]);
  const out = s.writes["driver/cite.mjs"].split("\n");
  assert.equal(out[0], tree["driver/cite.mjs"].split("\n")[0], "a bare citation's line was rewritten");
  assert.equal(out[1], `  // with the form path (ruling 2026-08-17, recorded at ${at("vocabulary.mjs", 85)} recordsFromSearch) and`,
    "a citation with its symbol beside it is checkable, so its line is rewritten like any other");
  assert.deepEqual(out.slice(2), tree["driver/cite.mjs"].split("\n").slice(2), "a wrapped pair carrying one is held whole");
  assert.ok(!("driver/test/cite.test.mjs" in s.writes), "a title carrying one is held too");
  const held = [...s.titles.handoff, ...s.attributions.handoff].filter((h) => /ratchet/.test(h.why)).map((h) => [h.file, h.line]);
  assert.deepEqual(held.sort(), [["driver/cite.mjs", 1], ["driver/cite.mjs", 3], ["driver/cite.mjs", 4], ["driver/test/cite.test.mjs", 1]]);
  assert.deepEqual(s.unaccounted, []);
});
