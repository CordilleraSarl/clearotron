// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RESUMED KNOCKOUT EMAILS THE COUNTS ITS PAGE STATES. A Knockout resumed after it published keeps the page it published,
// and runs its count step again, which settles a count the register did not answer the first time. The email took the
// counts the lane held, so it stated the late figures beside a page that says "not available" for them. It now reads the
// counts from the run's report document, as the page does.
//
// One run of two names, the second's count unanswered on the first pass, through the lane with a mock engine, register
// and web: no model turn, no register call and no web call is made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-late-count-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", join(ROOT, "ws"));
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

const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { koPaths } = await import("../stages-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");
const { countLine, countsForMark } = await import("../register-count.mjs");
const { paths } = await import("../run-record.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const JOB = { markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }, { name: "EMBERQUILL" }], classes: [4], jurisdictions: ["EU"], forwarder: "jordan" };
// The register leaves EMBERQUILL's counts unanswered while `unanswered` is set, and answers them after.
const register = { unanswered: true };
const EXECUTORS = {
  recordLister: async (term) => ({ ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }),
  countExecutor: async (term) => (register.unanswered && /EMBERQUILL/i.test(String(term))
    ? { ok: false, total: null, reason: "the provider did not answer" } : { ok: true, total: 3 }),
  gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
  sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
};

/** One pass of the lane over `dir`. The archive path sits under a file, so the run stays in place for the next pass. */
async function pass(dir, archiveDir) {
  const id = "ko-late-count";
  const run = { runDir: dir, studioRoot: join(ROOT, "studio", id), slug: "lanternwick", date: "2026-11-11", codename: "late", archiveDir };
  const job = { ...structuredClone(JOB), id, msgId: `<${id}@x>`, ref: "E2E-late" };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, stateReset: true,
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const res = await knockoutInner(ctx, job, EXECUTORS);
  assert.equal(res?.ok, true, `the Knockout did not deliver: ${JSON.stringify(res)}`);
}

const pageLine = (dir) => countLine(countsForMark(JSON.parse(readFileSync(paths(dir).reportDocument, "utf8")).client.registerCounts, "EMBERQUILL"));
const savedLine = (dir) => countLine(countsForMark(JSON.parse(readFileSync(koPaths(dir).registerCounts, "utf8")), "EMBERQUILL"));
const emailLine = (dir) => (readFileSync(koPaths(dir).emailBody, "utf8").match(/<b>EMBERQUILL<\/b>.*?<\/li>/)?.[0] ?? "");

test("a Knockout resumed after publishing emails the counts its page states, not the ones the resume settled", async () => {
  const studio = join(ROOT, "studio", "ko-late-count", "clearance-search");
  mkdirSync(studio, { recursive: true });
  const blocked = join(studio, "not-a-folder");
  writeFileSync(blocked, "the archive cannot be made under a file\n");
  const dir = join(studio, "runs", "lanternwick", "2026-11-11-late");

  await pass(dir, join(blocked, "first"));
  const published = pageLine(dir);
  assert.match(published, /not available/, "premise: the first pass published a count the register did not answer");
  // Resumed after publishing: the page stands, and the register answers this time.
  rmSync(join(dir, ".delivered"), { force: true });
  register.unanswered = false;
  await pass(dir, join(blocked, "second"));
  assert.equal(pageLine(dir), published, "premise: the resume kept the page it published");
  assert.notEqual(savedLine(dir), published, "premise: the resume settled the count the first pass could not take");
  assert.ok(emailLine(dir).includes(published), `the email does not state the page's counts: ${emailLine(dir)}`);
});
