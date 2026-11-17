// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives both products' stop endings in a temporary studio
//
// A STOPPED RUN RECORDS WHAT IT SPENT, WHICHEVER PRODUCT IT IS.
//
// A Knockout that was stopped wrote a consumption row with the cancelled status and refreshed the run list. A clearance
// that was stopped did neither, so the spend up to the stop reached no account view and the run list stayed stale
// until some other run ended. Both endings now do both, and neither write can turn the stop into a resume: each is
// best-effort, and the ledger keeps one row per run.
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "stopped-run-records-"));
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
const { consumptionLedgerPath, accountConsumption } = await import("../consumption-ledger.mjs");
const { studioDirFor } = await import("../../shared/pre-rename-spellings.mjs");

/** A run folder in its own studio, as openRun lays one out. */
function runIn(id, codename) {
  const studioRoot = join(ROOT, "studio", id);
  const runDir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-11-10-${codename}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  return { runDir, studioRoot, slug: "lanternwick", date: "2026-11-10", codename, archiveDir: join(studioRoot, "archive", `2026-11-10-${codename}`) };
}
const ledgerRows = (studioRoot) => readFileSync(consumptionLedgerPath(studioRoot), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const journal = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a stopped clearance records its consumption as cancelled and refreshes the run list, as a stopped Knockout does", async () => {
  const run = runIn("clearance-stop", "amber-gate");
  const job = { id: "clearance-stop", markName: "LANTERNWICK", classes: [4], jurisdictions: ["EU"], forwarder: "jordan", msgId: "<stop@x>" };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: run.runDir }, profile: {}, searchPolicy: { level: "full-country", stageLabel: "Full country search" } };
  const e = new RunCancelled("synthesis", { ts: "2026-11-10T18:00:00.000Z", via: "portal" });
  const helpers = { isContentShapedFail: () => false, logTurnaroundReconciliation: () => {}, recordConnotationAudit: () => {},
    sentinel: (dir) => { mkdirSync(dir, { recursive: true }); },
    undoTaintRenames: () => {} };
  const res = await endTheFailedRun({ P: {}, agent: "mailagent", ctx, e, job, run }, helpers);
  assert.equal(res.cancelled, true, "premise: the stop ended the run");
  const rows = ledgerRows(run.studioRoot);
  assert.equal(rows.length, 1, "one row for the stop");
  assert.equal(rows[0].phase, "cancelled");
  assert.equal(rows[0].runId, "lanternwick-2026-11-10-amber-gate");
  // Nothing else in this studio writes the run list, so its existence is the refresh.
  assert.ok(existsSync(join(run.studioRoot, "STATUS.md")), "the run list was refreshed");
  assert.equal(readFileSync(join(run.studioRoot, "STATUS.md"), "utf8").split("\n").filter((l) => l.startsWith("- ")).length, 1, "and lists the run");
  assert.equal(existsSync(join(run.runDir, ".postponed")), false, "a stop is terminal: nothing parks");
});

test("a stopped Knockout still records its consumption and refreshes the run list, and its journal row says who asked when", async () => {
  const run = runIn("knockout-stop", "slate-harbour");
  const job = { id: "knockout-stop", markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: "<ko-stop@x>", ref: "E2E-stop" };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: run.runDir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  requestCancel(run.runDir, { via: "portal" });
  const res = await knockoutInner(ctx, job, { countExecutor: async () => ({ ok: true, total: 0 }), sweepExecutor: async () => ({ ok: true, text: "u", bytes: 1 }) });
  assert.equal(res.cancelled, true, `premise: the stop ended the run: ${JSON.stringify(res)?.slice(0, 200)}`);
  const rows = ledgerRows(run.studioRoot);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phase, "cancelled");
  assert.match(readFileSync(join(run.studioRoot, "STATUS.md"), "utf8"), /^- E2E-stop LANTERNWICK/m, "the run list lists the run");
  const stopped = journal(run.runDir).filter((r) => r.event === "cancelled");
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].via, "portal", "the journal says how the stop arrived, as a clearance's does");
  assert.ok(stopped[0].requestedAt, "and when it was asked");
});

test("a stop handled twice is counted once in the account's usage", async () => {
  // The ledger is append-only, so a second handling of the same stop writes a second row. The account's view keeps the
  // last row per run, so the run counts once. This lays out one workspace the way the account view walks it.
  const workspaceRoot = mkdtempSync(join(ROOT, "workspaces-"));
  const studioRoot = studioDirFor(join(workspaceRoot, "workspace-intake-agent"));
  const runDir = join(studioRoot, "runs", "lanternwick", "2026-11-10-amber-twice");
  mkdirSync(driverDir(runDir), { recursive: true });
  const run = { runDir, studioRoot, slug: "lanternwick", date: "2026-11-10", codename: "amber-twice", archiveDir: join(studioRoot, "archive", "2026-11-10-amber-twice") };
  const job = { id: "clearance-stop-twice", markName: "LANTERNWICK", classes: [4], jurisdictions: ["EU"], forwarder: "jordan", msgId: "<twice@x>" };
  const ctx = { run, job, agent: "mailagent", paths: { runDir }, profile: { profileKey: "invented-account" }, searchPolicy: { level: "full-country", stageLabel: "Full country search" } };
  const helpers = { isContentShapedFail: () => false, logTurnaroundReconciliation: () => {}, recordConnotationAudit: () => {},
    sentinel: (dir) => { mkdirSync(dir, { recursive: true }); }, undoTaintRenames: () => {} };
  for (let i = 0; i < 2; i++) {
    const e = new RunCancelled("synthesis", { ts: "2026-11-10T18:00:00.000Z", via: "portal" });
    await endTheFailedRun({ P: {}, agent: "mailagent", ctx, e, job, run }, helpers);
  }
  assert.equal(ledgerRows(studioRoot).length, 2, "premise: the second handling wrote a second row");
  const usage = accountConsumption({ workspaceRoot, account: "invented-account" });
  assert.equal(usage.today.runs, 1, "the account counts the stopped run once");
  assert.equal(usage.thisMonth.runs, 1);
});
