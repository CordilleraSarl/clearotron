// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// T7 (E5/E6) — the deterministic case-law + enforcer-telemetry joins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCaseLawProfiles, joinCaseLawProfiles } from "../publish/parse.mjs";

const MD = [
  "# Case-law findings",
  "",
  "### Grounded profile — OPEN COUNTRY vs. WILDBOUND / Chengdu Wildbound Ltd (CN)",
  "- ord: 1",
  "",
  "**Question grounded:** enforcer posture",
  "",
  "**On-point authorities:**",
  "- *WARDOGS* · EUIPO BoA · 2021 · holding: composite word marks compared as wholes · ECLI:X — relevance: same comparison posture.",
  "",
  "## Grounded profile — OPEN COUNTRY vs BOUND / Sony Interactive (EU)",
  "",
  "**On-point authorities:**",
  "- *Palm Bay* · CJEU · 2005 · holding: aural similarity can suffice · C-334/05 — relevance: shared token.",
  "",
  "### Grounded profile — OPEN COUNTRY vs Windbound (US)",
  "- ord: 3",
  "",
  "**No on-point precedent found.** Sources searched: CourtListener. Coverage gaps: TTAB not searched.",
].join("\n");

test("parseCaseLawProfiles: ##/### heads, vs./vs forms, ord stamps, owner split, honest none state", () => {
  const p = parseCaseLawProfiles(MD);
  assert.equal(p.length, 3);
  assert.deepEqual([p[0].ord, p[0].mark, p[0].owner, p[0].jurisdiction], [1, "WILDBOUND", "Chengdu Wildbound Ltd", "CN"]);
  assert.ok(!/- ord:/.test(p[0].body), "the join key never renders in the strand body");
  assert.deepEqual([p[1].ord, p[1].mark, p[1].jurisdiction], [null, "BOUND", "EU"]);
  assert.equal(p[2].none, true, "the explicit no-precedent result is preserved — a result, not a gap");
  // doc-55 A3 — coverageLimited distinguishes a coverage-limited "no precedent" (a source outage) from a
  // genuinely exhaustive one, so the client's code-owned case-law line is honest without touching raw prose.
  assert.equal(p[2].coverageLimited, true, "'Coverage gaps: TTAB not searched' flags case-law coverage as limited");
  assert.equal(p[0].coverageLimited, false, "a precedent-found profile with no outage signal is not coverage-limited");
});

test("joinCaseLawProfiles: ordinal wins; mark/owner containment covers archived (un-stamped) profiles; every profile lands", () => {
  const findings = [
    { ordinal: 1, mark: "WILDBOUND", owner: { name: "Chengdu Wildbound Ltd" } },
    { ordinal: 2, mark: "BOUND", owner: { name: "Sony Interactive Entertainment" } },
    { ordinal: 3, mark: "WINDBOUND", owner: { name: "Deep Silver" } },
  ];
  const j = joinCaseLawProfiles(parseCaseLawProfiles(MD), findings);
  assert.equal(j.get(1)?.mark, "WILDBOUND", "ord stamp joins exactly");
  assert.equal(j.get(2)?.mark, "BOUND", "un-stamped profile joins by mark containment — the copper-spire Sony card class");
  assert.equal(j.get(3)?.none, true, "the ord-stamped none profile joins too");
});
