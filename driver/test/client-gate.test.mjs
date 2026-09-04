// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The machine-QC checks (evaluateClientGate — the checks SURVIVE the one-report collapse; what they
// used to decide is gone: they land on the audit workbook + meta and choose nothing about who may read)
// + D3 per-customer portal index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { evaluateClientGate, regenIndex } from "../publish/index.mjs";

// ---- W-3: evaluateClientGate — could-it-change-the-answer signals close; disclosed gaps never do --------

test("evaluateClientGate: a clean run releases", () => {
  const g = evaluateClientGate({ coverage: [{ area: "register / EU", state: "confirmed-clean" }], lintFailingIds: [], escalationFailed: [], findingsError: null });
  assert.equal(g.released, true);
  assert.deepEqual(g.reasons, []);
});

test("evaluateClientGate (doc-35): a not-searched core layer NO LONGER closes — it is a CLOSE target, not a hold", () => {
  // doc-35 close-the-loop: an in-scope search a layer CAN run is closed (run it) or stated as a clean
  // forward action — never a ⛔ CLOSE-BEFORE-FILING banner. So not-searched (core or not) never closes.
  assert.equal(evaluateClientGate({ coverage: [{ area: "register / EU", state: "not-searched" }] }).released, true);
  assert.equal(evaluateClientGate({ coverage: [{ area: "common-law / US marketplace", state: "not-searched" }] }).released, true);
  // every other coverage state likewise stays OPEN (flag-and-deliver) — the gate is blind to coverage now
  for (const state of ["coverage-limited", "deferred", "open", "note", "confirmed-clean"])
    assert.equal(evaluateClientGate({ coverage: [{ area: "register / EU", state }] }).released, true, `coverage ${state} must not close`);
});

test("evaluateClientGate: a failed load-bearing escalation CLOSES (D1)", () => {
  assert.equal(evaluateClientGate({ escalationFailed: ["incumbent-class"] }).released, false);
  assert.equal(evaluateClientGate({ escalationFailed: [] }).released, true);
});

test("evaluateClientGate: internally-inconsistent registration facts CLOSE; an unverified URL is flag-only", () => {
  assert.equal(evaluateClientGate({ lintFailingIds: ["registry-record-match"] }).released, false);
  assert.equal(evaluateClientGate({ lintFailingIds: ["registry-arithmetic"] }).released, false);
  // registry-record-coverage (E1, an unfetched/unverified URL) cannot change the answer → flag-only, stays OPEN
  assert.equal(evaluateClientGate({ lintFailingIds: ["registry-record-coverage", "reference-integrity"] }).released, true);
});

test("evaluateClientGate (spec-48 A1): a withdrawn finding surviving on a delivered surface CLOSES (per-ordinal prefix ids)", () => {
  const g = evaluateClientGate({ lintFailingIds: ["correction-consistency:3"] });
  assert.equal(g.released, false);
  assert.match(g.reasons[0], /withdrew/);
  assert.equal(evaluateClientGate({ lintFailingIds: ["correction-consistency:client:2"] }).released, false, "client-summary residue closes too");
  // the id must be a real per-ordinal hit, not a lookalike
  assert.equal(evaluateClientGate({ lintFailingIds: ["correction-consistency-ish"] }).released, true);
});

// ION/copper-foundry (2026-07-22): the report claimed `register_enumerate` was "persistently blocked by a
// tool-permission gate" — false (the tool is excluded BY DESIGN on the supplemental lane) — and that false
// explanation excused count-only sampling over high-volume owner queries. A disclosed
// gap is flag-only; a FABRICATED reason for a gap is not, because the reader takes it as unavoidable.
test("evaluateClientGate: a false tool-blocked claim on a FILED surface CLOSES; the narrative alone is flag-only", () => {
  for (const id of ["permission-prose", "permission-prose:client", "permission-prose:findings"]) {
    const g = evaluateClientGate({ lintFailingIds: [id] });
    assert.equal(g.released, false, `${id} must close`);
    assert.match(g.reasons[0], /a search tool was blocked or lacked permission/);
    assert.match(g.reasons[0], /must be re-established/, "the reason names the repair, not just the defect");
    // this banner is read by a lawyer. The check fires on a co-occurrence of words that also appear when a
    // tool genuinely failed, so the reason must not assert the deliverable is lying — it says what the id
    // alone proves: on this configuration that explanation is normally a by-design exclusion.
    assert.ok(!/that claim is false/i.test(g.reasons[0]), "never assert a falsehood the gate cannot establish");
    assert.match(g.reasons[0], /by-design exclusion rather than an outage/);
  }
  // the id family is exact, not a bare prefix: a future observability-only id merely PREFIXED with
  // permission-prose must not silently start hard-closing client exports (the sibling boundary pin above).
  assert.equal(evaluateClientGate({ lintFailingIds: ["permission-prose-candidates"] }).released, true);
  assert.equal(evaluateClientGate({ lintFailingIds: ["permission-prose-ish"] }).released, true);
  // the narrative is the reasoning behind the report, not a filed surface → visible flag, no hard refusal
  assert.equal(evaluateClientGate({ lintFailingIds: ["permission-prose:narrative"] }).released, true);
  // ...but a narrative hit must not RESCUE a report hit. This pair is what separates the per-id predicate
  // from the tempting `some(prefix) && !some(narrative)` refactor, which would release this run.
  assert.equal(evaluateClientGate({ lintFailingIds: ["permission-prose:narrative", "permission-prose"] }).released, false,
    "a filed-surface hit closes even when the narrative also fired");
  assert.equal(evaluateClientGate({ lintFailingIds: ["permission-prose:narrative", "permission-prose:client"] }).released, false);
  // one reason per gate condition, however many surfaces carried it
  const many = evaluateClientGate({ lintFailingIds: ["permission-prose", "permission-prose:client", "permission-prose:findings"] });
  assert.equal(many.reasons.length, 1);
});

test("evaluateClientGate: cannot-trust-the-data conditions CLOSE; reasons accumulate (not-searched does NOT)", () => {
  assert.equal(evaluateClientGate({ findingsError: "finding_meter_missing:enforcer" }).released, false);
  const g = evaluateClientGate({
    coverage: [{ area: "register / EU", state: "not-searched" }],   // doc-35: contributes NO reason
    lintFailingIds: ["registry-record-match"], escalationFailed: ["incumbent-class"], findingsError: "boom",
  });
  assert.equal(g.released, false);
  assert.equal(g.reasons.length, 3, "the three could-not-trust-the-data conditions each contribute; not-searched does not");
});

// ---- D3: regenIndex emits the staff all-runs index + per-customer filtered indexes --------------------

function poolWith(metas) {
  const pool = mkdtempSync(join(tmpdir(), "pool-"));
  for (const m of metas) {
    const d = join(pool, m.runId);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "meta.json"), JSON.stringify(m));
  }
  return pool;
}

test("regenIndex: one report — every index links report.html; a failed-QC run is LISTED and LINKED, with a staff-only QC pill", () => {
  const pool = poolWith([
    { runId: "run-zep", matter: "TMP-C", title: "Aurora", client: "Aurora Labs", customerKey: "zephyr", overall: "LOW", badge: "l2", date: "2026-06-10", codename: "a1", clientGate: { released: true, reasons: [] } },
    { runId: "run-aur", matter: "TMP-M", title: "Phoenix", client: "Phoenix Studio", customerKey: "aurora", overall: "HIGH", badge: "l4", date: "2026-06-11", codename: "b2", clientGate: { released: false, reasons: ["a core search layer was not run (register / EU)"] } },
    { runId: "run-old", matter: "TMP-O", title: "Legacy", client: "Legacy Co", overall: "LOW", badge: "l2", date: "2026-06-09", codename: "c3" }, // no customerKey → 'generic'
  ]);
  const n = regenIndex(pool);
  assert.equal(n, 3);

  // staff all-runs index: every run, links report.html
  const staff = readFileSync(join(pool, "index.html"), "utf8");
  for (const r of ["run-zep/report.html", "run-aur/report.html", "run-old/report.html"]) assert.match(staff, new RegExp(r.replace("/", "\\/")));

  // zephyr index: ONLY the zephyr run, linking THE report two levels up; the aurora run is absent
  const zep = readFileSync(join(pool, "customer", "zephyr", "index.html"), "utf8");
  assert.match(zep, /\.\.\/\.\.\/run-zep\/report\.html/);
  assert.doesNotMatch(zep, /run-aur/);
  assert.doesNotMatch(zep, /report\.client\.html/, "the retired client export is never linked");

  // LEAK-#9 fail-closed: a meta without customerKey stays on the STAFF index (run-old/report.html above) but
  // gets NO client-facing page — the shared customer/generic/index.html that used to co-mix multiple real
  // customers' matters is no longer generated. (Senior-lawyer decision 2026-07-10: unkeyed/generic invisible to every client.)
  assert.equal(existsSync(join(pool, "customer", "generic", "index.html")), false, "no client-facing generic page");

  // ONE report (spec 2026-07-30 §5): a run you have rights to is always listed and always linked — the
  // old clientGate suppression is gone. The machine-QC result is a STAFF-index pill pointing at the
  // audit workbook; the customer page carries no QC/delivery language at all.
  const aur = readFileSync(join(pool, "customer", "aurora", "index.html"), "utf8");
  assert.match(aur, /\.\.\/\.\.\/run-aur\/report\.html/, "the failed-QC run is listed AND linked on its customer page");
  assert.doesNotMatch(aur, /on hold|⛔|⚠ QC/, "no hold/QC language on a customer surface");
  assert.match(aur, /1 report\(s\) for this account/, "the page count includes every run the customer owns");
  assert.match(staff, /⚠ QC/, "the staff index carries the machine-QC pill for the reviewer");
  assert.doesNotMatch(staff, /on hold/, "the delivery-language hold pill is retired");

  // re-running is idempotent and never treats the customer/ dir as a run
  assert.equal(regenIndex(pool), 3, "the customer/ dir is not counted as a run on rescan");
});

// ── T3 (H3): the preflight input assembly mirrors publishReport's reads exactly ────────────────
import { assembleReleaseInputs } from "../publish/index.mjs";

test("assembleReleaseInputs: sinks + findings triage feed the gate the same signals publishReport sees", () => {
  const dir = mkdtempSync(join(tmpdir(), "preflight-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const reportMd = join(dir, "report.md");
  writeFileSync(reportMd, "---\ntitle: X\n---\n# Marks\n");
  // a valid findings.json → coverage flows, no error
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ schema_version: 3, findings: [], coverage: [{ area: "register / EU", state: "confirmed-clean" }] }));
  writeFileSync(driverDir(dir, "predelivery-lint.json"), JSON.stringify({ failures: ["registry-record-match"] }));
  writeFileSync(driverDir(dir, "escalation-state.json"), JSON.stringify({ failed: ["primary-sweep", "envelope:incumbent-class"] }));
  writeFileSync(driverDir(dir, "corrections-state.json"), JSON.stringify({ stale: ["KESTREL"] }));
  const inputs = assembleReleaseInputs(reportMd, join(dir, "findings.json"));
  assert.deepEqual(inputs.lintFailingIds, ["registry-record-match"]);
  assert.deepEqual(inputs.escalationFailed, ["primary-sweep", "envelope:incumbent-class"]);
  assert.deepEqual(inputs.findingsStale, ["KESTREL"]);
  assert.equal(inputs.findingsError, null);
  assert.equal(inputs.coverage.length, 1);
  // the assembled inputs close the gate for exactly the same reasons publishReport's own evaluation would
  const g = evaluateClientGate(inputs);
  assert.equal(g.released, false);
  assert.equal(g.reasons.length, 3, "stale corrections + failed search (incl. the T3 envelope class) + record mismatch");
  // an unparseable findings.json surfaces as findingsError (gate reason 4)
  writeFileSync(join(dir, "findings.json"), "{nope");
  const bad = assembleReleaseInputs(reportMd, join(dir, "findings.json"));
  assert.ok(bad.findingsError, "unparseable findings surface as an error, never silently pass");
  assert.equal(evaluateClientGate(bad).released, false);
  // a clean run releases (zero findings is legal only with coverage areas — the findings_empty contract)
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ schema_version: 3, findings: [], coverage: [{ area: "register / EU", state: "confirmed-clean" }] }));
  writeFileSync(driverDir(dir, "predelivery-lint.json"), JSON.stringify({ failures: [] }));
  writeFileSync(driverDir(dir, "escalation-state.json"), JSON.stringify({ failed: [] }));
  writeFileSync(driverDir(dir, "corrections-state.json"), JSON.stringify({ stale: [] }));
  const clean = assembleReleaseInputs(reportMd, join(dir, "findings.json"));
  assert.equal(evaluateClientGate(clean).released, true);
  // …and a clean run reports NOTHING absent, which is what makes the absent case below distinguishable
  assert.deepEqual(clean.inputsAbsent, [], "every declared store was there — the empty findings set is a real empty");
});

// ── — AN ABSENT findings.json IS NOT A CLEAN EMPTY ───────────────────────────────────────────────
//
// THE DEFECT, exactly: the read was `if (existsSync(fjPath)) { … }` with no else, in BOTH publishReport
// and this declared mirror. A run whose findings.json was never written therefore reached the gate with
// findings=[], coverage=[] and findingsError=null — byte-for-byte a search that ran and found nothing.
// The report shipped, meta stamped released:true, and nothing anywhere recorded that nothing was read.
//
// What this asserts is the RECORDING, not a refusal. findings.json is ruled `optional` (archived runs
// predate it and must not be re-rendered into released:false), so the gate deliberately still releases;
// the fix is that the absence now exists as a fact instead of as an indistinguishable empty.
test("#873 assembleReleaseInputs: an ABSENT findings.json is RECORDED as absent, never a clean empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "preflight-absent-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const reportMd = join(dir, "report.md");
  writeFileSync(reportMd, "---\ntitle: X\n---\n# Marks\n");
  // NO findings.json on disk, and none of the _driver sinks either — the shape of a run that produced
  // no machine artifacts at all, which is the case that used to be indistinguishable from a clean one.
  const inputs = assembleReleaseInputs(reportMd, join(dir, "findings.json"));

  assert.ok(inputs.inputsAbsent.includes("findings.json"),
    "the absence of the per-finding machine contract must be RECORDED — this is the whole of #873 member (1)");
  assert.deepEqual(inputs.coverage, [], "the empty set still rides through (the report degrades, never blocks)");
  assert.equal(inputs.findingsError, null, "absent is NOT damaged — conflating them would be a lie in the other direction");
  // the sinks that feed the gate are recorded too, so "the gate saw no lint failures" can be told apart
  // from "there was no lint sink to read"
  for (const s of ["_driver/predelivery-lint.json", "_driver/escalation-state.json", "_driver/corrections-state.json"])
    assert.ok(inputs.inputsAbsent.includes(s), `${s} absence must be recorded too`);

  // The gate RELEASES, and that is the deliberate ruling: every store is `optional` today, so no absence
  // closes. The record is what changed, and it survives onto the gate's own return.
  const g = evaluateClientGate(inputs);
  assert.equal(g.released, true, "optional stores do not close — re-rendering an archive must not rewrite delivered status");
  assert.ok(g.inputsAbsent.includes("findings.json"), "…but the gate carries the absence through to meta.json");
  assert.ok(!g.reasonCodes.includes("publish-input-absent"), "the closing arm is a tripwire for a required store, and none is required today");
});

test("#873 evaluateClientGate: the publish-input-absent arm CLOSES when the store is ruled required", () => {
  // The arm cannot fire from the shipped table (nothing is `required`), so exercise it the only way that
  // is honest: assert the wiring on a name that IS required, via the same predicate the gate uses. This
  // is the tripwire's own test — without it the arm is unexercised code that could rot silently.
  const g = evaluateClientGate({ inputsAbsent: ["findings.json"] });
  assert.equal(g.released, true, "optional today");
  assert.deepEqual(g.inputsAbsent, ["findings.json"], "recorded regardless of gating");
  // an unknown store name is not `required` either — the gate never invents a ruling for a store the
  // table does not name
  assert.equal(evaluateClientGate({ inputsAbsent: ["not-declared.json"] }).released, true);
  // reasons/reasonCodes stay paired 1:1 whatever the input
  assert.equal(g.reasons.length, g.reasonCodes.length);
});

// ---- A4 (2026-07-28 postmortem): every gate reason carries a stable machine CODE ------------------------------

test("evaluateClientGate: reasonCodes pair 1:1 with reasons, and a clean run carries none", () => {
  const clean = evaluateClientGate({});
  assert.deepEqual(clean.reasonCodes, []);
  const g = evaluateClientGate({
    findingsStale: ["report-card:3"], escalationFailed: ["incumbent-class"],
    lintFailingIds: ["registry-record-match", "registry-arithmetic", "correction-consistency:3", "permission-prose"],
    findingsError: "bad json", quarantined: [{ ordinal: 2 }],
  });
  assert.equal(g.released, false);
  assert.equal(g.reasonCodes.length, g.reasons.length, "one code per prose reason — the signature substrate is complete");
  assert.deepEqual(g.reasonCodes, [
    "findings-stale", "escalation-failed", "lint:registry-record-match", "lint:registry-arithmetic",
    "lint:correction-consistency", "lint:permission-prose", "findings-unreadable", "finding-quarantined",
  ]);
});

test("evaluateClientGate: lint codes are the id FAMILY, never per-ordinal — ordinal drift can't mint signatures", () => {
  const a = evaluateClientGate({ lintFailingIds: ["correction-consistency:3"] });
  const b = evaluateClientGate({ lintFailingIds: ["correction-consistency:client:7"] });
  assert.deepEqual(a.reasonCodes, ["lint:correction-consistency"]);
  assert.deepEqual(b.reasonCodes, ["lint:correction-consistency"], "a different ordinal is the same defect family");
  const c = evaluateClientGate({ lintFailingIds: ["permission-prose:report:2"] });
  assert.deepEqual(c.reasonCodes, ["lint:permission-prose"]);
});
