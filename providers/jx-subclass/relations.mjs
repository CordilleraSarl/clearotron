// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// 注-text → relation objects. Deterministic; no model authors this content.
//
// The four types are never interchangeable, so each is recognised by its own terminator and the
// checks run longest-first: 跨类似群保护商品 and 不类似 both CONTAIN 类似, and matching 类似 first
// would silently turn an EXCLUSION into a similarity assertion.
//
// Scored against the 690 vetted tranche-1 notes by verify-relations.mjs — the only reason to trust it
// on pages nobody has read.

const GROUP = /(?<![0-9])(\d{4})(?![0-9])/g;             // a group code, never part of a 6-digit basic no.
const EDITION = /第[一二三四五六七八九十]+版(?:及以前版本)?/g;

// Terminators, longest first. `mark` clauses carry their whole text as scope.
const TERMS = [
  // 商品 for goods, 服务 for the service classes — the same construct, and matching only the goods
  // form left every 35-45 protection clause to be swept up as cross-search assertions instead.
  { re: /跨类似群保护(?:商品|服务)/, type: "cross_group_protected", mark: true },
  // 不判为类似商品 is the same EXCLUSION as 不类似 written long; the 商品 guard below hides it from the
  // similarity terminator, so without this line the clause asserts nothing at all.
  { re: /互不类似|不类似|不判为类似(?:商品)?/, type: "intra_group_exception", mark: true },
  { re: /交叉检索/,          type: "cross_search" },
  // 类似 is a substring of 本类似群 / 跨类似群 and of 确定类似商品 — neither asserts anything. Matching
  // it there split "本类似群各部分之间商品不类似" into a SIMILARITY plus an exclusion, the exact
  // inversion this file exists to prevent.
  { re: /类似(?!群|商品)/,    type: "similar" },
];

const codesIn = (s) => [...s.matchAll(GROUP)].map(m => m[1]).filter(c => +c.slice(0, 2) >= 1 && +c.slice(0, 2) <= 45);

// Split an item into clauses, each ending at the first terminator found scanning left to right.
function clauses(text) {
  const out = [];
  let rest = text;
  while (rest) {
    let best = null;
    for (const t of TERMS) {
      const m = t.re.exec(rest);
      if (m && (!best || m.index < best.index || (m.index === best.index && m[0].length > best.len)))
        best = { index: m.index, len: m[0].length, ...t };
    }
    if (!best) { if (out.length) out[out.length - 1].text += rest; break; }
    // 跨类似群保护商品 OPENS its clause; the group list follows the marker and runs to the next ；or 。
    // Cutting at the marker left that list to be swept up by the following clause, which turned a
    // protection scope into cross-search assertions against groups the office never named that way.
    let end = best.index + best.len;
    if (best.type === "cross_group_protected") {
      const stop = rest.slice(end).search(/[；;。]/);
      end = stop < 0 ? rest.length : end + stop + 1;
    }
    out.push({ text: rest.slice(0, end), type: best.type, mark: !!best.mark });
    rest = rest.slice(end);
  }
  return out;
}

// Top-level （…） spans and the good named before each. Depth-tracked: a list can hold 1204第（一）部分,
// and a non-nesting scan would end the list at that inner bracket and drop the groups after it.
function protectedItems(text) {
  const items = []; let depth = 0, start = -1, cut = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "（" || ch === "(") { if (depth === 0) start = i; depth++; }
    else if (ch === "）" || ch === ")") {
      if (depth > 0) depth--;
      if (depth === 0 && start >= 0) {
        const codes = [...new Set(codesIn(text.slice(start + 1, i)))];
        if (codes.length) {
          const good = text.slice(cut, start).replace(/^[，,；;：:、]+/, "").replace(/^跨类似群保护(?:商品|服务)[：:]?/, "");
          items.push({ good, codes });
          cut = i + 1;
        }
        start = -1;
      }
    }
  }
  return items;
}

// "本类似群第九版时移入0407类似群" — the group was RETIRED into another at that edition. Tranche 1 typed
// this construct two different ways (cross_search at 0117, cross_group_protected at 0917); the second is
// wrong, because cross_group_protected takes a list of protected goods and asserts no similarity.
// A search of the retired group must still reach its successor, so it is a cross_search at that edition.
// 拆分移入4303、4401类似群 — a SPLIT names several successors in one 移入 clause.
const RETIRED = /移入((?:\d{4}[、,，]?)+)类似群/g;
const RETIRED_ED = /第([一二三四五六七八九十]+)版/;
const DELETED = /本类似群第[一二三四五六七八九十]+版(?:（\d{4}文本）)?时?删除/;

export function parseRelations(text, sourceGroup) {
  const t = (text ?? "").replace(/\s+/g, "");
  if (!t) return { relations: [], unparsed: [] };
  const relations = [], unparsed = [];

  // One statement can migrate several goods to several groups ("豆粉移入3008…，食用面筋移入2913…"),
  // so every target counts; taking the first would drop the rest with nothing to show for it.
  const moved = [...t.matchAll(RETIRED)];
  if (moved.length) {
    const ed = RETIRED_ED.exec(t);
    const tos = [...new Set(moved.flatMap(m => m[1].match(/\d{4}/g) ?? []))];
    return { relations: tos.map(to => ({ type: "cross_search", to_group: to, scope_zh: t,
                                         edition_qualifier: ed ? ed[0] : null })), unparsed: [] };
  }
  // A group deleted at an edition names no target. It is real and it is not a relation.
  if (DELETED.test(t)) return { relations: [{ type: "internal_note", to_group: null, scope_zh: t, edition_qualifier: null }], unparsed: [] };

  for (const c of clauses(t)) {
    if (c.type === "intra_group_exception") {
      relations.push({ type: c.type, to_group: null, scope_zh: c.text.replace(/^[，,；;、但]+/, ""), edition_qualifier: null });
      continue;
    }
    if (c.type === "cross_group_protected") {
      // The office states one PROTECTED GOOD per parenthesised group list. The unit is the good, not
      // the mention: 电动运载工具（1201，1202，1204第（一）部分，1205，1210）is ONE relation carrying five
      // targets. Collapsing the clause to a single deduped set loses which good spans which groups.
      const items = protectedItems(c.text);
      if (items.length) {
        for (const it of items)
          relations.push({ type: c.type, to_group: it.codes, scope_zh: it.good, edition_qualifier: null });
      } else {
        const codes = [...new Set(codesIn(c.text))];
        relations.push({ type: c.type, to_group: codes.length ? codes : null,
                         scope_zh: c.text.replace(/^[，,；;、]+/, ""), edition_qualifier: null });
      }
      continue;
    }
    // similar / cross_search: an edition qualifier governs every code AFTER it until the next one.
    const eds = [...c.text.matchAll(EDITION)];
    const segs = [];
    if (!eds.length) segs.push({ q: null, s: c.text });
    else {
      if (eds[0].index > 0) segs.push({ q: null, s: c.text.slice(0, eds[0].index) });
      eds.forEach((m, i) => segs.push({ q: m[0], s: c.text.slice(m.index + m[0].length, i + 1 < eds.length ? eds[i + 1].index : undefined) }));
    }
    let any = false;
    // "第（一）部分…与第（二）部分商品以及1103类似" states a similarity INSIDE this group as well as a
    // cross-group one. A 部分 reference not preceded by a code belongs to the note's own group; one
    // preceded by a code (0102第（二）部分) belongs to that code and is already counted.
    if (c.type === "similar" && sourceGroup && /^\d{4}$/.test(sourceGroup)) {
      for (const m of c.text.matchAll(/第（[一二三四五六七八九十]+）部分|第[一二三四五六七八九十]+自然段/g)) {
        if (!/\d/.test(c.text[m.index - 1] ?? "")) {
          relations.push({ type: c.type, to_group: sourceGroup, scope_zh: c.text.replace(/^[，,；;、]+/, ""),
                           edition_qualifier: null, self_reference: true });
          any = true; break;
        }
      }
    }
    for (const seg of segs) {
      for (const code of codesIn(seg.s)) {
        relations.push({ type: c.type, to_group: code, scope_zh: c.text.replace(/^[，,；;、]+/, ""), edition_qualifier: seg.q });
        any = true;
      }
    }
    if (!any) {
      const scope = c.text.replace(/^[，,；;、但]+/, "");
      if (c.type === "cross_search" && sourceGroup && /^\d{4}$/.test(sourceGroup)) {
        // "本类似群与第十一版及以前版本工业用化学品交叉检索" names no code: the office means an older
        // edition of THIS group. One relation per qualifier — a clause naming two editions states two
        // relations, and collapsing them to the last one loses the earlier edition silently.
        const qs = eds.length ? eds.map(m => m[0]) : [null];
        for (const q of qs) relations.push({ type: c.type, to_group: sourceGroup, scope_zh: scope, edition_qualifier: q, self_reference: true });
      } else {
        // A similarity with no group code is real and binding ("与5类含药物的相应商品类似") but cannot
        // be expressed group→group. It keeps its text and imports flagged, never dropped.
        relations.push({ type: c.type, to_group: null, scope_zh: scope, edition_qualifier: eds.length ? eds[eds.length - 1][0] : null });
        unparsed.push(c.text);
      }
    }
  }
  // One note can name the same target twice — six protected goods spanning the same two groups, or a
  // part reference repeated. The assertion is the same assertion; duplicate rows would inflate every
  // count taken off this table.
  // Scoped to the group→group types. Two protected-goods relations naming the same groups are two
  // OFFICE STATEMENTS about two different goods, and the second good's name is the provenance; folding
  // them would keep one name and drop the other.
  const seen = new Set(), deduped = [];
  for (const r of relations) {
    if (r.type === "cross_group_protected") { deduped.push(r); continue; }
    const key = `${r.type}|${r.to_group ?? ""}|${r.edition_qualifier ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key); deduped.push(r);
  }
  // A statement about the group's own internal structure ("第二自然段为橡胶工业用机器") asserts no
  // relation to anywhere. Tranche 1 recorded several as intra_group_exception, which reads as an
  // EXCLUSION the office never wrote. It keeps its text as an internal note and asserts nothing.
  if (!deduped.length && !codesIn(t).length && /自然段|第（[一二三四五六七八九十]+）部分|本部分/.test(t))
    deduped.push({ type: "internal_note", to_group: null, scope_zh: t, edition_qualifier: null });
  // A note that cites a group code and yields nothing is not an empty note — it is a phrasing this
  // parser does not know ("本类似群第九版时移入0407类似群"). Silence there would read as "no relation".
  if (!deduped.length && codesIn(t).length) unparsed.push(t);
  return { relations: deduped, unparsed };
}
