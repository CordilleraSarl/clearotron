// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end, on both engines
//
// THE RE-SWEEP DOES NOT ASK AGAIN FOR A FAMILY THE READING TURN WITHHELD, through a whole run.
//
// The unit arms (a-repeat-of-a-family-the-reading-turn-withheld-keeps-its-judgment.test.mjs) pin each
// reader on its own. These drive the real pipeline over the mock engine, with an injected plan executor
// standing in for the register, so what is asserted is what a run writes: which questions reach the
// register, the reopen receipt, the plan-execution receipt, the verdict, the client's coverage rows, the
// run's ask ledger and its doubts. The reading turn's record is written by the production record function,
// called from the mock reading turn (MOCK_WITHHOLD_FAMILIES). The re-sweep is driver code below either engine,
// so the main scenario runs once on each.
//
// THE GUARD BESIDE IT. A fold that adds nothing must send nothing. The executor reads an empty question
// list as "every entry on the axis", so a re-sweep whose every question was refused used to re-send the
// whole primary sweep. Refusing the withheld repeat makes that shape common, so one arm pins the guard on the
// case that reached it before: a re-sweep whose only question the plan had already asked. The arm after it pins
// what the guard keeps: a required question that failed before the comparison is asked again, and only it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnvAll } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";        // the injected executor is the only register these runs reach
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP-2201", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const CONTAINS_FAMILY = "primary-sweep:default:novapulse";   // the contains question on the main element, waiting
const CASE_FAMILY = "primary-sweep:exact:novapulse";         // the case form of the main element, waiting
const REASON = "the identical list already shows every mark a buyer would confuse with this one";
const KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FRAME_DIFF", "MOCK_WITHHOLD_FAMILIES", "MOCK_CODEX_CALL_LOG", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY"];

// Each engine's pins, and the other engine's pins UNSET (pinEnv deletes on undefined): the variables are
// process-global, and a Codex billing mode left behind refuses the next Claude run at its preflight.
const ENGINES = {
  "anthropic-agent": () => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
    CLEAROTRON_CODEX_PATH: undefined, CLEAROTRON_AI_BILLING: undefined, CODEX_API_KEY: undefined, MOCK_CODEX_CALL_LOG: undefined }),
  "openai-agent": (root) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key",
    CODEX_API_KEY: "sk-codex-dummy", MOCK_CODEX_CALL_LOG: join(root, "codex-calls.jsonl") }),
};

/**
 * An executor that records every call and answers each question it is GIVEN with one listed record: the
 * record the mock band already carries, so the run's findings end it and the recall join has nothing new
 * to reconcile.
 */
const listedBlock = (qid) => ({ state: "enumerated", qid, query: `${qid} [cl 9,41]`, total_hits: 1, records: [{ record_id: "/mark/us/90000001",
  mark_text: "NOVAPULSE", classes: [9], status: "Registered", owner_name: "Mystery Owner LLC", owner_country: "US", screen_verdict: "surface:in-scope-live" }] });
const writeBlocks = (outputPath, qids, blockFor) => {
  const blocks = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : [];
  for (const qid of qids) {
    const block = blockFor(qid);
    const at = blocks.findIndex((b) => b && b.qid === qid);
    if (at >= 0) blocks[at] = block; else blocks.push(block);
  }
  writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
};

function recordingExecutor(crowded = () => false) {
  const calls = [];
  const planExecutor = async ({ axis, outputPath, qids }) => {
    calls.push({ axis, qids: Array.isArray(qids) ? [...qids] : null });
    // A crowded question comes back counted and not listed, as a register answers a count too large to list.
    writeBlocks(outputPath, qids ?? [], (qid) => (crowded(qid) ? { state: "incomplete", qid, query: `${qid} [cl 9,41]`, total_hits: 12000, records: null } : listedBlock(qid)));
    return { ok: true, states: {} };
  };
  return { planExecutor, calls };
}

/**
 * An executor whose register recovers between the two passes: a question `fails` names comes back as a provider
 * error the run does not read as transient, so the fan-in defers it at once rather than spend its retries, until
 * the blind frame comparison has run (it writes frame-diff.json), and listed after it. A call with no
 * question list is the whole axis, as the real executor reads one; each call records which side of the comparison
 * it came from.
 */
function recoveringExecutor(fails) {
  const calls = [];
  const planExecutor = async ({ planPath, axis, outputPath, qids }) => {
    const afterComparison = existsSync(join(dirname(dirname(outputPath)), "frame-diff.json"));
    const asked = Array.isArray(qids) && qids.length ? [...qids] : null;
    calls.push({ axis, qids: asked, afterComparison });
    const todo = asked ?? JSON.parse(readFileSync(planPath, "utf8")).entries
      .filter((e) => e.axis === axis && e.unsupported !== true && !e.when?.awaits_reading_turn).map((e) => e.qid);
    writeBlocks(outputPath, todo, (qid) => (fails(qid) && !afterComparison
      ? { state: "incomplete", qid, query: `${qid} [cl 9,41]`, total_hits: 0, fetched: 0, sample: [], error: true, reason: "provider error — HTTP 400 Bad Request" }
      : listedBlock(qid)));
    return { ok: true, states: {} };
  };
  return { planExecutor, calls };
}

async function runOn(engine, env, { crowded, executor: injected } = {}) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-withheld-"));
  for (const k of KNOBS) delete process.env[k];
  pinEnvAll(process.env, { ...ENGINES[engine](root), CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env });
  const executor = injected ?? recordingExecutor(crowded);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { planExecutor: executor.planExecutor });
  // An artifact a failed run never wrote reads as null here, so the arm's first assertion — the run's own
  // result — is the one that reports it, rather than a file-not-found from the line that read it.
  const json = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const codexLog = join(root, "codex-calls.jsonl");
  const codexTurns = existsSync(codexLog) ? readFileSync(codexLog, "utf8").trim().split("\n").filter(Boolean).length : 0;
  return { res, events, calls: executor.calls, codexTurns,
    receipt: json(driverDir(res.runDir, "frame-reopen.json")),
    plan: json(driverDir(res.runDir, "register-plan.json")),
    execution: json(driverDir(res.runDir, "plan-execution.json")),
    asks: json(driverDir(res.runDir, "asks.json"))?.asks ?? null,
    doubts: json(driverDir(res.runDir, "doubts.json"))?.doubts ?? null,
    coverage: json(join(res.runDir, "findings.json"))?.coverage ?? null,
    withheldRecord: json(driverDir(res.runDir, "withheld-families-primary-sweep.json"))?.families ?? {},
    audit: existsSync(join(res.runDir, "audit.md")) ? readFileSync(join(res.runDir, "audit.md"), "utf8") : null };
}
const refusalsOf = (events) => events.filter((e) => e.event === "frame-reopen-fold-refused").flatMap((e) => e.rows ?? []);
const frameAsks = (asks) => asks.filter((a) => a.born?.place === "frame-diff");
const sentQids = (calls) => calls.flatMap((c) => c.qids ?? []);

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a main-element request whose contains question repeats a withheld family sends only the question that was not withheld, and the run reads it as settled`, async () => {
    const r = await runOn(engine, { MOCK_FRAME_DIFF: "dominant-on-waiting-family", MOCK_WITHHOLD_FAMILIES: JSON.stringify({ [CONTAINS_FAMILY]: REASON }) });
    assert.equal(r.res.ok, true, JSON.stringify(r.res));
    if (engine === "openai-agent") assert.ok(r.codexTurns > 0, "the stages ran on the Codex engine");
    assert.equal(r.withheldRecord[CONTAINS_FAMILY]?.reason, REASON, "guard: the reading turn's record holds the judgment before the comparison runs");

    // THE REFUSAL, and what reached the register.
    const refused = refusalsOf(r.events).filter((x) => x.kind === "withheld-by-judgment");
    assert.equal(refused.length, 1, `the fold's refusals: ${JSON.stringify(refusalsOf(r.events))}`);
    assert.equal(refused[0].twin, CONTAINS_FAMILY);
    assert.ok(r.calls.length >= 1 && r.calls.every((c) => Array.isArray(c.qids) && c.qids.length), `every dispatch names its questions: ${JSON.stringify(r.calls)}`);
    assert.ok(!sentQids(r.calls).includes(refused[0].qid), "the withheld family's question was sent to the register");
    const exact = r.plan.entries.find((e) => e.origin === "supplemental" && e.predicate === "exact" && e.term === "NOVAPULSE");
    assert.ok(exact && sentQids(r.calls).includes(exact.qid), "the question the reading turn did not withhold is still asked");
    assert.ok(!r.plan.entries.some((e) => e.origin === "supplemental" && e.predicate === "default" && e.term === "NOVAPULSE"), "nothing was folded for the withheld question");

    // THE DIRECTIVE, THE GAP AND THE VERDICT.
    assert.deepEqual(r.receipt.swept, ["variant:novapulse"], `deferrals: ${JSON.stringify(r.receipt.deferrals)}`);
    assert.deepEqual(r.receipt.deferrals, []);
    assert.equal(r.receipt.domClosed, true, "the main-element gap closes");
    assert.deepEqual(r.receipt.withheld_by_judgment, [{ directive: "variant:novapulse", slices: [{ qid: refused[0].qid, family: CONTAINS_FAMILY }] }]);
    const t = r.receipt.remedy_terms.find((x) => x.term === "NOVAPULSE");
    assert.equal(t?.class, "found", `the term: ${JSON.stringify(t)}`);
    assert.equal(t.slices.find((s) => s.qid === refused[0].qid)?.refused_at_fold, "withheld-by-judgment");
    assert.equal(r.res.verdict, "CLEAR", "nothing holds the CLEAR");

    // THE REPORT'S ACCOUNTING: no follow-up row, no open ask, no doubt, and the family on its own record.
    assert.deepEqual(r.coverage.filter((c) => /^Follow-up \//.test(String(c.area ?? ""))), [], "no follow-up row reaches the client");
    // The request keeps each slice's disposition: the question that ran, and the one withheld on the turn's reason.
    const asks = frameAsks(r.asks);
    assert.deepEqual(asks.map((a) => a.ending?.kind ?? "open"), ["executed", "judged-immaterial"], `the frame asks: ${JSON.stringify(asks)}`);
    assert.ok(!asks[0].ending.evidence.includes(refused[0].qid), "the withheld question is not called executed");
    assert.deepEqual(asks[1].qids, [refused[0].qid]);
    assert.deepEqual(asks[1].ending.reasons, [REASON], "the withheld question ends on the reading turn's own reason");
    // The delivered audit shows both, each in the ledger's existing line.
    const lines = (r.audit ?? "").split("\n## Ask Ledger\n")[1]?.split("\n").filter((l) => l.startsWith("- [frame-diff]")) ?? [];
    assert.equal(lines.length, 2, `the audit's frame asks: ${JSON.stringify(lines)}`);
    assert.match(lines[0], / — executed — qid\(s\) executed per plan-execution receipt: /);
    assert.ok(!lines[0].includes(refused[0].qid), "the audit does not call the withheld question executed");
    assert.ok(lines[1].endsWith(` — judged immaterial — ${REASON}`), lines[1]);
    assert.deepEqual(r.doubts.filter((d) => String(d.id).startsWith("doubt:remedy-accounting:")), []);
    assert.ok(r.execution.awaiting.some((x) => x.qid === CONTAINS_FAMILY), "the family reads as a question nobody asked");
    assert.ok(!r.execution.asked.some((x) => x.qid === CONTAINS_FAMILY));
  });
}

test("THE CONTROL: with no judgment on record the same request still asks the contains question, as before", async () => {
  const r = await runOn("anthropic-agent", { MOCK_FRAME_DIFF: "dominant-on-waiting-family" });
  assert.equal(r.res.ok, true, JSON.stringify(r.res));
  assert.deepEqual(r.withheldRecord, {}, "guard: nothing was withheld");
  assert.ok(!refusalsOf(r.events).some((x) => x.kind === "withheld-by-judgment"));
  const contains = r.plan.entries.find((e) => e.origin === "supplemental" && e.predicate === "default" && e.term === "NOVAPULSE");
  assert.ok(contains && sentQids(r.calls).includes(contains.qid), "an unjudged family's question is asked");
  assert.ok(r.execution.asked.some((x) => x.qid === CONTAINS_FAMILY && x.asked_by === contains.qid), "and answers the family");
  assert.equal(r.receipt.withheld_by_judgment, undefined);
});

test("a request whose every question was withheld sends nothing at all, and its ask ends on the reading turn's reason", async () => {
  const r = await runOn("anthropic-agent", { MOCK_FRAME_DIFF: "waiting-family-only", MOCK_WITHHOLD_FAMILIES: JSON.stringify({ [CASE_FAMILY]: REASON }) });
  assert.equal(r.res.ok, true, JSON.stringify(r.res));
  assert.equal(r.withheldRecord[CASE_FAMILY]?.reason, REASON, "guard: the judgment is on record");
  const refused = refusalsOf(r.events);
  assert.deepEqual(refused.map((x) => [x.kind, x.twin]), [["withheld-by-judgment", CASE_FAMILY]]);
  assert.deepEqual(r.calls, [], "no question reached the register — and never the whole axis");
  const key = r.receipt.requested[0];
  assert.deepEqual(r.receipt.swept, [key], `deferrals: ${JSON.stringify(r.receipt.deferrals)}`);
  assert.deepEqual(r.receipt.deferrals, []);
  assert.equal(r.receipt.remedy_terms.find((x) => x.term === "novapulse")?.class, "withheld-by-judgment");
  const ask = frameAsks(r.asks)[0];
  assert.equal(ask?.ending?.kind, "judged-immaterial", `the frame ask: ${JSON.stringify(ask)}`);
  assert.deepEqual(ask.ending.reasons, [REASON]);
  assert.deepEqual(r.coverage.filter((c) => /^Follow-up \//.test(String(c.area ?? ""))), [], "no follow-up row reaches the client");
  assert.deepEqual(r.doubts.filter((d) => String(d.id).startsWith("doubt:remedy-accounting:")), []);
  assert.equal(r.res.verdict, "CLEAR");
});

test("a re-sweep whose only question the plan already asked sends nothing to the register — never the whole axis", async () => {
  const r = await runOn("anthropic-agent", { MOCK_FRAME_DIFF: "duplicate-only" });
  assert.equal(r.res.ok, true, JSON.stringify(r.res));
  const refused = refusalsOf(r.events);
  assert.deepEqual(refused.map((x) => [x.kind, x.twin]), [["duplicate-question", "primary-sweep:exact:project-novapulse"]]);
  assert.deepEqual(r.calls, [], `the register was asked again: ${JSON.stringify(r.calls)}`);
  const key = r.receipt.requested[0];
  assert.deepEqual(r.receipt.swept, [key], `deferrals: ${JSON.stringify(r.receipt.deferrals)}`);
  assert.deepEqual(r.receipt.answered_elsewhere, [{ directive: key, slices: [{ qid: refused[0].qid, twin: "primary-sweep:exact:project-novapulse" }] }]);
});

test("a re-sweep that adds nothing still retries the required questions that failed before it, and only those, so the request they answer closes", async () => {
  const FAILED = "primary-sweep:exact:project-novapulse";   // the identical question and its merchandise-class row
  const failed = (qid) => qid.includes(FAILED);
  const r = await runOn("anthropic-agent", { MOCK_FRAME_DIFF: "duplicate-only", MOCK_PLAN_DROP_QID: FAILED, MOCK_PLAN_DROP_STICKY: "1" },
    { executor: recoveringExecutor(failed) });
  assert.equal(r.res.ok, true, JSON.stringify(r.res));
  const owed = r.plan.entries.filter((e) => e.axis === "primary-sweep" && failed(e.qid)).map((e) => e.qid).sort();
  assert.equal(owed.length, 2, `guard: the identical question and its merchandise row: ${JSON.stringify(owed)}`);
  assert.ok(r.calls.some((c) => !c.afterComparison && c.qids?.some(failed)), `guard: both failed before the comparison: ${JSON.stringify(r.calls)}`);
  const resweep = r.calls.filter((c) => c.afterComparison);
  assert.equal(resweep.length, 1, `the re-sweep's dispatches: ${JSON.stringify(resweep)}`);
  assert.ok(Array.isArray(resweep[0].qids), "never the whole axis");
  assert.deepEqual([...resweep[0].qids].sort(), owed, "only the required questions that had not landed, and both of them");
  assert.deepEqual(r.receipt.deferrals, [], "the request they answer closes");
  const causes = r.events.filter((e) => Array.isArray(e.causes)).flatMap((e) => e.causes);
  assert.ok(!causes.includes("frameDeferred"), `no hold rests on the request: ${JSON.stringify(causes)}`);
});

test("THE PRODUCTION HOLD, at its default: the crowd a withheld family's repeat would have found no longer holds the verdict; with no judgment on record the same crowd still holds it", async () => {
  const before = process.env.CLEAROTRON_REGISTER_GAP_CLAMP;
  delete process.env.CLEAROTRON_REGISTER_GAP_CLAMP;   // the unfinished-register hold, on as in production
  try {
    const crowded = (qid) => qid.startsWith("supp:primary-sweep:default:novapulse");
    const holds = (events) => events.some((e) => Array.isArray(e.causes) && e.causes.includes("registerGap"));
    const control = await runOn("anthropic-agent", { MOCK_FRAME_DIFF: "dominant-on-waiting-family" }, { crowded });
    assert.equal(control.res.ok, true, JSON.stringify(control.res));
    assert.equal(control.res.verdict, "CONDITIONAL", "guard: the hold is live, and the asked family's crowd holds the verdict");
    assert.ok(holds(control.events), "guard: the hold's own event names the unfinished register slice");
    const r = await runOn("anthropic-agent", { MOCK_FRAME_DIFF: "dominant-on-waiting-family", MOCK_WITHHOLD_FAMILIES: JSON.stringify({ [CONTAINS_FAMILY]: REASON }) }, { crowded });
    assert.equal(r.res.ok, true, JSON.stringify(r.res));
    assert.ok(!sentQids(r.calls).some(crowded), "the withheld family's question was not asked");
    assert.equal(r.res.verdict, "CLEAR", "nothing unfinished is left to hold it: the family stands on the reading turn's judgment");
    assert.ok(!holds(r.events), "no unfinished-register hold");
  } finally {
    if (before === undefined) delete process.env.CLEAROTRON_REGISTER_GAP_CLAMP; else process.env.CLEAROTRON_REGISTER_GAP_CLAMP = before;
  }
});
