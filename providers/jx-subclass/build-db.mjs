// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Build the similar-group reference database. node:sqlite + FTS5, zero dependencies —
// the same pattern as providers/uspto-local/src/index-store.js.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { isEntrypoint } from "../../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

// BUILD ORDER — this script only lays the goods and codes. A database is not shippable until the rest
// have run, and the one that matters is coverage: without it every lookup refuses (fails safe, but
// answers nothing), and a database carrying data with no coverage rows would be the false clear the
// coverage table exists to stop.
//
//   node build-db.mjs          goods, group codes, FTS, provenance
//   node load-cn.mjs --replace CN cross-references
//   node load-kr.mjs / load-xref.mjs / load-jp-spans.mjs
//   node load-fold.mjs         the match index (goods_fold)
//   node load-coverage.mjs     WHAT HAS BEEN READ — stated, never derived from the rows that landed
//   node load-provenance.mjs   sources; refuses a row with no hash or edition
//   node score-truth.mjs       the 63-item key, every miss itemised
const OUT = "similar-groups.db";

// Exported so `load-public.mjs` can lay the schema WITHOUT this file's ingest, which reads office
// documents that are deliberately not in the repo. Shipping the two welded together meant the
// documented "build from public/ with no office document" path threw ENOENT on a clean checkout —
// a path nobody had run.
export const SCHEMA_DDL = `
  PRAGMA journal_mode = OFF;
  CREATE TABLE IF NOT EXISTS goods (
    basic_no   TEXT PRIMARY KEY,      -- Nice basic number: the universal join key
    nice_class INTEGER NOT NULL,
    name_en    TEXT,
    name_zh_tw TEXT
  );
  CREATE TABLE IF NOT EXISTS group_code (
    basic_no TEXT NOT NULL REFERENCES goods(basic_no),
    office   TEXT NOT NULL CHECK (office IN ('CN','JP','KR','TW')),
    code     TEXT NOT NULL,
    PRIMARY KEY (basic_no, office, code)
  );
  CREATE INDEX IF NOT EXISTS idx_group_code_lookup ON group_code(office, code);
  -- Cross-references between groups. Empty until the CNIPA notes land.
  CREATE TABLE IF NOT EXISTS cross_reference (
    id                INTEGER PRIMARY KEY,
    office            TEXT NOT NULL CHECK (office IN ('CN','JP','KR','TW')),
    source_group      TEXT NOT NULL,
    to_group          TEXT,
    -- 'cross_group_protected' = 跨类似群保护商品: a named good protected across several listed groups.
    -- It is NOT a similarity assertion, and folding it into 'similar' overstates the link.
    type              TEXT NOT NULL CHECK (type IN ('similar','cross_search','intra_group_exception','cross_group_protected')),
    scope_zh          TEXT,
    edition_qualifier TEXT,
    printed_page      INTEGER,
    note_number       INTEGER,
    note_text_zh      TEXT,
    needs_review      INTEGER NOT NULL DEFAULT 0,
    -- Set when a cited group is well-formed but absent from the goods table's edition. China's notes are
    -- the 12th edition (2023 text); the goods and codes are NCL 13-2026. A group retired between the two
    -- is real data with no goods on the other side — dropping it would lose a relation the office states.
    edition_gap       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_xref_source ON cross_reference(office, source_group);
  CREATE VIRTUAL TABLE IF NOT EXISTS goods_fts USING fts5(basic_no UNINDEXED, name_en, name_zh_tw, name_ja, name_ko);
  -- Every shipped row must be traceable to an office document a lawyer can open. A report cites this
  -- table, so a missing office here is a claim with no source behind it.
  -- JP expresses cross-class reach as a class SPAN per group rather than group-to-group notes. It is
  -- created here rather than by its loader so a build from public/ has somewhere to put it.
  CREATE TABLE IF NOT EXISTS class_span (
    office TEXT NOT NULL, group_code TEXT NOT NULL, nice_class INTEGER NOT NULL,
    basis TEXT NOT NULL CHECK (basis IN ('exam_standard','intl_table','derived_from_goods')),
    PRIMARY KEY (office, group_code, nice_class, basis));
  CREATE TABLE IF NOT EXISTS provenance (office TEXT, source TEXT, document TEXT, file TEXT, edition TEXT, effective TEXT,
    url TEXT, retrieved TEXT, sha256 TEXT, bytes INTEGER, contributes TEXT);
`;

// Everything below re-derives the tables from the office documents. It runs only when this file is the
// entry point: importing it must never delete a database.
if (!isEntrypoint(import.meta.url)) { /* imported for SCHEMA_DDL only */ }
else {
// Check the sources BEFORE destroying anything. This script deletes the database and rebuilds it, so
// discovering a missing office file afterwards leaves the operator with no database at all — worse off
// than before they ran it. On a checkout without the office documents the answer is load-public.mjs.
for (const [f, why] of [["merged/similar-groups-merged.json", "the merged goods and group codes"],
                        ["tw/tw-jp.json", "Japanese goods names"], ["tw/tw-kr.json", "Korean goods names"],
                        ["provenance.json", "the source register"]])
  if (!existsSync(f)) {
    console.error(`ABSENT: ${f}\n  needed for: ${why}`);
    console.error(`  This script re-derives the tables from OFFICE DOCUMENTS, which this repo does not carry.`);
    console.error(`  To build from what ships here instead:  node load-public.mjs`);
    process.exit(1);
  }
if (existsSync(OUT)) rmSync(OUT);
const db = new DatabaseSync(OUT);
db.exec(SCHEMA_DDL);

const merged = JSON.parse(readFileSync("merged/similar-groups-merged.json", "utf8"));
const jaName = new Map(), koName = new Map();
for (const r of JSON.parse(readFileSync("tw/tw-jp.json", "utf8"))) if (r.other_name) jaName.set(r.basic_no, r.other_name);
for (const r of JSON.parse(readFileSync("tw/tw-kr.json", "utf8"))) if (r.other_name) koName.set(r.basic_no, r.other_name);

const insG = db.prepare("INSERT INTO goods VALUES (?,?,?,?)");
const insC = db.prepare("INSERT OR IGNORE INTO group_code VALUES (?,?,?)");
const insF = db.prepare("INSERT INTO goods_fts VALUES (?,?,?,?,?)");
let codes = 0, rejected = 0;
db.exec("BEGIN");
for (const r of merged) {
  insG.run(r.basic_no, Number(r.nice_class), r.en || null, r.zh_tw_name || null);
  insF.run(r.basic_no, r.en || "", r.zh_tw_name || "", jaName.get(r.basic_no) || "", koName.get(r.basic_no) || "");
  for (const [office, arr] of [["CN", r.cn], ["JP", r.jp], ["KR", r.kr], ["TW", r.tw]])
    for (const c of arr) {
      if (!c || c === "―" || c === "—") { rejected++; continue; }   // the "no code" placeholder
      insC.run(r.basic_no, office, c); codes++;
    }
}
db.exec("COMMIT");
const prov = JSON.parse(readFileSync("provenance.json", "utf8"));
const insProv = db.prepare(`INSERT INTO provenance
  (office,source,document,file,edition,effective,url,retrieved,sha256,bytes,contributes)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
for (const p of prov) insProv.run(p.office, p.source, p.document, p.file ?? null, p.edition,
  p.effective ?? null, p.url, p.retrieved, p.sha256, p.bytes ?? null, p.contributes);
console.log(`provenance rows ${prov.length}`);
console.log(`goods ${merged.length} | group codes ${codes} | placeholders skipped ${rejected}`);
}
