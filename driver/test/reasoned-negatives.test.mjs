// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — every reasoned negative carries positions; off-field only for genuine goods/sector distance.
//
// The defect this pins: on the 08-02 run all four off-field findings carried `net` and NEITHER position,
// while every adversarial and distinguished finding carried both. One of them was placed "off-field on
// rhythm and field" — a mark-similarity argument wearing a sector label — and another conceded its goods
// wording was unrestricted "pharmaceutical preparations" and was still labelled not in our field.
//
// The three things under test are the three the issue asks for, plus the two zero-semantics traps:
//   1. no disposition that reaches a reader is exempt from carrying both positions;
//   2. a different-field claim is checked against the finding's own goods meter;
//   3. reasoned negatives group by the ground they share — and an empty grouping is distinguishable from
//      one that never ran.
// All offline, all synthetic fixtures (structure-copied shapes only — no client data).
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  parseFindingsJson, parseFindingsJsonLenient, reasonedNegativeGroups, reasonedNegativeGround,
  FINDINGS_SCHEMA_VERSION, OFF_FIELD_GROUNDS, POSITION_REQUIRED_DISPOSITIONS, DISPOSITIONS,
} from "../findings-model.mjs";
import { contentModelChecks, schemaVersionChecks } from "../predelivery-lint.mjs";

// EXACTLY what the live pipeline derives (pipeline.mjs, lintNow: `contentModelExpected: lintSv >= 5`,
// where lintSv is the parsed findings.json's own schema_version, defaulting to 1 when the file is absent
// or unparseable). Hard-coding `expected: true` was how 's gap survived its own covering test: a test
// that asserts the caller's assertion can never demonstrate what happens when the caller does not assert.
const contentModelExpectedFor = (declaredVersion) => declaredVersion >= 5;

const meter = (token, basis = "verified-from-record") => ({ token, basis });
const POSITIONS = {
  legal_position: "Near-identical over identical class-5 goods — a high legal read under the framework's own definitions.",
  practical_position: "The proprietor is live in three instructed territories and has opposed twice since 2023.",
};
const BASE = {
  ordinal: 1, mark: "VOLTMAX", disposition: "adversarial", band: "High",
  owner: { name: "Synth Pharma AG", country: "CH", registrations: [{ uri: "/mark/eu/000000001", jurisdiction: "EU", classes: ["5"] }] },
  meters: { mark_similarity: meter("high"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("medium", "inferred-from-signal") },
  quadrant: { x: 0.8, y: 0.7 },
  source: { source_type: "register-vendor", resolved_link: "https://example.invalid/r/1" },
  // — the one-clause net is MANDATORY at v6: it is the only per-finding summary the report has.
  net: "The legal risk is a near-identical senior mark over identical class-5 goods — no coexistence terms are on the record searched.",
  ...POSITIONS,
};
const OFF_FIELD = {
  ...BASE, ordinal: 2, mark: "VOLTMAX", disposition: "off-field", band: undefined,
  off_field_ground: "different-field",
  meters: { ...BASE.meters, goods_proximity: meter("low") },
  legal_position: "The senior registration covers class 12 vehicle parts; its scope stops well short of pharmaceutical preparations.",
  practical_position: "An automotive supplier with no visible presence in any healthcare channel.",
};
const doc = (findings, { version = FINDINGS_SCHEMA_VERSION, ...extra } = {}) => JSON.stringify({
  schema_version: version, rated_under_framework: "house-default",
  findings: findings.map((f) => { const c = { ...f }; if (c.band === undefined) delete c.band; return c; }),
  coverage: [{ area: "register / EU", state: "confirmed-clean", note: "enumerated" }],
  ...extra,
});

// ── requirement 1: no disposition is structurally exempt ──────────────────────────────────────────────

test("v6 requires BOTH positions on every disposition that reaches a reader — off-field included", () => {
  // The exact 08-02 shape: an off-field negative with a net and no structured position.
  const silent = { ...OFF_FIELD, legal_position: undefined, practical_position: undefined, net: "Different field." };
  assert.throws(() => parseFindingsJson(doc([BASE, silent])), /finding_legal_position_missing:2/);
  assert.throws(() => parseFindingsJson(doc([BASE, { ...silent, ...{ legal_position: OFF_FIELD.legal_position } }])),
    /finding_practical_position_missing:2/);
  // and the complete record passes
  assert.equal(parseFindingsJson(doc([BASE, OFF_FIELD])).findings.length, 2);
});

test("every disposition in POSITION_REQUIRED_DISPOSITIONS is enforced, not just the ones the issue named", () => {
  for (const disposition of POSITION_REQUIRED_DISPOSITIONS) {
    const f = {
      ...BASE, ordinal: 1, disposition,
      ...(disposition === "off-field"
        ? { band: undefined, off_field_ground: "no-material-risk" }
        : { band: "Manageable" }),
      ...(["coexistence-partner", "distinguished"].includes(disposition)
        ? { manageable: { category: "large-competitor", reason: "a competitor, but the house mark distinguishes" } }
        : {}),
      legal_position: undefined, practical_position: undefined,
    };
    assert.throws(() => parseFindingsJson(doc([f])), /finding_legal_position_missing:1/,
      `${disposition} must not be exempt from carrying a position`);
  }
});

test("withdrawn is the ONE disposition outside the rule, and it carries withdrawn_reason instead", () => {
  // `withdrawn` is not a withdrawn APPLICATION — it is a finding the reviewer's corrective pass killed
  // ( A1). It renders nowhere. Requiring positions on it would mean the corrective pass could no
  // longer kill an unrated finding: the killer edits `disposition` and re-saves, and the model would have
  // to author a legal read for a card it is deleting. See the issue comment of 2026-08-03.
  assert.ok(!POSITION_REQUIRED_DISPOSITIONS.includes("withdrawn"));
  assert.deepEqual([...POSITION_REQUIRED_DISPOSITIONS, "withdrawn"].sort(), [...DISPOSITIONS].sort(),
    "every disposition is either position-required or withdrawn — none is unaccounted for");
  const killed = { ...OFF_FIELD, ordinal: 2, disposition: "withdrawn", withdrawn_reason: "reviewer flag: unsourced attribution", off_field_ground: undefined, legal_position: undefined, practical_position: undefined };
  delete killed.off_field_ground; delete killed.legal_position; delete killed.practical_position;
  assert.equal(parseFindingsJson(doc([BASE, killed])).findings[1].disposition, "withdrawn");
  // the corrective pass's real move: take a complete off-field finding and kill it, positions and all
  const killedFromOffField = { ...OFF_FIELD, disposition: "withdrawn", withdrawn_reason: "reviewer flag: confabulated owner" };
  delete killedFromOffField.off_field_ground;
  assert.equal(parseFindingsJson(doc([BASE, killedFromOffField])).findings[1].withdrawn_reason, "reviewer flag: confabulated owner");
});

test("a ruled-out name is not a reasoned negative, but it must still NAME what settled it", () => {
  const ruled = { ...OFF_FIELD, ordinal: 2, mark: "UNTAMED", ruled_out: true, off_field_ground: undefined, legal_position: undefined, practical_position: undefined };
  delete ruled.off_field_ground; delete ruled.legal_position; delete ruled.practical_position;
  assert.throws(() => parseFindingsJson(doc([BASE, ruled])), /finding_ruled_out_reason_missing:2/,
    "the ruled-out flag must not become the escape hatch that reaches silence");
  const withReason = { ...ruled, ruled_out_reason: "shares the theme, not the word: UNTAMED against VOLTMAX, no common element" };
  assert.equal(parseFindingsJson(doc([BASE, withReason])).findings[1].ruled_out, true);
});

// ── the version gate: archived runs, and the down-level emission ──────────────────────────────────────

test("v5 and below parse byte-identically — the archive republish path is untouched", () => {
  const silent = { ...OFF_FIELD, legal_position: undefined, practical_position: undefined };
  delete silent.legal_position; delete silent.practical_position; delete silent.off_field_ground;
  for (const version of [4, 5]) {
    const parsed = parseFindingsJson(doc([BASE, silent], { version }));
    assert.equal(parsed.findings.length, 2, `v${version} must keep parsing the archived shape`);
    assert.equal(parsed.findings[1].legal_position, undefined);
  }
  // off_field_ground is a v6 key: a v5 document carrying it is an unknown key, not a silent accept
  assert.throws(() => parseFindingsJson(doc([BASE, OFF_FIELD], { version: 5 })), /finding_key_unknown:off_field_ground/);
});

test("the LENIENT parser never DROPS a finding for a missing position — that would be silence by enforcement", () => {
  const silent = { ...OFF_FIELD, legal_position: undefined, practical_position: undefined };
  delete silent.legal_position; delete silent.practical_position;
  const out = parseFindingsJsonLenient(doc([BASE, silent]));
  assert.equal(out.quarantined.length, 0, "the quarantine path must not delete the very negative the rule exists to surface");
  assert.equal(out.findings.length, 2);
});

test("a down-level schema_version cannot silently disengage the requirement — the lint judges the RECORD", () => {
  const silent = { ...OFF_FIELD, legal_position: undefined, practical_position: undefined };
  delete silent.legal_position; delete silent.practical_position; delete silent.off_field_ground;
  const declared = 5;
  const findings = parseFindingsJson(doc([BASE, silent], { version: declared })).findings;
  // expected is DERIVED, not asserted — see contentModelExpectedFor at the top of this file.
  const by = Object.fromEntries([
    ...contentModelChecks({ findings, fourAnswers: null, expected: contentModelExpectedFor(declared) }),
    ...schemaVersionChecks({ schemaVersion: declared }),
  ].map((c) => [c.id, c]));
  assert.equal(by["legal-practical-split"].pass, false, "the parser stayed quiet at v5; the lint must not");
  assert.match(by["legal-practical-split"].detail, /off-field/);
  assert.equal(by["off-field-ground"].pass, false);
  assert.equal(by["findings-schema-current"].pass, false, "and the file is named as behind the dictated contract");
  assert.match(by["findings-schema-current"].detail, new RegExp(`dictates ${FINDINGS_SCHEMA_VERSION}`));
  for (const id of ["legal-practical-split", "off-field-ground", "findings-schema-current"]) assert.equal(by[id].structural, true);
});

// — THE SEAM THE TEST ABOVE COULD NOT REACH.
//
// findings-schema-current used to live inside contentModelChecks, behind `if (!expected) return []`, and
// `expected` is derived as `schema_version >= 5`. So the check written to report a down-level file was
// switched off BY the file being down-level. Below v5 it never ran — and the population it exists for is
// exactly the files below v5.
//
// The old covering test could not see it because it passed `expected: true` directly. This one derives
// expected the way the pipeline does, at every version the pipeline can derive it from.
test("#321: at every down-level version the content-model family goes quiet — and the version check does NOT", () => {
  for (const declared of [1, 2, 3, 4]) {
    const expected = contentModelExpectedFor(declared);
    assert.equal(expected, false, `v${declared} does not assert the v5+ content model`);
    assert.deepEqual(contentModelChecks({ findings: [BASE, OFF_FIELD], fourAnswers: null, expected }), [],
      `v${declared}: the presence flags are caller-asserted and stay silent, as designed`);

    const [c] = schemaVersionChecks({ schemaVersion: declared });
    assert.ok(c, `v${declared}: the version check still runs — this is the whole of #321`);
    assert.equal(c.id, "findings-schema-current");
    assert.equal(c.pass, false, `v${declared} is behind the dictated contract and must be named as behind it`);
    assert.equal(c.structural, true);
    assert.match(c.detail, new RegExp(`declares schema_version ${declared}`), "and the detail names the version it found");
  }
});

test("#321: a current file passes the version check, so the flag means something when it fires", () => {
  const [c] = schemaVersionChecks({ schemaVersion: FINDINGS_SCHEMA_VERSION });
  assert.equal(c.pass, true);
  assert.equal(c.detail, "");
});

test("the replay corpus stays silent — no expectation, and no version to claim anything about", () => {
  assert.deepEqual(contentModelChecks({ findings: [BASE], fourAnswers: null, expected: false }), []);
  // replay-archive.mjs passes neither, which is how archived runs never grow a failure. The version check
  // holds that line on its own terms: no version supplied ⇒ no version claim, at any `expected`.
  for (const v of [undefined, null, NaN, "5"]) {
    assert.deepEqual(schemaVersionChecks({ schemaVersion: v }), [], `${String(v)} is not a version this can judge`);
  }
});

// ── requirement 2: the label follows the argument ─────────────────────────────────────────────────────

test("off-field must declare WHICH of its two grounds it rests on", () => {
  const groundless = { ...OFF_FIELD };
  delete groundless.off_field_ground;
  assert.throws(() => parseFindingsJson(doc([BASE, groundless])), /finding_off_field_ground_missing:2/);
  assert.throws(() => parseFindingsJson(doc([BASE, { ...OFF_FIELD, off_field_ground: "rhythm" }])),
    /finding_off_field_ground_invalid:rhythm/);
  for (const g of OFF_FIELD_GROUNDS) {
    const f = { ...OFF_FIELD, off_field_ground: g, meters: { ...OFF_FIELD.meters, goods_proximity: meter(g === "different-field" ? "low" : "high") } };
    assert.equal(parseFindingsJson(doc([BASE, f])).findings[1].off_field_ground, g);
  }
});

test("a DIFFERENT-FIELD claim beside a proximate goods meter is rejected — one record cannot say both", () => {
  // The BRUVENZA shape: the goods wording is unrestricted "pharmaceutical preparations", the applicant is
  // in class 5, and the record still says "not in our field".
  for (const token of ["high", "medium"]) {
    const contradiction = { ...OFF_FIELD, meters: { ...OFF_FIELD.meters, goods_proximity: meter(token) } };
    assert.throws(() => parseFindingsJson(doc([BASE, contradiction])), /finding_off_field_goods_proximate:2/,
      `goods_proximity "${token}" cannot support a different-field claim`);
  }
  // The escape is not "score the meter low anyway" — it is the honest disposition. A mark argued apart on
  // rhythm with overlapping goods is `distinguished`, and it carries a band.
  const distinguished = {
    ...OFF_FIELD, disposition: "distinguished", band: "Manageable",
    meters: { ...OFF_FIELD.meters, goods_proximity: meter("high") },
    manageable: { category: "large-competitor", reason: "a live competitor, but the onset consonant carries the mark apart" },
  };
  delete distinguished.off_field_ground;
  assert.equal(parseFindingsJson(doc([BASE, distinguished])).findings[1].band, "Manageable");
});

test("off_field_ground on a rated disposition is a mis-typed disposition, not extra colour", () => {
  const rated = { ...BASE, ordinal: 2, off_field_ground: "different-field" };
  assert.throws(() => parseFindingsJson(doc([BASE, rated])), /finding_off_field_ground_orphan:2/);
});

test("the no-material-risk ground stays reachable at any goods proximity (doc-50's clear win)", () => {
  // Narrowing off-field to the goods claim alone would leave a mark-based clear win un-typeable:
  // `distinguished` demands a band, and the framework's lowest band is "never for clear wins".
  const clearWin = {
    ...OFF_FIELD, off_field_ground: "no-material-risk",
    meters: { ...OFF_FIELD.meters, goods_proximity: meter("high") },
    legal_position: "The senior mark is a device-only registration; the word element is not protected as such.",
    practical_position: "A single dormant filing, no renewals paid since 2019, no marketplace presence.",
  };
  assert.equal(parseFindingsJson(doc([BASE, clearWin])).findings[1].off_field_ground, "no-material-risk");
});

// ── requirement 3: grouping by the shared ground ──────────────────────────────────────────────────────

test("reasonedNegativeGroups groups by the TYPED ground, in a fixed order", () => {
  const mk = (ordinal, over) => ({ ...OFF_FIELD, ordinal, ...over });
  const findings = [
    BASE,                                                                                     // adversarial — not a negative
    mk(2, { off_field_ground: "different-field" }),
    mk(3, { off_field_ground: "no-material-risk" }),
    mk(4, { off_field_ground: "different-field" }),
    mk(5, { disposition: "distinguished", band: "Manageable", off_field_ground: undefined }),
    mk(6, { disposition: "withdrawn", withdrawn_reason: "killed", off_field_ground: undefined }),
    mk(7, { ruled_out: true, ruled_out_reason: "shares the theme, not the word" }),
  ];
  const { total, groups } = reasonedNegativeGroups(findings);
  assert.equal(total, 4, "adversarial, withdrawn and ruled-out are not reasoned negatives");
  assert.deepEqual(groups.map((g) => g.key), ["distinguished", "off-field:different-field", "off-field:no-material-risk"]);
  assert.deepEqual(groups.map((g) => g.findings.length), [1, 2, 1]);
  assert.deepEqual(groups.find((g) => g.key === "off-field:different-field").findings.map((f) => f.ordinal), [2, 4],
    "member order is the caller's — the render passes them already sorted by blocking power");
  assert.match(groups.find((g) => g.key === "off-field:different-field").ground, /different commercial field/);
  assert.ok(groups.every((g) => g.findings.length > 0), "an empty group is unrepresentable — groups are built FROM members");
});

test("zero negatives is a RESULT, not an absence — and an archived off-field says its ground is unstated", () => {
  const none = reasonedNegativeGroups([BASE]);
  assert.deepEqual(none, { total: 0, groups: [] }, "grouped, and there were none");
  assert.equal(reasonedNegativeGroups(null).total, 0, "and the shape never varies, so a caller can always tell");
  assert.equal(reasonedNegativeGround(BASE), null);
  // an archived v5 off-field finding predates the typed ground. Naming it unstated rather than folding it
  // into the field claim IS the point: assuming the ground is how "not in our field" got said about a
  // mark that was in our field.
  const legacy = { ...OFF_FIELD };
  delete legacy.off_field_ground;
  assert.equal(reasonedNegativeGround(legacy), "off-field:unstated");
  assert.match(reasonedNegativeGroups([legacy]).groups[0].ground, /not stated on the record/);
});

// ── the corrective pass must be able to satisfy the contract it is re-validated against ───────────────

test("the corrective prompt names off_field_ground and the positions as addable on a disposition re-type", async () => {
  // The corrective pass tells the model "THE FINDINGS CONTRACT IS CLOSED — NEVER invent a key", and its
  // output is re-validated through the STRICT parser. So a reviewer flag that re-types a finding to
  // off-field would need a key the prompt forbids — obeying the instruction and failing the file, with no
  // path out of the ladder. Both corrective prompt sites must name the exception.
  // RE-POINTED: both corrective prompts moved into the one registry, so the scan reads the file
  // that composes them. Scanning the file they left would find nothing and PASS — an absence wearing a
  // green tick, in a test whose subject is an instruction the model must be given.
  const src = await readFile(new URL("../repair-composers.mjs", import.meta.url), "utf8");
  const closed = src.split("THE FINDINGS CONTRACT IS CLOSED").slice(1);
  assert.equal(closed.length, 2, "both corrective sites are covered — a new one must extend this test");
  for (const clause of closed) {
    const head = clause.slice(0, 2000);
    assert.match(head, /off_field_ground/, "a re-type TO off-field must be told it may add the ground");
    assert.match(head, /legal_position/, "…and that a re-typed finding still carries both positions");
  }
});

test("report-data carries the declared ground beside the per-member positions", async () => {
  const { clearanceReportData } = await import("../publish/report-data.mjs");
  const findings = parseFindingsJson(doc([BASE, OFF_FIELD])).findings;
  const data = clearanceReportData({ runId: "r", markName: "VOLTMAX", findings, coverage: [] });
  // — SELECTED BY `group`, not by `disposition`: report-data.json is the client cut and does not
  // serve the engine's placement key. `group` is the same partition in the report's own heading words,
  // which is exactly why the key could go.
  const offField = data.findings.find((f) => f.group === "off-field");
  assert.equal(offField.ordinal, 2, "premise: the off-field member is the one this fixture typed off-field");
  assert.equal(offField.off_field_ground, "different-field");
  assert.ok(offField.legal_position && offField.practical_position, "the positions stay per-member, as the issue requires");
  const rated = data.findings.find((f) => f.group === "on-field");
  assert.equal(rated.ordinal, 1, "premise: the rated member is the adversarial one");
  assert.equal(rated.off_field_ground, undefined,
    "the ground is off-field's alone — it never travels on a rated finding");
});

// ── · report.md renders the reasoned negatives report.html already renders ───────────────────────
//
// R2, 2026-08-04: 14 findings — 6 adversarial, 4 distinguished, 4 off-field. findings.json,
// report-data.json and report.html all carried 14; report.md had ten `## ` sections and no negatives
// block, so four reasoned negatives about NAMED proprietors were silent on one delivered surface. The
// standing criterion is that every retrieved close match ends as a finding or a reasoned negative,
// never as silence — and a reader of the Markdown could not know these were considered, let alone why.
//
// Stronger than "the grouping is missing": an off-field finding is REQUIRED to carry band == null and
// its composite is null on a v4+ record, so it fails every clause of fullProseOrdinals, gets no ordinal,
// gets no report-card file, and is dropped. It was absent from report.md entirely.
import { buildReasonedNegativesSection } from "../pipeline.mjs";

test("#340: the off-field findings report.md dropped are present, grouped by their shared ground", () => {
  const md = buildReasonedNegativesSection([BASE, OFF_FIELD]);
  assert.match(md, /^# Reasoned negatives/m);
  assert.match(md, /different commercial field/i, "the shared ground, said once as the heading");
  assert.match(md, /1 mark\b/, "…with its member count, and singular when there is one");
  assert.match(md, new RegExp(`#${OFF_FIELD.ordinal} ${OFF_FIELD.mark}`), "the member is named");
  assert.ok(md.includes(OFF_FIELD.owner.name), "with its proprietor — the part a reader is looking for");
  assert.ok(!md.includes(`#${BASE.ordinal} ${BASE.mark}\n`) || !/adversarial/i.test(md),
    "an on-field conflict is not a reasoned negative and belongs in the cards above");
});

test("#340: the sentence is the TYPED net — this surface summarises nothing of its own", () => {
  // 's defect was two AUTHORS of one summary, not one summary on two surfaces. Both surfaces read
  // findings.json and print `net`, so they cannot disagree.
  const md = buildReasonedNegativesSection([OFF_FIELD]);
  assert.ok(md.includes(OFF_FIELD.net), "verbatim, not re-condensed");

  // an archived record with no net falls back to the legal position, exactly as the HTML line does
  const legacy = { ...OFF_FIELD, net: undefined };
  delete legacy.net;
  assert.ok(buildReasonedNegativesSection([legacy]).includes(OFF_FIELD.legal_position));
});

test("#340: zero is not absence — a run that grouped and found none says so", () => {
  const md = buildReasonedNegativesSection([BASE]);
  assert.match(md, /^# Reasoned negatives/m, "the section is present");
  assert.match(md, /None\./, "and states the zero, so a reader never guesses whether the grouping ran");
  assert.deepEqual(buildReasonedNegativesSection([]).split("\n")[0], "# Reasoned negatives");
});

test("#340: a withdrawn finding stays out — it renders nowhere else either", () => {
  const killed = { ...OFF_FIELD, disposition: "withdrawn", withdrawn_reason: "reviewer flag: confabulated owner" };
  const md = buildReasonedNegativesSection([BASE, killed]);
  assert.match(md, /None\./, `a killed finding is not a reasoned negative: ${md}`);
});

test("#340: groups come out in the contract's order, not the model's array order", () => {
  const distinguished = { ...OFF_FIELD, ordinal: 3, disposition: "distinguished", band: "Moderate",
    manageable: { category: "large-competitor", reason: "the house mark distinguishes" } };
  delete distinguished.off_field_ground;
  const md = buildReasonedNegativesSection([OFF_FIELD, distinguished]);
  assert.ok(md.indexOf("distinguished on the mark") < md.indexOf("different commercial field"),
    `GROUND_ORDER decides, so two runs of one matter cannot reorder the section: ${md}`);
});
