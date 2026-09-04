// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// findings-model — the per-finding machine contract. Mirrors coverage-ledger.test.mjs: the strict JSON parser
// (token-first throws, closed enums, additionalProperties:false by hand), and the validators.findings
// machine-vs-legacy dispatch (no sibling ⇒ legacy pass; bad JSON ⇒ fail-closed; the validator NEVER throws).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseFindingsJson, parseFindingsJsonLenient, consolidateFindings, CONTEXT_NOTE_TYPES,
  LEVELS, DISPUTE_TYPES, METERS, METER_TOKENS, BASIS_VALUES, SOURCE_TYPES, COVERAGE_AREA_STATES, DISPOSITIONS,
} from "../findings-model.mjs";
import { validators } from "../verify.mjs";
import { correctionHint, warmEligible } from "../gateway.mjs";

// ---- fixtures ------------------------------------------------------------------------------------

const meter = (token, basis = "verified-from-record") => ({ token, basis });
const FINDING = {
  ordinal: 1,
  mark: "LUMENGARDE",
  owner: {
    name: "Plesner Advokatpartnerselskab", country: "DK",
    registrations: [
      { uri: "/mark/eu/018553557", classes: ["09", "41"], status: "Registered", filed: "2021-09-07", expiry: "2031-09-07", jurisdiction: "EU" },
      { uri: "/mark/eu/018553560", classes: ["25"], status: "Registered", filed: "2004-02-01", expiry: "2034-02-01", jurisdiction: "EU" },
    ],
  },
  composite: 4, level: "B", dispute_type: "paper-conflict",
  meters: {
    mark_similarity: meter("high"),
    goods_proximity: meter("medium", "inferred-from-signal"),
    use: meter("confirmed"),
    enforcer: meter("high"),
  },
  quadrant: { x: 0.72, y: 0.55 },
  // — the ACTIVE provider's record host, not a placeholder. scripts/test-run.mjs declares
  // CLEAROTRON_DATABASE=corsearch for every suite, and verify.mjs now refuses a register-sourced
  // link whose host is not one that provider publishes. A fixture citing a host nobody searched is the
  // exact shape the gate exists to catch, so it cannot keep claiming to be one.
  source: { source_type: "register-vendor", resolved_link: "https://tm.corsearch.com/mark/eu/018553557" },
};
const DOC = { schema_version: 1, findings: [FINDING], coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }] };
const raw = (o) => JSON.stringify(o);
// deep clone so per-test mutations never bleed
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- C2: consolidateFindings (same owner + same mark → one finding, registrations unioned) --------

const f2 = (over) => clone({ ...FINDING, ...over });

test("consolidateFindings: same owner + same mark (case-only diff) fold into one; registrations unioned; renumber 1..N", () => {
  const input = [
    f2({ ordinal: 1, mark: "PETCARYN", owner: { name: "Petcaryn Animal Health AB", country: "CH", registrations: [{ uri: "/mark/int/1426961" }] }, composite: 4, level: "D" }),
    f2({ ordinal: 2, mark: "Petcary", owner: { name: "Project Management Limited", country: "CH", registrations: [{ uri: "/mark/ch/03285/2026" }] }, composite: 3, level: "C" }),
    f2({ ordinal: 3, mark: "petcary", owner: { name: "Project Management Limited", country: "CH", registrations: [{ uri: "/mark/ch/09415/2026" }] }, composite: 3, level: "C" }),
    f2({ ordinal: 4, mark: "TRUPETCARYN", owner: { name: "Trupetcaryn, Inc.", country: "CH", registrations: [{ uri: "/mark/int/1443046" }] }, composite: 2, level: "B" }),
  ];
  const { findings, merges } = consolidateFindings(input);
  assert.equal(findings.length, 3, "the two PETCARY filings collapse to one finding");
  assert.deepEqual(findings.map((f) => f.ordinal), [1, 2, 3], "ordinals renumbered contiguously");
  const petcary = findings.find((f) => f.owner.name === "Project Management Limited");
  assert.deepEqual(petcary.owner.registrations.map((r) => r.uri).sort(),
    ["/mark/ch/03285/2026", "/mark/ch/09415/2026"], "both filings preserved on the single card");
  assert.equal(petcary.ordinal, 2, "the merged finding keeps the group's first position");
  assert.equal(merges.length, 1);
  assert.deepEqual(merges[0].dropped, [3]);
  // the consolidated set is still a VALID findings doc
  assert.doesNotThrow(() => parseFindingsJson(raw({ schema_version: 1, findings, coverage: [{ area: "register / CH", state: "confirmed-clean", note: "" }] })));
});

test("consolidateFindings: distinct owners or distinct marks are NEVER merged (no false collapse)", () => {
  const input = [
    f2({ ordinal: 1, mark: "PETCARY", owner: { name: "Owner A", registrations: [{ uri: "/a" }] } }),
    f2({ ordinal: 2, mark: "PETCARY", owner: { name: "Owner B", registrations: [{ uri: "/b" }] } }),   // same mark, different owner
    f2({ ordinal: 3, mark: "PETCARY INC", owner: { name: "Owner A", registrations: [{ uri: "/c" }] } }),// same owner, different mark
  ];
  const { findings, merges } = consolidateFindings(input);
  assert.equal(merges.length, 0);
  assert.equal(findings.length, 3, "no merge across different owner or different mark");
});

// ---- exported vocabularies (one home for the closed enums) ---------------------------------------

test("vocab: the closed enums are exactly the design's tokens", () => {
  assert.deepEqual(LEVELS, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(DISPUTE_TYPES, ["classic", "horse-trade", "paper-conflict", "descriptive-terms", "nuisance-claim"]);
  assert.deepEqual(METERS, ["mark_similarity", "goods_proximity", "use", "enforcer"]);
  assert.deepEqual(METER_TOKENS.mark_similarity, ["high", "medium", "low"]);   // 3-pip; fine position is in quadrant
  assert.deepEqual(METER_TOKENS.use, ["confirmed", "not-confirmed", "unknown"]);
  assert.deepEqual(BASIS_VALUES, ["verified-from-record", "inferred-from-signal"]);
  assert.deepEqual(SOURCE_TYPES, ["register-vendor", "register-euipo", "common-law-marketplace", "common-law-web", "case-law"]);
  assert.deepEqual(COVERAGE_AREA_STATES, ["confirmed-clean", "coverage-limited", "open", "not-searched", "note"]);
  assert.deepEqual(DISPOSITIONS, ["adversarial", "coexistence-partner", "distinguished", "off-field", "withdrawn"]);   // A1
  assert.deepEqual(Object.keys(METER_TOKENS).sort(), [...METERS].sort());
});

// ---- strict parser: valid ------------------------------------------------------------------------

test("parse: a valid record returns its findings + coverage; multi-reg owner keeps both registrations", () => {
  const out = parseFindingsJson(raw(DOC));
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].owner.registrations.length, 2, "A3 — one owner holds two registrations, neither overwritten");
  assert.equal(out.coverage[0].state, "confirmed-clean");
  assert.equal(out.schemaVersion, 1);
});

test("parse: clean matter (zero findings, coverage present) is VALID; wholly-empty record is rejected", () => {
  assert.equal(parseFindingsJson(raw({ findings: [], coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }] })).findings.length, 0);
  assert.throws(() => parseFindingsJson(raw({ findings: [], coverage: [] })), (e) => e.message.startsWith("findings_empty"));
});

// ---- strict parser: token-FIRST throws (the corrective-hint contract) ----------------------------

test("throws token-FIRST on every defect class", () => {
  const t = (mutate, token) => {
    const d = clone(DOC); mutate(d);
    assert.throws(() => parseFindingsJson(raw(d)), (e) => e.message.startsWith(token), `${token} must lead for mutation`);
  };
  // top-level shape
  assert.throws(() => parseFindingsJson("not json {"), (e) => e.message.startsWith("findings_unparseable"));
  assert.throws(() => parseFindingsJson(raw([FINDING])), (e) => e.message.startsWith("findings_unparseable"));   // bare array, not object
  assert.throws(() => parseFindingsJson(raw({ findings: {} })), (e) => e.message.startsWith("findings_unparseable")); // findings not array
  t((d) => { d.surprise = 1; }, "findings_key_unknown:surprise");
  t((d) => { d.coverage = {}; }, "findings_coverage_invalid");
  t((d) => { d.coverage[0].oops = 1; }, "findings_coverage_key_unknown:oops");
  t((d) => { d.coverage[0].state = "clean"; }, "findings_coverage_state_invalid:clean");
  // per-finding scalars
  t((d) => { d.findings[0].mystery = 1; }, "finding_key_unknown:mystery");
  t((d) => { d.findings[0].ordinal = 0; }, "finding_ordinal_invalid:0");
  t((d) => { d.findings.push(clone(FINDING)); }, "finding_ordinal_duplicate:1");
  t((d) => { d.findings[0].mark = ""; }, "finding_mark_missing:1");
  t((d) => { d.findings[0].composite = 6; }, "finding_composite_invalid:6");
  t((d) => { d.findings[0].level = "F"; }, "finding_level_invalid:F");
  t((d) => { d.findings[0].dispute_type = "lawsuit"; }, "finding_dispute_type_invalid:lawsuit");
  // owner + registrations (A3)
  t((d) => { d.findings[0].owner = "Acme"; }, "finding_owner_invalid:1");
  t((d) => { d.findings[0].owner.weird = 1; }, "finding_owner_key_unknown:weird");
  t((d) => { d.findings[0].owner.registrations[0].nope = 1; }, "finding_registration_key_unknown:nope");
  t((d) => { d.findings[0].owner.registrations[0].uri = ""; }, "finding_registration_invalid");
  t((d) => { d.findings[0].owner.registrations[0].classes = "09"; }, "finding_registration_invalid");
  // meters + basis (B1)
  t((d) => { delete d.findings[0].meters.enforcer; }, "finding_meter_missing:enforcer");
  t((d) => { d.findings[0].meters.bogus = meter("high"); }, "finding_meter_unknown:bogus");
  t((d) => { d.findings[0].meters.mark_similarity.token = "huge"; }, "finding_meter_token_invalid:mark_similarity:huge");
  t((d) => { d.findings[0].meters.use.basis = "guessed"; }, "finding_basis_invalid:use:guessed");
  // quadrant / source (E1/E2)
  t((d) => { d.findings[0].quadrant.x = 1.4; }, "finding_quadrant_invalid:x=1.4");
  t((d) => { d.findings[0].source.source_type = "register"; }, "finding_source_type_invalid:register");
  t((d) => { d.findings[0].source.junk = 1; }, "finding_source_key_unknown:junk");
});

// ---- Instance #5: per-finding use_check / own_rights schema (SHAPE-only in the parser) -------------

test("use_check / own_rights: valid use_check (source URL) on a Composite 3+ finding parses", () => {
  const d = clone(DOC); d.findings[0].use_check = { source: "https://example.com/result" };
  assert.equal(parseFindingsJson(raw(d)).findings[0].use_check.source, "https://example.com/result");
});

test("use_check / own_rights: own_rights with record URIs parses", () => {
  const d = clone(DOC); d.findings[0].own_rights = { source: "/mark/eu/000123, /mark/us/75000" };
  assert.equal(parseFindingsJson(raw(d)).findings[0].own_rights.source, "/mark/eu/000123, /mark/us/75000");
});

test("use_check / own_rights: own_rights honest-negative string parses", () => {
  const d = clone(DOC); d.findings[0].own_rights = { source: "no applicant-owned registrations in the searched register material" };
  assert.equal(parseFindingsJson(raw(d)).findings[0].own_rights.source, "no applicant-owned registrations in the searched register material");
});

test("use_check / own_rights: a finding with BOTH fields populated parses", () => {
  const d = clone(DOC);
  d.findings[0].use_check = { source: "https://perplexity.example/r" };
  d.findings[0].own_rights = { source: "/mark/eu/000123456" };
  const out = parseFindingsJson(raw(d)).findings[0];
  assert.equal(out.use_check.source, "https://perplexity.example/r");
  assert.equal(out.own_rights.source, "/mark/eu/000123456");
});

test("use_check / own_rights: a Composite <3 finding without the fields parses (optional)", () => {
  const d = clone(DOC); d.findings[0].composite = 2; delete d.findings[0].use_check; delete d.findings[0].own_rights;
  assert.equal(parseFindingsJson(raw(d)).findings[0].composite, 2);
});

test("use_check / own_rights: legacy findings.json WITHOUT the fields parses clean (back-compat, schema 1)", () => {
  const out = parseFindingsJson(raw(DOC));   // DOC carries no use_check / own_rights
  assert.equal(out.schemaVersion, 1);
  assert.equal(out.findings[0].use_check, undefined);
  assert.equal(out.findings[0].own_rights, undefined);
});

test("use_check / own_rights: SHAPE throws are token-FIRST (non-object, unknown key, non-string source)", () => {
  const t = (mutate, token) => {
    const d = clone(DOC); mutate(d);
    assert.throws(() => parseFindingsJson(raw(d)), (e) => e.message.startsWith(token), `${token} must lead`);
  };
  t((d) => { d.findings[0].use_check = "https://x"; }, "finding_use_check_invalid:1");           // not an object
  t((d) => { d.findings[0].use_check = { source: "x", extra: 1 }; }, "finding_use_check_key_unknown:extra");
  t((d) => { d.findings[0].use_check = { source: 7 }; }, "finding_use_check_source_missing:1");   // non-string source
  t((d) => { d.findings[0].own_rights = "/mark/eu/1"; }, "finding_own_rights_invalid:1");
  t((d) => { d.findings[0].own_rights = { source: "x", who: 1 }; }, "finding_own_rights_key_unknown:who");
  t((d) => { d.findings[0].own_rights = { source: null }; }, "finding_own_rights_source_missing:1");
});

// ---- A4: optional meter `source` + use_check `quality` (v2 docs without them parse clean) ----
test("spec-48 A4: a meter may NAME its source; use_check may carry a quality class — both optional, both typed", () => {
  const d = clone(DOC);
  d.findings[0].meters.mark_similarity.source = "/mark/eu/018553557";
  d.findings[0].use_check = { source: "https://owner.example/shop", quality: "owner-site" };
  const out = parseFindingsJson(raw(d)).findings[0];
  assert.equal(out.meters.mark_similarity.source, "/mark/eu/018553557");
  assert.equal(out.use_check.quality, "owner-site");
  // legacy DOC (no source / quality anywhere) parses clean — v2/archived runs immune
  assert.equal(parseFindingsJson(raw(DOC)).findings[0].meters.mark_similarity.source, undefined);
});

test("spec-48 A4: SHAPE throws are token-FIRST (non-string meter source; off-enum use_check quality)", () => {
  const t = (mutate, token) => {
    const d = clone(DOC); mutate(d);
    assert.throws(() => parseFindingsJson(raw(d)), (e) => e.message.startsWith(token), `${token} must lead`);
  };
  t((d) => { d.findings[0].meters.use.source = 7; }, "finding_meter_source_invalid:use:7");
  t((d) => { d.findings[0].use_check = { source: "x", quality: "blog" }; }, "finding_use_check_quality_invalid:blog");
});

// ---- #6: optional per-finding `deadline` (a client-facing time-critical date; SHAPE-only) ----------
test("#6 deadline: a valid { kind, date } parses; legacy WITHOUT it parses clean (optional)", () => {
  const d = clone(DOC); d.findings[0].deadline = { kind: "opposition", date: "2026-07-19" };
  assert.deepEqual(parseFindingsJson(raw(d)).findings[0].deadline, { kind: "opposition", date: "2026-07-19" });
  assert.equal(parseFindingsJson(raw(DOC)).findings[0].deadline, undefined, "legacy doc with no deadline parses clean");
});

test("#6 deadline: SHAPE throws are token-FIRST (non-object, unknown key, missing date)", () => {
  const t = (mutate, token) => {
    const d = clone(DOC); mutate(d);
    assert.throws(() => parseFindingsJson(raw(d)), (e) => e.message.startsWith(token), `${token} must lead`);
  };
  t((d) => { d.findings[0].deadline = "2026-07-19"; }, "finding_deadline_invalid:1");                 // not an object
  t((d) => { d.findings[0].deadline = { date: "2026-07-19", extra: 1 }; }, "finding_deadline_key_unknown:extra");
  t((d) => { d.findings[0].deadline = { kind: "opposition" }; }, "finding_deadline_date_missing:1");  // no date
  t((d) => { d.findings[0].deadline = { kind: 7, date: "2026-07-19" }; }, "finding_deadline_invalid:1"); // non-string kind
});

// ---- CHANGE 2: optional per-finding `disposition` (a PLACEMENT token; never recomputes composite) -------
test("disposition: each valid value parses; legacy WITHOUT it parses clean (optional, schema 1)", () => {
  for (const d of DISPOSITIONS) {
    const doc = clone(DOC); doc.findings[0].disposition = d;
    if (d === "withdrawn") doc.findings[0].withdrawn_reason = "review flag: confabulated attribution";   // A1
    assert.equal(parseFindingsJson(raw(doc)).findings[0].disposition, d, `${d} parses`);
  }
  assert.deepEqual(DISPOSITIONS, ["adversarial", "coexistence-partner", "distinguished", "off-field", "withdrawn"]);
  assert.equal(parseFindingsJson(raw(DOC)).findings[0].disposition, undefined, "legacy doc with no disposition parses clean");
});

test("disposition: an unknown value throws token-FIRST (finding_disposition_invalid:<v>)", () => {
  const d = clone(DOC); d.findings[0].disposition = "headline";
  assert.throws(() => parseFindingsJson(raw(d)), (e) => e.message.startsWith("finding_disposition_invalid:headline"));
});

test("disposition: it does NOT touch composite/level — a Composite-3 coexistence-partner keeps composite 3", () => {
  const d = clone(DOC); d.findings[0].composite = 3; d.findings[0].disposition = "coexistence-partner";
  const out = parseFindingsJson(raw(d)).findings[0];
  assert.equal(out.composite, 3, "composite is unchanged by disposition");
  assert.equal(out.disposition, "coexistence-partner");
});

// ---- CHANGE 5d: coverage[].state controlled vocabulary is NORMALIZED (trim/lowercase) then validated ----
test("coverage 5d: a near-miss state token (case / whitespace) is REPAIRED to the canonical value", () => {
  const cases = [["Confirmed-Clean", "confirmed-clean"], [" open ", "open"], ["NOT-SEARCHED", "not-searched"], ["Coverage-Limited", "coverage-limited"]];
  for (const [given, want] of cases) {
    const d = clone(DOC); d.coverage[0].state = given;
    assert.equal(parseFindingsJson(raw(d)).coverage[0].state, want, `${JSON.stringify(given)} repaired to ${want}`);
  }
});

test("coverage 5d: a genuinely-unknown state still throws token-FIRST (normalize is repair, not loosening)", () => {
  const d = clone(DOC); d.coverage[0].state = "clean";   // not in the vocabulary even after normalize
  assert.throws(() => parseFindingsJson(raw(d)), (e) => e.message.startsWith("findings_coverage_state_invalid:clean"));
});

// ---- Three-tier risk: per-finding impact (SHAPE-only optional string; surfaced, never a rating) ---

test("impact: an optional impact string parses and round-trips", () => {
  const d = clone(DOC); d.findings[0].impact = "An injunction would hit physical stock already shipping — for the client to weigh.";
  assert.equal(parseFindingsJson(raw(d)).findings[0].impact, "An injunction would hit physical stock already shipping — for the client to weigh.");
});

test("impact: legacy findings.json WITHOUT impact parses clean (optional, back-compat)", () => {
  assert.equal(parseFindingsJson(raw(DOC)).findings[0].impact, undefined);
});

test("impact: a non-string impact throws token-FIRST; the key allowlist is not loosened", () => {
  const d = clone(DOC); d.findings[0].impact = { severity: "high" };
  assert.throws(() => parseFindingsJson(raw(d)), (e) => e.message.startsWith("finding_impact_invalid:1"), "finding_impact_invalid must lead");
  const d2 = clone(DOC); d2.findings[0].consequence = "x";   // a near-miss key is still rejected
  assert.throws(() => parseFindingsJson(raw(d2)), (e) => e.message.startsWith("finding_key_unknown:consequence"));
});

// ---- validators.findings dispatch (machine-vs-legacy; NEVER throws) ------------------------------

function runDirWith({ findingsJson = null, narrative = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "findings-"));
  writeFileSync(join(dir, "narrative.md"), narrative);
  if (findingsJson != null) writeFileSync(join(dir, "findings.json"), findingsJson);
  return dir;
}
const validate = (dir, narrative = "") => validators.findings(join(dir, "narrative.md"), narrative);
const NARRATIVE_WITH_MARK = "## Finding 1 — LUMENGARDE (Plesner)\nComposite — 4. The LUMENGARDE mark...";

test("dispatch: no findings.json beside the file → legacy pass (archived runs; replay must not flip)", () => {
  const v = validate(runDirWith());
  assert.equal(v.ok, true);
  assert.notEqual(v.reason, "machine-findings");
});

test("dispatch: valid JSON + a narrative that mentions the mark → machine path ok", () => {
  const v = validate(runDirWith({ findingsJson: raw(DOC), narrative: NARRATIVE_WITH_MARK }), NARRATIVE_WITH_MARK);
  assert.deepEqual(v, { ok: true, reason: "machine-findings" });
});

test("dispatch: valid JSON + a narrative that OMITS the mark → ok (Instance #4 — prose mirror retired)", () => {
  // Pre-retirement this raised findings_mirror_missing:LUMENGARDE. The JSON is the single source of truth
  // (the report renders from it), so an omitted prose mention is no longer a gate.
  const noMention = "## Finding 1 — SOMETHING ELSE\nComposite — 2.";
  const v = validate(runDirWith({ findingsJson: raw(DOC), narrative: noMention }), noMention);
  assert.deepEqual(v, { ok: true, reason: "machine-findings" });
});

// ---- gateway corrective-ladder wiring: findings_* tokens reach the findings hint, not the generic one ----

test("gateway: findings_* tokens route to the findings.json hint, are warm-eligible, and don't hijack coverage_", () => {
  // every contract token reaches the findings hint (not the generic fallback)
  for (const tok of ["findings_unparseable", "finding_composite_invalid:6", "finding_meter_token_invalid:use:huge", "findings_coverage_state_invalid:clean"]) {
    assert.match(correctionHint(tok), /findings\.json is a JSON OBJECT/, `hint for ${tok}`);
    assert.equal(warmEligible(`invalid_file:narrative.md:${tok}`, { status: "ok" }), true, `warm-eligible: ${tok}`);
  }
  // REGRESSION GUARD: placing the findings branch first must not steal real coverage-ledger tokens, and
  // the register-digest structural "findings+ledger" token (no underscore) must not hit the findings branch.
  assert.match(correctionHint("coverage_axis_invalid:foo"), /register-coverage-ledger\.json/);
  assert.doesNotMatch(correctionHint("missing:findings+ledger"), /findings\.json is a JSON OBJECT/);
});

test("dispatch: invalid JSON → fail(token), and the validator NEVER throws on any malformed input", () => {
  const bads = [
    "not json {", raw([]), raw({ findings: [] }),
    raw({ findings: [{ ...FINDING, level: "Z" }], coverage: [] }),
    raw({ findings: [{ ...FINDING, meters: {} }], coverage: [] }),
  ];
  for (const bad of bads) {
    let v;
    assert.doesNotThrow(() => { v = validate(runDirWith({ findingsJson: bad, narrative: NARRATIVE_WITH_MARK }), NARRATIVE_WITH_MARK); });
    assert.equal(v.ok, false, `must fail closed for: ${bad.slice(0, 40)}`);
    assert.match(v.reason, /^findings?_/, `token-first reason for: ${bad.slice(0, 40)}`);
  }
});

// ---- A1/A2/A3 fix: context_notes, URI-guard regression, lenient quarantine, corrective hints -----

const NOTE = { type: "famous-neighbour-ungrounded", mark: "CHROME", owner: "Google LLC", context: "one keystroke from NOVAPULSE; famous mark; no fetched record; off-field" };

test("context_notes: a valid famous-neighbour note parses and is returned", () => {
  const out = parseFindingsJson(raw({ ...DOC, context_notes: [NOTE] }));
  assert.equal(out.contextNotes.length, 1);
  assert.equal(out.contextNotes[0].mark, "CHROME");
  assert.deepEqual(CONTEXT_NOTE_TYPES, ["famous-neighbour-ungrounded"]);
});

test("context_notes: legacy doc with no context_notes key still parses (contextNotes:[])", () => {
  assert.deepEqual(parseFindingsJson(raw(DOC)).contextNotes, []);
});

test("context_notes: token-first throws on bad type / unknown key / non-empty fields", () => {
  assert.throws(() => parseFindingsJson(raw({ ...DOC, context_notes: [{ ...NOTE, type: "nope" }] })),
    (e) => e.message.startsWith("findings_context_note_type_invalid:nope"));
  assert.throws(() => parseFindingsJson(raw({ ...DOC, context_notes: [{ ...NOTE, bogus: 1 }] })),
    (e) => e.message.startsWith("findings_context_note_key_unknown:bogus"));
  assert.throws(() => parseFindingsJson(raw({ ...DOC, context_notes: [{ type: "famous-neighbour-ungrounded", mark: "", context: "x" }] })),
    (e) => /findings_context_note_invalid/.test(e.message));
});

test("A1 guard INTACT: a famous neighbour faked as an empty-uri registration is still rejected", () => {
  const bad = clone(FINDING);
  bad.owner.registrations = [{ uri: "", classes: ["9", "42"], status: "Registered (famous mark)", filed: "", expiry: "", jurisdiction: "worldwide" }];
  assert.throws(() => parseFindingsJson(raw({ ...DOC, findings: [bad] })),
    (e) => e.message.startsWith("finding_registration_invalid"), "the F-14 URI guard must NOT be loosened");
});

test("A3 lenient: quarantines the malformed finding, keeps the valid remainder + records the mark", () => {
  const bad = clone(FINDING); bad.ordinal = 2; bad.mark = "CHROME";
  bad.owner.registrations = [{ uri: "" }];
  const out = parseFindingsJsonLenient(raw({ ...DOC, findings: [FINDING, bad] }));
  assert.equal(out.findings.length, 1, "valid finding kept");
  assert.equal(out.findings[0].ordinal, 1);
  assert.equal(out.quarantined.length, 1, "malformed finding quarantined");
  assert.equal(out.quarantined[0].mark, "CHROME");
  assert.match(out.quarantined[0].error, /finding_registration_invalid/);
});

// ---- WP-56 B2: mark_assessment — the standing "mark itself" read (optional; both parsers) ----

const MA = { distinctiveness: "Coined and strong in the filed classes; the dominant element is NOVAPULSE.", connotation: "No adverse readings across the EN/zh/es sweeps." };

test("mark_assessment: a valid block parses on BOTH parsers; absent stays null (legacy runs unchanged)", () => {
  assert.deepEqual(parseFindingsJson(raw({ ...DOC, mark_assessment: MA })).markAssessment, MA);
  assert.equal(parseFindingsJson(raw(DOC)).markAssessment, null);
  assert.deepEqual(parseFindingsJsonLenient(raw({ ...DOC, mark_assessment: MA })).markAssessment, MA);
  assert.equal(parseFindingsJsonLenient(raw(DOC)).markAssessment, null);
});

test("mark_assessment: strict throws token-first on unknown key / empty half; lenient drops it to null (never sinks the run)", () => {
  assert.throws(() => parseFindingsJson(raw({ ...DOC, mark_assessment: { ...MA, bogus: 1 } })),
    (e) => e.message.startsWith("findings_mark_assessment_key_unknown:bogus"));
  assert.throws(() => parseFindingsJson(raw({ ...DOC, mark_assessment: { distinctiveness: "", connotation: "x" } })),
    (e) => /findings_mark_assessment_invalid/.test(e.message));
  const out = parseFindingsJsonLenient(raw({ ...DOC, mark_assessment: { distinctiveness: "", connotation: "x" } }));
  assert.equal(out.markAssessment, null, "quarantine path drops the malformed block and keeps delivering");
  assert.equal(out.findings.length, 1, "findings untouched by a bad mark_assessment");
});

test("A3 lenient: an all-valid doc quarantines nothing; a top-level defect still throws", () => {
  assert.equal(parseFindingsJsonLenient(raw(DOC)).quarantined.length, 0);
  assert.throws(() => parseFindingsJsonLenient("{ not json"), (e) => e.message.startsWith("findings_unparseable"));
});

test("A2 correctionHint: the registration/source/context-note branches name the SPECIFIC fix", () => {
  const reg = correctionHint("invalid_file:x/narrative.md:finding_registration_invalid: (registration.uri must be a non-empty string)");
  assert.match(reg, /registrations":\[\]|registrations:\[\]/);
  assert.match(reg, /context_notes/);
  const src = correctionHint("invalid_file:x/narrative.md:finding_source_invalid:3 (source must be { source_type, resolved_link })");
  assert.match(src, /source_type/);
  assert.match(src, /common-law/);
  const note = correctionHint("invalid_file:x/narrative.md:findings_context_note_type_invalid:nope (...)");
  assert.match(note, /famous-neighbour-ungrounded/);
});

// ---- A1: withdrawn_reason pairing + corrections marker + consolidation isolation ----
test("withdrawn: requires withdrawn_reason; orphan reason rejects; consolidation never merges a withdrawn base", () => {
  const d1 = clone(DOC); d1.findings[0].disposition = "withdrawn";
  assert.throws(() => parseFindingsJson(raw(d1)), (e) => e.message.startsWith("finding_withdrawn_reason_missing:1"));
  const d2 = clone(DOC); d2.findings[0].withdrawn_reason = "reason without withdrawal";
  assert.throws(() => parseFindingsJson(raw(d2)), (e) => e.message.startsWith("finding_withdrawn_reason_orphan:1"));
  // consolidation: same owner+mark, one live + one withdrawn ⇒ two entries survive (no fold)
  const live = { ...clone(DOC).findings[0], ordinal: 1 };
  const killed = { ...clone(DOC).findings[0], ordinal: 2, disposition: "withdrawn", withdrawn_reason: "review kill" };
  const { findings: merged } = consolidateFindings([live, killed]);
  assert.equal(merged.length, 2, "a withdrawn finding is a non-mergeable singleton");
  assert.equal(merged.filter((f) => f.disposition === "withdrawn").length, 1);
});

test("corrections marker: valid parses through; malformed throws token-first; lenient degrades to null", () => {
  const d = clone(DOC); d.corrections = { applied: true, note: "KESTRELION withdrawn; owner corrected to Cipla" };
  assert.deepEqual(parseFindingsJson(raw(d)).corrections, d.corrections);
  const bad = clone(DOC); bad.corrections = { applied: "yes" };
  assert.throws(() => parseFindingsJson(raw(bad)), (e) => e.message.startsWith("findings_corrections_invalid"));
  assert.equal(parseFindingsJsonLenient(raw(bad)).corrections, null, "lenient path degrades, never throws on the marker");
  assert.equal(parseFindingsJson(raw(clone(DOC))).corrections, null, "legacy doc without the marker parses clean");
});

// ── T2 (H5): the single display-verdict derivation + the deterministic recommendation bound ────
import { deriveDisplayVerdict, bindRecommendation, isUnconditionalProceed, maxLiveComposite } from "../findings-model.mjs";

test("deriveDisplayVerdict: tier/badge/gauge derive from the WORST LIVE composite; withdrawn findings never count", () => {
  const F = (composite, disposition) => ({ composite, disposition });
  const d = deriveDisplayVerdict({ verdict: "conditional", reasons: ["a gap"], kinds: { coverage: true },
    findings: [F(2), F(4, "withdrawn"), F(1)] });
  assert.equal(d.maxComposite, 2, "the withdrawn 4 never drives the label");
  assert.deepEqual([d.tier, d.badge, d.gaugeIndex], ["MANAGEABLE", "l2", 1]);
  assert.equal(d.verdict, "CONDITIONAL");
  assert.deepEqual(d.conditions, ["a gap"]);
  const worst = deriveDisplayVerdict({ verdict: "CLEAR", findings: [F(5), F(3)] });
  assert.deepEqual([worst.tier, worst.badge, worst.gaugeIndex], ["VERY HIGH", "l4", 4]);
  const clean = deriveDisplayVerdict({ verdict: "CLEAR", findings: [] });
  assert.deepEqual([clean.tier, clean.badge, clean.gaugeIndex, clean.maxComposite], ["LOW", "l1", 0, 0]);
  assert.equal(maxLiveComposite([F(3), F(5, "withdrawn")]), 3);
});

test("bindRecommendation: an unconditional proceed on CONDITIONAL gains its conditions; bound/other verdicts pass through", () => {
  assert.equal(bindRecommendation("Proceed with the filing.", "CONDITIONAL", ["close the CN gap"]),
    "Proceed with the filing — subject to: close the CN gap");
  // already bound → untouched (the validator and the bound share ONE predicate)
  assert.equal(bindRecommendation("Proceed once the CN gap closes.", "CONDITIONAL", ["x"]), "Proceed once the CN gap closes.");
  assert.equal(bindRecommendation("Proceed.", "CLEAR", []), "Proceed.");
  assert.match(bindRecommendation("Proceed.", "BLOCKING", []), /On hold/);
  assert.equal(isUnconditionalProceed("Proceed with the launch"), true);
  assert.equal(isUnconditionalProceed("Proceed, subject to the CN check"), false);
  assert.equal(isUnconditionalProceed("Hold pending checks"), false);
});

test("bindRecommendation: the CLIENT cap trims the verbatim reason run-on to the top reasons + a char budget; uncapped callers get the full join", () => {
  const reasons = ["close the CN register gap", "confirm the DE priority date", "narrow the class 9 goods", "resolve the applicant-identity question"];
  // uncapped (the report hero) — every reason verbatim, no elision
  const full = bindRecommendation("Proceed.", "CONDITIONAL", reasons);
  assert.equal(full, `Proceed — subject to: ${reasons.join("; ")}`);
  // client cap — top 2 reasons only, elision marked, and it STILL carries the bound word (validator-safe)
  const capped = bindRecommendation("Proceed.", "CONDITIONAL", reasons, { maxReasons: 2, maxLen: 240 });
  assert.match(capped, /^Proceed — subject to: close the CN register gap; confirm the DE priority date; …$/);
  assert.equal(isUnconditionalProceed(capped), false, "the capped bind still reads as conditioned");
  assert.ok(capped.length < full.length, "the cap shortens the client run-on");
  // a single reason longer than the char budget is truncated to the budget with an ellipsis
  const long = bindRecommendation("Proceed.", "CONDITIONAL", ["x".repeat(400)], { maxReasons: 2, maxLen: 60 });
  assert.ok(long.length <= "Proceed — subject to: ".length + 60 + 1, "long single reason held to the char budget");
  assert.match(long, /…$/);
});

// ── T6 (H8): adversarial ordering — who can actually block first ───────────────────────────────
import { compareBlockingPower, inDispositionMode, bandOf } from "../findings-model.mjs";

test("compareBlockingPower: disposition mode — adversarial outranks a higher-composite coexistence partner; legacy mode is byte-stable", () => {
  const F = (ordinal, composite, level, disposition, enforcer, deadline) => ({
    ordinal, composite, level, disposition, deadline,
    meters: { enforcer: { token: enforcer ?? "unknown", basis: "inferred-from-signal" } },
  });
  const adversarialC3 = F(4, 3, "C", "adversarial", "low");
  const coexistC4 = F(1, 4, "D", "coexistence-partner", "high");
  const offField = F(2, 2, "B", "off-field");
  const advHighEnf = F(3, 3, "C", "adversarial", "high");
  const advDeadline = F(5, 3, "C", "adversarial", "high", "2026-08-01");
  const set = [offField, coexistC4, adversarialC3, advHighEnf, advDeadline];
  assert.equal(inDispositionMode(set), true);
  const sorted = [...set].sort((a, b) => compareBlockingPower(a, b, true));
  // band first: the adversarial C3s lead the coexistence C4; within band: enforcer high + deadline first
  assert.deepEqual(sorted.map((f) => f.ordinal), [5, 3, 4, 1, 2]);
  assert.equal(bandOf(coexistC4), 2);
  // LEGACY (no dispositions): byte-identical to the old composite-desc/ordinal-asc sort
  const legacy = [F(1, 2, "B"), F(2, 4, "D"), F(3, 4, "C"), F(4, 3, "C")].map((f) => ({ ...f, disposition: undefined }));
  assert.equal(inDispositionMode(legacy), false);
  const ls = [...legacy].sort((a, b) => compareBlockingPower(a, b, inDispositionMode(legacy)));
  assert.deepEqual(ls.map((f) => f.ordinal), [2, 3, 4, 1], "composite desc, ordinal asc — unchanged");
});

// ── wp50: deterministic client-summary block → finding join ─────────────────────────────────────────────
import { joinFindingToBlock, parseBlockOrd } from "../findings-model.mjs";

test("joinFindingToBlock: the VENZY fixture — exact mark beats containment; ambiguity never guesses", () => {
  // the real ashen-vault shape: VENZY (C5), DEMVENZY (C3), VENZY-India (C3), VENZ (C3)
  const findings = [
    { ordinal: 1, mark: "VENZY", owner: { name: "Doruk İlkay" }, composite: 5 },
    { ordinal: 2, mark: "DEMVENZY", owner: { name: "Novartis Pharma AG" }, composite: 3 },
    { ordinal: 3, mark: "VENZY", owner: { name: "not extracted" }, composite: 3 },
    { ordinal: 4, mark: "VENZ", owner: { name: "SAMI Pharmaceuticals" }, composite: 3 },
  ];
  // the old containment join bound this to ordinal 1 (head contains "venzy") → enforced VERY HIGH
  assert.equal(joinFindingToBlock({ ord: null, head: "DEMVENZY — Novartis Pharma AG" }, findings)?.ordinal, 2);
  assert.equal(joinFindingToBlock({ ord: null, head: "VENZ — SAMI Pharmaceuticals (Pakistan)" }, findings)?.ordinal, 4);
  // two live VENZY findings → head "VENZY — …" is ambiguous without an ord line: honest null, never a guess
  assert.equal(joinFindingToBlock({ ord: null, head: "VENZY — Owner not identified (India)" }, findings), null);
  // the ord line resolves it exactly
  assert.equal(joinFindingToBlock({ ord: 3, head: "VENZY — Owner not identified (India)" }, findings)?.ordinal, 3);
  // withdrawn findings never join
  const withdrawn = findings.map((f) => f.ordinal === 2 ? { ...f, disposition: "withdrawn" } : f);
  assert.equal(joinFindingToBlock({ ord: 2, head: "DEMVENZY — Novartis" }, withdrawn), null);
  // unique containment still works when nothing collides (legacy summaries without ord lines)
  assert.equal(joinFindingToBlock({ ord: null, head: "OPTIVENZY tablets — Laboratoires Majorelle" },
    [{ ordinal: 6, mark: "OPTIVENZY", composite: 2 }])?.ordinal, 6);
});

test("parseBlockOrd: reads the ord line, tolerates absence", () => {
  assert.equal(parseBlockOrd("- ord: 7\n- risk: MEDIUM"), 7);
  assert.equal(parseBlockOrd("- risk: MEDIUM"), null);
  assert.equal(parseBlockOrd("- ord: seven"), null);
});

// ---- doc 50: schema_version 4 — the framework in force rates the matter (band mode) ---------------

import { worstLiveBand, NO_RATED_CONFLICTS } from "../findings-model.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const ZEPHYR_MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "zephyr", title: "Zephyr Beverages risk framework", source_deck: "deck",
  entity_label: "Zephyr/Volt/Kaskade",
  bands: [
    { label: "Very High", tone: "severe" }, { label: "High", tone: "high" },
    { label: "Medium", tone: "medium" }, { label: "Manageable", tone: "low" },
  ],
  structure: { kind: "bands" },
});
const v4finding = (over = {}) => {
  const f = clone(FINDING);
  delete f.composite; delete f.level; delete f.dispute_type;
  return { ...f, disposition: "adversarial", band: "Medium", ...over };
};
const V4DOC = (findings, over = {}) => ({ schema_version: 4, rated_under_framework: "zephyr", findings, coverage: [], ...over });

test("v4: a rated finding carries the framework's band word; the retired scale is FORBIDDEN token-first", () => {
  const okDoc = parseFindingsJson(raw(V4DOC([v4finding()])), { manifest: ZEPHYR_MANIFEST });
  assert.equal(okDoc.schemaVersion, 4);
  assert.equal(okDoc.ratedUnderFramework, "zephyr");
  assert.equal(okDoc.findings[0].band, "Medium");
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding({ composite: 3 })]))), /finding_legacy_scale_forbidden:composite/);
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding({ level: "C" })]))), /finding_legacy_scale_forbidden:level/);
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding({ dispute_type: "classic" })]))), /finding_legacy_scale_forbidden:dispute_type/);
});

test("v4: band-by-disposition matrix — rated need one, off-field forbids one, withdrawn tolerates", () => {
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding({ band: undefined })]))), /finding_band_missing:1/);
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding({ disposition: "off-field" })]))), /finding_band_forbidden:1/);
  const awareness = parseFindingsJson(raw(V4DOC([v4finding({ disposition: "off-field", band: undefined })])));
  assert.equal(awareness.findings[0].band, undefined);
  const withdrawn = parseFindingsJson(raw(V4DOC([v4finding({ disposition: "withdrawn", withdrawn_reason: "review kill" })])));
  assert.equal(withdrawn.findings[0].band, "Medium", "a withdrawn finding keeps its stale band as forensic record");
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding({ disposition: undefined })]))), /finding_disposition_missing:1/);
});

test("v4: band words judged against the frozen manifest — normalised to its casing; foreign vocabulary rejected", () => {
  const doc = parseFindingsJson(raw(V4DOC([v4finding({ band: "  mEdIuM " })])), { manifest: ZEPHYR_MANIFEST });
  assert.equal(doc.findings[0].band, "Medium", "case/whitespace normalised to the manifest's word");
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding({ band: "Moderate" })])), { manifest: ZEPHYR_MANIFEST }),
    /finding_band_invalid:Moderate/, "the house word is not a Zephyr Beverages word");
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding({ band: "Level 3" })]))), /finding_band_invalid/);
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding()], { rated_under_framework: undefined }))), /findings_rated_under_missing/);
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding()], { rated_under_framework: "house-default" })), { manifest: ZEPHYR_MANIFEST }),
    /findings_rated_under_mismatch:house-default/);
});

test("v4 derive: tier = worst live band; zero banded → 'No rated conflicts' (never LOW); fail-loud without manifest", () => {
  const findings = [v4finding(), v4finding({ ordinal: 2, band: "High" }), v4finding({ ordinal: 3, disposition: "withdrawn", band: "Very High", withdrawn_reason: "killed" })];
  const d = deriveDisplayVerdict({ verdict: "CLEAR", findings, manifest: ZEPHYR_MANIFEST });
  assert.equal(d.tier, "High", "withdrawn Very High never drives the tier");
  assert.equal(d.badge, "l4");
  assert.equal(d.gaugeIndex, 3);
  assert.deepEqual(d.band, { label: "High", rankFromTop: 2, scale: 4 });
  const clean = deriveDisplayVerdict({ verdict: "CLEAR", findings: [v4finding({ disposition: "off-field", band: undefined })], manifest: ZEPHYR_MANIFEST });
  assert.equal(clean.tier, NO_RATED_CONFLICTS);
  assert.equal(clean.badge, "l1");
  assert.equal(clean.gaugeIndex, 0);
  assert.throws(() => deriveDisplayVerdict({ verdict: "CLEAR", findings }), /findings_band_without_manifest/,
    "banded findings with no manifest must THROW, never default a rated matter to LOW");
  assert.equal(worstLiveBand(findings, ZEPHYR_MANIFEST), "High");
});

test("v4 ordering: within a render band the framework's own band order ranks severity", () => {
  const a = v4finding({ ordinal: 1, band: "Medium" });
  const b = v4finding({ ordinal: 2, band: "Very High" });
  const c = v4finding({ ordinal: 3, disposition: "off-field", band: undefined });
  const sorted = [a, b, c].sort((x, y) => compareBlockingPower(x, y, true, ZEPHYR_MANIFEST));
  assert.deepEqual(sorted.map((f) => f.ordinal), [2, 1, 3], "Very High leads; unbanded awareness trails");
});

test("v4 consolidation: the merge base is the WORST BAND by the manifest's order", () => {
  const dup1 = v4finding({ ordinal: 1, band: "Manageable" });
  const dup2 = v4finding({ ordinal: 2, band: "High" });
  const { findings, merges } = consolidateFindings([dup1, dup2], ZEPHYR_MANIFEST);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].band, "High", "the High member is the base");
  assert.equal(merges[0].kept, 2);
});

// ---- spec 64: typed forward actions + derived conditions + THE one risk statement -----------------

import {
  ACTION_KINDS, CONDITION_KINDS, ADVISORY_KINDS, validateAction, deriveActionConditions,
  remapActionOrdinals, riskStatement, verdictStance, sentenceCaseLead,
} from "../findings-model.mjs";

const ACTION = { id: 1, kind: "consent", text: "Obtain consent or a territorial delimitation from Doruk İlkay before filing in TR/AE/QA/SA.", ordinals: [1] };

test("spec 64: kind partition — every kind is exactly one of condition/advisory", () => {
  assert.deepEqual(ACTION_KINDS, [...CONDITION_KINDS, ...ADVISORY_KINDS]);
  assert.equal(new Set(ACTION_KINDS).size, ACTION_KINDS.length, "no kind appears twice");
});

test("spec 64: strict parse accepts a valid actions[]; legacy doc without one parses with actions:null", () => {
  const doc = parseFindingsJson(raw(V4DOC([v4finding()], {
    actions: [ACTION, { id: 2, kind: "client-fact", text: "Confirm whether the older Turkish filing is your own.", ordinals: [], deadline: { kind: "opposition", date: "2026-07-13" } }],
  })), { manifest: ZEPHYR_MANIFEST });
  assert.equal(doc.actions.length, 2);
  assert.equal(doc.actions[1].deadline.date, "2026-07-13");
  assert.equal(parseFindingsJson(raw(V4DOC([v4finding()])), { manifest: ZEPHYR_MANIFEST }).actions, null);
  assert.equal(parseFindingsJson(raw(DOC)).actions, null, "v1 archived doc parses unchanged");
});

test("spec 64: action defects throw token-FIRST for the corrective ladder", () => {
  const withA = (a) => raw(V4DOC([v4finding()], { actions: [a] }));
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding()], { actions: {} }))), /findings_actions_invalid/);
  assert.throws(() => parseFindingsJson(withA({ ...ACTION, extra: 1 })), /finding_action_key_unknown:extra/);
  assert.throws(() => parseFindingsJson(withA({ ...ACTION, id: 0 })), /finding_action_id_invalid:0/);
  assert.throws(() => parseFindingsJson(raw(V4DOC([v4finding()], { actions: [ACTION, { ...ACTION }] }))), /finding_action_id_duplicate:1/);
  assert.throws(() => parseFindingsJson(withA({ ...ACTION, kind: "sue-them" })), /finding_action_kind_invalid:sue-them/);
  assert.throws(() => parseFindingsJson(withA({ ...ACTION, text: " " })), /finding_action_text_missing:1/);
  assert.throws(() => parseFindingsJson(withA({ ...ACTION, ordinals: "1" })), /finding_action_ordinals_invalid:1/);
  assert.throws(() => parseFindingsJson(withA({ ...ACTION, ordinals: [7] })), /finding_action_ordinal_unknown:7/);
  assert.throws(() => parseFindingsJson(withA({ ...ACTION, deadline: { date: "" } })), /finding_action_deadline_invalid:1/);
  assert.throws(() => parseFindingsJson(withA({ ...ACTION, deadline: { date: "2026-07-13", when: "x" } })), /finding_action_deadline_key_unknown:when/);
});

test("spec 64: lenient parse drops a malformed action but RECORDS it (never silent) and keeps the rest", () => {
  const doc = parseFindingsJsonLenient(raw(V4DOC([v4finding()], {
    actions: [ACTION, { id: 9, kind: "nonsense", text: "x", ordinals: [] }],
  })));
  assert.equal(doc.actions.length, 1, "the valid action survives");
  assert.equal(doc.actionsQuarantined.length, 1);
  assert.equal(doc.actionsQuarantined[0].id, 9);
  assert.match(doc.actionsQuarantined[0].error, /finding_action_kind_invalid/);
  const legacy = parseFindingsJsonLenient(raw(DOC));
  assert.equal(legacy.actions, null);
  assert.deepEqual(legacy.actionsQuarantined, []);
});

test("spec 64: consolidation ordinalMap — merged-away members map to the KEPT finding's new ordinal", () => {
  const dup1 = v4finding({ ordinal: 1, band: "Manageable" });
  const dup2 = v4finding({ ordinal: 2, band: "High" });
  const solo = v4finding({ ordinal: 3, mark: "OTHERMARK", owner: { name: "Someone Else", country: "CH", registrations: [] } });
  const { findings, ordinalMap } = consolidateFindings([dup1, dup2, solo], ZEPHYR_MANIFEST);
  assert.equal(findings.length, 2);
  assert.equal(ordinalMap.get(1), 1, "merged-away member follows its group");
  assert.equal(ordinalMap.get(2), 1, "kept base renumbered to 1");
  assert.equal(ordinalMap.get(3), 2);
  const remapped = remapActionOrdinals([{ id: 1, kind: "consent", text: "t", ordinals: [1, 2] }, { id: 2, kind: "monitoring", text: "t", ordinals: [3, 99] }], ordinalMap);
  assert.deepEqual(remapped[0].ordinals, [1], "duplicate group references dedup to the kept ordinal");
  assert.deepEqual(remapped[1].ordinals, [2], "an unknown reference is dropped, the known one remapped");
  // review fix: an action whose EVERY reference dangles is DROPPED, never promoted to run-level —
  // ordinals:[] means always-live and would resurrect a quarantined condition as a verdict input.
  const dangling = remapActionOrdinals([{ id: 3, kind: "consent", text: "ghost", ordinals: [99] }], ordinalMap);
  assert.deepEqual(dangling, [], "a fully-dangling action is dropped");
  assert.deepEqual(remapActionOrdinals([{ id: 4, kind: "consent", text: "run-level", ordinals: [] }], ordinalMap)[0].ordinals, [],
    "a genuine run-level action ([] from the start) survives");
});

test("spec 64 review fix: a merged-away member's structured deadline survives consolidation (earliest wins)", () => {
  const dup1 = v4finding({ ordinal: 1, band: "High" });   // base (worst band), no deadline
  const dup2 = v4finding({ ordinal: 2, band: "Manageable", deadline: { kind: "opposition", date: "2026-07-13" } });
  const { findings } = consolidateFindings([dup1, dup2], ZEPHYR_MANIFEST);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].band, "High", "the High member stays the base");
  assert.deepEqual(findings[0].deadline, { kind: "opposition", date: "2026-07-13" }, "the fold keeps the member's deadline");
});

test("spec 64: deriveActionConditions — author's kind partitions; withdrawn-only actions are dead; [] = run-level = live", () => {
  const findings = [v4finding({ ordinal: 1 }), v4finding({ ordinal: 2, disposition: "withdrawn", withdrawn_reason: "review kill" })];
  const actions = [
    { id: 1, kind: "consent", text: "Obtain consent from the senior owner.", ordinals: [1] },
    { id: 2, kind: "mark-modification", text: "Swap the flavour name.", ordinals: [2] },      // withdrawn-only ⇒ dead
    { id: 3, kind: "client-fact", text: "Confirm the older filing is your own.", ordinals: [] }, // run-level advisory
    { id: 4, kind: "filing-routine", text: "File in the usual classes.", ordinals: [1] },
  ];
  const d = deriveActionConditions(actions, findings);
  assert.deepEqual(d.conditions, ["Obtain consent from the senior owner."]);
  assert.deepEqual(d.advisories, ["Confirm the older filing is your own.", "File in the usual classes."]);
  assert.equal(d.conditionActions.length, 1);
  assert.equal(deriveActionConditions(null, findings).conditions.length, 0, "null-safe");
});

test("PR-3 report voice: action.condition — the factual open-state clause, validated and surfaced index-aligned", () => {
  // valid: a condition kind carrying its factual open-state
  const withCond = { ...ACTION, condition: "consent from Doruk İlkay is not yet in hand" };
  assert.equal(validateAction(withCond, 0, new Set(), new Set([1])).condition, withCond.condition);
  // defects throw token-first for the corrective ladder
  assert.throws(() => validateAction({ ...ACTION, condition: " " }, 0, new Set(), new Set([1])), /finding_action_condition_invalid:1/);
  assert.throws(() => validateAction({ ...ACTION, condition: 3 }, 0, new Set(), new Set([1])), /finding_action_condition_invalid:1/);
  assert.throws(() => validateAction({ id: 5, kind: "monitoring", text: "Watch the register.", ordinals: [], condition: "x" }, 0, new Set(), new Set()),
    /finding_action_condition_on_advisory:5/);
  // deriveActionConditions: clauses align with conditions, clause preferred where typed, text elsewhere
  const d = deriveActionConditions([
    withCond,
    { id: 2, kind: "proceeding-response", text: "Respond to the examiner's objection.", ordinals: [] },
  ], [v4finding({ ordinal: 1 })]);
  assert.deepEqual(d.conditionClauses, ["consent from Doruk İlkay is not yet in hand", "Respond to the examiner's objection."]);
  assert.equal(d.conditionClauses.length, d.conditions.length, "index-aligned with the ask texts");
});

test("spec 64: riskStatement — one coherent sentence per verdict; null on a legacy half-empty sidecar", () => {
  assert.equal(riskStatement({ tier: "High", verdict: "CLEAR" }),
    "High — clear to proceed: no conditions beyond ordinary filing.");
  assert.equal(riskStatement({ tier: NO_RATED_CONFLICTS, verdict: "CLEAR" }),
    "No rated conflicts — clear to proceed: no conditions beyond ordinary filing.");
  assert.equal(riskStatement({ tier: "High", verdict: "CONDITIONAL", reasons: ["obtain consent from Doruk İlkay before filing."] }),
    "High — conditional on: Obtain consent from Doruk İlkay before filing.",
    "the reason is sentence-cased and de-duplicated punctuation-wise");
  const three = riskStatement({ tier: "Medium", verdict: "CONDITIONAL", reasons: ["fix A", "fix B", "fix C"] });
  assert.match(three, /^Medium — conditional on: Fix A \(and 2 more\)\.$/);
  const long = riskStatement({ tier: "High", verdict: "CONDITIONAL", reasons: ["x".repeat(50) + " " + "y".repeat(200)] });
  assert.ok(long.length < 230, "an unbounded reason is clipped for index cells/email headlines");
  assert.match(long, /…$/);
  assert.match(riskStatement({ tier: "High", verdict: "BLOCKING" }), /^On hold — /);
  assert.equal(riskStatement({ tier: "", verdict: "CLEAR" }), null);
  assert.equal(riskStatement({ tier: "High", verdict: "" }), null);
  assert.match(riskStatement({ tier: "High", verdict: "CONDITIONAL", reasons: [] }),
    /^High — conditional on: The open conditions carried in the report/,
    "a legacy CONDITIONAL sidecar with empty reasons still reads sensibly");
});

test("PR-3 report voice: the conditional statement states the FACT that conditions — clauses preferred, count from the reason set, no self-caveat anywhere", () => {
  // the factual open-state clause (action.condition) leads; the ask texts stay the count authority
  assert.equal(riskStatement({ tier: "High", verdict: "CONDITIONAL",
    reasons: ["Obtain consent from Matchday, Inc. before filing.", "Respond to the examiner's objection."],
    clauses: ["consent from Matchday, Inc. is not yet in hand", "the examiner's objection is unanswered"] }),
    "High — conditional on: Consent from Matchday, Inc. is not yet in hand (and 1 more).");
  // no clauses (machinery reasons / legacy) — the reason text itself is the lede
  assert.equal(riskStatement({ tier: "Medium", verdict: "CONDITIONAL", reasons: ["Consent is needed."] }),
    "Medium — conditional on: Consent is needed.");
  // the retired self-caveat never appears on any verdict
  for (const verdict of ["CLEAR", "CONDITIONAL", "BLOCKING"]) {
    const st = riskStatement({ tier: "High", verdict, reasons: ["Fix A"], clauses: ["A is open"] });
    assert.ok(!/do not rely/i.test(st), `${verdict} must never self-caveat: ${st}`);
  }
  // register-only basis note still rides the conditional form
  assert.equal(riskStatement({ tier: "High", verdict: "CONDITIONAL", reasons: ["Fix A."], basis: "register-only" }),
    "High — conditional on: Fix A. Register findings only — no common-law or marketplace search was run.");
});

test("PR-3 report voice: verdictStance — one structured value per verdict, null on unknown/legacy", () => {
  assert.equal(verdictStance("CONDITIONAL"), "conditional");
  assert.equal(verdictStance("conditional"), "conditional", "case-folded");
  assert.equal(verdictStance("CLEAR"), "clear");
  assert.equal(verdictStance("BLOCKING"), "on-hold");
  assert.equal(verdictStance(""), null);
  assert.equal(verdictStance("WEIRD"), null);
  assert.equal(verdictStance(undefined), null);
});

test("spec 64: sentenceCaseLead — first letter capitalized through markdown/quote openers; everything else untouched", () => {
  assert.equal(sentenceCaseLead("the legal risk is X — consent is not yet in hand."), "The legal risk is X — consent is not yet in hand.");
  assert.equal(sentenceCaseLead("**the legal risk** is X."), "**The legal risk** is X.");
  assert.equal(sentenceCaseLead("“the conditioning fact”"), "“The conditioning fact”");
  assert.equal(sentenceCaseLead("The legal risk."), "The legal risk.", "already capitalized ⇒ byte-identical");
  assert.equal(sentenceCaseLead("2026-07-13 is the deadline."), "2026-07-13 is the deadline.", "digit lead untouched");
  assert.equal(sentenceCaseLead(""), "");
  assert.equal(sentenceCaseLead(null), "");
});

// ──: A REGISTER LINK THAT IS NOT A LINK ───────────────────────────────────────────────────────
//
// `checkRecordUrlHost` asks whether a link points at the WRONG register, and `recordUrlOrigin` returns
// null for anything with no host — so the host gate returned CLEAN for `#`. Correct for its own purpose,
// and it meant nothing in the findings path asked whether the link was a link. The value then composed
// `- Source: [EUIPO · 018575624](#)`: the delivered R5 shape is about, byte for byte.
import { isDeadRecordLink } from "../findings-model.mjs";

test("#1710 a register resolved_link with no host is rejected, under its own reason", () => {
  const withLink = (resolved_link) => raw(clone({
    ...DOC, findings: [{ ...FINDING, source: { source_type: "register-vendor", resolved_link } }],
  }));

  // CONTROL FIRST — the fixture's real link must still validate, or the arm proves nothing.
  assert.doesNotThrow(() => parseFindingsJson(withLink("https://tm.corsearch.com/mark/eu/018553557")));

  for (const dead of ["#", "#details/trademarks/018575624", "/mark/eu/018553557", "   "]) {
    assert.throws(() => parseFindingsJson(withLink(dead)), (e) => {
      assert.match(e.message, /finding_record_url_not_a_link:/,
        `${JSON.stringify(dead)} must be refused as a dead link`);
      // NOT the foreign-host message: that one tells a seat to fix a host, and a value with no host
      // does not have the problem it describes. A wrong remedy costs a whole repair turn.
      assert.doesNotMatch(e.message, /foreign_host/);
      return true;
    });
  }

  // ABSENT IS NOT DEAD. "" is the sanctioned way to say this provider publishes no per-record page —
  // validateSource documents it in its own message — and no fixture in the corpus exercised it, which
  // is why this arm carries it: 0 of 20 register findings across the 8 fixtures had an empty link.
  assert.doesNotThrow(() => parseFindingsJson(withLink("")));
  assert.doesNotThrow(() => parseFindingsJson(withLink(null)));
});

test("#1710 isDeadRecordLink does not fire on a real record URL that contains a fragment", () => {
  // THE FALSE POSITIVE THAT WOULD HAVE COST MOST: EUIPO's own record URLs are fragment-based. A rule
  // reading "contains #" would refuse every EUIPO finding in every report — a delivery outage wearing
  // a bug fix's clothes. The rule is "has no http(s) host", which these pass.
  assert.equal(isDeadRecordLink("https://euipo.europa.eu/eSearch/#details/trademarks/018575624"), false);
  assert.equal(isDeadRecordLink("http://tm.corsearch.com/mark/eu/1#x"), false);
  assert.equal(isDeadRecordLink("#"), true);
  assert.equal(isDeadRecordLink("/mark/eu/1"), true);
  assert.equal(isDeadRecordLink("   "), true, "whitespace only looks like a value");
  assert.equal(isDeadRecordLink(""), false, "empty is ABSENT, which is legitimate");
  assert.equal(isDeadRecordLink(null), false);
  assert.equal(isDeadRecordLink(undefined), false);
});
