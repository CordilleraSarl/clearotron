// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A knockout report answers the way a lawyer's does: a name's filing evidence, then its web use, and where the evidence
// divides the classes searched, a band for each group. Invented names and an invented framework throughout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const { classGroupsDefect, validators, validateMergedFindings } = await import("../verify-knockout.mjs");
const { renderKnockoutHtml, knockoutReportData } = await import("../publish/render-knockout.mjs");
const { composeKnockoutEmail } = await import("../publish/knockout.mjs");
const { recordKnockoutAssess, knockoutAssessChunkFile } = await import("../knockout-assess-record.mjs");
const { KNOCKOUT_CARD_ORDER } = await import("../findings-model.mjs");
const { KO_STAGES } = await import("../stages-knockout.mjs");
const { invented, MANIFEST, mark, chunk, merged } = await import("./ko-fixture-invented.mjs");

const LADDER = MANIFEST.bands.map((b) => b.label);
const GROUPS = [{ band: "Slight", ratingQualifier: null, classes: [3, 21] }, { band: "Notable", ratingQualifier: null, classes: [9, 28] }];
const divided = (over = {}) => ({ ...mark("Notable", []), classesSearched: [3, 9, 21, 28], classesDriving: [9, 28], classGroups: GROUPS, ...over });
const said = (what) => `knockout_class_groups:TESTMARK: ${what}`;

// ── WHAT THE CHECK REFUSES, AND WHY EACH ROW OF IT MATTERS ON THE PAGE ──────────────────────────

test("a name with no groups is not asked for any, and a sound division passes", () => {
  assert.equal(classGroupsDefect(mark("Notable", []), LADDER), null);
  assert.equal(classGroupsDefect(divided(), LADDER), null);
});

test("each thing the band column could not print truthfully is refused in plain words", () => {
  const refused = (over) => classGroupsDefect(divided(over), LADDER);
  const ONE = "classGroups needs two or more rows that differ in band or qualifier. Where one conclusion holds, leave it out.";
  assert.equal(refused({ classGroups: [GROUPS[1]] }), said(ONE));
  assert.equal(refused({ classGroups: [{ band: "Notable", classes: [3, 21] }, { band: "Notable", classes: [9, 28] }] }), said(ONE));
  assert.equal(refused({ classGroups: [{ band: "Awful", classes: [3, 21] }, GROUPS[1]] }), said("band Awful is not in the framework's ladder."));
  assert.equal(refused({ classGroups: [{ band: "Slight", classes: [3] }, { band: "Slight", classes: [21] }, GROUPS[1]] }), said("Combine groups with the same band and qualifier."));
  assert.equal(refused({ classesDriving: [9] }), said("classesDriving must contain the highest group's classes."));
  assert.equal(refused({ classesDriving: [3, 9, 28] }), said("classesDriving must contain the highest group's classes."));
  assert.equal(refused({ classGroups: [{ band: "Slight", classes: [3, 21, 9] }, GROUPS[1]] }), said("class 9 sits in two groups."));
  assert.equal(refused({ classGroups: [{ band: "Slight", classes: [3] }, GROUPS[1]] }), said("class 21 was searched and is in no group."));
  assert.equal(refused({ classGroups: [{ band: "Slight", classes: [3, 21, 41] }, GROUPS[1]] }), said("class 41 is in a group but was not searched."));
  assert.equal(refused({ rating: "Serious" }), said("rating is Serious, but the highest group is Notable. They must agree."));
  assert.equal(refused({ classGroups: [{ band: "Slight", classes: ["3", 21] }, GROUPS[1]] }), said("each group's classes must be Nice-class integers (1–45)."));
});

test("two groups may differ by the qualifier alone, and the rating is the one without it", () => {
  const groups = [{ band: "Notable", ratingQualifier: "low", classes: [3, 21] }, { band: "Notable", classes: [9, 28] }];
  assert.equal(classGroupsDefect(divided({ classGroups: groups }), LADDER), null);
  assert.equal(classGroupsDefect(divided({ classGroups: groups, ratingQualifier: "low" }), LADDER),
    said("rating is Notable (low), but the highest group is Notable. They must agree."));
});

// ── THE MODEL HEARS IT IN THE TURN, AND THE GATES HOLD THE SAME LINE ────────────────────────────

const call = (m) => ({ schema_version: 1, framework: { source: "x", ladder: LADDER }, batch: { productContext: "An invented batch.", standardCaveats: [] },
  chunkSummary: "An invented summary.", marks: [{ contextFraming: "An invented use.", assessment: "An invented opening read.", ...m }] });

test("the call refuses a division the page could not print, writes nothing, and takes the corrected one", () => {
  const run = invented();
  const bad = recordKnockoutAssess(run, call(divided({ rating: "Serious" })), { boundOrdinal: 0 });
  assert.equal(bad.refused, said("rating is Serious, but the highest group is Notable. They must agree."));
  assert.equal(existsSync(knockoutAssessChunkFile(run, 0)), false, "a refused division was written");
  const good = recordKnockoutAssess(run, call(divided()), { boundOrdinal: 0 });
  assert.equal(good.refused, null, good.refused);
  assert.deepEqual(JSON.parse(readFileSync(knockoutAssessChunkFile(run, 0), "utf8")).marks[0].classGroups, GROUPS);
});

test("a key inside a group that the contract does not name is refused at the call", () => {
  const run = invented();
  const r = recordKnockoutAssess(run, call(divided({ classGroups: [{ ...GROUPS[0], why: "x" }, GROUPS[1]] })), { boundOrdinal: 0 });
  assert.match(String(r.refused), /why/);
});

test("the chunk gate refuses the same defect, so a correction that moves the rating cannot leave the groups behind", () => {
  const run = invented();
  const gate = (m) => validators.knockoutAssessChunk(knockoutAssessChunkFile(run, 0), chunk(m));
  assert.equal(gate(divided()).ok, true, gate(divided()).reason);
  const moved = gate(divided({ rating: "Serious", classesDriving: [9, 28] }));
  assert.equal(moved.ok, false);
  assert.equal(moved.reason, said("rating is Serious, but the highest group is Notable. They must agree."));
});

test("the merged gate refuses it too, and leaves the groups highest first for every surface that prints them", () => {
  const run = invented();
  const doc = merged(divided());
  assert.equal(validateMergedFindings(run, doc, { marks: [] }).ok, true);
  assert.deepEqual(doc.marks[0].classGroups.map((g) => g.band), ["Notable", "Slight"]);
  const bad = validateMergedFindings(run, merged(divided({ rating: "Severe" })), { marks: [] });
  assert.equal(bad.ok, false);
  assert.match(JSON.stringify(bad), /knockout_class_groups:TESTMARK: rating is Severe/);
});

// ── THE PAGE ────────────────────────────────────────────────────────────────────────────────

const FW = { framework_key: "orchard-test", title: "Invented test framework", bands: MANIFEST.bands };
const REC = (id, name) => ({ recordId: id, mark: name, owner: "Pemberton Tools Ltd", ownerCountry: "GB", status: "PENDING", classes: [9], territory: "us",
  matchedForm: name, matchedBasis: "identical", url: null, provider: "clarivate" });
const RECORDS = { provider: "clarivate", providerLabel: "Clarivate Compumark",
  marks: [{ name: "TESTMARK", classes: [9], classScope: "mark", records: [REC("R-1", "CARDFILING"), REC("R-2", "WEIGHEDFILING")], fetched: 2, available: true }] };
const FINDING = (ordinal, name, weighedFilings = []) => ({ ordinal, name, owner: "Veltra Labs GmbH", band: "Notable", type: "Active Business", net: `${name} is an invented conflict.`,
  evidence: ["https://example.invalid/x"], basis: "An invented ground.", ...(weighedFilings.length ? { weighedFilings } : {}) });
const NAMED = () => ({ ...mark("Notable", [FINDING(1, "ONUSE"), FINDING(2, "ONFILING", ["R-2"])]), classesSearched: [9], classesDriving: [9], assessment: "An invented read." });
const page = (m, over = {}) => renderKnockoutHtml({ marks: [m], batch: { executiveSummary: "One name.", standardCaveats: [] }, ...over }, FW,
  { runId: "r", overall: "Notable", identity: { identity: "Knockout search" }, registerRecords: RECORDS });

test("a name's filing evidence leads its web use: findings that weigh a filing, then filing cards, then findings on use", () => {
  const html = page(NAMED(), { cardOrder: KNOCKOUT_CARD_ORDER });
  const at = (s) => { const i = html.indexOf(`>${s}<`); assert.ok(i >= 0, `${s} is not on the page`); return i; };
  assert.ok(at("ONFILING") < at("CARDFILING"), "a finding weighing a filing did not lead");
  assert.ok(at("CARDFILING") < at("ONUSE"), "the filing card did not lead the web use");
});

test("a run recorded before this order re-renders as it was delivered, its findings before its filing cards", () => {
  const html = page(NAMED());
  const at = (s) => html.indexOf(`>${s}<`);
  assert.ok(at("ONUSE") < at("ONFILING"), "the findings' own order moved");
  assert.ok(at("ONFILING") < at("CARDFILING"), "a delivered report's cards moved");
});

test("the band column prints a chip and a Classes line per group, adding no words", () => {
  const html = page({ ...NAMED(), classesSearched: [3, 9, 21, 28], classesDriving: [9, 28], classGroups: [GROUPS[1], GROUPS[0]] });
  for (const line of ['Classes 9, 28</p>', 'Classes 3, 21</p>']) assert.ok(html.includes(`<p class="ko-classes">${line}`), `${line} is not on the page`);
  assert.ok(html.indexOf(">Notable</span>") < html.indexOf(">Slight</span>"), "the groups are not highest first");
  assert.ok(!html.includes('<p class="ko-classes">Classes 3, 9, 21, 28</p>'), "the undivided line still prints beside the groups");
});

test("on a batch the glance panel says the same as the name's own row", () => {
  const html = renderKnockoutHtml({ marks: [divided(), { ...mark("Slight", []), name: "OTHERMARK", classesSearched: [5] }], batch: { executiveSummary: "Two names.", standardCaveats: [] } }, FW,
    { runId: "r", overall: "Notable", identity: { identity: "Knockout search" } });
  for (const line of ["Classes 3, 21</p>", "Classes 9, 28</p>"]) assert.equal(html.split(`<p class="ko-classes">${line}`).length - 1, 2, `${line} is not in both places`);
});

test("a name with no groups keeps its one chip and its whole class list, byte for byte", () => {
  const html = page({ ...NAMED(), classesSearched: [3, 9] });
  const stop = "--med";
  assert.ok(html.includes(`<span class="ko-band" style="background:var(${stop})">Notable</span>\n        \n        <p class="ko-classes">Classes 3, 9</p>`), "the band column's markup moved");
});

test("report-data carries the groups only where a name has them", () => {
  const data = (m) => knockoutReportData({ marks: [m], batch: { executiveSummary: "x", standardCaveats: [] } }, FW, { runId: "r", codename: "c", overall: "Notable", issued: "i" });
  const of = (d) => (d.marks ?? d.names ?? [])[0];
  assert.deepEqual(of(data(divided())).classGroups, GROUPS);
  assert.equal("classGroups" in of(data(NAMED())), false);
});

test("the email's band line says each group's band and classes, and a name with none reads as before", () => {
  const mail = (m) => composeKnockoutEmail({ findings: { marks: [m], batch: { standardCaveats: [] } }, framework: FW, overall: "Notable", job: { markName: "TESTMARK" } });
  const body = (m) => JSON.stringify(mail(m));
  assert.match(body(divided({ classGroups: [GROUPS[1], GROUPS[0]] })), /Notable<\/b> — Classes 9, 28; <b[^>]*>Slight<\/b> — Classes 3, 21/);
  assert.match(body(NAMED()), /Notable<\/b> — Classes 9/);
});

// ── THE WORDS THE MODEL READS ───────────────────────────────────────────────────────────────

test("the manual, the check and the repair each say what they owe a divided answer", () => {
  const manual = readFileSync(new URL("../skills/knockout-assess/SKILL.md", import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.ok(manual.includes("Use `classGroups` when separating the requested goods changes the advice under the frozen framework."), "the manual does not teach the field");
  assert.ok(manual.includes("Different band words or qualifiers alone do not require a split."), "the manual does not say when to leave it");
  assert.ok(manual.includes("Below the framework's material bands, keep one overall conclusion unless the distinction changes the advice"), "the manual does not bound it below the material bands");
  assert.ok(manual.includes("Divide on the requested goods and evidence, never to soften a rating."), "the manual does not bound it");
  assert.ok(!/"classGroups": \[ \{/.test(manual), "the manual's one-class example teaches a call the tool refuses");
  assert.ok(manual.includes("what those filings show, what the screened field adds to that reading"), "the opening read does not lead with the filings");
  const K = { runDir: "/run", findings: "/run/f.json", researchDir: "/run/research", registerRecords: "/run/none.json", assessChunk: () => "/run/none.json", plan: "/run/p.json", research: () => "/run/r.md" };
  const review = KO_STAGES["knockout-review"].message({ K });
  assert.ok(review.includes("including one band where the evidence divides the requested goods, or a division it does not support (`band`)"));
  assert.ok(review.includes("including reasoning that never connects the requested use and the held goods to the conclusion (`scope`)"));
  const repair = KO_STAGES["knockout-correct"].message({ K, chunkNo: 0, work: { defects: [] } });
  assert.ok(repair.includes("`bullets`, `classGroups`, `classesDriving`, its `registerReads`"));
});
