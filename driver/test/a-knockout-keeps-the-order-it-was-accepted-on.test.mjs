// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a Knockout through pipeline() on the mock engine
//
// A KNOCKOUT KEEPS THE ORDER IT WAS ACCEPTED ON, AS A CLEARANCE DOES.
//
// A run keeps its order whole at intake, `_driver/accepted-order.json`, and a resume given no job file runs on that
// order (accepted-order.mjs). The write sat in the clearance's own steps, after the Knockout had already gone its own
// way, so a Knockout kept no order. A hand resume of a batch of several marks then rebuilt its job from status, whose
// mark is the display name "<first> +1 more"; the slug derived from that is not the run's, and the resume was refused
// as another matter. The refusal is right; the order should have been there.
//
// Nothing here dials a register or the web: every executor is injected, and the engine is the mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
const ROOT = mkdtempSync(join(tmpdir(), "knockout-keeps-its-order-"));
for (const [k, v] of Object.entries({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: join(ROOT, "ws"),
  CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_REPORTS_URL: "https://trademark.test",
  CLEAROTRON_DATABASE: "signa", CLEAROTRON_REGISTER_CALL_LOG: join(ROOT, "register-calls.jsonl"),
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent",
  MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", CORSEARCH_SESSION_KEY: "test-offline",
})) pinEnv(process.env, k, v);
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);

const { answeredGrid } = await import("./knockout-grid-fixture.mjs");
const { rebuildRunOrder, ACCEPTED_ORDER_FILE } = await import("../accepted-order.mjs");

/** A batch of two marks, with the routing only the order holds. */
const ORDER = {
  id: "ko-two-marks", msgId: "<ko-two-marks@x>", forwarder: "jordan", forwarderEmail: "jordan@example.com",
  ref: "KO-4410", product: "knockout-search", classes: [4], jurisdictions: ["EU"],
  markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }, { name: "CLUVENDRA" }],
};

async function knockout() {
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline(structuredClone(ORDER), {
    recordLister: async () => ({ ok: true, total: null, records: [] }),
    countExecutor: async () => ({ ok: true, total: 0 }),
    gridExecutor: async (spec) => answeredGrid(spec, []),
    sweepExecutor: async () => ({ ok: true, text: "Nothing found." }),
  });
  assert.equal(res?.ok, true, `the Knockout did not deliver: ${JSON.stringify(res)}`);
  return res;
}

/** What a hand resume with no job file does over this run folder: the order it would run on, and its door's answer. */
async function handResume(runDir) {
  const { jobFromStatus, resumeJobRefusal, instructedScopeOf } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const status = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  const read = (name) => { try { return JSON.parse(readFileSync(driverDir(runDir, name), "utf8")); } catch { return null; } };
  const scope = read("instructed-scope.json");
  const frozen = { profile: read("profile.json"), searchPolicy: read("search-policy.json"), roster: null };
  const recovered = rebuildRunOrder({ runDir, status, scope, profile: frozen.profile, queueDir: join(ROOT, "no-queue"),
    scopeOf: instructedScopeOf, fromStatus: () => jobFromStatus(status, scope, frozen), write: false });
  return { ...recovered, refusal: resumeJobRefusal(recovered.job, basename(dirname(runDir))) };
}

test("a Knockout of several marks keeps its order whole, and a hand resume runs on it", async () => {
  const res = await knockout();
  const kept = JSON.parse(readFileSync(driverDir(res.runDir, ACCEPTED_ORDER_FILE), "utf8"));
  assert.deepEqual(kept.order, ORDER, "the order is kept as it was accepted, marks and routing included");
  const resume = await handResume(res.runDir);
  assert.equal(resume.source, "accepted-order");
  assert.deepEqual(resume.job.marks.map((m) => m.name), ["LANTERNWICK", "CLUVENDRA"]);
  assert.equal(resume.job.forwarderEmail, "jordan@example.com", "the routing only the order holds comes back with it");
  assert.equal(resume.refusal, null, `the resume is refused: ${resume.refusal}`);
});

test("the control: without the kept order the rebuild from status is refused as another matter", async () => {
  const res = await knockout();
  rmSync(driverDir(res.runDir, ACCEPTED_ORDER_FILE), { force: true });
  assert.ok(!existsSync(driverDir(res.runDir, ACCEPTED_ORDER_FILE)));
  const resume = await handResume(res.runDir);
  assert.equal(resume.source, "status", "premise: with no kept order and no queue entry the job comes from status");
  assert.match(resume.refusal ?? "", /different matters/, "a batch's display name derives another slug, and the door refuses it");
});
