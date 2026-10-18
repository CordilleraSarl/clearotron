// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FINDING SENTENCE IS THE APPROVED STANDARD, AND THE WRITER AND THE REVIEWER READ THE SAME ONE.
//
// The standard approved on 2026-10-02: at most two sentences, each at most 25 words, in words a client
// reads without a glossary; the first gives the likelihood, the parties, the goods and the territory; the
// second, only when needed, what the earlier right covers; no "prevail", no semicolon, no arrow, no advice,
// no band word; every fact that does not fit goes to the legal and practical positions, never dropped.
//
// What this replaces said the opposite in four places: the writer's instruction asked for ONE sentence and
// said there was no length limit, the manual's worked example and the chain refusal's example were built on
// "prevail", and two refusals still called the field "one-clause". The reviewer, which rewrites visible
// sentences to the 25-word limit, never read the prose manual the limit comes from; it now does, on its first
// dispatch and on every follow-up. The plain-words list it is handed names the field by its name, and its
// length hit on a finding sentence no longer says "split it", which would give a two-sentence finding a third.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES, paths, composeFollowup } from "../stages.mjs";
import { parseFindingsJson } from "../findings-model.mjs";
import { composeDispatchExtra } from "../pipeline.mjs";
import { plainRegisterFlags, SENTENCE_WORD_LIMIT } from "../plain-register.mjs";

const PARAGRAPH = "**The finding sentence.** At most two sentences, each at most 25 words, in words a client reads without a glossary. The first states the outcome as a likelihood: who would win against whom, for what goods, where. *\"[Owner]'s earlier [mark] would probably win against [your mark] for [goods] in [territory].\"* The second, only when the first cannot carry it, states what the earlier right covers: *\"Their registration covers [goods].\"* No \"prevail\". No semicolon, no arrow, no advice, no band word. Every fact that does not fit goes in the legal and practical positions below, never dropped.";
const PARAGRAPH_IN_THE_MANUAL = "**The finding sentence.** At most two sentences, each at most 25 words, in words a client reads\nwithout a glossary. The first states the outcome as a likelihood: who would win against whom, for\nwhat goods, where. *\"[Owner]'s earlier [mark] would probably win against [your mark] for [goods] in\n[territory].\"* The second, only when the first cannot carry it, states what the earlier right covers:\n*\"Their registration covers [goods].\"* No \"prevail\". No semicolon, no arrow, no advice, no band word.\nEvery fact that does not fit goes in the legal and practical positions below, never dropped.";
const MANIFEST = {
  schema_version: 1, framework_key: "house-default", title: "House default", entity_label: "the company",
  bands: [{ label: "Severe" }, { label: "Serious" }, { label: "Moderate" }, { label: "Low" }],
};
const writerMessage = () => STAGES.synthesis.message({
  paths: paths("/r"), job: {}, profile: null,
  framework: { title: "T", framework_key: "house-default", entity_label: "the company", bands: MANIFEST.bands },
});
const manual = (rel) => readFileSync(new URL(`../skills/${rel}`, import.meta.url), "utf8");

test("the writer is given the approved paragraph in place of the old one-sentence instruction", () => {
  const msg = writerMessage();
  assert.ok(msg.split("\n").includes(`- net: ${PARAGRAPH}`), "the net line is the approved paragraph, word for word");
  assert.doesNotMatch(msg, /There is NO length cap/, "the claim that there is no length limit is gone");
  assert.doesNotMatch(msg, /IT IS A CONCLUSION, NOT A CHAIN: ONE sentence/, "the old one-sentence order is gone");
  assert.match(msg, /"net" \(MANDATORY on every finding a reader sees\),"borderline_between"/,
    "the field list no longer calls it the one-clause read or points at a heading that does not exist");
  assert.doesNotMatch(msg, /ONE-CLAUSE NET|one-clause read/);
});

test("the writing manual's section on the finding sentence says the same as the paragraph", () => {
  const text = manual("clearance-search/synthesis-rules.md");
  const section = text.slice(text.indexOf("### The finding sentence — the shape of the typed `net`"), text.indexOf("### The grouped reasoned negative"));
  assert.ok(section.length > 500, "the section was not found");
  assert.ok(section.includes("**A conclusion, not a chain.** It answers the single question a lawyer asks of this\n"), "its opening line");
  assert.ok(!section.includes("**One sentence."), "the opening no longer says one sentence");
  assert.ok(section.includes(`\n\n${PARAGRAPH_IN_THE_MANUAL}\n\n`), "the paragraph stands where the worked example stood");
  assert.ok(!section.includes("Worked example:"), "the old worked example is gone");
  assert.ok(section.includes("(`findings_net_chained`), and so does the pre-delivery lint (`net-conclusion-form`).\n\n"),
    "the line on what the save and the lint refuse ends there");
  assert.ok(!/no cap here|no length cap/i.test(section), "no claim that there is no length limit");
  assert.ok(section.includes("Say what is true of the world instead.\n"), "not repeating the band ends there");
  assert.ok(section.includes("**WHAT A CONCLUSION LOOKS LIKE.** Name the parties and the territory, and state the outcome as a\nlikelihood. *\"Nothing on the German register reaches the applicant's class-9 goods.\"*\n"),
    "the conclusion examples keep the German register line");
  assert.ok(!/prevail/i.test(section.replace("No \"prevail\".", "")), "no example in the section is built on prevail");
  assert.ok(section.trimEnd().endsWith("wider."), "the section ends after the paragraph on goods");
});

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
const refusal = (version, over) => {
  try {
    parseFindingsJson(JSON.stringify({ schema_version: version, rated_under_framework: "house-default",
      findings: [{ ...REAL, ...over }], coverage: [], actions: [] }), { manifest: MANIFEST });
  } catch (e) { return String(e.message); }
  return null;
};

test("the four refusals on the finding sentence no longer call it one-clause, ask for a chain, or wave length away", () => {
  const { net: _drop, ...noNet } = REAL;
  assert.ok(String(refusal(7, { ...noNet, net: undefined })).includes("finding_net_missing:1 (EVERY finding a reader sees carries the net — it is the ONLY per-finding summary the report has: the card leads with it, the grouped-negative line states it, the MCP brief lists the finding by it.)"));
  assert.ok(String(refusal(7, { net: "   " })).includes("finding_net_invalid:1 (net is a non-empty string, or omit it)"));
  assert.ok(String(refusal(7, { net: "You should seek consent from the prior owner." })).includes("finding_net_prescriptive:1 (the read carries FACTS AND ASSESSMENT, never an action prescription — the reader is a lawyer who layers their own advice on top; let the typed actions register carry what a human must do)"));
  const chained = String(refusal(7, { net: "The earlier owner would probably win in Germany; its use is confirmed." }));
  assert.match(chained, /^.*findings_net_chained:1 \(the finding sentence is a CONCLUSION, not a chain — this net carries .+\. Answer the one question a reader asks of this finding: is this a problem for me\. Name the parties and the territory and state the outcome as a likelihood\. Then MOVE the chain's clauses — territories, the goods paraphrase, the owner's business, status and use history — into legal_position and practical_position, in full: this is a relocation, never a compression, and a net that got shorter because the reasoning got thinner is the wrong fix\.\)/);
  for (const text of [refusal(7, { ...noNet, net: undefined }), refusal(7, { net: "   " }), chained]) {
    assert.doesNotMatch(String(text), /one-clause|prevail|no length cap|renderer's problem/i, String(text).slice(0, 80));
  }
});

test("the reviewer reads the prose manual whose rules it enforces, on its first dispatch and on every follow-up", () => {
  const first = STAGES["narrative-refutation"].message({ paths: paths("/r"), job: {}, profile: null, framework: null }).split("\n")[0];
  assert.equal(first, "First, read and follow exactly: skills/narrative-refutation/SKILL.md, skills/clearance-search/report-prose.md.");
  const follow = composeFollowup("narrative-refutation", { profile: null, job: {} }, { followup: "the instruction" }).split("\n")[0];
  assert.equal(follow, "METHODOLOGY (reference — this is a correction to work that already exists, NOT an instruction to redo the stage): this stage is held to skills/narrative-refutation/SKILL.md, skills/clearance-search/report-prose.md. Re-read whatever the instruction below turns on.");
});

test("the prose manual names the finding sentence and its two-sentence limit where it lists what a reader sees first", () => {
  const text = manual("clearance-search/report-prose.md");
  assert.ok(text.includes("**DEFAULT-VISIBLE TEXT CARRIES NO LEGAL OR ENGINE VOCABULARY.** Default-visible means anything a reader\nmeets before opening a fold: the summary and the opening line, the basis for the rating, the points for\nand against and what would soften them, the finding sentence under each name (at most two sentences),\nthe four answers, the reviewer's notes, the caveats, the coverage rows and the lines saying what needs a\ndecision. Ordinary nouns. One idea per sentence. **No visible sentence over 25 words.** The conclusion\nfirst.\n"));
  assert.ok(!text.includes("the one sentence under each name"));
});

const DEMO = new URL("../../demo/global-preliminary-search/run/findings.json", import.meta.url);
const withNet = (net) => {
  const doc = JSON.parse(readFileSync(DEMO, "utf8"));
  doc.findings = doc.findings.map((f, i) => (i === 0 ? { ...f, net } : { ...f, net: "A short clean line." }));
  const f = join(mkdtempSync(join(tmpdir(), "finding-sentence-")), "findings.json");
  writeFileSync(f, JSON.stringify(doc));
  return f;
};
const LONG = `The earlier owner would probably win against the applicant for the software goods ${"across every market it names ".repeat(4)}in the European Union.`;

test("the plain-words list names the finding sentence, and its length hit sends what does not fit to the positions", () => {
  const out = composeDispatchExtra("narrative-refutation", { paths: { findings: withNet(LONG), runDir: "/nonexistent" }, job: { marks: [] } });
  assert.deepEqual(out.failed, []);
  const n = plainRegisterFlags(LONG).find((f) => f.kind === "length")?.words;
  assert.ok(n > SENTENCE_WORD_LIMIT, "the planted sentence is over the limit");
  assert.ok(out.text.includes(`- conflict 1's finding sentence — ${n} words in one sentence, and a visible line takes ${SENTENCE_WORD_LIMIT}. The finding sentence is at most two sentences: every fact that does not fit goes in the legal and practical positions, never dropped.`),
    "the finding sentence's own hit");
  assert.ok(!/conflict \d+'s one sentence/.test(out.text), "the field is called by its name");
  // THE HIT ON EVERY OTHER LINE, AND THE KNOCKOUT'S, STAY WORD FOR WORD: the shared flag text is unchanged.
  const shared = plainRegisterFlags(LONG).find((f) => f.kind === "length").say;
  assert.equal(shared, `${n} words in one sentence, and a visible line takes ${SENTENCE_WORD_LIMIT}. Split it — one idea per sentence, the conclusion first. Do not shorten it by dropping the reason.`);
});

test("the card writer calls the field the finding sentence", () => {
  const msg = STAGES["report-card"].message({ paths: paths("/r"), job: {}, profile: null, framework: null, finding: { ordinal: 1 }, ordinal: 1 });
  assert.ok(msg.includes("Emit NO \"### The read\" narrative — RETIRED. It was a THIRD condensation of the same finding, beside this card's own one-liner and the typed net. The legal read and the enforcement read are already TYPED on the record (legal_position / practical_position) and render from there; the finding sentence is the typed net. Your whole output is the `full_detail` entries — filing, portfolio, the risk assessment, enforcement — and the driver builds the section around them."));
  assert.ok(!msg.includes("the one-clause summary"));
});
