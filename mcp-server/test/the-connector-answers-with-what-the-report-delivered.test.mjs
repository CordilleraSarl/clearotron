// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CONNECTOR ANSWERS WITH WHAT THE REPORT DELIVERED. Publishing binds each finding to the register record the run saved
// for it, and prints a coverage row the run's record repeats once. get_finding and get_search_coverage read the run's
// files from before that, so on a run whose saved record says something else than the assessment wrote, the connector
// gave the assessment's owner, status and classes beside a page that printed the record's, and listed a repeated row
// twice. Both now answer with the report's delivered values, keeping the finding's id, and list each registration a
// finding cites apart. The coverage answer's open rows are the page's "Left open": a follow-up row that another open row
// already reports is left out, and the native-script searches that did not complete are listed, with the places they
// count. A run published before the report document answers from its files, as before.
//
// The full-country demo is seeded as the connector finds a run, and its first finding's saved record is given an invented
// owner, status and classes before it is published.
//
// SAFETY GUARD: the workspace and the pool are pinned before anything is imported, because the driver config freezes
// its roots at import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", __mkdtemp(__join(__tmpdir(), "connector-delivered-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", __join(process.env.CLEAROTRON_WORK_DIR, "pool"));
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WS = process.env.CLEAROTRON_WORK_DIR, POOL = process.env.CLEAROTRON_REPORTS_DIR;
const { seedDemoRuns, publishSource, demoChildren } = await import("../../driver/demo-container.mjs");
const { republishRun } = await import("../../driver/publish/report-registry.mjs");
const { paths } = await import("../../driver/run-record.mjs");
const { renderReport } = await import("../../driver/publish/render-report.mjs");

const statusFiles = (dir, depth = 0) => (depth > 7 || !existsSync(dir) ? [] : readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  if (name === "status.json") return [p];
  return statSync(p).isDirectory() && !name.startsWith("_") ? statusFiles(p, depth + 1) : [];
}));

mkdirSync(POOL, { recursive: true });
const examples = publishSource(join(ROOT, "demo"), { repoRoot: ROOT });
seedDemoRuns({ workspace: WS, examplesDir: examples, portalOrigin: "http://127.0.0.1:9" });
const name = demoChildren(examples).find((n) => /full-country/.test(n));
const meta = JSON.parse(readFileSync(join(examples, name, "meta.json"), "utf8"));
const runDir = dirname(statusFiles(WS).find((f) => JSON.parse(readFileSync(f, "utf8")).runId === meta.runId));

// The first finding's saved record, given an owner, status and classes the assessment did not write.
const f1 = JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8")).findings.find((f) => f.ordinal === 1);
const uri = f1.owner.registrations[0].uri;
const recordFile = join(runDir, "_records", `${uri.split("/")[2]}-${uri.split("/")[3]}.json`);
const record = JSON.parse(readFileSync(recordFile, "utf8"));
writeFileSync(recordFile, JSON.stringify({ ...record, owner: "Harrowgate Instruments Ltd", ownerCountry: "GB", statusClass: "dead", statusText: "EXPIRED", niceClasses: [9, 11] }));
await republishRun({ runId: meta.runId, meta, pool: POOL, poolUrl: "", runDir });
const { tools } = await import("../server.mjs");
const { getFinding } = await import("../lib/findings.mjs");

/** The same question with the run's report document set aside, as a run published before it reads. */
async function withoutDocument(ask) {
  const document = paths(runDir).reportDocument;
  renameSync(document, `${document}.aside`);
  try { return await ask(); } finally { renameSync(`${document}.aside`, document); }
}

test("get_finding states the registration facts the report delivered, under the finding's own id", async () => {
  assert.equal(f1.owner.name !== "Harrowgate Instruments Ltd", true, "premise: the assessment wrote another owner");
  const answer = await tools.get_finding({ runId: meta.runId, id: "F1" });
  assert.equal(answer.id, "F1");
  assert.equal(answer.owner, "Harrowgate Instruments Ltd", "the owner is not the one the report delivered");
  assert.equal(answer.owner_country, "GB");
  assert.equal(answer.status, "EXPIRED");
  assert.equal(answer.classes, "9, 11");
  assert.deepEqual(answer.registrations.map((r) => [r.registration, r.status, r.classes]), [[uri, "EXPIRED", ["9", "11"]]],
    "each registration the finding cites is not listed apart with its own facts");
  // A negative result and an audit row keep their meaning: the same answer as the run's audit gives.
  for (const id of ["NR1", "AT1"]) {
    const own = getFinding(paths(runDir), id);
    if (own) assert.deepEqual(await tools.get_finding({ runId: meta.runId, id }), own, `${id} changed`);
  }
  // A run published before the document answers from its files.
  const before = await withoutDocument(() => tools.get_finding({ runId: meta.runId, id: "F1" }));
  assert.equal(before.owner, f1.owner.name);
  assert.equal(before.registrations, undefined);
});

/** The rows a clearance page lists under "Left open", as [area, state, note, detail]: area case and inline markup aside. */
function pageLeftOpen(html) {
  const at = html.indexOf('<div class="openrows">');
  const untag = (s) => { for (let was = null; was !== s;) { was = s; s = s.replace(/<[^>]*>/g, ""); } return s; };   // until none is left
  const text = (x) => untag(x ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return at < 0 ? [] : [...html.slice(at).matchAll(/<div class="ct">(.*?) <span class="cst">· (.*?)<\/span><\/div><div class="cd">(.*?)<\/div>(?:<div class="cd">(.*?)<\/div>)?/g)]
    .map(([, area, state, note, detail]) => JSON.stringify([text(area).toLowerCase(), text(state), text(note), text(detail)]));
}
const answeredOpen = (areas) => areas.filter((a) => a.state !== "confirmed-clean")
  .map((a) => JSON.stringify([a.area.toLowerCase(), a.stateLabel, a.note.replace(/`/g, ""), (a.detail ?? []).join(", ")]));
const poolPage = () => readFileSync(join(POOL, readdirSync(POOL).find((d) => existsSync(join(POOL, d, "meta.json"))
  && JSON.parse(readFileSync(join(POOL, d, "meta.json"), "utf8")).runId === meta.runId), "report.html"), "utf8");

test("get_search_coverage states the rows the report delivered, as its page lists them", async () => {
  const delivered = JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8")).client.coverage;
  const written = JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8")).coverage;
  assert.ok(written.length > delivered.length, "premise: the run's record repeats a row the report prints once");
  const { areas } = await tools.get_search_coverage({ runId: meta.runId });
  // The open rows are the page's "Left open": a follow-up row another open row already reports is left out, as there.
  assert.deepEqual(answeredOpen(areas).sort(), pageLeftOpen(poolPage()).sort(), "the open rows are not the page's Left open");
  assert.ok(areas.length < delivered.length, "premise: the page leaves out a follow-up row another open row reports");
  assert.deepEqual(areas.filter((a) => a.state === "confirmed-clean").map((a) => a.area),
    delivered.filter((r) => r.state === "confirmed-clean").map((r) => r.areaLabel || r.area), "a clean row changed");
  const before = await withoutDocument(() => tools.get_search_coverage({ runId: meta.runId }));
  assert.equal(before.areas.length, written.length, "a run published before the document no longer answers from its files");
});

test("get_search_coverage lists the native-script searches the page lists as not completed, with the places they count", async () => {
  const file = paths(runDir).reportDocument, saved = readFileSync(file, "utf8");
  const document = JSON.parse(saved);
  document.scope.searchDepth = { ...document.scope.searchDepth, counts: { ...document.scope.searchDepth?.counts,
    localScripts: { searched: ["Hani"], missed: ["Hang"], territories: { Hani: { searched: ["CN"], missed: ["JP", "KR", "TW", "HK"], worldwide: "searched", unnamed: "searched" } } } } };
  writeFileSync(file, JSON.stringify(document));
  try {
    const html = renderReport(JSON.parse(JSON.stringify(document)));
    const page = pageLeftOpen(html);
    assert.ok(page.some((r) => JSON.parse(r)[3]), "premise: the page lists a script gap with the places it counts");
    assert.deepEqual(answeredOpen((await tools.get_search_coverage({ runId: meta.runId })).areas).sort(), page.sort(),
      "the script searches the page left open are not in the answer");
  } finally { writeFileSync(file, saved); }
});
