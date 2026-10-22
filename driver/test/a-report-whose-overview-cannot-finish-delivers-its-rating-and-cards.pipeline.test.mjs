// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline whose report overview cannot finish through its park and its resume, on both engines
//
// A REPORT WHOSE OVERVIEW CANNOT FINISH DELIVERS ITS RATING AND ITS CARDS (874).
//
// The report overview writes the conclusion under the rating. When it failed and its recovery was spent, the run ended with
// the stop notice, though it held the findings, the review and the rating. Now the part is recorded as not completed and
// the resumed pass delivers the report with its rating and its cards and no conclusion. The workbook carries the shipped
// row for the report's top section, "Summary", and no overview is dispatched again on the delivering pass. Every mark and
// owner is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { PART_NAMES } from "../degraded-parts.mjs";

const TEMP_DIRS = [];
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

const JOB = { id: "test-job-open-overview", msgId: "<open-overview@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8192", markName: "ORBANTIQ", classes: [9, 41], provider: "corsearch" };
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE"];
const OVERVIEW_TURN = "record_report_overview";

async function runPass(root, engine, knobs = {}, codename = null) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CONDITIONAL", MOCK_SKEPTIC: "no flags surfaced", ...knobs }))
    pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  return pipeline({ ...JOB }, codename ? { codename } : {});
}
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("the part's name is the report's own top section, as its section strip prints it", () => {
  assert.equal(PART_NAMES.summary, "Summary");
  assert.ok(readFileSync(join(HERE, "..", "publish", "render.mjs"), "utf8").includes(`['summary', '${PART_NAMES.summary}']`),
    "the report's section strip no longer prints the name the part is given");
});

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: an overview that cannot finish parks once, and the report delivers its rating and cards with no conclusion`, async () => {
    const root = mkdtempSync(join(tmpdir(), "clearotron-open-overview-"));
    TEMP_DIRS.push(root);
    const p1 = await runPass(root, engine, { MOCK_FAIL_STAGE: OVERVIEW_TURN });
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1)}`);
    assert.equal(json(driverDir(p1.runDir, "not-completed", "overview.json")).stage, "report-overview");
    const n1 = events(p1.runDir).length;
    // The failing knob stays armed: the delivering pass must not dispatch the overview at all.
    const p2 = await runPass(root, engine, { MOCK_FAIL_STAGE: OVERVIEW_TURN }, p1.codename);
    assert.equal(p2.ok, true, `the run did not deliver: ${JSON.stringify(p2)}`);
    assert.equal(p2.verdict, "CONDITIONAL", "the review's sign-off was lost with the overview");
    const rd = p2.runDir;
    const ev2 = events(rd).slice(n1);
    assert.deepEqual(ev2.filter((e) => e.event === "stage" && e.stage === "report-overview").map((e) => e.trigger), [],
      "the delivering pass dispatched the overview");
    assert.ok(ev2.some((e) => e.event === "overview-not-completed-delivery"), "the delivery is not on the run's record");
    assert.ok(!existsSync(join(rd, ".failed")) && !existsSync(driverDir(rd, "failure.json")), "a delivered run carries a failure");
    assert.ok(!existsSync(driverDir(rd, "not-completed", "assessment.json")), "the assessment was recorded as not completed");
    assert.ok(!/^overall_caption:/m.test(readFileSync(join(rd, "report.md"), "utf8")), "the report carries a conclusion no overview wrote");

    const status = json(join(rd, "status.json"));
    const pool = join(root, "pool", status.runId);
    const meta = json(join(pool, "meta.json"));
    assert.ok(meta.overall, "the rating did not reach the pool");
    assert.equal(meta.caption, undefined, "the run list quotes a conclusion no overview wrote");
    assert.equal(meta.assessment, undefined, "an overview not completed was stated as the assessment not completed");
    const html = readFileSync(join(pool, "report.html"), "utf8");
    assert.ok(html.includes('class="tb-risk"') && html.includes('class="panel gauge"'), "the page lost its rating with the overview");
    const parts = json(driverDir(rd, "degraded-parts.json")).parts;
    const row = json(driverDir(rd, "degraded-parts.json")).rows.find((r) => r.area.endsWith(PART_NAMES.summary));
    assert.ok(parts.some((d) => d.part === "overview" && d.name === PART_NAMES.summary), `the part is not on the record: ${JSON.stringify(parts)}`);
    assert.match(row?.note ?? "", /it could not be completed this run, so it is left open here rather than reported as clean$/,
      "the workbook's row is not the shipped gap row");
  });
}
