// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE RENDERER DRAWS EVERY REPORT PAGE (C14). A run's report document says which report it is, and
// publish/render-report.mjs draws the page that document names, in the one frame both products share. Two
// things that frame must never do: draw a document it does not know, and let one page read what the page
// drawn before it left behind. The clearance's page keeps its working state in module variables it sets at
// the start of every render, so a Knockout drawn after a clearance, or a clearance after a Knockout, is the
// case to prove.
//
// SAFETY GUARD: the workspace is pinned before the driver's modules are imported, because the driver config
// freezes its roots at import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", __mkdtemp(__join(__tmpdir(), "one-renderer-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", __mkdtemp(__join(__tmpdir(), "one-renderer-pool-default-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { publishSource, demoChildren } = await import("../demo-container.mjs");
const { republishRun } = await import("../publish/report-registry.mjs");
const { CLEARANCE_DOCUMENT, KNOCKOUT_DOCUMENT } = await import("../publish/report-document.mjs");
const { renderReport } = await import("../publish/render-report.mjs");
const { paths } = await import("../run-record.mjs");

// Each demo run, published once, and the report document publishing wrote for it, read back as written.
const copy = publishSource(join(ROOT, "demo"), { repoRoot: ROOT });
const documents = [];
for (const name of demoChildren(copy)) {
  const dir = join(copy, name), runDir = join(dir, "run");
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  await republishRun({ runId: meta.runId, meta, pool: mkdtempSync(join(tmpdir(), "one-renderer-pool-")), poolUrl: "", runDir });
  documents.push({ name, doc: JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8")) });
}
const clearances = documents.filter((d) => d.doc.document === CLEARANCE_DOCUMENT);
const knockouts = documents.filter((d) => d.doc.document === KNOCKOUT_DOCUMENT);
const draw = ({ doc }) => renderReport(doc, { at: 0 });

test("the demos give the frame both products to draw", () => {
  assert.equal(clearances.length, 3, `the demo container holds ${clearances.length} clearance document(s)`);
  assert.equal(knockouts.length, 1, `the demo container holds ${knockouts.length} Knockout document(s)`);
});

test("a document says which page draws it, and a document no page draws is refused by name", () => {
  for (const d of clearances) assert.match(draw(d), /<span class="tb-risk"[^>]*>/, `${d.name}: no clearance page was drawn`);
  for (const d of knockouts) assert.match(draw(d), /<div class="fab-stack" data-report-chrome>/, `${d.name}: no Knockout page was drawn`);
  assert.throws(() => renderReport({ ...clearances[0].doc, document: "report-document/opinion-1" }),
    /no report page draws a "report-document\/opinion-1" document/);
  assert.throws(() => renderReport({ run: {} }), /no report page draws a "undefined" document/);
});

// A page drawn alone, in a process that has drawn nothing else: the page with no state but its own.
const RENDERER = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "publish", "render-report.mjs")).href;
const alone = ({ name, doc }) => {
  const file = join(mkdtempSync(join(tmpdir(), "one-renderer-doc-")), "doc.json");
  writeFileSync(file, JSON.stringify(doc));
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const { renderReport } = await import(${JSON.stringify(RENDERER)}); const { readFileSync } = await import("node:fs");`
    + `process.stdout.write(renderReport(JSON.parse(readFileSync(${JSON.stringify(file)}, "utf8")), { at: 0 }));`],
  { encoding: "utf8", maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, `${name}: the page drawn alone did not draw: ${r.stderr}`);
  return r.stdout;
};

test("a page is the same whatever page was drawn before it", () => {
  const [a, b, c] = clearances, [k] = knockouts;
  const fresh = new Map([a, b, c, k].map((d) => [d, alone(d)]));
  // Each clearance after the Knockout and after another clearance; the Knockout after two different clearances.
  const order = [a, k, b, a, c, k, b, k, a];
  order.forEach((d, i) => {
    assert.equal(draw(d), fresh.get(d),
      `${d.name}: drawn after ${i ? order[i - 1].name : "the pages above"}, the page is not the page it is when drawn alone`);
  });
});
