// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── RULING, 2026-09-17: a NAMED territory the register cannot search is refused BEFORE the run ───────
//
// The rule, and it is one rule rather than one per product:
//
//   · a search that names NO territory always runs — worldwide, on any register, disclosed in the report
//   · a search that NAMES a territory the wired register cannot search is refused at the door, in one
//     sentence naming the territory and what to remove
//   · a saved account default counts as NAMED once it reaches the engine (ruling of the same day), so it
//     is judged with the rest and the requester is told which one to take out
//
// This is NOT a revival of the product-level refusal retired on 2026-08-31.
// `coverage-is-disclosed-never-refused.test.mjs` pins that one RETIRED, and both files must be green at
// once: the product half asks "may this product be sold here", this half asks "can these territories be
// searched". Arm 3 below is the arm that would red if the two were ever folded together.
//
// BREAK MATRIX:
//   · a named uncovered territory refuses                    → break: fail open, arm 1 red
//   · it refuses at the CLIENT-FACING doors too              → break: move the arm inside `availability`, arm 2 red
//   · worldwide still runs on a partial register             → break: judge the product, arm 3 red
//   · an account default is judged                           → break: read job.jurisdictions only, arm 5 red
//   · EU/EM/EUTM are ONE place                               → break: compare raw strings, arm 8 red
//   · a name outside the composer's 37 fails open            → break: bare membership test, arm 9 red
//   · unknown/unrestricted coverage fails open               → break: `covered ?? []`, arm 7 red
//   · the sentence names the territory and the remedy        → break: reword either half, arms 1/10 red
//   · the label and the covered set come off the SNAPSHOT    → break: stop writing either, arm 11 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { uncoveredTerritories, registerReachRefusal } from "../register-coverage.mjs";
import { buildFlagSnapshot, snapshotPath, registerLabelFor } from "../flag-snapshot.mjs";
import { PROMPT_TERRITORIES } from "../compose-read.mjs";

// The wired register's reach as MEASURED through the real `coveredTerritoryNames` on 2026-09-17 — ten of
// the composer's 37. Not invented: China, Japan and Korea are genuinely outside it, which is the case
// this rule was filed on.
const SIGNA = Object.freeze(["Australia", "Canada", "European Union", "France", "Norway",
  "Singapore", "Sweden", "Switzerland", "United Kingdom", "United States"]);
const CLARIVATE = PROMPT_TERRITORIES;          // 37 of 37 — no refusal is reachable
const EU_ONLY = Object.freeze(["European Union"]);

const gate = await (async () => {
  // Env BEFORE the import: `poolRootOrNull` reads CLEAROTRON_REPORTS_DIR, and a module that captured it
  // at import time would read the box's real pool instead of this test's.
  const pool = mkdtempSync(join(tmpdir(), "reach-gate-"));
  process.env.CLEAROTRON_REPORTS_DIR = pool;
  const mod = await import("../door-gates.mjs");
  return { ...mod, pool };
})();

/** A resolution a door would hold, with no clarify — the shape `gateResolvedRequest` gates over. */
const resolvedAs = (product) => ({ product, stageLabel: product, level: product, recipeScope: null });

// A DEFAULT PARAMETER CANNOT CARRY "the caller passed undefined on purpose", and undefined is a value
// this rule has to be driven with: it is the fail-open state. `territories = SIGNA` silently rewrote the
// one case arm 7 exists to test, and the arm went red naming the product — the helper was the defect.
const NOT_GIVEN = Symbol("not given");

/** What the gate says about a request, with the register's reach handed in rather than read off disk. */
function errorsFor({ job, profile = null, product = "multi-country-focus-search",
  territories = NOT_GIVEN, label = NOT_GIVEN, availability = true }) {
  const opts = { availability };
  if (territories !== NOT_GIVEN) opts.registerTerritories = territories;
  else opts.registerTerritories = SIGNA;
  if (label !== NOT_GIVEN) opts.registerLabel = label;
  else opts.registerLabel = "Signa";
  return gate.gateResolvedRequest(
    { job, profile, resolved: resolvedAs(product), readable: true }, opts,
  ).errors;
}

/** Point the gate at a fresh, EMPTY pool for one arm, so a snapshot another arm wrote cannot decide it
 *  and the arms stay order-independent. */
function withPool(fn) {
  const was = process.env.CLEAROTRON_REPORTS_DIR;
  const dir = mkdtempSync(join(tmpdir(), "reach-pool-"));
  process.env.CLEAROTRON_REPORTS_DIR = dir;
  try { return fn(dir); } finally { process.env.CLEAROTRON_REPORTS_DIR = was; }
}

/** Write a flag snapshot into `dir` exactly as the live writer would. */
function writeSnapshot(dir, fields) {
  const file = snapshotPath(dir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(buildFlagSnapshot({}, {
    capturedAt: "2026-09-17T00:00:00Z", registerProvider: "signa", registerCanCount: true, ...fields,
  }), null, 2));
  return file;
}

const REFUSAL_CN = "China is not available with Signa, the register configured here — remove China to run this search.";

test("arm 1 — a multi-country search naming China is refused, and the sentence names the remedy", () => {
  const errors = errorsFor({ job: { geography: { mode: "named" }, jurisdictions: ["China", "United States"] } });
  assert.ok(errors.includes(REFUSAL_CN),
    `the door did not refuse a territory the register cannot search.\n  got: ${JSON.stringify(errors, null, 2)}`);
  // United States IS covered and must not be dragged into the sentence — a refusal that names a
  // territory the register reaches tells the client to remove the wrong one.
  assert.ok(!REFUSAL_CN.includes("United States"));
});

test("arm 2 — the CLIENT-FACING doors get the SAME BYTES, and this is the arm that catches the silent version", () => {
  // The portal (portal-service.mjs) and plan_run (plan.mjs) pass `availability:false`, because they word
  // an unavailable PRODUCT themselves. An arm written inside that block is invisible at exactly the two
  // doors a client orders through, and nothing errors — it just never refuses. Byte-identical, per the
  // ruling's "the same bytes at every door".
  const client = errorsFor({ job: { geography: { mode: "named" }, jurisdictions: ["China"] }, availability: false });
  const staff = errorsFor({ job: { geography: { mode: "named" }, jurisdictions: ["China"] }, availability: true });
  assert.ok(client.includes(REFUSAL_CN), `a client-facing door did NOT refuse: ${JSON.stringify(client)}`);
  assert.deepEqual(client.filter((e) => e === REFUSAL_CN), staff.filter((e) => e === REFUSAL_CN),
    "the client-facing doors and the staff doors must say the same bytes");
});

test("arm 3 — worldwide still RUNS on a partial register: the 2026-08-31 ruling is untouched", () => {
  // The ladder answers [] for a worldwide stamp — worldwide accepts no narrowing, so the account's
  // defaults are not consulted. If this ever refuses, the product-level refusal has come back.
  const errors = errorsFor({
    job: { geography: { mode: "worldwide" } },
    profile: { defaultJurisdictions: ["China", "Japan"] },   // and these must NOT be consulted
    product: "global-preliminary-search",
  });
  assert.ok(!errors.some((e) => /not available with/.test(e)),
    `a worldwide search was refused on a partial register: ${JSON.stringify(errors)}`);
});

test("arm 4 — an account default that IS covered runs", () => {
  const errors = errorsFor({
    job: { geography: { mode: "account-default" } },
    profile: { defaultJurisdictions: ["France", "United States"] },
  });
  assert.ok(!errors.some((e) => /not available with/.test(e)), JSON.stringify(errors));
});

test("arm 5 — an account default that is NOT covered is refused, and named so it can be removed", () => {
  // Owner, 2026-09-17: a saved default counts as named once it reaches the engine, and the client must
  // be able to take it out. Reading job.jurisdictions alone would let this through — the requester typed
  // nothing, and the territory arrives from the profile down the ladder.
  const errors = errorsFor({
    job: { geography: { mode: "account-default" } },
    profile: { defaultJurisdictions: ["France", "Japan"] },
  });
  assert.ok(errors.some((e) => e.includes("Japan") && e.includes("remove Japan")),
    `an account default the register cannot search was accepted: ${JSON.stringify(errors)}`);
});

test("arm 6 — a full country search: Germany refuses, France runs", () => {
  const germany = errorsFor({
    job: { geography: { mode: "named" }, jurisdictions: ["Germany"] }, product: "full-country-search",
  });
  assert.ok(germany.some((e) => e.startsWith("Germany is not available with Signa")), JSON.stringify(germany));
  const france = errorsFor({
    job: { geography: { mode: "named" }, jurisdictions: ["France"] }, product: "full-country-search",
  });
  assert.ok(!france.some((e) => /not available with/.test(e)), JSON.stringify(france));
});

test("arm 7 — a register with no declared limit, and one that did not say, both fail OPEN", () => {
  // `null` — corsearch, a global aggregator that declares no enumerable covered set.
  const unrestricted = errorsFor({
    job: { geography: { mode: "named" }, jurisdictions: ["China", "Japan"] }, territories: null,
  });
  assert.ok(!unrestricted.some((e) => /not available with/.test(e)),
    `an unrestricted register must fail open, got ${JSON.stringify(unrestricted)}`);

  // `undefined` — a snapshot written before coverage shipped. Driven through a REAL snapshot carrying no
  // territories key at all, in a pool of its own, rather than by handing the gate the word undefined:
  // this is the state every deployment is in until its driver next drains, and reading it as "covers
  // nothing" would refuse every named territory on every one of them.
  withPool((dir) => {
    writeSnapshot(dir, { registerLabel: "Signa" });          // no registerTerritories ⇒ key absent
    const errors = gate.gateResolvedRequest(
      { job: { geography: { mode: "named" }, jurisdictions: ["China", "Japan"] }, profile: null,
        resolved: resolvedAs("multi-country-focus-search"), readable: true },
      { availability: false },
    ).errors;
    assert.ok(!errors.some((e) => /not available with/.test(e)),
      `a snapshot that does not say must fail open, got ${JSON.stringify(errors)}`);
  });
  // And the full register refuses nothing at all.
  const clarivate = errorsFor({
    job: { geography: { mode: "named" }, jurisdictions: ["China"] }, territories: CLARIVATE, label: "Clarivate",
  });
  assert.ok(!clarivate.some((e) => /not available with/.test(e)), JSON.stringify(clarivate));
});

test("arm 8 — EU, EM and EUTM are ONE place, on a register that reaches the EU", () => {
  // The defect this pins was made by a fleet measurement on 2026-09-17: the table is keyed EU, the probe
  // asked EM — the register's own code for an EU trade mark — and the empty answer read as "not covered".
  // Pointed at a client that is an EU search refused on an EU register.
  for (const spelling of ["European Union", "EU", "EM", "EUTM", "european union"]) {
    const errors = errorsFor({
      job: { geography: { mode: "named" }, jurisdictions: [spelling] },
      territories: EU_ONLY, label: "EUIPO", product: "multi-country-focus-search",
    });
    assert.ok(!errors.some((e) => /not available with/.test(e)),
      `"${spelling}" was refused on a register that reaches the European Union: ${JSON.stringify(errors)}`);
  }

  // AND THE DIRECTION THAT ACTUALLY DECIDES THE FOLD. Every case above passes whether the fold works or
  // not: drop it and "EM" simply falls outside the composer's vocabulary and fails open — accepted for
  // the wrong reason, with the arm still green. The fold is only load-bearing pointing the other way, on
  // a register that does NOT reach the EU, where "EM" has to be recognised as the European Union and
  // refused. Without it this request is accepted and the client hears nothing about it.
  const onUsOnly = errorsFor({
    job: { geography: { mode: "named" }, jurisdictions: ["EM"] },
    territories: ["United States"], label: "USPTO", product: "multi-country-focus-search",
  });
  assert.ok(onUsOnly.some((e) => e.startsWith("European Union is not available with USPTO")),
    `"EM" was not recognised as the European Union on a register that does not reach it: ${JSON.stringify(onUsOnly)}`);
});

test("arm 9 — a name outside the composer's 37 fails OPEN rather than refusing", () => {
  // `registerTerritories` is scoped to the 37 display names the portal offers. The other doors are not:
  // start_run and the CLI can name VN, which is inside clarivate's own 186-office enum. A bare
  // membership test would refuse a search this engine runs today.
  for (const outside of ["VN", "Vietnam", "Kenya", "ZZ"]) {
    const errors = errorsFor({ job: { geography: { mode: "named" }, jurisdictions: [outside] } });
    assert.ok(!errors.some((e) => /not available with/.test(e)),
      `"${outside}" is outside the snapshot's vocabulary and must fail open: ${JSON.stringify(errors)}`);
  }
});

test("arm 10 — two territories read as a list, and a CODE is named back as its display name", () => {
  const two = errorsFor({ job: { geography: { mode: "named" }, jurisdictions: ["China", "Japan"] } });
  assert.ok(two.includes("China and Japan are not available with Signa, the register configured here"
    + " — remove China and Japan to run this search."), JSON.stringify(two));
  // The requester wrote a code; the sentence must hand back the name they would recognise on the form.
  const code = errorsFor({ job: { geography: { mode: "named" }, jurisdictions: ["cn"] } });
  assert.ok(code.includes(REFUSAL_CN), `a code was not named back as its display name: ${JSON.stringify(code)}`);
});

test("arm 11 — the reach AND the register's label are read off the SNAPSHOT ON DISK", () => {
  // Everything above hands the gate its answer. This arm is the one that proves a real deployment reads
  // one: the writer puts the covered names and the display label in the snapshot, and the door picks
  // both up with no argument at all. Without it, the whole rule could be wired to a field nobody writes.
  withPool((dir) => {
    writeSnapshot(dir, { registerLabel: "Signa", registerTerritories: SIGNA });
    const errors = gate.gateResolvedRequest(
      { job: { geography: { mode: "named" }, jurisdictions: ["China"] }, profile: null,
        resolved: resolvedAs("multi-country-focus-search"), readable: true },
      { availability: false },                   // nothing handed in — read it off disk
    ).errors;
    assert.ok(errors.includes(REFUSAL_CN),
      `the door did not read the register off the snapshot: ${JSON.stringify(errors)}`);
  });
});

test("arm 12 — a snapshot with no label names the register not at all, rather than naming its key", () => {
  // Every snapshot written before the label shipped has none. "not available with signa" is the key
  // leaking into a client's sentence; the fallback drops the clause instead.
  const no = buildFlagSnapshot({}, {
    capturedAt: "2026-09-17T00:00:00Z", registerProvider: "signa", registerCanCount: true,
    registerTerritories: SIGNA,
  });
  assert.equal(registerLabelFor(no), "signa", "the reader falls back to the provider key");
  assert.equal(registerReachRefusal(["China"], null),
    "China is not available with the register configured here — remove China to run this search.");
});

test("arm 13 — the rule itself, over the three coverage states", () => {
  assert.deepEqual(uncoveredTerritories(["China", "France"], SIGNA), ["China"]);
  assert.deepEqual(uncoveredTerritories([], SIGNA), []);
  assert.deepEqual(uncoveredTerritories(["China"], null), [], "no declared restriction");
  assert.deepEqual(uncoveredTerritories(["China"], undefined), [], "the snapshot did not say");
  assert.deepEqual(uncoveredTerritories(["China", "cn", "CHINA"], SIGNA), ["China"], "one place, named once");
  assert.equal(registerReachRefusal([], "Signa"), null, "nothing uncovered ⇒ no sentence");
});
