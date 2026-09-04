// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE SCORER PRINTED THE LABEL THE RUN SHIPPED UNDER AND NEVER THE REVIEWER'S OWN ANSWER.
//
// `verdict:` comes from `_driver/verdict.json` — the CARRIED verdict. `senior-eye-review.md` is the
// reviewer's own, one file away in the same run dir, and nothing in `scripts/` or `shared/` had ever
// read it. On the run was filed on, those two said CONDITIONAL and BLOCKING, and the round
// report published that run as the round's improvement.
//
// TWO LABELLED VALUES, NEVER ONE RECONCILED ONE. They answer different questions — what shipped, and
// what the reviewer wrote — and a scorer that merged them would answer neither.
//
// The comparison is on TIERS, and both directions of getting that wrong are live faults I hit while
// building this:
//   · comparing `verdict.text` — a composite of band, tier, statement and badge joined with `·` —
//     differs from a bare `BLOCKING` on EVERY run ever scored. A tripwire that always fires is one
//     nobody reads.
//   · running `parseVerdict` over that same composite returns null, because it neither leads with a
//     verdict word nor contains the word "verdict". That fires on NONE, which is worse: a silent
//     tripwire is indistinguishable from agreement.
// `verdict.json` records the tier in its own field. Read the field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pinEnv } from "../../shared/env-aliases.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

const GOLD = { schema_version: 1, scenario: "RV1", source: "synthetic fixture, this test — never a real matter", register: [{ mark: "ALPHA" }] };

/**
 * @param {object}      opts
 * @param {string|null} opts.carried   the tier `_driver/verdict.json` records, or null to omit the file
 * @param {string|null} opts.review    senior-eye-review.md's contents, or null to omit the file
 * @param {boolean}     opts.knockout  write the knockout lane's artifacts instead of a clearance verdict
 */
function scoreFixture({ carried = "CONDITIONAL", review = "# BLOCKING\n\nBLOCKING — a cited defect.\n", knockout = false } = {}) {
  const store = mkdtempSync(join(tmpdir(), "reviewer-verdict-store-"));
  const run = mkdtempSync(join(tmpdir(), "reviewer-verdict-run-"));
  try {
    mkdirSync(join(store, "baselines"));
    writeFileSync(join(store, "baselines", "RV1.gold.json"), JSON.stringify(GOLD, null, 2));
    writeFileSync(join(run, "findings.json"), JSON.stringify({ findings: [{ mark: "ALPHA", owner: { name: "Alpha Holdings" } }] }, null, 2));
    mkdirSync(join(run, "_driver"));
    if (knockout) {
      // — this lane writes no _driver/verdict.json, and may write no review either.
      writeFileSync(join(run, "knockout-findings.json"), JSON.stringify({ marks: [{ name: "ALPHA", rating: "Low" }] }, null, 2));
    } else if (carried) {
      writeFileSync(join(run, "_driver", "verdict.json"),
        JSON.stringify({ tier: "Very High", verdict: carried, statement: "a long statement that also rides the display line", badge: "l4" }, null, 2));
    }
    if (review !== null) writeFileSync(join(run, "senior-eye-review.md"), review);

    const r = spawnSync("node", [SCORE, "RV1", "--run", run], {
      encoding: "utf8",
      // Scrubbed before ours is set: an inherited CLEAROTRON_E2E_DIR points at the config store's real gold
      // sets, which are live client matter.
      // pinEnv, not a bare key: CLEAROTRON_WORK_DIR answers to two spellings, and setting one leaves
      // the other holding whatever it inherited.
      env: pinEnv({ ...process.env, CLEAROTRON_E2E_DIR: store }, "CLEAROTRON_WORK_DIR", ""),
    });
    assert.equal(r.status, 0, `score.mjs refused the fixture:\n${r.stderr}`);
    return r.stdout;
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
}

const line = (out, label) => (out.split("\n").find((l) => l.startsWith(label)) ?? "").trim();

test("the reviewer's verdict prints as its own labelled value beside the carried one", () => {
  const out = scoreFixture({ carried: "CONDITIONAL", review: "# BLOCKING\n\nBLOCKING — a cited defect.\n" });

  assert.match(line(out, "verdict:"), /CONDITIONAL/, "the carried verdict still prints");
  assert.match(line(out, "reviewer:"), /^reviewer:\s+BLOCKING$/,
    `the reviewer's own verdict must print on its own labelled line: got "${line(out, "reviewer:")}"`);
});

test("a disagreement is stated at the volume a skimming reader cannot miss", () => {
  const out = scoreFixture({ carried: "CONDITIONAL", review: "# BLOCKING\n" });

  assert.match(out, /\*\*\* VERDICT DISAGREEMENT/,
    "the same `***` prefix the bucket-collision warning uses — a reader skimming for recall numbers "
    + "must not have to notice this");
  assert.match(out, /shipped as CONDITIONAL and its reviewer wrote BLOCKING/,
    "…and it must name BOTH values, so the reader does not have to look them up");
});

test("agreement is silent — the tripwire must not fire on every run", () => {
  // The first fault: comparing the reviewer's bare word against `verdict.text`, which is a COMPOSITE
  // ("Very High · BLOCKING · a long statement… · l4"). That differs from "BLOCKING" always. The
  // fixture's verdict.json carries exactly that composite shape, so this arm fails if the comparison
  // ever goes back to the display string.
  const out = scoreFixture({ carried: "BLOCKING", review: "# BLOCKING\n" });

  assert.match(line(out, "reviewer:"), /BLOCKING/, "both values still print when they agree");
  assert.doesNotMatch(out, /VERDICT DISAGREEMENT/,
    "two BLOCKINGs are not a disagreement — a warning that fires on every run is one nobody reads");
});

test("the tripwire still fires when the tiers really differ — it must not be silenced instead", () => {
  // The second fault, and the worse one: `parseVerdict` over the composite returns null, so the
  // comparison never ran and NOTHING was reported. A silent tripwire looks exactly like agreement.
  for (const [carried, reviewer] of [["CLEAR", "BLOCKING"], ["CONDITIONAL", "CLEAR"], ["BLOCKING", "CONDITIONAL"]]) {
    const out = scoreFixture({ carried, review: `# ${reviewer}\n` });
    assert.match(out, /\*\*\* VERDICT DISAGREEMENT/, `${carried} vs ${reviewer} must be reported`);
    assert.match(out, new RegExp(`shipped as ${carried} and its reviewer wrote ${reviewer}`));
  }
});

test("an absent or empty review prints as unreadable, never as agreement", () => {
  // score.mjs:407 already holds this rule for the carried verdict — "Never a bare (unreadable). An
  // unread verdict is an absence". Silence here would rebuild the hole this issue is about.
  const absent = scoreFixture({ carried: "CONDITIONAL", review: null });
  assert.match(line(absent, "reviewer:"), /NOT READABLE/, "an absent review is an absence, stated");
  assert.match(line(absent, "reviewer:"), /no senior-eye-review\.md/, "…and it names what is missing");
  assert.doesNotMatch(absent, /VERDICT DISAGREEMENT/, "an absence is not a disagreement either");

  const empty = scoreFixture({ carried: "CONDITIONAL", review: "   \n" });
  assert.match(line(empty, "reviewer:"), /NOT READABLE/);
  assert.match(line(empty, "reviewer:"), /present but empty/, "empty and absent are different absences");

  const unparseable = scoreFixture({ carried: "CONDITIONAL", review: "# Review\n\nSome prose with no verdict word.\n" });
  assert.match(line(unparseable, "reviewer:"), /no parseable verdict/,
    "a review that holds no verdict is unreadable, not agreement with whatever shipped");
});

test("the knockout lane prints an honest absence rather than a blank", () => {
  // — this lane writes no _driver/verdict.json and may write no review. Neither value can be had,
  // and both lines must say so rather than print nothing.
  const out = scoreFixture({ knockout: true, review: null });

  assert.match(line(out, "reviewer:"), /NOT READABLE/, "the reviewer line must not go blank on this lane");
  assert.doesNotMatch(out, /VERDICT DISAGREEMENT/,
    "two absences are not a disagreement — this lane would otherwise shout on every knockout run");
});
