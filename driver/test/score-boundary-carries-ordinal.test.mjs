// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE SCORER'S INPUT IS A PROJECTION, AND A FIELD IT DOES NOT LIST IS DROPPED IN TRANSIT.
//
// `found[].matched_ordinal` was added so a reader can tell WHICH finding earned a find — on a run
// holding five findings whose marks are the gold label or start with it, the matched mark STRING does
// not say which one. It was null on every find of every preserved run measured (thirty finds across
// five runs, 2026-08-22 — cited by round and date because a run codename is a client identifier and
// this tree is de-identified by design).
//
// Nothing upstream was missing. `ordinal` is the FIRST key of both FINDING_KEYS and FINDING_KEYS_V4, so
// findings.json carries it and the model validates it. `scripts/score.mjs` builds the scorer's rows by
// an explicit field-by-field map and that map did not list `ordinal`, so `hit.ordinal` was always
// undefined and reference-score.mjs did exactly what it was written to do: recorded null.
//
// WHY THE EXISTING TEST DID NOT SEE IT, WHICH IS THE POINT OF THIS FILE.
// `reference-score.test.mjs` constructs findings carrying `ordinal` and hands them straight to the
// scorer. The scorer's logic is correct, so it passes — it is never fed by the real boundary. The map
// lives in a CLI script that has no exports and runs top-to-bottom to `process.exit(0)`, so the only
// instrument that can reach it is a SUBPROCESS over a fixture run. That is what this file is.
//
// Read this before adding a field to that map: a component test cannot see an unwired component, and
// asserting through the real boundary is the only arm that discriminates.
import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

const GOLD = {
  schema_version: 1,
  scenario: "BF1",
  source: "synthetic fixture, this test — never a real matter",
  register: [{ mark: "ALPHA" }, { mark: "BRAVO" }, { mark: "CHARLIE" }],
};

// Three findings, one per arm. No `source` on any of them: `evidenceClassOf(undefined)` folds to
// "unknown", which satisfiesReference accepts for a register entry, so all three reach `found`.
const FINDINGS = {
  findings: [
    // CARRIED — an integer ordinal must arrive at the scorer.
    { ordinal: 7, mark: "ALPHA", owner: { name: "Alpha Holdings" }, band: { label: "High" } },
    // ABSENT — a finding genuinely carrying no ordinal must score null, NEVER a position in the list.
    // `scorable` is a FILTERED list, so an index is a plausible wrong number, which is worse than a
    // stated absence. This arm is what fails if the fix ever derives the value.
    { mark: "BRAVO", owner: { name: "Bravo Ltd" }, band: { label: "Medium" } },
    // NON-INTEGER — the boundary normalizes on the same predicate the scorer guards with.
    { ordinal: "3", mark: "CHARLIE", owner: { name: "Charlie SA" }, band: { label: "Low" } },
  ],
};

function scoreFixture() {
  const store = mkdtempSync(join(tmpdir(), "score-ordinal-store-"));
  const run = mkdtempSync(join(tmpdir(), "score-ordinal-run-"));
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "BF1.gold.json"), JSON.stringify(GOLD, null, 2));
    writeFileSync(join(run, "findings.json"), JSON.stringify(FINDINGS, null, 2));
    const r = spawnSync("node", [SCORE, "BF1", "--run", run, "--json"], {
      encoding: "utf8",
      // BOTH names scrubbed before ours is set. An inherited CLEAROTRON_E2E_DIR would point this at the
      // config store's real gold sets, which are live client matter, and the run would read as clean.
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    // `die()` exits 2. Without this the JSON parse would throw somewhere unhelpful, and a fixture that
    // trips a refusal would otherwise be indistinguishable from "the field is null".
    assert.equal(r.status, 0, `score.mjs refused the fixture:\n${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
}

test("the run→scorer boundary carries `ordinal`, so a find names which finding earned it", () => {
  const out = scoreFixture();
  const found = out.buckets.found;
  const byMark = new Map(found.map((f) => [f.mark, f]));

  assert.equal(found.length, 3, `all three fixture entries should be found — got ${found.length}`);
  assert.equal(byMark.get("ALPHA").matched_ordinal, 7,
    "the finding's own ordinal must survive the map in scripts/score.mjs — null here is the #1596 defect: "
    + "the field is computed by the scorer and starved by the boundary");
});

test("an ordinal the finding does not carry scores null, never a position in the list", () => {
  const byMark = new Map(scoreFixture().buckets.found.map((f) => [f.mark, f]));

  // BRAVO is the second gold entry and the second finding, so an index-derived value would read 1 or 2
  // and look entirely plausible. That is the number this arm exists to refuse.
  assert.equal(byMark.get("BRAVO").matched_ordinal, null,
    "a finding carrying no ordinal must report the absence, not a derived index");
  assert.equal(byMark.get("CHARLIE").matched_ordinal, null,
    'a non-integer ordinal ("3") must normalize to null on the same predicate the scorer guards with');
});

test("the scorer stamps a version that separates a carried ordinal from a starved one", () => {
  // A v3 score carries `matched_ordinal: null` on every find and a post-fix score carries the real
  // number. Those are two instruments, not one measurement described twice, so the stamp has to move or
  // the back-catalogue is unreadable — a reader cannot tell "this finding had no ordinal" from "this
  // scorer could not see ordinals at all".
  assert.ok(scoreFixture().scorer_version >= 4,
    "SCORER_VERSION must move when what a bucket RECORDS changes");
});
