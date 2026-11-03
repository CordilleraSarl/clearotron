// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CONDITIONS A CLIENT READS FOLLOW A REPAIR THAT REWRITES OR DROPS A FORWARD LEGAL STEP.
//
// Every surface reads its "conditional on" list from the one label, and the label was written before the delivery
// check: the floor that fills its list only ever added a step. A writer's repair in the delivery check that restated a
// step's open-state clause, or withdrew a step, left the page and the email listing the step as first written. These
// drive the rebuild as a pure function, then the change end to end on the mock pipeline, on both engines.
import { test, after } from "node:test";
import { pinEnvAll, pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { clientConditions } from "../terminal-clamp.mjs";
import { conditionsFollowingTheRecord } from "../pipeline.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

// ── the rebuild ─────────────────────────────────────────────────────────────────────────────────────────────────
const LIST = {
  reasons: ["guard: a gap a guard named", "Step one.", "Step two.", "a coverage gap the floor named"],
  clauses: ["A gap a guard named.", "Step one is open.", "Step two is open.", "A coverage gap the floor named."],
};
const FROM = new Set(["Step one.", "Step two."]);

test("a step whose open-state clause is restated keeps its place, and only its clause moves", () => {
  const f = conditionsFollowingTheRecord({ ...LIST, fromRecord: FROM,
    now: [{ reason: "Step one.", clause: "Step one is open, as restated." }, { reason: "Step two.", clause: "Step two is open." }] });
  assert.deepEqual(f.reasons, LIST.reasons);
  assert.deepEqual(f.clauses, ["A gap a guard named.", "Step one is open, as restated.", "Step two is open.", "A coverage gap the floor named."]);
  assert.deepEqual([f.withdrawn, f.added, f.restated], [[], [], ["Step one."]]);
  assert.deepEqual([...f.held], ["Step one.", "Step two."]);
});

test("a step rewritten whole takes the place of the one it replaces", () => {
  const f = conditionsFollowingTheRecord({ ...LIST, fromRecord: FROM,
    now: [{ reason: "Step one, rewritten.", clause: "Step one is open." }, { reason: "Step two.", clause: "Step two is open." }] });
  assert.deepEqual(f.reasons, ["guard: a gap a guard named", "Step one, rewritten.", "Step two.", "a coverage gap the floor named"]);
  assert.deepEqual([f.withdrawn, f.added], [["Step one."], ["Step one, rewritten."]]);
});

test("a dropped step leaves the list, and every other entry keeps its place", () => {
  const f = conditionsFollowingTheRecord({ ...LIST, fromRecord: FROM, now: [{ reason: "Step two.", clause: "Step two is open." }] });
  assert.deepEqual(f.reasons, ["guard: a gap a guard named", "Step two.", "a coverage gap the floor named"]);
  assert.deepEqual(f.clauses, ["A gap a guard named.", "Step two is open.", "A coverage gap the floor named."]);
  assert.deepEqual(f.withdrawn, ["Step one."]);
  const none = conditionsFollowingTheRecord({ ...LIST, fromRecord: FROM, now: [] });
  assert.deepEqual(none.reasons, ["guard: a gap a guard named", "a coverage gap the floor named"], "every step dropped: the record's entries go, no other");
  assert.equal(none.held.size, 0);
});

test("a step where the list held none is added at its end; a step another entry carries is left to that entry", () => {
  const f = conditionsFollowingTheRecord({ reasons: ["guard: a gap a guard named"], clauses: ["A gap a guard named."], fromRecord: new Set(),
    now: [{ reason: "Step one.", clause: "Step one is open." }, { reason: "guard: a gap a guard named", clause: "a clause it would have replaced" }] });
  assert.deepEqual(f.reasons, ["guard: a gap a guard named", "Step one."]);
  assert.deepEqual(f.clauses, ["A gap a guard named.", "Step one is open."]);
  assert.deepEqual([...f.held], ["Step one."]);
  const same = conditionsFollowingTheRecord({ ...LIST, fromRecord: FROM,
    now: [{ reason: "Step one.", clause: "Step one is open." }, { reason: "Step two.", clause: "Step two is open." }] });
  assert.deepEqual([same.reasons, same.clauses], [LIST.reasons, LIST.clauses], "a record that did not move leaves the list as it was");
});

// ── end to end, on the mock pipeline ────────────────────────────────────────────────────────────────────────────
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
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_ACTIONS", "MOCK_NARRATIVE_OVER_CAP", "MOCK_LINT_REPAIR_ACTIONS"];
const AS_STARTED = Object.fromEntries(["CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"].map((k) => [k, process.env[k]]));
const ENGINES = {
  claude: { ...AS_STARTED, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};

async function runPipeline(env, engine) {
  const root = tempDir("clearotron-conditions-follow-");
  for (const k of KNOBS) delete process.env[k];
  pinEnvAll(process.env, { ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_SKEPTIC: "no flags surfaced", ...env });
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const { runId } = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  const pool = join(root, "pool", runId);
  return {
    res, events,
    label: JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8")),
    rating: JSON.parse(readFileSync(join(pool, "report-data.json"), "utf8")).rating,
    email: readFileSync(join(res.runDir, "email-body.md"), "utf8"),
    pages: readdirSync(pool).filter((f) => f.endsWith(".html")).map((f) => readFileSync(join(pool, f), "utf8")),
  };
}

// The two steps MOCK_ACTIONS=two-conditions writes, and the clause a repair restates.
const STEP_ONE_CLAUSE = "Consent from Mystery Owner LLC is not yet in hand";
const STEP_ONE_RESTATED = "Consent from Mystery Owner LLC to the filing in the US is not yet in hand";
const STEP_ONE_TEXT = "Obtain consent from Mystery Owner LLC before filing in the US";
const STEP_TWO_TEXT = "Obtain a letter of consent from Mystery Owner LLC before filing in the EU";
const REPAIR = { MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_ACTIONS: "two-conditions" };
const stageEvents = (events, stage, trigger) => events.filter((e) => e.event === "stage" && e.stage === stage && e.trigger === trigger);

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a repair that restates a step's clause moves the delivered conditions with it`, async () => {
    const { res, events, label, rating, email, pages } = await runPipeline({ ...REPAIR, MOCK_LINT_REPAIR_ACTIONS: "rewrite" }, engine);
    // CONTROL: the writer repaired its record in the delivery check, and the list first stated the clause as written.
    assert.equal(stageEvents(events, "synthesis", "lint-repair").length, 1, "the writer repaired its record");
    const followed = events.filter((e) => e.event === "verdict-conditions-followed");
    assert.ok(followed.length >= 1, "the conditions followed the record");
    assert.deepEqual([followed[0].withdrawn, followed[0].added, followed[0].restated], [0, 0, 1]);
    assert.deepEqual([followed[0].from, followed[0].to], ["CONDITIONAL", "CONDITIONAL"], "the result is not moved");
    assert.equal(label.verdict, "CONDITIONAL");
    assert.deepEqual(clientConditions(label).map((c) => c.replace(/\.$/, "")), [STEP_ONE_RESTATED, STEP_TWO_TEXT]);
    for (const [where, text] of [["the page's data", JSON.stringify(rating)], ["the page", pages.join("\n")]]) {
      assert.ok(text.includes(STEP_ONE_RESTATED), `${where} states the restated clause`);
      assert.ok(!text.includes(STEP_ONE_CLAUSE), `${where} no longer states the clause as first written`);
    }
    assert.ok(rating.statement.includes(STEP_ONE_RESTATED), "the statement's lede is the restated clause");
    // The email lists each step in its own words, from the report's actions, under the result the label states.
    assert.ok(email.includes("Only you can close these") && email.includes(STEP_ONE_TEXT) && email.includes(STEP_TWO_TEXT), "the email lists both steps");
    assert.ok(!email.includes(STEP_ONE_CLAUSE), "and no clause as first written");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });

  test(`${engine}: a repair that drops a step takes it off the delivered conditions, and the result stands`, async () => {
    const { res, events, label, rating, email, pages } = await runPipeline({ ...REPAIR, MOCK_LINT_REPAIR_ACTIONS: "drop" }, engine);
    assert.equal(stageEvents(events, "synthesis", "lint-repair").length, 1, "the writer repaired its record");
    const followed = events.filter((e) => e.event === "verdict-conditions-followed");
    assert.ok(followed.length >= 1, "the conditions followed the record");
    assert.deepEqual([followed[0].withdrawn, followed[0].added], [1, 0]);
    assert.equal(label.verdict, "CONDITIONAL", "the step that remains still conditions the result");
    assert.deepEqual(clientConditions(label).map((c) => c.replace(/\.$/, "")), [STEP_TWO_TEXT]);
    assert.equal(label.kinds?.legalActions, true);
    for (const [where, text] of [["the page's data", JSON.stringify(rating)], ["the page", pages.join("\n")], ["the email", email]]) {
      assert.ok(text.includes(STEP_TWO_TEXT), `${where} states the step that remains`);
      assert.ok(!text.includes(STEP_ONE_CLAUSE) && !text.includes(STEP_ONE_TEXT), `${where} no longer states the dropped step`);
    }
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });
}
