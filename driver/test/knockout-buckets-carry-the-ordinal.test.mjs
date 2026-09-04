// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// (folded into) — ON A KNOCKOUT RUN, NO SCORED FINDING WAS IDENTIFIABLE.
//
// gave `found.matched_ordinal` its value, and deliberately did NOT carry an ordinal into the
// knockout map: a knockout finding cannot reach `found` at all, by three independent routes, so the
// field would have been computed and read by nothing. Its own comment named the real gap and left it —
// `noise` and `additional`, the buckets a knockout finding DOES reach, recorded no ordinal either.
//
// So a knockout score named a mark, an owner and a band, and nothing tying the row back to the finding
// that produced it. `KNOCKOUT_FINDING_KEYS` declares `ordinal` and findings-model validates it as an
// integer >= 1, so the number existed on every row and was dropped twice on the way out: once by the map
// in scripts/score.mjs, once by the two push sites in reference-score.mjs.
//
// THE MAP IS A CLI SCRIPT WITH NO EXPORTS, so the only instrument that can reach it is a SUBPROCESS over
// a fixture run — the same reason score-boundary-carries-ordinal.test.mjs exists. A unit test that hands
// the scorer findings it built itself passes on the broken boundary, which is how this survived.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SCORER_VERSION } from "../reference-score.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

// COUNTS-SHAPED, which is what makes this the knockout lane: `countShaped` passes `reference: []`, the
// entry loop never runs, and every finding falls to `noise` or `additional`. `pre_accepted` is what
// routes one of them to `additional` instead.
const GOLD = {
  schema_version: 1,
  scenario: "BF9",
  source: "synthetic fixture, this test — never a real matter",
  // Non-empty because the reference validator requires it ("a malformed reference reads as a clean
  // sweep"). It is never scored for recall here: `countShaped` passes `reference: []` to scoreRecall,
  // which is exactly the lane behaviour these arms depend on.
  register: [{ mark: "ZEPHYR CORP" }],
  counts: [{ mark: "ZEPHYR", territory: "US", live: 3 }],
  pre_accepted: [{ mark: "KELBROOK", why: "the client already coexists with this one" }],
};

const KNOCKOUT = {
  marks: [{
    name: "ZEPHYR",
    findings: [
      // → noise, carrying its ordinal
      { ordinal: 4, name: "ZEPHYRA", band: "High", type: "Active Business", url: "https://example.invalid/1" },
      // → additional (pre-accepted), carrying its ordinal
      { ordinal: 2, name: "KELBROOK", band: "Medium", type: "Famous Brand", url: "https://example.invalid/2" },
      // → noise with NO ordinal: a stated absence, never a position in the list
      { name: "NIMBUS", band: "Low", type: "Active Business", url: "https://example.invalid/3" },
    ],
  }],
};

function scoreKnockout() {
  const store = mkdtempSync(join(tmpdir(), "ko-ordinal-store-"));
  const run = mkdtempSync(join(tmpdir(), "ko-ordinal-run-"));
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "BF9.gold.json"), JSON.stringify(GOLD, null, 2));
    writeFileSync(join(run, "knockout-findings.json"), JSON.stringify(KNOCKOUT, null, 2));
    const r = spawnSync("node", [SCORE, "BF9", "--run", run, "--json"], {
      encoding: "utf8",
      // BOTH scrubbed before ours is set — an inherited CLEAROTRON_E2E_DIR would point this at the config
      // store's real gold sets, which are live client matter, and the run would read as clean.
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    assert.equal(r.status, 0, `score.mjs refused the fixture:\n${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
}

test("#1599 a knockout finding in `noise` names which finding it was", () => {
  const out = scoreKnockout();
  const noise = out.buckets.noise ?? [];
  assert.ok(noise.length, `nothing reached noise — the fixture is not exercising the lane:\n${JSON.stringify(out.buckets)}`);
  const zephyra = noise.find((n) => n.mark === "ZEPHYRA");
  assert.ok(zephyra, `ZEPHYRA is not in noise: ${JSON.stringify(noise)}`);
  assert.equal(zephyra.ordinal, 4,
    "a scored knockout finding carries no ordinal, so nothing ties this row back to the finding it came from");
});

test("#1599 a pre-accepted knockout finding in `additional` names it too", () => {
  const out = scoreKnockout();
  const additional = out.buckets.additional ?? [];
  const kelbrook = additional.find((a) => a.mark === "KELBROOK");
  assert.ok(kelbrook, `the pre-accepted mark did not reach additional: ${JSON.stringify(additional)}`);
  assert.equal(kelbrook.ordinal, 2);
  // The bucket's own reason survives — this arm must not have quietly turned an `additional` into noise.
  assert.match(String(kelbrook.why ?? ""), /coexist|pre-accepted/i);
});

test("#1599 THE CONTROL — a finding with no ordinal scores null, never a position", () => {
  // `findings` is a filtered list by the time the scorer sees it, so an index is a plausible WRONG
  // number and worse than a stated absence. This arm is what fails if the fix ever derives the value.
  const out = scoreKnockout();
  const nimbus = (out.buckets.noise ?? []).find((n) => n.mark === "NIMBUS");
  assert.ok(nimbus, "NIMBUS is missing from noise");
  assert.equal(nimbus.ordinal, null);
});

test("#1599 the stamp moved, because what these buckets RECORD changed", () => {
  // At 5 and below, an absent ordinal cannot be told from a scorer that never looked — the same
  // distinction the v3→v4 note draws for `matched_ordinal`, one bucket set over. A reader comparing a
  // 5 and a 6 is comparing two instruments, and only the version says so.
  //
  // PINNED TO THE EXACT VALUE ON PURPOSE, and it did its job: the bump to 7 reddened this arm and sent
  // its author here to say why the stamp moved, which is the conversation the pin exists to force. It is
  // deliberately not a `>=` — a floor would let the stamp move silently, and the whole point of the
  // stamp is that a move is never silent.
  //
  // v7: the delivery line stopped reading a MISSING status.json as a refusal.
  // At 6 and below every archived run scored as THE ORDER WAS REFUSED, above correct numbers, because
  // the pool preserves no status.json. A v6 delivery verdict on a pool dir is not comparable to a v7 one.
  // The ordinal distinction this arm is named for is unaffected and still holds at 7.
  assert.equal(SCORER_VERSION, 7);
  assert.equal(scoreKnockout().scorer_version ?? SCORER_VERSION, 7);
});
