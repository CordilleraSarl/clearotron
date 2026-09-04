// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("similar-groups.db", { readOnly: true });
console.log("Q: I sell cosmetics in Taiwan (group 0301). What else must be searched?\n");
const r = db.prepare(`SELECT DISTINCT to_group FROM cross_reference
                      WHERE office='TW' AND source_group='0301' AND to_group IS NOT NULL`).all();
console.log("   must also search:", r.map(x => x.to_group).join(", "));
// The office's sentence is dropped from what ships (see export-public.mjs), so this CITES it rather
// than quoting it — and says which, instead of printing "null" or throwing on a public-only build.
const note = db.prepare(`SELECT note_text_zh, printed_page, note_number, scope_zh FROM cross_reference
                         WHERE office='TW' AND source_group='0301' LIMIT 1`).get();
const src = db.prepare("SELECT document, edition FROM provenance WHERE office='TW' LIMIT 1").get();
if (note?.note_text_zh) console.log("   source note:", note.note_text_zh.slice(0, 88));
else console.log(`   source: ${src?.document ?? "unknown"} (${src?.edition ?? "?"}), group 0301` +
                 `${note?.printed_page ? `, printed p.${note.printed_page}` : ""} — the office's wording is not carried here, by design`);
console.log("\n   -> 4402 is class 44 (hairdressing/beauty services) and 351918 is a class 35 retail");
console.log("      sub-group. A class-3 cosmetics search that ignored these would miss both.\n");
const stats = db.prepare(`SELECT office, COUNT(*) n, COUNT(DISTINCT source_group) g FROM cross_reference GROUP BY office`).all();
for (const s of stats) console.log(`   ${s.office}: ${s.n} relations across ${s.g} source groups`);
const cross = db.prepare(`SELECT COUNT(*) n FROM cross_reference
  WHERE office='TW' AND to_group IS NOT NULL AND SUBSTR(to_group,1,2) <> SUBSTR(source_group,1,2)`).get();
console.log(`   of which CROSS-CLASS (different Nice class): ${cross.n}`);
