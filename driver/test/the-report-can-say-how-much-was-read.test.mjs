// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ── THE NEGATIVE EVIDENCE, AS FIELDS A RENDERER CAN READ ────────────────────────────────────────────
//
// A run that read 1,455 register records and cleared 432 near-names delivered a page showing 13 findings
// and nothing of the work behind them. `search-depth.mjs` derives that body of evidence from artifacts
// the run already wrote — counts, tokens and facts copied from records, no sentence composed anywhere.
//
// THE GROUP ARMS ARE THE POINT. Each cleared name is grouped by why it was cleared, and the only honest
// source is the providers' closed screening vocabulary plus the record's own status. The arms below
// drive a row whose REASONING PROSE says one thing and whose verdict says another, because classifying
// on the prose is the failure this key exists to avoid and it cannot be caught by a row where the two
// agree.
//
// BREAK MATRIX:
//   · a dead status groups as dead-filing           → break: drop the status arm, arm 1 red
//   · an out-of-class verdict groups as goods       → break: map it to other, arm 2 red
//   · an in-scope live name groups as other         → break: classify on the prose, arm 3 red
//   · parsing reads the audit's own note fields     → break: change the note key, arm 4 red
//   · counts name every country READ               → break: count only countries with a finding, arm 5 red
//   · four court states stay four                  → break: collapse none-found into not-checked, arm 6 red
import { test } from "node:test";
process.env.CLEAROTRON_MCP_URL ||= "https://mcp.test/mcp";
import assert from "node:assert/strict";
import { CLEARED_GROUPS, groupForCleared, clearedNames, recordsByCountry, sweepCounts, courtDecisionsState, localScriptSearched, searchDepthRecord, planTerritoriesOf, localLanguageDepth, recordNamesFromIds } from "../publish/search-depth.mjs";

// Invented ground throughout. No client content reaches a fixture.
const AUDIT = `# Negative Results

## NR1
- source_layer: Register
- search_term: VOLTARIS
- result: the filing lapsed and cannot be revived
- notes: URI /mark/jp/aaa-111; screen_verdict=drop:dead; class=9; status=CANCELLED

## NR2
- source_layer: Register
- search_term: VOLTARIS
- result: a live registration covering unrelated goods, nothing in common with this specification
- notes: URI /mark/kr/bbb-222; screen_verdict=surface:in-scope-live; class=42; status=REGISTERED

## NR3
- source_layer: Register
- search_term: VOLTARIS
- notes: URI /mark/us/ccc-333; screen_verdict=drop:out-of-class; class=5; status=REGISTERED

## A trading name on a marketplace
- source_layer: Common-law
- url: https://example.com/shop/voltaris
- type: storefront

## (none found on this platform)
- source_layer: Common-law

## VOLTARIS reads as "thunder" in the regional dialect and carries a civic association
- source_layer: Common-law
- description: A reading of what the mark means, not a name anybody trades under. It has no url because
  there is nothing to open.
- source: dictionary and press coverage
`;

test("a dead filing is grouped from its status, not its prose", () => {
  assert.equal(groupForCleared({ screenVerdict: "drop:dead", status: "CANCELLED" }), "dead-filing");
  assert.equal(groupForCleared({ screenVerdict: "surface:in-scope-live", status: "EXPIRED" }), "dead-filing",
    "a record the register calls expired was grouped as live — the status arm is not reached");
});

test("an out-of-class verdict is the only thing that means different goods", () => {
  assert.equal(groupForCleared({ screenVerdict: "drop:out-of-class", status: "REGISTERED" }), "different-goods");
});

test("a live in-scope name is read and cleared, whatever its reasoning says", () => {
  // NR2's prose reads "unrelated goods, nothing in common". A classifier reading that would call this
  // different-goods. The verdict says the record was a real in-scope candidate, and the verdict is the
  // fact. This arm is what stops the prose being consulted.
  const { register } = clearedNames(AUDIT);
  const live = register.find((r) => r.uri === "/mark/kr/bbb-222");
  assert.equal(live.group, "other",
    "a cleared name was grouped from the engine's reasoning paragraph rather than from its screening verdict");
});

test("the audit's own note fields are what the parse reads", () => {
  const { register, web } = clearedNames(AUDIT);
  assert.equal(register.length, 3, `3 register rows in the fixture, ${register.length} parsed`);
  assert.deepEqual(register.map((r) => r.group), ["dead-filing", "other", "different-goods"]);
  assert.deepEqual(register.map((r) => r.country), ["JP", "KR", "US"]);
  assert.equal(register[0].status, "CANCELLED");
  assert.ok(register.every((r) => !("result" in r)), "a cleared row carries the engine's sentence — the owner ruled it out");
  assert.equal(web.length, 1, "the empty-platform heading was counted as a named web result");
  assert.equal(web[0].url, "https://example.com/shop/voltaris");
});

// ── A NAME IS A NAME AT A PLACE ─────────────────────────────────────────────────────────────────────
//
// The common-law layer carries two kinds of block under one heading style: a name somebody trades under,
// which has a url, and a reading of what the mark MEANS, which has none because there is nothing to
// open. Both were listed under "Web and marketplace names", so a reading — a whole sentence — landed in
// the chip built for a name and was truncated with an ellipsis, its right-hand column empty. Measured on
// the delivered full country report: one such chip held 416px of content in a 200px box, and across
// every demo product 7 of 31 common-law blocks carried no url, every one of them a reading.
test("a common-law READING is not a web name — a name is a name at a place", () => {
  const { web } = clearedNames(AUDIT);
  assert.ok(web.length >= 1, "nothing parsed at all, so this arm would pass over an empty list");
  assert.ok(web.every((w) => w.url), "a block with no url is in the names list — a reading in a name slot");
  assert.ok(!web.some((w) => /reads as "thunder"/.test(w.title)),
    "the meaning reading is listed as a web name, which is the chip defect at its source");
  // AND THE NAME IS STILL THERE. A filter that dropped the whole layer would pass every assertion above.
  assert.ok(web.some((w) => w.title === "A trading name on a marketplace"),
    "the marketplace name went with the readings — this drops findings rather than sorting them");
});

test("the counts name every country read, including the clean ones", () => {
  // A country with no finding is the whole point: a report that lists only countries with a conflict
  // cannot show that the rest came back clean.
  const by = recordsByCountry(["jp-1.json", "jp-2.json", "kr-1.json", "wo-9.json", "notacountry.json"]);
  assert.deepEqual(by, { JP: 2, KR: 1, WO: 1 });
  assert.ok(Object.keys(by).length >= 3, "the fixture is too small for this to mean anything");
});

test("court decisions keeps its four states apart", () => {
  assert.equal(courtDecisionsState(""), "not-in-scope");
  assert.equal(courtDecisionsState("The source could not be reached this session."), "not-checked");
  assert.equal(courtDecisionsState("No on-point precedent found in the searched corpus."), "none-found");
  assert.equal(courtDecisionsState("### 1\n- ord: 1\nA decision on point, with a citation."), "found");
});

test("the sweep and local-script counts come from the machine record", () => {
  const grid = { cells: [{ term: "a", platform: "p1" }, { term: "b", platform: "p1" }, { term: "a", platform: "p2" }], extras: { pr_risk: [1, 2] } };
  assert.deepEqual(sweepCounts(grid), { checks: 3, platforms: 2, spellings: 2, reputation: 2 });
  assert.equal(localScriptSearched({ entries: [{ term: "VOLTARIS" }, { term: "ボルタリス" }] }), true);
  assert.equal(localScriptSearched({ entries: [{ term: "VOLTARIS" }] }), false);
});

test("the whole record carries a group tally over the closed set only", () => {
  const rec = searchDepthRecord({ auditMd: AUDIT, recordFileNames: ["jp-1.json"], commonLawGrid: null, caseLawText: "", registerPlan: null });
  assert.deepEqual(Object.keys(rec.cleared.groups).sort(), [...CLEARED_GROUPS].sort());
  assert.equal(rec.cleared.groups["dead-filing"] + rec.cleared.groups["different-goods"] + rec.cleared.groups.other,
    rec.cleared.register.length, "the tally and the rows disagree");
  assert.equal(rec.counts.courtDecisions, "not-in-scope");
});

// ── A REGISTER THAT ARCHIVES NOTHING IS NOT A REGISTER NOBODY SEARCHED ──────────────────────────────
//
// Both arrived here as `[]` and the page could only drop the section, so a clearance that searched three
// territories and found a rated conflict in one of them told the reader nothing about the register at
// all — in the same voice it uses for the things that were deliberately out of scope. Three-valued now,
// the way a stage's output already is: null means the run cannot say, and a number means it counted.

test("no record store and an empty one are different answers, not the same zero", () => {
  // The pair that matters. Asserted as a PAIR on purpose: either one alone passes against code that
  // collapses them, because each is individually what the old behaviour produced for its own input.
  assert.equal(recordsByCountry(null), null, "no `_records/` store — the run cannot say how many it read");
  assert.deepEqual(recordsByCountry([]), {}, "a store that is present and empty IS a zero, and reads as one");
  assert.notDeepEqual(recordsByCountry(null), recordsByCountry([]));
});

test("the whole record carries the distinction through to what the page reads", () => {
  const of = (names) => searchDepthRecord({ auditMd: AUDIT, recordFileNames: names }).counts;

  const absent = of(null);
  assert.equal(absent.recordsByCountry, null);
  assert.equal(absent.recordsRead, null, "a count of 0 here is a claim the run is not entitled to make");

  const empty = of([]);
  assert.deepEqual(empty.recordsByCountry, {});
  assert.equal(empty.recordsRead, 0, "and a real zero must still be a real zero, or this trades one lie for another");

  // The counted case is untouched — the guard against a fix that makes every run say "cannot say".
  const read = of(["jp-1.json", "jp-2.json", "kr-1.json"]);
  assert.deepEqual(read.recordsByCountry, { JP: 2, KR: 1 });
  assert.equal(read.recordsRead, 3);
});

test("an omitted listing is not a declaration that the store was empty", () => {
  // The default stays `[]` because only the publish path knows whether the directory exists, and it is
  // the one producer. This arm pins that the default is a DEFAULT and not the absent case: if someone
  // later "tidies" it to null, every caller that omits the argument starts reporting "cannot say".
  assert.equal(searchDepthRecord({ auditMd: AUDIT }).counts.recordsRead, 0);
});

// ── WHAT WAS SEARCHED IS THE PLAN'S ANSWER, NOT THE ARCHIVE'S ───────────────────────────────────────

test("the searched and unreached territories are read off the plan, with the reason for each", () => {
  const plan = {
    entries: [{ regions: ["EU", "GB"] }, { regions: ["GB", "JP"] }, { term: "no regions here" }],
    deferred_coverage: [
      { jurisdiction: "US", reason: "outside this register's coverage" },
      { jurisdiction: "CN", reason: "no index wired on this deployment" },
    ],
  };
  const t = planTerritoriesOf(plan);
  assert.deepEqual(t.searched, ["EU", "GB", "JP"], "deduped across entries, in plan order");
  assert.deepEqual(t.unreached, [
    { jurisdiction: "US", reason: "outside this register's coverage" },
    { jurisdiction: "CN", reason: "no index wired on this deployment" },
  ], "the reason travels with the territory — an unnamed gap is a wider gap, not a smaller one");
});

test("a run with no plan cannot say, and a plan that named nothing said nothing", () => {
  // The same distinction the record listing makes, for the same reason: collapsing them is what let a
  // register with no archive read as a register nobody searched.
  assert.equal(planTerritoriesOf(null), null);
  assert.equal(planTerritoriesOf(undefined), null);
  assert.deepEqual(planTerritoriesOf({}), { searched: [], unreached: [] });
});

test("a worldwide plan that names no region cannot say where it reached, and says so with null", () => {
  // Measured on a worldwide run on a provider that takes no region list: 487 entries, none carrying a
  // region, `regions: []`. Read as "searched these", that is "searched nowhere", and the by-country
  // section vanished on the run that searched the whole database. Null hands the page to what came back.
  const plan = { scope_basis: "worldwide", regions: [], entries: [{ qid: "a", term: "X" }, { qid: "b", term: "Y" }] };
  assert.equal(planTerritoriesOf(plan), null);
  // A worldwide order with deferrals is not an unrestricted sweep, and keeps its plan answer.
  const deferred = { ...plan, deferred_coverage: [{ jurisdiction: "RU", reason: "not covered" }] };
  assert.deepEqual(planTerritoriesOf(deferred), { searched: [], unreached: [{ jurisdiction: "RU", reason: "not covered" }] });
  // A worldwide plan that DOES name its offices (a provider that needs a region list) is unchanged.
  assert.deepEqual(planTerritoriesOf({ scope_basis: "worldwide", entries: [{ regions: ["US", "EM"] }] }).searched, ["US", "EM"]);
});

test("with no record archive, what was read is the band the register returned", () => {
  const ids = ["/mark/us/tm_1", "/mark/us/tm_2", "/mark/gb/tm_3", "/mark/us/tm_1", "not-a-ref"];
  assert.deepEqual(recordNamesFromIds(ids).sort(), ["gb-tm_3", "us-tm_1", "us-tm_2"], "one per distinct record, filed by office");
  const noArchive = searchDepthRecord({ recordFileNames: null, bandRecordIds: ids });
  assert.equal(noArchive.counts.recordsRead, 3);
  assert.deepEqual(noArchive.counts.recordsByCountry, { US: 2, GB: 1 });
  // An archive that exists is the authority, even when it is empty: the band is only read where there is none.
  const emptyArchive = searchDepthRecord({ recordFileNames: [], bandRecordIds: ids });
  assert.equal(emptyArchive.counts.recordsRead, 0);
  // And no band at all is still "cannot say".
  assert.equal(searchDepthRecord({ recordFileNames: null }).counts.recordsRead, null);
});

test("a deferred territory is never also reported as searched", () => {
  // The compiler moves an unreachable office OUT of `regions` and into `deferred_coverage`. `plan.regions`
  // is the OLDER shape and must stay a fallback: unioned with the entries it would report exactly the
  // territory that was moved out as though it had been queried, which is the false clean the deferral
  // list exists to prevent.
  const t = planTerritoriesOf({
    entries: [{ regions: ["EU"] }],
    regions: ["EU", "US"],                                  // pre-split shape, still on the artifact
    deferred_coverage: [{ jurisdiction: "US", reason: "not covered" }],
  });
  assert.deepEqual(t.searched, ["EU"], "the entries are the authority where they exist");
  assert.ok(!t.searched.includes("US"), "a territory that was deferred was reported as searched");
  assert.deepEqual(t.unreached.map((d) => d.jurisdiction), ["US"]);

  // And the fallback still works where there are no entries at all.
  assert.deepEqual(planTerritoriesOf({ regions: ["EU", "US"] }).searched, ["EU", "US"]);
});

test("a deferral with no jurisdiction is dropped rather than rendered as a blank territory", () => {
  const t = planTerritoriesOf({ deferred_coverage: [{ reason: "nothing names this" }, { jurisdiction: "  " }, { jurisdiction: "US", reason: "" }] });
  assert.deepEqual(t.unreached, [{ jurisdiction: "US", reason: "" }]);
});

// ── HOW DEEP THE LOCAL-LANGUAGE INVESTIGATION WENT, AGAINST WHAT WAS CONFIGURED ────────────────────
//
// The engine can run this shallower than the account asked for. It said so in one place: a sentence a
// model wrote in the Methodology paragraph. The redesigned report replaces that paragraph with named
// rows, so a run that went shallow said so on no page at all. These are the four states behind that row.

const lane = (asked, ran, shortfall = asked === "full" && ran !== "full") => ({ asked, ran, shortfall });

test("local-language depth: RAN when every lane reached the depth it was asked for", () => {
  const d = localLanguageDepth({ zh: lane("full", "full"), ja: lane("candidates", "candidates") });
  assert.equal(d.state, "ran");
  assert.deepEqual(d.lanes.zh, { configured: "full", achieved: "full" });
  assert.deepEqual(d.lanes.ja, { configured: "candidates", achieved: "candidates" });
});

test("local-language depth: RAN-SHALLOW when a lane falls short of its ask", () => {
  const d = localLanguageDepth({ zh: lane("full", "candidates") });
  assert.equal(d.state, "ran-shallow", "a run that asked for full and delivered candidates says so");
  assert.deepEqual(d.lanes.zh, { configured: "full", achieved: "candidates" });
});

test("local-language depth: a lane asked and NOT run is short, even beside one that ran", () => {
  // Not covered by `shortfall`, which only fires on a full ask. A lane asked for candidates that ran
  // nothing is still less than the matter configured, and folding it into "ran" because a sibling lane
  // succeeded would report the better half of a partial investigation.
  assert.equal(localLanguageDepth({ zh: lane("full", "full"), ja: lane("candidates", null) }).state, "ran-shallow");
});

test("local-language depth: NOT-RUN when lanes were asked and none of them ran", () => {
  assert.equal(localLanguageDepth({ zh: lane("full", null), ja: lane("candidates", null) }).state, "not-run");
});

test("local-language depth: NOT-IN-SCOPE for a plain clearance, and for every lane switched off", () => {
  assert.equal(localLanguageDepth(null).state, "not-in-scope", "no sidecar — the component never ran");
  assert.equal(localLanguageDepth({}).state, "not-in-scope");
  assert.equal(localLanguageDepth({ zh: lane("off", null), ja: lane("off", null) }).state, "not-in-scope");
});

test("local-language depth: an unestablished lane is never quietly the lesser depth", () => {
  // `ran: null` means the slices settled to nothing readable — the lane cannot say what it delivered.
  // The jx verdicts report that as unestablished rather than as candidates, and folding it to a depth
  // here would put a claim no artifact supports onto a client's page.
  //
  // ALONE, IT READS AS not-run, AND THAT IS THE CONSERVATIVE ANSWER OF THE TWO AVAILABLE. There is no
  // "could not establish" among the four states, so the choice is between saying the investigation did
  // not run and saying it ran shallowly. The second claims coverage this run cannot evidence, which is
  // the direction that hurts a client; the first understates what may have happened, which a reader
  // resolves. Understating is the one that is safe to be wrong about.
  const alone = localLanguageDepth({ zh: { asked: "full", ran: null, shortfall: true } });
  assert.equal(alone.state, "not-run");
  assert.equal(alone.lanes.zh.achieved, null, "an unestablished depth must not be reported as a depth");

  // BESIDE A LANE THAT DID RUN it is a shortfall, because then the investigation demonstrably ran and
  // this part of it demonstrably did not reach what was asked.
  const beside = localLanguageDepth({ zh: { asked: "full", ran: null, shortfall: true }, ja: lane("candidates", "candidates") });
  assert.equal(beside.state, "ran-shallow");
  assert.equal(beside.lanes.zh.achieved, null);
});

test("the state is derived from the record, and no prose anywhere can move it", () => {
  // Acceptance 2, asserted rather than asserted-about: the sentence the old Methodology paragraph used
  // is fed in as audit prose with no lane record beside it, and it changes nothing.
  const shallowProse = `${AUDIT}\n\nThe local-language investigation ran at a shallower depth than configured.`;
  assert.equal(searchDepthRecord({ auditMd: shallowProse }).counts.localLanguage.state, "not-in-scope",
    "prose moved the state — the one thing this field exists to stop");
  assert.equal(
    searchDepthRecord({ auditMd: shallowProse, laneDepthVerdicts: { zh: lane("full", "candidates") } }).counts.localLanguage.state,
    "ran-shallow", "and the record still decides it");
});
