// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the attempt record says how much of a turn was TOOL WAIT, not just how fast it generated.
//
// `tokensPerSec` states its own limit: "the denominator still contains the turn's own tool waits… it
// records the ratio; it does not diagnose it." So a stage that was WAITING and a stage that was slow are
// the same number, and telling them apart has meant reading archived runs by hand and correlating —
// which is exactly what cost.
//
// TWO INTEGERS, NO CONTENT: a count and a millisecond total. Not a call log — no tool names, no inputs,
// no per-call rows. The owner's ruling against tool-call log records was about call logs carrying client
// mark text; neither of these can name a mark.
//
// The arms below run a turn that calls NO tools, which is the case that proves the plumbing: the fields
// must be PRESENT and zero. A field that is silently absent is the failure this file exists to catch —
// the first cut read the wrong variable and emitted nothing at all, and nothing else would have said so.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "tooltime-locks-"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
const { runStage } = await import("../gateway.mjs");

let dir;
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "tooltime-"));
  mkdirSync(driverDir(dir), { recursive: true });
  process.env.MOCK_CLAUDE_CALL_LOG = join(dir, "calls.jsonl");
  process.env.MOCK_OUT_FILE = join(dir, "out.md");
  process.env.MOCK_COUNT_FILE = join(dir, "count");
  delete process.env.MOCK_WARM_MODE;
  delete process.env.MOCK_CLAUDE_TOOL_WAIT;
  process.env.MOCK_CLAUDE_FILE = "a stub the validator accepts\n";
});
// The mock writes its artifact when the message names the path; this stage calls no tools, which is
// exactly the case that proves the fields are PRESENT rather than merely non-zero somewhere.
const runIt = (sessionKey) => runStage("tool-time-stage", {
  agent: "clawdi", message: `TASK\nOUTPUT_FILE: ${process.env.MOCK_OUT_FILE}`, sessionKey,
  timeoutSec: 30, expectFile: process.env.MOCK_OUT_FILE, maxRetries: 0, runDir: dir,
});
const rows = (f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("#1111 the per-stage attempt row carries BOTH fields — present and zero on a tool-less turn", async () => {
  const r = await runIt("prelim-tt");
  assert.equal(r.ok, true, `the fixture stage failed (${r.fail}) — the arms below would read nothing`);
  const [row] = rows(driverDir(dir, "tool-time-stage.jsonl"));
  assert.ok("toolCalls" in row,
    "the attempt row carries no `toolCalls`. A field read off the wrong variable emits nothing and looks "
    + "exactly like an engine that cannot report — which is the whole reason this arm reads the record.");
  assert.ok("toolWaitMs" in row, "the attempt row carries no `toolWaitMs`");
  assert.equal(row.toolCalls, 0, "a turn that called no tools must record 0, not absence");
  assert.equal(row.toolWaitMs, 0);
});

test("#1111 the SPINE carries them too — or a round has to join two files to ask why a stage was slow", async () => {
  await runIt("prelim-tt2");
  const attempts = rows(driverDir(dir, "run.jsonl")).filter((e) => e.event === "attempt");
  assert.equal(attempts.length, 1);
  assert.ok("toolCalls" in attempts[0], "run.jsonl's attempt event carries no `toolCalls`");
  assert.ok("toolWaitMs" in attempts[0], "run.jsonl's attempt event carries no `toolWaitMs`");
});

test("#1111 the two fields carry NO content — a count and a duration can never name a mark", async () => {
  await runIt("prelim-tt3");
  const [row] = rows(driverDir(dir, "tool-time-stage.jsonl"));
  assert.equal(typeof row.toolCalls, "number", "toolCalls must be a NUMBER — a name or a list would be a "
    + "call log, which is what the owner's ruling refuses");
  assert.equal(typeof row.toolWaitMs, "number", "toolWaitMs must be a number");
});

// ── THE PER-TOOL CONTRACT, AS TWO PREDICATES ────────────────────────────────────────────────────
//
// Lifted out of the arm so the same contract can be applied to a real dispatch and to rows that are
// written down. `namesIn` splits the SET key `closePeriod` builds from the outstanding asks.
const namesIn = (key) => String(key ?? "").split("+");
const measuredFor = (row, tool) =>
  Object.hasOwn(row.toolWaitByTool ?? {}, tool) && row.toolWaitByTool[tool] > 0;
const declaredFor = (row, tool) =>
  (row.toolWaitUnmeasurable ?? []).some((u) => u?.cause && namesIn(u?.tool).includes(tool));

// ── ROUND 2 — A NONZERO WAIT, AND WHAT IT WAS MADE OF ──────────────────────────────────────────
//
// Every arm above runs a turn that calls NO tools. That proves the fields are PRESENT and zero, which was
// the defect at the time — and it leaves the gauge in exactly the state it was built to end: an instrument
// only ever seen reporting zero. These arms drive a real gap and read a real number.
//
// The attribution exists because the total cannot answer the question it was collected for. "Exclude tool
// wait from the kill clock, because a turn waiting on a tool is the harness working" is TRUE of
// `register_execute_plan` and FALSE of the perplexity tools, which dispatch to a MODEL — that wait is
// another model generating. Which one a wall kill was made of decides whether the clock should count it.

test("#1111 a REAL tool wait is measured, attributed, and the parts sum to the total", async () => {
  process.env.MOCK_CLAUDE_TOOL_WAIT = JSON.stringify([
    { name: "register_execute_plan", ms: 120 },
    { name: "register_execute_plan", ms: 80 },
    { name: "perplexity_ask", ms: 60 },
  ]);
  await runIt("prelim-tooltime-real").catch(() => {});
  const row = rows(driverDir(dir, "tool-time-stage.jsonl"))[0];
  // — THE SPECIMEN, AND DELIBERATELY NOT THE CURE. This arm went red under concurrent full-suite
  // load on run 32690588919, on a diff that cannot reach the tool-time gauge, with only the last of its
  // five assertions failing. Two causes produce exactly that and the artifact could not tell them apart:
  // `toolWaitByTool.perplexity_ask` being ABSENT (`undefined >= 50` is false), or present and genuinely
  // under 50 for a 60ms requested wait. Every value that would settle it — the total, the count, the
  // split — was discarded by the assertion, which is the position was in for days before
  // / put a specimen in every timing arm.
  //
  // So each assertion now carries the whole row. The next natural red answers the question in one
  // reading: no `perplexity_ask` key at all is a turn that lost a tool result, a number under 50 is a
  // bound that cannot hold, and they need different fixes. Building either one before the reading
  // arrives would be guessing, and already settled the cheapest guess — a timing-sensitive test
  // made quieter is not made correct.
  const spec = ` [row: toolWaitMs=${row?.toolWaitMs} toolCalls=${row?.toolCalls} activeMs=${row?.activeMs}`
    + ` byTool=${JSON.stringify(row?.toolWaitByTool)}`
    // The unmeasurable list travels with EVERY assertion, not just the total's. Two reds on the
    // per-tool bounds could not be told apart without it — a declared collapse and a plain short
    // measurement need different fixes, and neither run's artifacts could answer which it was.
    + ` unmeasurable=${JSON.stringify(row?.toolWaitUnmeasurable)}]`;
  // ── THE READING ARRIVED, AND THIS BOUND IS NOW MEASURED-OR-DECLARED ─────────────────────────────
  //
  // The paragraph above kept this as a SPECIMEN deliberately, waiting for a reading that would tell the
  // two causes apart. It arrived: the arm reddened twice more on busy shards (`toolWaitMs 201` for the
  // same ~260ms fixture), and the gauge now RECORDS the blindness that produces it. Driven and counted
  // on a quiet box rather than re-run:
  //
  //   the shipped fixture (120/80/60)   undercounted  0/10   totals 259–260
  //   TINY gaps (2/2/2)                 undercounted  1/10   and that one was DECLARED, 1 of 1
  //
  // So the shortfall is no longer silent. Every line delivered in one stdout chunk is parsed in a single
  // synchronous loop and shares one timestamp; when a period opens and closes inside that chunk the wait
  // is real and unobservable, and `toolWaitUnmeasurable` now carries it with a `cause`.
  //
  // Asserting the total outright therefore measures the box, not the gauge — green on a quiet one, red
  // on a busy one, on identical code. The contract the gauge actually owes is: the wait is MEASURED, or
  // the run SAYS it could not be. Never neither, which is a real wait reported as a smaller one.
  //
  // The branch where the collapse is DRIVEN rather than waited for lives in
  // `a-wait-the-driver-could-not-measure-says-so.test.mjs`, which blocks the loop across an ask and its
  // result on an escalating ladder and fails loudly when it cannot. It is not duplicated here: through
  // this fixture the collapse is 1-in-10 and a second unreliable driver would be a second load meter.
  const declared = (row.toolWaitUnmeasurable ?? []).filter((u) => u?.cause);
  // ── THE LAST WALL-CLOCK FLOOR, MOVED FROM ACCURACY TO SCALE — ───────────
  //
  // It was `>= 250` against a nominal 260, and the note closing the previous round predicted this
  // exactly: "the only remaining magnitude assertion is still a timing assertion and gets the same
  // treatment when it reds." It redded on main, and the row showed the arm was measuring the box:
  //
  //   toolWaitMs=239 activeMs=456 byTool={register_execute_plan:179, perplexity_ask:60} unmeasurable=[]
  //
  // Every period seen, both tools keyed, 179+60=239 so the identity held, nothing to declare. The gauge
  // did not fail — 239 is 92% of nominal, and the floor demanded 96%.
  //
  // COUNTED, NOT TUNED, the way the sibling file counted its stall ladder. 30 runs of this fixture on an
  // idle box: toolWaitMs 259–260 every time, 0 declaring unmeasurable — the gauge is EXACT at rest, and
  // all of the variance is the box. Against that, the values seen under CI load are 201, 239 and 284.
  //
  // So the floor now asserts SCALE, which this gauge can promise, instead of ACCURACY, which it cannot:
  // half of nominal is 71ms clear of the lowest value ever observed and still fails a gauge reporting a
  // half, a tenth or a hundredth of reality — which is the residual this floor is kept for. What it can
  // no longer see, stated rather than lost: a shortfall of tens of milliseconds. Nothing can see that
  // without measuring the box, which is what three reds of this arm have been.
  const NOMINAL_WAIT_MS = 260;                       // 120 + 80 + 60, the fixture at the top of this arm
  const SCALE_FLOOR_MS = Math.round(NOMINAL_WAIT_MS / 2);
  assert.ok(row.toolWaitMs >= SCALE_FLOOR_MS || declared.length >= 1,
    `toolWaitMs was ${row.toolWaitMs} against a nominal ${NOMINAL_WAIT_MS} — under HALF, and the row `
    + "declared nothing unmeasurable. This is not a slow box: 30 runs at rest give 259–260, and the "
    + "worst value ever seen under CI load is 201. A number this small is the gauge reporting a "
    + "fraction of reality in the same field and units as a real measurement" + spec
    + ` [unmeasurable=${JSON.stringify(row.toolWaitUnmeasurable)}]`);
  assert.equal(row.toolCalls, 3, "three asks, three tool_use blocks" + spec);
  // THE IDENTITY. Attribution that does not sum to the total is a second opinion about the same
  // milliseconds, and a reader comparing them would have no way to know which one to believe.
  const parts = Object.values(row.toolWaitByTool).reduce((a, b) => a + b, 0);
  assert.equal(parts, row.toolWaitMs,
    `the per-tool parts sum to ${parts} but the total is ${row.toolWaitMs}` + spec);
  // AND THE SPLIT IS THE POINT: harness time and sub-model time are separable, which is the whole reason
  // the total alone cannot decide whether the kill clock should count tool wait.
  //
  // ── THESE ASSERT ATTRIBUTION, NOT DURATION, AND THAT IS THE FIX ─────────────────────────────────
  //
  // They were wall-clock floors — `register_execute_plan >= 180`, `perplexity_ask >= 50` — and the floor
  // is the half that measures the box. `perplexity_ask` reddened twice on busy runners for a requested
  // 60 ms wait, at 48 and then at 28, the second time on MAIN; every other assertion passed both times,
  // including the measured-or-declared total directly above at 313 and 259 against its floor of 250.
  //
  // The header's own conclusion about the total — that asserting a raw number measures the box and not
  // the gauge — is a statement about the GAUGE, so it was always true of a bucket too. `1233d0b` gave
  // the total its contract and left the buckets on raw thresholds; this is the other half of that
  // change, and carries the measurements.
  //
  // WHY NOT A LOWER FLOOR, OR THE TOTAL'S measured-or-declared CONTRACT. 28 is already under any floor
  // worth writing, and settled that a timing-sensitive test made quieter is not made correct. The
  // declared contract does not fit either: the gauge records an unmeasurable period only when one opens
  // and closes inside a single chunk, which would read ~0 rather than 28, so these rows are probably not
  // the declared case at all — and building on that guess is what the header spent a round of this
  // file's history avoiding. The unmeasurable list is now in `spec` so the next red can settle it.
  //
  // WHAT THE ARM IS NAMED FOR IS ATTRIBUTION: that the model-bearing tool keeps its OWN key instead of
  // being pooled into the register one. Measured 28 times locally, 54–70 for a requested 60 — the gauge
  // under-measures even at rest, so the floor was inside its own noise. The properties below say the
  // same thing without asking the box: both keys present, both non-zero, and the pooled key larger
  // because it pools 120+80 against a single 60. Load scales both, so the ordering survives it.
  // ── AND THE BUCKETS GET THE TOTAL'S CONTRACT: MEASURED, OR THE RUN SAYS IT COULD NOT LOOK ───────
  //
  // The header above left one question open — "these rows are probably not the declared case at all" —
  // and put the unmeasurable list in `spec` so the next red could settle it. It arrived on MAIN, CI run
  // 33532859792, driver shard 2, and it settles it the other way:
  //
  //   byTool={"register_execute_plan":284}
  //   unmeasurable=[{tool:"register_execute_plan",chunk:2,bytes:1286,sincePrevChunkMs:284,cause:"result-in-ask-chunk"},
  //                 {tool:"perplexity_ask",       chunk:2,bytes:1286,sincePrevChunkMs:284,cause:"result-in-ask-chunk"}]
  //
  // It IS the declared case, and the declared case produces ABSENCE rather than a small number. Both
  // results arrived in one 1286-byte chunk, so both periods opened and closed on a single timestamp:
  // `spent` is 0, `closePeriod`'s `if (spent > 0)` never creates the key, and the row declares both.
  // The gauge did what built it to do and this assertion had no way to accept it.
  //
  // ✕ NOT THE FLOOR LOWERED AGAIN. Absent AND undeclared still fails — a turn that lost a tool result is
  // the defect this arm is named for and it is untouched. What stops failing is the row that SAYS it
  // could not see one, which is the same contract the total two assertions up already carries.
  //
  // MEASURED MEANS ITS OWN KEY, AND DECLARED READS THE SET. That asymmetry is not tidiness. A period
  // covering both asks keys on the SET — `"a+b"`, pinned by the multi-tool arm below — so accepting a
  // composite as measurement would accept exactly the pooling this arm exists to refuse. The same
  // composite in the unmeasurable list must be accepted, because a collapse covering two asks can only
  // name them together, and refusing it would leave this hole open one shape over.
  for (const tool of ["register_execute_plan", "perplexity_ask"]) {
    assert.ok(measuredFor(row, tool) || declaredFor(row, tool),
      `${tool} has no key of its own AND nothing in the row says why. The turn lost a tool result, or its `
      + "wait was pooled under another name — a different and worse failure than a short measurement, and "
      + "the one this arm is named for" + spec);
  }
  // ORDERING NEEDS TWO NUMBERS, and a declared collapse leaves fewer than two. Written as an implication
  // rather than an `if` so the assertion still EXECUTES on such a run: a site the coverage census sees
  // skipped is a site it reports as never run, which would trade this flake for another one.
  const bothMeasured = measuredFor(row, "register_execute_plan") && measuredFor(row, "perplexity_ask");
  assert.ok(!bothMeasured || row.toolWaitByTool.register_execute_plan > row.toolWaitByTool.perplexity_ask,
    "the two register asks (120+80) are pooled under one key and must therefore out-measure the single "
    + "60ms perplexity ask. If they do not, the pooling is wrong or a wait landed under the wrong name — "
    + "and unlike a floor, this compares two numbers from the same run on the same box" + spec);
});

// ── THE SAME CONTRACT, DRIVEN INSTEAD OF RACED ───────────────────────────────────────────────────
//
// Through this fixture the collapse is 1-in-10, so the arm above cannot be relied on to visit the branch
// it just gained; and the header refuses a second stall driver in this file, because a second unreliable
// driver is a second load meter. Rows written down visit every branch on every box, every time — the
// specimen from the run that took main red among them.
test("#1111 the per-tool contract: its OWN key, or the row says why it has none", () => {
  const mainRed = {
    toolWaitMs: 284, toolCalls: 3, activeMs: 896,
    toolWaitByTool: { register_execute_plan: 284 },
    toolWaitUnmeasurable: [
      { tool: "register_execute_plan", chunk: 2, bytes: 1286, sincePrevChunkMs: 284, cause: "result-in-ask-chunk" },
      { tool: "perplexity_ask", chunk: 2, bytes: 1286, sincePrevChunkMs: 284, cause: "result-in-ask-chunk" },
    ],
  };
  assert.ok(!measuredFor(mainRed, "perplexity_ask"),
    "the specimen's whole subject is a key the collapse could not create");
  assert.ok(declaredFor(mainRed, "perplexity_ask"),
    "…and a row that says why, which is what makes the absence acceptable rather than a lost result");

  // THE DEFECT THIS ARM IS NAMED FOR, UNCHANGED: absent, and nothing saying why.
  const lost = { toolWaitByTool: { register_execute_plan: 284 }, toolWaitUnmeasurable: [] };
  assert.ok(!measuredFor(lost, "perplexity_ask") && !declaredFor(lost, "perplexity_ask"),
    "a turn that lost a tool result must still fail: no key of its own, and no declaration either");

  // A DECLARATION WITHOUT A CAUSE IS NOT ONE. The entry shape is the sibling file's contract; an entry
  // naming a tool and nothing else would excuse every absence.
  assert.ok(!declaredFor({ toolWaitByTool: {}, toolWaitUnmeasurable: [{ tool: "perplexity_ask" }] }, "perplexity_ask"),
    "an unmeasurable entry with no cause must not excuse an absent key");

  // POOLING IS NOT MEASUREMENT — the asymmetry, in both directions.
  assert.ok(!measuredFor({ toolWaitByTool: { "perplexity_ask+register_execute_plan": 284 } }, "perplexity_ask"),
    "a composite key is the pooling this arm refuses, not a measurement of either tool");
  const pooledCollapse = { toolWaitByTool: {},
    toolWaitUnmeasurable: [{ tool: "perplexity_ask+register_execute_plan", cause: "result-in-ask-chunk" }] };
  for (const tool of ["perplexity_ask", "register_execute_plan"]) {
    assert.ok(declaredFor(pooledCollapse, tool),
      `a collapse covering both asks can only name them together, so it must declare ${tool}`);
  }
});

test("#1111 ONE ask for several tools is ONE interval under ONE key — never counted twice", async () => {
  // A message asking for two tools waits once. Attributing the interval to each name would report roughly
  // double the elapsed wait, and the sum identity above is what makes that visible rather than plausible.
  process.env.MOCK_CLAUDE_TOOL_WAIT = JSON.stringify([{ name: ["band_lookup", "band_record"], ms: 120 }]);
  await runIt("prelim-tooltime-multi").catch(() => {});
  const row = rows(driverDir(dir, "tool-time-stage.jsonl"))[0];
  // MEASURED-OR-DECLARED HERE TOO, and this arm was one chunk away from being the next red. A period
  // that opens and closes inside one stdout chunk credits nothing, so `toolWaitByTool` is EMPTY — and
  // `deepEqual([], ["band_lookup+band_record"])` would have reported "the set key is wrong" about a run
  // where the gauge had correctly said it could not look. Found by walking every assertion in this file
  // against a collapsed row rather than waiting for it to arrive.
  // ✕ AND WRITTEN SO BOTH SITES EXECUTE ON EVERY RUN, which the first version of this got wrong three
  // assertions after stating the rule for the ordering bound. An `if (!collapsed) … else …` puts an
  // assertion in a branch no ordinary run takes, and the coverage census reports that — correctly — as
  // an arm that gained an assertion which never runs. It reddened main's own gate. A site the census
  // sees skipped is a site it reports as never run, so a tolerance must be expressed as ONE assertion
  // over both cases, never as two assertions in two branches.
  //
  // NOT A PASS BY DEFAULT EITHER. Whichever half the gauge could produce has to name the SET: measured
  // under the set key, or declared under the same set key. A collapse that named something else means
  // the two halves disagree about what the outstanding ask was.
  const declaredKeys = (row.toolWaitUnmeasurable ?? []).filter((u) => u?.cause).map((u) => u.tool);
  const measuredKeys = Object.keys(row.toolWaitByTool);
  assert.deepEqual(measuredKeys.length ? measuredKeys : declaredKeys, ["band_lookup+band_record"],
    "a concurrent ask must key on the SET — or, where the period collapsed inside one chunk and nothing "
    + `could be credited, be DECLARED under that same set key. Saw byTool=${JSON.stringify(row.toolWaitByTool)} `
    + `unmeasurable=${JSON.stringify(row.toolWaitUnmeasurable)}`);
  assert.ok(!measuredKeys.length || Object.values(row.toolWaitByTool)[0] === row.toolWaitMs,
    "the one key does not carry the whole total, so the interval landed somewhere else as well"
    + ` [byTool=${JSON.stringify(row.toolWaitByTool)} toolWaitMs=${row.toolWaitMs}]`);
  assert.equal(row.toolCalls, 2, "two tool_use blocks were still asked for");
});

test("#1111 activeMs separates GENERATING from WAITING, and a no-tool turn reports the whole wall", async () => {
  // The field that makes a wall kill readable: a turn killed with most of its elapsed in tool wait is a
  // different event from one that ground for the whole budget generating, and `wall` alone cannot say which.
  process.env.MOCK_CLAUDE_TOOL_WAIT = JSON.stringify([{ name: "register_execute_plan", ms: 250 }]);
  await runIt("prelim-tooltime-active").catch(() => {});
  const row = rows(driverDir(dir, "tool-time-stage.jsonl"))[0];
  assert.ok("activeMs" in row, "the attempt row carries no `activeMs`");
  assert.ok(row.activeMs >= 0);
  assert.ok(row.activeMs + row.toolWaitMs <= Math.round(row.wall * 1000) + 50,
    `activeMs ${row.activeMs} + toolWaitMs ${row.toolWaitMs} exceeds the wall ${Math.round(row.wall * 1000)}ms`);
  // MEASURED-OR-DECLARED, and this one was found by PLANTING the collapse rather than by reading the
  // file. Its message is a diagnosis — "the subtraction is not happening" — and under a collapsed period
  // that diagnosis is FALSE: the subtraction happened, and there was nothing to subtract because the
  // wait was unobservable. Wrong answers are worse than none, so the claim is conditioned rather than
  // asserted flat. It is NOT the same case as the identity arm's anti-vacuity guard below, which stays
  // strict on purpose: that one reds because it PROVED nothing, this one would have reported a defect
  // that is not there.
  const unobservable = (row.toolWaitUnmeasurable ?? []).some((u) => u?.cause);
  assert.ok(row.activeMs < Math.round(row.wall * 1000) || unobservable,
    "a turn with a real 250ms tool wait reported its ENTIRE wall as active, and the row declared nothing "
    + `unmeasurable — the subtraction is not happening [activeMs=${row.activeMs} toolWaitMs=${row.toolWaitMs} `
    + `wall=${Math.round(row.wall * 1000)} unmeasurable=${JSON.stringify(row.toolWaitUnmeasurable)}]`);
});

test("#1111 a turn that calls no tools reports an EMPTY attribution, not a missing one", async () => {
  // `{}` is a measurement — this engine reports, and there was nothing to report. null would mean the engine
  // cannot report at all, and absent would be indistinguishable from a record written before the field.
  await runIt("prelim-tooltime-empty").catch(() => {});
  const row = rows(driverDir(dir, "tool-time-stage.jsonl"))[0];
  assert.ok("toolWaitByTool" in row, "the key must be present even when nothing was called");
  assert.deepEqual(row.toolWaitByTool, {});
  assert.notEqual(row.toolWaitByTool, null, "an engine that CAN report and had nothing is not an engine that cannot");
});

// ── ROUND 3 — THE CEILING MEASURES WORK, NOT ELAPSED ───────────────────────────────────────────
//
// Owner ruling: "there isnt such thing as a hung model. it always delivers something or fails." The
// ceiling exists for the harness's own failure modes, not to budget the model, so a turn still doing
// work must not die because a tool it was waiting on took a while to answer.
//
// Asserted on the pure predicate rather than through a live turn: `hardMs` clamps to a 60s floor, so an
// integration arm would have to burn a minute of wall to reach it — and would then be measuring the
// clamp as much as the rule.

const { activeElapsedMs } = await import("../engine/anthropic-agent.mjs");

test("#1111 a turn that is mostly TOOL WAIT is not near the ceiling", () => {
  // The measured specimen, in round numbers: 646.7s elapsed, 74.8% of it waiting on 17 register calls.
  // On elapsed it is 6.5× past a 100s ceiling; on work it is nowhere near it.
  const wall = 646_700, toolWaitMs = 483_700;
  assert.equal(activeElapsedMs({ wall, toolWaitMs }), 163_000);
  assert.ok(wall >= 100_000, "the fixture must exceed the ceiling on ELAPSED, or this proves nothing");
  assert.ok(activeElapsedMs({ wall, toolWaitMs }) < 200_000, "the same turn is well inside it on work");
});

test("#1111 a turn that is GENERATING for the whole budget still hits it — this is not a ceiling removal", () => {
  // The positive control. A rule that never fires would satisfy the arm above and delete the bound.
  assert.ok(activeElapsedMs({ wall: 400_000, toolWaitMs: 0 }) >= 300_000);
  assert.ok(activeElapsedMs({ wall: 400_000, toolWaitMs: 50_000 }) >= 300_000,
    "some tool wait must not excuse a turn that ground through the budget generating");
});

test("#1111 a call still IN FLIGHT counts as wait — the case that kills a turn mid-call", () => {
  // Without this the ceiling charges the model for the wait that killed it, which is the exact reading
  // the whole issue is about.
  const now = 1_000_000;
  assert.equal(activeElapsedMs({ wall: 200_000, toolWaitMs: 0, toolAskedAt: now - 150_000, now }), 50_000);
  // A clock that ran backwards must not manufacture work out of a negative wait.
  assert.equal(activeElapsedMs({ wall: 200_000, toolWaitMs: 0, toolAskedAt: now + 5_000, now }), 200_000);
  assert.equal(activeElapsedMs({ wall: 100, toolWaitMs: 500 }), 0, "active time is never negative");
});

test("#1111 THE IDENTITY: activeMs + toolWaitMs === wall, on a turn with real tool wait", async () => {
  // The cheap red for the whole clock fix, and the one that only holds because the in-flight gap is now
  // closed into the REPORTED toolWaitMs. Before that, the two fields were short of the wall by exactly
  // that gap — on turns killed mid-call, which is the population this issue is about, so a guard would
  // have passed everywhere it did not matter.
  process.env.MOCK_CLAUDE_TOOL_WAIT = JSON.stringify([{ name: "Bash", ms: 120 }, { name: "Read", ms: 80 }]);
  try {
    const r = await runIt("prelim-tt-identity");
    assert.equal(r.ok, true, `the fixture stage failed (${r.fail})`);
    const [row] = rows(driverDir(dir, "tool-time-stage.jsonl"));
    // ✕ DELIBERATELY NOT GIVEN THE MEASURED-OR-DECLARED ESCAPE, unlike every assertion above. This is
    // an ANTI-VACUITY guard, not a claim about the gauge: at zero the identity below holds trivially, so
    // a green here would report that an arm which proved nothing had proved something. If every period
    // collapsed, the honest outcome is this red — and the message says so, so the next reader does not
    // go hunting for a clock defect that is not there.
    assert.ok(row.toolWaitMs > 0, `the fixture produced no tool wait (${row.toolWaitMs}ms) — the identity `
      + "holds trivially at zero and this arm would prove nothing. If the row also declares every period "
      + `unmeasurable (${JSON.stringify(row.toolWaitUnmeasurable)}), the fixture could not build its state `
      + "under load rather than the clocks being wrong: re-read, do not re-run.");
    assert.ok("activeMs" in row, "the attempt row carries no `activeMs`");
    const wallMs = Math.round(row.wall * 1000);
    // ±1 for the two independent roundings (wall is recorded in seconds).
    assert.ok(Math.abs((row.activeMs + row.toolWaitMs) - wallMs) <= 1,
      `activeMs (${row.activeMs}) + toolWaitMs (${row.toolWaitMs}) = ${row.activeMs + row.toolWaitMs}, `
      + `but the turn's wall was ${wallMs}ms. The two clocks must TILE the wall — a third bucket means one `
      + "of them is measuring something nobody named.");
  } finally { delete process.env.MOCK_CLAUDE_TOOL_WAIT; }
});

test("#1111 THE IDENTITY HOLDS ON A TURN KILLED MID-CALL — the case that only the closed gap covers", async () => {
  // THE ARM THAT DISCRIMINATES. The identity above holds whether or not the in-flight gap is folded in,
  // because at settle every ask had closed. A turn killed WHILE a call is outstanding is the population
  // is about, and there `toolWaitMs` has not closed: reporting the raw accumulator leaves the two
  // fields short of the wall by exactly the gap that killed the turn.
  // MARGINS, not tight numbers. The kill must land while the ask is OPEN, so the mock has to have
  // emitted its tool_use before the stall clock runs out. At 250ms it usually had — and under full-suite
  // load sometimes had not, which showed up as this arm intermittently reporting 0ms of tool wait: the
  // turn died before any call existed, so there was no mid-call to measure. The stall is now several
  // times the mock's worst observed start-up, and the gap several times the stall.
  process.env.CLEAROTRON_STALL_MS = "2000";
  process.env.MOCK_CLAUDE_TOOL_WAIT = JSON.stringify([{ name: "Bash", ms: 10000 }]);
  try {
    const r = await runIt("prelim-tt-inflight");
    assert.equal(r.ok, false, "the fixture turn was not killed — it must die mid-call for this arm to mean anything");
    const [row] = rows(driverDir(dir, "tool-time-stage.jsonl"));
    // PRECONDITION FIRST, and named as one: a zero here means the fixture never got mid-call, not that
    // the gap is uncounted. Distinguishing them is the difference between a margin to widen and a defect.
    assert.ok(row.toolCalls > 0 || row.toolWaitMs > 0,
      "the turn died before any tool ask existed, so this arm never reached the case it tests — widen the "
      + "stall margin rather than reading this as a passing or failing measurement");
    assert.ok(row.toolWaitMs > 0,
      `the killed turn reported ${row.toolWaitMs}ms of tool wait. The ask was still open when it died, so a `
      + "raw accumulator reads zero and the model is charged for the wait that killed it.");
    const wallMs = Math.round(row.wall * 1000);
    assert.ok(Math.abs((row.activeMs + row.toolWaitMs) - wallMs) <= 1,
      `activeMs (${row.activeMs}) + toolWaitMs (${row.toolWaitMs}) = ${row.activeMs + row.toolWaitMs} against a `
      + `wall of ${wallMs}ms — the in-flight gap is missing from the reported wait.`);
  } finally { delete process.env.MOCK_CLAUDE_TOOL_WAIT; delete process.env.CLEAROTRON_STALL_MS; }
});
