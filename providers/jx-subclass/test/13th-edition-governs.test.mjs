// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — WHICH EDITION ANSWERS A CHINA SIMILAR-GROUP LOOKUP.
//
// Three sources gave three codes for one good. Owner ruling, 2026-08-20: "13th edition. done." — option
// 2, accepting that the 12th's assignments lose authority WHEREVER THE EDITIONS DISAGREE.
//
// That last clause is what these arms are about, because disagreement is not the only case:
//
//   · a good BOTH editions hold, with different codes   → the 13th governs      (25 basic numbers)
//   · a good BOTH editions hold, agreeing               → unchanged            (8,959)
//   · a good only the 12th holds                        → the 12th answers, and says so   (1,858,
//     of which 1,757 are the ※C-numbered China-only goods that carry no Nice basic number and can
//     therefore appear in no concordance at all)
//
// Those counts are measured on the committed `public/` data, not estimated. The fixture below reproduces
// one good of each kind — including the issue's own specimen, 3D 眼镜 / 090726, which the 区分表 prints
// under 0921 and the concordance places at 0911.
//
// THE FIXTURE IS BUILT FROM THE SHIPPED DDL, so it cannot drift from the schema the loader writes. It is
// in-memory: no database file, no office document, nothing fetched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { subclassesFor } from "../lookup.mjs";
import { GOODS_FOLD_DDL, foldZh } from "../terms.mjs";
import { CN_GOODS_DDL } from "../load-cn-goods.mjs";
import { COVERAGE_DDL } from "../coverage.mjs";
import { SCHEMA_DDL } from "../build-db.mjs";

/** The three shapes, with the specimen's real numbers. */
const CN_GOODS = [
  // BOTH editions, DISAGREEING — the issue's specimen.
  { no: "090726", nice_class: 9, group_code: "0921", name: "3D 眼镜", page: 86, china_only: 0 },
  // BOTH editions, AGREEING — the control. Without it a "the 13th won" arm cannot tell governing from
  // simply reading a different table.
  { no: "090001", nice_class: 9, group_code: "0901", name: "计算机", page: 80, china_only: 0 },
  // The 12th ALONE — a China-only good. No Nice basic number, so no concordance can hold it.
  { no: "C090123", nice_class: 9, group_code: "0913", name: "中国专用商品", page: 92, china_only: 1 },
];
const GROUP_CODE = [
  { basic_no: "090726", office: "CN", code: "0911" },   // the 13th moves the specimen
  { basic_no: "090001", office: "CN", code: "0901" },   // and agrees about the control
];

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(SCHEMA_DDL);
  d.exec(GOODS_FOLD_DDL);
  d.exec(CN_GOODS_DDL);
  d.exec(COVERAGE_DDL);
  const ins = d.prepare("INSERT INTO cn_goods (no, nice_class, group_code, name_zh_cn, fold, printed_page, china_only) VALUES (?,?,?,?,?,?,?)");
  for (const g of CN_GOODS) ins.run(g.no, g.nice_class, g.group_code, g.name, foldZh(g.name), g.page, g.china_only);
  // `group_code.basic_no` references goods(basic_no), so the referenced rows exist — a fixture that
  // skipped them would be testing a shape the loader cannot produce.
  const good = d.prepare("INSERT OR IGNORE INTO goods (basic_no, nice_class) VALUES (?, ?)");
  for (const g of GROUP_CODE) good.run(g.basic_no, 9);
  const gc = d.prepare("INSERT INTO group_code (basic_no, office, code) VALUES (?,?,?)");
  for (const g of GROUP_CODE) gc.run(g.basic_no, g.office, g.code);
  // The gate `subclassesFor` runs before it answers anything: a class this database has not transcribed
  // is REFUSED by name rather than answered thinly, so the fixture has to declare its own coverage.
  d.exec("INSERT OR IGNORE INTO coverage (office, layer, nice_class, status) VALUES ('CN','group_code',9,'extracted')");
  return d;
}

const ask = (d, term) => subclassesFor(d, { country: "CN", term, niceClass: 9 });

test("#1391 THE FIXTURE IS REAL — the two editions genuinely disagree about the specimen", () => {
  // Without this the governing arm below could pass over two tables that say the same thing.
  const d = db();
  const twelfth = d.prepare("SELECT group_code FROM cn_goods WHERE no = '090726'").get();
  const thirteenth = d.prepare("SELECT code FROM group_code WHERE basic_no = '090726' AND office = 'CN'").get();
  assert.equal(twelfth.group_code, "0921", "the 区分表 side of the disagreement is gone from the fixture");
  assert.equal(thirteenth.code, "0911", "the concordance side is gone");
  assert.notEqual(twelfth.group_code, thirteenth.code, "the fixture no longer disagrees, so nothing below is about anything");
});

test("#1391 the 13th edition GOVERNS where the two disagree", () => {
  const r = ask(db(), "3D 眼镜");
  assert.equal(r.status, "ok");
  assert.deepEqual(r.codes, ["0911"],
    "the answer still carries the 12th edition's 0921. The ruling is that the concordance governs the "
    + "code wherever the editions disagree, and this good is the specimen the issue was opened on.");
  assert.equal(r.matched[0].code_edition, 13, "the answer must say WHICH edition decided it");
  assert.equal(r.matched[0].cn_goods_code, "0921",
    "what the 12th said is dropped from the answer — a reader cannot see that an edition moved this good");
  assert.match(r.source, /13th edition governs/);
});

test("#1391 CNIPA's own wording still FINDS the good — the 区分表 is the matcher, not the decider", () => {
  // The reason cn_goods is consulted at all: the two offices name the same basic number differently
  // three times in four, and a Chinese client writes CNIPA's wording. If the concordance became the
  // matcher too, this term would resolve to nothing.
  const r = ask(db(), "3D 眼镜");
  assert.match(r.matchedHow, /^cn-/, "the match no longer comes from the 区分表, so CNIPA's wording stopped finding goods");
  assert.equal(r.matched[0].basic_no, "090726");
  assert.equal(r.matched[0].printed_page, 86, "the printed page rides on the row, so a lawyer can still open it");
});

test("#1391 a good the 13th has never heard of is answered by the 12th, and the answer says why", () => {
  // 1,858 of them on the committed data, 1,757 being the ※C-goods. "Loses authority where they disagree"
  // is not "is deleted": there is nothing here for the 13th to disagree WITH.
  const r = ask(db(), "中国专用商品");
  assert.equal(r.status, "ok");
  assert.deepEqual(r.codes, ["0913"], "a China-only good stopped being answerable — 1,757 of them go dark on this path");
  assert.equal(r.matched[0].code_edition, 12);
  assert.equal(r.matched[0].china_only, true);
  assert.match(r.source, /holds no group for this good/,
    "the answer does not say the 13th simply has no row here — a reader would read a 12th-edition code as a ruled one");
});

test("#1391 where the editions AGREE the answer is unchanged, and it is still the 13th that ruled", () => {
  const r = ask(db(), "计算机");
  assert.deepEqual(r.codes, ["0901"]);
  assert.equal(r.matched[0].code_edition, 13,
    "an agreeing good must still be decided by the concordance — otherwise the rule is 'the 13th wins "
    + "arguments' rather than 'the 13th governs', and the two come apart the moment the 12th is edited");
});
