// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SNAPSHOT READS REGISTER ANSWERS OF A REAL RUN'S SHAPE. Its Knockout scenarios read a list of one or two filings
// with no goods text, so the code that lists, shortens and prints a real list never ran in it. The generator here
// writes invented filings at the sizes measured on saved runs, in the register band's own row shape, the same bytes for
// the same name every time; these arms hold it to that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { realShapedFilings, seedRealShapedRecords, FILINGS_PER_NAME } = await import("./snapshot/real-shaped.mjs");
const { fixtureFileName, fixtureLister } = await import("../register-records.mjs");
const { SCENARIO_GAPS } = await import("./snapshot/behaviour-snapshot.mjs");

test("a name's filings are the same bytes every time, and another name's differ", () => {
  assert.equal(JSON.stringify(realShapedFilings("QUILLBRAE", { count: 40 })), JSON.stringify(realShapedFilings("QUILLBRAE", { count: 40 })));
  assert.notEqual(JSON.stringify(realShapedFilings("QUILLBRAE", { count: 40 })), JSON.stringify(realShapedFilings("MOSSVALE", { count: 40 })));
});

test("the filings are the measured shape: most of them long, half of them dead, some in another script", () => {
  const rows = ["QUILLBRAE", "MOSSVALE", "LANTERNWICK", "ODRAVEL"].flatMap((t) => realShapedFilings(t, { count: 100 }));
  const goods = rows.flatMap((r) => r.raw.classifications.map((c) => c.goods_services_text.length)).sort((a, b) => a - b);
  const share = (n) => n / rows.length;
  assert.ok(goods[goods.length >> 1] >= 200 && goods[goods.length >> 1] <= 320, `median goods text ${goods[goods.length >> 1]}, measured 255`);
  const over300 = goods.filter((g) => g > 300).length / goods.length;
  assert.ok(over300 > 0.3 && over300 < 0.55, `share of goods text past 300 characters ${over300}, measured 0.43`);
  assert.ok(goods.at(-1) >= 3000, "no goods text reaches the measured tail of thousands of characters");
  const dead = share(rows.filter((r) => r.status_class === "dead").length);
  assert.ok(dead > 0.4 && dead < 0.65, `share dead ${dead}, measured over half`);
  const other = share(rows.filter((r) => /[^\u0000-ɏ]/.test(r.mark_text)).length);
  assert.ok(other > 0 && other < 0.15, `share in another script ${other}, measured about 5%`);
  assert.deepEqual(FILINGS_PER_NAME.at(-1), 100, "the batch reaches the measured largest list");
});

test("a row is the register band's own shape, so the lister, the band and the reading take it as they take a register's", () => {
  const [row] = realShapedFilings("ODRAVEL", { count: 1 });
  for (const k of ["record_id", "mark_text", "owner_name", "status", "status_class", "classes", "raw"]) assert.ok(k in row, `a row lacks ${k}`);
  assert.match(row.record_id, /^\/mark\/[a-z]{2}\//);
  assert.ok(row.raw.classifications.length === row.classes.length, "each class carries its own goods statement");
});

test("the fixture folder holds one file per question, named as the tree under test names it, and the lister reads it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "real-shaped-"));
  try {
    seedRealShapedRecords(dir, [{ term: "VELMORA", count: 13 }, { term: "VELMORA", question: { matchMode: "contains" }, count: 2 }], fixtureFileName);
    assert.deepEqual(readdirSync(dir).sort(), [fixtureFileName("VELMORA", { matchMode: "contains" }), fixtureFileName("VELMORA", {})].sort());
    const answer = await fixtureLister(dir)("VELMORA", {});
    assert.equal(answer.ok, true);
    assert.equal(answer.records.length, 13);
    assert.equal(JSON.parse(readFileSync(join(dir, fixtureFileName("VELMORA", {})), "utf8")).total, 13);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the gap the comparison prints names what is still invented: a clearance's band", () => {
  assert.equal(SCENARIO_GAPS.length, 1);
  assert.match(SCENARIO_GAPS[0], /clearance/);
});
