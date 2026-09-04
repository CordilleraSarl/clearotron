// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// load-provenance.mjs — sync provenance.json into the database without rebuilding it.
//
// build-db.mjs deletes and recreates the file, which would take the cross-references and the coverage
// table with it. Provenance changes whenever a source lands, so it needs its own idempotent loader:
// every shipped row must be traceable to a document a lawyer can open, and a source that arrives after
// the build would otherwise sit in the JSON and never reach the table a report cites.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");
const prov = JSON.parse(readFileSync("provenance.json", "utf8"));
const missing = prov.filter((p) => !p.sha256 || !p.edition);
if (missing.length) {
  console.error(`REFUSING: ${missing.length} provenance row(s) lack a hash or an edition — `
    + `a citable table cannot hold an uncitable row: ${missing.map((p) => p.office + "/" + p.document).join(", ")}`);
  process.exit(2);
}
const db = new DatabaseSync("similar-groups.db");
if (DRY) { console.log(`--dry-run: ${prov.length} rows validated, nothing written`); process.exit(0); }
db.exec("DELETE FROM provenance");
const ins = db.prepare(`INSERT INTO provenance
  (office,source,document,file,edition,effective,url,retrieved,sha256,bytes,contributes)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
db.exec("BEGIN");
for (const p of prov) ins.run(p.office, p.source, p.document, p.file ?? null, p.edition,
  p.effective ?? null, p.url, p.retrieved, p.sha256, p.bytes ?? null, p.contributes);
db.exec("COMMIT");
for (const r of db.prepare("SELECT office, edition, effective, substr(sha256,1,12) h FROM provenance ORDER BY office").all())
  console.log(`  ${r.office}  ${String(r.edition).padEnd(34)} ${String(r.effective ?? "(not recorded)").padEnd(14)} ${r.h}…`);
console.log(`provenance rows: ${prov.length}`);
