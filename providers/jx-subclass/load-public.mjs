// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// load-public.mjs — build the database from public/ alone, with no office document on disk.
//
// This is the path an operator without the source PDFs takes, and the path CI takes. It is a separate
// script rather than a flag on the office-source loaders: a flag that swaps the input underneath a
// loader hides which one ran, and the two answer different questions — "rebuild what we shipped" and
// "re-derive it from the office".
//
// It refuses on a hash mismatch. A shipped table whose bytes drifted from its manifest is not a
// smaller table, it is an unknown one.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { GOODS_FOLD_DDL, foldZh } from "./terms.mjs";
import { COVERAGE_DDL } from "./coverage.mjs";
import { CN_GOODS_DDL } from "./load-cn-goods.mjs";
import { SCHEMA_DDL } from "./build-db.mjs";

const DIR = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : "public";
// `--out` so a caller that must not write into the checkout can still take THIS path — the driver's
// tests build into a temp directory and assert against the shipped tables rather than against a fixture
// somebody typed. Without it they had to SKIP wherever the database was absent, which is every CI run,
// and a permanently-skipped arm is a test that stopped guarding ( caught exactly that).
const DB = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "similar-groups.db";
if (!existsSync(`${DIR}/MANIFEST.json`)) {
  console.error(`ABSENT: ${DIR}/MANIFEST.json — nothing to load. An absence is a finding, not an empty table.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(`${DIR}/MANIFEST.json`, "utf8"));
const read = (name) => {
  const body = readFileSync(`${DIR}/${name}`, "utf8");
  const want = manifest.files.find(f => f.file === name);
  const got = createHash("sha256").update(body).digest("hex");
  if (!want) throw new Error(`${name} is not in the manifest`);
  if (want.sha256 !== got) throw new Error(`${name}: sha256 ${got.slice(0, 12)} does not match the manifest's ${want.sha256.slice(0, 12)}`);
  return body.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
};

const db = new DatabaseSync(DB);
// Lay the schema here too: this path must work on a checkout with no office document on it, and
// requiring build-db.mjs first made that false.
db.exec(SCHEMA_DDL);
db.exec(GOODS_FOLD_DDL);
db.exec(COVERAGE_DDL);
db.exec(CN_GOODS_DDL);
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).filter(c => c !== "id");
// group_code references goods, so the wipe runs children-first and the fill parents-first. Clearing
// goods while group_code still points at it fails the foreign key, which is the constraint doing its job.
for (const t of ["group_code", "cross_reference", "class_span", "coverage", "provenance", "cn_goods", "goods_fts", "goods_fold", "goods"]) db.exec(`DELETE FROM ${t}`);

const fill = (table, rows) => {
  const c = cols(table);
  const ins = db.prepare(`INSERT INTO ${table} (${c.join(",")}) VALUES (${c.map(() => "?").join(",")})`);
  db.exec("BEGIN");
  for (const r of rows) ins.run(...c.map(k => r[k] ?? null));
  db.exec("COMMIT");
  return rows.length;
};

const counts = {};
counts.goods = fill("goods", read("goods.jsonl"));
counts.group_code = fill("group_code", read("group-code.jsonl"));
counts.cross_reference = fill("cross_reference", read("cross-reference.jsonl"));
counts.class_span = fill("class_span", read("class-span.jsonl"));
// fold is derived, not shipped: a stored fold that drifts from the folder is worse than no index.
const cng = read("cn-goods.jsonl").map(r => ({ ...r, fold: foldZh(r.name_zh_cn) }));
counts.cn_goods = fill("cn_goods", cng);
counts.coverage = fill("coverage", read("coverage.jsonl"));
counts.provenance = fill("provenance", read("provenance.jsonl"));

// The two derived indexes. Both are rebuilt, never assumed: an index carried over from an older load
// answers for goods that are no longer there.
const insF = db.prepare("INSERT INTO goods_fts VALUES (?,?,?,?,?)");
const insD = db.prepare("INSERT OR IGNORE INTO goods_fold VALUES (?,?)");
db.exec("BEGIN");
let folded = 0;
for (const g of db.prepare("SELECT basic_no, name_en, name_zh_tw FROM goods").all()) {
  insF.run(g.basic_no, g.name_en, g.name_zh_tw, null, null);
  const f = foldZh(g.name_zh_tw);
  if (f) { insD.run(g.basic_no, f); folded++; }
}
db.exec("COMMIT");
counts.goods_fts = counts.goods; counts.goods_fold = folded;

for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(16)} ${n}`);
console.log(`\nbuilt from ${DIR}/ — no office document read. Quotation column dropped at export: ${manifest.dropped_column}.`);
