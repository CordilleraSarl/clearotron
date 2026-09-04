// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Item 9a/9b — THE ONE-CLAUSE NET, written once and rendered everywhere.
//
// It is the only ALWAYS-VISIBLE per-finding sentence: the report card leads with it, the MCP brief lists
// the finding by it. Until now each surface authored its own version of it — the card parsed a `- one:`
// line out of model markdown and the brief re-read that same line. Two surfaces separately summarising
// one finding is how they end up disagreeing about it.
//
// It stays MODEL-WRITTEN, and it must: which fact conditions the risk is exactly the judgment a lawyer is
// paid for. What is typed is where it lives, not who decides it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFindingsJson, netChainMarkers } from "../findings-model.mjs";   // parseFindingsJsonLenient is imported at the block below (ESM hoists it)

const MANIFEST = {
  schema_version: 1, framework_key: "house-default", title: "House default", entity_label: "the company",
  bands: [{ label: "Severe" }, { label: "Serious" }, { label: "Moderate" }, { label: "Low" }],
};
const REAL = {
  ordinal: 1, mark: "VENZAL",
  owner: { name: "Muster Handels GmbH & Co. KG", country: "DE", registrations: [] },
  band: "Moderate", disposition: "adversarial",
  legal_position: "The marks share the whole distinctive root of a coined word.",
  practical_position: "The proprietor sits in the same corporate group as an active enforcer.",
  meters: {
    mark_similarity: { token: "medium", basis: "verified-from-record", source: "/mark/em/X" },
    goods_proximity: { token: "high", basis: "verified-from-record", source: "/mark/em/X" },
    use: { token: "not-confirmed", basis: "inferred-from-signal", source: "" },
    enforcer: { token: "medium", basis: "inferred-from-signal", source: "" },
  },
  quadrant: { x: 0.95, y: 0.62 },
  source: { source_type: "register-vendor", resolved_link: "https://example.invalid/mark/em/X" },
};
const parse = (over) => parseFindingsJson(JSON.stringify({
  schema_version: 5, rated_under_framework: "house-default", findings: [{ ...REAL, ...over }], coverage: [], actions: [],
}), { manifest: MANIFEST });

test("item 9a — the net is a typed field, trimmed, and optional", () => {
  const out = parse({ net: "  The legal risk is an identical prior right in class 5 — no coexistence terms are on record.  " });
  assert.equal(out.findings[0].net, "The legal risk is an identical prior right in class 5 — no coexistence terms are on record.");
  assert.equal(parse({}).findings[0].net, undefined, "absent ⇒ the card falls back exactly as before this field existed");
});

test("item 9a — FACTS AND ASSESSMENT, never an action prescription", () => {
  // The reader is a lawyer who layers their own advice on top; what a human must do lives in the typed
  // actions register. This is the sentence most likely to drift into advice, so it is the one checked.
  for (const bad of [
    "We recommend filing a defensive application in class 5.",
    "You should seek consent from the prior owner.",
    "The practical path is a coexistence agreement.",
    "Consider rebranding before launch.",
    "It would be prudent to obtain a freedom-to-operate opinion.",
  ]) assert.throws(() => parse({ net: bad }), /finding_net_prescriptive/, `must refuse: ${bad}`);
  // …and the honest form of the same finding passes
  assert.ok(parse({ net: "The legal risk is an identical prior right in class 5, and no coexistence terms are on record." }).findings[0].net);
  assert.throws(() => parse({ net: "   " }), /finding_net_invalid/);
  assert.throws(() => parse({ net: 42 }), /finding_net_invalid/);
});

test("item 9a — the validator sets NO length maximum: brevity is the renderer's problem", () => {
  // A model told to be brief writes a shorter sentence and drops a fact. A renderer folding a long one
  // loses nothing the reader wanted, because the full reasoning is in the card body directly below it.
  const long = `The legal risk is an identical prior right in class 5 held by the same corporate group as an active enforcer, ${"and the specification covers the company's exact goods, ".repeat(6)}and no coexistence terms are on record.`;
  assert.ok(long.length > 400);
  assert.equal(parse({ net: long }).findings[0].net, long, "stored in full — nothing upstream truncates a judgment sentence");
});

// (2026-08-06) replaced this test's subject. It used to pin the 240-character fold — the sentence
// end inside the budget, the word boundary under it, the ellipsis that marked the cut. The cap is
// deleted: bounded the sentence by contract (a conclusion, not a chain, with a mechanical gate) and
// moved every other piece of card prose behind the drawer, so there is nothing above the fold left
// for a long sentence to overrun. The test now guards the deletion, because "reintroduce a cap just in
// case" is the specific regression the ruling names.
test("#470 — the renderer renders the sentence VERBATIM: no budget, no fold, no ellipsis", () => {
  const src = readFileSync(new URL("../publish/render.mjs", import.meta.url), "utf8");
  assert.match(src, /const one = clause\(f\.net\) \|\| \(card\?\.meta\?\.one\) \|\| oneFallback/,
    "the TYPED record wins over the parsed markdown — that is the whole point of typing it");
  assert.doesNotMatch(src, /^const NET_BUDGET\b/m, "the character budget is DELETED, never raised");
  assert.doesNotMatch(src, /function foldClause\(/, "…and so is the function that applied it");
  assert.doesNotMatch(src, /\\u2026`;/, "no fold mark is emitted anywhere, because nothing is folded");
  // The half of foldClause that was NOT a cap and had to survive its deletion: trim-to-empty is what
  // makes the fallback chain fall through on a record whose `net` key is present and blank.
  assert.match(src, /const clause = \(value\) => String\(value \?\? ''\)\.trim\(\);/,
    "clause() is foldClause with the budget arm removed and nothing else");
});

test("item 9a — one author, every surface: the client cut and the MCP brief both read the typed field", () => {
  const rd = readFileSync(new URL("../publish/report-data.mjs", import.meta.url), "utf8");
  assert.match(rd, /net: clientText\(f\.net\)/,
    "it is a client-facing sentence by design (it is the card's lead), so it joins the whitelist explicitly and routes through the scrub");
  const brief = readFileSync(new URL("../../mcp-server/lib/brief.mjs", import.meta.url), "utf8");
  assert.match(brief, /netByOrd\.get\(String\(c\.meta\.ord\)\) \?\? c\.meta\.one/,
    "the brief prefers the typed field and keeps the parsed line as the archived-run fallback");
});

test("item 9a / #469 — the stage that writes it is told what it is, and told NOT to shorten it", async () => {
  const { STAGES, paths } = await import("../stages.mjs");
  const msg = STAGES.synthesis.message({
    paths: paths("/r"), job: {}, profile: null,
    framework: { title: "T", framework_key: "house-default", entity_label: "the company", bands: MANIFEST.bands },
  });
  assert.match(msg, /THE FINDING SENTENCE/);
  assert.match(msg, /NEVER AN ACTION PRESCRIPTION/);
  // #469 — the dictation used to restate the retired chain shape here IN FULL ("semicolon-chained …
  // the consequence after '→'"), so rewriting synthesis-rules.md alone would have left the prompt
  // teaching the shape the parser now refuses. These pin the join, not the wording of the section.
  assert.match(msg, /IT IS A CONCLUSION, NOT A CHAIN/);
  assert.match(msg, /NO SEMICOLON-CHAIN, NO "→", NO CONSEQUENCE CLAUSE/);
  assert.doesNotMatch(msg, /semicolon-chained/i, "the retired shape is never re-taught — a superseded contract in the prompt is a gate silently switched off");
  assert.match(msg, /THE REASONING MOVES, IT NEVER DISAPPEARS/,
    "relocation, not compression: a net that got shorter because the reasoning got thinner is the rewrite the ruling rejects");
  assert.match(msg, /There is NO length cap and none is coming/,
    "the budget was never the validator's and is no longer the renderer's — nothing asks the model to be brief");
});

// ── #469 — the finding sentence is a CONCLUSION, and the gate that says so ────────────────────────────
//
// The contract these pin was a CHAIN by mandate until 2026-08-06: synthesis-rules.md required a
// semicolon-chained rights → facts → consequence sentence and render.mjs folded the result at 240
// characters. The ruling moved the reasoning into legal_position / practical_position and left the net
// as the answer to one question. Two arms, and the split is the point:
//   · the PARSER refuses the chain at schema_version 7, so it rides the corrective ladder and is repaired;
//   · the LINT names it version-independently, for the lenient/quarantine parse and the down-level file.
// The parser arm was inert until FINDINGS_SCHEMA_VERSION reached 7, which #470 armed on 2026-08-06.
// These tests drive it by declaring the version directly, so they held before the bump and hold after
// it — and they still pin the DOWN-LEVEL half, which is the half that never changes.
const parseAt = (version, over) => parseFindingsJson(JSON.stringify({
  schema_version: version, rated_under_framework: "house-default", findings: [{ ...REAL, ...over }], coverage: [], actions: [],
}), { manifest: MANIFEST });

test("#469 — a v7 net carrying the retired chain punctuation is refused, token FIRST and PLURAL", () => {
  for (const [bad, why] of [
    ["Veltra Labs holds VELTRA in EU/UK for laboratory software; no current use is on record.", "semicolon"],
    ["VELTRA in EU/UK for laboratory software → the registration is vulnerable to revocation.", "the U+2192 arrow"],
    ["VELTRA in EU/UK -> vulnerable to revocation.", "the ASCII arrow a model types from habit"],
  ]) {
    assert.throws(() => parseAt(7, { net: bad }), (e) => {
      assert.match(e.message, /^findings_net_chained:1 /, `${why}: the token leads the message, and it is PLURAL — pipeline.mjs's A3 lane keys on the singular family and has nothing to salvage here`);
      return true;
    }, `must refuse (${why}): ${bad}`);
  }
  // …and the ruled shape passes, em-dash and all: the gate reads two punctuation marks, never a style.
  assert.ok(parseAt(7, { net: "Veltra Labs' registered VELTRA is more likely than not to prevail against VELTRA PHARMA in the United States." }).findings[0].net);
  assert.ok(parseAt(7, { net: "Norvell Instruments — a laboratory-equipment maker — could oppose in the EU but has never asserted." }).findings[0].net);
});

test("#469 — the gate is version-gated at 7, so every archived record still parses byte-identically", () => {
  // This is the ONE net rule that had to be gated. PRESCRIPTION_RE applies at every version because a
  // prescriptive net was always wrong; a CHAIN was MANDATORY until this ruling, so applying this rule
  // retroactively would stop delivered matters republishing (publish/index.mjs strict-parses the
  // archived findings.json). Every version the archive can carry is checked, not just the newest.
  const chain = "VELTRA in EU/UK for laboratory software; no current use is on record → vulnerable to revocation.";
  for (const v of [4, 5, 6]) assert.equal(parseAt(v, { net: chain }).findings[0].net, chain, `schema_version ${v} must be untouched`);
});

test("#469 — the parser exempts the SAME two findings the lint row does, and for the same reasons", () => {
  // The two arms judging different SETS is the failure this pins: it would mean a defect the banner
  // forgives and the parser refuses, on one record. The exemptions are shared through
  // POSITION_REQUIRED_DISPOSITIONS, so they cannot drift.
  const chain = "VELTRA in DE; no use on record → vulnerable.";
  // withdrawn: judging it would mean the corrective pass CAN NO LONGER KILL A FINDING — the killer sets
  // disposition and re-saves, and the model is then asked to repair the punctuation of a card it is
  // deleting, on a net written under the chain contract that was mandatory when it was authored.
  assert.ok(parseAt(7, { disposition: "withdrawn", withdrawn_reason: "killed by the reviewer's flag", band: undefined, net: chain }));
  // ruled_out: renders in the quiet "Also considered" list off ruled_out_reason, never off net.
  assert.ok(parseAt(7, { ruled_out: true, ruled_out_reason: "shares the theme, not the word", net: chain }));
  // …and every disposition that DOES reach a reader is still judged.
  for (const d of ["adversarial", "coexistence-partner", "distinguished"])
    assert.throws(() => parseAt(7, { disposition: d, net: chain }), /findings_net_chained/, `${d} reaches a reader`);
  assert.throws(() => parseAt(7, { disposition: "off-field", band: undefined, off_field_ground: "no-material-risk", net: chain }),
    /findings_net_chained/, "an off-field awareness item carries the sentence like any other card");
});

test("#469 — the lenient/quarantine path never drops a finding over its punctuation", () => {
  // Dropping a real conflict because its sentence is shaped wrong is silence arrived at by enforcing a
  // rule about clarity — validateNetRequired's reasoning, and the same answer. It also keeps the
  // token out of the A3 salvage lane, whose re-emit is driven by exactly this quarantined[] array.
  const doc = JSON.stringify({
    schema_version: 7, rated_under_framework: "house-default",
    findings: [{ ...REAL, net: "VELTRA in EU/UK; no use on record → vulnerable." }], coverage: [], actions: [],
  });
  const out = parseFindingsJsonLenient(doc, { manifest: MANIFEST });
  assert.equal(out.quarantined.length, 0, "the finding survives");
  assert.equal(out.findings.length, 1);
});

test("#469 — the markers are punctuation and NOTHING else: no length, no quality, no word match", () => {
  // This gate replaced a character cap — deleted render.mjs's NET_BUDGET fold on 2026-08-06. A
  // gate that counted characters would be that cap wearing a gate's clothes and earn the same defect.
  const long = `Veltra Labs' registered VELTRA is more likely than not to prevail against VELTRA PHARMA in the United States ${"across every market the applicant has named in its filing instructions ".repeat(8)}on the register material this run holds.`;
  assert.ok(long.length > 600);
  assert.equal(parseAt(7, { net: long }).findings[0].net, long, "no maximum, at any version");
  // 's prose names "the word so"; the gate deliberately does not, because a word match fires on
  // "also" and "so-called" and that is a quality judgment code cannot make.
  for (const ok of [
    "The owner is dormant, so the practical exposure is low in the United States.",
    "Norvell also holds a so-called defensive filing in class 9.",
  ]) assert.ok(parseAt(7, { net: ok }).findings[0].net, `must pass: ${ok}`);
  assert.deepEqual(netChainMarkers("no markers here"), []);
  assert.deepEqual(netChainMarkers("a; b → c"), ["semicolon", "arrow"], "both are reported, so the message can name what it saw");
});

// ── — report.md renders the typed net; the separately-authored summaries are deleted ─────────────
//
// Item 9a typed the field and pointed report.html and report-data.json at it. report.md kept authoring
// its own `- one:` line AND a third condensation under `### The read`, so one finding carried three
// summaries from two authors with nothing making them agree. They happened to agree on the case that was
// checked. These tests pin the half that makes agreement structural rather than lucky.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFindingsJsonLenient, FINDINGS_SCHEMA_VERSION } from "../findings-model.mjs";
import { contentModelChecks } from "../predelivery-lint.mjs";
import { assembleReportMd } from "../pipeline.mjs";

const V6 = {
  ...REAL, disposition: "adversarial", legal_position: "L.", practical_position: "P.",
  net: "The legal risk is an identical prior right in class 5 — no coexistence terms are on the record searched.",
};
const doc6 = (findings) => JSON.stringify({
  schema_version: FINDINGS_SCHEMA_VERSION, rated_under_framework: "house-default", findings, coverage: [], actions: [],
});
const parse6 = (findings) => parseFindingsJson(doc6(findings), { manifest: MANIFEST });

test("#243 — at v6 the net is REQUIRED: with nothing else authoring a summary, its absence is a finding with no sentence", () => {
  const netless = { ...V6 };
  delete netless.net;
  assert.throws(() => parse6([netless]), /finding_net_missing:1/,
    "a throw, not a flag: this is a synthesis-time contract miss, so it rides the corrective ladder and gets REPAIRED");
  assert.ok(parse6([{ ...V6, net: "The legal risk is an identical prior right in class 5." }]).findings[0].net);
  // …and blank-but-present is refused by the shape check, so "" cannot be used to satisfy presence.
  assert.throws(() => parse6([{ ...V6, net: "   " }]), /finding_net_invalid:1/);
});

test("#243 — the two exemptions are the two #242 already established, and no others", () => {
  // withdrawn: a reviewer-killed finding gets no card call at all ( A1) — it has no surface to be
  // silent on, and demanding a summary for a card being deleted would block the corrective pass.
  const killed = { ...V6, disposition: "withdrawn", withdrawn_reason: "reviewer flag: unsourced attribution", band: undefined };
  delete killed.net; delete killed.band; delete killed.legal_position; delete killed.practical_position;
  assert.equal(parse6([killed]).findings[0].disposition, "withdrawn");
  // ruled_out: renders in the quiet "Also considered — ruled out" list off ruled_out_reason, never off net.
  const ruled = { ...V6, ruled_out: true, ruled_out_reason: "shares the theme, not the word — no common element" };
  delete ruled.net;
  assert.equal(parse6([ruled]).findings[0].ruled_out, true);
  // every OTHER disposition is required to carry one.
  for (const disposition of ["adversarial", "coexistence-partner", "distinguished"]) {
    const f = { ...V6, disposition, manageable: disposition === "adversarial" ? undefined : { category: "large-competitor", reason: "r" } };
    delete f.net; if (disposition === "adversarial") delete f.manageable;
    assert.throws(() => parse6([f]), /finding_net_missing:1/, `${disposition} must not be exempt`);
  }
});

test("#243 — archived runs still parse clean, and the LENIENT path never DROPS a finding for a missing net", () => {
  // v4/v5 legitimately predate the field. A gate applied there would fail every archived record on replay.
  const netless = { ...V6 };
  delete netless.net; delete netless.legal_position; delete netless.practical_position;
  for (const version of [4, 5]) {
    const parsed = parseFindingsJson(JSON.stringify({
      schema_version: version, rated_under_framework: "house-default", findings: [netless], coverage: [], actions: [],
    }), { manifest: MANIFEST });
    assert.equal(parsed.findings.length, 1, `v${version} must keep parsing the archived shape`);
    assert.equal(parsed.findings[0].net, undefined);
  }
  // Enforcement must never become silence: the lenient/quarantine parse KEEPS the finding so the lint can
  // report it, rather than deleting the evidence of the defect.
  const lenient = parseFindingsJsonLenient(doc6([netless]));
  assert.equal(lenient.findings.length + (lenient.quarantined?.length ?? 0), 1, "the finding survives the lenient parse in one bucket or the other");
});

test("#243 — the lint backstop is version-INDEPENDENT: a down-level file cannot disengage the gate silently", () => {
  // The parser enforces presence at v6. A model that keeps typing 5 would switch that off with nothing
  // behind it — the exact shape of the lint that could not fire.
  // The declared version is no longer an argument here: it is judged by schemaVersionChecks, which
  // sits outside the `expected` gate precisely so a down-level file cannot switch off its own report.
  const netless = { ...V6, ordinal: 2 };
  delete netless.net;
  const out = contentModelChecks({ findings: [{ ...V6 }, netless], fourAnswers: { third_party_rights: { read: "r" } }, expected: true });
  const row = out.find((c) => c.id === "one-clause-net");
  assert.equal(row.pass, false, "the check judges the RECORD, not the version it declares");
  assert.equal(row.structural, true);
  assert.match(row.detail, /ordinal 2 \(adversarial\)/, "it names which finding, so the repair can be targeted");
  assert.ok(contentModelChecks({ findings: [{ ...V6 }], fourAnswers: { third_party_rights: { read: "r" } }, expected: true })
    .find((c) => c.id === "one-clause-net").pass);
});

// ── the assembly: report.md renders the typed field, and authors nothing ──────────────────────────────

const mkP = (dir) => ({
  reportOverview: join(dir, "report-overview.md"),
  reportCardsDir: join(dir, "report-cards"),
  reportCard: (ord) => join(dir, "report-cards", `${ord}.md`),
  report: join(dir, "report.md"),
});
function assemble(cards, findings) {
  const dir = mkdtempSync(join(tmpdir(), "net-assemble-"));
  mkdirSync(join(dir, "report-cards"));
  const P = mkP(dir);
  writeFileSync(P.reportOverview, "---\noverall_label: MEDIUM\noverall_caption: bottom line\n---\n\n# Coverage\nok\n");
  for (const [ord, body] of Object.entries(cards)) writeFileSync(P.reportCard(ord), body);
  assembleReportMd(P, findings, findings.map((f) => f.ordinal));
  return readFileSync(P.report, "utf8");
}

test("#243 — report.md carries the TYPED net for every card, stamped from the record like `- group:` is", () => {
  const md = assemble({
    1: "## Owner A — MARK A, US\n- ord: 1\n### Full detail\n- Source: [x](/mark/us/1)\n",
    2: "## Owner B — MARK B, EU\n- ord: 2\n### Full detail\n- Source: [x](/mark/eu/2)\n",
  }, [
    { ordinal: 1, band: "Moderate", disposition: "adversarial", owner: { name: "Owner A" }, mark: "MARK A", net: "The legal risk is an identical senior mark in class 5 — no coexistence terms are on the record searched." },
    { ordinal: 2, band: "Moderate", disposition: "distinguished", owner: { name: "Owner B" }, mark: "MARK B", net: "The shared element sits behind the house mark." },
  ]);
  assert.equal((md.match(/^- net: /gm) || []).length, 2, "one stamped net per card — the count E2E checks 13/13 on a real run");
  assert.match(md, /- net: The legal risk is an identical senior mark in class 5 — no coexistence terms are on the record searched\./);
  assert.match(md, /- net: The shared element sits behind the house mark\./);
  // FULL TEXT, not the folded form: report.md is the source artifact and the budget belongs to the renderer.
  const long = "A ".repeat(300) + "end.";
  const md2 = assemble({ 1: "## O — M, US\n- ord: 1\n### Full detail\n- Source: [x](/mark/us/1)\n" },
    [{ ordinal: 1, band: "Moderate", disposition: "adversarial", owner: { name: "O" }, mark: "M", net: long }]);
  assert.ok(md2.includes(long.trim()), "nothing at assembly shortens a judgment sentence");
  assert.doesNotMatch(md2, /…/, "and nothing folds it anywhere — the renderer's cap went with #470");
});

test("#243 — no separately-authored condensation survives into report.md, even from a drifted card", () => {
  // The prompt no longer asks for `- one:`. A card that emits one anyway would put two summaries of one
  // finding back into the delivered artifact, so the assembly drops it rather than trusting the prompt.
  const md = assemble({
    1: "## Owner A — MARK A, US\n- ord: 1\n- one: a SEPARATELY AUTHORED summary that drifted\n### Full detail\n- Source: [x](/mark/us/1)\n",
  }, [{ ordinal: 1, band: "Moderate", disposition: "adversarial", owner: { name: "Owner A" }, mark: "MARK A", net: "The typed read." }]);
  assert.doesNotMatch(md, /- one:/, "the retired authored line is dropped at assembly");
  assert.doesNotMatch(md, /SEPARATELY AUTHORED/);
  assert.match(md, /- net: The typed read\./, "and the typed field is what report.md renders");
  assert.equal((md.match(/^- net: /gm) || []).length, 1, "one summary per finding — the whole ruling");
});

test("#243 — a missing net at assembly is LOUD, and a rendered-nothing card stays distinguishable from a filtered-out one", () => {
  // Reaching here without a net means the lenient/quarantine path or a down-level record (v6 throws).
  // The card must still render and must SAY what is missing: an omitted line is the silent-absence bug
  // this file family has now shipped seven times, and an empty `- net:` reads as a finding with nothing
  // to say about it.
  const md = assemble({
    1: "## Owner A — MARK A, US\n- ord: 1\n### Full detail\n- Source: [x](/mark/us/1)\n",
    2: "## Owner B — MARK B, EU\n- ord: 2\n### Full detail\n- Source: [x](/mark/eu/2)\n",
  }, [
    { ordinal: 1, band: "Moderate", disposition: "adversarial", owner: { name: "Owner A" }, mark: "MARK A" },   // NO net
    { ordinal: 2, band: "Moderate", disposition: "adversarial", owner: { name: "Owner B" }, mark: "MARK B", net: "The typed read." },
  ]);
  assert.doesNotMatch(md, /^- net:\s*$/m, "never an empty bullet");
  assert.match(md, /- net: \[no one-clause net on this finding's record\]/, "the absence is stated on the card, in the reader's own artifact");
  assert.match(md, /## Owner A — MARK A, US/, "and the card is NOT dropped — a silently missing card is unreadable as a defect");
  // The contrast that makes it legible: a FILTERED-OUT finding has no `##` block at all.
  const md2 = assemble({ 1: "## Owner A — MARK A, US\n- ord: 1\n### Full detail\n- Source: [x](/mark/us/1)\n" },
    [{ ordinal: 1, band: "Moderate", disposition: "adversarial", owner: { name: "Owner A" }, mark: "MARK A", net: "n." }]);
  assert.doesNotMatch(md2, /MARK B/, "a finding with no card file is absent entirely — not a blank card");
});

test("#243 — BOTH card renderers read the typed field; compactCard was the one the eleventh break missed", () => {
  const src = readFileSync(new URL("../publish/render.mjs", import.meta.url), "utf8");
  const chains = src.match(/const one = .*/g) ?? [];
  assert.equal(chains.length, 2, "findingCard and compactCard — the two places a card's lead sentence is chosen");
  for (const chain of chains) {
    assert.match(chain, /^const one = clause\(f\.net\) \|\|/,
      "the TYPED record wins in BOTH: one rendering the typed net beside one rendering an authored line is the drift this issue closes");
    assert.match(chain, /card\?\.meta\?\.one/, "…and the parsed line stays under it, so an archived run renders unchanged");
  }
});

// ── — the LINT arm: the version-independent twin, and the only arm firing today ──────────────────
//
// The parser refuses the chain at schema_version 7. This row judges the RECORD instead of the version it
// declares, for the two paths a version-gated throw cannot reach — the lenient/quarantine parse (which
// validateNetShape exempts by design) and a down-level emission that would disengage the gate silently.
// It was the whole gate until FINDINGS_SCHEMA_VERSION reached 7 (, 2026-08-06); it is now the half
// of it that a version-gated throw can never cover.
// (contentModelChecks is already imported by the block above — ESM hoists it.)

const netRow = (findings) => contentModelChecks({ findings, fourAnswers: null, expected: true })
  .find((c) => c.id === "net-conclusion-form");

test("#469 lint — a chain-shaped net is named on the banner, whatever version the file declares", () => {
  const base = { ordinal: 1, disposition: "adversarial", net: "Veltra Labs is more likely than not to prevail in Germany." };
  assert.equal(netRow([base]).pass, true);
  const chained = netRow([{ ...base, net: "VELTRA in DE; no use on record → vulnerable to revocation." }]);
  assert.equal(chained.pass, false);
  assert.equal(chained.structural, true, "a visible banner flag, never load-blocking — the validator-brittleness rule");
  assert.match(chained.detail, /ordinal 1: semicolon \+ arrow/, "names the ordinal AND which marks it saw, so the fix needs no re-derivation");
  assert.match(chained.detail, /legal_position \/ practical_position/, "…and says where the reasoning goes: relocation, never compression");
});

test("#469 lint — the same two exemptions as one-clause-net, and no others", () => {
  const chain = "VELTRA in DE; vulnerable.";
  assert.equal(netRow([{ ordinal: 1, disposition: "withdrawn", net: chain }]).pass, true, "a review-killed finding renders nowhere");
  assert.equal(netRow([{ ordinal: 1, disposition: "adversarial", ruled_out: true, net: chain }]).pass, true, "ruled-out reads off ruled_out_reason");
  for (const d of ["adversarial", "coexistence-partner", "distinguished", "off-field"])
    assert.equal(netRow([{ ordinal: 1, disposition: d, net: chain }]).pass, false, `${d} reaches a reader, so it is judged`);
});

test("#469 lint — LIVE-ONLY, so no archived run can ever fail it", () => {
  // Every net in the archive was written to the chain contract that was mandatory when it ran.
  // contentModelChecks returns [] without the caller's assertion, and replay-archive.mjs passes no
  // `findings` at all — so the archived lane cannot reach this row by either route.
  assert.deepEqual(contentModelChecks({ findings: [{ ordinal: 1, disposition: "adversarial", net: "a; b" }], fourAnswers: null, expected: false }), []);
});
