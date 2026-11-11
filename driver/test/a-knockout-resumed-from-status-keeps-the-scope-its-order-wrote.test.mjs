// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the Knockout lane twice over one run folder on the mock engine
//
// A KNOCKOUT RESUMED FROM STATUS KEEPS THE SCOPE ITS ORDER WROTE, AS A CLEARANCE DOES.
//
// A resume with no order to hand rebuilds its job from the run's status. That job knows the names, and not each name's
// own classes or reference. The Knockout wrote its instructed scope again on every pass, so such a resume replaced the
// scope its order wrote with a narrower one: each name's own classes and reference were lost, and the steps that read
// the scope or ask with a name's classes saw a different matter. A clearance keeps its scope in that case. The Knockout
// now does too, and reads the names from it, so nothing the order said is lost. A resume given its order again still
// writes the scope from that order.
//
// Nothing dials a register or the web: every executor is injected, and the engine is the mock. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-scope-on-resume-"));
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
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { keepsInstructedScope } = await import("../accepted-order.mjs");
const { instructedScopeToWrite } = await import("../pipeline.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
// The order: the batch is instructed over classes 4 and 21, and LANTERNWICK's own row narrows it to class 4, with a
// reference of its own.
const ORDER = { markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK", classes: [4], ref: "LW-REF-7" }], classes: [4, 21], jurisdictions: ["EU"], forwarder: "jordan" };
// What a resume rebuilds from status: the names, and the batch's classes.
const REBUILT = { markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4, 21], jurisdictions: ["EU"], forwarder: "jordan" };
const EXECUTORS = {
  recordLister: async (term) => ({ ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }),
  countExecutor: async () => ({ ok: true, total: 3 }),
  gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
  sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
};

async function pass(codename, dir, archiveDir, order, extra = {}) {
  const id = `ko-${codename}`;
  const run = { runDir: dir, studioRoot: join(ROOT, "studio", id), slug: "lanternwick", date: "2026-11-11", codename, archiveDir };
  const job = { ...structuredClone(order), id, msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, stateReset: true,
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const res = await knockoutInner(ctx, job, { ...EXECUTORS, ...extra });
  assert.equal(res?.ok, true, `the Knockout did not deliver: ${JSON.stringify(res)}`);
  return res;
}
const journal = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const scopeOf = (dir) => readFileSync(driverDir(dir, "instructed-scope.json"), "utf8");

/** A first pass on the order, then a second over the same folder with `job` and `extra`, as a resume. */
async function resumedWith(codename, job, extra) {
  const studio = join(ROOT, "studio", `ko-${codename}`, "clearance-search");
  mkdirSync(studio, { recursive: true });
  const blocked = join(studio, "not-a-folder");
  writeFileSync(blocked, "the archive cannot be made under a file\n");
  const dir = join(studio, "runs", "lanternwick", `2026-11-11-${codename}`);
  await pass(codename, dir, join(blocked, "first"), ORDER);
  assert.ok(readdirSync(dir).includes(".delivered"), "premise: the first pass delivered and stayed in place");
  for (const f of [".published", ".delivered"]) rmSync(join(dir, f), { force: true });
  const first = scopeOf(dir);
  const before = journal(dir).length;
  await pass(codename, dir, join(blocked, "second"), job, extra);
  return { dir, first, rows: journal(dir).slice(before) };
}
const ran = (rows) => rows.filter((r) => r.event === "stage" && r.lane === "knockout").map((r) => r.stage);

test("a Knockout resumed from status keeps the scope its order wrote, each name's classes and reference included", async () => {
  const { dir, first, rows } = await resumedWith("rebuilt", REBUILT, { jobRebuiltFromStatus: true });
  const detailed = JSON.parse(first).marksDetailed;
  assert.deepEqual(detailed, [{ name: "LANTERNWICK", classes: [4], ref: "LW-REF-7" }], "premise: the order's own row is in the scope");
  assert.equal(scopeOf(dir), first, "the resume rewrote the scope its order wrote");
  assert.deepEqual(ran(rows), [], `a step ran again, though the matter did not change: ${JSON.stringify(rows.filter((r) => r.event === "stage-stale"))}`);
});

test("a Knockout resumed on its order again writes the scope from that order", async () => {
  const amended = { ...structuredClone(ORDER), marks: [{ name: "LANTERNWICK", classes: [4, 21], ref: "LW-REF-8" }] };
  const { dir } = await resumedWith("order-again", amended, {});
  assert.deepEqual(JSON.parse(scopeOf(dir)).marksDetailed, [{ name: "LANTERNWICK", classes: [4, 21], ref: "LW-REF-8" }],
    "an order given again is the run's instruction, and its scope is written from it");
});

test("one decision for both products: keep the scope only when the job was rebuilt and a scope is there", () => {
  assert.equal(keepsInstructedScope({ jobRebuiltFromStatus: true, scopeOnDisk: true }), true);
  assert.equal(keepsInstructedScope({ jobRebuiltFromStatus: true, scopeOnDisk: false }), false, "a run with no scope yet writes one");
  assert.equal(keepsInstructedScope({ jobRebuiltFromStatus: false, scopeOnDisk: true }), false, "an order read from a file writes as before");
  assert.equal(keepsInstructedScope(), false);
  assert.equal(instructedScopeToWrite({ markName: "LANTERNWICK" }, { jobRebuiltFromStatus: true, scopeOnDisk: true }), null, "the clearance takes the same decision");
  assert.notEqual(instructedScopeToWrite({ markName: "LANTERNWICK" }, { jobRebuiltFromStatus: false, scopeOnDisk: true }), null);
});
