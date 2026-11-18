// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// @tier full — publishes the four demo reports through the demo's own publisher
//
// THE PORTAL'S TWO CANARIES SPEAK ONLY ON DRIFT. When the portal serves a stored report it strips the site
// nav and the connector token, and it used to log a line whenever it stripped neither. No renderer writes
// either any more, so that line was logged for every current report, and a strip that had stopped working
// read the same as a report that never had anything to strip. Each canary now reads the served document:
// a nav or a token still in it is the line, and nothing else is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readReport } from "../portal-report.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CANARY = /site nav survived|connector token survived/;

/** Serve one stored document and return what the portal logged and what it served. */
function serve(body) {
  const dir = mkdtempSync(join(tmpdir(), "canary-"));
  writeFileSync(join(dir, "report.html"), `<!doctype html><html><head><title>t</title></head><body>${body}<main><p>An invented finding.</p></main></body></html>`);
  const lines = [];
  const html = readReport(dir, { log: (l) => lines.push(l) });
  return { html, lines };
}

test("a report with no nav and no token, as every renderer now writes, logs nothing", () => {
  const { lines } = serve("");
  assert.deepEqual(lines, [], "a clean current report was logged");
});

test("a stored report's nav and token, in the shapes the strips know, are removed without a line", () => {
  const { html, lines } = serve(`<nav class="sitenav"><a href="../index.html">Archive</a></nav>`
    + `<a href="https://door.invalid/connect?token=v1.abc.def">Ask your AI</a>`);
  assert.doesNotMatch(html, /class="sitenav"/, "the known nav was not stripped");
  assert.doesNotMatch(html, /token=v1\./, "the known token was not dropped");
  assert.deepEqual(lines.filter((l) => CANARY.test(l)), [], "a strip that worked was logged as drift");
});

test("a nav or a token in a shape the strips do not know is served, and each is named", () => {
  const nav = serve(`<nav class="site-nav"><a href="../index.html">Archive</a></nav>`);
  assert.match(nav.html, /class="site-nav"/, "premise: the strip does not know this class");
  assert.ok(nav.lines.some((l) => /site nav survived the strip/.test(l)), `no line for a surviving nav: ${nav.lines.join(" | ")}`);
  const token = serve(`<a href="https://door.invalid/connect?token=v2.abc.def">Ask your AI</a>`);
  assert.match(token.html, /token=v2\./, "premise: the strip does not know this version");
  assert.ok(token.lines.some((l) => /connector token survived the strip/.test(l)), `no line for a surviving token: ${token.lines.join(" | ")}`);
});

test("the four demo reports, served as the portal serves them, log no canary", () => {
  const pool = mkdtempSync(join(tmpdir(), "canary-pool-"));
  mkdirSync(pool, { recursive: true });
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "example.mjs"), "--once", "--pool", pool], { encoding: "utf8", timeout: 240_000 });
  assert.equal(r.status, 0, `the demo publisher failed:\n${r.stderr || r.stdout}`);
  const reports = nonEmpty(readdirSync(pool, { recursive: true }).map(String).filter((n) => /(^|[\\/])report\.html$/.test(n)), "the demo's reports");
  assert.equal(reports.length, 4, `the demo published ${reports.length} reports, not the four products`);
  for (const rel of reports) {
    const lines = [];
    readReport(join(pool, dirname(rel)), { log: (l) => lines.push(l), poolRoot: pool });
    assert.deepEqual(lines.filter((l) => CANARY.test(l)), [], `${rel} logged a canary`);
  }
});
