// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("similar-groups.db", { readOnly: true });

console.log("1. CUSTOMER WORDING -> official goods (FTS5 match)");
for (const q of ['"hair" AND "shampoo"', 'sunglasses', '"pet" AND "diapers"']) {
  const r = db.prepare(`SELECT f.basic_no, g.nice_class, f.name_en FROM goods_fts f
                        JOIN goods g ON g.basic_no=f.basic_no WHERE goods_fts MATCH ? LIMIT 2`).all(q);
  for (const x of r) console.log(`   "${q}" -> ${x.basic_no} cls ${x.nice_class}  ${x.name_en?.slice(0,44)}`);
}

console.log("\n2. ONE GOOD -> its group in every country");
const one = db.prepare(`SELECT office, code FROM group_code WHERE basic_no=? ORDER BY office`).all("030134");
console.log("   shampoos (030134):", one.map(r => `${r.office}=${r.code}`).join("  "));

console.log("\n3. THE CROSS-CLASS TEST — everything Japan treats as similar to pet diapers");
const jp = db.prepare(`SELECT code FROM group_code WHERE basic_no=(SELECT basic_no FROM goods WHERE name_en LIKE 'diapers for pets%' LIMIT 1) AND office='JP'`).get();
const fam = db.prepare(`SELECT DISTINCT g.nice_class, g.name_en FROM group_code c JOIN goods g ON g.basic_no=c.basic_no
                        WHERE c.office='JP' AND c.code=? ORDER BY g.nice_class LIMIT 6`).all(jp.code);
console.log(`   JP group ${jp.code} spans:`);
for (const r of fam) console.log(`     class ${String(r.nice_class).padStart(2)}  ${r.name_en?.slice(0,46)}`);
const n = db.prepare(`SELECT COUNT(DISTINCT nice_class) n FROM group_code c JOIN goods g ON g.basic_no=c.basic_no WHERE c.office='JP' AND c.code=?`).get(jp.code);
console.log(`   -> ${n.n} Nice classes. Scoping this search by class would miss all but one.`);

console.log("\n4. cross_reference table (awaiting the CNIPA notes):",
  db.prepare("SELECT COUNT(*) n FROM cross_reference").get().n, "rows");
