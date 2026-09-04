// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// senior-rights.mjs — seniority ranking + verdict-driving selection (WP-receipts). The ranking fixture
// mirrors the REAL VENZY 9-leg Doruk İlkay cluster from ashen-vault (2026-07-03): the senior right
// is the Turkish 2009 registration; the run verified from the junior UAE 2015 leg; KZ/AL are Expired
// (the model listed dead legs in owner.registrations — liveness is never trusted from the list).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankClusterLegs, verdictDrivingFindings } from "../senior-rights.mjs";

// The VENZY-shaped cluster (dates from the register-index batch-screen `screen` blocks).
const IDX = new Map([
  ["/mark/tr/2009-53984", { applicationDate: "2009-10-14", registrationDate: "2011-11-30", status: "Valid", live_status: "live" }],
  ["/mark/ae/229552", { applicationDate: "2015-03-23", registrationDate: "2016-01-10", status: "Valid", live_status: "live" }],
  ["/mark/sa/2014-1", { applicationDate: "2014-08-27", registrationDate: "2015-02-01", status: "Valid", live_status: "live" }],
  ["/mark/qa/2018-9", { applicationDate: "2018-05-01", status: "Pending", live_status: "live" }],
  ["/mark/kz/999", { applicationDate: "2010-01-01", status: "Expired", live_status: "dead" }],
  ["/mark/al/888", { applicationDate: "2008-06-01", status: "Expired", live_status: "dead" }],
]);
const REGS = [...IDX.keys()].map((uri) => ({ uri }));

test("rankClusterLegs: the VENZY cluster ranks TR-2009 senior; dead legs excluded even when older", () => {
  const { senior, ranked, excluded, unrankable } = rankClusterLegs(REGS, IDX, new Map());
  assert.equal(senior.uri, "/mark/tr/2009-53984", "earliest LIVE registered application wins");
  assert.equal(unrankable, false);
  assert.deepEqual(excluded.map((x) => x.uri).sort(), ["/mark/al/888", "/mark/kz/999"],
    "AL 2008 is older than TR 2009 but DEAD — never a senior-right candidate");
  assert.deepEqual(ranked.map((r) => r.uri), [
    "/mark/tr/2009-53984", "/mark/sa/2014-1", "/mark/ae/229552", "/mark/qa/2018-9",
  ], "registered legs by application date, then the pending application");
});

test("rankClusterLegs: registered beats pending even when the pending application is older", () => {
  const idx = new Map([
    ["/mark/us/1", { applicationDate: "2020-01-01", registrationDate: "2022-01-01", status: "Valid", live_status: "live" }],
    ["/mark/us/2", { applicationDate: "2018-01-01", status: "Pending", live_status: "live" }],
  ]);
  const { senior } = rankClusterLegs([{ uri: "/mark/us/2" }, { uri: "/mark/us/1" }], idx, new Map());
  assert.equal(senior.uri, "/mark/us/1", "a granted right outranks an older application");
});

test("rankClusterLegs: a fetched record's facts refine the index; hint-only clusters are unrankable (honest, never guessed)", () => {
  // the index knows nothing; the fetched record carries the dates → rankable from the record
  const recs = new Map([["/mark/tr/1", { applicationDate: "2009-10-14", registrationDate: "2011-11-30", statusText: "Valid" }]]);
  const r1 = rankClusterLegs([{ uri: "/mark/tr/1" }, { uri: "/mark/xx/2" }], new Map(), recs);
  assert.equal(r1.senior.uri, "/mark/tr/1");
  assert.equal(r1.senior.source, "record");
  // NO record and NO index date for any live leg — model-typed hints alone never rank a senior right
  const r2 = rankClusterLegs([{ uri: "/mark/aa/1", filed: "2001", status: "Registered" }, { uri: "/mark/bb/2", filed: "2005", status: "Registered" }], new Map(), new Map());
  assert.equal(r2.senior, null);
  assert.equal(r2.unrankable, true, "honest state — the caller discloses instead of guessing");
});

test("rankClusterLegs: empty/uri-less input → no senior, not unrankable (nothing to rank)", () => {
  const r = rankClusterLegs([], new Map(), new Map());
  assert.equal(r.senior, null);
  assert.equal(r.unrankable, false);
});

// ── verdictDrivingFindings: the handful that set the delivered tier ───────────────────────────────────
const MANIFEST = { schema_version: 1, framework_key: "house-default", bands: [
  { label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Moderate", tone: "medium" }, { label: "Low", tone: "low" },
] };

test("verdictDrivingFindings: live findings at the WORST live band only; withdrawn and lower bands never drive", () => {
  const findings = [
    { ordinal: 1, mark: "A", band: "High", owner: { registrations: [{ uri: "/mark/tr/1" }] } },
    { ordinal: 2, mark: "B", band: "High", disposition: "withdrawn", owner: { registrations: [{ uri: "/mark/us/9" }] } },
    { ordinal: 3, mark: "C", band: "Moderate", owner: { registrations: [{ uri: "/mark/eu/2" }] } },
    { ordinal: 4, mark: "D", band: "High", owner: { registrations: [] } },
  ];
  const driving = verdictDrivingFindings(findings, MANIFEST);
  assert.deepEqual(driving.map((f) => f.ordinal), [1, 4], "the worst LIVE band is High; withdrawn High and Moderate never drive");
});

test("verdictDrivingFindings: v≤3 archives (no band) and absent manifests are no-ops", () => {
  assert.deepEqual(verdictDrivingFindings([{ ordinal: 1, mark: "A", composite: 9 }], MANIFEST), []);
  assert.deepEqual(verdictDrivingFindings([{ ordinal: 1, mark: "A", band: "High" }], null), []);
});

// ── D1 fail-closed: the lint side of the guarantee (predelivery-lint seniorRightChecks) ──────────────
// `expected` mirrors the pipeline closure's arming condition (frozen framework + v4 findings): an
// EXPECTED receipt that never materialised (the closure crashed before writing senior-rights.json)
// must fail structurally — before D1 the presence-gated check silently passed over exactly that crash.
import { seniorRightChecks } from "../predelivery-lint.mjs";

test("D1 seniorRightChecks: expected-but-absent fails structurally; unexpected absence stays silent (replay shape)", () => {
  const missing = seniorRightChecks({ seniorRights: null, expected: true });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, "senior-rights-present");
  assert.equal(missing[0].pass, false);
  assert.equal(missing[0].structural, true, "a redo cannot conjure the receipt — ships as a visible flag");
  // the replay harness never passes `expected` — archived runs never grow the failure
  assert.deepEqual(seniorRightChecks({ seniorRights: null }), []);
  assert.deepEqual(seniorRightChecks({ seniorRights: null, expected: false }), []);
});

test("D1 seniorRightChecks: present rows keep today's behaviour under `expected` (verified passes; open item fails)", () => {
  const ok = seniorRightChecks({ seniorRights: [{ ordinal: 1, mark: "A", applicable: true, seniorUri: "/mark/tr/1", verified: true }], expected: true });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].id, "senior-right-coverage");
  assert.equal(ok[0].pass, true);
  const open = seniorRightChecks({ seniorRights: [{ ordinal: 1, mark: "A", applicable: true, seniorUri: "/mark/tr/1", verified: false }], expected: true });
  assert.equal(open[0].pass, false);
  assert.equal(open[0].structural, true);
});
