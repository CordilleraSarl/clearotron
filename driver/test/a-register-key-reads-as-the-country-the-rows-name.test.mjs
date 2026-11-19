// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REGISTER'S KEY READS AS THE COUNTRY THE ROWS NAME.
//
// The register row's per-country chips printed the register's own keys, so one register read EM on a chip and EU in
// the band rows beside it, and a country the naming table lacked was a bare code on hover too. A key is now read as
// the country (EM as EU, GB as UK, INT as the international line), two keys for one country are one count, and the
// hover names any real country code. Every count here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFindingsJson } from "../findings-model.mjs";

const run = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "demo", "multi-country-focus-search", "run");
const render = (recordsByCountry) => {
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  return renderHtml(parseReport(join(run, "report.md")), v.findings, v.coverage, { runId: "demo", searchDepth: { counts: { recordsByCountry } } });
};
const chips = (html) => [...html.matchAll(/<span class="wchip" title="([^"]*)">([^ <]+) <b>([\d,]+)<\/b><\/span>/g)].map((m) => [m[2], m[3], m[1]]);

test("register keys fold into the country they name, and each chip's hover names it", () => {
  const html = render({ EM: 3, EU: 2, GB: 1, AR: 4, INT: 6, WO: 1 });
  assert.deepEqual(chips(html), [["EU", "5", "European Union"], ["AR", "4", "Argentina"], ["UK", "1", "United Kingdom"]]);
  assert.match(html, /10 records read across 3 countries, plus 7 international registrations/, "the line counts the folded keys");
});

test("one country left after folding is named in the line, with no chips", () => {
  const html = render({ EM: 3, EU: 2 });
  assert.match(html, /5 records read in European Union/);
  assert.deepEqual(chips(html), []);
});
