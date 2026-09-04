// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Contract tests for buildAuditMd's parsing of the register spine → published audit.md.
// Specifically: a relevance-gate drop, written into the `### Negative results` table (the fix), reaches
// `# Negative Results`; the old `### Relevance-gate drops (audit-only)` heading did NOT (the bug).
import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditMd, parseSpineFindingBlocks } from "../publish/audit-from-spine.mjs";
import { mintContradictionDoubts, stitchDoubts } from "../doubt-ledger.mjs";

test("a relevance-gate drop in the Negative results table reaches # Negative Results with its URI", () => {
  const registerMd = [
    "# Register findings — Mark: TEST",
    "",
    "### Negative results",
    "| Mark | Search Term / Variant | Result | Notes |",
    "|---|---|---|---|",
    "| DAWN OF JUSTICE FILMS LLC | dawn (default) | dropped — off-field (relevance gate) | URI /mark/xx/123; DAWN-only hit, film not gaming |",
    "",
    "### Coverage ledger",
    "| Coverage unit | Status | Reason |",
    "|---|---|---|",
    "| primary-sweep / worldwide | confirmed-clean | full |",
  ].join("\n");
  const { md, counts } = buildAuditMd(registerMd, "");
  assert.ok(counts.negatives >= 1, "the relevance-gate drop is parsed as a negative result");
  assert.ok(md.includes("# Negative Results"), "audit has a Negative Results section");
  assert.ok(md.includes("/mark/xx/123"), "the dropped candidate's URI survives into the published audit");
  assert.ok(md.includes("dawn (default)"), "the surfacing variant survives too");
});

test("a drop under the old `Relevance-gate drops (audit-only)` heading does NOT reach the audit (the orphaning bug)", () => {
  // Regression doc: that heading matches none of buildAuditMd's parsed headings
  // (risk-relevant|watchlist / negative result / audit trail), so the drop never left the spine. This is
  // exactly why the digest now routes relevance-gate drops into `### Negative results` instead.
  const orphaned = [
    "# Register findings",
    "",
    "### Relevance-gate drops (audit-only)",
    "| URI | Mark | Why dropped |",
    "|---|---|---|",
    "| /mark/xx/999 | OFFFIELD CO | off-field noise |",
  ].join("\n");
  const { md } = buildAuditMd(orphaned, "");
  assert.ok(!md.includes("/mark/xx/999"), "an audit-only-heading drop is orphaned — the reason for the fix");
});

test("common-law negatives keep their Common-law layer and their platform/channel (the two search-log bugs)", () => {
  // Before the fix: a common-law grid negative sits under a heading like "Initial Grid Negative Results"
  // that does NOT say "common", so the heading-regex mislabelled it Register; and its Platform / Channel /
  // Receipt columns weren't in the get() fallbacks, so the whole common-law search log dropped out.
  const registerMd = [
    "# Register findings — Mark: TEST",
    "",
    "### Negative results",
    "| Mark | Search Term / Variant | Result | Notes |",
    "|---|---|---|---|",
    "| TEST | test (exact) cl. 5 | no hits — clean | enumerated 0 |",
  ].join("\n");
  const commonLawMd = [
    "# Common-law findings — TEST",
    "",
    "### Initial Grid Negative Results (2 cells)",
    "| Variant | Platform | Result | Receipt |",
    "|---|---|---|---|",
    "| TESTBRAND | amazon.com | No results | 6 candidates reviewed; no beverage hits |",
    "",
    "### Supplementary Channel Negative Results",
    "| Variant | Channel | Result | Notes |",
    "|---|---|---|---|",
    "| TESTBRAND | Instagram @handle | No active brand account | no commercial presence |",
  ].join("\n");
  const { md } = buildAuditMd(registerMd, commonLawMd);
  const nr = md.split(/^# /m).find((s) => s.startsWith("Negative Results")) || "";
  const clBlocks = nr.split(/^## /m).slice(1).filter((b) => /source_layer: Common-law/.test(b));
  assert.equal(clBlocks.length, 2, "both common-law negatives are tagged Common-law, not Register");
  assert.ok(clBlocks.some((b) => /platform: amazon\.com/.test(b)), "the Platform column survives");
  assert.ok(clBlocks.some((b) => /platform: Instagram @handle/.test(b)), "the Channel column survives as platform");
  // and the register negative is still Register
  assert.ok(/source_layer: Register/.test(nr), "the register negative keeps its Register layer");
});

// ── resolution stamping + Doubt Ledger (2026-07-22, doubt-stitch) ─────────────────────────────────
// Synthetic copper-gantry-shaped material with INVENTED marks/owners: an asserted finding block and its
// direct-search refutation about the same mark, plus the run's findings.json resolution of it.

// A spine whose watchlist annex carries the asserted⇄refuted pair (same mark, different fragments).
const CONTRA_SPINE_MD = [
  "# Register findings — Mark: VOLTMAX",
  "",
  "### Watchlist annex",
  "| Mark | Owner | Status | Notes |",
  "|---|---|---|---|",
  "| VOLTMAX ENERGYCORE | NutriVolt Beverages, Inc. | live | CRITICAL FINDING: active commercial product with nationwide distribution via retail channels |",
  "| Kestrel Hydration (VOLTMAX ENERGYCORE NOT found) | Kestrel Hydration LLC | n/a | direct search of nutrivolt.example: VOLTMAX ENERGYCORE does NOT appear as a product name on official NutriVolt sites |",
].join("\n");

const OFF_FIELD_FINDING = {
  ordinal: 7, mark: "VOLTMAX ENERGYCORE",
  owner: { name: "NutriVolt Beverages, Inc.", country: "US" },
  disposition: "off-field",
};

test("resolution stamping reaches a NON-withdrawn (off-field) finding — the case the withdrawn-only stamp missed", () => {
  const { md, counts } = buildAuditMd(CONTRA_SPINE_MD, "", { findings: [OFF_FIELD_FINDING] });
  assert.equal(counts.resolutionStamped, 1, "the mark+owner block joins the off-field finding");
  assert.equal(counts.withdrawnStamped, 0, "nothing is mislabelled withdrawn");
  assert.ok(md.includes("- resolution: off-field — see finding #7"),
    "the block carries the run's own recorded resolution, copied — never new prose");
});

test("withdrawn behavior is unchanged — the reviewer's kill still stamps disposition + reason, not a resolution line", () => {
  const withdrawn = { ...OFF_FIELD_FINDING, disposition: "withdrawn", withdrawn_reason: "confabulated product page; owner-site search found no such product" };
  const { md, counts } = buildAuditMd(CONTRA_SPINE_MD, "", { findings: [withdrawn] });
  assert.equal(counts.withdrawnStamped, 1);
  assert.equal(counts.resolutionStamped, 0, "the withdrawn special case wins; no generic resolution line doubles it");
  assert.ok(md.includes("- disposition: withdrawn"));
  assert.ok(md.includes("confabulated product page"), "the reviewer's own reason travels verbatim");
  assert.ok(!md.includes("- resolution:"), "no generic stamp on the withdrawn block");
});

test("a contradiction pair with a findings.json read annotates BOTH fragments naming which one the record supports", () => {
  const blocks = parseSpineFindingBlocks(CONTRA_SPINE_MD, "");
  const doubts = stitchDoubts(mintContradictionDoubts(blocks), { findings: { findings: [OFF_FIELD_FINDING], actions: [] } });
  assert.equal(doubts.length, 1, "the asserted⇄refuted pair mints exactly one doubt");
  const { md } = buildAuditMd(CONTRA_SPINE_MD, "", { findings: [OFF_FIELD_FINDING], doubts });
  const annotations = md.match(/- contradiction_resolution: .*/g) ?? [];
  assert.equal(annotations.length, 2, "BOTH blocks of the pair carry the annotation");
  for (const line of annotations) {
    assert.ok(line.includes("finding #7"), "the annotation cites the findings record");
    assert.ok(line.includes("Kestrel Hydration (VOLTMAX ENERGYCORE NOT found)"),
      "off-field = not a live in-field product, so the record supports the REFUTING fragment");
  }
});

test("the # Doubt Ledger renders settled doubts with their evidence and open doubts as OPEN — and legacy calls render no ledger", () => {
  const doubts = [
    {
      id: "doubt:crosscheck:common-law-findings.md:1",
      birth: { place: "gather-crosscheck", artifact: "common-law-findings.md", quote: "CROSS-CHECK REQUIRED: VOLTMAX ENERGYCORE US designations — owner-site search found no such product" },
      subject: { mark: "", owner: "", terms: ["VOLTMAX ENERGYCORE"], text: "" },
      status: "checked-and-settled",
      ending: { by: "code-stitch", evidence: { file: "findings.json", quote: "finding #7: VOLTMAX ENERGYCORE — off-field" } },
    },
    {
      id: "doubt:crosscheck:common-law-findings.md:2",
      birth: { place: "gather-crosscheck", artifact: "common-law-findings.md", quote: "CROSS-CHECK REQUIRED: MARLOVIA QUENCHROOT EU designations — no EU register layer ran" },
      subject: { mark: "", owner: "", terms: ["MARLOVIA QUENCHROOT"], text: "" },
      status: "open",
      ending: null,
    },
    {
      // T2c — a doubt the settle-by-citation stage closed with a code-VERIFIED quote renders as its
      // own evidence class, never conflated with a deterministic stitch.
      id: "doubt:crosscheck:common-law-findings.md:3",
      birth: { place: "gather-crosscheck", artifact: "common-law-findings.md", quote: "CROSS-CHECK REQUIRED: BREVIOLA SNOWTHISTLE CH designations — marketplace hit unverified" },
      subject: { mark: "", owner: "", terms: ["BREVIOLA SNOWTHISTLE"], text: "" },
      status: "checked-and-settled",
      ending: { by: "doubt-closure-stage", evidence: { file: "register-findings.md", quote: "BREVIOLA SNOWTHISTLE: no live CH record; 2018 lapse" }, reason: "the register layer answered it outside the answer sections" },
    },
  ];
  const { md, counts } = buildAuditMd(CONTRA_SPINE_MD, "", { findings: [OFF_FIELD_FINDING], doubts });
  assert.ok(md.includes("# Doubt Ledger"), "the ledger section renders when doubts are passed");
  assert.ok(/- \[gather-crosscheck\] "CROSS-CHECK REQUIRED: VOLTMAX ENERGYCORE US designations[^\n]*" — settled — code-stitch — findings\.json: 'finding #7/.test(md),
    "a settled doubt names its evidence class (code-stitch) + file + quote");
  assert.ok(/— settled — model-cited \(verified quote\) — register-findings\.md: 'BREVIOLA SNOWTHISTLE: no live CH record/.test(md),
    "a stage-settled doubt is labelled model-cited (verified quote), distinct from code-stitch");
  assert.ok(md.includes("— OPEN — unanswered at delivery"), "a doubt with no ending ships VISIBLY as OPEN — delivery is never gated");
  assert.equal(counts.doubtsSettled, 2);
  assert.equal(counts.doubtsOpen, 1);

  // legacy/replay callers (no doubts option) get byte-compatible output: no ledger section at all
  const legacy = buildAuditMd(CONTRA_SPINE_MD, "", { findings: [OFF_FIELD_FINDING] });
  assert.ok(!legacy.md.includes("# Doubt Ledger"), "no doubts passed — no section rendered");
});

// PR-6 — "# Questions the run asked itself": doubt + ask ledgers side by side when asks are passed;
// doubts alone keep the legacy heading (previous test); asks alone still render both subsections.
test("the ask ledger renders side by side with the doubt ledger under '# Questions the run asked itself'", () => {
  const doubts = [{
    id: "doubt:crosscheck:common-law-findings.md:1",
    birth: { place: "gather-crosscheck", artifact: "common-law-findings.md", quote: "CROSS-CHECK REQUIRED: VOLTMAX ENERGYCORE US designations — owner-site search found no such product" },
    subject: { mark: "", owner: "", terms: ["VOLTMAX ENERGYCORE"], text: "" },
    status: "open", ending: null,
  }];
  const asks = [
    { ask_id: "ask:frame:variant-frostberri", born: { place: "frame-diff", artifact: "_driver/frame-reopen.json", ref: "variant:frostberri", ts: null },
      ask: { text: "blind frame-diff omission: variant:frostberri — sweep it or say why not", owner: "register", structured: null },
      qids: ["supp:primary-sweep:exact:frostberri:aa11bb22"],
      ending: { kind: "executed", by: "plan-execution-join", evidence: "qid(s) executed per plan-execution receipt: supp:primary-sweep:exact:frostberri:aa11bb22", reasons: [], ts: null }, handoff: null },
    { ask_id: "ask:escalation-skip:saturation-probe", born: { place: "escalation-skip", artifact: "_driver/run.jsonl", ref: "saturation-probe", ts: null },
      ask: { text: "the skeptic flagged saturation-probe but the escalation gate declined the re-run", owner: "register", structured: null },
      qids: [], ending: { kind: "judged-immaterial", by: "code-gate", evidence: null, reasons: ["code-side unit (no session)"], ts: null }, handoff: null },
    { ask_id: "ask:envelope:translit-cyrillic", born: { place: "envelope", artifact: "_driver/run.jsonl", ref: "translit-cyrillic", ts: null },
      ask: { text: "deferred coverage-floor work on translit-cyrillic — close it in-loop if the deadline permits", owner: "register", structured: null },
      qids: [], ending: { kind: "recovery", by: "envelope-decision", evidence: null, reasons: ["deadline pressure"], ts: null },
      handoff: "envelope_note front-matter + the open coverage rows" },
    { ask_id: "ask:xcheck-overflow:1", born: { place: "cross-check", artifact: "_driver/register-xcheck.json", ref: "overflow[0]", ts: null },
      ask: { text: "xcheck probe over the cap — never dispatched: Frost Hollow Trading", owner: "register", structured: null },
      qids: [], ending: null, handoff: "ships OPEN in the audit's ask ledger — for the reviewing lawyer" },
  ];
  const { md, counts } = buildAuditMd(CONTRA_SPINE_MD, "", { findings: [OFF_FIELD_FINDING], doubts, asks });
  assert.ok(md.includes("# Questions the run asked itself"), "the umbrella section renders");
  assert.ok(md.includes("## Doubt Ledger") && md.includes("## Ask Ledger"), "both ledgers, side by side");
  assert.ok(md.indexOf("## Doubt Ledger") < md.indexOf("## Ask Ledger"));
  assert.match(md, /- \[frame-diff\] "[^"]+" — executed — qid\(s\) executed per plan-execution receipt/);
  assert.match(md, /- \[escalation-skip\] "[^"]+" — judged immaterial — code-side unit \(no session\)/);
  assert.match(md, /- \[envelope\] "[^"]+" — recovery — deadline pressure — handed over: envelope_note/);
  assert.match(md, /- \[cross-check\] "[^"]+" — OPEN — ships OPEN in the audit's ask ledger/);
  assert.equal(counts.asksEnded, 3);
  assert.equal(counts.asksOpen, 1);
  assert.equal(counts.doubtsOpen, 1);
  // asks present but NO doubts (a doubts-failed run): the section still renders honestly
  const noDoubts = buildAuditMd(CONTRA_SPINE_MD, "", { findings: [OFF_FIELD_FINDING], asks });
  assert.ok(noDoubts.md.includes("- doubt stitching unavailable this run"));
  assert.ok(noDoubts.md.includes("## Ask Ledger"));
});

// ── PR-8: # Reading audit — the band tools' lookup log, code-rendered into the audit ────────────────
const READ_SPINE_MD = [
  "# Register findings — Mark: SYNTH",
  "",
  "### Risk-relevant findings",
  "| Mark | Owner | Classes | Status | URL | Notes |",
  "|---|---|---|---|---|---|",
  "| SYNTH MARK | Synth Co | 32 | Registered | /mark/us/1 | on-field |",
].join("\n");

test("# Reading audit renders from the reading log: counts by tool + session, one clipped row per lookup", () => {
  const readingLog = [
    { ts: "2026-07-29T01:00:00Z", tool: "band_shape", args: { format: "md" }, ok: true, bytes: 4210, session: "prelim-x-y-register-digest" },
    { ts: "2026-07-29T01:00:05Z", tool: "band_lookup", args: { owner: "synth" }, ok: true, matched: 3, returned: 3, session: "prelim-x-y-register-digest" },
    { ts: "2026-07-29T01:10:00Z", tool: "band_record", args: { record_id: "/mark/de/9" }, ok: false, session: "prelim-x-y-synthesis" },
    { ts: "2026-07-29T01:11:00Z", tool: "band_record", args: { record_id: "/mark/us/7" }, ok: false, reason: "unreadable", session: "prelim-x-y-synthesis" },
  ];
  const { md, counts } = buildAuditMd(READ_SPINE_MD, "", { readingLog });
  assert.ok(md.includes("# Reading audit"));
  assert.match(md, /4 lookup\(s\): band_lookup ×1, band_record ×2, band_shape ×1/);
  assert.match(md, /session prelim-x-y-register-digest: 2 lookup\(s\)/);
  assert.match(md, /\[band_lookup\] \{"owner":"synth"\} — matched 3, returned 3/);
  assert.match(md, /\[band_record\] \{"record_id":"\/mark\/de\/9"\} — MISS \(prelim-x-y-synthesis\)/, "a miss is disclosed as a miss; a log with no reason renders as before");
  // — a document the run HOLDS but could not open reads differently from one it never fetched.
  assert.match(md, /\[band_record\] \{"record_id":"\/mark\/us\/7"\} — MISS \(unreadable\)/, "…with the cause, where the log recorded one");
  assert.equal(counts.readingLookups, 4);
});

test("# Reading audit: an EMPTY log renders the honest zero (a stage that read nothing must be visible)", () => {
  const { md } = buildAuditMd(READ_SPINE_MD, "", { readingLog: [] });
  assert.ok(md.includes("# Reading audit"));
  assert.match(md, /no band lookups recorded this run/);
});

test("# Reading audit: legacy callers (no readingLog) get byte-identical output — no section at all", () => {
  const withNull = buildAuditMd(READ_SPINE_MD, "", {});
  assert.ok(!withNull.md.includes("# Reading audit"));
  assert.equal(withNull.md, buildAuditMd(READ_SPINE_MD, "").md, "options omitted entirely ⇒ same bytes");
  assert.equal(withNull.counts.readingLookups, 0);
});

test("# Reading audit: bounded at 400 rendered rows, with the honest remainder pointing at the jsonl", () => {
  const readingLog = Array.from({ length: 450 }, (_, i) => ({ tool: "band_lookup", args: { text: `t${i}` }, ok: true, matched: 1, session: "s" }));
  const { md, counts } = buildAuditMd(READ_SPINE_MD, "", { readingLog });
  assert.equal(counts.readingLookups, 450);
  assert.match(md, /and 50 more lookup\(s\) — the complete log is _driver\/reading-log\.jsonl/);
});
