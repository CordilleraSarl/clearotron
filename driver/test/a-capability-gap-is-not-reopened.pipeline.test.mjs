// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ENVELOPE NEVER HANDS A SLICE THE RUN ACCEPTED AS A CAPABILITY GAP BACK AS WORK.
//
// The envelope re-opens deferred coverage when time permits, and decides what is closeable from the reason
// the seat wrote on each ledger row. A seat that describes a provider refusal in its own words (the mock
// seat writes "the active register provider cannot express this slice", which names no gap the split
// recognises) had the gap offered back to it as work, and on production the model then re-proposed the
// refused query. The run's own record of the gap now decides, through the coverage form's qid: the row is
// named to the re-opened unit as not its to close, and an axis whose only open work is such gaps is held.
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

const { PLAN_ENTRY_RERUN_RULE } = await import("../stages.mjs");

async function run(env) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-mock-"));
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", ...env }))
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
    // The axis carries a closeable row as well (the mock seat defers one slice as "not run"), so the envelope
    // rightly re-opens it. What changes is what the re-opened unit is asked to do.
    const gapUnit = "primary-sweep / exact: PROJECT NOVAPULSE [cl 25]";
    const close = events.filter((e) => e.event === "envelope-close-rows" && e.axis === "primary-sweep");
    assert.equal(close.length, 1, `the envelope did not re-open the axis, so this arm sees nothing: ${JSON.stringify(events.filter((e) => /envelope/.test(e.event)))}`);
    assert.ok(!close[0].closeable.includes(gapUnit), `the accepted gap was handed back to the seat as work to close: ${JSON.stringify(close[0])}`);
    assert.ok(close[0].held.includes(gapUnit), "the unit was not told to leave the gap as it is");
    assert.ok(close[0].closeable.length >= 1, "the closeable row on the same axis stopped being offered");

    // AND THE RE-OPENED UNIT IS TOLD NOT TO RUN THE WHOLE AXIS AGAIN. Its plan has already run; a
    // register_execute_plan call without qids asks every entry again and re-fetches every record the axis
    // holds. Read off the prompt the run actually dispatched, not off the builder.
    const prompts = readdirSync(driverDir(res.runDir)).filter((f) => /\.dispatch\.txt(\.prev-[0-9a-f]+)?$/.test(f))   // a later dispatch keeps an earlier one as .prev-<hash>
      .map((f) => readFileSync(driverDir(res.runDir, f), "utf8")).filter((t) => t.includes("records DEFERRED (planned but never run)"));
    assert.equal(prompts.length, 1, "the envelope's follow-up was dispatched once, and its text was recorded");
    assert.ok(prompts[0].includes(PLAN_ENTRY_RERUN_RULE), "the follow-up carries the rule against a whole-axis re-run");
  } finally { delete process.env.MOCK_PLAN_DEFERRED; }
});
