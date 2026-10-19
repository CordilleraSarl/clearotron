// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline through a park and a resume on both engines, beside a direct test of the merge
//
// A RECORD A UNIT'S RE-RUN FINDS REACHES THE NAMED BAND.
//
// After the band's first merge, a register unit can be re-run in its own session: for the cross-check's questions, a
// frame-reopen sweep, the skeptic's escalation, or the envelope close. A narrow sub-query adds blocks to its axis band,
// and placement, the reading step and the writer read the named band. Only the code-side recheck merged again, so the
// records those re-runs found reached none of them. Now the named band is merged again whenever an axis band moved since
// the last merge, whatever the unit's notes did, and a moved band counts as a change for the reading step. Own file =
// own process + own workspace root; the workspace and the call ledger are pinned before any driver module loads, so
// driver modules are imported dynamically. Every mark and owner is invented.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-remerge-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const ADDED = "/mark/us/90000077";   // the record mockUnitBandWrite adds on a warm re-run of MOCK_ESCALATION_ADDS_FLOOR's axis
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };

// ── the merge itself: a band that moved is merged again, whatever the unit's notes did ──
test("an axis band that moves while the unit's notes stand is merged again into the named band, and one that did not move is not", async (t) => {
  const { deriveNamedBand, remergeIfBandsMoved } = await import("../pipeline.mjs");
  const { paths } = await import("../stages.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "remerge-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  const rec = (id, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: "QZORVAK", classes: [9], status: "Registered", owner_name: owner,
    owner_country: "DE", screen_verdict: "surface:in-scope-live" });
  const block = (n, records) => ({ state: "enumerated", qid: `supp:primary-sweep:t:${n}`, query: "primary-sweep / exact-in-class-live", total_hits: records.length, records });
  mkdirSync(dirname(P.registerBand("primary-sweep")), { recursive: true });
  writeFileSync(P.registerBand("primary-sweep"), JSON.stringify([block(1, [rec("a1", "Alpha Ltd")])]));
  writeFileSync(P.registerUnit("primary-sweep"), "# primary-sweep\n\nThe unit's notes, which the re-run leaves as they are.\n");
  const ctx = { paths: P, axes: ["primary-sweep"], job: { markName: "QZORVAK", classes: [9] }, profile: null, run: { slug: "qz", codename: "remerge" } };
  deriveNamedBand(ctx);
  const ids = () => JSON.parse(readFileSync(P.registerNamedBand, "utf8")).enumerated.map((r) => r.record_id);
  assert.deepEqual(ids(), ["/mark/eu/a1"], "guard: the first merge holds the first record");
  assert.equal(remergeIfBandsMoved(ctx, "escalation"), false, "a band that did not move was merged again");
  const notes = readFileSync(P.registerUnit("primary-sweep"), "utf8");
  writeFileSync(P.registerBand("primary-sweep"), JSON.stringify([block(1, [rec("a1", "Alpha Ltd")]), block(2, [rec("b1", "Beta GmbH")])]));
  assert.equal(remergeIfBandsMoved(ctx, "escalation"), true, "a band that moved was not merged again");
  assert.deepEqual(ids(), ["/mark/eu/a1", "/mark/eu/b1"], "the record the re-run added is not in the named band");
  assert.equal(readFileSync(P.registerUnit("primary-sweep"), "utf8"), notes, "guard: the unit's notes did not change");
  assert.equal(remergeIfBandsMoved(ctx, "escalation"), false, "the same band was merged again");
  const ev = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(ev.filter((e) => e.event === "named-band-remerged").map((e) => e.why), ["escalation"]);
});

test("a band merged again that a reading stage would refuse is not adopted: the earlier merge stands, and the records it held are kept for the recall gate", async (t) => {
  const { deriveNamedBand, remergeIfBandsMoved, refusedRecordsLeftOut } = await import("../pipeline.mjs");
  const { paths } = await import("../stages.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "remerge-ceiling-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  const rec = (id, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: "QZORVAK", classes: [9], status: "Registered", owner_name: owner,
    owner_country: "DE", screen_verdict: "surface:in-scope-live" });
  const block = (n, records) => ({ state: "enumerated", qid: `supp:primary-sweep:t:${n}`, query: "primary-sweep / exact-in-class-live", total_hits: records.length, records });
  mkdirSync(dirname(P.registerBand("primary-sweep")), { recursive: true });
  writeFileSync(P.registerBand("primary-sweep"), JSON.stringify([block(1, [rec("a1", "Alpha Holdings Limited")])]));
  writeFileSync(P.registerUnit("primary-sweep"), "# primary-sweep\n\nThe unit's notes.\n");
  const ctx = { paths: P, axes: ["primary-sweep"], job: { markName: "QZORVAK", classes: [9] }, profile: null, run: { slug: "qz", codename: "remerge" } };
  deriveNamedBand(ctx);
  const first = readFileSync(P.registerNamedBand, "utf8");
  // The ceiling stands just above the first merge, so the band the re-run grows is past it. The measure is handed the
  // size of the band as it would be written.
  const measured = [];
  let ceiling = Buffer.byteLength(first);
  const refusing = (bytes) => { measured.push(bytes); return bytes > ceiling ? ["placement-inquiry"] : []; };
  writeFileSync(P.registerBand("primary-sweep"), JSON.stringify([block(1, [rec("a1", "Alpha Holdings Limited")]), block(2, [rec("b1", "Beta GmbH")])]));
  assert.equal(remergeIfBandsMoved(ctx, "escalation", { refusing }), false, "a band a reading stage would refuse was adopted");
  assert.equal(readFileSync(P.registerNamedBand, "utf8"), first, "the earlier merge does not stand");
  assert.equal(remergeIfBandsMoved(ctx, "escalation", { refusing }), false);
  assert.equal(measured.length, 1, "the band refused as it stands was merged and measured again");
  const ev = () => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(ev().filter((e) => e.event === "named-band-remerge-over-ceiling").map((e) => [e.why, e.stages, e.bytes > Buffer.byteLength(first), e.records]),
    [["escalation", ["placement-inquiry"], true, 1]], "the run record does not say the band was refused, by whom, at what size and leaving out what");
  // the record the refused band held and the band standing does not is kept, and counts as left out
  assert.deepEqual(JSON.parse(readFileSync(driverDir(runDir, "band-refused-records.json"), "utf8")).ids, ["/mark/eu/b1"]);
  assert.deepEqual(refusedRecordsLeftOut(P), ["/mark/eu/b1"], "the record the refused merge left out is not counted as left out");
  // The band moves again and fits: it is merged, at the size measured, and a record it takes in is no longer left out.
  ceiling = Number.MAX_SAFE_INTEGER;
  writeFileSync(P.registerBand("primary-sweep"), JSON.stringify([block(1, [rec("a1", "Alpha Holdings Limited")]), block(2, [rec("b1", "Beta GmbH")]), block(3, [rec("c1", "Gamma SA")])]));
  assert.equal(remergeIfBandsMoved(ctx, "escalation", { refusing }), true, "a band under the ceiling was not merged again");
  assert.equal(statSync(P.registerNamedBand).size, measured.at(-1), "the size measured before adoption is not the size of the band written");
  assert.deepEqual(ev().filter((e) => e.event === "named-band-remerged").map((e) => e.why), ["escalation"]);
  assert.deepEqual(refusedRecordsLeftOut(P), [], "a record a later merge took in is still counted as left out");
});

// ── whole runs: a resumed run whose warm re-run adds a live identical record ──
const JOB = {
  id: "test-job-remerge", msgId: "<remerge@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8921", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const PARK_AT_DIGEST = "You are register DIGEST mode";
const ESCALATE = "- transliteration-numeric extra script group looks thin\n\n## Escalation decisions\nESCALATE: transliteration-numeric — sweep the extra script group";

async function runMockPipeline(root, env, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_PLACEMENT_NO_SIBLING", "MOCK_ESCALATION_ADDS_FLOOR", "MOCK_ESCALATION_ADDS_MARK",
    "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, codename ? { codename } : {});
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

// Pass 1 parks after placement; pass 2 resumes, and the warm re-run of `axis` adds the record. The repeated placement
// pass hands back nothing new, so the record is a floor nobody answered.
async function resumeWithAddedRecord(engineEnv, axis, extra) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-remerge-"));
  const p1 = await runMockPipeline(root, { ...engineEnv, MOCK_FAIL_STAGE: PARK_AT_DIGEST });
  assert.equal(p1.res.failedStage, "register-digest", `guard: pass 1 parks at the reading step (parked at ${p1.res.failedStage})`);
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline(root, { ...engineEnv, ...extra, MOCK_ESCALATION_ADDS_FLOOR: axis, MOCK_PLACEMENT_NO_SIBLING: "1" }, codename);
  const rd = p2.res.runDir;
  const json = (f) => JSON.parse(readFileSync(f, "utf8"));
  return { p2, ev2: p2.events.slice(n1), rd, json,
    inAxisBand: JSON.stringify(json(join(rd, "register-units", `${axis}-band.json`))).includes(ADDED),
    inNamedBand: json(join(rd, "register-named-band.json")).enumerated.some((r) => r.record_id === ADDED),
    floorInShape: json(driverDir(rd, "band-shape.json")).floors.in_class_identical_or_near.some((f) => f.record_id === ADDED),
    duty: existsSync(driverDir(rd, "floor-duty.json")) ? json(driverDir(rd, "floor-duty.json")) : null,
    verdict: existsSync(driverDir(rd, "verdict.json")) ? json(driverDir(rd, "verdict.json")) : null };
}

// The escalation's re-run, on both engines: the band is merged again, the moved band queues the reading step's re-run,
// and the record reaches the recall reconciliation, which never saw it before. What the reading step then writes about it
// is the model's answer: on this path the mock reading step writes no row for the new record, so the whole chain to
// delivery is driven on the envelope close below.
for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: a record the skeptic's escalation adds reaches the named band, its shape and the reading step's next pass`, async () => {
    const r = await resumeWithAddedRecord(env, "transliteration-numeric", { MOCK_SKEPTIC: ESCALATE });
    assert.ok(r.ev2.some((e) => e.event === "stage" && e.stage === "register-unit:transliteration-numeric" && e.trigger === "escalation"), "guard: the escalation re-ran the unit");
    assert.ok(r.inAxisBand, "guard: the re-run added the record to its axis band");
    assert.deepEqual(r.ev2.filter((e) => e.event === "named-band-remerged").map((e) => e.why), ["escalation"]);
    assert.ok(r.inNamedBand, "the record the escalation found is not in the named band");
    assert.ok(r.floorInShape, "the band shape does not list the record as a floor");
    assert.ok(r.ev2.some((e) => e.event === "digest-queued" && e.trigger === "escalation"), "the moved band did not queue the reading step's re-run");
    const recall = r.ev2.filter((e) => e.event === "recall-reconciliation");
    assert.ok(recall.some((e) => e.trigger === "settlement-flush" && e.candidates === 22), `the record did not reach the recall reconciliation: ${JSON.stringify(recall.map((e) => [e.trigger, e.candidates]))}`);
    // assessed in the run, and never held (the owner's rulings of 2026-10-19): placement placed nothing new for it and the
    // reading step left it unended, so the delivered report names it once, as the floor it is
    assert.deepEqual(r.ev2.filter((e) => e.event === "late-evidence").map((e) => e.records), [1], "the late record was not assessed");
    assert.equal(r.p2.res.ok, true, JSON.stringify({ fail: r.p2.res.fail, stage: r.p2.res.failedStage }));
    assert.ok(!r.ev2.some((e) => e.event === "failed"), "the run was stopped");
    assert.equal(r.verdict?.verdict, "CONDITIONAL");
    assert.ok(r.duty.rows.some((f) => f.record_id === ADDED && f.disposition === "unanswered"), "the floor does not count the record");
    assert.ok(!r.ev2.some((e) => e.event === "recall-reconciliation-unended-delivered"), "the recall gate named a record the floor's clause names");
  });
}

test("claude: a record the reading step leaves unended after the run's recovery is named in the delivered report, never a stopped run", async () => {
  const { clauseForDefect } = await import("../terminal-clamp.mjs");
  // a record of the mark's dominant element in a longer mark: a record the recall gate weighs, and not a floor
  const r = await resumeWithAddedRecord({}, "transliteration-numeric", { MOCK_SKEPTIC: ESCALATE, MOCK_ESCALATION_ADDS_MARK: "NOVAPULSE MOBILE" });
  assert.ok(r.inNamedBand, "guard: the record reached the named band");
  assert.ok(!r.floorInShape, "guard: the record is not a floor");
  assert.equal(r.p2.res.ok, true, JSON.stringify({ fail: r.p2.res.fail, stage: r.p2.res.failedStage }));
  assert.ok(!r.ev2.some((e) => e.event === "failed"), "the run was stopped");
  const gap = r.ev2.filter((e) => e.event === "recall-reconciliation-unended-delivered");
  assert.equal(gap.length, 1, "the recall gate did not state the gap");
  assert.equal(r.verdict?.verdict, "CONDITIONAL");
  const clause = clauseForDefect("recall_reconciliation_unended", gap[0].records, gap[0].candidates);
  assert.ok(r.verdict.clauses.includes(clause), `the verdict does not carry the approved sentence: ${JSON.stringify(r.verdict.clauses)}`);
  assert.equal(clause, clauseForDefect("synthesis_unaccounted_delivered", gap[0].records, gap[0].candidates), "the gap is not said in the approved sentence");
});

test("claude: a record a refused merge left out is counted in the delivered report's recall sentence, out of a total that includes it", async () => {
  const { clauseForDefect } = await import("../terminal-clamp.mjs");
  const root = mkdtempSync(join(tmpdir(), "clearotron-remerge-refused-"));
  const p1 = await runMockPipeline(root, { MOCK_FAIL_STAGE: PARK_AT_DIGEST });
  assert.equal(p1.res.failedStage, "register-digest", `guard: pass 1 parks at the reading step (parked at ${p1.res.failedStage})`);
  const rd = p1.res.runDir;
  const codename = JSON.parse(readFileSync(join(rd, "status.json"), "utf8")).codename;
  // What a refused merge leaves on record: one record outside the band, and one a later merge took in, which is read.
  const inBand = JSON.parse(readFileSync(join(rd, "register-named-band.json"), "utf8")).enumerated[0].record_id;
  writeFileSync(driverDir(rd, "band-refused-records.json"), JSON.stringify({ ids: ["/mark/us/90000099", String(inBand).toLowerCase()], count: 2 }));
  const n1 = p1.events.length;
  const p2 = await runMockPipeline(root, {}, codename);
  const ev2 = p2.events.slice(n1);
  assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
  const gap = ev2.filter((e) => e.event === "recall-reconciliation-unended-delivered");
  assert.deepEqual(gap.map((e) => [e.records, e.refused]), [[1, 1]], "the record left out was not counted once, or the one taken in was counted");
  const verdict = JSON.parse(readFileSync(driverDir(p2.res.runDir, "verdict.json"), "utf8"));   // the delivered run, as archived
  assert.equal(verdict.verdict, "CONDITIONAL");
  const clause = clauseForDefect("recall_reconciliation_unended", 1, gap[0].candidates + 1);
  assert.ok(verdict.clauses.includes(clause), `the verdict does not count the record left out in the approved sentence: ${JSON.stringify(verdict.clauses)}`);
});

test("claude: a record the envelope close adds reaches the named band, the shape and the floor of the placement pass that assesses it", async () => {
  const r = await resumeWithAddedRecord({}, "primary-sweep", {});
  assert.ok(r.ev2.some((e) => e.event === "stage" && e.stage === "register-unit:primary-sweep" && e.trigger === "envelope"), "guard: the envelope close re-ran the unit");
  assert.ok(r.inAxisBand, "guard: the re-run added the record to its axis band");
  assert.deepEqual(r.ev2.filter((e) => e.event === "named-band-remerged").map((e) => e.why), ["envelope"]);
  assert.ok(r.inNamedBand && r.floorInShape, "the record the envelope close found is not in the named band and its shape");
  assert.ok(r.duty.rows.some((f) => f.record_id === ADDED && f.disposition === "unanswered"), "the repeated pass's floor does not count the record");
  assert.equal(r.verdict.verdict, "CONDITIONAL");
});
