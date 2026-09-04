// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// parse-goods.mjs — write the 区分表's goods lines as JSONL.
//
//   node parse-goods.mjs --layout <a.json> --layout <b.json> --out cn/goods/cn-goods.jsonl
//
// Deduplicated on (number, group, name): the same good is printed under several groups deliberately,
// and each printing is a real assignment, so only exact repeats are folded.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadLayout } from "./layout-notes.mjs";
import { extractGoods } from "./layout-goods.mjs";

const argsOf = (f) => process.argv.reduce((a, v, i) => (process.argv[i - 1] === f ? [...a, v] : a), []);
const one = (f, d) => { const i = process.argv.indexOf(f); return i < 0 ? d : process.argv[i + 1]; };
const LAYOUTS = argsOf("--layout");
const OUT = one("--out", null), FROM = Number(one("--from", 4)), TO = Number(one("--to", 252));
if (!LAYOUTS.length) { console.error("ABSENT: no --layout given — nothing to read"); process.exit(1); }

const seen = new Map();
for (const f of LAYOUTS)
  for (const g of extractGoods(loadLayout(f)))
    if (g.printed_page >= FROM && g.printed_page <= TO) {
      const k = `${g.no}|${g.group_code}|${g.name_zh_cn}`;
      if (!seen.has(k)) seen.set(k, g);
    }
const rows = [...seen.values()].sort((a, b) => a.group_code.localeCompare(b.group_code) || a.no.localeCompare(b.no));

const cn = rows.filter(r => r.china_only), nice = rows.filter(r => !r.china_only);
const mism = nice.filter(r => +r.no.slice(0, 2) !== r.nice_class);
console.log(`goods ${rows.length} | Nice-numbered ${nice.length} | China-only ※C ${cn.length}`);
console.log(`distinct numbers ${new Set(rows.map(r => r.no)).size} | groups ${new Set(rows.map(r => r.group_code)).size} | classes ${new Set(rows.map(r => r.nice_class)).size}`);
console.log(`basic numbers whose class contradicts the group they print under: ${mism.length}`);
if (mism.length) for (const m of mism.slice(0, 5)) console.log(`  ${m.no} under ${m.group_code}: ${m.name_zh_cn}`);
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join("\n") + "\n"); console.log(`\nwrote ${OUT}`); }
