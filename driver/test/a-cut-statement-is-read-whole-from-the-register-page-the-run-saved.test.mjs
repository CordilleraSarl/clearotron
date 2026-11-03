// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CUT STATEMENT IS READ WHOLE FROM THE REGISTER PAGE THE RUN SAVED.
//
// A writer reads a record's goods through the band tools, and a search answer that did not ask for the whole text holds
// a long class statement cut at 280 characters. The run's research may already have saved the register's own page for
// that record. Measured 2026-11-03: the writer still wrote the record's classes up as "cut and unread". Now a statement
// cut, or not established whole, on a US record's row reads as the page's statement for its class, whole, where that
// statement begins with the row's own copy, and the record's goods say which research question saved the page. A page
// that says something else, a fetch that stopped before the goods table, and a held official record leave the reading
// as it was. Own file, so the call ledger is pinned before the driver loads. Every mark, owner, serial and goods line
// here is invented.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(mkdtempSync(join(tmpdir(), "saved-page-calls-")), "register-calls.jsonl");
writeFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "");

import { test } from "node:test";
import assert from "node:assert/strict";
const { rowGoods, bandShapeGoods, statementCut } = await import("../record-goods.mjs");
const { recordGoodsEvidence, deriveGoodsEvidence, heldRecordProvenance, goodsFromLabel } = await import("../goods-evidence.mjs");
const { statusPageGoods, savedStatusPages } = await import("../saved-register-pages.mjs");
const { withGoodsFrom } = await import("../pipeline.mjs");
const { paths } = await import("../stages.mjs");

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");
const LABEL = "the register's own page, saved by research question 7";

// Class 42 runs past the default answer's cut, and the client's word "telescopes" is in the part it cuts off.
const S42 = "Providing scientific research in the field of invented compounds; providing information about invented compounds; "
  + "conducting laboratory studies of invented compounds; preparing reports about invented compounds; ".repeat(2)
  + "design of invented instruments, namely, telescopes and their parts";
const CUT = S42.slice(0, 280);
// The row's own copy, as a search answer might hand it: its case and spacing its own, and an ellipsis where it stops.
const COPY = `${CUT.replace(/^Providing/, "PROVIDING").replace("in the field", "in  the field")}…`;
const S44 = "Providing information about invented treatments; providing health information";
const S9 = `${"Invented measuring apparatus, namely, gauges for invented liquids; ".repeat(4)}and invented spare gauges`;

const SERIAL = { whole: "09900011", other: "09900012", partial: "09900013", held: "09900014", rowWhole: "09900015", later: "09900016", unknown: "09900017" };
const signa = (cls, text, truncated) => ({ nice_class: cls, goods_services_text: text, goods_services_language: "en", goods_services_text_truncated: truncated });
const row = (id, owner, serial, classifications) => ({ record_id: `/mark/us/tm_${id}`, mark_text: "QZORVAK", owner_name: owner, classes: classifications.map((c) => String(c.nice_class)),
  status: "registered", jurisdictions: ["US"], raw: { office_code: "US", application_number: serial, classifications } });
const A = row("qa", "Alpha Ltd", SERIAL.whole, [signa(42, COPY, true), signa(44, S44, false)]);   // cut; the page continues it
const B = row("qb", "Beta GmbH", SERIAL.other, [signa(42, CUT, true)]);                         // cut; the page says something else
const C = row("qc", "Gamma SA", SERIAL.partial, [signa(42, CUT, true)]);                        // cut; only a partial fetch was saved
const D = row("qd", "Delta AG", SERIAL.held, [signa(42, CUT, true)]);                           // cut; an official record is held too
const E = row("qe", "Eta Kft", SERIAL.rowWhole, [signa(44, S44, false)]);                       // whole on the row
const F = row("qf", "Theta Oy", SERIAL.later, [signa(42, CUT, true)]);                          // cut; its page is saved mid-stage
const G = row("qg", "Iota Oy", SERIAL.unknown, [{ nice_class: 9, goods_services_text: S9.slice(0, 280), goods_services_language: "en" }]);   // not established whole

// The register's status page as a fetch hands it over, in markdown.
const statusPage = (rows) => ["# Invented mark status", "", "## Goods and services", "",
  "Note: brackets mark deleted goods.", "",
  "| International Class | U.S Class(es) | Class Status | First Use | Use in Commerce | Goods and Services |",
  "|---|---|---|---|---|---|",
  ...rows.map(([cls, text]) => `| ${cls} - Primary Class | 100, 101 | ACTIVE | Oct. 01, 2024 | Oct. 01, 2024 | ${text} |`),
  "", "## Basis information", "", "Filed use: Yes"].join("\n");
const fetched = (pages) => ({ tool: "perplexity_research", kind: "question", task: "What does the register list for the invented mark QZORVAK?",
  preset: "pro-search", session: "clearance-qz-test-synthesis",
  items: [{ type: "fetch_url_results", contents: pages.map(([serial, snippet]) => ({ url: `https://tsdr.uspto.gov/statusview/sn${serial}`, title: "Invented status page", snippet })) }] });
const keep = (runDir, name, result) => {
  mkdirSync(driverDir(runDir, "web-results"), { recursive: true });
  writeFileSync(driverDir(runDir, "web-results", name), JSON.stringify(result, null, 1) + "\n");
};
const partial = (serial) => [serial, statusPage([]).split("|---")[0] + `|---|---|---|---|---|---|\n| 042 - Primary Class | 100 | ACTIVE | Oct. 01, 2024 | Oct. 01, 2024 | ${S42.slice(0, 300)}`];
const noTable = (serial) => [serial, "# Invented mark status\n\nThe page could not be loaded in full."];

function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "saved-page-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ slug: "qz", codename: "test" }));
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated: [A, B, C, D, E, F, G], crowds: [] }));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify({ groups: { goods_test: { source: "product_words", words: ["telescopes"] } } }));
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), JSON.stringify({ ts: "2026-11-03T00:00:00Z", provider: "x",
    sessionKey: "clearance-qz-test-register-unit-primary", target: D.record_id,
    body: { statusText: "Registered", goodsServices: [{ classes: [42], language: "en", description: "Invented research services" }] } }) + "\n");
  // Question 3 stopped before the goods table; question 7 saved the whole page, with a page for three other records.
  keep(runDir, "2026-11-03T10-00-00-000Z-4242-3.json", fetched([noTable(SERIAL.whole), partial(SERIAL.partial)]));
  keep(runDir, "2026-11-03T10-05-00-000Z-4242-7.json", fetched([
    [SERIAL.whole, statusPage([["042", S42], ["044", "Providing information about other invented treatments"]])],
    [SERIAL.other, statusPage([["042", "Providing information about other invented compounds, namely, telescopes"]])],
    [SERIAL.held, statusPage([["042", S42]])],
    [SERIAL.rowWhole, statusPage([["044", `${S44}; providing invented telescopes`]])],
    [SERIAL.unknown, statusPage([["009", S9]])],
  ]));
  // The whole page for the partial record sits only in a file of another shape, which is not a question's.
  keep(runDir, "qzorvak-gamma-sa.json", { mark: "QZORVAK", owner: "Gamma SA", query: "QZORVAK", items: fetched([[SERIAL.partial, statusPage([["042", S42]])]]).items });
  return runDir;
}
const stageGoods = (runDir) => bandShapeGoods(paths(runDir), [A, B, C, D, E, F, G]).goods;
const labelOf = (runDir, r) => goodsFromLabel(recordGoodsEvidence(r, { goods: stageGoods(runDir), held: heldRecordProvenance(runDir) }));

test("the page's goods table reads class by class, from the last column", () => {
  assert.deepEqual(statusPageGoods(statusPage([["042", S42], ["044", S44]])), [{ cls: "42", text: S42 }, { cls: "44", text: S44 }]);
  assert.deepEqual(statusPageGoods(partial(SERIAL.partial)[1]), [], "a row no bar closes is not whole");
});

test("a statement the search answer cut reads whole from the page the run saved, and its goods name the question", (t) => {
  const runDir = seedRun(t);
  assert.equal(statementCut(rowGoods(A)), true, "precondition: without the page the row is cut");
  const goods = rowGoods(A, savedStatusPages(runDir)());
  assert.deepEqual(goods, [{ classes: ["42"], text: S42, page: { question: 7 } }, { classes: ["44"], text: S44 }],
    "class 42 is the page's whole statement, from the fetch whose table has it; class 44, whole on the row, is the row's own");
  assert.equal(labelOf(runDir, A), LABEL);
  assert.equal(labelOf(runDir, G), LABEL, "a statement not established whole is continued as a cut one is");
  assert.match(stageGoods(runDir).of(A)[0].text, /telescopes and their parts$/, "the goods test reads the class to its end");
});

test("a page whose statement does not begin with the row's copy is not used", (t) => {
  const runDir = seedRun(t);
  assert.deepEqual(rowGoods(B, savedStatusPages(runDir)()), rowGoods(B));
  assert.equal(labelOf(runDir, B), "search answer, cut by the register");
});

test("a fetch that stopped before its goods table, or a page in a file that is not a question's, is not used", (t) => {
  const runDir = seedRun(t);
  assert.deepEqual(rowGoods(C, savedStatusPages(runDir)()), rowGoods(C));
  assert.equal(labelOf(runDir, C), "search answer, cut by the register");
});

test("a held official record still wins over a saved page", (t) => {
  const runDir = seedRun(t);
  assert.deepEqual(stageGoods(runDir).of(D), [{ classes: ["42"], text: "Invented research services" }]);
  assert.equal(labelOf(runDir, D), "official record");
  const doc = deriveGoodsEvidence({ records: [A, D], goods: stageGoods(runDir), held: heldRecordProvenance(runDir) });
  assert.deepEqual(doc.records.map((r) => [r.state, r.source, r.basis, r.question ?? null]),
    [["complete", "register-page", "register-page-statement", 7], ["complete", "record-body", "full-record", null]]);
  assert.deepEqual(doc.totals.by_source, { "register-page": 1, "record-body": 1 });
});

test("a row already whole is left as it is", (t) => {
  const runDir = seedRun(t);
  assert.deepEqual(rowGoods(E, savedStatusPages(runDir)()), rowGoods(E));
  assert.equal(labelOf(runDir, E), "search answer");
});

test("the write-up's list carries the question that saved the page", (t) => {
  const runDir = seedRun(t);
  const out = withGoodsFrom({ run: { slug: "qz", codename: "test" } }, paths(runDir),
    [A, B, D].map((r) => ({ kind: "record", uri: r.record_id, mark: r.mark_text, owner: r.owner_name, tier: "sheet-2" })));
  assert.deepEqual(out.map((r) => r.goods_from), [LABEL, "search answer, cut by the register", "official record"]);
});

// The band tool server over stdio, one request at a time, so the run's files can change between two calls.
function bandServer(t, runDir) {
  const calls = join(runDir, "register-calls.jsonl");
  writeFileSync(calls, "");
  const child = spawn(process.execPath, [join(MCP, "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_REGISTER_CALL_LOG: calls } });
  t.after(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } });
  const waiting = new Map();
  let buf = "", id = 0;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d; let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      const done = waiting.get(m?.id);
      if (done) { waiting.delete(m.id); done(m); }
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { waiting.delete(n); reject(new Error(`the band server did not answer ${method}`)); }, 8000);
    waiting.set(n, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  const text = async (name, args) => (await send("tools/call", { name, arguments: args }))?.result?.content?.[0]?.text ?? "";
  return { init: () => send("initialize", { protocolVersion: "2025-06-18" }), text };
}

test("the band lookup says the goods rest on the saved page, and the record tool serves the class whole", async (t) => {
  const runDir = seedRun(t);
  const band = bandServer(t, runDir);
  await band.init();
  const records = JSON.parse(await band.text("band_lookup", { text: "QZORVAK", limit: 20 })).records;
  const by = Object.fromEntries(records.map((r) => [r.record_id, [r.goods_from, r.goods_words]]));
  assert.deepEqual(by, {
    [A.record_id]: [LABEL, "1 of 1: telescopes"], [B.record_id]: ["search answer, cut by the register", null],
    [C.record_id]: ["search answer, cut by the register", null], [D.record_id]: ["official record", "0 of 1"],
    [E.record_id]: ["search answer", "0 of 1"], [F.record_id]: ["search answer, cut by the register", null], [G.record_id]: [LABEL, "0 of 1"],
  }, "the client's word cut off the row is read on the page, and every other record keeps its reading");
  const lines = (await band.text("band_record", { record_id: A.record_id })).split("\n");
  assert.deepEqual(lines.slice(1, 3).map((l) => JSON.parse(l)), [
    { class: "42", text: S42, goods_from: LABEL }, { class: "44", text: S44, goods_from: "search answer" }]);
});

test("a page the stage's own research saves after its first lookup is read from its next one", async (t) => {
  const runDir = seedRun(t);
  const band = bandServer(t, runDir);
  await band.init();
  const fOf = async () => JSON.parse(await band.text("band_lookup", { record_id: F.record_id })).records[0].goods_from;
  assert.equal(await fOf(), "search answer, cut by the register");
  keep(runDir, "2026-11-03T11-00-00-000Z-5151-7.json", fetched([[SERIAL.later, statusPage([["042", S42]])]]));
  assert.equal(await fOf(), LABEL);
});
