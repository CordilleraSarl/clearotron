// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// - ONE REPEAT DETECTOR, THREE RECEIVERS, AND THE ONE OF THEM WHOSE KEY IS A POSITION.
//
// doubt-closure, coverage and declination can each be handed a batch they have already been sent. Three
// hand-written copies of that check is the dictated-shape-in-N-places defect this tree keeps paying for,
// so the detector lives in `call-repeat.mjs` and each receiver supplies what genuinely differs.
//
// The load-bearing asymmetry: coverage's `row_id` is CONTENT-DERIVED and doubt-closure's `doubt_id` is
// frozen for the life of the stage, so neither needs a generation key. Declination identifies rows by
// `row_index` - a POSITION into a spec the driver rewrites between the main and the corrective pass - so
// a match across that rewrite would compare positions into two different lists. The generation key is
// what makes that safe, and the arm proving it STOPS matching is the one worth having.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { idSetHash, priorCallWithIdSet, listGeneration } from "../call-repeat.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("#1239 the fingerprint is over the ITEMS, not their order or their repetition in one call", () => {
  const a = idSetHash([{ row_id: "B" }, { row_id: "A" }, { row_id: "B" }], { idField: "row_id" });
  const b = idSetHash([{ row_id: "A" }, { row_id: "B" }], { idField: "row_id" });
  assert.equal(a, b, "order or in-call repetition changed the fingerprint");
  assert.notEqual(a, idSetHash([{ row_id: "A" }], { idField: "row_id" }), "a different item set hashed the same");
});

test("#1239 a call naming no items has no fingerprint and can never be a repeat", () => {
  // null rather than the hash of an empty string: there is nothing to be identical TO, and a shared hash
  // for "carried nothing" would make every empty call a repeat of the first empty one.
  assert.equal(idSetHash([], { idField: "row_id" }), null);
  assert.equal(idSetHash([{ row_id: "" }, { row_id: "   " }], { idField: "row_id" }), null);
  assert.equal(priorCallWithIdSet("/nonexistent/index.jsonl", null), null);
});

test("#1239 the idField is REQUIRED - a hash over the wrong property matches nothing, silently", () => {
  // The failure this refuses is the quiet one: hash a property no row carries and every call returns
  // null, so the detector reports no repeats forever and reads exactly like a clean tree.
  assert.throws(() => idSetHash([{ row_id: "A" }], {}), /idField is required/);
});

test("#1239 the GENERATION KEY splits a match, which is what makes a positional id safe", () => {
  const rows = [{ row_index: 0 }, { row_index: 1 }];
  const g1 = idSetHash(rows, { idField: "row_index", generation: "listA" });
  const g2 = idSetHash(rows, { idField: "row_index", generation: "listB" });
  assert.notEqual(g1, g2, "the same POSITIONS against two different lists hashed identically");
  assert.equal(g1, idSetHash(rows, { idField: "row_index", generation: "listA" }), "the same generation did not agree with itself");
});

test("#1239 listGeneration is CONTENT-derived, so a rewrite of the identical list does not split it", () => {
  // A timestamp would split whenever the writer ran, including when it rewrote the same rows - which
  // would report every repeat as new work and quietly stop the detector doing anything at all.
  const rows = [{ ordinal: 1, mark: "A" }, { ordinal: 2, mark: "B" }];
  assert.equal(listGeneration(rows), listGeneration([{ ordinal: 1, mark: "A" }, { ordinal: 2, mark: "B" }]),
    "an identical list produced a different generation - a rewrite would read as a new edition");
  assert.notEqual(listGeneration(rows), listGeneration([{ ordinal: 1, mark: "A" }]),
    "a changed list shares a generation with the old one - positions would be compared across editions");
  assert.notEqual(listGeneration([]), listGeneration(rows));
});

// -- the wiring: one implementation, three receivers ------------------------------------------------

test("#1239 all three receivers use the SHARED detector - no second copy of the shape", () => {
  // The reason this module exists. A receiver that grows its own `createHash` over an id list is the
  // third copy arriving, and it would drift from the other two without anything failing.
  const offenders = [];
  for (const f of ["doubt-closure-tool.mjs", "coverage-tool.mjs", "declination-tool.mjs"]) {
    const src = readFileSync(join(HERE, "..", f), "utf8");
    if (!/from "\.\/call-repeat\.mjs"/.test(src)) offenders.push(`${f} does not import the shared detector`);
    if (/createHash\(/.test(src)) offenders.push(`${f} hashes on its own - a second copy of the detector`);
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("#1239 the positional receiver passes a generation and the others deliberately do not", () => {
  // Stated as a test because it is the asymmetry a future edit is most likely to flatten - either by
  // adding a generation everywhere (harmless but meaningless) or by dropping declination's (unsafe).
  const decl = readFileSync(join(HERE, "..", "declination-tool.mjs"), "utf8");
  // COUNTED, not matched. Declination hashes in TWO places - the capture and the pre-capture question -
  // and a single `assert.match` passes while one of them silently loses its generation. Found by seeding
  // exactly that and watching this arm stay green.
  const keyed = (decl.match(/idField: "row_index", generation/g) ?? []).length;
  const bare = (decl.match(/idField: "row_index"\s*\}/g) ?? []).length;
  assert.equal(keyed, 2, `declination keys ${keyed} of its 2 hash sites to a generation`);
  assert.equal(bare, 0, `${bare} declination hash site(s) use the positional key with NO generation`);
  assert.match(decl, /listGeneration\(spec\?\.rows\)/,
    "declination's generation is no longer derived from the spec row list its positions index into");

  const cov = readFileSync(join(HERE, "..", "coverage-tool.mjs"), "utf8");
  assert.match(cov, /idField: "row_id"/, "coverage stopped keying on its content-derived row id");
});
