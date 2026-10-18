// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// record-goods.mjs — the goods and services text of each band record, read from the official records the run
// already holds. No register call: the register logs every record body it returns to the run's record ledger
// (`_driver/register-record-bodies.jsonl`), and the digest copies the ones it opens into `_records/`.
//
// WHY. A lawyer reading a crowded field reads the identical marks for the client's particular goods first
// (the crowded-field rule, the owner's ruling of 2026-09-21). The band row the placement step reads carries
// mark, classes, status and owner, and no goods, so that test could only be made by opening records one by
// one. The goods are on file: measured 2026-10-12 on two saved Clarivate runs, a body with goods for 1,423 of
// 1,423 band records and 5,220 of 5,220, logged before placement starts. A provider that logs only the
// records it fetched (Signa, Corsearch) has goods for those alone; every other record reads as unknown.
//
// UNKNOWN IS NOT A MISMATCH. A record with no goods on file passes a goods filter, the way a record that
// names no class passes the class scope (band-shape.mjs `inScope`): a filter must never hide a record for
// what the run simply does not hold.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { foldDiacritics } from "./form-neighbourhood.mjs";
import { parseVariantManifestModel } from "./variant-manifest-model.mjs";
import { canonicalJurisdictionCode } from "./jurisdiction-codes.mjs";

/**
 * The registers whose language is English (ruled 2026-10-12): there, a goods statement with no language tag
 * is read as English. Everywhere else an untagged statement is unknown to the goods test; Canada and Hong Kong,
 * with two languages each, are unknown too. The list is data, and grows with evidence.
 */
export const ENGLISH_REGISTERS = new Set(["US", "GB", "IE", "AU", "NZ", "SG", "IN", "ZA"]);
const registerOf = (uri) => canonicalJurisdictionCode(String(normalizeRecordUri(uri) ?? "").match(/^\/mark\/([a-z0-9]+)\//i)?.[1]?.toUpperCase() ?? "");
/** Is an untagged statement on this record read as English? Only on an English-language register. PURE. */
export const untaggedIsEnglish = (uri) => ENGLISH_REGISTERS.has(registerOf(uri));

/** A Nice class as the engine compares it: "09", 9 and " 9 " are all "9". Anything else is "". */
export const niceClass = (c) => {
  const n = Number.parseInt(String(c ?? "").trim(), 10);
  return Number.isInteger(n) && n >= 1 && n <= 45 ? String(n) : "";
};

const isEnglish = (lang) => /^en\b/i.test(String(lang ?? "").trim());
const textOf = (v) => (typeof v === "string" ? v
  : Array.isArray(v) ? v.map(textOf).filter(Boolean).join("; ")
  : v && typeof v === "object" ? textOf(v.text ?? v.terms ?? v.description ?? "") : "");

/**
 * The goods of one official record body: [{classes, text}], one entry per class statement, or [] when the body
 * carries none. PURE. Each provider's shape, as its own code writes it:
 *   · Clarivate: goodsServices[{classes, language, description, translation, translation_language}];
 *   · Signa: _raw.classifications[{nice_class, goods_services_text, goods_services_language}];
 *   · EUIPO and the free tier: goodsAndServices[{classNumber, description}], where description is a string or
 *     [{language, terms}];
 *   · USPTO local: goodsAndServices as one string, no class;
 *   · anything else carrying goodsAndServices: read generically, class where one is named.
 * English is preferred where a statement offers it; otherwise the statement's own text.
 */
export function recordGoods(body, { english = true } = {}) {
  const b = Array.isArray(body) ? body[0] : body;
  if (!b || typeof b !== "object") return [];
  const out = [];
  // `en: false` marks a statement with no English the engine can use: its words cannot be tested against the
  // client's English goods words, so it is unknown to the goods test, never a mismatch.
  const push = (classes, text, original = null, en = true) => {
    const t = String(text ?? "").trim(), o = String(original ?? "").trim();
    if (t) out.push({ classes: [...new Set((classes ?? []).map(niceClass).filter(Boolean))], text: t, ...(o && o !== t ? { alt: o } : {}), ...(en ? {} : { en: false }) });
  };
  const tagged = (lang) => String(lang ?? "").trim() !== "";
  if (Array.isArray(b.goodsServices)) {
    for (const g of b.goodsServices) {
      // English as written; untagged, English only on an English-language register; else the translation,
      // tagged English, or untagged on such a register; else the original, unread.
      if (isEnglish(g?.language)) push(g?.classes, textOf(g?.description), null, true);
      else if (!tagged(g?.language) && !g?.translation) push(g?.classes, textOf(g?.description), null, english);
      else if (g?.translation && (isEnglish(g?.translation_language) || (!tagged(g?.translation_language) && english))) push(g?.classes, textOf(g.translation), textOf(g?.description), true);
      else push(g?.classes, textOf(g?.description ?? g?.translation), null, false);
    }
  }
  if (out.length === 0 && Array.isArray(b?._raw?.classifications)) {
    for (const c of b._raw.classifications) push([c?.nice_class], c?.goods_services_text, null, isEnglish(c?.goods_services_language) || (!tagged(c?.goods_services_language) && english));
  }
  if (out.length === 0 && b.goodsAndServices != null) {
    const gs = b.goodsAndServices;
    if (typeof gs === "string") push([], gs, null, english);
    else if (Array.isArray(gs)) {
      for (const g of gs) {
        if (typeof g === "string") { push([], g, null, english); continue; }
        const d = g?.description;
        const en = Array.isArray(d) ? d.find((x) => isEnglish(x?.language)) : null;
        const chosen = Array.isArray(d) ? (en ?? d[0]) : d;
        push([g?.classNumber ?? g?.class ?? g?.niceClass ?? g?.nice_class], textOf(chosen ?? g?.text ?? g?.goods), null,
          Boolean(en) || (Array.isArray(d) ? !tagged(d[0]?.language) && english : english));
      }
    }
  }
  return out;
}

// THE RAW GOODS LIST SAYS NOTHING THE NORMALISED ONE DOES NOT. A Clarivate record holds its goods twice: as the
// register wrote them (`_raw.goodsServices.intClassDescriptions`) and as the provider maps them, item for item,
// into `goodsServices` beside it (providers/clarivate/src/core.js `normalizeGoodsServices`). On a crowded test
// run, 2026-10-13, the raw goods were 22.7 of the 53.5 MB of record text, and all 1,348 records held both
// lists. Only the five fields that mapping reads are known here: a raw item carrying any other field, classes
// written other than as numbers between commas (one statement may cover several classes: "9,35,42"), or any
// value the normalised item does not repeat exactly means the raw list says something of its own. The rest of
// the raw goods block (a national class list, on six of those records) is not the normalised list's to carry.
const RAW_GOODS_FIELDS = new Set(["intClassNumber", "intGoodsLanguageCode", "intGoodsServicesDescription",
  "cmComputerTranslationIntGoodsLanguageCode", "cmComputerTranslationIntGoodsServicesDescription"]);

/** Does the record's `goodsServices` carry its raw international goods list item for item, so that list adds nothing? PURE. */
export function rawGoodsCarried(body) {
  const items = body?._raw?.goodsServices?.intClassDescriptions, norm = body?.goodsServices;
  if (!Array.isArray(items) || !items.length || !Array.isArray(norm) || norm.length !== items.length) return false;
  return items.every((d, i) => {
    const n = norm[i];
    if (!d || typeof d !== "object" || Array.isArray(d) || !n || typeof n !== "object") return false;
    if (Object.keys(d).some((k) => !RAW_GOODS_FIELDS.has(k))) return false;
    const cls = String(d.intClassNumber ?? "").trim();
    if (cls !== "" && !/^\d+(\s*,\s*\d+)*$/.test(cls)) return false;
    const classes = cls === "" ? [] : cls.split(",").map((c) => Number(c.trim()));
    const same = (a, b) => (a ?? null) === (b ?? null);
    return Array.isArray(n.classes) && n.classes.length === classes.length && n.classes.every((c, j) => c === classes[j])
      && same(d.intGoodsLanguageCode, n.language) && same(d.intGoodsServicesDescription, n.description)
      && same(d.cmComputerTranslationIntGoodsLanguageCode, n.translation_language)
      && same(d.cmComputerTranslationIntGoodsServicesDescription, n.translation);
  });
}

/**
 * Every record's goods this run holds, by canonical record uri: Map(uri → [{classes, text}]). Read from the
 * record ledger, then from `_records/`, the later copy of a record winning, as `band_record` reads them. A
 * missing or unreadable file contributes nothing; the index is then simply smaller, never wrong.
 */
export function bandGoodsIndex(runDir) {
  const index = new Map();
  const take = (uri, body) => {
    const key = normalizeRecordUri(uri);
    if (!key) return;
    const goods = recordGoods(body, { english: untaggedIsEnglish(key) });
    if (goods.length) index.set(key, goods);
  };
  const ledger = driverDir(runDir, "register-record-bodies.jsonl");
  if (existsSync(ledger)) {
    let text = "";
    try { text = readFileSync(ledger, "utf8"); } catch { text = ""; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      take(row?.target, row?.body);
    }
  }
  const dir = join(runDir, "_records");
  if (existsSync(dir)) {
    let names = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith(".json")); } catch { names = []; }
    for (const n of names) {
      try { const body = JSON.parse(readFileSync(join(dir, n), "utf8")); take(body?._uri ?? body?.uri, body); } catch { /* unreadable: skip */ }
    }
  }
  return index;
}

/** The goods of one band row from an index, or null when the run holds none for it. PURE. */
export const goodsFor = (index, record) => index?.get(normalizeRecordUri(record?.record_id)) ?? null;

/**
 * The goods a band row holds itself, where the register's search answer carries them: Signa sends each record's
 * class statements on the search row (`raw.classifications`), up to 280 characters, and flags a statement it cut.
 * Each statement is read as a held body's is (`recordGoods`) and marked `cut: true` where the register cut it, so a
 * statement that stops early is never read as the whole of its class. null when the row holds none. PURE.
 */
export function rowGoods(row) {
  const classes = Array.isArray(row?.raw?.classifications) ? row.raw.classifications : null;
  if (!classes) return null;
  const english = untaggedIsEnglish(normalizeRecordUri(row?.record_id));
  const out = [];
  for (const c of classes) {
    const [g] = recordGoods({ _raw: { classifications: [c] } }, { english });
    if (g) out.push(c?.goods_services_text_truncated === true ? { ...g, cut: true } : g);
  }
  return out.length ? out : null;
}

/**
 * Was a statement of these goods cut short by the register? A record whose statements match no word, while one of
 * them stops where the register cut it, is unknown to the goods test, not a mismatch: the words cut off may be the
 * client's. Only goods read off a band row carry the mark (`rowGoods`); a held body's statements are whole. PURE.
 */
export const statementCut = (goods) => (goods ?? []).some((g) => g?.cut === true);

/** How many records rest on each kind of goods evidence: a held body, a row's whole statements, a row's statements cut short, or none. PURE. */
export function goodsEvidence(records, goods) {
  const out = { held: 0, complete: 0, cut: 0, none: 0 };
  for (const r of Array.isArray(records) ? records : []) {
    if (goods?.held?.(r)) { out.held++; continue; }
    const g = goods ? goods.of(r) : null;
    if (!g) out.none++; else if (statementCut(g)) out.cut++; else out.complete++;
  }
  return out;
}

const fold = (s) => foldDiacritics(String(s ?? "")).toLowerCase();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The forms of one goods word: as given, its singular where it is given as a plural, and the plural of each,
 * with the endings s, es and ies. Every form is a whole word, so "car" is never "cards". A word that ends in
 * s without being a plural ("apparatus", "status", "glass") keeps its own spelling. PURE.
 */
export function goodsWordForms(word) {
  const w = fold(word).trim();
  const singulars = new Set([w]);
  if (/\p{L}{2,}ies$/u.test(w)) singulars.add(`${w.slice(0, -3)}y`);
  if (/(?:s|x|z|ch|sh|o)es$/u.test(w)) singulars.add(w.slice(0, -2));             // boxes, tomatoes
  if (/\p{L}{2,}ves$/u.test(w)) { singulars.add(`${w.slice(0, -3)}f`); singulars.add(`${w.slice(0, -3)}fe`); }   // shelves, knives
  if (/\p{L}{2,}[^sui]s$/u.test(w)) singulars.add(w.slice(0, -1));
  const forms = new Set(singulars);
  for (const f of singulars) {
    forms.add(/(?:s|x|z|ch|sh)$/u.test(f) ? `${f}es` : `${f}s`);
    if (/[^aeiou]o$/u.test(f)) forms.add(`${f}es`);
    if (/[^aeiou]y$/u.test(f)) forms.add(`${f.slice(0, -1)}ies`);
    if (/\p{L}fe?$/u.test(f)) forms.add(`${f.replace(/fe?$/u, "")}ves`);
  }
  return [...forms].sort((x, y) => y.length - x.length);
}

/**
 * A counter for a list of goods words: how many of the words or phrases appear whole in the goods, or null
 * when the record has no goods on file, or when there are no words to look for. Case and diacritics are
 * folded, and the original wording is read beside its English translation. With `stems`, each word of a
 * word or phrase matches its singular and plural forms (`goodsWordForms`), at word boundaries, never as the
 * start of a longer word. PURE.
 */
export function goodsWordCounter(words, { stems = false } = {}) {
  // A phrase's words are separated by spaces or hyphens alike: "mobile phone" is "mobile-phone".
  const phrase = (w) => w.split(/[\s-]+/).filter(Boolean).map((x) => (stems ? `(?:${goodsWordForms(x).map(escape).join("|")})` : escape(x))).join("[\\s-]+");
  const res = (Array.isArray(words) ? words : [words])
    .map((w) => fold(w).trim()).filter(Boolean)
    .map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${phrase(w)}($|[^\\p{L}\\p{N}])`, "u"));
  return (goods) => {
    const readable = (goods ?? []).filter((g) => g.en !== false);
    if (!res.length || !readable.length) return null;
    const text = fold(readable.map((g) => (g.alt ? `${g.text}\n${g.alt}` : g.text)).join("\n"));
    const n = res.filter((re) => re.test(text)).length;
    return n === 0 && (classUnread(goods) || statementCut(goods)) ? null : n;
  };
}

/**
 * Does a class of these goods have no statement the engine can read? A record whose readable statements match
 * no word, while one of its classes is written only in a language the engine cannot use, is unknown to the
 * goods test, not a mismatch. A class with an English statement beside its other languages is read. PURE.
 */
export function classUnread(goods) {
  const read = new Set(), unread = new Set();
  let readNone = false, unreadNone = false;
  for (const g of goods ?? []) {
    const cls = Array.isArray(g?.classes) ? g.classes : [];
    if (g?.en === false) { if (cls.length) for (const c of cls) unread.add(c); else unreadNone = true; }
    else if (cls.length) for (const c of cls) read.add(c);
    else readNone = true;
  }
  return [...unread].some((c) => !read.has(c)) || (unreadNone && !readNone);
}

/**
 * Which of the client's goods words a record's goods hold, as the words themselves, in the list's order;
 * null when the record has no goods on file or there are no words. A shape line shows them as "k of N:
 * the words", which is the goods ground made visible on the line. PURE.
 */
export function goodsWordsMatched(words, { stems = false } = {}) {
  const list = (Array.isArray(words) ? words : [words]).map((w) => String(w ?? "").trim()).filter(Boolean);
  const tests = list.map((w) => [w, goodsWordCounter([w], { stems })]);
  return (goods) => {
    if (!list.length || !(goods ?? []).some((g) => g.en !== false)) return null;
    const hit = tests.filter(([, t]) => t(goods) === 1).map(([w]) => w);
    return hit.length === 0 && (classUnread(goods) || statementCut(goods)) ? null : hit;
  };
}

/** The same test as true or false: any word present, none present, or null when it cannot be told. PURE. */
export function goodsWordMatcher(words) {
  const count = goodsWordCounter(words);
  return (goods) => { const n = count(goods); return n == null ? null : n > 0; };
}

/**
 * The order as the band shape reads it: the job, with the goods wording, territories and geography taken
 * from the run's own instructed scope, written from the order at intake before any model reads it. A
 * stage replayed from a job rebuilt out of the run's status carries none of those three, so reading them
 * from the job alone would sort a replay's shape differently from the run's. IMPURE (reads the run).
 */
export function instructedOrder(P, job = null) {
  let scope = null;
  try { scope = JSON.parse(readFileSync(P.instructedScope, "utf8")); } catch { scope = null; }
  const order = { ...(job ?? {}) };
  for (const k of ["goods", "jurisdictions", "geography"]) if (scope?.[k] != null) order[k] = scope[k];
  return order;
}

/**
 * What the band shape needs to sort the band by the client's goods: the goods reader over this run's own
 * records; the goods test, which is the client's product words when the variants stage names them and the
 * goods words otherwise, matched as stems and saying which it is; and the word the register's goods-narrowed
 * search asked for beside the one the variants stage named. The client's markets come from the caller:
 * this module is loaded by the band tool server, which reads no account settings. IMPURE (reads the run).
 * Any part that cannot be read is simply absent, and the shape sorts without it.
 *
 * A record's goods are its held body's, and where the run holds no body, the statements its band row carries
 * (`rowGoods`). `held` says which: a line's goods are "on file" only where a body is held, because that is the
 * record `band_record` can open. `records` are the band's, so the shape tests goods whenever either is held.
 */
export function bandShapeGoods(P, records = []) {
  let model = null;
  try { if (existsSync(P.variantManifestModel)) model = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8")); } catch { model = null; }
  let searched = "";
  try {
    const plan = JSON.parse(readFileSync(P.registerPlan, "utf8"));
    searched = String((plan?.entries ?? []).find((e) => /\+goods($|-)/.test(String(e?.qid ?? "")))?.term ?? "");
  } catch { searched = ""; }
  const manifestDominant = String(model?.dominant_element ?? "");
  const index = bandGoodsIndex(P.runDir);
  // The particular goods when the variants stage names them, as stems, else the goods words (ruled 2026-10-12).
  const product = Array.isArray(model?.product_words) && model.product_words.length;
  const words = product ? model.product_words : Array.isArray(model?.goods_words) ? model.goods_words : [];
  const stems = true;   // the word list the shape groups on is matched as stems, whichever source it came from
  const hits = goodsWordCounter(words, { stems });
  const held = (r) => goodsFor(index, r);
  const rowsHold = Array.isArray(records) && records.some((r) => r && typeof r === "object" && rowGoods(r));
  const goods = index.size || rowsHold ? { of: (r) => held(r) ?? rowGoods(r), held: (r) => held(r) != null, hits, matched: goodsWordsMatched(words, { stems }) } : null;
  const goodsTest = { source: product ? "product_words" : words.length ? "goods_words" : "none", words };
  return { goods, goodsTest, goodsWordCount: words.length, dominantTerm: searched || manifestDominant, manifestDominant };
}
