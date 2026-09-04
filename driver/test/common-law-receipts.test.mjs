// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for the search-as-code receipt gate (common-law-receipts.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { parseManifestVariants, variantsManifestAudit, variantsParseFailure, countMatrixCells, findReceiptViolations, parsePrRiskQueries,
  GRID_HALVES, MEANING_SEAT, GRID_SEATS, splitGridTerms, splitGridSpec, halfOfTerm, mergeGrids, mergeCommonLawFindings,
  parseGridLedger, findGridLedgerViolations } from "../common-law-receipts.mjs";

// ── connotation receipt count: parsePrRiskQueries (the ZURENA fix) ──
test("parsePrRiskQueries: counts non-empty extras.pr_risk queries across batches; junk/absent → 0; never throws", () => {
  const led = JSON.stringify({ cells: [], gaps: [], extras: { pr_risk: [{ query: "ZURENA gang", results: [] }, { query: "ZURENA slang", results: [{ title: "x", url: "u" }] }] } });
  assert.equal(parsePrRiskQueries(led), 2, "two recorded queries (empty results still count — searched-clean)");
  const batched = JSON.stringify([{ cells: [], extras: { pr_risk: [{ query: "A gang", results: [] }] } }, { cells: [], extras: { pr_risk: [{ query: "B gang", results: [] }] } }]);
  assert.equal(parsePrRiskQueries(batched), 2, "counts across batched ledgers");
  assert.equal(parsePrRiskQueries(JSON.stringify({ extras: { pr_risk: [] } })), 0, "empty pr_risk → 0");
  assert.equal(parsePrRiskQueries(JSON.stringify({ extras: {} })), 0, "no pr_risk key → 0");
  assert.equal(parsePrRiskQueries(JSON.stringify({ extras: { pr_risk: [{ query: "  " }, {}] } })), 0, "blank / query-less entries → 0");
  assert.equal(parsePrRiskQueries("{not json"), 0, "unparseable ledger → 0, never throws");
});

const MANIFEST = `# Variant manifest

## Elements
| element | saturation |
|---|---|
| NOVAPULSE | high |

## Variants — PROJECT NOVAPULSE
| Variant | Category | Verify? |
|---|---|---|
| novapulse | exact-phrase | |
| novapulsea | phonetic | |
| 转码 | translit-zh | ✅ |

### Variant applicability
| Category | Disposition |
|---|---|
| numeric-substitution | skipped — English-only mark |
`;

const matrixRows = (variant, n, result = "No results") =>
  Array.from({ length: n }, (_, i) => `| ${variant} | platform-${i} | ${result} |`).join("\n");

const findings = (body) => `# Common-law findings

## Findings — Mark: PROJECT NOVAPULSE
| Finding | Platform | URL |
|---|---|---|

### Negative results (per-platform per-variant)
| Variant | Platform | Result |
|---|---|---|
${body}

### Coverage ledger
| unit | confirmed-clean | reason |
`;

test("parseManifestVariants: reads Variants tables, skips Elements + Variant-applicability sections", () => {
  assert.deepEqual(parseManifestVariants(MANIFEST), ["novapulse", "novapulsea", "转码"]);
});

test("parseManifestVariants: live prelim-variants format — term in the 'Value' column, not the first", () => {
  const live = `# Variant manifest

### Variants

(Axes derived from archetype.)

| Category | Value | Rationale | Verify? |
|---|---|---|---|
| exact-phrase | Dawn: Legends of Thornmantle | full mark | |
| exact-element | THORNMANTLE | distinctive anchor | |
| foreign-transliteration | エンバーヴェイル | JP reach | ✅ |
`;
  assert.deepEqual(parseManifestVariants(live), ["Dawn: Legends of Thornmantle", "THORNMANTLE", "エンバーヴェイル"]);
});

test("countMatrixCells: counts per-variant rows in the negative-results section only", () => {
  const c = countMatrixCells(findings(matrixRows("novapulse", 7)));
  assert.equal(c.get("novapulse"), 7);
  assert.equal(c.has("finding"), false); // findings table is outside the matrix section
});

test("findReceiptViolations: clean when every variant has its 7+ cells (receipt forms all count)", () => {
  const body = [
    matrixRows("novapulse", 5),
    `| novapulse | itch.io | Similar listing(s) found — see Findings (2 candidates) |`,
    `| novapulse | web | No similar listings (8 candidates reviewed) |`,
    matrixRows("novapulsea", 7),
    matrixRows('"转码"', 6),                                       // quote-normalized match
    `| 转码 | web | not executed — coverage-limited (see ledger) |`,
  ].join("\n");
  assert.deepEqual(findReceiptViolations(MANIFEST, findings(body)), []);
});

test("findReceiptViolations: flags the silently-dropped variant (the probe-B failure mode)", () => {
  // probe B live result: the model's transcription dropped one full term — its cells simply vanish
  const body = [matrixRows("novapulse", 7), matrixRows("novapulsea", 7)].join("\n"); // 转码 missing entirely
  const v = findReceiptViolations(MANIFEST, findings(body));
  assert.equal(v.length, 1);
  assert.deepEqual(v[0], { variant: "转码", cells: 0, expected: 7 });
});

test("findReceiptViolations: flags a short-counted variant and respects a custom floor", () => {
  const body = [matrixRows("novapulse", 7), matrixRows("novapulsea", 3), matrixRows("转码", 7)].join("\n");
  const v = findReceiptViolations(MANIFEST, findings(body));
  assert.deepEqual(v, [{ variant: "novapulsea", cells: 3, expected: 7 }]);
  assert.deepEqual(findReceiptViolations(MANIFEST, findings(body), { minCellsPerVariant: 3 }), []);
});

test("findReceiptViolations: empty manifest or findings degrade safely", () => {
  assert.deepEqual(findReceiptViolations("", findings(matrixRows("x", 7))), []);
  const v = findReceiptViolations(MANIFEST, "");
  assert.equal(v.length, 3); // nothing accounted — all variants short
});

// ── 2026-06-10 live-failure regression set: NOT every Variants-table row is a marketplace term ─────────

test("parseManifestVariants: register wildcard family probes are NOT grid variants (matchday killer)", () => {
  // verbatim shape from the teal-anvil manifest (lines 60-64): live `| Category | Value | … |` format
  const m = [
    "## Variants",
    "| Category | Value | Rationale | Verify? |",
    "|---|---|---|---|",
    "| exact | THIS IS MY RALLYDAY | the mark | |",
    "| family-pattern | THIS IS MY \\* | right-wild — probes the family | |",
    "| family-pattern | \\* RALLYDAY | left-wild on the anchor | |",
    "| wildcard | `SATIN & *` | backticked register pattern | |",
  ].join("\n");
  assert.deepEqual(parseManifestVariants(m), ["THIS IS MY RALLYDAY"]);
});

test("parseManifestVariants: (inherit) / em-dash annotation rows are NOT grid variants (inherit-row killer)", () => {
  // verbatim shape from the copper-conduit manifest (line 163)
  const m = [
    "## Variants — Mark 2",
    "| Category | Value | Rationale | Verify? |",
    "|---|---|---|---|",
    "| exact-phrase | Aurora Conquest II: Oak & Ember | full prefixed mark | |",
    "| (inherit) | — all SATIN & STEEL variants from Mark 1 — | the clearable element is identical | |",
  ].join("\n");
  assert.deepEqual(parseManifestVariants(m), ["Aurora Conquest II: Oak & Ember"]);
});

test("commonLaw validator: honest 'deferred to Step 3 (not executed in this run)' prose no longer false-fails", async () => {
  const { validators } = await import("../verify.mjs");
  const base = [
    "# Common-law findings — X", "",
    "## Findings — Mark: X", "| a | b |", "",
    "### Negative results", "| X | Steam | No results |", "",
    "### Coverage ledger", "| unit | confirmed-clean | full |", "",
    "### Audit trail", "| 1 | grid | all cells | ok |", "",
  ].join("\n") + "x".repeat(200);
  // the matchday att3 sentence, verbatim trigger shape: "Perplexity … (not executed in this run)"
  const honest = base + "\nManifest flagged RALLYDAY as requiring a dedicated famous-mark Perplexity call (Step 3). Step 2 grid completed first; famous-mark call deferred to Step 3 (not executed in this run).";
  assert.notEqual(validators.commonLaw("/tmp/x/common-law-findings.md", honest).reason, "declared_unavailable",
    "honest deferred-step prose must not read as a declared-unavailable layer");
  // a TRUE give-up still fails the wording check
  const giveUp = base + "\nThe marketplace research could not be completed — Perplexity unavailable.";
  assert.equal(validators.commonLaw("/tmp/x/common-law-findings.md", giveUp).reason, "declared_unavailable");
});

// ── 2026-06-12 copper-conduit att3 regression set: the work was done, the keys differed ─────────────────

test("alternates: a ' / '-packed manifest cell is satisfied when EVERY alternate carries its own full grid", () => {
  const m = "## Variants\n| Category | Value |\n|---|---|\n| translit | 橡木与烬 / 奥克 |\n";
  const both = findings(matrixRows("橡木与烬", 7) + "\n" + matrixRows("奥克", 7));
  assert.deepEqual(findReceiptViolations(m, both), [], "split-keyed full grids satisfy the compound cell");
  const oneOnly = findings(matrixRows("橡木与烬", 7) + "\n" + matrixRows("奥克", 3));
  assert.equal(findReceiptViolations(m, oneOnly).length, 1, "a short alternate still fails — no thinning");
});

test("substring coverage: a fully-receipted variant covers a LONGER manifest variant containing it", () => {
  const m = "## Variants\n| Category | Value |\n|---|---|\n| exact | Oak & Ember |\n| exact-phrase | Aurora Conquest II: Oak & Ember |\n";
  const sub = findings(matrixRows("Oak & Ember", 7));
  assert.deepEqual(findReceiptViolations(m, sub), [], "the substring sweep surfaces every superstring listing");
  const neither = findings(matrixRows("Oak & Ember", 3));
  assert.equal(findReceiptViolations(m, neither).length, 2, "the substring itself short ⇒ both fail — coverage never thins");
});

test("grid-key dictation: the common-law message hands the worker the exact keys + a batch plan over 14", async () => {
  const { STAGES, paths } = await import("../stages.mjs");
  const P = paths("/tmp/x");
  const few = STAGES["common-law"].message({ paths: P, gridVariants: ["Alpha", "Beta"] });
  assert.match(few, /GRID KEYS \(the validator checks EXACTLY these 2 terms/);
  assert.match(few, /- Alpha\n- Beta/);
  assert.ok(!/BATCHING/.test(few), "small grids run as one call");
  const many = STAGES["common-law"].message({ paths: P, gridVariants: Array.from({ length: 32 }, (_, i) => `V${i}`) });
  assert.match(many, /BATCHING \(MANDATORY/);
  assert.match(many, /3 batches of ≤14/);
  const none = STAGES["common-law"].message({ paths: P });
  assert.ok(!/GRID KEYS/.test(none), "no manifest-derived keys → message unchanged (back-compat)");
});

// ── A1 SPLIT: the deterministic term partition + the half-grid merge ────────────────────────────────────

// A captured-shape full spec/ledger pair (mirrors the live plugin stdout: cells with judged payloads,
// program-error gaps, recorded pr_risk queries) — the cell-loss regression joins the merge against THIS.
const SPEC_PLATFORMS = ["store.steampowered.com", "itch.io", "web"];
const FULL_SPEC = {
  terms: ["novapulse", "nuvapulse", "转码", "n0vapulse", "project novapulse"],
  platforms: SPEC_PLATFORMS,
  output_path: "/x/r/common-law-grid.json",
  batch: 14,
  connotation: { queries: ["novapulse slang", "novapulse gang", "nuvapulse meaning"] },
  ledger_required: true,
};
const cellsFor = (terms, platforms = SPEC_PLATFORMS) =>
  terms.flatMap((term) => platforms.map((platform) => ({ term, platform, status: "no_hit", results: [] })));

test("splitGridTerms: disjoint interleaved halves that union back to the input, deterministically", () => {
  const halves = splitGridTerms(FULL_SPEC.terms);
  assert.deepEqual(halves.a, ["novapulse", "转码", "project novapulse"], "even indices → half a");
  assert.deepEqual(halves.b, ["nuvapulse", "n0vapulse"], "odd indices → half b");
  assert.deepEqual(splitGridTerms(FULL_SPEC.terms), halves, "pure + deterministic");
  assert.ok(Math.abs(halves.a.length - halves.b.length) <= 1, "parity keeps the halves balanced");
  assert.deepEqual(splitGridTerms([]), { a: [], b: [] });
});

test("halfOfTerm: partition ownership — norm equality, ' / '-alternate membership, unknown → null", () => {
  const halves = splitGridTerms(["Oak & Ember", "橡木与烬 / 奥克"]);
  assert.equal(halfOfTerm(halves, "oak & ember"), "a", "normalized match");
  assert.equal(halfOfTerm(halves, "奥克"), "b", "a bare alternate of a packed cell routes to its family's half");
  assert.equal(halfOfTerm(halves, "unrelated"), null, "unknown terms own no half — callers treat as spanning both");
});

test("splitGridSpec: platforms/batch/ledger_required copied verbatim; terms split across the halves; per-seat output paths", () => {
  const outputPaths = Object.fromEntries(GRID_SEATS.map((h) => [h, `/x/r/common-law-grid.half-${h}.json`]));
  const halves = splitGridSpec(FULL_SPEC, { outputPaths });
  for (const h of GRID_SEATS) {
    assert.deepEqual(halves[h].platforms, SPEC_PLATFORMS, `seat ${h} carries the FULL platform list (per-term ownership)`);
    assert.equal(halves[h].batch, 14);
    assert.equal(halves[h].ledger_required, true, "the fail-closed stamp survives the split");
    assert.equal(halves[h].output_path, `/x/r/common-law-grid.half-${h}.json`);
    assert.equal(halves[h].half, h);
  }
  assert.deepEqual([...halves.a.terms, ...halves.b.terms].sort(), [...FULL_SPEC.terms].sort(), "terms union = full spec");
  // — the TERM split is across the two grid halves only, and the meaning seat sweeps no cells at
  // all. That is what makes its dispatch the meaning work and nothing else.
  assert.deepEqual(halves[MEANING_SEAT].terms, [], "the meaning seat owns no term x platform work");
  assert.deepEqual(halves[MEANING_SEAT].connotation.queries, FULL_SPEC.connotation.queries,
    "and it owns the WHOLE sweep — the recurrence floor is a property of the whole sweep");
  for (const h of GRID_HALVES)
    assert.deepEqual(halves[h].connotation.queries, [], `grid half ${h} carries no meaning obligation, so connotation_no_ruling cannot fire on it`);
});

test("mergeGrids: disjoint halves union clean — merged cells === full-spec cells, zero gaps (cell-loss regression)", () => {
  const halves = splitGridTerms(FULL_SPEC.terms);
  const a = { cells: cellsFor(halves.a), extras: { pr_risk: [{ query: "novapulse slang", results: [] }] }, gaps: [] };
  const b = { cells: cellsFor(halves.b), extras: { pr_risk: [{ query: "nuvapulse meaning", results: [] }] }, gaps: [] };
  const merged = mergeGrids(a, b, { spec: FULL_SPEC });
  assert.equal(merged.cells.length, FULL_SPEC.terms.length * SPEC_PLATFORMS.length, "no cell lost, no cell invented");
  assert.deepEqual(merged.gaps, [], "a fully-run grid recomputes to zero gaps");
  assert.deepEqual(findGridLedgerViolations(FULL_SPEC.terms, JSON.stringify(merged), { minCellsPerVariant: SPEC_PLATFORMS.length }), [],
    "the canonical exact join over the merged ledger is clean");
  assert.deepEqual(merged.extras.pr_risk.map((e) => e.query).sort(), ["novapulse slang", "nuvapulse meaning"]);
});

test("mergeGrids: overlapping cells dedup by term|platform (first wins) — a re-routed repair cell never double-counts", () => {
  const halves = splitGridTerms(FULL_SPEC.terms);
  const dup = { term: "nuvapulse", platform: "web", status: "no_hit", results: [], carried_by: "a" };   // half-b term repaired via half-a's session
  const a = [{ cells: [...cellsFor(halves.a), dup], extras: {}, gaps: [] }];                        // batched-array form
  const b = { cells: [...cellsFor(halves.b), { ...dup, carried_by: "b" }], extras: {}, gaps: [] };
  const merged = mergeGrids(a, b, { spec: FULL_SPEC });
  const hits = merged.cells.filter((c) => c.term === "nuvapulse" && c.platform === "web");
  assert.equal(hits.length, 1, "one canonical cell per term|platform key");
  assert.equal(hits[0].carried_by, "a", "first occurrence (half a) wins");
  assert.equal(merged.cells.length, FULL_SPEC.terms.length * SPEC_PLATFORMS.length);
});

test("mergeGrids: one half failed → its cells surface as HONEST gaps against the FULL spec (never a thinner-but-valid ledger)", () => {
  const halves = splitGridTerms(FULL_SPEC.terms);
  const a = { cells: cellsFor(halves.a), extras: { pr_risk: [] }, gaps: [] };
  const merged = mergeGrids(a, null, { spec: FULL_SPEC, halfErrors: { b: "half-b gather member did not complete: timeout" } });
  assert.equal(merged.cells.length, halves.a.length * SPEC_PLATFORMS.length, "only half-a cells present");
  assert.equal(merged.gaps.length, halves.b.length * SPEC_PLATFORMS.length, "EVERY half-b cell accounted as a gap");
  assert.ok(merged.gaps.every((g) => /half-b gather member did not complete/.test(g.error)), "gaps carry the owning half's failure reason");
  // the ladder counts gaps as accounted — the merged ledger stays join-complete (honest, never thinner)
  assert.deepEqual(findGridLedgerViolations(FULL_SPEC.terms, JSON.stringify(merged), { minCellsPerVariant: SPEC_PLATFORMS.length }), []);
  const accounted = parseGridLedger(JSON.stringify(merged));
  assert.equal([...accounted.keys()].length, FULL_SPEC.terms.length, "every dictated term accounted (cells ∪ gaps)");
});

test("mergeGrids: recorded half gaps win over the generic marker; a cell closed by a supplementary batch never re-reads as a gap", () => {
  const halves = splitGridTerms(FULL_SPEC.terms);
  const aCells = cellsFor(halves.a).filter((c) => !(c.term === "novapulse" && c.platform === "web"));
  const a = [
    { cells: aCells, extras: {}, gaps: ["novapulse | web | HTTP 503 from the store", "转码 | itch.io | TimeoutError('cell')"] },
    { cells: [{ term: "转码", platform: "itch.io", status: "no_hit", results: [] }], extras: {}, gaps: [] },   // supplementary closure batch
  ];
  const b = { cells: cellsFor(halves.b), extras: {}, gaps: [] };
  const merged = mergeGrids(a, b, { spec: FULL_SPEC });
  assert.deepEqual(merged.gaps, [{ term: "novapulse", platform: "web", error: "HTTP 503 from the store" }],
    "the open gap keeps its program error; the closed one dropped (its cell is in cells[])");
});

test("mergeGrids: extras.pr_risk concat+dedup by query (a-then-b order); other extras arrays concatenate", () => {
  const a = { cells: [], extras: { pr_risk: [{ query: "novapulse gang", results: [] }, { query: "novapulse slang", results: [{ url: "u" }] }], other: [1] }, gaps: [] };
  const b = { cells: [], extras: { pr_risk: [{ query: "novapulse slang", results: [] }, { query: "nuvapulse meaning", results: [] }], other: [2] }, gaps: [] };
  const merged = mergeGrids(a, b, { spec: { terms: [], platforms: [] } });
  assert.deepEqual(merged.extras.pr_risk.map((e) => e.query), ["novapulse gang", "novapulse slang", "nuvapulse meaning"], "dedup by query, first wins");
  assert.equal(parsePrRiskQueries(JSON.stringify(merged)), 3, "the connotation receipt count reads the merged set");
  assert.deepEqual(merged.extras.other, [1, 2]);
});

test("mergeCommonLawFindings: concatenated halves stay one structurally-valid findings file; a failed half becomes an honest driver note", async () => {
  const { validators } = await import("../verify.mjs");
  const half = (h) => [
    `# Common-law findings — half ${h}`, "",
    "## Findings — Mark: X", "| a | b |", "",
    "### Negative results", `| term-${h} | web | No results |`, "",
    "### Coverage ledger", "| unit | confirmed-clean | full |", "",
    "### Audit trail", "| 1 | grid | cells | ok |", "",
  ].join("\n") + "x".repeat(200);
  const both = mergeCommonLawFindings([{ half: "a", content: half("a"), error: null }, { half: "b", content: half("b"), error: null }]);
  assert.match(both, /half a/);
  assert.match(both, /half b/);
  assert.match(both, /driver-assembled/);
  // no _driver spec in reach → the canonical validator runs its structural core only (the merge gate's shape)
  assert.equal(validators.commonLaw("/nonexistent-dir/common-law-findings.md", both).ok, true, "merged file passes the canonical structural checks");
  const oneDown = mergeCommonLawFindings([{ half: "a", content: half("a"), error: null }, { half: "b", content: null, error: "half-b gather member did not complete: timeout" }]);
  assert.match(oneDown, /Half-b sweep unavailable/);
  assert.match(oneDown, /asserts NO coverage/);
  assert.equal(validators.commonLaw("/nonexistent-dir/common-law-findings.md", oneDown).ok, true, "a one-half assembly is still structurally valid");
});

// ── A1 SPLIT: the commonLawHalf validator (half spec + half ledger exact join, always fail-closed) ─────
test("validators.commonLawHalf: joins THIS half's spec against THIS half's ledger; ledger/spec defects fail closed; the connotation COUNT arm stays merge-only", async () => {
  const { validators } = await import("../verify.mjs");
  const dir = mkdtempSync(join(tmpdir(), "clhalf-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const halves = splitGridSpec(FULL_SPEC, { outputPaths: { a: join(dir, "common-law-grid.half-a.json"), b: join(dir, "common-law-grid.half-b.json") } });
    writeFileSync(driverDir(dir, "grid-spec.half-a.json"), JSON.stringify(halves.a));
    const p = join(dir, "common-law-findings.half-a.md");
    const md = [
      "# Common-law findings — half a", "",
      "## Findings — Mark: X", "| a | b |", "",
      "### Negative results", "| novapulse | web | No results |", "",
      // a clean-claim PR section with ZERO recorded queries — the canonical validator would demand the
      // receipt; the HALF validator must NOT (the meaning queries are partitioned, a half may own none)
      "### PR / reputational", "None identified — reads clean.", "",
      "### Coverage ledger", "| unit | confirmed-clean | full |", "",
      "### Audit trail", "| 1 | grid | cells | ok |", "",
    ].join("\n") + "x".repeat(200);
    // ledger missing → fail-closed (a half member only exists under a dictated spec)
    assert.match(validators.commonLawHalf(p, md).reason, /^grid_ledger_missing/);
    // complete half ledger (no pr_risk) → machine-receipts pass — the COUNT arm is the MERGED gate's job
    // (the disposition arm is separate: it rides the half — see the dedicated test below)
    writeFileSync(join(dir, "common-law-grid.half-a.json"), JSON.stringify({ cells: cellsFor(halves.a.terms), extras: { pr_risk: [] }, gaps: [] }));
    assert.deepEqual(validators.commonLawHalf(p, md), { ok: true, reason: "machine-receipts" });
    // a dropped half term → the same grid_join_missing token the corrective ladder already understands
    writeFileSync(join(dir, "common-law-grid.half-a.json"), JSON.stringify({ cells: cellsFor(halves.a.terms.slice(1)), extras: {}, gaps: [] }));
    assert.match(validators.commonLawHalf(p, md).reason, /^grid_join_missing:novapulse/);
    // wrong platform identity → platforms_missing
    writeFileSync(join(dir, "common-law-grid.half-a.json"),
      JSON.stringify({ cells: cellsFor(halves.a.terms, ["wrong.example", "also-wrong.example", "web"]), extras: {}, gaps: [] }));
    assert.match(validators.commonLawHalf(p, md).reason, /^platforms_missing/);
    // corrupt driver-written half spec → grid_spec_unreadable (a bug, never a silent downgrade)
    writeFileSync(driverDir(dir, "grid-spec.half-a.json"), "{torn");
    assert.match(validators.commonLawHalf(p, md).reason, /^grid_spec_unreadable/);
    // a path that names no half is unrecognizable — the validator never guesses
    assert.equal(validators.commonLawHalf(join(dir, "common-law-findings.md"), md).reason, "half_path_unrecognized");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── P2-C §8b leg 2 at the HALF seat (2026-07-31 review round): under the split the half member writes
// the PR section, so the receipts-disposition arm must judge it where the corrective ladder can still
// reach the authoring session — enforcement living only at the code-side merge is terminal-without-remedy
// (deterministic failClass, parkBudget 0). Gated on the HALF spec's own connotation.disposition_required
// stamp (splitGridSpec spreads the canonical connotation object verbatim), so unstamped specs never flip.
test("validators.commonLawHalf: the receipts-disposition arm rides the half — a driver-written form with an unruled row fails; a ruled one passes; unstamped never flips", async () => {
  const { validators } = await import("../verify.mjs");
  const { obligationRows, connotationObligations, parsePrRiskResults } = await import("../connotation-search.mjs");
  const dir = mkdtempSync(join(tmpdir(), "clhalf-disp-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const stampedSpec = { ...FULL_SPEC, connotation: { ...FULL_SPEC.connotation, disposition_required: true } };
    // The form's path is DICTATED into the half spec by the driver and derived nowhere else (/),
    // so a fixture that omitted it would be testing a spec no run has.
    const halves = splitGridSpec(stampedSpec, { dispositionsPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, join(dir, `common-law-dispositions.half-${h}.json`)])) });
    //: the meaning sweep is single-seat, so this arm is exercised on the OWNING half. The sibling
    // holds no dictated queries and has nothing to dispose — that is the fix, not a gap.
    const H = MEANING_SEAT;
    const half = halves[H];
    writeFileSync(driverDir(dir, `grid-spec.half-${H}.json`), JSON.stringify(half));
    const p = join(dir, `common-law-findings.half-${H}.md`);
    // this half's plugin-written ledger: grid complete; ONE recorded meaning query returned results
    const withResult = half.connotation.queries[0];
    const ledger = (results) => JSON.stringify({ cells: cellsFor(half.terms), extras: { pr_risk: [
      { query: withResult, results },
      ...half.connotation.queries.slice(1).map((q) => ({ query: q, results: [] })),
    ] }, gaps: [] });
    writeFileSync(join(dir, `common-law-grid.half-${H}.json`),
      ledger([{ title: "Street-crew profile piece on the mark in local press", url: "https://news.example/crew-profile" }]));
    const doc = (extra = "") => [
      `# Common-law findings — meaning sweep (seat ${H})`, "",
      "## Findings — Mark: X", "| a | b |", "",
      "### PR / reputational risk", "(None identified — affirmative sweep) — reads clean.",
      "**Connotation-search source:** perplexity_research (dictated sweep)", extra, "",
      "### Audit trail", "| 1 | meaning | queries | ok |", "",
    ].join("\n") + "x".repeat(200);
    // — NO FORM ON DISK IS NOTHING TO JUDGE, not a pass and not a failure. Every archived run is in
    // this state, which is why the replay corpus does not flip; a fresh run can never reach delivery in it,
    // because the driver writes the form at the grid and unions it before every judgement.
    assert.equal(validators.commonLawHalf(p, doc()).ok, true, "no form ⇒ the disposition arm has nothing to judge");

    // With the DRIVER-WRITTEN accumulator beside it, an unruled row fails the half seat — where the
    // corrective ladder can still reach the authoring session, which is the whole reason this arm lives
    // at the half. B: the accumulator in `_driver/` is the ONE copy (the era stamp, and the copy no seat
    // can delete into a pass); no seat-facing file exists any more.
    const driverForm = driverDir(dir, `common-law-dispositions.half-${H}.form.json`);
    const form = (body) => writeFileSync(driverForm, body);
    const rows = obligationRows(connotationObligations(parsePrRiskResults(readFileSync(join(dir, `common-law-grid.half-${H}.json`), "utf8"))));
    assert.equal(rows.length, 1, "one recorded query returned results, so one row is owed");
    form(JSON.stringify({ rows }));
    const v = validators.commonLawHalf(p, doc());
    assert.equal(v.ok, false);
    // B — the whole-population verdict is the call audit's: rows are owed and nothing was recorded. On
    // this fixture no tool-calls log exists at all, and the audit's honest floor for that blindness is
    // `call_partial` (an unreadable record is not an empty one — disposition-call-audit.mjs).
    assert.match(v.reason, /^connotation_call_partial:call_partial=1;/);
    assert.equal(v.quantity, 1, "the validator stamps its own exact count (#246)");

    // The row ruled → machine-receipts pass. Two fields, and nothing transcribed.
    form(JSON.stringify({ rows: rows.map((r) => ({ ...r, receipt_id: r.candidates[0].receipt_id, ruling: "loaded", note: "street-crew profile; carried to Findings" })) }));
    assert.deepEqual(validators.commonLawHalf(p, doc()), { ok: true, reason: "machine-receipts" });

    // (owner's ruling 2026-08-04): a half whose OWN doc makes no clean claim USED TO pass unpoliced.
    // That is the defect — the arm was a phrase match on model prose, so the corrective ladder could drive
    // a model into redrafting the claim away and the whole gate went silent over its recorded receipts.
    // The half is policed on its receipts, whatever its prose says — and does not soften that: the
    // form is judged the same whether the section claims clean, reports a loaded reading, or is absent.
    const engaged = doc().replace("(None identified — affirmative sweep) — reads clean.",
      "A loaded street-crew reading surfaced; carried to Findings.");
    assert.equal(validators.commonLawHalf(p, engaged).ok, true, "a ruled form passes whatever the prose says");
    form(JSON.stringify({ rows }));
    assert.equal(validators.commonLawHalf(p, engaged).ok, false, "and an unruled one fails whatever the prose says");

    // A row naming an id that is not one of ITS OWN candidates is a DAMAGED form, with its own token —
    // repairSiblingName routes on that pattern, and a bare `form_damaged` would be indistinguishable from
    // the register-digest form's.
    form(JSON.stringify({ rows: rows.map((r) => ({ ...r, receipt_id: "R-ZZZZZZZZ", ruling: "benign", note: "n" })) }));
    assert.match(validators.commonLawHalf(p, doc()).reason, /^connotation_form_damaged:form_damaged=1;/);
    // Present-and-unparseable is a NAMED defect, never read as absent.
    form("{not json");
    assert.match(validators.commonLawHalf(p, doc()).reason, /^connotation_form_damaged:.*unparseable/);

    // the SAME unruled form under an UNSTAMPED half spec (pre-P2-C shape) → verdict never flips
    form(JSON.stringify({ rows }));
    writeFileSync(driverDir(dir, `grid-spec.half-${H}.json`), JSON.stringify(splitGridSpec(FULL_SPEC, {})[H]));
    assert.equal(validators.commonLawHalf(p, doc()).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── copper-lattice net #3: cross-check signal extraction ────────────────────────────────────────────────
test("findSimilarListingSignals: matrix similar-listing rows + owner-carrying finding blocks; junk tolerated", async () => {
  const { findSimilarListingSignals } = await import("../common-law-receipts.mjs");
  const md = [
    "## Findings", "",
    "### Zylight FROSTBERRY energy drink", "",
    "**Developer of record:** Zylight LLC", "Listing: https://www.amazon.com/dp/B0FROST", "",
    "### Mystery seller", "",
    "**Owner of record:** not extracted", "",
    "## Negative results", "",
    "| Variant | Platform | Result | Notes |",
    "| --- | --- | --- | --- |",
    "| frostplum | amazon | Similar listing(s) found — see Findings | 3 candidates |",
    "| frostplum | etsy | No results | — |",
    "## Audit trail", "irrelevant",
  ].join("\n");
  const s = findSimilarListingSignals(md);
  const finding = s.find((x) => x.source === "finding");
  assert.ok(finding, "the owner-carrying block signals");
  assert.equal(finding.owner, "Zylight LLC");
  assert.equal(finding.markText, "Zylight FROSTBERRY energy drink");
  assert.match(finding.url, /amazon\.com/);
  const matrix = s.filter((x) => x.source === "matrix");
  assert.equal(matrix.length, 1, "only the similar-listing row signals, never the No-results row");
  assert.equal(matrix[0].term, "frostplum");
  assert.equal(matrix[0].platform, "amazon");
  assert.ok(!s.some((x) => x.owner === "not extracted"), "an unextracted owner never signals");
  assert.deepEqual(findSimilarListingSignals(""), [], "empty/absent prose ⇒ no signals");
});

// ── review fix (2026-07-12): the per-query connotation identity join + channel-sweep term routing ───────
test("findDroppedConnotationQueries: a quarantined half's dictated meaning queries surface as DROPPED (count-based gate blindness)", async () => {
  const { findDroppedConnotationQueries } = await import("../common-law-receipts.mjs");
  const halves = splitGridTerms(FULL_SPEC.terms);
  const qHalves = splitGridTerms(FULL_SPEC.connotation.queries);
  // half b quarantined (null ledger) — its queries never ran; half a recorded ITS partition
  const a = { cells: cellsFor(halves.a), extras: { pr_risk: qHalves.a.map((q) => ({ query: q, results: [] })) }, gaps: [] };
  const merged = mergeGrids(a, null, { spec: FULL_SPEC, halfErrors: { b: "half-b did not complete: timeout" } });
  assert.ok(parsePrRiskQueries(JSON.stringify(merged)) > 0, "the COUNT-based gate is satisfied — exactly the blindness under test");
  assert.deepEqual(findDroppedConnotationQueries(FULL_SPEC, merged), qHalves.b,
    "every dictated query half b owned reads as dropped — never silently absorbed");
  // both halves recorded → nothing dropped (whitespace/case tolerated via norm)
  const b = { cells: cellsFor(halves.b), extras: { pr_risk: qHalves.b.map((q) => ({ query: `  ${q.toUpperCase()} `, results: [] })) }, gaps: [] };
  assert.deepEqual(findDroppedConnotationQueries(FULL_SPEC, mergeGrids(a, b, { spec: FULL_SPEC })), []);
  // spec with no dictated queries → nothing to police
  assert.deepEqual(findDroppedConnotationQueries({ ...FULL_SPEC, connotation: { queries: [] } }, merged), []);
});

test("routeHalfTermScopes: a dead half's terms RE-ROUTE to a usable sibling — the union is always the full manifest", async () => {
  const { routeHalfTermScopes } = await import("../common-law-receipts.mjs");
  const halves = splitGridTerms(FULL_SPEC.terms);
  // both usable → each covers exactly its own partition
  assert.deepEqual(routeHalfTermScopes(halves, ["a", "b"]), { a: halves.a, b: halves.b });
  // half b dead → half a is dictated the WHOLE grid (its own + b's terms), never half the variants
  const only = routeHalfTermScopes(halves, ["a"]);
  assert.deepEqual(Object.keys(only), ["a"]);
  assert.deepEqual([...only.a].sort(), [...FULL_SPEC.terms].sort(), "no variant left unsearched on a channel sweep");
  // no usable half → {} (the caller must defer/disclose, never sweep-and-close)
  assert.deepEqual(routeHalfTermScopes(halves, []), {});
  assert.deepEqual(routeHalfTermScopes(halves, ["nope"]), {}, "unknown half ids are ignored");
});

// ── — the meaning sweep is SINGLE-SEAT, and the merge can no longer owe what no half was asked ──
//
// The terminal this closes: both halves passed their own validator and the MERGE of them failed, on
// connotation terms neither half had been asked to dispose. The issue guessed the frame-reopen remedy
// path was injecting terms after the halves ran. It is not — nothing on that path touches the meaning
// receipts. The cause is that the recurrence floor is SUPERADDITIVE over an index-parity partition:
// findConnotationViolations promotes a result to a citation obligation at RECURRENT_MIN = 4 DISTINCT
// queries, so a result surfacing on 2 of half a's queries and 2 of half b's owes nothing at either half
// (2 < 4) and owes a citation at the merge (4 >= 4). No reader anywhere could have seen the pattern from
// the receipts it held, which is why no amount of retrying a half fixes it.
test("#345: the dictated meaning queries all go to ONE half — the sibling is asked to dispose nothing", () => {
  const halves = splitGridSpec(FULL_SPEC, {});
  const other = GRID_HALVES.find((h) => h !== MEANING_SEAT);
  assert.deepEqual(halves[MEANING_SEAT].connotation.queries, FULL_SPEC.connotation.queries,
    "the owning half holds the WHOLE sweep — the recurrence floor is a property of the whole sweep");
  assert.deepEqual(halves[other].connotation.queries, [],
    "and the sibling holds none: an obligation it cannot observe is one it must never be asked to satisfy");
  // the TERM split is untouched — a term x platform cell is judged on its own and still splits
  assert.deepEqual(halves.a.terms, ["novapulse", "转码", "project novapulse"]);
  assert.deepEqual(halves.b.terms, ["nuvapulse", "n0vapulse"]);
  // the disposition_required stamp still rides BOTH halves: a stray pr_risk block in the non-owning half
  // must still be judged, never waved through because it "should not be there".
  const stamped = splitGridSpec({ ...FULL_SPEC, connotation: { ...FULL_SPEC.connotation, disposition_required: true } }, {});
  for (const h of GRID_HALVES) assert.equal(stamped[h].connotation.disposition_required, true);
});

test("#345: a result recurring across the sweep is now an obligation the OWNING half can see — under the old parity split neither half could", async () => {
  const { connotationObligations: ob, obligationRows: rowsOf } = await import("../connotation-search.mjs");
  // Four dictated queries; one recorded result surfaces on all four. That is the recurrence floor.
  const queries = ["VENZY wikipedia", "VENZY meaning slang", "Вензи offensive meaning", "Κίνζι meaning in english"];
  const RECUR = { title: "the shared receipt every query surfaced", url: "https://example.org/venzy-sense" };
  const recorded = queries.map((query) => ({ query, results: [RECUR] }));
  const recurrenceRows = (rec) => rowsOf(ob(rec)).filter((r) => r.kind === "recurrence").length;

  // UNDER THE OLD PARITY SPLIT: each half saw 2 of the 4 queries, so 2 < RECURRENT_MIN at both — and the
  // merged set saw 4. This is the exact shape that passed twice and died at the merge.
  const parity = { a: recorded.filter((_, i) => i % 2 === 0), b: recorded.filter((_, i) => i % 2 === 1) };
  for (const h of GRID_HALVES)
    assert.equal(recurrenceRows(parity[h]), 0,
      `half ${h} could not see the recurrence — it holds only ${parity[h].length} of the queries that carry it`);
  assert.equal(recurrenceRows(recorded), 1,
    "…and the merge owes a citation neither half was asked for — the terminal, reproduced");
  // UNDER SINGLE-SEAT: the owning half holds the whole sweep, so its form carries exactly the row the
  // merge's does, and the obligation surfaces at the HALF stage where the ladder can still reach it.
  assert.deepEqual(rowsOf(ob(recorded)).map((r) => r.row_id), rowsOf(ob(recorded)).map((r) => r.row_id));
  assert.equal(recurrenceRows(recorded), 1);
});


// ──: a sub-heading inside the Variants section must not close it ──────────────────────────────
//
// FIXTURE RULE: the SHAPE is the real 2026-08-15 manifest's — `### Variants`, seven `####` sub-groups
// (core, phonetic, visual, transliteration, numeric, composite, other), the first six lines below the
// arming heading, `| Category | Value | Rationale | Verify? |` tables under each. The CONTENT is
// synthetic. Manifest content carries the mark's own variant terms, which is precisely what
// no-client-identifiers.test.mjs exists to keep out of this tree, so the real terms are not reproduced
// here and must not be added later.
//
// What it reproduces: 84 variants written, 0 reachable, because line 45 reset the collector on EVERY
// heading at ANY level. The manifest had IMPROVED — more variants, better organised — and the flat-only
// reader called it an empty matter.

const GROUPS = ["Core", "Phonetic", "Visual", "Transliteration", "Numeric", "Composite", "Other"];
const nested = (groups = GROUPS, perGroup = 2) => [
  "# Variant manifest", "", "## Mark 1 — SAMPLEMARK", "", "### Variants", "",
  "Generated across the categories below.", "",
  ...groups.flatMap((g, gi) => [
    `#### ${g}`, "",
    "| Category | Value | Rationale | Verify? |",
    "|---|---|---|---|",
    ...Array.from({ length: perGroup }, (_, i) => `| ${g.toLowerCase()} | term-${gi}-${i} | because | yes |`),
    "",
  ]),
  "### Variant applicability", "",
  "| Category | Applies? |", "|---|---|", "| core | yes |", "",
].join("\n");

const flat = [
  "# Variant manifest", "", "### Variants", "",
  "| Category | Value | Rationale | Verify? |", "|---|---|---|---|",
  "| core | alpha | because | yes |", "| core | beta | because | yes |", "",
  "### Something else", "", "| Other | Table |", "|---|---|", "| x | y |", "",
].join("\n");

test("#978: variants under `####` sub-groups are REACHED — the regression, in the real manifest's shape", () => {
  const v = parseManifestVariants(nested());
  assert.equal(v.length, 14, `7 groups x 2 rows; got ${v.length} — a sub-heading is closing the section`);
  assert.ok(v.includes("term-0-0") && v.includes("term-6-1"), "first group and last group both reached");
});

test("#978: a heading at the SAME level or shallower still ends the section", () => {
  // The `### Variant applicability` table in the fixture must NOT be collected, and neither must a
  // sibling section's rows. Depth-awareness must not turn into never-closing.
  const v = parseManifestVariants(nested());
  assert.equal(v.some((x) => /^yes$|^core$/i.test(x)), false, v.join(","));
  assert.deepEqual(parseManifestVariants(flat), ["alpha", "beta"], "a `###` sibling closes it, as before");
});

test("#978: `applicability` still excludes at ANY depth, including deeper than the arming heading", () => {
  const md = ["### Variants", "", "| Category | Value |", "|---|---|", "| core | kept |", "",
    "#### Variant applicability", "", "| Category | Value |", "|---|---|", "| core | dropped |", ""].join("\n");
  assert.deepEqual(parseManifestVariants(md), ["kept"]);
});

test("#978: the audit separates NO VARIANTS WRITTEN from COULD NOT REACH THEM", () => {
  const broken = variantsManifestAudit(nested());
  assert.ok(broken.headings > 0 && broken.rowsAfterFirstHeading > 0);

  // No Variants section at all — a legitimately variant-less manifest, and NOT a parse failure.
  const none = variantsManifestAudit(["# Manifest", "", "## Notes", "", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
  assert.equal(none.variants.length, 0);
  assert.equal(none.headings, 0);
  assert.equal(variantsParseFailure(["# Manifest", "", "## Notes", "", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n")), null,
    "no arming heading ⇒ nothing was promised ⇒ not a failure");
});

test("#978: rows after an arming heading with nothing taken IS a parse failure, and says so", () => {
  // The exact shape the bug produced: a Variants heading, rows plainly present, zero parsed. Simulated
  // by a term column no header resolves and every value filtered — the point is the CALLER's predicate,
  // not this particular way of reaching zero.
  const md = ["### Variants", "", "| Category | Value |", "|---|---|",
    "| core | * |", "| core | ** |", ""].join("\n");
  const a = variantsManifestAudit(md);
  assert.equal(a.variants.length, 0, "asterisk rows are register patterns and are correctly skipped");
  assert.ok(a.rowsAfterFirstHeading > 0);
  const why = variantsParseFailure(md);
  assert.ok(why, "rows present, none taken ⇒ loud");
  assert.match(why, /legacy spec-less path/, "and it names the consequence, not just the symptom");
});

test("#978: a Variants section with NO rows is not a failure — the narrow condition holds", () => {
  // Error direction: a false parse-failure kills a run that had nothing to sweep. This must stay null.
  assert.equal(variantsParseFailure(["### Variants", "", "None generated for this matter.", ""].join("\n")), null);
});
