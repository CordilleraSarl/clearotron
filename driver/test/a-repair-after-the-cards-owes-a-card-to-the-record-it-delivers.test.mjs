// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the pre-delivery repair end to end on the mock pipeline, on both engines, with invented names
//
// A REPAIR AFTER THE CARDS OWES A CARD TO THE RECORD IT DELIVERS, AND NO OTHER.
//
// The cards a run owes were fixed when the cards were first built, and the delivery check judged those cards alone.
// A synthesis save after them can change which findings are owed one. A finding the save adds had no card and no
// card stamp, and a card with no stamp is never stale, so no step built it, and the report rendered that finding
// structured-only. A card whose finding the save withdrew stayed on the delivery path: its finding no longer had a
// card owed, so the repair could not rebuild it, and the delivery check held the run back over a card it would never
// have shipped.
//
// The scenario, from mock knobs: three findings, the second a second filing of the first, which the seam folds in;
// the first write-up is over the cap, so the pre-delivery lint re-runs synthesis after the cards, and the mock writer
// re-sends its whole record. MOCK_LATE_SAVE_ADDS makes that record carry a fourth finding, and
// MOCK_LATE_SAVE_WITHDRAWS withdraws the third.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8441", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const ENGINE_KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY"];
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_FINDINGS_TWIN", "MOCK_NARRATIVE_OVER_CAP",
  "MOCK_LATE_SAVE_EDITS", "MOCK_LATE_SAVE_ADDS", "MOCK_LATE_SAVE_WITHDRAWS"];
const SCENARIO = { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3", MOCK_FINDINGS_TWIN: "2",
  MOCK_NARRATIVE_OVER_CAP: "1" };

async function runPipeline(engine, knobs) {
  const root = tempDir("clearotron-owed-card-");
  for (const k of [...MOCK_KNOBS, ...ENGINE_KEYS]) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...knobs })) pinEnv(process.env, k, v);
  const { pipeline, fullProseOrdinals } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, fullProseOrdinals };
}

const isCard = (e) => e.event === "stage" && /^report-card:\d+$/.test(String(e.stage));

/** The scenario is the one described: cards built on the folded record, then a whole re-send of `modelFindings`. */
function controls(res, events, modelFindings) {
  assert.deepEqual(events.filter((e) => isCard(e) && e.trigger === "fresh").map((e) => e.stage).sort(), ["report-card:1", "report-card:2"],
    "the cards were not built on a folded record of two findings");
  const lastFresh = events.findLastIndex((e) => isCard(e) && e.trigger === "fresh");
  const repair = events.findIndex((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "lint-repair");
  assert.ok(repair > lastFresh, "no synthesis save ran after the cards were built");
  const calls = readdirSync(driverDir(res.runDir, "synthesis-calls")).filter((n) => /^call-\d+\.json$/.test(n)).sort();
  const last = JSON.parse(readFileSync(driverDir(res.runDir, "synthesis-calls", calls.at(-1)), "utf8")).params;
  assert.equal(last?.findings?.findings?.length, modelFindings, "the save after the cards did not re-send the record described");
  return repair;
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a finding a repair after the cards adds gets the card it is owed, and the delivered report carries it`, async () => {
    const { res, events, fullProseOrdinals } = await runPipeline(engine, { ...SCENARIO, MOCK_LATE_SAVE_ADDS: "1" });
    const repair = controls(res, events, 4);
    const doc = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
    assert.equal(doc.findings.length, 3, "the delivered record is not the folded record of three findings");
    const added = doc.findings.find((f) => f.owner?.name === "Mystery Owner 4 LLC");
    assert.equal(added?.ordinal, 3, "premise: the added finding is not the record's third");
    const cards = existsSync(join(res.runDir, "report-cards")) ? readdirSync(join(res.runDir, "report-cards")) : [];
    assert.deepEqual(fullProseOrdinals(doc.findings).filter((o) => !cards.includes(`${o}.md`)), [], "a finding owed a card shipped without one");
    assert.ok(events.slice(repair).some((e) => isCard(e) && e.stage === "report-card:3" && e.ok === true), "no card was built for the added finding");
    assert.deepEqual(events.slice(repair).filter((e) => isCard(e) && e.stage !== "report-card:3").map((e) => e.stage), [],
      "a card whose finding did not change was rebuilt");
    assert.ok(readFileSync(join(res.runDir, "report.md"), "utf8").includes("Mock filing detail for Mystery Owner 4 LLC."),
      "the delivered report does not carry the added finding's card");
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test(`${engine}: a card whose finding a repair after the cards withdrew stays off the delivery path, and the run delivers in one pass`, async () => {
    // the model's third finding, which the fold numbers second
    const { res, events } = await runPipeline(engine, { ...SCENARIO, MOCK_LATE_SAVE_WITHDRAWS: "3" });
    controls(res, events, 3);
    const doc = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
    assert.equal(doc.findings.find((f) => f.ordinal === 2)?.disposition, "withdrawn", "premise: the folded second finding is not withdrawn");
    assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"), "the delivery check held the run back over the withdrawn finding's card");
    assert.ok(existsSync(join(res.runDir, ".delivered")), "the run did not deliver in one pass");
    assert.ok(!readFileSync(join(res.runDir, "report.md"), "utf8").includes("Mock filing detail for Mystery Owner 3 LLC."),
      "the delivered report carries the card of the finding the repair withdrew");
    assert.equal(res.ok, true, JSON.stringify(res));
  });
}
