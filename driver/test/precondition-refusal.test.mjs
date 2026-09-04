// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// precondition-refusal.test.mjs — the refusals refuse, and say the things a reader needs.
//
//. A guard that has never been seen to fire is not a guard, and this one's whole
// value is the MESSAGE: the failure it replaces was "exactly one VELTRIPHEN ran (got )", which reads as
// a product defect and cost an hour of diagnosis, a withdrawn fleet notice, and a correct ruling nearly
// discarded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { requiresTheSuiteRunner } from "./precondition-refusal.mjs";

/** Run `fn` with the named variables removed, then put the environment back exactly as it was. */
const without = (keys, fn) => {
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try { return fn(); }
  finally { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

/** Run `fn` with the named variables SET, then put the environment back exactly as it was. */
const with_ = (pairs, fn) => {
  const saved = new Map(Object.keys(pairs).map((k) => [k, process.env[k]]));
  Object.assign(process.env, pairs);
  try { return fn(); }
  finally { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test("2030 with the precondition present it returns quietly — the control", () => {
  // This arm SUPPLIES the environment rather than assuming the wrapper did. Assuming it is how this
  // file failed bare with `the refusal fired on an invocation that DID supply its environment` — a
  // false accusation standing in for an absent precondition, which is the exact defect 2030 exists to
  // stop. A file about that failure must not commit it, and it must be runnable on the bare path the
  // issue names as the one a developer debugging a single file actually takes.
  with_({ CLEAROTRON_DATABASE: "corsearch", CLEAROTRON_NO_ENV_FILE: "1" }, () => {
    assert.doesNotThrow(() => requiresTheSuiteRunner("the control"),
      "the refusal fired on an invocation that DID supply its environment");
  });
});

test("2030 each missing variable is refused BY NAME, and the message says the command", () => {
  for (const key of ["CLEAROTRON_DATABASE", "CLEAROTRON_NO_ENV_FILE"]) {
    const err = without([key], () => {
      try { requiresTheSuiteRunner("a subject"); return null; } catch (e) { return e; }
    });
    assert.ok(err, `${key} was absent and the refusal did not fire`);
    assert.match(err.message, new RegExp(`missing  ${key}`),
      `the refusal fired but did not name ${key}, so a reader cannot act on it`);
    assert.match(err.message, /node scripts\/test-run\.mjs node --test/,
      "the refusal must say the command — naming the variable alone leaves the reader to guess the fix");
    assert.match(err.message, /a subject/, "and it names which file stopped");
  }
});

test("2030 the refusal does not read as a product failure — the whole point", () => {
  const err = without(["CLEAROTRON_DATABASE", "CLEAROTRON_NO_ENV_FILE"], () => {
    try { requiresTheSuiteRunner("a subject"); return null; } catch (e) { return e; }
  });
  assert.match(err.message, /REFUSING TO RUN/, "it must announce a refusal, not report a measurement");
  assert.match(err.message, /absent precondition/);
  // The message it replaces said nothing about the environment at all. This asserts the replacement
  // carries what that one lacked, rather than merely being longer.
  assert.equal(/VELTRIPHEN|got \(\)|0 !== 1/.test(err.message), false,
    "the refusal is carrying the product-shaped wording it exists to replace");
});

test("2030 the environment is restored — a guard arm that leaks its own fixture breaks its neighbours", () => {
  const before = { db: process.env.CLEAROTRON_DATABASE, noEnv: process.env.CLEAROTRON_NO_ENV_FILE };
  without(["CLEAROTRON_DATABASE"], () => { try { requiresTheSuiteRunner("x"); } catch { /* expected */ } });
  assert.equal(process.env.CLEAROTRON_DATABASE, before.db, "CLEAROTRON_DATABASE was not restored");
  assert.equal(process.env.CLEAROTRON_NO_ENV_FILE, before.noEnv, "CLEAROTRON_NO_ENV_FILE was not restored");
});

// ---------------------------------------------------------------------------------------------
// refuseOnPreRunFailure — driven by PLANTED packets, because the startup guard above now fires first
// on a bare invocation and would mask this one entirely. A mechanism that can only be reached through
// a path another guard short-circuits has never been seen to work.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

const REAL_REASON = "[register-provider] CLEAROTRON_DATABASE is not set, and there is NO default. "
  + "Set it in the environment the deploy carries — one of: signa, free-tier, euipo, uspto-local, "
  + "corsearch, clarivate.";

/** A scratch outbox holding exactly the packets named. */
const outboxWith = (packets) => {
  const dir = join(mkdtempSync(join(tmpdir(), "precond-2030-")), "prelim-outbox");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(packets)) writeFileSync(join(dir, name), JSON.stringify(body));
  return dir;
};
const thrown = (fn) => { try { fn(); return null; } catch (e) { return e; } };

test("2030 a pre-run-failed packet refuses, carrying the RUNNER'S OWN reason", () => {
  const dir = outboxWith({
    "intake-vel-orig.prerun-failed.pending": { kind: "pre-run-failed", base: "vel-orig", reason: REAL_REASON },
  });
  const err = thrown(() => refuseOnPreRunFailure(dir, "a subject"));
  assert.ok(err, "a parked pre-run failure was present and nothing refused");
  assert.match(err.message, /REFUSING TO READ THIS AS A RESULT/);
  assert.match(err.message, /CLEAROTRON_DATABASE is not set/,
    "the refusal must carry the product's own reason — restating it in our words is how they drift apart");
  assert.match(err.message, /node scripts\/test-run\.mjs node --test/, "and the command");
  assert.match(err.message, /a subject/);
});

test("2030 it DISCRIMINATES — a clean outbox and a missing one both pass quietly", () => {
  assert.doesNotThrow(() => refuseOnPreRunFailure(outboxWith({}), "empty outbox"),
    "an empty outbox is the normal case and must not refuse");
  assert.doesNotThrow(() => refuseOnPreRunFailure(join(tmpdir(), "no-such-outbox-2030"), "absent outbox"),
    "an absent outbox is not a pre-run failure");
  // The ordinary intake-failure packet is a DIFFERENT lane and a legitimate result in these suites.
  const ordinary = outboxWith({
    "intake-nosubject.failed.pending": { kind: "failed", base: "nosubject", reason: "no subject line" },
    "intake-vel-reply.duplicate.pending": { kind: "duplicate", base: "vel-reply" },
  });
  assert.doesNotThrow(() => refuseOnPreRunFailure(ordinary, "ordinary packets"),
    "an ordinary intake failure is a RESULT these suites assert on — refusing on it would break them");
});

test("2030 the dotted form MISSES these packets — the near-miss this mechanism exists around", () => {
  // runner.dedup.test.mjs already asserts `.endsWith(".failed.pending")` is zero, and stayed green with
  // six prerun-failed packets on disk. This pins WHY, so nobody 'tidies' the matcher back to the dot.
  const name = "intake-vel-orig.prerun-failed.pending";
  assert.equal(name.endsWith(".failed.pending"), false,
    "the dotted form now matches — the comment in precondition-refusal.mjs is stale and the two "
    + "matchers have silently converged");
  assert.equal(name.endsWith("prerun-failed.pending"), true, "the form this mechanism matches on");
});

test("2030 a packet with NO reason still refuses, and says the reason is missing", () => {
  const dir = outboxWith({ "intake-x.prerun-failed.pending": { kind: "pre-run-failed", base: "x" } });
  const err = thrown(() => refuseOnPreRunFailure(dir, "a subject"));
  assert.ok(err, "a reasonless packet is still a pre-run failure and must not pass");
  assert.match(err.message, /carry no reason/, "an absent reason is a finding, not a blank line");
});

test("2030 a WHITESPACE value counts as missing — present-but-blank is how a guard gets fooled", () => {
  const saved = process.env.CLEAROTRON_DATABASE;
  process.env.CLEAROTRON_DATABASE = "   ";
  try {
    const err = thrown(() => requiresTheSuiteRunner("a subject"));
    assert.ok(err, "a blank value satisfied the guard, so the driver refuses further downstream instead");
    assert.match(err.message, /missing  CLEAROTRON_DATABASE/);
  } finally { if (saved === undefined) delete process.env.CLEAROTRON_DATABASE; else process.env.CLEAROTRON_DATABASE = saved; }
});
