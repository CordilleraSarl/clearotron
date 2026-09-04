// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Load cross-references into the reference DB, validating every row.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { mustRead } from "./sources.mjs";
const db = new DatabaseSync("similar-groups.db");
db.exec("DELETE FROM cross_reference WHERE office='TW'");
// Authority for TW group codes is TIPO's own per-class files (635 groups), NOT the
// concordance (609) — the concordance only lists goods that carry a Nice basic number,
// so validating against it silently rejected 14 real groups.
const known = new Set(JSON.parse(mustRead("tw/tw-group-codes.json", "the TIPO cross-reference sources")));
for (const r of db.prepare("SELECT DISTINCT code FROM group_code WHERE office='TW'").all()) known.add(r.code);
const rows = JSON.parse(mustRead("tw/tw-cross-references.json", "the TIPO cross-reference sources"));
const ins = db.prepare(`INSERT INTO cross_reference
  (office,source_group,to_group,type,scope_zh,edition_qualifier,printed_page,note_number,note_text_zh,needs_review)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
let loaded = 0, sub = 0, unknown = new Set(), review = 0;
db.exec("BEGIN");
for (const r of rows) {
  if (!r.refs.length) { ins.run("TW", r.source_group, null, "similar", null, null, null, null, r.note_text_zh, 1); review++; continue; }
  for (const to of r.refs) {
    if (to.length === 6) { sub++; }                   // sub-group ref: parent group is its first 4 digits
    else if (!known.has(to)) { unknown.add(to); continue; }   // reject, do not import
    ins.run("TW", r.source_group, to, "cross_search", null, null, null, null, r.note_text_zh, 0);
    loaded++;
  }
}
db.exec("COMMIT");
console.log(`loaded ${loaded} relations | sub-group refs ${sub} | flagged for review ${review}`);
console.log(`rejected unknown group codes: ${unknown.size}`, [...unknown].slice(0, 8));
const q = db.prepare(`SELECT source_group, GROUP_CONCAT(to_group) t FROM cross_reference
                      WHERE office='TW' AND to_group IS NOT NULL GROUP BY source_group LIMIT 3`).all();
console.log("\nsample:"); for (const x of q) console.log(`  TW ${x.source_group} -> ${x.t}`);
