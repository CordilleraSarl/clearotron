// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// export-public.mjs — the shippable form of the table: everything a lookup needs, nothing quoted.
//
// ── WHAT COMES OUT, AND WHY THIS LINE ──────────────────────────────────────────────────────────────
//
// The offices' own terms differ and only one is open: TIPO publishes under Open Government Data
// License v1, CNIPA's site notice permits no commercial reproduction, KIPO publishes no licence and
// JPO's PDL1.0 has carve-outs nobody has confirmed. One policy for all four is simpler to hold than
// four, so this export applies the same rule everywhere:
//
//   DATA travels — group codes, relation types, edition qualifiers, the goods a relation binds.
//   QUOTATION does not — `note_text_zh`, the office's sentence as printed. 626 KB across three
//   offices, and no consumer reads it: acceptance 6 on  asks for a CITATION, not a quotation.
//
// A dropped quotation must not become an unauditable row. CN keeps printed page and note number, so
// its citation survives intact. KR and TW carry NEITHER — their extractions were never paginated, and
// the note text was the only thing tying a row to its source. For those, this export writes the
// locator the office's own structure provides: the document from `provenance`, plus the source group,
// which is the section heading you look under. Every row stays checkable in the original.
//
// The result rebuilds a working database with `load-public.mjs` and no office document present.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "public";
const db = new DatabaseSync(process.argv.includes("--db") ? process.argv[process.argv.indexOf("--db") + 1] : "similar-groups.db");
mkdirSync(OUT, { recursive: true });

const DROPPED = "note_text_zh";
const cite = { CN: "printed page and note number", KR: "source document + source group", TW: "source document (per-class file) + source group" };

const jsonl = (name, rows) => {
  const body = rows.map(r => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(`${OUT}/${name}`, body);
  return { file: name, rows: rows.length, bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") };
};
const all = (sql) => db.prepare(sql).all().map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)));

const manifest = { generated_from: "similar-groups.db", dropped_column: DROPPED, citation_by_office: cite, files: [] };
manifest.files.push(jsonl("goods.jsonl", all("SELECT basic_no, nice_class, name_en, name_zh_tw FROM goods ORDER BY basic_no")));
manifest.files.push(jsonl("group-code.jsonl", all("SELECT basic_no, office, code FROM group_code ORDER BY office, basic_no, code")));
manifest.files.push(jsonl("cross-reference.jsonl", all(
  `SELECT office, source_group, to_group, type, scope_zh, edition_qualifier, printed_page, note_number,
          needs_review, edition_gap FROM cross_reference ORDER BY office, source_group, id`)));
// CNIPA's own goods list: names and the group each prints under. Names are DATA under the same rule —
// what stays out is the office's SENTENCES, not its terms. Without these the ※C-goods reach nothing.
manifest.files.push(jsonl("cn-goods.jsonl", all("SELECT no, nice_class, group_code, name_zh_cn, printed_page, china_only FROM cn_goods ORDER BY group_code, no, name_zh_cn")));
manifest.files.push(jsonl("class-span.jsonl", all("SELECT office, group_code, nice_class, basis FROM class_span ORDER BY office, group_code, nice_class")));
manifest.files.push(jsonl("coverage.jsonl", all("SELECT office, layer, nice_class, status, read_pages, groups_no_notes, source_document, edition, note FROM coverage ORDER BY office, layer, nice_class")));
manifest.files.push(jsonl("provenance.jsonl", all("SELECT office, source, document, file, edition, effective, url, retrieved, sha256, bytes, contributes FROM provenance ORDER BY office, document")));

// What the export refuses to leave implicit: how much quotation was removed, per office.
const held = db.prepare(`SELECT office, COUNT(*) rows, SUM(LENGTH(COALESCE(note_text_zh,$e))) dropped_bytes,
                                SUM(CASE WHEN printed_page IS NOT NULL THEN 1 ELSE 0 END) with_page
                         FROM cross_reference GROUP BY office`).all({ e: "" });
manifest.dropped_by_office = Object.fromEntries(held.map(h => [h.office, { rows: h.rows, dropped_bytes: h.dropped_bytes, rows_citing_a_printed_page: h.with_page }]));
writeFileSync(`${OUT}/MANIFEST.json`, JSON.stringify(manifest, null, 2) + "\n");

const total = manifest.files.reduce((a, f) => a + f.bytes, 0);
console.log(`exported to ${OUT}/ — ${manifest.files.length} files, ${(total / 1024).toFixed(0)} KB`);
for (const f of manifest.files) console.log(`  ${f.file.padEnd(24)} ${String(f.rows).padStart(6)} rows  ${(f.bytes / 1024).toFixed(0).padStart(5)} KB`);
console.log(`\nquotation dropped (${DROPPED}):`);
for (const [o, d] of Object.entries(manifest.dropped_by_office))
  console.log(`  ${o}: ${(d.dropped_bytes / 1024).toFixed(0)} KB over ${d.rows} rows | rows citing a printed page ${d.rows_citing_a_printed_page} → cited by ${cite[o]}`);
