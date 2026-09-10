// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The committed environment classification is what a reviewer reads before authorising a deletion from
// the configuration, and `env-classify --check` is what says it still matches the tree. It used to say
// only "stale", which sends the reader to diff two large JSON files by eye. It now names the rows that
// moved. The check itself needs inputs this tree does not carry, so these drive the comparison it prints
// from; where the inputs are laid, the private control drives the check at its door.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classificationDrift, describeDrift } from "../../scripts/env-classify.mjs";

const row = (name, cls, extra = {}) => ({ name, class: cls, everSet: [], documented: true, ...extra });
const artifact = (rows, counts = { rows: rows.length }) => ({ _counts: counts, rows });

test("a row removed from the artifact is named as removed, and nothing else moves", () => {
  const now = artifact([row("ALPHA", "setup"), row("BRAVO", "tuning")]);
  const d = classificationDrift(artifact([row("ALPHA", "setup"), row("BRAVO", "tuning"), row("CHARLIE", "deployment")]), now);
  assert.deepEqual(d.removed, ["CHARLIE"]);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.changed, []);
  assert.match(describeDrift(d).join("\n"), /1 row\(s\) removed: CHARLIE/);
});

test("a row added, a class changed and a field one side lacks are each named, with the field", () => {
  const before = artifact([row("ALPHA", "setup"), row("BRAVO", "tuning")]);
  const after = artifact([row("ALPHA", "deployment"), row("BRAVO", "tuning", { declared: "tuning" }), row("DELTA", "setup")]);
  const d = classificationDrift(before, after);
  assert.deepEqual(d.added, ["DELTA"]);
  assert.deepEqual(d.changed, [{ name: "ALPHA", fields: ["class"] }, { name: "BRAVO", fields: ["declared"] }]);
  assert.deepEqual(d.header, ["_counts"], "the counts moved with the rows, and are named outside them");
  const said = describeDrift(d).join("\n");
  assert.match(said, /1 row\(s\) added: DELTA/);
  assert.match(said, /2 row\(s\) changed: ALPHA \(class\), BRAVO \(declared\)/);
  assert.match(said, /outside the rows: _counts/);
});

test("the same classification has no drift — the control, without which the arms above prove nothing", () => {
  const a = artifact([row("ALPHA", "setup"), row("BRAVO", "tuning")]);
  const d = classificationDrift(a, structuredClone(a));
  assert.deepEqual(d, { added: [], removed: [], changed: [], header: [] });
  assert.match(describeDrift(d).join("\n"), /no row differs/);
});

test("an artifact that could not be read reads as every row added, and says why", () => {
  const now = artifact([row("ALPHA", "setup")]);
  const d = classificationDrift(null, now);
  assert.deepEqual(d.added, ["ALPHA"]);
  assert.match(describeDrift(d, { unreadable: true }).join("\n"), /not valid JSON, so every row below reads as added/);
  assert.match(describeDrift(d, { missing: true }).join("\n"), /absent, so every row below reads as added/);
});

test("a long list is capped and says how many more there are", () => {
  const names = Array.from({ length: 15 }, (_, i) => `NAME_${String(i).padStart(2, "0")}`);
  const d = classificationDrift(artifact([]), artifact(names.map((n) => row(n, "tuning"))));
  const said = describeDrift(d, { cap: 12 }).join("\n");
  assert.match(said, /15 row\(s\) added: NAME_00, .*NAME_11 and 3 more/);
  assert.doesNotMatch(said, /NAME_12/);
});
