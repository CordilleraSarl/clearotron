// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A web or marketplace hit reads as a hit on the workbook's "What was searched" sheet.
//
// THE DEFECT. The search log writes an executed grid cell that came back with candidates as
// "<n> candidates reviewed" (gridNegativeRows, audit-from-spine.mjs). The sheet decided a hit with a
// pattern that did not match that wording, so every such term read "0 — clean", "No conflict" and "no
// listing found": three claims that a search came back empty, for a search that surfaced listings. The
// committed demo audits carried 486, 289 and 180 such cells, and every one of their terms read as clean.
//
// THE PATH IS DRIVEN WHOLE: the grid cell, the log the builder writes from it, that log read back as a
// republish reads it, and the row the sheet writes. A test that handed the sheet a retyped result string
// would keep passing against a writer that had changed its words.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAuditMd } from "../publish/audit-from-spine.mjs";
import { parseAudit } from "../publish/parse.mjs";
import { searchRows } from "../publish/xlsx.mjs";

const dir = mkdtempSync(join(tmpdir(), "web-hit-rows-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const REGISTER_MD = [
  "## Negative results", "", "| Search Term / Variant | Platform / Source / Provider | Result | Notes |", "|---|---|---|---|",
  "| SKELDOVAN | Register (EU) | No conflict | exact sweep |", "",
].join("\n");

const cell = (term, platform, n) => ({ term, platform, status: n ? "hit" : "no_hit",
  candidates: Array.from({ length: n }, (_, i) => ({ title: `listing ${i + 1}`, url: `https://${platform}/item/${i + 1}` })) });

let seq = 0;
/** The common-law rows of the sheet, keyed by term, built the way a republish builds them. */
function commonLawRows(grid, findings = []) {
  const { md } = buildAuditMd(REGISTER_MD, "", { commonLawGrid: grid });
  const path = join(dir, `audit-${++seq}.md`);
  writeFileSync(path, md);
  const rows = searchRows(parseAudit(path), { findings });
  const start = rows.findIndex((r) => r._section && /^COMMON-LAW/.test(r["Search term / variant"]));
  assert.ok(start >= 0, "the sheet has a common-law block");
  return Object.fromEntries(rows.slice(start + 1).filter((r) => !r._section).map((r) => [r["Search term / variant"], r]));
}

test("a term whose grid cell found candidates reads as a hit, never as clean", () => {
  const rows = commonLawRows({ cells: [cell("SKELDOVAN", "shop.example", 3), cell("SKELDOVAN", "apps.example", 0), cell("SKELDOVANE", "shop.example", 0)] });
  const hit = rows.SKELDOVAN;
  assert.equal(hit.Result, "similar listing(s) found");
  assert.equal(hit.Outcome, "Reviewed — not carried as a conflict", "listings no finding carries are reviewed, not clean");
  assert.match(hit.Note, /^Checked across ~2 surfaces; listing\(s\) reviewed, none carried as a separate conflict/);
  assert.doesNotMatch(`${hit.Result} ${hit.Outcome} ${hit.Note}`, /clean|No conflict|no listing found/, "not one of the three clean claims survives");
  // The term beside it came back empty on every surface, and still says so.
  assert.deepEqual([rows.SKELDOVANE.Result, rows.SKELDOVANE.Outcome], ["0 — clean", "No conflict"]);
});

test("one candidate is a hit too", () => {
  const rows = commonLawRows({ cells: [cell("SKELDOVAN", "shop.example", 1)] });
  assert.equal(rows.SKELDOVAN.Result, "similar listing(s) found");
  assert.notEqual(rows.SKELDOVAN.Outcome, "No conflict");
});

test("a hit whose term a finding carries goes to Findings", () => {
  const rows = commonLawRows({ cells: [cell("SKELDOVAN", "shop.example", 2)] }, [{ mark: "SKELDOVAN" }]);
  assert.equal(rows.SKELDOVAN.Outcome, "→ Findings");
  assert.match(rows.SKELDOVAN.Note, /similar listing\(s\) surfaced → see Findings/);
});

test("a run with no hits writes the rows it always wrote", () => {
  const rows = commonLawRows({
    cells: [cell("SKELDOVAN", "shop.example", 0), cell("SKELDOVAN", "apps.example", 0), cell("SKELDOVANE", "shop.example", 0)],
    gaps: [{ term: "SKELDOVANE", platform: "market.example", error: "HTTP 503" }],
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, [r.Result, r.Outcome, r.Note]])),
    {
      SKELDOVAN: ["0 — clean", "No conflict", "Checked across ~2 surfaces; no listing found"],
      SKELDOVANE: ["0 — clean on 1 of 2", "No conflict — partial",
        "Checked across ~1 surface; no listing found 1 surface could not be searched (market.example) — this term is NOT closed across them. The surface gave a reason: market.example — 503."],
    },
  );
});

test("the committed demo audits: every term with a reviewed candidate reads as a hit", () => {
  let terms = 0;
  for (const demo of ["full-country-search", "global-preliminary-search", "multi-country-focus-search"]) {
    const audit = parseAudit(join(import.meta.dirname, "..", "..", "demo", demo, "run", "audit.md"));
    const hitTerms = new Set(audit.negatives
      .filter((n) => n.source_layer === "Common-law" && /^\d+ candidates? reviewed$/.test(String(n.result ?? "").trim()))
      .map((n) => String(n.search_term).trim()));
    assert.ok(hitTerms.size > 0, `${demo}: the demo's log carries reviewed candidates — an empty set would pass this test by absence`);
    const rows = searchRows(audit, {});
    const start = rows.findIndex((r) => r._section && /^COMMON-LAW/.test(r["Search term / variant"]));
    for (const r of rows.slice(start + 1)) {
      if (r._section || !hitTerms.has(r["Search term / variant"])) continue;
      terms++;
      assert.equal(r.Result, "similar listing(s) found", `${demo}: a term with reviewed candidates`);
      assert.doesNotMatch(r.Outcome, /^No conflict/, `${demo}: a term with reviewed candidates`);
    }
  }
  assert.equal(terms, 27 + 17 + 10, "every hit term of the three demos was read");
});
