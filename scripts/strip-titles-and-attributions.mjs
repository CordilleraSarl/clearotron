// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Removes two more classes of internal attribution, over the population the citation-opener sweep beside
// it (strip-tracker-citations.mjs) scans, with the same exclusions:
//
//   TITLES — a test title that opens with an issue number:
//       test("1223 with no research credential …")    →   test("with no research credential …")
//       test("2087 arm 1 — the sources are …")         →   test("arm 1 — the sources are …")
//   ATTRIBUTIONS — a comment that names who a ruling came from:
//       // Owner ruling, 2026-08-29: …                  →   // Ruling, 2026-08-29: …
//   The ruling and its date stay; the person goes, as public attribution is by role and date.
//
//     node scripts/strip-titles-and-attributions.mjs            what would change, per class
//     node scripts/strip-titles-and-attributions.mjs --apply    change it
//
// WHY A SIBLING AND NOT MORE RULES IN THE OPENER SWEEP. That sweep is about one construction and its arms
// pin it; neither class here is a tracker citation, and folding them in would make its counts mean two
// things. What it has that is worth sharing — which files are in scope, which are excluded by name, and
// which tree is the published one — is IMPORTED, so there is still one population definition.
//
// THE POPULATION DIFFERS FROM THAT SWEEP'S IN TWO NAMED PLACES. `.env.example` is added: it carries two
// members of the attribution class and the opener sweep has never scanned it. And this file and its arms
// are excluded by name, because they quote both classes as specimens.
//
// WHAT EACH TRANSFORM WILL NOT DO, and each is an arm in the-title-and-attribution-sweep-takes-the-label.test.mjs:
//   · A title's label is taken WHOLE: a workstream letter (1957F), an item suffix (2191-F54, 1135-12,
//     600.3) or a second number (526/1067) is part of it, with or without its hash. Exactly one separator
//     after it goes with it: a space, `: `, or ` — `.
//   · A bare number the same file uses as a value in its code is what the title is ABOUT — `409 splits: …`
//     in a file that calls `withFetch(409, …)` — and a title that opens with a date is dated, not
//     labelled. Both are handed off.
//   · A title whose remainder would open with punctuation or with ANOTHER reference, would be empty, or
//     would read the same as another title in its file is HANDED OFF, never rewritten: a reader decides.
//     Another reference after the label is the title's subject ("2018 1010 still fires …"), and a sweep
//     that took the label would take the subject the next time it ran. A remainder opening with
//     a CLI flag (`--dry-run`) or a code span is ordinary prose and is rewritten.
//   · Only the FIRST argument of test(), it() or describe() is a title. A numbered string anywhere else is
//     somebody's data.
//   · A title another line QUOTES BY NAME moves with it: a table that anchors on a test's full name, with
//     its separator written as the character or as its escape, is rewritten in the same pass. A quote the
//     sweep may not touch — in a file excluded by name, or outside the population — keeps the title as it
//     is, and the title goes to a reader.
//   · An attribution is rewritten only on a COMMENT line, a JSX `{/* … */}` block included, or in markdown
//     PROSE outside a code fence. Inside a string the words are text a user reads or a value a run writes,
//     and changing either is not a comment edit, so those are handed off. So is a line where the word after
//     "owner" is a verb ("the owner ordered"): dropping the person would leave "the ordered".
//   · A phrase wrapped across two lines is taken as one — "(owner⏎// ruling, 2026-09-08)" becomes
//     "(ruling,⏎// 2026-09-08)" — and no line is added or removed, so every line citation into a swept
//     file still lands where it did.
//   · The article follows the word it now stands before: "an owner ruling" becomes "a ruling", and "an
//     owner order" stays "an order", on one line or across two.
//   · A line that carries a bare line citation (a line number cited with no symbol beside it) is handed off. The
//     citation ratchet judges a changed line as an added one, so any rewrite of that line would read as
//     adding the citation. The ratchet's own matcher decides, never a copy of its pattern.
//   · THE FLOOR. After the sweep, every line the class's own instrument still counts must be on a hand-off
//     list. A line neither rewritten nor handed off is a rule that cannot see it — it is reported, and
//     --apply refuses to write anything while one exists.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isScannable, EXCLUDED } from "./strip-tracker-citations.mjs";
import { publishedOf } from "../shared/reference-guard-classes.mjs";
import { newBareCitations } from "./citation-line-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

// ── THE POPULATION ───────────────────────────────────────────────────────────────────────────────────
export const OWN_SPECIMENS = [
  "scripts/strip-titles-and-attributions.mjs",
  "driver/test/the-title-and-attribution-sweep-takes-the-label.test.mjs",
];
const ALSO_SCANNED = /(?:^|\/)\.env\.example$/;
export const inPopulation = (f) =>
  !OWN_SPECIMENS.includes(f) && !EXCLUDED.includes(f) && (isScannable(f) || ALSO_SCANNED.test(f));

// ── TITLES ───────────────────────────────────────────────────────────────────────────────────────────
export const TITLE_CALL = /^(\s*(?:test|it|describe)(?:\.(?:skip|only|todo))?\(\s*)(["'`])/;
const PART = String.raw`\d+(?:[A-Za-z]\d*)?(?:-[A-Za-z]?\d+[A-Za-z]?)*`;
/** The label, whole — digits, a workstream letter, item suffixes, a second number after / or . — and ONE separator. */
export const TITLE_NUMBER = new RegExp(String.raw`^#?\d{3,}(?:[A-Za-z]\d*)?(?:-[A-Za-z]?\d+[A-Za-z]?)*(?:[/.]#?${PART})*(?:\s*[—–:]\s+|\s+-\s+|\s+)`);
const OPENS_WITH_NUMBER = /^#?\d{3,}/;
const DATE_LED = /^#?\d{4}-\d{2}-\d{2}(?!\d)/;
const PUNCTUATION_LED = /^[—–:,.;!?)\]-]/;
const ORDINARY_LEAD = /^(?:--[a-z]|`)/;

/** The title literal's text, up to its own unescaped closing quote; null when it does not close on this line. */
function titleText(rest, q) {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "\\") { i++; continue; }
    if (rest[i] === q) return rest.slice(0, i);
  }
  return null;
}

/** A code line with its strings and trailing comment removed — what is left is what the program computes with. */
const codeOnly = (l) => l.replace(/\\./g, "").replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""').replace(/\/\/.*$/, "");

/** Every number of three or more digits a file uses as a VALUE: in code, outside strings, comments and titles. PURE. */
export function valuesInCode(lines, kinds) {
  const out = new Set();
  lines.forEach((l, i) => {
    if (kinds[i] !== "code" || TITLE_CALL.test(l) || /^\s*[+`'"]/.test(l)) return;
    for (const m of codeOnly(l).matchAll(/(?<![\w#.$-])(\d{3,})(?![\w.])/g)) out.add(m[1]);
  });
  return out;
}

/**
 * One line's title, stripped. PURE. `valuesInCode` is the file's own numbers-as-values, from valuesInCode().
 * @returns {{line: string, changed: boolean, handoff?: string, title?: string}}
 */
export function stripTitle(line, { valuesInCode = new Set() } = {}) {
  const m = TITLE_CALL.exec(line);
  if (!m) return { line, changed: false };
  const rest = line.slice(m[0].length);
  if (!OPENS_WITH_NUMBER.test(rest)) return { line, changed: false };
  if (DATE_LED.test(rest)) return { line, changed: false, handoff: "a date opens this title — it is dated, not labelled" };
  const bare = /^(\d{3,})/.exec(rest);
  if (bare && valuesInCode.has(bare[1]))
    return { line, changed: false, handoff: "this file uses the number as a value in its code — it is what the title is about" };
  const t = TITLE_NUMBER.exec(rest);
  if (!t) return { line, changed: false, handoff: "a number with no separator after it — part of the title, or a label with none?" };
  const remainder = rest.slice(t[0].length);
  if (OPENS_WITH_NUMBER.test(remainder))
    return { line, changed: false, handoff: "what is left opens with another reference — the title's subject, which a second run would take" };
  const text = titleText(remainder, m[2]);
  if (text === null || text.trim() === "") return { line, changed: false, handoff: "the title would be empty, or does not close on this line" };
  if (PUNCTUATION_LED.test(remainder) && !ORDINARY_LEAD.test(remainder))
    return { line, changed: false, handoff: "what is left would open with punctuation" };
  return { line: m[0] + remainder, changed: true, title: text };
}

// ── ATTRIBUTIONS ─────────────────────────────────────────────────────────────────────────────────────
/** Where "owner" can start: a word boundary, or just after an escape such as the \n that opens a message. */
const START = String.raw`(?:(?<![A-Za-z0-9_])|(?<=\\[ntr]))`;
export const ATTRIBUTION = new RegExp(String.raw`${START}(an?\s+)?(owner)(\s+)(rulings?|steer|order)\b`, "gi");
/** "owner" before another form of the word — a verb, mostly: "the owner ordered". */
const OTHER_FORM = new RegExp(String.raw`${START}owner\s+(?:ruling(?!s?\b)|steer(?!\b)|order(?!\b))`, "i");
const COMMENT_BY_EXT = [
  [/\.(?:mjs|js|jsx|ts|tsx|css)$/, /^\s*(?:\/\/|\*|\/\*)/],
  [/\.(?:sh|yml|yaml|toml|service|timer)$|(?:^|\/)\.git(?:attributes|ignore)$|(?:^|\/)\.env\.example$/, /^\s*#/],
];
const BLOCK_OPENS = /^\s*\{?\/\*/;
const caseLike = (model, word) =>
  model === model.toUpperCase() ? word.toUpperCase()
  : model[0] === model[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;
const articleFor = (word) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** "owner ruling" → "ruling", keeping the case the phrase was written in and fixing the article. PURE. */
export function dropOwner(text) {
  return text.replace(ATTRIBUTION, (_, article, owner, _sp, word) => {
    const kept = caseLike(owner, word.toLowerCase());
    return article ? `${caseLike(article.trim(), articleFor(word))} ${kept}` : kept;
  });
}

/**
 * One line's attribution, dropped — where the line is somewhere a person reads rather than a value.
 * `kind` is "comment", "prose" or "code". PURE.
 */
export function stripAttribution(line, kind) {
  ATTRIBUTION.lastIndex = 0;
  const hit = ATTRIBUTION.test(line);
  ATTRIBUTION.lastIndex = 0;
  const other = OTHER_FORM.test(line);
  if (!hit && !other) return { line, changed: false };
  if (other) return { line, changed: false, handoff: 'the word after "owner" is a verb or another form here — dropping the person would leave "the ordered"' };
  if (kind === "code") return { line, changed: false, handoff: "inside a string or code — text a user reads or a value a run writes, not a comment" };
  const out = dropOwner(line);
  return { line: out, changed: out !== line };
}

/** Which kind of line this is. A markdown code fence is code; a JS block comment, JSX's included, is comment throughout. */
export function lineKinds(file, lines) {
  if (/\.md$/i.test(file)) {
    let fenced = false;
    return lines.map((l) => { if (/^\s*```/.test(l)) { fenced = !fenced; return "code"; } return fenced ? "code" : "prose"; });
  }
  const rule = COMMENT_BY_EXT.find(([ext]) => ext.test(file));
  if (!rule) return lines.map(() => "code");
  const blocks = rule === COMMENT_BY_EXT[0];
  let inBlock = false;
  return lines.map((l) => {
    if (inBlock) { if (l.includes("*/")) inBlock = false; return "comment"; }
    if (blocks && BLOCK_OPENS.test(l)) { inBlock = !l.includes("*/"); return "comment"; }
    return rule[1].test(l) ? "comment" : "code";
  });
}

const RATCHET_WHY = "the line carries a bare line citation, and the citation ratchet reads any rewrite of it as adding one";
/** Whether the citation ratchet would read this line, as rewritten, as ADDING a bare citation — its own matcher, called. */
const ratchetRefuses = (file, line, text) => newBareCitations([{ file, line, text }]).length > 0;

const LEADER = String.raw`\s*(?:(?:\/\/|#|\*|\{?\/\*)\s*)?`;
const WRAP_TAIL = /\b(?:an?\s+)?owner\s*$/i;
const WRAP_HEAD = new RegExp(String.raw`^(${LEADER})(rulings?|steer|order)\b([,:]?) ?`, "i");
const ARTICLE_TAIL = /\b(an?)(\s*)$/i;
const OWNER_HEAD = new RegExp(String.raw`^${LEADER}owner\s+(rulings?|steer|order)\b`, "i");

/**
 * The attribution wrapped across a line break, taken as one phrase: the word moves up to where "owner" stood,
 * and an article left at the end of a line agrees with the word that now follows it. Two lines in, two out. PURE.
 */
export function unwrapPairs(lines, kinds, refuses = () => false) {
  const out = lines.slice(), rewritten = [], handoff = [];
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i], b = out[i + 1];
    const tail = WRAP_TAIL.exec(a), head = WRAP_HEAD.exec(b);
    const readable = kinds[i] !== "code" && kinds[i + 1] !== "code";
    if (tail && head) {
      if (!readable) { handoff.push({ line: i + 1, why: "a wrapped attribution inside a string or code" }); continue; }
      const na = a.slice(0, tail.index) + dropOwner(`${tail[0].trimEnd()} ${head[2]}`) + head[3];
      const nb = head[1] + b.slice(head[0].length);
      if (refuses(i, na) || refuses(i + 1, nb)) { handoff.push({ line: i + 1, why: RATCHET_WHY }, { line: i + 2, why: RATCHET_WHY }); continue; }
      out[i] = na; out[i + 1] = nb;
      rewritten.push(i + 1);
      continue;
    }
    const art = ARTICLE_TAIL.exec(a), oh = OWNER_HEAD.exec(b);
    if (art && oh && readable) {
      const na = a.slice(0, art.index) + caseLike(art[1], articleFor(oh[1])) + art[2];
      if (na !== a && (refuses(i, na) || refuses(i + 1, dropOwner(b)))) { handoff.push({ line: i + 1, why: RATCHET_WHY }, { line: i + 2, why: RATCHET_WHY }); continue; }
      out[i] = na;
    }
  }
  return { lines: out, rewritten, handoff };
}

// ── THE FLOOR ───────────────────────────────────────────────────────────────────────────────────────
/** The two instruments the ruling counted its classes with, line-based and verbatim in what they match. */
export const INSTRUMENT = {
  title: /^\s*(?:test|it|describe)(?:\.\w+)?\(\s*["'`]#?\d{3,}/,
  attribution: /owner (?:ruling|steer|order)/i,
};
/**
 * Every line of a swept file that an instrument still counts and no hand-off list names, and every quote that
 * still names a renamed title as it was — a rule that cannot see the line, reported rather than left in silence. PURE.
 */
export function accountFor(file, lines, titleHandoff, attributionHandoff, rename = () => undefined) {
  const listed = (h) => new Set(h.filter((x) => x.file === file).map((x) => x.line));
  const t = listed(titleHandoff), a = listed(attributionHandoff);
  const out = [];
  lines.forEach((l, i) => {
    if (/\.test\.(?:mjs|js|ts)$/.test(file) && INSTRUMENT.title.test(l) && !t.has(i + 1)) out.push({ file, line: i + 1, class: "title", text: l.trim().slice(0, 110) });
    if (INSTRUMENT.attribution.test(l) && !a.has(i + 1)) out.push({ file, line: i + 1, class: "attribution", text: l.trim().slice(0, 110) });
    if (!TITLE_CALL.test(l) && renameQuoted(l, rename).hits) out.push({ file, line: i + 1, class: "reference", text: l.trim().slice(0, 110) });
  });
  return out;
}

// ── THE SURVEY ───────────────────────────────────────────────────────────────────────────────────────
/** A quoted string that could name a test — and the separators a test's full name is joined with. */
const QUOTED = /(["'`])([^"'`\n]*\d{3,}[^"'`\n]*)\1/g;
const NAME_SEPARATOR = /(\s*(?:›|\\u203a| > )\s*)/;

/** Every quoted part of `line` that `rename` maps, rewritten; the separators stay exactly as written. PURE. */
function renameQuoted(line, rename) {
  let hits = 0;
  const out = line.replace(QUOTED, (_, q, seg) => {
    const parts = seg.split(NAME_SEPARATOR);
    for (let k = 0; k < parts.length; k += 2) {
      const to = rename(parts[k]);
      if (to !== undefined) { parts[k] = to; hits++; }
    }
    return q + parts.join("") + q;
  });
  return { line: out, hits };
}

/** Per-file classification over the population. PURE; `read` is injected so an arm drives a planted tree. */
export function surveyOf(files, read) {
  const titles = { rewritten: {}, handoff: [] }, attributions = { rewritten: {}, handoff: [] }, references = { rewritten: {} };
  const unreadable = [], writes = {}, unaccounted = [];
  const bump = (o, f, n = 1) => { o[f] = (o[f] ?? 0) + n; };
  const state = new Map();     // file → { lines, out }
  const renamed = new Map();   // a title as it was → { to, file, i }
  // 1. TITLES — only in test files, and a file's rewrites are held back together if any two would collide.
  for (const f of files.filter(inPopulation)) {
    let text;
    try { text = read(f); } catch (e) { unreadable.push({ file: f, why: String(e?.message ?? e).slice(0, 120) }); continue; }
    const lines = text.split("\n"), out = lines.slice();
    state.set(f, { lines, out });
    if (!/\.test\.(?:mjs|js|ts)$/.test(f)) continue;
    const values = valuesInCode(lines, lineKinds(f, lines));
    const done = [];
    lines.forEach((l, i) => {
      const r = stripTitle(l, { valuesInCode: values });
      if (r.handoff) titles.handoff.push({ file: f, line: i + 1, why: r.handoff, text: l.trim().slice(0, 110) });
      else if (r.changed && ratchetRefuses(f, i + 1, r.line)) titles.handoff.push({ file: f, line: i + 1, why: RATCHET_WHY, text: l.trim().slice(0, 110) });
      else if (r.changed) done.push({ i, line: r.line, title: r.title, was: l });
    });
    const others = new Set(lines.map((l) => { const m = TITLE_CALL.exec(l); return m ? titleText(l.slice(m[0].length), m[2]) : null; })
      .filter((t, i) => t !== null && !done.some((d) => d.i === i)));
    const counts = {};
    for (const d of done) counts[d.title] = (counts[d.title] ?? 0) + 1;
    for (const d of done) {
      if (counts[d.title] > 1 || others.has(d.title)) {
        titles.handoff.push({ file: f, line: d.i + 1, why: "would read the same as another title in this file", text: d.was.trim().slice(0, 110) });
        continue;
      }
      out[d.i] = d.line;
      const m = TITLE_CALL.exec(d.was);
      renamed.set(titleText(d.was.slice(m[0].length), m[2]), { to: d.title, file: f, i: d.i });
    }
  }
  // 2. A TITLE ANOTHER LINE QUOTES BY NAME moves with it, in the same pass. A quote this sweep may not touch —
  //    in a file excluded by name, or outside the population — keeps the title as it is, for a reader.
  for (const g of files.filter((g) => !inPopulation(g) && !OWN_SPECIMENS.includes(g))) {
    let text;
    try { text = read(g); } catch { continue; }
    if (text.includes("\0")) continue;
    text.split("\n").forEach((l, j) => {
      if (TITLE_CALL.test(l)) return;
      renameQuoted(l, (part) => {
        const r = renamed.get(part);
        if (!r) return undefined;
        const st = state.get(r.file);
        st.out[r.i] = st.lines[r.i];
        renamed.delete(part);
        titles.handoff.push({ file: r.file, line: r.i + 1, why: `quoted by name at ${g}:${j + 1}, which this sweep may not touch`, text: st.lines[r.i].trim().slice(0, 110) });
        return undefined;
      });
    });
  }
  for (const r of renamed.values()) bump(titles.rewritten, r.file);
  const rename = (part) => renamed.get(part)?.to;
  for (const [f, st] of state) st.out.forEach((l, j) => {
    if (TITLE_CALL.test(l)) return;
    const r = renameQuoted(l, rename);
    // A quote whose line the ratchet would refuse is left, and the floor reports it: --apply then refuses
    // outright rather than land a title its quote no longer names.
    if (r.hits && !ratchetRefuses(f, j + 1, r.line)) { st.out[j] = r.line; bump(references.rewritten, f, r.hits); }
  });
  // 3. ATTRIBUTIONS — every file in the population, on the line kinds a person reads.
  for (const [f, st] of state) {
    const kinds = lineKinds(f, st.out);
    const wrapped = unwrapPairs(st.out, kinds, (i, text) => ratchetRefuses(f, i + 1, text));
    const out = wrapped.lines;
    for (const _ of wrapped.rewritten) bump(attributions.rewritten, f);
    const held = new Set(wrapped.handoff.map((h) => h.line - 1));
    for (const h of wrapped.handoff) attributions.handoff.push({ file: f, line: h.line, why: h.why, text: st.lines[h.line - 1].trim().slice(0, 110) });
    out.forEach((l, i) => {
      if (held.has(i)) return;
      const r = stripAttribution(l, kinds[i]);
      if (r.handoff) attributions.handoff.push({ file: f, line: i + 1, why: r.handoff, text: l.trim().slice(0, 110) });
      else if (r.changed && ratchetRefuses(f, i + 1, r.line)) attributions.handoff.push({ file: f, line: i + 1, why: RATCHET_WHY, text: l.trim().slice(0, 110) });
      else if (r.changed) { out[i] = r.line; bump(attributions.rewritten, f); }
    });
    if (out.some((l, i) => l !== st.lines[i])) writes[f] = out.join("\n");
    unaccounted.push(...accountFor(f, out, titles.handoff, attributions.handoff, rename));
  }
  return { titles, attributions, references, unreadable, writes, unaccounted };
}

const total = (o) => Object.values(o).reduce((a, n) => a + n, 0);

if (import.meta.url === `file://${process.argv[1]}`) {
  // THE PUBLISHED POPULATION, NOT THE INDEX — the same helper, for the same reason, as the opener sweep.
  const all = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean);
  const pub = publishedOf(all, ROOT);
  if (pub.error) { console.error(`strip-titles-and-attributions: ${pub.error}`); process.exit(2); }
  const s = surveyOf(pub.files, (f) => readFileSync(join(ROOT, f), "utf8"));
  if (s.unreadable.length) {
    console.log(`${s.unreadable.length} file(s) COULD NOT BE READ — every count below excludes them:`);
    for (const u of s.unreadable) console.log(`  ${u.file}  ${u.why}`);
    console.log("");
  }
  if (s.unaccounted.length) {
    console.log(`${s.unaccounted.length} line(s) an instrument still counts that the sweep neither rewrote nor handed off — UNACCOUNTED:`);
    for (const u of s.unaccounted) console.log(`  ${u.file}:${u.line}  [${u.class}]  ${u.text}`);
    if (APPLY) { console.error("strip-titles-and-attributions: refusing to --apply while a line is unaccounted for"); process.exit(2); }
    console.log("");
  }
  const verb = APPLY ? "rewrote" : "would rewrite";
  console.log(`titles:       ${verb} ${total(s.titles.rewritten)} across ${Object.keys(s.titles.rewritten).length} file(s); ${s.titles.handoff.length} handed to a reader`);
  console.log(`attributions: ${verb} ${total(s.attributions.rewritten)} across ${Object.keys(s.attributions.rewritten).length} file(s); ${s.attributions.handoff.length} handed to a reader`);
  console.log(`references:   ${verb} ${total(s.references.rewritten)} quoted test name(s) across ${Object.keys(s.references.rewritten).length} file(s)`);
  for (const [label, h] of [["titles", s.titles.handoff], ["attributions", s.attributions.handoff]]) {
    if (!h.length) continue;
    console.log(`\n${label} — the hand-off list:`);
    for (const x of h) console.log(`  ${x.file}:${x.line}  [${x.why}]  ${x.text}`);
  }
  if (APPLY) for (const [f, text] of Object.entries(s.writes)) writeFileSync(join(ROOT, f), text);
  console.log(`\nexcluded by name, shared with the opener sweep: ${EXCLUDED.join(", ")}`);
  console.log(`excluded by name, this sweep's own specimens: ${OWN_SPECIMENS.join(", ")}`);
}
