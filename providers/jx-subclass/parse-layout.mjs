// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// layout.json → the tranche JSONL that load-cn.mjs validates and loads.
//
//   node parse-layout.mjs --from 161 --to 252 --out cn/tranche2/cnipa-notes-161-252.jsonl
//
// Nothing here judges: it prints what it read, what it could not type, and what it dropped. A note it
// cannot parse is written with the relation it could not build named, never omitted.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { extractNotes, loadLayout } from "./layout-notes.mjs";
import { parseRelations } from "./relations.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i < 0 ? d : process.argv[i + 1]; };
const requireLayout = (v) => {
  if (v) return v;
  console.error("ABSENT: --layout <mineru layout.json> is required. There is no default: a path baked in\n" +
                "here would name one operator's home directory, and a wrong-but-present default reads as\n" +
                "data rather than as the missing argument it is. BUILDING.md says where the sources live.");
  process.exit(1);
};

const FROM = Number(arg("--from", 124)), TO = Number(arg("--to", 252));
const OUT = arg("--out", null);
const SRC = requireLayout(arg("--layout", null));

const CLASS_NUM = { 一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10 };
const classCode = (t) => {                                   // 第二十四类 → CLASS24
  const m = /^第([一二三四五六七八九十]+)类$/.exec(t ?? ""); if (!m) return null;
  const s = m[1]; let n = 0;
  if (s.includes("十")) { const [a, b] = s.split("十"); n = (a ? CLASS_NUM[a] : 1) * 10 + (b ? CLASS_NUM[b] : 0); }
  else n = CLASS_NUM[s] ?? 0;
  return n ? `CLASS${String(n).padStart(2, "0")}` : null;
};

const notes = extractNotes(loadLayout(SRC)).filter(n => n.printed_page >= FROM && n.printed_page <= TO);
const out = [], unparsed = [], noGroup = [];
let relCount = 0, rowCount = 0;
for (const n of notes) {
  const src = classCode(n.source_group) ?? n.source_group;
  if (!src) { noGroup.push(n); continue; }
  const { relations, unparsed: u } = parseRelations(n.text, /^\d{4}$/.test(src) ? src : null);
  for (const c of u) unparsed.push({ src, page: n.printed_page, text: c });
  const rec = { source_group: src, printed_page: n.printed_page, note_number: n.note_number,
                note_text_zh: n.text, relations: relations.map(r => ({ type: r.type, to_group: r.to_group ?? null,
                  scope_zh: r.scope_zh ?? null, edition_qualifier: r.edition_qualifier ?? null })) };
  if (u.length) { rec.needs_review = true; rec.review_reason = `clause carried no group code this parser could resolve: ${u.join(" / ")}`; }
  relCount += relations.length;
  rowCount += relations.reduce((a, r) => a + (Array.isArray(r.to_group) ? r.to_group.length : 1), 0);
  out.push(rec);
}

const classes = [...new Set(out.map(r => /^\d{4}$/.test(r.source_group) ? r.source_group.slice(0, 2) : r.source_group))].sort();
const pages = new Set(out.map(r => r.printed_page));
console.log(`printed ${FROM}-${TO}: ${out.length} note items | ${relCount} relation objects | ${rowCount} rows once lists expand`);
console.log(`groups ${new Set(out.map(r => r.source_group)).size} | classes ${classes.length} (${classes.join(",")})`);
console.log(`pages carrying at least one note: ${pages.size} of ${TO - FROM + 1}`);
const byType = {};
for (const r of out) for (const rel of r.relations) byType[rel.type] = (byType[rel.type] ?? 0) + 1;
console.log("by type:", byType);
console.log(`items flagged needs_review: ${out.filter(r => r.needs_review).length} | notes with no group context: ${noGroup.length}`);
if (unparsed.length) { console.log(`\nclauses this parser could not resolve to a group (${unparsed.length}):`);
  for (const u of unparsed.slice(0, 10)) console.log(`  ${u.src} p${u.page}: ${u.text.slice(0, 90)}`); }

if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, out.map(r => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\nwrote ${OUT}`); }
