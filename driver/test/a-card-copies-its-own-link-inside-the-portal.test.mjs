// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// COPY LINK (owner, 2026-11-25). Inside the portal, each full conflict card offers "Copy link" beside "Ask AI about this
// finding". The page sits in a null-origin frame and knows neither the portal's address nor its clipboard, so a press
// asks the portal, naming the card by its id, and the portal answers whether the copy landed. A report opened by itself
// never shows the control, and it never prints. Checked end to end in headless Chrome with a stand-in parent page; these
// arms hold the markup, the bridge's two halves and their run against a small stand-in for the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { prepareReportForEmbed } from "../portal-report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "..", "..", "demo", "global-preliminary-search", "run");
const FRAMEWORK = parseFrameworkManifest(JSON.parse(readFileSync(join(RUN, "_driver", "framework.json"), "utf8")));
const REPORT = (() => {
  const dir = mkdtempSync(join(tmpdir(), "copy-link-"));
  try {
    writeFileSync(join(dir, "r.report.md"), ["---", "type: clearance-clearance", "matter: copy-link", "title: OSTREVIN",
      "overall_label: MEDIUM", "overall_badge: l3", "classes: 9", "jurisdiction: European Union", "run: 2026-11-26", "---", ""].join("\n"));
    return parseReport(join(dir, "r.report.md"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();
const conflict = (ordinal, band) => ({ ordinal, mark: `SKARVEL ${ordinal}`, band, disposition: "adversarial", net: "A sentence.",
  owner: { name: `Owner ${ordinal}`, registrations: [] } });
const html = renderHtml(REPORT, [conflict(1, "Moderate"), conflict(2, "Manageable")], [], { runId: "copy-link", framework: FRAMEWORK });

test("a full card carries Copy link left of Ask AI, hidden and unprinted; a compact card carries none", () => {
  const full = html.match(/<div class="card" id="c1">[\s\S]*?<button class="ask-fi no-print">/)?.[0] ?? "";
  assert.match(full, /<button type="button" class="copy-fi no-print" data-copied="Copied">[\s\S]*?<span>Copy link<\/span><\/button><button class="ask-fi no-print">$/,
    "the full card's Copy link is missing, not left of Ask AI, or not kept off paper");
  const compact = html.match(/<div class="card compact" id="c2">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
  assert.ok(compact, "the lower-rated conflict draws no compact card, so nothing below was checked");
  assert.doesNotMatch(compact, /copy-fi/, "a compact card in the list carries Copy link");
  const css = readFileSync(join(HERE, "..", "publish", "templates", "report.css"), "utf8");
  assert.match(css, /\.copy-fi\{display:none;/, "the control shows in a report opened by itself");
  assert.match(css, /html\.rep-portal \.copy-fi\{display:inline-flex\}/, "the portal's mark does not show the control");
});

test("the bridge marks the page only when framed, asks the portal with the card's id, and shows the tick only on a landed copy", () => {
  const served = prepareReportForEmbed(html);
  const page = typeof served === "string" ? served : served.html;
  assert.match(page, /if\(framed\)\{\s*try\{document\.documentElement\.classList\.add\('rep-portal'\);\}/, "the page is marked inside the portal unconditionally, or not at all");
  assert.match(page, /parent\.postMessage\(\{source:TAG,type:'copyLink',card:id,ordinal:ord,markIndex:/, "the press does not ask the portal by the card's id");
  assert.match(page, /if\(d\.command==='copied'\)\{\s*if\(copyBtn&&d\.value===true&&copyLive\)\{/, "the tick shows on a failed copy too");
});
