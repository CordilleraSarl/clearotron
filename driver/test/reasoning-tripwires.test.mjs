// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Pure tests for the v5 Appendix-A reasoning tripwire net. Each tripwire reads only mechanical run
// artifacts; these fixtures are the catastrophic-miss shapes each one exists to catch, plus a clean
// counterpart that must NOT trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findRecallFloorViolations, findReviewFreshnessViolation, findSeedNeutralityViolations,
  findProbativeGradingViolations, findStatusHonestyViolation,
  findDeadlineUrgencyMiss, findUnresolvedDisagreements, findOrphanVerificationFlags,
} from "../reasoning-tripwires.mjs";

const negMatrix = (rows) =>
  `## Findings\n(none)\n\n### Negative results\n| Mark | Search Term / Variant | Result | Notes |\n|---|---|---|---|\n${rows.join("\n")}\n`;

test("recall-floor: identical-name live in-scope drop not carried → trips", () => {
  const md = negMatrix([
    "| NOVAPULSE | NOVAPULSE | dropped (relevance gate / off-field) | URI /mark/us/12345; screen_verdict=surface:in-scope-live; class=9; status=live; crowded |",
  ]);
  const v = findRecallFloorViolations(md, { carriedMarks: ["KORVANE NOVAPULSE"], searchedNames: ["NOVAPULSE"], inScopeClasses: ["9"] });
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
  const probed = findReviewFreshnessViolation("CONDITIONAL\nFresh probe: NOVAPULSO class 9 → https://tmsearch/x confirms a live mark.", {});
  assert.equal(probed.pass, true);
  const newUrl = findReviewFreshnessViolation("CLEAR\nVerified at https://new.example/mark/9 (not upstream).", { upstreamTexts: ["only https://old.example here"] });
  assert.equal(newUrl.pass, true);
});

test("seed-neutrality: a graded / 'do not soften' seed trips; placement vocabulary does not", () => {
  const bad = findSeedNeutralityViolations([
    { name: "matter-context", text: "Seed #1: Korvane (Composite: 4, must not be softened downstream)." },
  ]);
  assert.ok(bad.some((v) => /do not soften|softened/i.test(v.why)), JSON.stringify(bad));
  assert.ok(bad.some((v) => /Composite/i.test(v.why)));
  const ok = findSeedNeutralityViolations([
    { name: "placements", text: "Korvane NOVAPULSE — placement: headline-candidate. Partner-ecosystem owner; facts only." },
  ]);
  assert.equal(ok.length, 0, JSON.stringify(ok));
  // a Level grade on a seed is a grade, whatever the framework calls the level; a hyphenated word is not
  assert.ok(findSeedNeutralityViolations([{ name: "matter-context", text: "Seed #2: rated Level C by the prior search." }])
    .some((v) => /Level/.test(v.why)), "a Level grade on a seed trips");
  assert.equal(findSeedNeutralityViolations([{ name: "matter-context", text: "A board-level C-suite owner; an enterprise-level E-commerce seller." }]).length, 0,
    "a letter that starts a hyphenated word is not a grade");
});

test("probative-grading: enforcer=high without bears_on trips when adopted; legacy v1 is exempt", () => {
  const mk = (extra) => ({ ordinal: 1, mark: "KORVANE NOVAPULSE", meters: { enforcer: { token: "high", basis: "inferred-from-signal" } }, ...extra });
  // adopted (schema_version 2) + no bears_on → trip
  const a = findProbativeGradingViolations({ schemaVersion: 2, findings: [mk({})] });
  assert.equal(a.length, 1, JSON.stringify(a));
  // adopted via a sibling carrying bears_on, this one missing → trip
  const b = findProbativeGradingViolations({ findings: [mk({}), { ordinal: 2, mark: "X", bears_on: "asserts NOVAPULSE in class 9", meters: { enforcer: { token: "low" } } }] });
  assert.equal(b.length, 1);
  // adopted + bears_on present → clean
  const c = findProbativeGradingViolations({ schemaVersion: 2, findings: [mk({ bears_on: "Korvane enforces NOVAPULSE on lighting in class 9, the disputed element" })] });
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
  const mk = (over) => ({ ordinal: 1, mark: "BIOVEL", source: { source_type: "register-vendor" }, owner: { name: "Acme", registrations: [] }, ...over });
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
