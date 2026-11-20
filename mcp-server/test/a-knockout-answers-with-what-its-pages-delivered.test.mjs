// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT ANSWERS WITH WHAT ITS PAGES DELIVERED. Two of the connector's answers about a Knockout disagreed with the
// delivered report. get_search_coverage built its own rows: a name whose register reading stopped part-way, or whose
// research was unavailable, was answered "Searched" while its page listed the gap under "Left open". get_finding read
// the clearance's audit trail only, so it refused every id that list_findings had just given for a Knockout. Coverage
// now states each name's Left open rows from the page's own projection, in its words, naming the name; get_finding
// reopens every id the list gives. Both describe the edition the report delivered: a resume that settles more later
// changes neither until the report is published again. A run published before the report document answers as before.
//
// The Knockout demo is seeded as the connector finds a run, then made a batch of two invented names before it is
// published: the first with a finding, a filing the rater read and three negative results, the second with research
// that was unavailable and one negative result, so both names hold a first negative result under the same number. The
// register reading stopped part-way.
//
// SAFETY GUARD: the workspace and the pool are pinned before anything is imported, because the driver config freezes
// its roots at import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", __mkdtemp(__join(__tmpdir(), "knockout-delivered-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", __join(process.env.CLEAROTRON_WORK_DIR, "pool"));
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WS = process.env.CLEAROTRON_WORK_DIR, POOL = process.env.CLEAROTRON_REPORTS_DIR;
const { seedDemoRuns, publishSource, demoChildren } = await import("../../driver/demo-container.mjs");
const { republishRun } = await import("../../driver/publish/report-registry.mjs");
const { paths } = await import("../../driver/run-record.mjs");
const { koPaths } = await import("../lib/driver.mjs");
const { authorize } = await import("../../shared/scope.mjs");

const statusFiles = (dir, depth = 0) => (depth > 7 || !existsSync(dir) ? [] : readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  if (name === "status.json") return [p];
  return statSync(p).isDirectory() && !name.startsWith("_") ? statusFiles(p, depth + 1) : [];
}));

mkdirSync(POOL, { recursive: true });
const examples = publishSource(join(ROOT, "demo"), { repoRoot: ROOT });
seedDemoRuns({ workspace: WS, examplesDir: examples, portalOrigin: "http://127.0.0.1:9" });
const meta = JSON.parse(readFileSync(join(examples, demoChildren(examples).find((n) => /knockout/.test(n)), "meta.json"), "utf8"));
const runDir = dirname(statusFiles(WS).find((f) => JSON.parse(readFileSync(f, "utf8")).runId === meta.runId));
const K = koPaths(runDir);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const runLog = (event) => appendFileSync(paths(runDir).run, `${JSON.stringify(event)}\n`);

// The batch: the demo's name, given a finding and a filing the rater read, and a second name whose research was unavailable.
const findings = readJson(K.findings);
const [FIRST] = findings.marks.map((m) => m.name), SECOND = "TORVELLE";
Object.assign(findings.marks[0], {
  findings: [{ ordinal: 1, name: "VENQORA", owner: "Larkspur Fittings Oy", band: "Low", type: "Common-law",
    net: "A trading use in a nearby field.", basis: "Close in sound, different goods.", evidence: [] }],
  registerReads: [{ recordId: "R-VQ-1", band: "Low", read: "An expired filing in unrelated goods." }],
});
findings.marks.push({ ...findings.marks[0], name: SECOND, degraded: true, findings: [], registerReads: [],
  negatives: [{ term: "torvelle", source: "open web", note: "no trading use located" }] });
writeFileSync(K.findings, JSON.stringify(findings));
const records = readJson(K.registerRecords);
records.marks[0].records = [{ recordId: "R-VQ-1", mark: "VENQORY", owner: "Larkspur Fittings Oy", status: "Expired",
  classes: [9], territory: "FI", matchedForm: "VENQORY", matchedBasis: "close", url: null }];
records.marks.push({ ...records.marks[0], name: SECOND, records: [] });
writeFileSync(K.registerRecords, JSON.stringify(records));
runLog({ event: "knockout-register-read-failed", cause: "provider timed out" });
await republishRun({ runId: meta.runId, meta, pool: POOL, poolUrl: "", runDir });
const { tools, presentForPrincipal } = await import("../server.mjs");

const document = () => readJson(paths(runDir).reportDocument);
const poolDir = () => readdirSync(POOL).map((d) => join(POOL, d))
  .find((d) => existsSync(join(d, "meta.json")) && readJson(join(d, "meta.json")).runId === meta.runId);
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** A name's "Left open" rows as its delivered page prints them, in the page's order: [area, state, note]. */
function pageLeftOpen(name) {
  const file = document().run.reports.find((r) => r.mark === name).file;
  const html = readFileSync(join(poolDir(), file), "utf8");
  const at = html.indexOf('id="open"');
  if (at < 0) return [];
  const section = html.slice(at, html.indexOf('<div class="panel ko-caveats"', at));
  return [...section.matchAll(/<div class="ct">(.*?) <span class="cst">· (.*?)<\/span><\/div><div class="cd">(.*?)<\/div>/g)]
    .map(([, area, state, note]) => [unescape(area), unescape(state), unescape(note)]);
}
const answered = (areas, name) => areas.filter((a) => a.name === name).map((a) => [a.area, a.state, a.detail]);

async function withoutDocument(ask) {
  const file = paths(runDir).reportDocument;
  renameSync(file, `${file}.aside`);
  try { return await ask(); } finally { renameSync(`${file}.aside`, file); }
}

test("get_search_coverage states each name's Left open rows as its delivered page prints them", async () => {
  const { areas } = await tools.get_search_coverage({ runId: meta.runId });
  for (const name of [FIRST, SECOND]) {
    const page = pageLeftOpen(name);
    assert.ok(page.length, `premise: ${name}'s page lists something under Left open`);
    assert.deepEqual(answered(areas, name), page, `${name}: the answer is not its page's Left open rows`);
  }
  // A name whose research was unavailable is stated by its own row alone, never also as swept.
  assert.equal(areas.some((a) => a.area.startsWith(`${SECOND} — `)), false, "the name without research is answered as swept");
  assert.equal(areas.find((a) => a.area.startsWith(`${FIRST} — `))?.state, "Searched", "the completed sweep's summary is gone");
  assert.equal(areas.find((a) => a.area === "Register" && !a.name)?.state, "Searched", "the listing that completed lost its summary");
});

test("the coverage answer stays the delivered edition when later figures arrive, and a run without the document answers as before", async () => {
  const before = await tools.get_search_coverage({ runId: meta.runId });
  const pages = [FIRST, SECOND].map(pageLeftOpen);
  // A resume settles the reading and the listing changes, in the run's own files only.
  runLog({ event: "knockout-register-read", outcome: "ok" });
  writeFileSync(K.registerRecords, JSON.stringify({ ...records, unavailable: "The register could not be reached." }));
  assert.deepEqual(await tools.get_search_coverage({ runId: meta.runId }), before, "a later resume changed the delivered answer");
  assert.deepEqual([FIRST, SECOND].map(pageLeftOpen), pages, "premise: the delivered pages are unchanged");
  const archived = await withoutDocument(() => tools.get_search_coverage({ runId: meta.runId }));
  assert.equal(archived.areas.some((a) => a.name), false, "a run published before the document answered with Left open rows");
  assert.equal(archived.areas.find((a) => a.area.startsWith(`${SECOND} — `))?.state, "Partially covered");
  writeFileSync(K.registerRecords, JSON.stringify(records));
});

test("every id list_findings gives reopens through get_finding as the item it named, and an unknown id stays a miss", async () => {
  const listed = [...(await tools.list_findings({ runId: meta.runId })).items, ...(await tools.list_findings({ runId: meta.runId, kind: "negatives" })).items];
  assert.ok(listed.some((i) => i.type === "Register filing") && listed.some((i) => i.ordinal === 1), "premise: a finding and a filing are listed");
  assert.deepEqual(listed.filter((i) => i.id.endsWith(" NR#1")).map((i) => i.mark), [FIRST, SECOND], "premise: both names number a negative result 1");
  for (const item of listed) {
    const { record, ...answer } = await tools.get_finding({ runId: meta.runId, id: item.id });
    assert.deepEqual(answer, item, `${item.id} did not reopen as the item the list named`);
    if (item.recordId) {
      assert.equal(record?.owner, "Larkspur Fittings Oy", "the filing's register record, as the report delivered it, is missing");
      assert.equal(record.recordId, item.recordId);
    } else assert.equal(record, undefined);
  }
  assert.throws(() => tools.get_finding({ runId: meta.runId, id: `${FIRST} NR#9` }), /not found/);
  assert.throws(() => tools.get_finding({ runId: meta.runId, id: "F1" }), /not found/, "a clearance id is not a Knockout's");
});

test("the account sees the same items through the client door, and a report link still reaches neither tool", async () => {
  const account = { kind: "account", sub: "reader@demo.example", accounts: [meta.customerKey ?? "demo-brand-owner"] };
  const list = presentForPrincipal(account, "list_findings", await tools.list_findings({ runId: meta.runId }));
  for (const item of list.items) {
    const { record, ...answer } = presentForPrincipal(account, "get_finding", await tools.get_finding({ runId: meta.runId, id: item.id }));
    assert.deepEqual(answer, item, `${item.id} reads differently to an account than the list showed it`);
    assert.equal(Boolean(record), Boolean(item.recordId));
  }
  const coverage = await tools.get_search_coverage({ runId: meta.runId });
  assert.deepEqual(presentForPrincipal(account, "get_search_coverage", coverage), coverage, "the account's coverage answer is not the delivered one");
  for (const tool of ["get_finding", "get_search_coverage"]) {
    assert.doesNotThrow(() => authorize(account, tool, { runId: meta.runId, id: `${FIRST} NR#1` }), `${tool} refused the account`);
    assert.throws(() => authorize({ kind: "user", runId: meta.runId }, tool, { runId: meta.runId, id: `${FIRST} NR#1` }), `${tool} reached a report link`);
  }
});

test("where the listing of filings never came back, each name's page and answer say so, and no register row claims it was searched", async () => {
  rmSync(K.registerRecords);
  runLog({ event: "knockout-register-records-failed", cause: "provider timed out" });
  await republishRun({ runId: meta.runId, meta, pool: POOL, poolUrl: "", runDir });
  const { areas } = await tools.get_search_coverage({ runId: meta.runId });
  for (const name of [FIRST, SECOND]) {
    const page = pageLeftOpen(name);
    assert.ok(page.some(([area, state]) => area === "Register" && state === "Not searched"), `premise: ${name}'s page lists the listing`);
    assert.deepEqual(answered(areas, name), page, `${name}: the answer is not its page's Left open rows`);
  }
  assert.equal(areas.some((a) => a.area === "Register" && !a.name), false, "a register row still claims the listing was searched");
});
