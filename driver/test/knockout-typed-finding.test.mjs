// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the knockout typed finding: the SHAPE, which gates ranking, evidence and concrete coverage.
//
// The stage writes structured rows with free-prose cells today — the analysis lives in `bullets[]`,
// unranked and untyped — so render-knockout.mjs contains no sort at all and prints bullets because that
// is all it is given. This file pins the record the stage build will emit. It does NOT test the stage:
// emission is 's own build, and these are the rules that build has to satisfy.
//
// The one decision that had to be made before any of it: the verdict vocabulary is the FRAMEWORK'S BAND
// WORDS, not a dedicated Blocking/Crowd pair. Reasoning posted on before building; the short form
// is that the knockout report is already band-rated at per-NAME grain (knockout-assess/SKILL.md: "rating
// must be a band from the frozen ladder") and carries `framework: {source, ladder}` in its own artifact,
// so a per-finding band is one vocabulary reaching one level finer — while a dedicated pair would be a
// second rating vocabulary on the same page.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateKnockoutFinding, validateKnockoutFindings, compareKnockoutBlockingPower,
  KNOCKOUT_FINDING_TYPES, knockoutFindingViews, knockoutFindingRange,
} from "../findings-model.mjs";

// A 5-band ladder with its own words, so nothing here can accidentally pass against a hardcoded set.
const MANIFEST = {
  schema_version: 1, framework_key: "aurora", title: "Synthetic five-band deck", entity_label: "the company",
  bands: [{ label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
};
const OK = {
  ordinal: 1, name: "VELTRA PHARMA", owner: "Veltra Labs GmbH", band: "High", type: "Active Business",
  net: "Veltra Labs' unregistered VELTRA PHARMA use is more likely than not to block the applicant in Germany.",
  evidence: ["https://example.invalid/shop/veltra-pharma"],
  basis: "Continuous German retail listings since 2019 under the applicant's exact goods, with an active storefront.",
};
const f = (over) => validateKnockoutFinding({ ...OK, ...over }, 0, new Set(), { manifest: MANIFEST });

test("#471 — the typed record carries everything the card and the rank need", () => {
  const out = f({});
  for (const k of ["ordinal", "name", "owner", "band", "net", "type", "evidence", "basis"]) assert.ok(out[k], `${k} survives`);
  assert.equal(out.band, "High");
  // `impact` is REPLACED by the band, not carried beside it — two rating vocabularies inside one record
  // is the defect the band decision exists to avoid. `description`/`url` are likewise gone: the
  // conclusion sentence and the evidence LIST replace them.
  for (const dead of [{ impact: "HIGH" }, { description: "prose" }, { url: "https://example.invalid/x" }])
    assert.throws(() => f(dead), /knockout_finding_key_unknown/, `${Object.keys(dead)[0]} must be refused, not tolerated`);
});

test("#471 — the band is the framework's own word, checked against the run's frozen ladder", () => {
  assert.equal(f({ band: "medium" }).band, "Medium", "normalised to the deck's casing, exactly as a clearance band is");
  assert.throws(() => f({ band: "Blocking" }), /knockout_finding_band_invalid/,
    "a word from a vocabulary this run does not rate in — the dedicated-pair answer, refused by construction");
  assert.throws(() => f({ band: "Crowd" }), /knockout_finding_band_invalid/);
  assert.throws(() => f({ band: 3 }), /knockout_finding_band_invalid/, "never a number or a code (doc-50)");
  // Offline/unit paths with no manifest stay shape-only, mirroring parseFindingsJson's band handling.
  assert.equal(validateKnockoutFinding({ ...OK, band: "Whatever" }, 0).band, "Whatever");
  assert.throws(() => validateKnockoutFinding({ ...OK, band: "Level 3" }, 0), /knockout_finding_band_invalid/);
});

test("#471 — the finding sentence is #469's contract, on the other product", () => {
  // One rule and one gate across both products: the same lawyer reads a knockout card and a clearance
  // card in the same week, and a sentence contract that held in one place only would be no contract.
  assert.throws(() => f({ net: "VELTRA PHARMA in DE; listed since 2019 → likely to block." }), /knockout_finding_net_chained/);
  assert.throws(() => f({ net: "VELTRA PHARMA in DE -> likely to block." }), /knockout_finding_net_chained/);
  assert.throws(() => f({ net: "We recommend seeking consent from the German seller." }), /knockout_finding_net_prescriptive/);
  assert.throws(() => f({ net: "  " }), /knockout_finding_net_missing/);
  assert.ok(f({ net: "Veltra Labs — a German retailer — is more likely than not to block the applicant." }).net,
    "an em-dash is not a chain marker: the gate reads two punctuation marks, never a style");
});

test("#471 — a card that cannot be opened is the untyped bullet with a shape around it", () => {
  assert.throws(() => f({ evidence: [] }), /knockout_finding_evidence_missing/);
  assert.throws(() => f({ evidence: "https://example.invalid/x" }), /knockout_finding_evidence_missing/, "a list, not a single url");
  assert.throws(() => f({ evidence: ["  "] }), /knockout_finding_evidence_invalid/);
  assert.equal(f({ evidence: ["https://example.invalid/a", "https://example.invalid/b"] }).evidence.length, 2);
});

test("#471 — owner is required, and its honest negative is a VALUE, never a guess", () => {
  // A required field that cannot be left out is a field a model will invent, and "never confabulate the
  // owner/seller" is doctrine. So the requirement is that the author say SOMETHING; the stated absence
  // is an accepted answer, the same idiom use_check.source uses.
  assert.throws(() => f({ owner: "" }), /knockout_finding_owner_missing/);
  assert.ok(f({ owner: "not established on the searched material" }).owner);
});

test("#471 — the rank comes from the stage's typed band, and an unknown word never leads", () => {
  const set = [
    { ...OK, ordinal: 1, band: "Manageable" },
    { ...OK, ordinal: 2, band: "Very High" },
    { ...OK, ordinal: 3, band: "Wildcard" },   // a word the manifest does not know
    { ...OK, ordinal: 4, band: "Very High" },
  ];
  const ranked = [...set].sort((a, b) => compareKnockoutBlockingPower(a, b, MANIFEST)).map((x) => x.ordinal);
  assert.deepEqual(ranked, [2, 4, 1, 3], "band order first, ordinal for stability, unknown word LAST — never first");
  // Not a count: two pieces of evidence do not outrank a worse band. Volume is not a risk multiplier.
  const byEvidence = [{ ...OK, ordinal: 1, band: "Manageable", evidence: ["a", "b", "c"] }, { ...OK, ordinal: 2, band: "High", evidence: ["a"] }];
  assert.deepEqual([...byEvidence].sort((a, b) => compareKnockoutBlockingPower(a, b, MANIFEST)).map((x) => x.ordinal), [2, 1]);
  // Without a manifest the order is ordinal — an archived/offline path re-orders nothing.
  assert.deepEqual([...set].sort((a, b) => compareKnockoutBlockingPower(a, b)).map((x) => x.ordinal), [1, 2, 3, 4]);
});

test("#471 — the list: ordinals unique per mark, a clean mark is [] and never prose", () => {
  assert.deepEqual(validateKnockoutFindings([], { manifest: MANIFEST }), []);
  assert.deepEqual(validateKnockoutFindings(null, { manifest: MANIFEST }), [], "absent ⇒ clean, the same as empty");
  assert.throws(() => validateKnockoutFindings("no conflicts found", { manifest: MANIFEST }), /knockout_findings_invalid/);
  assert.throws(() => validateKnockoutFindings([OK, { ...OK }], { manifest: MANIFEST }), /knockout_finding_ordinal_duplicate/);
  assert.equal(validateKnockoutFindings([OK, { ...OK, ordinal: 2 }], { manifest: MANIFEST }).length, 2);
  assert.throws(() => validateKnockoutFindings([{ ...OK, ordinal: 0 }], { manifest: MANIFEST }), /knockout_finding_ordinal_invalid/);
});

test("#471 — type stays as the taxonomy it is, and is not a second rating", () => {
  for (const t of KNOCKOUT_FINDING_TYPES) assert.ok(f({ type: t }).type);
  assert.throws(() => f({ type: "Blocking" }), /knockout_finding_type_invalid/);
  assert.ok(!KNOCKOUT_FINDING_TYPES.some((t) => MANIFEST.bands.some((b) => b.label === t)),
    "the two vocabularies are disjoint by construction — type says what a finding IS, band says how bad");
});

test("#471 — the throw family is knockout_, NOT findings_, or the repair aims at the wrong file", () => {
  // gateway.mjs repairSiblingName routes every `/findings?_/` token to findings.json — the CLEARANCE
  // artifact, which a knockout run never writes. A knockout token borrowing that family would order the
  // model to repair a file the stage does not have.
  const tokenOf = (fn) => { try { fn(); return null; } catch (e) { return String(e.message).split(/[:\s]/)[0]; } };
  for (const bad of [{ band: 3 }, { evidence: [] }, { owner: "" }, { net: "a; b" }, { ordinal: 0 }, { type: "Nope" }])
    assert.match(tokenOf(() => f(bad)) ?? "", /^knockout_/, `${JSON.stringify(bad)} must throw in the knockout_ family`);
  assert.match(tokenOf(() => validateKnockoutFindings("prose")) ?? "", /^knockout_/);
});

// ── The SURFACE VIEW: the one dual read, and the one drill-through key ( build) ──────────────────
//
// The shape above is the contract. This is what every delivery surface actually reads — and the reason
// it exists is the defect the build closed: three surfaces each did their own read of a finding, one of
// them filtered on a field the typed record does not have, and a mark with conflicts rendered to the
// client as a clean mark. One projection, and nothing in either shape falls out of it.
test("#471 — the view projects the typed record whole, and ranks by band", () => {
  const mark = { name: "IRONWHISK", findings: [
    { ...OK, ordinal: 1, name: "Low rival", band: "Manageable" },
    { ...OK, ordinal: 2, name: "High rival", band: "Very High" },
  ] };
  const views = knockoutFindingViews(mark, { manifest: MANIFEST });
  assert.deepEqual(views.map((v) => v.ordinal), [2, 1], "blocking order, off the typed band");
  assert.deepEqual(views.map((v) => v.ref), ["IRONWHISK #2", "IRONWHISK #1"],
    "the key is <MARK> #<per-mark ordinal> — the only one on this lane");
  assert.equal(views[0].lead, OK.net, "the conclusion sentence is what the card leads with");
  assert.equal(views[0].detail, OK.basis);
  assert.deepEqual(views[0].evidence, OK.evidence);
  assert.equal(views[0].shape, "typed");
  assert.equal(views[0].owner, OK.owner);
});

// KNOCKOUT PROSE ARM 2026-08-06 — an archived run republishes through the same surfaces, so the view
// reads the delivered prose row too. Delete this arm with the others, and not before.
test("#471 — the view reads the ARCHIVED prose row, and records what that shape never carried", () => {
  const mark = { name: "IRONWHISK", findings: [
    { name: "Rival Ltd", type: "Active Business", url: "https://example.invalid/a", description: "A marketplace seller.", impact: "HIGH" },
    { name: "Second", type: "Domain", url: "https://example.invalid/b", description: "A parked domain.", impact: "LOW" },
  ] };
  const views = knockoutFindingViews(mark, { manifest: MANIFEST });
  assert.deepEqual(views.map((v) => v.ordinal), [1, 2], "a prose row has no ordinal, so position is the key");
  assert.deepEqual(views.map((v) => v.ref), ["IRONWHISK #1", "IRONWHISK #2"]);
  assert.equal(views[0].lead, "A marketplace seller.", "the description is the sentence it leads with");
  assert.equal(views[0].detail, null, "the prose row had no basis — recorded as absent, never invented");
  assert.equal(views[0].band, null, "and no band: `impact` is NOT translated into one behind the reader's back");
  assert.deepEqual(views[0].evidence, ["https://example.invalid/a"], "its one url reads as the evidence list");
  assert.equal(views[0].shape, "prose");
  // no band ⇒ no re-ranking: a republished archived report keeps the order it was delivered in
  assert.deepEqual(knockoutFindingViews(mark).map((v) => v.ordinal), [1, 2]);
});

test("#471 — the mark's whole finding block has one reference too, and an empty mark has none", () => {
  assert.equal(knockoutFindingRange({ name: "IRONWHISK", findings: [{ ...OK, ordinal: 1 }] }), "IRONWHISK #1");
  assert.equal(knockoutFindingRange({ name: "IRONWHISK", findings: [{ ...OK, ordinal: 1 }, { ...OK, ordinal: 4 }] }), "IRONWHISK #1–#4");
  assert.equal(knockoutFindingRange({ name: "IRONWHISK", findings: [] }), "", "no findings ⇒ no reference, never a wrong one");
  assert.equal(knockoutFindingRange({ name: "", findings: [{ ...OK }] }), "");
});
