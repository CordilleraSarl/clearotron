// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline through a review asked again, on both engines
//
// A CLEAR FROM A REVIEW ASKED AGAIN KEEPS THE CONDITIONS STILL STANDING.
//
// A guard that meets a BLOCKING moves nothing, since BLOCKING is already the most cautious result, and records its
// condition. If the review is then asked again and answers CLEAR, that condition still stands, so the run delivers
// CONDITIONAL on it. The floor the opinion's own steps meet does not read the guards' entries, so nothing else holds it.
//
// THE STATE IS PLANTED. The record tool refuses a BLOCKING that cites nothing, and a recheck's refused save is put back,
// so no mock setting leaves a BLOCKING carried over a review that says something else. The senior-right fetch runs after
// the recheck and before the guards, so the fetcher, once, leaves the review on disk saying CLEAR, leaves one floor
// unanswered, and turns the seat into one that answers CLEAR. Every mark and owner is invented.
import { test, after } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { clauseForDefect, verdictWithConditionsStanding } from "../terminal-clamp.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

test("a CLEAR with a condition standing is CONDITIONAL; every other result and an empty list stand", () => {
  assert.equal(verdictWithConditionsStanding({ verdict: "CLEAR", reasons: ["floor_duty_undischarged:1"] }), "CONDITIONAL");
  assert.equal(verdictWithConditionsStanding({ verdict: "CLEAR", reasons: [] }), "CLEAR");
  assert.equal(verdictWithConditionsStanding({ verdict: "CONDITIONAL", reasons: ["a"] }), "CONDITIONAL");
  assert.equal(verdictWithConditionsStanding({ verdict: "BLOCKING", reasons: ["a"] }), "BLOCKING", "a clamp never lowers");
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8440", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const AS_STARTED = Object.fromEntries(["CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"].map((k) => [k, process.env[k]]));
const ENGINES = {
  claude: { ...AS_STARTED, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const OPEN = { record_id: "/mark/us/90000099", mark: "NOVAPULSE", disposition: "unanswered" };
const OPEN_ITEMS = "the open items set out in the report, before relying on a clean result";

function runDirOf(recordLog) {
  let d = dirname(String(recordLog));
  while (!existsSync(join(d, "senior-eye-review.md"))) { const up = dirname(d); assert.notEqual(up, d, "the review file was not found above the record log"); d = up; }
  return d;
}

function plant(runDir, { guard }) {
  writeFileSync(join(runDir, "senior-eye-review.md"), "CLEAR\n\nThe file on disk no longer says what the run carries.\n");
  if (guard) {
    const p = driverDir(runDir, "floor-duty.json");
    const a = JSON.parse(readFileSync(p, "utf8"));
    const t = a.totals ?? {};
    writeFileSync(p, JSON.stringify({ ...a, undischarged_by_seat: 1, rows: [...(a.rows ?? []), OPEN],
      totals: { ...t, floors: (t.floors ?? 0) + 1, unanswered: (t.unanswered ?? 0) + 1 } }, null, 2) + "\n");
  }
  pinEnvAll(process.env, { MOCK_VERDICT: "CLEAR" });
  delete process.env.MOCK_VERDICT_DEFECTS;
}

async function runPipeline(engine, { guard }) {
  const root = tempDir("clearotron-reask-standing-");
  for (const k of ["MOCK_VERDICT", "MOCK_VERDICT_DEFECTS", "MOCK_SKEPTIC", "MOCK_MULTI_LEG"]) delete process.env[k];
  pinEnvAll(process.env, { ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_SKEPTIC: "no flags surfaced", MOCK_MULTI_LEG: "1",
    MOCK_VERDICT: "BLOCKING", MOCK_VERDICT_DEFECTS: "- the narrative overclaims the date on the fetched record" });
  let planted = false;
  const recordFetcher = async (_uri, { recordLog }) => {
    if (!planted) { planted = true; plant(runDirOf(recordLog), { guard }); }
    return { ok: false, cause: "mock no-op" };
  };
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { recordFetcher });
  assert.ok(planted, "guard: the senior-right fetch never ran, so nothing was planted");
  const json = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const status = json(join(res.runDir, "status.json"));
  const pool = join(root, "pool", status.runId);
  return {
    res, events, status,
    duty: json(driverDir(res.runDir, "floor-duty.json")),
    label: json(driverDir(res.runDir, "verdict.json")),
    settle: json(join(pool, "settle.json")),
    rating: json(join(pool, "report-data.json"))?.rating ?? null,
    email: existsSync(join(res.runDir, "email-body.md")) ? readFileSync(join(res.runDir, "email-body.md"), "utf8") : "",
    pages: existsSync(pool) ? readdirSync(pool).filter((f) => f.endsWith(".html")).map((f) => readFileSync(join(pool, f), "utf8")) : [],
  };
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a review asked again that says CLEAR delivers CONDITIONAL on the guard's condition, on every surface`, async () => {
    const run = await runPipeline(engine, { guard: true });
    assert.ok(run.events.some((e) => e.event === "floor-duty-undischarged"), "guard: the floor's guard never fired");
    assert.ok(run.events.some((e) => e.event === "reviewer-degenerate"), "guard: the review was never asked again");
    const reask = readdirSync(driverDir(run.res.runDir)).filter((f) => f.startsWith("narrative-refutation.attempt") && f.includes(".dispatch.txt"))
      .map((f) => readFileSync(driverDir(run.res.runDir, f), "utf8")).find((m) => m.includes("A BLOCKING with no cited defects is invalid output"));
    assert.ok(reask?.includes("Record the review again with `record_narrative_refutation`: the verdict (CLEAR / CONDITIONAL / BLOCKING) and any flags that still stand."), "the seat was not told to record through its tool");
    assert.ok(!reask.includes("Write your review"), "the seat was told to write a file it has no tool for");
    assert.equal(run.events.find((e) => e.event === "verdict-3" && e.trigger === "degenerate-reask")?.verdict, "CLEAR", "guard: the review asked again did not say CLEAR");
    const clause = clauseForDefect("floor_duty_undischarged", 1, run.duty.totals.floors);
    assert.equal(run.res.ok, true, JSON.stringify({ fail: run.res.fail, stage: run.res.failedStage }));
    assert.equal(run.res.verdict, "CONDITIONAL");
    assert.equal(run.label.verdict, "CONDITIONAL");
    assert.ok(run.label.clauses.includes(clause), `the verdict on record lost the condition: ${JSON.stringify(run.label.clauses)}`);
    assert.equal(run.status.review.signoff, "CONDITIONAL");
    assert.equal(run.settle.signoff, "CONDITIONAL");
    assert.ok(run.rating.conditions.includes(clause), `the report's rating lost the condition: ${JSON.stringify(run.rating.conditions)}`);
    assert.ok(run.pages.some((p) => p.includes(clause)), "the report the client opens does not name the condition");
    assert.ok(run.email.includes(OPEN_ITEMS), `the email does not point at the open items: ${run.email.slice(0, 400)}`);
    assert.deepEqual(run.events.filter((e) => e.event === "terminal-guard-clamp" && /^reasked_clear_over_standing_condition/.test(e.defect)).map((e) => [e.from, e.to]), [["CLEAR", "CONDITIONAL"]]);
  });

  test(`${engine}: with no condition standing, the CLEAR the review gave stands`, async () => {
    const run = await runPipeline(engine, { guard: false });
    assert.ok(run.events.some((e) => e.event === "reviewer-degenerate"), "guard: the review was never asked again");
    assert.equal(run.res.ok, true, JSON.stringify({ fail: run.res.fail, stage: run.res.failedStage }));
    assert.equal(run.label.verdict, "CLEAR");
    assert.ok(!run.email.includes(OPEN_ITEMS), "a clean result's email points at open items");
    assert.deepEqual(run.events.filter((e) => e.event === "terminal-guard-clamp"), []);
  });
}
