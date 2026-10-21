// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FOLLOW-UP THE RUN'S SAFETY NET DID NOT SEND IS A QUESTION NOT ASKED: NEVER MISSING, NEVER ANSWERED.
//
// A run's follow-up searches share one safety net in code, which no model reads. A follow-up met with the net full
// is not sent, and the run carries on to delivery with the gap stated. Joined as missing, it would be sent back to
// be run, and the net would hold it again until the run failed. Joined as nothing, it would vanish from the count.
// It joins as outstanding: the class line says it could not be searched, in the words the line already uses. The
// net's own figures go to the run log, never to the receipt a model may read. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { joinPlanToBands, deriveCoverageSkeleton } from "../register-plan.mjs";
import { deriveScopeFacts } from "../scope-facts.mjs";
import { writePlanExecutionReceipt } from "../pipeline.mjs";
import { SEARCHES_FILE, FOLLOW_UP_SEARCH_LIMIT, recordOutstanding } from "../../providers/_shared/follow-up-searches.mjs";

const entry = (qid, term, extra = {}) => ({ qid, axis: "primary-sweep", predicate: "exact", term, nice_classes: ["9"], regions: ["jp"], expected_kind: "enumerate", ...extra });
const PLAN = { schema: "register-plan/1", plan_version: 2, derived_from: { job_key: "k", variants_fingerprint: "f" }, nice_classes: ["9"], regions: ["jp"], entries: [
  entry("primary-sweep:exact:qzorvak", "QZORVAK", { provenance: "mark" }),
  entry("primary-sweep:exact:qzorvek", "QZORVEK"),
  entry("supp:primary-sweep:exact:korvak:00000001", "KORVAK", { origin: "supplemental" }),
  entry("supp:primary-sweep:exact:qorvak:00000002", "QORVAK", { origin: "supplemental" }),
  entry("supp:primary-sweep:exact:zorvak:00000003", "ZORVAK", { origin: "supplemental" }),
] };
const done = (qid) => ({ qid, state: "enumerated", total_hits: 0, records: [] });
const BANDS = { "primary-sweep": [
  done("primary-sweep:exact:qzorvak"),
  // a plan question with no block: still missing, whatever the outstanding list says
  { qid: "supp:primary-sweep:exact:qorvak:00000002", state: "incomplete", error: true, reason: "provider error — 502" },
  done("supp:primary-sweep:exact:zorvak:00000003"),
] };
const OUTSTANDING = new Set(["primary-sweep:exact:qzorvek", "supp:primary-sweep:exact:korvak:00000001",
  "supp:primary-sweep:exact:qorvak:00000002", "supp:primary-sweep:exact:zorvak:00000003"]);

test("a refused follow-up with no answer, or a failed one, joins as outstanding; one that kept its answer is executed; a plan question is never refused", () => {
  const j = joinPlanToBands(PLAN, BANDS, { outstanding: OUTSTANDING });
  assert.deepEqual(j.missing, ["primary-sweep:exact:qzorvek"], "a plan question without an answer is missing, and goes back to be run");
  assert.deepEqual(j.outstanding.map((x) => x.qid), ["supp:primary-sweep:exact:korvak:00000001", "supp:primary-sweep:exact:qorvak:00000002"]);
  assert.ok(j.executed.some((x) => x.qid === "supp:primary-sweep:exact:zorvak:00000003"), "the answer it already had stands");
  assert.equal("outstanding" in joinPlanToBands(PLAN, BANDS), false, "a run that refused nothing keeps the receipt's earlier shape");
});

test("the skeleton counts them; an axis with nothing run but refused follow-ups is not read as searched", () => {
  const full = { ...BANDS, "primary-sweep": [...BANDS["primary-sweep"], done("primary-sweep:exact:qzorvek")] };
  const s = deriveCoverageSkeleton(PLAN, joinPlanToBands(PLAN, full, { outstanding: OUTSTANDING })).find((x) => x.axis === "primary-sweep");
  assert.deepEqual([s.state, s.outstanding, s.missing], ["executed", 2, []]);
  const onlyRefused = { ...PLAN, entries: PLAN.entries.filter((e) => e.origin === "supplemental").slice(0, 1) };
  const t = deriveCoverageSkeleton(onlyRefused, joinPlanToBands(onlyRefused, {}, { outstanding: OUTSTANDING }))[0];
  assert.equal(t.state, "unexecuted", "nothing on the axis ran, and a clean claim must not rest on it");
});

test("the class line says a refused follow-up could not be searched, in the words it already uses", () => {
  const full = { ...BANDS, "primary-sweep": [...BANDS["primary-sweep"], done("primary-sweep:exact:qzorvek")] };
  const f = deriveScopeFacts({ instructedScope: { classes: [9] }, plan: PLAN, planExecution: joinPlanToBands(PLAN, full, { outstanding: OUTSTANDING }) });
  assert.equal(f.coverage_line.split(" · ")[0], "Class 9: 3 of 5 searches completed — the remaining 2 could not be searched");
  assert.equal(f.per_class["9"].outstanding, 2);
});

test("the net's figures go to the run log once per change, never to the receipt, and count only questions never sent", (t) => {
  const run = mkdtempSync(join(tmpdir(), "net-receipt-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(join(run, "register-units"), { recursive: true });
  mkdirSync(driverDir(run), { recursive: true });
  const ctx = { registerPlan: PLAN, axes: ["primary-sweep"], paths: { runDir: run, registerPlan: driverDir(run, "register-plan.json"),
    planExecution: driverDir(run, "plan-execution.json"), registerBand: (a) => join(run, "register-units", `${a}-band.json`) } };
  writeFileSync(ctx.paths.registerPlan, JSON.stringify(PLAN));
  const join1 = () => joinPlanToBands(PLAN, BANDS, { outstanding: OUTSTANDING });
  const events = () => { try { return readFileSync(driverDir(run, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "register-follow-up-searches"); } catch { return []; } };
  writePlanExecutionReceipt(ctx, joinPlanToBands(PLAN, BANDS));
  assert.deepEqual(events(), [], "a net never drawn on is not logged");

  writeFileSync(driverDir(run, SEARCHES_FILE), Array.from({ length: FOLLOW_UP_SEARCH_LIMIT }, (_, i) => JSON.stringify({ qid: `q${i}` })).join("\n") + "\n");
  for (const qid of ["supp:primary-sweep:exact:korvak:00000001", "supp:primary-sweep:exact:qorvak:00000002", "supp:primary-sweep:exact:zorvak:00000003"]) recordOutstanding(driverDir(run), { qid, axis: "primary-sweep" });
  writePlanExecutionReceipt(ctx, join1());
  writePlanExecutionReceipt(ctx, join1());
  const text = readFileSync(ctx.paths.planExecution, "utf8");
  assert.equal(/follow_up|allowance|limit|paid|\bcap\b/i.test(text), false, "the receipt a model may read names the net");
  // the third was held back once and asked later, so two were never sent
  assert.deepEqual(events().map(({ limit, sent, reached, not_sent }) => ({ limit, sent, reached, not_sent })),
    [{ limit: FOLLOW_UP_SEARCH_LIMIT, sent: FOLLOW_UP_SEARCH_LIMIT, reached: true, not_sent: 2 }], "the same figures were logged twice, or not at all");
  appendFileSync(driverDir(run, SEARCHES_FILE), JSON.stringify({ qid: "in-flight" }) + "\n");
  writePlanExecutionReceipt(ctx, join1());
  assert.deepEqual(events().map((e) => e.sent), [FOLLOW_UP_SEARCH_LIMIT, FOLLOW_UP_SEARCH_LIMIT + 1]);
});
