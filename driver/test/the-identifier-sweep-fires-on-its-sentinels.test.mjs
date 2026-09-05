// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE IDENTIFIER SWEEP RUNS HERE, AND ITS ZERO IS EARNED.
//
// The matcher ships on this tree; the table of real names does not and must not. So the sweep runs with
// synthetic sentinels, and the only interesting question is whether it can still fire at all. A sweep
// that has never been shown finding something reports the same clean zero as a sweep whose table is
// empty, whose glob broke, or whose regex stopped matching.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanCorpus, firesOn } from "../../shared/identifier-scan.mjs";
import { SENTINELS, SUFFIXABLE } from "../../shared/identifier-sentinels.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const GUARD = "identifier sweep (synthetic sentinels)";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const opts = { retired: SENTINELS, suffixable: SUFFIXABLE };

test("the sweep FIRES on a planted line — this is what makes the zero below mean anything", () => {
  const planted = new Map([
    ["invented/a.mjs", "// a note naming Vantis Orriden in passing"],
    ["invented/b.md", "Thalvic Reach was the counterparty."],
  ]);
  const hits = scanCorpus([...planted.keys()], (f) => planted.get(f) ?? null, opts);
  assert.equal(hits.length, 2, `the sweep missed a planted sentinel: ${JSON.stringify(hits)}`);
  assert.ok(hits.some((h) => /Vantis Orriden/.test(h)), "a hit must NAME what it matched");
  assert.ok(hits.some((h) => /Northwind Partners/.test(h)),
    "…and the twin, because a hit a writer cannot act on is a hit they will route around");
});

test("the suffixable row fires past its trailing boundary, and the ordinary row does not", () => {
  assert.ok(firesOn("Brindlow", "the Brindlows filing", SUFFIXABLE),
    "the suffixable entry stopped matching past its boundary — the option is declared and not working");
  assert.ok(!firesOn("Thalvic Reach", "the ThalvicReachly filing", SUFFIXABLE),
    "a non-suffixable entry matched inside a longer word, which is how a sweep starts crying wolf");
});

test("CONTROL — a line naming none of them is not a hit", () => {
  const clean = new Map([["invented/c.mjs", "// an ordinary comment about nothing in particular"]]);
  assert.deepEqual(scanCorpus([...clean.keys()], (f) => clean.get(f) ?? null, opts), []);
});

// THE TWO FILES THAT ARE MEANT TO NAME THEM. The table declares the sentinels and this file plants
// them, so both contain every string the sweep looks for. They are exempted by literal path and by
// nothing else: a rule like "skip anything that looks like a fixture" would skip the next real one
// too, and a sweep that flagged its own instrument could never be run at all.
const DECLARES_THEM = [
  "shared/identifier-sentinels.mjs",
  "driver/test/the-identifier-sweep-fires-on-its-sentinels.test.mjs",
];

test("the tracked tree names no sentinel", (ctx) => {
  const files = trackedFiles(GUARD, { root: ROOT });
  if (files === null) return ctx.skip(skipReason(GUARD));
  // A FLOOR ON THE CORPUS. Zero files swept is the shape in which this arm passes over a tree it never
  // opened, and it reports exactly the same green as a clean one.
  assert.ok(files.length > 100, `only ${files.length} tracked file(s) swept — the corpus is broken, not the tree`);
  // AND THE EXEMPTION IS HELD TO THE TREE, not taken on trust. If either file is renamed or dropped,
  // this fails by name — rather than the exemption quietly covering nothing while the arm reports the
  // same green, which is how a stale allow-list outlives the reason it was written.
  for (const f of DECLARES_THEM) {
    assert.ok(files.includes(f), `${f} is not a tracked file — the sentinel exemption names a path that is gone`);
  }
  const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };
  const swept = files.filter((f) => !DECLARES_THEM.includes(f));
  assert.deepEqual(scanCorpus(swept, read, opts), [],
    "a synthetic sentinel appears in the tracked tree — it was invented for the two files above and "
    + "should be nowhere else, so either somebody used it as a fixture name or the table has drifted "
    + "into real use");
});

test("CONTROL — the exemption is two paths, and the sweep still reads everything else", (ctx) => {
  const files = trackedFiles(GUARD, { root: ROOT });
  if (files === null) return ctx.skip(skipReason(GUARD));
  assert.equal(DECLARES_THEM.length, 2,
    "the sentinel exemption has grown past the table and its own test — every path added here is a file "
    + "the sweep no longer reads, and that is the failure this whole file exists to catch");
  // The exempted files must be the ones that ACTUALLY carry sentinels, not a pair of quiet paths: sweep
  // them alone and the sweep has to fire. Otherwise the exemption is covering something else.
  const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };
  assert.ok(scanCorpus(DECLARES_THEM, read, opts).length > 0,
    "the exempted files name no sentinel — the exemption is pointed at the wrong files, and the ones "
    + "that do carry them are being swept or are gone");
  assert.ok(files.filter((f) => !DECLARES_THEM.includes(f)).length > 100,
    "the exemption now removes most of the tree from the sweep");
});

test("the sentinel table is not empty, and every row is a pair", () => {
  assert.ok(SENTINELS.length >= 3, `only ${SENTINELS.length} sentinel(s) — an empty table sweeps clean over anything`);
  for (const row of SENTINELS) {
    assert.equal(row.length, 2, `a sentinel row is [name, twin]; got ${JSON.stringify(row)}`);
    assert.ok(row[0].trim() && row[1].trim(), `a sentinel row carries an empty half: ${JSON.stringify(row)}`);
  }
});
