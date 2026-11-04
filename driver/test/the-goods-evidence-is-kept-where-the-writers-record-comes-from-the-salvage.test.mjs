// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the writer's first pass through its salvage on the mock pipeline, with invented names
//
// THE GOODS EVIDENCE IS KEPT WHERE THE WRITER'S RECORD COMES FROM THE SALVAGE.
//
// The delivery check reads the goods evidence a cold dispatch of the writer was given, and the writer's stage keeps it
// once the dispatch returns a record. Where the dispatch fails and the salvage after it completes the record, by a
// re-emit or by taking the record with its foreign links blanked, the record still rests on the evidence that dispatch
// was given, so the first pass keeps it there too. Without it such a run kept no copy, and a resumed pass compared its
// findings with evidence derived again after the writer wrote.
//
// The scenario, from a mock knob: every register link reaches the saved file without the transport
// (MOCK_FOREIGN_LINK=file), so the writer's dispatch fails its check and the salvage blanks the links.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { GOODS_EVIDENCE_FILE, GOODS_EVIDENCE_AS_WRITTEN_FILE } from "../goods-evidence.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8442", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

test("a writer's record taken from the salvage after a failed dispatch keeps the goods evidence that dispatch was given", async () => {
  const root = tempDir("clearotron-goods-salvage-");
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_FOREIGN_LINK"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3", MOCK_FOREIGN_LINK: "file" })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // CONTROLS — the writer's first dispatch failed, the salvage completed its record, and the run delivered; the goods
  // evidence was last derived before the writer was dispatched.
  const writer = events.findIndex((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "fresh");
  assert.equal(events[writer]?.ok, false, "the writer's first dispatch did not fail, so no salvage completed its record");
  assert.deepEqual(events.filter((e) => e.event === "foreign-record-links-blanked").map((e) => e.layer), ["salvage"],
    "the salvage did not complete the writer's record");
  assert.ok(events.findLastIndex((e) => e.event === "goods-evidence") < writer, "the goods evidence was derived again after the writer");
  assert.equal(res.ok, true, JSON.stringify(res));
  // THE CLAIM: the copy the delivery check reads is the evidence the failed dispatch was given.
  const at = driverDir(res.runDir, GOODS_EVIDENCE_AS_WRITTEN_FILE);
  assert.ok(existsSync(at), "no copy was kept of the evidence the writer was given");
  assert.equal(readFileSync(at, "utf8"), readFileSync(driverDir(res.runDir, GOODS_EVIDENCE_FILE), "utf8"), "the copy is not the evidence the writer was given");
});
