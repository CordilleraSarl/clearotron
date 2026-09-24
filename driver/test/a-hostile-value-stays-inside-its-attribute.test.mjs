// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-hostile-value-stays-inside-its-attribute.test.mjs — a value placed inside a quoted attribute cannot
// close it, and a URL placed inside an href cannot run code.
//
// Code scanning flagged every renderer sink where a value sat between quotes through an `esc` that
// encodes `&`, `<` and `>` and nothing else. One of them was a live breakout, not a hypothetical: an
// evidence line's URLs are found by /https?:\/\/[^\s,|]+/, which admits a `"`, so a cited address ending
// `"onmouseover="…` closed the href and wrote an attribute of its own. And a correctly quoted
// `javascript:` URL is still a link that runs code, which escaping cannot stop.
//
// Driven through the REAL renderers — the client's report, the staff index and the delivery email — with
// the shapes an attacker reaches for: both quote characters, backslashes, `</script>` in its variants, and
// the schemes that execute, including behind the tab, newline and control characters a browser discards
// before it reads a scheme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attrValue, hrefAttr } from "../publish/attr.mjs";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { regenIndex, composeEmailHtml } from "../publish/index.mjs";

// The schemes that run code, in the spellings a browser still reads as that scheme.
const EXECUTING = [
  "javascript:alert(1)", " JavaScript:alert(1)", "java\nscript:alert(1)", "java\tscript:alert(1)",
  "\u0001javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)",
];
const BREAKOUTS = [
  'https://evidence.example/"onmouseover="alert(1)',
  "https://evidence.example/'onmouseover='alert(1)",
  "https://evidence.example/</script><script>alert(1)</script>",
  "https://evidence.example/</SCRIPT ><script>alert(1)</script>",
  'https://evidence.example/a\\"b\\\\c',
];

/** What a page must never contain, whatever it was handed. */
// An ANCHOR is what a reader clicks, so an executing scheme is checked on anchors: the page's own favicon is
// a `data:` link element, and legitimate. Every attribute these renderers write is double-quoted, so a
// breakout is a `"` closing one — a single quote inside a double-quoted attribute is data.
function assertContained(html, where) {
  assert.doesNotMatch(html, /<a\b[^>]*\bhref\s*=\s*["']?\s*(?:java\s*script|data|vbscript)\s*:/i, `${where}: a link runs code`);
  // INSIDE A TAG: a `"` in a link's visible text is harmless; one that ends an attribute and writes a handler is not.
  assert.doesNotMatch(html, /<[^>]*"\s*onmouseover\s*=[^>]*>/i, `${where}: a quote closed an attribute and a handler was written`);
  assert.doesNotMatch(html, /<script>alert\(1\)/i, `${where}: a script element was injected`);
  assert.doesNotMatch(html, /href="null"/, `${where}: a refused link rendered as the word null`);
}

test("hrefAttr: every executing scheme is refused, however it is spelled; http(s) is kept", () => {
  for (const u of EXECUTING) {
    assert.equal(hrefAttr(u), null, `${JSON.stringify(u)} was accepted as a link`);
    assert.equal(hrefAttr(u, { relative: true }), null, `${JSON.stringify(u)} was accepted as a relative link`);
  }
  assert.equal(hrefAttr("https://x.example/a?b=1&c=2"), "https://x.example/a?b=1&amp;c=2");
  assert.equal(hrefAttr("audit.xlsx"), null, "a relative reference is a link only when the caller asks for one");
  assert.equal(hrefAttr("audit.xlsx", { relative: true }), "audit.xlsx");
  for (const u of ["//evil.example/x", "\\\\evil.example\\x"])
    assert.equal(hrefAttr(u, { relative: true }), null, `${u} is an external address by another spelling`);
});

test("attrValue: both quotes, <, > and & are encoded; a backslash is data, not an escape", () => {
  assert.equal(attrValue(`a"b'c<d>e&f\\g`), "a&quot;b&#39;c&lt;d&gt;e&amp;f\\g");
  for (const u of BREAKOUTS) assert.doesNotMatch(hrefAttr(u) ?? "", /["'<>]/, `${u} kept a character that closes the attribute`);
});

// ── the client's report ──────────────────────────────────────────────────────────────────────────────
function parsedOf(reportMd) {
  const dir = mkdtempSync(join(tmpdir(), "hostile-attr-"));
  try { writeFileSync(join(dir, "f.report.md"), reportMd); return parseReport(join(dir, "f.report.md")); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const REPORT = [
  "---", "type: clearance-clearance", "matter: hostile-demo", "title: INVENTED MARK",
  "overall_label: MEDIUM", "overall_badge: l3", "overall_caption: medium overall.",
  "classes: 9", "jurisdiction: United States only", "run: 2026-06-10", "---", "",
  "# Marks", "## Invented Owner", "- one: An invented conflict.", "### The read", "An invented read.",
].join("\n");
const meter = (token) => ({ token, basis: "verified-from-record" });
const finding = (link) => ({
  ordinal: 1, mark: "INVENTED", owner: { name: "Invented Owner", country: "US", registrations: [] },
  composite: 2, level: "B", dispute_type: "paper-conflict",
  meters: { mark_similarity: meter("medium"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("medium") },
  quadrant: { x: 0.5, y: 0.5 }, source: { source_type: "common-law-marketplace", resolved_link: link },
});

test("the report: a finding's source link cannot close its attribute or run code", () => {
  for (const link of [...EXECUTING, ...BREAKOUTS]) {
    const html = renderHtml(parsedOf(REPORT), [finding(link)], [], { runId: "hostile-demo" });
    assertContained(html, `report, source link ${JSON.stringify(link)}`);
  }
  // THE CONTROL: an ordinary link still renders as one. A renderer that dropped every link would pass above.
  const ok = renderHtml(parsedOf(REPORT), [finding("https://evidence.example/record/1")], [], { runId: "hostile-demo" });
  assert.match(ok, /href="https:\/\/evidence\.example\/record\/1"/, "an ordinary http link no longer renders");
});

test("the report: the audit download is a relative file, and nothing else", () => {
  for (const auditFile of [...EXECUTING, '"><script>alert(1)</script>', "//evil.example/audit.xlsx"]) {
    const html = renderHtml(parsedOf(REPORT), [finding("https://evidence.example/r")], [], { runId: "hostile-demo", auditFile });
    assertContained(html, `report, audit file ${JSON.stringify(auditFile)}`);
    assert.doesNotMatch(html, /href="\/\/evil/, "a protocol-relative address became the download");
  }
  const ok = renderHtml(parsedOf(REPORT), [finding("https://evidence.example/r")], [], { runId: "hostile-demo", auditFile: "audit.xlsx" });
  assert.match(ok, /href="audit\.xlsx" download/, "the ordinary download no longer renders");
});

// ── the staff index ──────────────────────────────────────────────────────────────────────────────────
test("the staff index: a client key, run id or badge carrying quotes stays inside its attribute", () => {
  const pool = mkdtempSync(join(tmpdir(), "hostile-index-"));
  try {
    const runId = `tmp1-x-2026-06-15-quote"onmouseover="alert(1)`;
    // A Windows folder name cannot hold a double quote. The index takes the run id from meta.json, not
    // from the folder, so there the folder gets a plain name and the hostile id still reaches the page.
    const folder = process.platform === "win32" ? "tmp1-x-2026-06-15-quote-run" : runId;
    mkdirSync(join(pool, folder));
    writeFileSync(join(pool, folder, "meta.json"), JSON.stringify({
      runId, matter: "TMP", title: "INVENTED", client: "Invented", overall: "MEDIUM", date: "2026-06-15",
      badge: `l3"><script>alert(1)</script>`, customerKey: `key'onmouseover='alert(1)`, codename: "quote-run",
    }));
    regenIndex(pool);
    assertContained(readFileSync(join(pool, "index.html"), "utf8"), "staff index");
  } finally { rmSync(pool, { recursive: true, force: true }); }
});

// ── the delivery email ───────────────────────────────────────────────────────────────────────────────
test("the email: the report and audit links cannot close their attribute or run code", () => {
  const dir = mkdtempSync(join(tmpdir(), "hostile-email-"));
  try {
    const md = join(dir, "report.md");
    writeFileSync(md, REPORT);
    for (const url of [...EXECUTING, ...BREAKOUTS]) {
      const html = composeEmailHtml(md, url, "audit.xlsx", ["Invented Owner"], { email: "table", privileged: true });
      assertContained(html, `email, report url ${JSON.stringify(url)}`);
    }
    const ok = composeEmailHtml(md, "https://portal.example/portal/report/r1", "audit.xlsx", ["Invented Owner"], { email: "table", privileged: true });
    assert.match(ok, /href="https:\/\/portal\.example\/portal\/report\/r1"/, "the ordinary report link no longer renders");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
