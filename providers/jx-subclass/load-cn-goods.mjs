// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// load-cn-goods.mjs — CNIPA's own goods list, beside TIPO's rather than over it.
//
// A separate table, not extra columns on `goods`. The two offices name the same basic number
// differently (010093 is 一氧化二氮 to CNIPA and 氧化亞氮（笑氣）to TIPO) and only 26% fold to the same
// string. Overwriting would destroy the Taiwanese name a TW lookup cites; merging would invent a good
// neither office lists. They are two records of the same thing and both are cited.
//
// The ※C-goods have no basic number at all, so they can only live here.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { foldZh } from "./terms.mjs";
import { isEntrypoint } from "../../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

export const CN_GOODS_DDL = `
CREATE TABLE IF NOT EXISTS cn_goods (
  no           TEXT NOT NULL,           -- Nice basic number, or C###### for a China-only good
  nice_class   INTEGER NOT NULL CHECK (nice_class BETWEEN 1 AND 45),
  group_code   TEXT NOT NULL,
  name_zh_cn   TEXT NOT NULL,
  fold         TEXT NOT NULL,
  printed_page INTEGER,
  china_only   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (no, group_code, name_zh_cn)
);
CREATE INDEX IF NOT EXISTS idx_cn_goods_fold ON cn_goods(fold);
CREATE INDEX IF NOT EXISTS idx_cn_goods_group ON cn_goods(group_code);`;

const FILE = process.argv.find(a => a.endsWith(".jsonl")) ?? "cn/goods/cn-goods.jsonl";
if (isEntrypoint(import.meta.url)) {
  if (!existsSync(FILE)) { console.error(`ABSENT: ${FILE} — nothing to load (an absence is a finding, not a pass)`); process.exit(1); }
  const db = new DatabaseSync("similar-groups.db");
  db.exec(CN_GOODS_DDL);
  db.exec("DELETE FROM cn_goods");
  const ins = db.prepare("INSERT OR IGNORE INTO cn_goods (no,nice_class,group_code,name_zh_cn,fold,printed_page,china_only) VALUES (?,?,?,?,?,?,?)");
  const rows = readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  db.exec("BEGIN");
  let n = 0, nofold = 0;
  for (const r of rows) { const f = foldZh(r.name_zh_cn); if (!f) { nofold++; continue; } ins.run(r.no, r.nice_class, r.group_code, r.name_zh_cn, f, r.printed_page ?? null, r.china_only ?? 0); n++; }
  db.exec("COMMIT");
  const got = db.prepare("SELECT COUNT(*) n, SUM(china_only) c FROM cn_goods").get();
  console.log(`cn_goods rows ${got.n} | China-only ${got.c} | names with nothing to fold ${nofold}`);
  const cover = db.prepare("SELECT COUNT(DISTINCT nice_class) n FROM cn_goods").get().n;
  console.log(`classes represented ${cover}/45${cover < 45 ? "  ← a gap, not a pass" : ""}`);
}
