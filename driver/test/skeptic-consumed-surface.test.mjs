// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// amendment 3 — `skepticConsumed` reads the TYPED REGISTER, not the narrative prose.
//
// THE RULE THIS ENFORCES: the ladder must not be measured with an instrument it moved. Lever 1 grades
// per-finding narrative prose, so the old surface was the exact thing the ladder shrinks. A graded run
// would have read as a collapse in skeptic uptake while every flag was still weighed, dispositioned and
// printed — a designed reduction, reported as a regression, in the same run records lever 1's own
// counters land in.
//
// The arm that matters is the third: a flag whose entity reached findings.json and NOT narrative.md.
// That is a graded product, and under the old instrument it scored zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { skepticConsumed } from "../gate-metrics.mjs";

const FLAGS = `# Skeptic flags

- The KESTREL axis in class 25 may hold records the sweep did not reach.

ESCALATION DECISIONS
- something after the split, which is not counted
`;
const finding = (extra = {}) => ({
  ordinal: 1, mark: "KESTREL", owner: { name: "Kestrel Holdings AG" }, classes: [25],
  disposition: "adversarial", band: "High", net: "in the way", ...extra,
});
const run = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "gm-skeptic-"));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
};

test("#1503 CONTROL — a flag whose entity is nowhere counts as NOT consumed", () => {
  const dir = run({
    "skeptic-flags.md": FLAGS,
    "findings.json": { findings: [finding({ mark: "MORNDALE", owner: { name: "Brightwater SA" } })] },
    "narrative.md": "# Narrative\n\nNothing about that axis.\n",
  });
  assert.deepEqual(skepticConsumed(dir), { total: 1, consumed: 0, surface: "findings.json" },
    "an entity absent from the register still scored as consumed — the metric reports uptake it cannot see");
});

test("#1503 CONTROL — a flag whose entity is in the register counts as consumed", () => {
  const dir = run({
    "skeptic-flags.md": FLAGS,
    "findings.json": { findings: [finding()] },
    "narrative.md": "# Narrative\n\nKESTREL is discussed at length here.\n",
  });
  assert.deepEqual(skepticConsumed(dir), { total: 1, consumed: 1, surface: "findings.json" });
});

test("#1503 THE GRADED CASE — typed fields, no prose, and the flag still counts as consumed", () => {
  const dir = run({
    "skeptic-flags.md": FLAGS,
    "findings.json": { findings: [finding()] },
    // exactly what a graded product produces: the finding is registered, judged and printed, and no
    // per-finding prose is written about it.
    "narrative.md": "# Narrative\n\nThe adversarial set is treated below.\n",
  });
  assert.deepEqual(skepticConsumed(dir), { total: 1, consumed: 1, surface: "findings.json" },
    "a finding with its full typed field set and no prose scored as UNCONSUMED. That is the measurement "
    + "artefact amendment 3 ruled out — on products 2 and 3 this metric would fall by design and read "
    + "as a regression in skeptic uptake.");
});

test("#1503 a SCHEMA WORD never counts as consumption — keys are excluded from the searched text", () => {
  const dir = run({
    "skeptic-flags.md": "# Skeptic flags\n\n- The Disposition of the sweep was never settled.\n",
    "findings.json": { findings: [finding({ mark: "MORNDALE", owner: { name: "Brightwater SA" } })] },
  });
  assert.deepEqual(skepticConsumed(dir), { total: 1, consumed: 0, surface: "findings.json" },
    '"Disposition" is a key in every findings.json ever written. Matching one would count a flag as '
    + "consumed because the file has the shape it always has — every run would score near 100%.");
});

test("#1503 a run with NO register reads as UNREADABLE, not as zero uptake", () => {
  const dir = run({ "skeptic-flags.md": FLAGS, "narrative.md": "# Narrative\n" });
  assert.equal(skepticConsumed(dir), null,
    "a run with no findings.json returned a score. An absent register is a run this metric cannot read; "
    + "0-of-N would print as a total collapse in skeptic uptake and aggregate into the holdout as one.");
});
