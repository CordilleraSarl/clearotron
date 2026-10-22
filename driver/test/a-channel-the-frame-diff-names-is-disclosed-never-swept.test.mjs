// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end, with a frame-diff that names a channel
//
// A CHANNEL THE FRAME-DIFF NAMES IS DISCLOSED, NEVER SWEPT.
//
// The frame-diff manual says a source directive naming a channel is disclosed rather than swept blind, and ends as an
// open coverage row. The driver did the opposite: the frame-reopen resumed the web-search sessions to sweep the
// channel for every variant, and the coverage closure folded the same channels into its supplementary pass. On a test
// run of a crowded matter, the second framing swept all of its directives, the channel ones included. No channel
// directive goes to a web-search session now; it is deferred with the reason a reader gets for a channel never swept.
// Own process, because config.workspaceRoot freezes at first import. Billable-call-free (mock engine).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8193", markName: "QUILLAMOR", classes: [9, 41], provider: "corsearch",
};
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-mock-channel-"));

async function runPipeline(env) {
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_LEDGER_LIMITED", "MOCK_FRAME_DIFF"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
    CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0",
    CLEAROTRON_RECOVERY_MAX: "0", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("a channel the frame-diff names is an open row, and no web-search session is resumed to sweep it", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "source" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "frame-reopen.json"), "utf8"));
  assert.ok(!receipt.swept.some((k) => /^source:/.test(k)), "the channel was swept by a web-search session");
  const deferred = receipt.deferrals.filter((d) => /^source:/.test(d.directive));
  assert.ok(deferred.length > 0, "guard: the frame-diff's channel directive fired");
  for (const d of deferred) assert.equal(d.reason, "source-not-swept", `the channel ${d.directive} is not deferred as never swept`);
  const resumed = events.filter((e) => e.event === "stage" && /^common-law/.test(String(e.stage)) && ["frame-reopen", "coverage-closure"].includes(e.trigger));
  assert.deepEqual(resumed.map((e) => `${e.stage} (${e.trigger})`), [], "a web-search session was resumed for the channel");
  // The reader's row says what it always said for a channel never swept, in the shipped words.
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  const rows = Array.isArray(findings?.coverage) ? findings.coverage : [];
  const row = rows.find((r) => /^Follow-up \//.test(String(r.area ?? "")) && /github\.com/.test(`${r.area} ${r.note}`));
  assert.ok(row, `no open row for the channel among ${rows.length} coverage row(s)`);
  assert.equal(row.state, "open");
  assert.ok(String(row.note).includes(plainDeferralReason("source-not-swept")), `the channel's row does not say it was never swept: ${row.note}`);
});
