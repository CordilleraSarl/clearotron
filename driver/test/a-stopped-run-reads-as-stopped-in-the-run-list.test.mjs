// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives both products' stop endings in a temporary studio
//
// A STOPPED RUN READS AS STOPPED IN THE STAFF RUN LIST, WHICHEVER PRODUCT IT IS.
//
// The run list (`STATUS.md`) had a line for a delivered, failed, recovering, parked and postponed run, and none for a
// stopped one, so a stopped run fell through to the default and read "running" until newer runs pushed it off. Staff,
// and the watch that reads the list for anything still owed, saw a live run that never finished. A stopped run's line
// now reuses the reason the stop already writes: "stopped by request at ⟨stage⟩ via ⟨route⟩ (asked ⟨time⟩)".
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "stopped-run-reads-as-stopped-"));
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
process.env.CLEAROTRON_RECOVERY_MAX = "0";

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { endTheFailedRun } = await import("../run-failed.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { RunCancelled, requestCancel } = await import("../cancel.mjs");
const { lineFor } = await import("../progress.mjs");

/** A run folder in its own studio, as openRun lays one out. */
function runIn(id, codename) {
  const studioRoot = join(ROOT, "studio", id);
  const runDir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-11-10-${codename}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  return { runDir, studioRoot, slug: "lanternwick", date: "2026-11-10", codename, archiveDir: join(studioRoot, "archive", `2026-11-10-${codename}`) };
}
const runLines = (studioRoot) => readFileSync(join(studioRoot, "STATUS.md"), "utf8").split("\n").filter((l) => l.startsWith("- "));
const statusOf = (runDir) => JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));

test("a stopped clearance's line in the run list is the stop's own reason, not running", async () => {
  const run = runIn("clearance-stop", "amber-gate");
  const job = { id: "clearance-stop", markName: "LANTERNWICK", classes: [4], jurisdictions: ["EU"], forwarder: "jordan", msgId: "<stop@x>" };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: run.runDir }, profile: {}, searchPolicy: { level: "full-country", stageLabel: "Full country search" } };
  const e = new RunCancelled("synthesis", { ts: "2026-11-10T18:00:00.000Z", via: "portal" });
  const helpers = { isContentShapedFail: () => false, logTurnaroundReconciliation: () => {}, recordConnotationAudit: () => {},
    sentinel: (dir) => { mkdirSync(dir, { recursive: true }); }, undoTaintRenames: () => {} };
  const res = await endTheFailedRun({ P: {}, agent: "mailagent", ctx, e, job, run }, helpers);
  assert.equal(res.cancelled, true, "premise: the stop ended the run");
  const status = statusOf(run.runDir);
  assert.equal(status.state, "cancelled");
  assert.equal(status.reason, "stopped by request at synthesis via portal (asked 2026-11-10T18:00:00.000Z)", "premise: the reason the stop writes");
  const [line] = runLines(run.studioRoot);
  assert.ok(line.endsWith(` — ${status.reason}`), `the line is the stop's reason: ${line}`);
  assert.doesNotMatch(line, /running/);
});

test("a stopped Knockout's line in the run list is the stop's own reason, not running", async () => {
  const run = runIn("knockout-stop", "slate-harbour");
  const job = { id: "knockout-stop", markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: "<ko-stop@x>", ref: "E2E-stop" };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: run.runDir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  requestCancel(run.runDir, { via: "portal" });
  const res = await knockoutInner(ctx, job, { countExecutor: async () => ({ ok: true, total: 0 }), sweepExecutor: async () => ({ ok: true, text: "u", bytes: 1 }) });
  assert.equal(res.cancelled, true, `premise: the stop ended the run: ${JSON.stringify(res)?.slice(0, 200)}`);
  const status = statusOf(run.runDir);
  assert.equal(status.state, "cancelled");
  assert.match(status.reason, /^stopped by request at .+ \(knockout\) via portal \(asked .+\)$/, "premise: the reason the stop writes");
  const [line] = runLines(run.studioRoot);
  assert.equal(line, `- E2E-stop LANTERNWICK — ${status.reason}`);
});

test("a stopped run whose status holds no reason reads as stopped, from the stage it records", () => {
  assert.equal(lineFor({ ref: "R-1", markName: "LANTERNWICK", state: "cancelled", failedStage: "parked", reason: null }),
    "- R-1 LANTERNWICK — stopped by request at parked");
  assert.equal(lineFor({ ref: "R-1", markName: "LANTERNWICK", state: "cancelled" }), "- R-1 LANTERNWICK — stopped by request");
});
