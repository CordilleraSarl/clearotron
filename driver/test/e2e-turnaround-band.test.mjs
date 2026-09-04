// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE BAND OWNS THE TURNAROUND BENCHMARK, AND THE REPORT SAYS WHICH NUMBER IT JUDGED AGAINST.
//
// WHAT WENT WRONG. `cost.targetMinutes` was a per-scenario field. Four scenarios in ONE band carried
// four different values — 120, 180, 240 and nothing at all — each copied from that scenario's own
// expected wall. A benchmark taken from the run's own estimate moves with the thing it judges and can
// never be exceeded. It shipped a wrong report: a 171-minute run was called inside a 180-minute
// "benchmark" while the engine's own line for the same run said "quoted 2h, actual 2.86h — 1.43× the
// quote". And the fourth scenario carried no key at all, so the harness printed no benchmark line
// whatsoever — an absence rendered as silence, which reads exactly like a benchmark that was met.
//
// WHY EVERY TEST HERE IS A PROPERTY AND NOT A PRESENCE CHECK. "A benchmark line is printed" passes
// under almost any bug, including the one that shipped — the line WAS printed, for three of the four.
// So the assertions below are relational: this scenario and that one derive the SAME number; this wall
// against that independently-supplied band yields THIS difference; the number the verdict judged
// against is NAMED and is the band's, not the engine's.
//
// THE PURE SPLIT IS WHAT MAKES THIS CHECKABLE AT ALL. `turnaroundVerdict` takes plain values and
// touches no clock and no filesystem, so "a 171-minute run reads as 51 minutes over a 120-minute band"
// is a fixture rather than a three-hour clearance run.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  TURNAROUND_BANDS, BAND_IDS, bandForPipeline, benchmarkMinutes, benchmarkSource,
} from "../turnaround-bands.mjs";
import {
  bandForScenario, engineTurnaround, turnaroundVerdict, lintScenarios, TERMINAL_RUN_STATES,
} from "../../scripts/e2e.mjs";
import { PRODUCT_POLICIES } from "../search-policy.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const E2E = join(REPO, "scripts", "e2e.mjs");
const E2E_SRC = readFileSync(E2E, "utf8");

// ── the table ───────────────────────────────────────────────────────────────────────────────────────

test("the band axis IS policy.pipeline — the table has a row for every pipeline the offering runs, and no others", () => {
  // Not "the table contains clearance". A table naming a subset passes that; a table naming a band no
  // product can reach passes it too. Set equality against the live registry, both directions.
  const pipelines = [...new Set(Object.values(PRODUCT_POLICIES).map((p) => p.pipeline))].sort();
  assert.deepEqual([...BAND_IDS].sort(), pipelines,
    "a pipeline with no band would print NOT DETERMINED forever; a band no product reaches is a number nobody can check");
  assert.deepEqual(BAND_IDS.map(benchmarkMinutes), BAND_IDS.map((b) => TURNAROUND_BANDS[b].minutes));
});

test("an unknown band is null, never zero and never a default — 0 is a benchmark every run exceeds", () => {
  for (const bad of ["full-depth", "prelim", "prelim-jx", "", null, undefined, 5, {}]) {
    assert.equal(bandForPipeline(bad), null, `${JSON.stringify(bad)} must not resolve to a band`);
    assert.equal(benchmarkMinutes(bad), null, `${JSON.stringify(bad)} must have no benchmark`);
    assert.equal(benchmarkSource(bad), null);
  }
  assert.equal(bandForPipeline("  CLEARANCE "), "clearance", "the lookup is case- and space-tolerant on a real row");
});

// ── the derivation: the band comes from the doors, never from the file ──────────────────────────────

const KNOCKOUT_JOB = { ref: "E2E-K", markName: "E2E BAND PROBE", classes: [9], product: "knockout-search", forwarder: "e2e" };
const CLEARANCE_JOB = { ref: "E2E-C", markName: "E2E BAND PROBE", classes: [9], product: "multi-country-focus-search", jurisdictions: ["FR", "DE"], forwarder: "e2e" };

/** A resolver stub, so the derivation can be driven without a profile store. */
const stubResolve = (byRef) => (job) => ({ resolved: byRef[job?.ref] ?? null });

test("THE BAND OWNS THE NUMBER: a scenario carrying its own targetMinutes derives exactly what one carrying none does", () => {
  // THE central property, and the one the shipped defect fails. Two scenarios identical but for the
  // benchmark keys must be indistinguishable to the derivation — a field that is read cannot pass this,
  // whatever it is read into.
  const bare = { id: "R9", job: CLEARANCE_JOB, expect: { terminal: "delivered" }, cost: { measured: true, wallMinutes: 122 } };
  const loaded = { ...bare, cost: { ...bare.cost, targetMinutes: 999, targetBand: "full depth", wallMinutes: 240 } };
  const resolve = stubResolve({ "E2E-C": { pipeline: "clearance" } });

  const a = bandForScenario(bare, resolve);
  const b = bandForScenario(loaded, resolve);
  assert.deepEqual(b, a, "the scenario's own figures must not reach the benchmark by any route");
  assert.equal(a.minutes, 120);
  assert.equal(a.source, TURNAROUND_BANDS.clearance.source, "and the number carries the band's provenance, not the file's");

  // …and neither does the verdict it feeds.
  assert.deepEqual(turnaroundVerdict(b).lines, turnaroundVerdict(a).lines);
  assert.ok(!turnaroundVerdict(b).lines.join(" ").includes("999"), "no scenario-carried figure reaches the printed line");
});

test("a case refused before any model call cannot put a scenario in a band", () => {
  // The R0 shape: seven cases refused at the door, two that actually run. Four of the refused ones name
  // clearance-pipeline products and one names a RETIRED product the doors answer for with no pipeline
  // at all. Only what RUNS has a turnaround.
  const scenario = {
    id: "R0",
    cases: [
      { id: "a", job: { ref: "A" }, expect: { terminal: "clarify" } },
      { id: "h", job: { ref: "H" }, expect: { terminal: "clarify" } },
      { id: "d", job: { ref: "D" }, expect: { terminal: "duplicate" } },
      { id: "e", job: { ref: "E" }, expect: { terminal: "delivered" } },
    ],
  };
  const resolve = stubResolve({
    A: { pipeline: "clearance" },     // a clearance product, refused
    H: null,                          // a retired product: the doors resolve no pipeline
    D: { pipeline: "knockout" },
    E: { pipeline: "knockout" },
  });
  const b = bandForScenario(scenario, resolve);
  assert.equal(b.band, "knockout", "the band of what actually runs");
  assert.equal(b.minutes, 30);
  assert.equal(b.runnable, 2, "and it says how many blocks that judgement rests on");
});

test("the derived band reproduces the store's own answer for every scenario shape the suite has", () => {
  // A single-job scenario and a multi-case one, both driven through the REAL resolver rather than a
  // stub — so a change in how the doors resolve a product turns this red rather than passing against
  // a fixture that agrees with the old answer.
  const single = { id: "R2", job: CLEARANCE_JOB, expect: { terminal: "delivered" } };
  assert.deepEqual(
    (({ band, minutes }) => ({ band, minutes }))(bandForScenario(single)),
    { band: "clearance", minutes: 120 });

  const multi = { id: "R3", cases: [{ id: "x", job: KNOCKOUT_JOB, expect: { terminal: "delivered" } }] };
  assert.deepEqual(
    (({ band, minutes }) => ({ band, minutes }))(bandForScenario(multi)),
    { band: "knockout", minutes: 30 });
});

test("a policy the doors could not resolve is NOT DETERMINED — never the product word the file typed", () => {
  const scenario = { id: "R9", job: { ...KNOCKOUT_JOB }, expect: { terminal: "delivered" } };
  const b = bandForScenario(scenario, () => ({ resolved: null, readable: false }));
  assert.equal(b.band, null);
  assert.equal(b.minutes, null, "no benchmark, rather than a plausible one");
  assert.match(b.why, /NOT DETERMINED/);
  assert.ok(!/\bknockout\b/.test(b.why), `the typed product word must not leak into the answer: ${b.why}`);
  // And it is reported, not swallowed.
  const v = turnaroundVerdict(b);
  assert.match(v.lines[0], /benchmark: NOT DETERMINED/);
  assert.equal(v.investigate.length, 1, "an undetermined benchmark is the absence this issue is about");
});

test("one scenario, one band: cases resolving to two pipelines refuse rather than pick", () => {
  const scenario = {
    id: "R9",
    cases: [
      { id: "a", job: { ref: "A" }, expect: { terminal: "delivered" } },
      { id: "b", job: { ref: "B" }, expect: { terminal: "delivered" } },
    ],
  };
  const b = bandForScenario(scenario, stubResolve({ A: { pipeline: "knockout" }, B: { pipeline: "clearance" } }));
  assert.equal(b.band, null);
  assert.match(b.why, /more than one band \(clearance, knockout\)/);
});

test("a scenario whose every case is refused still gets a printed line, and is NOT flagged", () => {
  // Nothing ran, so nothing is over. Flagging it would put a permanent entry on the scenario that runs
  // every round, which teaches the reader to skim the block.
  const scenario = { id: "R0", cases: [{ id: "a", job: { ref: "A" }, expect: { terminal: "clarify" } }] };
  const b = bandForScenario(scenario, stubResolve({ A: { pipeline: "clearance" } }));
  assert.equal(b.band, null);
  assert.equal(b.runnable, 0);
  const v = turnaroundVerdict(b);
  assert.equal(v.lines.length, 1, "silence is not an option; a line is printed");
  assert.match(v.lines[0], /NOT DETERMINED — every case is refused/);
  assert.deepEqual(v.investigate, [], "nothing ran, so nothing is over its benchmark");
});

// ── the verdict: units, terminality, and which number it judged against ─────────────────────────────

const CLEARANCE_BENCH = { band: "clearance", minutes: 120, source: TURNAROUND_BANDS.clearance.source, why: null, runnable: 1 };
const KNOCKOUT_BENCH = { band: "knockout", minutes: 30, source: TURNAROUND_BANDS.knockout.source, why: null, runnable: 1 };

test("SECONDS vs MINUTES vs HOURS: the wall is converted, and the difference is the real one", () => {
  // runLedger measures in seconds, the band is in minutes, reconcileTurnaround is in hours. This is the
  // one place all three meet, and a missed conversion fails by printing a plausible number. R2's real
  // 2h02m against the 120-minute band is 2 minutes over — not 7200, and not 0.
  const v = turnaroundVerdict({ ...CLEARANCE_BENCH, run: { engine: null, wallSeconds: 122 * 60, terminal: true } });
  assert.match(v.lines.join("\n"), /actual 122 min → 2 min OVER the clearance band/);
  assert.equal(v.investigate.length, 1);
  assert.match(v.investigate[0], /wall 122 min against the clearance band's 120 min benchmark — 2 min over/);
});

test("REPORT SAYS WHICH NUMBER IT USED when the band and the engine's quote disagree", () => {
  // The real R1: quoted 2h by the engine (later 3h once the native lane fires), band 120, wall 171.
  // Judged against the BAND, said in as many words, with the engine's own figure beside it.
  const v = turnaroundVerdict({
    ...CLEARANCE_BENCH,
    run: {
      engine: { quotedHours: 3, actualHours: 2.86, ratio: 1.43, state: "delivered", source: '_driver/run.jsonl {event:"turnaround-reconciliation"}, last row' },
      wallSeconds: 171 * 60, terminal: true,
    },
  });
  const text = v.lines.join("\n");
  assert.match(text, /the engine quoted 3h \(180 min\) for this run/);
  assert.match(text, /THE TWO DISAGREE/);
  assert.match(text, /judged against the BAND \(120 min\)/);
  assert.match(text, /state delivered/);
  // The arithmetic is the band's, not the engine's: against 180 this run is 9 minutes UNDER.
  assert.equal(v.investigate.length, 1);
  assert.match(v.investigate[0], /51 min over/);
  assert.ok(!/9 min/.test(text), "judging against the engine's quote would report 9 minutes under");
});

test("agreement is stated too, so silence never means 'not checked'", () => {
  const v = turnaroundVerdict({
    ...CLEARANCE_BENCH,
    run: { engine: { quotedHours: 2, state: "delivered", source: "src" }, wallSeconds: 100 * 60, terminal: true },
  });
  const text = v.lines.join("\n");
  assert.match(text, /the engine's quote agrees with the band \(120 min\)/);
  assert.ok(!/DISAGREE/.test(text));
  assert.deepEqual(v.investigate, [], "inside the band is not a finding");
  assert.match(text, /inside the clearance band, by 20 min/);
});

test("a CLEARANCE run with no recorded quote is NOT PROBED — an absence, not a pass", () => {
  const v = turnaroundVerdict({ ...CLEARANCE_BENCH, run: { engine: null, wallSeconds: 60 * 60, terminal: true } });
  assert.equal(v.notProbed.length, 1);
  assert.match(v.notProbed[0], /could NOT be read/);
  assert.match(v.notProbed[0], /absence, not a pass/);
});

test("a KNOCKOUT run with no recorded quote is by design, and is NOT flagged", () => {
  // The cry-wolf case: the knockout lane computes no quote at all, and R3, R4 and R0 run every round.
  const v = turnaroundVerdict({ ...KNOCKOUT_BENCH, run: { engine: null, wallSeconds: 4 * 60, terminal: true } });
  assert.deepEqual(v.notProbed, [], "three of the suite's scenarios would flag this every single round");
  assert.deepEqual(v.investigate, []);
  assert.match(v.lines.join("\n"), /By design, not a gap/);
});

test("an in-flight run makes NO over/under claim — its wall is time-so-far", () => {
  // runLedger falls back to `updatedAt` when there is no `deliveredAt`, so an unfinished run's figure is
  // time elapsed. Calling it over the benchmark manufactures a finding about a run that has not ended.
  const v = turnaroundVerdict({ ...CLEARANCE_BENCH, run: { engine: null, wallSeconds: 200 * 60, terminal: false } });
  assert.match(v.lines.join("\n"), /still in flight; this is time-so-far/);
  assert.deepEqual(v.investigate, [], "a 200-minute in-flight run must not read as 80 minutes over");
  assert.ok(!/OVER/.test(v.lines.join("\n")));
});

test("an unmeasurable wall is NOT PROBED, not zero", () => {
  const v = turnaroundVerdict({ ...CLEARANCE_BENCH, run: { engine: null, wallSeconds: null, terminal: true } });
  assert.match(v.lines.join("\n"), /actual: NOT MEASURED/);
  assert.equal(v.notProbed.length, 2, "the wall AND the clearance quote both declined to answer");
  assert.deepEqual(v.investigate, [], "a wall nobody could measure is not a wall over its benchmark");
});

test("the terminal set is the ENGINE's, not a second opinion about it", () => {
  // driver/progress.mjs holds these in a module-local const and cannot be imported here — its chain
  // reaches driver.config.mjs, whose unset-env defaults are PRODUCTION. So the copy is pinned against
  // the source. A terminal state missing from the harness's list makes every finished run of that kind
  // read as "still in flight", and an in-flight run is never declared over its benchmark: silence.
  const src = readFileSync(join(REPO, "driver", "progress.mjs"), "utf8");
  const m = src.match(/const TERMINAL_STATES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "progress.mjs no longer declares TERMINAL_STATES the way this test reads it — re-derive, do not delete");
  const engineStates = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual([...TERMINAL_RUN_STATES].sort(), engineStates,
    "the harness's terminal states and the engine's must be the same set");
});

// ── the engine's own figure, read off the run journal ───────────────────────────────────────────────

function makeRunDir(lines) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-band-run-"));
  mkdirSync(driverDir(dir));
  writeFileSync(driverDir(dir, "run.jsonl"), lines.join("\n") + "\n");
  return dir;
}

test("engineTurnaround takes the LAST reconciliation row — a run writes several across its life", () => {
  const dir = makeRunDir([
    JSON.stringify({ event: "quote", turnaroundHours: 2 }),
    JSON.stringify({ event: "turnaround-reconciliation", state: "rate-limit-postponed", quotedHours: 2, actualHours: 0.5, ratio: 0.25 }),
    JSON.stringify({ event: "stage", stage: "synthesis" }),
    JSON.stringify({ event: "turnaround-reconciliation", state: "delivered", quotedHours: 2, actualHours: 2.86, ratio: 1.43 }),
  ]);
  try {
    const e = engineTurnaround(dir);
    assert.equal(e.state, "delivered", "a forward first-match returns the leg that got rate-limited");
    assert.equal(e.actualHours, 2.86);
    assert.equal(e.ratio, 1.43);
    assert.match(e.source, /turnaround-reconciliation/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("with no reconciliation row, the run-start quote answers, and says that is what it is", () => {
  const dir = makeRunDir([JSON.stringify({ event: "quote", turnaroundHours: 1.5, units: 4 })]);
  try {
    const e = engineTurnaround(dir);
    assert.equal(e.quotedHours, 1.5);
    assert.equal(e.state, null, "sized, but no terminal reached");
    assert.match(e.source, /\{event:"quote"\}/);
    assert.match(e.source, /no turnaround reconciliation recorded/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a torn append is skipped, never thrown on — the journal is written by another process", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-band-run-"));
  mkdirSync(driverDir(dir));
  writeFileSync(driverDir(dir, "run.jsonl"),
    JSON.stringify({ event: "turnaround-reconciliation", state: "delivered", quotedHours: 2, actualHours: 3 }) + "\n"
    + '{"event":"stage","sta');   // half a line, as a concurrent append leaves it
  try {
    assert.equal(engineTurnaround(dir).state, "delivered", "one truncated line must not take out the whole report");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no journal at all is null — which the verdict then reads three different ways", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-band-run-"));
  try { assert.equal(engineTurnaround(dir), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the store lint, and the census that keeps the read from coming back ─────────────────────────────

const LINTABLE = {
  id: "R1", door: "cli", cost: { measured: true, wallMinutes: 1 },
  job: KNOCKOUT_JOB, expect: { terminal: "delivered" },
};

test("a scenario carrying its own benchmark is NAMED as dead — and does not brick the suite", () => {
  // THE ORDERING PROBLEM THIS ARM EXISTS FOR. The scenario store is a different repo, and all seven live
  // scenarios carry both keys today. A refusal here would stop `list`, `run`, `report` and `teardown`
  // until an edit lands somewhere this repo cannot reach — a harness that cannot run until another repo
  // catches up is not stricter, it is broken. Verified against the live store before this was written:
  // the refusing version printed fourteen refusals and ran nothing.
  //
  // Silence is the other failure and it is the `requiresAck` shape: the key sits in the store looking
  // like the rule it used to be, and the next reader "fixes" the benchmark by editing a number nothing
  // reads. So it is neither obeyed nor passed over — it is named, every invocation, with its value.
  for (const k of ["targetMinutes", "targetBand"]) {
    const val = k === "targetMinutes" ? 240 : "clearance";
    const { wrong, dead } = lintScenarios([{ ...LINTABLE, cost: { ...LINTABLE.cost, [k]: val } }]);
    assert.equal(wrong.length, 0, `cost.${k} must NOT refuse the store — the store is a different repo`);
    assert.equal(dead.length, 1, `cost.${k} must be reported as dead`);
    assert.match(dead[0], new RegExp(`cost\\.${k}`));
    assert.match(dead[0], /DEAD AND UNREAD/);
    assert.match(dead[0], /BAND owns the/);
    assert.match(dead[0], /Delete the key/);
    assert.match(dead[0], new RegExp(JSON.stringify(val).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the value is quoted back, so the reader sees what they thought they set");
  }
  // A null or zero value is still the key being carried — hasOwnProperty, not truthiness.
  assert.equal(lintScenarios([{ ...LINTABLE, cost: { ...LINTABLE.cost, targetMinutes: 0 } }]).dead.length, 1);
  const clean = lintScenarios([LINTABLE]);
  assert.equal(clean.wrong.length, 0, "and a clean scenario passes");
  assert.equal(clean.dead.length, 0);
});

test("census: no scenario-carried benchmark read survives anywhere in the harness", () => {
  assert.equal(/cost\s*\?\.\s*target(Minutes|Band)/.test(E2E_SRC), false,
    "the two conditional reads at cmdList and cmdRun are what #523 deletes; a comment must not spell this form either");
  // The benchmark line is printed unconditionally, so it cannot be guarded back into existence.
  assert.equal(/if \(s\.cost.{0,20}target/.test(E2E_SRC), false, "a guard around the benchmark line is the defect");
});

// ── the CLI, end to end through a temp store ────────────────────────────────────────────────────────

/** A store laid out as the config repo lays it out, with the pool NESTED so the doors receipt that
 *  `run` writes at `<pool>/..` still lands inside the temp root. */
function makeBox(scenarios) {
  const root = mkdtempSync(join(tmpdir(), "e2e-band-"));
  mkdirSync(join(root, "store", "scenarios"), { recursive: true });
  mkdirSync(join(root, "store", "baselines"), { recursive: true });
  mkdirSync(join(root, "queue", "pool"), { recursive: true });
  for (const sc of scenarios) writeFileSync(join(root, "store", "scenarios", `${sc.id}.json`), JSON.stringify(sc, null, 2));
  return { root, store: join(root, "store"), pool: join(root, "queue", "pool") };
}

function cli(box, args) {
  // `--stale` on every paid command. `run` calls reportCommit({paid:true}), which refuses a clone that is
  // ahead of origin/main with exit 4 — and a feature branch always is, so without this these arms pass
  // only on a clone that happens to be level with main and fail for everyone else. The override is inert
  // beyond the refusal: it is read once inside reportCommit and touches no job field, dispatch or queue
  // write, so it cannot change what the arm measures.
  const argv = args[0] === "run" ? [...args, "--stale"] : args;
  const r = spawnSync("node", [E2E, ...argv], {
    encoding: "utf8",
    env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: box.store, CLEAROTRON_REPORTS_DIR: box.pool, CLEAROTRON_QUEUE_DIR: box.pool }),
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const NO_BENCHMARK_KEY = {
  id: "R6", title: "fixture — carries no benchmark key at all", why: ["fixture"], door: "cli",
  cost: { measured: true, wallMinutes: 1 },
  job: CLEARANCE_JOB, expect: { terminal: "delivered" },
};

test("`list` prints a benchmark line for a scenario carrying no benchmark key — no benchmark is not a pass", () => {
  const box = makeBox([NO_BENCHMARK_KEY]);
  try {
    const { code, out } = cli(box, ["list"]);
    assert.equal(code, 0, out);
    assert.match(out, /benchmark: 120 min \(clearance band/, out);
    assert.match(out, /turnaround-bands\.mjs/, "and says where the number came from");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("`run` prints the benchmark BEFORE it spends, for a scenario carrying no benchmark key", () => {
  const box = makeBox([NO_BENCHMARK_KEY]);
  try {
    const { code, out } = cli(box, ["run", "R6"]);
    assert.equal(code, 0, out);
    assert.match(out, /benchmark: 120 min \(clearance band/, out);
    // Before the enqueue, which is the only moment the figure can change a decision.
    assert.ok(out.indexOf("benchmark: 120 min") < out.indexOf("enqueue:"), out);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("`report` states the benchmark, this run's wall against it, and WHICH number it judged against", () => {
  // The wiring test. `printLedger` changed from returning an array to returning {investigate, notProbed}
  // and there is exactly one call site; a `.map(...)` left behind on the object yields nothing at all,
  // and the whole block disappears in silence. This drives the real command over a fabricated run dir.
  //
  // The figures are the shipped defect, restaged: band 120, engine quote 3h (180 min), wall 171 min.
  const box = makeBox([NO_BENCHMARK_KEY]);
  const runDir = join(box.root, "workspace", "2026-08-08-run");
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    ref: "E2E-C", runId: "2026-08-08-run", state: "delivered",
    startedAt: "2026-08-08T06:00:00.000Z", deliveredAt: "2026-08-08T08:51:00.000Z", updatedAt: "2026-08-08T08:51:00.000Z",
  }));
  writeFileSync(driverDir(runDir, "run.jsonl"),
    JSON.stringify({ event: "quote", turnaroundHours: 3 }) + "\n"
    + JSON.stringify({ event: "turnaround-reconciliation", state: "delivered", quotedHours: 3, actualHours: 2.86, ratio: 0.95 }) + "\n");
  try {
    const r = spawnSync("node", [E2E, "report", "R6"], {
      encoding: "utf8",
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: box.store, CLEAROTRON_REPORTS_DIR: box.pool, CLEAROTRON_QUEUE_DIR: box.pool,
             CLEAROTRON_WORK_DIR: join(box.root, "workspace") }),
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.match(out, /benchmark: 120 min \(clearance band/, out);
    assert.match(out, /actual 171 min → 51 min OVER the clearance band/, out);
    assert.match(out, /the engine quoted 3h \(180 min\)/, out);
    assert.match(out, /THE TWO DISAGREE.*judged against the BAND \(120 min\)/s, out);
    // The over-benchmark measurement reaches the reader's list, which is what makes it a finding rather
    // than a line in a wall of output. Exit 1 means "a human wants to look" on this CLI, never a verdict.
    assert.match(out, /51 min over/, out);
    assert.equal(r.status, 1, "a run over its band enters the investigate list");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("a store carrying the deleted keys still RUNS, and the dead keys are named on every invocation", () => {
  // REWRITTEN. This arm previously asserted the invocation exits 2 — and that is what shipped in the
  // first cut of this change. Run against the LIVE store it printed fourteen refusals and executed
  // nothing: all seven scenarios carry both keys, and the store is a different repo. A harness that
  // cannot run until another repo catches up is not stricter, it is broken.
  //
  // The contract is now: the key is neither obeyed nor passed over. The band's number is used, the
  // scenario's is named as dead with its value quoted, and the command proceeds.
  const box = makeBox([{ ...NO_BENCHMARK_KEY, cost: { ...NO_BENCHMARK_KEY.cost, targetMinutes: 240, targetBand: "full depth" } }]);
  try {
    for (const args of [["list"], ["run", "R6"]]) {
      const { code, out } = cli(box, args);
      assert.equal(code, 0, out);
      assert.match(out, /DEAD AND UNREAD/, out);
      assert.match(out, /cost\.targetMinutes = 240/, out);
      assert.match(out, /cost\.targetBand = "full depth"/, out);
      assert.match(out, /Delete the key/, out);
      assert.ok(!/benchmark: 240 min/.test(out), "the dead number never reaches a benchmark line");
    }
    // And the BAND's number is the one that got used.
    assert.match(cli(box, ["run", "R6"]).out, /benchmark: 120 min \(clearance band/);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});
