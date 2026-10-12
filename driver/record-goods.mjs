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
export function recordGoods(body) {
  const b = Array.isArray(body) ? body[0] : body;
  if (!b || typeof b !== "object") return [];
  const out = [];
  const push = (classes, text, original = null) => {
    const t = String(text ?? "").trim(), o = String(original ?? "").trim();
    if (t) out.push({ classes: [...new Set((classes ?? []).map(niceClass).filter(Boolean))], text: t, ...(o && o !== t ? { alt: o } : {}) });
  };
  if (Array.isArray(b.goodsServices)) {
    for (const g of b.goodsServices) {
      const english = isEnglish(g?.language) ? g?.description
        : isEnglish(g?.translation_language) && g?.translation ? g.translation : g?.description ?? g?.translation;
      push(g?.classes, textOf(english), textOf(g?.description));
    }
  }
  if (out.length === 0 && Array.isArray(b?._raw?.classifications)) {
    for (const c of b._raw.classifications) push([c?.nice_class], c?.goods_services_text);
  }
  if (out.length === 0 && b.goodsAndServices != null) {
    const gs = b.goodsAndServices;
    if (typeof gs === "string") push([], gs);
    else if (Array.isArray(gs)) {
      for (const g of gs) {
        if (typeof g === "string") { push([], g); continue; }
        const d = g?.description;
        const english = Array.isArray(d) ? (d.find((x) => isEnglish(x?.language)) ?? d[0]) : d;
        push([g?.classNumber ?? g?.class ?? g?.niceClass ?? g?.nice_class], textOf(english ?? g?.text ?? g?.goods));
      }
    }
  }
  return out;
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
    const goods = recordGoods(body);
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

const fold = (s) => foldDiacritics(String(s ?? "")).toLowerCase();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A counter for a list of goods words: how many of the words or phrases appear whole in the goods, or null
 * when the record has no goods on file, or when there are no words to look for. Case and diacritics are
 * folded, and the original wording is read beside its English translation. With `stems`, a word matches
 * its forms: its last word may run on (a product word is given as a stem, ruled 2026-10-13). PURE.
 */
export function goodsWordCounter(words, { stems = false } = {}) {
  const res = (Array.isArray(words) ? words : [words])
    .map((w) => fold(w).trim()).filter(Boolean)
    // A stem is the word without its plural ending, so "video games" and "video game" match each other.
    .map((w) => (stems ? w.replace(/(\p{L}{3,})s$/u, "$1") : w))
    .map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w).replace(/\s+/g, "\\s+")}${stems ? "[\\p{L}\\p{N}]*" : ""}($|[^\\p{L}\\p{N}])`, "u"));
  return (goods) => {
    if (!res.length || !goods || !goods.length) return null;
    const text = fold(goods.map((g) => (g.alt ? `${g.text}\n${g.alt}` : g.text)).join("\n"));
    return res.filter((re) => re.test(text)).length;
  };
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
    if (!list.length || !goods || !goods.length) return null;
    return tests.filter(([, t]) => t(goods) === 1).map(([w]) => w);
  };
}

/** The same test as true or false: any word present, none present, or null when it cannot be told. PURE. */
export function goodsWordMatcher(words) {
  const count = goodsWordCounter(words);
  return (goods) => { const n = count(goods); return n == null ? null : n > 0; };
}

/**
 * The goods a reader is shown for one record: the statements in the in-scope classes first (all of them
 * when no scope is set or the statement names no class), then the rest, cut at `maxChars`. Returns
 * { text, chars, cut } or null when the run holds no goods. `chars` is the full length before the cut;
 * `cut` says the part a goods ground is read from did not fit, so the record must be opened for one: the
 * in-scope statements, or every statement when the record has none in scope. PURE.
 */
export function goodsExcerpt(goods, { inScopeClasses = [], maxChars = 400 } = {}) {
  if (!goods || !goods.length) return null;
  const scope = new Set((inScopeClasses ?? []).map(niceClass).filter(Boolean));
  const inScope = (g) => scope.size === 0 || g.classes.length === 0 || g.classes.some((c) => scope.has(c));
  const line = (g) => (g.classes.length ? `[${g.classes.join(",")}] ${g.text}` : g.text);
  const inScopePart = goods.filter(inScope).map(line).join(" | ");
  const full = [...goods.filter(inScope), ...goods.filter((g) => !inScope(g))].map(line).join(" | ");
  return { text: full.length > maxChars ? full.slice(0, maxChars) : full, chars: full.length,
    cut: (inScopePart || full).length > maxChars };
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

// How much of a record's goods a row `band_lookup` serves. A shape line carries the words matched, not the text.
export const GOODS_ROW_CHARS = 1500;

/**
 * What the band shape needs to sort the band by the client's goods: the goods reader over this run's own
 * records, the client's goods words from the variants stage, and
 * the word the register's goods-narrowed search asked for beside the one the variants stage named. The
 * client's markets come from the caller: this module is loaded by the band tool server, which reads no
 * account settings. IMPURE (reads the run). Any part that cannot be read is simply absent, and the shape
 * sorts without it.
 */
export function bandShapeGoods(P, inScopeClasses = [], { rowChars = GOODS_ROW_CHARS } = {}) {
  let model = null;
  try { if (existsSync(P.variantManifestModel)) model = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8")); } catch { model = null; }
  let searched = "";
  try {
    const plan = JSON.parse(readFileSync(P.registerPlan, "utf8"));
    searched = String((plan?.entries ?? []).find((e) => /\+goods($|-)/.test(String(e?.qid ?? "")))?.term ?? "");
  } catch { searched = ""; }
  const manifestDominant = String(model?.dominant_element ?? "");
  const index = bandGoodsIndex(P.runDir);
  // The particular goods when the variants stage names them, as stems, else the goods words (ruled 2026-10-13).
  const product = Array.isArray(model?.product_words) && model.product_words.length;
  const words = product ? model.product_words : Array.isArray(model?.goods_words) ? model.goods_words : [];
  const stems = true;   // the word list the shape groups on is matched as stems, whichever source it came from
  const hits = goodsWordCounter(words, { stems });
  const goods = index.size ? {
    of: (r) => goodsFor(index, r),
    hits,
    matched: goodsWordsMatched(words, { stems }),
    rowCut: (g) => Boolean(goodsExcerpt(g, { inScopeClasses, maxChars: rowChars })?.cut),
  } : null;
  return { goods, goodsWordCount: words.length, dominantTerm: searched || manifestDominant, manifestDominant };
}
