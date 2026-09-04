// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Load China's 注 (notes) cross-references into the reference DB.
//
// Input: cn/cnipa-cross-references.jsonl — one JSON object per note; the loader below is the shape's record.
// JSONL, not JSON: a malformed line costs one note and is named by line number, never the file.
//
// Run with --dry-run to validate without writing.
//
// ── TWO THINGS THIS FILE EXISTS TO GET RIGHT ───────────────────────────────────────────────────────
//
// 1. THE NOTES AND THE GOODS ARE DIFFERENT EDITIONS. CNIPA's notes come from the 12th edition (2023
//    text); the goods and group codes come from TIPO's NCL 13-2026 concordance. Groups retired between
//    the two — 0117 merged into 0407 at the 9th edition, 1203 into 1202 at the 10th, 0917 into 0751,
//    and 0305/0921 which are live in the 12th and absent from the 13th — are cited by notes that no
//    goods row can corroborate. They are REAL RELATIONS, so they import with `edition_gap = 1` rather
//    than being rejected. Validating them against the 13th-edition code set would have silently
//    dropped 33 relations the office actually states.
//
// 2. RELATION TYPE SPELLINGS DRIFT ACROSS A LONG EXTRACTION RUN. `cross_group_protection` and
//    `cross_group_protected` are the same construct written two ways in different batches. Normalising
//    is safe; INVENTING a mapping is not, so anything unrecognised is rejected and named, never guessed.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");
const FILE = process.argv.find(a => a.endsWith(".jsonl")) ?? "cn/cnipa-cross-references.jsonl";
const PAGES = 278;                       // the 2023-text edition; a different edition must change this

// Spellings seen in the delivered batches, folded onto the four schema types. `internal_note` and
// `needs_review_placeholder` carry no assertable relation — they keep their text and are flagged.
const TYPE_MAP = {
  similar: "similar",
  cross_search: "cross_search",
  intra_group_exception: "intra_group_exception",
  cross_group_protected: "cross_group_protected",
  cross_group_protection: "cross_group_protected",
  internal_note: null,
  needs_review_placeholder: null,
};

if (!existsSync(FILE)) { console.error(`ABSENT: ${FILE} — nothing to load (an absence is a finding, not a pass)`); process.exit(1); }

const db = new DatabaseSync("similar-groups.db");
const known = new Set(db.prepare("SELECT DISTINCT code FROM group_code WHERE office='CN'").all().map(r => r.code));
console.log(`CN group codes in the NCL 13-2026 goods table: ${known.size}`);

// CNIPA prints some codes full-width (０５０１). NFKC folds them; anything else is left verbatim.
const norm = (s) => typeof s === "string" ? s.normalize("NFKC").trim() : s;
// Some notes are CLASS-level, not group-level: 跨类似群保护商品 clauses that head a whole class, and
// "根据功能用途与5类…类似" clauses that name a class with no group code. The extraction marks these
// `CLASS07` / `Class24_intro`. They are real and must not be dropped, so a class-level note is stored
// with a TWO-CHARACTER source_group ("07") — a length no group code can have, so no consumer can
// mistake one for the other.
const classLevel = (g) => { const m = /^class[_-]?(\d{1,2})/i.exec(String(g ?? "")); return m ? String(+m[1]).padStart(2, "0") : null; };
// Well-formed: 4 digits whose first two are a Nice class, or a 6-digit sub-group of one.
const wellFormed = (g) => /^\d{4}$/.test(g) ? +g.slice(0, 2) >= 1 && +g.slice(0, 2) <= 45
                        : /^\d{6}$/.test(g) ? +g.slice(0, 2) >= 1 && +g.slice(0, 2) <= 45 : false;
const inGoods = (g) => /^\d{4}$/.test(g) ? known.has(g) : known.has(g.slice(0, 4));

const lines = readFileSync(FILE, "utf8").split("\n");
const rej = { badLine: [], malformedGroup: [], unknownType: [], badPage: [] };
const gapCodes = new Map();
const rows = [];
let notes = 0, noRelations = 0, classNotes = 0;

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i].trim();
  if (!raw) continue;
  const ln = i + 1;
  let n;
  try { n = JSON.parse(raw); } catch (e) { rej.badLine.push(`${ln}: ${e.message}`); continue; }
  notes++;

  const rawSrc = norm(n.source_group);
  const cls = classLevel(rawSrc);
  const src = cls ?? rawSrc;
  if (!cls && !wellFormed(src)) { rej.malformedGroup.push(`${ln}: source ${JSON.stringify(n.source_group)}`); continue; }
  let gap = 0;
  if (!cls && !inGoods(src)) { gap = 1; gapCodes.set(src, (gapCodes.get(src) ?? 0) + 1); }

  const page = Number(norm(String(n.printed_page ?? "")));
  const pageOk = Number.isInteger(page) && page >= 1 && page <= PAGES;
  if (!pageOk) rej.badPage.push(`${ln}: page ${JSON.stringify(n.printed_page)}`);   // recorded, row still imported

  const push = (to, type, r, flag) => rows.push(["CN", src, to, type, r?.scope_zh ?? null,
    r?.edition_qualifier ?? null, pageOk ? page : null, n.note_number ?? null, n.note_text_zh ?? null,
    flag, gap]);

  const rels = Array.isArray(n.relations) ? n.relations : [];
  if (!rels.length) { noRelations++; push(null, "similar", null, 1); continue; }
  if (cls) classNotes++;

  for (const r of rels) {
    const rawType = norm(r.type);
    if (!(rawType in TYPE_MAP)) { rej.unknownType.push(`${ln}: ${JSON.stringify(r.type)}`); continue; }
    const type = TYPE_MAP[rawType];
    if (type === null) { push(null, "similar", r, 1); continue; }   // note kept, no relation asserted

    // to_group may be a single code or a list (跨类似群保护商品 names several groups at once).
    const targets = r.to_group == null ? [null] : (Array.isArray(r.to_group) ? r.to_group : [r.to_group]);
    for (const t of targets) {
      const to = t == null ? null : norm(String(t));
      if (to === null) {
        // A note can state a real similarity with no group code — "本类似群商品根据功能用途与5类含药物的
        // 相应商品类似" is cosmetics against medicated cosmetics, and it binds. It cannot be expressed as
        // group→group, so it keeps its text and is flagged rather than discarded.
        const assertable = type === "intra_group_exception" || type === "cross_group_protected";
        push(null, type, r, assertable ? 0 : 1); continue;
      }
      if (!wellFormed(to)) { rej.malformedGroup.push(`${ln}: to ${JSON.stringify(t)}`); continue; }
      const g = inGoods(to) ? gap : 1;
      if (!inGoods(to)) gapCodes.set(to, (gapCodes.get(to) ?? 0) + 1);
      rows.push(["CN", src, to, type, r.scope_zh ?? null, r.edition_qualifier ?? null,
                 pageOk ? page : null, n.note_number ?? null, n.note_text_zh ?? null, 0, g]);
    }
  }
}

const rejected = Object.values(rej).reduce((a, b) => a + b.length, 0);
console.log(`\nnotes read ${notes} | rows valid ${rows.length} | no assertable relation ${noRelations}`);
console.log(`flagged needs_review ${rows.filter(r => r[9] === 1).length} | edition_gap ${rows.filter(r => r[10] === 1).length}`);
console.log(`class-level notes (2-char source_group) ${classNotes} | rejected ${rejected}`);
for (const [k, v] of Object.entries(rej)) if (v.length) console.log(`  ${k}: ${v.length}`, v.slice(0, 6));
console.log("by type:", rows.reduce((m, r) => (m[r[3]] = (m[r[3]] ?? 0) + 1, m), {}));
console.log(`carrying an edition qualifier: ${rows.filter(r => r[5]).length}`);
console.log(`cross-class relations: ${rows.filter(r => r[2] && r[2].slice(0, 2) !== r[1].slice(0, 2)).length}`);
if (gapCodes.size) console.log(`groups cited by the 12th-ed notes and absent from the 13th-ed goods table (${gapCodes.size}):`,
  [...gapCodes.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(" "));

if (DRY) { console.log("\n--dry-run: nothing written"); process.exit(0); }

// A write REPLACES every CN row, so loading one partial file without --replace would silently discard
// the tranches already loaded. Requiring the flag means forgetting it costs a refusal, not the data.
if (!process.argv.includes("--replace")) {
  const held = db.prepare("SELECT COUNT(*) n FROM cross_reference WHERE office='CN'").get().n;
  console.error(`\nREFUSING: a write replaces all ${held} CN rows with the ${rows.length} in this file.`);
  console.error(`Pass --replace if this file is the complete China set, or --dry-run to validate only.`);
  process.exit(2);
}
db.exec("DELETE FROM cross_reference WHERE office='CN'");
const ins = db.prepare(`INSERT INTO cross_reference
  (office,source_group,to_group,type,scope_zh,edition_qualifier,printed_page,note_number,note_text_zh,needs_review,edition_gap)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
db.exec("BEGIN");
for (const r of rows) ins.run(...r);
db.exec("COMMIT");
for (const t of db.prepare("SELECT office, COUNT(*) n, COUNT(DISTINCT source_group) g FROM cross_reference GROUP BY office").all())
  console.log(`  ${t.office}: ${t.n} relations / ${t.g} groups`);
