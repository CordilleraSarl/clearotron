#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What does the EXPORTED PDF actually show? Ask a browser under print media, not a regex.
//
//   node scripts/report-print-check.mjs [--keep]
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
//
// The exported PDF is the client-facing document, and it is the one rendering of a report that nothing
// else in this repository can see. The frozen hash pins the renderer's bytes; the render tests read its
// HTML. Neither can tell you that a control which exists to be CLICKED is being printed onto paper,
// because on screen it is correct and only the print block decides otherwise.
//
// Two folds have shipped mis-ruled. A hero caption's fold printed an inert label and a right-pointing
// COLLAPSED marker above text that was already fully expanded. A "What was searched" heading printed its
// arrow the same way. In both cases the commit that added the fold checked the half it thought about —
// the caption's text was carried correctly — and shipped the half it did not.
//
// ── THE INVARIANT, AND WHY IT IS NOT A LIST OF NAMES ────────────────────────────────────────────────
//
// `report.css`'s print block has two mechanisms for <details>, and its own comment states the rule. PURE
// TOGGLES hide their summary line. Summaries that CARRY content — region rows, secondary groups, section
// titles — print as static headers with the marker blanked. Every <details> the renderers emit must be
// ruled by one or the other.
//
// A test naming a class in the hide list would be the tautology this repository keeps shipping: it would
// go green the day somebody adds a sixth disclosure and forgets it, which is precisely the failure. So
// this walks EVERY <details> a real rendered page contains and requires each one that reaches paper to be
// ruled by a mechanism. A new disclosure fails this until somebody decides which it is.
//
// ── HOW IT ASKS ─────────────────────────────────────────────────────────────────────────────────────
//
// `@media print{` is rewritten to `@media all{`, so the print block applies to the live layout tree and
// every computed style is the one the export would use. A probe script appended to the page walks the
// disclosures and writes what it found into the DOM, which `--dump-dom` hands back. Two floors sit under
// that: a page with no print block at all is a refusal rather than a clean sweep, and a probe that never
// ran is a refusal rather than an empty list of problems.
//
// Needs `google-chrome`, and MUST NOT run under a virtual-memory ulimit — Chrome dies under one.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { browserRun } from "../shared/browser-temp-root.mjs";
import { buildFixturePool } from "./render-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Appended to the page: it walks the disclosures and leaves its answer in the DOM for --dump-dom. */
export const PROBE = `
<script>
(function () {
  var out = [];
  document.querySelectorAll('details').forEach(function (d) {
    var sm = d.querySelector(':scope > summary');
    if (!sm) { out.push({ cls: d.className || '(none)', noSummary: true }); return; }
    // Does it reach paper at all? An ancestor with display:none means no, and a disclosure that never
    // prints cannot print a control.
    var hidden = false, n = d;
    while (n && n !== document.body) { if (getComputedStyle(n).display === 'none') { hidden = true; break; } n = n.parentElement; }
    var sc = getComputedStyle(sm);
    out.push({
      cls: d.className || '(none)',
      renders: !hidden,
      summaryDisplay: sc.display,
      before: getComputedStyle(sm, '::before').content,
      listStyle: sc.listStyleType,
      text: sm.textContent.replace(/\\s+/g, ' ').trim().slice(0, 48),
    });
  });
  var p = document.createElement('pre');
  p.id = 'PRINT-PROBE';
  p.textContent = JSON.stringify(out);
  document.body.appendChild(p);
})();
</script>
`;

const unescapeDom = (s) => s
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** A disclosure is ruled when its summary is hidden, or when it prints with no marker of any kind. */
export function ruledBy(row) {
  if (row.summaryDisplay === "none") return "hidden";
  const before = String(row.before ?? "");
  const blanked = before === "" || before === "none" || before === '""' || before === "normal";
  const noNativeMarker = row.listStyle === "none";
  return blanked && noNativeMarker ? "static-header" : null;
}

/** Every <details> on one rendered page, as the export would draw it. */
export function measure(name, html, work, env) {
  const printed = html.replace(/@media print\{/g, "@media all{");
  if (printed === html) return { error: `${name}: no @media print block — the instrument measured nothing` };
  const file = join(work, `${name}.print.html`);
  writeFileSync(file, printed + PROBE);
  let dom;
  try {
    dom = execFileSync("google-chrome", [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      `--user-data-dir=${join(work, `chrome-${name}`)}`, "--virtual-time-budget=8000",
      "--dump-dom", `file://${file}`,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, env });
  } catch (e) {
    return { error: `${name}: the browser did not run (${String(e.message).split("\n")[0]})` };
  }
  const m = dom.match(/<pre id="PRINT-PROBE">([\s\S]*?)<\/pre>/);
  if (!m) return { error: `${name}: the probe never ran — nothing was measured` };
  return { rows: JSON.parse(unescapeDom(m[1])) };
}

/** Every published report in a pool, with the stylesheet each one needs beside it. */
export function pagesIn(pool, work) {
  const pages = [];
  for (const run of readdirSync(pool)) {
    const html = join(pool, run, "report.html");
    if (!existsSync(html)) continue;
    for (const f of readdirSync(join(pool, run))) {
      if (f.endsWith(".css")) copyFileSync(join(pool, run, f), join(work, f));
    }
    pages.push([run, readFileSync(html, "utf8")]);
  }
  return pages;
}

export function main() {
  const keep = process.argv.includes("--keep");
  const { root: work, env } = browserRun("report-print-check-");
  const pool = buildFixturePool(mkdtempSync(join(tmpdir(), "print-check-pool-")));
  let failures = 0;
  const fail = (m) => { failures += 1; console.error(`  ✕ ${m}`); };
  try {
    const pages = pagesIn(pool, work);
    // THE FLOOR ON THE POPULATION. An empty pool reports nothing wrong, which is what a broken fixture
    // looks like from here. A check that measured no page is a could-not-look, never a pass.
    if (!pages.length) {
      console.error("report-print-check: the fixture pool published no report — nothing was measured.");
      return 2;
    }
    let ruled = 0;
    const byMechanism = { hidden: 0, "static-header": 0 };
    for (const [name, html] of pages) {
      const got = measure(name, html, work, env);
      if (got.error) { fail(got.error); continue; }
      const printed = got.rows.filter((r) => r.renders);
      console.log(`${name}: ${got.rows.length} disclosure(s), ${printed.length} of them printed`);
      for (const r of got.rows) {
        if (r.noSummary) { fail(`${name}: a <details class="${r.cls}"> has no <summary> — nothing rules how it prints`); continue; }
        if (!r.renders) continue;
        const how = ruledBy(r);
        if (how) { ruled += 1; byMechanism[how] = (byMechanism[how] ?? 0) + 1; continue; }
        fail(`${name}: <details class="${r.cls}"> ("${r.text}") prints its control — summary display `
          + `${r.summaryDisplay}, marker ${r.before}, list-style ${r.listStyle}. On paper that is a label and `
          + "an arrow over content that is already fully expanded. Rule it in report.css's print block: hide "
          + "the summary if it is a pure toggle, or blank its marker if the summary carries content.");
      }
    }
    // AND THE SECOND FLOOR. Every page answering "no disclosures" is indistinguishable from a probe that
    // walked an empty document, so the run must have ruled at least one.
    if (!failures && !ruled) {
      console.error("report-print-check: no printed disclosure was found on any page. Either the reports "
        + "stopped carrying them or the probe read the wrong document; both are a could-not-look.");
      return 2;
    }
    if (failures) {
      console.error(`\nreport-print-check: ${failures} disclosure(s) reach paper ruled by neither mechanism.`);
      return 1;
    }
    // THE BREAKDOWN IS THE POINT OF PRINTING IT. "How many still draw a marker" is a question a reader
    // will ask of a rendered report, and the answer is none: the hidden ones draw nothing because their
    // summary is not painted at all, and the static headers draw nothing because their marker is blanked.
    // Recording which mechanism ruled how many turns that from an inference into a number.
    console.log(`report-print-check: ${ruled} printed disclosure(s), every one ruled by the print block — `
      + `${byMechanism.hidden} by hiding the summary (pure toggles), `
      + `${byMechanism["static-header"]} as static headers with the marker blanked.`);
    return 0;
  } finally {
    if (!keep) { rmSync(pool, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); }
    else console.log(`  kept: ${work}`);
  }
}

if (isEntrypoint(import.meta.url)) process.exitCode = main();
