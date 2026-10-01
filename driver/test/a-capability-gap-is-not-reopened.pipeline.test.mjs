// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ENVELOPE NEVER HANDS A SLICE THE RUN ACCEPTED AS A CAPABILITY GAP BACK AS WORK.
//
// The envelope re-opens deferred coverage when time permits, and decides what is closeable from the reason
// on each ledger row. A seat that described a provider refusal in its own words had the gap offered back to
// it as work, and on production the model then re-proposed the refused query. The run's own record of the
// gap now decides, through the coverage form's qid: the row is named to a re-opened unit as not its to
// close, and an axis whose only open work is such gaps is held.
//
// Code now settles every coverage row from the run's facts, so the gap is the axis's only deferred row
// here and the axis is held. The split inside an axis that also carries closeable work, and the rule
// against a whole-axis re-run, are pinned on their own (a-capability-gap-is-decided-once-per-run,
// a-follow-up-re-runs-only-what-is-missing).
//
// Driven through the whole mock pipeline, so the envelope's decision is the one a run makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
const PROFILES = mkdtempSync(join(tmpdir(), "clearotron-profiles-"));
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
mkdirSync(join(PROFILES, "projects", "demo-brand-owner"), { recursive: true });
writeFileSync(join(PROFILES, "projects", "demo-brand-owner", "japan-and-korea-app-launch.json"),
  JSON.stringify({ projectName: "Japan and Korea app launch", platforms: ["store.steampowered.com"] }, null, 2) + "\n");
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES);

const JOB = { id: "test-job", msgId: "<test@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP-2201", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch" };

async function run(env) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-mock-"));
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",...env }))
    pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, {});
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("the envelope never hands an accepted capability gap back as work, whatever the seat wrote about it", async () => {
  try {
    const { res, events } = await run({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_PLAN_DEFERRED: "+merch" });
    assert.equal(res.ok, true, JSON.stringify(res));
    const decision = JSON.parse(readFileSync(driverDir(res.runDir, "envelope-decision.json"), "utf8"));
    const gaps = (decision.sticky_gaps ?? []).map((g) => g.qid);
    assert.ok(gaps.some((q) => q.includes("+merch")), `the run did not record the gap it accepted: ${JSON.stringify(decision.sticky_gaps)}`);
    // The gap is the axis's only deferred row, so the envelope HOLDS the axis: no unit is re-opened, and
    // nothing is dispatched that could hand the gap back as work.
    const gapUnit = "primary-sweep / exact: PROJECT NOVAPULSE [cl 25]";
    const env = events.filter((e) => e.event === "envelope-decision");
    assert.equal(env.length, 1, `the envelope made no decision: ${JSON.stringify(events.filter((e) => /envelope/.test(e.event)))}`);
    assert.deepEqual(env[0].held, ["primary-sweep"], "the axis whose only open work is an accepted gap was not held");
    assert.ok(env[0].held_rows[0].rows.some((r) => r.unit === gapUnit), `the held row is not the accepted gap: ${JSON.stringify(env[0].held_rows)}`);
    assert.equal(env[0].close, false, "an axis held for a capability gap was closed by time");
    assert.equal(events.filter((e) => e.event === "envelope-close-rows").length, 0, "a held axis was re-opened");
    const prompts = readdirSync(driverDir(res.runDir)).filter((f) => /\.dispatch\.txt(\.prev-[0-9a-f]+)?$/.test(f))
      .map((f) => readFileSync(driverDir(res.runDir, f), "utf8")).filter((t) => t.includes("records DEFERRED (planned but never run)"));
    assert.equal(prompts.length, 0, "the accepted gap was dispatched back to a unit as work to close");
  } finally { delete process.env.MOCK_PLAN_DEFERRED; }
});
