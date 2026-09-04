// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Re-measure the 63-item CNIPA answer key against the table, through the term resolver.
// Reports every miss. A headline score with unlisted misses is not a measurement.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolveGood, resolveCnGood } from "./terms.mjs";

const KEY = process.argv[2] ?? "/mnt/datadisk1/tmp/haiku-subclass-probe/subclass-truth.json";
const db = new DatabaseSync("similar-groups.db", { readOnly: true });
const items = JSON.parse(readFileSync(KEY, "utf8"));
const codes = db.prepare("SELECT DISTINCT code FROM group_code WHERE basic_no = ? AND office = 'CN'");

const out = { exact: [], superset: [], partial: [], wrong: [], nocode: [], unresolved: [] };
const byHow = {};
for (const it of items) {
  // CNIPA's own list first: it is the only source carrying the ※C-goods, and it names shared basic
  // numbers in the words a Chinese query is actually written in.
  const cn = resolveCnGood(db, { term: it.goods_zh, niceClass: it.nice_class });
  if (cn.rows.length && cn.how !== "zh-fragment") {
    const got = new Set(cn.rows.map((x) => x.group_code));
    const want = new Set(it.subclass_codes);
    const hit = [...want].filter((c) => got.has(c));
    const rec = { it, got: [...got], how: `cn-${cn.how}`, matched: { name_zh_tw: cn.rows[0].name_zh_cn, basic_no: cn.rows[0].no } };
    byHow[`cn-${cn.how}`] = (byHow[`cn-${cn.how}`] ?? 0) + 1;
    if (hit.length === want.size && got.size === want.size) out.exact.push(rec);
    else if (hit.length === want.size) out.superset.push(rec);
    else if (hit.length) out.partial.push(rec);
    else out.wrong.push(rec);
    continue;
  }
  const r = resolveGood(db, { term: it.goods_zh, niceClass: it.nice_class });
  const r2 = r.rows.length ? r : resolveGood(db, { term: it.goods_en, niceClass: it.nice_class });
  byHow[r2.how] = (byHow[r2.how] ?? 0) + 1;
  // A fragment match is NOT an answer — it is a suggestion for a human. Scoring it as a hit would
  // credit the table for a code it cannot stand behind.
  if (!r2.rows.length || r2.how === "zh-fragment") {
    out.unresolved.push({ ...it, _fragment: r2.how === "zh-fragment" ? r2.rows[0]?.name_zh_tw : null });
    continue;
  }
  const got = new Set();
  for (const row of r2.rows) for (const c of codes.all(row.basic_no)) got.add(c.code);
  const want = new Set(it.subclass_codes);
  const hit = [...want].filter((c) => got.has(c));
  const rec = { it, got: [...got], how: r2.how, matched: r2.rows[0] };
  if (hit.length === want.size && got.size === want.size) out.exact.push(rec);
  else if (hit.length === want.size) out.superset.push(rec);
  else if (hit.length) out.partial.push(rec);
  // Empty is not wrong. The good resolved and the office assigns it no code — that is a named outcome
  // the lookup reports as no-code-for-good, not a false answer. Counting it as "wrong" would hide the
  // only claim that matters here: the table never returns a code that is not the office's.
  else if (!got.size) out.nocode.push(rec);
  else out.wrong.push(rec);
}
const n = items.length;
const right = out.exact.length + out.superset.length;
console.log(`\n63-item key, resolved through the term fold\n${"─".repeat(58)}`);
console.log(`  every expected code present   ${String(right).padStart(2)}/${n}  (${Math.round(right / n * 100)}%)`);
console.log(`    of which exact set match    ${String(out.exact.length).padStart(2)}`);
console.log(`    of which superset           ${String(out.superset.length).padStart(2)}  (matched more goods than the key names)`);
console.log(`  partial                       ${String(out.partial.length).padStart(2)}`);
console.log(`  WRONG CODE returned           ${String(out.wrong.length).padStart(2)}  ← the number that must be zero`);
console.log(`  good resolved, office lists no code  ${String(out.nocode.length).padStart(2)}`);
console.log(`  term did not resolve          ${String(out.unresolved.length).padStart(2)}`);
console.log(`\n  matched by: ${Object.entries(byHow).map(([k, v]) => `${k}=${v}`).join("  ")}`);
const tricky = items.filter((i) => i.tricky);
const trickyRight = [...out.exact, ...out.superset].filter((r) => r.it.tricky).length;
console.log(`  tricky items: ${trickyRight}/${tricky.length} (${Math.round(trickyRight / tricky.length * 100)}%)  — production haiku scores 24%`);

for (const [label, list] of [["PARTIAL", out.partial], ["WRONG CODE", out.wrong], ["NO CODE FOR GOOD", out.nocode]])
  if (list.length) { console.log(`\n${label}:`); for (const r of list)
    console.log(`  cls ${r.it.nice_class} ${r.it.goods_zh} — want [${r.it.subclass_codes}] got [${r.got}] via ${r.how} (${r.matched.name_zh_tw})`); }
if (out.unresolved.length) { console.log(`\nUNRESOLVED — no goods row reachable:`);
  for (const it of out.unresolved) console.log(`  cls ${it.nice_class} ${it.goods_zh} / ${it.goods_en} — want [${it.subclass_codes}]`
    + (it._fragment ? `   [fragment seen: ${it._fragment} — suggested, not answered]` : "")); }
