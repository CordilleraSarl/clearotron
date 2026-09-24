// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The report's summary line counts, per class, the register searches that completed and says why the rest
// did not. A waiting family that never became a search of its own used to fall into the fail-closed
// "missing" bucket and print as a search that "did not complete". Measured on a test run on 2026-09-23:
// "107 of 1073 searches completed — of the remaining 966, 964 did not complete and 2 were skipped", where
// 963 of the 964 were withheld by judgment and 1 was answered by the entry that asked it. None failed.
//
// Both now leave the count. A waiting family nobody judged stays where it was: it is still unread, and
// "did not complete" is the fail-closed reading. The receipt is derived by the production join.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { deriveScopeFacts } from "../scope-facts.mjs";
import { joinPlanToBands } from "../register-plan.mjs";
import { withheldFamiliesPath } from "../withheld-families.mjs";
import { waitingFamilyStates, writeCoverageForm } from "../coverage-form-io.mjs";

const WAITS = { awaits_reading_turn: true };
const entry = (qid, term, extra = {}) => ({ qid, axis: "primary-sweep", predicate: "exact", term, nice_classes: ["5"], regions: ["us"], ...extra });
const PLAN = {
  schema_version: 1, plan_version: 1, nice_classes: ["5"], regions: ["us"],
  entries: [
    entry("primary-sweep:exact:markname", "MARKNAME"),
    entry("primary-sweep:exact:marknames", "MARKNAMES"),
    entry("primary-sweep:wildcard:mark", "MARK*", { predicate: "wildcard", when: { runs_if_enumerated: "primary-sweep:exact:marknames" } }),
    entry("primary-sweep:default:marknane", "MARKNANE", { predicate: "default", when: WAITS }),   // withheld in the turn's record
    entry("primary-sweep:default:marknamee", "MARKNAMEE", { predicate: "default", when: WAITS }), // withheld on the form
    entry("primary-sweep:exact:marknames-waiting", "MARKNAMES", { when: WAITS }),                 // asked, by the same question above
    entry("primary-sweep:default:marcname", "MARCNAME", { predicate: "default", when: WAITS }),   // nobody judged it
  ],
};
const BANDS = { "primary-sweep": [
  { qid: "primary-sweep:exact:markname", state: "enumerated", records: [] },
  { qid: "primary-sweep:exact:marknames", state: "incomplete", records: [] },
] };
const INSTRUCTED = { marks: ["MARKNAME"], classes: [5], jurisdictions: ["us"], goods: null, customer: "X" };
const WITHHELD = ["primary-sweep:default:marknane", "primary-sweep:default:marknamee"];

const EXEC = joinPlanToBands(PLAN, BANDS);

test("the fixture's join holds three waiting families unasked and one asked, so the line is what separates them", () => {
  assert.deepEqual(EXEC.awaiting.map((f) => f.qid).sort(), [...WITHHELD, "primary-sweep:default:marcname"].sort());
  assert.deepEqual(EXEC.asked.map((f) => f.qid), ["primary-sweep:exact:marknames-waiting"]);
  assert.deepEqual(EXEC.skipped.map((f) => f.qid), ["primary-sweep:wildcard:mark"]);
});

test("a withheld family and one asked by another entry leave the count; one nobody judged still did not complete", () => {
  const f = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: PLAN, planExecution: EXEC, coverageRows: [], withheldQids: WITHHELD });
  assert.equal(f.coverage_line.split(" · ")[0],
    "Class 5: 1 of 4 searches completed — of the remaining 3, 1 did not complete, 1 was skipped after a broader search came back crowded and 1 returned more records than could be listed in full");
  assert.equal(f.per_class["5"].withheld, 2);
  assert.equal(f.per_class["5"].asked_elsewhere, 1);
});

test("THE CONTROL: with no withheld families named, every waiting family still counts as a search that did not complete", () => {
  const f = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: PLAN, planExecution: { ...EXEC, asked: [] }, coverageRows: [] });
  assert.equal(f.coverage_line.split(" · ")[0],
    "Class 5: 1 of 7 searches completed — of the remaining 6, 4 did not complete, 1 was skipped after a broader search came back crowded and 1 returned more records than could be listed in full");
  assert.equal("withheld" in f.per_class["5"], false, "the sidecar keeps its earlier shape when nothing was withheld");
});

test("the run's waiting families are read as withheld from the turn's record and from the form, one reader for both surfaces", () => {
  const runDir = mkdtempSync(join(tmpdir(), "withheld-count-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(withheldFamiliesPath(runDir, "primary-sweep"),
    JSON.stringify({ axis: "primary-sweep", families: { [WITHHELD[0]]: { reason: "a spelling no one would read as the mark" } } }));
  writeCoverageForm(runDir, { rows: [
    { row_id: "CF-1", axis: "primary-sweep", kind: "family", qid: WITHHELD[1], open: true, status: "withheld-by-judgment", reason: "the identical search already answers it" },
  ] });
  const { withheld, awaiting } = waitingFamilyStates(runDir, EXEC.awaiting);
  assert.deepEqual(withheld.map((f) => f.qid).sort(), [...WITHHELD].sort());
  assert.deepEqual(awaiting.map((f) => f.qid), ["primary-sweep:default:marcname"]);
});

// The summary line is derived at assembly, deep in a run no offline scenario reaches with waiting
// families on the plan. The wiring is read from the source: the one call must name the withheld
// families through the same reader the reviewer's table uses.
test("the pipeline derives the summary line with the withheld families from waitingFamilyStates", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");
  assert.equal(src.split("deriveScopeFacts({").length - 1, 1, "one derivation of the summary line");
  const site = src.slice(src.indexOf("deriveScopeFacts({"), src.indexOf("deriveScopeFacts({") + 600);
  assert.match(site, /withheldQids: waitingFamilyStates\(run\.runDir, planExecution\?\.awaiting\)\.withheld\.map\(\(f\) => f\.qid\)/);
  assert.match(src, /const \{ withheld, awaiting \} = waitingFamilyStates\(P\.runDir, exec\.awaiting\);/, "the reviewer's table reads through the same helper");
});
