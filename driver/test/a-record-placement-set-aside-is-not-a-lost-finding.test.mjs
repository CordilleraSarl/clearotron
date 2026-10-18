// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RECORD PLACEMENT SET ASIDE IS AN APPROVED DECISION, NOT A LOST FINDING.
//
// The stated-divergence check looks for positions the register digest ended as findings that never reached
// the findings, dropped with a reason that points somewhere else. Its population is every record that left a
// seam with a stated reason and arrived nowhere visible. A record placement set aside, by name or by its group's
// one row, leaves the placement seam exactly so: with the step's own ground, before the digest ever sees it.
// Each one was listed as a divergence, "the reason given points at a different artifact", and on a crowded band
// that is thousands of rows burying the few the check exists to find. Placement's own set-aside is the ruled
// method's decision and stays out of that population, unless the digest ended the same position as a finding:
// then the record did vanish, and it is still reported. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statedDivergenceFindings } from "../record-carry.mjs";

const recon = (findingEnded = []) => ({ computable: true, residual: [],
  top_slice: findingEnded.map((uri) => ({ ending: "finding", mark_text: "Plimbo", position_records: [uri] })) });
const setAside = (uri, group = null) => ({ uri, mark: "Plimbo", reach: "screened", stopped_at: "placement",
  reason: "placement:set-aside", reason_source: "step-stated",
  detail: group ? `placement-inquiry set aside this owner's records with group ${group}: other marks a lawyer would not raise`
    : "placement-inquiry set aside this owner's records as a set: a different product, sold only to farmers" });
const DIGEST_DROP = { uri: "/mark/eu/x1", mark: "Drellux", reach: "placed", stopped_at: "digest",
  reason: "digest:reasoned-negative", reason_source: "step-stated" };

test("placement's set-asides, by name or by group, are not divergences; the digest's stated drop still is", () => {
  const r = statedDivergenceFindings({ reconciliation: recon(), carryRows: [setAside("/mark/eu/a2"), setAside("/mark/eu/d1", "d"), DIGEST_DROP] });
  assert.equal(r.computable, true);
  assert.deepEqual(r.diverged.map((d) => d.uri), ["/mark/eu/x1"], "a set-aside the placement step gave its ground was reported as a lost finding");
  assert.equal(r.checked, 1, "the population is the stated drops the check is for");
});

test("a set-aside position the digest ended as a finding is still reported, because the record did vanish", () => {
  const r = statedDivergenceFindings({ reconciliation: recon(["/mark/eu/d1"]),
    carryRows: [setAside("/mark/eu/d1", "d"), setAside("/mark/eu/a2")] });
  assert.deepEqual(r.diverged.map((d) => [d.uri, d.reconciliation_agrees]), [["/mark/eu/d1", true]],
    "the digest's finding-ending makes this a divergence again, and only this one");
});

test("a run whose only stated drops are placement's set-asides has no population, which is its own answer", () => {
  const r = statedDivergenceFindings({ reconciliation: recon(), carryRows: [setAside("/mark/eu/a2"), setAside("/mark/eu/d1", "d")] });
  assert.deepEqual([r.computable, r.population_empty, r.diverged.length], [true, true, 0]);
});
