// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A JUDGE MAY CITE A RECORD BY ITS BARE REGISTER ID, AND IT IS FILED UNDER THE RECORD IT NAMES.
//
// The run holds each record under its full id, the office before the register's own id. A tool's answer
// can also show a record by the register's id alone (a designation inside another record, say), and a
// judge cited records that way: on a test clearance one judge was refused twice for records the run did
// hold, and only its third attempt passed. The register-side twin of the web-page fix beside this file.
// A bare id now resolves to the one held record whose id ends with it, in the check and in the merge
// alike; one that matches no record, or several, is still refused. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPile } from "../pile.mjs";
import { buildOwnerTable } from "../owner-table.mjs";
import { writeJudgmentFacts, checkJudgmentFile, checkAnswer, mergeJudgments, JUDGMENT_FACTS_FILE, FATES } from "../owner-judgment.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const PILE = join(import.meta.dirname, "fixtures", "owner-pile");
const SCALE = parseFrameworkManifest({
  schema_version: 1, framework_key: "orchard-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company", bands: [{ label: "High", tone: "high" }, { label: "Low", tone: "low" }],
  structure: { kind: "bands" },
});
const carry = (records) => ({ owners: ["Owner One K.K."], decision: "carry", records, rating: "High",
  marks_alike: "same", goods_close: "same", reason: "The same mark, live, in the order's classes." });
const answer = (considered) => ({ considered, overall_rating: "High", advice: "Invented advice.", questions_wished_for: [] });

test("a bare id the run holds passes the check, through the real facts the driver writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-bare-id-"));
  try {
    cpSync(PILE, dir, { recursive: true });
    const pile = loadPile(dir);
    assert.ok(pile.recordById.has("/mark/AA/0000-A1"), "premise: the invented pile holds the full id");
    writeJudgmentFacts(driverDir(dir, JUDGMENT_FACTS_FILE), { pile, framework: SCALE });
    const at = driverDir(dir, "owner-judgment-1.json");
    assert.deepEqual(checkJudgmentFile(at, JSON.stringify(answer([carry(["0000-A1"])]))), { ok: true, failures: [] },
      "a record the run holds was refused because it was cited by its bare register id");
    // THE CONTROL: a bare id no held record ends with is still refused.
    const v = checkJudgmentFile(at, JSON.stringify(answer([carry(["0000-Z9"])])));
    assert.match(v.failures.join(" "), /^judgment_record_not_held:1:0000-Z9/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a bare id several different held records end with is refused, never guessed", () => {
  const facts = { recordIds: new Set(["/mark/AA/0000-X1", "/mark/BB/0000-X1", "/mark/aa/0000-x1", "/mark/AA/0000-Y1", "/mark/aa/0000-y1"]),
    webUrls: new Set(), framework: SCALE };
  assert.match(checkAnswer(answer([carry(["0000-X1"])]), facts).failures.join(" "), /judgment_record_not_held:1:0000-X1/,
    "an id two different records end with was filed under one of them");
  // …while the same record held under two spellings of its full id is one record, not two.
  assert.deepEqual(checkAnswer(answer([carry(["0000-Y1"])]), facts).failures, []);
});

test("the merge files a bare id under the record it names, so its owner is the record's owner", () => {
  const pile = loadPile(PILE);
  const table = buildOwnerTable(pile);
  const m = mergeJudgments({ table, judges: [{ judge: 1, answer: answer([carry(["0000-A1"])]), opening: new Set(), looked: new Set() }] });
  assert.equal(m.carried.length, 1);
  assert.ok(m.carried[0].records.includes("/mark/AA/0000-A1"), `the carried group did not file the record under its full id: ${m.carried[0].records}`);
  assert.ok(!m.carried[0].records.includes("0000-A1"), "the bare id travelled on into the decisions");
  const owner = table.rows.find((r) => r.records.some((rec) => rec.id === "/mark/AA/0000-A1"));
  assert.equal(m.fates.find((f) => f.key === owner.key)?.fate, FATES.CARRIED, "the record's owner was not given its carried fate");
});
