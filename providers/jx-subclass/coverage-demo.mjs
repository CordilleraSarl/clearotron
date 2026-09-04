// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The check the coverage table exists to pass: class 15 and class 30 hold ZERO CN cross-reference rows
// each, and must not give the same answer.
import { DatabaseSync } from "node:sqlite";
import { assertCovered, CoverageError, assertCoverageComplete } from "./coverage.mjs";

const db = new DatabaseSync("similar-groups.db", { readOnly: true });
const xrefs = (g) => db.prepare("SELECT COUNT(*) n FROM cross_reference WHERE office='CN' AND substr(source_group,1,2)=?").get(g).n;

for (const [cls, label] of [[3, "class 3 — read, has notes"], [15, "class 15 — read, genuinely empty"],
                            [24, "class 24 — half read"], [30, "class 30 — never opened"]]) {
  const rows = xrefs(String(cls).padStart(2, "0"));
  process.stdout.write(`\nCN class ${String(cls).padStart(2)} (${label})\n  rows in cross_reference: ${rows}\n  lookup answers: `);
  try {
    const cov = assertCovered(db, { office: "CN", layer: "cross_reference", niceClass: cls });
    console.log(rows
      ? `${rows} cross-references, cited to printed pages (${cov.read_pages})`
      : `NO cross-references — a clean negative. Read at printed ${cov.read_pages}.`);
    if (cov.groups_no_notes) console.log(`  groups confirmed to carry no 注 block: ${cov.groups_no_notes}`);
  } catch (e) {
    if (!(e instanceof CoverageError)) throw e;
    console.log(`REFUSES (${e.status})\n  → ${e.message}`);
  }
}
console.log(`\nmanifest complete for every office/layer: ${assertCoverageComplete(db)}`);
