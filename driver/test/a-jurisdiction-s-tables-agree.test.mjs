// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A JURISDICTION'S TABLES AGREE, OR THE PLACES THEY DO NOT ARE NAMED HERE.
//
// A jurisdiction is a row in several hand-written tables: its code and spellings, its name, its registration
// system, the regional registers that bind it, the scripts its register holds, its native-language lane.
// They live together in shared/jurisdiction-tables.mjs, and this file reads them side by side. Each check
// below asks one question every jurisdiction should answer the same way in every table.
//
// WHERE THE TABLES DIFFER TODAY, THE DIFFERENCE IS LISTED, NOT FIXED. Closing one changes what a run asks a
// register, what the model is told, or what a reader is shown, so each is a decision of its own. The list
// can only shrink: a new difference fails this file, and so does a listed one that has gone, so whoever
// closes one takes it off the list in the same change.
//
// Read where they are, not moved: the transliteration manual the model reads, for the scripts it covers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as TABLES from "../../shared/jurisdiction-tables.mjs";
import { normalizeTerritory } from "../../providers/_shared/territory-codes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANUAL = "driver/skills/clearance-variants/transliteration-scripts.md";

const keys = (o) => Object.keys(o);

/** Every code each table names, by table. */
function codesByTable(T) {
  return {
    JURISDICTION_CODE_FOLD: [...keys(T.JURISDICTION_CODE_FOLD), ...Object.values(T.JURISDICTION_CODE_FOLD)],
    REGION_NAMES: keys(T.REGION_NAMES).filter((c) => c !== T.COMMON_LAW),
    REGION_ALIAS: [...keys(T.REGION_ALIAS), ...Object.values(T.REGION_ALIAS)],
    TERRITORY_TO_CODE: Object.values(T.TERRITORY_TO_CODE).filter(Boolean),
    FIRST_TO_USE: T.FIRST_TO_USE,
    FIRST_TO_REGISTER: T.FIRST_TO_REGISTER,
    BENELUX_MEMBERS: T.BENELUX_MEMBERS,
    EU_MEMBERS: T.EU_MEMBERS,
    OFFICES: [T.EU_OFFICE, T.WO_OFFICE, T.BX_OFFICE],
    REGION_CODES: [...T.REGION_CODES],
    KNOWN_NON_COUNTRY_CODES: [...T.KNOWN_NON_COUNTRY_CODES],
    REGISTRABLE_SCRIPTS: keys(T.REGISTRABLE_SCRIPTS),
    ALSO_REGISTERED_IN: keys(T.ALSO_REGISTERED_IN),
    SCRIPTS_ASKED_IN: keys(T.SCRIPTS_ASKED_IN),
    JURISDICTION_ADAPTERS: keys(T.JURISDICTION_ADAPTERS),
  };
}

/** Every difference between the tables, one line each: "<check>: <what>". `T` is the tables, or a planted copy. */
export function differences(T = TABLES) {
  const canon = (code) => T.JURISDICTION_CODE_FOLD[code] ?? code;   // the engine's spelling
  const asNamed = (code) => T.REGION_ALIAS[code] ?? code;   // the report's spelling
  const found = [];
  const known = T.KNOWN_JURISDICTION_CODES;
  const byTable = codesByTable(T);

  // 1. A code any table names is one the engine knows, in some spelling it folds.
  for (const [table, codes] of Object.entries(byTable)) {
    for (const code of new Set(codes)) if (!known.has(canon(code))) found.push(`unknown code: ${code} in ${table}`);
  }

  // 2. The engine's fold and the report's aliases join the same spellings, whichever way each points.
  for (const [from, to] of Object.entries(T.REGION_ALIAS)) {
    if (canon(from) !== canon(to)) found.push(`spellings joined only for the report: ${from} and ${to}`);
  }
  for (const [from, to] of Object.entries(T.JURISDICTION_CODE_FOLD)) {
    if (asNamed(from) !== asNamed(to)) found.push(`spellings joined only for the engine: ${from} and ${to}`);
  }

  // 3. A regional register has a name of its own, not a country's from the runtime's region data.
  for (const code of T.REGION_CODES) {
    if (!Object.hasOwn(T.REGION_NAMES, asNamed(code))) found.push(`region with no name of its own: ${code}`);
  }

  // 4. A jurisdiction a table treats as a place has a registration system.
  const system = new Set([...T.FIRST_TO_USE, ...T.FIRST_TO_REGISTER].map(canon));
  const regions = new Set([...T.REGION_CODES, T.WO_OFFICE].map(canon));
  const places = new Map();
  const place = (code, where) => {
    const c = canon(code);
    if (!known.has(c) || regions.has(c) || T.KNOWN_NON_COUNTRY_CODES.has(c) || /^X/.test(c)) return;
    places.set(c, [...(places.get(c) ?? []), where]);
  };
  for (const c of keys(T.REGION_NAMES)) if (c !== T.COMMON_LAW) place(c, "REGION_NAMES");
  for (const c of T.EU_MEMBERS) place(c, "EU_MEMBERS");
  for (const c of keys(T.REGISTRABLE_SCRIPTS)) place(c, "REGISTRABLE_SCRIPTS");
  for (const c of keys(T.JURISDICTION_ADAPTERS)) place(c, "JURISDICTION_ADAPTERS");
  for (const label of T.LABELS_OFFERED_BEFORE_THE_RULE) { const c = normalizeTerritory(label); if (c) place(c, "LABELS_OFFERED_BEFORE_THE_RULE"); }
  for (const [c, where] of [...places].sort(([a], [b]) => a.localeCompare(b))) {
    if (!system.has(c)) found.push(`no registration system: ${c} (${[...new Set(where)].join(", ")})`);
  }

  // 5. A Benelux member is named and typed like the other places the form offers.
  for (const c of T.BENELUX_MEMBERS) {
    if (!T.EU_MEMBERS.includes(c)) found.push(`Benelux member outside the EU list: ${c}`);
    if (!Object.hasOwn(T.REGION_NAMES, asNamed(c))) found.push(`Benelux member with no curated name: ${c}`);
    if (!Object.values(T.TERRITORY_TO_CODE).includes(c)) found.push(`Benelux member no typed name reaches: ${c}`);
  }

  // 6. A jurisdiction with a native-language lane has a row of scripts its register holds.
  for (const c of keys(T.JURISDICTION_ADAPTERS)) {
    if (!(T.REGISTRABLE_SCRIPTS[c] ?? []).some((s) => s !== "latin")) found.push(`lane with no script row: ${c}`);
  }

  // 7. A script the tables ask for has a section in the transliteration manual the model reads.
  const manual = readFileSync(join(ROOT, MANUAL), "utf8");
  const headings = [...manual.matchAll(/^###\s+(.+)$/gm)].map(([, h]) => h.toLowerCase());
  const scripts = new Set([T.REGISTRABLE_SCRIPTS, T.ALSO_REGISTERED_IN, T.SCRIPTS_ASKED_IN].flatMap((t) => Object.values(t).flat()));
  for (const s of [...scripts].sort()) {
    if (s !== "latin" && !headings.some((h) => h.includes(s))) found.push(`script with no section in the manual: ${s}`);
  }

  return found.sort();
}

// THE PLACES THE TABLES DIFFER TODAY (2026-11-20). Each line is a decision for whoever owns what it would change.
const STANDING = [
  "Benelux member with no curated name: LU",
  "no registration system: AE (REGION_NAMES, REGISTRABLE_SCRIPTS, LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: AR (LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: BG (EU_MEMBERS, REGISTRABLE_SCRIPTS, LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: BH (REGISTRABLE_SCRIPTS)",
  "no registration system: BY (REGISTRABLE_SCRIPTS)",
  "no registration system: CL (REGION_NAMES)",
  "no registration system: CY (EU_MEMBERS, REGISTRABLE_SCRIPTS)",
  "no registration system: EE (EU_MEMBERS)",
  "no registration system: EG (REGISTRABLE_SCRIPTS)",
  "no registration system: GR (REGION_NAMES, EU_MEMBERS, REGISTRABLE_SCRIPTS, LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: HK (REGION_NAMES, REGISTRABLE_SCRIPTS, JURISDICTION_ADAPTERS, LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: HR (EU_MEMBERS)",
  "no registration system: HU (EU_MEMBERS)",
  "no registration system: ID (REGION_NAMES)",
  "no registration system: IL (REGION_NAMES, REGISTRABLE_SCRIPTS)",
  "no registration system: IR (REGISTRABLE_SCRIPTS)",
  "no registration system: JO (REGISTRABLE_SCRIPTS)",
  "no registration system: KW (REGISTRABLE_SCRIPTS)",
  "no registration system: KZ (REGISTRABLE_SCRIPTS)",
  "no registration system: LT (EU_MEMBERS)",
  "no registration system: LU (EU_MEMBERS)",
  "no registration system: LV (EU_MEMBERS)",
  "no registration system: MO (REGISTRABLE_SCRIPTS, JURISDICTION_ADAPTERS, LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: MT (EU_MEMBERS)",
  "no registration system: OM (REGISTRABLE_SCRIPTS)",
  "no registration system: PK (REGISTRABLE_SCRIPTS)",
  "no registration system: QA (REGISTRABLE_SCRIPTS)",
  "no registration system: RO (EU_MEMBERS)",
  "no registration system: RS (REGISTRABLE_SCRIPTS)",
  "no registration system: SA (REGION_NAMES, REGISTRABLE_SCRIPTS, LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: SG (REGION_NAMES, REGISTRABLE_SCRIPTS, LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: SI (EU_MEMBERS)",
  "no registration system: SK (EU_MEMBERS)",
  "no registration system: TH (REGISTRABLE_SCRIPTS, LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: TK (REGION_NAMES)",
  "no registration system: TW (REGION_NAMES, REGISTRABLE_SCRIPTS, JURISDICTION_ADAPTERS, LABELS_OFFERED_BEFORE_THE_RULE)",
  "no registration system: UA (REGISTRABLE_SCRIPTS)",
  "no registration system: ZA (REGION_NAMES, LABELS_OFFERED_BEFORE_THE_RULE)",
  "region with no name of its own: EA",
  "region with no name of its own: IB",
  "script with no section in the manual: hebrew",
  "spellings joined only for the report: INT and WO",
  "unknown code: INT in REGION_ALIAS",
];

test("the tables differ only where the standing list says, and every listed difference is still there", () => {
  const found = differences();
  assert.deepEqual(found.filter((d) => !STANDING.includes(d)), [], "a new difference between the tables");
  assert.deepEqual(STANDING.filter((d) => !found.includes(d)), [], "a listed difference has gone: take it off the list");
});

test("a jurisdiction added to one table and not the others is a new difference", () => {
  // Peru, named for the report and given no registration system.
  const planted = { ...TABLES, REGION_NAMES: { ...TABLES.REGION_NAMES, PE: "Peru" } };
  assert.deepEqual(differences(planted).filter((d) => !STANDING.includes(d)), ["no registration system: PE (REGION_NAMES)"]);
});

test("a difference closed in the tables leaves the standing list behind it, which fails until the line goes", () => {
  const { INT, ...aliases } = TABLES.REGION_ALIAS;
  assert.equal(INT, "WO", "premise: the report folds INT into WO");
  const closed = differences({ ...TABLES, REGION_ALIAS: aliases });
  assert.deepEqual(STANDING.filter((d) => !closed.includes(d)),
    ["spellings joined only for the report: INT and WO", "unknown code: INT in REGION_ALIAS"]);
});
