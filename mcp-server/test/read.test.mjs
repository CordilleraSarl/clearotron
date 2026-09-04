// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Read-path tests: enumerate / findings / coverage / usage / trace, against the fixture run.
// Lib modules are imported DYNAMICALLY in before() (after _fixture sets CLEAROTRON_WORK_DIR).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildFixture, RUN_ID } from "./_fixture.mjs";

let runs, findings, coverageLib, usage, traceLib;

before(async () => {
  buildFixture();
  runs = await import("../lib/runs.mjs");
  findings = await import("../lib/findings.mjs");
  coverageLib = await import("../lib/coverage.mjs");
  usage = await import("../lib/usage.mjs");
  traceLib = await import("../lib/trace.mjs");
});

test("enumerateRuns finds the fixture run (in-flight)", () => {
  const all = runs.enumerateRuns();
  const r = all.find((x) => x.runId === RUN_ID);
  assert.ok(r, "fixture run present");
  assert.equal(r.location, "in-flight");
  assert.equal(r.markName, "ACME");
  assert.equal(r.state, "running");
});

test("resolveRun by runId and by codename", () => {
  assert.equal(runs.resolveRun(RUN_ID)?.runId, RUN_ID);
  assert.equal(runs.resolveRun("copper-anvil")?.runId, RUN_ID);
  assert.equal(runs.resolveRun("nope-nope"), null);
});

test("loadFindings parses the deterministic audit.md", () => {
  const P = runs.resolveRun(RUN_ID).P;
  const f = findings.loadFindings(P);
  assert.equal(f.source, "audit.md");
  assert.equal(f.findings.length, 2);
  assert.equal(f.negatives.length, 1);
  assert.equal(f.audit.length, 1);
  assert.equal(f.findings[0].id, "F1");
  assert.equal(f.findings[0].owner, "Beta Inc");
  assert.equal(findings.getFinding(P, "F1").owner, "Beta Inc");
});

test("filterFindings by sourceLayer", () => {
  const P = runs.resolveRun(RUN_ID).P;
  const reg = findings.filterFindings(P, { sourceLayer: "Register" });
  assert.equal(reg.items.length, 1);
  assert.equal(reg.items[0].owner, "Beta Inc");
});

test("loadCards surfaces the curated groups", () => {
  const P = runs.resolveRun(RUN_ID).P;
  const c = findings.loadCards(P);
  assert.equal(c.cards.length, 2);
  assert.deepEqual([...new Set(c.cards.map((x) => x.group))].sort(), ["off-field", "on-field"]);
  assert.ok(c.cards[0].read.length > 0);
  // the fixture is an ARCHIVED-shape report.md (authored `- one:` + `### The read`) — that path must
  // keep answering unchanged, which is what this asserts alongside the fresh shape below.
  assert.match(c.cards[0].one, /Live US registration by Beta Inc/);
});

test("#243 — loadCards reads the STAMPED `- net:` line, so a fresh run's cards do not go quiet", async () => {
  // From the driver stamps `- net:` onto each card from the typed findings.json field and the
  // authored `- one:` line is retired. A projection reading `one` alone would return null for every card
  // on every run from that commit forward — a delivered MCP surface going silent with no error.
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "mcp-net-"));
  const report = join(dir, "report.md");
  writeFileSync(report, [
    "---", "type: prelim-clearance", "overall_label: MEDIUM", "---", "",
    "# Marks", "",
    "## Synth Pharma AG — VOLTMAX, EU",
    "- ord: 1",
    "- open: true",
    "- net: The legal risk is a near-identical senior mark over identical class-5 goods.",
    "- group: on-field",
    "- source: Register",
    "### Full detail",
    "- Source: [reg · 1](/mark/eu/1)", "",
  ].join("\n"));
  const c = findings.loadCards({ report });
  assert.equal(c.cards.length, 1);
  assert.equal(c.cards[0].one, "The legal risk is a near-identical senior mark over identical class-5 goods.",
    "the stamped net is what the card surface answers with");
  assert.equal(c.cards[0].group, "on-field");
  // `### The read` is retired by the same ruling, so null here is BY DESIGN, not a parse miss.
  assert.equal(c.cards[0].read, null);
  assert.ok(c.cards[0].fullDetail.length > 0, "the card's remaining depth section still projects");
});

test("coverage reports axes, ledger, completeness", () => {
  const P = runs.resolveRun(RUN_ID).P;
  const c = coverageLib.coverage(P);
  assert.equal(c.coverageLedgerPresent, true);
  const ps = c.registerAxes.find((a) => a.axis === "primary-sweep");
  assert.equal(ps.present, true);
  assert.equal(c.findings, 2);
  assert.equal(c.negativeResults, 1);
});

test("providerUsage recomputes live and agrees with cached", () => {
  const run = runs.resolveRun(RUN_ID);
  const u = usage.providerUsage(run);
  assert.equal(u.live.total, 3);
  assert.equal(u.live.search, 2);
  assert.equal(u.live.record_fetch, 1);
  assert.equal(u.drift, false);
  assert.equal(u.lowConfidence, false);
});

test("trace(stage) walks inputs + the judgment leaf", () => {
  const run = runs.resolveRun(RUN_ID);
  const t = traceLib.trace(run, "report-overview");
  assert.ok(t.emittingStage.inputs.some((i) => i.name === "narrative.md"));
  // every input carries a changedSince flag (false here — fixture untouched)
  assert.ok(t.emittingStage.inputs.every((i) => typeof i.changedSince === "boolean" || i.changedSince === null));
  assert.equal(t.judgment.verdict, "CLEAR");
  assert.ok(t.judgment.skepticEscalated.includes("primary-sweep"));
  // recursion reached an upstream stage
  assert.ok(Array.isArray(t.emittingStage.upstream) && t.emittingStage.upstream.length > 0);
});

test("trace(findingId) attaches the record + audit trail", () => {
  const run = runs.resolveRun(RUN_ID);
  const t = traceLib.trace(run, "F1");
  assert.equal(t.resolvedAs.kind, "finding");
  assert.equal(t.finding.owner, "Beta Inc");
  assert.equal(t.record.url, "https://tm.corsearch.com/mark/us/123");
  assert.ok(Array.isArray(t.auditTrail));
});

test("trace(verdict) explains the gate", () => {
  const run = runs.resolveRun(RUN_ID);
  const t = traceLib.trace(run, "verdict");
  assert.equal(t.resolvedAs.kind, "verdict");
  assert.equal(t.judgment.verdict, "CLEAR");
});

test("getFinding is case-insensitive on the id", () => {
  const P = runs.resolveRun(RUN_ID).P;
  assert.equal(findings.getFinding(P, "f1")?.owner, "Beta Inc");
  assert.equal(findings.getFinding(P, "F1")?.owner, "Beta Inc");
});

test("trace errors on a finding-id-shaped target that doesn't exist (no fuzzy fallthrough)", () => {
  const run = runs.resolveRun(RUN_ID);
  const t = traceLib.trace(run, "F999");
  assert.ok(t.error, "nonexistent finding id should error, not fuzzy-match a different record");
});

test("providerUsage notes honestly when there is no cached value", () => {
  const run = runs.resolveRun(RUN_ID);
  const noCache = { ...run, status: { ...run.status, providerUsage: undefined } };
  const u = usage.providerUsage(noCache);
  assert.equal(u.cached, null);
  assert.match(u.note, /only source|no cached/i);
});

// — the cached tally is keyed by WHICHEVER provider ran. This read named one vendor, so on a
// clarivate/signa/euipo/uspto run it found nothing and reported "no cached value stored" — an absence
// that reads as benign while the drift detector is switched off. The register tier stopped being
// single-vendor at //; this read had not.
test("#594 the drift detector reads the tally the run actually wrote, whatever the provider is", () => {
  const run = runs.resolveRun(RUN_ID);
  const cached = run.status.providerUsage.corsearch;
  for (const provider of ["clarivate", "signa", "euipo", "uspto-local"]) {
    const other = { ...run, status: { ...run.status, providerUsage: { [provider]: cached } } };
    const u = usage.providerUsage(other);
    assert.deepEqual(u.cached, cached, `THE DEFECT: a ${provider} run's stored tally was invisible`);
    assert.equal(u.drift, false, "…and its drift verdict is a measurement, not a null");
  }
  // a tally naming more than one provider is a different fact and is refused rather than half-read
  const two = { ...run, status: { ...run.status, providerUsage: { corsearch: cached, signa: cached } } };
  assert.equal(usage.providerUsage(two).cached, null);
  assert.equal(usage.cachedProviderTally({ providerUsage: { corsearch: "not-an-object" } }), null);
  assert.equal(usage.cachedProviderTally(undefined), null, "an absent status is an absence, not a throw");
});

// ── — the two hand-maintained tables on this read surface ───────────────────────────────────────

// CLOSED: lib/coverage.mjs mirrored 12 of the driver's 21 validator keys by hand. A validator added
// upstream was never run here, `check()` was never called for it, and `coverage().complete` still
// answered TRUE — a completeness surface saying "yes" about a file it does not know exists. The mirror is
// now a partition of `validators` enforced when the module loads.
test("#249: the coverage artifact table is CLOSED against the driver's validators, in both directions", async () => {
  const { validators } = await import("../lib/driver.mjs");
  const { REPORTED_ARTIFACTS, NOT_REPORTED } = await import("../lib/coverage.mjs");
  const known = Object.keys(validators);
  assert.ok(known.length > 15, `only ${known.length} validators reachable — this guard is checking nothing`);
  for (const k of known)
    assert.ok(k in REPORTED_ARTIFACTS || k in NOT_REPORTED, `validator "${k}" is neither reported nor declared out`);
  for (const k of [...Object.keys(REPORTED_ARTIFACTS), ...Object.keys(NOT_REPORTED)])
    assert.ok(known.includes(k), `"${k}" names no validator — a dead key`);
  // Both halves must be non-empty, or "closed" would be satisfied by putting everything on one side.
  assert.ok(Object.keys(NOT_REPORTED).length > 0 && Object.keys(REPORTED_ARTIFACTS).length > 0);
  for (const [k, why] of Object.entries(NOT_REPORTED))
    assert.ok(typeof why === "string" && why.length > 20, `NOT_REPORTED["${k}"] must state why it is off this surface`);
  // The file the whole issue turns on: findings.json is on the coverage surface now.
  assert.ok("findings" in REPORTED_ARTIFACTS, "findings.json must be reported — the run's most-consumed artifact was invisible here");
});

test("#249: an unknown validator key hard-fails the coverage table at load", async () => {
  // The load-time gate, exercised directly: a validator with no declaration is rejected, not skipped.
  const mod = await import("../lib/coverage.mjs");
  const { REPORTED_ARTIFACTS, NOT_REPORTED, assertValidatorCoverage } = mod;
  assert.throws(
    () => assertValidatorCoverage({ ...REPORTED_ARTIFACTS, ...NOT_REPORTED, someNewArtifact: null }),
    /neither reported nor declared out/,
    "a validator nobody placed must fail at load — otherwise artifactStatus() omits it and `complete` answers yes about it");
  assert.throws(
    () => assertValidatorCoverage({ matterContext: null }),
    /name no validator|dead key/,
    "a declaration for an artifact that no longer has a validator must fail too");
  assert.doesNotThrow(() => assertValidatorCoverage(), "the shipped tables must satisfy their own gate");
});

// OPEN: the live-vs-cached comparison keyed on 3 of the 17 counters provider-usage writes, so a run whose
// whole disagreement sat in `enumerate` or `unclassified` reported drift:false.
test("#249: providerUsage drift compares EVERY counter and names the ones that moved", () => {
  const run = runs.resolveRun(RUN_ID);
  const live = usage.providerUsage(run).live;
  // A cached tally that agrees on the three old keys and disagrees on a fourth — invisible before.
  const cached = { ...live, enumerate: (live.enumerate ?? 0) + 7 };
  const u = usage.providerUsage({ ...run, status: { ...run.status, providerUsage: { corsearch: cached } } });
  assert.equal(u.drift, true, "a disagreement outside search/record_fetch/total must still be drift");
  assert.deepEqual(u.driftKeys, ["enumerate"], "…and the response must NAME the counter that moved");
  assert.match(u.note, /enumerate/, "the note names it too — a boolean nobody can act on is the same silence");
  assert.equal(u.ledgerStale, true);
  assert.ok(u.comparedCounters.includes("enumerate") && u.comparedCounters.length > 3,
    "…and the response says which counters the verdict covers, so `drift:false` is never a mute claim");
  // …and agreement on every counter is still agreement.
  const same = usage.providerUsage({ ...run, status: { ...run.status, providerUsage: { corsearch: { ...live } } } });
  assert.equal(same.drift, false);
  assert.deepEqual(same.driftKeys, []);
  // A LEGACY cached shape is not drift: a tally written before a counter existed never recorded a value
  // that could disagree. It is excluded from the comparison, and the response says so rather than
  // reading absence as zero (which would manufacture drift out of a schema change).
  const legacy = usage.providerUsage({ ...run, status: { ...run.status, providerUsage: { corsearch: { search: live.search, record_fetch: live.record_fetch, total: live.total } } } });
  assert.equal(legacy.drift, false, "a 3-counter legacy tally that agrees on all 3 is not drift");
  assert.deepEqual(legacy.comparedCounters, ["record_fetch", "search", "total"], "…and the answer states it covered only those three");
});
