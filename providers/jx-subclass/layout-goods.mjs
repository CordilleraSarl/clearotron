// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// layout-goods.mjs — the GOODS lines of the 区分表, which the 注 blocks sit under.
//
// Two kinds of good, and the second is why this file exists (编者说明 clauses 五 and 七):
//
//   国际分类 goods   name + a six-digit Nice basic number — joinable onto the goods table we already
//                    hold from TIPO, and carrying the office's own SIMPLIFIED name for it.
//   ※ C-goods       我国常用但未列入《国际分类》的商品 — China-only, numbered C######, present in NO
//                    TIPO source by construction. Today they resolve to nothing at all.
//
// Each good also carries the GROUP it is printed under. That is CNIPA's own assignment, not a mapping
// derived from someone else's concordance.
import { pageLines } from "./layout-notes.mjs";

const CLASS_TITLE = /^第[一二三四五六七八九十]+类$/;
const GROUP_HEAD  = /^(\d{4})[ 　]*([^\d].*)$/;
const NOTE_START  = /^注\s*[：:]/;
const ITEM        = /^(.*?)[*＊]?\s*([CＣ]?\d{6})$/;
const PART_MARK   = /^（[一二三四五六七八九十]+）/;

// A goods run can wrap across lines and pages, so lines are accumulated and split on the separator the
// office uses between entries. 、 is NOT a separator — it appears inside names (非绝缘、非隔热用玻璃棉).
export function extractGoods(layout, opts = {}) {
  const out = [];
  let group = null, printed = null, china = false;
  const flush = (buf) => {
    if (!buf.trim() || !group) return;
    for (const raw of buf.split(/[，,]/)) {
      const t = raw.replace(/\s+/g, " ").trim().replace(/^[※＊*]\s*/, "");
      const m = ITEM.exec(t);
      if (!m) continue;
      // A part marker opens a run —（一）氨 is the marker plus the first good, not a good called "（一）氨".
      const name = m[1].replace(/[*＊]/g, "").replace(/^（[一二三四五六七八九十]+）\s*/, "").trim();
      const no = m[2].normalize("NFKC");
      if (!name || name.length > 60) continue;                 // a run-on capture, not a goods name
      out.push({ no, nice_class: +group.slice(0, 2), group_code: group, name_zh_cn: name,
                 printed_page: printed, china_only: /^C/i.test(no) ? 1 : 0 });
    }
  };
  let buf = "";
  for (const ln of pageLines(layout, opts)) {
    const s = ln.text.replace(/\s+/g, " ").trim();
    const bare = s.replace(/\s+/g, "");
    if (CLASS_TITLE.test(bare)) { flush(buf); buf = ""; group = null; continue; }
    if (NOTE_START.test(bare)) { flush(buf); buf = ""; group = null; continue; }   // notes end the goods run
    const gm = GROUP_HEAD.exec(bare);
    if (gm && +gm[1].slice(0, 2) >= 1 && +gm[1].slice(0, 2) <= 45) {
      flush(buf); buf = ""; group = gm[1]; printed = ln.printed; china = false; continue;
    }
    if (!group) continue;
    if (!/\d{6}/.test(bare) && !buf) continue;                  // prose between blocks carries no numbers
    printed = ln.printed;
    buf += (PART_MARK.test(bare) || /^[※＊]/.test(s) ? "，" : "") + s;
  }
  flush(buf);
  return out;
}
