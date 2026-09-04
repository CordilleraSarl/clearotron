// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// score-previous-auto.test.mjs — `score.mjs <ID> --run <dir> --previous auto`.
//
// A noise-floor pair is two runs of one scenario on one commit, and the whole point of a pair is
// to compare the two. Before this, comparing them meant the operator holding the earlier round's path —
// at exactly the moment the round is most expensive and the operator most tired, and after the harness
// had already thrown the earlier round's token away. `auto` resolves it from the scenario's declared
// refs and the workspace archive.
//
// THE FAILURE MODE THIS PINS is not "auto is wrong" — it is "auto quietly resolves to nothing" and the
// delta section then prints `no previous run given`, which reads as the operator's omission rather than
// as the tool's. An unresolvable `auto` is an absence, and an absence is a finding.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCORE = join(REPO, "scripts", "score.mjs");

const SCENARIO = {
  id: "R1", title: "PAIR FIXTURE", why: ["fixture for #514"], door: "cli",
  cost: { measured: true, wallMinutes: 1 },
  job: { ref: "E2E-R1", markName: "E2E PAIR PROBE", classes: [9], product: "knockout-search", forwarder: "e2e" },
  expect: { terminal: "delivered" },
};

const GOLD = {
  schema_version: 1, scenario: "R1", mark: "E2E PAIR PROBE",
  source: "fixture — no lawyer answered this; it exists to drive the delta section",
  register: [{ mark: "PAIRPROBE ALPHA", owner: "Fixture Holdings", classes: [9] }],
};

function makeBox() {
  const root = mkdtempSync(join(tmpdir(), "score-auto-"));
  const store = join(root, "store");
  mkdirSync(join(store, "scenarios"), { recursive: true });
  mkdirSync(join(store, "baselines"), { recursive: true });
  writeFileSync(join(store, "scenarios", "R1.json"), JSON.stringify(SCENARIO, null, 2));
  writeFileSync(join(store, "baselines", "R1.gold.json"), JSON.stringify(GOLD, null, 2));
  const ws = join(root, "workspace");
  mkdirSync(ws, { recursive: true });
  return { root, store, ws };
}

/** A completed run: findings.json is what makes it scoreable, status.json what makes it discoverable. */
function putRun(box, name, { ref, startedAt, marks = [] }) {
  const dir = join(box.ws, "runs", name);
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ schema: 1, runId: name, ref, state: "delivered", startedAt }, null, 2));
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: marks.map((m) => ({ mark: m, owner: { name: "Fixture Holdings" } })) }, null, 2));
  writeFileSync(driverDir(dir, "instructed-scope.json"), JSON.stringify({ classes: [9], jurisdictions: ["CH"] }, null, 2));
  return dir;
}

function score(box, args) {
  const r = spawnSync("node", [SCORE, ...args], { encoding: "utf8",
    env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: box.store, CLEAROTRON_WORK_DIR: box.ws }) });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("--previous auto resolves the OTHER HALF of the pair and produces a real delta", () => {
  const box = makeBox();
  try {
    const A = putRun(box, "run-a", { ref: "E2E-R1-1a2b3c4d", startedAt: "2026-08-07T22:00:00.000Z", marks: ["PAIRPROBE ALPHA"] });
    const B = putRun(box, "run-b", { ref: "E2E-R1-9f8e7d6c", startedAt: "2026-08-07T22:20:00.000Z", marks: [] });

    const r = score(box, ["R1", "--run", B, "--previous", "auto"]);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.includes(`--previous auto → ${A}`), `auto must resolve to the earlier round's dir:\n${r.out}`);
    assert.match(r.out, /1a2b3c4d/, "…and say which round token that was");
    assert.doesNotMatch(r.out, /no previous run given/, "auto must never degrade into the operator-omitted branch");
    // A REAL delta, not just the section header: round A found the reference mark and round B did not,
    // so the entry MOVED bucket. A section that printed "no bucket changed" would pass a presence check
    // while comparing a run against itself.
    assert.match(r.out, /PAIRPROBE ALPHA: found → lost/, `the delta must name the entry that moved:\n${r.out}`);

    // And the pairing is directional: A has nothing before it.
    const alone = score(box, ["R1", "--run", A, "--previous", "auto"]);
    assert.equal(alone.code, 2, "one round is not a pair, and that is an error rather than an empty delta");
    assert.match(alone.out, /could not resolve/);
    assert.match(alone.out, /1a2b3c4d/, "…naming the rounds it did see");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("--previous auto with nothing to search DIES rather than scoring a lone run as though it were a pair", () => {
  const box = makeBox();
  try {
    const B = putRun(box, "run-b", { ref: "E2E-R1-9f8e7d6c", startedAt: "2026-08-07T22:20:00.000Z", marks: [] });
    const r = spawnSync("node", [SCORE, "R1", "--run", B, "--previous", "auto"], { encoding: "utf8",
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: box.store, CLEAROTRON_WORK_DIR: "" }) });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.equal(r.status, 2, out);
    assert.match(out, /CLEAROTRON_WORK_DIR/, "an unset workspace root is NOT `there is no earlier round`");
    assert.doesNotMatch(out, /no previous run given/);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("an explicit --previous <dir> still works, for a preserved run dir outside any workspace", () => {
  const box = makeBox();
  try {
    const A = putRun(box, "run-a", { ref: "E2E-R1-1a2b3c4d", startedAt: "2026-08-07T22:00:00.000Z", marks: ["PAIRPROBE ALPHA"] });
    const B = putRun(box, "run-b", { ref: "E2E-R1-9f8e7d6c", startedAt: "2026-08-07T22:20:00.000Z", marks: [] });
    const r = score(box, ["R1", "--run", B, "--previous", A]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PAIRPROBE ALPHA: found → lost/);
    assert.doesNotMatch(r.out, /--previous auto →/, "the literal path is used as given, not re-resolved");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});
