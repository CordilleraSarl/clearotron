// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// query-vocabulary.test.mjs — the seam between the plan's `match_mode` and this store's `predicate`.
//
// EVERY FAILURE HERE PRODUCES A WELL-FORMED BAND. The frozen plan's executor builds its queries with
// planPredicateParams → defaultBuildEntryQuery, which emit `{ match_mode }` and never `predicate`; the
// count adapter passes `matchMode` down the same way. A store that reads only `predicate` therefore
// ignores what every plan entry asked for and answers with its default — an unanchored contains.
//
// Graded consequences, and the tests are ordered by how bad:
//   1. an `exact` slice widens to a contains         — a band wider than the plan froze
//   2. a `*TERM` slice widens to a contains          — likewise
//   3. a `phonetic` slice runs as a contains         — a CLEAN NEGATIVE for a search this source
//                                                      cannot perform (capabilities.predicates.phonetic
//                                                      is null); doctrine rule 2, broken
//   4. a `*TERM*` pattern searches for a literal `*` — zero rows, state:"enumerated". A FALSE CLEAN.
//
// Case 4 is the one worth staring at: corsearch and clarivate pass `*` through to a query language
// that understands it, so the shared kernel forwards the raw pattern by design. SQLite's LIKE reads it
// as an ordinary character.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openIndex, createSchema, putRecords, rebuildFts, setMeta } from "../src/index-store.js";
import { doSearch, doCount, doCountHits, resetHandles } from "../src/core.js";
import { CAPABILITY_GAP_MARKER, isCapabilityGap, planPredicateParams, defaultBuildEntryQuery }
  from "../../_shared/execute-plan.mjs";

const parse = (r) => JSON.parse(r.text);

// The provider cores append to the SHARED register ledger, whose path is read at module load. Point it
// at a scratch file: unset, these tests write into the pre- telemetry directory, which on the test box is a
// file other users' runs are reading.
const LEDGER = mkdtempSync(join(tmpdir(), "uspto-ledger-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(LEDGER, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(LEDGER, "records.jsonl");
test.after(() => { try { rmSync(LEDGER, { recursive: true, force: true }); } catch { /* gone */ } });


// One exact match, one that merely CONTAINS the term, one that ends with it, one that starts with it.
// If a predicate is being ignored, these four are what tell the difference.
const ROWS = [
  { serial: "80000001", text: "ARBORA", status: "700", classes: ["009"], owner: "ARBORA HOLDINGS SA" },
  { serial: "80000002", text: "NOVARBORAX", status: "700", classes: ["009"], owner: "NOVA SA" },
  { serial: "80000003", text: "NOVARBORA", status: "700", classes: ["009"], owner: "NOVA SA" },
  { serial: "80000004", text: "ARBORAWORKS", status: "700", classes: ["009"], owner: "AW SA" },
];

let dir, auth;
test.before(() => {
  dir = mkdtempSync(join(tmpdir(), "uspto-vocab-"));
  const path = join(dir, "us.db");
  const db = createSchema(openIndex(path));
  putRecords(db, ROWS);
  rebuildFts(db);
  setMeta(db, "records", String(ROWS.length));
  setMeta(db, "backfile_through", new Date().toISOString());   // a complete build; see
  setMeta(db, "newest_delta", new Date().toISOString());
  db.close();
  resetHandles();
  auth = { dbPath: path };
});
test.after(() => { try { resetHandles(); rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });

const texts = async (q) => parse(await doSearch(auth, q)).results.map((r) => r.mark_text).sort();

test("match_mode:exact is an exact match, not the default contains", async () => {
  assert.deepEqual(await texts({ name: "ARBORA", match_mode: "exact" }), ["ARBORA"]);
  // The proof that the assertion above means anything: the default really does return all four.
  assert.equal((await texts({ name: "ARBORA" })).length, 4);
});

test("match_mode:starts_with and ends_with each anchor their own end", async () => {
  assert.deepEqual(await texts({ name: "ARBORA", match_mode: "starts_with" }), ["ARBORA", "ARBORAWORKS"]);
  assert.deepEqual(await texts({ name: "ARBORA", match_mode: "ends_with" }), ["ARBORA", "NOVARBORA"]);
});

test("the driver's Stage 0.5 count vocabulary reaches the index", async () => {
  // register-count.mjs COUNT_PREDICATES: matchMode "exact" (Identical) and "default" (Containing).
  // Ignore match_mode and the two columns report the same number for every mark in every report.
  const identical = await doCountHits(auth, { name: "ARBORA", match_mode: "exact" });
  const containing = await doCountHits(auth, { name: "ARBORA", match_mode: "default" });
  assert.equal(identical.total, 1);
  assert.equal(containing.total, 4);
  assert.notEqual(identical.total, containing.total,
    "Identical and Containing must be able to differ — two columns that always agree are one column");
});

test("a phonetic slice is REFUSED as a capability gap, never answered as a contains", async () => {
  // capabilities.predicates.phonetic is null. The compiler stamps such a slice `unsupported` before it
  // is ever dispatched, and this is the second lock: if one reaches the store anyway it must refuse.
  const s = await doSearch(auth, { name: "ARBORA", match_mode: "phonetic" });
  assert.ok(s.isError, "a phonetic search is an error, never a result set");
  assert.ok(isCapabilityGap(s.text),
    `the refusal must carry ${CAPABILITY_GAP_MARKER} so the executor DEFERS it as a disclosed gap `
    + "rather than grinding the repair ladder over an answer that will never change");
  assert.match(s.text, /no phonetic or fuzzy surface/);

  const c = await doCount(auth, { name: "ARBORA", match_mode: "phonetic" });
  assert.equal(c.ok, false);
  assert.equal(c.total, null, "UNKNOWN is null — a capability we lack must never read as the number 0");
  assert.ok(isCapabilityGap(c.reason));
});

test("a both-anchored wildcard is an infix, not a literal search for an asterisk", async () => {
  // THE FALSE CLEAN. planPredicateParams de-anchors a SINGLE-ended pattern for us and returns {} for a
  // both-ended one, so the raw `*ARBORA*` rides through to a LIKE that reads `*` as an ordinary char.
  const pp = planPredicateParams({ predicate: "wildcard", term: "*ARBORA*" });
  assert.deepEqual(pp, {}, "the kernel really does forward this pattern unchanged — that is the setup");
  const q = defaultBuildEntryQuery({ predicate: "wildcard", term: "*ARBORA*", nice_classes: [9] }, pp);
  assert.equal(q.name, "*ARBORA*", "the stars reach the provider");

  const out = parse(await doSearch(auth, q));
  assert.equal(out.total_hits, 4, "the anchors are stripped and the pattern is served as an infix");
  assert.ok(!out.results.some((r) => r.mark_text.includes("*")));
});

test("a single-anchored pattern the kernel already de-anchored still lands on the right predicate", async () => {
  const pp = planPredicateParams({ predicate: "wildcard", term: "*ARBORA" });
  assert.deepEqual(pp, { match_mode: "ends_with", __term: "ARBORA" });
  const q = defaultBuildEntryQuery({ predicate: "wildcard", term: "*ARBORA", nice_classes: [9] }, pp);
  assert.deepEqual(parse(await doSearch(auth, q)).results.map((r) => r.mark_text).sort(),
    ["ARBORA", "NOVARBORA"]);
});

test("an INTERNAL wildcard is refused rather than searched literally", async () => {
  // Stripping the anchors cannot rescue `AR*RA`: there is no wildcard query language underneath, and a
  // literal search for it finds nothing and reads as a clean.
  const s = await doSearch(auth, { name: "AR*RA", match_mode: "default" });
  assert.ok(s.isError);
  assert.ok(isCapabilityGap(s.text));
  assert.match(s.text, /no wildcard query language/);
});

test("an explicit native predicate still wins, and an elementless call still says so", async () => {
  assert.deepEqual(await texts({ name: "ARBORA", predicate: "exact" }), ["ARBORA"]);
  // The element check runs BEFORE the predicate resolves, so a query with nothing to search for gets
  // the message about its real problem rather than one about a match mode it never reached.
  const s = await doSearch(auth, { match_mode: "phonetic" });
  assert.ok(s.isError);
  assert.match(s.text, /at least one search element/);
});
