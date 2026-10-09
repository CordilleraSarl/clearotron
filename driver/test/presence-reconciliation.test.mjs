// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Contract tests for presence-reconciliation.mjs — every on-field-rated row ends in PRESENCE or a
// RECORDED REASON. The defect shape under test mirrors the measured leak (6 and 11 unjoined Sheet-2
// rows on two delivered runs, 0 on Sheet-1) rebuilt with INVENTED marks/owners (no client data in
// git). Everything here is pure/offline.
import test from "node:test";
import assert from "node:assert/strict";
import { parseRatedRows, deliveredUriSet, hasRecordedExclusion, mintPresenceDoubts, urisIn } from "../presence-reconciliation.mjs";
import { stitchDoubts } from "../doubt-ledger.mjs";

// ── shared synthetic register-findings spine (frozen digest headings, invented marks) ────────────
// Sheet-1: 2 rows, BOTH accounted for (one by canonical-uri presence, one by full-URL row vs
// canonical delivered uri — the recall-bug shape). Sheet-2: 4 rows — one satisfied by a
// Negative-results drop row, one carrying its own recorded exclusion basis, and exactly TWO with no
// presence and no recorded reason anywhere ⇒ K = 2 doubts.
const REGISTER_MD = [
  "# Register findings — Mark: PROJECT GLIMMERPEAK (2026-07-22, provider: corsearch)",
  "",
  "## Findings — Mark: PROJECT GLIMMERPEAK",
  "",
  "### Risk-relevant (orchestrator: Sheet 1 candidates)",
  "",
  "| URI | Mark | Owner | Country | Classes | Status | Filed | Expiry | Flag reason | Verify? |",
  "|---|---|---|---|---|---|---|---|---|---|",
  "| /mark/eu/018777001 | GLIMMERPEAK | Nordvinter Aps | DK | 09,41 | Registered | 2021-03-01 | 2031-03-01 | H1 exact match in target classes | |",
  "| https://tm.corsearch.com/mark/int/1054099 | GLIMMER PIQUE | Maison Voltique SARL | FR | 41 | Registered | 2019-05-05 | 2029-05-05 | H2 near-identical, instructed class | |",
  "| ... | ... | ... | ... | ... | ... | ... | ... | ... | |",
  "",
  "### Incumbent-context (orchestrator: Sheet 2 candidates)",
  "",
  "| URI | Mark | Owner | Country | Classes | Status | Context |",
  "|---|---|---|---|---|---|---|",
  "| /mark/us/90111222 | SHIMMERPEAK STUDIOS | Bramblewick Media LLC | US | 41 | Registered | S1 parallel-class incumbent, on-field |",
  "| /mark/us/90333444 | GLINTPEAK | Harrowgate Games Inc | US | 09 | Registered | S2 crowded-field neighbour, on-field rating |",
  "| /mark/us/90555666 | PEAKGLIMMER | Ostrellen Interactive | US | 09 | Registered | S2 neighbour — dropped as context-only, crowded field priced in |",
  "| /mark/us/90777888 | GLIMMERPOINT | Quillhaven Corp | US | 41 | Registered | S3 adjacent incumbent |",
  "",
  "### Negative results (orchestrator: Sheet \"Negative Results\")",
  "",
  "| Mark | Search Term / Variant | Result | Notes |",
  "|---|---|---|---|",
  "| GLIMMERPOINT | glimmer (default) | dropped — off-field (relevance gate) | URI /mark/us/90777888; screen_verdict=surface:in-scope-live; class=41; status=live; record_fetched — different field |",
].join("\n");

// The delivered set: finding #1 carries the Sheet-1 canonical uri as a FULL URL (both sides must
// canonicalize); an action names the Sheet-1 full-URL row by its canonical path.
const FINDINGS_DOC = {
  findings: [
    { ordinal: 1, mark: "GLIMMERPEAK", owner: { name: "Nordvinter Aps", registrations: [{ uri: "https://tm.corsearch.com/mark/eu/018777001" }] } },
  ],
  actions: [
    { id: 1, kind: "monitoring", text: "Watch the Maison Voltique registration /mark/int/1054099 and re-assess on any US designation.", ordinals: [1] },
  ],
  coverage: [],
};

// ── parsing ──────────────────────────────────────────────────────────────────────────────────────
test("parseRatedRows parses BOTH frozen sheet shapes, keeps only rows with a parseable /mark uri, canonicalizes full URLs", () => {
  const rows = parseRatedRows(REGISTER_MD);
  assert.equal(rows.length, 6, "2 Sheet-1 + 4 Sheet-2 rows (the '...' filler row and the Negative-results table parse to nothing)");
  assert.deepEqual(rows.map((r) => r.sheet), ["risk-relevant", "risk-relevant",
    "incumbent-context", "incumbent-context", "incumbent-context", "incumbent-context"]);
  const fullUrl = rows[1];
  assert.deepEqual(fullUrl.uris, ["/mark/int/1054099"], "a full provider URL row canonicalizes to the /mark path");
  assert.equal(fullUrl.mark, "GLIMMER PIQUE");
  assert.equal(fullUrl.owner, "Maison Voltique SARL");
  assert.ok(rows[2].line.startsWith("| /mark/us/90111222"), "the verbatim row line is captured (the doubt's birth quote)");
  assert.ok(rows[2].text.includes("S1 parallel-class incumbent"), "the row's own rating/context text is captured");
});

test("urisIn extracts + canonicalizes every /mark uri; hasRecordedExclusion matches exclusion verbs, never a bare rating", () => {
  assert.deepEqual(urisIn("see https://tm.corsearch.com/mark/int/1054099 and /mark/us/90111222"),
    ["/mark/int/1054099", "/mark/us/90111222"]);
  assert.ok(hasRecordedExclusion("dropped as context-only, crowded field priced in"));
  assert.ok(hasRecordedExclusion("status Expired — lapsed 2019"));
  assert.ok(!hasRecordedExclusion("S1 parallel-class incumbent, on-field · Registered"), "a live rated row records no exclusion");
});

// ── the mint: measured-shape counts ──────────────────────────────────────────────────────────────
test("2 Sheet-1 rows all joined + 4 Sheet-2 rows with exactly 2 unjoined ⇒ exactly 2 doubts, in the frozen record shape", () => {
  const doubts = mintPresenceDoubts(REGISTER_MD, { findings: FINDINGS_DOC });
  assert.equal(doubts.length, 2, "Sheet-1 joins (uri presence + action uri); Sheet-2: drop-row uri + recorded exclusion satisfy two — the silent two mint");
  assert.deepEqual(doubts.map((d) => d.subject.mark), ["SHIMMERPEAK STUDIOS", "GLINTPEAK"]);
  const [d] = doubts;
  assert.equal(d.id, "doubt:presence:incumbent-context:1");
  assert.equal(d.birth.place, "presence-reconciliation");
  assert.equal(d.birth.artifact, "register-findings.md");
  assert.ok(d.birth.quote.startsWith("| /mark/us/90111222"), "the birth quote IS the row, verbatim");
  assert.deepEqual(d.subject.uris, ["/mark/us/90111222"]);
  assert.equal(d.subject.owner, "Bramblewick Media LLC");
  assert.equal(d.status, "open");
  assert.equal(d.ending, null);
});

test("URI primary join works in BOTH directions: full-URL row vs canonical delivered uri, and canonical row vs full-URL registration", () => {
  // row holds the FULL URL (/mark/int/1054099 inside it), the action delivers the canonical path — joined
  const viaAction = mintPresenceDoubts(REGISTER_MD, { findings: FINDINGS_DOC });
  assert.ok(!viaAction.some((d) => d.subject.mark === "GLIMMER PIQUE"), "the full-URL Sheet-1 row joins the canonical action uri");
  // row holds the canonical path, the finding registers the FULL URL — joined (both sides canonicalized)
  assert.ok(!viaAction.some((d) => d.subject.mark === "GLIMMERPEAK"), "the canonical Sheet-1 row joins the full-URL registration");
  // drop the delivered set entirely ⇒ the same rows now mint
  const bare = mintPresenceDoubts(REGISTER_MD, {});
  assert.equal(bare.length, 4, "without the delivered set only the recorded-exclusion + drop-row-cited rows stay silent");
});

test("a recorded-exclusion row does NOT mint; a Negative-results drop row citing the uri is a recorded reason", () => {
  const doubts = mintPresenceDoubts(REGISTER_MD, { findings: FINDINGS_DOC });
  assert.ok(!doubts.some((d) => d.subject.mark === "PEAKGLIMMER"), "the row's own 'dropped as context-only' text is the reason");
  assert.ok(!doubts.some((d) => d.subject.mark === "GLIMMERPOINT"), "the drop row's uri (a recorded exclusion) satisfies the Sheet-2 row");
});

test("mark+owner FALLBACK joins a delivered finding when no uri matches — floor-guarded, never a guess", () => {
  // the finding carries the mark under a DIFFERENT registration uri (a sibling leg) — uri equality
  // fails, but the shared findingJoinFor mark join (distinctiveness floor passed) accounts for it.
  const findings = { findings: [
    { ordinal: 2, mark: "SHIMMERPEAK STUDIOS", owner: { name: "Bramblewick Media LLC", registrations: [{ uri: "/mark/eu/018999888" }] } },
  ], actions: [], coverage: [] };
  const doubts = mintPresenceDoubts(REGISTER_MD, { findings });
  assert.ok(!doubts.some((d) => d.subject.mark === "SHIMMERPEAK STUDIOS"), "mark+owner containment joins the sibling-leg finding");
  assert.ok(doubts.some((d) => d.subject.mark === "GLINTPEAK"), "the genuinely silent row still mints");
});

test("the fallback respects the distinctiveness floor: a short mark alone never joins — the row mints", () => {
  const md = [
    "### Incumbent-context (Sheet 2)",
    "| URI | Mark | Owner | Country | Classes | Status | Context |",
    "|---|---|---|---|---|---|---|",
    "| /mark/us/90999000 | ION | Blackfen Press | US | 09 | Registered | S2 short-mark neighbour |",
  ].join("\n");
  // a finding named ION exists (different owner, different uri) — "ION" fails the floor, so no join
  const findings = { findings: [{ ordinal: 3, mark: "ION", owner: { name: "Marrowfield Audio", registrations: [{ uri: "/mark/us/90111333" }] } }], actions: [], coverage: [] };
  const doubts = mintPresenceDoubts(md, { findings });
  assert.equal(doubts.length, 1, "a floor-failing mark token joins nothing — the doubt is the honest record");
  assert.deepEqual(doubts[0].subject.terms, [], "no bare join term is minted for a below-floor mark");
});

test("a uri named in a coverage-row area is presence — both the ledger-row and findings.json coverage shapes", () => {
  const md = [
    "### Incumbent-context (Sheet 2)",
    "| URI | Mark | Owner | Country | Classes | Status | Context |",
    "|---|---|---|---|---|---|---|",
    "| /mark/us/90121212 | FROSTWICK | Alderline GmbH | DE | 41 | Registered | S2 on-field |",
    "| /mark/us/90343434 | THORNWICK | Vellmore Ltd | GB | 41 | Registered | S2 on-field |",
  ].join("\n");
  const viaLedger = mintPresenceDoubts(md, { coverageRows: [{ axis: "incumbent-class", scope: "FROSTWICK family", status: "confirmed-clean", reason: "family priced in — see /mark/us/90121212" }] });
  assert.deepEqual(viaLedger.map((d) => d.subject.mark), ["THORNWICK"], "the ledger-row reason uri accounts for FROSTWICK");
  const viaFindingsCoverage = mintPresenceDoubts(md, { findings: { findings: [], actions: [], coverage: [{ area: "incumbent sweep", state: "note", note: "context family incl. /mark/us/90343434 priced into the crowd read" }] } });
  assert.deepEqual(viaFindingsCoverage.map((d) => d.subject.mark), ["FROSTWICK"], "the findings.json coverage area uri accounts for THORNWICK");
});

test("deliveredUriSet unions all four sources, canonicalized", () => {
  const set = deliveredUriSet({
    findings: { findings: [{ owner: { registrations: [{ uri: "HTTPS://tm.corsearch.com/mark/EU/018777001" }] } }],
      actions: [{ text: "watch /mark/int/1054099" }], coverage: [{ area: "x", note: "/mark/us/90343434" }] },
    coverageRows: [{ reason: "see /mark/us/90121212" }],
    registerFindingsText: "### Negative results\n| Mark | Term | Result | Notes |\n|---|---|---|---|\n| X | x | dropped | URI /mark/us/90777888; status=live |",
  });
  assert.deepEqual([...set].sort(), ["/mark/eu/018777001", "/mark/int/1054099", "/mark/us/90121212", "/mark/us/90343434", "/mark/us/90777888"]);
});

// ── the chain: presence doubts ride the SAME stitch as every other family ────────────────────────
test("a presence doubt flows through stitchDoubts: unjoinable stays OPEN; a coverage row naming the mark's family settles it", () => {
  const doubts = mintPresenceDoubts(REGISTER_MD, { findings: FINDINGS_DOC });
  const open = stitchDoubts(doubts, {});
  assert.ok(open.every((d) => d.status === "open" && d.ending === null), "nothing to join ⇒ ships visibly OPEN");
  const settled = stitchDoubts(doubts, {
    coverageRows: [{ axis: "incumbent-class", scope: "SHIMMERPEAK STUDIOS parallel-class family", status: "confirmed-clean", reason: "crowd disclosure prices the family in" }],
  });
  const [a, b] = settled;
  assert.equal(a.status, "checked-and-settled", "the coverage disclosure naming the family settles the presence doubt");
  assert.equal(a.ending.evidence.file, "register-coverage-ledger.json");
  assert.equal(b.status, "open", "the un-named row stays open");
});
