// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FORWARDED REPORT CARRIES NO STYLESHEET NOTES, AND PRINTS NO HEADING STRANDED AT A PAGE'S FOOT.
//
// Every report inlined its stylesheet with the developers' comments in it, about 17 KB of internal notes a client
// could read by viewing the source. The page shell now strips comments from the page's own stylesheet as it inlines it;
// the source files keep every one. In print, a section heading could end a page while its content started the next;
// the print rules now keep a section heading with what follows. Measured 2026-11-18 by printing the four demos in
// headless Chrome and reading each page's last line: four stranded headings before, none after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripCssComments } from "../publish/page-shell.mjs";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFindingsJson } from "../findings-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("the strip removes comments and keeps a comment opener that is text, in a string or a url()", () => {
  assert.equal(stripCssComments("a{b:c}/* a note */d{e:f}"), "a{b:c}d{e:f}");
  assert.equal(stripCssComments('.x::before{content:"/* not a note */"}'), '.x::before{content:"/* not a note */"}');
  assert.equal(stripCssComments(".x{content:'it\\'s /*'}"), ".x{content:'it\\'s /*'}");
  assert.equal(stripCssComments("a{background:url(https://h.example/*p.png)}"), "a{background:url(https://h.example/*p.png)}");
  assert.equal(stripCssComments('a{background:url("/*q")}/*z*/'), 'a{background:url("/*q")}');
  assert.equal(stripCssComments("a/**/b{}"), "a b{}", "two tokens a comment separated stay separate");
  assert.equal(stripCssComments("a{}/* never closed"), "a{}");
});

test("a rendered page's own stylesheet holds no comment, and the source keeps its notes", () => {
  const run = join(HERE, "..", "..", "demo", "multi-country-focus-search", "run");
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  const html = renderHtml(parseReport(join(run, "report.md")), v.findings, v.coverage, { runId: "demo" });
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const own = styles.find((s) => s.includes(".wrap{"));
  assert.ok(own, "the page's own stylesheet was not found");
  assert.equal(own.split("/*").length - 1, 0, "the page's stylesheet still carries comments");
  const source = readFileSync(join(HERE, "..", "publish", "templates", "report.css"), "utf8");
  assert.ok(source.split("/*").length - 1 > 20, "the source stylesheet lost its notes");
});

test("in print, a section heading is kept with what follows it", () => {
  const css = readFileSync(join(HERE, "..", "publish", "templates", "report.css"), "utf8");
  const print = css.slice(css.indexOf("@media print{"));
  assert.match(stripCssComments(print), /\.sec,\.sec h2,\.cardhead\{break-after:avoid\}/,
    "the print rules do not keep a section heading, or a card's title row, with its content");
});
