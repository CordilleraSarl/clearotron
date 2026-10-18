// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE GOODS A BAND ROW HOLDS ARE READ.
//
// The band shape tested a record's goods only through a held body, and a register that sends each record's class
// statements on its search row, cut at a length, holds a body only for a record something fetched. With none held
// when placement starts, every line the goods test would have put in (a), (c) or (d) was listed among the lines
// whose goods are unknown. The shape now reads the statements the row carries where no body is held, and keeps
// what each rests on: a statement the register cut that matches no word proves nothing, so that record stays
// unknown. "On file" still means a body `band_record` can open, and the band tools show a row's goods words as
// the shape does. Every mark, owner and statement here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { normalizeSearchResponse } from "../../providers/signa/src/core.js";
import { buildBandShape } from "../band-shape.mjs";
import { bandShapeGoods, rowGoods, goodsWordCounter, goodsWordsMatched, goodsEvidence } from "../record-goods.mjs";

const statement = (text, cut = false) => ({ nice_class: 9, goods_services_text: text, goods_services_language: "en", ...(cut ? { goods_services_text_truncated: true } : {}) });
const vendorRow = (id, mark, owner, classifications) => ({ id, mark_text: mark, jurisdiction_code: "US", office_code: "US",
  status: { primary: "active", stage: "registered" }, classifications,
  owners: [{ id: `o-${id}`, name: owner, country_code: "CH" }], filing_date: "2019-03-04", registration_date: "2020-01-02" });
const ROWS = normalizeSearchResponse({ data: [
  vendorRow("s1", "QZORVAK", "Alpha Ltd", [statement("Joysticks and game controllers")]),         // whole, a match → (a)
  vendorRow("s2", "QZORVAK", "Beta GmbH", [statement("Laser printers")]),                          // whole, no match → (b)
  vendorRow("s3", "QZORVAK", "Gamma SA", [statement("Printers, scanners and toner cartri", true)]), // cut, no match → unknown
  vendorRow("s4", "QZORVAK", "Delta AG", [statement("Cables; joysticks; power suppl", true)]),     // cut, a match → (a)
  vendorRow("s5", "QZORVAK", "Eta Kft", [{ nice_class: 9 }]),                                      // no statement → unknown
  vendorRow("s6", "Plimbo", "Zeta BV", [statement("Joysticks")]),                                  // another mark, a match → (d)
  vendorRow("s7", "QZORVAK", "Theta Oy", [statement("Laser printers")]),                           // a held body says joysticks → (a)
  vendorRow("s8", "QZORVAK", "Iota Oy", [statement("Laser printers")]),                            // a held body the engine cannot read
], pagination: { total_count: 8, has_more: false } }, "qzorvak").results;
const id = (k) => ROWS.find((r) => r.id === k).record_id;
const HELD = [
  { target: id("s7"), body: { _raw: { classifications: [statement("Joysticks for consoles")] } } },
  { target: id("s8"), body: { _raw: { classifications: [{ nice_class: 9, goods_services_text: "Druckerpatronen", goods_services_language: "de" }] } } },
];

function runWith(t) {
  const runDir = mkdtempSync(join(tmpdir(), "row-goods-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = { runDir, variantManifestModel: join(runDir, "variant-manifest.json"), registerPlan: driverDir(runDir, "register-plan.json") };
  writeFileSync(P.variantManifestModel, JSON.stringify({ schema_version: 1, mark: "QZORVAK", dominant_element: "QZORVAK",
    elements: [{ value: "QZORVAK", kind: "distinctive" }], variants: [{ value: "QZORVAK", category: "core" }],
    incumbent_classes: [], watchlist_owners: [], goods_words: ["joysticks"], product_words: ["joysticks"] }));
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), HELD.map((h) => JSON.stringify(h)).join("\n") + "\n");
  const g = bandShapeGoods(P, ROWS);
  const { shape } = buildBandShape({ enumerated: ROWS, crowds: [] }, { targets: ["Qzorvak"], inScopeClasses: ["9"], ...g });
  return { P, runDir, g, shape };
}
const where = (shape, k) => ["a", "b", "c", "d", "rest", "no_goods"].find((grp) => shape.groups[grp].list.some((l) => l.record_id === id(k)));
const lineOf = (shape, k) => ["a", "b", "c", "d", "rest", "no_goods"].flatMap((grp) => shape.groups[grp].list).find((l) => l.record_id === id(k));

test("with no body held, the shape sorts a line by the statements its row carries", (t) => {
  const { shape } = runWith(t);
  assert.deepEqual(Object.fromEntries(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((k) => [k, where(shape, k)])),
    { s1: "a", s2: "b", s3: "no_goods", s4: "a", s5: "no_goods", s6: "d", s7: "a", s8: "no_goods" });
  assert.deepEqual(lineOf(shape, "s1").goods_words, ["joysticks"]);
  assert.deepEqual(lineOf(shape, "s2").goods_words, [], "a whole statement that names none of the client's goods says so");
});

test("a statement the register cut proves nothing by what it lacks", () => {
  const count = goodsWordCounter(["joysticks"], { stems: true }), matched = goodsWordsMatched(["joysticks"], { stems: true });
  const of = (k) => rowGoods(ROWS.find((r) => r.id === k));
  assert.deepEqual([count(of("s2")), matched(of("s2"))], [0, []], "whole and no match: not the client's goods");
  assert.deepEqual([count(of("s3")), matched(of("s3"))], [null, null], "cut and no match: unknown, never a mismatch");
  assert.deepEqual([count(of("s4")), matched(of("s4"))], [1, ["joysticks"]], "cut and a match: the match stands");
  assert.equal(of("s3")[0].cut, true);
  assert.equal(of("s2")[0].cut, undefined);
  assert.equal(of("s5"), null, "a row with no statement holds no goods");
});

test("a line is on file only where a body is held, so band_record is never pointed at a record it refuses", (t) => {
  const { shape } = runWith(t);
  assert.equal(lineOf(shape, "s3").goods_on_file, false, "a row's cut statement is not a body band_record can open");
  assert.equal(lineOf(shape, "s8").goods_on_file, true, "a held body in a language the engine cannot read is on file");
});

test("the run record counts what each record's goods rest on", (t) => {
  const { g } = runWith(t);
  assert.deepEqual(goodsEvidence(ROWS, g.goods), { held: 2, complete: 3, cut: 2, unknown: 0, none: 1 });
});

test("a band whose rows carry no statements, with no body held, is read as before", (t) => {
  const { P } = runWith(t);
  writeFileSync(driverDir(P.runDir, "register-record-bodies.jsonl"), "");
  const plain = [{ record_id: "/mark/eu/p1", mark_text: "QZORVAK", owner_name: "Kappa Ltd", classes: ["9"], status: "registered" }];
  assert.equal(bandShapeGoods(P, plain).goods, null, "with nothing held, the shape still tests no goods");
});

const SERVER = fileURLToPath(new URL("../engine/mcp/band-server.mjs", import.meta.url));
async function lookup(runDir, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
    child.stdout.setEncoding("utf8");
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 8000);
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.kill("SIGKILL"); resolve(JSON.parse(m.result.content[0].text)); } } catch { /* not ours */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "band_lookup", arguments: args } }) + "\n");
  });
}

test("band_lookup shows a row's goods words as the shape's line does", async (t) => {
  const { runDir, shape } = runWith(t);
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated: ROWS, crowds: [] }));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape));
  const words = async (k) => (await lookup(runDir, { record_id: id(k) }))?.records?.[0]?.goods_words;
  assert.equal(await words("s1"), "1 of 1: joysticks", "the row's whole statement was not read");
  assert.equal(await words("s4"), "1 of 1: joysticks", "a match in a cut statement was not read");
  assert.equal(await words("s3"), null, "a cut statement with no match was read as a mismatch");
  assert.equal(await words("s2"), "0 of 1");
});
