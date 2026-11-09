// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// T7 (E5/E6) — the deterministic case-law + enforcer-telemetry joins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCaseLawProfiles, joinCaseLawProfiles } from "../publish/parse.mjs";
import { foldRecord } from "../record-fold.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const MD = [
  "# Case-law findings",
  "",
  "### Grounded profile — OPEN COUNTRY vs. WILDFIELD / Chengdu Wildfield Ltd (CN)",
  "- ord: 1",
  "",
  "**Question grounded:** enforcer posture",
  "",
  "**On-point authorities:**",
  "- *WARDOGS* · EUIPO BoA · 2021 · holding: composite word marks compared as wholes · ECLI:X — relevance: same comparison posture.",
  "",
  "## Grounded profile — OPEN COUNTRY vs FIELD / Veltrona Interactive (EU)",
  "",
  "**On-point authorities:**",
  "- *Palm Bay* · CJEU · 2005 · holding: aural similarity can suffice · C-334/05 — relevance: shared token.",
  "",
  "### Grounded profile — OPEN COUNTRY vs Windfield (US)",
  "- ord: 3",
  "",
  "**No on-point precedent found.** Sources searched: CourtListener. Coverage gaps: TTAB not searched.",
].join("\n");

test("parseCaseLawProfiles: ##/### heads, vs./vs forms, ord stamps, owner split, honest none state", () => {
  const p = parseCaseLawProfiles(MD);
  assert.equal(p.length, 3);
  assert.deepEqual([p[0].ord, p[0].mark, p[0].owner, p[0].jurisdiction], [1, "WILDFIELD", "Chengdu Wildfield Ltd", "CN"]);
  assert.ok(!/- ord:/.test(p[0].body), "the join key never renders in the strand body");
  assert.deepEqual([p[1].ord, p[1].mark, p[1].jurisdiction], [null, "FIELD", "EU"]);
  assert.equal(p[2].none, true, "the explicit no-precedent result is preserved — a result, not a gap");
  // doc-55 A3 — coverageLimited distinguishes a coverage-limited "no precedent" (a source outage) from a
  // genuinely exhaustive one, so the client's code-owned case-law line is honest without touching raw prose.
  assert.equal(p[2].coverageLimited, true, "'Coverage gaps: TTAB not searched' flags case-law coverage as limited");
  assert.equal(p[0].coverageLimited, false, "a precedent-found profile with no outage signal is not coverage-limited");
});

test("joinCaseLawProfiles: ordinal wins; mark/owner containment covers archived (un-stamped) profiles; every profile lands", () => {
  const findings = [
    { ordinal: 1, mark: "WILDFIELD", owner: { name: "Chengdu Wildfield Ltd" } },
    { ordinal: 2, mark: "FIELD", owner: { name: "Veltrona Interactive Entertainment" } },
    { ordinal: 3, mark: "WINDFIELD", owner: { name: "Quillstone Publishing" } },
  ];
  const j = joinCaseLawProfiles(parseCaseLawProfiles(MD), findings);
  assert.equal(j.get(1)?.mark, "WILDFIELD", "ord stamp joins exactly");
  assert.equal(j.get(2)?.mark, "FIELD", "un-stamped profile joins by mark containment — the copper-spire Veltrona card class");
  assert.equal(j.get(3)?.none, true, "the ord-stamped none profile joins too");
});

// The grouping renumbers the findings and leaves the case-law file alone, so the stamped numbers are the writer's. The
// first two findings are two filings of one conflict: 1 and 2 become 1, 3 becomes 2, 4 becomes 3. Every name is invented.
const FOLDED_MD = [[1, "VELTRIN", "Qorvalen Holdings", "The first filing's decision."], [2, "VELTRIN", "Qorvalen Holdings", "No on-point precedent found."],
  [3, "ORVANTE", "Brannick Tooling", "The decision on the tooling mark."], [4, "KESTRIN", "Selmora Labs", "The decision on the laboratory mark."]]
  .map(([ord, mark, owner, body]) => `## Grounded profile — ${mark} vs. ${mark} / ${owner} (US)\n- ord: ${ord}\n${body}\n`).join("\n");

function grouped() {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  const rows = [["Qorvalen Holdings", "VELTRIN"], ["Qorvalen Holdings", "VELTRIN"], ["Brannick Tooling", "ORVANTE"], ["Selmora Labs", "KESTRIN"]];
  doc.findings = rows.map(([owner, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner = { ...f.owner, name: owner };
    return f;
  });
  return foldRecord(doc, null);
}

test("after a grouping each finding prints its own decision, and one that folded in takes no other's", () => {
  const { doc, map, merges } = grouped();
  assert.equal(merges.length, 1, "guard: the two filings did not fold");
  assert.deepEqual(doc.findings.map((f) => f.ordinal), [1, 2, 3], "guard: the record was not renumbered");
  const j = joinCaseLawProfiles(parseCaseLawProfiles(FOLDED_MD), doc.findings, map.modelToFolded);
  assert.deepEqual(doc.findings.map((f) => j.get(f.ordinal)?.body), ["The first filing's decision.", "The decision on the tooling mark.", "The decision on the laboratory mark."]);
  const unmapped = joinCaseLawProfiles(parseCaseLawProfiles(FOLDED_MD), doc.findings);
  assert.notEqual(unmapped.get(2)?.body, "The decision on the tooling mark.", "control: without the map the second finding has another's decision");
});

test("a grouped finding keeps the decision over a no-precedent result, whichever filing held it", () => {
  const { doc, map } = grouped();
  const md = FOLDED_MD.replace("The first filing's decision.", "No on-point precedent found.").replace(/(- ord: 2\n)No on-point precedent found\./, "$1The second filing's decision.");
  assert.equal(joinCaseLawProfiles(parseCaseLawProfiles(md), doc.findings, map.modelToFolded).get(1)?.body, "The second filing's decision.");
});

test("a name match never takes a profile stamped for a later finding", () => {
  const findings = [{ ordinal: 1, mark: "VELTRIN", owner: { name: "Qorvalen Holdings" } }, { ordinal: 2, mark: "VELTRIN NOVA", owner: { name: "Qorvalen Holdings" } }];
  const md = "## Grounded profile — VELTRIN NOVA vs. VELTRIN NOVA / Qorvalen Holdings (US)\n- ord: 2\nThe decision on the second mark.\n";
  const j = joinCaseLawProfiles(parseCaseLawProfiles(md), findings);
  assert.equal(j.get(2)?.body, "The decision on the second mark.");
  assert.equal(j.has(1), false, "the first finding took the second's decision by owner");
});

test("a stamped number the grouping does not know is matched by name, as an unstamped profile is", () => {
  const findings = [{ ordinal: 1, mark: "ORVANTE", owner: { name: "Brannick Tooling" } }];
  const md = "## Grounded profile — ORVANTE vs. ORVANTE / Brannick Tooling (US)\n- ord: 9\nThe decision.\n";
  assert.equal(joinCaseLawProfiles(parseCaseLawProfiles(md), findings, { 1: 1 }).get(1)?.body, "The decision.");
});
