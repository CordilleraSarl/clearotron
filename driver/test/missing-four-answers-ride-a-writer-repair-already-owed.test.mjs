// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline on both engines, a writer record without its four answers
//
// MISSING FOUR ANSWERS RIDE A WRITER REPAIR ALREADY OWED, AND ONLY ONE (design's decision of 2026-11-26).
//
// A clearance shipped with no four answers: the writer left the block out, and the check that saw it is marked
// structural, so no repair was ever sent. Design ruled: where the writer is repaired for another fault, the same turn
// is told the answers are missing, in the approved words; with no other writer repair the run keeps the check's flag
// for the reviewer and delivers; and a grounded partial block satisfies the check, an unsupported answer being omitted
// honestly. Here the writer's first record has no answers, once beside a narrative fault that owes it a repair and once
// alone. Against the same run with its block present, asking for it in the owed repair starts no writer turn and no
// engine session, and the published page draws exactly the answers the record carries. The engine is the mock; every
// name is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, chmodSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

const { FOUR_ANSWERS_CHECK, FOUR_ANSWERS_REPAIR_LINE, contentModelChecks } = await import("../predelivery-lint.mjs");

const JOB = { id: "test-job", msgId: "<four-answers@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8442", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch" };
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const ENGINE_KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "MOCK_CLAUDE_CALL_LOG", "MOCK_CODEX_CALL_LOG"];
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_NO_FOUR_ANSWERS", "MOCK_NARRATIVE_OVER_CAP"];

async function runPipeline(engine, knobs) {
  const root = tempDir("clearotron-four-answers-");
  const calls = join(root, "calls.jsonl");
  for (const k of [...MOCK_KNOBS, ...ENGINE_KEYS]) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_CLAUDE_CALL_LOG: calls, MOCK_CODEX_CALL_LOG: calls, ...knobs })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  let prompts = [];
  try { prompts = readFileSync(calls, "utf8").trim().split("\n").map((l) => String(JSON.parse(l).prompt ?? "")); } catch { /* no call logged */ }
  // The page the run published: one report folder under the pool, its report.html.
  const pool = join(root, "pool");
  const pages = readdirSync(pool, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(pool, e.name, "report.html"))
    .filter((f) => existsSync(f));
  assert.equal(pages.length, 1, `premise: the run published one report, found ${pages.length}`);
  return { res, events, prompts, page: readFileSync(pages[0], "utf8") };
}
/** Every writer session the run started, by its trigger: the fresh turn and each repair. */
const writerTurns = (events) => events.filter((e) => e.event === "stage" && e.stage === "synthesis").map((e) => e.trigger ?? "fresh");
/** The four-answer rows the page draws, label and text, in the order the page shows them. */
const answerRows = (page) => [...page.matchAll(/<div class="fa-row"><span class="fa-k">([^<]*)<\/span><span class="fa-v">([\s\S]*?)<\/span><\/div>/g)]
  .map((m) => ({ label: m[1], text: m[2].replace(/<[^>]+>/g, "") }));
const writerRepairs = (events) => events.filter((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "lint-repair");
const answersOf = (runDir) => JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8")).four_answers ?? null;

test("a grounded partial block satisfies the check; a block with no grounded answer does not", () => {
  const check = (fourAnswers) => contentModelChecks({ findings: [], fourAnswers, expected: true }).find((c) => c.id === FOUR_ANSWERS_CHECK);
  assert.equal(check({ registrability: { read: "Inherently distinctive for the filed goods.", token: "registrable", basis: "the assessment of the mark" } })?.pass, true,
    "one grounded answer, the other three honestly omitted, failed the check");
  assert.equal(check(null)?.pass, false);
  assert.equal(check({ registrability: { read: "  ", token: "registrable" } })?.pass, false);
  assert.equal(check(null)?.structural, true, "the check started a repair of its own");
});

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a missing block rides the writer's repair for another fault, in the approved words, and the answers it grounds ship`, async () => {
    const { res, events, prompts } = await runPipeline(engine, { MOCK_NO_FOUR_ANSWERS: "1", MOCK_NARRATIVE_OVER_CAP: "1" });
    assert.equal(writerRepairs(events).length, 1, "premise: the narrative fault owed the writer one repair");
    const repair = prompts.find((p) => p.includes(FOUR_ANSWERS_REPAIR_LINE));
    assert.ok(repair, "the writer's repair was not told the four answers are missing");
    assert.match(repair, new RegExp(`^- ${FOUR_ANSWERS_REPAIR_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), "the line is not one of the repair's listed faults");
    assert.ok(events.some((e) => e.event === "four-answers-handed"), "the run does not record that it handed the block");
    assert.equal(answersOf(res.runDir)?.registrability?.token, "registrable", "the answer the repair grounded did not reach the delivered record");
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test(`${engine}: the block asked for in that repair adds no writer turn, and the page shows the one answer it grounded`, async () => {
    // The same run with its block present owes the same one repair for the narrative fault: the comparison that says
    // whether asking for the block cost a turn.
    const owed = await runPipeline(engine, { MOCK_NARRATIVE_OVER_CAP: "1" });
    const asked = await runPipeline(engine, { MOCK_NO_FOUR_ANSWERS: "1", MOCK_NARRATIVE_OVER_CAP: "1" });
    assert.deepEqual(writerTurns(owed.events), ["fresh", "lint-repair"], "premise: the narrative fault owes one writer repair");
    assert.deepEqual(writerTurns(asked.events), writerTurns(owed.events), "asking for the block started a writer turn of its own");
    assert.equal(asked.prompts.length, owed.prompts.length, "asking for the block started an engine session the run did not otherwise start");
    // The page: the answer the repair grounded, with its token and its basis, and no row for the three it left out.
    const rows = answerRows(asked.page);
    assert.deepEqual(rows.map((r) => r.label), ["Registrability"], "the page does not show exactly the one answer the repair grounded");
    assert.match(rows[0].text, /^Registrable — The coined mark is inherently distinctive for the filed goods\./);
    assert.match(rows[0].text, /the assessment of the mark and the register coverage/, "the answer's basis is not on the page");
    // And the run whose block was there all along shows its own answer, so the reading above reads the page's rows.
    assert.deepEqual(answerRows(owed.page).map((r) => r.label), ["Third-party rights"]);
  });

  test(`${engine}: with no other writer repair, the run keeps the check's flag and delivers, and sends no repair for it`, async () => {
    const { res, events, prompts, page } = await runPipeline(engine, { MOCK_NO_FOUR_ANSWERS: "1" });
    assert.equal(writerRepairs(events).length, 0, "a writer repair was started for the missing block alone");
    assert.ok(!prompts.some((p) => p.includes(FOUR_ANSWERS_REPAIR_LINE)));
    const lint = events.filter((e) => e.event === "predelivery-lint-failed").at(-1);
    assert.ok(lint?.failures?.includes(FOUR_ANSWERS_CHECK), "the flag for the reviewer is gone");
    assert.equal(answersOf(res.runDir), null);
    assert.equal(res.ok, true, JSON.stringify(res));
    // No writer turn beyond a clean run's, and a page that invents no answer.
    const clean = await runPipeline(engine, {});
    assert.deepEqual(writerTurns(events), ["fresh"]);
    assert.equal(prompts.length, clean.prompts.length, "the missing block alone started an engine session a clean run does not");
    assert.deepEqual(answerRows(page), [], "the page shows an answer the writer never gave");
    assert.ok(answerRows(clean.page).length > 0, "premise: a clean run's page draws its answer rows");
  });
}
