// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// terms.mjs — resolve a goods term to the rows the group-code tables are keyed on. Zero dependencies.
//
// ── WHY A FOLD AND NOT A CONVERSION ────────────────────────────────────────────────────────────────
//
// The goods names in this database come from TIPO and are TRADITIONAL Chinese throughout: zero rows
// contain 电, 药 or 纱; 621 contain 電, 191 藥, 31 紗. CNIPA writes simplified, and so does every
// Chinese client describing their goods. A simplified query therefore misses on script alone — and a
// miss returns no group codes, which reads as "this good has no similar-group exposure". That is the
// same false clear the coverage table exists to stop, arriving through a different door.
//
// So both sides are folded to ONE form for COMPARISON ONLY. Nothing is converted in place: the stored
// name, the displayed name and the cited name stay the office's verbatim text. The fold is a search
// index, not a claim about what the office wrote.
//
// The fold runs TRADITIONAL → SIMPLIFIED because that direction is many-to-one. 發 and 髮 both fold to
// 发, so a simplified query matches either. Going the other way would have to pick one and would miss
// the other.
//
// ── WHAT THIS CANNOT REACH ─────────────────────────────────────────────────────────────────────────
//
// The 区分表's own 编者说明 (clauses 五 and 七) states that it lists two kinds of goods: those in the
// international classification, carrying their Nice basic number, and 我国常用但未列入《国际分类》的
// 商品 — goods commonly used in China that Nice does not list, marked ※ and numbered with a "C" prefix
// (牛津布 C240001). This database is keyed on the Nice basic number, so the C-goods HAVE NO ROW HERE AT
// ALL and no amount of folding will find them. 月饼 and 婚纱 are of that kind. Reaching them needs the
// 区分表's goods lists, which the 注-block extraction did not capture. Until then a miss on a Chinese
// term is not evidence the good has no similar group.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAGMENT_FLOOR = 0.5;   // matched office name must cover at least half the query
const FOLD = JSON.parse(readFileSync(join(HERE, "zh-fold.json"), "utf8")).map;

/** Canonical comparison form: NFKC (folds full-width Ｔ in Ｔ恤), traditional→simplified, and drop the
 *  spacing and bracketing that the two sources punctuate differently. Never stored, never displayed. */
export function foldZh(s) {
  if (typeof s !== "string") return "";
  let out = "";
  for (const ch of s.normalize("NFKC")) out += FOLD[ch] ?? ch;
  return out.toLowerCase().replace(/[\s　（）()［］\[\]「」『』【】、，,．.。;；:：/／*＊-]/g, "");
}

export const GOODS_FOLD_DDL = `
  CREATE TABLE IF NOT EXISTS goods_fold (
    basic_no TEXT NOT NULL,
    fold     TEXT NOT NULL,
    PRIMARY KEY (basic_no, fold)
  );
  CREATE INDEX IF NOT EXISTS idx_goods_fold ON goods_fold(fold);`;

/**
 * Resolve a term to candidate goods rows, cheapest and most exact first. Returns
 * { how, rows } — `how` names which rule matched so a caller can weigh an exact hit differently from
 * a substring one, and so a report can say why a good was matched at all.
 */
export function resolveGood(db, { term, niceClass = null }) {
  const f = foldZh(term);
  const clause = niceClass ? " AND g.nice_class = ?" : "";
  const args = (x) => (niceClass ? [x, Number(niceClass)] : [x]);
  const sel = "SELECT DISTINCT g.basic_no, g.nice_class, g.name_en, g.name_zh_tw FROM goods g";

  // A term can be longer OR shorter than the office's name for the same good, so containment is tried
  // BOTH ways. "T恤衫" is longer than the listed Ｔ恤; "服装" is shorter than 嬰兒服裝. Searching one
  // direction only silently drops whichever half of that the query happens to be on.
  const segments = [f, ...String(term ?? "").split(/[；;，,、/／]/).map(foldZh)]
    .filter((x, i, a) => x && a.indexOf(x) === i);
  for (const seg of segments) {
    const exact = db.prepare(`${sel} JOIN goods_fold f ON f.basic_no = g.basic_no
                              WHERE f.fold = ?${clause}`).all(...args(seg));
    if (exact.length) return { how: "zh-exact", rows: exact };
  }
  for (const seg of segments) {
    const sub = db.prepare(`${sel} JOIN goods_fold f ON f.basic_no = g.basic_no
                            WHERE f.fold LIKE ?${clause} LIMIT 25`).all(...args(`%${seg}%`));
    if (sub.length) return { how: "zh-substring", rows: sub };
    // The office name sitting INSIDE the query. Length floor of 2 characters: a single shared character
    // matches almost anything and would turn a precise lookup into a guess.
    const inQ = db.prepare(`${sel} JOIN goods_fold f ON f.basic_no = g.basic_no
                            WHERE length(f.fold) >= 2 AND ? LIKE '%' || f.fold || '%'${clause}
                            ORDER BY length(f.fold) DESC LIMIT 25`).all(...args(seg));
    if (inQ.length) {
      // Keep only the longest office name found in the query — the most specific reading of it.
      const best = Math.max(...inQ.map((r) => foldZh(r.name_zh_tw).length));
      const rows = inQ.filter((r) => foldZh(r.name_zh_tw).length === best);
      const covers = best / seg.length;
      // A SHORT name inside a LONG query is a fragment, not the good. 手機 sits inside 可下载的手机应用
      // 软件 and returns the phone's group (0907) for a piece of software (0901) — a confidently wrong
      // code, which in a clearance search is worse than no answer, because nobody goes and checks it.
      // Below the floor the match is returned LABELLED and the caller must not treat it as the answer.
      return { how: covers >= FRAGMENT_FLOOR ? "zh-in-query" : "zh-fragment", rows, covers };
    }
  }
  const t = String(term ?? "").trim().toLowerCase();
  if (t) {
    const en = db.prepare(`${sel} WHERE lower(g.name_en) = ?${clause}`).all(...args(t));
    if (en.length) return { how: "en-exact", rows: en };
    const enSub = db.prepare(`${sel} WHERE lower(g.name_en) LIKE ?${clause} LIMIT 25`).all(...args(`%${t}%`));
    if (enSub.length) return { how: "en-substring", rows: enSub };
  }
  return { how: "none", rows: [] };
}

/** The same ladder over CNIPA's OWN goods list.
 *
 *  Tried before the TIPO concordance for a China lookup, for two reasons that are not preference:
 *  the ※C-numbered goods appear in no other source at all, and where both offices list the same basic
 *  number they name it differently three times in four. A Chinese term is written in CNIPA's words, so
 *  it should be matched against CNIPA's words first.
 *
 *  Returns the group code directly — the office prints each good under its group, so no concordance
 *  step is needed and none is taken. */
export function resolveCnGood(db, { term, niceClass = null }) {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cn_goods'").get();
  if (!has) return { how: "no-cn-goods-table", rows: [] };
  const f = foldZh(term);
  if (!f) return { how: "none", rows: [] };
  const clause = niceClass ? " AND nice_class = ?" : "";
  const args = (x) => (niceClass ? [x, Number(niceClass)] : [x]);
  const sel = "SELECT DISTINCT no, nice_class, group_code, name_zh_cn, printed_page, china_only FROM cn_goods";
  const segments = [f, ...String(term ?? "").split(/[；;，,、/／]/).map(foldZh)].filter((x, i, a) => x && a.indexOf(x) === i);

  for (const seg of segments) {
    const exact = db.prepare(`${sel} WHERE fold = ?${clause}`).all(...args(seg));
    if (exact.length) return { how: "zh-exact", rows: exact };
  }
  for (const seg of segments) {
    const sub = db.prepare(`${sel} WHERE fold LIKE ?${clause} LIMIT 25`).all(...args(`%${seg}%`));
    if (sub.length) return { how: "zh-substring", rows: sub };
    const inQ = db.prepare(`${sel} WHERE length(fold) >= 2 AND ? LIKE '%' || fold || '%'${clause}
                            ORDER BY length(fold) DESC LIMIT 25`).all(...args(seg));
    if (inQ.length) {
      const best = Math.max(...inQ.map((r) => foldZh(r.name_zh_cn).length));
      const rows = inQ.filter((r) => foldZh(r.name_zh_cn).length === best);
      const covers = best / seg.length;
      // Same floor as the TIPO path: a short office name inside a long query is a fragment, and a
      // confidently wrong code is worse in a clearance search than no code at all.
      return { how: covers >= FRAGMENT_FLOOR ? "zh-in-query" : "zh-fragment", rows, covers };
    }
  }
  return { how: "none", rows: [] };
}
