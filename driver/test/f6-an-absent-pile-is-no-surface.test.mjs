// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// f6-an-absent-pile-is-no-surface.test.mjs — a could-not-look must not wear a measurement's clothes.
//
//. F6 (`scoredFetched`) answers "how many scored findings cite a registration this
// run actually fetched". It built its fetched set by reading `_records/`, and when that directory was
// ABSENT it fell through with an empty set — reporting `{total: N, fetched: 0}`, which is the exact
// shape of the alert it exists to raise: "N findings cite records that failed to fetch".
//
// The cost is the AGGREGATE, not one run. `runMetrics` folds every run into one numerator and
// denominator, so a run with no pile at all contributed its whole total to the denominator and nothing
// to the numerator — dragging the fleet-wide figure down with runs that had nothing to measure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scoredFetched } from "../gate-metrics.mjs";

const FINDINGS = { findings: [
  { band: "High", owner: { registrations: [{ uri: "/mark/us/111" }] } },
  { band: "Medium", owner: { registrations: [{ uri: "/mark/us/222" }] } },
] };

/** A run dir with findings, and a `_records/` pile holding exactly the uris named. */
function run({ pile }) {
  const d = mkdtempSync(join(tmpdir(), "f6-"));
  writeFileSync(join(d, "findings.json"), JSON.stringify(FINDINGS));
  if (pile) {
    mkdirSync(join(d, "_records"), { recursive: true });
    for (const uri of pile) {
      writeFileSync(join(d, "_records", uri.replace(/^\/mark\//, "").replace(/\//g, "-") + ".json"),
        JSON.stringify({ _uri: uri }));
    }
  }
  return d;
}

test("2039 THE DEFECT: an ABSENT pile is no surface, not a run that fetched nothing", () => {
  // `pile: null` — the directory does not exist at all, which is what a converted run looks like.
  assert.equal(scoredFetched(run({ pile: null })), null,
    "an absent pile reported a fetch failure — indistinguishable from the alert this metric raises");
});

test("2039 a PRESENT pile still measures, and a missing record is still the alert", () => {
  // The fix must not buy its honesty by going quiet. A cited record that is missing WHILE the pile
  // exists is exactly the fetch failure worth alerting on, and the seam contract keeps it that way:
  // "a picked line with no record is the fetch failure worth alerting on".
  assert.deepEqual(scoredFetched(run({ pile: ["/mark/us/111", "/mark/us/222"] })), { total: 2, fetched: 2 });
  assert.deepEqual(scoredFetched(run({ pile: ["/mark/us/111"] })), { total: 2, fetched: 1 },
    "a record missing from a pile that exists must still count as unfetched");
  assert.deepEqual(scoredFetched(run({ pile: [] })), { total: 2, fetched: 0 },
    "a pile that exists and holds nothing is a run that fetched nothing — a real reading, not an absence");
});

test("2039 the AGGREGATE stops taking a denominator from runs with nothing to measure", () => {
  // This is the cost the single-run reading hides. `runMetrics` accumulates `if (sf)`, so a null
  // contributes NOTHING — while the old `{total: 2, fetched: 0}` contributed 2 to the denominator.
  const absent = scoredFetched(run({ pile: null }));
  const measured = scoredFetched(run({ pile: ["/mark/us/111"] }));
  let num = 0, den = 0;
  for (const sf of [absent, measured]) if (sf) { num += sf.fetched; den += sf.total; }
  assert.equal(den, 2, "a run with no pile still contributed a denominator");
  assert.equal(num, 1);
  // The old behaviour, stated as the arithmetic it produced: 1/4 = 25% instead of 1/2 = 50%.
  const old = { total: 2, fetched: 0 };
  assert.equal(old.total + measured.total, 4,
    "if this stops being 4, the old shape changed and this arm's comparison is stale");
});
