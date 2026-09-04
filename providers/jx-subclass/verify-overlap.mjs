// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What the DATABASE asserts for printed 124-160 versus what the PAGE says there.
//
// Tranche 1 was transcribed by a vision model; layout.json is MinerU's OCR of the same pages. Both are
// machine reads, so neither is authority on its own — but they can be diffed, and where they disagree
// the page image settles it. This measures the size of the disagreement so the answer is a number.
// The answer key is the VETTED 690, pinned by path. Reading cn/cnipa-cross-references.jsonl here
// compared the new extraction against itself the moment that file was reassembled — and scored 92%.
import { readFileSync } from "node:fs";
import { extractNotes, loadLayout } from "./layout-notes.mjs";
import { parseRelations } from "./relations.mjs";
import { mustRead } from "./sources.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i < 0 ? d : process.argv[i + 1]; };
const LO = Number(arg("--from", 124)), HI = Number(arg("--to", 160));
const requireLayout = (v) => {
  if (v) return v;
  console.error("ABSENT: --layout <mineru layout.json> is required. There is no default: a path baked in\n" +
                "here would name one operator's home directory, and a wrong-but-present default reads as\n" +
                "data rather than as the missing argument it is. BUILDING.md says where the sources live.");
  process.exit(1);
};

const FOLD = { cross_group_protection: "cross_group_protected", internal_note: null, needs_review_placeholder: null };
const expand = (rels) => rels.flatMap(r => {
  const type = r.type in FOLD ? FOLD[r.type] : r.type;
  if (type === null) return [];
  const tos = r.to_group == null ? [null] : (Array.isArray(r.to_group) ? r.to_group : [r.to_group]);
  return tos.map(t => `${type}|${t ?? ""}|${r.edition_qualifier ?? ""}`);
});
const bag = (a) => a.reduce((m, k) => (m[k] = (m[k] ?? 0) + 1, m), {});
// cross_group_protected is expanded per protected GOOD here and per GROUP in some tranche-1 batches.
// That is a convention difference between two extractions, not a disagreement about the office's text,
// and left in it would triple the apparent gap. Deduped on both sides so the diff measures content.
const dedupe = (a) => [...new Set(a)];

const vetted = mustRead("cn/tranche1/cnipa-vetted-690.jsonl", "the hand-checked notes this compares a machine read against").trim().split("\n").map(l => JSON.parse(l))
  .filter(r => r.printed_page >= LO && r.printed_page <= HI);
const layout = extractNotes(loadLayout(requireLayout(arg("--layout", null))))
  .filter(r => r.printed_page >= LO && r.printed_page <= HI);

const byGroup = (rows, text, rel) => rows.reduce((m, r) => {
  const g = r.source_group; (m[g] ??= []).push(...(rel ? rel(r) : expand(parseRelations(text(r), /^\d{4}$/.test(g) ? g : null).relations)));
  return m;
}, {});
const V = byGroup(vetted, null, r => expand(r.relations ?? []));
const G = byGroup(layout, r => r.text, null);

const groups = [...new Set([...Object.keys(V), ...Object.keys(G)])].sort();
let identical = 0, dbOnly = 0, pageOnly = 0, gDbOnly = 0, gPageOnly = 0, gBoth = 0;
const worst = [];
for (const g of groups) {
  const x = bag(dedupe(V[g] ?? [])), y = bag(dedupe(G[g] ?? []));
  let d = 0, p = 0;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    d += Math.max(0, (x[k] ?? 0) - (y[k] ?? 0));
    p += Math.max(0, (y[k] ?? 0) - (x[k] ?? 0));
  }
  if (!d && !p) { identical++; continue; }
  dbOnly += d; pageOnly += p;
  if (d && p) gBoth++; else if (d) gDbOnly++; else gPageOnly++;
  worst.push({ g, d, p });
}
console.log(`printed ${LO}-${HI}: ${groups.length} groups | vetted note items ${vetted.length} | layout note items ${layout.length}`);
console.log(`groups whose assertions agree exactly: ${identical}/${groups.length} (${(100 * identical / groups.length).toFixed(0)}%)`);
console.log(`relations the DATABASE asserts and the page text does not support: ${dbOnly}`);
console.log(`relations the PAGE states and the database lacks: ${pageOnly}`);
console.log(`groups: db-only ${gDbOnly} | page-only ${gPageOnly} | both directions ${gBoth}`);
const perType = {};
for (const g of groups) {
  const x = bag(dedupe(V[g] ?? [])), y = bag(dedupe(G[g] ?? []));
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const t = k.split("|")[0];
    (perType[t] ??= { dbOnly: 0, pageOnly: 0, agreed: 0 });
    perType[t].agreed   += Math.min(x[k] ?? 0, y[k] ?? 0);
    perType[t].dbOnly   += Math.max(0, (x[k] ?? 0) - (y[k] ?? 0));
    perType[t].pageOnly += Math.max(0, (y[k] ?? 0) - (x[k] ?? 0));
  }
}
console.log("\nby relation type (agreed / db-only / page-only):");
for (const [t, v] of Object.entries(perType)) console.log(`  ${t.padEnd(23)} ${v.agreed}  -${v.dbOnly}  +${v.pageOnly}`);
console.log(`\nworst groups (db-only, page-only):`);
for (const w of worst.sort((a, b) => (b.d + b.p) - (a.d + a.p)).slice(0, 10)) console.log(`  ${w.g}: -${w.d} +${w.p}`);
