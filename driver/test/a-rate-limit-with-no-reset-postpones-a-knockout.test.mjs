// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the knockout lane on the mock engine
//
// A RATE LIMIT WITH NO RESET TIME IS STILL A RATE LIMIT, ON A KNOCKOUT AS ON A CLEARANCE.
//
// The engine reports a rejected turn as `rate_limited`, with the reset time when the provider gave one. A clearance's
// steps treat either as a rate limit and hand it to the shared postponement. Three Knockout steps that may fail without
// stopping the run (the register reading, the correction and its recheck) tested the reset time alone, so a rate limit
// that named none was taken as the step failing, and the run went on without it. This drives the knockout lane on the
// mock engine with the register reading's turn rejected.
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-rate-limit-"));
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

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
/** A phrase only the register reading's turn carries (stages-knockout.mjs, "knockout-register-read"). */
const READING_TURN = "You are reading the register for a KNOCKOUT batch";

/** One knockout through the lane, with the register reading's turn rejected; what the lane answered or threw. */
async function knockoutWithTheReadingRejected(codename, resetsAt) {
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-11-10-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-11-10", codename, archiveDir: join(studioRoot, "archive", `2026-11-10-${codename}`) };
  // Register FIXTURES rather than an injected lister: an injected register has no tool server a model turn could reach,
  // so the code reads it and the reading turn never runs. A fixture register is read by the turn.
  const fixtures = mkdtempSync(join(ROOT, "fixtures-"));
  writeFileSync(join(fixtures, "lanternwick.json"), JSON.stringify({ total: 1, records: [FILING] }));
  const job = { id, markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}`, registerFixtures: { records: fixtures } };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const saved = { ...process.env };
  Object.assign(process.env, { MOCK_CLAUDE_RATELIMIT: resetsAt, MOCK_CLAUDE_RATELIMIT_MATCH: READING_TURN });
  try {
    const res = await knockoutInner(ctx, job, {
      countExecutor: async () => ({ ok: true, total: 3 }),
      gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
      sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
    });
    return { res, thrown: null, dir };
  } catch (e) {
    return { res: null, thrown: e, dir };
  } finally { process.env = saved; }
}

test("a rate limit that names no reset time stops the knockout for the shared postponement, as one that names it does", async () => {
  // "none" is no number: the rejected turn carries no reset time, which is the shape the engine reports as a bare
  // `rate_limited`. The control below gives one.
  const bare = await knockoutWithTheReadingRejected("no-reset", "none");
  assert.equal(bare.res, null, `the run went on past a rate limit: ${JSON.stringify(bare.res)?.slice(0, 200)}`);
  assert.equal(bare.thrown?.rateLimited, true, `what reached pipeline() was not a rate limit: ${bare.thrown?.message}`);
  assert.equal(bare.thrown?.resetsAt ?? null, null, "premise: no reset time was given");
  assert.equal(existsSync(join(bare.dir, ".failed")), false, "a rate limit is no failure");
  assert.equal(existsSync(join(bare.dir, ".delivered")), false);

  const timed = await knockoutWithTheReadingRejected("with-reset", String(Math.floor(Date.now() / 1000) + 3600));
  assert.equal(timed.res, null, "the control: a rate limit with its reset time reaches pipeline() as it always did");
  assert.equal(timed.thrown?.rateLimited, true);
  assert.ok(timed.thrown?.resetsAt, "premise: the control carries its reset time");
});
