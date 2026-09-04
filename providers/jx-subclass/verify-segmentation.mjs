// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Does layout-notes.mjs read the same 注 blocks a human read? Printed 124-160 exists in BOTH the
// vetted tranche-1 extraction and the MinerU layout, so it is measurable before anything is trusted
// on pages 161-252 that only the machine has seen.
//
// Compared on the note TEXT with whitespace removed: MinerU spaces ASCII digits away from CJK
// ("与 0115 类似"), which is a rendering artefact, not a difference in what the office wrote.
// The answer key is the VETTED 690, pinned by path. Reading cn/cnipa-cross-references.jsonl here
// compared the new extraction against itself the moment that file was reassembled — and scored 92%.
import { readFileSync } from "node:fs";
import { extractNotes, loadLayout } from "./layout-notes.mjs";
import { mustRead } from "./sources.mjs";

const requireLayout = (v) => {
  if (v) return v;
  console.error("ABSENT: --layout <mineru layout.json> is required. There is no default: a path baked in\n" +
                "here would name one operator's home directory, and a wrong-but-present default reads as\n" +
                "data rather than as the missing argument it is. BUILDING.md says where the sources live.");
  process.exit(1);
};


const LO = 124, HI = 160;
const key = (s) => (s ?? "").replace(/\s+/g, "").replace(/[；;。]$/, "");
const vetted = mustRead("cn/tranche1/cnipa-vetted-690.jsonl", "the hand-checked notes this compares segmentation against").trim().split("\n").map(l => JSON.parse(l))
  .filter(r => r.printed_page >= LO && r.printed_page <= HI);
const got = extractNotes(loadLayout(requireLayout(process.argv.slice(2).find(a => a.endsWith(".json")))))
  .filter(r => r.printed_page >= LO && r.printed_page <= HI);

console.log(`printed ${LO}-${HI}: vetted ${vetted.length} note items | layout ${got.length}`);

const idx = (rows, t) => rows.reduce((m, r) => { const k = key(t(r)); (m[k] ??= []).push(r); return m; }, {});
const V = idx(vetted, r => r.note_text_zh), G = idx(got, r => r.text);
const bothText = Object.keys(V).filter(k => G[k]).length;
console.log(`identical note text: ${bothText} of ${vetted.length} vetted items (${(100 * bothText / vetted.length).toFixed(1)}%)`);

const onlyV = Object.keys(V).filter(k => !G[k]), onlyG = Object.keys(G).filter(k => !V[k]);
// Same text, same group: does the layout put it on the same printed page and item number?
let pageOk = 0, numOk = 0, groupOk = 0, n = 0;
for (const k of Object.keys(V)) if (G[k]) {
  const v = V[k][0], g = G[k][0]; n++;
  if (v.printed_page === g.printed_page) pageOk++;
  if ((v.note_number ?? null) === (g.note_number ?? null)) numOk++;
  if (v.source_group === g.source_group) groupOk++;
}
console.log(`of those: same source_group ${groupOk}/${n} | same printed_page ${pageOk}/${n} | same note_number ${numOk}/${n}`);
console.log(`\nvetted-only items ${onlyV.length}:`);
for (const k of onlyV.slice(0, 12)) console.log(`  ${V[k][0].source_group} p${V[k][0].printed_page}: ${k.slice(0, 110)}`);
console.log(`\nlayout-only items ${onlyG.length}:`);
for (const k of onlyG.slice(0, 12)) console.log(`  ${G[k][0].source_group} p${G[k][0].printed_page}: ${k.slice(0, 110)}`);
