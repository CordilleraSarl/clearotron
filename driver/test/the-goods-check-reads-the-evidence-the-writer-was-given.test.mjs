// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE GOODS CHECK READS THE EVIDENCE THE WRITER WAS GIVEN.
//
// The delivery check names a finding that says its goods are cut where the run, by then, holds the record whole, and it
// compares the findings with what each record's goods rested on when the writer wrote. That record, goods-evidence.json,
// is derived again with every band merge, the first merge of a resumed pass among them, from the bodies the run holds by
// then. A record the writer had as a cut search answer then read as an official record: the check found no outcome for a
// record it had handed to the repair, and a claim the repair left standing lost its unresolved row.
//
// So a cold dispatch of the writer keeps the evidence it is given, and the check reads that copy. Driven through the band
// derivation the pipeline runs and the two functions the stage dispatch calls, on a run's own files. Every mark, owner and
// record id is invented.
// SAFETY GUARD (repo convention): the workspace root and the call ledger are pinned BEFORE any driver module loads, so
// driver modules are imported dynamically below.
import { test } from "node:test";
import { driverSource } from "./driver-source.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";

pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(mkdtempSync(join(tmpdir(), "goods-as-written-calls-")), "register-calls.jsonl");
const { DERIVATION_RUNNERS, goodsEvidenceForTheWriter, keepGoodsEvidenceAsWritten } = await import("../pipeline.mjs");
const { paths } = await import("../stages.mjs");
const { readGoodsEvidence, readGoodsEvidenceAsWritten, GOODS_EVIDENCE_FILE, GOODS_EVIDENCE_AS_WRITTEN_FILE } = await import("../goods-evidence.mjs");
const { goodsHeldWholeChecks } = await import("../predelivery-lint.mjs");
const URI = "/mark/us/tm_invented-quorvane";
const CUT = "Downloadable software for planning invented ferry timetables, and downloadable applications for";
const WHOLE = "Downloadable software for planning invented ferry timetables, and downloadable applications for booking invented ferry seats";
// The band row as a search answer that cut its class 9 statement holds it, and the record's body as a later fetch leaves it.
const ROW = { record_id: URI, mark_text: "QUORVANE", owner_name: "Invented Ferries Ltd", owner_country: "US", classes: [9], status: "Registered",
  raw: { classifications: [{ nice_class: 9, goods_services_text: CUT, goods_services_text_truncated: true }] } };
const BODY = { applicationNumber: "tm_invented-quorvane", statusText: "Registered", goodsServices: [{ classes: [9], language: "en", description: WHOLE }] };
const CLAIM = "The class 9 goods list in the earlier record is cut and unread.";

function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "goods-as-written-run-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: [ROW], crowds: [] }));
  return { runDir, ctx: { paths: P, job: { markName: "Quorvane", classes: ["9"], jurisdictions: ["US"] }, profile: {}, run: { slug: "qv", codename: "test", runDir } } };
}
const deriveBand = (ctx) => assert.equal(DERIVATION_RUNNERS["band-shape"](ctx), true, "guard: the band shape was derived");
const bodyArrives = (runDir) => appendFileSync(driverDir(runDir, "register-record-bodies.jsonl"),
  JSON.stringify({ sessionKey: "clearance-qv-test-record-closure", target: URI, body: BODY }) + "\n");
const stateOf = (doc) => { const r = doc?.records?.find((x) => x.uri === URI); return r ? [r.source, r.state] : null; };
const evidenceText = (runDir) => readFileSync(driverDir(runDir, GOODS_EVIDENCE_FILE), "utf8");
const copyAt = (runDir) => driverDir(runDir, GOODS_EVIDENCE_AS_WRITTEN_FILE);
// What the delivery check is given, in the words pipeline.mjs gives it (pinned in the last test).
const checkInput = (runDir) => readGoodsEvidenceAsWritten(runDir) ?? readGoodsEvidence(runDir);
// One dispatch of a stage, as `stage` makes it: the evidence read before it, kept once it returns `r`.
const dispatch = (ctx, r, { name = "synthesis", opts = {} } = {}) => keepGoodsEvidenceAsWritten(ctx, r, goodsEvidenceForTheWriter(name, ctx, opts));

test("a band derived again after the record's body arrives leaves the copy the writer was given", (t) => {
  const { runDir, ctx } = seedRun(t);
  deriveBand(ctx);
  assert.deepEqual(stateOf(readGoodsEvidence(runDir)), ["search-row", "cut"], "control: the writer is given the record as a cut search answer");
  dispatch(ctx, { ok: true });
  const kept = readFileSync(copyAt(runDir), "utf8");
  assert.equal(kept, evidenceText(runDir), "the copy is not the evidence the writer was given");
  bodyArrives(runDir);
  deriveBand(ctx);
  assert.deepEqual(stateOf(readGoodsEvidence(runDir)), ["record-body", "complete"], "control: the band derived again reads the record as held whole");
  assert.equal(readFileSync(copyAt(runDir), "utf8"), kept, "the band derived again changed the copy");
  assert.deepEqual(stateOf(checkInput(runDir)), ["search-row", "cut"], "the check is not given the evidence as the writer had it");
});

test("a writer that skipped, a followup and a failed dispatch leave the copy, and a cold writer refreshes it", (t) => {
  const { runDir, ctx } = seedRun(t);
  deriveBand(ctx);
  dispatch(ctx, { ok: true });
  const kept = readFileSync(copyAt(runDir), "utf8");
  bodyArrives(runDir);
  deriveBand(ctx);
  assert.notEqual(evidenceText(runDir), kept, "control: the evidence moved after the writer wrote");
  for (const [why, r, opts] of [
    ["a writer that skipped, as on a resume", { ok: true, skipped: true }, {}],
    ["a followup, as the delivery check's repair is", { ok: true }, { opts: { followup: "Correct the claim in finding 1 where these statements resolve it." } }],
    ["a dispatch that failed", { ok: false, fail: "nonzero_exit_1" }, {}],
    ["another stage", { ok: true }, { name: "narrative-refutation" }],
  ]) {
    dispatch(ctx, r, opts);
    assert.equal(readFileSync(copyAt(runDir), "utf8"), kept, `${why} changed the copy`);
  }
  dispatch(ctx, { ok: true });
  assert.equal(readFileSync(copyAt(runDir), "utf8"), evidenceText(runDir), "a cold writer did not refresh the copy");
  assert.deepEqual(stateOf(checkInput(runDir)), ["record-body", "complete"], "the check is not given what the cold writer was given");
});

test("with no copy the check reads the evidence as it stands, and a writer given none leaves none", (t) => {
  const { runDir, ctx } = seedRun(t);
  deriveBand(ctx);
  assert.equal(existsSync(copyAt(runDir)), false, "control: no writer has been dispatched");
  assert.deepEqual(checkInput(runDir), readGoodsEvidence(runDir), "with no copy, the check is not given the evidence as it stands");
  const finding = { ordinal: 1, owner: { registrations: [{ uri: URI }] }, net: CLAIM };
  bodyArrives(runDir);
  const named = goodsHeldWholeChecks({ findings: [finding], goodsEvidence: checkInput(runDir), recordsByUri: new Map([[URI, BODY]]) });
  assert.deepEqual(named.filter((c) => !c.pass).map((c) => c.id), [`goods-held-whole:1:${URI}`], "the check did not name the finding as it did before");
  writeFileSync(copyAt(runDir), "{ torn");
  assert.deepEqual(checkInput(runDir), readGoodsEvidence(runDir), "a copy that will not parse was read");
  // A writer dispatched before any evidence was derived leaves no copy, so none describes an earlier writer.
  rmSync(driverDir(runDir, GOODS_EVIDENCE_FILE));
  dispatch(ctx, { ok: true });
  assert.equal(existsSync(copyAt(runDir)), false, "a copy describes evidence the last writer was not given");
});

test("a claim the repair left standing keeps its unresolved row once the band is derived again", (t) => {
  const { runDir, ctx } = seedRun(t);
  deriveBand(ctx);
  dispatch(ctx, { ok: true });   // the writer, on the cut statement
  bodyArrives(runDir);           // the record's body, fetched before the delivery check
  deriveBand(ctx);               // a resumed pass's first band merge
  // The finding still says its goods are cut, after the repair was handed the record's whole statements.
  const finding = { ordinal: 2, owner: { registrations: [{ uri: URI }] }, net: CLAIM };
  const failing = (goodsEvidence) => goodsHeldWholeChecks({ findings: [finding], goodsEvidence, recordsByUri: new Map([[URI, BODY]]), handed: new Set([URI]) })
    .filter((c) => !c.pass).map((c) => c.id);
  assert.deepEqual(failing(readGoodsEvidence(runDir)), [], "control: on the evidence as it stands, the claim reads as no outcome");
  assert.deepEqual(failing(checkInput(runDir)), [`goods-held-whole-unresolved:2:${URI}`], "the claim left standing lost its unresolved row");
});

test("the writer's stage keeps the copy, and the delivery check reads it", () => {
  // The dispatch and the check are inline in pipeline.mjs, so their wiring is pinned in the source.
  const src = driverSource("pipeline.mjs");
  assert.match(src, /async function stage\(name, ctx, opts = \{\}\) \{\n  const writersEvidence = goodsEvidenceForTheWriter\(name, ctx, opts\);/,
    "the stage dispatch does not read the evidence before it dispatches");
  assert.match(src, /sweepStrayArtifacts\(ctx, name\);\n      keepGoodsEvidenceAsWritten\(ctx, r, writersEvidence\);\n      await afterLateSynthesisSave\(name, ctx, r\);\n      return r;/,
    "the stage dispatch does not keep the copy once it returns");
  assert.match(src, /const writersEvidence = goodsEvidenceForTheWriter\("synthesis", ctx\);\n    const synth = await asPartNotCompleted\("assessment", async \(\) =>\n      quarantineSynth\(await stage\("synthesis"[^\n]*\n    keepGoodsEvidenceAsWritten\(ctx, synth, writersEvidence\);/,
    "the writer's first pass does not keep the copy where its record comes from the salvage after a failed dispatch");
  assert.match(src, /goodsEvidence: readGoodsEvidenceAsWritten\(run\.runDir\) \?\? readGoodsEvidence\(run\.runDir\), goodsHanded: readGoodsHanded\(run\.runDir\),/,
    "the delivery check is not given the evidence as the writer had it");
});
