// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STOP PRESSED DURING A KNOCKOUT'S LAST STAGE PUBLISHES NOTHING. On this lane publication follows the final stage
// directly and never goes through the gateway, whose read of the stop flag comes before a turn is sent, so a stop
// pressed while the review ran was seen by nothing and the report went out (measured: published 100 seconds after the
// stop). The lane now reads the flag once more before it publishes. This drives a Knockout whose review records a stop
// while it runs, and reads what the run left: no published record, nothing in the pool, a cancelled run.
//
// It replaces an arm that compared the read's position with the publish call's in the source text, which held only
// while those strings stayed unique and said nothing of what a run does.
import { mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-stop-before-publish-"));
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

/** One knockout through the lane; what it returned or threw, and its run directory. */
async function knockout(codename, env = {}) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-11-10-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-11-10", codename, archiveDir: join(studioRoot, "archive", `2026-11-10-${codename}`) };
  const job = { id, markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  let res = null, thrown = null;
  try {
    res = await knockoutInner(ctx, job, {
      recordLister: async (term) => ({ ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }),
      countExecutor: async () => ({ ok: true, total: 3 }),
      gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
      sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
    });
  } catch (e) { thrown = e; }
  finally { for (const k of Object.keys(env)) delete process.env[k]; }
  return { res, thrown, dir };
}

const inPool = (codename) => (existsSync(join(ROOT, "pool")) ? readdirSync(join(ROOT, "pool"), { recursive: true }) : [])
  .filter((p) => String(p).includes(codename));

test("a stop recorded while the review runs ends the Knockout cancelled, with nothing published", async () => {
  const { res, thrown, dir } = await knockout("stopped-in-review", { MOCK_KO_REVIEW_STOP: "1" });
  assert.notEqual(res?.ok, true, "the Knockout delivered after its stop");
  assert.ok(existsSync(join(dir, ".cancel")), "premise: the review recorded the stop while it ran");
  assert.equal(existsSync(join(dir, ".published")), false, "the report was published after the stop: the last read came too late");
  assert.deepEqual(inPool("stopped-in-review"), [], "the pool holds the stopped run's report");
  const status = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
  assert.equal(status.state, "cancelled", `the run ended ${status.state}${thrown ? ` (${String(thrown.message).slice(0, 120)})` : ""}, not cancelled`);
});

test("CONTROL: the same Knockout with no stop publishes, so the arm above is about the stop", async () => {
  const { res, dir } = await knockout("not-stopped");
  assert.equal(res?.ok, true, `the Knockout did not deliver: ${JSON.stringify(res)}`);
  assert.ok(existsSync(join(dir, ".published")) || existsSync(join(res.runDir, ".published")), "the unstopped Knockout published nothing");
});
