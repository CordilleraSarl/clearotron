// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { mustRead } from "./sources.mjs";
const db = new DatabaseSync("similar-groups.db");
db.exec(`CREATE TABLE IF NOT EXISTS class_span (
  office TEXT NOT NULL, group_code TEXT NOT NULL, nice_class INTEGER NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('exam_standard','intl_table','derived_from_goods')),
  PRIMARY KEY (office, group_code, nice_class, basis));`);
db.exec("DELETE FROM class_span WHERE office='JP'");
const notes = JSON.parse(mustRead("jp/jp-class-notes.json", "the JPO class-span source"));
const ins = db.prepare("INSERT OR IGNORE INTO class_span VALUES (?,?,?,?)");
let n = 0;
db.exec("BEGIN");
for (const r of notes) {
  for (const c of [...r.exam_standard_classes, r.sheet_class]) { ins.run("JP", r.source_group, c, "exam_standard"); n++; }
  for (const c of [...r.intl_table_classes, r.sheet_class]) { ins.run("JP", r.source_group, c, "intl_table"); n++; }
}
// the goods-derived span, so the two can be compared in SQL
const rows = JSON.parse(mustRead("jp/jpo-13-2026.json", "the JPO class-span source"));
for (const r of rows) if (r.nice_class) ins.run("JP", r.group_code, r.nice_class, "derived_from_goods");
db.exec("COMMIT");
const q = db.prepare(`SELECT basis, COUNT(DISTINCT group_code) g, COUNT(*) n FROM class_span WHERE office='JP' GROUP BY basis`).all();
for (const x of q) console.log(`  ${x.basis}: ${x.g} groups, ${x.n} group-class pairs`);
// 審査基準 governs examination; 国際分類表 does not. Quoting one as "the notes" without saying which
// is how this file previously reported the gap as 52 when the examination-standard gap is 24.
const diff = (a, b) => db.prepare(`SELECT COUNT(*) n FROM (
  SELECT group_code, nice_class FROM class_span WHERE office='JP' AND basis='${a}'
  EXCEPT SELECT group_code, nice_class FROM class_span WHERE office='JP' AND basis='${b}')`).get().n;
console.log(`  pairs 審査基準 (exam standard) has and the goods data does NOT: ${diff("exam_standard", "derived_from_goods")}`);
console.log(`  pairs 国際分類表 (intl table)  has and the goods data does NOT: ${diff("intl_table", "derived_from_goods")}`);
console.log(`  pairs the goods data has and 審査基準 does NOT:                ${diff("derived_from_goods", "exam_standard")}`);
console.log(`  -> neither is a superset: a class-span query must UNION both bases.`);
