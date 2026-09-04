// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// PR-9 — the clearance report-data.json producer (publish/report-data.mjs): the run as CLIENT-CUT data.
// The not-a-back-door test mirrors render-knockout's: internal material that the report itself never
// shows the client (verification receipts, the coverage-judgment reason, withdrawn findings, ::p::
// internal tails, engine-internal narration) must not resurface through the data file. Synthetic
// fixtures only — structure copied from real artifact SHAPES, no client data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearanceReportData } from "../publish/report-data.mjs";

const meter = (token, basis = "verified-from-record") => ({ token, basis });
const FRAMEWORK = {
  framework_key: "house-default", title: "House risk framework",
  bands: [{ label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Moderate", tone: "medium" }, { label: "Manageable", tone: "low" }],
};
const FINDINGS = [
  {
    ordinal: 1, mark: "VOLTMAX", band: "High", disposition: "adversarial",
    owner: { name: "Synth Beverages GmbH", country: "DE", registrations: [{ uri: "/mark/eu/000000001", classes: ["32"], status: "Registered", filed: "2020-01-01", expiry: "2030-01-01", jurisdiction: "EU" }] },
    meters: { mark_similarity: meter("high"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("medium", "inferred-from-signal") },
    quadrant: { x: 0.8, y: 0.7 },
    source: { source_type: "register-vendor", resolved_link: "https://example.com/r/1" },
    bears_on: "INTERNAL-REASONING-RATIONALE the enforcer picture rests on one dispute",
    use_check: { source: "https://example.com/use-evidence-page" },
    own_rights: { source: "own-portfolio sweep — no registrations found" },
    impact: "an injunction would halt the launch ::p:: staff note about the client's timeline",
    deadline: { kind: "opposition", date: "2026-09-01" },
  },
  {
    ordinal: 2, mark: "KILLEDMARK", band: "Moderate", disposition: "withdrawn",
    withdrawn_reason: "REVIEW-KILLED-THIS-FINDING wrong owner entirely",
    owner: { name: "Wrong Owner Ltd", registrations: [] },
    meters: { mark_similarity: meter("low"), goods_proximity: meter("low"), use: meter("unknown"), enforcer: meter("unknown") },
    quadrant: { x: 0.1, y: 0.1 },
    source: { source_type: "common-law-web", resolved_link: "" },
  },
];
const ACTIONS = [
  { id: 1, kind: "consent", text: "Obtain the owner's consent before filing.", ordinals: [1], deadline: { kind: "opposition", date: "2026-09-01" } },
  { id: 2, kind: "monitoring", text: "Watch the pending application.", ordinals: [1] },
  { id: 3, kind: "filing-routine", text: "Ordinary filing mechanics.", ordinals: [] },
];
const ARGS = {
  runId: "synth-run-2026-07-29-test-fixture", codename: "test-fixture", matter: "synth-matter",
  markName: "Voltmax", title: "VOLTMAX — Preliminary Trademark Clearance", customerKey: "aurora",
  issued: "2026-07-29 · 10:00 CEST", url: "https://pool.example/synth/report.html", auditFile: "synth-audit.xlsx",
  product: "global-preliminary-search", stageLabel: "Depth 4", framework: FRAMEWORK,
  verdictInfo: {
    verdict: "CONDITIONAL", tier: "High", badge: "l4", band: { label: "High", rankFromTop: 2, scale: 4 },
    statement: "High — do not rely on this as-is: obtain the owner's consent before filing (and 1 more).",
    reasons: ["Obtain the owner's consent before filing.", "The MCP server did not connect for the marketplace sweep."],
  },
  findings: FINDINGS,
  coverage: [
    { area: "register / EU", state: "confirmed-clean", note: "enumerated in full" },
    { area: "marketplace", state: "open", note: "sweep pending ::p:: internal: rerun after quota reset" },
  ],
  contextNotes: [{ type: "famous-neighbour-ungrounded", mark: "CHROME", context: "famous neighbour, no register record — not a conflict" }],
  markAssessment: {
    distinctiveness: { spectrum: "Suggestive", per_class: [{ class: "32", note: "distinctive for soft drinks" }] },
    connotation: "no adverse readings across EN/DE",
  },
  askAnswers: [{ ask: "check the Benelux position", answer: "nothing found [internal] the register mirror was stale" }],
  actions: ACTIONS,
  jurisdiction: "EU/US (register) + common-law (Western web / marketplace / social)",
  searchedJurisdictions: ["EU", "US"], scopeBasis: null,
  caption: "One driver. One consequence. One step.",
};

test("clearanceReportData: the run as data — shape, level identity, verdict record, findings, asks", () => {
  const d = clearanceReportData(ARGS);
  assert.equal(d.schema, "report-data/1");
  assert.equal(d.kind, "clearance");
  assert.equal(d.level.stageLabel, "Depth 4");
  assert.equal(d.framework.key, "house-default");
  assert.equal(d.verdict.verdict, "CONDITIONAL");
  assert.equal(d.verdict.tier, "High");
  assert.match(d.verdict.statement, /do not rely on this as-is/);
  assert.equal(d.findings.length, 1, "live findings only");
  const f = d.findings[0];
  assert.equal(f.mark, "VOLTMAX");
  assert.equal(f.group, "on-field");
  assert.equal(f.meters.enforcer.basis, "inferred-from-signal");
  assert.equal(f.owner.registrations[0].uri, "/mark/eu/000000001");
  assert.equal(f.deadline.date, "2026-09-01");
  assert.equal(d.askAnswers.length, 1);
  assert.equal(d.askAnswers[0].answer, "nothing found", "the [internal]-labelled tail is dropped by the client scrub");
  assert.equal(d.actions.conditions.length, 1);
  assert.equal(d.actions.conditions[0].kind, "consent");
  // — report-data.json held the THIRD copy of the filing-routine drop, and it is the copy that
  // matters most: legacy runs are served as baked bytes, but new runs render component-native from this
  // file. A fix that reached only the markdown renderer would have left the kind unreachable on every
  // run from here on, with this assertion going green over it.
  assert.deepEqual(d.actions.advisories.map((a) => a.kind), ["monitoring", "filing-routine"],
    "every ADVISORY_KINDS member travels to the component surface — the partition is conditions vs "
    + "advisories and nothing else");
  assert.equal(d.markAssessment.distinctiveness.per_class[0].class, "32", "structured rows are client content and travel");
  assert.match(d.markAssessment.distinctiveness.text, /^Suggestive\./, "…beside their deterministic projection");
});

test("report-data.json is not a back door for the internal material the report never shows the client", () => {
  const json = JSON.stringify(clearanceReportData(ARGS));
  // a withdrawn finding renders NOWHERE — it does not exist here either
  assert.ok(!json.includes("KILLEDMARK"), "withdrawn finding leaked");
  assert.ok(!json.includes("REVIEW-KILLED-THIS-FINDING"), "withdrawn_reason leaked");
  assert.ok(!json.includes("Wrong Owner"), "withdrawn finding's owner leaked");
  // verification receipts are the reviewer's evidence trail (audit workbook), never client data
  assert.ok(!json.includes("INTERNAL-REASONING-RATIONALE"), "bears_on leaked");
  assert.ok(!json.includes("use-evidence-page"), "use_check receipt leaked");
  assert.ok(!json.includes("own-portfolio sweep"), "own_rights receipt leaked");
  // ::p:: internal tails die at the scrub choke point — in prose fields AND coverage notes
  assert.ok(!json.includes("::p::"), "raw internal marker leaked");
  assert.ok(!json.includes("staff note about the client"), "::p:: tail leaked via impact");
  assert.ok(!json.includes("rerun after quota reset"), "::p:: tail leaked via coverage note");
  assert.ok(!json.includes("[internal]"), "labelled internal tail leaked");
  assert.ok(!json.includes("register mirror was stale"), "labelled internal tail leaked via ask answer");
  // engine-internal narration dies at the sentence filter (the same rule the client HTML applies)
  assert.ok(!json.includes("MCP server did not connect"), "engine-internal sentence leaked via verdict conditions");
  assert.equal(clearanceReportData(ARGS).verdict.conditions.length, 1, "the legal condition survives; the engine sentence does not");
});

// ── — the PLACEMENT key is not client data ─────────────────────────────────────────────────────
//
// `disposition` sets only WHERE a card is placed and never the band (stages.mjs), and its members read as
// claims about the owner: "adversarial" tells a client that this proprietor is hostile, which is not what
// the engine decided. D5 took it off the report's risk chip and off list_findings; this file was
// the third door. `group` carries the same fact in the client report's own section-heading words.
test("#831: the placement key is not served — `group` says the same thing in the client report's words", () => {
  const d = clearanceReportData(ARGS);
  const f = d.findings[0];
  assert.equal(FINDINGS[0].disposition, "adversarial", "premise: the input finding carries the word");
  assert.ok(!("disposition" in f), "the engine's placement word is served to a component author who would render it");
  assert.equal(f.group, "on-field", "…and the client-vocabulary derivation of it is untouched");
  assert.ok(!JSON.stringify(d).includes("adversarial"), "nor anywhere else in the file");
});

test("clearanceReportData: degenerate inputs (no findings, no verdict, no asks) still produce a valid file", () => {
  const d = clearanceReportData({ runId: "x", codename: null });
  assert.equal(d.schema, "report-data/1");
  assert.deepEqual(d.findings, []);
  assert.equal(d.verdict, null);
  assert.deepEqual(d.askAnswers, []);
  assert.deepEqual(d.actions, { conditions: [], advisories: [] });
});

// ── P5 (charter 2026-07-30) — the content model travels as client data, through the scrub ──────────────

test("P5: legal/practical split, manageable category and four_answers travel as client-cut data", () => {
  const p5findings = [
    { ...FINDINGS[0],
      legal_position: "High similarity over identical goods — high legal risk. ::p:: staff aside",
      practical_position: "Active enforcer; recent oppositions.",
    },
    { ordinal: 3, mark: "VOLTIX", band: "Manageable", disposition: "coexistence-partner",
      legal_position: "Same element; documented coexistence stands.",
      practical_position: "Partner relationship; no enforcement history.",
      manageable: { category: "commercial-partner", reason: "a client partner ::p:: internal note" },
      owner: { name: "Partner GmbH", registrations: [] },
      meters: { mark_similarity: meter("medium"), goods_proximity: meter("medium"), use: meter("confirmed"), enforcer: meter("low", "inferred-from-signal") },
      quadrant: { x: 0.4, y: 0.4 }, source: { source_type: "register-vendor", resolved_link: "" } },
  ];
  const fourAnswers = {
    third_party_rights: { read: "Strong senior rights. ::p:: internal basis note", token: "strong", basis: "findings 1", ordinals: [1] },
    registrability: { read: "The descriptive element carries no exclusive rights.", token: "registrable-with-conditions", obstacles: [{ class: "32", note: "the office holds the element descriptive ::p:: staff tail" }] },
  };
  const d = clearanceReportData({ ...ARGS, findings: p5findings, fourAnswers });
  const f1 = d.findings.find((f) => f.ordinal === 1), f3 = d.findings.find((f) => f.ordinal === 3);
  assert.match(f1.legal_position, /high legal risk/);
  assert.equal(f3.manageable.category, "commercial-partner");
  assert.match(f3.manageable.reason, /client partner/);
  assert.equal(d.fourAnswers.third_party_rights.token, "strong");
  assert.equal(d.fourAnswers.registrability.obstacles[0].class, "32");
  // the scrub choke point applies to every free string, obstacles included
  const json = JSON.stringify(d);
  assert.ok(!json.includes("::p::"), "raw internal marker leaked");
  assert.ok(!json.includes("staff aside"), "::p:: tail leaked via legal_position");
  assert.ok(!json.includes("internal note"), "::p:: tail leaked via manageable.reason");
  assert.ok(!json.includes("internal basis note"), "::p:: tail leaked via four_answers.read");
  assert.ok(!json.includes("staff tail"), "::p:: tail leaked via obstacles note");
  // absent on legacy runs ⇒ absent in the data file (no fabricated nulls beyond the field defaults)
  const legacy = clearanceReportData(ARGS);
  assert.equal(legacy.fourAnswers, null);
  assert.equal(legacy.findings[0].legal_position, null);
  assert.equal(legacy.findings[0].manageable, null);
});
