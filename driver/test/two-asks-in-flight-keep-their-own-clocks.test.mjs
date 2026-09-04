// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — TWO ASKS IN FLIGHT, ONE SLOT TO HOLD THEM.
//
// The gauge kept a single `toolAskedAt`. A second assistant message arriving before the first ask's
// result OVERWROTE it, so the first ask's start time was gone and its wait was never counted at all.
// `tool_use_id` has been on both the ask and its result on the wire the whole time; nothing read it.
//
// MEASURED on the overlap fixture — two asks, 150ms each, every ask emitted before any result:
//
//   single-slot   toolWaitMs=149  toolCalls=2  {"perplexity_ask":149}
//   keyed         toolWaitMs=451  toolCalls=2  {"register_execute_plan":151,"perplexity_ask":300}
//
// The first tool is not merely mis-attributed, it is ABSENT, and the turn under-reports its own waiting
// by two thirds. Nothing in the suite could see it: every existing tool-wait fixture strictly alternates
// ask and result, so two asks were never in flight at once. That is why this stayed latent.
//
// NOT THE CAUSE OF THE 380/0 SPECIMEN this issue was opened on. That one is the parse-time stall, and
// the fixture there alternates, so no second ask is ever outstanding. Two defects, one file, and fixing
// this one leaves that one exactly where it was.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
// — both names answer to two spellings; pinEnv writes every one.
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
pinEnv(process.env, "CLEAROTRON_AI", "anthropic-agent");
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "twoask-locks-"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
const { runStage } = await import("../gateway.mjs");

let dir;
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "twoask-"));
  mkdirSync(driverDir(dir), { recursive: true });
  process.env.MOCK_CLAUDE_CALL_LOG = join(dir, "calls.jsonl");
  process.env.MOCK_OUT_FILE = join(dir, "out.md");
  process.env.MOCK_COUNT_FILE = join(dir, "count");
  process.env.MOCK_CLAUDE_FILE = "a stub the validator accepts\n";
  delete process.env.MOCK_CLAUDE_TOOL_WAIT;
  delete process.env.MOCK_CLAUDE_TOOL_OVERLAP;
  delete process.env.MOCK_CLAUDE_TOOL_OVERLAP_ONE_CHUNK;
});

const run = async (key) => {
  await runStage("twoask-stage", {
    agent: "clawdi", message: `TASK\nOUTPUT_FILE: ${process.env.MOCK_OUT_FILE}`, sessionKey: key,
    timeoutSec: 30, expectFile: process.env.MOCK_OUT_FILE, maxRetries: 0, runDir: dir,
  }).catch(() => {});
  return JSON.parse(readFileSync(driverDir(dir, "twoask-stage.jsonl"), "utf8").trim().split("\n")[0]);
};

test("tracker issue 1828 an ask still in flight when the next one starts is not forgotten", async () => {
  process.env.MOCK_CLAUDE_TOOL_OVERLAP = JSON.stringify([
    { name: "register_execute_plan", ms: 150 },
    { name: "perplexity_ask", ms: 150, preMs: 120 },   // the first ask waits ALONE for 120ms first
  ]);
  const row = await run("twoask-overlap");
  const spec = ` [toolWaitMs=${row.toolWaitMs} toolCalls=${row.toolCalls}`
    + ` byTool=${JSON.stringify(row.toolWaitByTool)}]`;
  assert.equal(row.toolCalls, 2, "two tool_use blocks were emitted" + spec);
  // THE DISCRIMINATOR, AND IT IS THE TOTAL. On the single-slot clock the first ask's start time was
  // overwritten before its result arrived, so its wait was never added to anything and the whole turn
  // reported 149ms of waiting. Both asks were outstanding across ~300ms of real time.
  assert.ok(row.toolWaitMs >= 250,
    "the turn reports less waiting than it did. Two asks were outstanding across ~300ms; a single-slot "
    + "ask clock reports ~150 because the first ask's wait is dropped when the second overwrites it."
    + spec);
  // AND THE OVERLAP IS VISIBLE. While both were outstanding the milliseconds belong to BOTH, which this
  // file records the way the one-message-two-tools case already does: a sorted set joined by "+".
  const composite = Object.keys(row.toolWaitByTool).find((k) => k.includes("+"));
  assert.ok(composite,
    "no key names both tools, so the period when both were outstanding was credited to one of them "
    + "alone — which is the double-count the sum identity exists to prevent" + spec);
  assert.deepEqual(composite.split("+").sort(), ["perplexity_ask", "register_execute_plan"],
    "the overlap key must name exactly the tools that were outstanding together" + spec);
  // AND THE PERIOD BEFORE THE OVERLAP IS ITS OWN. For 120ms only the first ask was waiting, and those
  // milliseconds belong to it alone. A model that only closes a period when a RESULT lands drops this
  // stretch entirely — in production the gap between two asks is however long the model took to ask
  // again, which is not small.
  // AND THE PERIOD BEFORE THE OVERLAP IS MEASURED OR DECLARED — NEVER SILENTLY ZERO.
  //
  // This arm asserted `>= 90` outright and took main red on 2026-08-25 while passing 12 of 12 locally.
  // It was not flaky: the 120ms gap is real on the WIRE, and whether the reader SEES it depends on when
  // the reader is scheduled. On a busy box both asks land in one stdout chunk, the parser reads them
  // microseconds apart, and no measurement of that period is possible — the recorded shape was
  // {"a+b":150,"b":149}, total 299 where 420 was owed.
  //
  // Asserting the measurement outright makes this arm a load meter. Dropping it lets the period vanish
  // silently, which is the defect it exists to catch. So it asserts the DISJUNCTION, which is the real
  // contract and is stronger than what it asserted before: the solo period is measured, or the run says
  // it could not be measured. What is forbidden is neither — a real wait credited as no wait.
  // ✕ THE MAGNITUDE FLOOR WAS ITSELF THE LOAD METER, AND IT REDDED A THIRD TIME. The paragraph above
  // replaced an outright `>= 90` with a disjunction and kept `>= 90` as the measured branch. That still
  // asserts HOW MUCH of the solo period the reader caught, which is a property of scheduling, not of the
  // engine. Measured on a saturated queue (three runners, five queued):
  //
  //   byTool {"register_execute_plan":83,"perplexity_ask+register_execute_plan":150,"perplexity_ask":150}
  //   toolWaitMs 383,  unmeasurable []
  //
  // 83ms is a MEASUREMENT. The solo period was seen, was credited to the right key, and 83+150+150 is
  // exactly the 383 total — the accounting is complete and correct. The arm failed anyway, and its own
  // message said "a real wait was credited as no wait", which was false about the very numbers it printed.
  //
  // The contract this file exists for is that the solo period is measured, or declared unmeasurable, and
  // never SILENTLY ZERO. So that is what is asserted: presence, not size. The magnitude claim has not been
  // dropped — it moves to where load cannot move it, the `toolWaitMs >= 250` arm above and the identity
  // below. The original defect still reds both: a single-slot clock drops the first ask's wait entirely,
  // so the solo key is absent (0 here) AND the total falls to ~150.
  const soloMeasured = (row.toolWaitByTool.register_execute_plan ?? 0) > 0;
  const soloDeclared = (row.toolWaitUnmeasurable ?? [])
    .some((u) => u?.cause === "ask-superseded-in-chunk");
  assert.ok(soloMeasured || soloDeclared,
    "the period during which only the first ask was outstanding is neither in its own key nor declared "
    + "unmeasurable — a real wait was credited as no wait, which is the whole of issue 1828"
    + ` [unmeasurable=${JSON.stringify(row.toolWaitUnmeasurable)}]` + spec);

  // AND THE ACCOUNTING IS COMPLETE, ASSERTED HERE RATHER THAN ONLY IN THE SIBLING TEST. This is the half
  // that actually carries magnitude: every millisecond of the turn's wait belongs to some key, so a period
  // that shrinks in one key cannot quietly vanish from the total. It is load-INDEPENDENT — it constrains
  // the parts against each other, never against the wall clock.
  const parts = Object.values(row.toolWaitByTool ?? {}).reduce((a, b) => a + b, 0);
  assert.equal(parts, row.toolWaitMs,
    "the per-tool keys do not sum to the turn's total wait. A period credited to no key is the #1828 "
    + "defect; a period credited to two keys is the double-count the composite key exists to prevent"
    + spec);
});

/**
 * Did this turn record the one-chunk collapse?
 *
 * TRUE WHEN THE RUN SAYS SO, never inferred from a key being missing. Two asks arriving in one chunk
 * means the first ask's solo period could not be observed, and the engine records exactly that as an
 * `ask-superseded-in-chunk` entry in `toolWaitUnmeasurable`.
 *
 * The predicate is up here, rather than inline in the arm below, so that it can be DRIVEN — an arm that
 * only ever sees whatever the box produced that minute proves nothing about the cases it did not.
 */
export function collapsedInOneChunk(row) {
  return (row?.toolWaitUnmeasurable ?? []).some((u) => u?.cause === "ask-superseded-in-chunk");
}

// ── THE SAME COLLAPSE, DRIVEN RATHER THAN WAITED FOR ────────────────────────────────────────────────
//
// The arm above cannot force the reader to be late, so on a quiet box it always takes the measured
// branch and the declared branch is never exercised. This one puts every ask in a SINGLE WRITE, which
// is the shape a late reader produces, and asserts the half that only appears then.
//
// It is the second occurrence rule applied: a race that passed on re-run gets driven and counted, not
// re-run and believed.
test("tracker issue 1828 asks that reach the parser in ONE chunk are declared unmeasurable, not zero", async () => {
  // WHY THIS RETRIES, AND WHY A MISS IS A FAILURE RATHER THAN A PASS.
  //
  // The sender can put every ask in one WRITE; it cannot make the reader deliver them as one CHUNK.
  // A single write is atomic on a pipe, but the reader's chunk boundary can still fall between the two
  // lines when earlier bytes are still draining — measured here on the first cut of this very arm, which
  // passed alone and failed once inside a four-file run. So the condition is attempted, and OBSERVED
  // rather than assumed.
  //
  // If no attempt produces the collapse, this FAILS. It does not pass quietly: an arm whose fixture
  // could not build the state it exists to test has proved nothing, and reporting that as green is the
  // exact shape of defect this whole issue is about.
  let observed = null;
  const seen = [];
  for (let attempt = 1; attempt <= 6 && !observed; attempt++) {
    process.env.MOCK_CLAUDE_TOOL_OVERLAP = JSON.stringify([
      { name: "register_execute_plan", ms: 60 },
      { name: "perplexity_ask", ms: 60, preMs: 120 },   // ignored in one-chunk mode, and that is the point
    ]);
    process.env.MOCK_CLAUDE_TOOL_OVERLAP_ONE_CHUNK = "1";
    const row = await run(`twoask-onechunk-${attempt}`);
    seen.push({ byTool: row.toolWaitByTool, unmeasurable: row.toolWaitUnmeasurable });
    assert.equal(row.toolCalls, 2, "both asks were still emitted");
    // THE COLLAPSE IS A THING THE RUN RECORDS, SO SELECT ON THE RECORD.
    // This used to select on `register_execute_plan` being ABSENT from byTool, which is not the
    // collapse — it is one possible CONSEQUENCE of it, and scheduling defeats it. Measured on main at
    // 54a8d10, all six attempts byte-identical:
    //   byTool {"register_execute_plan":2,"perplexity_ask+register_execute_plan":58,"perplexity_ask":59}
    //   unmeasurable [{"tool":"register_execute_plan","chunk":2,"bytes":545,
    //                  "sincePrevChunkMs":41,"cause":"ask-superseded-in-chunk"}]
    // The reader caught a 2ms sliver in which the first ask WAS alone, then the second arrived in the
    // same chunk. That is the engine honouring this issue exactly — measure what you saw, declare what
    // you could not — and the old selector threw all six away and called it a fixture failure.
    // Partially observed is a THIRD state, and an absence test cannot express it.
    if (collapsedInOneChunk(row)) observed = row;
  }
  assert.ok(observed,
    "6 attempts and the reader never delivered both asks in one chunk, so the branch this arm tests was "
    + "never reached. That is a fixture failure, not a pass — the collapse is what the arm is for. "
    + `[attempts=${JSON.stringify(seen)}]`);
  // NOW THE PAYOFF, AND IT IS NO LONGER THE SELECTOR SAID TWICE. The assertion that stood here was
  // `!Object.keys(observed.toolWaitByTool).includes("register_execute_plan")` — the SAME predicate the
  // loop used to choose `observed`. It was true by construction from the day it was written and could
  // never have failed. Fixing the selector is what made that visible.
  const declared = (observed.toolWaitUnmeasurable ?? []).filter((u) => u?.cause === "ask-superseded-in-chunk");
  const spec = ` [byTool=${JSON.stringify(observed.toolWaitByTool)}`
    + ` unmeasurable=${JSON.stringify(observed.toolWaitUnmeasurable)}]`;

  // (a) THE DECLARATION IS ACTIONABLE, NOT A BARE FLAG. It must name the ask that was superseded and
  // carry the evidence a reader needs to believe it — which chunk, and how big it was.
  assert.ok(declared.some((u) => u.tool === "register_execute_plan"),
    "the superseded ask is not named in the declaration, so a reader cannot tell WHICH period went "
    + "unobserved" + spec);
  for (const u of declared) {
    assert.equal(typeof u.chunk, "number", "a declaration without its chunk index cannot be checked" + spec);
    assert.ok(Number.isFinite(u.bytes) && u.bytes > 0,
      "a declaration whose byte count is absent or zero describes nothing" + spec);
  }

  // (b) AND THE ACCOUNTING IS COMPLETE. This is the half that carries magnitude, and it is
  // load-INDEPENDENT: it constrains the parts against each other, never against the wall clock. A
  // period the reader could not see cannot be quietly credited with invented time, because the invented
  // millisecond would have to come from somewhere and the sum would stop matching.
  const parts = Object.values(observed.toolWaitByTool ?? {}).reduce((a, b) => a + b, 0);
  assert.equal(parts, observed.toolWaitMs,
    "the per-tool keys do not sum to the turn's total wait, so a period was credited to no key or to "
    + "two" + spec);
});

test("tracker issue 1828 the parts still sum to the total when asks overlap", async () => {
  // The identity the kill clock depends on. Keying by id must not make an interval land twice, which is
  // the failure mode a naive per-tool split has: a message asking for two tools waits ONCE.
  process.env.MOCK_CLAUDE_TOOL_OVERLAP = JSON.stringify([
    { name: "register_execute_plan", ms: 120 },
    { name: "perplexity_ask", ms: 90 },
  ]);
  const row = await run("twoask-identity");
  const parts = Object.values(row.toolWaitByTool).reduce((a, b) => a + b, 0);
  assert.equal(parts, row.toolWaitMs,
    `the parts sum to ${parts} and the total is ${row.toolWaitMs} — an interval was counted a different `
    + "number of times in the two places, and a reader comparing them cannot tell which to believe");
});

test("tracker issue 1828 the ALTERNATING case is unchanged — one ask, one result, one interval", async () => {
  // THE CONTROL. Every arm above passes on an engine that simply adds every interval to every tool, and
  // this is the one that does not: with strict alternation the two waits must stay separate and the
  // pooled key must still pool.
  process.env.MOCK_CLAUDE_TOOL_WAIT = JSON.stringify([
    { name: "register_execute_plan", ms: 120 },
    { name: "register_execute_plan", ms: 80 },
    { name: "perplexity_ask", ms: 60 },
  ]);
  const row = await run("twoask-alternating");
  const spec = ` [byTool=${JSON.stringify(row.toolWaitByTool)} total=${row.toolWaitMs}]`;
  assert.equal(row.toolCalls, 3, "three asks" + spec);
  assert.deepEqual(Object.keys(row.toolWaitByTool).sort(), ["perplexity_ask", "register_execute_plan"],
    "the two register asks must still POOL under one key, and no third key may appear" + spec);
  const parts = Object.values(row.toolWaitByTool).reduce((a, b) => a + b, 0);
  assert.equal(parts, row.toolWaitMs, "the identity holds in the alternating case too" + spec);
});

test("tracker issue 1828 results that come back OUT OF ORDER close the ask they belong to", async () => {
  // THE ARM THE ID EXISTS FOR, and the only one that tells this fix from a half-fix. Closing "whichever
  // ask is oldest" passes every other arm in this file, because results normally arrive in ask order.
  // Here the SECOND ask is answered FIRST, so after that result the still-outstanding ask is the FIRST
  // one — and the tail period must be credited to ITS tool. Oldest-first credits it to the other, for
  // the same total. Both were planted; without this arm both stayed green.
  process.env.MOCK_CLAUDE_TOOL_OVERLAP = JSON.stringify([
    { name: "register_execute_plan", ms: 100 },   // asked FIRST, answered SECOND — outlives the other
    { name: "perplexity_ask", ms: 200 },          // asked second, answered first
  ]);
  process.env.MOCK_CLAUDE_TOOL_OVERLAP_REVERSE = "1";
  try {
    const row = await run("twoask-outoforder");
    const spec = ` [byTool=${JSON.stringify(row.toolWaitByTool)} total=${row.toolWaitMs}]`;
    const solo = Object.keys(row.toolWaitByTool).filter((k) => !k.includes("+"));
    assert.ok(solo.includes("register_execute_plan"),
      "after the second ask was answered, the FIRST ask was still outstanding — so the tail period "
      + "belongs to it. Crediting the other tool means each result closed whichever ask was oldest "
      + "rather than its own, which is exactly what tool_use_id is on the wire to prevent." + spec);
    assert.ok(!solo.includes("perplexity_ask"),
      "the tool that was answered FIRST cannot own a period after its own result landed" + spec);
    const parts = Object.values(row.toolWaitByTool).reduce((a, b) => a + b, 0);
    assert.equal(parts, row.toolWaitMs, "the identity holds with results out of order too" + spec);
  } finally { delete process.env.MOCK_CLAUDE_TOOL_OVERLAP_REVERSE; }
});

// ── THE SELECTOR ITSELF, DRIVEN ─────────────────────────────────────────────────────────────────────
//
// The arm above can only ever see what the box produced that minute. This one puts the three shapes to
// the predicate directly, so the case that redded main is a fixture rather than a weather report.
test("tracker issue 1828 the one-chunk selector reads the RECORD, so a measured sliver does not hide the collapse", () => {
  // THE SHAPE THAT REDDED MAIN AT 54a8d10, verbatim from job 98444817794. The reader caught a 2ms
  // period in which the first ask was alone and THEN the second arrived in the same chunk, so the
  // collapse is recorded AND the key is present. This is the regression: the old selector, written as
  // `!hasOwnProperty(byTool, "register_execute_plan")`, threw it away and reported a fixture failure
  // over six identical attempts that had each built the condition perfectly.
  const partiallyObserved = {
    toolWaitByTool: { register_execute_plan: 2, "perplexity_ask+register_execute_plan": 58, perplexity_ask: 59 },
    toolWaitMs: 119,
    toolWaitUnmeasurable: [{
      tool: "register_execute_plan", chunk: 2, bytes: 545, sincePrevChunkMs: 41,
      cause: "ask-superseded-in-chunk",
    }],
  };
  assert.equal(collapsedInOneChunk(partiallyObserved), true,
    "a collapse that was recorded must be recognised even when the reader also caught a sliver of the "
    + "solo period — partially observed is a third state, and this is the case that redded main");
  assert.equal(!Object.prototype.hasOwnProperty.call(partiallyObserved.toolWaitByTool, "register_execute_plan"),
    false, "the OLD selector on this same row: it answers false, which is how six good attempts were "
    + "discarded. Kept as the plant, so the re-aim is shown to move and not merely asserted to.");

  // FULLY COLLAPSED — no sliver at all. The shape the arm was written for, and it must still hold.
  assert.equal(collapsedInOneChunk({
    toolWaitByTool: { perplexity_ask: 59 },
    toolWaitMs: 59,
    toolWaitUnmeasurable: [{ tool: "register_execute_plan", chunk: 1, bytes: 545, cause: "ask-superseded-in-chunk" }],
  }), true, "the case with no solo key at all must still be recognised");

  // THE CONTROL — a predicate that cannot say no is not a predicate. An ordinary alternating turn
  // records no supersede, and a DIFFERENT unmeasurable cause must not be mistaken for this one.
  assert.equal(collapsedInOneChunk({
    toolWaitByTool: { register_execute_plan: 151, perplexity_ask: 300 }, toolWaitMs: 451, toolWaitUnmeasurable: [],
  }), false, "an ordinary turn with both waits measured is not a collapse");
  assert.equal(collapsedInOneChunk({
    toolWaitByTool: { perplexity_ask: 59 }, toolWaitMs: 59,
    toolWaitUnmeasurable: [{ tool: "register_execute_plan", chunk: 1, bytes: 545, cause: "reader-stalled" }],
  }), false, "another unmeasurable cause is not this one");
  assert.equal(collapsedInOneChunk({}), false, "a row with no unmeasurable list at all is not a collapse");
});
