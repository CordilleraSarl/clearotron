// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-dry-run-asks-the-wall.test.mjs — a door must not report a pass on a question it never asked.
//
//. `--dry-run` answered "is this well-formed enough to enqueue?" and was read as
// "will this run?": it reported ok:true, classify:"run" on jobs `claimAndPrep` then rejected outright.
//
// DRIVEN AT THE DOOR, as a subprocess, not through the helper. The defect was that a door reported a
// verdict its own wall disagreed with, so an arm that calls the predicate directly would assert the
// predicate and not the door. These run `driver/enqueue.mjs --dry-run` the way an operator does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ENQUEUE = fileURLToPath(new URL("../enqueue.mjs", import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), "dry-run-wall-"));

/** Run the real door. Returns {code, json} — a refusal exits non-zero and still prints its verdict. */
function dryRun(job, envExtra = {}) {
  const f = join(TMP, `${job.id}.json`);
  writeFileSync(f, JSON.stringify(job));
  let out = "", code = 0;
  try {
    out = execFileSync(process.execPath, [ENQUEUE, "--dry-run", "--job", f],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
        env: { ...process.env, CLEAROTRON_DATABASE: process.env.CLEAROTRON_DATABASE ?? "corsearch", ...envExtra } });
  } catch (e) { out = String(e.stdout ?? ""); code = e.status ?? 1; }
  const i = out.indexOf("{");
  return { code, json: i >= 0 ? JSON.parse(out.slice(i)) : null, raw: out };
}

const base = (extra) => ({ id: `t${Math.random().toString(36).slice(2, 8)}`, markName: "PROBEMARK",
  classes: [9], forwarder: "probe", ...extra });

test("2040 THE DEFECT: a demo profile dry-ran clean and the wall rejected it minutes later", () => {
  const r = dryRun(base({ profileKey: "demo-brand-owner" }));
  assert.equal(r.json.ok, false, "the dry run still reports a pass on a job the wall rejects");
  assert.equal(r.json.classify, "reject",
    "a REJECT is not a CLARIFY — clarify invites a re-send that will fail identically");
  assert.match(r.json.errors.join(" "), /is DEMO DATA/,
    "and it must be the WALL's own sentence, not a paraphrase of it");
  assert.notEqual(r.code, 0, "a refusal must not exit 0");
});

test("2040 the check WIDENS and does not tighten — what would run still runs", () => {
  // Criterion 3. The failure mode of a fix like this is refusing things that would in fact run.
  for (const [job, why] of [
    [base({ profileKey: "generic" }), "an ordinary job on a real account"],
    [base({ profileKey: "demo-brand-owner", demoRun: true }), "the one honest demo combination"],
  ]) {
    const r = dryRun(job);
    assert.equal(r.json.ok, true, `${why} was refused, and it would in fact run: ${r.json.errors ?? ""}`);
    assert.equal(r.json.classify, "run");
    assert.equal(r.code, 0);
  }
});

test("2040 the INVERSE is refused too, and says which way the mismatch runs", () => {
  // A demo banner over a real account's report is the same untruth pointing the other way, and worse.
  const r = dryRun(base({ profileKey: "generic", demoRun: true }));
  assert.equal(r.json.ok, false, "a real account accepted a demo declaration");
  assert.equal(r.json.classify, "reject");
  assert.match(r.json.errors.join(" "), /is a REAL account/);
  assert.doesNotMatch(r.json.errors.join(" "), /is DEMO DATA/,
    "both mismatches printed one sentence — a reader cannot tell which way the disagreement runs");
});

test("2040 the WALL's precedence: an unresolvable request CLARIFIES, and the demo question is never reached", () => {
  // At the wall `!policy.clarify` guards the demo check. A door that asked demo FIRST would reject where
  // the wall clarifies — the same two-surfaces-disagree defect this issue exists to close, reversed.
  const r = dryRun(base({ profileKey: "demo-brand-owner", product: "no-such-product-exists" }));
  assert.equal(r.json.ok, false);
  assert.notEqual(r.json.classify, "reject",
    "the door rejected on demo where the wall would clarify on the unresolvable product");
  assert.doesNotMatch(r.json.errors.join(" "), /is DEMO DATA/,
    "the demo sentence overtook the resolution clarify that the wall reaches first");
});

test("2040 A COULD-NOT-CHECK IS NOT A CHECK — an unreadable STORE says so by name", () => {
  // `demoData` lives on the profile, so this question is unanswerable when the profile STORE cannot be
  // read. Doors fail OPEN by doctrine, which here would mean reporting a pass on a question never asked.
  //
  // DRIVEN BY AN UNREADABLE STORE, not an unknown key, and the difference is the whole arm. An unknown
  // profileKey RESOLVES — it comes back `classify:"clarify"` from the resolution itself — so it never
  // reaches the demo question and never exercises this state at all. The first version of this arm used
  // one and branched on the outcome; it asserted nothing about criterion 4 and the coverage census caught
  // it as an assert site that never ran.
  const r = dryRun(base({ profileKey: "demo-brand-owner" }),
    { CLEAROTRON_CUSTOMERS_DIR: "/nonexistent/profile/store/for/this/arm" });
  assert.equal(r.json.ok, true,
    "an unreadable store must not become a refusal — the doors fail open and the wall still decides");
  assert.equal(r.json.classify, "run");
  assert.ok(Array.isArray(r.json.couldNotCheck) && r.json.couldNotCheck.length === 1,
    "the dry run reported a clean pass on a question it could not ask");
  assert.match(r.json.couldNotCheck[0], /demoData/, "and it must name the field it could not read");
  assert.match(r.json.couldNotCheck[0], /wall still decides/, "and say who does decide it");
});
