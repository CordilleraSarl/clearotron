// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// REGISTER ANSWERS THE SIZE AND SHAPE OF A REAL RUN'S, WITH EVERY NAME INVENTED. The other scenarios read a register
// fixture of one or two filings with no goods text, so the code that lists, pages, shortens and prints a real filing
// list never ran in the snapshot: a list of a hundred filings, an owner with many of them, a goods statement of
// thousands of characters, a mark in another script. These are generated, never copied from a run, and the same seed
// writes the same bytes, so a snapshot compares like with like.
//
// THE SIZES ARE MEASURED, counts only, on the test instance's saved runs, 2026-11-19: 398 Knockout names over 189 runs,
// and 537 fetched record bodies.
//   - filings per name: median 0, p90 24, max 100;
//   - owners per name, where any: median 13, p90 36 to 67;
//   - classes per filing: median 3, p90 7, max 45;
//   - goods text per class: median 255 characters, p90 1,102, p99 3,640, and 43% past 300;
//   - marks in a script other than Latin: about 5%;
//   - of 839 listed filings: 40% registered, 20% abandoned, 18% cancelled, 12% expired, 3% under examination, so over
//     half are dead; 58% at the US office, 18% at the EU's, the rest national offices and WIPO; filed directly at a
//     national office 69% of the time, at a regional one 17%, and through Madrid 14%.
//
// A ROW IS THE REGISTER BAND'S OWN SHAPE (`record_id`, `mark_text`, `raw.classifications`), which is what a lister
// returns and what the band, the reading and the list read; goods text sits in `raw.classifications`, as a fetched
// record holds it.
// NO DRIVER IMPORT: the snapshot tool loads this in its own process, where the driver's configuration must not load.
// The file names come from the tree under test, handed in by the scenario process that runs it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The spread of filings across a batch of eight names: the measured median, p90 and maximum, and steps between. */
export const FILINGS_PER_NAME = Object.freeze([0, 2, 6, 13, 24, 36, 67, 100]);
/** Goods text per class, in characters, in the measured proportions: under half past 300, a tail into thousands. */
const GOODS_LENGTHS = Object.freeze([60, 120, 180, 230, 255, 280, 520, 1102, 1102, 3640]);
const CLASSES_PER_FILING = Object.freeze([1, 2, 3, 3, 3, 4, 5, 7, 12, 45]);

/** A small seeded generator (mulberry32): the same seed gives the same sequence on every machine. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const seedOf = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

const SYLLABLES = ["bra", "ven", "tor", "lis", "quel", "mar", "dov", "sen", "kai", "rup", "zel", "fon", "tir", "nal", "obe", "sk"];
const OWNER_FORMS = ["Ltd", "GmbH", "S.A.", "Inc.", "B.V.", "S.r.l.", "AB", "K.K.", "Oy", "LLC"];
const COUNTRIES = ["GB", "DE", "FR", "US", "NL", "IT", "SE", "JP", "FI", "CH", "CN", "GR", "BG"];
// Ten draws in the measured proportions.
const STAGES = Object.freeze(["registered", "registered", "registered", "registered", "abandoned", "abandoned", "cancelled", "cancelled", "expired", "examining"]);
const OFFICES = Object.freeze([["us", "national", "direct_national"], ["us", "national", "direct_national"], ["us", "national", "direct_national"],
  ["us", "national", "direct_national"], ["us", "national", "direct_national"], ["us", "national", "direct_national"],
  ["eu", "regional", "direct_regional"], ["eu", "regional", "direct_regional"], ["fr", "national", "madrid_designation"], ["wo", "international_registration", "madrid_ir"]]);
const LIVE = { registered: ["active", "live"], examining: ["pending", "live"] };
const GOODS_WORDS = ["software", "downloadable applications", "electronic games", "instruments for measuring", "apparatus for recording",
  "computer peripherals", "printed matter", "clothing", "footwear", "headgear", "retail services", "advertising",
  "education services", "entertainment", "providing online information", "design of computer programs", "cosmetics",
  "household utensils", "kitchen tools", "toys", "sporting articles", "beverages", "foodstuffs", "telecommunication services"];
// The share in another script is measured; the scripts are the ones the native-language lanes name.
const OTHER_SCRIPT = { Cyrillic: (s) => s.replace(/[a-z]/g, (c) => "абцдефгхийклмнопкрстувшхыз"[c.charCodeAt(0) - 97] ?? c),
  Greek: (s) => s.replace(/[a-z]/g, (c) => "αβψδεφγηιξκλμνοπκρστθωςχυζ"[c.charCodeAt(0) - 97] ?? c), Han: () => "维纳斯" };

const word = (r, n) => Array.from({ length: n }, () => pick(r, SYLLABLES)).join("");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function goodsText(r, length) {
  const parts = [];
  while (parts.join("; ").length < length) parts.push(pick(r, GOODS_WORDS));
  return parts.join("; ").slice(0, length);
}

/**
 * The filings a register would list for one term, invented at real size: `count` filings across `owners` owners.
 * PURE, and seeded by the term, so a name's list is the same on every run.
 */
export function realShapedFilings(term, { count = 0, owners = Math.max(1, Math.round(count * 0.5)) } = {}) {
  const r = seeded(seedOf(term));
  const people = Array.from({ length: Math.max(1, owners) }, () => `${cap(word(r, 2))} ${pick(r, OWNER_FORMS)}`);
  return Array.from({ length: count }, (_, i) => {
    const classes = [...new Set(Array.from({ length: pick(r, CLASSES_PER_FILING) }, () => 1 + Math.floor(r() * 45)))].sort((a, b) => a - b);
    const script = r() < 0.05 ? pick(r, Object.keys(OTHER_SCRIPT)) : null;
    const base = i % 3 === 0 ? String(term) : `${term}${i % 3 === 1 ? " " + word(r, 1).toUpperCase() : word(r, 1).toUpperCase()}`;
    const mark = script ? OTHER_SCRIPT[script](base.toLowerCase()) : base;
    const [office, scope, route] = pick(r, OFFICES);
    const stage = pick(r, STAGES);
    const [primary, statusClass] = LIVE[stage] ?? ["inactive", "dead"];
    const number = String(1000000 + Math.floor(r() * 8999999));
    const year = 1995 + Math.floor(r() * 30);
    const filed = `${year}-0${1 + (i % 9)}-1${i % 9}`, registered = stage === "examining" ? null : `${year + 1}-0${1 + (i % 9)}-2${i % 9}`;
    const id = `/mark/${office}/rs${seedOf(term).toString(16)}${i}`;
    const owner = people[i % people.length];
    const tier = i % 3 === 0 ? "identical" : i % 3 === 1 ? "related" : null;
    return {
      record_id: id, id, office, mark_text: mark, status: stage, status_class: statusClass, nice_classes: classes, classes,
      owner, owner_name: owner, owner_country: pick(r, COUNTRIES), filing_date: filed, application_date: filed, registration_date: registered,
      relevance_score: Math.floor(r() * 100), match: { tier, via: tier === "identical" ? ["identical"] : tier ? ["phonetic"] : [], terms: [String(term)] },
      raw: {
        id, object: "mark", grain: "mark", mark_text: mark, right_kind: "trademark",
        status: { primary, stage, reason: null, challenges: [], effective_date: registered ?? filed, basis: "register" },
        office_code: office, jurisdiction_code: office.toUpperCase(), scope_kind: scope, filing_route: route,
        office_url: `https://office.example.test/${office}/${number}`, application_number: number,
        registration_number: registered ? String(Number(number) + 7) : null, ir_number: office === "wo" ? String(900000 + i) : null,
        classifications: classes.map((c) => ({ nice_class: c, goods_services_text: goodsText(r, pick(r, GOODS_LENGTHS)),
          goods_services_text_truncated: false, goods_services_language: "en" })),
      },
    };
  });
}

/**
 * Writes the records fixture folder a run with `registerFixtures.records` reads: one file per question the lister is
 * asked, named by the tree under test's own `fixtureFileName`. Each question carries the filings of its name.
 * @param {string} dir
 * @param {{ term: string, question?: object, count: number }[]} asked
 * @param {(term: string, question: object) => string} fixtureFileName
 */
export function seedRealShapedRecords(dir, asked, fixtureFileName) {
  mkdirSync(dir, { recursive: true });
  for (const { term, question = {}, count } of asked) {
    const records = realShapedFilings(term, { count });
    writeFileSync(join(dir, fixtureFileName(term, question)), JSON.stringify({ records, total: records.length }) + "\n");
  }
}
