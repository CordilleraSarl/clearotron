// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// An invented knockout run for the gate arms: a four-band framework whose labels are nobody's, one mark with its
// research payload, and a chunk or a merged record built around them. No method is frozen, so a finding carries
// no table inputs, as every knockout sent before methods existed.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

export const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "orchard-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
export const EVIDENCE = "https://example.invalid/shop/veltra-pharma";
export const finding = (band) => ({ ordinal: 1, name: "VELTRA PHARMA", owner: "Veltra Labs GmbH", band, type: "Active Business",
  net: "Veltra Labs' unregistered VELTRA PHARMA use is more likely than not to block the applicant in Germany.",
  evidence: [EVIDENCE], basis: "Continuous German retail listings since 2019 under the applicant's exact goods, with an active storefront." });
export const mark = (rating, findings) => ({ name: "TESTMARK", rating, classesDriving: [9], basis: "The name is close to a known property.",
  factors: ["A first load-bearing observation.", "A second load-bearing observation."], counterFactors: ["What holds it at this band."],
  mitigation: "", bullets: ["One honest evidence bullet."], purpleNotes: [], findings });
export function invented() {
  const d = mkdtempSync(join(tmpdir(), "ko-invented-"));
  mkdirSync(driverDir(d), { recursive: true });
  mkdirSync(join(d, "research"), { recursive: true });
  writeFileSync(join(d, "research", "testmark.md"), `# research payload for TESTMARK\n\nA storefront: ${EVIDENCE}\n`);
  writeFileSync(driverDir(d, "framework.json"), JSON.stringify(MANIFEST));
  writeFileSync(driverDir(d, "register-records.json"), JSON.stringify({ marks: [] }));
  return d;
}
export const chunk = (m) => JSON.stringify({ framework: MANIFEST, batch: { productContext: "x", standardCaveats: [] }, marks: [m],
  chunkSummary: "A measured sentence about this chunk of marks." });
export const merged = (m) => ({ schema_version: 1, batch: { executiveSummary: "A batch read.", standardCaveats: ["Triage, not clearance."] }, marks: [m] });
