// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for the DATA-DRIVEN report render: the HTML is built from the findings.json contract
// (findings + coverage), with narrative prose joined from report.md cards. Asserts the redesign components
// (gauge, quadrant, 3-tier cards, four meters, coverage grid), the preserved askAi gating, and A1
// internal-never-client stripping. Renders through the real renderer (reads the real CSS). No network.
import { test } from "node:test";

// The staff "Ask your AI" connector is deployment config with NO placeholder default — unset ⇒ the panel is
// omitted (a connector host that resolves nowhere is worse than no connector). These tests assert the panel
// RENDERS, so they have to stand on a configured deployment. Before this, they passed by asserting the
// example.com fallback verbatim — the tests encoded the placeholder as the spec, which is why the dead
// connector shipped unnoticed.
process.env.CLEAROTRON_MCP_URL ||= "https://mcp.test/mcp";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml, homeButton } from "../publish/render.mjs";

function parsedOf(reportMd) {
  const dir = mkdtempSync(join(tmpdir(), "prelim-render-"));
  const path = join(dir, "f.report.md");
  writeFileSync(path, reportMd);
  try { return parseReport(path); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

const FM = [
  "---", "type: prelim-clearance", "matter: noref-demo", "title: THIS IS MY MATCHDAY",
  "overall_label: MEDIUM", "overall_badge: l3", "overall_caption: medium overall.",
  "classes: 5 · 32 · 41", "jurisdiction: United States only", "run: 2026-06-10",
  "lint_flags: one identifier to re-verify", "---", "",
].join("\n");
// report.md prose cards the render joins by owner name (one carries a ::p:: internal note).
const CARDS = [
  "# Marks",
  "## Matchday, Inc.", "- one: The dominant MATCHDAY holder in the filed class.",
  "### The read", "Distinguished as wholes. ::p:: internal: invert if applicant is Matchday.",
  "## MAN Sports", "- one: Identical anchor on core supplement goods.",
  "### The read", "Common-law only; descriptiveness defence weakens it.",
].join("\n");
const REPORT = `${FM}\n${CARDS}`;

const meter = (token, basis = "verified-from-record") => ({ token, basis });
const FINDINGS = [
  { ordinal: 1, mark: "MATCHDAY", owner: { name: "Matchday, Inc.", country: "US", registrations: [
      { uri: "https://tm.example/us/3396572", classes: ["41"], status: "Registered", filed: "2008-03-11", expiry: "2028-03-11", jurisdiction: "US" },
      { uri: "https://tm.example/us/8036850", classes: ["41"], status: "Registered", filed: "2025-11-25", expiry: "2035-11-25", jurisdiction: "US" } ] },
    composite: 3, level: "B", dispute_type: "paper-conflict",
    meters: { mark_similarity: meter("medium"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("medium", "inferred-from-signal") },
    quadrant: { x: 0.72, y: 0.55 }, source: { source_type: "register-vendor", resolved_link: "https://tm.example/us/3396572" } },
  { ordinal: 2, mark: "MATCH DAY", owner: { name: "MAN Sports", country: "US", registrations: [] },
    composite: 2, level: "B", dispute_type: "descriptive-terms",
    meters: { mark_similarity: meter("high"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("low", "inferred-from-signal") },
    quadrant: { x: 0.9, y: 0.8 }, source: { source_type: "common-law-marketplace", resolved_link: "https://mansports.example/match-day" } },
];
const COVERAGE = [
  { area: "register / US", state: "confirmed-clean", note: "zero hits on the exact slogan" },
  { area: "adjacent classes 25/29/30", state: "coverage-limited", note: "224 hits, 25 reviewed" },
];

test("data-driven: gauge, quadrant, key panel, on-field + secondary cards, coverage grid all render", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.match(html, /THIS IS MY MATCHDAY/);
  assert.match(html, /class="scale"/);                         // risk gauge
  assert.match(html, /MEDIUM/);                                // overall label on gauge + topbar
  assert.match(html, /<svg viewBox="0 0 560 430"/);            // quadrant chart
  assert.match(html, /href="#c1"[\s\S]*MATCHDAY/);              // key panel / marker drill-through to c1
  assert.match(html, /id="c1"/);                               // on-field finding card
  assert.match(html, /Level B/);
  assert.match(html, /Composite 3 · Paper conflict/);          // decomposed + humanized dispute type
  assert.match(html, /class="meters"/);                        // the four strength meters
  assert.match(html, /class="cov"/);                           // coverage grid
  assert.match(html, /confirmed-clean|✓/);
});

test("a genuinely-open floor still surfaces plainly in the report Coverage section (no disclosure suppressed)", () => {
  // Fix-3 guard: dropping internal-axis codenames from the reviewer EMAIL, and filtering an inactive
  // axis out of the open-floor NOTE, must not touch the reader-visible disclosure — the report Coverage
  // section (findings coverage[]) still carries every meaningful open floor in plain language.
  const OPEN_COVERAGE = [
    { area: "register / VIBRA (the shorter root of VIBRANTE)", state: "open", note: "not completed this run — no provider tool to run the contains-mode enumerate" },
    ...COVERAGE,
  ];
  const html = renderHtml(parsedOf(REPORT), FINDINGS, OPEN_COVERAGE, { runId: "noref-open" });
  assert.match(html, /What we covered/);
  assert.match(html, /VIBRA \(the shorter root of VIBRANTE\)/, "the meaningful open floor is disclosed to the reader");
  assert.doesNotMatch(html, /primary-sweep|saturation-probe|transliteration-numeric|incumbent-class/, "the reader disclosure is plain — no internal axis codenames");
});

test("spec-49 T6 (H6/I8): the risk chip is CODE-BUILT from the record — a model-authored '- label:' is ignored", () => {
  // I8 closes by construction: the model can no longer author a chip that disagrees with the typed
  // level/composite (a lint-repair on NOVAPULSE once re-invented level/dispute labels). The customer
  // riskExpression presentation moves to a render-side delivery formatter as a follow-on — never a
  // model-authored line.
  const CARDS2 = [
    "# Marks",
    "## Matchday, Inc.", "- label: 55% likelihood — negotiate", "- one: The dominant MATCHDAY holder in the filed class.",
    "### The read", "Distinguished as wholes.",
    "## MAN Sports", "- one: Identical anchor on core supplement goods.",
    "### The read", "Common-law only; descriptiveness defence weakens it.",
  ].join("\n");
  const internal = renderHtml(parsedOf(`${FM}\n${CARDS2}`), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.doesNotMatch(internal, /55% likelihood — negotiate/, "a model-authored label never renders");
  // wp50: the internal chip leads with the SAME client tier word as every other surface, with the
  // Level/Composite legal shorthand beside it — one vocabulary, reviewer detail preserved.
  assert.match(internal, /class="tier med">MEDIUM · <span class="lv">Level B<\/span>Composite 3 · Paper conflict/, "internal chip = tier word + reviewer shorthand from the record");
  assert.match(internal, /class="tier med"/, "colour/structure from the canonical composite");
  // ONE report (spec 2026-07-30 §5): there is no client variant — a stale opts.client is INERT and the
  // chip above (tier word + reviewer shorthand) is THE chip on the one document.
  const stale = renderHtml(parsedOf(`${FM}\n${CARDS2}`), FINDINGS, COVERAGE, { client: true, runId: "noref-demo" });
  assert.equal(stale, internal, "opts.client no longer forks the render");
});

test("A3: a two-registration owner shows BOTH registrations in Full detail (no transposition)", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  assert.match(html, /us\/3396572/);
  assert.match(html, /us\/8036850/);                           // both regs present
});

test("B1: the enforcer meter states its basis (inferred), never presented as fact", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  // D4 — the basis is still stated, in the meter's own EVIDENCE position instead of welded to the
  // front of the appetite word. "Inferred — medium" put the evidence where the reader looks for the fact.
  assert.match(html, /<div class="mv">Medium<\/div><div class="mev">Evidence: inferred<\/div>/);
  assert.doesNotMatch(html, /Inferred — medium/);
});

test("classification: composite ≥3 is on-field (02); a common-law secondary renders in its OWN section (spec-48 A5)", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  assert.match(html, /On-field conflicts/);
  // the only secondary finding here is common-law → it renders in the Common-law section, and the
  // register-region "Secondary & watch" section (which would be empty) is omitted.
  assert.match(html, /Common-law &amp; marketplace/);
  assert.doesNotMatch(html, /Secondary &amp; watch/);
  assert.match(html, /card compact" id="c2"/);                 // the C2 finding renders as a compact card
});

// C1 regression — the PETCARY "02 On-field conflicts" copy-paste defect. Three on-field findings whose
// marks collide under the OLD fuzzy join ("petcary" ⊂ "kanion"; ords 2 & 3 share owner AND mark) must each
// render their OWN card prose. The fix keys matchCard on the `- ord:` line every card now carries, so the
// join is exact + injective. Under the old code all three rendered ord-1's body (verified in the live run).
test("C1: each on-field card joins to its OWN ordinal's prose — no copy-paste across colliding marks", () => {
  const FM_P = ["---", "type: prelim-clearance", "matter: noref-petcary", "title: PETCARY",
    "overall_label: MEDIUM", "overall_caption: medium overall.", "classes: 5 · 10 · 44",
    "jurisdiction: CH", "run: 2026-06-18", "---", ""].join("\n");
  const CARDS_P = [
    "# Marks",
    "## Kanion Animal Health AB — KANION, CH", "- ord: 1", "- one: KANION holder.",
    "### The read", "ZEBRAREAD the Swedish animal-health registrant.",
    "## Project Management Limited — PETCARY, CH", "- ord: 2", "- one: PETCARY, earlier filing.",
    "### The read", "OTTERREAD the earlier PETCARY filing.",
    "## Project Management Limited — PETCARY, CH", "- ord: 3", "- one: PETCARY, later filing.",
    "### The read", "RAVENREAD the later PETCARY filing.",
  ].join("\n");
  const mP = (token, basis = "verified-from-record") => ({ token, basis });
  const mtr = { mark_similarity: mP("high"), goods_proximity: mP("high"), use: mP("confirmed"), enforcer: mP("low", "inferred-from-signal") };
  const own = (name) => ({ name, country: "CH", registrations: [] });
  const FP = [
    { ordinal: 1, mark: "KANION", owner: own("Kanion Animal Health AB"), composite: 4, level: "D", dispute_type: "paper-conflict", meters: mtr, quadrant: { x: 0.6, y: 0.7 }, source: { source_type: "register-vendor" } },
    { ordinal: 2, mark: "PETCARY", owner: own("Project Management Limited"), composite: 3, level: "C", dispute_type: "paper-conflict", meters: mtr, quadrant: { x: 0.6, y: 0.8 }, source: { source_type: "register-vendor" } },
    { ordinal: 3, mark: "PETCARY", owner: own("Project Management Limited"), composite: 3, level: "C", dispute_type: "paper-conflict", meters: mtr, quadrant: { x: 0.6, y: 0.8 }, source: { source_type: "register-vendor" } },
  ];
  const html = renderHtml(parsedOf(`${FM_P}\n${CARDS_P}`), FP, [], {});
  const count = (s) => (html.match(new RegExp(s, "g")) || []).length;
  assert.equal(count("ZEBRAREAD"), 1, "ord-1 KANION read renders exactly once (the bug rendered it under all three)");
  assert.equal(count("OTTERREAD"), 1, "ord-2 renders its OWN read, not ord-1's");
  assert.equal(count("RAVENREAD"), 1, "ord-3 renders its OWN read (shares owner+mark with ord-2, still distinct)");
});

test("askAi: internal report includes the launcher + shared read-only MCP; runId keys the prompt", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.match(html, /https:\/\/mcp\.test\/mcp/);
  assert.match(html, /Copy question/);
  assert.match(html, /Set up Claude/);
  assert.match(html, /Brief me on trademark clearance run noref-demo\./);
});

test("A1 / askAi: one report — lint flags render nowhere; ::p:: notes render labelled for review; explicit mcpUrl drives the launcher", () => {
  // A1: lint flags arrive via opts.lintFlags (the internal _driver sink), NOT report.md front-matter.
  // T4 (H1/H2): they render NOWHERE — the report a lawyer signs carries no QC caveat; the
  // receipts live on audit.xlsx (Review receipts) + the _driver sinks.
  const LINT = ["registration number inconsistent with its serial — verify against the record"];
  const internal = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { lintFlags: LINT });
  assert.doesNotMatch(internal, /Review notes/);
  assert.doesNotMatch(internal, /registration number inconsistent/);
  // ONE report: the ::p:: note renders LABELLED for the reviewing reader; serve-time preparation
  // (portal-report.mjs) strips int-note ELEMENTS for every embedded reader — never a second render here.
  assert.match(internal, /invert if applicant is Matchday/);
  assert.ok(!internal.includes("::p::"), "the raw marker never survives to any surface");
  // a stale opts.client changes nothing
  const stale = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { client: true, lintFlags: LINT });
  assert.equal(stale, internal, "opts.client no longer forks the render");
  // an explicit scoped url drives the launcher (env-based CLEAROTRON_MCP_URL is unset under test)
  const scoped = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { mcpUrl: "https://mcp.example.com/c/acme/mcp" });
  assert.match(scoped, /mcp\.example\.com\/c\/acme\/mcp/);
});

test("spec-49 T4 (H1): the reasoning-integrity caveat renders NOWHERE — receipts live on the audit surfaces", () => {
  const IG = ["2/3 on-field finding(s) cited none of their own field anchors", "possible rule-shaped reasoning: a Level/Composite cutoff"];
  for (const opts of [{ integrityFlags: IG }, { client: true, integrityFlags: IG }]) {
    const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, opts);
    assert.doesNotMatch(html, /Reasoning-integrity/, "the verify-before-relying surface is dead on every variant");
    assert.doesNotMatch(html, /cited none of their own field anchors/);
    assert.doesNotMatch(html, /verify before relying/i);
  }
});

test("#761 delivery.privileged is TWO-STATE: off, and a default for everything else", () => {
  // The rule is shared/brand.mjs `confPosture`, and render-knockout.mjs calls the same function — one
  // firm-wide marking, one definition. It was once two-state the WRONG way, coercing absent into false,
  // which is how a House-default clearance shipped carrying no confidentiality line at all. made it
  // three; dropped the extended wording, so `true` and absent now render the same line and the
  // field folds to on/off at load. The property bought — absent is NOT false — is what survives.
  const priv = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { delivery: { email: "table", privileged: true } });
  assert.match(priv, /Privileged &amp; Confidential/, "a retired true still renders the marking, not nothing");
  assert.doesNotMatch(priv, /Attorney Work Product/, "and never the dropped suffix");

  // FALSE IS AN INSTRUCTION TO LEAVE IT OFF — a customer's own choice, and still honoured.
  const off = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { delivery: { email: "summary", privileged: false } });
  assert.doesNotMatch(off, /Privileged &amp; Confidential/, "false ⇒ nothing");
  // ...and with nothing else to say, the whole row goes rather than leaving a dot bulleting an empty label.
  assert.doesNotMatch(off, /class="conf"/);
  // With a product to name, the row survives carrying that alone.
  const offNamed = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { delivery: { email: "summary", privileged: false }, productName: "Knockout search" });
  assert.match(offNamed, /<span class="label">Knockout search<\/span>/);

  // ABSENT IS NOT FALSE. No opinion ⇒ the plain default. "Attorney Work Product" characterises the
  // document in legal terms and is not ours to assert by default; the plain line claims nothing.
  const silent = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  assert.match(silent, /<span class="label">Privileged &amp; Confidential<\/span>/, "absent ⇒ the default line");
  assert.doesNotMatch(silent, /Attorney Work Product/, "and never the legal characterisation by default");
  // A delivery object that simply omits the key is the same no-opinion state — that IS the shipped
  // House default (profiles/generic.json) and NEUTRAL_DELIVERY, both silent on the field since.
  const noKey = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { delivery: { email: "summary" } });
  assert.match(noKey, /<span class="label">Privileged &amp; Confidential<\/span>/);
  assert.equal(noKey, silent, "an overlay silent on the field renders identically to no overlay");
});

test("machine-QC state never stamps the report: no sticker, no hold badge, on the one document", () => {
  // The QC checks live on the audit workbook + meta (spec 2026-07-30 §5); the renderer knows nothing of
  // them — a stale clientGate opt is inert on every path.
  const gate = { released: false, reasons: ["a core search layer was not run (register / EU)"] };
  const withGate = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { clientGate: gate });
  assert.doesNotMatch(withGate, /CLOSE BEFORE FILING/);
  assert.doesNotMatch(withGate, /Client export ON HOLD|Not client-ready/);
  const plain = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  assert.equal(withGate, plain, "the QC record is invisible to the renderer");
});

// ── Instance #5: use_check / own_rights rendered FROM the JSON in Full detail (no prose-regex) ─────────
test("Full detail renders use_check.source as a LINK when the source is a URL", () => {
  const f = [{ ...FINDINGS[0], use_check: { source: "https://example.com/result" } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /<li><b>Use checked\.<\/b> <a href="https:\/\/example\.com\/result" target="_blank" rel="noopener noreferrer">example\.com\/result<\/a><\/li>/);
});

// spec 47 — a multi-URL source renders one anchor PER URL (gluing them into one href made a dead link),
// and the non-URL remainder stays as text.
test("Full detail: a multi-URL cite renders one link per URL, never one glued dead href", () => {
  const f = [{ ...FINDINGS[0], own_rights: { source: "https://reg.example/mark/us/1, https://reg.example/mark/eu/2 | own-portfolio sweep" } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /<a href="https:\/\/reg\.example\/mark\/us\/1" target="_blank" rel="noopener noreferrer">reg\.example\/mark\/us\/1<\/a>/);
  assert.match(html, /<a href="https:\/\/reg\.example\/mark\/eu\/2" target="_blank" rel="noopener noreferrer">reg\.example\/mark\/eu\/2<\/a>/);
  assert.doesNotMatch(html, /href="https:\/\/reg\.example\/mark\/us\/1[,\s]/, "no comma-glued href survives");
  assert.match(html, /— own-portfolio sweep</, "the non-URL remainder stays as text");
});

test("Full detail renders own_rights.source as TEXT when it is an honest-negative", () => {
  const f = [{ ...FINDINGS[0], own_rights: { source: "no applicant-owned registrations in the searched register material" } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /<li><b>Own-portfolio sweep\.<\/b> no applicant-owned registrations in the searched register material<\/li>/);
});

test("Full detail OMITS the use_check / own_rights cites when the fields are absent", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});   // FINDINGS carry neither field
  assert.doesNotMatch(html, /Use checked\./);
  assert.doesNotMatch(html, /Own-portfolio sweep\./);
});

// ── Instance #6: registry identifiers RENDERED FROM the fetched _records/ (recordsByUri), not model prose ──
test("Map A: a fetched record in recordsByUri OVERRIDES the finding's fields (transposition-proof)", () => {
  // the finding's own fields say filed 2008 / Registered; the FETCHED record says different facts — the
  // record must win on the page (the model is out of the identifier path).
  const recordsByUri = new Map([["https://tm.example/us/3396572", {
    _uri: "https://tm.example/us/3396572",
    applicationNumber: "77999111", registrationNumber: "3396572",
    applicationDate: "2011-05-04", registrationDate: "2014-08-19",
    statusText: "Registered and renewed", jurisdiction: "US", classList: ["41"],
  }]]);
  const f = [{ ...FINDINGS[0], owner: { name: "Matchday, Inc.", country: "US", registrations: [
    { uri: "https://tm.example/us/3396572", classes: ["41"], status: "Registered", filed: "2008-03-11", expiry: "2028-03-11", jurisdiction: "US" } ] } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri });
  assert.match(html, /app\. 77999111/);                 // application number from the record
  assert.match(html, /reg\. 3396572/);
  assert.match(html, /filed 2011/);                     // filing YEAR from the record, NOT the finding's 2008
  assert.match(html, /registered 2014/);
  assert.match(html, /Registered and renewed/);         // status text from the record
  assert.doesNotMatch(html, /filed 2008/);              // the finding's transposable field is gone
});

// ── WP-receipts W2: the provable "verified" label + provider record links ─────────────────────────────
test("W2: a record artifact carrying _receipt renders the verified-fetched line; absent receipt renders none (byte-stable)", () => {
  const rec = {
    _uri: "/mark/tr/2009-53984", applicationNumber: "2009-53984", registrationNumber: "2011-99",
    applicationDate: "2009-10-14", registrationDate: "2011-11-30", statusText: "Valid", jurisdiction: "TR", classList: ["5"],
  };
  const f = [{ ...FINDINGS[0], owner: { name: "Doruk", country: "TR", registrations: [
    { uri: "/mark/tr/2009-53984", classes: ["5"], jurisdiction: "TR" } ] } }];
  // WITH receipt + provider config: the line names the provider + fetch date, the uri links via recordOrigin
  const withReceipt = new Map([["/mark/tr/2009-53984", { ...rec, _receipt: { fetched_at: "2026-07-05T12:00:00Z", context: "prelim-x-register-digest" } }]]);
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri: withReceipt, recordOrigin: "https://tm.corsearch.com", providerLabel: "Corsearch" });
  assert.match(html, /verified — Corsearch record fetched 2026-07-05/);
  assert.match(html, /href="https:\/\/tm\.corsearch\.com\/mark\/tr\/2009-53984"/, "path uri links via the provider record origin");
  // WITHOUT receipt (archived run): no verified-fetched line, no invented provider label
  const without = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri: new Map([["/mark/tr/2009-53984", rec]]) });
  assert.doesNotMatch(without, /record fetched/);
  assert.doesNotMatch(without, /Corsearch record/);
});

test("Map A: a cited uri with NO record body and NO fields → the honest '(register-index entry)' marker (B3: what it means is stated once, in Scope)", () => {
  const f = [{ ...FINDINGS[0], owner: { name: "Matchday, Inc.", country: "US", registrations: [
    { uri: "https://tm.example/ch/16021" } ] } }];   // the 404 case: uri cited, never fetched, no fields
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri: new Map() });
  assert.match(html, /ch\/16021/);
  assert.match(html, /\(register-index entry\)/);
});

test("Map A back-compat: no recordsByUri + populated fields → the existing field render is unchanged", () => {
  // identical to A3 but asserting the exact field-render strings survive when no _records/ is in reach.
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  assert.match(html, /us\/3396572/);
  assert.match(html, /us\/8036850/);
  assert.match(html, /filed 2008-03-11/);               // findings.json field rendered verbatim (back-compat)
  assert.match(html, /Registered/);
  assert.doesNotMatch(html, /\(unverified/);            // fields present ⇒ never the unverified label
});

// ── doc-31 NEVER-INVENT: a run WITH a record set must not render the model's fields for a cited record it
// never fetched (the "shown as if confirmed" defect — five marks cited with registry values never fetched). ──
test("doc-31 no-invent: record set present + a cited uri NOT in it + model fields → unverified, never the model's values", () => {
  const recordsByUri = new Map([["https://tm.example/us/3396572", {
    _uri: "https://tm.example/us/3396572", applicationNumber: "77999111", registrationNumber: "3396572",
    applicationDate: "2011-05-04", statusText: "Registered", jurisdiction: "US",
  }]]);
  // the finding cites a DIFFERENT registration this run never fetched, yet the model filled in fields:
  const f = [{ ...FINDINGS[0], owner: { name: "Matchday, Inc.", country: "US", registrations: [
    { uri: "https://tm.example/jp/9999999", classes: ["41"], status: "Registered", filed: "2008-03-11", expiry: "2028-03-11", jurisdiction: "JP" } ] } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri });
  assert.match(html, /jp\/9999999/);
  assert.match(html, /\(register-index entry\)/);   // run fetched records, this one wasn't among them
  assert.doesNotMatch(html, /filed 2008/);                     // the model's invented field must NOT render as confirmed
});

// ── doc-31 step 4: owner DISPLAY is bound from the record, so an invented variant never reaches the card. ──
test("doc-31 owner binding: the card owner is the RECORD's proprietor, not the model's invented variant", () => {
  const recordsByUri = new Map([["https://tm.example/us/3396572", {
    _uri: "https://tm.example/us/3396572", applicationNumber: "77999111", owner: "Lo.Li. Pharma S.r.l.", jurisdiction: "US",
  }]]);
  const f = [{ ...FINDINGS[0], owner: { name: "Lo.Li. Pharma International", country: "US", registrations: [
    { uri: "https://tm.example/us/3396572", classes: ["41"], jurisdiction: "US" } ] } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri });
  assert.match(html, /Lo\.Li\. Pharma S\.r\.l\./);             // bound from the record
  assert.doesNotMatch(html, /Lo\.Li\. Pharma International/);  // the invented variant never reaches the card owner/oneline
});

test("doc-31 owner binding: no record owner → falls back to the model's finding.owner.name (back-compat)", () => {
  const recordsByUri = new Map([["https://tm.example/us/3396572", {
    _uri: "https://tm.example/us/3396572", applicationNumber: "77999111",  // record carries NO owner field
  }]]);
  const f = [{ ...FINDINGS[0], owner: { name: "Matchday, Inc.", country: "US", registrations: [
    { uri: "https://tm.example/us/3396572", classes: ["41"], jurisdiction: "US" } ] } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri });
  assert.match(html, /Matchday, Inc\./);                        // model owner stands when the record has none
});

test("report floating nav: rendered whenever opts.nav is passed — serve-time nav stripping is portal-report's job", () => {
  const NAV = '<nav class="sitenav"><div class="navinner"><a href="../index.html">Archive</a></nav>';
  const internal = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo", nav: NAV });
  assert.match(internal, /class="sitenav"/);
  assert.match(internal, /href="\.\.\/index.html"/);
  // one sticky header: nav + topbar wrap in .rep-stickyhead; the nav is static inside it (doesn't fight the topbar)
  assert.match(internal, /class="rep-stickyhead/);
  assert.match(internal, /\.rep-stickyhead \.sitenav\{position:static/);
  // ONE report: opts.client is inert — the nav rides the document; portal-report/readReport strips it
  // (it lists every customer key) before any embedded reader sees it.
  const stale = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { client: true, runId: "noref-demo", nav: NAV });
  assert.equal(stale, internal, "opts.client no longer forks the render");
});

test("logo de-dup: the topbar NEVER carries a lockup — the brand arrives via the injected nav and the footer", () => {
  const NAV = '<nav class="sitenav"><div class="navinner"><span class="lockup">NAVLOCK</span><a href="../index.html">Archive</a></div></nav>';
  const tbOf = (h) => h.slice(h.indexOf('class="topbar'), h.indexOf('class="tb-menu"'));
  const internal = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo", nav: NAV });
  assert.doesNotMatch(tbOf(internal), /class="lockup"/, "topbar carries no SECOND lockup — the nav already brands the header");
  assert.match(internal, /class="lockup">NAVLOCK/, "…the single header brand lockup is the nav's");
  // ONE report: the old client-only topbar lockup went with the CLIENT flag — a navless render brands
  // via the footer lockup alone.
  const navless = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.doesNotMatch(tbOf(navless), /class="lockup"/, "no audience-forked topbar lockup remains");
  assert.match(navless, /<footer>[\s\S]*class="lockup"/, "the footer lockup still brands the document");
});

test("D shared chrome: the report LINKS chrome.css when chromeHref is set (chrome out of inline <style>); no chromeHref ⇒ inline", () => {
  const NAV = '<nav class="sitenav"><div class="navinner"></div></nav>';
  const linked = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo", nav: NAV, chromeHref: "../assets/chrome.css" });
  assert.match(linked, /<link rel="stylesheet" href="\.\.\/assets\/chrome\.css">/, "internal links the shared chrome sheet");
  assert.doesNotMatch(linked, /\.fab-stack\{position:fixed/, "shared chrome (fab CSS) is NOT inlined when linked");
  assert.match(linked, /\.rep-stickyhead \.sitenav\{position:static/, "the report-specific override stays inline");
  const inline = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo", nav: NAV });
  assert.match(inline, /\.fab-stack\{position:fixed/, "without chromeHref the chrome is inlined (back-compat)");
  assert.doesNotMatch(inline, /href="[^"]*chrome\.css"/, "no stray chrome link when inlining");
  // ONE report: chromeHref always links; a stale opts.client is inert.
  const stale = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { client: true, runId: "noref-demo", nav: NAV, chromeHref: "../assets/chrome.css" });
  assert.equal(stale, linked, "opts.client no longer forks the render");
});

test("theme gating: one report, EXPLICIT theming only (no OS media query + pre-paint init); the explicit-light client fork is retired", () => {
  const internal = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  // A CLIENT SURFACE MUST NOT FOLLOW THE OS. This asserted the opposite — that
  // the report auto-darks — and that predates the client-surface ruling. A clearance report is opened
  // in front of a client and the portal frames it for one; it went dark on a dark-mode laptop as a
  // delivered legal document. Dark stays fully supported, by explicit choice, which is the two
  // assertions below: the explicit dark block is present and the pre-paint init still reads the
  // stored choice. What is gone is the media query that made the laptop decide.
  assert.doesNotMatch(internal, /prefers-color-scheme/, "the report must not follow the reader's OS");
  assert.match(internal, /:root\[data-theme="dark"\]/);
  assert.match(internal, /localStorage\.getItem\('cordillera-theme'\)/);
  assert.ok(internal.indexOf("cordillera-theme") < internal.indexOf("</head>"), "init in <head> (pre-paint)");
  assert.match(internal, /--crimson:#860F09/i, "light :root unchanged — the first :root block stays the light tokens");
  assert.doesNotMatch(internal, /#3b4fd6|#11132a|#f5f6f9|#1a1a2e/i, "no blue-skin hex via the dark block");

  // the report carries no standalone toggle button — its theme fab arrives bundled with the nav
  // (siteNav/siteFab), and the old client-only .fab-stack went with the CLIENT flag
  assert.doesNotMatch(internal, /class="fab-stack"/, "no fab without an injected nav (arrives via siteNav)");
  assert.doesNotMatch(internal, /class="theme-toggle tt-page"/);

  // a stale opts.client is inert — no explicit-light fork, no client fab, byte-identical output
  const stale = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { client: true, runId: "noref-demo" });
  assert.equal(stale, internal, "opts.client no longer forks the theme");

  // the quadrant SVG panel keeps a fixed light surface with dark legend text in dark mode
  assert.match(internal, /\.panel\.land\{background:#FFFDF9\}/i);
  assert.match(internal, /\.panel\.land \.legend[^{]*\{color:#250902\}/i);

  // determinism holds (the theme additions are static strings)
  const again = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.equal(internal, again);
});

test("no findings.json (legacy / model miss) → renders without crashing, no findings sections", () => {
  const html = renderHtml(parsedOf(REPORT), [], [], {});
  assert.match(html, /THIS IS MY MATCHDAY/);
  assert.doesNotMatch(html, /On-field conflicts/);             // no findings → section omitted, no crash
});

// ---- A1/A3 fix: context_notes block + quarantine banner ------------------------------------------

const CTX_NOTE = { type: "famous-neighbour-ungrounded", mark: "CHROME", owner: "Google LLC", context: "one keystroke from NOVAPULSE; famous mark; no fetched record; off-field" };
const QUAR = [{ index: 8, mark: "CHROME", error: "finding_registration_invalid: (registration.uri must be a non-empty string)" }];

test("A1 render: the famous-neighbour context_notes block renders on the one report", () => {
  const parsed = parsedOf(FM);
  const internal = renderHtml(parsed, [], [], { contextNotes: [CTX_NOTE] });
  assert.match(internal, /Famous-mark neighbours noted/);
  assert.match(internal, /CHROME/);
  // a stale opts.client is inert (one report, spec 2026-07-30 §5)
  assert.equal(renderHtml(parsed, [], [], { client: true, contextNotes: [CTX_NOTE] }), internal);
});

test("spec-49 T4: the quarantine banner is dead on every variant (a quarantined finding fails the run upstream)", () => {
  const parsed = parsedOf(FM);
  for (const opts of [{ quarantined: QUAR }, { client: true, quarantined: QUAR }]) {
    const html = renderHtml(parsed, [], [], opts);
    assert.doesNotMatch(html, /excluded as malformed/i);
    assert.doesNotMatch(html, /quarantined/i);
  }
});

test("spec-49 T4 (§2.1): NO review surface renders at all — no toolbar, no badges, no notes (#265)", () => {
  // T4 killed the caveat body and left a slim internal toolbar whose only job was hosting the
  // Flag/Etch capture controls. retired them, so the toolbar went with it and nothing renders here any more.
  // Asserted with the flags SET, which is the case that would have produced caveat machinery.
  for (const opts of [
    { runId: "t4-demo", integrityFlags: ["ignored"], lintFlags: ["ignored"] },
    { runId: "t4-demo", captureUrl: "", integrityFlags: ["ignored"], lintFlags: ["ignored"] },   // a stale caller passing the retired option
    { integrityFlags: ["ignored"] },
  ]) {
    const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, opts);
    assert.doesNotMatch(html, /class="review internal no-print"/);
    assert.doesNotMatch(html, /Internal review copy/);
    assert.doesNotMatch(html, /qcctl|cardflag|qc-flag|qc-etch/, "no quality-capture surface survives the retirement");
    assert.doesNotMatch(html, /rv-badge|rv-toggle|rv-body|Review notes|Reasoning-integrity|File-ready|ON HOLD/);
  }
  // A stale capture-URL option is INERT, not an error: the option is simply not read any more.
  assert.equal(
    renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "t4-demo", captureUrl: "" }),
    renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "t4-demo" }),
    "a retired option must not fork the render",
  );
});

// ── Redesign invariants (spec §4): structure reproduced from run data — every finding represented once in
// the scatter + region panel + cards; 0 scatter-dot overlaps; region grouping; pending rings; determinism. ──
const mk = (token, basis = "verified-from-record") => ({ token, basis });
const RMETERS = { mark_similarity: mk("high"), goods_proximity: mk("high"), use: mk("confirmed"), enforcer: mk("low", "inferred-from-signal") };
const reg = (jur, status = "Registered", uri) => ({ owner: { name: `${jur} Holder`, country: jur, registrations: [{ uri: uri || `/mark/${jur.toLowerCase()}/1`, classes: ["32"], status, jurisdiction: jur }] } });
// US on-field (registered) + US on-field PENDING sharing coords with F1 (forces de-overlap) + EU on-field;
// JP secondary; common-law secondary (empty registrations → region CL); GB secondary (→ UK via alias).
const REGION_FINDINGS = [
  { ordinal: 1, mark: "AURA", ...reg("US"), composite: 3, level: "C", dispute_type: "paper-conflict", meters: RMETERS, quadrant: { x: 0.7, y: 0.6 }, source: { source_type: "register-vendor" } },
  { ordinal: 2, mark: "AURA", ...reg("US", "Pending"), composite: 3, level: "C", dispute_type: "paper-conflict", meters: RMETERS, quadrant: { x: 0.7, y: 0.6 }, source: { source_type: "register-vendor" } },
  { ordinal: 3, mark: "AURA", ...reg("EU"), composite: 4, level: "B", dispute_type: "horse-trade", meters: RMETERS, quadrant: { x: 0.5, y: 0.8 }, source: { source_type: "register-vendor" } },
  { ordinal: 4, mark: "AURA", ...reg("JP"), composite: 2, level: "B", dispute_type: "paper-conflict", meters: RMETERS, quadrant: { x: 0.3, y: 0.4 }, source: { source_type: "register-vendor" } },
  { ordinal: 5, mark: "AURA", owner: { name: "Marketplace seller", registrations: [] }, composite: 2, level: "B", dispute_type: "nuisance-claim", meters: RMETERS, quadrant: { x: 0.2, y: 0.2 }, source: { source_type: "common-law-marketplace" } },
  { ordinal: 6, mark: "AURA", ...reg("GB", "Registered", "/mark/gb/UK00001"), composite: 2, level: "B", dispute_type: "descriptive-terms", meters: RMETERS, quadrant: { x: 0.6, y: 0.3 }, source: { source_type: "register-vendor" } },
];
const REGION_COVERAGE = [
  { area: "register / US", state: "confirmed-clean", note: "exact sweep" },
  { area: "register / EU", state: "confirmed-clean", note: "EUIPO cross-check" },
  { area: "register / JP", state: "confirmed-clean", note: "exact sweep" },
  { area: "register / TR", state: "coverage-limited", note: "dead-probe only" },
  { area: "common-law", state: "confirmed-clean", note: "8-platform grid" },
];
// The scatter/quadrant chart is the svg with viewBox "0 0 560 430" — target it explicitly so the brand
// ridge marks in the topbar/footer wordmark (viewBox "0 0 1446 1446") aren't mistaken for the chart.
const svgOf = html => (html.match(/<svg viewBox="0 0 560 430"[\s\S]*?<\/svg>/) || [""])[0];
const matchN = (s, re) => (s.match(re) || []).length;
const orderedCodes = (html, cls) => { const re = new RegExp(`<details class="${cls}"[^>]*><summary><span class="rcode">([A-Z/]+)</span>`, "g"); const out = []; let m; while ((m = re.exec(html))) out.push(m[1]); return out; };
function scatterCircles(html) {
  const re = /<circle cx="([\d.]+)" cy="([\d.]+)" r="(\d+)"/g; const out = []; let m;
  while ((m = re.exec(svgOf(html)))) out.push({ x: +m[1], y: +m[2], r: +m[3] });
  return out;
}

test("§2.2/2.3/2.4: every finding appears exactly once in the scatter, the region panel, and the cards", () => {
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, { runId: "region-demo" });
  assert.equal(matchN(svgOf(html), /href="#c\d+"/g), 6, "one scatter dot per finding");
  assert.equal(matchN(html, /class="keyrow" href="#c\d+"/g), 6, "one rights-holder row per finding");
  assert.equal(matchN(html, / id="c\d+"/g), 6, "one card per finding");
  assert.equal(matchN(html, /<div class="card" id="c\d+"/g), 3, "3 full (on-field) cards = composite≥3");
  assert.equal(matchN(html, /<div class="card compact" id="c\d+"/g), 3, "3 compact (secondary) cards");
});

test("§2.2: the de-overlap nudges coincident dots apart — zero overlapping scatter dots, all inside the box", () => {
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, {});
  const dots = scatterCircles(html);
  assert.equal(dots.length, 6);
  for (const d of dots) {
    assert.ok(d.x >= 70 + d.r - 0.5 && d.x <= 530 - d.r + 0.5, `dot inside box x (${d.x})`);
    assert.ok(d.y >= 30 + d.r - 0.5 && d.y <= 372 - d.r + 0.5, `dot inside box y (${d.y})`);
  }
  for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
    const a = dots[i], b = dots[j], dist = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(dist >= a.r + b.r + 3 - 0.5, `dots ${i}/${j} do not overlap (dist ${dist.toFixed(1)} ≥ ${a.r + b.r + 3})`);
  }
});

test("§2.2: a pending finding is a hollow ring; filled dots carry the dark contrast outline", () => {
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, {});
  assert.match(svgOf(html), /fill="#FFFDF9"/);              // the pending (F2) dot is a hollow ring
  assert.match(svgOf(html), /stroke="#250902" stroke-opacity=".22"/);   // filled dots get the dark outline
});

test("§2.3/2.4: region grouping — key-panel and secondary share the same region order; common-law leaves the region groups (spec-48 A5)", () => {
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, {});
  // key-panel region order = ascending lowest ordinal: US(1) EU(3) JP(4) C/L(5) UK(6) — the landscape
  // panel keeps its Common-law group (it is the index of everything). The sentinel is C/L, never
  // Chile's ISO code CL (spec 47).
  // wp50/wi8: C/L is no longer interleaved in the jurisdiction order — it renders LAST, as its own
  // labelled non-jurisdiction block (cross-linked to the reading section).
  assert.deepEqual(orderedCodes(html, "rrow"), ["US", "EU", "JP", "UK", "C/L"], "key panel region order (C/L last)");
  assert.doesNotMatch(html, /<span class="rcode">CL<\/span>/, "the two-letter CL (Chile) never labels common-law");
  // A5: the secondary REGION groups hold registers only — common-law has its own section.
  assert.deepEqual(orderedCodes(html, "rgroup"), ["JP", "UK"], "secondary region order (registers only)");
  assert.match(html, /<h2>Common-law &amp; marketplace<\/h2>/);            // its own section
  assert.match(html, /<span class="rname">Common-law \/ marketplace<\/span>/); // labelled as non-register block
  assert.match(html, /<a href="#common-law">/, "cross-link to the reading section");
  assert.match(html, /<details class="rrow" open>/);                       // on-field region open by default
  assert.match(html, /<details class="rgroup"><summary><span class="rcode">UK<\/span>/);  // GB normalized → UK region
});

test("§2.6/2.8: hero is split — conclusion card carries the verdict, scope card carries jurisdiction chips", () => {
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, {});
  assert.match(html, /class="gconc"/);                                     // verdict block sits with the dial
  assert.match(html, /class="gk">Recommendation<\/span>/);
  // doc-35: the "Open conditions: N to close" self-audit KPI was removed from the conclusion card
  assert.doesNotMatch(html, /class="gk">Open conditions<\/span>/);
  assert.match(html, /class="jchips"/);                                    // jurisdiction chips in the scope card
  assert.match(html, /<span class="jchip" title="United States">US<\/span>/);            // hover carries the full country name
  assert.match(html, /<span class="jchip lim" title="Turkey — coverage-limited">TR\*<\/span>/);   // coverage-limited office dashed + * + named
  assert.match(html, /coverage-limited \(see/);                            // the limited-office note
});

test("§2.9: the issued timestamp renders verbatim from opts (deterministic), omitted when absent", () => {
  const withIssued = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, { issued: "2026-06-16 · 14:32 CEST" });
  assert.match(withIssued, /Issued 2026-06-16 · 14:32 CEST/);
  assert.match(withIssued, /class="mono tb-issued"/);
  const without = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, {});
  assert.doesNotMatch(without, /class="mono tb-issued"/);                  // no issued field when not passed (the .tb-issued CSS rule still lives in <style>)
  assert.doesNotMatch(without, />Issued /);
  assert.match(without, /class="topbar no-print"/);                        // topbar still renders
});

test("determinism: the same inputs render byte-identical HTML (no Date/random in the renderer)", () => {
  const opts = { runId: "region-demo", issued: "2026-06-16 · 14:32 CEST" };
  const a = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, opts);
  const b = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, opts);
  assert.equal(a, b);
});

test("§2.5/2.7: the under-hero actions strip is gone; Export popover + collapsible Ask-AI banner present", () => {
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, { runId: "region-demo", homeHref: "../index.html" });
  assert.doesNotMatch(html, /class="actions no-print"/, "the old under-hero actions strip is removed");
  assert.match(html, /class="tb-pop tb-exp-pop" hidden/);                  // one Export popover in the top line
  assert.match(html, /class="homebtn tb-back no-print"/);                  // back link carries the homebtn marker (pool-admin idempotency)
  assert.match(html, /<details class="askband no-print">/);                // Ask-AI is its own collapsible banner
  assert.doesNotMatch(html, /class="askai-toggle"/, "the old popover-button Ask-AI launcher is gone");
});

// ── CHANGE 2: disposition-driven banding (placement only — never recomputes composite/level) ──────────
const dm = (token, basis = "verified-from-record") => ({ token, basis });
const DMETERS = { mark_similarity: dm("high"), goods_proximity: dm("high"), use: dm("confirmed"), enforcer: dm("low", "inferred-from-signal") };
const dreg = (jur, uri) => ({ name: `${jur} Holder`, country: jur, registrations: [{ uri: uri || `/mark/${jur.toLowerCase()}/1`, classes: ["9"], status: "Registered", jurisdiction: jur }] });
// A Nordwave-style set: a bare Composite-3 ADVERSARIAL (Auralis NOVAPULSE) must LEAD band 1; a Composite-3
// COEXISTENCE-PARTNER (NORDWAVE NOVAPULSE) must render in band 2 DESPITE the identical composite; a DISTINGUISHED
// also band 2; an OFF-FIELD in band 3.
// doc-52 — the disposition-band tests carry NOVAPULSE findings; the mark under clearance must share a word
// with them (title "NOVAPULSE"), else the off-field genre-neighbour router (off-field + shares-no-word)
// correctly treats them as "ruled out". The shared FM title ("THIS IS MY MATCHDAY") is a fixture artifact.
const FM_NOVAPULSE = FM.replace("THIS IS MY MATCHDAY", "NOVAPULSE");
const DISP_FINDINGS = [
  { ordinal: 1, mark: "NOVAPULSE", owner: dreg("US", "/mark/us/auralis"), composite: 3, level: "C", dispute_type: "classic", disposition: "adversarial", meters: DMETERS, quadrant: { x: 0.8, y: 0.9 }, source: { source_type: "register-vendor" } },
  { ordinal: 2, mark: "NOVAPULSE", owner: dreg("US", "/mark/us/nordwave"), composite: 3, level: "C", dispute_type: "paper-conflict", disposition: "coexistence-partner", meters: DMETERS, quadrant: { x: 0.6, y: 0.5 }, source: { source_type: "register-vendor" } },
  { ordinal: 3, mark: "NOVAPULSE HOUSE", owner: dreg("EU", "/mark/eu/house"), composite: 3, level: "C", dispute_type: "horse-trade", disposition: "distinguished", meters: DMETERS, quadrant: { x: 0.4, y: 0.4 }, source: { source_type: "register-vendor" } },
  { ordinal: 4, mark: "NOVAPULSE", owner: dreg("US", "/mark/us/paint"), composite: 2, level: "B", dispute_type: "nuisance-claim", disposition: "off-field", meters: DMETERS, quadrant: { x: 0.2, y: 0.2 }, source: { source_type: "register-vendor" } },
];

function sectionOrder(html) {
  const re = /<h2>([^<]+)<\/h2>/g; const out = []; let m;
  while ((m = re.exec(html))) out.push(m[1].replace(/&amp;/g, "&"));
  return out;
}
// the band a finding-card id lands in = the nearest preceding <h2> section title
function bandOfCard(html, ord) {
  const at = html.indexOf(`id="c${ord}"`);
  assert.ok(at >= 0, `card c${ord} present`);
  const head = html.slice(0, at);
  const titles = [...head.matchAll(/<h2>([^<]+)<\/h2>/g)];
  return titles.length ? titles[titles.length - 1][1].replace(/&amp;/g, "&") : null;
}

test("CHANGE 2: disposition bands — adversarial leads band 1; a Composite-3 coexistence-partner lands in band 2", () => {
  const html = renderHtml(parsedOf(FM_NOVAPULSE), DISP_FINDINGS, [], { runId: "novapulse-demo" });
  // spec 2026-07-30 §3 — 03 Notable but manageable ABSORBS 04 Commercial awareness: the off-field
  // band renders under the SAME heading, demoted to a fold-lead ("we looked, it is not a problem" is
  // one section, not two). The heading count drops; the cards and their words are unchanged.
  assert.match(html, /<h2>On-field conflicts<\/h2>/);
  assert.match(html, /<h2>Notable but manageable<\/h2>/);
  assert.doesNotMatch(html, /<h2>Commercial awareness<\/h2>/, "the absorbed heading is gone");
  assert.match(html, /<p class="fold-lead"><b>Same name, a different commercial field\.<\/b>/, "the band-3 lead-in survives as a fold-lead");
  // placement: adversarial (c1) in band 1; coexistence-partner (c2) + distinguished (c3) + off-field (c4) all under 03
  assert.equal(bandOfCard(html, 1), "On-field conflicts", "adversarial composite-3 leads band 1");
  assert.equal(bandOfCard(html, 2), "Notable but manageable", "NORDWAVE-style coexistence-partner composite-3 is band 2, NOT band 1");
  assert.equal(bandOfCard(html, 3), "Notable but manageable", "distinguished composite-3 is band 2");
  assert.equal(bandOfCard(html, 4), "Notable but manageable", "off-field renders under 03 (absorbed), after the fold-lead");
  assert.ok(html.indexOf('<p class="fold-lead"><b>Same name') < html.indexOf('id="c4"'), "the off-field card sits under the fold-lead");
  // the full (band-1) card is the adversarial one; the band-2/3 cards are compact
  assert.match(html, /<div class="card" id="c1"/);
  assert.match(html, /<div class="card compact" id="c2"/);
  assert.match(html, /<div class="card compact" id="c4"/);
  // composite is NEVER recomputed — every card still states its own composite
  assert.match(html, /id="c2"[\s\S]*Composite 3/, "the coexistence-partner card still carries Composite 3");
});

test("CHANGE 2: a card's content (composite/level/dispute) is byte-unchanged across bands — disposition only moves placement", () => {
  // identical composite across c1 (band1) and c2 (band2): the tier labels must both read Composite 3.
  const html = renderHtml(parsedOf(FM), DISP_FINDINGS, [], {});
  assert.equal((html.match(/Composite 3/g) || []).length >= 3, true, "all three composite-3 cards keep Composite 3");
  assert.match(html, /Level C/);   // levels unchanged
});

test("CHANGE 2 back-compat: NO finding carries disposition → legacy composite banding, byte-identical sections", () => {
  // strip dispositions: the SAME inputs must collapse to the legacy two-section layout (01/02/03 + coverage 04).
  const legacy = DISP_FINDINGS.map(({ disposition, ...f }) => f);
  const html = renderHtml(parsedOf(FM), legacy, REGION_COVERAGE, { runId: "novapulse-demo" });
  // doc-52 — coverage is no longer a numbered top section; it renders inside the collapsed Scope section.
  assert.deepEqual(sectionOrder(html), ["The conflict landscape", "On-field conflicts", "Secondary & watch"]);
  assert.doesNotMatch(html, /Notable but manageable/);
  assert.doesNotMatch(html, /Commercial awareness/);
  // composite≥3 → on-field (c1,c2,c3 full), composite≤2 → secondary (c4 compact) — the pre-change split
  assert.match(html, /<div class="card" id="c1"/);
  assert.match(html, /<div class="card" id="c2"/);
  assert.match(html, /<div class="card" id="c3"/);
  assert.match(html, /<div class="card compact" id="c4"/);
  // doc-52 — coverage moved into the collapsed Scope section, under its own subheading
  assert.match(html, /<details class="scope"><summary>Scope/);
  assert.match(html, /What we covered — and what's open/);
});

test("CHANGE 2 back-compat: the EXISTING composite-only fixtures render byte-identically (no disposition anywhere)", () => {
  // REGION_FINDINGS carries no disposition → must use the legacy split + headings unchanged.
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, {});
  assert.match(html, /On-field conflicts/);
  assert.match(html, /Secondary &amp; watch/);
  assert.doesNotMatch(html, /Notable but manageable/);
  assert.doesNotMatch(html, /Commercial awareness/);
});

// ── CHANGE 1: the Methodology telemetry block + frame-reopen note are no longer rendered (internal too) ──
test("CHANGE 1: the 'How this search was run' Methodology block is NOT rendered (telemetry stripped)", () => {
  const FM_METH = [
    "---", "type: prelim-clearance", "matter: meth-demo", "title: METH",
    "overall_label: LOW", "frame_reopen_note: blind re-derivation diff: 3 cells changed", "---", "",
    "# Methodology", "Ran 412 searches, 86 record fetches, 14 batches; saturation baseline 0.92; cell-matrix 100/105; has_more=false.",
    "# Marks", "## Acme", "- ord: 1", "- one: x", "### The read", "y",
  ].join("\n");
  const html = renderHtml(parsedOf(FM_METH), FINDINGS, COVERAGE, { runId: "meth-demo" });
  assert.doesNotMatch(html, /How this search was run/, "the Methodology disclosure block is gone");
  assert.doesNotMatch(html, /class="method"/);
  assert.doesNotMatch(html, /86 record fetches/, "fetch counts never surface");
  assert.doesNotMatch(html, /saturation baseline/);
  assert.doesNotMatch(html, /cell-matrix/);
  assert.doesNotMatch(html, /has_more/);
  // genuine coverage OPEN ITEMS still render (the coverage grid is untouched)
  assert.match(html, /What we covered/);
  assert.match(html, /class="cov"/);
});

test("spec-49 T4: legacy fm caveat notes (frame_reopen_note / envelope_note) render on NO report variant", () => {
  // Archived runs may still carry these fm fields — the render must not resurrect the caveat surface.
  // Their substance reaches the reader via verdict clamp reasons + injected coverage rows (T1/T3);
  // envelope_note survives only as the email's plain "Search scope:" line.
  const FM_FR = [
    "---", "type: prelim-clearance", "matter: fr", "title: FR", "overall_label: LOW",
    "frame_reopen_note: frame-diff directives left unswept: variant:venzy phonetic family",
    "envelope_note: EU adjacent classes not exhausted", "---", "", "# Marks", "## Acme", "- one: x",
  ].join("\n");
  for (const opts of [{ lintFlags: ["a real flag"] }, { client: true }]) {
    const html = renderHtml(parsedOf(FM_FR), FINDINGS, COVERAGE, opts);
    assert.doesNotMatch(html, /Frame-reopen residue/);
    assert.doesNotMatch(html, /phonetic family/);
    assert.doesNotMatch(html, /Coverage gap \(stated, not closed\)/);
    assert.doesNotMatch(html, /EU adjacent classes not exhausted/);
  }
});

// ── CHANGE 5b: an inferred enforcer basis renders as an EXPLICIT inference, never as asserted fact ──────
test("CHANGE 5b: enforcer inferred-from-signal renders as an explicit inference (spec-48 A5: no absence assertion)", () => {
  const f = [{ ...FINDINGS[0], meters: { ...FINDINGS[0].meters, enforcer: { token: "high", basis: "inferred-from-signal" } } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  // A5: the line states only what was done — never "no enforcement record on file" (the
  // system did not sweep dockets, so it cannot assert the absence). B3 (spec 2026-07-30): the basis
  // is stated as a fact and STOPS — the "not verified against a fetched record" hedge lives once, in
  // Scope's record-provenance statement, never stamped per card.
  assert.match(html, /appetite <i>inferred<\/i> — reputation\/profile signal\./);
  assert.doesNotMatch(html, /not verified against a fetched record/);
  assert.doesNotMatch(html, /no enforcement record on file/);
  assert.doesNotMatch(html, /High appetite — <b>verified<\/b>/);   // inferred must NOT be stated as a verified fact
});

test("CHANGE 5b: enforcer verified-from-record stays stated as a fact (enforcement record on file)", () => {
  const f = [{ ...FINDINGS[0], meters: { ...FINDINGS[0].meters, enforcer: { token: "high", basis: "verified-from-record" } } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /High appetite — <b>verified<\/b> \(enforcement record on file\)/);
});

test("doc-35 T1 backstop: verified-from-record enforcer citing an UNFETCHED proceeding renders as INFERRED", () => {
  const f = [{ ...FINDINGS[0],
    bears_on: "owner won TTAB opp. 91223803 v NOVAPULSE FINANCIAL (sustained 2016-04-06)",
    meters: { ...FINDINGS[0].meters, enforcer: { token: "high", basis: "verified-from-record" } } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.doesNotMatch(html, /verified<\/b> \(enforcement record on file\)/, "an authority the system cannot fetch (TTABVUE not wired) must not render as verified");
  assert.match(html, /appetite <i>inferred<\/i> — reputation\/profile signal\./);
});

// ── CHANGE 5a (render side): the registration number is a structured per-record value bound to {uri, jur} ──
test("CHANGE 5a render: the reg number is bound to its record's uri + jurisdiction (per-record structured, not floated)", () => {
  const recordsByUri = new Map([["/mark/us/3396572", {
    _uri: "/mark/us/3396572", applicationNumber: "77999111", registrationNumber: "3396572",
    applicationDate: "2011-05-04", registrationDate: "2014-08-19", statusText: "Registered", jurisdiction: "US", classList: ["41"],
  }]]);
  const f = [{ ...FINDINGS[0], owner: { name: "Matchday, Inc.", country: "US", registrations: [
    { uri: "/mark/us/3396572", classes: ["41"], jurisdiction: "US" } ] } }];
  // — the origin now comes from the run's ALLOW-LIST, passed as `recordOrigins`, exactly as
  // publish/index.mjs passes it. It used to be scraped from `f.source.resolved_link`, which is why the
  // expected host below is the allow-listed one and not the fixture's source host.
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri, recordOrigins: ["https://tm.example"] });
  // the reg number sits INSIDE the same <li> as its uri + jurisdiction (one structured per-record line)
  // C1: the record-backed line now labels the jurisdiction's registration system from DATA
  assert.match(html, /<li><b><a href="https:\/\/tm\.example\/mark\/us\/3396572" target="_blank" rel="noopener noreferrer">\/mark\/us\/3396572<\/a><\/b>[^<]*· Registered[^<]*reg\. 3396572[^<]*· US <i class="jsys">\(first-to-use\)<\/i><\/li>/);
});

// — THIS ARM ASSERTED THE DEFECT, and is rewritten rather than deleted so the record of what it
// used to promise survives. Its title read "each registration URI is a LINK (origin from
// resolved_link)", and that scraped origin IS the bug: the allow-list refused a provider that publishes
// no per-record page, and the render took a host out of the finding's own source link instead. The arm
// was green from the day it landed, so the report and the test agreed with each other and both were
// wrong — the test won, by being the thing CI reads.
//
// What it asserts now is the same shape with the origin coming from the run's allow-list.
test("Full detail: a registration URI links from the run's ALLOW-LIST, never from the finding's source host", () => {
  // record-set present but THIS uri not fetched (the unverified branch) — it must still be a clickable link
  const recordsByUri = new Map([["/mark/us/other", { _uri: "/mark/us/other" }]]);
  const linked = [{ ...FINDINGS[0],
    source: { source_type: "register-vendor", resolved_link: "https://tm.corsearch.com/mark/us/88189278" },
    owner: { name: "Mythical, Inc.", country: "US", registrations: [
      { uri: "/mark/us/88189278", jurisdiction: "US" }, { uri: "/mark/eu/018553255", jurisdiction: "EU" } ] } }];
  const origins = { recordsByUri, recordOrigins: ["https://tm.corsearch.com"] };
  const html = renderHtml(parsedOf(REPORT), linked, COVERAGE, origins);
  assert.match(html, /<a href="https:\/\/tm\.corsearch\.com\/mark\/us\/88189278" target="_blank" rel="noopener noreferrer">\/mark\/us\/88189278<\/a>/);
  assert.match(html, /<a href="https:\/\/tm\.corsearch\.com\/mark\/eu\/018553255" target="_blank" rel="noopener noreferrer">\/mark\/eu\/018553255<\/a>/);

  // THE DEFECT, PINNED. Same findings, same source host — but a provider whose allow-list is EMPTY
  // (signa, clarivate: they publish no per-record page). Before both records linked onto
  // tm.corsearch.com anyway, because the `||` took the origin from resolved_link. Now: text.
  const empty = renderHtml(parsedOf(REPORT), linked, COVERAGE, { recordsByUri, recordOrigins: [] });
  // MATCHED ON THE ANCHOR'S TEXT, not on the href alone. The same URL is ALSO this finding's source
  // link, which renders as a legitimate provenance anchor elsewhere on the card — an href-only
  // assertion fails on that and reports a defect that is not there. (It did, on the first draft of
  // this arm.) A REGISTRATION link is the one whose visible text is the record path.
  const regAnchor = (h, path) => new RegExp(`<a href="[^"]*${path.replace(/\//g, "\\/")}"[^>]*>${path.replace(/\//g, "\\/")}<\\/a>`).test(h);
  assert.equal(regAnchor(empty, "/mark/us/88189278"), false,
    "an empty allow-list is an ANSWER — this provider publishes no record page, so nothing may link");
  assert.equal(regAnchor(empty, "/mark/eu/018553255"), false);
  assert.match(empty, /\/mark\/us\/88189278/, "the identifier is still shown — honest, just not a link");

  // A FOREIGN HOST DOES NOT WIN WHEN A LIST EXISTS. The allow-list names one origin and the finding's
  // source link names another. The record still links — one allow-listed origin is exactly the case
  // where a bare path CAN be resolved — but it must resolve to the LISTED host, not the scraped one.
  //
  // The pairing is artificial (a corsearch source link under a EUIPO allow-list cannot arise on a real
  // single-provider run, because the record paths come from the provider that owns the id space). It is
  // constructed on purpose: the defect was the scrape winning, and the only way to see the scrape lose
  // is to make the two disagree.
  const foreign = renderHtml(parsedOf(REPORT), linked, COVERAGE, { recordsByUri, recordOrigins: ["https://euipo.europa.eu"] });
  assert.doesNotMatch(foreign, /<a href="https:\/\/tm\.corsearch\.com\/mark\/us\/88189278"[^>]*>\/mark\/us\/88189278<\/a>/,
    "the finding's own source host reached a registration anchor past an allow-list without it");
  assert.match(foreign, /<a href="https:\/\/euipo\.europa\.eu\/mark\/us\/88189278"[^>]*>\/mark\/us\/88189278<\/a>/,
    "and the allow-listed origin is the one that resolved it");

  // A COMPOSITE names two origins, so a bare path cannot be resolved without guessing an office.
  const composite = renderHtml(parsedOf(REPORT), linked, COVERAGE,
    { recordsByUri, recordOrigins: ["https://euipo.europa.eu", "https://tsdr.uspto.gov"] });
  assert.equal(regAnchor(composite, "/mark/us/88189278"), false,
    "two offices, two hosts — picking one is a guess, and a guessed citation is what #1438 forbids");

  // no allow-list at all (a legacy/receipt-less run) → nothing is CONSTRUCTED from a bare path
  const noLink = [{ ...FINDINGS[0], source: { source_type: "register-vendor" },
    owner: { name: "X", country: "US", registrations: [{ uri: "/mark/us/55", jurisdiction: "US" }] } }];
  const html2 = renderHtml(parsedOf(REPORT), noLink, COVERAGE, {});
  assert.doesNotMatch(html2, /<a href="[^"]*\/mark\/us\/55"/);
  assert.match(html2, /<b>\/mark\/us\/55<\/b>/);
});

test("the card header shows the contentious MARK + the classes it matched in (not only the holder)", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  // FINDINGS[0]: holder "Matchday, Inc." owns the mark MATCHDAY in class 41 — the card shows BOTH, prominently
  assert.match(html, /class="who">Matchday, Inc\.<\/span>/, "the holder is still shown");
  assert.match(html, /class="cm-mark">MATCHDAY<\/span>/, "the contentious mark is shown next to the holder");
  assert.match(html, /class="ccl">Cl\.&nbsp;41<\/span>/, "the matched class is shown");
});

// ---- A1: a review-killed (withdrawn) finding renders NOWHERE; internal bar notes the kill ----
test("spec-48 A1 + spec-49 T4: a withdrawn finding appears NOWHERE on either report variant (receipt lives on the audit workbook)", () => {
  const killed = { ordinal: 3, mark: "KESTRELION", owner: { name: "Kestrel Lifesciences", country: "IN", registrations: [] },
    composite: 4, level: "D", dispute_type: "classic", disposition: "withdrawn",
    withdrawn_reason: "review flag: confabulated attribution",
    meters: { mark_similarity: meter("high"), goods_proximity: meter("high"), use: meter("unknown", "inferred-from-signal"), enforcer: meter("unknown", "inferred-from-signal") },
    quadrant: { x: 0.9, y: 0.9 }, source: { source_type: "common-law-web", resolved_link: "" } };
  const internal = renderHtml(parsedOf(REPORT), [...FINDINGS, killed], COVERAGE, {});
  assert.doesNotMatch(internal, /id="c3"/, "no card for the withdrawn ordinal");
  assert.doesNotMatch(internal, /KESTRELION/.source ? /class="who">Kestrel Lifesciences/ : /x/, "no rights-holder row");
  assert.doesNotMatch(internal, /href="#c3"/, "no scatter/panel drill-through");
  // T4: the withdrawal receipt lives on audit.xlsx (Disposition column + Review receipts),
  // not on a report banner — the mark now appears NOWHERE on either report variant.
  assert.doesNotMatch(internal, /Withdrawn by review/);
  assert.doesNotMatch(internal, /KESTRELION|Kestrel Lifesciences/, "the internal report never resurrects the kill either");
  // one report: a stale opts.client is inert, and the kill holds on it identically
  const stale = renderHtml(parsedOf(REPORT), [...FINDINGS, killed], COVERAGE, { client: true });
  assert.equal(stale, internal, "opts.client no longer forks the render");
});

// ---- A4: evidence status (the four-tuple) renders on every meter + on the cites ----
test("spec-48 A4: meter captions carry the joined four-tuple; without _status the legacy captions are byte-identical", () => {
  const joined = [{ ...FINDINGS[0], meters: {
    mark_similarity: { token: "medium", basis: "verified-from-record", source: "/mark/us/3396572", _status: "confirmed" },
    goods_proximity: { token: "high", basis: "verified-from-record", _status: "assumed" },
    use: { token: "confirmed", basis: "verified-from-record", _status: "assumed" },
    enforcer: { token: "medium", basis: "inferred-from-signal", _status: "inferred" },
  } }];
  const html = renderHtml(parsedOf(REPORT), joined, COVERAGE, {});
  // D4 — the four-tuple still renders on every meter, in its OWN labelled position. The fused
  // `<fact> · <status>` caption is gone: a client read "Confirmed · inferred" as one caption, and
  // nothing on the page said the separator meant "and we know that because".
  assert.match(html, /<div class="mv">Medium<\/div><div class="mev">Evidence: verified<\/div>/, "a receipt-joined verified meter says so");
  assert.match(html, /<div class="mv">High<\/div><div class="mev">Evidence: not yet verified<\/div>/, "an unjoined verified meter is presented as not-yet-verified");
  // — the use meter prints NO verification word (owner ruling): its receipt join is
  // unreachable for an http source, so verified/not-yet-verified carried no information there and
  // read as doubt about the fact. The register meters above keep the full vocabulary.
  assert.match(html, /<div class="mv">Confirmed<\/div><\/div>/, "the use meter closes after its fact — no verification word on the use surface");
  assert.doesNotMatch(html, /<div class="mv">Confirmed<\/div><div class="mev">Evidence: not yet verified<\/div>/, "the verification word is back on the use meter — tracker 2097 regressed");
  assert.match(html, /<div class="mv">Medium<\/div><div class="mev">Evidence: inferred<\/div>/, "the enforcer status replaces the raw basis word");
  assert.doesNotMatch(html, /Confirmed · |High · |Medium · /, "no meter fuses its two facts with a separator any more");
  // no _status (direct render, archived replay) → the meter's own `basis` lands in the SAME evidence
  // position rather than in the fact position. `basis` is REQUIRED by findings-model.mjs, so this is
  // the shape every archived run has, and the caption it produces DOES move — see the eighteenth break.
  const legacy = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  assert.doesNotMatch(legacy, /· verified|· assumed|· not yet verified|· not checked/);
  assert.doesNotMatch(legacy, /Inferred — medium/, "the enforcer no longer leads with its evidence word");
  assert.match(legacy, /<div class="mv">Medium<\/div><div class="mev">Evidence: inferred<\/div>/,
    "the legacy enforcer basis is stated as evidence, under the appetite it qualifies");
});

test("#762 D4: a meter with NO evidence to state emits no evidence slot at all", () => {
  // The zero-residue direction. `basis` is required on a real record, so this shape is synthetic — but
  // it is what makes the '' return a fact rather than an assumption: an absent evidence word costs zero
  // bytes, it does not render an empty <div>.
  const bare = [{ ...FINDINGS[0], meters: {
    mark_similarity: { token: "medium" }, goods_proximity: { token: "high" },
    use: { token: "confirmed" }, enforcer: { token: "medium" },
  } }];
  const html = renderHtml(parsedOf(REPORT), bare, COVERAGE, {});
  assert.match(html, /<div class="mv">Confirmed<\/div><\/div>/, "the use meter closes straight after its fact");
  assert.doesNotMatch(html, /class="mev"/, "no evidence slot is emitted where there is no evidence word");
});

test("spec-48 A4: an assumed-demoted 'verified' enforcer renders as inference; cites carry the four-tuple + use-source class", () => {
  const f = [{ ...FINDINGS[0],
    use_check: { source: "https://trademarks.justia.com/854/03/matchday.html" },
    own_rights: { source: "no applicant-owned registrations in the searched register material", _status: "assumed" },
    meters: { ...FINDINGS[0].meters,
      use: { token: "confirmed", basis: "verified-from-record", _status: "not-checked", _useSourceClass: "register-mirror" },
      enforcer: { token: "high", basis: "verified-from-record", _status: "assumed" } } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /appetite <i>inferred<\/i>/, "a verified claim the join demoted is never stated as fact");
  assert.doesNotMatch(html, /<b>verified<\/b> \(enforcement record on file\)/);
  // D4 — the cite's status is LABELLED as evidence, and the source class reads as a source phrase.
  assert.match(html, /Use checked\.[^<]*<\/b>[\s\S]{0,200}?Evidence: not checked, from a register mirror, which is not evidence of use/);
  assert.match(html, /Own-portfolio sweep\.<\/b> no applicant-owned registrations in the searched register material <i class="evstat">Evidence: not yet verified<\/i>/);
});

test("spec-48 A4/A5: enforcer verified NAMES its source when the meter carries one", () => {
  const f = [{ ...FINDINGS[0], meters: { ...FINDINGS[0].meters,
    enforcer: { token: "high", basis: "verified-from-record", source: "/mark/us/999", _status: "confirmed" } } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /<b>verified<\/b> \(source: \/mark\/us\/999\)/);
});

// ---- A5: a WO (WIPO/Madrid) registration names its designated countries, never implies worldwide ----
test("spec-48 A5: a WO registration renders 'designating: …' from the fetched record, or the honest absent-label", () => {
  const recordsByUri = new Map([
    ["/mark/wo/522733", { _uri: "/mark/wo/522733", statusText: "Registered", jurisdiction: "WO",
      onomaticsJurisdictionsStatuses: [{ jurisdiction: "EU", status: "Registered" }, "CH", { jurisdiction: "CN", status: "Refused" }] }],
    ["/mark/wo/900001", { _uri: "/mark/wo/900001", statusText: "Registered", jurisdiction: "WO" }],
  ]);
  const f = [{ ...FINDINGS[0], source: { source_type: "register-vendor", resolved_link: "https://tm.example/mark/wo/522733" },
    owner: { name: "Intl Holder", country: "CH", registrations: [
      { uri: "/mark/wo/522733", classes: ["41"], jurisdiction: "WO" },
      { uri: "/mark/wo/900001", classes: ["41"], jurisdiction: "WO" } ] } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri });
  assert.match(html, /designating: EU \(Registered\), CH, CN \(Refused\)/, "designated countries named from the record");
  assert.match(html, /designated countries not on the fetched record — rights reach only its designations/, "honest absent-label when the record lacks them");
});

// ---- A5: common-law gets its own section; on-field common-law cards are cross-linked ----
test("spec-48 A5: on-field common-law stays in On-field (full card) and is cross-linked from the Common-law section", () => {
  const clOn = { ordinal: 7, mark: "AURA", owner: { name: "Big Marketplace Seller", registrations: [] },
    composite: 4, level: "D", dispute_type: "classic", meters: RMETERS, quadrant: { x: 0.85, y: 0.85 },
    source: { source_type: "common-law-marketplace" } };
  const html = renderHtml(parsedOf(FM), [...REGION_FINDINGS, clOn], REGION_COVERAGE, {});
  assert.equal(bandOfCard(html, 7), "On-field conflicts", "the on-field CL card drives the read from On-field");
  assert.equal(bandOfCard(html, 5), "Common-law & marketplace", "the secondary CL card lives in the CL section");
  assert.match(html, /On-field common-law conflicts \(full cards above\): <a href="#c7">#7 AURA<\/a>/);
  // doc-52 — coverage renders inside the collapsed Scope section, not as a numbered top section
  assert.match(html, /<details class="scope"><summary>Scope[\s\S]*What we covered — and what's open/);
});

test("spec-48 A5: disposition mode — common-law leaves the bands for its own section, numbered sequentially", () => {
  const clOff = { ordinal: 5, mark: "NOVAPULSE", owner: { name: "Marketplace Seller", registrations: [] },
    composite: 2, level: "B", dispute_type: "nuisance-claim", disposition: "off-field",
    meters: DMETERS, quadrant: { x: 0.15, y: 0.15 }, source: { source_type: "common-law-marketplace" } };
  const html = renderHtml(parsedOf(FM_NOVAPULSE), [...DISP_FINDINGS, clOff], [], { runId: "novapulse-demo" });
  assert.equal(bandOfCard(html, 5), "Common-law & marketplace", "the CL off-field card is in the CL section, not band 3");
  assert.equal(bandOfCard(html, 4), "Notable but manageable", "register off-field stays in the absorbed 03 band");
  const order = sectionOrder(html);
  assert.deepEqual(order.slice(-1), ["Common-law & marketplace"], "CL section renders after the bands (no coverage in this fixture)");
});

// ---- C1/C2: jurisdiction-system labels + the Paris-priority window flag ----
test("spec-48 C1: region groups are labeled by registration system from DATA; unknown regions stay unlabeled", () => {
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, {});
  assert.match(html, /<span class="rcode">US<\/span><span class="rname">United States<\/span><span class="kc [a-z]+">C\d<\/span><span class="rsub">First-to-use<\/span>/);
  assert.match(html, /<span class="rcode">EU<\/span><span class="rname">European Union<\/span><span class="kc [a-z]+">C\d<\/span><span class="rsub">First-to-register<\/span>/);
  // the common-law pseudo-region is NOT a legal system — unlabeled
  assert.match(html, /<span class="rcode">C\/L<\/span><span class="rname">Common-law \/ marketplace<\/span><span class="kc [a-z]+">C\d<\/span><span class="rsub"><span style="white-space:nowrap">Unregistered use<\/span><\/span>/);
});

test("spec-48 C2: a record filed inside the Paris-priority window flags on its registration line; no asOf = no flag", () => {
  const recordsByUri = new Map([["/mark/us/3396572", {
    _uri: "/mark/us/3396572", registrationNumber: "3396572", applicationDate: "2026-06-01", statusText: "Pending", jurisdiction: "US", classList: ["41"],
  }]]);
  const f = [{ ...FINDINGS[0], owner: { name: "Matchday, Inc.", country: "US", registrations: [
    { uri: "/mark/us/3396572", classes: ["41"], jurisdiction: "US" } ] } }];
  const withClock = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri, asOf: "2026-07-03" });
  assert.match(withClock, /recent filing — Paris-priority window \(potential global backdating\)/);
  const noClock = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri });
  assert.doesNotMatch(noClock, /Paris-priority window/, "deterministic contexts (no asOf) never flag");
  const oldFiling = new Map([["/mark/us/3396572", { ...recordsByUri.get("/mark/us/3396572"), applicationDate: "2020-01-01" }]]);
  const settled = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri: oldFiling, asOf: "2026-07-03" });
  assert.doesNotMatch(settled, /Paris-priority window/, "an old filing never flags");
});

// ── spec 47 quick fixes (reviewer feedback, VENZY tranche — ported by spec 49 T0 from PR) ────────
test("spec 47: a reasoned Enforcer prose bullet suppresses the templated meter line (no duplicate/contradiction)", () => {
  const CARDS_E = [
    "# Marks",
    "## Matchday, Inc.", "- ord: 1", "- one: The dominant MATCHDAY holder.",
    "### The read", "Distinguished as wholes.",
    "### Full detail", "- **Enforcement.** Novartis-scale portfolio; appears likely to monitor and oppose.",
    "## MAN Sports", "- ord: 2", "- one: Identical anchor on core supplement goods.",
    "### The read", "Common-law only.",
  ].join("\n");
  const html = renderHtml(parsedOf(`${FM}\n${CARDS_E}`), FINDINGS, COVERAGE, {});
  // card 1 carries the reasoned prose bullet — the templated inferred-appetite line is suppressed
  const card1 = html.slice(html.indexOf('id="c1"'), html.indexOf('id="c2"'));
  assert.match(card1, /<b>Enforcement\.<\/b> Novartis-scale portfolio/);
  assert.doesNotMatch(card1, /appetite <i>inferred<\/i>/, "the templated meter line never doubles a reasoned prose bullet");
  // card 2 has no prose enforcer bullet — the templated meter line still renders (inferred, honest)
  const card2 = html.slice(html.indexOf('id="c2"'));
  assert.match(card2, /<b>Enforcer\.<\/b> Low appetite <i>inferred<\/i>/);
});

test("spec 47: the title heading carries classes + searched countries, full names on hover", () => {
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, {});
  const scope = (html.match(/<div class="mark-scope"[^>]*>[\s\S]*?<\/div>/) || [""])[0];
  assert.ok(scope, "the mark-scope line renders under the H1");
  assert.match(scope, /Cl\.&nbsp;5 · 32 · 41/);
  assert.match(scope, /<span title="United States">US<\/span>/);
  assert.match(scope, /<span title="Turkey">TR<\/span>/);
});

test("spec 47: external links in prose open in a new tab; internal anchors do not", () => {
  const CARDS_L = [
    "# Marks",
    "## Matchday, Inc.", "- ord: 1", "- one: holder.",
    "### The read", "See [the listing](https://store.example/matchday) and [the card](#c2).",
    "## MAN Sports", "- ord: 2", "- one: anchor.",
    "### The read", "Common-law only.",
  ].join("\n");
  const html = renderHtml(parsedOf(`${FM}\n${CARDS_L}`), FINDINGS, COVERAGE, {});
  assert.match(html, /<a href="https:\/\/store\.example\/matchday" target="_blank" rel="noopener noreferrer">the listing<\/a>/);
  assert.match(html, /<a href="#c2">the card<\/a>/);
});

// report-xss: a markdown link is the one place registry text + LLM output become an href in the
// client-facing report. The href must be attribute-escaped (no quote breakout) and scheme-allowlisted
// (javascript:/data:/… neutralised to plain text) so [x](" onmouseover=…) and [x](javascript:…) can't run.
test("report-xss: markdown link hrefs are attribute-escaped and scheme-allowlisted (no XSS)", () => {
  const CARDS_X = [
    "# Marks",
    "## Matchday, Inc.", "- ord: 1", "- one: holder.",
    "### The read", 'A breakout attempt [x](" onmouseover=alert(1)) and a scheme attack [y](javascript:alert(1)). A real registry link [reg](https://reg.example/s?a=1&b=2).',
    "## MAN Sports", "- ord: 2", "- one: anchor.",
    "### The read", "Common-law only.",
  ].join("\n");
  const html = renderHtml(parsedOf(`${FM}\n${CARDS_X}`), FINDINGS, COVERAGE, {});
  assert.doesNotMatch(html, /onmouseover=/, "no attribute breakout — the raw quote can't escape the href");
  assert.doesNotMatch(html, /href="javascript:/i, "javascript: scheme is never emitted as an href");
  assert.match(html, /a scheme attack y\b/, "the javascript: link is neutralised to its plain-text label");
  // regression guard: a legitimate query-string href stays SINGLE-escaped (& -> &amp;), never double
  // (escAttr would have re-run esc() and produced &amp;amp;, corrupting registry URLs).
  assert.match(html, /href="https:\/\/reg\.example\/s\?a=1&amp;b=2"/, "query-string & is single-escaped");
  assert.doesNotMatch(html, /&amp;amp;/, "no double-escaped ampersand in any emitted href");
});

test("spec 47: an actual Chilean registration groups under CL = Chile, distinct from common-law C/L", () => {
  const chilean = [
    { ordinal: 1, mark: "AURA", owner: { name: "CL Holder", country: "CL", registrations: [{ uri: "/mark/cl/1", classes: ["32"], status: "Registered", jurisdiction: "CL" }] },
      composite: 3, level: "C", dispute_type: "paper-conflict", meters: RMETERS, quadrant: { x: 0.7, y: 0.6 }, source: { source_type: "register-vendor" } },
    { ordinal: 2, mark: "AURA", owner: { name: "Marketplace seller", registrations: [] }, composite: 2, level: "B", dispute_type: "nuisance-claim", meters: RMETERS, quadrant: { x: 0.2, y: 0.2 }, source: { source_type: "common-law-marketplace" } },
  ];
  const html = renderHtml(parsedOf(FM), chilean, [], {});
  assert.match(html, /<span class="rcode">CL<\/span><span class="rname">Chile<\/span>/);
  assert.match(html, /<span class="rcode">C\/L<\/span><span class="rname">Common-law \/ marketplace<\/span>/);
});

// ── T2 (H5): the derived verdict sidecar is THE hero/topbar authority; legacy stays byte-stable ──
test("spec 49: verdictInfo drives the gauge and bound recommendation — fm.overall_label demotes to legacy fallback", () => {
  const vi = { verdict: "CONDITIONAL", reasons: ["close the CN register gap"], tier: "MANAGEABLE", badge: "l2", gaugeIndex: 1, maxComposite: 2 };
  const fmRec = FM.replace("overall_label: MEDIUM", "overall_label: MEDIUM").replace("---\n", "---\nrecommendation: Proceed with the filing.\n", 1);
  const withVi = renderHtml(parsedOf(fmRec), FINDINGS, COVERAGE, { runId: "vi-demo", verdictInfo: vi });
  // gauge marker sits at the DERIVED stop (index 1 = LOW pill), not the model's MEDIUM
  assert.match(withVi, /<div class="marker" style="left:30%">/);
  // doc-52 — the conditions live in the plain bound line (sourced from "Only you can close these"),
  // stated ONCE; the gauge shows the bare recommendation and the engine clamp reason never reaches any reader.
  assert.match(withVi, /class="gv gv-rec">Proceed with the filing/);
  assert.doesNotMatch(withVi, /close the CN register gap/, "the engine clamp reason never renders");
  // wp50: ONE vocabulary — pill/topbar speak the client tier word, ticks the client scale; no third scale
  assert.match(withVi, />MANAGEABLE<\/div>/, "gauge pill speaks the derived client tier word");
  assert.match(withVi, /class="tb-risk"[^>]*>MANAGEABLE</, "topbar badge speaks the same word");
  assert.match(withVi, /Low \/ Manageable/, "ticks use the client tier scale");
  assert.doesNotMatch(withVi, /SEVERE|>Severe</, "the legacy 'severe' vocabulary never renders with a sidecar");
  // legacy: no verdictInfo (or a pre-49 sidecar without tier) → the fm label still rules
  const legacy = renderHtml(parsedOf(fmRec), FINDINGS, COVERAGE, { runId: "vi-demo", verdictInfo: { verdict: "CONDITIONAL", reasons: [] } });
  assert.match(legacy, /<div class="marker" style="left:52%">/, "MEDIUM fm label = index 2 (legacy path unchanged)");
  // legacy vocabulary untouched (byte-stability for sidecar-less archives)
  const noVi = renderHtml(parsedOf(fmRec), FINDINGS, COVERAGE, { runId: "vi-demo" });
  assert.match(noVi, />Severe</, "legacy tick vocabulary preserved without a sidecar");
});

// ── T6 (D4 + H10): honest searched scope + the worst-exposure jurisdiction ──────────────────────
test("spec 49 (D4): the machine-derived searched set drives the header; a code-LIST coverage row also parses (copper-spire's shape)", () => {
  // machine set (register-plan regions via publish) wins
  const withSet = renderHtml(parsedOf(FM), REGION_FINDINGS, [], { searchedJurisdictions: ["US", "EU", "UK", "CN", "JP", "NZ", "PH", "IN", "RU", "ID", "ZA", "TR"] });
  for (const code of ["US", "CN", "NZ", "PH", "ZA", "TR"]) assert.match(withSet, new RegExp(`<span class="jchip" title="[^"]*">${code}</span>`), `${code} chips in`);
  // copper-spire's single row carrying a code LIST — the old single-code regex matched nothing → "CN/EU"
  const listCoverage = [{ area: "register / material jurisdictions US·EU·UK·CN·JP·NZ", state: "confirmed-clean", note: "" }];
  const legacy = renderHtml(parsedOf(FM), REGION_FINDINGS, listCoverage, {});
  for (const code of ["US", "EU", "UK", "CN", "JP", "NZ"]) assert.match(legacy, new RegExp(`>${code}\\*?</span>`), `${code} extracted from the list row`);
});

test("spec 49 (H10): the hero names the highest-exposure jurisdiction(s), derived from the highest-rated finding(s)", () => {
  const html = renderHtml(parsedOf(FM), REGION_FINDINGS, REGION_COVERAGE, {});
  // REGION_FINDINGS: max composite 4 = the EU finding
  assert.match(html, /Highest exposure<\/span>/);
  assert.match(html, /Highest exposure<\/span><span class="v"><span title="European Union">EU<\/span>/);
  assert.match(html, /from the highest-rated finding/);
  // no rated findings ⇒ the row is suppressed
  const none = renderHtml(parsedOf(FM), [], [], {});
  assert.doesNotMatch(none, /Highest exposure/);
});

// ── T7 (E1/E5/E6/E4): integrated cards — strands, chips, telemetry, contributions ───────────────
test("spec 49 (E5/E6): matched case-law strands render on EVERY joined card; enforcer telemetry names its provider", () => {
  const caseLawByOrdinal = new Map([
    [1, { ord: 1, mark: "MATCHDAY", owner: "Matchday, Inc.", jurisdiction: "US", none: false, body: "**On-point authorities:**\n- *WARDOGS* · EUIPO BoA · 2021 · holding: composites compared as wholes." }],
    [2, { ord: 2, mark: "MATCH DAY", owner: "MAN Sports", jurisdiction: "US", none: true, body: "**No on-point precedent found.** Sources searched: CourtListener." }],
  ]);
  const enforcerSignals = [{ uri: "https://tm.example/us/3396572", owner: "Matchday, Inc.", aggression: 2, oppositions: 3 }];
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { caseLawByOrdinal, enforcerSignals });
  const card1 = html.slice(html.indexOf('id="c1"'), html.indexOf('id="c2"'));
  assert.match(card1, /Case-law \(US\)\./, "the joined strand renders on card 1");
  assert.match(card1, /WARDOGS/);
  assert.match(card1, /<b>Enforcement telemetry\.<\/b> Corsearch records an aggression indicator of 2 and 3 opposition proceedings/, "the provider is NAMED (E6) — never an unattributed inference");
  const card2 = html.slice(html.indexOf('id="c2"'));
  assert.match(card2, /No on-point precedent found/, "the honest negative renders too");
  // E1: the chip set states the contributing layers
  assert.match(card1, /<span class="src reg">Register<\/span>/);
  assert.match(card1, /<span class="src cl">Case-law<\/span>/);
});

test("spec 49 (E4): the common-law section lists what the marketplace layer added to register findings — even with zero CL findings", () => {
  const f = [{ ...FINDINGS[0],
    use_check: { source: "https://store.example/matchday-listing" },
    meters: { ...FINDINGS[0].meters, use: { token: "confirmed", basis: "verified-from-record", _status: "confirmed", _useSourceClass: "owner-site" } } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /Common-law &amp; marketplace/, "the section renders on contributions alone");
  assert.match(html, /What the marketplace layer added to register findings/);
  // D4 — same three facts, three positions, none of them fused: what was found, where it was
  // checked, and how well it is evidenced. The line used to spend ' · ' on two different jobs.
  // — no verification word on the use surface (owner ruling); the source class alone.
  assert.match(html, /use Confirmed — store\.example <i class="evstat">\(evidence: from the owner's own site\)<\/i>/,
    "attributed, with the source class (the use line prints no verification word)");
});

// ── wp50/wi5: # Actions renders on the report — the Q&A can no longer be email-only ────────────────────
test("wp50: the # Actions panel renders — Answers first, buckets styled, ::p:: markers never survive raw", () => {
  const ACTIONS = [
    "# Actions",
    "### Answers to your instructions",
    "- You asked us to check whether the mark has any bad or unpleasant meaning → **nothing found** — it reads as a coined term. ::p:: internal caveat for the reviewer.",
    "- You asked us to flag whether the mark is descriptive of the goods → **not descriptive**.",
    "### Checks we ran — what we found",
    "- Use-check on the Turkish incumbent: marketed products found.",
    "### Only you can close these",
    "- Confirm whether the identical senior mark is the client's own prior filing.",
  ].join("\n");
  const md = `${FM}\n${ACTIONS}\n\n# Marks\n`;
  const internal = renderHtml(parsedOf(md), FINDINGS, COVERAGE, { runId: "act-demo" });
  assert.match(internal, /class="panel actions"/, "the actions panel renders");
  assert.match(internal, /Answers to your instructions/, "the Q&A section reaches the report");
  assert.match(internal, /bad or unpleasant meaning/, "ask 1 rides through");
  assert.match(internal, /not descriptive/, "ask 2 rides through");
  assert.match(internal, /What only you can close/, "doc-52 — the human-only bucket renders under its own section after the findings");
  assert.match(internal, /Confirm whether the identical senior mark/, "the only-you forward decision rides through");
  // doc-52 — the Q&A leads (verdict block, top); "Checks we ran" moves to the collapsed Scope section (bottom)
  assert.ok(internal.indexOf("Answers to your instructions") < internal.indexOf("Checks we ran"), "Q&A (verdict block) precedes Checks-we-ran (Scope)");
  // ONE report: the ::p:: tail renders LABELLED [internal] for the reviewing reader; the raw marker
  // never survives; a stale opts.client is inert.
  assert.ok(!internal.includes("::p::"), "the raw marker never reaches any surface");
  assert.match(internal, /\[internal\] internal caveat for the reviewer/, "the tail renders labelled for review");
  const stale = renderHtml(parsedOf(md), FINDINGS, COVERAGE, { client: true, runId: "act-demo" });
  assert.equal(stale, internal, "opts.client no longer forks the render");
  // no Actions section → no panel (legacy byte-stability)
  const none = renderHtml(parsedOf(`${FM}\n# Marks\n`), FINDINGS, COVERAGE, { runId: "act-demo" });
  assert.ok(!/class="panel actions"/.test(none), "absent section renders nothing");
});

// ── doc-52: one skeleton — verdict → conflicts → only-you → Scope; plain banner; ruled-out routing ───────
test("doc-52: reading order + plain banner (from only-you) + ruled-out routing + no engine idioms on any surface", async () => {
  const ACTIONS = [
    "# Actions",
    "### Answers to your instructions",
    "- You asked whether the mark has any bad meaning → nothing found.",
    "### Checks we ran — what we found",
    "- Marketplace use-check on the incumbent: active use found.",
    "### Only you can close these",
    "- Confirm whether the identical senior mark is the client's own prior filing.",
  ].join("\n");
  const md = `${FM_NOVAPULSE}\n${ACTIONS}\n\n# Marks\n`;
  const F = [
    { ordinal: 1, mark: "NOVAPULSE", owner: dreg("US", "/mark/us/1"), composite: 3, level: "C", dispute_type: "classic", disposition: "adversarial", meters: DMETERS, quadrant: { x: 0.8, y: 0.9 }, source: { source_type: "register-vendor" } },
    { ordinal: 2, mark: "UNTAMED", owner: dreg("US", "/mark/us/2"), composite: 2, level: "B", dispute_type: "nuisance-claim", disposition: "off-field", meters: DMETERS, quadrant: { x: 0.2, y: 0.1 }, source: { source_type: "register-vendor" } },
  ];
  const COV = [{ area: "register / CN slice", state: "coverage-limited", note: "35 records crossed into the band with null class/owner/status — unadjudicable" }];
  const vi = { verdict: "CONDITIONAL", reasons: ["engine: the slice crossed into the band"], kinds: { coverage: true }, tier: "MANAGEABLE", badge: "l2" };
  const opts = { runId: "d52", verdictInfo: vi, coverageJudgment: { reason: "the exact-compound slice is unadjudicable" } };
  const html = renderHtml(parsedOf(md), F, COV, opts);
  const client = renderHtml(parsedOf(md), F, COV, { ...opts, client: true });
  // reading order: verdict (mark) → conflicts → What only you can close → Scope
  const iVerdict = html.indexOf('class="mark"'), iConf = html.indexOf("On-field conflicts");
  const iYou = html.indexOf("What only you can close"), iScope = html.indexOf("Scope &amp; what we didn't search");
  assert.ok(iVerdict >= 0 && iVerdict < iConf && iConf < iYou && iYou < iScope, "verdict → conflicts → only-you → Scope");
  // the lawyer's Q&A leads in the verdict block, before the conflicts
  assert.ok(html.indexOf("Answers to your instructions") >= 0 && html.indexOf("Answers to your instructions") < iConf, "Q&A in the verdict block");
  // B1 (spec 2026-07-30 §4) — the "Subject to:" bound line is DELETED (a third copy of the verdict's
  // conditions); the conditions live in "What only you can close" and the verdict statement. The
  // engine clamp reason still never renders anywhere.
  assert.doesNotMatch(html, /class="bound"/, "no bound line — deleted, not reformatted");
  assert.doesNotMatch(html, /the slice crossed into the band/, "engine clamp reason never renders");
  // ruled-out routing: UNTAMED (off-field, shares no word with NOVAPULSE) leaves the conflict bands
  assert.match(html, /Also considered — ruled out/);
  assert.match(html, /<b>#\d+ UNTAMED<\/b>/);
  assert.doesNotMatch(html, /Commercial awareness/, "the genre-neighbour is not surfaced as a conflict");
  // RE-POINTED. This asserted that the renderer REWROTE engine idioms out of a coverage note.
  // That mechanism is deleted: it was find-and-replace over a client-facing string, and is what it
  // cost — `axis` -> `group` turned "AXIS Bank filed in class 36" into "group Bank filed in class 36"
  // on the report that was clearing AXIS. The ban list and the trademark register overlap.
  //
  // The guarantee moved to the source and split in two: the driver emits `areaLabel` beside the axis
  // identifier, and the seat is REFUSED the engine identifiers where it writes its reason
  // (coverage-form.SEAT_BANNED_TOKENS). The eleven legacy doc-52 idioms are no longer rewritten at all
  // — measured across the twelve delivered runs in the test pool, each matches ZERO times in the source
  // artifacts, so the contract that stopped emitting them is what holds now.
  //
  // So the fixture's idiom rides VERBATIM, and asserting that is the honest pin: it says out loud that
  // this surface no longer launders text, which is the property bought.
  assert.match(client, /crossed into the band/,
    "#669: the renderer no longer rewrites a client string — an idiom in the source now reaches the page, and the source is where it is stopped");
  // …and the property that replaced it: a coverage row prints the DRIVER'S label when it has one, and
  // its area verbatim when it does not. No pattern touches either.
  const { projectCoverageJudgment } = await import("../findings-model.mjs");
  const labelled = renderHtml(parsedOf(REPORT), FINDINGS,
    [{ area: "Unexamined drop / AXIS", state: "coverage-limited", note: "AXIS and Axis both enumerated to zero" }],
    { runId: "noref-669", coverageJudgment: projectCoverageJudgment({ sufficient: false, reason: "open",
        rows: [{ area: "incumbent-class / AXIS portfolio", areaLabel: "owner portfolio sweep / AXIS portfolio",
                 note: "coverage-limited — the owner lane did not close" }] }) });
  assert.match(labelled, /owner portfolio sweep \/ AXIS portfolio/i, "the label is what the page prints");
  assert.doesNotMatch(labelled, /incumbent-class/, "…and the identifier is not on the page");
  assert.match(labelled, /AXIS and Axis both enumerated to zero/, "the seat's sentence rides verbatim — both casings of the mark intact");
  // exactly ONE collapsible Scope section
  assert.equal((html.match(/<details class="scope"><summary>Scope/g) || []).length, 1, "one Scope section");
});

// ── scope_basis: the worldwide claim comes from the PLAN, not from model prose ──────────────────────
// The wp50 test below proves the ledger-prose sniff. That sniff was the ONLY thing making a worldwide
// sweep read as worldwide, so the disclosure appeared only if a model happened to write the word. It
// also cannot survive a regions-required provider, whose worldwide plan carries the vendor's full
// office list: by shape that is identical to a matter that hand-picked 186 territories.

test("scope_basis: a worldwide plan reads as worldwide even when no ledger row says the word", () => {
  // Deliberately prose-free: no row mentions worldwide, so only scope_basis can carry the claim.
  const coverage = [{ area: "register / citation-core exact", state: "confirmed-clean", note: "enumerated to has_more:false" }];
  const html = renderHtml(parsedOf(FM), [], coverage, { runId: "ww-plan", scopeBasis: "worldwide" });
  assert.match(html, /class="jchip ww"[^>]*>worldwide</, "the plan's own answer drives the chip");
  assert.match(html, /worldwide register sweep/, "and the scope line");
  assert.match(html, /register sweep ran worldwide/, "and the plain-language disclosure");
  assert.match(html, /class="jchip"[^>]*>WO<\/span>/, "doc-55 B: WO is always shown on a worldwide sweep");

  // Same inputs without the plan flag: unchanged from before — archived runs keep the prose fallback.
  const legacy = renderHtml(parsedOf(FM), [], coverage, { runId: "ww-plan" });
  assert.ok(!/jchip ww/.test(legacy), "no plan flag and no prose ⇒ no worldwide claim");
});

test("scope_basis: prose still wins on archived runs that have no plan flag", () => {
  const coverage = [{ area: "register / worldwide sweep", state: "confirmed-clean", note: "enumerated worldwide" }];
  const html = renderHtml(parsedOf(FM), [], coverage, { runId: "ww-prose", scopeBasis: null });
  assert.match(html, /class="jchip ww"[^>]*>worldwide</, "the pre-existing sniff is untouched");
});

test("scope_basis: a worldwide sweep never chips its office list", () => {
  // What publish hands render on a regions-required provider: scope_basis set, searchedJurisdictions
  // cleared. The office list belongs in "What we covered", never as 186 header chips.
  const coverage = [{ area: "register / citation-core exact", state: "confirmed-clean", note: "" }];
  const html = renderHtml(parsedOf(FM), [], coverage, { runId: "ww-offices", scopeBasis: "worldwide", searchedJurisdictions: [] });
  assert.match(html, /class="jchip ww"[^>]*>worldwide</);
  for (const code of ["AD", "AF", "BQ", "ZW"]) assert.ok(!new RegExp(`<span class="jchip"[^>]*>${code}<`).test(html), `${code} never chips on a worldwide run`);
});

// ── wp50/wi6: honest scope header — worldwide reads as worldwide; risk-bearing regions never drop ───────
test("wp50: script rows are skipped, worldwide leads the scope, and every leg of a composite≥3 finding joins the chips", () => {
  const coverage = [
    { area: "register / worldwide Class-5 near-VENZY", state: "confirmed-clean", note: "exact + near-form enumerated" },
    { area: "register / citation-core exact (US/EU/UK/CH/JP)", state: "confirmed-clean", note: "" },
    { area: "register / transliteration axis (JP/ZH/KR/AR/CY/Devanagari)", state: "confirmed-clean", note: "" },
    { area: "register / material jurisdictions US·EU·UK·CH·JP", state: "confirmed-clean", note: "" },
  ];
  const findings = [
    { ordinal: 1, mark: "VENZY", composite: 5, level: "E", dispute_type: "classic", meters: {}, owner: { name: "Doruk", registrations: [
      { uri: "https://tm.corsearch.com/mark/tr/2009-53984" }, { uri: "https://tm.corsearch.com/mark/ae/229552" },
      { uri: "https://tm.corsearch.com/mark/sa/1435019984" } ] }, source: { source_type: "register-vendor" } },
    { ordinal: 2, mark: "VENZ", composite: 2, level: "B", dispute_type: "classic", meters: {}, owner: { name: "SAMI", registrations: [
      { uri: "https://tm.corsearch.com/mark/pk/444492" } ] }, source: { source_type: "register-vendor" } },
  ];
  const html = renderHtml(parsedOf(FM), findings, coverage, { runId: "scope-demo" });
  assert.match(html, /worldwide register sweep/, "the header states the true scope");
  assert.match(html, /class="jchip ww"[^>]*>worldwide</, "worldwide chip leads the facts panel");
  for (const code of ["TR", "AE", "SA"]) assert.match(html, new RegExp(`<span class="jchip"[^>]*>${code}</span>`), `${code} (risk-bearing leg) chips in`);
  for (const bad of ["ZH", "AR", "CY", "KR"]) assert.ok(!new RegExp(`<span class="jchip"[^>]*>${bad}<`).test(html), `script token ${bad} never chips`);
  assert.ok(!/jchip"[^>]*>PK</.test(html), "a composite-2 finding's leg does not join the union");
  // no worldwide row, no ≥3 finding → legacy shape untouched
  const legacy = renderHtml(parsedOf(FM), [findings[1]], [coverage[1]], { runId: "scope-demo" });
  assert.ok(!/worldwide register sweep/.test(legacy), "no worldwide claim without ledger evidence");
});

// ── B3 (spec 2026-07-30 §4, replacing wp50/wi7): record provenance is stated ONCE, in Scope — never
// stamped per card. A mixed fetched/unfetched finding still renders honestly (never-invent intact):
// the fetched leg carries record facts, the unfetched legs render as bare index entries with no field
// shown as confirmed — and the ONE Scope statement explains what those states mean.
test("B3: provenance once in Scope — no per-card coherence line, index entries stay honest, one Record-provenance statement", () => {
  const recs = new Map([["https://tm.example/mark/ae/229552", { jurisdiction: "AE", status: "Registered" }]]);
  const f = [{ ...FINDINGS[0], owner: { name: "Doruk", country: "TR", registrations: [
    { uri: "https://tm.example/mark/ae/229552", jurisdiction: "AE" },
    { uri: "https://tm.example/mark/tr/2009-53984" },
    { uri: "https://tm.example/mark/sa/1435019984" } ] } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, { recordsByUri: recs });
  assert.doesNotMatch(html, /Verified from the fetched AE record/, "the per-card coherence stamp is gone");
  assert.match(html, /\(register-index entry\)/, "unfetched legs still marked — never shown as confirmed");
  assert.equal((html.match(/Record provenance/g) || []).length, 1, "the provenance statement renders exactly once, in Scope");
  assert.match(html, /register-index entry was seen in the register index; its full record was not pulled/);
  assert.match(html, /read from the official register records fetched this run/, "with a record set, the fetched sentence leads — byte-identical to B3 as shipped");

  // NO record set (2026-07-31 — B3 shipped this branch inverted). The labels the paragraph exists to
  // explain still render here: "(register-index entry)" comes out of the registration render's second
  // disjunct, and the enforcer "inferred" basis line is not gated on the record set at all. Gating the
  // EXPLANATION on the record set therefore left exactly the reader who needs it looking at bare labels,
  // with the self-explanatory per-leg wording ("full record not pulled this run") removed in the same
  // change. The explanation now renders wherever the labels can; only the fetched-records sentence,
  // which would be untrue here, drops out.
  const bare = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(bare, /\(register-index entry\)/, "the label still renders with no record set");
  assert.equal((bare.match(/Record provenance/g) || []).length, 1, "…so its explanation renders too, still exactly once");
  assert.match(bare, /register-index entry was seen in the register index; its full record was not pulled/);
  assert.doesNotMatch(bare, /read from the official register records fetched this run/,
    "no record set ⇒ the run never claims records were fetched");

  // Nothing to explain ⇒ nothing said: no cards, no labels, no paragraph.
  const empty = renderHtml(parsedOf(REPORT), [], COVERAGE, {});
  assert.doesNotMatch(empty, /Record provenance/, "no findings ⇒ no labels ⇒ no provenance statement");
});

// ── wp50/wi8: common-law leaves the by-jurisdiction grouping in the rights-holders panel ───────────────
test("wp50: the C/L group renders AFTER the region list, labelled and cross-linked; no-CL runs unchanged", () => {
  const findings = [
    { ordinal: 1, mark: "AAA", composite: 3, level: "C", dispute_type: "classic", meters: {}, owner: { name: "X", registrations: [{ uri: "/mark/us/1", jurisdiction: "US" }] }, source: { source_type: "register-vendor" } },
    { ordinal: 2, mark: "BBB", composite: 2, level: "B", dispute_type: "classic", meters: {}, owner: { name: "Y", registrations: [] }, source: { source_type: "common-law-marketplace" } },
  ];
  const html = renderHtml(parsedOf(REPORT), findings, COVERAGE, {});
  assert.match(html, /Common-law \/ marketplace — unregistered use, not register rights/, "labelled block");
  assert.match(html, /<a href="#common-law">/, "cross-link to the reading section");
  const usIdx = html.indexOf('<span class="rcode">US</span>');
  const clIdx = html.indexOf('Common-law / marketplace');
  assert.ok(usIdx > 0 && clIdx > usIdx, "C/L block sits after the region list");
  // no-CL run: no C/L block at all
  const none = renderHtml(parsedOf(REPORT), [findings[0]], COVERAGE, {});
  assert.ok(!/Common-law \/ marketplace/.test(none), "no C/L group without common-law findings");
});

// ── wp50/wi9: coverage reads as covered vs next-steps, in plain English ─────────────────────────────────
test("wp50: coverage grid — clean rows green, routine states neutral (.todo/.info, never orange warn), split intro renders", () => {
  const cov = [
    { area: "register / worldwide Class-5 sweep", state: "confirmed-clean", note: "enumerated to has_more:false" },
    { area: "Follow-up / WHO INN drug-name-stem screening", state: "open", note: "not completed this run — the source timed out this run" },
    { area: "common-law / non-Latin marketplace reach", state: "coverage-limited", note: "thin non-Latin marketplace data" },
    { area: "common-law / per-jurisdiction ledger", state: "note", note: "ledger accounts at platform level" },
  ];
  const html = renderHtml(parsedOf(REPORT), FINDINGS, cov, {});
  assert.match(html, /covcell ok/, "clean row keeps the green check");
  assert.ok(!/covcell warn/.test(html), "no orange warn cells for routine states");
  assert.match(html, /covcell todo/, "open/limited rows are neutral to-dos");
  assert.match(html, /covcell info/, "note rows are info");
  assert.match(html, /Next steps &amp; monitoring/, "the split intro renders");
  assert.match(html, /· Open item</, "state word in plain English");
  assert.match(html, /· Partially covered</, "coverage-limited state word");
  assert.ok(html.indexOf("covcell ok") < html.indexOf("Next steps"), "covered group leads");
});

// ---- doc-54: the dynamic framework band ladder (one tick per band; Clear = zero-state, not a tick) ----
import { parseFrameworkManifest } from "../framework.mjs";
const AURORA_MANIFEST = parseFrameworkManifest(JSON.stringify({
  schema_version: 1, framework_key: "aurora", title: "Aurora Interactive ACP risk framework",
  source_deck: "ACP Risk Assessment Framework (test fixture)", entity_label: "Aurora Interactive",
  bands: [
    { label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" },
  ],
  structure: { kind: "matrix", axes: ["Legal Risk Level (A–E)", "Dispute Type"] },
}), "test");
const BAND_FINDINGS = [
  { ordinal: 1, mark: "MATCHDAY", band: "Manageable", disposition: "distinguished",
    owner: { name: "Matchday, Inc.", country: "US", registrations: [{ uri: "https://tm.example/us/1", classes: ["41"], status: "Registered", jurisdiction: "US" }] },
    source: { source_type: "register-vendor", resolved_link: "https://tm.example/us/1" }, meters: {} },
  { ordinal: 2, mark: "LOWMARK", band: "Low", disposition: "distinguished",
    owner: { name: "Low Co", country: "US", registrations: [{ uri: "https://tm.example/us/2", classes: ["41"], status: "Registered", jurisdiction: "US" }] },
    source: { source_type: "register-vendor", resolved_link: "https://tm.example/us/2" }, meters: {} },
];

test("doc-54: framework gauge = one tick per band, no merged tick, no Clear tick; marker lands on the VERDICT band (Manageable ≠ Low)", () => {
  const vi = { tier: "Manageable", verdict: "CONDITIONAL", badge: "l2", gaugeIndex: 1,
    band: { label: "Manageable", rankFromTop: 4, scale: 5 } };
  const html = renderHtml(parsedOf(REPORT), BAND_FINDINGS, [], { framework: AURORA_MANIFEST, verdictInfo: vi });
  const ticks = html.match(/<div class="ticks">([\s\S]*?)<\/div>/)[1];
  assert.equal((ticks.match(/<span/g) || []).length, 5, "one tick per manifest band");
  assert.match(ticks, /^<span>Low<\/span>/, "least severe leads (ladder reversed)");
  assert.match(ticks, /Very High<\/span>$/, "most severe ends the ladder");
  assert.doesNotMatch(ticks, /Clear/, "'Clear' is a verdict state, never a band tick");
  assert.doesNotMatch(ticks, / \/ /, "no merged tone-grouped tick");
  // 5 bands ⇒ Manageable (rank 4 of 5, second-least severe) sits at cell 1 → 30.0%
  assert.match(html, /class="marker" style="left:30\.0%"/, "marker positioned by band label, not tone-stop");
  assert.match(ticks, /<span class="on"[^>]*>Manageable<\/span>/, "the verdict band's tick is active");
});

test("doc-54: Clear zero-state — no active tick, left-anchored clear pill", () => {
  const vi = { tier: "No rated conflicts", verdict: "CLEAR", badge: "l1", gaugeIndex: 0 };
  const html = renderHtml(parsedOf(REPORT), [], [], { framework: AURORA_MANIFEST, verdictInfo: vi });
  const ticks = html.match(/<div class="ticks">([\s\S]*?)<\/div>/)[1];
  assert.doesNotMatch(ticks, /class="on"/, "no band tick is active in the zero-state");
  assert.match(html, /class="marker" style="left:0;transform:none[^"]*"><div class="pill" style="background:var\(--clear\)">No rated conflicts<\/div>/);
});

test("doc-54: composite-tier sidecar on a framework run maps tone-nearest, never Clear (fail-loud floor)", () => {
  const vi = { tier: "MEDIUM", verdict: "CONDITIONAL", badge: "l3", gaugeIndex: 2 };
  const html = renderHtml(parsedOf(REPORT), [], [], { framework: AURORA_MANIFEST, verdictInfo: vi });
  const ticks = html.match(/<div class="ticks">([\s\S]*?)<\/div>/)[1];
  assert.match(ticks, /<span class="on"[^>]*>Medium<\/span>/, "tone 2 → the Medium band tick");
});

// ── the framework is named beside the words it owns ───────────────────────────────────────────
// The ticks under the scale spell a vocabulary — "Manageable", "Moderate" — that means nothing without
// the framework in force, and the ONLY place naming it was the footer, several screens down a document
// that routinely runs six thousand pixels. The footer line stays (it is the printed page's provenance);
// what this adds is the name where the ladder is actually read.
test("#761 the gauge names the framework whose ladder it is printing, right above the ticks", () => {
  const html = renderHtml(parsedOf(REPORT), BAND_FINDINGS, [], { framework: AURORA_MANIFEST, runId: "r" });
  const label = html.match(/<div class="label">Overall risk[\s\S]*?<\/div>/)[0];
  assert.match(label, /<span class="gauge-fw">Aurora Interactive ACP risk framework<\/span>/,
    "the manifest's own name for itself, in the gauge's heading");
  // BESIDE the ticks, not merely somewhere on the page: the whole complaint is distance.
  const gauge = html.match(/<div class="panel gauge">[\s\S]*?<div class="ticks">/)[0];
  assert.match(gauge, /<span class="gauge-fw">/, "the name sits inside the gauge panel, above the scale and the ticks");
  // ONE name for one framework. A second, composed short form here would rebuild in another corner.
  assert.equal((html.match(/Aurora Interactive ACP risk framework/g) ?? []).length, 2,
    "named twice and only twice — the gauge and the footer provenance line");
});

test("#761 the legacy gauge names nothing — an archived run with no manifest is byte-identical", () => {
  // The legacy branch has no framework object to name, which is what makes it the legacy branch. This
  // is the guard on the freeze table's zero rows: if the name ever leaks into this shape, a sidecar-less
  // archived clearance starts re-rendering differently and the SIXTEENTH BREAK's measurement is a lie.
  const legacy = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "r" });
  // The MARKUP, not the document: `.gauge-fw` is also a selector in the inlined report.css, so a bare
  // /gauge-fw/ would match the stylesheet and pass for the wrong reason on a page that emitted the span.
  assert.doesNotMatch(legacy, /<span class="gauge-fw">/, "no framework ⇒ no name, and no empty span where one would go");
  assert.match(legacy, /<div class="label">Overall risk<\/div>/, "the legacy heading is untouched");
});

test("doc-54: region chips speak the group's worst band word in framework mode; C-codes stay legacy-only", () => {
  const vi = { tier: "Manageable", verdict: "CONDITIONAL", badge: "l2", gaugeIndex: 1, band: { label: "Manageable", rankFromTop: 4, scale: 5 } };
  const fw = renderHtml(parsedOf(REPORT), BAND_FINDINGS, [], { framework: AURORA_MANIFEST, verdictInfo: vi });
  assert.match(fw, /<span class="kc [a-z]+">Manageable<\/span>/, "region header chip = worst band word");
  assert.doesNotMatch(fw, /<span class="kc [a-z]+">C\d<\/span>/, "no composite shorthand on a framework run");
  const legacy = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  assert.match(legacy, /<span class="kc [a-z]+">C\d<\/span>/, "legacy renders keep the C-codes");
});

test("doc-54: landscape legend avoids the band-word collision only in framework mode", () => {
  const vi = { tier: "Medium", verdict: "CONDITIONAL", badge: "l3", gaugeIndex: 2, band: { label: "Medium", rankFromTop: 3, scale: 5 } };
  const onfield = [{ ordinal: 3, mark: "MATCHDAY LIVE", band: "Medium", disposition: "adversarial",
    owner: { name: "Adversary Co", country: "US", registrations: [{ uri: "https://tm.example/us/3", classes: ["41"], status: "Registered", jurisdiction: "US" }] },
    source: { source_type: "register-vendor", resolved_link: "https://tm.example/us/3" }, meters: {} }, ...BAND_FINDINGS];
  const fw = renderHtml(parsedOf(REPORT), onfield, [], { framework: AURORA_MANIFEST, verdictInfo: vi });
  assert.match(fw, /Secondary · watch/);
  assert.doesNotMatch(fw, /Secondary · manageable/);
  const legacy = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  assert.match(legacy, /Secondary · manageable/);
});

test("doc-54: legacy sidecar-less gauge keeps its 5 positional ticks (byte-stability guard)", () => {
  const legacy = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  const ticks = legacy.match(/<div class="ticks">([\s\S]*?)<\/div>/)[1];
  assert.equal((ticks.match(/<span/g) || []).length, 5);
  assert.match(ticks, />Severe</);
});

test("doc-54: one footer — the full provenance line rides the document; serve-time removal is portal-report's job", () => {
  // ONE report (spec 2026-07-30 §5): the client footer variant is retired. The document carries the
  // reviewer's full "Rated under:" provenance; portal-report.mjs (RATED_UNDER_RE) strips that line for
  // EVERY embedded reader at serve time — one place, tested there.
  const fmLeak = REPORT.replace("run: 2026-06-10", "run: 2026-06-10 · Corsearch register + common-law grid")
    .replace("---\n\n#", "rated_under: Aurora Interactive (aurora) · custom framework (risk-framework-aurora.md) · profile 890f610e1dcf\n---\n\n#");
  const vi = { tier: "Manageable", verdict: "CONDITIONAL", badge: "l2", gaugeIndex: 1, band: { label: "Manageable", rankFromTop: 4, scale: 5 } };
  const internal = renderHtml(parsedOf(fmLeak), BAND_FINDINGS, [], { framework: AURORA_MANIFEST, verdictInfo: vi });
  assert.match(internal, /Rated under: <span class="mono">Aurora Interactive \(aurora\)/, "the footer keeps the full provenance line");
  const stale = renderHtml(parsedOf(fmLeak), BAND_FINDINGS, [], { client: true, framework: AURORA_MANIFEST, verdictInfo: vi });
  assert.equal(stale, internal, "opts.client no longer forks the footer");
});

test("B1 (spec 2026-07-30 §4): the 'Subject to:' bound line is DELETED — no third copy of the conditions on the hero", () => {
  const acts = ["# Actions", "### Only you can close these",
    "- **[Time-critical] Identify the publisher of The Unbeatable Path** — storefront silence.",
    "- Confirm the classes you will actually file.", "- Decide the launch jurisdictions list now.",
    "- Approve the coexistence outreach draft.", "- Monitor prosecution of the GB application.",
  ].join("\n");
  const vi = { tier: "Manageable", verdict: "CONDITIONAL", badge: "l2", gaugeIndex: 1, band: { label: "Manageable", rankFromTop: 4, scale: 5 } };
  const html = renderHtml(parsedOf(`${REPORT}\n${acts}`), BAND_FINDINGS, [], { client: true, framework: AURORA_MANIFEST, verdictInfo: vi });
  assert.doesNotMatch(html, /class="bound"/, "the bound line is gone on a CONDITIONAL run");
  assert.match(html, /What only you can close/, "the conditions' one home (the only-you section) still renders");
  // actYouConditions itself STAYS — the email composer builds its conditions list from it (tested below).
});

// ---- report-leftovers: session-wide notice, pending dot, C/L default-collapse ----
test("leftovers: the case-law session-wide notice renders ONCE in §04 when strands exist to reference it", () => {
  const clMap = new Map([[1, { ord: 1, mark: "MATCHDAY", owner: "Matchday, Inc.", jurisdiction: "US", body: "No on-point precedent found.\nCoverage gaps: as § Session-wide notice above." }]]);
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { caseLawByOrdinal: clMap, caseLawNotice: "CourtListener and EUR-Lex were unavailable this session; federal-court coverage is partial." });
  assert.match(html, /Session-wide notice/);
  assert.match(html, /CourtListener and EUR-Lex were unavailable/);
  assert.equal((html.match(/Session-wide notice/g) || []).length <= 2, true, "notice heading appears once (plus at most one strand ref)");
  // no strands ⇒ no orphan notice block
  const bare = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { caseLawNotice: "CourtListener was down." });
  assert.doesNotMatch(bare, /Session-wide notice/);
});

test("leftovers: a _wasPending registration plots with the pending ring, not the solid registered dot", () => {
  const f = [{ ...FINDINGS[0], owner: { ...FINDINGS[0].owner, registrations: [
    { uri: "/mark/gb/1", status: null, _wasPending: true, classes: [] },
  ] }, quadrant: { x: 0.6, y: 0.6 } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /<circle[^>]*fill="#FFFDF9" stroke="/, "pending ring style used");
});

test("leftovers: the C/L rights-holder group is collapsed by default; geographic on-field regions stay open", () => {
  const mixed = [
    { ...FINDINGS[0] },   // on-field US register finding (composite 4 in fixture)
    { ordinal: 2, mark: "CLMARK", owner: { name: "Seller", registrations: [] }, composite: 4, level: "D",
      dispute_type: "paper-conflict", meters: {}, quadrant: { x: 0.7, y: 0.7 }, source: { source_type: "common-law-marketplace" } },
  ];
  const html = renderHtml(parsedOf(REPORT), mixed, COVERAGE, {});
  const cl = html.match(/<details class="rrow"[^>]*><summary><span class="rcode">C\/L<\/span>[\s\S]*?<\/summary>/)[0];
  assert.doesNotMatch(cl, /rrow" open/, "C/L group collapsed even with an on-field CL finding");
  assert.match(html, /<details class="rrow" open><summary><span class="rcode">US<\/span>/, "on-field geographic region still open");
});

// ══ WP-55 (doc-55) — UI residuals (A) + WIPO/register-source coverage (B) ═════════════════════════════

test("doc-55 A1: card-anchor navigation opens collapsed <details> ancestors and lands on the card top", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "a1" });
  assert.match(html, /a\[href\^="#c"\]/, "a delegated click handler targets #c<n> card anchors");
  assert.match(html, /tagName===.DETAILS./, "it opens the target's ancestor <details> (rgroup/rrow) before scrolling");
  assert.match(html, /scrollIntoView/, "it scrolls the card top into view (scroll-margin-top offsets the sticky topbar)");
  assert.match(html, /addEventListener\(.hashchange./, "hashchange / deep-link navigation handled too");
  assert.match(html, /<div class="card" id="c1">/, "the anchor target is the card WRAPPER (headline first), never the Full-detail <details>");
});

test("doc-55 A2: the rights-holder panel opens ONLY the highest-risk region; other on-field regions collapse", () => {
  const F = [
    { ordinal: 1, mark: "ALPHA", composite: 4, level: "B", dispute_type: "classic", meters: {}, owner: { name: "A Inc", registrations: [{ uri: "https://tm.example/mark/us/1", jurisdiction: "US" }] }, source: { source_type: "register-vendor" } },
    { ordinal: 2, mark: "BETA", composite: 4, level: "B", dispute_type: "classic", meters: {}, owner: { name: "B GmbH", registrations: [{ uri: "https://tm.example/mark/eu/2", jurisdiction: "EU" }] }, source: { source_type: "register-vendor" } },
    { ordinal: 3, mark: "GAMMA", composite: 1, level: "D", dispute_type: "classic", meters: {}, owner: { name: "G KK", registrations: [{ uri: "https://tm.example/mark/jp/3", jurisdiction: "JP" }] }, source: { source_type: "register-vendor" } },
  ];
  const html = renderHtml(parsedOf(FM), F, COVERAGE, { runId: "a2" });
  const openRegions = (html.match(/<details class="rrow" open>/g) || []).length;
  assert.equal(openRegions, 1, "exactly ONE region open (the top/highest-risk), not every on-field region");
  assert.match(html, /<details class="rrow" open><summary><span class="rcode">US<\/span>/, "the highest-exposure region (US, lowest ordinal) is the open one");
  assert.match(html, /<details class="rrow"><summary><span class="rcode">EU<\/span>/, "the other on-field region collapses to a one-line header");
});

test("doc-55 A3 (one-report form): the case-law strand renders its full body once; opts.client is inert", () => {
  const caseLawByOrdinal = new Map([
    [1, { ord: 1, mark: "MATCHDAY", owner: "Matchday, Inc.", jurisdiction: "US", none: true, coverageLimited: true,
          body: "**No on-point precedent found.** CourtListener was not reachable (MCP server did not connect); ToolSearch returned no courtlistener__* tools; still connecting; HTTP 429." }],
  ]);
  const caseLawNotice = "Case-law grounding incomplete: CourtListener MCP not wired; Legal Data Hunter quota exhausted (HTTP 429).";
  const internal = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { caseLawByOrdinal, caseLawNotice });
  assert.match(internal, /MCP server did not connect/, "the reviewer keeps the full case-law diagnostics");
  assert.match(internal, /Session-wide notice/, "the session-wide notice renders on the report");
  // ONE report (spec 2026-07-30 §5): the code-owned client line and the client body-fork are retired
  // with the CLIENT flag — a stale opts.client is inert. Getting engine vocabulary off the DOCUMENT for
  // every reader is the prompt-side voice work (charter P6/P7), never a second render here.
  const stale = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { client: true, caseLawByOrdinal, caseLawNotice });
  assert.equal(stale, internal, "opts.client no longer forks the case-law strand");
});

test("doc-55 A3 (one-report form): Full-detail prose renders whole; opts.client is inert (voice cleanup is prompt-side)", () => {
  const card = [
    "# Marks", "## Matchday, Inc.", "### Full detail",
    "- **Case law.** No US federal precedent was located. CourtListener was not reachable (MCP server did not connect); TTABVUE was not searched. The absence of precedent is an honest negative, not a clean bill.",
  ].join("\n");
  const md = `${FM}\n${card}`;
  const internal = renderHtml(parsedOf(md), FINDINGS, COVERAGE, {});
  assert.match(internal, /MCP server did not connect/, "the reviewer's operational sentence renders");
  assert.match(internal, /No US federal precedent was located/, "the legal sentence renders");
  assert.match(internal, /honest negative, not a clean bill/, "the legal conclusion renders");
  const stale = renderHtml(parsedOf(md), FINDINGS, COVERAGE, { client: true });
  assert.equal(stale, internal, "opts.client no longer forks Full-detail prose");
});

test("doc-55 A3 (one-report form): a precedent-FOUND strand renders citations and coverage detail once", () => {
  const caseLawByOrdinal = new Map([
    [1, { ord: 1, mark: "MATCHDAY", owner: "Matchday, Inc.", jurisdiction: "US", none: false, coverageLimited: false,
          body: "**On-point authorities:**\n- *WARDOGS* · EUIPO BoA · 2021 · holding: composites compared as wholes.\n- TTAB (US): TTABVUE not wired — no administrative record searched.\n- CourtListener was not reachable (MCP server did not connect)." }],
  ]);
  const internal = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { caseLawByOrdinal });
  assert.match(internal, /WARDOGS/, "the precedent citation renders (legal content)");
  assert.match(internal, /composites compared as wholes/, "the holding renders");
  assert.match(internal, /MCP server did not connect/, "the reviewer keeps the full coverage detail");
  const stale = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { client: true, caseLawByOrdinal });
  assert.equal(stale, internal, "opts.client no longer forks the strand");
});

test("doc-55 A3 (safety): legitimate client legal prose that merely mentions 'MCP' or 'not wired' is PRESERVED, never stripped", () => {
  // the strip must never silently delete real legal content on an unseen mark — a conflict/owner named
  // "MCP" (a common 3-letter mark) or class-9 goods described as "wireless, not wired" must survive.
  const card = [
    "# Marks", "## Matchday, Inc.", "### Full detail",
    "- **Goods.** MCP Corp's registration in class 9 covers wireless, not wired audio devices — a different channel from the applicant's goods.",
  ].join("\n");
  const client = renderHtml(parsedOf(`${FM}\n${card}`), FINDINGS, COVERAGE, { client: true });
  assert.match(client, /MCP Corp's registration in class 9/, "a conflict/owner named 'MCP' is not mistaken for the Model Context Protocol");
  assert.match(client, /wireless, not wired audio devices/, "'not wired' goods prose survives — the tokens bind to an engine context, not bare words");
});

test("doc-55 B: a worldwide sweep ALWAYS shows WO (WIPO/Madrid) + the national/regional/international source note; INT→WO; targeted runs unforced", () => {
  const coverage = [{ area: "register / worldwide sweep", state: "confirmed-clean", note: "exact + near-form enumerated worldwide" }];
  const F = [{ ordinal: 1, mark: "ZED", composite: 3, level: "B", dispute_type: "classic", meters: {}, owner: { name: "Z", registrations: [{ uri: "https://tm.example/mark/us/1", jurisdiction: "US" }] }, source: { source_type: "register-vendor" } }];
  const html = renderHtml(parsedOf(FM), F, coverage, { runId: "b" });
  assert.match(html, /class="jchip"[^>]*>WO<\/span>/, "WO shows even with no Madrid conflict — the worldwide sweep covers the WIPO register");
  assert.match(html, /national register, the EU regional register[^<]*WIPO\/Madrid/, "the honest per-source coverage note renders");
  // a Madrid record (jurisdiction INT / uri /mark/int/) normalizes to WO, never a raw 'INT' chip
  const madrid = [{ ...F[0], owner: { name: "Z", registrations: [{ uri: "https://tm.example/mark/int/878545", jurisdiction: "INT" }] } }];
  const h2 = renderHtml(parsedOf(FM), madrid, coverage, { runId: "b2" });
  assert.ok(!/class="jchip"[^>]*>INT</.test(h2), "a Madrid record never chips as raw 'INT'");
  assert.match(h2, /class="jchip"[^>]*>WO</, "it normalizes to the WO (WIPO/Madrid) register");
  // a targeted (non-worldwide) run does NOT get a forced WO chip
  const targeted = renderHtml(parsedOf(FM), F, [{ area: "register / US", state: "confirmed-clean", note: "" }], { runId: "b3" });
  assert.ok(!/class="jchip"[^>]*>WO</.test(targeted), "WO is not forced onto a targeted (non-worldwide) run");
});

// ---- WP-56 B2: the standing mark-itself section (typed mark_assessment → top-of-report render) ----
test("WP-56 B2: mark_assessment renders 'The mark itself' between the hero and the conflict landscape on BOTH variants; absent → no section; content escaped", () => {
  const ma = {
    distinctiveness: "Coined and strong in the filed classes; the dominant element is MATCHDAY.",
    connotation: "Reads clean in English; no adverse readings across the es/zh sweeps <script>.",
  };
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo", markAssessment: ma });
  assert.match(html, /<h2>The mark itself<\/h2>/);
  assert.match(html, /class="markassess"/);
  assert.match(html, /<strong>Distinctiveness\.<\/strong>/);
  assert.match(html, /<strong>Connotation &amp; meaning\.<\/strong>/);
  assert.ok(html.indexOf("</header>") < html.indexOf("The mark itself"), "sits below the hero/verdict block");
  assert.ok(html.indexOf("The mark itself") < html.indexOf("The conflict landscape"), "sits above the conflict landscape (decision 2: TOP, not a bottom panel)");
  assert.match(html, /no adverse readings across the es\/zh sweeps &lt;script&gt;/, "lawyer prose is escaped, never raw HTML");
  const client = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo", client: true, markAssessment: ma });
  assert.match(client, /<h2>The mark itself<\/h2>/, "the client export carries the standing section too");
  const none = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.doesNotMatch(none, /The mark itself/, "legacy runs (no mark_assessment) render without the section — nothing shifts");
});

// ---- spec 64: one risk statement + sentence-cased leads + advisory-tag filtering + code-lane impact ----
import { actYouConditions } from "../publish/render.mjs";

test("spec 64: the hero speaks THE one risk statement labelled 'Verdict' when the sidecar carries it", () => {
  const vi = { verdict: "CONDITIONAL", tier: "MEDIUM", badge: "l3", gaugeIndex: 2, maxComposite: 3,
    statement: "MEDIUM — conditional on: Obtain consent from Matchday, Inc. before filing." };
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo", verdictInfo: vi });
  assert.match(html, /<span class="gk">Verdict<\/span>/);
  assert.match(html, /MEDIUM — conditional on: Obtain consent from Matchday, Inc\. before filing\./);
  const legacy = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo",
    verdictInfo: { verdict: "CLEAR", tier: "MEDIUM", badge: "l3", gaugeIndex: 2, maxComposite: 3 } });
  assert.match(legacy, /<span class="gk">Recommendation<\/span>/, "no statement ⇒ today's label, byte-identical path");
});

test("spec 64: a lowercase model-authored one-liner renders sentence-cased (archived cards repaired at render)", () => {
  const cards = [
    "# Marks",
    "## Matchday, Inc.", "- one: the legal risk is a near-identical holder — coexistence terms are not yet in hand.",
    "### The read", "Read.",
  ].join("\n");
  const html = renderHtml(parsedOf(`${FM}\n${cards}`), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.match(html, /The legal risk is a near-identical holder — coexistence terms are not yet in hand\./);
  assert.doesNotMatch(html, /<div class="oneline">the legal risk/);
});

test("spec 64: actYouConditions skips code-tagged advisory items — an open question never reads as 'subject to'", () => {
  const you = { label: "Only you can close these", body: [
    "- **[Time-critical]** Respond to the CH opposition. (due by 2026-07-13)",
    "- Obtain consent from Matchday, Inc. before filing.",
    "- **[Open question]** Confirm the older filing is your own.",
    "- **[Your decision]** Decide the coexistence posture.",
    "- **[Monitor]** Watch the pending application.",
  ].join("\n") };
  const conds = actYouConditions(you);
  assert.equal(conds.length, 2, "only the two genuine conditions survive");
  assert.ok(conds.some((c) => /Respond to the CH opposition/.test(c)));
  assert.ok(conds.some((c) => /Obtain consent from Matchday/.test(c)));
});

// doc-54, RE-POINTED (2026-07-31). This assertion was written against the hero's "Subject to:" bound
// line, which B1 deleted as a third copy of the conditions. The BEHAVIOUR it pinned did not go with it:
// the tag strip, the sentence head and the no-ellipsis cap all live in actYouConditions, which is now
// read by the email composer's conditions row instead. Deleting the test left that strip unasserted —
// and '[Time-critical]' leaking onto a client-facing line is precisely the regression doc-54 exists for.
// The bound line's "and N more" teaser has no successor and needs none: the email lists every condition,
// so the promise it stood for ("the 5th condition is pointed at, not silently dropped") is now literal.
test("doc-54: '[Time-critical]' never reaches a delivered conditions line, and no condition is silently dropped", () => {
  const you = { label: "Only you can close these", body: [
    "- **[Time-critical] Identify the publisher of The Unbeatable Path** — storefront silence.",
    "- Confirm the classes you will actually file.",
    "- Decide the launch jurisdictions list now.",
    "- Obtain consent from Matchday, Inc. before filing.",
    "- Resolve the CH opposition before launch.",
  ].join("\n") };
  const conds = actYouConditions(you);
  assert.equal(conds.length, 5, "every condition survives — the 5th is not silently dropped");
  assert.ok(conds.every((c) => !/\[Time-critical\]/.test(c)), "the tag is stripped even when authored inside '**…**'");
  assert.ok(conds.every((c) => !/…/.test(c)), "no ellipsis truncation on any condition");
  // RE-POINTED AGAIN (, 2026-08-10). This read `/^Identify the publisher of The Unbeatable Path$/`
  // — the bold lead ALONE was the head, and the clause after it was dropped. That was one of three
  // cuts in this function and the owner ruled all three out: the box renders the ask as authored. The
  // doc-54 property is untouched and is what this test is for — the tag never reaches a client line,
  // the markdown never reaches a client line, and no condition is silently dropped.
  assert.equal(conds[0], "Identify the publisher of The Unbeatable Path — storefront silence.",
    "the ask renders as written: tag-free, unmarked-down, and not shortened to its first clause");
  assert.ok(conds.every((c) => !/\*\*/.test(c)), "no markdown survives onto a client line");
  assert.equal(conds[3], "Obtain consent from Matchday, Inc. before filing.",
    "THE DEFECT #601 CLOSED: this line was delivered as 'Obtain consent from Matchday, Inc'");
});

test("spec 64: §3 renders the advisory tags as chips (Open question / Your decision / Monitor)", () => {
  const md = `${FM}\n# Actions\n### Only you can close these\n- **[Time-critical]** Respond to the CH opposition.\n- **[Open question]** Confirm the older filing is your own.\n\n${CARDS}`;
  const html = renderHtml(parsedOf(md), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.match(html, />Open question<\/span>/);
  assert.match(html, />Time-critical<\/span>/);
  assert.doesNotMatch(html, /\[Open question\]/, "the raw tag never leaks");
});

test("spec 64: f.impact renders as a code-built 'If enforced' bullet (structured-only cards included)", () => {
  const withImpact = FINDINGS.map((f) => f.ordinal === 1 ? { ...f, impact: "an injunction would halt the shipped stock" } : f);
  const html = renderHtml(parsedOf(REPORT), withImpact, COVERAGE, { runId: "noref-demo" });
  assert.match(html, /<b>If enforced:<\/b> an injunction would halt the shipped stock — for the client to consider\./);
});

// ── spec 62: per-project disclosure — the project line (both surfaces) + the origin table (internal-only) ──
test("spec 62: 'Run under project' + the configuration-provenance table render on the one report; serve-time removal is portal-report's", () => {
  const originsJson = JSON.stringify([
    { field: "Marketplaces", value: "9 stores + web", origin: "project" },
    { field: "Default classes", value: "9, 28, 41", origin: "project" },
    { field: "Delivery format", value: "summary", origin: "customer" },
  ]);
  const fmProj = [
    "---", "type: prelim-clearance", "matter: noref-demo", "title: THIS IS MY MATCHDAY",
    "overall_label: MEDIUM", "overall_badge: l3", "overall_caption: medium overall.",
    "classes: 5 · 32 · 41", "jurisdiction: United States only", "run: 2026-06-10",
    "run_under_project: Console ecosystem (Aurora Interactive)",
    `origins_json: ${originsJson}`,
    "---", "",
  ].join("\n");
  const report = `${fmProj}\n${CARDS}`;

  const internal = renderHtml(parsedOf(report), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.match(internal, /Run under project: <span class="mono">Console ecosystem \(Aurora Interactive\)<\/span>/, "project line on the internal footer");
  assert.match(internal, /Configuration provenance \(internal\)/, "the origin table renders internally");
  assert.match(internal, /Marketplaces/, "an origin row renders (effective + set-by)");

  // ONE report (spec 2026-07-30 §5): the origin table rides the document (class scoperead/origins);
  // portal-report.mjs strips those elements for EVERY embedded reader at serve time — one place,
  // tested there. A stale opts.client is inert here.
  const stale = renderHtml(parsedOf(report), FINDINGS, COVERAGE, { client: true, runId: "noref-demo" });
  assert.equal(stale, internal, "opts.client no longer forks the provenance table");
});

// ── 404-card caveat (2026-07-22): a closure-fetch-FAILED citation gets ONE code-owned unverified line ──
test("404-card caveat: a _recordFetchFailure finding carries the deterministic caveat line; unstamped findings do not", () => {
  const stamped = FINDINGS.map((f, i) => i === 1
    ? { ...f, _recordFetchFailure: { uris: ["/mark/us/90333444"], cause: "provider returned 404 (record gone)" } }
    : f);
  const internal = renderHtml(parsedOf(REPORT), stamped, COVERAGE, { runId: "noref-demo" });
  assert.match(internal, /Official register record could not be retrieved \(provider returned 404 \(record gone\)\)<\/b> — registry details in this card are unverified\./,
    "the code-owned caveat line renders with its mechanical cause");
  const stale = renderHtml(parsedOf(REPORT), stamped, COVERAGE, { client: true, runId: "noref-demo" });
  assert.equal(stale, internal, "opts.client is inert — every reader sees the caveat on the one report");
  const clean = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.doesNotMatch(clean, /Official register record could not be retrieved/, "no stamp (legacy/joined runs) ⇒ no line — byte-identical legacy render");
});

// ── the report names ONE product, and it is the resolver's ────────────────────────────────────
// Before this, the hero composed `${opts.stageLabel} — Preliminary Clearance`: a rung on a retired ladder
// joined to a literal. A Global preliminary search therefore printed "Global preliminary search —
// Preliminary Clearance" — one page, two names — and a run at a retired level printed "Depth 4 —".
// The renderer now prints `opts.productName` and composes nothing.
test("the hero names the product the run resolved to — one name, no rung, and silence when there is none", () => {
  const parsed = { fm: { title: "AquaPlus", matter: "TMP1", overall_label: "MEDIUM" }, secs: {} };

  // — with no delivery overlay the posture is the DEFAULT line, so the label composes it with the
  // product. 's guarantee is unchanged and is what is asserted: ONE product name, and it is the
  // resolver's. The product's own assertions are scoped to the conf label so they cannot pass on some
  // other mention elsewhere in the document.
  const confLabel = (html) => html.match(/<div class="conf">.*?<span class="label">(.*?)<\/span>/)[1];

  const live = renderHtml(parsed, [], [], { runId: "r", productName: "Full country search" });
  assert.equal(confLabel(live), "Privileged &amp; Confidential · Full country search",
    "the product is named where the reader meets it, beside the default posture");
  assert.doesNotMatch(live, /Preliminary Clearance/, "the hardcoded second name is gone from the whole document");

  // A RETIRED row still renders honestly: reportIdentityFor gives it its own registry name, and that is
  // what prints. What must NOT print is its stageLabel, which is a depth number.
  const retired = renderHtml(parsed, [], [], { runId: "r", productName: "Preliminary clearance" });
  assert.equal(confLabel(retired), "Privileged &amp; Confidential · Preliminary clearance");
  assert.doesNotMatch(retired, /Depth \d/, "no depth number reaches a client surface");

  // stageLabel is DELETED as a render input. Passing one must change nothing — if this ever fails, the
  // rung has grown a way back onto the page.
  assert.equal(
    renderHtml(parsed, [], [], { runId: "r", productName: "Full country search", stageLabel: "Depth 5" }),
    live,
    "opts.stageLabel is not a render input any more",
  );

  // No resolvable product (no policy sidecar, or a level the registry has forgotten) ⇒ NO claim about the
  // product. — the row itself now survives on the DEFAULT posture, because absent delivery is no
  // opinion rather than a refusal; what must never appear is an invented product name.
  const nameless = renderHtml(parsed, [], [], { runId: "r" });
  assert.equal(confLabel(nameless), "Privileged &amp; Confidential", "the posture stands alone, no dangling separator");
  assert.doesNotMatch(nameless, /Preliminary Clearance/);
  // The row DOES still go when nothing at all has anything to say — an explicit off with no product.
  const silentBoth = renderHtml(parsed, [], [], { runId: "r", delivery: { privileged: false } });
  assert.doesNotMatch(silentBoth, /class="conf"/, "the whole row goes when it has nothing to say");

  // The posture composes with the product rather than being replaced by it — and survives alone when
  // there is no product to name. ( dropped the extended wording, so the composed string is the
  // plain line either way; what this pins is the COMPOSITION and the absence of a dangling separator.)
  const priv = renderHtml(parsed, [], [], { runId: "r", productName: "Full country search", delivery: { privileged: true } });
  assert.match(priv, /Privileged &amp; Confidential · Full country search/);
  assert.doesNotMatch(priv, /Attorney Work Product/);
  const privNameless = renderHtml(parsed, [], [], { runId: "r", delivery: { privileged: true } });
  assert.match(privNameless, /<span class="label">Privileged &amp; Confidential<\/span>/,
    "no dangling separator when the product is unknown");
});

// ── P4 (spec 2026-07-30 §3): structured mark-itself render, depth strip, famous-mark absorption,
//    and the ruled-out fallback heuristic that was hiding chart points ─────────────────────────────

test("spec 2026-07-30 §3: structured mark_assessment renders the `read` sentence and collapses the typed rows behind toggles", () => {
  const ma = {
    distinctiveness: {
      read: "A weak name to own. SLUSH is simply what the product is, so the whole mark rests on TIKI.",
      spectrum: "descriptive-leaning suggestive",
      per_class: [{ class: "5", note: "descriptive for supplements" }, { class: "32", note: "suggestive for drinks" }],
      per_market: [{ market: "CN", note: "descriptive once translated" }],
      counter_registrations: [{ mark: "OWN MARK", uri: "/mark/us/1", note: "the client's own prior filing" }],
    },
    connotation: "Reads as a Polynesian carving; no adverse readings surfaced.",
  };
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "ma-demo", markAssessment: ma });
  assert.match(html, /<h2>The mark itself<\/h2>/);
  assert.match(html, /A weak name to own\. SLUSH is simply what the product is/, "the read leads");
  assert.match(html, /<details class="ma-more"><summary>By class and market \(3\)<\/summary>/, "per-class + per-market rows collapse behind one toggle");
  assert.match(html, /<details class="ma-more"><summary>Registrations considered \(1\)<\/summary>/, "counter_registrations KEPT, collapsed (spec §10)");
  assert.match(html, /<b>Class 5\.<\/b> descriptive for supplements/);
  assert.match(html, /<b>CN\.<\/b> descriptive once translated/);
  assert.match(html, /<b>OWN MARK<\/b>/);
  const visible = html.slice(html.indexOf('class="markassess"'), html.indexOf('class="ma-more"'));
  assert.doesNotMatch(visible, /descriptive for supplements/, "row detail is NOT in the visible prose");
  // no `read` on an archived structured object → the short spectrum/note fallback, never the projected wall
  const legacyStructured = { distinctiveness: { spectrum: "suggestive", per_class: ma.distinctiveness.per_class }, connotation: "clean" };
  const h2 = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "ma-demo", markAssessment: legacyStructured });
  assert.match(h2, /<strong>Distinctiveness\.<\/strong> Suggestive\./);
  assert.doesNotMatch(h2, /By class: Class 5/, "the projectAssessmentField wall-paragraph never renders here");
  // legacy two-string form renders byte-identically to the pre-P4 shape
  const legacy = { distinctiveness: "Coined and strong.", connotation: "Clean." };
  const h3 = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "ma-demo", markAssessment: legacy });
  assert.match(h3, /<strong>Distinctiveness\.<\/strong> Coined and strong\./);
  assert.doesNotMatch(h3, /class="ma-more"/, "string runs have no toggles — unchanged");
});

test("charter ruling 1: opts.depthNote renders as a NAME-LED masthead depth strip; absent (archived) ⇒ no strip", () => {
  const note = "Preliminary clearance — covers registered rights and unregistered (common-law) use; the dedicated per-jurisdiction native-script deep dive is not part of this depth.";
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "d", stageLabel: "Depth 4", depthNote: note });
  assert.match(html, /<div class="depth-strip">/);
  // name-led (the pill name), bolded ahead of the coverage clauses
  assert.match(html, /<div class="depth-strip"><b>Preliminary clearance<\/b> — covers registered rights and unregistered \(common-law\) use/);
  assert.ok(html.indexOf('<div class="depth-strip">') < html.indexOf('class="mark"'), "the strip sits in the masthead, above the mark");
  // a nameless note (retired-level degradation) renders whole, unbolded — never an invented name
  const plain = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "d", depthNote: "This depth covers registered rights." });
  assert.match(plain, /<div class="depth-strip">This depth covers registered rights\.<\/div>/);
  const bare = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "d" });
  assert.doesNotMatch(bare, /<div class="depth-strip">/, "no sidecar ⇒ no strip ⇒ archived runs render as before");
});

test("§L: disposition mode absorbs the famous-mark notes into 03 Notable but manageable (out of Scope)", () => {
  const ctx = { type: "famous-neighbour-ungrounded", mark: "CHROME", owner: "Google LLC", context: "famous neighbour; no fetched record; off-field" };
  const html = renderHtml(parsedOf(FM_NOVAPULSE), DISP_FINDINGS, [], { runId: "fm-demo", contextNotes: [ctx] });
  assert.match(html, /<p class="fold-lead"><b>Famous-mark neighbours\.<\/b>/, "the famous-mark lead-in renders inside 03");
  assert.doesNotMatch(html, /<h2>Famous-mark neighbours noted<\/h2>/, "the standalone heading is gone in disposition mode");
  const i03 = html.indexOf("Notable but manageable"), iCHROME = html.indexOf("CHROME");
  assert.ok(i03 >= 0 && i03 < iCHROME, "the note renders under 03");
  const scope = html.slice(html.indexOf('<details class="scope">'));
  assert.doesNotMatch(scope, /CHROME/, "and NOT inside Scope any more");
});

test("§L: a same-element mark (token containment ≥4 chars) is NEVER silently ruled out — every numbered finding plots", () => {
  // FREEZEIV shares the FREEZE element of CORAL FREEZE but equals no token — the old equality check routed
  // it to "Also considered — ruled out" and off the conflict-landscape chart (a numbering gap).
  const FM_TIKI = FM.replace("THIS IS MY MATCHDAY", "CORAL FREEZE");
  const F = [
    { ordinal: 1, mark: "CORAL", owner: dreg("US", "/mark/us/1"), composite: 3, level: "C", dispute_type: "classic", disposition: "adversarial", meters: DMETERS, quadrant: { x: 0.8, y: 0.9 }, source: { source_type: "register-vendor" } },
    { ordinal: 2, mark: "FREEZEIV", owner: dreg("US", "/mark/us/2"), composite: 2, level: "B", dispute_type: "nuisance-claim", disposition: "off-field", meters: DMETERS, quadrant: { x: 0.9, y: 0.25 }, source: { source_type: "register-vendor" } },
    { ordinal: 3, mark: "UNTAMED", owner: dreg("US", "/mark/us/3"), composite: 2, level: "B", dispute_type: "nuisance-claim", disposition: "off-field", meters: DMETERS, quadrant: { x: 0.2, y: 0.1 }, source: { source_type: "register-vendor" } },
  ];
  const html = renderHtml(parsedOf(FM_TIKI), F, [], { runId: "plot-demo" });
  const svg = html.slice(html.indexOf("<svg viewBox"), html.indexOf("</svg>"));
  assert.match(svg, /href="#c2"/, "FREEZEIV plots on the landscape");
  assert.equal(bandOfCard(html, 2), "Notable but manageable", "and renders in the absorbed awareness band, not the ruled-out list");
  // the genuinely word-free neighbour still routes to the quiet list, with its ordinal accounted for
  assert.doesNotMatch(svg, /href="#c3"/, "UNTAMED stays off the chart");
  assert.match(html, /Also considered — ruled out/);
  assert.match(html, /<b>#3 UNTAMED<\/b>/, "the ruled-out ordinal stays accounted for");
});

// ── P5 (charter 2026-07-30, Reviewer §L) — content model on the render ──────────────────────────────────

const P5_BANDED = [
  { ordinal: 1, mark: "MATCHDAY", disposition: "adversarial", band: "High",
    legal_position: "Near-identical mark over identical class-41 services — a high legal read.",
    practical_position: "Owner actively enforces; two oppositions in the last three years.",
    owner: { name: "Matchday, Inc.", country: "US", registrations: [{ uri: "https://tm.example/us/3396572", classes: ["41"], jurisdiction: "US" }] },
    meters: { mark_similarity: meter("high"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("medium", "inferred-from-signal") },
    quadrant: { x: 0.72, y: 0.55 }, source: { source_type: "register-vendor", resolved_link: "https://tm.example/us/3396572" } },
  { ordinal: 2, mark: "MATCH DAY", disposition: "coexistence-partner", band: "Manageable",
    legal_position: "Same element, but a documented coexistence stands on the record.",
    practical_position: "The retailer listing was delisted in 2024; no visible revenue.",
    manageable: { category: "commercial-partner", reason: "a client partner — the coexistence is the client's own arrangement" },
    owner: { name: "MAN Sports", country: "US", registrations: [{ uri: "https://tm.example/us/8036850", classes: ["41"], jurisdiction: "US" }] },
    meters: { mark_similarity: meter("high"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("low", "inferred-from-signal") },
    quadrant: { x: 0.9, y: 0.8 }, source: { source_type: "register-vendor", resolved_link: "https://tm.example/us/8036850" } },
];

test("P5: legal_position / practical_position render as separated labelled reads on full AND compact cards", () => {
  const html = renderHtml(parsedOf(REPORT), P5_BANDED, COVERAGE, { runId: "noref-demo" });
  assert.match(html, /Legal risk\.<\/b> Near-identical mark over identical class-41 services/);
  assert.match(html, /Practical position\.<\/b> Owner actively enforces/);
  // the compact (band-2) card carries its split too
  assert.match(html, /Legal risk\.<\/b> Same element, but a documented coexistence/);
  assert.match(html, /Practical position\.<\/b> The retailer listing was delisted/);
});

test("P5: the manageable category + reason render on the notable-but-manageable card; absence renders nothing", () => {
  const html = renderHtml(parsedOf(REPORT), P5_BANDED, COVERAGE, { runId: "noref-demo" });
  assert.match(html, /Commercial partner\.<\/b> a client partner — the coexistence is the client's own arrangement/);
  const bare = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  assert.ok(!bare.includes('class="lp-split"'), "legacy findings must render no lp-split block");
});

test("P5: the four-answers panel renders in the hero from opts.fourAnswers; absent (archived) renders nothing", () => {
  const fourAnswers = {
    third_party_rights: { read: "Strong senior rights block the core class.", token: "strong", basis: "findings 1-2", ordinals: [1] },
    objection_likelihood: { read: "An objection is likely.", token: "likely" },
    registrability: { read: "The descriptive element carries no exclusive rights of its own.", token: "registrable-with-conditions", obstacles: [{ class: "41", note: "the office holds the element descriptive for these services" }] },
  };
  const html = renderHtml(parsedOf(REPORT), P5_BANDED, COVERAGE, { runId: "noref-demo", fourAnswers });
  assert.match(html, /The four answers/);
  assert.match(html, /Third-party rights/);
  assert.match(html, /fa-token">Strong<\/span> — Strong senior rights block the core class\./);
  assert.match(html, /Likelihood of objection/);
  assert.match(html, /fa-ords"><a href="#c1">#1<\/a>/);
  assert.match(html, /Class 41\.<\/b> the office holds the element descriptive for these services/);
  // the omitted fourth answer renders no row; the panel never fakes it
  assert.ok(!html.includes("Your own enforceability"));
  const bare = renderHtml(parsedOf(REPORT), P5_BANDED, COVERAGE, { runId: "noref-demo" });
  assert.ok(!bare.includes("The four answers"), "absent fourAnswers must render no panel");
  // both variants carry it (one report)
  const client = renderHtml(parsedOf(REPORT), P5_BANDED, COVERAGE, { runId: "noref-demo", client: true, fourAnswers });
  assert.match(client, /The four answers/);
});

// Review 2026-07-31 (BLOCKING): the six new P5 free-prose fields bypassed inline() — the ONE
// internal-note choke point — and rendered with bare esc(), so a ::p:: staff aside inside
// legal_position / practical_position / manageable.reason / four_answers.read / .basis /
// obstacles[].note shipped VERBATIM (marker and tail) to every reader, while report-data.json
// scrubbed the same bytes through clientText. Two surfaces, two answers.
//
// RESHAPED ON THE REBASE onto one report (/). The finding is unchanged and so is the fix —
// all six fields route through inline(). What changed underneath is WHERE the guarantee is enforced:
// this package was written against a renderer that still forked on `client`, and asserted "the client
// variant loses the tail". Main retired the CLIENT audience flag and its render fork with the
// one-report ruling, so that fork is not a thing these tests can address any more. The renderer's job
// is now what main's own ::p:: tests assert (render.test.mjs "A1 / askAi", "wp50"): the raw marker
// never survives, the tail renders [internal]-LABELLED, and a line-leading label wears the int-note
// print class. Removal for embedded readers is serve-time preparation's job and is asserted there
// (portal-report.test.mjs, "P5 four-answers/legal-practical internal tails"). The assertions that
// actually discriminate inline() from bare esc() — no raw ::p::, and the [internal] relabel — are
// kept verbatim, so these still fail on the pre-fix bytes.
const P5_TAILED = [{
  ordinal: 1, mark: "MATCHDAY", disposition: "coexistence-partner", band: "Manageable",
  legal_position: "High similarity over identical services. ::p:: STAFFONLYLEGAL",
  practical_position: "The owner looks dormant. ::p:: STAFFONLYPRACTICAL",
  manageable: { category: "commercial-partner", reason: "a client partner ::p:: STAFFONLYMANAGEABLE" },
  owner: { name: "Matchday, Inc.", country: "US", registrations: [{ uri: "https://tm.example/us/3396572", classes: ["41"], jurisdiction: "US" }] },
  meters: { mark_similarity: meter("high"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("low", "inferred-from-signal") },
  quadrant: { x: 0.72, y: 0.55 }, source: { source_type: "register-vendor", resolved_link: "https://tm.example/us/3396572" },
}];
const P5_TAILED_ANSWERS = {
  third_party_rights: { read: "Strong senior rights block the core class. ::p:: STAFFONLYREAD", token: "strong", basis: "findings 1-2 ::p:: STAFFONLYBASIS" },
  registrability: { read: "The descriptive element carries no exclusive rights.", token: "registrable-with-conditions",
    obstacles: [{ class: "41", note: "the office holds the element descriptive ::p:: STAFFONLYOBSTACLE" }] },
};
const P5_STAFF_TAGS = ["STAFFONLYLEGAL", "STAFFONLYPRACTICAL", "STAFFONLYMANAGEABLE", "STAFFONLYREAD", "STAFFONLYBASIS", "STAFFONLYOBSTACLE"];

test("P5 internal-note safety: every new free-prose field routes through the choke point — no raw marker, tails RELABELLED", () => {
  const html = renderHtml(parsedOf(REPORT), P5_TAILED, COVERAGE, { runId: "noref-demo", fourAnswers: P5_TAILED_ANSWERS });
  // BOTH of these fail on the pre-fix bytes: bare esc() renders the marker and never mints the label.
  assert.ok(!html.includes("::p::"), "the raw internal marker must never survive to any surface");
  assert.match(html, /\[internal\] STAFFONLYLEGAL/);
  assert.match(html, /\[internal\] STAFFONLYPRACTICAL/);
  assert.match(html, /\[internal\] STAFFONLYMANAGEABLE/);
  assert.match(html, /\[internal\] STAFFONLYREAD/);
  assert.match(html, /\[internal\] STAFFONLYBASIS/);
  assert.match(html, /\[internal\] STAFFONLYOBSTACLE/);
  // the PUBLIC head of each mixed field survives — labelling is not suppression
  assert.match(html, /Legal risk\.<\/b> High similarity over identical services\./);
  assert.match(html, /Practical position\.<\/b> The owner looks dormant\./);
  assert.match(html, /Commercial partner\.<\/b> a client partner/);
  assert.match(html, /Strong senior rights block the core class\./);
});

test("P5 internal-note safety: a line-leading label wears the int-note print class, on both P5 containers", () => {
  const whollyInternal = [{ ...P5_TAILED[0], legal_position: "::p:: STAFFONLYWHOLE", practical_position: "" }];
  const html = renderHtml(parsedOf(REPORT), whollyInternal, COVERAGE, { runId: "noref-demo",
    fourAnswers: { third_party_rights: { read: "::p:: STAFFONLYWHOLEREAD", token: "strong" } } });
  // the paragraph form (legal/practical, manageable) …
  assert.match(html, /<p class="lp int-note"><b>Legal risk\.<\/b> \[internal\] STAFFONLYWHOLE<\/p>/);
  // … and the four-answers ROW form. It is a <div>, which is why serve-time preparation needed a
  // div rule of its own — the class is what both the print stylesheet and the strip key on.
  assert.match(html, /<div class="fa-row int-note">/);
  assert.ok(!html.includes("::p::"));
});

// ONE report (/): `client` is a retired flag. A stale caller must get the SAME bytes — that
// is the honest statement of the retired fork, and it stops a future reader re-growing a client branch
// under the P5 fields (which is how "two client surfaces, two answers" happened in the first place).
test("P5 internal-note safety: the retired client flag is inert over the P5 fields — byte-identical", () => {
  const opts = { runId: "noref-demo", fourAnswers: P5_TAILED_ANSWERS };
  const stale = renderHtml(parsedOf(REPORT), P5_TAILED, COVERAGE, { ...opts, client: true });
  assert.equal(stale, renderHtml(parsedOf(REPORT), P5_TAILED, COVERAGE, opts));
});

test("P5 internal-note safety: doc-52 plainify runs on the new fields (engine idiom never reaches a reader surface)", () => {
  const idiom = [{ ...P5_TAILED[0], legal_position: "The mark similarity meter is high.", practical_position: "Sheet-2 placement holds." }];
  const html = renderHtml(parsedOf(REPORT), idiom, COVERAGE, { runId: "noref-demo" });
  assert.ok(!/mark_similarity|::p::/.test(html));
});

// Review 2026-07-31 (problem 8): the PR claimed an archived run renders byte-identically; the empty
// `${lpSplit(f)}${manageableLine(f)}` / `${fourAnswersPanel(...)}` expressions each sat on their own
// source line and left a whitespace-only line behind. They are now attached to the preceding element,
// so a P5-less (archived) run's card and hero carry no P5 bytes at all — asserted here, not claimed.
//
// REWROTE THE SECOND HALF, and the first two assertions are why. The seam assertion survives the
// fold move unchanged — removing `${lpSplit(f)}${manageableLine(f)}` from the card body leaves exactly
// the bytes it pinned — which makes it VACUOUS on the shape it was written for: it can no longer tell
// an empty interpolation from a deleted one. The strip-and-compare broke outright, because its lookahead
// was anchored to where the blocks used to sit. Both are re-expressed against the post- layout, and
// the property they now prove is stronger than the one they replaced: the above-fold region of a card is
// byte-identical WHETHER OR NOT the finding carries a content model, on both card shapes.
test("#470: the above-fold card is byte-identical with and without the content model — the reasoning is all below", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  // report.css (correctly NOT frozen) carries the .lp-split/.fourans/.fa-row rules — the page BODY is
  // what must be residue-free, so the inlined stylesheet is dropped before the assertion.
  const body = html.replace(/<style[\s\S]*?<\/style>/g, "");
  assert.ok(!/lp-split|fourans|fa-row/.test(body), "no P5 markup on an archived-shape run");

  // The above-fold region of a card is everything before its first <details> — the meters strip on a full
  // card, the one-liner on a compact one. Anchored on the card open tag and the first drawer, so it does
  // not encode the indentation of anything between them.
  const aboveFold = (h) => [...h.matchAll(/<div class="card[^"]*" id="c\d+">([\s\S]*?)<details/g)].map((m) => m[1]);
  const withP5 = renderHtml(parsedOf(REPORT), P5_BANDED, COVERAGE, { runId: "noref-demo" });
  const withoutP5 = renderHtml(parsedOf(REPORT), P5_BANDED.map((f) => ({ ...f, legal_position: undefined, practical_position: undefined, manageable: undefined })), COVERAGE, { runId: "noref-demo" });
  const a = aboveFold(withP5), b = aboveFold(withoutP5);
  assert.ok(a.length >= 2, `expected a full and a compact card above the fold, got ${a.length} — did the card markup change?`);
  assert.deepEqual(a, b, "a finding's positions must add NOTHING above the fold on either card shape");
  assert.ok(!a.join("").includes("lp-split"), "no legal/practical block survives above the fold");
  // The seams both cards depend on, pinned literally so a stray interpolation cannot creep back in.
  assert.match(withP5.replace(/<style[\s\S]*?<\/style>/g, ""), /<\/div>\n {8}<div class="meters">/, "full card: one-liner → meters, no blank line");
  assert.match(withP5.replace(/<style[\s\S]*?<\/style>/g, ""), /<div class="oneline">[^\n]*<\/div>\n {4}<\/div><\/div>/, "compact card: the one-liner closes the card body");

  // RELOCATION, NOT ADDITION, measured rather than claimed: strip every lp-split block from both renders
  // and the remainders are equal, so the content model still contributes exactly those blocks and not one
  // byte more — it has simply stopped contributing them above the fold. (`.lp-split` wraps <p> only, with
  // no nested <div>, so the non-greedy match to the first </div> is exact.)
  const LP = /<div class="lp-split">.*?<\/div>/gs;
  assert.equal(withP5.replace(LP, ""), withoutP5.replace(LP, ""),
    "the legal/practical + manageable blocks are the ONLY bytes the content model adds to a report");
  assert.equal((withP5.match(LP) ?? []).length, 3, "two positions blocks + one manageable block, all inside the drawers");
  for (const block of withP5.match(LP) ?? []) {
    const at = withP5.indexOf(block);
    const drawer = withP5.lastIndexOf('<div class="drillbody">', at);
    assert.ok(drawer > 0 && withP5.slice(drawer, at).indexOf("</details>") === -1, "every lp-split block sits inside a drillbody");
  }
});

// — THE CAP IS GONE, and this is the test that has to stop it coming back "just in case". Until
// 2026-08-06 render.mjs cut the one-clause net at 240 characters. The word-boundary arm at least marked
// the cut with an ellipsis; the SENTENCE-END arm did not, so a net whose first sentence ended anywhere
// past 120 characters lost everything after it silently — measured on this fixture, the delivered card
// dropped the opposition deadline and read as though the sentence had simply ended.
const LONG_NET = "Matchday, Inc. is more likely than not to prevail against THIS IS MY MATCHDAY across the United States and the European Union on the class-41 services as filed. "
  + "The holder has opposed twice in the last three years and the opposition window closes in March.";
test("#470: the one-clause net renders VERBATIM — no cap, no ellipsis, on every card shape", () => {
  assert.ok(LONG_NET.length > 240, `the fixture must exceed the retired 240-char budget (it is ${LONG_NET.length})`);
  const findings = [{ ...P5_BANDED[0], net: LONG_NET }, { ...P5_BANDED[1], net: LONG_NET }];
  const html = renderHtml(parsedOf(REPORT), findings, COVERAGE, { runId: "noref-demo" });
  const onelines = [...html.matchAll(/<div class="oneline">(.*?)<\/div>/g)].map((m) => m[1]);
  assert.equal(onelines.length, 2, "one full card and one compact card");
  for (const line of onelines) {
    assert.ok(line.includes("the opposition window closes in March"), "the tail of the sentence must survive — this is the fact the fold ate");
    assert.ok(!line.includes("…"), "no fold mark, because nothing was folded");
  }
  // and on the reasoned-negative row, which folded through the same helper
  const neg = renderHtml(parsedOf(REPORT), [P5_BANDED[0], { ...V6_NEGATIVES[2], net: LONG_NET }], COVERAGE, { runId: "noref-demo", findingsSchemaVersion: 6 });
  assert.match(neg, /class="rn-why">[^<]*the opposition window closes in March/, "the grouped negative's reason is uncut too");
});

// The half of foldClause that was NOT a cap, and had to survive its deletion: trim-to-empty. It is what
// makes the `net || card.meta.one || oneFallback` chain fall through on an archived run, whose findings
// carry no net at all — and on the file that carries the key with nothing in it, which is the case a
// naive `f.net ||` would get wrong.
test("#470: a blank or whitespace-only net falls through the fallback chain exactly as an absent one does", () => {
  const authored = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "noref-demo" });
  for (const net of [undefined, "", "   ", "\n\t "]) {
    const html = renderHtml(parsedOf(REPORT), FINDINGS.map((f) => ({ ...f, net })), COVERAGE, { runId: "noref-demo" });
    assert.equal(html, authored, `net=${JSON.stringify(net)} must render the card's own '- one:' line, byte for byte`);
  }
  assert.match(authored, /The dominant MATCHDAY holder in the filed class\./, "…which is the authored line, still reaching the reader");
});

// — the completeness half of the ruling: below the fold, nothing is ever cut. A reader who opens a
// card gets every word the pre- layout showed above it, plus the structured facts that were always
// down here, in that order — the argument first, the evidence under it.
test("#470: the positions render below the fold, complete, and lead the drawer", () => {
  const html = renderHtml(parsedOf(REPORT), P5_BANDED, COVERAGE, { runId: "noref-demo" });
  const drawer = html.slice(html.indexOf('<summary>Full detail &amp; provenance</summary>'));
  assert.match(drawer, /<div class="drillbody"><div class="lp-split"><p class="lp"><b>Legal risk\.<\/b> Near-identical mark over identical class-41 services — a high legal read\.<\/p>/,
    "the legal read opens the drawer, whole");
  assert.match(drawer, /<b>Practical position\.<\/b> Owner actively enforces; two oppositions in the last three years\./);
  assert.match(drawer, /<b>Commercial partner\.<\/b> a client partner — the coexistence is the client's own arrangement/);
  // …and the structured facts still follow them, not the other way round
  const lp = drawer.indexOf('class="lp-split"'), ul = drawer.indexOf("<ul>");
  assert.ok(lp > -1 && ul > lp, "the reasoning leads the drawer; the registration facts follow it");
});

// ── — the grouped reasoned negatives ─────────────────────────────────────────────────────────────
//
// The rendering fires on a v6 record only. Below v6 the section is assembled exactly as before, byte for
// byte, because a republish re-renders archived runs and a delivered report must not come back a
// different document — and because only v6 guarantees the typed grounds the grouping keys on.
const V6_NEGATIVES = [
  P5_BANDED[0],
  { ...P5_BANDED[1], ordinal: 2, disposition: "distinguished",
    net: "Common-law use only, confined to one US retail channel; no registration → nothing to assert on the register.",
    manageable: { category: "large-competitor", reason: "a live competitor, but the added house mark carries it apart" } },
  { ordinal: 3, mark: "MATCHDAY MOTORS", disposition: "off-field", off_field_ground: "different-field",
    net: "Class 12 vehicle servicing; the specification stops short of any class-41 service.",
    legal_position: "The registration covers vehicle maintenance; its scope does not reach the applicant's services.",
    practical_position: "A regional garage chain with no media or events presence.",
    owner: { name: "Matchday Motors Ltd", country: "GB", registrations: [{ uri: "https://tm.example/gb/9001", classes: ["12"], jurisdiction: "GB" }] },
    meters: { mark_similarity: meter("high"), goods_proximity: meter("low"), use: meter("confirmed"), enforcer: meter("low", "inferred-from-signal") },
    quadrant: { x: 0.8, y: 0.1 }, source: { source_type: "register-vendor", resolved_link: "https://tm.example/gb/9001" } },
];

test("#242: on a v6 record the reasoned negatives group by their shared ground, one line per member", () => {
  const html = renderHtml(parsedOf(REPORT), V6_NEGATIVES, COVERAGE, { runId: "noref-demo", findingsSchemaVersion: 6 });
  // the shared ground, stated ONCE per group in the heading parenthetical
  assert.match(html, /<b>Argued apart on the mark<\/b> \(distinguished on the mark itself\) — 1 mark\./);
  assert.match(html, /<b>A different commercial field<\/b> \(the same name in a different commercial field\) — 1 mark\./);
  // and one line per member carrying its OWN jurisdictions, classes and reason
  assert.match(html, /class="rn-mark">MATCHDAY MOTORS<\/span>/);
  assert.match(html, /class="rn-who">Matchday Motors Ltd<\/span>/);
  assert.match(html, /class="rn-facts">UK · Cl\.&nbsp;12<\/span>/, "jurisdictions go through the renderer's own region vocabulary (GB → UK), not the record's raw string");
  assert.match(html, /class="rn-why">Class 12 vehicle servicing; the specification stops short/);
  // the adversarial finding stays where it was — it is not a negative
  assert.ok(!/rn-mark">MATCHDAY</.test(html.split("Notable but manageable")[1] ?? ""), "band-1 conflicts never enter the negatives section");
});

test("#242: zero reasoned negatives SAYS so — an empty heading with nothing under it never renders", () => {
  const html = renderHtml(parsedOf(REPORT), [P5_BANDED[0]], COVERAGE, { runId: "noref-demo", findingsSchemaVersion: 6 });
  assert.match(html, /<b>No reasoned negatives\.<\/b> Every retrieved close match on this run is an on-field conflict/);
  assert.ok(!/class="rn-mark"/.test(html), "no member rows under a zero grouping");
  // and the distinguishing signal: a v5 record renders no such claim either way, because it never grouped
  const legacy = renderHtml(parsedOf(REPORT), [P5_BANDED[0]], COVERAGE, { runId: "noref-demo" });
  assert.ok(!/No reasoned negatives/.test(legacy), "'grouped and found none' must not be confusable with 'never grouped'");
});

test("#242: the version gate is fail-CLOSED — an absent, stale or unparseable version renders the old section", () => {
  const grouped = renderHtml(parsedOf(REPORT), V6_NEGATIVES, COVERAGE, { runId: "noref-demo", findingsSchemaVersion: 6 });
  for (const opt of [{}, { findingsSchemaVersion: 5 }, { findingsSchemaVersion: null }, { findingsSchemaVersion: "six" }]) {
    const html = renderHtml(parsedOf(REPORT), V6_NEGATIVES, COVERAGE, { runId: "noref-demo", ...opt });
    assert.ok(!/class="rn-mark"|No reasoned negatives/.test(html), `${JSON.stringify(opt)} must render the pre-#242 section`);
    assert.match(html, /Same name, a different commercial field/, "…which is the region-grouped one");
  }
  assert.notEqual(grouped, renderHtml(parsedOf(REPORT), V6_NEGATIVES, COVERAGE, { runId: "noref-demo" }));
});

test("#242: an archived (pre-v6) run renders byte-identically to its pre-change output", () => {
  // The freeze checklist asks whether a change is reachable from a REPUBLISH. It is — so the claim is
  // measured, not asserted: the whole page for a legacy-shape and a P5-shape run must carry not one byte
  // of the rendering, including in the stylesheet-stripped body seams.
  for (const set of [FINDINGS, P5_BANDED, V6_NEGATIVES]) {
    const body = renderHtml(parsedOf(REPORT), set, COVERAGE, { runId: "noref-demo" }).replace(/<style[\s\S]*?<\/style>/g, "");
    assert.ok(!/rn-mark|rn-who|rn-facts|rn-why|rgroup rn|No reasoned negatives/.test(body));
  }
});

// ──: the hero verdict caption folds to its first sentence ────────────────────────────────────────
//
// 's design ruling — "above any fold, only a statement, a labelled row, a count or a one-line card;
// prose never appears until someone opens something, and once opened nothing is ever cut". cf8dd43 moved
// the finding cards onto that rule and left the hero caption behind; PR recorded the bullet as
// still owed and routed it here.
const heroOf = (html) => html.slice(html.indexOf('<h1 class="mark"'), html.indexOf('<div class="heroGrid"'));
const capsOf = (html) => (heroOf(html).match(/<p class="sub[^"]*">([\s\S]*?)<\/p>/g) ?? [])
  .map((p) => p.replace(/<[^>]+>/g, ""));

test("#470 the hero caption folds to its first sentence, and the remainder is complete behind it", () => {
  const render = (caption) => renderHtml(
    { fm: { title: "AquaPlus", matter: "TMP1", overall_label: "MEDIUM", overall_caption: caption }, secs: {} },
    [], [], { runId: "r", productName: "Full country search" });

  const caption = "Medium overall. One owner holds a near-identical mark for the same goods and is likely "
    + "to object. No coexistence appears on the record searched.";
  const html = render(caption);

  // ABOVE THE FOLD: the first sentence, alone.
  const caps = capsOf(html);
  assert.equal(caps[0], "Medium overall.", "only the first sentence is visible");
  assert.ok(heroOf(html).includes('<details class="sub-more">'), "the remainder is behind a disclosure");

  // NOTHING IS CUT — the two halves recompose the caption exactly. This is the property puts above
  // everything else, and the one a character cap violated.
  assert.equal(caps.join(" "), caption, "the fold loses not one word");

  // A ONE-SENTENCE caption grows no disclosure and no lead class: an archived run whose caption is a
  // single sentence renders exactly as it did.
  const single = render("Cleared on the evidence searched.");
  assert.deepEqual(capsOf(single), ["Cleared on the evidence searched."]);
  assert.ok(!heroOf(single).includes("sub-more"), "no empty disclosure");
  assert.ok(!heroOf(single).includes("sub-lead"), "and no lead class — the unfolded caption keeps its spacing");

  // An absent caption renders nothing at all, as before.
  assert.deepEqual(capsOf(render("")), []);
});

test("#470 the fold point is a sentence end, not a full stop — initialisms and corporate suffixes hold", () => {
  const first = (caption) => capsOf(renderHtml(
    { fm: { title: "A", matter: "M", overall_label: "MEDIUM", overall_caption: caption }, secs: {} },
    [], [], { runId: "r" }))[0];

  // The two shapes that actually occur in this caption's voice: a territory initialism and an owner's
  // corporate suffix. Splitting on the first full stop cuts both mid-sentence.
  assert.equal(first("The U.S. holder is active. It has opposed twice."), "The U.S. holder is active.");
  assert.equal(first("Matchday, Inc. is active on the register. A challenge is realistic."),
    "Matchday, Inc. is active on the register.");
  // Terminators other than the full stop end a sentence too.
  assert.equal(first("Is it registrable? The absolute grounds are clean."), "Is it registrable?");
  assert.equal(first("Cleared on the evidence searched! Nothing further arose."), "Cleared on the evidence searched!");

  // WHY A HEURISTIC IS ACCEPTABLE HERE, pinned rather than argued: its worst failure moves the fold, and
  // the caption still recomposes whole. A cap — the thing deleted — could not make that promise.
  for (const c of ["The U.S. holder is active. It has opposed twice.", "A. B. C. D.", "No. 5 is senior. It is registered."]) {
    const caps = capsOf(renderHtml({ fm: { title: "A", matter: "M", overall_label: "MEDIUM", overall_caption: c }, secs: {} },
      [], [], { runId: "r" }));
    assert.equal(caps.join(" "), c, `nothing is cut, wherever the fold lands: ${c}`);
  }
});

// ── — THE PAGE STOPS SPEAKING ENGINE ────────────────────────────────────────────────────────────
//
// Three of the four defects in "Client prose fails the non-lawyer test" land in this renderer, and every
// one of them is the same mistake with a different word: a CODE-OWNED TOKEN reaching a client's page
// with nothing between it and the reader. None of the fixes is a filter over prose — settled that
// (`axis` -> `group` ate the mark AXIS inside the report that clears it). Each is either a closed enum
// mapped to client words at this boundary, exactly as EVIDENCE_LABEL has mapped `_status` since,
// or a field deleted from a surface.

test("#762 D5: the client risk chip is the BAND WORD — the placement key never rides on it", () => {
  const html = renderHtml(parsedOf(REPORT), BAND_FINDINGS, [], { framework: AURORA_MANIFEST, runId: "r" });
  assert.match(html, /<span class="tier[^"]*">Manageable<\/span>/, "the chip is the framework's own band word");
  assert.match(html, /<span class="tier[^"]*">Low<\/span>/);
  // THE DEFECT: "Manageable · Adversarial" on every card. `disposition` is a PLACEMENT key — stages.mjs
  // dictates that it "SETS ONLY WHERE THE CARD IS PLACED IN THE REPORT (it NEVER changes the band you set
  // above)" — so the suffix restated the section heading in the engine's spelling, and "Adversarial" reads
  // to a client as a claim about the owner rather than about where the card sits.
  assert.doesNotMatch(html, /Manageable · |Low · /, "the disposition suffix is gone from the chip");
  for (const word of ["Adversarial", "Distinguished", "Coexistence partner", "Off field"])
    assert.doesNotMatch(html, new RegExp(`class="tier[^"]*">[^<]*${word}`), `"${word}" is on a client chip`);
  // …and the section headings the disposition DOES decide are untouched: the fact is still on the page,
  // once, in the place that owns it.
  assert.match(html, /<h2>Notable but manageable<\/h2>/);
});

test("#762 D5: an UNRATED awareness finding drops the suffix too, and keeps its own words", () => {
  const unrated = [{ ...BAND_FINDINGS[0], band: null, disposition: "off-field" }];
  const html = renderHtml(parsedOf(REPORT), unrated, [], { framework: AURORA_MANIFEST, runId: "r" });
  assert.match(html, /<span class="tier[^"]*">Not rated — awareness<\/span>/);
  assert.doesNotMatch(html, /Not rated — awareness · /);
});

test("#762 D5: the INTERNAL legacy Level/Composite chip is untouched — this is the client branch only", () => {
  // The band-mode branch is the one a client reads. The composite branch below it is the reviewer
  // shorthand and keeps its own separator; narrowing the fix to the client chip is deliberate, and a
  // change here would be a different decision on a different surface.
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, {});
  assert.match(html, /<span class="lv">Level B<\/span>Composite 3 · Paper conflict/,
    "the legacy chip still carries Level/Composite and its dispute type");
});

// ── D7: the tool name leaves the page, the sentinel stays where it is enforced ───────────────────
//
// `perplexity_research — no result` is the ONLY legal "we searched and found nothing" value for
// use_check.source: stages.mjs dictates it, findings-model.mjs names it in two refusals, and
// use-check.mjs wires it into validators.narrative as FATAL. It is mapped HERE, by exact equality, and
// nowhere else — changing the sentinel would force every archived run and every check to accept two
// spellings of one enum member, over a complaint that is only ever about the page.
const NO_RESULT = "perplexity_research — no result";

test("#762 D7: the sentinel renders as client words on the finding card, and the tool name is nowhere", () => {
  const f = [{ ...FINDINGS[0], use_check: { source: NO_RESULT } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /<b>Use checked\.<\/b> Marketplace search run — no result found\./);
  assert.doesNotMatch(html, /perplexity_research/, "the raw tool name reached a client's page");
  assert.doesNotMatch(html, /perplexity/i, "…in any casing");
});

test("#762 D7: the common-law contribution list maps it too — where `new URL` used to throw", () => {
  // THE MECHANISM. The sentinel is not a URL, so `new URL(...)` threw and the catch printed
  // `host.slice(0, 40)`. The sentinel is 31 characters, so what a client read was the tool name WHOLE.
  assert.equal(NO_RESULT.length, 31, "premise: the slice truncated nothing — the leak was the full name");
  const f = [{ ...FINDINGS[0], use_check: { source: NO_RESULT } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /What the marketplace layer added to register findings/, "premise: the list renders at all");
  assert.match(html, /#1 MATCHDAY<\/a> — use Confirmed — marketplace search — no result found/);
  assert.doesNotMatch(html, /perplexity_research/);
});

test("2097 the sentinel matches on NORMALISED punctuation — the seat's hyphen renders as client words", () => {
  // The seat emitted a HYPHEN where the doctrine writes an em dash; exact equality against one spelling
  // let the raw tool name through to a delivered report, twice on one page. The constant itself does
  // not move (archived runs carry it forever) — the MATCH folds the dash class and whitespace.
  for (const variant of ["perplexity_research - no result", "perplexity_research – no result", "perplexity_research  —  no result"]) {
    const f = [{ ...FINDINGS[0], use_check: { source: variant } }];
    const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
    assert.match(html, /Marketplace search run — no result found\./, `variant not mapped: ${variant}`);
    assert.doesNotMatch(html, /perplexity/i, `the raw tool name reached the page for: ${variant}`);
  }
  // And a real source containing a hyphen is untouched — the fold is not a rule over strings.
  const real = [{ ...FINDINGS[0], use_check: { source: "https://shop.example.com/no-result-tshirts" } }];
  const html = renderHtml(parsedOf(REPORT), real, COVERAGE, {});
  assert.doesNotMatch(html, /Marketplace search run/, "a URL that merely contains similar words was substituted");
});

test("#762 D7: a real source URL is NOT touched — the map is one equality, never a rule over strings", () => {
  const f = [{ ...FINDINGS[0], use_check: { source: "https://shop.example.com/matchday-gear" } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  assert.match(html, /href="https:\/\/shop\.example\.com\/matchday-gear"/, "the cite still links the real source");
  assert.match(html, /— use Confirmed — shop\.example\.com/, "the contribution list still names the host");
  assert.doesNotMatch(html, /no result found/, "nothing was substituted into a source that had one");
});

test("#762 D4/D7: the use-source class has ONE definition, and it reads as a source phrase", () => {
  // It was declared twice with two different strings for the same closed member: fullDetail said
  // "register mirror — not evidence of use", the contribution list said "register mirror — not use
  // evidence". One vocabulary, two spellings, one page.
  const f = [{ ...FINDINGS[0], use_check: { source: "https://shop.example.com/x" },
    meters: { ...FINDINGS[0].meters,
      use: { token: "confirmed", basis: "verified-from-record", _status: "confirmed", _useSourceClass: "register-mirror" } } }];
  const html = renderHtml(parsedOf(REPORT), f, COVERAGE, {});
  const phrase = "from a register mirror, which is not evidence of use";
  assert.equal((html.match(new RegExp(phrase, "g")) ?? []).length, 2, "both print sites, one wording");
  assert.doesNotMatch(html, /not use evidence/, "the second spelling is gone");
  // — the use line prints no verification word; the source phrase stands alone.
  assert.match(html, new RegExp(`Evidence: ${phrase}`), "the cite labels the source class");
  assert.match(html, new RegExp(`\\(evidence: ${phrase}\\)`), "…and so does the contribution line");
  assert.doesNotMatch(html, /Evidence: verified, from|Evidence: not yet verified, from/, "no verification word rides the use line");
});

// ── (was D6's second candidate) — the Methodology note keeps the structure it was written in ─
//
// D6 reported a scope fragment on a delivered page beginning with a bare dash. Two mechanisms produce it.
// fixed the knockout caveats block (render-knockout.mjs). This is the clearance-side one, and the
// arm below used to PIN it open.
//
// THE DEFECT WAS NOT THE TELEMETRY, which is why the second arm here has no telemetry in it at all.
// `plainScopeNote` split the WHOLE block on /(?<=[.;])\s+/ and rejoined the survivors with a space; `\s`
// matches a newline, so every multi-line note came back as one run of sentences whether or not anything
// was dropped. Dropping a telemetry lead-in only made the wreckage visible — the first surviving bullet
// became the paragraph and the rest printed their dashes as text. It calls parse.mjs's stripTelemetry
// now, which splits per LINE first, so the two rules are one rule.
test("#832: a telemetry lead-in is dropped and the bullets it led each stand as their own item", () => {
  const meth = "Scope: 146 of 147 searches completed.\n- Japan was not searched.\n- Korea was not searched.";
  const html = renderHtml(parsedOf(`${REPORT}\n\n# Methodology\n${meth}\n`), FINDINGS, COVERAGE, {});
  const note = html.match(/<div class="methnote"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.ok(note, "premise: the Methodology note renders at all");
  assert.doesNotMatch(note, /146 of 147/, "process telemetry never renders — doc-52 CHANGE-1, unchanged");
  assert.equal((note.match(/<li>/g) ?? []).length, 2, "two authored bullets render as two");
  assert.match(note, /<li>Japan was not searched\.<\/li><li>Korea was not searched\.<\/li>/,
    "…and no dash is left printing as text inside another item");
});

test("#832: the weld never needed telemetry — a multi-line note with none keeps its lead-in AND its bullets", () => {
  const meth = "Scope note.\n- Japan was not searched.\n- Korea was not searched.";
  const html = renderHtml(parsedOf(`${REPORT}\n\n# Methodology\n${meth}\n`), FINDINGS, COVERAGE, {});
  const note = html.match(/<div class="methnote"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.equal(note, "<p>Scope note.</p><ul><li>Japan was not searched.</li><li>Korea was not searched.</li></ul>",
    "the lead-in is a paragraph and each bullet is an item — before #832 all three welded into one <p>");
});

test("#832: an ALL-telemetry note still reduces to nothing — no empty methodology block", () => {
  const meth = "Scope: 146 of 147 searches completed.\n- 12 batches ran against the mirror.";
  const html = renderHtml(parsedOf(`${REPORT}\n\n# Methodology\n${meth}\n`), FINDINGS, COVERAGE, {});
  assert.equal(html.match(/<div class="methnote"/), null,
    "every line was telemetry, so the section is absent — a note of only newlines is not a note");
  assert.doesNotMatch(html, /How this search was run/, "…and neither is its heading");
});

test("#832: the ONE-PARAGRAPH archived shape is byte-identical — this is the row every old run sits on", () => {
  const meth = "Register layer covered worldwide exact VENZY. Common-law layer covered 25 search terms. "
    + "146 of 147 searches completed.";
  const html = renderHtml(parsedOf(`${REPORT}\n\n# Methodology\n${meth}\n`), FINDINGS, COVERAGE, {});
  const note = html.match(/<div class="methnote"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.equal(note, "<p>Register layer covered worldwide exact VENZY. Common-law layer covered 25 search terms.</p>",
    "one line in, one paragraph out, telemetry clause dropped — the pre-#832 output exactly");
});

// The divergence names as the actual defect: a fix that leaves the two rules disagreeing has only
// moved it. They agree because there is now ONE rule — this arm is what would notice a second copy
// growing back in the renderer.
test("#832: plainScopeNote and stripTelemetry answer the same input the same way", async () => {
  const { stripTelemetry } = await import("../publish/parse.mjs");
  for (const meth of [
    "Scope: 146 of 147 searches completed.\n- Japan was not searched.\n- Korea was not searched.",
    "Scope note.\n- Japan was not searched.",
    "One paragraph with 146 of 147 searches completed inside it. And a real clause.",
    "First paragraph stands alone.\n\nSecond paragraph stands alone.",
  ]) {
    const html = renderHtml(parsedOf(`${REPORT}\n\n# Methodology\n${meth}\n`), FINDINGS, COVERAGE, {});
    const rendered = html.match(/<div class="methnote"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const expected = stripTelemetry(meth).trim();
    // renderProse is markup, so compare the TEXT the renderer kept against the text the sibling rule keeps.
    const text = rendered.replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, "").trim();
    assert.equal(text.replace(/\s+/g, " "), expected.replace(/^- /gm, "").replace(/\s+/g, " "),
      `the two rules disagree on:\n${meth}`);
  }
});

// ── — NO EXTERNAL LINK IS TARGETLESS, AS AN INVARIANT RATHER THAN PER EMITTER ──────────────────
//
// Counsel reported two symptoms in delivered reports viewed in the portal: links that open in the
// report's own window and fail, and links that render but do nothing when clicked. Both are the
// sandbox. The frame carries no `allow-same-origin` — deliberate, and it stays, because that is what
// retires the stored-XSS class for every report ever delivered. Inside it a targetless anchor
// navigates the FRAME, where a portal-relative href cannot resolve.
//
// The individual assertions above already pin several emitters one at a time. That is what let a new
// emitter arrive without one: this file grew a check per link rather than a rule about links. The test
// below is the rule — over the rendered document, every `https?://` anchor carries `target="_blank"`,
// whoever emitted it and whenever it was added.
//
// AND THE OTHER DIRECTION, because an over-eager fix would break navigation: in-page ordinal anchors
// (`#c3`) must STAY targetless. They are how a reader moves inside the report, and a `_blank` on one
// opens a second copy of the document instead of scrolling.
const externalAnchorsWithoutTarget = (html) =>
  [...String(html).matchAll(/<a\s[^>]*>/gi)].map((m) => m[0])
    .filter((a) => /href="https?:\/\//i.test(a) && !/target="_blank"/i.test(a));

test("#705 every EXTERNAL anchor in a rendered report opens in a new tab", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "link-invariant" });
  const external = [...html.matchAll(/<a\s[^>]*>/gi)].map((m) => m[0]).filter((a) => /href="https?:\/\//i.test(a));
  assert.ok(external.length >= 3,
    `the fixture must actually emit external links, or this test asserts nothing — found ${external.length}`);
  assert.deepEqual(externalAnchorsWithoutTarget(html), [],
    "an external link without target=_blank is silently discarded inside the report sandbox");
  for (const a of external)
    assert.match(a, /rel="noopener/, "and every one of them fences window.opener");
});

test("#705 IN-PAGE ordinal anchors stay targetless — the other direction", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "link-invariant" });
  const inPage = [...html.matchAll(/<a\s[^>]*href="#[^"]*"[^>]*>/gi)].map((m) => m[0]);
  for (const a of inPage)
    assert.ok(!/target="_blank"/i.test(a),
      `an in-page anchor with _blank opens a second copy of the report instead of scrolling: ${a.slice(0, 90)}`);
});

test("#705 the chrome home link leaves the FRAME, not just the report", () => {
  // Targetless it navigated the iframe, where a portal-relative href cannot resolve — counsel's
  // symptom 1. The sandbox carries allow-popups and NOT allow-top-navigation, so a new tab is the
  // option that works without widening the boundary the report is held behind.
  const btn = homeButton("/clearances");
  assert.match(btn, /target="_blank"/);
  assert.match(btn, /rel="noopener"/);
  assert.equal(homeButton(""), "", "and no href still emits nothing");
});

// ── — a citation label is not a URL, and must never sit in a link's destination slot ─────────
// The producer fix (85aa7d30) was DOCTRINE: delivery-contract.md's "Checks we ran" section gained the
// arm it was missing — a source that is a SEARCH has no URL and is cited as plain text. Doctrine
// changes what a seat WRITES, and nothing asserted what the renderer DOES with the shape that already
// shipped. That is this instrument. It is a direct call on the render path, not a read of the
// dictation file: a test that the file contains the sentence would pass on the sentence and prove
// nothing about a rendered report.
//
// The shape is the one the engine emitted, from mcp-server/test/fixtures/report.internal.md — a
// markdown link whose destination is the citation label, with the search's own parentheses nested
// inside it. The query text is neutral here; the load-bearing bytes are the tool name in the
// destination slot and the nested parens, and the client identifier on the real line is deliberately
// not copied into the product tree.
const CITE_AS_DEST = "([perplexity_research pro-search](perplexity_research (pro-search): reference price list, drug index))";
const CITE_AS_URL = "([registry.example/record-4471](https://registry.example/record-4471))";

const citeCards = (body) => [
  "# Marks",
  "## Matchday, Inc.", "- one: The dominant MATCHDAY holder in the filed class.",
  "### The read", body,
  "## MAN Sports", "- one: Identical anchor on core supplement goods.",
  "### The read", "Common-law only; descriptiveness defence weakens it.",
].join("\n");
const citeHtml = (body) => renderHtml(parsedOf(`${FM}\n${citeCards(body)}`), FINDINGS, COVERAGE, { runId: "noref-cite" });

test("#875 a citation label in the destination slot renders as TEXT, never as a link destination", () => {
  const html = citeHtml(`Confirmed in active market use ${CITE_AS_DEST}.`);
  // The claim, stated as the thing a client would actually be handed: no anchor anywhere in the
  // report points at the citation label. Asserting on `href="perplexity_research` rather than on the
  // absence of the string keeps the label itself free to appear — as text, which is the fix.
  assert.doesNotMatch(html, /href="[^"]*perplexity_research/,
    "a relative href of `perplexity_research` resolves to nothing in a report a client opens");
  assert.doesNotMatch(html, /<a\b[^>]*>\s*perplexity_research pro-search\s*<\/a>/,
    "and it is not an anchor by any other route either");
  assert.match(html, /perplexity_research pro-search/,
    "the citation is still THERE — refusing to link it must not delete it, or the report loses the source");
});

test("#875 a real URL on the same surface still becomes a link — the check is not vacuous", () => {
  // Without this, the assertion above would pass on a renderer that had stopped emitting anchors at
  // all, which is the failure mode a negative-only test cannot see.
  const html = citeHtml(`Listed on the register ${CITE_AS_URL}.`);
  assert.match(html, /<a href="https:\/\/registry\.example\/record-4471"[^>]*>registry\.example\/record-4471<\/a>/,
    "a source that IS a page is linked, and the anchor carries the real http(s) destination");
});

test("#875 no destination that is not http(s), mailto: or a fragment ever reaches an href", () => {
  // The rule generalised. Each of these is a destination slot holding something that is not a URL —
  // the citation-label case is the first row, and the rest are the neighbours it shares a bug with.
  const NOT_URLS = [
    ["a citation label", "perplexity_research (pro-search): reference price list"],
    ["a bare tool name", "perplexity_research"],
    ["a relative path", "../records/4471"],
    ["a scheme that executes", "javascript:alert(1)"],
    ["a data payload", "data:text/html,<b>x</b>"],
  ];
  for (const [what, dest] of NOT_URLS) {
    const html = citeHtml(`Source ([the label](${dest})).`);
    assert.doesNotMatch(html, /<a href="(?!https?:\/\/|mailto:|#)/,
      `${what} reached an href — a destination that is not a URL must render as its label`);
    assert.match(html, /the label/, `${what}: the label itself must survive as text`);
  }
});

// ── — A RUN THAT MEASURED NO COVERAGE SAYS SO, AND NEVER GOES SILENT ────────────────────────
//
// `if (coverage.length)` dropped the whole section on a zero-row run. Not "we covered nothing", not an
// empty grid — no heading, no marker, nothing. The reader with the least context lost the most, and on
// the one delivered run in the pool that reaches this state the internal `Coverage read` line was
// missing too, so the report carried no coverage disclosure of any kind.
//
// PINNED IN BOTH DIRECTIONS. The populated branch must stay byte-for-byte what it was — 28 of the pool's
// 29 clearance reports go down it, and `doRepublish()` re-renders archived runs — so an arm that only
// checked the empty state would let a careless edit rewrite documents already delivered.
test("#1132 zero coverage rows render the heading and an explicit statement, never silence", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, [], { runId: "cov-none" });
  assert.match(html, /What we covered — and what's open/,
    "the section vanished on a zero-row run: a reader cannot tell a run that measured nothing from one "
    + "whose section was never reached");
  assert.match(html, /No coverage record was produced for this run/);
  assert.match(html, /not a finding that nothing is open/,
    "the empty state must not read as an all-clear — that is the one way it could be worse than silence");
});

test("#1132 the populated branch is untouched — a republish of a normal run rewrites nothing", () => {
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, { runId: "cov-rows" });
  assert.match(html, /What we covered — and what's open/);
  assert.doesNotMatch(html, /No coverage record was produced/,
    "the empty-state sentence leaked into a run that HAS coverage — every delivered report would gain it "
    + "on its next republish");
  // And the grid is really there, so "no empty-state sentence" is not passing on an empty section.
  assert.match(html, /class="cov"/, "the grid itself is missing, so the assertion above passed over an empty section");
});
