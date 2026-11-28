// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stated-facts.mjs — WHAT THE ORDER STATES, IN ITS OWN WORDS, KEPT WITH ITS SOURCE.
//
// The matter frame restates the request, and a restatement can drop a fact the request gave: a request form named
// its product and four sales channels, the order's goods field was empty, and the frame said the brief gave no goods
// specification. Every later stage read that frame. The facts a request states plainly are now read by code, once,
// before any model runs, and kept in the run as `_driver/stated-facts.json`, each with where it was found: the record
// a later stage can be given its facts from, and the evidence of what was asked whatever any frame says.
//
// What is read, and only this:
//   - the order's own fields: `goods` (or its older spelling `use`), and `priorUse`;
//   - in the verbatim request, a label from a fixed set, in English, German, French or Italian, for a description of
//     the product, the goods or services, the use, and the sales channels: a line `Label: value`, a table row rendered
//     `Label | value`, a label whose value follows as a list, or a form flattened onto one line, where a capitalised
//     `Label:` opens each field and the value runs to the next one.
// Nothing is inferred and nothing is judged: no word overlap, no model, no gate. A fact stated more than once,
// differently, is kept every time, each with its source, and listed as having multiple stated values: different
// descriptions may all be true. Where a label sits in a quoted older email, its source says where the text was found,
// not that it governs this order. A request with no labelled fact and an order with no such field record nothing.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { goodsOf } from "./queue-markers.mjs";

/** The facts read, in the order the frame shows them. */
export const STATED_FIELDS = Object.freeze(["description", "goods", "use", "channels"]);

// Labels as a request form writes them, lower-cased, without the colon. A label must be the whole label: "Products"
// is goods, "Product" is the description. Words a signature or disclaimer also uses alone (`Distribution`) are not
// labels here.
const LABELS = Object.freeze({
  description: ["description", "product", "product description", "description of the product", "description of goods",
    "beschreibung", "produkt", "produktbeschreibung", "description du produit", "produit", "descrizione", "prodotto",
    "descrizione del prodotto"],
  goods: ["goods", "goods and services", "goods/services", "goods & services", "services", "products", "products and services",
    "waren", "dienstleistungen", "waren und dienstleistungen", "waren/dienstleistungen", "produkte",
    "produits", "produits et services", "produits/services", "prodotti", "servizi", "prodotti e servizi", "prodotti/servizi"],
  use: ["use", "intended use", "manner of use", "use of the mark", "prior use", "planned use", "verwendung", "nutzung", "geplante verwendung",
    "verwendungszweck", "utilisation", "usage", "utilisation prévue", "usage prévu", "uso", "uso previsto", "utilizzo"],
  channels: ["channels", "sales channels", "distribution channels", "channels of trade", "trade channels", "vertriebskanäle",
    "vertriebswege", "verkaufskanäle", "canaux", "canaux de distribution", "canaux de vente", "canali", "canali di vendita",
    "canali di distribuzione"],
});
const FIELD_OF = new Map(Object.entries(LABELS).flatMap(([field, labels]) => labels.map((l) => [l, field])));

// A label opening a line: an optional list mark or bold, the label, then a colon or a table cell's " | ", then the value.
const LABEL_LINE = /^\s*(?:[-*•]\s+)?(?:\*\*|__)?([^:|*_\n]{2,48}?)(?:\*\*|__)?\s*(?::|：|\s\|)\s*(?:\*\*|__)?\s*(.*)$/;
// A label inside a line, as a form flattened onto one line writes it: capitalised words, then a colon and a space.
const INLINE_LABEL = /(?<=^|[\s|•·;,(])(?:\*\*)?(\p{Lu}[\p{L}/&' -]{1,46}?)(?:\*\*)?\s*[:：](?=\s)/gu;
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/;

const clean = (v) => String(v ?? "").replace(/\s*[|·;,]\s*$/, "").replace(/\s+/g, " ").trim();
const fieldOf = (label) => FIELD_OF.get(clean(label).toLowerCase().replace(/\s*\(s\)$/, "")) ?? null;

/** Every labelled fact in the verbatim request, with its label as written and its line. PURE. */
export function requestFormFacts(rawRequest) {
  const lines = String(rawRequest ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  const push = (field, label, value, i) => { if (value) out.push({ field, value, source: `request: the “${clean(label)}” line (line ${i + 1})` }); };
  for (let i = 0; i < lines.length; i++) {
    const m = LABEL_LINE.exec(lines[i]);
    const field = m ? fieldOf(m[1]) : null;
    if (field) {
      let value = clean(m[2]);
      // A label whose value follows as a list: the items up to the first line that is not one.
      if (!value) {
        const items = [];
        for (let j = i + 1; j < lines.length && LIST_ITEM.test(lines[j]); j++) items.push(clean(LIST_ITEM.exec(lines[j])[1]));
        value = items.filter(Boolean).join("; ");
      }
      // A line that opens with a label and carries more of them is a flattened form: read below, field by field.
      if ([...lines[i].matchAll(INLINE_LABEL)].length < 2) { push(field, m[1], value, i); continue; }
    }
    // A form flattened onto one line: each capitalised label opens a field, and its value runs to the next label.
    const labels = [...lines[i].matchAll(INLINE_LABEL)];
    if (labels.length < 2) continue;
    labels.forEach((x, k) => {
      const f = fieldOf(x[1]);
      if (!f) return;
      const end = labels[k + 1]?.index ?? lines[i].length;
      push(f, x[1], clean(lines[i].slice(x.index + x[0].length, end)), i);
    });
  }
  return out;
}

/**
 * What an order states, from its own fields and its verbatim request: `{ facts: [{ field, value, source }],
 * multiple: [field] }`, or null when it states none. `multiple` names each field stated more than once, differently. A
 * repeated identical fact is kept once. PURE.
 */
export function statedFactsOf(job) {
  const facts = [];
  const goods = goodsOf(job);
  if (goods != null && clean(goods)) facts.push({ field: "goods", value: String(goods).trim(), source: "order: the goods field" });
  if (job?.priorUse != null && clean(job.priorUse)) facts.push({ field: "use", value: String(job.priorUse).trim(), source: "order: the prior or intended use field" });
  facts.push(...requestFormFacts(job?.rawRequest));
  const seen = new Set();
  const kept = facts.filter((f) => { const k = `${f.field}\u0000${clean(f.value).toLowerCase()}`; return seen.has(k) ? false : (seen.add(k), true); });
  if (!kept.length) return null;
  kept.sort((a, b) => STATED_FIELDS.indexOf(a.field) - STATED_FIELDS.indexOf(b.field));
  const multiple = STATED_FIELDS.filter((f) => kept.filter((x) => x.field === f).length > 1);
  return { facts: kept, multiple };
}

// ── WHERE THE FACTS REACH THE ASSESSORS: THE ORDER'S OWN SLOTS, AND ONLY WHERE THE ORDER LEFT THEM EMPTY ───────────
//
// The record is carried to a model only through the slots the assessors already read: the frame stage's goods and use
// lines, and the instructed scope stamped at the head of the frame that every later stage reads. Only an order that names
// no goods of its own is filled: its own fields are thin, and the request's labelled fields are its own words for what
// is missing. An order that names its goods keeps every slot exactly as it is, so a run that already had the facts reads
// what it always read. Where the order's own use and the request's differ, both are shown, each with its source.

const fromOrder = (f) => /^order:/.test(String(f?.source ?? ""));

/**
 * The slots the stated facts fill: `{ goods, use, channels }`, each a list of `{ value, source }`, only the non-empty
 * ones; or null when nothing is filled. PURE.
 */
export function slotsFilledFrom(record) {
  const facts = Array.isArray(record?.facts) ? record.facts.filter((f) => f && String(f.value ?? "").trim()) : [];
  if (facts.some((f) => f.field === "goods" && fromOrder(f))) return null;   // the order names its goods: nothing changes
  const asked = (fields) => facts.filter((f) => fields.includes(f.field) && !fromOrder(f));
  const slots = {};
  const goods = asked(["description", "goods"]);
  if (goods.length) slots.goods = goods;
  const use = asked(["use"]);
  if (use.length) slots.use = [...facts.filter((f) => f.field === "use" && fromOrder(f)), ...use];
  const channels = asked(["channels"]);
  if (channels.length) slots.channels = channels;
  return Object.keys(slots).length ? slots : null;
}

/** One slot's text: the value with its source, or every value with its own source when there is more than one. PURE. */
export function slotText(entries) {
  const list = (Array.isArray(entries) ? entries : []).map((e) => `${String(e.value).trim()} — ${e.source}`);
  return list.length > 1 ? `Multiple stated values: ${list.join("; ")}` : (list[0] ?? "");
}

/** A run's filled slot, read from its record: the slot's text, or "" when it is not filled. IMPURE. */
export function statedSlot(P, slot) {
  let record = null;
  try { record = JSON.parse(readFileSync(P.statedFacts, "utf8")); } catch { return ""; }
  return slotText(slotsFilledFrom(record)?.[slot]);
}

/**
 * Write the run's stated facts beside its instructed scope, at intake, before any model runs; an order that states
 * none leaves no file, and a stale one is removed. `P` is the run's paths. IMPURE.
 */
export function writeStatedFacts(P, job) {
  const record = statedFactsOf(job);
  if (record) writeFileSync(P.statedFacts, JSON.stringify(record, null, 2) + "\n");
  else rmSync(P.statedFacts, { force: true });
  return record;
}
