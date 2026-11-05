// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A knockout's independent check can name a material defect, and it reaches the step that can repair it. Once: one
// correction, then a fresh read of the corrected record. What no defect named stays as it was, by construction, and a
// correction that cannot stand leaves the rated record standing. Names here are invented.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "ko-correction-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", join(ROOT, "work"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
pinEnv(process.env, "CLEAROTRON_CODEX_PATH", join(HERE, "mock-codex.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");
const { applyCorrectionCall, chunkScope, correctionOutcomes, correctionWork, mergedAnswers, movedOutsideScope, summaryBlock } = await import("../knockout-correction-record.mjs");
const { acceptKnockoutReview, knockoutReviewFile, rewritesThatSurvive, validateKnockoutReviewFile } = await import("../knockout-review-record.mjs");
const { KO_STAGES } = await import("../stages-knockout.mjs");

const NAME = "QUILLBRAE", SIBLING = "MOSSVALE";

// ── THE WHOLE PATH, ON BOTH ENGINES ─────────────────────────────────────────────────────────────────

/** One two-name knockout through the lane, on the mock engine. What the run left. */
async function knockout(codename, env = {}) {
  const set = { MOCK_KO_MATERIAL: undefined, MOCK_KO_MATERIAL_OPEN: undefined, MOCK_KO_CORRECTED_BAND: undefined, MOCK_KO_CORRECTION_STANDS: undefined, MOCK_FAIL_STAGE: undefined,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: undefined, CODEX_API_KEY: undefined, ...env };
  for (const [k, v] of Object.entries(set)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "quillbrae", `2026-11-05-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "quillbrae", date: "2026-11-05", codename, archiveDir: join(studioRoot, "archive", `2026-11-05-${codename}`) };
  const job = { id, markName: NAME, marks: [{ name: NAME }, { name: SIBLING }], classes: [4], jurisdictions: ["EU"], forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const res = await knockoutInner(ctx, job, {
    recordLister: async () => ({ ok: true, total: 0, records: [] }),
    countExecutor: async () => ({ ok: true, total: 0 }),
    gridExecutor: async (spec) => answeredGrid(spec, [{ title: "An invented listing", url: "https://example.test/listing" }]),
    sweepExecutor: async () => ({ ok: true, text: "An invented trader sells candles. https://example.test/trader" }),
  });
  assert.equal(res?.ok, true, `the knockout did not deliver: ${JSON.stringify(res)}`);
  const json = (p) => JSON.parse(readFileSync(p, "utf8"));
  // A delivered run moves to the archive.
  const at = existsSync(dir) ? dir : run.archiveDir;
  const findings = json(join(at, "knockout-findings.json"));
  const journal = readFileSync(driverDir(at, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { dir: at, findings, json, journal, stages: journal.filter((e) => e.event === "stage").map((e) => e.stage),
    review: journal.filter((e) => e.event === "knockout-review").at(-1), of: (doc, n) => doc.marks.find((m) => m.name === n) };
}

const DEFECT = { kind: "contradiction", mark: NAME, finding: 1, problem: "The first conflict is rated below what its own evidence shows." };

for (const [engine, wiring] of [["anthropic-agent", {}], ["openai-agent", { CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "invented-test-value" }]]) {
  test(`a defect reaches the rating step, its dependent answers move, the sibling stands, and the corrected record is read again (${engine})`, async () => {
    const r = await knockout(`corrected-${engine}`, { CLEAROTRON_AI: engine, ...wiring, MOCK_KO_MATERIAL: JSON.stringify([DEFECT]), MOCK_KO_CORRECTED_BAND: "High" });
    assert.ok(r.stages.includes("knockout-correct#0"), `no correction was dispatched: ${r.stages}`);
    assert.ok(r.stages.includes("knockout-review#1"), `no fresh read of the corrected record: ${r.stages}; ${JSON.stringify(r.review)}`);
    const rated = r.json(driverDir(r.dir, "knockout-correction-work.json")).rated;
    const now = r.of(r.findings, NAME), was = r.of(rated, NAME);
    assert.notEqual(was.rating, "High", "the fixture has to start from another band");
    assert.equal(now.rating, "High", "the rating moved");
    assert.equal(now.findings[0].band, "High", "the finding moved");
    assert.match(now.basis, /moves to High/, "the name's basis moved with it");
    assert.match(now.assessment, /now screens at High/, "the name's opening read moved with it");
    assert.equal(summaryBlock(r.findings.batch.executiveSummary, NAME).includes("High"), true, "the batch summary moved with it");
    assert.deepEqual(r.of(r.findings, SIBLING), r.of(rated, SIBLING), "the name no defect named stands byte for byte");
    assert.match(r.json(knockoutReviewFile(r.dir, 1)).first_question, new RegExp(`${NAME}: High`), "the second look read the corrected record");
    const record = r.json(driverDir(r.dir, "knockout-corrections.json"));
    assert.deepEqual(record.outcomes.map((o) => o.outcome), ["findings-changed"]);
    assert.equal(record.recheck, "ran");
    assert.deepEqual(record.open, []);
    assert.deepEqual([r.review.outcome, r.review.material, r.review.open], ["corrected", 1, 0]);
  });
}

test("a defect the rating step answers with no change leaves the record, and the second look is told so", async () => {
  const r = await knockout("stands", { MOCK_KO_MATERIAL: JSON.stringify([DEFECT]), MOCK_KO_CORRECTION_STANDS: "1" });
  const record = r.json(driverDir(r.dir, "knockout-corrections.json"));
  assert.deepEqual(record.outcomes.map((o) => [o.outcome, o.reason]), [["findings-unchanged", "mock correction: the evidence does not support the defect"]]);
  assert.ok(r.stages.includes("knockout-review#1"));
});

test("what the second look still finds stays on the record, in the workbook's notes, and no third look follows", async () => {
  const still = { kind: "contradiction", mark: NAME, problem: "The opening read still leans on the old band." };
  const r = await knockout("open", { MOCK_KO_MATERIAL: JSON.stringify([DEFECT]), MOCK_KO_CORRECTED_BAND: "High", MOCK_KO_MATERIAL_OPEN: JSON.stringify([still]) });
  assert.deepEqual(r.json(driverDir(r.dir, "knockout-corrections.json")).open, [still]);
  assert.equal(r.stages.filter((s) => s.startsWith("knockout-correct")).length, 1, "one correction");
  assert.equal(r.stages.filter((s) => s.startsWith("knockout-review")).length, 2, "two looks");
  const ExcelJS = (await import("exceljs")).default;
  const pool = join(ROOT, "pool");
  const book = readdirSync(pool, { recursive: true }).find((p) => String(p).endsWith("knockout-audit-open.xlsx"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(pool, book));
  const notes = [];
  wb.getWorksheet("Working Notes").eachRow((row) => notes.push(String(row.values[3] ?? "")));
  assert.ok(notes.includes(still.problem), `the open point is not in the notes: ${JSON.stringify(notes)}`);
});

test("a correction that fails leaves the rated record standing, and the run delivers", async () => {
  const clean = await knockout("no-defect");
  const r = await knockout("correction-failed", { MOCK_KO_MATERIAL: JSON.stringify([DEFECT]), MOCK_FAIL_STAGE: "record_knockout_correction" });
  assert.equal(r.review.outcome, "correction-failed");
  assert.equal(r.of(r.findings, NAME).rating, r.of(clean.findings, NAME).rating, "the rated band stands");
  assert.equal(existsSync(knockoutReviewFile(r.dir, 1)), false, "with nothing corrected there is nothing to read again");
});

test("with no material defect nothing more is dispatched", async () => {
  const r = await knockout("clean");
  assert.deepEqual(r.stages.filter((s) => /correct|review/.test(s)), ["knockout-review"]);
  assert.equal(existsSync(driverDir(r.dir, "knockout-correction-work.json")), false);
});

// ── WHAT A CALL MAY REACH ────────────────────────────────────────────────────────────────────────────

const finding = (ordinal, name, band = "Medium") => ({ ordinal, name, owner: "Invented Owner", band, net: `${name} net`, type: "Active Business", evidence: ["https://example.test/a"], basis: `${name} basis` });
const rated = () => ({ chunkSummary: `An opening line.\n\n## ${NAME}\nRated Medium.\n\n## ${SIBLING}\nRated Low.`,
  marks: [{ name: NAME, rating: "Medium", ratingQualifier: null, basis: "b", assessment: "a", findings: [finding(1, "ONE"), finding(2, "TWO")] },
    { name: SIBLING, rating: "Low", ratingQualifier: null, basis: "b", assessment: "a", findings: [finding(1, "THREE", "Low")] }] });
const work = (defects) => correctionWork({ rated: rated(), material: defects, chunks: [[NAME, SIBLING]] });
const apply = (defects, call) => {
  const base = rated();
  return applyCorrectionCall({ held: base, base, call, scope: chunkScope(work(defects), 0, base) });
};

test("a call reaches only what a defect names", () => {
  const onOne = [{ kind: "band", mark: NAME, finding: 1, problem: "p", rests_on: ["x"] }];
  assert.match(apply(onOne, { marks: [{ name: SIBLING, basis: "new" }] }).reason, /no material defect names this mark/);
  assert.match(apply(onOne, { marks: [{ name: NAME, findings: [{ ...finding(2, "TWO"), band: "High" }] }] }).reason, /no defect names finding 2/);
  assert.match(apply(onOne, { marks: [{ name: NAME, findings: [finding(3, "FOUR")] }] }).reason, /asks for a new finding/);
  assert.match(apply(onOne, { marks: [{ name: NAME, remove_findings: [2] }] }).reason, /no defect names finding 2/);
  const ok = apply(onOne, { marks: [{ name: NAME, findings: [{ ...finding(1, "ONE"), band: "High" }] }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.chunk.marks[0].findings[0].band, "High");
  assert.deepEqual(ok.chunk.marks[0].findings[1], finding(2, "TWO"), "the finding no defect named stands, and was not sent");
  assert.deepEqual(ok.chunk.marks[1], rated().marks[1], "the sibling stands, and was not sent");
  assert.equal(apply(onOne, { marks: [{ name: NAME, findings: [finding(2, "TWO")] }] }).ok, true, "an unchanged finding sent back is no change");
});

test("a missing filing may add a finding; a removal needs its finding named", () => {
  const missing = [{ kind: "missing", mark: NAME, problem: "p", rests_on: ["x"] }];
  const added = apply(missing, { marks: [{ name: NAME, findings: [finding(3, "NEW")] }] });
  assert.deepEqual(added.chunk.marks[0].findings.map((f) => f.ordinal), [1, 2, 3]);
  const onTwo = [{ kind: "band", mark: NAME, finding: 2, problem: "p", rests_on: ["x"] }];
  assert.deepEqual(apply(onTwo, { marks: [{ name: NAME, remove_findings: [2] }] }).chunk.marks[0].findings.map((f) => f.ordinal), [1]);
});

test("a rating that moves brings its dependent answers, and the summary has to carry the band", () => {
  const defects = [{ kind: "band", mark: NAME, problem: "p", rests_on: ["x"] }];
  assert.match(apply(defects, { marks: [{ name: NAME, rating: "High", assessment: "new" }] }).reason, /basis still reads for the old band/);
  assert.match(apply(defects, { marks: [{ name: NAME, rating: "High", basis: "new" }] }).reason, /assessment still reads for the old band/);
  assert.match(apply(defects, { marks: [{ name: NAME, rating: "High", basis: "new", assessment: "new" }] }).reason, /chunkSummary still reads for the old band/);
  assert.match(apply(defects, { marks: [{ name: NAME, rating: "High", basis: "new", assessment: "new" }], chunkSummary: `## ${NAME}\nRated Medium.` }).reason, /does not carry its band, High/);
  assert.equal(apply(defects, { marks: [{ name: NAME, rating: "High", basis: "new", assessment: "new" }], chunkSummary: `## ${NAME}\nRated High.\n\n## ${SIBLING}\nRated Low.` }).ok, true);
});

test("every defect is answered, and an answer of changed has to show a change", () => {
  const defects = [{ kind: "band", mark: NAME, finding: 1, problem: "p", rests_on: ["x"] }];
  const base = rated();
  const scope = chunkScope(work(defects), 0, base);
  const answer = (received, chunk = base) => mergedAnswers([], received, scope, { base, chunk });
  assert.match(answer([]).reason, /defect 1 has no answer/);
  assert.match(answer([{ defect: 9, outcome: "stands", why: "w" }]).reason, /no defect 9/);
  assert.match(answer([{ defect: 1, outcome: "changed", why: "w" }]).reason, /nothing on QUILLBRAE differs/);
  assert.match(answer([{ defect: 1, outcome: "stands", why: " " }]).reason, /carries no reason/);
  assert.equal(answer([{ defect: 1, outcome: "stands", why: "the evidence does not support it" }]).ok, true);
});

// ── WHAT THE DRIVER SAW, THROUGH A RENUMBERING ───────────────────────────────────────────────────────

test("what moved is read by a finding's identity, because the gate renumbers on the band", () => {
  const w = work([{ kind: "band", mark: NAME, finding: 2, problem: "p", rests_on: ["x"] }]);
  const after = rated();
  after.marks[0].findings = [{ ...finding(2, "TWO", "High"), ordinal: 1 }, { ...finding(1, "ONE"), ordinal: 2 }];
  assert.deepEqual(correctionOutcomes(w, after).map((o) => [o.outcome, o.targets]), [["findings-changed", ["TWO"]]]);
  assert.deepEqual(movedOutsideScope(w, after), { marks: [], findings: [] }, "ONE was renumbered, not changed");
  const removed = rated();
  removed.marks[0].findings = [finding(1, "ONE")];
  assert.deepEqual(correctionOutcomes(w, removed).map((o) => [o.outcome, o.removed]), [["findings-removed", ["TWO"]]]);
  const moved = rated();
  moved.marks[1].basis = "moved";
  moved.marks[0].findings[0].net = "moved";
  assert.deepEqual(movedOutsideScope(w, moved), { marks: [SIBLING], findings: [{ mark: NAME, name: "ONE" }] });
});

// ── THE CHECK'S OWN ANSWER ───────────────────────────────────────────────────────────────────────────

test("a material row is held to its shape, and to what this run holds", () => {
  assert.match(acceptKnockoutReview({ material: [{ kind: "taste", mark: NAME, problem: "p" }] }).reason, /kind is one of/);
  assert.match(acceptKnockoutReview({ material: [{ kind: "band", mark: NAME, problem: "p" }] }).reason, /names no evidence/);
  assert.match(acceptKnockoutReview({ material: [{ kind: "scope", mark: NAME }] }).reason, /says nothing about what is wrong/);
  assert.equal(acceptKnockoutReview({ material: [{ kind: "scope", mark: NAME, problem: "class 35 was asked for" }] }).ok, true, "scope rests on the request, and a material row is an answer");

  const dir = mkdtempSync(join(tmpdir(), "ko-material-"));
  mkdirSync(driverDir(dir), { recursive: true });
  mkdirSync(join(dir, "research"), { recursive: true });
  writeFileSync(join(dir, "knockout-findings.json"), JSON.stringify(rated()));
  writeFileSync(driverDir(dir, "register-records.json"), JSON.stringify({ marks: [{ name: NAME, records: [{ recordId: "/mark/em/carried" }], setAsideRecords: [{ recordId: "/mark/em/aside" }] }] }));
  writeFileSync(join(dir, "research", "quillbrae.md"), "A held page: https://example.test/held");
  const check = (m) => validateKnockoutReviewFile(knockoutReviewFile(dir), JSON.stringify({ material: [m] }));
  assert.match(check({ kind: "band", mark: "STRANGER", problem: "p", rests_on: ["x"] }).reason, /not a name on this record/);
  assert.match(check({ kind: "band", mark: NAME, finding: 9, problem: "p", rests_on: ["/mark/em/carried"] }).reason, /does not hold/);
  assert.match(check({ kind: "band", mark: NAME, problem: "p", rests_on: ["/mark/em/invented"] }).reason, /does not hold for that name/);
  assert.equal(check({ kind: "exclusion", mark: NAME, problem: "p", rests_on: ["/mark/em/aside"] }).ok, true, "a filing set aside can be raised");
  assert.equal(check({ kind: "missing", mark: NAME, problem: "p", rests_on: ["https://example.test/held"] }).ok, true, "a URL in the name's payload can be raised");
});

test("only a first pass's rewrites on lines no defect reopened carry over", () => {
  const review = { rewrites: [{ at: { field: "basis", mark: NAME }, text: "a" }, { at: { field: "basis", mark: SIBLING }, text: "b" },
    { at: { field: "batch.executiveSummary" }, text: "c" }, { at: { field: "batch.standardCaveats", index: 0 }, text: "d" }] };
  assert.deepEqual(rewritesThatSurvive(review, [NAME]).rewrites.map((r) => r.text), ["b", "d"]);
});

test("the correction's dispatch names each defect, in the chunk's own numbering", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-dispatch-"));
  const chunkFile = join(dir, "knockout-assess-0.json");
  const chunk = rated();
  chunk.marks[0].findings = [finding(5, "TWO"), finding(6, "ONE")];
  writeFileSync(chunkFile, JSON.stringify(chunk));
  const w = work([{ kind: "band", mark: NAME, finding: 2, problem: "The second conflict is rated too low.", rests_on: ["/mark/em/x"] }]);
  const K = { runDir: dir, assessChunk: () => chunkFile, plan: join(dir, "plan.json"), research: (k) => join(dir, "research", `${k}.md`), registerRecords: join(dir, "absent"), inboundRequest: join(dir, "absent"), confirmationBrief: join(dir, "absent") };
  const msg = KO_STAGES["knockout-correct"].message({ K, chunkNo: 0, work: w, chunkMarks: [{ name: NAME }, { name: SIBLING }] });
  assert.match(msg, /1\. \[band\] "QUILLBRAE", finding 5 \(TWO\): The second conflict is rated too low\. Rests on: \/mark\/em\/x\./);
  assert.match(msg, /quillbrae\.md/);
  assert.doesNotMatch(msg, /mossvale\.md/, "a name no defect names is not reopened");
});
