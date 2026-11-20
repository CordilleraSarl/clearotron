// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CONFLICTS BELOW THE RISK SIT BEHIND ONE CLOSED HEADING (owner, 2026-11-18).
//
// A report printed every conflict as a full card, however far below its risk the conflict sat. Full cards now stay for the conflicts in the band that sets the risk, the highest band any
// conflict holds on the framework's own ladder. The rest render as compact cards, unticked for export, behind one
// closed heading with their count in his words, "{N} more conflicts rated {band}", each band below the risk named
// and joined by "or", and "1 more conflict rated {band}" for one (owner, 2026-11-19). A conflict with no band on the
// ladder keeps its full card, and a run with no framework renders every card in full. The export leaves
// the heading out of the PDF when none of its cards is ticked. The demo is the public one; the rest is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFindingsJson } from "../findings-model.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "..", "..", "demo", "global-preliminary-search", "run");
const FRAMEWORK = parseFrameworkManifest(JSON.parse(readFileSync(join(RUN, "_driver", "framework.json"), "utf8")));
const fullCards = (html) => [...html.matchAll(/<div class="card" id="c(\d+)">/g)].map((m) => Number(m[1]));
const lower = (html) => html.match(/<details class="rgroup lowerband"><summary><span class="gname">([^<]*)<\/span><\/summary><div class="gbody">([\s\S]*?)\n  <\/div><\/details>/);

test("on the demo, the two Moderate conflicts keep full cards and the seven Manageable ones sit behind the heading, unticked", () => {
  const v = parseFindingsJson(readFileSync(join(RUN, "findings.json"), "utf8"));
  const html = renderHtml(parseReport(join(RUN, "report.md")), v.findings, v.coverage, { runId: "demo", framework: FRAMEWORK });
  assert.deepEqual(fullCards(html), [1, 2], "the full cards are not the two that set the risk");
  const section = lower(html);
  assert.ok(section, "the closed heading is missing, or opens");
  assert.equal(section[1], "7 more conflicts rated Manageable");
  const compact = [...section[2].matchAll(/<div class="card compact" id="c(\d+)">/g)].map((m) => Number(m[1]));
  assert.deepEqual([...compact].sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 9], "the compact cards are not the seven below the risk");
  assert.equal((section[2].match(/<input type="checkbox" class="pickbox" aria-label/g) ?? []).length, 7, "a card below the risk is ticked for export");
  assert.equal((html.match(/<input type="checkbox" class="pickbox" checked/g) ?? []).length, 2, "a card that sets the risk is not ticked");
});

const REPORT = (() => {
  const dir = mkdtempSync(join(tmpdir(), "lower-band-"));
  try {
    writeFileSync(join(dir, "r.report.md"), ["---", "type: clearance-clearance", "matter: lower-band", "title: OSTREVIN",
      "overall_label: MEDIUM", "overall_badge: l3", "classes: 9", "jurisdiction: European Union", "run: 2026-11-19", "---", ""].join("\n"));
    return parseReport(join(dir, "r.report.md"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();
const conflict = (ordinal, band) => ({ ordinal, mark: `SKARVEL ${ordinal}`, band, disposition: "adversarial", composite: 3,
  net: "A sentence.", owner: { name: `Owner ${ordinal}`, registrations: [] } });
const render = (findings, opts = {}) => renderHtml(REPORT, findings, [], { runId: "lower-band", framework: FRAMEWORK, ...opts });

test("several bands below the risk are each named, joined by or, in the ladder's order", () => {
  const html = render([conflict(1, "High"), conflict(2, "Manageable"), conflict(3, "Moderate"), conflict(4, "Moderate")]);
  assert.deepEqual(fullCards(html), [1]);
  assert.equal(lower(html)?.[1], "3 more conflicts rated Moderate or Manageable");
});

test("a single conflict below the risk folds under the singular heading", () => {
  const one = render([conflict(1, "Moderate"), conflict(2, "Manageable")]);
  assert.deepEqual(fullCards(one), [1], "a lone conflict below the risk kept its full card");
  assert.equal(lower(one)?.[1], "1 more conflict rated Manageable");
  assert.match(lower(one)?.[2] ?? "", /<div class="card compact" id="c2">/, "the lone conflict is not the compact card under the heading");
});

test("an unrated conflict and a run with no framework keep full cards", () => {
  const unrated = render([conflict(1, "Moderate"), conflict(2, "Manageable"), conflict(3, "Manageable"), conflict(4, null)]);
  assert.ok(fullCards(unrated).includes(4), "a conflict with no band was folded");
  assert.equal(lower(unrated)?.[1], "2 more conflicts rated Manageable");
  const legacy = renderHtml(REPORT, [conflict(1, "Moderate"), conflict(2, "Manageable"), conflict(3, "Manageable")], [], { runId: "lower-band" });
  assert.doesNotMatch(legacy, /<details class="rgroup lowerband">/, "a run with no framework folded its conflicts");
});

test("the export leaves the heading out of the PDF when none of its cards is ticked", () => {
  const html = render([conflict(1, "Moderate"), conflict(2, "Manageable"), conflict(3, "Manageable")]);
  const exportPdf = html.match(/function exportPDF\(\)\{[^\n]*\}/)?.[0] ?? "";
  assert.match(exportPdf, /querySelectorAll\('details\.lowerband'\)\.forEach\(function\(d\)\{if\(!d\.querySelector\('\.card:not\(\.print-hidden\)'\)\)\{d\.classList\.add\('print-hidden'\);_hidden\.push\(d\);\}\}\)/,
    "the export does not hide a heading whose cards are all unticked");
  assert.ok(exportPdf.indexOf("details.lowerband") > exportPdf.indexOf("card.classList.add('print-hidden')"), "the heading is judged before its cards are hidden");
});
