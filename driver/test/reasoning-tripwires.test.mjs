// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Pure tests for the v5 Appendix-A reasoning tripwire net. Each tripwire reads only mechanical run
// artifacts; these fixtures are the catastrophic-miss shapes each one exists to catch, plus a clean
// counterpart that must NOT trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findRecallFloorViolations, findReviewFreshnessViolation, findSeedNeutralityViolations,
  findProbativeGradingViolations, findStatusHonestyViolation, acpCeiling, findMatrixCeilingViolations,
  findDeadlineUrgencyMiss, findUnresolvedDisagreements, findOrphanVerificationFlags,
} from "../reasoning-tripwires.mjs";

const negMatrix = (rows) =>
  `## Findings\n(none)\n\n### Negative results\n| Mark | Search Term / Variant | Result | Notes |\n|---|---|---|---|\n${rows.join("\n")}\n`;

test("recall-floor: identical-name live in-scope drop not carried → trips", () => {
  const md = negMatrix([
    "| NOVAPULSE | NOVAPULSE | dropped (relevance gate / off-field) | URI /mark/us/12345; screen_verdict=surface:in-scope-live; class=9; status=live; crowded |",
  ]);
  const v = findRecallFloorViolations(md, { carriedMarks: ["RAZER NOVAPULSE"], searchedNames: ["NOVAPULSE"], inScopeClasses: ["9"] });
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.match(v[0].why, /identical name in the applicant/i);
});

test("recall-floor: in-scope established by screen verdict when no class list supplied", () => {
  const md = negMatrix([
    "| NOVAPULSE | NOVAPULSE | dropped (off-field) | URI /mark/us/1; screen_verdict=surface:all-class; status=live; |",
  ]);
  const v = findRecallFloorViolations(md, { carriedMarks: [], searchedNames: ["novapulse"] });
  assert.equal(v.length, 1);
});

test("recall-floor: clean cases do NOT trip (carried / dead / out-of-scope / non-identical)", () => {
  const carried = negMatrix(["| NOVAPULSE | NOVAPULSE | dropped | URI /mark/us/1; screen_verdict=surface:in-scope-live; class=9; status=live; |"]);
  assert.equal(findRecallFloorViolations(carried, { carriedMarks: ["NOVAPULSE"], searchedNames: ["NOVAPULSE"], inScopeClasses: ["9"] }).length, 0, "carried elsewhere");
  const dead = negMatrix(["| NOVAPULSE | NOVAPULSE | dropped | URI /mark/us/1; screen_verdict=surface:in-scope-live; class=9; status=dead; |"]);
  assert.equal(findRecallFloorViolations(dead, { searchedNames: ["NOVAPULSE"], inScopeClasses: ["9"] }).length, 0, "dead");
  const oos = negMatrix(["| NOVAPULSE | NOVAPULSE | dropped | URI /mark/us/1; screen_verdict=surface:in-scope-live; class=3; status=live; |"]);
  assert.equal(findRecallFloorViolations(oos, { searchedNames: ["NOVAPULSE"], inScopeClasses: ["9"] }).length, 0, "out of scope class");
  const other = negMatrix(["| ZEPHYR | NOVAPULSE | dropped | URI /mark/us/1; screen_verdict=surface:in-scope-live; class=9; status=live; |"]);
  assert.equal(findRecallFloorViolations(other, { searchedNames: ["NOVAPULSE"], inScopeClasses: ["9"] }).length, 0, "different name");
  assert.equal(findRecallFloorViolations(carried, { searchedNames: [] }).length, 0, "no searched names → no-op");
});

test("review-freshness: a review with no fresh input trips; a 'Fresh probe:' line or new URL passes", () => {
  assert.equal(findReviewFreshnessViolation("", {}), null, "no review → null");
  const stale = findReviewFreshnessViolation("CONDITIONAL\nThe narrative is consistent with placement-recommendations.", { upstreamTexts: ["..."] });
  assert.equal(stale.pass, false);
  const probed = findReviewFreshnessViolation("CONDITIONAL\nFresh probe: CHROME class 9 → https://tmsearch/x confirms a live mark.", {});
  assert.equal(probed.pass, true);
  const newUrl = findReviewFreshnessViolation("CLEAR\nVerified at https://new.example/mark/9 (not upstream).", { upstreamTexts: ["only https://old.example here"] });
  assert.equal(newUrl.pass, true);
});

test("seed-neutrality: a graded / 'do not soften' seed trips; placement vocabulary does not", () => {
  const bad = findSeedNeutralityViolations([
    { name: "matter-context", text: "Seed #1: Razer (Composite: 4, must not be softened downstream)." },
  ]);
  assert.ok(bad.some((v) => /do not soften|softened/i.test(v.why)), JSON.stringify(bad));
  assert.ok(bad.some((v) => /Composite/i.test(v.why)));
  const ok = findSeedNeutralityViolations([
    { name: "placements", text: "Razer NOVAPULSE — placement: headline-candidate. Partner-ecosystem owner; facts only." },
  ]);
  assert.equal(ok.length, 0, JSON.stringify(ok));
});

test("probative-grading: enforcer=high without bears_on trips when adopted; legacy v1 is exempt", () => {
  const mk = (extra) => ({ ordinal: 1, mark: "RAZER NOVAPULSE", meters: { enforcer: { token: "high", basis: "inferred-from-signal" } }, ...extra });
  // adopted (schema_version 2) + no bears_on → trip
  const a = findProbativeGradingViolations({ schemaVersion: 2, findings: [mk({})] });
  assert.equal(a.length, 1, JSON.stringify(a));
  // adopted via a sibling carrying bears_on, this one missing → trip
  const b = findProbativeGradingViolations({ findings: [mk({}), { ordinal: 2, mark: "X", bears_on: "asserts NOVAPULSE in class 9", meters: { enforcer: { token: "low" } } }] });
  assert.equal(b.length, 1);
  // adopted + bears_on present → clean
  const c = findProbativeGradingViolations({ schemaVersion: 2, findings: [mk({ bears_on: "Razer enforces NOVAPULSE on lighting in class 9, the disputed element" })] });
  assert.equal(c.length, 0);
  // legacy v1, no bears_on anywhere → exempt (no regression)
  const d = findProbativeGradingViolations({ schemaVersion: 1, findings: [mk({})] });
  assert.equal(d.length, 0);
});

test("status-honesty: a clean headline over a material gap trips; a gap honestly stated passes", () => {
  assert.equal(findStatusHonestyViolation([], "Verdict: CLEAR"), null, "no gap → null");
  const gaps = [{ unit: "primary-sweep / EU", status: "deferred" }];
  assert.equal(findStatusHonestyViolation(gaps, "Verdict: CLEAR — no conflicts worldwide.").pass, false);
  assert.equal(findStatusHonestyViolation(gaps, "Verdict: CONDITIONAL — EU primary sweep deferred; coverage incomplete.").pass, true);
});

test("#6 deadline-urgency: a near-term client deadline trips; far-future / long-past / absent do not", () => {
  const NOW = Date.parse("2026-06-19T00:00:00Z");
  const mk = (deadline) => ({ ordinal: 1, mark: "PHINIA", deadline });
  const day = 86400000;
  // due in 30 days → trip (action window)
  const a = findDeadlineUrgencyMiss({ findings: [mk({ kind: "opposition", date: "2026-07-19" })] }, { nowMs: NOW });
  assert.equal(a.length, 1, JSON.stringify(a));
  assert.match(a[0].why, /time-critical ACTION/i);
  assert.equal(a[0].kind, "opposition");
  // lapsed 5 days ago → still trip (within grace — a late action may reach)
  assert.equal(findDeadlineUrgencyMiss({ findings: [mk({ kind: "statement-of-use", date: new Date(NOW - 5 * day).toISOString() })] }, { nowMs: NOW }).length, 1);
  // far future (200 days) → no trip
  assert.equal(findDeadlineUrgencyMiss({ findings: [mk({ kind: "renewal", date: new Date(NOW + 200 * day).toISOString() })] }, { nowMs: NOW }).length, 0);
  // long past (60 days ago, beyond grace) → no trip
  assert.equal(findDeadlineUrgencyMiss({ findings: [mk({ date: new Date(NOW - 60 * day).toISOString() })] }, { nowMs: NOW }).length, 0);
  // adoption-gated: a legacy finding with NO deadline → no trip
  assert.equal(findDeadlineUrgencyMiss({ findings: [{ ordinal: 1, mark: "X" }] }, { nowMs: NOW }).length, 0);
  // no clock supplied → cannot judge (offline) → no trip
  assert.equal(findDeadlineUrgencyMiss({ findings: [mk({ date: "2026-07-19" })] }, {}).length, 0);
  // unparseable date → left to the reasoning layer
  assert.equal(findDeadlineUrgencyMiss({ findings: [mk({ date: "sometime soon" })] }, { nowMs: NOW }).length, 0);
});

test("#7 unresolved-disagreement: a Disagreement-resolutions row with no/placeholder resolution trips; a real one passes", () => {
  const md = (rows) => `## Findings\n\n### Disagreement resolutions\n| Disagreement | Resolution |\n|---|---|\n${rows.join("\n")}\n`;
  // empty resolution → trip
  const a = findUnresolvedDisagreements(md(["| placement-inquiry placed PHINIA at watchlist, class-match said headline | |"]));
  assert.equal(a.length, 1, JSON.stringify(a));
  assert.match(a[0].why, /no resolution/i);
  // placeholder (pending / tbd) → trip
  assert.equal(findUnresolvedDisagreements(md(["| X deviated | pending |", "| Y deviated | TBD |"])).length, 2);
  // a real resolution → pass
  assert.equal(findUnresolvedDisagreements(md(["| PHINIA placement | ADOPTED placement-inquiry — cl.12 auto-parts is off-field |"])).length, 0);
  // no table at all (legacy / no disagreements) → nothing
  assert.equal(findUnresolvedDisagreements("## Findings\n(none)\n").length, 0);
});

test("#8 orphan-finding: a register-sourced finding with no grounding registration trips; grounded / common-law do not", () => {
  const mk = (over) => ({ ordinal: 1, mark: "BIODEL", source: { source_type: "register-vendor" }, owner: { name: "Acme", registrations: [] }, ...over });
  // register finding, empty registrations → orphan
  const a = findOrphanVerificationFlags({ findings: [mk({})] });
  assert.equal(a.length, 1, JSON.stringify(a));
  assert.match(a[0].why, /orphan/i);
  // register-euipo, registration with no uri → still orphan
  assert.equal(findOrphanVerificationFlags({ findings: [mk({ source: { source_type: "register-euipo" }, owner: { name: "Acme", registrations: [{ uri: "  " }] } })] }).length, 1);
  // register finding WITH a grounding uri → clean
  assert.equal(findOrphanVerificationFlags({ findings: [mk({ owner: { name: "Acme", registrations: [{ uri: "/mark/eu/018553557" }] } })] }).length, 0);
  // common-law finding with no registration → legitimate, NOT an orphan
  assert.equal(findOrphanVerificationFlags({ findings: [mk({ source: { source_type: "common-law-marketplace" } })] }).length, 0);
  // case-law finding → not policed here
  assert.equal(findOrphanVerificationFlags({ findings: [mk({ source: { source_type: "case-law" } })] }).length, 0);
});

test("acpCeiling: the ACP matrix ceilings (Appendix B)", () => {
  assert.equal(acpCeiling("A", "classic"), 1);
  assert.equal(acpCeiling("B", "horse-trade"), 2);
  assert.equal(acpCeiling("C", "classic"), 3, "C tops out at Medium regardless of dispute type");
  assert.equal(acpCeiling("C", "horse-trade"), 3);
  assert.equal(acpCeiling("D", "classic"), 5);
  assert.equal(acpCeiling("E", "classic"), 5);
  assert.equal(acpCeiling("D", "horse-trade"), 4);
  assert.equal(acpCeiling("D", "nuisance-claim"), 4);
  assert.equal(acpCeiling("D", "paper-conflict"), 3);
  assert.equal(acpCeiling("E", "descriptive-terms"), 3);
});

test("matrix-ceiling: the RAZER NOVAPULSE defect (Level C → Composite 4) trips; matrix-faithful ratings pass", () => {
  // RAZER NOVAPULSE: "Level C legal read" rated Composite 4/HIGH on an aggressive-enforcer adjustment
  const razer = findMatrixCeilingViolations({ findings: [{ ordinal: 1, mark: "RAZER NOVAPULSE", composite: 4, level: "C", dispute_type: "horse-trade" }] });
  assert.equal(razer.length, 1, JSON.stringify(razer));
  assert.match(razer[0].why, /caps it at 3/);
  // matrix-faithful: Ember Guard C + horse-trade = 3; a genuine 5 = E + classic; B = 2 → all pass
  const ok = findMatrixCeilingViolations({ findings: [
    { ordinal: 1, mark: "EMBER GUARD", composite: 3, level: "C", dispute_type: "horse-trade" },
    { ordinal: 2, mark: "DEPTH SENSE", composite: 5, level: "E", dispute_type: "classic" },
    { ordinal: 3, mark: "X", composite: 2, level: "B", dispute_type: "nuisance-claim" },
  ] });
  assert.equal(ok.length, 0, JSON.stringify(ok));
  // a below-ceiling rating (extra conservatism) does NOT trip
  assert.equal(findMatrixCeilingViolations({ findings: [{ ordinal: 1, mark: "Y", composite: 2, level: "D", dispute_type: "paper-conflict" }] }).length, 0);
});

// ── copper-lattice: the two new S1 siblings ─────────────────────────────────────────────────────────────
test("findUncrossCheckedDemotions: owner signal with no executed receipt flags; carried/executed suppress; no receipt ⇒ []", async () => {
  const { findUncrossCheckedDemotions } = await import("../reasoning-tripwires.mjs");
  const signals = [
    { source: "finding", owner: "Xyience", markText: "FROSTBERRY", url: "https://x", term: null, platform: null },
    { source: "finding", owner: "Carried Corp", markText: "KEPT", url: null, term: null, platform: null },
    { source: "matrix", owner: null, term: "frostplum", platform: "amazon" },
  ];
  const receipt = { directives: [{ qid: "xcheck-owner-xyience", owner: "Xyience" }, { qid: "xcheck-owner-carried-corp", owner: "Carried Corp" }] };
  // no executed qids, nothing carried → Xyience and Carried Corp both flag
  assert.equal(findUncrossCheckedDemotions(signals, { xcheckReceipt: receipt }).length, 2);
  // executed directive suppresses
  const v1 = findUncrossCheckedDemotions(signals, { xcheckReceipt: receipt, executedQids: ["xcheck-owner-xyience"] });
  assert.equal(v1.length, 1);
  assert.equal(v1[0].owner, "Carried Corp");
  // carried-as-finding suppresses
  const v2 = findUncrossCheckedDemotions(signals, { xcheckReceipt: receipt, executedQids: ["xcheck-owner-xyience"], carriedOwners: ["Carried Corp"] });
  assert.equal(v2.length, 0);
  // pre-xcheck runs (no receipt) — replay purity
  assert.equal(findUncrossCheckedDemotions(signals, { xcheckReceipt: null }).length, 0);
  // owner-less signals never flag (mark-text recheck is the dispatcher's job, not a demotion)
  assert.equal(findUncrossCheckedDemotions([signals[2]], { xcheckReceipt: receipt }).length, 0);
});

test("findRecallRegressionViolations: carried passes, fetched+drop-row-cited justifies, else flags with materiality", async () => {
  const { findRecallRegressionViolations } = await import("../reasoning-tripwires.mjs");
  const knownConflicts = { schema_version: 1, marks: {
    "vibrante frostplum": [
      { uri: "/mark/us/90491258", mark_text: "Xyience FROSTBERRY", classes: [32], status: "live" },
      { uri: "/mark/us/11111111", mark_text: "CARRIEDMARK", classes: [32], status: "live" },
      { uri: "/mark/us/22222222", mark_text: "JUSTIFIEDMARK", classes: [32], status: "live" },
      { uri: "/mark/eu/offscope", mark_text: "OFFSCOPE", classes: [7], status: "live" },
    ],
    "other mark": [{ uri: "/mark/us/99999999", mark_text: "OTHER", classes: [32], status: "live" }],
  } };
  const registerFindingsMd = [
    "## Negative results", "",
    "| Mark | Search Term / Variant | Result | Notes |",
    "| --- | --- | --- | --- |",
    "| JUSTIFIEDMARK | frostplum | dropped | URI /mark/us/22222222; screen_verdict=surface:in-scope-live; class=32; status=live; goods reviewed — different field |",
  ].join("\n");
  const out = findRecallRegressionViolations({
    knownConflicts,
    searchedNames: ["VIBRANTE FROSTPLUM"],
    carriedUris: ["/mark/us/11111111"],
    fetchedUris: ["/mark/us/22222222"],
    registerFindingsMd,
    inScopeClasses: ["32"],
  });
  assert.equal(out.length, 2, "FROSTBERRY (unjustified) + OFFSCOPE (uncarried) flag; carried + justified pass; other-mark rows scoped out");
  const frost = out.find((v) => v.uri === "/mark/us/90491258");
  assert.ok(frost && frost.material === true, "the FROSTBERRY anchor is MATERIAL (live, class 32 in scope)");
  const off = out.find((v) => v.uri === "/mark/eu/offscope");
  assert.ok(off && off.material === false, "an off-scope class flags for the eye but is not material");
  // fetched but NOT drop-row-cited is not justification
  const out2 = findRecallRegressionViolations({ knownConflicts, searchedNames: ["VIBRANTE FROSTPLUM"], carriedUris: [], fetchedUris: ["/mark/us/90491258"], registerFindingsMd: "", inScopeClasses: ["32"] });
  assert.ok(out2.some((v) => v.uri === "/mark/us/90491258"), "a fetch alone is not a justification — the drop row must cite the uri");
  // absent fixture ⇒ [] (replay purity)
  assert.equal(findRecallRegressionViolations({ knownConflicts: null }).length, 0);
});

test("recall-regression canonicalizes the STORE side: a full-URL store row vs a carried canonical uri is NOT a violation (and vice versa a real miss still trips)", async () => {
  const { findRecallRegressionViolations, formatRecallRegression } = await import("../reasoning-tripwires.mjs");
  const knownConflicts = { schema_version: 1, marks: { "glimmerpeak": [
    // the class-fix shape: a human-edited/legacy row holding the FULL provider URL
    { uri: "https://tm.corsearch.com/mark/int/1054099", mark_text: "GLIMMER PIQUE", classes: [41], status: "live", owner: "Maison Voltique SARL" },
    { uri: "https://tm.corsearch.com/mark/us/90121212", mark_text: "FROSTWICK", classes: [41], status: "live", owner: "Alderline GmbH" },
  ] } };
  // carried as the canonical /mark path (the pipeline normalizes the carried side) ⇒ NOT a violation
  const out = findRecallRegressionViolations({
    knownConflicts, searchedNames: ["GLIMMERPEAK"],
    carriedUris: ["/mark/int/1054099"], fetchedUris: [], registerFindingsMd: "", inScopeClasses: ["41"],
  });
  assert.ok(!out.some((v) => /1054099/.test(v.uri)), "full-URL store row joins the carried canonical uri — no false positive");
  // the genuinely uncarried row STILL trips, carrying its owner for the named clamp reason
  assert.equal(out.length, 1);
  assert.equal(out[0].mark_text, "FROSTWICK");
  assert.equal(out[0].owner, "Alderline GmbH");
  // full-URL store row justified by a canonical-path drop row + canonical fetched key ⇒ NOT a violation
  const rfMd = ["## Negative results", "", "| Mark | Search Term / Variant | Result | Notes |", "| --- | --- | --- | --- |",
    "| FROSTWICK | glimmer | dropped | URI /mark/us/90121212; screen_verdict=surface:in-scope-live; class=41; status=live; goods reviewed |"].join("\n");
  const out2 = findRecallRegressionViolations({
    knownConflicts, searchedNames: ["GLIMMERPEAK"],
    carriedUris: ["/mark/int/1054099"], fetchedUris: ["/mark/us/90121212"], registerFindingsMd: rfMd, inScopeClasses: ["41"],
  });
  assert.equal(out2.length, 0, "canonicalized justification (fetched + drop-row-cited) works for the full-URL row too");
  // the named clamp reason: <MARK> (<owner> — <canonical uri>) — three same-named marks stay distinguishable
  assert.equal(formatRecallRegression(out[0]), "FROSTWICK (Alderline GmbH — /mark/us/90121212)");
  assert.equal(formatRecallRegression({ uri: "/mark/us/1", mark_text: "ION", owner: null }), "ION (/mark/us/1)");
  assert.equal(formatRecallRegression({ uri: "/mark/us/2", mark_text: null, owner: "Kestrel Ltd" }), "Kestrel Ltd — /mark/us/2");
});

// ---- spec 64 (B3): deadline carry-forward — a recorded window must never silently disappear -------
import { findDeadlineCarryViolations } from "../reasoning-tripwires.mjs";

test("spec 64 deadline-carry: carried-without-deadline trips; carried-with passes; uncarried is recall-regression's", () => {
  const NOW = Date.parse("2026-07-11T00:00:00Z");
  const ledger = { schema_version: 1, marks: { venzy: [
    { uri: "/mark/ch/06198", mark_text: "DEMVENZY", status: "live", opposition_end: "2026-07-13" },   // 2 days out
    { uri: "/mark/us/111", mark_text: "OLDMARK", status: "live", opposition_end: "2015-08-05" },      // long lapsed
    { uri: "/mark/us/222", mark_text: "UNCARRIED", status: "live", opposition_end: "2026-07-20" },    // not carried
    { uri: "/mark/us/333", mark_text: "COVERED", status: "live", opposition_end: "2026-08-01" },      // carried WITH deadline
  ] } };
  const findings = { findings: [
    { ordinal: 1, mark: "DEMVENZY", owner: { registrations: [{ uri: "/mark/ch/06198" }] } },          // no deadline field
    { ordinal: 2, mark: "COVERED", deadline: { kind: "opposition", date: "2026-08-01" }, owner: { registrations: [{ uri: "/mark/us/333" }] } },
  ] };
  const v = findDeadlineCarryViolations({ knownConflicts: ledger, searchedNames: ["VENZY"], parsedFindings: findings, nowMs: NOW });
  assert.equal(v.length, 1, "exactly the DEMVENZY shape trips");
  assert.equal(v[0].uri, "/mark/ch/06198");
  assert.equal(v[0].material, true);
  assert.match(v[0].why, /closes 2026-07-13/);
  assert.equal(findDeadlineCarryViolations({ knownConflicts: ledger, searchedNames: ["VENZY"], parsedFindings: findings, nowMs: 0 }).length, 0, "no clock ⇒ [] (replay purity)");
  assert.equal(findDeadlineCarryViolations({ knownConflicts: null, searchedNames: ["VENZY"], parsedFindings: findings, nowMs: NOW }).length, 0, "no ledger ⇒ []");
  assert.equal(findDeadlineCarryViolations({ knownConflicts: ledger, searchedNames: ["OTHERMARK"], parsedFindings: findings, nowMs: NOW }).length, 0, "other mark's rows never judged");
});

test("spec 64 review fix: deadline-carry matches a store PATH row against a finding's FULL provider URL", () => {
  const NOW = Date.parse("2026-07-11T00:00:00Z");
  const ledger = { schema_version: 1, marks: { venzy: [
    { uri: "/mark/ch/06198", mark_text: "DEMVENZY", status: "live", opposition_end: "2026-07-13" },
  ] } };
  const findings = { findings: [
    { ordinal: 1, mark: "DEMVENZY", owner: { registrations: [{ uri: "https://tm.corsearch.com/mark/ch/06198" }] } },
  ] };
  const v = findDeadlineCarryViolations({ knownConflicts: ledger, searchedNames: ["VENZY"], parsedFindings: findings, nowMs: NOW });
  assert.equal(v.length, 1, "the URL-shaped carried uri still joins the path-shaped store row");
});
