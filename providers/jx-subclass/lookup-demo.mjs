// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { DatabaseSync } from "node:sqlite";
import { subclassesFor, crossReferencesFor } from "./lookup.mjs";
const db = new DatabaseSync("similar-groups.db", { readOnly: true });

console.log("QUESTION 1 — which CN group codes does this good carry?\n" + "─".repeat(70));
for (const [term, cls] of [["香皂", 3], ["婴儿车", 12], ["工业用化学品", 1], ["月饼", 30], ["可下载的手机应用软件", 9]]) {
  const r = subclassesFor(db, { country: "CN", term, niceClass: cls });
  console.log(`\n  ${term} (class ${cls})  →  ${r.status}${r.codes?.length ? "  codes: " + r.codes.join(",") : ""}`);
  if (r.matched?.length) console.log(`    matched ${r.matchedHow}: ${r.matched.slice(0,2).map(m=>m.name+" ("+m.basic_no+")").join(", ")}`);
  if (r.suggestion) console.log(`    fragment seen: ${r.suggestion} — suggested, not answered`);
  if (r.note) console.log(`    ${r.note.slice(0, 150)}…`);
  if (r.citation) console.log(`    cite: ${r.citation.document} ${r.citation.edition}`);
}

console.log("\n\nQUESTION 2 — which other groups must the search cover?\n" + "─".repeat(70));
for (const [g, cls] of [["0301", 3], ["1501", 15], ["3001", 30], ["2402", 24]]) {
  const r = crossReferencesFor(db, { country: "CN", group: g, niceClass: cls });
  console.log(`\n  group ${g} (class ${cls})  →  ${r.status}`);
  if (r.status === "ok") {
    for (const [t, list] of Object.entries(r.byType))
      console.log(`    ${t.padEnd(22)} ${list.map(x => x.to_group ?? "(no code)").join(", ")}`);
    console.log(`    edition-qualified ${r.editionQualified} | edition-gap ${r.editionGap} | needs review ${r.needsReview}`);
    console.log(`    cited to printed pages ${r.coverage.readPages}`);
  } else if (r.status === "none") {
    console.log(`    clean negative — read at printed ${r.coverage.readPages}; groups confirmed empty: ${r.coverage.groupsNoNotes}`);
  } else {
    console.log(`    ${r.reason.slice(0, 190)}`);
  }
}
