// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The audit tools, on a delivered KNOCKOUT run (tracker issue 275).
//
// THESE CALL THE TOOL HANDLERS, not the projections underneath them. The issue's own judging rule is that
// each acceptance line "must be shown by the tool's actual output on a real delivered knockout, not by a
// unit test asserting a code path is wired" — and the defect was precisely a wiring one: the projections
// were fine for the lane they were written for, and every tool called the wrong one. An arm on
// lib/knockout.mjs alone would have passed on the broken tree.
//
// WHAT THE BROKEN TREE RETURNED, for the record, so a later reader can tell these arms are not vacuous:
// get_run listed 11 artifacts with `exists: false` on ALL of them; list_evidence `{source:"none",
// records:[]}`; list_searches `{count:0}`; list_findings `"report.md not present"`; get_search_coverage
// `{areas:[]}`; read_artifact report `exists:false` while report.md sat in the pool; trace could resolve
// nothing and its error named fifteen stages, none of them from this lane.
//
// Lib and server modules are imported DYNAMICALLY in before(), after _fixture.mjs has pinned
// CLEAROTRON_WORK_DIR at module scope — product modules capture config at import.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildFixture, buildKnockoutRun, RUN_ID_KO, RUN_ID } from "./_fixture.mjs";

let tools;

before(async () => {
  buildFixture();
  buildKnockoutRun();
  ({ tools } = await import("../server.mjs"));
});

// ── 1. get_run ───────────────────────────────────────────────────────────────────────────────────────

test("275: get_run lists the artifacts this lane writes, with their real presence", () => {
  const out = tools.get_run({ runId: RUN_ID_KO });
  const byName = Object.fromEntries(out.artifacts.map((a) => [a.name, a]));

  assert.equal(out.product, "knockout", "the answer names the product it is about");
  assert.equal(byName.findings?.exists, true, "knockout-findings.json is on disk and reported present");
  assert.equal(byName.plan?.exists, true);
  assert.equal(byName.assessment?.exists, true);
  assert.equal(byName.registerRecords?.exists, true);
  assert.equal(byName.report?.exists, true, "the delivered report — in the POOL, which is the half that was invisible");

  // THE FALSE NEGATIVES. Eleven clearance documents were listed and each reported missing; that is what a
  // reader saw before concluding the run had nothing on disk.
  //
  // THE RULE IS ABOUT WHOSE DOCUMENT IT IS, not about the count of absent ones. A knockout artifact that
  // THIS run did not produce — no register component, say — is honestly reported absent, and that is the
  // absence-is-a-finding rule working rather than the defect. What must never appear is a document from
  // the other lane's table.
  const CLEARANCE_ONLY = ["narrative", "placement", "blindFrame", "caseLaw", "commonLaw", "registerFindings",
    "skepticFlags", "seniorEyeReview", "clientSummary", "matterContext", "variantManifest"];
  const listed = out.artifacts.map((a) => a.name);
  for (const n of CLEARANCE_ONLY)
    assert.ok(!listed.includes(n), `"${n}" is a clearance document and must not be listed on a knockout`);
  assert.ok(!listed.some((n) => n.startsWith("registerUnit:")),
    "the clearance register axes are not documents this product produces");

  // On THIS run every knockout artifact was produced, so the list is all-present — which also proves the
  // `exists` flags are read from disk rather than hardcoded true.
  const missing = out.artifacts.filter((a) => !a.exists).map((a) => a.name);
  assert.deepEqual(missing, [], `this fixture is a complete delivered run: ${missing.join(", ")}`);
});

test("275: get_run states that no coverage ledger EXISTS, rather than reporting one missing", () => {
  const out = tools.get_run({ runId: RUN_ID_KO });
  assert.equal(out.coverageSummary.coverageLedgerPresent, false);
  assert.match(out.coverageSummary.coverageLedgerNote, /keeps no coverage ledger/,
    "the absence is explained as a property of the product");
  assert.equal(out.coverageSummary.findings, 2, "one typed conflict plus the filing the rater read");
  assert.equal(out.coverageSummary.negativeResults, 3, "and the proof-of-search rows are counted");
});

// ── 2. list_findings ─────────────────────────────────────────────────────────────────────────────────

test("275: list_findings returns the run's findings with their bands", () => {
  const out = tools.list_findings({ runId: RUN_ID_KO });
  assert.ok(out.items.length > 0, "the run's findings, not an empty list");
  const halcyon = out.items.find((f) => f.name === "HALCYON");
  assert.ok(halcyon, "the typed conflict is listed");
  assert.equal(halcyon.band, "HIGH");
  assert.equal(halcyon.owner, "Halcyon Systems GmbH");
  assert.equal(halcyon.source_layer, "Register", "derived from weighedFilings, not from a typed label");

  const read = out.items.find((f) => f.recordId === "R-HALCYON-DORMANT");
  assert.ok(read, "the filing the rater read is a finding a reader can ask about");
  assert.equal(read.band, "LOW", "carrying the rater's band for it");
});

test("275: list_findings kind=negatives returns the proof-of-search rows", () => {
  const out = tools.list_findings({ runId: RUN_ID_KO, kind: "negatives" });
  assert.equal(out.items.length, 3);
  assert.ok(out.items.some((n) => n.term === "project halcyon app store"));
});

// THE RULE THAT MATTERS MOST IN THIS ISSUE. A projection with no knockout equivalent must SAY so. An empty
// array here reads as "the audit trail is empty", which is the false statement this whole issue is about.
test("275: a projection with no knockout equivalent states it, and never returns a bare empty list", () => {
  const audit = tools.list_findings({ runId: RUN_ID_KO, kind: "audit" });
  assert.equal(audit.available, false, "the answer is flagged as a non-answer");
  assert.match(audit.note, /does not produce/, "…in words");
  assert.match(audit.note, /not a result/, "…that rule out the 'we looked and found nothing' reading");
  assert.match(audit.note, /audit workbook/, "…and point at where the record actually is");

  const grouped = tools.list_findings({ runId: RUN_ID_KO, group: "on-field" });
  assert.equal(grouped.available, false, "the clearance card groups are named as not produced here");
  assert.match(grouped.note, /does not produce/);
});

// ── 3–5. evidence, searches, coverage ────────────────────────────────────────────────────────────────

test("275: list_evidence returns the register records and the located common-law uses", () => {
  const out = tools.list_evidence({ runId: RUN_ID_KO });
  assert.notEqual(out.source, "none", "the source names the stores it read");
  const reg = out.records.filter((r) => r.layer === "register");
  assert.equal(reg.length, 2, "both fetched filings");
  assert.ok(reg.some((r) => r.owner === "Halcyon Systems GmbH" && r.country === "EU"));
  const cl = out.records.filter((r) => r.layer === "common-law");
  assert.ok(cl.length >= 1, "and the cited common-law use");
  assert.equal(tools.list_evidence({ runId: RUN_ID_KO, layer: "register" }).records.length, 2,
    "the layer filter still applies");
});

test("275: list_searches answers the defensibility question — where we looked and found nothing", () => {
  const out = tools.list_searches({ runId: RUN_ID_KO });
  assert.ok(out.count > 0, "this returned 0 on every knockout we sell");
  const noHits = out.searches.filter((s) => s.outcome === "no-hit");
  assert.ok(noHits.some((s) => s.term === "halcyona"), "a search that came back empty is on the record");

  // A search that did NOT ANSWER is not a clean negative. Reporting a provider timeout as "no-hit" is the
  // un-run check dressed as a searched result — the exact thing the clearance validator exists to catch.
  const unanswered = out.searches.find((s) => s.term === "HALCYONA" && s.source === "register-records.json");
  assert.ok(unanswered, "the register term that did not answer is listed");
  assert.equal(unanswered.outcome, "recorded", "and is NOT filed as a no-hit");
  assert.match(unanswered.note, /did not answer/);
});

test("275: get_search_coverage reports real coverage instead of 'no ledger'", () => {
  const out = tools.get_search_coverage({ runId: RUN_ID_KO });
  assert.ok(out.areas.length > 0, "this returned [] with 'this run records no coverage ledger'");
  assert.ok(out.areas.some((a) => a.area.includes("PROJECT HALCYON")));
  assert.ok(out.areas.some((a) => a.area === "Register" && a.state === "Searched"));
  // NEVER "clear". The lane's own doctrine: a survivor is not knocked out at the configured depth — a
  // result about the screen, not about the mark.
  assert.doesNotMatch(JSON.stringify(out.areas), /\bclear\b|\bclean\b/i,
    "no area may be described in words that read as a clearance");
  assert.match(out.note, /never that the name is clear/);
});

// ── 6. read_artifact ─────────────────────────────────────────────────────────────────────────────────

test("275: read_artifact 'report' returns the delivered report from the pool", () => {
  const out = tools.read_artifact({ runId: RUN_ID_KO, name: "report" });
  assert.notEqual(out.exists, false, "it answered exists:false about a file on disk");
  assert.match(out.text, /KNOCKOUT TRADEMARK REVIEW REPORT/, "the delivered document itself");
  assert.equal(out.file, "report.md");
});

test("275: the knockout's own working documents are readable by name", () => {
  assert.match(tools.read_artifact({ runId: RUN_ID_KO, name: "assessment" }).text, /PROJECT HALCYON meets a live registration/);
  assert.match(tools.read_artifact({ runId: RUN_ID_KO, name: "research:project-halcyon" }).text, /Sweep payload/);
  // And an unknown name is refused with THIS lane's artifacts named, not eleven documents it never writes.
  assert.throws(() => tools.read_artifact({ runId: RUN_ID_KO, name: "narrative" }), (e) => {
    assert.match(e.message, /not recognized/);
    assert.match(e.message, /findings/, "the suggestion names artifacts this run actually has");
    assert.ok(!/placement|blindFrame|caseLaw/.test(e.message), "and not the clearance table");
    return true;
  });
});

// ── 7. trace ─────────────────────────────────────────────────────────────────────────────────────────

test("275: trace resolves this lane's stages and the run's verdict", () => {
  const v = tools.trace({ runId: RUN_ID_KO, target: "verdict" });
  assert.equal(v.verdict, "HIGH", "the verdict resolves — it did not, on any knockout");
  assert.ok(v.marks.some((m) => m.mark === "PROJECT HALCYON" && m.band === "HIGH"));

  const st = tools.trace({ runId: RUN_ID_KO, target: "knockout-assess" });
  assert.equal(st.kind, "stage");
  assert.ok(st.produced.some((a) => a.name === "findings"), "what the stage produced, by presence on disk");

  const chunk = tools.trace({ runId: RUN_ID_KO, target: "knockout-assess#0" });
  assert.equal(chunk.kind, "stage", "a chunked stage resolves too");

  const mark = tools.trace({ runId: RUN_ID_KO, target: "HALCYONA" });
  assert.equal(mark.kind, "mark");
  assert.equal(mark.band, "LOW");
});

test("275: an unresolvable trace target names the KNOCKOUT stages, not the clearance ones", () => {
  const out = tools.trace({ runId: RUN_ID_KO, target: "no-such-thing" });
  assert.match(out.error, /knockout-frame/, "the suggestion is this lane's stage list");
  assert.ok(!/matter-frame|clearotron-variants|blind-frame/.test(out.error),
    "the clearance stages are not offered on a product that has none");
});

// ── 8. the tools that already worked must not move ───────────────────────────────────────────────────

test("275: brief and decision_timeline still answer exactly as they did", () => {
  const b = tools.brief({ runId: RUN_ID_KO });
  assert.ok(b, "brief still answers on a knockout");
  assert.ok(JSON.stringify(b).includes("PROJECT HALCYON"), "with the run's own content");
  const t = tools.decision_timeline({ runId: RUN_ID_KO });
  assert.ok(t, "and so does decision_timeline");
});

// THE CONTROL. Every branch added for this issue is gated on the lane, so the clearance run must be
// untouched — including the eleven-artifact list, which is CORRECT on a product that writes them.
test("275: a clearance run is unaffected by any of it", () => {
  const out = tools.get_run({ runId: RUN_ID });
  assert.equal(out.product, undefined, "no knockout branch was taken");
  assert.ok(out.artifacts.some((a) => a.name.startsWith("registerUnit:")),
    "the clearance lane still lists its register axes");
  assert.ok(tools.list_searches({ runId: RUN_ID }).searches !== undefined);
  assert.ok(tools.get_search_coverage({ runId: RUN_ID }).areas !== undefined);
});

// ── 274 acceptance 5: the briefing shows the register card's rating and read ──────────────────────────
//
// This card used to be described here as carrying no rating of its own, on runs where the search had
// written a full read of that exact filing and the report was already printing it. The report and the
// briefing disagreed about what the search found, and the briefing is what a person is read.
test("274: brief shows a read register filing's rating and read, not the no-rating line", () => {
  const text = JSON.stringify(tools.brief({ runId: RUN_ID_KO }));
  assert.match(text, /Halcyon Holdings/, "the promoted filing is named");
  assert.match(text, /Low risk/, "with the rating the search gave THAT filing");
  assert.match(text, /dormant filing in unrelated goods/, "and the read behind it");
  assert.doesNotMatch(text, /carries no rating of its own/, "the disclaimer is gone where a read exists");
});

// The scoping is the safety property: everything that is not a register card is left exactly as it was.
test("274: a typed conflict's briefing line is untouched", () => {
  const text = JSON.stringify(tools.brief({ runId: RUN_ID_KO }));
  assert.match(text, /HALCYON — Halcyon Systems GmbH: Live EU registration in class 9\./,
    "the typed line keeps its original 'name — owner: net' shape");
});
