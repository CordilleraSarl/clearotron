// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The "Web and marketplace names" list under "Also considered": every name its header counts is printed, a row links only
// addresses, and a block that names no place is not a name.
//
// Measured on the two public demos replayed through the publisher, 2026-11-25: both headers read "9 names" and printed 8
// rows with nothing pointing at the ninth; one row's link, text and target alike, was the sentence "See cell-level
// receipts below"; and three rows' targets were whole Markdown links, so the row showed the brackets and the press led
// nowhere. The links also opened in the page's own tab, where the page's other evidence links open a new one.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.CLEAROTRON_MCP_URL ||= "https://mcp.test/mcp";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { webAddresses, clearedNames } from "../publish/search-depth.mjs";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));

test("a url value gives the http(s) addresses it holds, and a sentence gives none", () => {
  assert.deepEqual(webAddresses("https://brisandor.example/"), ["https://brisandor.example/"]);
  assert.deepEqual(webAddresses("https://brisandor.example/ ; https://quellmont.example/features"),
    ["https://brisandor.example/", "https://quellmont.example/features"]);
  assert.deepEqual(webAddresses("[Brisandor platform](https://brisandor.example/platform)"), ["https://brisandor.example/platform"]);
  assert.deepEqual(webAddresses("[Quellmont developer page](https://apps.example/dev/quellmont/id1); [Brisandor page](https://apps.example/dev/brisandor/id2)"),
    ["https://apps.example/dev/quellmont/id1", "https://apps.example/dev/brisandor/id2"]);
  // A Markdown link the model left unclosed still gives its address.
  assert.deepEqual(webAddresses("[Press release](https://news.example/brisandor.html"), ["https://news.example/brisandor.html"]);
  assert.deepEqual(webAddresses("See cell-level receipts below"), []);
  assert.deepEqual(webAddresses(""), []);
  assert.deepEqual(webAddresses("https://brisandor.example/ and https://brisandor.example/"), ["https://brisandor.example/"], "an address twice is one link");
});

const AUDIT = `# Negative Results

## A trading name on a marketplace
- source_layer: Common-law
- url: https://shop.example/brisandor
- description: A seller trades under a near name.

## Two names on one developer page
- source_layer: Common-law
- url: [Quellmont developer page](https://apps.example/dev/quellmont/id1); [Brisandor developer page](https://apps.example/dev/brisandor/id2)
- description: Two near names.

## No confirmed directly conflicting app identified.
- source_layer: Common-law
- type: No direct conflict surfaced
- url: See cell-level receipts below
- description: Candidates were platform pages.

## A name the run's own search record backs
- source_layer: Common-law
- url: common-law-grid.json
- description: Backed by the run's ledger.
`;

test("a block whose url names no place is not a name; the run's own search record still is", () => {
  const { web } = clearedNames(AUDIT);
  assert.deepEqual(web.map((w) => w.title), ["A trading name on a marketplace", "Two names on one developer page", "A name the run's own search record backs"],
    "the note with a sentence for its url was listed as a name, or a name was lost");
  assert.deepEqual(web[1].links, ["https://apps.example/dev/quellmont/id1", "https://apps.example/dev/brisandor/id2"]);
  assert.equal(web[2].runRecord, true);
  assert.deepEqual(web[2].links, []);
  assert.ok(web.every((w) => typeof w.url === "string" && w.url), "the url as written is kept beside the links");
});

/** The web names list's rows and header count, as the rendered page draws them. */
function webList(html) {
  const start = html.indexOf('Web and marketplace names</span>');
  assert.ok(start >= 0, "the rendered page has no web and marketplace names list, so nothing below would be checked");
  const end = html.indexOf('</details>', start);
  const block = html.slice(start, end);
  const count = Number((block.match(/<span class="gcount">(\d+)/) || [])[1]);
  const rows = block.split('<div class="crow">').slice(1);
  const anchors = [...block.matchAll(/<a ([^>]*)>/g)].map((m) => m[1]);
  return { count, rows, anchors };
}

function renderWith(web) {
  const dir = mkdtempSync(join(tmpdir(), "clearotron-webnames-"));
  const path = join(dir, "f.report.md");
  writeFileSync(path, "# Clearance read\n\n## Overall\n\nMEDIUM\n\n## What we found\n\nNothing notable.\n");
  let parsed;
  try { parsed = parseReport(path); } finally { rmSync(dir, { recursive: true, force: true }); }
  return renderHtml(parsed, [], [], { runId: "webnames", searchDepth: { cleared: { register: [], web, groups: {} }, counts: {} } });
}

test("every name the header counts is printed, and every link is an address that opens in a new tab", () => {
  // Twelve names: more than the eight the list used to stop at.
  const many = Array.from({ length: 12 }, (_, i) => `## Brisandor${i} kit\n- source_layer: Common-law\n- url: [Brisandor${i}](https://shop.example/${i})\n`).join("\n");
  const { web } = clearedNames(`# Negative Results\n\n${many}\n${AUDIT.split("\n").slice(2).join("\n")}`);
  const { count, rows, anchors } = webList(renderWith(web));
  assert.equal(count, 15, "the header counts something other than the twelve names and three blocks that are names");
  assert.equal(rows.length, count, "the header and the rows disagree");
  for (let i = 0; i < 12; i++) assert.ok(rows.some((r) => r.includes(`Brisandor${i} kit`)), `name ${i + 1} is counted and not printed`);
  assert.ok(!rows.some((r) => r.includes("See cell-level receipts")), "a note is printed as a name");
  assert.ok(anchors.length >= 14, "the rows' addresses were not linked");
  for (const a of anchors) {
    const href = (a.match(/href="([^"]*)"/) || [])[1] ?? "";
    assert.match(href, /^https?:\/\/[^\s[\]()]+$/, `a link's target is not an address: ${href}`);
    assert.match(a, /target="_blank"/, "a link opens in the page's own tab");
    assert.match(a, /rel="noopener noreferrer"/, "a new-tab link without noopener noreferrer");
  }
});

// THE PUBLIC DEMOS ARE THE CASE THE DEFECT WAS MEASURED ON. Their own audits, read and drawn as the publisher draws them.
for (const demo of ["global-preliminary-search", "multi-country-focus-search"]) {
  test(`the ${demo} demo's list counts what it prints, and links only addresses`, () => {
    const { web } = clearedNames(readFileSync(at(`../../demo/${demo}/run/audit.md`), "utf8"));
    const { count, rows, anchors } = webList(renderWith(web));
    assert.ok(count > 0, "the demo lists no names, so nothing below was checked");
    assert.equal(rows.length, count, "the header and the rows disagree");
    for (const a of anchors) {
      const href = (a.match(/href="([^"]*)"/) || [])[1] ?? "";
      assert.match(href, /^https?:\/\/[^\s[\]()]+$/, "a link's target is a sentence or Markdown");
    }
  });
}
