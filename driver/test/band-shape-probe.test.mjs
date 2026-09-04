// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scripts/band-shape-probe.mjs — the free half of the noise-floor question.
//
// WHAT IT DEFENDS. The original spec would have reported a noise floor of 0% and called it measured.
// This probe exists to establish, before anyone spends a model turn, WHY that number would be zero: the
// order seam permutes the shape's lists and cannot move a record's tier, because the tier comes from a
// per-record classifier that never reads order.
//
// Two properties, and both must hold or the probe is lying in one of the two available directions:
//
//   armed and moving      — a seam inert when ARMED is the same absence-read-as-success shape, deliberately
//                           shipped. `order-probe.test.mjs` pins it at the unit level; this pins that
//                           buildBandShape actually reaches it.
//   tiers never moving    — if a tier ever moves, the classifier has started reading order.
//
// The band below is synthetic and says so. It is not a fixture of anyone's matter: the probe's own
// behaviour is what is under test, and the real-data run is recorded on the issue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROBE = join(REPO, "scripts", "band-shape-probe.mjs");

/** A band big enough that the in-class floors list has 2+ entries — below that a permutation is identity. */
function runDir({ records = 40 } = {}) {
  const d = mkdtempSync(join(tmpdir(), "probe-run-"));
  mkdirSync(driverDir(d));
  const enumerated = [];
  for (let i = 0; i < records; i++) {
    enumerated.push({
      record_id: `/mark/us/PROBE${i}`, mark_text: i % 3 ? `ZORVIL ${i}` : "ZORVIL",
      classes: [9], status: "REGISTERED", owner_name: `Owner ${i % 4}`, jurisdictions: "US",
      screen: { classes: [9], live_status: "live", screen_verdict: "surface:in-scope-live" },
    });
  }
  writeFileSync(join(d, "register-named-band.json"), JSON.stringify({ enumerated, crowds: [] }));
  // `marks`, an ARRAY — the key pipeline.mjs actually writes. This fixture used to carry `markName`,
  // which the driver has never written, and that is precisely why the suite did not catch the probe
  // reading a key that is never there. A fixture whose shape only the test produces certifies
  // the bug instead of finding it.
  writeFileSync(driverDir(d, "instructed-scope.json"), JSON.stringify({ marks: ["ZORVIL"], classes: [9], jurisdictions: ["US"] }));
  writeFileSync(driverDir(d, "profile.json"), JSON.stringify({ job: { markName: "ZORVIL", classes: [9] } }));
  return d;
}

/** A run dir carrying a band and NOTHING that names the mark — the shape that inverted the answer. */
function targetlessRunDir() {
  const d = runDir();
  rmSync(driverDir(d, "instructed-scope.json"), { force: true });
  rmSync(driverDir(d, "profile.json"), { force: true });
  return d;
}

const run = (args) => {
  const r = spawnSync("node", [PROBE, ...args], {
    encoding: "utf8",
    // Unset, so the probe's own arming is what is measured rather than an inherited seed.
    env: { ...process.env, CLEAROTRON_ORDER_PROBE_SEED: "" },
  });
  // `out` FOLDS BOTH STREAMS, and that is right for the prose arms — they assert on the report, which
  // the probe writes across whichever stream it chooses. It is WRONG for `--json`: stdout carries the
  // document and stderr carries notes about the environment, so concatenating them and parsing the
  // result makes any note a syntax error. made that concrete — the probe now imports the alias
  // loader, which writes a line to stderr when a retired spelling is set, and two arms failed with
  // "Unexpected non-whitespace character after JSON" on a probe that was working correctly.
  //
  // So the streams are returned apart and the JSON arms read `json` alone. This is the probe's own
  // contract — a `--json` consumer reads stdout — and asserting it here is what stops the next thing
  // that writes a warning from reading as a broken document.
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, json: r.stdout ?? "", notes: r.stderr ?? "" };
};

test("the seam moves the shape's lists, and moves no record's tier", () => {
  const d = runDir();
  try {
    const { code, out } = run(["--run", d, "--seed", "7"]);
    assert.equal(code, 0, out);
    assert.match(out, /does the seam move its input\?[\s\S]*?YES/, "armed, the seam is not inert");
    assert.match(out, /does a tier move\?[\s\S]*?NO\./, "and it cannot move a tier");
    assert.match(out, /by_tier census is byte-identical/);
    assert.match(out, /0% by construction rather than by measurement/, "says why the naive floor is zero");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("membership is preserved — a permutation that drops a record is a defect, not a result", () => {
  const d = runDir();
  try {
    const { json, notes } = run(["--run", d, "--seed", "11", "--json"]);
    const j = JSON.parse(json);
    assert.doesNotMatch(json, /\[env-(local|aliases)\]/,
      "an environment note reached STDOUT, where the --json document lives");
    void notes;
    assert.equal(j.membership_broken, false);
    assert.equal(j.seam_moves_input, true);
    assert.deepEqual(j.tier_moves, []);
    assert.equal(j.by_tier_identical, true);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("two seeds permute differently, so the report is not reading one cached derivation", () => {
  const d = runDir();
  try {
    const a = JSON.parse(run(["--run", d, "--seed", "7", "--json"]).json);
    const b = JSON.parse(run(["--run", d, "--seed", "8", "--json"]).json);
    assert.equal(a.seam_moves_input, true);
    assert.equal(b.seam_moves_input, true);
    assert.equal(a.seed, 7);
    assert.equal(b.seed, 8);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a seed probeSeed would reject is refused rather than run as an unarmed arm", () => {
  // The failure this blocks: probeSeed fails CLOSED, so `--seed 0` would leave the second arm unarmed and
  // the probe would report "no movement" — the finding inverted, from an argument typo.
  const d = runDir();
  try {
    for (const bad of ["0", "-1", "abc", "1.5"]) {
      const { code, out } = run(["--run", d, "--seed", bad]);
      assert.equal(code, 2, `--seed ${bad} must refuse: ${out}`);
      assert.match(out, /UNARMED second arm/);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a pool dir has no band, and the error says which directory is wanted", () => {
  const d = mkdtempSync(join(tmpdir(), "probe-pool-"));
  try {
    writeFileSync(join(d, "report.md"), "# a pool dir keeps this and not the band\n");
    const { code, out } = run(["--run", d]);
    assert.equal(code, 2);
    assert.match(out, /WORKSPACE archive dir, not the published pool dir/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("an empty band is a finding about the run, not a probe result", () => {
  const d = mkdtempSync(join(tmpdir(), "probe-empty-"));
  try {
    writeFileSync(join(d, "register-named-band.json"), JSON.stringify({ enumerated: [], crowds: [] }));
    const { code, out } = run(["--run", d]);
    assert.equal(code, 2);
    assert.match(out, /finding about the run, not a probe result/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("it never claims to be the noise floor #217 needs", () => {
  const d = runDir();
  try {
    const { out } = run(["--run", d]);
    assert.match(out, /NOT the noise floor/);
    assert.match(out, /placement-model\.mjs:46/, "and it names where the real floor lives");
    assert.match(out, /Nothing was written/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});


// ── — the two silent defects that inverted this probe's answer ────────────────────────────────

test("with no target it REFUSES rather than reporting no movement", () => {
  // The whole point. Targetless, every record classifies `unclassifiable`, floors is empty, probeOrder
  // returns the identity on a list shorter than two, and the probe printed "NO MOVEMENT … This is a
  // FINDING" — the answer that cancels the paid arms, produced by a missing file.
  const d = targetlessRunDir();
  try {
    const { code, out } = run(["--run", d, "--seed", "7"]);
    assert.equal(code, 2, out);
    assert.match(out, /no target mark could be recovered/);
    // the refusal TEXT names the answer it is refusing to give, so match the section that would
    // carry the conclusion rather than the words
    assert.doesNotMatch(out, /does the seam move its input\?/, "it must not reach the question at all");
    assert.doesNotMatch(out, /This is a FINDING/, "and it must never print the reassuring conclusion");
    assert.match(out, /cancels the paid arms/, "and it says why the refusal matters");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the target comes from instructed-scope `marks`, the key the driver writes", () => {
  const d = runDir();
  try {
    rmSync(driverDir(d, "profile.json"), { force: true });
    const { code, out } = run(["--run", d, "--seed", "7"]);
    assert.equal(code, 0, out);
    assert.match(out, /does the seam move its input\?[\s\S]*?YES/, "targets were recovered from `marks` alone");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the target also comes from _driver/profile.json, which is where the job lives", () => {
  const d = runDir();
  try {
    rmSync(driverDir(d, "instructed-scope.json"), { force: true });
    const { code, out } = run(["--run", d, "--seed", "7"]);
    assert.equal(code, 0, out);
    assert.match(out, /enumerated records/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
