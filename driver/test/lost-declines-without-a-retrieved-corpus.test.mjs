// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// `lost` DECLINES FOR THE SAME REASON `withheld` DOES.
//
//, criterion 2. `withheld` says "NOT COMPUTED" on a run dir with no `_driver/`;
// `lost` inherited the same blindness and answered anyway, so the marks it could not classify fell into
// it silently. Measured on the delivered R14 run, one scorer, two directories: `lost` is 3 from the
// workspace archive and 5 from the pool copy, the two that move being withheld from the archive and
// invisible inside `lost` from the pool. A reader scoring the pool sees five never-retrieved marks and
// goes looking for a retrieval problem; the truth is three retrieval failures and two seam failures.
//
// THE A/B IS ONE DIRECTORY. `readRun` computes `hasDriver` from `existsSync` alone and then sets
// `retrieved: hasDriver ? retrievedOf(runDir) : []`, so the presence of `_driver/` is the whole
// difference between a `lost` that is a measurement and a `lost` that is a sum. These two arms differ
// in nothing else — same findings, same gold, same scorer — which is what makes the row the subject.
//
// DRIVEN THROUGH scripts/score.mjs, never by handing rows to a function: the printed row IS the
// deliverable here, and a unit call on the bucket would pass while the reader still saw a number.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pinEnvAll } from "../../shared/env-aliases.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

// One in-scope reference entry the run never surfaces, so it lands in `lost` when `lost` is computable.
const GOLD = {
  schema_version: 1,
  scenario: "BF2",
  source: "synthetic fixture, this test — never a real matter",
  register: [{ mark: "CALDERA", owner: "Verrit Instruments Ltd" }],
};

/** Score one run dir. `withDriver` is the ONLY thing that varies between the two arms. */
function scoreRun(withDriver) {
  const store = mkdtempSync(join(tmpdir(), "lost-decline-store-"));
  const run = mkdtempSync(join(tmpdir(), "lost-decline-run-"));
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "BF2.gold.json"), JSON.stringify(GOLD, null, 2));
    writeFileSync(join(run, "findings.json"), JSON.stringify({ findings: [] }, null, 2));
    // A POOL COPY OMITS BOTH, WHICH IS THE PREMISE. The archive arm gets `_driver/` and nothing else —
    // an empty one is enough, because `hasDriver` is an existsSync and the bucket's soundness turns on
    // whether a retrieved corpus COULD be read, not on what is in it.
    if (withDriver) mkdirSync(join(run, "_driver"));
    const r = spawnSync("node", [SCORE, "BF2", "--run", run], {
      encoding: "utf8",
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    // 2064 — fate before text: an empty output from a child that never returned must not read as the
    // scorer declining. The decline this file is ABOUT arrives as printed text with a real exit.
    if (r.error || r.signal) throw new Error(`the scorer child did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a decline`);
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
}

const lostRow = (out) => (out.split("\n").find((l) => /^\s*lost\b/.test(l)) ?? "");
// THE COUNT COLUMN, not the prose. `row(a, b, c)` pads the value into its own column, and the thing that
// regresses here is a NUMBER appearing where `n/a` belongs. Matching the sentence instead would fail on
// any honest rewording — this arm's first version did exactly that, against wording it had itself asked
// for, because the decline legitimately contains the words "never retrieved".
const lostCount = (out) => (lostRow(out).match(/^\s*lost\s+(\S+)/)?.[1] ?? "");

test("2059 a run dir with NO _driver/ declines `lost` and names what is missing", () => {
  const row = lostRow(scoreRun(false));
  assert.ok(row, "no `lost` row was printed at all");
  assert.equal(lostCount(scoreRun(false)), "n/a",
    `lost still reports a count on a dir with no retrieved corpus: ${row.trim()}`);
  assert.match(row, /_driver\//, "the decline must name _driver/, the way `withheld`'s already does");
});

test("2059 a run dir WITH _driver/ still reports `lost` as a number — the decline is not a blanket", () => {
  // The control, and it is the one that matters: gating this on `registerOnly` instead of `hasDriver`
  // would silence a bucket that is perfectly computable on every register-only and knockout run.
  const row = lostRow(scoreRun(true));
  assert.ok(row, "no `lost` row was printed at all");
  assert.match(lostCount(scoreRun(true)), /^\d+$/,
    `lost declined on a dir that HAS a retrieved corpus to read: ${row.trim()}`);
  assert.match(row, /never retrieved/, "the computable case must keep its own sentence");
});

test("2059 `withheld` and `lost` decline in ONE voice, so a reader is not told two stories", () => {
  const out = scoreRun(false);
  const withheld = out.split("\n").find((l) => /^\s*withheld\b/.test(l)) ?? "";
  assert.match(withheld, /NOT COMPUTED/, "the sibling row changed shape — this arm is now measuring nothing");
  assert.match(lostRow(out), /NOT COMPUTED/, "`lost` declines in different words from `withheld`, one row apart");
});
