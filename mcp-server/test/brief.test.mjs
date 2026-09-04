// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Briefing-tier tests: buildBrief plain-language output + model-identity confinement (models live in
// get_telemetry's raw events only — never in the timeline/trace/get_run projections an agent narrates from).
// Lib modules are imported DYNAMICALLY in before() (after _fixture sets CLEAROTRON_WORK_DIR).
//
// — the four defects these arms pin:
//   (a) the product name was the LITERAL "preliminary trademark clearance" on every run, whatever it was;
//   (b) the brief re-emitted the source document's "Recommendation:" line (the deliverable is facts, not advice);
//   (c) it sourced from client-summary.md, whose stage was retired 2026-08-01, and read report-data.json never;
//   (d) a delivered knockout briefed as "may still be in flight" — its output is in the POOL, not the run dir.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFixture, buildRichRun, buildKnockoutRun, buildInFlightRun, RUN_ID, RUN_ID2, RUN_ID_KO, RUN_ID_FLIGHT, POOL } from "./_fixture.mjs";

const MODEL_ID = /(anthropic|claude|sonnet|opus|haiku|gemini|deepseek|gpt)/i;

let runs, brief, events, traceLib;
let run;

before(async () => {
  buildFixture();
  buildRichRun();
  buildKnockoutRun();
  buildInFlightRun();
  runs = await import("../lib/runs.mjs");
  brief = await import("../lib/brief.mjs");
  events = await import("../lib/events.mjs");
  traceLib = await import("../lib/trace.mjs");
  run = runs.resolveRun(RUN_ID);
});

// ── (a) the product name ─────────────────────────────────────────────────────────────────────────────

test("buildBrief: the run is announced by its REGISTRY-resolved product, never a hardcoded one", () => {
  const b = brief.buildBrief(run);
  assert.equal(b.runId, RUN_ID);
  // the fixture run's frozen level is full-country-search
  assert.equal(b.product, "Full country search");
  assert.match(b.brief, /^\*\*ACME\*\* — Full country search, run 2026-06-08\./m);
  assert.doesNotMatch(b.brief, /preliminary trademark clearance/i, "the hardcoded product string is gone");
});

test("buildBrief: a knockout and a clearance are named differently — one resolver, four products", () => {
  const ko = brief.buildBrief(runs.resolveRun(RUN_ID_KO));
  const cl = brief.buildBrief(runs.resolveRun(RUN_ID2));
  assert.equal(ko.product, "Knockout search");
  assert.equal(cl.product, "Global preliminary search");
  assert.equal(brief.buildBrief(runs.resolveRun(RUN_ID_FLIGHT)).product, "Multi-country focus search");
  for (const b of [ko, cl]) assert.doesNotMatch(b.brief, /preliminary trademark clearance/i);
});

test("buildBrief: the product name is DERIVED, not read from the data file's stored string", () => {
  // the knockout fixture's report-data carries level.identity = "STALE STORED NAME" on purpose
  const stored = JSON.parse(readFileSync(join(POOL, RUN_ID_KO, "report-data-halcyona.json"), "utf8"));
  assert.equal(stored.level.identity, "STALE STORED NAME", "fixture sanity: a stale stored name is present");
  const b = brief.buildBrief(runs.resolveRun(RUN_ID_KO));
  assert.doesNotMatch(b.brief, /STALE STORED NAME/, "the brief must resolve the level id, never read the stored name");
  assert.equal(b.product, "Knockout search");
});

test("buildBrief: a run whose product the registry cannot name prints NO product name", () => {
  const r = runs.resolveRun(RUN_ID);
  const unknown = { ...r, runDir: "/nonexistent/run", P: { ...r.P, report: "/nonexistent/report.md" }, poolDir: "/nonexistent/pool" };
  const b = brief.buildBrief(unknown);
  assert.equal(b.product, null);
  assert.match(b.brief, /^\*\*ACME\*\* — run 2026-06-08\./m, "no product clause at all — never a guessed name");
});

// ── (b) no advice ────────────────────────────────────────────────────────────────────────────────────

test("buildBrief: no Recommendation line anywhere — the deliverable carries facts, not advice", () => {
  // the fixture's retired-stage client-summary.md DOES carry a recommendation, so this is not vacuous
  const cs = readFileSync(run.P.clientSummary, "utf8");
  assert.match(cs, /- recommendation:/, "fixture sanity: the source document carries advice to re-emit");
  for (const id of [RUN_ID, RUN_ID2, RUN_ID_KO, RUN_ID_FLIGHT]) {
    const b = brief.buildBrief(runs.resolveRun(id));
    assert.doesNotMatch(b.brief, /Recommendation:/i, `${id} re-emitted advice`);
    assert.doesNotMatch(b.brief, /Rebrand before launch/, `${id} re-emitted the recommendation text`);
  }
});

// ── (c) report-data.json is the source ───────────────────────────────────────────────────────────────

test("buildBrief: a delivered clearance builds from report-data.json, conflicts one for one", () => {
  const r = runs.resolveRun(RUN_ID2);
  const b = brief.buildBrief(r);
  assert.equal(b.source, "report-data");
  assert.equal(b.state, "delivered");
  const data = JSON.parse(readFileSync(join(POOL, RUN_ID2, "report-data.json"), "utf8"));
  const conflictLines = b.brief.split("\n").filter((l) => l.startsWith("- **"));
  assert.equal(conflictLines.length, data.findings.length,
    "every live finding in the data file, and nothing else, is a conflict line");
  for (const f of data.findings) assert.ok(b.brief.includes(f.net), `finding ${f.ordinal} net missing from the brief`);
  // the out-of-scope finding the old report-card path silently dropped
  assert.match(b.brief, /MYRKUR CAFE/, "out-of-scope findings are not filtered out of the brief");
  assert.match(b.brief, /Overall risk: Medium/);
  assert.match(b.brief, new RegExp(data.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the report link rides the brief");
  assert.doesNotMatch(b.brief, /may still be in flight/, "a delivered run is never briefed as in flight");
  assert.doesNotMatch(b.brief, MODEL_ID);
});

test("buildBrief: client-summary.md is never the source, even when it is on disk", () => {
  const b = brief.buildBrief(run);
  assert.notEqual(b.source, "client-summary");
  assert.doesNotMatch(b.brief, /One live US conflict by Beta Inc/, "the retired stage's summary must not be read");
});

test("buildBrief: an archived run with a report but no data file falls back VISIBLY", () => {
  const b = brief.buildBrief(run);   // fixture run 1 has report.md and no pool data
  assert.equal(b.source, "report-cards");
  assert.match(b.brief, /No published data file for this run/, "the fallback names itself");
  assert.match(b.brief, /ACME/);
  assert.doesNotMatch(b.brief, /Level\s*\d\s*Risk\s*=/i, "risk-formula clause must be dropped");
  assert.doesNotMatch(b.brief, MODEL_ID, "no model identity in a briefing");
});

test("buildBrief: a DELIVERED run with no readable output says so — never an empty brief", () => {
  const r = runs.resolveRun(RUN_ID2);
  const blind = { ...r, P: { ...r.P, report: "/nonexistent/report.md" }, poolDir: "/nonexistent/pool" };
  const b = brief.buildBrief(blind);
  assert.equal(b.source, "unavailable");
  assert.match(b.brief, /delivered, but none of its published output can be read/i);
  assert.match(b.brief, /NOT a search that found no conflicts/);
  assert.doesNotMatch(b.brief, /may still be in flight/, "a delivered run must not be reported as in flight");
});

// ── (d) knockout runs ────────────────────────────────────────────────────────────────────────────────

test("enumerateRuns already discovers knockout runs — same studio root, same status.json shape", () => {
  const all = runs.enumerateRuns();
  const ko = all.find((x) => x.runId === RUN_ID_KO);
  assert.ok(ko, "the knockout run is enumerated");
  assert.equal(ko.state, "delivered");
  assert.equal(ko.location, "archive");
  assert.ok(runs.resolveRun("brass-lantern"), "and resolves by codename like any other run");
});

test("buildBrief: a delivered knockout BATCH answers as delivered, per name, with a link each", () => {
  const b = brief.buildBrief(runs.resolveRun(RUN_ID_KO));
  assert.equal(b.source, "report-data");
  assert.equal(b.product, "Knockout search");
  assert.equal(b.state, "delivered");
  assert.doesNotMatch(b.brief, /may still be in flight/, "the defect: a delivered knockout read as in flight");
  // the lane's own batch spelling for the subject, and the batch's worst band as the overall
  assert.match(b.brief, /^\*\*PROJECT HALCYON \+1 more\*\* — Knockout search, run 2026-08-04\./m);
  assert.match(b.brief, /^\*\*Overall risk: High\.\*\*/m);
  // a two-name batch writes report-data-<slug>.json PER MARK — both names must be briefed
  assert.match(b.brief, /- \*\*PROJECT HALCYON\*\* — High \(in-class\)\./);
  assert.match(b.brief, /- \*\*HALCYONA\*\* — Low\./);
  assert.match(b.brief, /report\/tmpkock1-halcyon-2026-08-04-brass-lantern\/project-halcyon/);
  assert.match(b.brief, /report\/tmpkock1-halcyon-2026-08-04-brass-lantern\/halcyona/);
  assert.match(b.brief, /Live EU registration in class 9\./);
  assert.doesNotMatch(b.brief, MODEL_ID);
});

test("readReportData: a multi-mark batch is read as every one of its files", () => {
  const docs = runs.readReportData(runs.resolveRun(RUN_ID_KO));
  assert.equal(docs.length, 2, "a batch writes one data file per name — stat'ing report-data.json finds none");
  assert.deepEqual(docs.map((d) => d.marks[0].name).sort(), ["HALCYONA", "PROJECT HALCYON"]);
  assert.deepEqual(runs.readReportData(runs.resolveRun(RUN_ID_FLIGHT)), [], "an absence is an empty list, not a throw");
});

// ── the path that must not regress ───────────────────────────────────────────────────────────────────

test("buildBrief: a run mid-flight still answers in flight", () => {
  const r = runs.resolveRun(RUN_ID_FLIGHT);
  assert.equal(r.state, "running");
  const b = brief.buildBrief(r);
  assert.equal(b.source, "none");
  assert.match(b.brief, /may still be in flight/);
  assert.match(b.brief, /Status: running/);
  assert.doesNotMatch(b.brief, /delivered/i, "an in-flight run is never described as delivered");
  assert.doesNotMatch(b.brief, /conflicts that matter/i, "no conflict list is invented for a run with no output");
  // it is still named by its product — being unfinished does not make a run product-less
  assert.match(b.brief, /^\*\*VESPERA\*\* — Multi-country focus search, run 2026-08-11\./m);
});

// ── unchanged surfaces ───────────────────────────────────────────────────────────────────────────────

test("decision timeline: stage/manual-rerun entries carry no model; failover keeps the fact only", () => {
  const raw = events.readEvents(run.runDir);
  assert.ok(raw.some((e) => e.event === "stage" && e.model), "fixture sanity: raw events DO carry models (telemetry keeps them)");
  const synthetic = [...raw,
    { ts: "2026-06-08T11:00:00Z", event: "failover", stage: "report-overview", requested: "anthropic/claude-opus-4-8", served: "azure-openai/gpt-5.4", attempt: 2 },
    { ts: "2026-06-08T11:01:00Z", event: "manual-rerun", stage: "report-overview", model: "anthropic/claude-opus-4-8", snapshot: "_history/x" },
  ];
  const { timeline } = events.projectTimeline(synthetic, run.P);
  assert.doesNotMatch(JSON.stringify(timeline), MODEL_ID, "no model identity anywhere in the projected timeline");
  const fo = timeline.find((t) => t.kind === "failover");
  assert.equal(fo.decision, "model-failover");
  assert.equal(fo.attempt, 2);
  assert.equal(fo.requested, undefined);
  assert.equal(fo.served, undefined);
});

test("trace: stage nodes carry no model identity", () => {
  const t = traceLib.trace(run, "report-overview");
  assert.equal(t.emittingStage.model, undefined);
  assert.doesNotMatch(JSON.stringify(t), MODEL_ID, "no model identity anywhere in a trace");
});
