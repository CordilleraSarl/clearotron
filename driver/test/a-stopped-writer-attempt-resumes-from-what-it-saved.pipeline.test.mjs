// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STOPPED WRITER ATTEMPT IS RESUMED FROM WHAT IT SAVED, THROUGH THE STAGE'S OWN RETRY.
//
// The writer's first attempt saves a finding with `save_findings` and is stopped, as the stall watchdog or the time
// limit stops one. The stage's ladder retries. The retry's message says what is saved, and the retry sends the whole
// record without the saved finding, so only the run's own saved copy can put that finding in the record. The record
// that results holds it, and the saved findings are consumed. Nothing between the two attempts may clear them. Every
// mark and owner here is the stand-in's invented fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-writer-resume-"));
const LOG = join(ROOT, "writer-attempts.jsonl");
const vars = { CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_BAND_TRUTH_GATE: "0", CLEAROTRON_AI: "anthropic-agent",
  CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "1",
  CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_SATPROBE_CODESIDE: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  MOCK_FINDINGS_N: "2", MOCK_WRITER_SAVE_THEN_DIE: "1", MOCK_WRITER_SAVE_LOG: LOG };
for (const [k, v] of Object.entries(vars)) pinEnv(process.env, k, v);

const PL = await import("../pipeline.mjs");
const SR = await import("../synthesis-record.mjs");

test("the retry is told what the stopped attempt saved, and the record it completes holds the saved finding", async (t) => {
  t.after(() => rmSync(ROOT, { recursive: true, force: true }));
  const job = { id: "job-TMPRESUME1", msgId: "<TMPRESUME1@x>", forwarder: "jordan", forwarderDomain: "example.com",
    ref: "TMPRESUME1", markName: "MARK TMPRESUME1", classes: [9, 41], provider: "corsearch" };
  const res = await PL.pipeline(job);
  const attempts = readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(attempts.slice(0, 3), [{ told: false }, { saved: 1, refused: [] }, { told: true }],
    `the first attempt did not save and stop, or the retry was not told: ${JSON.stringify(attempts)}`);
  const rec = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.equal(rec.findings.length, 2, `the record lost the saved finding: ${rec.findings.map((f) => f.mark).join(", ")}`);
  assert.ok(rec.findings.some((f) => f.mark === "PROJECT NOVAPULSE"), "the finding only the saved copy held is not in the record");
  assert.deepEqual(SR.readSavedFindings(res.runDir), [], "the accepted record did not consume the saved findings");
  assert.ok(existsSync(join(res.runDir, "synthesis-saved.json")), "the retry was not handed the saved findings as a file");
  assert.match(readFileSync(driverDir(res.runDir, "synthesis-calls", "saved-findings.jsonl"), "utf8"), /"consumed":true/);
});
