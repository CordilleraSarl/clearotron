// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the Knockout lane twice over one run folder on the mock engine
//
// A RESUMED KNOCKOUT ASKS NO OWNER CHECK IT ALREADY HOLDS.
//
// A Knockout searches the web for what the owner of each promoted filing sells. Every pass asked those checks again,
// a resume with nothing changed included: one research question per promoted owner, paid again for an answer the run
// already held. An owner check is paid for, and its answer does not change within the run, so a resume now reuses a
// held answer to the same question and asks only what the run holds no answer to.
//
// These arms count every question put to a stand-in research provider, separately from the register's questions.
// Nothing dials a register or the web: every executor is injected, and the engine is the mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-owner-check-reuse-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner, heldOwnerChecks } = await import("../pipeline-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");
const { knockoutBandPath } = await import("../knockout-register-read.mjs");
const { composeOwnerQuery, ownerPayloadFile } = await import("../owner-use-check.mjs");
const { KNOCKOUT_WEB } = await import("../stages-knockout.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const JOB = { markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"], forwarder: "jordan" };
const OWNER_QUESTION = /^What goods or services does the company "([^"]+)"/;

// The register's questions and the research provider's are counted apart: they are two bills.
const registerCalls = { list: 0, count: 0 };
const CANDLES = "Brightmoor sells candles. https://example.test/brightmoor";
const research = { sent: [], ownerFails: false, says: CANDLES };
const EXECUTORS = {
  recordLister: async (term) => { registerCalls.list++; return { ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }; },
  countExecutor: async () => { registerCalls.count++; return { ok: true, total: 3 }; },
  gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
  sweepExecutor: async (query) => {
    research.sent.push(String(query));
    if (research.ownerFails && OWNER_QUESTION.test(String(query))) return { ok: false, cause: "the provider did not answer" };
    return { ok: true, text: research.says };
  },
};
/** The owners named by the owner questions sent since the counter was last cleared. */
const ownersAsked = () => research.sent.map((q) => q.match(OWNER_QUESTION)?.[1]).filter(Boolean);

/** One pass of the Knockout lane over `dir`, archiving to `archiveDir`. */
async function pass(codename, dir, archiveDir) {
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-11-11", codename, archiveDir };
  const job = { ...structuredClone(JOB), id, msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, stateReset: true,
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const res = await knockoutInner(ctx, job, EXECUTORS);
  assert.equal(res?.ok, true, `the Knockout did not deliver: ${JSON.stringify(res)}`);
  return res;
}

const journal = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const ownerChecksOf = (runDir) => JSON.parse(readFileSync(driverDir(runDir, "owner-checks.json"), "utf8")).checks;

/**
 * A first pass to delivery, then a second over the same folder after `change` ran on it, as a resume does. The run is
 * kept in place: its archive path sits under a file, so the archive's move fails and, as it is non-fatal, the run stays.
 */
async function resumedAfter(codename, change = () => {}) {
  const studio = join(ROOT, "studio", `ko-${codename}`, "clearance-search");
  mkdirSync(studio, { recursive: true });
  const blocked = join(studio, "not-a-folder");
  writeFileSync(blocked, "the archive cannot be made under a file\n");
  const dir = join(studio, "runs", "lanternwick", `2026-11-11-${codename}`);
  research.sent.length = 0;
  await pass(codename, dir, join(blocked, "first"));
  assert.ok(readdirSync(dir).includes(".delivered"), "premise: the first pass delivered and stayed in place");
  for (const f of [".published", ".delivered"]) rmSync(join(dir, f), { force: true });
  const first = { owners: ownersAsked(), checks: ownerChecksOf(dir), bytes: readFileSync(driverDir(dir, "owner-checks.json"), "utf8") };
  assert.deepEqual(first.owners, ["Brightmoor Candle Co"], "premise: the first pass asked the one promoted owner");
  const before = journal(dir).length;
  change(dir);
  research.sent.length = 0;
  Object.assign(registerCalls, { list: 0, count: 0 });
  await pass(codename, dir, join(blocked, "second"));
  return { first, rows: journal(dir).slice(before), runDir: dir, research: [...research.sent], owners: ownersAsked(), register: { ...registerCalls } };
}
const ownerCheckRow = (rows) => rows.find((r) => r.event === "knockout-owner-checks");
const ran = (rows) => rows.filter((r) => r.event === "stage" && r.lane === "knockout").map((r) => r.stage);

test("a Knockout resumed with nothing changed asks the research provider nothing, and keeps the answer it holds", async () => {
  const { first, rows, runDir, research: sent, register } = await resumedAfter("unchanged");
  assert.deepEqual(sent, [], `the resume asked the research provider again: ${JSON.stringify(sent)}`);
  assert.equal(readFileSync(driverDir(runDir, "owner-checks.json"), "utf8"), first.bytes, "the held answer stands as it was written, its time and sources included");
  assert.deepEqual(ownerCheckRow(rows), { ...ownerCheckRow(rows), owners: 1, answered: 1, unanswered: 0, reused: 1, asked: 0 }, JSON.stringify(ownerCheckRow(rows)));
  assert.deepEqual(ran(rows), [], "with the answer unchanged, nothing is rated again");
  assert.deepEqual(register, { list: 0, count: 0 }, "and the register is asked nothing either, counted apart");
});

test("a resume whose owner lookup would now answer in other words asks nothing and rates nothing again", async (t) => {
  // A live answer is not the same bytes twice. Asked again, the owner's answer would come back in other words, its
  // file under research/ would change, and every rating that reads that folder would run again, the review with it.
  t.after(() => { research.says = CANDLES; });
  const { rows, owners } = await resumedAfter("other-words", () => { research.says = "Brightmoor makes candles and diffusers. https://example.test/brightmoor"; });
  assert.deepEqual({ ownerQuestions: owners.length, ratedAgain: ran(rows) }, { ownerQuestions: 0, ratedAgain: [] },
    "the resume bought the owner's answer again, and the new words re-rated the batch");
});

test("an owner check that did not answer is asked again on the resume, once, and its answer rates again", async (t) => {
  t.after(() => { research.ownerFails = false; });
  research.ownerFails = true;
  const { first, rows, owners } = await resumedAfter("unanswered", () => { research.ownerFails = false; });
  assert.equal(first.checks[0].ok, false, "premise: the first pass's owner check did not answer");
  assert.deepEqual(owners, ["Brightmoor Candle Co"], "the outstanding check is asked, once");
  assert.deepEqual(ownerCheckRow(rows), { ...ownerCheckRow(rows), owners: 1, answered: 1, unanswered: 0, reused: 0, asked: 1 }, JSON.stringify(ownerCheckRow(rows)));
  assert.ok(ran(rows).includes("knockout-assess#0"), "the rating reads the answer it did not have");
});

test("an owner check whose answer is no longer in the run is asked again", async () => {
  const { rows, runDir, owners } = await resumedAfter("payload-gone", (dir) => {
    const payload = join(dir, "research", ownerChecksOf(dir)[0].payloadFile);
    rmSync(payload);
  });
  assert.deepEqual(owners, ["Brightmoor Candle Co"], "a row without its answer is not an answer");
  assert.equal(ownerCheckRow(rows).asked, 1);
  assert.match(readFileSync(join(runDir, "research", ownerChecksOf(runDir)[0].payloadFile), "utf8"), /Brightmoor sells candles/, "and the answer is back beside its row");
});

test("a filing whose owner changed asks the new owner, and the old owner's answer is not carried over", async () => {
  const { rows, runDir, owners, register } = await resumedAfter("owner-changed", (dir) => {
    const band = knockoutBandPath(dir, "LANTERNWICK");
    const blocks = JSON.parse(readFileSync(band, "utf8"));
    const hit = blocks.flatMap((b) => b.records ?? []).find((r) => r.record_id === "tm_1");
    assert.ok(hit, "premise: the held register answer holds the filing");
    hit.owner_name = "Harbourlight Wax Ltd";
    writeFileSync(band, JSON.stringify(blocks, null, 2));
  });
  assert.deepEqual(owners, ["Harbourlight Wax Ltd"], "only the new owner is asked");
  assert.deepEqual(ownerChecksOf(runDir).map((c) => c.owner), ["Harbourlight Wax Ltd"], "no row of the old owner's stands for the new one");
  assert.equal(ownerCheckRow(rows).reused, 0);
  assert.deepEqual(register, { list: 0, count: 0 }, "the register is asked nothing: the change was in its held answer");
});

// ── WHICH HELD ROW ANSWERS WHICH OWED CHECK ──────────────────────────────────────────────────────────────────────────

const PRESET = KNOCKOUT_WEB.questionPreset;
const OWED = { mark: "LANTERNWICK", owner: "Brightmoor Candle Co", recordIds: ["tm_1", "tm_2"], classes: [4, 21] };
const OTHER = { mark: "LANTERNWICK", owner: "Harbourlight Wax Ltd", recordIds: ["tm_3"], classes: [4] };
const rowFor = (o, extra = {}) => ({ mark: o.mark, owner: o.owner, recordIds: o.recordIds, classes: o.classes, query: composeOwnerQuery(o),
  preset: PRESET, ok: true, source: "https://example.test/brightmoor", payloadFile: ownerPayloadFile(o), ts: "2026-11-11T08:00:00Z", took_ms: 900, ...extra });
function runWithAnswers(...owners) {
  const dir = mkdtempSync(join(ROOT, "held-"));
  mkdirSync(join(dir, "research"), { recursive: true });
  for (const o of owners) writeFileSync(join(dir, "research", ownerPayloadFile(o)), `${o.owner} sells candles. https://example.test/a\n`);
  return dir;
}

test("a held row answers the owed check only when it is the same question with its answer beside it", () => {
  const runDir = runWithAnswers(OWED);
  const same = heldOwnerChecks([rowFor(OWED)], [OWED], { runDir, preset: PRESET });
  assert.equal(same.held.get(0)?.ts, "2026-11-11T08:00:00Z", "the same question is answered by the held row, as it was written");
  assert.deepEqual(same.ask, []);
  // The filings in another order are the same filings.
  assert.deepEqual(heldOwnerChecks([rowFor(OWED, { recordIds: ["tm_2", "tm_1"], classes: [21, 4] })], [OWED], { runDir, preset: PRESET }).ask, []);
  const asks = (row, owed = OWED, preset = PRESET) => heldOwnerChecks([row], [owed], { runDir, preset }).ask.length;
  assert.equal(asks(rowFor(OWED, { ok: false, cause: "no result" })), 1, "a failed check is unfinished work");
  assert.equal(asks(rowFor(OWED, { owner: "Brightmoor Candles" })), 1, "another owner's answer is not this owner's");
  assert.equal(asks(rowFor(OWED, { mark: "LANTERNWICKE" })), 1, "nor another name's");
  assert.equal(asks(rowFor(OWED, { recordIds: ["tm_1"] })), 1, "a filing added under the owner is a new question");
  assert.equal(asks(rowFor(OWED, { recordIds: ["tm_1", "tm_9"] })), 1, "and so is a filing exchanged");
  assert.equal(asks(rowFor(OWED, { classes: [4] })), 1, "classes the question names are part of it");
  assert.equal(asks(rowFor(OWED, { query: `${composeOwnerQuery(OWED)} Also its parent.` })), 1, "a question in other words is another question");
  assert.equal(asks(rowFor(OWED), OWED, "fast-search"), 1, "a question asked at another depth is another question");
  assert.equal(asks(rowFor(OWED, { payloadFile: "owner-elsewhere.md" })), 1, "a row pointing at another answer's file is not this answer");
  assert.equal(heldOwnerChecks([], [OWED], { runDir, preset: PRESET }).ask.length, 1, "no row is no answer");
});

test("a row whose answer file is gone, empty or an error is no answer", () => {
  const runDir = runWithAnswers();
  const ask = () => heldOwnerChecks([rowFor(OWED)], [OWED], { runDir, preset: PRESET }).ask.length;
  assert.equal(ask(), 1, "gone");
  writeFileSync(join(runDir, "research", ownerPayloadFile(OWED)), "  \n");
  assert.equal(ask(), 1, "empty");
  writeFileSync(join(runDir, "research", ownerPayloadFile(OWED)), "ERROR: the formatter could not read the reply\n");
  assert.equal(ask(), 1, "an error");
  writeFileSync(join(runDir, "research", ownerPayloadFile(OWED)), "Brightmoor sells candles.\n");
  assert.equal(ask(), 0, "and with the answer back, nothing is asked");
});

test("of two owners, only the one without a held answer is asked, and each keeps its place", () => {
  const runDir = runWithAnswers(OWED, OTHER);
  const { held, ask } = heldOwnerChecks([rowFor(OTHER), rowFor(OWED, { ok: false, cause: "no result" })], [OWED, OTHER], { runDir, preset: PRESET });
  assert.deepEqual(ask, [OWED], "the failed check is asked");
  assert.deepEqual([...held.keys()], [1], "the held answer stands in the second owner's place");
  assert.equal(held.get(1).owner, "Harbourlight Wax Ltd");
});
