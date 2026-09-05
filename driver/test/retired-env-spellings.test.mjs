// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A setting the operator set that this build does not read — tracker issue 168.
//
// An upgrade across the `PRELIM_*` rename leaves every renamed line in place and readerless. Nothing
// threw, nothing warned, doctor exited 0, and thirteen configured settings on the production install
// were being ignored. This file holds the two halves of the fix apart, because they can fail
// separately and only one of them is table-driven:
//
//   DETECTION — no product code reads a `PRELIM_*` name, so a `PRELIM_*` that is set is dead. That is
//   an assertion about the TREE, and the arm below measures it rather than trusting it. The day
//   somebody adds a `PRELIM_` reader back, the detection starts lying and this is what says so.
//
//   REPLACEMENT — which name to use instead comes from `NAMES_IN_FORCE`, derived from the build's own
//   readers. A derivation checked only against itself proves nothing, so the oracle here is the
//   THIRTEEN dead names measured in the production install's env file on 2026-09-05 — a population
//   this repo's tooling never saw and cannot influence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RETIRED_PREFIX, retiredSpellingsIn, retiredSpellingLine, warnRetiredEnv,
} from "../../shared/env-aliases.mjs";
import { NAMES_IN_FORCE } from "../../shared/names-in-force.mjs";
import { deriveNamesInForce, sourceFiles } from "../../scripts/mint-names-in-force.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * The thirteen names measured on the production `clearotron` install after it was upgraded from
 * `68f6b17f` to `52cf8e40` — every one set in the deployment's env file, every one with zero readers
 * in the new build. This list is EVIDENCE, not configuration: it is what a real operator's file
 * actually held, and it must never be edited to make a test pass.
 */
const MEASURED_ON_PRODUCTION = Object.freeze([
  "PRELIM_ACCESS_DOMAIN", "PRELIM_AGENT_MCP_URL", "PRELIM_AGENT_WHATSAPP", "PRELIM_CLIENT_MCP_URL",
  "PRELIM_GATHER_CONCURRENCY", "PRELIM_JX_CONSUME", "PRELIM_JX_NATIVEREAD", "PRELIM_JX_SERP_GRID",
  "PRELIM_MAX_CONCURRENT_RUNS", "PRELIM_MCP_URL", "PRELIM_RECIPES_DIR",
  "PRELIM_REQUIRE_EXPLICIT_PORTS", "PRELIM_STALL_MS",
]);

test("tracker issue 168 — every name measured dead on production resolves to the name in force", () => {
  nonEmpty(MEASURED_ON_PRODUCTION, "the production evidence list is empty, so this arm checked nothing");
  const env = Object.fromEntries(MEASURED_ON_PRODUCTION.map((n) => [n, "set-by-an-operator"]));
  const rows = retiredSpellingsIn(env);

  assert.equal(rows.length, MEASURED_ON_PRODUCTION.length,
    "a name that was ignored on the production box is not detected here");
  for (const row of rows) {
    // The point of the issue is the SECOND half of the sentence. A row detected with no replacement
    // tells the operator their setting is dead and leaves them with nowhere to put the value.
    assert.ok(row.replacement,
      `${row.name} was measured live on production and this build names no replacement for it`);
    assert.equal(row.replacement, `CLEAROTRON_${row.name.slice(RETIRED_PREFIX.length)}`);
    assert.ok(NAMES_IN_FORCE.includes(row.replacement),
      `${row.replacement} is named as the replacement but nothing in this build reads it`);
  }
});

test("tracker issue 168 — the detection's premise: no product code reads a retired spelling", () => {
  // THE ASSUMPTION THE WHOLE CHECK RESTS ON. `retiredSpellingsIn` reports every set `PRELIM_*` name as
  // dead without consulting a list. That is only true while nothing reads one. If a reader comes back,
  // the product starts telling an operator that a setting it is actively honouring is being ignored —
  // which is worse than the silence this issue was filed about.
  const files = sourceFiles(REPO);
  nonEmpty(files, "no source files were walked, so this arm proves nothing about the tree");
  const offenders = [];
  for (const rel of files) {
    const text = readFileSync(join(REPO, rel), "utf8");
    for (const m of text.matchAll(/\bPRELIM_[A-Z0-9_]+/g)) offenders.push(`${rel}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [],
    "product code mentions a retired spelling — either it is read (and the detection is now wrong) "
    + "or it is a stale mention that will read as a reader to the next person");
});

test("tracker issue 168 — the names-in-force table is not stale against the tree", () => {
  // Regenerate and compare. This cannot catch a name the derivation never looks for — that is what
  // the production-evidence arm above is for — but it is what stops the table rotting as code moves.
  const fresh = deriveNamesInForce(REPO);
  nonEmpty(fresh, "the derivation returned nothing, so a stale table would compare equal to it");
  assert.deepEqual([...NAMES_IN_FORCE], fresh,
    "shared/names-in-force.mjs disagrees with the tree — re-mint: node scripts/mint-names-in-force.mjs");
});

test("tracker issue 168 — a retired name speaks, a name in force is silent", () => {
  const said = [];
  const emit = (l) => said.push(l);

  warnRetiredEnv({ env: { PRELIM_STALL_MS: "90000" }, note: emit });
  assert.equal(said.length, 1, "a retired spelling produced no line at start-up");
  assert.match(said[0], /RETIRED spelling/);
  assert.match(said[0], /CLEAROTRON_STALL_MS/, "the line does not name the replacement");

  // THE CONTROL, and it is the arm that would have caught a check that warns on everything.
  said.length = 0;
  warnRetiredEnv({ env: { CLEAROTRON_STALL_MS: "90000" }, note: emit });
  assert.deepEqual(said, [], "the name in force produced a warning");

  // EMPTY IS UNSET. An `X=` line in an EnvironmentFile means "not configured", and an operator who
  // blanked the line has already stopped setting it.
  said.length = 0;
  warnRetiredEnv({ env: { PRELIM_STALL_MS: "" }, note: emit });
  assert.deepEqual(said, [], "a blanked retired line was reported as set");
});

test("tracker issue 168 — a setting that went entirely says so, rather than naming a replacement", () => {
  // The two sentences are different actions: rename the line, or delete it. Composing
  // `CLEAROTRON_<SUFFIX>` unconditionally would send an operator to a variable nothing reads, which is
  // the same silent failure one step along.
  const [row] = retiredSpellingsIn({ PRELIM_NO_SUCH_SETTING_EVER: "x" });
  assert.equal(row.replacement, null);
  assert.match(retiredSpellingLine(row), /no longer exists under any name/);
  assert.doesNotMatch(retiredSpellingLine(row), /CLEAROTRON_NO_SUCH_SETTING_EVER/);
});

test("tracker issue 168 — the mint script refuses a stale table", () => {
  // A guard whose only evidence is a green tree on the day it was written is the shape this repository
  // keeps being bitten by. Drive the refusal.
  const out = execFileSync(process.execPath,
    [join(REPO, "scripts", "mint-names-in-force.mjs"), "--check"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /current/);
});
