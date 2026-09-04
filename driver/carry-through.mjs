// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Carry-through: of every subject the run's own findings surfaces CARRY, which ones reach none of
// `findings.json`, `narrative.md`, `placements.json`.
//
//. `score.mjs`'s `withheld` bucket answers a narrower question — it is built from REFERENCE
// entries, so a mark the run retrieved and dropped can only raise it if the lawyer's list happens to
// name that mark. On R2 `ed1d7248` the reviewer returned BLOCKING on two dropped rights and the
// scorer printed `withheld 0`. Both numbers were correct. Nothing measured the rest of the seam.
//
// This measure is built from the RUN'S OWN corpus and needs no reference, which is also why it lives
// here rather than inside `score.mjs`: that script dies when there is no gold set, and R0, R5 and R6
// have none. They are exactly the runs where nothing else measures anything.
//
// IDENTITY, AND WHY IT IS CHECKED RATHER THAN ASSUMED. `register-findings.md` states its own: "The
// `URI` column is the canonical record identity". Joining on it beats joining on the mark name, which
// has to cope with three shapes, each wrong in a different direction. Illustrated on synthetic marks,
// because this tree is de-identified and the real specimens are client matter:
//   · a CJK cell carrying a gloss — `冰莓 ("ice berry")` — never matches the bare mark downstream;
//   · a cell naming several forms — `NOVA Reminder / Feedback` — matches none of them literally;
//   · a short bare mark — `PULSE` — matches INSIDE `NOVAPULSE` and `PULSEFIELD`, so a real drop reads
//     as an arrival.
// The first two over-report, the third under-reports. All three were live in the first version.
//
// But an identifier is only a join key if the DOWNSTREAM artifacts carry it, and one of these two
// surfaces does not. Measured on a preserved clearance run (2026-08-19): of the 49 URLs in that run's
// `common-law-findings.md`, ZERO appear in its `placements.json` — while the seats themselves plainly
// arrive, by name, one of them with 3 hits in findings.json, 2 in narrative.md and 2 in
// placements.json. Joining that surface on URL reports every row lost and is wrong about all of them.
//
// So a subject counts as ARRIVED if EITHER its identifier or its name arrives, and is reported LOST
// only when NEITHER does. No threshold and no per-surface switch: a rule like "trust the identifier if
// enough of them carry" needs a number nobody can derive, and picks wrong near the boundary. Requiring
// both to fail can only move a row from lost to arrived, which is the conservative direction for a
// defect count — and `joinedOn` records which join answered, so a reader can see how much of the
// result rests on the weaker one. `joinBasis` reports each surface's identifier carry rate, because a
// surface where almost no identifier reaches the artifacts is itself worth knowing.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

export const ARRIVAL_ARTIFACTS = ["findings.json", "narrative.md", "placements.json"];

const REGISTER_URI = /\/mark\/[a-z]{2}\/[A-Za-z0-9]+/g;
const CJK = /[㐀-鿿豈-﫿]/;

// A section is not expected to reach the findings when its own heading says so. Both phrasings are
// the artifact's words, not a taxonomy of ours: "… — reasoning carried, NOT Findings" and
// "Negative results". Read the heading rather than maintaining a list of section names — a heading
// nobody anticipated otherwise lands in the population and inflates the count.
const DECLARES_NOT_FINDINGS = /\bnot\s+findings\b|\bnegative\s+results\b|\bout-of-scope\b/i;
// Query logs (audit trail, coverage ledger) have no subject column at all and exclude themselves.
const SUBJECT_HEADERS = ["mark", "finding"];
const IDENT_HEADERS = ["uri", "url"];

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** Rows of every table that HAS a subject column, tagged with the heading they sit under. */
export function subjectRows(md) {
  const rows = [];
  let heading = "", subjectCol = null, identCol = null, inBody = false;
  for (const line of String(md ?? "").split("\n")) {
    const h = /^#{2,6}\s+(.*)$/.exec(line);
    if (h) { heading = h[1].trim(); subjectCol = identCol = null; inBody = false; continue; }
    if (!line.startsWith("|")) { subjectCol = identCol = null; inBody = false; continue; }
    const cells = splitRow(line);
    if (/^[-: ]+$/.test(cells[0])) { inBody = true; continue; }
    if (!inBody) {
      const low = cells.map((c) => c.toLowerCase());
      subjectCol = SUBJECT_HEADERS.map((k) => low.indexOf(k)).find((i) => i >= 0) ?? null;
      identCol = IDENT_HEADERS.map((k) => low.indexOf(k)).find((i) => i >= 0) ?? null;
      if (subjectCol === undefined) subjectCol = null;
      if (identCol === undefined) identCol = null;
      continue;
    }
    if (subjectCol == null || subjectCol >= cells.length) continue;
    const name = cells[subjectCol].replace(/\*\*|`/g, "").trim();
    if (!name) continue;
    const identCell = identCol != null && identCol < cells.length ? cells[identCol] : "";
    rows.push({ name, identCell, heading, expectedToArrive: !DECLARES_NOT_FINDINGS.test(heading) });
  }
  return rows;
}

/** Identifiers in a cell: register URIs, or http(s) URLs on the common-law side. */
export function identifiersOf(cell) {
  const s = String(cell ?? "");
  const out = [...(s.match(REGISTER_URI) ?? [])];
  for (const m of s.match(/https?:\/\/[^\s|)>\]]+/g) ?? []) out.push(m.replace(/[.,;]+$/, ""));
  return [...new Set(out)];
}

/** Name fallback for rows with no identifier. Word-boundary for Latin; CJK has no boundaries. */
export function nameFragments(cell) {
  let s = String(cell ?? "").replace(/\*\*|`/g, "").trim();
  s = s.replace(/\s*\([^()]*\)\s*$/, "").replace(/\s*\[[^[\]]*\]\s*$/, "");
  const out = [];
  // — THE EM-DASH SEPARATES A NAME FROM ITS DESCRIPTION, and not splitting on it
  // made the whole composite the only join key. The common-law surface writes its subject as
  // "<entity> — <what they do>", so the fragment tested was the entire sentence and it matched nothing
  // downstream, while the ENTITY plainly arrived. Measured on a preserved delivered run: three subjects
  // reported LOST, all three present in findings.json and placements.json under their entity name.
  //
  // Both halves are kept as fragments rather than only the head, which is this function's existing
  // direction: a subject counts as arrived if ANY fragment arrives, and adding fragments can only move
  // a row from lost to arrived — the conservative direction for a DEFECT count, as the header says. The
  // word-boundary test is what keeps a short fragment from matching inside a longer word.
  for (let f of s.split(/\s*[/;,—–]\s*|\s+…\s*/)) {
    f = f.replace(/^[\s.·—-]+|[\s.·—-]+$/g, "");
    if (f.length >= 3 || (f && CJK.test(f))) out.push(f);
  }
  return out;                       // MAY BE EMPTY — a cell naming nothing testable is UNMEASURABLE,
}                                   // never "arrived": the empty string is contained in every text.

const nameArrives = (frag, text) => CJK.test(frag)
  ? text.includes(frag)
  : new RegExp(`(?<![A-Za-z0-9])${frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i").test(text);

/**
 * @returns {{computable: boolean, reason: string|null, surfaces: string[], subjects: number,
 *            lost: object[], unmeasurable: object[], nameOnly: number, notExpected: number}}
 */
export function carryThrough(runDir) {
  const surfaces = ["register-findings.md", "common-law-findings.md"].filter((f) => existsSync(join(runDir, f)));
  if (!surfaces.length) {
    return { computable: false, reason: "neither register-findings.md nor common-law-findings.md is present, so this run carries no subject list to check",
      surfaces: [], joinBasis: {}, subjects: 0, lost: [], unmeasurable: [], nameOnly: 0, notExpected: 0, distinct: 0, rawRows: 0 };
  }
  const texts = ARRIVAL_ARTIFACTS.map((f) => ({ f, t: readText(join(runDir, f)) }));
  const present = texts.filter((x) => x.t);
  if (!present.length) {
    // Same shape as a computable result, so a consumer reading `distinct` or `lost` off a refusal gets
    // zeros rather than `undefined` — and `computable: false` is the field that says why it is zero.
    return { computable: false, reason: `none of ${ARRIVAL_ARTIFACTS.join(", ")} is readable, so arrival cannot be tested — an absence, not a clean sweep`,
      surfaces, joinBasis: {}, subjects: 0, lost: [], unmeasurable: [], nameOnly: 0, notExpected: 0, distinct: 0, rawRows: 0 };
  }
  const seen = new Set(), lost = [], unmeasurable = [], joinBasis = {};
  let subjects = 0, nameOnly = 0, notExpected = 0, rawRows = 0;
  for (const surface of surfaces) {
    const rows = subjectRows(readText(join(runDir, surface)));
    rawRows += rows.length;
    // REPORTED, NOT ACTED ON. How much of a surface's identifier space reaches the artifacts is worth
    // knowing — one of these two surfaces carries almost none downstream — but it does not switch the
    // join. Switching on it needs a threshold, and no defensible number separates "2 of 9" from "3 of
    // 22". The per-row rule below needs no threshold at all.
    const allIds = [...new Set(rows.flatMap((r) => identifiersOf(r.identCell)))];
    const idsCarried = allIds.filter((i) => present.some(({ t }) => t.includes(i))).length;
    joinBasis[surface] = allIds.length
      ? `${idsCarried} of ${allIds.length} identifier(s) reach an arrival artifact`
      : "this surface records no identifiers; name join only";
    for (const row of rows) {
      const ids = identifiersOf(row.identCell);
      // An identifier is unique, so the same record listed in two sections is ONE subject and dedups
      // globally. A name is not: keying a no-identifier row on the bare name merged rows that sit in
      // different sections — measured at 3 such merges on one preserved run, each one a row silently
      // dropped from the population. Without an identifier the section is part of what distinguishes
      // the row, so it is part of the key.
      const key = ids.length ? `${surface}::${ids[0]}` : `${surface}::${row.heading}::${row.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!row.expectedToArrive) { notExpected++; continue; }
      const frs = nameFragments(row.name);
      if (!ids.length && !frs.length) {
        unmeasurable.push({ surface, subject: row.name, section: row.heading, why: "the row carries no identifier and its subject cell names nothing testable" });
        continue;
      }
      subjects++;
      const byId = ids.length && present.some(({ t }) => ids.some((i) => t.includes(i)));
      const byName = frs.length && present.some(({ t }) => frs.some((f) => nameArrives(f, t)));
      if (!ids.length) nameOnly++;
      if (byId || byName) continue;
      lost.push({ surface, subject: row.name, identifier: ids[0] ?? null, section: row.heading,
        checkedBy: [ids.length ? "identifier" : null, frs.length ? "name" : null].filter(Boolean).join(" and ") });
    }
  }
  // A decomposition that does not reconcile to its total is three numbers, not a breakdown. `distinct`
  // is what the three buckets must sum to; `rawRows` says how many rows collapsed into it.
  return { computable: true, reason: null, surfaces, joinBasis, subjects, lost, unmeasurable, nameOnly, notExpected,
    distinct: seen.size, rawRows,
    missingArrivalArtifacts: texts.filter((x) => !x.t).map((x) => x.f) };
}

/**
 * acceptance 2 — the run's own "every right found is reported" claim, checked rather than read.
 * A coverage-ledger row marked `confirmed-clean` asserts its axis is fully reported. A lost subject
 * traced back to that axis contradicts it. The trace is the axis band file that names the URI.
 */
export function coverageConflicts(runDir, lost) {
  const ledger = readJson(join(runDir, "register-coverage-ledger.json"));
  if (!Array.isArray(ledger)) return { computable: false, reason: "register-coverage-ledger.json is absent or not a list", conflicts: [] };
  const unitsDir = join(runDir, "register-units");
  if (!existsSync(unitsDir)) return { computable: false, reason: "register-units/ is absent, so a lost record cannot be traced to an axis", conflicts: [] };
  const bands = readdirSync(unitsDir).filter((f) => f.endsWith("-band.json"))
    .map((f) => ({ axis: f.replace(/-band\.json$/, ""), text: readText(join(unitsDir, f)) }));
  const clean = new Map(ledger.filter((r) => r?.status === "confirmed-clean").map((r) => [r.axis, r]));
  const conflicts = [];
  for (const l of lost) {
    if (!l.identifier) continue;
    for (const b of bands) {
      if (!b.text.includes(l.identifier)) continue;
      const row = clean.get(b.axis);
      if (row) conflicts.push({ axis: b.axis, subject: l.subject, identifier: l.identifier, claim: "confirmed-clean" });
    }
  }
  return { computable: true, reason: null, conflicts };
}

/**
 * ONE renderer, used by `scripts/carry-through.mjs` and by `score.mjs`. Two call sites formatting the
 * same measure independently is how they come to disagree about what was measured.
 */
export function renderCarryThrough(runDir, { indent = "  " } = {}) {
  const r = carryThrough(runDir);
  const out = [];
  const p = (s = "") => out.push(s ? indent + s : "");
  p("carry-through — every subject this run's OWN findings carry, checked for arrival in");
  p(`  ${ARRIVAL_ARTIFACTS.join(", ")}. Built from the run's corpus, so it needs no reference and is`);
  p("  not the same measurement as `withheld` above, which is scoped to the reference.");
  p();
  if (!r.computable) { p(`NOT COMPUTABLE — ${r.reason}`); return { lines: out, result: r }; }
  if (r.missingArrivalArtifacts?.length)
    p(`absent arrival artifact(s): ${r.missingArrivalArtifacts.join(", ")} — arrival was tested against the rest`);
  for (const [s, b] of Object.entries(r.joinBasis)) p(`${s}: ${b}`);
  p(`subjects checked ${r.subjects} · reached none ${r.lost.length}`
    + `${r.notExpected ? ` · ${r.notExpected} in sections their own headings mark not-findings` : ""}`
    + `${r.unmeasurable.length ? ` · ${r.unmeasurable.length} unmeasurable` : ""}`);
  if (!r.lost.length && r.subjects) p("every subject reached at least one of them.");
  const bySurface = {};
  for (const l of r.lost) (bySurface[l.surface] ??= []).push(l);
  for (const [surface, rows] of Object.entries(bySurface)) {
    p();
    p(`REACHED NONE — ${surface} (${rows.length})`);
    for (const l of rows) p(`  · ${l.subject}${l.identifier ? `  ${l.identifier}` : ""}  [checked by ${l.checkedBy}]`);
  }
  for (const u of r.unmeasurable) p(`  ? ${u.subject} — ${u.why}`);

  const c = coverageConflicts(runDir, r.lost);
  p();
  if (!c.computable) {
    p(`the run's own coverage claim is NOT CHECKABLE here — ${c.reason}`);
  } else if (!c.conflicts.length) {
    p("the run's coverage ledger claims no axis is confirmed-clean while carrying a subject that reached nothing.");
  } else {
    const axes = [...new Set(c.conflicts.map((x) => x.axis))];
    p(`*** THE RUN'S OWN COVERAGE CLAIM IS CONTRADICTED (${c.conflicts.length}) — axis ${axes.join(", ")} is`);
    p(`    marked confirmed-clean, which asserts every right it found is reported:`);
    for (const x of c.conflicts) p(`    · ${x.axis}: ${x.subject}  ${x.identifier}`);
  }
  return { lines: out, result: r };
}
