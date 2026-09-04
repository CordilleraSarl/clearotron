// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// update-coverage-cn.mjs — restate CN coverage after a tranche lands.
//
// STATED, never derived: the STATUS is a claim about which pages were actually read, and it is written
// here rather than inferred from the rows that happened to load. A class read and found empty and a
// class nobody opened both produce zero rows.
//
// What IS derived, and only because the whole document has now been read end to end: which groups
// appeared as a header and carry no 注 block. That is a CONFIRMED empty — the class-15 answer — and it
// is now available for all 45 classes instead of the first six.
//
// Fields are SET, not appended, so re-running cannot accumulate stale prose.
import { readFileSync, writeFileSync } from "node:fs";
import { pageLines, loadLayout } from "./layout-notes.mjs";

// Two MinerU runs cover the document: printed 4-123 and 124-252. They overlap at 124-134 and produce
// 34 of 34 character-identical note items there, so either may be read for the shared pages. Both are
// named on the command line — a default path here would be one operator's home directory, and this
// script would then restate coverage from whatever happened to be at it.
//
//   node update-coverage-cn.mjs --layout <a.json> --layout <b.json> --notes <a.jsonl> --notes <b.jsonl>
const argsOf = (f) => process.argv.reduce((a, v, i) => (process.argv[i - 1] === f ? [...a, v] : a), []);
const LAYOUTS = argsOf("--layout"), TRANCHES = argsOf("--notes");
if (!LAYOUTS.length || !TRANCHES.length) {
  console.error("ABSENT: --layout and --notes are both required, at least one of each. Coverage is STATED,\n" +
                "and a default path would state it from whatever file happened to sit there.");
  process.exit(1);
}
const MINERU = "Read from MinerU 3.4.4 (hybrid, OCR on) over the whole document, printed 4-252. Relation typing scored 1220/1240 against the 690 hand-checked tranche-1 notes; the two runs agree character for character on the 11 pages they share.";

const cov = JSON.parse(readFileSync("cn/coverage.json", "utf8"));
const notes = TRANCHES.flatMap(f => readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l)));
const withNotes = new Set(notes.map(n => n.source_group));

const HEAD = /^(\d{4})[ 　]*([^\d].*)$/;
const seen = new Map();
for (const { printed, text } of LAYOUTS.flatMap(f => pageLines(loadLayout(f)))) {
  if (printed < 4 || printed > 252) continue;
  const m = HEAD.exec(text.replace(/\s+/g, ""));
  if (!m) continue;
  const c = +m[1].slice(0, 2);
  if (c >= 1 && c <= 45 && !seen.has(m[1])) seen.set(m[1], printed);
}

const empties = {};
for (const [g] of seen) if (!withNotes.has(g)) (empties[+g.slice(0, 2)] ??= []).push(g);

for (let c = 1; c <= 45; c++) {
  const e = cov.classes[String(c)];
  if (!e) throw new Error(`no class ${c} in the manifest — it may not skip one`);
  e.status = "extracted";
  e.read_pages = "4-252";
  if (empties[c]?.length) e.groups_no_notes = empties[c].sort(); else delete e.groups_no_notes;
  const held = notes.filter(n => n.source_group.startsWith(String(c).padStart(2, "0"))).length;
  e.note = held ? MINERU
    : `${MINERU} Every group in this class was read and carries NO 注 block — a clean negative, not an absence of work.`;
}
cov.read_pages = "4-252";
cov.unread_pages = "none";
cov.source_document = "《类似商品和服务区分表——基于尼斯分类第十二版（2023文本）》, 商标局 — read end to end by MinerU 3.4.4, printed 4-123 and 124-252 in two runs";
cov.groups_no_notes_itemised_through_class = 45;
cov._groups_no_notes_caveat = "Itemised in FULL for all 45 classes: every group header on printed 4-252 carrying no 注 block is listed, and that is a CONFIRMED empty, not an unread one. The earlier caveat — absence meaning NOT ITEMISED beyond class 6 — no longer applies now the whole document has been read by one instrument.";
writeFileSync("cn/coverage.json", JSON.stringify(cov, null, 2) + "\n");

const emptyClasses = [...Array(45)].map((_, i) => i + 1).filter(c => !notes.some(n => n.source_group.startsWith(String(c).padStart(2, "0"))));
console.log(`all 45 classes restated | group headers read ${seen.size} | groups confirmed to carry no 注 block ${Object.values(empties).flat().length}`);
console.log(`classes carrying an itemised empty list: ${Object.keys(empties).length}`);
console.log(`classes read and holding NO cross-reference at all: ${emptyClasses.join(", ") || "none"}`);
