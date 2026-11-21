// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the Knockout lane once on the mock engine, then its stages on stand-in engines
//
// A KNOCKOUT STAGE THAT FAILS THROWS ITS OWN FAILURE, AND THE RATING IT WAS REPLACING CAN BE GOT BACK.
//
// The Knockout's stages run through the runner both lanes share (stage-runner.mjs). The runner returns a failure; the
// Knockout's boundary, `koStage`, must still throw the `StageFailure` it always threw. That failure carries the stage's
// label, the failure's reason and the provider's reset time, so a rate limit reaches the shared postponement and the
// stages after it do not run. Four arms, each on what a run is left holding:
//   - the failure a caller catches, for a rate limit with its reset time and for a turn that simply failed;
//   - a replacement that overwrote the chunk and then failed: the earlier rating is in the history, and no review round
//     begun on it is set aside, because the chunk was not rated again;
//   - the lane's freshness rule: a stage that declares its inputs and holds no record of them is stale, and a stage that
//     declares none keeps its validation rule alone, reused when valid and run again when not;
//   - a stage run through the lane with a table of its own, so the arm that declares no inputs is driven as a run drives it.
//
// The first pass runs on the mock engine; every later turn is a stand-in registered for this file, so nothing is
// billed and each turn does exactly what its arm needs. Every name is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-stage-failure-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
pinEnv(process.env, "CLEAROTRON_KNOCKOUT_MODEL", undefined);
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { registerEngine } = await import("../gateway.mjs");
const { StageFailure } = await import("../run-outcome.mjs");
const { writeFingerprint, readStamp } = await import("../stage-freshness.mjs");
const { runLaneStage } = await import("../stage-runner.mjs");
const { koPaths } = await import("../stages-knockout.mjs");
const { knockoutInner, koStage, koHeldOutput, koReadsNow, KNOCKOUT_LANE } = await import("../pipeline-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const CHUNK = "knockout-assess-0.json";
const RESETS_AT = 1795000000;

/** A stand-in engine for the turns `fn` dispatches, as the gateway tests register one. */
async function withEngine(name, runTurn, fn) {
  registerEngine({ name, runTurn });
  const saved = { CLEAROTRON_AI: process.env.CLEAROTRON_AI, CLEAROTRON_RETRY_BACKOFF_MS: process.env.CLEAROTRON_RETRY_BACKOFF_MS };
  process.env.CLEAROTRON_AI = name;
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const okTurn = () => ({ code: 0, killed: false, wall: 2, stdout: "ok", stderr: "", laneWaitMs: 0,
  json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "done" }] }, summary: "done" },
  usage: { input: 5, output: 9, cacheRead: 0, cacheWrite: 0, total: 14 }, sessionRef: "s-ok" });
const failTurn = (extra = {}) => ({ code: 1, killed: false, wall: 1, stdout: "", stderr: "boom", laneWaitMs: 0,
  json: null, usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, total: 4 }, sessionRef: "s-fail", ...extra });

const journal = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rejection = async (p) => { try { await p; } catch (e) { return e; } return null; };

/** One delivered Knockout, kept in place (its archive path sits under a file), with the context it ran on. */
async function delivered(codename) {
  const studio = join(ROOT, "studio", `ko-${codename}`, "clearance-search");
  mkdirSync(studio, { recursive: true });
  const blocked = join(studio, "not-a-folder");
  writeFileSync(blocked, "the archive cannot be made under a file\n");
  const dir = join(studio, "runs", "lanternwick", `2026-11-20-${codename}`);
  const id = `ko-${codename}`;
  const run = { runDir: dir, studioRoot: join(ROOT, "studio", id), slug: "lanternwick", date: "2026-11-20", codename, archiveDir: join(blocked, "archive") };
  const job = { id, markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, stateReset: true,
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const res = await knockoutInner(ctx, job, {
    recordLister: async (term) => ({ ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }),
    countExecutor: async () => ({ ok: true, total: 3 }),
    gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
    sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
  });
  assert.equal(res?.ok, true, `premise: the first pass delivered: ${JSON.stringify(res)}`);
  return { dir, ctx };
}
/** The rating's own dispatch, as the lane makes it for the batch's one chunk. */
const rate = (ctx) => koStage("knockout-assess", ctx, { chunkNo: 0, msgCtx: { chunkMarks: [{ name: "LANTERNWICK", degraded: null }],
  chunkTotal: 1, framework: ctx.framework, frameworkMethod: ctx.frameworkMethod ?? null } });
/** Takes away the rating's record of what it read, so the rating is stale and dispatches again. */
const forgetWhatTheRatingRead = (dir) => {
  const records = readdirSync(driverDir(dir, "stage-inputs")).filter((f) => f.startsWith("knockout-assess"));
  assert.ok(records.length, "premise: the first pass recorded what its rating read");
  for (const f of records) rmSync(driverDir(dir, "stage-inputs", f));
};

test("the Knockout's caller catches the same StageFailure: its stage, its reason and the provider's reset time", async () => {
  const { dir, ctx } = await delivered("caller-failure");
  forgetWhatTheRatingRead(dir);
  const limited = await withEngine("stand-in-rate-limited", async () => failTurn({ signals: { rateLimited: true, resetsAt: RESETS_AT } }), () => rejection(rate(ctx)));
  assert.ok(limited instanceof StageFailure, `the caller caught something else: ${limited?.stack ?? limited}`);
  assert.equal(limited.stage, "knockout-assess#0", "the failure names the stage and its chunk");
  assert.equal(limited.reason, "rate_limited");
  assert.equal(limited.rateLimited, true, "a rate limit still reaches the shared postponement as one");
  assert.equal(limited.resetsAt, RESETS_AT, "the provider's reset time reaches the caller");

  const failed = await withEngine("stand-in-failure", async () => failTurn(), () => rejection(rate(ctx)));
  assert.ok(failed instanceof StageFailure);
  assert.equal(failed.stage, "knockout-assess#0");
  const row = journal(dir).filter((r) => r.event === "stage" && r.stage === "knockout-assess#0").at(-1);
  assert.equal(row.ok, false);
  assert.equal(failed.reason, row.fail, "the caller is told the reason the stage row records");
  assert.equal(failed.rateLimited, false);
  assert.equal(failed.resetsAt, undefined, "no reset time is invented for a failure that named none");
});

test("a replacement that overwrote the chunk and then failed leaves the earlier rating recoverable, and sets no review aside", async () => {
  const { dir, ctx } = await delivered("torn-replacement");
  const before = readFileSync(join(dir, CHUNK), "utf8");
  forgetWhatTheRatingRead(dir);
  ctx.koRated = new Set();   // what this pass has rated again; the first pass's own rating is not this pass's
  const failed = await withEngine("stand-in-overwrites-then-fails", async () => { writeFileSync(join(dir, CHUNK), "{ the replacement was cut off"); return failTurn(); },
    () => rejection(rate(ctx)));
  assert.ok(failed instanceof StageFailure, `premise: the replacement failed: ${failed}`);
  assert.ok(!existsSync(join(dir, CHUNK)) || readFileSync(join(dir, CHUNK), "utf8") !== before, "premise: the replacement overwrote the rating before it failed");
  const snap = journal(dir).filter((r) => r.event === "output-snapshot" && r.stage === "knockout-assess#0").at(-1);
  assert.ok(snap, "nothing was kept before the replacement was dispatched");
  const kept = join(dir, "_history", snap.snapshot, CHUNK);
  assert.equal(readFileSync(kept, "utf8"), before, "the earlier rating is recoverable from the history");
  assert.equal(ctx.koRated.has(0), false, "a chunk whose new rating failed was not rated again, so no review round begun on it is obsolete");
  assert.equal(readStamp(dir, "knockout-assess#0"), null, "a failed rating records no inputs it was based on");

  // Put back from the history, and rated again on the mock engine: only now is the chunk rated again.
  copyFileSync(kept, join(dir, CHUNK));
  const r = await rate(ctx);
  assert.equal(r.ok, true, "premise: the rating ran again and succeeded");
  assert.equal(ctx.koRated.has(0), true, "a chunk rated again successfully makes a review round begun on its old rating obsolete");
  assert.ok(readStamp(dir, "knockout-assess#0"), "a successful rating records what it read");
});

// ── THE LANE'S FRESHNESS RULE ──────────────────────────────────────────────────────────────────────────────────────
const validJson = (_p, text) => { try { return JSON.parse(text)?.ok === true ? { ok: true } : { ok: false, reason: "probe_not_ok" }; } catch { return { ok: false, reason: "probe_unparseable" }; } };
const probeDef = (extra = {}) => ({ model: "opus", thinking: "high", timeoutSec: 60, stallSec: 30,
  out: (K) => join(K.runDir, "probe.json"), validate: validJson, message: () => "Write the probe.", ...extra });
const DECLARES = probeDef({ reads: (K) => ({ files: [join(K.runDir, "probe-input.txt")] }) });
const DECLARES_NONE = probeDef();

function probeRun(name) {
  const dir = join(mkdtempSync(join(ROOT, `${name}-`)), "run");
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "probe-input.txt"), "what the stage read\n");
  const K = koPaths(dir);
  const ctx = { K, agent: "mailagent", paths: { runDir: dir }, run: { runDir: dir, studioRoot: dirname(dir), slug: "probe", codename: name } };
  return { dir, K, ctx, out: join(dir, "probe.json") };
}

test("a stage that declares its inputs and holds no record of them is stale; one that declares none keeps its validation rule", () => {
  const { dir, K, out } = probeRun("freshness-rule");
  writeFileSync(out, JSON.stringify({ ok: true }));
  const now = koReadsNow(DECLARES, K, "probe", "Write the probe.");
  assert.ok(Array.isArray(now) && now.length, "premise: the declaring stage fingerprints what it read");
  assert.deepEqual(koHeldOutput(DECLARES, out, dir, "probe", now),
    { held: true, valid: true, stale: true, reason: "no record of the inputs it was produced from", changed: [] },
    "a valid output whose inputs were declared and not recorded is stale: what it was based on is unknown");
  writeFingerprint(dir, "probe", now);
  assert.equal(koHeldOutput(DECLARES, out, dir, "probe", now).stale, false, "with its record, and nothing changed, it stands");
  writeFileSync(join(dir, "probe-input.txt"), "what the stage read, changed\n");
  const moved = koHeldOutput(DECLARES, out, dir, "probe", koReadsNow(DECLARES, K, "probe", "Write the probe."));
  assert.equal(moved.stale, true);
  assert.ok(moved.changed.some((c) => c.name === "probe-input.txt"), `a changed input is named: ${JSON.stringify(moved)}`);

  const none = koReadsNow(DECLARES_NONE, K, "bare", "Write the probe.");
  assert.equal(none, null, "premise: the other stage declares nothing it read");
  assert.deepEqual(koHeldOutput(DECLARES_NONE, out, dir, "bare", none), { held: true, valid: true, stale: false, changed: [] },
    "a valid output of a stage that declares nothing is reused with no record at all");
  writeFileSync(out, "not the probe");
  assert.deepEqual(koHeldOutput(DECLARES_NONE, out, dir, "bare", none), { held: true, valid: false, stale: true, reason: "probe_unparseable", changed: [] },
    "an invalid one is stale, named by its validator");
  rmSync(out);
  assert.deepEqual(koHeldOutput(DECLARES_NONE, out, dir, "bare", none), { held: false, valid: false, stale: false, changed: [] });
});

test("through the lane: a valid output of a stage that declares nothing is reused with nothing copied; an invalid one is kept and run again", async () => {
  const { dir, ctx, out } = probeRun("lane-table");
  const lane = { ...KNOCKOUT_LANE, stages: { "probe-stage": DECLARES_NONE, "probe-declared": DECLARES } };
  let turns = 0;
  const writesTheProbe = async () => { turns++; writeFileSync(out, JSON.stringify({ ok: true, turn: turns })); return okTurn(); };
  writeFileSync(out, JSON.stringify({ ok: true, turn: 0 }));

  const reused = await withEngine("stand-in-probe-a", writesTheProbe, () => runLaneStage(lane, "probe-stage", ctx));
  assert.deepEqual(reused, { ok: true, skipped: true });
  assert.equal(turns, 0, "a valid output of a stage that declares nothing was dispatched again");
  assert.ok(!existsSync(join(dir, "_history")), "a valid reuse copied its output aside");
  const skip = journal(dir).find((r) => r.event === "skip" && r.stage === "probe-stage");
  assert.equal(skip?.lane, "knockout");
  assert.equal(skip?.chunk, null);

  writeFileSync(out, "a torn probe");
  const rerun = await withEngine("stand-in-probe-b", writesTheProbe, () => runLaneStage(lane, "probe-stage", ctx));
  assert.equal(rerun.ok, true);
  assert.equal(turns, 1, "an invalid output was not run again");
  const rows = journal(dir);
  assert.equal(rows.find((r) => r.event === "stage-stale" && r.stage === "probe-stage")?.reason, "probe_unparseable");
  const snap = rows.find((r) => r.event === "output-snapshot" && r.stage === "probe-stage");
  assert.equal(readFileSync(join(dir, "_history", snap.snapshot, "probe.json"), "utf8"), "a torn probe", "the output it replaced is kept");
  const row = rows.find((r) => r.event === "stage" && r.stage === "probe-stage");
  assert.deepEqual([row.ok, row.lane, row.chunk, row.summary, row.inputs], [true, "knockout", null, "done", []],
    "a stage that declares nothing names no inputs, and its row says what the turn reported");
  assert.equal(readStamp(dir, "probe-stage"), null, "a stage that declares nothing records no inputs");

  // The declaring stage, over the same valid output and no record of what it read, is run again rather than reused.
  const declared = await withEngine("stand-in-probe-c", writesTheProbe, () => runLaneStage(lane, "probe-declared", ctx));
  assert.equal(declared.ok, true);
  assert.equal(turns, 2, "a valid output with declared inputs and no record of them was reused");
  assert.equal(journal(dir).find((r) => r.event === "stage-stale" && r.stage === "probe-declared")?.reason, "no record of the inputs it was produced from");
  assert.ok(readStamp(dir, "probe-declared"), "and it records what it read this time");
});
