// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// By the time the reviewer and synthesis read the plan-execution table, the reading turn is over. A
// waiting family it chose not to ask is a settled judgment with its reason on record, either in the
// turn's own per-axis record or on the coverage form, where a family the turn left unrecorded is settled.
// The table used to count every such family as "awaiting the reading turn's ask", and its class (4) told
// the reader each was a question still open to it. Measured on a test run: all 963 waiting families were
// withheld by judgment, the table said 963 awaiting, and the reviewer raised a coverage flag against
// judgments already made.
//
// The fixture is derived by the production join, so the receipt is the shape a run writes. Three waiting
// families: one withheld in the turn's record, one withheld only on the coverage form, and one nobody
// judged, which must still read as awaiting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths } from "../stages.mjs";
import { sandboxManifest } from "../stage-context.mjs";
import { joinPlanToBands, deriveCoverageSkeleton, PLAN_AUDIT_CLASSES } from "../register-plan.mjs";
import { withheldFamiliesPath, splitWaitingFamilies } from "../withheld-families.mjs";
import { writeCoverageForm, coverageFormPaths } from "../coverage-form-io.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const ROOT = mkdtempSync(join(tmpdir(), "withheld-not-awaiting-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", CLAUDE);
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.CLEAROTRON_AGENT = "clawdi";
const { composeDispatchExtra } = await import("../pipeline.mjs");

const WAITS = { awaits_reading_turn: true };
const RECORDED = "primary-sweep:default:venzi";   // withheld in the reading turn's record
const ON_FORM = "primary-sweep:default:venzee";   // withheld only on the coverage form
const UNJUDGED = "transliteration-numeric:exact:v3nzy";   // nobody judged it
const PLAN = {
  schema_version: 1, plan_version: 3, nice_classes: ["5"], regions: ["US"], provider: "corsearch",
  entries: [
    { qid: "primary-sweep:exact:venzy", nice_classes: ["5"], regions: ["US"], axis: "primary-sweep", predicate: "exact", term: "VENZY", expected_kind: "enumerate" },
    { qid: RECORDED, nice_classes: ["5"], regions: ["US"], axis: "primary-sweep", predicate: "default", term: "VENZI", expected_kind: "enumerate", when: WAITS },
    { qid: ON_FORM, nice_classes: ["5"], regions: ["US"], axis: "primary-sweep", predicate: "default", term: "VENZEE", expected_kind: "enumerate", when: WAITS },
    { qid: UNJUDGED, nice_classes: ["5"], regions: ["US"], axis: "transliteration-numeric", predicate: "exact", term: "V3NZY", expected_kind: "enumerate", when: WAITS },
  ],
};
const BANDS = { "primary-sweep": [{ qid: "primary-sweep:exact:venzy", state: "enumerated", records: [] }], "transliteration-numeric": [] };

function fixtureRun({ record = true, form = true } = {}) {
  const runDir = mkdtempSync(join(ROOT, "run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const joined = joinPlanToBands(PLAN, BANDS);
  writeFileSync(driverDir(runDir, "plan-execution.json"),
    JSON.stringify({ plan_version: PLAN.plan_version, ...joined, skeleton: deriveCoverageSkeleton(PLAN, joined) }, null, 2) + "\n");
  if (record) writeFileSync(withheldFamiliesPath(runDir, "primary-sweep"),
    JSON.stringify({ axis: "primary-sweep", families: { [RECORDED]: { reason: "a spelling no one would read as the mark" } } }));
  if (form) writeCoverageForm(runDir, { rows: [
    { row_id: "CF-1", axis: "primary-sweep", kind: "family", qid: ON_FORM, open: true, status: "withheld-by-judgment", reason: "the identical search already answers it" },
    { row_id: "CF-2", axis: "transliteration-numeric", kind: "family", qid: UNJUDGED, open: true, status: null, reason: null },
  ] });
  return { runDir, ctx: { paths: paths(runDir), registerPlan: PLAN }, joined };
}

const tableOf = (text) => text.split("\n").filter((l) => l.startsWith("- "));

test("the fixture's join puts all three families in the awaiting bucket, so the table is what separates them", () => {
  const { joined } = fixtureRun();
  assert.deepEqual(joined.awaiting.map((f) => f.qid).sort(), [ON_FORM, RECORDED, UNJUDGED].sort());
});

test("a family withheld in the turn's record or on the coverage form is counted withheld; one nobody judged still awaits", () => {
  const { ctx } = fixtureRun();
  for (const stage of ["narrative-refutation", "synthesis"]) {
    const { text, failed } = composeDispatchExtra(stage, ctx);
    assert.deepEqual(failed, [], `${stage}: the plan-audit block built`);
    const rows = tableOf(text);
    assert.ok(rows.includes("- withheld by judgment (the reading turn chose not to ask them; each carries its reason on the coverage form): 2"), `${stage}:\n${rows.join("\n")}`);
    assert.ok(rows.includes("- awaiting the reading turn's ask: 1"), `${stage}:\n${rows.join("\n")}`);
    assert.ok(rows.includes("- axis primary-sweep: executed (1/3 executed, 0 crowd, 2 withheld)"), `${stage}:\n${rows.join("\n")}`);
    assert.ok(rows.includes("- axis transliteration-numeric: awaiting-judgment (0/1 executed, 0 crowd, 1 awaiting)"), `${stage}:\n${rows.join("\n")}`);
  }
});

test("THE CONTROL: with neither record on disk, every waiting family still reads as awaiting", () => {
  const { ctx } = fixtureRun({ record: false, form: false });
  const rows = tableOf(composeDispatchExtra("narrative-refutation", ctx).text);
  assert.ok(rows.includes("- withheld by judgment (the reading turn chose not to ask them; each carries its reason on the coverage form): 0"), rows.join("\n"));
  assert.ok(rows.includes("- awaiting the reading turn's ask: 3"), rows.join("\n"));
  assert.ok(rows.includes("- axis primary-sweep: executed (1/3 executed, 0 crowd, 2 awaiting)"), rows.join("\n"));
});

test("only a family row settled withheld-by-judgment counts; an open family row or a seat row saying so does not", () => {
  const awaiting = [{ qid: "a", axis: "x" }, { qid: "b", axis: "x" }, { qid: "c", axis: "x" }];
  const { withheld, awaiting: still } = splitWaitingFamilies(awaiting, { recorded: {}, formRows: [
    { kind: "family", qid: "a", status: "withheld-by-judgment" },
    { kind: "family", qid: "b", status: "" },
    { kind: "seat", qid: "c", status: "withheld-by-judgment" },
  ] });
  assert.deepEqual(withheld.map((f) => f.qid), ["a"]);
  assert.deepEqual(still.map((f) => f.qid), ["b", "c"]);
});

test("class (4) tells the reader both states, and the block carries it", () => {
  assert.match(PLAN_AUDIT_CLASSES, /AWAITING JUDGMENT while the reading turn can still ask it: a question still open to you\./);
  assert.match(PLAN_AUDIT_CLASSES, /WITHHELD BY JUDGMENT once the reading turn chose not to ask it and recorded why: a settled judgment, not an open question\./);
  assert.ok(composeDispatchExtra("narrative-refutation", fixtureRun().ctx).text.includes(PLAN_AUDIT_CLASSES));
});

test("a stage sandbox carries both records, so a replayed reviewer counts what the run counted", () => {
  const P = paths("/RUN");
  for (const stage of ["narrative-refutation", "synthesis"]) {
    const held = new Set(sandboxManifest(stage, P).map((e) => e.path));
    for (const path of [withheldFamiliesPath("/RUN", "primary-sweep"), withheldFamiliesPath("/RUN", "transliteration-numeric"),
      coverageFormPaths("/RUN").sidecar, P.coverageEnum])
      assert.ok(held.has(path), `${stage}'s sandbox is missing ${path}`);
  }
});
