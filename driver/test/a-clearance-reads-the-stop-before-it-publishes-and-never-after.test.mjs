// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CLEARANCE READS THE STOP BEFORE IT PUBLISHES, AND NEVER AFTER. Its delivery reads the stop flag one last time, and
// the place of that read is the whole rule: before the publish, or a stop pressed during the last stage is seen by
// nothing; and only on the branch that publishes, because a run that has already published has delivered, and
// refusing it then would record a delivered run as cancelled. This drives the delivery itself on a stopped run, once
// with nothing published and once with the publish already recorded, and reads what each does.
//
// It replaces an arm that compared the read's position with the publish call's and the published branch's in the
// source text.
import { mkdirSync, mkdtempSync, existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "clearance-stop-before-publish-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));

import { test } from "node:test";
import assert from "node:assert/strict";

const { deliveryEndState } = await import("../run-delivered.mjs");
const { requestCancel, RunCancelled } = await import("../cancel.mjs");
const { driverDir } = await import("../../shared/driver-dir.mjs");

const noop = () => {};
const HELPERS = { applyScopeFrontMatterOf: noop, archive: noop, assessmentCoverageOfRun: () => null, localLanguageStateOf: async () => null,
  reportIdentityRecord: () => ({}), searchLogAuditMd: () => "", sentinel: noop, setAsideTheAssessment: noop, writeScopeFactsOf: noop };

/** A stopped clearance at its delivery, with or without its publish recorded; what the delivery did. */
async function deliverStopped(codename, { publishedAlready }) {
  const runDir = join(ROOT, "ws", "runs", `2026-11-19-${codename}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ schema: 1, state: "running" }));
  if (publishedAlready) writeFileSync(join(runDir, ".published"), JSON.stringify({ ts: "2026-11-19T00:00:00Z", url: "https://trademark.test/r", reports: [] }));
  requestCancel(runDir, { via: "test", by: "test" });
  const run = { runDir, studioRoot: join(ROOT, "ws"), slug: "orderwell", date: "2026-11-19", codename, archiveDir: join(ROOT, "archive", codename) };
  const job = { id: `job-${codename}`, markName: "ORDERWELL", classes: [9], forwarder: "jordan", msgId: `<${codename}@x>`, ref: "TMP-1414" };
  const ctx = { run, job, agent: "mailagent", paths: { runDir }, profile: {}, searchPolicy: {} };
  const { publishAndDeliver } = await deliveryEndState({ P: { runDir }, agent: "mailagent", ctx, job, run, opts: {} }, HELPERS);
  let thrown = null;
  try { await publishAndDeliver("CLEAR"); } catch (e) { thrown = e; }
  return { runDir, thrown };
}

test("a stopped clearance that has not published is refused before anything is published", async () => {
  const { runDir, thrown } = await deliverStopped("not-yet-published", { publishedAlready: false });
  assert.ok(thrown instanceof RunCancelled, `the delivery went past the stop: ${String(thrown?.message ?? "it returned").slice(0, 200)}`);
  assert.equal(existsSync(join(runDir, ".published")), false, "a publish was recorded for a stopped run");
  assert.deepEqual(existsSync(join(ROOT, "pool")) ? readdirSync(join(ROOT, "pool"), { recursive: true }) : [], [], "the pool holds a stopped run's report");
});

test("a clearance that published before the stop is not refused: a delivered run is never recorded as cancelled", async () => {
  const { runDir, thrown } = await deliverStopped("published-already", { publishedAlready: true });
  // Past the published branch the delivery reads the run's own material, which this planted run does not hold, so it
  // may fail there. What it must not do is refuse on the stop.
  assert.equal(thrown instanceof RunCancelled, false, "the delivery refused a run that had already published");
  assert.notEqual(JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).state, "cancelled", "a published run was recorded as cancelled");
});
