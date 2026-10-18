// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the corrective pass and the cards end to end on the mock pipeline, on both engines, with invented names
//
// THE CARDS ARE BUILT ON THE SETTLED RECORD, EVEN AFTER A CORRECTIVE PASS.
//
// The basis derivation demotes a `verified-from-record` stamp the run's reading log cannot back, right after the
// first synthesis save and again before delivery. On a run whose review asks for corrections, the corrective pass
// saves synthesis again in between, and a whole re-send brings back every stamp the derivation had demoted. The cards
// were then built on those stamps, the derivation before delivery demoted them again, and every card whose finding
// carried one read as stale and was rebuilt, with the overview, for a finding nothing had changed.
//
// Now the derivation settles the record once more at the seam, before the overview and the cards are built.
//
// The scenario, from mock knobs: three findings; the review returns CONDITIONAL, so the corrective pass runs, and the
// mock writer re-sends its whole record (MOCK_VERDICT, MOCK_FINDINGS_N).
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
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const ENGINE_KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY"];
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N"];
const SCENARIO = { MOCK_VERDICT: "CONDITIONAL", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3" };

async function runPipeline(engine, knobs) {
  const root = tempDir("clearotron-corrective-cards-");
  for (const k of [...MOCK_KNOBS, ...ENGINE_KEYS]) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...knobs })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
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
  test(`${engine}: after a corrective pass that re-sends the whole record, the cards are built on the settled record and none is rebuilt`, async () => {
    const { res, events } = await runPipeline(engine, SCENARIO);
    // CONTROLS — the scenario is the one described.
    const corrective = events.findIndex((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "corrective" && e.ok === true);
    const firstCard = events.findIndex((e) => e.event === "stage" && /^report-card:\d+$/.test(String(e.stage)) && e.trigger === "fresh");
    assert.ok(corrective >= 0 && corrective < firstCard, "no corrective save ran before the cards were built");
    assert.ok((events.find((e) => e.event === "basis-derivation" && e.at === "post-synthesis")?.demoted ?? 0) > 0,
      "the derivation demoted no stamp before the corrective pass, so a lost demotion could not show");
    const calls = readdirSync(driverDir(res.runDir, "synthesis-calls")).filter((n) => /^call-\d+\.json$/.test(n)).sort();
    assert.ok(calls.some((n) => Array.isArray(JSON.parse(readFileSync(driverDir(res.runDir, "synthesis-calls", n), "utf8")).params?.findings?.findings)
      && n !== calls[0]), "the corrective pass did not re-send a whole record");
    // THE CLAIMS.
    assert.equal(events.find((e) => e.event === "basis-derivation" && e.at === "pre-delivery")?.demoted, 0,
      "the derivation before delivery found stamps the cards had been built on");
    assert.deepEqual(events.filter((e) => e.event === "stage" && /^report-card:\d+$/.test(String(e.stage)) && e.trigger !== "fresh")
      .map((e) => `${e.stage}/${e.trigger}`), [], "a card was rebuilt for a finding nothing had changed");
    assert.deepEqual(unprovableDelivered(res.runDir).map((d) => `${d.ordinal}/${d.meter}`), [],
      "the delivered record carries stamps the reading log cannot back");
    assert.equal(res.ok, true, JSON.stringify(res));
  });
}
