// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RECORD'S GOODS ARE SERVED ONCE.
//
// A Clarivate record holds its goods twice: the register's raw list (`_raw.goodsServices.intClassDescriptions`)
// and the normalised `goodsServices` the provider maps from it, item for item. `band_record` served both, so every
// goods statement was read twice: on a crowded test run, 2026-10-13, the raw goods were 22.7 of the 53.5 MB of
// record text, and one synthesis attempt read 10.79 MB in 549 calls where 6.03 MB in 398 carry the same. A record
// is now served without the raw list where the normalised goods carry it, and as it stands where they do not.
// Every mark, owner and statement here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { rawGoodsCarried } from "../record-goods.mjs";

const SERVER = fileURLToPath(new URL("../engine/mcp/band-server.mjs", import.meta.url));
// The answer sizes a Codex run gives the band server (engine/mcp/codex-config.mjs).
const CODEX_SIZES = { CLEAROTRON_BAND_RESPONSE_CHARS: "30000", CLEAROTRON_TOOL_ANSWER_BYTES: "36000" };

/** One goods statement, as the register writes it and as the provider maps it. */
const item = (cls, text, lang = "en", tr = null) => ({
  raw: { intClassNumber: cls, intGoodsLanguageCode: lang, intGoodsServicesDescription: text,
    ...(tr ? { cmComputerTranslationIntGoodsLanguageCode: "en", cmComputerTranslationIntGoodsServicesDescription: tr } : {}) },
  norm: { classes: String(cls).split(",").map(Number), language: lang, description: text, translation_language: tr ? "en" : null, translation: tr },
});
const record = (id, items, extraGoods = {}) => ({
  uri: `/mark/eu/${id}`, provider: "clarivate", office: "EM", markText: "QZORVAK", goodsServices: items.map((i) => i.norm),
  _raw: { contentType: "TM", applicants: [{ name: "Alpha Ltd" }], goodsServices: { intClassDescriptions: items.map((i) => i.raw), ...extraGoods }, status: "Registered" },
  _uri: `/mark/eu/${id}`,
});
/** The record with its raw international list left out, and the goods block with it when nothing else is in it. */
function servedOnce(rec) {
  const want = structuredClone(rec);
  delete want._raw.goodsServices.intClassDescriptions;
  if (!Object.keys(want._raw.goodsServices).length) delete want._raw.goodsServices;
  return want;
}
const asFiled = (rec) => JSON.stringify(rec, null, 2) + "\n";   // as the run writes `_records/` (registry-fidelity.mjs)

function runDir(t, records) {
  const d = mkdtempSync(join(tmpdir(), "goods-once-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(join(d, "_records"), { recursive: true });
  mkdirSync(driverDir(d), { recursive: true });
  for (const r of records) writeFileSync(join(d, "_records", `${r.uri.replace(/^\/mark\//, "").replace(/[^a-z0-9]+/g, "-")}.json`), asFiled(r));
  return d;
}
const readingLog = (d) => readFileSync(driverDir(d, "reading-log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** One session with the band server: the text of each band_record call, in order. */
async function records(dir, calls, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: dir, ...env } });
    child.stdout.setEncoding("utf8");
    let buf = "";
    const got = new Map();
    const done = () => { clearTimeout(timer); child.kill("SIGKILL"); resolve(calls.map((_, i) => got.get(i + 2))); };
    const timer = setTimeout(done, 8000);
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id >= 2) got.set(m.id, m.result.content.map((c) => c.text).join("")); } catch { /* not ours */ }
        if (got.size === calls.length) done();
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    calls.forEach((args, i) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i + 2, method: "tools/call", params: { name: "band_record", arguments: args } }) + "\n"));
  });
}

/** Every part of one record, read the way a model reads them: the joined text, and how many calls it took. */
async function wholeRecord(dir, uri, env) {
  const [first] = await records(dir, [{ record_id: uri }], env);
  const total = Number(/^\[band_record part 1\/(\d+)\./.exec(first)?.[1] ?? 1);
  if (total === 1) return { text: first, parts: 1 };
  const rest = await records(dir, Array.from({ length: total - 1 }, (_, i) => ({ record_id: uri, part: i + 2 })), env);
  const body = (t) => t.slice(t.indexOf("\n") + 1, t.lastIndexOf("\n["));
  return { text: [first, ...rest].map(body).join("\n"), parts: total };
}

const AGREE = record("000000001", [item("9", "Scheduling software."), item("9,42", "Logiciels de planification.", "fr", "Scheduling software design.")]);

test("a record whose normalised goods carry the raw list is served without it, and nothing else in it changes", async (t) => {
  assert.equal(rawGoodsCarried(AGREE), true);
  const dir = runDir(t, [AGREE]);
  const [text] = await records(dir, [{ record_id: AGREE.uri }]);
  assert.equal(text, asFiled(servedOnce(AGREE)), "the record was not served as the file less its raw goods list, in the file's own layout");
  assert.ok(!text.includes("intGoodsServicesDescription"), "the raw goods list was served");
  assert.deepEqual(JSON.parse(text).goodsServices, AGREE.goodsServices, "the normalised goods changed");
  const [row] = readingLog(dir);
  assert.equal(row.raw_goods_left_out, asFiled(AGREE).length - text.length, "the reading audit does not say how much was left out");
});

test("where the two differ, the record is served as it stands", async (t) => {
  const differ = [
    record("000000002", [item("9", "Scheduling software.")]),                                     // the description differs
    record("000000003", [item("9", "Scheduling software.")]),                                     // a field the mapping never reads
    record("000000004", [item("IX", "Scheduling software.")]),                                    // a class not written as a number
    record("000000005", [item("9", "Scheduling software."), item("42", "Software design.")]),     // the normalised list is short
  ];
  differ[0].goodsServices[0].description = "Scheduling software";
  differ[1]._raw.goodsServices.intClassDescriptions[0].intGoodsServicesRemark = "Limited";
  differ[3].goodsServices.pop();
  const dir = runDir(t, differ);
  const texts = await records(dir, differ.map((r) => ({ record_id: r.uri })));
  differ.forEach((r, i) => {
    assert.equal(rawGoodsCarried(r), false, `${r.uri} read as carried`);
    assert.equal(texts[i], asFiled(r), `${r.uri} was not served as it stands`);
  });
  assert.deepEqual(readingLog(dir).filter((x) => "raw_goods_left_out" in x), [], "a record served as it stands was audited as cut");
});

test("the rest of the raw goods block stays: a national class list is not the normalised goods' to carry", async (t) => {
  const rec = record("000000006", [item("9", "Scheduling software.")], { natClassDescriptions: [{ natClassNumber: "1", natGoodsServicesDescription: "Logiciels." }] });
  const dir = runDir(t, [rec]);
  const [text] = await records(dir, [{ record_id: rec.uri }]);
  assert.deepEqual(JSON.parse(text)._raw.goodsServices, { natClassDescriptions: rec._raw.goodsServices.natClassDescriptions });
});

test("an oversize record comes in fewer parts, and its parts still join to exactly what is served", async (t) => {
  const words = (n) => Array.from({ length: n }, (_, i) => `zorvak${i % 97} scheduling`).join(", ");
  const items = Array.from({ length: 24 }, (_, i) => item(String(1 + (i % 45)), `${words(120)}.`));
  const once = record("000000007", items);
  const whole = record("000000008", items);
  whole.goodsServices = structuredClone(whole.goodsServices);
  whole.goodsServices[23].description += " ";                                                     // differs: served as it stands
  const dir = runDir(t, [once, whole]);
  const a = await wholeRecord(dir, once.uri, CODEX_SIZES);
  const b = await wholeRecord(dir, whole.uri, CODEX_SIZES);
  assert.ok(b.parts >= 4, `control: the record served as it stands came in ${b.parts} parts — too few to show a drop`);
  assert.ok(a.parts <= b.parts / 2 + 1, `served once, the record still took ${a.parts} parts against ${b.parts}`);
  assert.equal(a.text, asFiled(servedOnce(once)), "the parts do not join to the record less its raw goods list");
  assert.equal(b.text, asFiled(whole), "the parts of the record served as it stands do not join to the file");
});

test("a record answered from the run's ledger is served once too", async (t) => {
  const dir = runDir(t, []);
  writeFileSync(driverDir(dir, "register-record-bodies.jsonl"), JSON.stringify({ target: AGREE.uri, body: AGREE }) + "\n");
  const [text] = await records(dir, [{ record_id: AGREE.uri }]);
  assert.equal(text, JSON.stringify(servedOnce(AGREE), null, 2));
  assert.ok(readingLog(dir)[0].raw_goods_left_out > 0);
});

test("a record with no raw goods list, or a provider that holds no normalised one, is not carried", () => {
  assert.equal(rawGoodsCarried({ goodsServices: AGREE.goodsServices }), false);
  assert.equal(rawGoodsCarried({ _raw: { classifications: [{ nice_class: 9, goods_services_text: "Scheduling software." }] } }), false);
  assert.equal(rawGoodsCarried({ ...AGREE, goodsServices: [] }), false);
  assert.equal(rawGoodsCarried(null), false);
});
