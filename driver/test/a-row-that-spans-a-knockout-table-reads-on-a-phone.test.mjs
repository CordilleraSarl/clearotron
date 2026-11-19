// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ON A PHONE, A ROW THAT SPANS A KNOCKOUT TABLE READS WITHOUT SCROLLING SIDEWAYS (e2e, 2026-11-19).
//
// The counts and filings tables are wider than a phone and scroll sideways inside their card. A row spanning a whole
// table, a filing's register record or the counts card's close-variations line, laid out at the table's width: at a
// true 390 px a record entry was 590 px wide and 296 px past the visible card, and the variations line 443 px wide
// and 107 px past. Each scroller is now a size container, and such a row's content takes the scroller's visible
// width and stays at its left edge while the table scrolls beside it. Measured after: 270 px and 288 px wide, 0 px
// past the card, scrolled or not; 1280 px unchanged. A browser measures the layout; this holds the rules and markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("on a phone screen, each sideways scroller is a size container and a spanning row keeps to its visible width", () => {
  const css = readFileSync(join(HERE, "..", "publish", "templates", "knockout.css"), "utf8");
  const phone = css.match(/@media screen and \(max-width:640px\)\{\s*\.ko-scroll\{container-type:inline-size\}\s*([^}]*)\{([^}]*)\}\s*\}/);
  assert.ok(phone, "the phone rules are missing, or reach print or the wider layout");
  assert.deepEqual(phone[1].split(",").map((s) => s.trim()), [".rr-krow td>details", ".ko-forms .ko-formsline"]);
  assert.equal(phone[2], "position:sticky;left:24px;box-sizing:border-box;max-width:calc(100cqw - 48px)");
});

test("the close-variations line sits in a block of its own inside its spanning cell", () => {
  const manifest = parseFrameworkManifest({ schema_version: 1, framework_key: "forms-test", title: "Invented test framework", source_deck: "none",
    entity_label: "the company", bands: [{ label: "Serious", tone: "high" }, { label: "Slight", tone: "low" }],
    structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] } });
  // The public demo's own counts, which carry its close variations.
  const registerCounts = JSON.parse(readFileSync(join(HERE, "..", "..", "demo", "knockout-search", "run", "_driver", "register-counts.json"), "utf8"));
  const html = renderKnockoutHtml({ batch: { overall: "Slight", executiveSummary: "summary" }, marks: [{ name: "VENQORI", rating: "Slight",
    classesSearched: [9], classesDriving: [9], basis: "A basis.", factors: [], counterFactors: [], mitigation: "", bullets: [], purpleNotes: [], findings: [] }] },
  manifest, { runId: "r1", overall: "Slight", probeRan: true, registerCounts });
  const row = html.match(/<tr class="ko-forms"><td colspan="\d+">([\s\S]*?)<\/td><\/tr>/)?.[1];
  if (row === undefined) return assert.fail("the counts card drew no close-variations line for a mark with variant forms");
  assert.match(row, /^<div class="ko-formsline">[^<]+<\/div>$/, "the line is not a block of its own");
});
