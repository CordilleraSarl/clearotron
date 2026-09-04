// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Score relations.mjs against the 690 vetted tranche-1 notes.
//
// The comparison is the ASSERTABLE tuple (type, to_group, edition_qualifier) as a multiset per note.
// scope_zh is provenance prose the vetted extraction rewrote per target; matching it character for
// character would measure phrasing, not agreement.
// The answer key is the VETTED 690, pinned by path. Reading cn/cnipa-cross-references.jsonl here
// compared the new extraction against itself the moment that file was reassembled — and scored 92%.
import { readFileSync } from "node:fs";
import { parseRelations } from "./relations.mjs";
import { mustRead } from "./sources.mjs";

const FOLD = { cross_group_protection: "cross_group_protected", internal_note: null, needs_review_placeholder: null };
const expand = (rels) => rels.flatMap(r => {
  const type = r.type in FOLD ? FOLD[r.type] : r.type;
  if (type === null) return [];
  const tos = r.to_group == null ? [null] : (Array.isArray(r.to_group) ? r.to_group : [r.to_group]);
  return tos.map(t => `${type}|${t ?? ""}|${r.edition_qualifier ?? ""}`);
});
const bag = (a) => a.reduce((m, k) => (m[k] = (m[k] ?? 0) + 1, m), {});
const same = (a, b) => { const x = bag(a), y = bag(b); const ks = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of ks) if ((x[k] ?? 0) !== (y[k] ?? 0)) return false; return true; };

const rows = mustRead(process.argv.slice(2).find(a=>a.endsWith(".jsonl")) ?? "cn/tranche1/cnipa-vetted-690.jsonl", "the hand-checked answer key the relation parser is scored against").trim().split("\n").map(l => JSON.parse(l));
let exact = 0, tp = 0, fp = 0, fn = 0, selfRef = 0, unparsed = 0;
const misses = [];
for (const n of rows) {
  const want = expand(n.relations ?? []);
  const got0 = parseRelations(n.note_text_zh, /^\d{4}$/.test(n.source_group) ? n.source_group : null);
  const got = expand(got0.relations);
  selfRef += got0.relations.filter(r => r.self_reference).length;
  unparsed += got0.unparsed.length;
  if (same(want, got)) exact++;
  else misses.push({ n, want, got });
  const y = bag(want), x = bag(got);
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const c = Math.min(x[k] ?? 0, y[k] ?? 0); tp += c; fp += (x[k] ?? 0) - c; fn += (y[k] ?? 0) - c;
  }
}
console.log(`notes ${rows.length} | exact multiset match ${exact} (${(100 * exact / rows.length).toFixed(1)}%)`);
console.log(`relation tuples: agreed ${tp} | parser-only ${fp} | vetted-only ${fn}`);
console.log(`self-reference inferences ${selfRef} | clauses with no code and no source group ${unparsed}`);
const byType = {};
for (const m of misses) for (const k of [...m.want, ...m.got]) { const t = k.split("|")[0]; byType[t] = (byType[t] ?? 0) + 1; }
console.log("types involved in mismatching notes:", byType);
if (process.argv.includes("--show")) for (const m of misses.slice(0, Number(process.argv[process.argv.indexOf("--show") + 1]) || 8)) {
  console.log(`\n${m.n.source_group} p${m.n.printed_page} #${m.n.note_number}: ${m.n.note_text_zh}`);
  console.log("  vetted:", m.want.join("  "));
  console.log("  parser:", m.got.join("  "));
}
if (process.argv.includes("--type")) {
  const want = process.argv[process.argv.indexOf("--type") + 1];
  const sel = misses.filter(m => [...m.want, ...m.got].some(k => k.startsWith(want)));
  console.log(`\nmismatching notes involving ${want}: ${sel.length}`);
  for (const m of sel.slice(0, 6)) {
    console.log(`\n${m.n.source_group} p${m.n.printed_page} #${m.n.note_number}: ${m.n.note_text_zh}`);
    console.log("  vetted:", m.want.join("  "));
    console.log("  parser:", m.got.join("  "));
  }
}
