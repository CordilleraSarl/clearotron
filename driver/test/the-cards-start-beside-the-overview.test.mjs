// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The report cards waited for the report overview, though neither reads the other's output: about a minute of serial
// wall a clearance. They now start beside it and the step joins both before assembly. What must not move with that is
// the report: whichever finishes first, the assembled report is the same. These arms run the whole mock pipeline in a
// temporary home, ordering the overview against the cards with the mock engine's delays. No model or register is
// called and nothing is spent. An overview recorded as not completed, which is not dispatched at all, is run end to end by
// a-report-whose-overview-cannot-finish-delivers-its-rating-and-cards.pipeline.test.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
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
const KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_STAGE_TRACE", "MOCK_TRACE_OVERVIEW", "MOCK_STAGE_DELAY_MS", "MOCK_OVERVIEW_DELAY_MS", "MOCK_FAIL_STAGE"];

async function runPipeline(knobs) {
  const root = tempDir("clearotron-cards-beside-");
  const trace = join(root, "trace.jsonl");
  for (const k of KNOBS) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3", MOCK_STAGE_TRACE: trace, MOCK_TRACE_OVERVIEW: "1", ...knobs })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  let spans = [];
  try { spans = readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* no trace */ }
  return { res, events, spans };
}

/** The assembled report with this run's own name taken out: the date and codename, which differ run to run. */
function reportOf(res) {
  const id = basename(res.runDir);
  const codename = id.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return readFileSync(join(res.runDir, "report.md"), "utf8").split(id).join("<run>").split(codename).join("<codename>");
}
const window = (spans, card) => ({ start: spans.find((s) => s.card === card && s.phase === "start")?.t, end: spans.find((s) => s.card === card && s.phase === "end")?.t });

test("whichever finishes first, overview or cards, the assembled report is the same", async () => {
  const overviewFirst = await runPipeline({ MOCK_STAGE_DELAY_MS: "1500" });
  const cardsFirst = await runPipeline({ MOCK_OVERVIEW_DELAY_MS: "2500" });
  const interleaved = await runPipeline({ MOCK_OVERVIEW_DELAY_MS: "1200", MOCK_STAGE_DELAY_MS: "1000" });
  for (const r of [overviewFirst, cardsFirst, interleaved]) assert.equal(r.res.ok, true, JSON.stringify(r.res));
  const o = window(overviewFirst.spans, "overview"), c1 = window(overviewFirst.spans, "1");
  assert.ok(o.end < c1.end, "the overview did not finish first in the arm meant to order it first");
  const o2 = window(cardsFirst.spans, "overview"), c2 = window(cardsFirst.spans, "1");
  assert.ok(c2.start < o2.end, "the first card did not start before the overview ended: they did not run together");
  assert.ok(c2.end < o2.end, "the cards did not finish first in the arm meant to order them first");
  const base = reportOf(overviewFirst.res);
  assert.equal(reportOf(cardsFirst.res), base, "the report changed when the cards finished first");
  assert.equal(reportOf(interleaved.res), base, "the report changed when the two interleaved");
  // The freshness check on the delivery path finds nothing the order made stale.
  for (const r of [overviewFirst, cardsFirst, interleaved])
    assert.deepEqual(r.events.filter((e) => e.event === "stage-stale" && /^report-(overview|card)/.test(String(e.stage))), [],
      "a report stage read as stale after the two ran together");
});

test("an overview that fails during the fan-out is raised after every card has settled", async () => {
  // The overview's turn fails (its message alone names its recording tool), while the cards are each held 800 ms.
  const { res, events, spans } = await runPipeline({ MOCK_FAIL_STAGE: "record_report_overview", MOCK_STAGE_DELAY_MS: "800" });
  assert.equal(res.ok, false, "a failed overview delivered as a success");
  const ends = spans.filter((s) => s.card !== "overview" && s.phase === "end").length;
  const starts = spans.filter((s) => s.card !== "overview" && s.phase === "start").length;
  assert.equal(ends, starts, "a card was still running when the failure was raised");
  assert.ok(events.some((e) => e.event === "stage" && /^report-card:/.test(String(e.stage))), "no card ran beside the failing overview");
});
