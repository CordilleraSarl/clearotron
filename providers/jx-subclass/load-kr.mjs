// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { mustRead } from "./sources.mjs";
const db = new DatabaseSync("similar-groups.db");
db.exec("DELETE FROM cross_reference WHERE office='KR'");
const known = new Set(db.prepare("SELECT DISTINCT code FROM group_code WHERE office='KR'").all().map(r => r.code));
const rows = JSON.parse(mustRead("kr/kr-cross-references.json", "the KIPO cross-reference source"));
const ins = db.prepare(`INSERT INTO cross_reference
  (office,source_group,to_group,type,scope_zh,edition_qualifier,printed_page,note_number,note_text_zh,needs_review)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
let loaded = 0, unknownSrc = new Set(), unknownTo = new Set();
db.exec("BEGIN");
for (const r of rows) for (const x of r.refs) {
  if (!known.has(r.source_group)) unknownSrc.add(r.source_group);
  if (!known.has(x.to_group)) unknownTo.add(x.to_group);
  ins.run("KR", r.source_group, x.to_group, "similar", r.source_name || null, null, null, null, r.note_text_ko, 0);
  loaded++;
}
db.exec("COMMIT");
console.log(`KR loaded ${loaded} relations`);
console.log(`  source codes not in concordance: ${unknownSrc.size}`);
console.log(`  target codes not in concordance: ${unknownTo.size}`);
const tot = db.prepare("SELECT office, COUNT(*) n, COUNT(DISTINCT source_group) g FROM cross_reference GROUP BY office").all();
for (const t of tot) console.log(`  ${t.office}: ${t.n} relations / ${t.g} groups`);
const cross = db.prepare(`SELECT COUNT(*) n FROM cross_reference WHERE office='KR'
  AND SUBSTR(to_group,2,2) <> SUBSTR(source_group,2,2)`).get();
console.log(`  KR cross-class relations: ${cross.n}`);
