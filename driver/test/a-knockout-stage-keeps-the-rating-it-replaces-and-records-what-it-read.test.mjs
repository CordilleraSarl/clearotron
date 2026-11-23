// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the Knockout lane over one run folder, twice, on the mock engine
//
// A KNOCKOUT STAGE KEEPS THE RATING IT REPLACES, AND ITS ROW SAYS WHAT IT READ, AS A CLEARANCE STAGE'S DOES.
//
// Both lanes now run each stage through one runner (stage-runner.mjs). Two things the Knockout lacked came with it. A
// chunk rated again over an earlier rating overwrote it with nothing kept, so a replacement that then failed left the
// run without the rating it had. And its stage row named neither the inputs the turn was offered nor what the turn
// reported, so a Knockout row could not be read the way a clearance row is. This drives the lane as a run does: a first
// pass to delivery, then a second pass over the same folder, as a resume runs. It reads what the folder and its journal
// hold, through the lane's own entry point only. The same arms also hold what the shared runner must not change: a
// valid output is reused with nothing copied; a failure stops the stages after it; a stop is not swallowed; and the
// lane keeps its own model and its own time limits.
//
// Nothing dials a register or the web: every executor is injected, and the engine is the mock. Every name is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-stage-runner-"));
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
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { KO_STAGES } = await import("../stages-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const JOB = { markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"], forwarder: "jordan" };
const EXECUTORS = {
  recordLister: async (term) => ({ ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }),
  countExecutor: async () => ({ ok: true, total: 3 }),
  gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
  sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
};
/** A phrase only the rating turn carries (stages-knockout.mjs, "knockout-assess"). */
const RATING_TURN = "You are rating one name for a Knockout screen.";
const CHUNK = "knockout-assess-0.json";

async function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

/** One pass of the lane over `dir`; what it returned or threw. */
async function pass(codename, dir, archiveDir) {
  const id = `ko-${codename}`;
  const run = { runDir: dir, studioRoot: join(ROOT, "studio", id), slug: "lanternwick", date: "2026-11-20", codename, archiveDir };
  const job = { ...structuredClone(JOB), id, msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, stateReset: true,
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  try { return { res: await knockoutInner(ctx, job, EXECUTORS), thrown: null }; }
  catch (e) { return { res: null, thrown: e }; }
}

const journal = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const stageRows = (rows) => rows.filter((r) => r.event === "stage" && r.lane === "knockout");
const historyOf = (runDir) => (existsSync(join(runDir, "_history")) ? readdirSync(join(runDir, "_history")) : []);

/**
 * A first pass to delivery, kept in place (its archive path sits under a file, so the move fails and, as it is
 * non-fatal, the run stays), then a second pass over the same folder after `change`, under `env`. Returns the first
 * pass's rows, the second pass's rows, the chunk's bytes as the first pass left them, and the second pass's outcome.
 */
async function resumedAfter(codename, change = () => {}, env = {}) {
  const studio = join(ROOT, "studio", `ko-${codename}`, "clearance-search");
  mkdirSync(studio, { recursive: true });
  const blocked = join(studio, "not-a-folder");
  writeFileSync(blocked, "the archive cannot be made under a file\n");
  const dir = join(studio, "runs", "lanternwick", `2026-11-20-${codename}`);
  const first = await pass(codename, dir, join(blocked, "first"));
  assert.equal(first.res?.ok, true, `premise: the first pass delivered: ${first.thrown?.message ?? JSON.stringify(first.res)}`);
  for (const f of [".published", ".delivered"]) rmSync(join(dir, f), { force: true });
  const firstRows = journal(dir);
  const ratedBefore = readFileSync(join(dir, CHUNK), "utf8");
  change(dir);
  const second = await withEnv(env, () => pass(codename, dir, join(blocked, "second")));
  return { dir, firstRows, rows: journal(dir).slice(firstRows.length), ratedBefore, second };
}
const planMoved = (dir) => {
  const plan = JSON.parse(readFileSync(join(dir, "knockout-plan.json"), "utf8"));
  plan.marks[0].contextFraming = `${plan.marks[0].contextFraming ?? ""} Also sold as a gift set.`.trim();
  writeFileSync(join(dir, "knockout-plan.json"), JSON.stringify(plan, null, 2) + "\n");
};

test("each Knockout stage row names the inputs it was offered, what the turn reported, its lane, chunk, elapsed time and model", async () => {
  const { firstRows } = await resumedAfter("journal");
  const rows = stageRows(firstRows);
  assert.ok(rows.length >= 3, `premise: the first pass ran the frame, the rating and the review: ${rows.map((r) => r.stage)}`);
  for (const r of rows) {
    assert.equal(r.ok, true, `premise: ${r.stage} succeeded`);
    assert.ok(Array.isArray(r.inputs), `${r.stage} names no inputs: ${JSON.stringify(r)}`);
    assert.equal(typeof r.summary, "string", `${r.stage} carries no summary of what its turn reported: ${JSON.stringify(r.summary)}`);
    assert.ok(Object.hasOwn(r, "chunk"), `${r.stage} carries no chunk identity`);
    assert.equal(r.chunk, /#(\d+)$/.test(r.stage) ? Number(r.stage.match(/#(\d+)$/)[1]) : null, `${r.stage}'s chunk is not the one its label names`);
    assert.ok(Number.isFinite(r.wallSec) && r.wallSec >= 0 && r.dispatchedAt && r.settledAt, `${r.stage} carries no elapsed time`);
    assert.ok(typeof r.model === "string" && r.model, `${r.stage} names no model that ran`);
    assert.equal(r.modelSelector, KO_STAGES[r.stage.replace(/#\d+$/, "")].model, `${r.stage} names another model than the one assigned`);
    assert.equal(r.followup, false);
  }
  const rating = rows.find((r) => r.stage === "knockout-assess#0");
  assert.equal(rating?.chunk, 0);
  const plan = rating.inputs.find((i) => i.name === "knockout-plan.json");
  assert.ok(plan?.sha && Object.hasOwn(plan, "read"), `the rating's row does not name the plan it was offered: ${JSON.stringify(rating.inputs)}`);
  assert.ok(rating.inputs.some((i) => /^lanternwick/.test(i.name)), `the rating's row does not name the research it was offered: ${rating.inputs.map((i) => i.name)}`);
  assert.ok(!rating.inputs.some((i) => String(i.name).startsWith("value:") || i.name === "message"), "only files are named as inputs, never the message");
});

test("a resumed Knockout reuses each valid output with nothing copied aside, and its reuse rows are told apart from a success", async () => {
  const { dir, rows } = await resumedAfter("unchanged");
  assert.deepEqual(stageRows(rows), [], `a stage ran again with nothing changed: ${JSON.stringify(rows.filter((r) => r.event === "stage-stale"))}`);
  const skips = rows.filter((r) => r.event === "skip" && r.lane === "knockout");
  const rating = skips.find((r) => r.stage === "knockout-assess#0");
  assert.ok(rating, `premise: the rating was reused: ${skips.map((r) => r.stage)}`);
  assert.equal(rating.trigger, "skip");
  assert.equal(rating.ok, true);
  assert.equal(rating.chunk, 0, "a reuse row names its chunk, as the row of the run that made it does");
  assert.equal(rating.output?.present, true);
  assert.deepEqual(rows.filter((r) => r.event === "output-snapshot"), [], "a valid reuse copied an output aside");
  assert.deepEqual(historyOf(dir), [], "a valid reuse left a copy in _history");
});

test("a rating made stale by its plan runs again, and the rating it replaces is kept under its stage and chunk", async () => {
  const { dir, rows, ratedBefore } = await resumedAfter("plan-moved", planMoved);
  const stale = rows.find((r) => r.event === "stage-stale" && r.stage === "knockout-assess#0");
  assert.ok(stale?.changed?.some((c) => c.name === "knockout-plan.json"), `the stale row names the plan: ${JSON.stringify(stale)}`);
  const snap = rows.find((r) => r.event === "output-snapshot" && r.stage === "knockout-assess#0");
  assert.ok(snap, `the rating was overwritten with nothing kept: ${JSON.stringify(rows.map((r) => [r.event, r.stage]))}`);
  assert.equal(snap.chunk, 0);
  assert.match(snap.snapshot, /knockout-assess-0$/, "the folder names the stage and chunk it holds");
  assert.equal(readFileSync(join(dir, "_history", snap.snapshot, CHUNK), "utf8"), ratedBefore, "the copy is the rating as it stood");
  assert.ok(existsSync(join(dir, "_history", snap.snapshot, "knockout-assess#0.jsonl")), "the rating's attempt journal is kept beside it");
  const rerun = stageRows(rows).find((r) => r.stage === "knockout-assess#0");
  assert.equal(rerun?.ok, true, "the rating ran again");
  assert.ok(!rows.some((r) => r.event === "output-snapshot" && r.stage === "knockout-frame"), "the frame read none of the plan, and is reused with nothing copied");
});

test("a replacement rating that fails leaves the earlier rating in the history, stops the stages after it, and its row is told apart", async () => {
  const { dir, rows, ratedBefore, second } = await resumedAfter("replacement-failed", planMoved, { MOCK_FAIL_STAGE: RATING_TURN });
  assert.notEqual(second.res?.ok, true, "premise: the resumed pass did not deliver");
  const snap = rows.find((r) => r.event === "output-snapshot" && r.stage === "knockout-assess#0");
  assert.ok(snap, "nothing was kept before the replacement was dispatched");
  assert.equal(readFileSync(join(dir, "_history", snap.snapshot, CHUNK), "utf8"), ratedBefore, "the earlier rating is recoverable from the history");
  const failed = stageRows(rows).find((r) => r.stage === "knockout-assess#0");
  assert.equal(failed?.ok, false, `premise: the replacement failed: ${JSON.stringify(failed)}`);
  assert.ok(failed.fail, "a failed row names its failure");
  assert.equal(failed.summary, null, "a failed row reports no summary that could read as a success");
  assert.equal(failed.chunk, 0);
  assert.ok(Array.isArray(failed.inputs) && failed.inputs.length, "a failed row still names what it was offered");
  assert.ok(!stageRows(rows).some((r) => /^knockout-(review|correct)/.test(r.stage)), `a stage ran after the failure: ${stageRows(rows).map((r) => r.stage)}`);
  assert.ok(!rows.some((r) => r.event === "skip" && /^knockout-review/.test(r.stage)), "the review was reached after the failure");
});

test("a stop recorded while the review runs: no correction runs after it, and the run ends cancelled", async () => {
  const studio = join(ROOT, "studio", "ko-stopped", "clearance-search");
  const dir = join(studio, "runs", "lanternwick", "2026-11-20-stopped");
  mkdirSync(driverDir(dir), { recursive: true });
  const defect = { kind: "contradiction", mark: "LANTERNWICK", finding: 1, problem: "The first conflict is rated below what its own evidence shows." };
  const { res } = await withEnv({ MOCK_KO_REVIEW_STOP: "1", MOCK_KO_MATERIAL: JSON.stringify([defect]), MOCK_KO_CORRECTED_BAND: "High" },
    () => pass("stopped", dir, join(studio, "archive", "2026-11-20-stopped")));
  assert.notEqual(res?.ok, true, "the Knockout delivered after its stop");
  assert.ok(existsSync(join(dir, ".cancel")), "premise: the review recorded the stop while it ran");
  const ran = stageRows(journal(dir)).map((r) => r.stage);
  assert.ok(ran.includes("knockout-review"), `premise: the review ran: ${ran}`);
  for (const after of ["knockout-correct#0"]) assert.ok(!ran.includes(after), `${after} ran after the stop: ${ran}`);
  assert.equal(JSON.parse(readFileSync(join(dir, "status.json"), "utf8")).state, "cancelled");
});

test("a Knockout stage keeps its own model override and its own time limits; the clearance's band-derived limit is not applied", async () => {
  const studio = join(ROOT, "studio", "ko-own-limits", "clearance-search");
  const dir = join(studio, "runs", "lanternwick", "2026-11-20-own-limits");
  mkdirSync(driverDir(dir), { recursive: true });
  const archived = join(studio, "archive", "2026-11-20-own-limits");
  const { res } = await withEnv({ CLEAROTRON_KNOCKOUT_MODEL: "sonnet" }, () => pass("own-limits", dir, archived));
  assert.equal(res?.ok, true, `premise: the Knockout delivered: ${JSON.stringify(res)}`);
  const runDir = existsSync(dir) ? dir : archived;   // a delivered run is moved to its archive
  const rows = journal(runDir);
  const ran = stageRows(rows);
  assert.ok(ran.length >= 3);
  for (const r of ran) assert.equal(r.modelSelector, "sonnet", `${r.stage} did not run on the override`);
  assert.deepEqual(rows.filter((r) => /^stage-(limit-derived|input-over-ceiling)$/.test(r.event)), [], "a clearance limit was derived for a Knockout stage");
  for (const r of ran) {
    const attempts = readFileSync(driverDir(runDir, `${r.stage}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const name = r.stage.replace(/#\d+$/, "");
    assert.equal(attempts[0].timeoutSec, KO_STAGES[name].timeoutSec, `${r.stage} ran under another time limit than its own`);
    assert.equal(attempts[0].derivedLimitSec, undefined, `${r.stage} carries a limit derived from a band`);
  }
});
