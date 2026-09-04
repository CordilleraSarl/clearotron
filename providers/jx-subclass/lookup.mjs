// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lookup.mjs — the two questions this database exists to answer, with every empty result named.
//
//   1. Which similar-group codes does this good carry in country X?
//   2. Which other groups must be searched because of it?
//
// ── EVERY WAY OF FINDING NOTHING IS A DIFFERENT ANSWER ─────────────────────────────────────────────
//
// A caller that receives an empty array cannot tell these apart, and they are not the same fact:
//
//   refused           the class was never transcribed — we do not know (COVERAGE)
//   good-not-found    the term matched no goods row; it may be a China-only C-good (TERMS)
//   no-code-for-good  the good is listed and the office assigns it no group code — 103 CN goods
//   none              read, resolved, and the office genuinely lists nothing — a clean negative
//
// Only the last is a clean negative. Returning [] for all four is the false clear this whole slice
// exists to prevent, so this module returns a STATUS and never a bare list.
import { assertCovered, CoverageError, coverageFor } from "./coverage.mjs";
import { resolveGood, resolveCnGood } from "./terms.mjs";

export const ENABLED_COUNTRIES = ["CN"];   // DATA, not a flag. Adding "JP","KR","TW" is a list edit.

const citation = (db, office) => db.prepare(
  "SELECT document, edition, effective, url FROM provenance WHERE office = ? LIMIT 1").get(office) ?? null;

/** Question 1: the group codes a good carries in one country. */
export function subclassesFor(db, { country, term, niceClass }) {
  const office = String(country).toUpperCase();
  if (!ENABLED_COUNTRIES.includes(office))
    return { status: "country-not-enabled", office, codes: [] };

  try { assertCovered(db, { office, layer: "group_code", niceClass }); }
  catch (e) { if (e instanceof CoverageError) return { status: "refused", office, codes: [], reason: e.message }; throw e; }

  // CNIPA's own goods list answers a China lookup first: it is the only source carrying the ※C-goods,
  // and where both offices list the same basic number they name it differently three times in four.
  //
  // IT IS A DIFFERENT EDITION, and the answer says so rather than blending them. cn_goods is the 12th
  // edition (2023 text); `group_code` comes from TIPO's NCL 13-2026 concordance.
  //
  // ── — THE 13TH EDITION GOVERNS THE CODE. CNIPA'S OWN WORDING STILL FINDS THE GOOD. ──────────
  //
  // Owner ruling, 2026-08-20: "13th edition. done." — option 2, accepting that the 12th's assignments
  // lose authority WHEREVER THE EDITIONS DISAGREE. That last clause is the whole design: disagreement is
  // the case being decided, and it is not the same case as "the 13th has never heard of this good".
  //
  // So the two tables do different jobs now, and each does the one it is best at:
  //
  //   cn_goods    FINDS the good. It carries CNIPA's own wording — which is what a Chinese client
  //               writes, and the two offices name the same basic number differently three times in
  //               four — and it is the only source carrying the ※C-numbered China-only goods.
  //   group_code  DECIDES the code, when it holds one for that good's Nice basic number.
  //
  // Measured on the committed public data: 10,842 distinct basic numbers in cn_goods, 8,984 of them
  // also in group_code(CN). Of those, 8,959 AGREE and **25 DISAGREE** — that 25 is the population this
  // ruling moves, and the specimen is one of them: 3D 眼镜 (090726) prints under 0921 in the 12th and
  // the concordance puts it at 0911. The other 1,858 are absent from the 13th entirely (1,757 of them
  // the C-goods, which carry no Nice basic number and can appear in no concordance) — there is nothing
  // for them to disagree WITH, so the 12th still answers and the citation says so.
  //
  // DROPPING THEM WAS THE OTHER READING AND IT IS NOT THIS ONE. "Loses authority where they disagree"
  // is not "is deleted": answering nothing for 1,858 goods a Chinese client can name would trade a
  // stale code for no code at all.
  if (office === "CN") {
    const cn = resolveCnGood(db, { term, niceClass });
    if (cn.rows.length && cn.how !== "zh-fragment") {
      const govern = db.prepare("SELECT code FROM group_code WHERE basic_no = ? AND office = 'CN'");
      const ruled = cn.rows.map((x) => {
        const thirteenth = govern.all(String(x.no)).map((c) => c.code);
        return { row: x, codes: thirteenth.length ? thirteenth : [x.group_code], edition: thirteenth.length ? 13 : 12 };
      });
      const codes = [...new Set(ruled.flatMap((r) => r.codes))];
      // WHICH EDITION ANSWERED, PER MATCHED GOOD — not one label over a mixed answer. A term that matches
      // two goods can take its code from the concordance for one and from the 区分表 for the other, and a
      // single `source` string would have to lie about one of them. The printed page rides on the row it
      // belongs to, so a 12th-edition answer stays checkable against the page a lawyer can open.
      const from13 = ruled.filter((r) => r.edition === 13).length;
      return { status: "ok", office, codes, matchedHow: `cn-${cn.how}`,
               matched: ruled.map(({ row, codes: c, edition }) => ({
                 basic_no: row.no, name: row.name_zh_cn, china_only: !!row.china_only,
                 printed_page: row.printed_page, codes: c, code_edition: edition,
                 cn_goods_code: row.group_code,   // what the 12th says, kept even when the 13th governs
               })),
               source: from13 === ruled.length
                 ? "NCL 13-2026 concordance — the 13th edition governs the group code (#1391); CNIPA's 区分表 found the good"
                 : from13 === 0
                   ? "CNIPA 区分表, 12th edition (2023 text) — the 13th edition holds no group for this good, so there is nothing it disagrees with"
                   : `mixed: ${from13} of ${ruled.length} matched goods take the 13th edition's group, the rest have no 13th-edition group at all`,
               citation: citation(db, office) };
    }
  }
  const r = resolveGood(db, { term, niceClass });
  if (!r.rows.length || r.how === "zh-fragment")
    return { status: r.how === "zh-fragment" ? "good-not-found-fragment-only" : "good-not-found",
             office, codes: [], matchedHow: r.how, suggestion: r.rows[0]?.name_zh_tw ?? null,
             note: "No goods row. The 区分表 also lists China-only goods (※, C-numbered) that carry no Nice basic number and cannot appear in this table at all — a miss is not evidence the good has no similar group." };

  const codes = [...new Set(r.rows.flatMap((row) =>
    db.prepare("SELECT code FROM group_code WHERE basic_no = ? AND office = ?").all(row.basic_no, office)
      .map((c) => c.code)))];
  const base = { office, matchedHow: r.how, matched: r.rows.map((x) => ({ basic_no: x.basic_no, name: x.name_zh_tw, en: x.name_en })),
                 citation: citation(db, office) };
  return codes.length
    ? { status: "ok", codes, ...base }
    : { status: "no-code-for-good", codes: [], ...base,
        note: "The good is listed and this office assigns it no group code. That is the concordance's own placeholder, not an absence of exposure." };
}

/**
 * The Nice classes a group code spans — acceptance 7 and 10.
 *
 * ── THE UNION IS THE ANSWER, AND EITHER SOURCE ALONE IS A FALSE CLEAR ─────────────────────────────
 *
 * `class_span` holds three bases and they are three different authorities, not three copies:
 *
 *   exam_standard        the office's own examination standard ENUMERATES the class
 *   derived_from_goods   a good in that class CARRIES the code, so the office puts it there in practice
 *   intl_table           the international table's mapping
 *
 * Measured on the committed JP data: 24 (group, class) pairs are in `exam_standard` and NOT in
 * `derived_from_goods`, and 895 are in `derived_from_goods` and not in `exam_standard`. Neither
 * contains the other, in either direction, so a query over one is incomplete both ways.
 *
 * `19B33` is the specimen: 14 classes by goods, 5 by the examination standard. Answering from the
 * standard alone drops nine classes a Japanese examiner will search — a false clear in the
 * jurisdiction a Western client is least able to check.
 *
 * INTL_TABLE IS REPORTED, NOT UNIONED. Acceptance 7 names two bases and this returns exactly those two.
 * The international mapping is a different authority from the office's own practice, and folding it in
 * would make a national answer depend on a table the national office did not write. It rides alongside
 * so a caller can see it, which is the house rule: distinct things are surfaced, never merged.
 *
 * NOT SCOPED BY NICE CLASS, and that is the point (acceptance 10). 43% of JP codes and 39% of KR codes
 * span classes deliberately. A caller that already knows the class must not narrow this — the whole
 * question is "which OTHER classes does this reach".
 */
export function classSpanFor(db, { country, group }) {
  const office = String(country).toUpperCase();
  if (!ENABLED_COUNTRIES.includes(office))
    return { status: "country-not-enabled", office, classes: [] };

  const code = String(group);
  const rows = db.prepare(
    "SELECT nice_class, basis FROM class_span WHERE office = ? AND group_code = ? ORDER BY nice_class").all(office, code);
  if (!rows.length)
    return { status: "none", office, group: code, classes: [], byBasis: {}, intlOnly: [], citation: citation(db, office),
             note: "No class span recorded for this group. That is not the same as a group confined to one class — check coverage for the office before reading it as one." };

  const of = (b) => rows.filter((r) => r.basis === b).map((r) => r.nice_class);
  const exam = of("exam_standard"), goods = of("derived_from_goods"), intl = of("intl_table");
  const classes = [...new Set([...exam, ...goods])].sort((a, b) => a - b);
  return {
    status: "ok", office, group: code, classes,
    // Kept apart so a caller can see WHICH authority put a class in the answer, and so a later change
    // to what unions with what is a visible edit rather than a silent one.
    byBasis: { exam_standard: exam, derived_from_goods: goods, intl_table: intl },
    // Reported, never merged: classes only the international table names.
    intlOnly: intl.filter((c) => !classes.includes(c)).sort((a, b) => a - b),
    citation: citation(db, office),
  };
}

/**
 * Which similar groups exist in one Nice class —, the replacement for `driver/jx-cnipa-groups.mjs`.
 *
 * That module was five classes of hand-written top-level groups marked `vetted:false`, and it was the
 * only similar-group surface the zh lane had. Measured against the committed data it carried **4 of the
 * 22 groups in class 9**, and returned `null` for class 33, which has one. An operator reading it saw a
 * short list with no way to tell "these are the groups" from "these are the five somebody typed".
 *
 * THE CLASS COMES FROM THE GOODS TABLE, NEVER FROM THE CODE. A CN group code encodes its class in its
 * first two digits (`0901` is class 9) and it is tempting to read it off — but a JP code does not
 * (`19B33` spans fourteen classes and begins with none of them). A substring rule would be silently
 * CN-only and would answer confident nonsense the day the country list is flipped, which is exactly the
 * shape acceptance 12 exists to catch. Joining through `goods.nice_class` is office-agnostic and is the
 * office's own assignment rather than an inference about code formatting.
 *
 * CN ALSO UNIONS `cn_goods`, because the ※C-numbered China-only goods carry no Nice basic number and
 * therefore appear in no concordance — they exist only in CNIPA's own table. Leaving them out would
 * drop groups that genuinely exist in the class.
 */
export function groupsInClass(db, { country, niceClass }) {
  const office = String(country).toUpperCase();
  if (!ENABLED_COUNTRIES.includes(office))
    return { status: "country-not-enabled", office, groups: [] };

  const n = Number(niceClass);
  if (!Number.isInteger(n) || n < 1 || n > 45)
    return { status: "class-invalid", office, groups: [], note: `${JSON.stringify(niceClass)} is not a Nice class (1-45)` };

  try { assertCovered(db, { office, layer: "group_code", niceClass: n }); }
  catch (e) { if (e instanceof CoverageError) return { status: "refused", office, groups: [], reason: e.message }; throw e; }

  const codes = new Set(db.prepare(
    `SELECT DISTINCT gc.code AS code FROM group_code gc
       JOIN goods g ON g.basic_no = gc.basic_no
      WHERE gc.office = ? AND g.nice_class = ?`).all(office, n).map((r) => r.code));
  if (office === "CN")
    for (const r of db.prepare("SELECT DISTINCT group_code AS code FROM cn_goods WHERE nice_class = ?").all(n))
      codes.add(r.code);

  const groups = [...codes].sort();
  return groups.length
    ? { status: "ok", office, niceClass: n, groups, citation: citation(db, office) }
    : { status: "none", office, niceClass: n, groups: [], citation: citation(db, office),
        note: "Read, and this office assigns no similar group in this class. A clean negative — not an unread class, which refuses above." };
}

/** Question 2: the groups a search must also cover, because of one group. */
export function crossReferencesFor(db, { country, group, niceClass }) {
  const office = String(country).toUpperCase();
  if (!ENABLED_COUNTRIES.includes(office))
    return { status: "country-not-enabled", office, relations: [] };

  try { assertCovered(db, { office, layer: "cross_reference", niceClass }); }
  catch (e) { if (e instanceof CoverageError) return { status: "refused", office, relations: [], reason: e.message, coverage: e.status }; throw e; }

  const rows = db.prepare(`SELECT to_group, type, scope_zh, edition_qualifier, printed_page, note_number,
                                  note_text_zh, needs_review, edition_gap
                           FROM cross_reference WHERE office = ? AND source_group = ?
                           ORDER BY type, to_group`).all(office, String(group));
  const cov = coverageFor(db, { office, layer: "cross_reference", niceClass });
  // The four types are never merged. 类似 means treated as similar; 交叉检索 means the search must ALSO
  // cover that group; 各部分之间商品不类似 is an EXCLUSION; 跨类似群保护商品 is simultaneous protection,
  // not a similarity assertion. Collapsing any pair of them changes the answer.
  const byType = {};
  for (const r of rows) (byType[r.type] ??= []).push(r);
  return {
    status: rows.length ? "ok" : "none",
    office, group, relations: rows, byType,
    // Surfaced, never applied silently: a relation qualified 第九版及以前版本 belongs to a historical
    // edition of that group and applying it to today's data is wrong.
    editionQualified: rows.filter((r) => r.edition_qualifier).length,
    editionGap: rows.filter((r) => r.edition_gap).length,
    needsReview: rows.filter((r) => r.needs_review).length,
    coverage: { status: cov?.status, readPages: cov?.read_pages ?? null, groupsNoNotes: cov?.groups_no_notes ?? null },
    citation: citation(db, office),
  };
}
