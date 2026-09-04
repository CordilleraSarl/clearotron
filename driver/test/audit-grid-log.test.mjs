// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Item 33 — the workbook's common-law search log comes from the MACHINE RECORD.
//
// It used to come from a heading regex over the model's prose. already found one way that loses rows
// (the jx lane writes its per-term log under a heading the tagger does not match) and made the workbook
// DISCLOSE the shortfall rather than certify it. Disclosure was the right first move; this is the fix.
// A heading is a presentation choice, `common-law-grid.json` is the record.
//
// The BUILDER and not audit.md, per the ruling: buildAuditMd runs on every republish, so an
// already-delivered run gets its search log repaired the next time its workbook is built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gridNegativeRows, buildAuditMd } from "../publish/audit-from-spine.mjs";
import { searchRows } from "../publish/xlsx.mjs";
import { STAGES, chainEntries, REGISTER_AXES } from "../stages.mjs";

// The cell shape the grid tool actually writes (archived R2 test run): {term, platform, status, candidates[]}
// plus gaps[] as "<term> | <platform> | <error>".
const GRID = {
  cells: [
    { term: "VENZY", platform: "ema.europa.eu", status: "hit", candidates: [{ title: "A", url: "https://ema/1" }, { title: "B", url: "https://ema/2" }] },
    { term: "VENZY", platform: "animaldrugsatfda.fda.gov", status: "no_hit", candidates: [] },
    { term: "VENZI", platform: "apps.apple.com", status: "no_hit", candidates: [] },
  ],
  gaps: ["VENZY | reddit.com | 429 after two retries"],
};

test("item 33 — every grid cell becomes a search-log row, hits and no-hits alike", () => {
  const rows = gridNegativeRows(GRID);
  assert.equal(rows.length, 4, "three cells and the gap — a query that errored is part of what was searched");
  assert.deepEqual(rows.map((r) => r.source_layer), ["Common-law", "Common-law", "Common-law", "Common-law"]);
  assert.deepEqual(rows.map((r) => r.platform), ["ema.europa.eu", "animaldrugsatfda.fda.gov", "apps.apple.com", "reddit.com"]);
  assert.equal(rows[0].result, "2 candidates reviewed");
  assert.equal(rows[1].result, "No relevant result");
  assert.equal(rows[3].result, "Could not be searched", "an errored query says so; leaving it out is how a short log reads as complete");
  assert.equal(rows[3].notes, "429 after two retries");
});

test("item 33 — an EMPTY machine record yields an empty log, never a silent re-read of the prose", () => {
  const rows = gridNegativeRows({ cells: [], gaps: [] });
  assert.deepEqual(rows, [], "an empty grid is a fact");
  assert.notEqual(rows, null, "…and it must not signal 'fall back to the tables' — that is absence reading as coverage");
});

test("item 33 — no grid (or an unreadable one) falls back to the prose tables, which is honest for a pre-grid run", () => {
  assert.equal(gridNegativeRows(null), null);
  assert.equal(gridNegativeRows("{not json"), null);
  assert.equal(gridNegativeRows({ nope: true }), null, "a parsed object with no cells[] is not a grid");
});

test("item 33 — buildAuditMd uses the grid instead of the common-law tables when one is supplied", () => {
  const registerMd = [
    "## Findings", "", "| Mark | Owner | Classes | Status | Notes |", "|---|---|---|---|---|",
    "| VENZAL | Muster Handels GmbH & Co. KG | 5 | Registered | prior right |", "",
    "## Negative results", "", "| Search Term / Variant | Platform / Source / Provider | Result | Notes |", "|---|---|---|---|",
    "| VENZY | Register (EU) | No conflict | exact sweep |", "",
  ].join("\n");
  // The common-law spine's own table sits under a heading the tagger DOES match, so if the grid were
  // ignored this row would appear — which is exactly what makes this a real check rather than a tautology.
  const commonLawMd = [
    "## Initial Grid Negative Results", "", "| Variant | Channel | Result | Receipt |", "|---|---|---|---|",
    "| ONLY-IN-THE-PROSE | somewhere.example | nothing | r |", "",
  ].join("\n");

  const withGrid = buildAuditMd(registerMd, commonLawMd, { commonLawGrid: GRID });
  assert.ok(!withGrid.md.includes("ONLY-IN-THE-PROSE"), "the prose table is not consulted when the record is in hand");
  assert.ok(withGrid.md.includes("ema.europa.eu"), "…and the grid's own cells are what the log carries");
  assert.ok(withGrid.md.includes("reddit.com"), "…including the query that could not be run");

  const withoutGrid = buildAuditMd(registerMd, commonLawMd, {});
  assert.ok(withoutGrid.md.includes("ONLY-IN-THE-PROSE"),
    "a run with no machine record still gets its prose log — this is a fallback for pre-grid archives, not a mask");
});

// ── issue — the model-failover chain is DELETED, and stays deleted ──────────────────────────────
// It began as item 24's honesty fix: a comment pinned so it could not drift back to describing an inert
// mechanism as a working one. The mechanism is now gone rather than described, so the pin is stronger —
// it asserts the deletion instead of the sentence.
//
// What was deleted: chainEntries() returned exactly ONE entry for every stage on both shipped engines
// (no stage def set `fallback`; the cross-provider tail's engine gate was never true), so the second rung,
// the `failover` and `chain-exhausted` events, the WS1c front-matter stamp and the report's "Model
// failover:" line were all unreachable. It was deleted rather than armed: untested code firing for the
// first time mid-production-failure, and a silent mid-run model swap changing which model judges inside
// one matter. The retry ladder is the whole failure story.
//
// This is the mechanical guard for "no code path can render a failover note into a report". It reads the
// three driver files that carried the chain. The MCP surfaces (mcp-server/) are deliberately NOT read:
// they parse `failover` events out of ARCHIVED runs' run.jsonl and degrade to null, and retiring that
// response shape is a separate decision.
test("#235 — no driver source can write or render a failover note", () => {
  for (const f of ["../pipeline.mjs", "../stages.mjs", "../publish/index.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    // strip comments: the deletion is recorded in prose in all three files, and that prose must be
    // free to say the word. Only executable text is asserted on. NOTE the stripper handles FULL-LINE
    // `//` comments and block comments — a TRAILING `// … failover …` on a code line reads as
    // executable and fails this test. That direction is safe (over-strict, never permissive); if it
    // trips you, move the comment onto its own line rather than loosening the pin.
    const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/failover/i.test(code), `${f} still carries executable failover code`);
    assert.ok(!/Model failover/.test(code), `${f} can still render a "Model failover" line`);
  }
});

// …and the resolver it collapsed to returns exactly one model per stage, never a chain.
test("#235 — chainEntries resolves ONE model for every stage, on any engine", () => {
  for (const engine of ["anthropic-agent", "openai-agent", ""]) {
    const prior = process.env.CLEAROTRON_AI;
    process.env.CLEAROTRON_AI = engine;
    try {
      for (const name of Object.keys(STAGES)) {
        const entries = chainEntries(name, REGISTER_AXES[0]);
        assert.equal(entries.length, 1, `${name} on ${engine || "(unset)"} resolved ${entries.length} models, not 1`);
        assert.ok(entries[0].model, `${name} resolved no model`);
      }
    } finally { if (prior === undefined) delete process.env.CLEAROTRON_AI; else process.env.CLEAROTRON_AI = prior; }
  }
});

// ── · a search that could not run must never render as one that ran clean ───────────────────────
//
// The workbook is the document a reviewing lawyer relies on to answer "what was searched". Two places in
// xlsx.mjs turned "this could not be searched" into "this was searched and found nothing": the common-law
// `anyHit` boolean, which collapsed searched-empty and errored into one arm, and outcomeFor's
// `return 'No conflict'` fall-through, which handed the most reassuring answer to any shape it did not
// recognise. made the run's own receipt honest about that difference; this is the surface that
// flattened it again on the way to the reader.

const rowsFor = (grid) => searchRows({ negatives: gridNegativeRows(grid) }, {});
const termRow = (grid) => rowsFor(grid).find((r) => !r._section && /VENZY/.test(r["Search term / variant"] ?? ""));

test("#312: gridNegativeRows types WHETHER the query ran, instead of only phrasing it", () => {
  const rows = gridNegativeRows(GRID);
  const gap = rows.find((r) => r.platform === "reddit.com");
  assert.equal(gap.not_searched, "yes", "the gaps[] arm was already known here — it was thrown away into prose");
  for (const r of rows.filter((x) => x.platform !== "reddit.com")) {
    assert.ok(!r.not_searched, "an executed cell carries no marker, so the key means one thing only");
  }
});

test("#312: the marker survives the markdown round-trip, which a boolean could not", () => {
  // The serialiser writes a key only `if (v)` and parse.mjs reads every value back as a string, so
  // `searched: false` would never be written and `searched: true` would return as "true". A truthy
  // marker is the one shape that comes back unchanged — and the workbook reads audit.md, not the grid.
  const { md } = buildAuditMd("# Register findings\n", "", { commonLawGrid: GRID });
  assert.match(md, /- not_searched: yes/);
  assert.equal((md.match(/- not_searched: yes/g) ?? []).length, 1, "exactly the one gapped row carries it");
});

test("#312: an OBJECT-shaped gap produces a row — it used to produce none at all", () => {
  // Two writers, two shapes: jx-units.mjs writes the pipe string, common-law-receipts.mjs writes the
  // object. The object stringified to "[object Object]", split to one part, and hit the length guard —
  // so an unrunnable query VANISHED rather than rendering wrong, which is the same failure one step back.
  const rows = gridNegativeRows([{ cells: [], gaps: [{ term: "VENZY", platform: "etsy.com", error: "provider 503" }] }]);
  assert.equal(rows.length, 1, `the object-form gap is a row: ${JSON.stringify(rows)}`);
  assert.equal(rows[0].platform, "etsy.com");
  assert.equal(rows[0].not_searched, "yes");
  assert.match(rows[0].notes, /503/, "and it keeps the reason it could not run");
});

test("#312: a term whose only surface errored is NOT rendered as clean", () => {
  const row = termRow([{ cells: [], gaps: ["VENZY | etsy.com | provider 503 on both attempts"] }]);
  assert.ok(row, "the term is listed");
  assert.doesNotMatch(row.Result, /clean/i, "never '0 — clean' for a search that did not run");
  assert.notEqual(row.Outcome, "No conflict", "and never a bare closure claim beside it");
  assert.match(row.Outcome, /not searched/i);
});

test("#312: a partly-gapped term says both halves — the clean surfaces AND the ones that never ran", () => {
  // The dedup unions results across platforms, so one gapped surface among many used to disappear.
  const row = termRow([{
    cells: [
      { term: "VENZY", platform: "amazon.com", status: "no_hit", candidates: [] },
      { term: "VENZY", platform: "ebay.com", status: "no_hit", candidates: [] },
    ],
    gaps: ["VENZY | etsy.com | provider 503"],
  }]);
  assert.match(row.Outcome, /partial/i, "a partial sweep is not a closure");
  assert.match(row.Note, /could not be searched/i, "the note says how many surfaces were missed");
  assert.match(row.Note, /etsy\.com/, "…and which");
});

test("#312: a fully clean term is unchanged — annotating every clean row teaches the reader to skip it", () => {
  const row = termRow([{ cells: [{ term: "VENZY", platform: "amazon.com", status: "no_hit", candidates: [] }], gaps: [] }]);
  assert.equal(row.Result, "0 — clean");
  assert.equal(row.Outcome, "No conflict");
});

test("#312: outcomeFor has no reassuring fall-through — an unrecognised Result is not a closure claim", () => {
  const reg = (result) => searchRows({ negatives: [{ source_layer: "Register", search_term: "VENZY", platform: "vendor", result, notes: "" }] }, {})
    .find((r) => !r._section).Outcome;
  // The four not-searched phrasings the register spine actually emits — an open vocabulary, which is why
  // the register arm still needs the prose fallback the typed grid rows do not.
  for (const said of ["NOT SEARCHED — receipt `deferred`, never a negative",
                      "NOT SEARCHED — provider-rejected on both attempts; never a negative",
                      "not executed — coverage-limited (see ledger)",
                      "Could not be searched"]) {
    assert.match(reg(said), /not searched/i, `must not read as a closure: ${said}`);
  }
  assert.equal(reg("0 — clean"), "No conflict", "a genuine empty sweep still says so");
  assert.equal(reg("nothing relevant"), "No conflict");
  assert.equal(reg("some shape this file has never seen"), "Recorded — read the Result",
    "the old fall-through answered 'No conflict' to anything it did not recognise");
});
