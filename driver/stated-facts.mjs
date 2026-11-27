// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stated-facts.mjs — WHAT THE ORDER STATES, IN ITS OWN WORDS, KEPT WITH ITS SOURCE.
//
// The matter frame restates the request, and a restatement can drop a fact the request gave: a request form named
// its product and four sales channels, the order's goods field was empty, and the frame said the brief gave no goods
// specification. Every later stage read that frame. The facts a request states plainly are now read by code, once,
// before any model runs, and stamped into the frame beside the instructed scope, each with where it was found. A frame
// that omits or contradicts one cannot take it out of what later stages read.
//
// What is read, and only this:
//   - the order's own fields: `goods` (or its older spelling `use`), and `priorUse`;
//   - in the verbatim request, a label from a fixed set, in English, German, French or Italian, for a description of
//     the product, the goods or services, the use, and the sales channels: a line `Label: value`, a table row rendered
//     `Label | value`, a label whose value follows as a list, or a form flattened onto one line, where a capitalised
//     `Label:` opens each field and the value runs to the next one.
// Nothing is inferred and nothing is judged: no word overlap, no model, no gate. A fact stated twice, differently, is
// kept both times and marked uncertain. A request with no labelled fact and an order with no such field have nothing
// to stamp.
import { rmSync, writeFileSync } from "node:fs";
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
 * uncertain: [field] }`, or null when it states none. A repeated identical fact is kept once. PURE.
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
  const uncertain = STATED_FIELDS.filter((f) => kept.filter((x) => x.field === f).length > 1);
  return { facts: kept, uncertain };
}

// THE WORDS BELOW ARE READ BY THE MODEL in every stage that reads the frame. They are a draft put to design, and
// land only on its approval.
const HEADINGS = Object.freeze({ description: "Product or description", goods: "Goods/services", use: "Use", channels: "Sales channels" });

/** The frame's stamped section for the stated facts, or no lines at all when the order states none. PURE. */
export function renderStatedFacts(record) {
  const facts = Array.isArray(record?.facts) ? record.facts.filter((f) => STATED_FIELDS.includes(f?.field) && clean(f?.value)) : [];
  if (!facts.length) return [];
  const uncertain = new Set(Array.isArray(record?.uncertain) ? record.uncertain : []);
  const out = ["## Stated in the request", ""];
  for (const f of facts)
    out.push(`- **${HEADINGS[f.field]}${uncertain.has(f.field) ? " (stated more than once, differently: each kept)" : ""}:** ${String(f.value).trim()} — ${f.source}`);
  out.push("", "Stamped by the driver from `_driver/stated-facts.json`: what the order states in its own words, read "
    + "before any model ran, each with where it was found. Nothing here is inferred.", "");
  return out;
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
