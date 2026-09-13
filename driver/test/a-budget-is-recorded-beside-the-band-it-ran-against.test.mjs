// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A stage's wall is a number somebody set against one crowded matter. This pins that the band it ran
// against is recorded beside it, and that the set of stages the field is recorded for is DERIVED from
// which stages actually read the band rather than maintained by hand in two places.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { STAGES, BAND_READING_STAGES } from "../stages.mjs";
import { bandSizeAtDispatch, bandSizeForStage } from "../band-size.mjs";
import { runStage, registerEngine } from "../gateway.mjs";

// THE SET IS DERIVED FROM THE STAGE'S OWN FUNCTION SOURCE, not from a line number and not from the
// rendered prose. `String(def.message)` contains the identifier `BAND_READING_CONTRACT` wherever a
// stage's dispatch references the contract, so this survives reordering the table, renaming a stage and
// rewording the contract itself. It would NOT survive someone inlining the contract's text instead of
// referencing the constant — which is why the floor below exists: if that happened the derived set
// would shrink, and a shrunken set must fail rather than quietly agree with a shrunken declaration.
const derivedBandStages = () => new Set(
  Object.entries(STAGES)
    .filter(([, def]) => typeof def?.message === "function" && String(def.message).includes("BAND_READING_CONTRACT"))
    .map(([name]) => name));

test("the declared band-reading stages are exactly the stages whose dispatch reads the band", () => {
  const derived = derivedBandStages();
  // A FLOOR ON THE POPULATION, not just a pattern: a derivation that matched nothing would otherwise
  // agree with an empty declaration and both would look correct.
  assert.ok(derived.size >= 3,
    `only ${derived.size} stage(s) derived as band-reading — the derivation is broken, not the table`);
  // MEMBERS, never counts: two sets of the same size can disagree about which stages they hold, and
  // that is exactly the failure a total hides.
  assert.deepEqual([...BAND_READING_STAGES].sort(), [...derived].sort());
});

test("a stage that never reads the band is not in the set", () => {
  // The other direction of the same claim: the set is not simply every stage.
  assert.ok(!BAND_READING_STAGES.has("matter-frame"));
  assert.ok(BAND_READING_STAGES.size < Object.keys(STAGES).length);
});

const withRun = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "band-size-"));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("band size is a measurement when the band and its shape are both on disk", () => {
  withRun((dir) => {
    const band = join(dir, "register-named-band.json");
    const shape = join(dir, "band-shape.json");
    writeFileSync(band, JSON.stringify({ enumerated: [{ a: 1 }, { a: 2 }] }));
    writeFileSync(shape, JSON.stringify({ totals: { records: 6668, crowds: 12, by_tier: {} } }));
    const got = bandSizeAtDispatch({ bandShape: shape, registerNamedBand: band });
    assert.equal(got.records, 6668);
    assert.equal(got.crowds, 12);
    assert.ok(got.bytes > 0, "bytes come from the band's own file, not from the shape");
    assert.equal(got.absent, undefined);
  });
});

test("every absence is NAMED, and none of them reads as a band of zero records", () => {
  withRun((dir) => {
    const band = join(dir, "register-named-band.json");
    const shape = join(dir, "band-shape.json");
    // 1. no band at all — the register-only / no-Nice-classes / pre-shape-replay case
    let got = bandSizeAtDispatch({ bandShape: shape, registerNamedBand: band });
    assert.match(got.absent, /no merged register band/);
    assert.equal(got.records, undefined, "an absent band must never report a record count");
    // 2. a band, but its shape not derived yet — the bytes are still a measurement
    writeFileSync(band, JSON.stringify({ enumerated: [] }));
    got = bandSizeAtDispatch({ bandShape: shape, registerNamedBand: band });
    assert.match(got.absent, /no band shape derived/);
    assert.ok(got.bytes > 0, "the band's size is knowable even before its shape is");
    assert.equal(got.records, undefined);
    // 3. a shape that will not parse
    writeFileSync(shape, "{not json");
    got = bandSizeAtDispatch({ bandShape: shape, registerNamedBand: band });
    assert.match(got.absent, /unreadable/);
    assert.equal(got.records, undefined);
    // 4. a shape that parses but carries no totals — not a measurement of anything
    writeFileSync(shape, JSON.stringify({ role: "a shape from before totals existed" }));
    got = bandSizeAtDispatch({ bandShape: shape, registerNamedBand: band });
    assert.match(got.absent, /no totals/);
    assert.equal(got.records, undefined);
  });
});

test("no run paths is its own named absence, not a crash", () => {
  assert.match(bandSizeAtDispatch(undefined).absent, /no run paths/);
  assert.match(bandSizeAtDispatch({}).absent, /no run paths/);
});

test("a band that cannot be stat'ed names the error code rather than reporting a size", () => {
  const got = bandSizeAtDispatch(
    { bandShape: "/nowhere/shape.json", registerNamedBand: "/nowhere/band.json" },
    { exists: () => true, stat: () => { const e = new Error("nope"); e.code = "EACCES"; throw e; } });
  assert.match(got.absent, /unstatable \(EACCES\)/);
  assert.equal(got.bytes, undefined);
});

// THE ARM A PLANT PROVED MISSING. Disabling the dispatch's measurement entirely left every other arm
// green, because the wiring arms below hand `runStage` a size directly and so never reach the site that
// computes one. The decision now lives in a function, and this is that function's test.
test("only a band-reading stage gets a band size, and a stage outside the set gets no field at all", () => {
  withRun((dir) => {
    const band = join(dir, "register-named-band.json");
    const shape = join(dir, "band-shape.json");
    writeFileSync(band, JSON.stringify({ enumerated: [{ a: 1 }] }));
    writeFileSync(shape, JSON.stringify({ totals: { records: 41, crowds: 2, by_tier: {} } }));
    const paths = { bandShape: shape, registerNamedBand: band };
    for (const stage of BAND_READING_STAGES) {
      assert.equal(bandSizeForStage(stage, paths).records, 41, `${stage} reads the band and must be measured`);
    }
    // NOT a named absence: "this stage does not read the band" is not a fact about the band, and a
    // reason here would put a band story on a row that has nothing to do with one.
    assert.equal(bandSizeForStage("matter-frame", paths), undefined);
    assert.equal(bandSizeForStage("report-card", paths), undefined);
    // the io seam still reaches through the decision
    const got = bandSizeForStage([...BAND_READING_STAGES][0], paths,
      { exists: () => true, stat: () => { const e = new Error("no"); e.code = "EIO"; throw e; } });
    assert.match(got.absent, /unstatable \(EIO\)/);
  });
});

// ── THE WIRING, DRIVEN RATHER THAN MATCHED ────────────────────────────────────────────────────────
//
// The two arms above prove the helper measures and the set is right. Neither proves the number REACHES
// the row — and it travels through a destructure in runStageLadder that silently drops any option it
// does not name, which is exactly the failure a source-text assertion would miss after a rename. So
// this drives the real gateway with a fake engine and reads the journal it wrote. One call site, so
// every stage is covered by construction.
async function withEngine(name, runTurn, fn) {
  registerEngine({ name, runTurn });
  const saved = { CLEAROTRON_AI: process.env.CLEAROTRON_AI, CLEAROTRON_RETRY_BACKOFF_MS: process.env.CLEAROTRON_RETRY_BACKOFF_MS };
  process.env.CLEAROTRON_AI = name;
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const okTurn = () => ({
  code: 0, killed: false, wall: 3, stdout: "", stderr: "", laneWaitMs: 0,
  json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "done" }] }, summary: "ok" },
  usage: { input: 10, output: 300, cacheRead: 0, cacheWrite: 0, total: 310 }, sessionRef: "s-band",
});

const driveStage = async (label, extra) => {
  const dir = mkdtempSync(join(tmpdir(), "band-row-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    await withEngine(`fake-band-${label}`, async () => { writeFileSync(out, "# done\n"); return okTurn(); },
      () => runStage("teststage", {
        agent: "clawdi", sessionKey: `clearotron-test-band-${label}`, message: "do it",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
        validate: () => ({ ok: true }), runDir: dir, maxRetries: 1, ...extra,
      }));
    return readFileSync(driverDir(dir, "teststage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("the measured band reaches the attempt row, beside the wall it explains", async () => {
  const rows = await driveStage("measured", { bandSize: { records: 6668, crowds: 12, bytes: 185542612 } });
  const row = rows.at(-1);
  assert.deepEqual(row.band, { records: 6668, crowds: 12, bytes: 185542612 });
  // The point of recording it: the wall and its denominator are on the SAME row, so nobody has to
  // reconstruct the band from an archived run to ask whether the budget suited it.
  assert.ok(Number.isFinite(row.wall), "the wall is on the row the band is on");
});

test("a named absence reaches the row as a reason, and a stage with no band carries no key at all", async () => {
  const named = (await driveStage("absent", { bandSize: { absent: "no merged register band on disk" } })).at(-1);
  assert.equal(named.band.absent, "no merged register band on disk");
  assert.equal(named.band.records, undefined, "an absence must never arrive with a record count");
  // A stage that does not read the band is dispatched without the option, and the row must then be
  // SILENT rather than carrying null — a null would read as "measured, and it was nothing".
  const none = (await driveStage("unset", {})).at(-1);
  assert.ok(!("band" in none), `a non-band stage's row carries a band key: ${JSON.stringify(none.band)}`);
});
