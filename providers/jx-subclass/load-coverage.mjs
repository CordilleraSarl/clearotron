// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// load-coverage.mjs — state, per office/layer/class, what has actually been read.
//
// Idempotent: every run rebuilds the whole table from the manifests below, so it can be re-run after
// any tranche lands. --dry-run prints without writing.
//
// WHY THE JUSTIFICATIONS ARE INLINE: a row saying "extracted" is a claim that a zero-row answer under
// it is a real clean negative. Whoever writes that claim has to say what makes it true, or the next
// reader cannot tell a measured completeness from an assumed one.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { COVERAGE_DDL, assertCoverageComplete, gaps } from "./coverage.mjs";

const DRY = process.argv.includes("--dry-run");
const DB = "similar-groups.db";
const ALL = Array.from({ length: 45 }, (_, i) => i + 1);

const rows = [];
const push = (r) => rows.push([r.office, r.layer, r.niceClass, r.status, r.readPages ?? null,
  r.groupsNoNotes ?? null, r.sourceDocument ?? null, r.edition ?? null, r.note ?? null]);

// ── group_code: goods → office group code ──────────────────────────────────────────────────────────
// COMPLETE BY CONSTRUCTION, and verified: all four offices return 45/45 classes. The TIPO concordances
// enumerate every Nice basic number in the edition, so a good with no code carries the office's own "―"
// placeholder rather than being absent. Nothing here is transcribed from a scan.
const CONCORDANCE = {
  CN: "兩岸尼斯分類商品及服務類似組群碼對應表(第13-2026版)",
  JP: "臺日尼斯分類商品及服務類似組群碼對應表第13-2026版",
  KR: "臺韓尼斯分類商品及服務類似組群碼對應表第13-2026版",
  TW: "商品及服務近似組群參考資料 — 45 per-class reference files",
};
for (const [office, doc] of Object.entries(CONCORDANCE))
  for (const c of ALL) push({ office, layer: "group_code", niceClass: c, status: "extracted",
    sourceDocument: doc, edition: "NCL 13-2026",
    note: "Concordance enumerates every Nice basic number in the edition; verified 45/45 classes present." });

// ── cross_reference: group → group ─────────────────────────────────────────────────────────────────
// CN is the transcription in progress and is stated per class by its own manifest.
const cn = JSON.parse(readFileSync("cn/coverage.json", "utf8"));
for (const c of ALL) {
  const e = cn.classes[String(c)];
  if (!e) throw new Error(`cn/coverage.json states no class ${c} — a coverage manifest may not skip one`);
  push({ office: "CN", layer: "cross_reference", niceClass: c, status: e.status,
    readPages: e.read_pages ?? null,
    groupsNoNotes: e.groups_no_notes?.join(",") ?? null,
    sourceDocument: cn.source_document, edition: cn.edition, note: e.note ?? null });
}

// KR: one document covering every class, transcribed whole. TW: 45 per-class reference files, one per
// class, all 45 retrieved and hashed (tw/class-pdfs.sha256) — so a class with no rows was read and is
// empty. TW classes 13 and 23 hold zero rows for exactly that reason.
for (const c of ALL) push({ office: "KR", layer: "cross_reference", niceClass: c, status: "extracted",
  sourceDocument: "유사상품 심사기준 (니스 제13판 기준)", edition: "Nice 13th ed.",
  note: "Single office document covering all classes, extracted whole." });
for (const c of ALL) push({ office: "TW", layer: "cross_reference", niceClass: c, status: "extracted",
  sourceDocument: "商品及服務近似組群參考資料 — 45 per-class reference files, 備註 column",
  edition: "NCL 13-2026",
  note: "One source file per class; all 45 retrieved and hashed. Classes 13 and 23 hold zero rows because their 備註 columns are empty, not because they were skipped." });

// JP publishes similarity as a CLASS SPAN per group, not as group→group notes. Zero cross_reference
// rows for JP is the correct final answer, not a gap — so it is stated rather than left to refuse.
for (const c of ALL) push({ office: "JP", layer: "cross_reference", niceClass: c, status: "not_applicable",
  sourceDocument: "類似商品・役務審査基準〔国際分類第13-2026版対応〕", edition: "Nice 13th ed., 2026",
  note: "JPO expresses cross-class reach as a class span per group; see the class_span layer." });

// ── class_span: which classes a group reaches ──────────────────────────────────────────────────────
// JP only. Both bases are loaded (exam_standard and derived_from_goods) and NEITHER is a superset —
// the notes carry 24 group-class pairs the goods data lacks, and the goods data carries classes in 84
// groups the notes do not enumerate. A consumer must union them; coverage does not excuse that.
for (const c of ALL) push({ office: "JP", layer: "class_span", niceClass: c, status: "extracted",
  sourceDocument: "類似商品・役務審査基準〔国際分類第13-2026版対応〕", edition: "Nice 13th ed., 2026",
  note: "exam_standard and derived_from_goods both loaded; a class-span query must UNION them — neither is a superset." });
for (const office of ["CN", "KR", "TW"])
  for (const c of ALL) push({ office, layer: "class_span", niceClass: c, status: "not_applicable",
    note: "Office does not publish a per-group class span; similarity is stated as group→group cross-references." });

const db = new DatabaseSync(DB);
db.exec(COVERAGE_DDL);
if (DRY) {
  // Report from the ROWS BUILT, never from the table — the table is untouched in a dry run, so a gaps()
  // query here would print a confident 0 having measured nothing.
  const byKey = {};
  for (const r of rows) byKey[`${r[0]} ${r[1]} ${r[3]}`] = (byKey[`${r[0]} ${r[1]} ${r[3]}`] ?? 0) + 1;
  for (const k of Object.keys(byKey).sort()) console.log(`  ${k.padEnd(36)} ${byKey[k]}`);
  const willRefuse = rows.filter((r) => r[3] !== "extracted" && r[3] !== "not_applicable");
  console.log(`\n--dry-run: ${rows.length} coverage rows built, nothing written`);
  console.log(`classes that WILL REFUSE once written: ${willRefuse.length}`);
  console.log("  " + willRefuse.map((r) => `${r[0]}/${r[1]} ${r[2]} (${r[3]})`).join(", "));
  process.exit(0);
} else {
  db.exec("DELETE FROM coverage");
  const ins = db.prepare(`INSERT INTO coverage
    (office,layer,nice_class,status,read_pages,groups_no_notes,source_document,edition,note)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  db.exec("BEGIN"); for (const r of rows) ins.run(...r); db.exec("COMMIT");
  assertCoverageComplete(db);
  console.log(`coverage rows written: ${rows.length}`);
}

for (const r of db.prepare(`SELECT office, layer, status, COUNT(*) n FROM coverage
                            GROUP BY office, layer, status ORDER BY office, layer, status`).all())
  console.log(`  ${r.office} ${r.layer.padEnd(16)} ${r.status.padEnd(15)} ${r.n}`);
const g = gaps(db);
console.log(`\nclasses that will REFUSE: ${g.length}`);
if (g.length) console.log("  " + g.map((r) => `${r.office}/${r.layer} ${r.nice_class} (${r.status})`).join(", "));
