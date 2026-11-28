// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lever 1 — the narrative's per-finding prose, checked against the depth rows.
//
// The directive that told the synthesis seat which findings get a prose write-up, and how long, left the synthesis dispatch
// (design, 2026-11-06): the call records sections only, and its own message says per-finding write-ups are not a field. What
// stays is the check: a narrative that does carry per-finding prose, an older one among them, is still held to the product's
// kept band rank and word cap, read from the same depth rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { depthFor } from "../search-policy.mjs";
import { narrativeWriteUpChecks } from "../predelivery-lint.mjs";

const WORLDWIDE = "global-preliminary-search", MULTI = "multi-country-focus-search", ONE = "full-country-search";

test("the check ACTIVATES on the shipped depth rows — an older narrative with per-finding prose is still held to them", () => {
  // The check arms elsewhere read a fixture's parameters; this reads the shipped per-product rows, so a graded row whose
  // check has gone quiet is visible.
  const MANIFEST = { bands: [{ label: "Very High" }, { label: "High" }, { label: "Moderate" }, { label: "Manageable" }] };
  const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const md = [
    "# N", "", "## Finding 1 — A", "", "**Composite:** 4", "", w(20), "",
    "## Finding 2 — B", "", "**Composite:** 2", "", w(400), "",
    "## Finding 3 — C", "", "**Composite:** 1", "", w(20), "",
  ].join("\n");
  const findings = { findings: [{ ordinal: 1, band: "Very High" }, { ordinal: 2, band: "High" }, { ordinal: 3, band: "Manageable" }] };

  for (const p of [WORLDWIDE, MULTI]) {
    const depth = depthFor({ product: p });
    assert.ok(depth.narrativeKeptBandRank >= 1 && depth.narrativeWriteUpWords >= 1, `${p}: the shipped row grades nothing`);
    const bad = narrativeWriteUpChecks({ narrativeMd: md, findings, depth, manifest: MANIFEST }).filter((r) => !r.pass);
    assert.deepEqual(bad.map((r) => r.id.replace(/^narrative-write-ups:/, "")).sort(),
      ["not-kept:3", "over-cap:2"],
      `${p}: did not catch a 400-word write-up and a rank-4 one`);
  }
  // And the ungraded product has no check and no row.
  const one = depthFor({ product: ONE });
  assert.deepEqual(narrativeWriteUpChecks({ narrativeMd: md, findings, depth: one, manifest: MANIFEST }), []);
});
