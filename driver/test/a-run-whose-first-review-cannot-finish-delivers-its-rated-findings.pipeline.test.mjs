// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline whose first review cannot finish through its park and its resume, on both engines
//
// A RUN WHOSE FIRST REVIEW CANNOT FINISH DELIVERS ITS RATED FINDINGS, WITH THE BAND ALONE (874).
//
// The first review reads the assessment and signs it. When it failed and its recovery was spent, the run ended with the
// stop notice, though it held the rated findings. Now the part is recorded as not completed, and the resumed pass delivers
// the findings with their band and no verdict sentence, as a review that signs nothing already renders. No sign-off is
// recorded on any surface, because nobody gave one, and no corrective pass runs, because there are no flags to answer. The
// workbook's shipped "Machine QC" row records the review as not completed. Every mark and owner is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
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

const JOB = { id: "test-job-open-review", msgId: "<open-review@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8191", markName: "ORBANTIQ", classes: [9, 41], provider: "corsearch" };
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE"];
const REVIEW_TURN = `narrative-refutation${sep}SKILL`;

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

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a first review that cannot finish parks once, and the findings are delivered with the band alone and no sign-off`, async () => {
    const root = mkdtempSync(join(tmpdir(), "clearotron-open-review-"));
    TEMP_DIRS.push(root);
    const p1 = await runPass(root, engine, { MOCK_FAIL_STAGE: REVIEW_TURN });
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1)}`);
    assert.equal(json(driverDir(p1.runDir, "not-completed", "review.json")).stage, "narrative-refutation");
    const n1 = events(p1.runDir).length;
    // The failing knob stays armed: the delivering pass must not dispatch the review at all.
    const p2 = await runPass(root, engine, { MOCK_FAIL_STAGE: REVIEW_TURN }, p1.codename);
    assert.equal(p2.ok, true, `the run did not deliver: ${JSON.stringify(p2)}`);
    assert.equal(p2.verdict, null, "a sign-off nobody gave was returned");
    const rd = p2.runDir;
    const ev2 = events(rd).slice(n1);
    assert.deepEqual(ev2.filter((e) => e.event === "stage" && e.stage === "narrative-refutation").map((e) => e.trigger ?? "fresh"), [],
      "the delivering pass dispatched the review");
    assert.ok(!ev2.some((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "corrective"), "a corrective pass ran with no flags to answer");
    assert.ok(ev2.some((e) => e.event === "review-not-completed-delivery"), "the delivery is not on the run's record");
    assert.ok(!existsSync(join(rd, ".failed")) && !existsSync(driverDir(rd, "failure.json")), "a delivered run carries a failure");

    const status = json(join(rd, "status.json"));
    assert.equal(status.review?.signoff ?? null, null, "status records a sign-off nobody gave");
    assert.ok(status.tier, "the band did not reach the run's status");
    assert.equal(status.statement ?? null, null, "status carries a verdict sentence no review signed");
    const verdict = json(driverDir(rd, "verdict.json"));
    assert.equal(verdict.verdict ?? null, null, "the verdict on record carries a sign-off nobody gave");
    assert.ok(verdict.tier, "the verdict on record lost its band");
    assert.equal(verdict.statement ?? null, null, "the verdict on record carries a sentence");

    const pool = join(root, "pool", status.runId);
    const meta = json(join(pool, "meta.json"));
    assert.equal(meta.overall, verdict.tier, "the run list's band is not the run's");
    for (const k of ["review", "statement", "assessment"]) assert.equal(meta[k], undefined, `meta.json carries ${k}`);
    const html = readFileSync(join(pool, "report.html"), "utf8");
    assert.ok(html.includes('class="tb-risk"') && html.includes('class="panel gauge"'), "the page lost the band with the review");
    assert.ok(!html.includes('<span class="gk">Verdict</span>'), "the page states a verdict no review signed");
    const mail = String(json(driverDir(rd, "delivery.json")).emailBodyHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.ok(mail.includes(`Overall risk: ${verdict.tier}.`), "the email lost the band");
    assert.ok(!/Only you can close these/.test(mail), "the email carries a review's conditions");
    const parts = json(driverDir(rd, "degraded-parts.json")).parts;
    const checks = parts.find((d) => d.part === "checks");
    assert.equal(checks?.name, PART_NAMES.machineQc, `the review not completed is not on the workbook's Machine QC row: ${JSON.stringify(parts)}`);
    assert.match(checks.cause, /the review, not completed/, "the row's cause does not name the review");
  });
}
