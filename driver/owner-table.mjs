// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// owner-table.mjs — every owner in the pile, in one table, laid out by code.
//
// ── what this is for ─────────────────────────────────────────────────────────────────────────────────
//
// The judging step does not page the pile record by record. Code lays it out by OWNER, the way a lawyer
// reads a search report — who holds what, how close, where, how live — and the judges read the table and
// open what they choose. Nothing here judges: an owner's place is worked out from the register's own
// words. How close a mark is to the ordered one is read off its text; which kind of question brought it
// is the run's own record.
//
// PORTED, NOT REDESIGNED, from the private bench where this order was specified and measured on five
// lawyer-scored cases (its `src/owner.mjs` and `src/owner-table.mjs`, the order it calls "v2"). The
// order, the four closeness steps, the line's columns and the folding of owner names are the bench's,
// unchanged; what the judges were measured reading is what they read here. Only the bench's first order
// is not ported — it was measured and not chosen.
//
// THE ORDER:
//   1. owners holding a live record in the order's classes before the rest;
//   2. closeness of the owner's closest mark, in four steps (CLOSENESS);
//   3. fewer letters away from the ordered mark first;
//   4. more offices first; 5. more records first; 6. the folded name.
// Each owner is one line, so a page holds about twice as many owners as a record dump would.
//
// PURE — no node imports, so it tests offline. The pile it reads is built by pile.mjs.

const LIVE = new Set(["REGISTERED", "PENDING"]);
const MARKS_SHOWN = 5;
const OFFICES_SHOWN = 10;

// ── owner names ──────────────────────────────────────────────────────────────────────────────────────
//
// A register returns owner NAMES, never a stable owner identifier, so records are grouped by a folded
// name. The fold errs toward splitting one company in two; it never merges two different names.

const LEGAL_FORMS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "llc", "llp", "lp", "plc",
  "gmbh", "ag", "kg", "sa", "sas", "sarl", "srl", "spa", "bv", "nv", "ab", "as", "oy", "kk", "pte", "pty",
  "the",
]);

// A pile names a few thousand owners and the merge asks for each key many times over: keys are kept.
const KEPT = new Map();

/** The key two records share when their owner names differ only by case, accents, punctuation or legal form. */
export function ownerKey(name) {
  const asked = String(name ?? "");
  if (!KEPT.has(asked)) KEPT.set(asked, foldName(asked));
  return KEPT.get(asked);
}

function foldName(name) {
  const folded = String(name ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(?:\p{L}\.){2,}/gu, (dotted) => dotted.replaceAll(".", ""))   // "k.k." and "s.a.r.l." are one word
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!folded) return "";
  const kept = folded.split(" ").filter((w) => !LEGAL_FORMS.has(w));
  return (kept.length ? kept : folded.split(" ")).join(" ");
}

/** The key of a record that names no owner: a group of its own, named by its record so it can be asked for. */
export const namelessKey = (recordId) => `(no owner recorded) ${recordId}`;

/** Group records by owner. A record with no owner name is a group of its own. Largest group first. */
export function groupByOwner(records) {
  const groups = new Map();
  for (const r of records) {
    const key = ownerKey(r.owner) || namelessKey(r.id);
    if (!groups.has(key)) groups.set(key, { key, names: new Map(), records: [] });
    const g = groups.get(key);
    g.records.push(r);
    if (r.owner) g.names.set(r.owner, (g.names.get(r.owner) ?? 0) + 1);
  }
  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      owner: [...g.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "(no owner recorded)",
      records: g.records,
    }))
    .sort((a, b) => b.records.length - a.records.length || a.key.localeCompare(b.key));
}

// ── closeness ────────────────────────────────────────────────────────────────────────────────────────

export const CLOSENESS = [
  "same",                           // the mark is the ordered mark, letters and digits compared
  "holds it as a word",             // the ordered mark is a whole word of the mark
  "another form, asked exactly",    // neither, and an exact question on another form brought it
  "loose match",                    // neither, and only a contains or wildcard question brought it
];

const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase();
const solid = (s) => fold(s).replace(/[^\p{L}\p{N}]+/gu, "");
const wordsOf = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** 0 to 3, an index into CLOSENESS. */
export function closenessOf(markText, orderedMarks, broughtByAnExactQuestion) {
  const mark = solid(markText);
  const line = ` ${wordsOf(markText).join(" ")} `;
  for (const ordered of orderedMarks) if (solid(ordered) && solid(ordered) === mark) return 0;
  for (const ordered of orderedMarks) {
    const w = wordsOf(ordered);
    if (w.length && line.includes(` ${w.join(" ")} `)) return 1;
  }
  return broughtByAnExactQuestion ? 2 : 3;
}

/** How many letters must be added, dropped or changed to turn one mark into the other. */
export function lettersAway(a, b) {
  const x = [...solid(a)], y = [...solid(b)];
  if (!x.length || !y.length) return Math.max(x.length, y.length);
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    for (let j = 1; j <= y.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    row = next;
  }
  return row[y.length];
}

// ── the line ─────────────────────────────────────────────────────────────────────────────────────────

export const LINE_COLUMNS = "owner | countries | closeness | letters away | records, live, live in the order's classes | marks | classes | offices | years filed";

/** One owner as one line, in the order of LINE_COLUMNS. */
export function lineOf(row) {
  const clean = (v) => String(v).replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim();
  return [
    clean(row.owner),
    row.countries.join(","),
    row.closeness,
    row.letters_away,
    `${row.records}, ${row.live}, ${row.live_in_the_order_classes}`,
    row.marks.map(clean).join("; ") + (row.more_marks ? `; and ${row.more_marks} more` : ""),
    row.classes.join(","),
    row.offices.join(",") + (row.more_offices ? ` and ${row.more_offices} more` : ""),
    row.filed ? (row.filed[0] === row.filed[1] ? String(row.filed[0]) : `${row.filed[0]}-${row.filed[1]}`) : "",
  ].join(" | ");
}

const year = (date) => (/^\d{4}/.test(String(date ?? "")) ? Number(String(date).slice(0, 4)) : null);
export const isLive = (r) => LIVE.has(String(r.status).toUpperCase());

/**
 * The table. `pile` is pile.mjs's shape: `{ orderMarks, orderClasses, questions:[{qid, match}], records:[{id,
 * mark, owner, ownerCountry, office, classes, status, filed, qids}] }`. Returns null when the run does not
 * record the order's mark, since closeness cannot be read without it.
 *
 * Each row: `{ key, records, step, letters, liveInClasses, officeCount, row }`, where `row` is what the
 * judges are shown (and `lineOf(row)` the line).
 */
export function buildOwnerTable(pile) {
  if (!pile?.orderMarks?.length) return null;
  const orderClasses = new Set(pile.orderClasses.map(Number));
  const matchOf = new Map(pile.questions.map((q) => [q.qid, q.match]));
  const closeness = new Map(pile.records.map((r) => [r.id, closenessOf(r.mark, pile.orderMarks, r.qids.some((q) => matchOf.get(q) === "exact"))]));
  const away = new Map(pile.records.map((r) => [r.id, closeness.get(r.id) < 2 ? 0 : Math.min(...pile.orderMarks.map((m) => lettersAway(r.mark, m)))]));

  const rows = groupByOwner(pile.records).map((g) => {
    const records = [...g.records].sort((a, b) => closeness.get(a.id) - closeness.get(b.id) || Number(isLive(b)) - Number(isLive(a)));
    const marks = [...new Set(records.map((r) => r.mark).filter(Boolean))];
    const officeCount = new Map();
    for (const r of records) officeCount.set(r.office, (officeCount.get(r.office) ?? 0) + 1);
    const offices = [...officeCount.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([o]) => o);
    const years = records.map((r) => year(r.filed)).filter(Boolean);
    const step = Math.min(...records.map((r) => closeness.get(r.id)));
    const letters = Math.min(...records.filter((r) => closeness.get(r.id) === step).map((r) => away.get(r.id)));
    const liveInClasses = records.filter((r) => isLive(r) && r.classes.some((c) => orderClasses.has(Number(c)))).length;
    return {
      key: g.key,
      records,
      step,
      letters,
      liveInClasses,
      officeCount: offices.length,
      row: {
        // A record with no owner name is a row of its own, named by its record so it can be asked for.
        owner: records.some((r) => r.owner) ? g.owner : namelessKey(records[0].id),
        countries: [...new Set(records.map((r) => r.ownerCountry).filter(Boolean))],
        closeness: CLOSENESS[step],
        letters_away: letters,
        records: records.length,
        live: records.filter(isLive).length,
        live_in_the_order_classes: liveInClasses,
        marks: marks.slice(0, MARKS_SHOWN),
        ...(marks.length > MARKS_SHOWN ? { more_marks: marks.length - MARKS_SHOWN } : {}),
        classes: [...new Set(records.flatMap((r) => r.classes.map(Number)))].sort((a, b) => a - b),
        offices: offices.slice(0, OFFICES_SHOWN),
        ...(offices.length > OFFICES_SHOWN ? { more_offices: offices.length - OFFICES_SHOWN } : {}),
        filed: years.length ? [Math.min(...years), Math.max(...years)] : null,
      },
    };
  });
  const live = (r) => Number(r.liveInClasses > 0);
  rows.sort((a, b) => live(b) - live(a) || a.step - b.step || a.letters - b.letters || b.officeCount - a.officeCount
    || b.records.length - a.records.length || a.key.localeCompare(b.key));

  return {
    rows,
    closenessOfRecord: (id) => closeness.get(id),
    byKey: new Map(rows.map((r) => [r.key, r])),
    byName: new Map(rows.map((r) => [r.row.owner, r])),
    summary: CLOSENESS.map((name, step) => {
      const mine = rows.filter((r) => r.step === step);
      return { closeness: name, owners: mine.length, records: mine.reduce((n, r) => n + r.records.length, 0), owners_live_in_the_order_classes: mine.filter((r) => r.liveInClasses > 0).length };
    }),
  };
}

/**
 * The two bands the judges' opening pages are built around, by key and in the table's order, among the
 * owners holding a live record in the order's classes (design, 2026-10-03):
 *   floor  the first two closeness steps, the same mark and marks holding it as a word. The old sweep fetched
 *          these with no cap, since a dangerous live mark in the order's classes must never be paged past;
 *          the opening holds them whole, always.
 *   band   the first three, the near band. Its third step follows the floor, fewest letters away first, up to
 *          a ceiling in pages.
 * Each is a prefix of the table, since the order puts those owners first. PURE.
 */
export function openingBands(table) {
  const live = (table?.rows ?? []).filter((r) => r.liveInClasses > 0);
  const before = (name) => live.filter((r) => r.step < CLOSENESS.indexOf(name)).map((r) => r.key);
  return { floor: before("another form, asked exactly"), band: before("loose match") };
}
