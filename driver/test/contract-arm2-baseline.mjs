// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// contract-arm2-baseline.mjs — E2 arm 2's measurement, and the thing that writes its baseline. ONE
// derivation, two callers, the same shape as contract-e3-baseline.mjs and skill-instruction-load.mjs.
//
// ── WHY THIS EXISTS: THE SAME DISEASE AS, ON THE OTHER INSTRUMENT ─────────────────────────────
//
// Arm 2 ships as a RATCHET by owner ruling: green-or-red on arm 1, ratchet on arm 2, because a
// check that can never go green is disabled within a week. `arm2Regressions` therefore asks only whether
// a stage GAINED an unpoliced element.
//
// That leaves the mirror hole found in the E3 ceiling. A baseline row naming an element the stage
// no longer declares is a PHANTOM, and a phantom is not inert: `arm2Regressions` compares against the
// recorded list, so re-adding that exact element is not a gain and does not trip. The row that was
// supposed to record a debt has become a licence to re-incur it.
//
// Measured 2026-08-18: `report-card` listed 13 elements against 9 measured — the four absentees being
// `- ord:`, `- group:`, `- source:` and `- net:`, the frame lines the 2026-08-16 conversion retired
// without dropping them here. They sat for two days, and any of the four could have been re-declared
// with CI green.
//
// ── WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT ──────────────────────────────────────────────────
//
// MEMBERSHIP is exact, in both directions: no phantom rows, no unrecorded elements. The RATCHET is
// untouched — `arm2Regressions` still owns the "a stage gained an unpoliced element" question, and this
// says nothing about whether the total is going up or down. The owner ruling was that arm 2 must not be
// a permanently-red gate; a membership check is not that, because it goes green the moment the baseline
// is regenerated, and regenerating is exactly the act that records what changed.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES } from "../stages.mjs";
import { arm2Unspoken } from "../contract-audit.mjs";

const DRIVER = dirname(dirname(fileURLToPath(import.meta.url)));
export const BASELINE_PATH = join(DRIVER, "contract-arm2-baseline.json");

/** Every stage's unpoliced elements, zero-filled so a stage that cleared its row is `[]`, not absent. */
export function measureArm2() {
  const measured = arm2Unspoken(STAGES);
  const byStage = {};
  for (const stage of Object.keys(STAGES)) byStage[stage] = [...(measured[stage] ?? [])].sort();
  const total = Object.values(byStage).reduce((a, v) => a + v.length, 0);
  return { byStage, total };
}

export const readBaseline = () => JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

/**
 * Membership disagreements, both directions and named.
 *
 * `phantom` — recorded, no longer declared. The licence-to-re-incur case above.
 * `unrecorded` — declared, never recorded. A genuinely new unpoliced element that arrived without the
 *                baseline moving, which the ratchet catches as a regression; listed here so the two
 *                instruments cannot disagree about what the population IS.
 */
export function arm2Drift(measured = measureArm2(), baseline = readBaseline()) {
  const phantom = [];
  const unrecorded = [];
  const stages = [...new Set([...Object.keys(measured.byStage), ...Object.keys(baseline.byStage ?? {})])].sort();
  for (const stage of stages) {
    const now = new Set(measured.byStage[stage] ?? []);
    const was = new Set(baseline.byStage?.[stage] ?? []);
    for (const n of was) if (!now.has(n)) phantom.push(`${stage} / ${n}`);
    for (const n of now) if (!was.has(n)) unrecorded.push(`${stage} / ${n}`);
  }
  return { phantom, unrecorded };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes("--write")) {
    console.error("usage: node driver/test/contract-arm2-baseline.mjs --write\n"
      + "  records the CURRENT element census, and prints every membership change in both directions");
    process.exit(2);
  }
  const measured = measureArm2();
  const { phantom, unrecorded } = existsSync(BASELINE_PATH) ? arm2Drift(measured) : { phantom: [], unrecorded: [] };
  // BOTH LISTS PRINTED BEFORE THE WRITE. They mean opposite things — a phantom leaving is a debt being
  // discharged, an unrecorded element arriving is a new one being taken on — and an author who sees only
  // "wrote the file" has recorded a decision they never read.
  if (phantom.length) { console.error(`${phantom.length} PHANTOM row(s) dropped — recorded but no longer declared:`); for (const l of phantom) console.error(`  ${l}`); }
  if (unrecorded.length) {
    console.error(`${unrecorded.length} element(s) NEWLY recorded as unpoliced — this is a debt being taken on:`);
    for (const l of unrecorded) console.error(`  ${l}`);
    console.error("  Give it a validator token instead, unless it is genuinely unpoliceable — and say which in the PR.");
  }
  if (!phantom.length && !unrecorded.length) console.error("membership unchanged — only counts could have moved");
  const next = { ...readBaselineHeader(), total: measured.total, byStage: measured.byStage };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote ${BASELINE_PATH} (${measured.total} unpoliced element(s))`);
}

/** Keep whatever prose header the committed baseline carries — it is doctrine, not data. */
function readBaselineHeader() {
  try {
    const b = readBaseline();
    const { total, byStage, ...rest } = b;   // eslint-disable-line no-unused-vars
    return rest;
  } catch { return {}; }
}
