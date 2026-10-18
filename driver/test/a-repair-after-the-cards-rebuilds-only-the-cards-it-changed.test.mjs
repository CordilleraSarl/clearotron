// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the pre-delivery repair end to end on the mock pipeline, on both engines, with invented names
//
// A REPAIR AFTER THE CARDS REBUILDS ONLY THE CARDS IT CHANGED.
//
// Before the delivery seam the driver writes into the findings record twice more than the seam does: the basis
// derivation demotes a `verified-from-record` stamp the reading log cannot back, and the deadline enrichment adds the
// register's own opposition window. A synthesis save after the cards wrote the model's record back. The seam's own
// writes were made again after it; these two were not. A whole re-send brought back every stamp the derivation had
// demoted, so the delivered record claimed reads no step had made, and every card whose finding carried such a stamp
// was rebuilt for a finding the repair had not changed.
//
// The scenario, from mock knobs: three findings, the second a second filing of the first, which the seam folds in;
// the first write-up is over the cap, so the pre-delivery lint re-runs synthesis after the cards, and the mock writer
// re-sends its whole record (MOCK_FINDINGS_N, MOCK_FINDINGS_TWIN, MOCK_NARRATIVE_OVER_CAP). MOCK_LATE_SAVE_EDITS makes
// that save change one finding as well.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { unprovableRecordBases, readOkRecordUris } from "../recall-reconciliation.mjs";

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
// Both engines run the same scenario through the same mock stage fixtures.
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
  const root = tempDir("clearotron-late-save-");
  for (const k of [...MOCK_KNOBS, ...ENGINE_KEYS]) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...knobs })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

const cardStages = (events, triggers) => events.filter((e) => e.event === "stage" && /^report-card:\d+$/.test(String(e.stage))
  && triggers.includes(e.trigger)).map((e) => e.stage).sort();

/** The scenario is the one described, or the claims prove nothing. */
function controls(res, events) {
  assert.deepEqual(cardStages(events, ["fresh"]), ["report-card:1", "report-card:2"], "the cards were not built on a folded record of two findings");
  const lastFresh = events.findLastIndex((e) => e.event === "stage" && /^report-card:/.test(String(e.stage)) && e.trigger === "fresh");
  const repair = events.findIndex((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "lint-repair");
  assert.ok(repair > lastFresh, "no synthesis save ran after the cards were built");
  assert.ok((events.find((e) => e.event === "basis-derivation" && e.at === "post-synthesis")?.demoted ?? 0) > 0,
    "the derivation demoted no stamp before the cards, so a lost demotion could not show");
  const calls = readdirSync(driverDir(res.runDir, "synthesis-calls")).filter((n) => /^call-\d+\.json$/.test(n)).sort();
  const last = JSON.parse(readFileSync(driverDir(res.runDir, "synthesis-calls", calls.at(-1)), "utf8")).params;
  assert.ok(Array.isArray(last?.findings?.findings), "the save after the cards was not a whole re-send");
}

/** The stamps the delivered record carries that the run's reading log cannot back: what the derivation demotes. */
function unprovableDelivered(runDir) {
  const doc = JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8"));
  // the record file and reading log the driver's own derivation reads (pipeline.mjs settleDerivedBases)
  const recordFile = (uri) => join(runDir, "_records", String(uri).replace(/^\/mark\//, "").replace(/[^a-z0-9]+/gi, "-") + ".json");
  let read = new Set();
  try { read = readOkRecordUris(readFileSync(driverDir(runDir, "reading-log.jsonl"), "utf8")); } catch { /* no reads logged */ }
  return unprovableRecordBases({ findings: doc.findings, hasRecord: (uri) => existsSync(recordFile(uri)), wasRead: (uri) => read.has(uri) });
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a whole re-send after the cards keeps the stamps the driver demoted, and rebuilds no card`, async () => {
    const { res, events } = await runPipeline(engine, SCENARIO);
    controls(res, events);
    assert.deepEqual(unprovableDelivered(res.runDir).map((d) => `${d.ordinal}/${d.meter}`), [],
      "the delivered record carries stamps the reading log cannot back");
    assert.deepEqual(cardStages(events, ["stale-repair", "lint-repair"]), [], "a card was rebuilt for a finding the repair did not change");
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test(`${engine}: a repair after the cards that changes one finding rebuilds that card alone, and the delivered report carries it`, async () => {
    // the model's third finding, which the fold numbers second
    const { res, events } = await runPipeline(engine, { ...SCENARIO, MOCK_LATE_SAVE_EDITS: "3" });
    controls(res, events);
    const doc = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
    assert.equal(doc.findings.length, 2, "the repair unfolded the record");
    assert.match(String(doc.findings.find((f) => f.ordinal === 2)?.owner?.name), /\(post-redo\)/, "the change did not land on the folded finding");
    assert.deepEqual(cardStages(events, ["stale-repair", "lint-repair"]), ["report-card:2"], "the rebuilt cards are not the one whose finding changed");
    const report = readFileSync(join(res.runDir, "report.md"), "utf8");
    assert.ok(report.includes("Mock filing detail for Mystery Owner 3 LLC (post-redo)."), "the delivered report does not carry the changed card");
    assert.ok(!report.includes("Mock filing detail for Mystery Owner 3 LLC."), "the delivered report still carries the card from before the change");
    assert.ok(report.includes("Mock filing detail for Mystery Owner LLC."), "the delivered report lost the card the repair did not change");
    assert.equal(res.ok, true, JSON.stringify(res));
  });
}
