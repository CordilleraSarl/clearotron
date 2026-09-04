// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// P5 (charter 2026-07-30, Reviewer §L + Round-2 §4) — the content model: legal_position /
// practical_position separated on every rated finding, the manageable {category, reason} on
// notable-but-manageable findings (promote-or-omit), and the top-level four_answers data block.
// All OPTIONAL in the parser (archived v4/v5 runs parse byte-identically); strict on presence,
// token-first. All offline, synthetic fixtures (structure-copied shapes only — no client data).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFindingsJson, parseFindingsJsonLenient, MANAGEABLE_CATEGORIES } from "../findings-model.mjs";
import { contentModelChecks } from "../predelivery-lint.mjs";

const meter = (token, basis = "verified-from-record") => ({ token, basis });
const FINDING = {
  ordinal: 1, mark: "VOLTMAX", disposition: "adversarial", band: "High",
  owner: { name: "Synth Beverages GmbH", country: "DE", registrations: [{ uri: "/mark/eu/000000001" }] },
  meters: { mark_similarity: meter("high"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("medium", "inferred-from-signal") },
  quadrant: { x: 0.8, y: 0.7 },
  source: { source_type: "register-vendor", resolved_link: "https://example.com/r/1" },
};
const v5doc = (finding = {}, extra = {}) => JSON.stringify({
  schema_version: 5, rated_under_framework: "house-default",
  findings: [{ ...FINDING, ...finding }],
  coverage: [{ area: "register / EU", state: "confirmed-clean", note: "enumerated" }],
  ...extra,
});

// ---- legal_position / practical_position -------------------------------------------------------------

test("legal/practical: optional (absent parses clean — archived runs), valid strings pass, empties throw token-first", () => {
  assert.equal(parseFindingsJson(v5doc()).findings[0].legal_position, undefined);
  const v = parseFindingsJson(v5doc({
    legal_position: "Near-identical mark over identical class-32 goods — a high legal read under the framework.",
    practical_position: "The owner's retail listing was delisted in 2024 and no revenue is visible.",
  }));
  assert.match(v.findings[0].legal_position, /high legal read/);
  assert.match(v.findings[0].practical_position, /delisted/);
  assert.throws(() => parseFindingsJson(v5doc({ legal_position: " " })), /finding_legal_position_invalid:1/);
  assert.throws(() => parseFindingsJson(v5doc({ practical_position: 7 })), /finding_practical_position_invalid:1/);
});

test("legal/practical: v4-only keys — a v3 (composite) doc carrying them rejects as unknown keys", () => {
  const v3 = {
    schema_version: 3,
    findings: [{ ordinal: 1, mark: "VOLTMAX", composite: 4, level: "B", dispute_type: "classic", owner: FINDING.owner, meters: FINDING.meters, quadrant: FINDING.quadrant, source: FINDING.source, legal_position: "x" }],
    coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }],
  };
  assert.throws(() => parseFindingsJson(JSON.stringify(v3)), /finding_key_unknown:legal_position/);
});

// ---- manageable {category, reason} -------------------------------------------------------------------

test("manageable: every closed-enum category validates on a coexistence-partner finding", () => {
  for (const category of MANAGEABLE_CATEGORIES) {
    const v = parseFindingsJson(v5doc({ disposition: "coexistence-partner", band: "Manageable", manageable: { category, reason: "documented coexistence stands on the record" } }));
    assert.equal(v.findings[0].manageable.category, category);
  }
});

test("manageable defects throw token-first: off-enum category, missing reason, unknown key, wrong shape", () => {
  const on = (m) => v5doc({ disposition: "distinguished", band: "Manageable", manageable: m });
  assert.throws(() => parseFindingsJson(on({ category: "big-company", reason: "why" })), /finding_manageable_category_invalid:big-company/);
  assert.throws(() => parseFindingsJson(on({ category: "troll", reason: "" })), /finding_manageable_reason_missing:1/);
  assert.throws(() => parseFindingsJson(on({ category: "troll", reason: "why", extra: 1 })), /finding_manageable_key_unknown:extra/);
  assert.throws(() => parseFindingsJson(on("troll")), /finding_manageable_invalid:1/);
});

test("manageable on an adversarial or off-field finding is a mis-typed disposition (promote-or-omit has no third state)", () => {
  assert.throws(() => parseFindingsJson(v5doc({ manageable: { category: "large-competitor", reason: "why" } })), /finding_manageable_on_unmanageable:1/);
  assert.throws(() => parseFindingsJson(v5doc({ disposition: "off-field", band: undefined, manageable: { category: "large-competitor", reason: "why" } })), /finding_manageable_on_unmanageable:1/);
  // withdrawn tolerates a stale one (forensic record, renders nowhere)
  const v = parseFindingsJson(v5doc({ disposition: "withdrawn", withdrawn_reason: "reviewer killed it", manageable: { category: "troll", reason: "stale" } }));
  assert.equal(v.findings[0].manageable.category, "troll");
});

// ---- four_answers ------------------------------------------------------------------------------------

const ANSWERS = {
  third_party_rights: { read: "Strong senior rights block the core class.", token: "strong", basis: "findings 1-3, senior registrations verified", ordinals: [1] },
  objection_likelihood: { read: "An objection from the class-32 incumbent is likely.", token: "likely", ordinals: [1] },
  registrability: { read: "The descriptive element carries no exclusive rights of its own.", token: "registrable-with-conditions", obstacles: [{ class: "32", note: "the office holds the element descriptive for these goods" }] },
  client_enforceability: { read: "A weak name to own — enforcement would reach only near-identical takes.", token: "weak", basis: "element crowd + suggestive spectrum" },
};

test("four_answers: optional (absent parses clean), the full grounded set validates, partial sets are honest", () => {
  assert.equal(parseFindingsJson(v5doc()).fourAnswers, null);
  const v = parseFindingsJson(v5doc({}, { four_answers: ANSWERS }));
  assert.equal(v.fourAnswers.third_party_rights.token, "strong");
  assert.equal(v.fourAnswers.registrability.obstacles.length, 1);
  // an answer the run cannot ground is OMITTED — a partial block is valid
  const partial = parseFindingsJson(v5doc({}, { four_answers: { third_party_rights: ANSWERS.third_party_rights } }));
  assert.equal(partial.fourAnswers.objection_likelihood, undefined);
});

test("four_answers defects throw token-first: unknown answer, missing read, off-enum token, obstacles off registrability", () => {
  const fa = (o) => v5doc({}, { four_answers: o });
  assert.throws(() => parseFindingsJson(fa({ fifth_answer: { read: "x" } })), /findings_four_answers_key_unknown:fifth_answer/);
  assert.throws(() => parseFindingsJson(fa({ third_party_rights: { token: "strong" } })), /findings_four_answers_read_missing:third_party_rights/);
  assert.throws(() => parseFindingsJson(fa({ objection_likelihood: { read: "x", token: "certain" } })), /findings_four_answers_token_invalid:objection_likelihood.certain/);
  assert.throws(() => parseFindingsJson(fa({ third_party_rights: { read: "x", obstacles: [] } })), /findings_four_answers_key_unknown:third_party_rights.obstacles/);
  assert.throws(() => parseFindingsJson(fa({ registrability: { read: "x", obstacles: [{ class: "", note: "n" }] } })), /findings_four_answers_invalid:registrability/);
  assert.throws(() => parseFindingsJson(fa({ client_enforceability: { read: "x", ordinals: [0] } })), /findings_four_answers_ordinals_invalid:client_enforceability/);
});

test("four_answers is v5-only: a v4 doc carrying it rejects the key token-first", () => {
  const v4 = JSON.parse(v5doc({}, { four_answers: ANSWERS })); v4.schema_version = 4;
  assert.throws(() => parseFindingsJson(JSON.stringify(v4)), /findings_key_unknown:four_answers/);
});

test("lenient path: a malformed four_answers block never sinks the parse (best-effort null)", () => {
  const v = parseFindingsJsonLenient(v5doc({}, { four_answers: { third_party_rights: { token: "strong" } } }));
  assert.equal(v.fourAnswers, null);
  assert.equal(v.findings.length, 1);
});

// ---- predelivery-lint presence flags (flags, never load-blocking) ------------------------------------

test("contentModelChecks: silent without `expected` (replay corpus never grows a failure)", () => {
  assert.deepEqual(contentModelChecks({ findings: [FINDING], fourAnswers: null, expected: false }), []);
});

test("contentModelChecks: flags the category-less manageable finding, the unsplit rated finding, the absent four_answers", () => {
  const bare = { ...FINDING, ordinal: 2, disposition: "coexistence-partner", band: "Manageable" };
  const out = contentModelChecks({ findings: [FINDING, bare], fourAnswers: null, expected: true });
  const by = Object.fromEntries(out.map((c) => [c.id, c]));
  assert.equal(by["manageable-category"].pass, false);
  assert.match(by["manageable-category"].detail, /ordinal 2/);
  assert.equal(by["legal-practical-split"].pass, false);
  // — the detail now names each finding's DISPOSITION beside its ordinal: "which negative is
  // silent" is the question a reader of this flag is actually asking.
  assert.match(by["legal-practical-split"].detail, /ordinal 1 \(adversarial\), 2 \(coexistence-partner\)/);
  assert.equal(by["four-answers-present"].pass, false);
  for (const c of out) if (!c.pass) assert.equal(c.structural, true);
});

test("contentModelChecks: a complete content model passes all three", () => {
  const good = {
    ...FINDING,
    legal_position: "High similarity over identical goods — high legal risk.",
    practical_position: "Active enforcer with recent oppositions.",
    net: "The legal risk is a near-identical senior mark over identical goods — no coexistence terms are on the record searched.",   //
  };
  const managed = {
    ...FINDING, ordinal: 2, disposition: "distinguished", band: "Manageable",
    legal_position: "Same element, distinguished by the house mark.",
    practical_position: "No enforcement history.",
    manageable: { category: "well-known-enforcer", reason: "famous owner, but the house mark distinguishes" },
    net: "The shared element sits behind the house mark, and the owner has never asserted it against a composite.",   //
  };
  const withdrawn = { ...FINDING, ordinal: 3, disposition: "withdrawn", withdrawn_reason: "killed" };
  const out = contentModelChecks({ findings: [good, managed, withdrawn], fourAnswers: { third_party_rights: { read: "Strong senior rights." } }, expected: true });
  assert.ok(out.every((c) => c.pass), JSON.stringify(out.filter((c) => !c.pass)));
});
