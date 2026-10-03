// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// settleOneShotStamp — a sanctioned in-pass rewrite is accounted for in a one-shot stage's stamp, and a
// restamp aimed at a file the stage does NOT declare lands a `restamp-miss` row instead of passing silently.
//
// SAFETY GUARD: driver.config freezes workspaceRoot at FIRST import with a PRODUCTION default. Pin it to a
// throwaway root BEFORE any driver module loads, so driver modules are imported DYNAMICALLY below.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

// ZERO SEMANTICS, the FIRING direction. A healthy run logs no `restamp-miss`, which on its own would pass
// just as well if the detector never fired at all. This drives the miss directly: point a restamp at a
// file the stage does not declare and assert the row lands. Without this, the thing built to catch the
// next input-list move is itself untested. The label is step 3's, the helper's live caller.
test("a restamp aimed at a file the stage does NOT declare lands a restamp-miss row — it is never silent", async () => {
  const { settleOneShotStamp } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const { writeStamp } = await import("../stage-freshness.mjs");

  const d = mkdtempSync(join(tmpdir(), "clearotron-restamp-miss-"));
  mkdirSync(driverDir(d), { recursive: true });
  const declared = join(d, "register-named-band.json");
  const undeclared = join(d, "register-findings.md");
  writeFileSync(declared, "band v1");
  writeFileSync(undeclared, "digest v1");
  writeStamp(d, "owner-judgment:1", [declared]);

  writeFileSync(declared, "band v2");         // sanctioned: accounted for, no row
  writeFileSync(undeclared, "digest v2");     // aimed at nothing: a row
  const r = settleOneShotStamp(d, "owner-judgment:1", [declared, undeclared], "unit-probe");
  assert.deepEqual(r.changed, [declared], "only the declared file was accounted for");
  assert.deepEqual(r.missed, [undeclared], "the undeclared file is reported as a miss, not swallowed");

  const rows = readFileSync(driverDir(d, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const miss = rows.filter((e) => e.event === "restamp-miss");
  assert.equal(miss.length, 1, JSON.stringify(rows));
  assert.equal(miss[0].stage, "owner-judgment:1");
  assert.equal(miss[0].path, undeclared);
  assert.equal(miss[0].why, "unit-probe", "the row says which arm's compensating rewrite is aimed at nothing");
  const settled = rows.filter((e) => e.event === "one-shot-stamp-settled");
  assert.deepEqual(settled.map((e) => e.changed), [[declared]], "…and the grant it DID make is recorded beside it");
});
