// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The E2E scenario store: CLEAROTRON_E2E_DIR is the ONLY suite (owner ruling 2026-08-07).
//
// WHY THIS EXISTS. The scenarios that can be scored against a lawyer's answer name live client
// matters — they cannot enter this repo, which is de-identified by design. There used to be a bundled
// synthetic fallback here sharing the same IDs with different marks; it was deleted, because two suites
// under one set of IDs is exactly the wrong-matter confusion the swap-whole rule exists to prevent.
// This file pins the three properties that make the single-store design safe:
//
//   1. UNSET REFUSES. There is no fallback; a run with no store says so and stops.
//   2. SET IS EXCLUSIVE AND WHOLE. A configured store is used whole; a missing file refuses, naming
//      the path, and nothing else answers for the ID.
//   3. THE STORE IS SWEPT BEFORE ANYTHING SPENDS. Every job block goes through both admission
//      gates, against the outcome its scenario declares — a store the doors would treat differently
//      than it says refuses the whole invocation, on `list` and on `run`.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { scenarioStore, validateStoreJobs, lintScenarios } from "../../scripts/e2e.mjs";
import { validateJob } from "../enqueue-schema.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const E2E = join(REPO, "scripts", "e2e.mjs");

// A well-formed scenario whose job every door admits. The marker string decides "which store answered".
const GOOD = {
  id: "R1",
  title: "EXTERNAL STORE MARKER — fixture scenario",
  why: ["fixture"],
  door: "cli",
  cost: { measured: true, wallMinutes: 1, note: "fixture" },
  job: { ref: "E2E-R1", markName: "E2E STORE PROBE", classes: [9], product: "knockout-search", forwarder: "e2e" },
  expect: { terminal: "delivered" },
};

/** A store laid out as the config repo lays it out: <root>/scenarios/, <root>/baselines/. */
function makeStore(scenarios = [GOOD]) {
  const root = mkdtempSync(join(tmpdir(), "e2e-store-"));
  mkdirSync(join(root, "scenarios"));
  mkdirSync(join(root, "baselines"));
  for (const sc of scenarios) {
    writeFileSync(join(root, "scenarios", `${sc.id}.json`), JSON.stringify(sc, null, 2));
  }
  return root;
}

/** `list` needs no pool; `run` needs one to clear refuseProduction before it reaches the loader. */
function runCli(args, env = {}) {
  const r = spawnSync("node", [E2E, ...args], {
    encoding: "utf8",
    env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: "", CLEAROTRON_REPORTS_DIR: "", CLEAROTRON_QUEUE_DIR: "", ...env }),
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ── the resolver itself ───────────────────────────────────────────────────────────────────────────

test("unset resolves to NO store — there is no bundled fallback", () => {
  const s = scenarioStore({});
  assert.equal(s.external, false);
  assert.equal(s.root, null);
  assert.equal(s.dir, null, "no directory: the bundled suite is gone");
  assert.match(s.label, /unset/, "the label says why nothing will run");
});

test("an empty or whitespace value counts as unset, exactly as CLEAROTRON_CUSTOMERS_DIR does", () => {
  for (const v of ["", "   ", "\t", "\n"]) {
    const s = scenarioStore({ CLEAROTRON_E2E_DIR: v });
    assert.equal(s.external, false, `${JSON.stringify(v)} must not select an external store`);
    assert.equal(s.dir, null);
  }
});

test("CLEAROTRON_E2E_DIR names the store's e2e/ directory, and scenarios sit beneath it", () => {
  // One variable has to reach both halves: the harness reads scenarios/, the scorer reads baselines/.
  // If this ever becomes the scenarios directory itself, the scorer loses its reference path.
  const s = scenarioStore({ CLEAROTRON_E2E_DIR: "/srv/config/e2e" });
  assert.equal(s.external, true);
  assert.equal(s.root, "/srv/config/e2e");
  assert.equal(s.dir, join("/srv/config/e2e", "scenarios"));
  assert.match(s.label, /CLEAROTRON_E2E_DIR=\/srv\/config\/e2e/, "the label names the path, for the run log");
});

test("the value is trimmed, so a trailing newline in an .env line does not break the path", () => {
  const s = scenarioStore({ CLEAROTRON_E2E_DIR: "  /srv/config/e2e\n" });
  assert.equal(s.root, "/srv/config/e2e");
});

// ── end to end through the CLI ────────────────────────────────────────────────────────────────────

test("unset: refuses, names the ruling and the variable, and lists nothing", () => {
  const { code, out } = runCli(["list"]);
  assert.equal(code, 2, out);
  assert.match(out, /CLEAROTRON_E2E_DIR is unset/);
  assert.match(out, /one suite/i, "says the design, not just the mechanics");
  assert.doesNotMatch(out, /VIBRANTE|VENZY|HALCYON|MERIDIAN/, "no synthetic scenario answered");
});

test("set: the external store is read whole and named in the output", () => {
  const root = makeStore();
  try {
    const { code, out } = runCli(["list"], { CLEAROTRON_E2E_DIR: root });
    assert.equal(code, 0, out);
    assert.match(out, /EXTERNAL STORE MARKER/, "the store's R1 answered");
    assert.match(out, new RegExp(`store: CLEAROTRON_E2E_DIR=${root}`), "the store is named in the output");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("set but the file is missing: refuses, names the path, and nothing else answers for the ID", () => {
  const root = makeStore();                  // R2 deliberately absent
  const pool = mkdtempSync(join(tmpdir(), "e2e-pool-"));
  try {
    const { code, out } = runCli(["run", "R2"], {
      CLEAROTRON_E2E_DIR: root, CLEAROTRON_REPORTS_DIR: pool, CLEAROTRON_QUEUE_DIR: pool,
    });
    assert.equal(code, 2, out);
    assert.match(out, new RegExp(join(root, "scenarios", "R2.json").replace(/[.]/g, "\\.")), "names the path it looked for");
    assert.match(out, /ONLY suite/, "says plainly there is no fallback");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(pool, { recursive: true, force: true }); }
});

test("set to a directory that is not there: refuses loudly", () => {
  const { code, out } = runCli(["list"], { CLEAROTRON_E2E_DIR: "/nonexistent/config/e2e" });
  assert.equal(code, 2, out);
  assert.match(out, /store unreadable/);
  assert.match(out, /\/nonexistent\/config\/e2e\/scenarios/, "names the resolved path, not just the env var");
  assert.match(out, /CLEAROTRON_E2E_DIR/, "names the variable to fix");
});

// ── — the admission sweep, now a harness property rather than a CI-only test ─────────────────
//
// The sweep itself lives in scripts/e2e.mjs (`validateStoreJobs`) because it must run where the store
// exists — CI cannot read the private config repo. What CI pins here, through fixtures, is that the
// mechanism works and that `list`/`run` actually invoke it. The real store is swept on the box on
// every invocation.

test("#490: a store whose jobs match their declared outcomes sweeps clean", () => {
  const clarify = {
    ...GOOD, id: "R0",
    cases: [{
      id: "R0x-retired-product",
      job: { ref: "E2E-R0x", markName: "PROBE", classes: [9], product: "prelim-register-only", forwarder: "e2e" },
      expect: { terminal: "clarify" },
    }],
  };
  delete clarify.job; delete clarify.expect;
  assert.deepEqual(validateStoreJobs([GOOD, clarify]), []);
});

test("#490: a scenario expecting `delivered` that the doors refuse is caught, named, and blocks the CLI", () => {
  const bad = structuredClone(GOOD);
  bad.id = "R2";
  bad.job.ref = "E2E-R2";
  bad.job.searchLevel = "prelim-jx";          // the retired vocabulary every door refuses by name
  const wrong = validateStoreJobs([bad]);
  assert.equal(wrong.length, 1, JSON.stringify(wrong));
  assert.match(wrong[0], /R2/);
  assert.match(wrong[0], /wants ADMITTED/);

  const root = makeStore([bad]);
  try {
    const { code, out } = runCli(["list"], { CLEAROTRON_E2E_DIR: root });
    assert.equal(code, 2, out);
    assert.match(out, /doors disagree/, "the CLI refuses before anything spends");
    assert.match(out, /R2/, "and names the scenario");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#490: a refusal case the doors would ADMIT is the same defect from the other side — it would spend", () => {
  const spendy = {
    ...GOOD, id: "R0",
    cases: [{
      id: "R0y-admissible-but-expects-clarify",
      job: { ...GOOD.job, ref: "E2E-R0y" },   // perfectly admissible
      expect: { terminal: "clarify" },
    }],
  };
  delete spendy.job; delete spendy.expect;
  const wrong = validateStoreJobs([spendy]);
  assert.equal(wrong.length, 1, JSON.stringify(wrong));
  assert.match(wrong[0], /R0y/);
  assert.match(wrong[0], /wants REFUSED/);
});

test("#490: and the underlying refusal is real — the retired vocabulary is refused by the schema itself", () => {
  // Guards the guard: if validateJob ever stops refusing searchLevel/caseLaw, the sweep above passes
  // for the wrong reason. Proved by construction rather than asserted.
  const retired = validateJob({ id: "e2e-probe", ...GOOD.job, searchLevel: "prelim-jx", caseLaw: true });
  assert.notEqual(retired.classify, "run");
  const clean = validateJob({ id: "e2e-probe", ...GOOD.job });
  assert.equal(clean.classify, "run", clean.errors.join("; "));
});

// ── the store lint — each rule pinned through a fixture that violates it ──────────────────────────

test("lint: a duplicate case without oneMatterAcrossDoors is caught, and the flag anywhere else too", () => {
  const sc = { ...GOOD, id: "R0", cases: [
    { id: "R0d-dup", job: { ...GOOD.job, ref: "E2E-R0d" }, expect: { terminal: "duplicate" } },
    { id: "R0e-live", oneMatterAcrossDoors: true, job: { ...GOOD.job, ref: "E2E-R0e" }, expect: { terminal: "delivered" } },
  ]};
  delete sc.job; delete sc.expect;
  const { wrong } = lintScenarios([sc]);   // — {wrong, dead}; these arms are about the refusing half
  assert.equal(wrong.length, 2, JSON.stringify(wrong));
  assert.match(wrong[0], /R0d-dup.*without oneMatterAcrossDoors/);
  assert.match(wrong[1], /R0e-live.*not expecting/);
});

test("lint: an assert against _driver/scope-ledger.json is caught — the engine never writes it", () => {
  const sc = structuredClone(GOOD);
  sc.expect.assert = [{ what: "territories", path: "_driver/scope-ledger.json:territories", op: "length", value: 1 }];
  const { wrong } = lintScenarios([sc]);   // — {wrong, dead}; these arms are about the refusing half
  assert.equal(wrong.length, 1, JSON.stringify(wrong));
  assert.match(wrong[0], /instructed-scope/, "and the message names the record that IS written");
});

test("lint: a knockout deliverable missing an honesty op is caught (#324)", () => {
  const sc = structuredClone(GOOD);
  sc.expect.artifacts = ["knockout-assessment.md", "status.json"];
  sc.expect.assert = [{ what: "pipeline", path: "_driver/search-policy.json:pipeline", op: "equals", value: "knockout" }];
  const { wrong } = lintScenarios([sc]);   // — {wrong, dead}; these arms are about the refusing half
  assert.equal(wrong.length, 4, JSON.stringify(wrong));
  for (const op of ["no-wildcard-exact-pair", "names-configured-depth", "register-claims-within-counts", "survivor-not-clear"]) {
    assert.ok(wrong.some((w) => w.includes(op)), `missing ${op} must be named`);
  }
});

test("lint: absolute or traversing artifact names, a missing wall figure, and the removed ack gate", () => {
  const sc = structuredClone(GOOD);
  sc.expect.artifacts = ["/etc/passwd", "../escape.md"];
  sc.cost = { measured: true, requiresAck: true };
  const { wrong } = lintScenarios([sc]);   // — {wrong, dead}; these arms are about the refusing half
  assert.equal(wrong.length, 4, JSON.stringify(wrong));
  assert.ok(wrong.some((w) => /wallMinutes/.test(w)));
  assert.ok(wrong.some((w) => /requiresAck/.test(w)));
  assert.equal(wrong.filter((w) => /plain run-relative/.test(w)).length, 2);
});

test("lint: the CLI refuses a store that fails lint, before anything spends", () => {
  const sc = structuredClone(GOOD);
  sc.cost = { measured: true, wallMinutes: 1, requiresAck: true, note: "fixture" };
  const root = makeStore([sc]);
  try {
    const { code, out } = runCli(["list"], { CLEAROTRON_E2E_DIR: root });
    assert.equal(code, 2, out);
    assert.match(out, /requiresAck/, "names the rule");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
