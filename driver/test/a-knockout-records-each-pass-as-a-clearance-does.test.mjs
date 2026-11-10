// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the knockout lane on the mock engine
//
// A KNOCKOUT RECORDS EACH PASS, EACH STAGE AND ITS TURNAROUND AS A CLEARANCE DOES.
//
// A clearance's status says which pass the run is on (`attempts`, and `resumedAt` on a resume) and which stage it
// entered last (`lastStage`), and every ending writes a turnaround row. A Knockout's said none of it: its seed wrote no
// pass, its stages wrote only the step, and its delivery wrote no turnaround row. This drives one Knockout that parks
// on its first pass and delivers on its resume.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-passes-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "3";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { StageFailure } = await import("../run-outcome.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const status = (dir) => JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
const journal = (dir) => readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a Knockout that parks and resumes records each pass, the stage it entered, and its turnaround, as a clearance does", async () => {
  const codename = "amber-pass";
  const studioRoot = join(ROOT, "studio", "ko-passes");
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-11-10-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-11-10", codename, archiveDir: join(studioRoot, "archive", `2026-11-10-${codename}`) };
  const fixtures = mkdtempSync(join(ROOT, "fixtures-"));
  writeFileSync(join(fixtures, "lanternwick.json"), JSON.stringify({ total: 1, records: [FILING] }));
  const job = { id: "ko-passes", markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: "<ko-passes@x>", ref: "E2E-passes", registerFixtures: { records: fixtures } };
  const ctxFor = (stateReset) => ({ run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, stateReset,
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } });
  const executors = {
    countExecutor: async () => ({ ok: true, total: 3 }),
    gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
    sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
  };

  // The first pass fails where the counts are asked, with a failure the ladder buys one park for.
  const parked = await knockoutInner(ctxFor(false), job, { ...executors,
    get countExecutor() { throw new StageFailure("knockout-register-count", "knockout_chunk_invalid: rating vocabulary miss"); } });
  assert.equal(parked.postponed, true, `premise: the first pass parks: ${JSON.stringify(parked)?.slice(0, 200)}`);
  assert.equal(status(dir).attempts, 1, "a fresh run is attempt 1, as a clearance's seed records it");
  assert.equal(status(dir).resumedAt, undefined);
  assert.ok(journal(dir).some((r) => r.event === "turnaround-reconciliation" && r.state === "recovery-parked"));

  // The resume delivers.
  const delivered = await knockoutInner(ctxFor(true), job, executors);
  assert.equal(delivered.ok, true, `premise: the resume delivers: ${JSON.stringify(delivered)?.slice(0, 300)}`);
  const done = delivered.runDir;
  const st = status(done);
  assert.equal(st.attempts, 2, "a resume counts itself");
  assert.ok(Date.parse(st.resumedAt), "and records when it resumed");
  assert.match(String(st.lastStage), /^knockout-/, "the stage the run entered last, as a clearance's status names it");
  assert.equal(st.currentStep?.label, st.stepLabel, "the step the run is in now, in the clearance's shape");
  const rows = journal(done).filter((r) => r.event === "turnaround-reconciliation").map((r) => r.state);
  assert.deepEqual(rows, ["recovery-parked", "delivered"], "every ending writes its turnaround row");
});
