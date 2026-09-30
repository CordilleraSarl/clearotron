// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-scenario-names-its-register.test.mjs — a scenario's counts belong to the register that returned them.
//
// WHAT WENT WRONG. A knockout scenario's floors are `identical: 8` and `containing: 300`. Run against
// the register those numbers were measured on, both hold. Run against another, the same mark came back
// `identical: 2` and `containing: 471` — one floor under, one floor over, in a single run, and neither
// result said anything about the engine. That red costs a round: it is read as a regression, it is
// investigated as one, and the run is already paid for.
//
// WHAT IS PINNED HERE, and the second is the one that keeps the rule honest:
//   1. a scenario that names its register is refused BEFORE the spend on an instance configured for
//      another, and an instance that names no register is its own case rather than a silent pass;
//   2. the rule encodes NO DIRECTION. The two registers disagreed in opposite directions on two
//      predicates of one mark, and nothing has established why. A harness that assumed "this one
//      returns fewer" would be asserting a cause nobody measured.
//
// The register names below are the two this repository already configures by name; no matter appears
// here, and the numbers in the comment above are counts, which belong to no party.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registersDeclaredBy, configuredRegister, registerRefusal, REGISTER_ENV, lintScenarios } from "../../scripts/e2e.mjs";

const scenario = (extra) => ({ id: "RX", title: "a scenario", ...extra });

// ── what a scenario declares ─────────────────────────────────────────────────────────────────────────

test("a scenario that declares nothing declares nothing — the store is a different repo", () => {
  // The whole reason this is optional: a store that has not caught up must keep working, not go red.
  assert.deepEqual(registersDeclaredBy(scenario({})), []);
  assert.deepEqual(registersDeclaredBy(scenario({ register: null })), []);
});

test("one name and a list of names both read as a list, so no caller has to know which it got", () => {
  assert.deepEqual(registersDeclaredBy(scenario({ register: "clarivate" })), ["clarivate"]);
  assert.deepEqual(registersDeclaredBy(scenario({ register: ["clarivate", "signa"] })), ["clarivate", "signa"]);
});

test("a declared name is compared case- and space-insensitively — the env file is hand-edited", () => {
  assert.deepEqual(registersDeclaredBy(scenario({ register: "  Clarivate  " })), ["clarivate"]);
});

// ── the refusal ──────────────────────────────────────────────────────────────────────────────────────

test("a scenario declaring nothing is never refused, whatever the instance is configured for", () => {
  assert.equal(registerRefusal(scenario({}), { [REGISTER_ENV]: "signa" }), null);
  assert.equal(registerRefusal(scenario({}), {}), null);
});

test("a match is not refused", () => {
  assert.equal(registerRefusal(scenario({ register: "clarivate" }), { [REGISTER_ENV]: "clarivate" }), null);
});

test("a MISMATCH is refused, and the refusal names BOTH registers", () => {
  // Naming both is what makes a misspelled declaration self-evident: the scenario's word and the
  // instance's word sit side by side, which is why the lint checks shape and not the name.
  const no = registerRefusal(scenario({ register: "clarivate" }), { [REGISTER_ENV]: "signa" });
  assert.ok(no, "a mismatch must refuse");
  assert.match(no, /clarivate/);
  assert.match(no, /signa/);
  assert.match(no, /RX/, "and the scenario, so a list of refusals is readable");
});

test("AN UNSET VARIABLE IS ITS OWN CASE, not a match and not a mismatch", () => {
  // This file may not import the module that resolves a default, and resolving one here would be
  // guessing. So an environment naming no register refuses too, and says that is what happened.
  const no = registerRefusal(scenario({ register: "clarivate" }), {});
  assert.ok(no, "an unset variable must refuse rather than pass");
  assert.match(no, new RegExp(REGISTER_ENV));
  assert.ok(!/configured for null|configured for undefined/.test(no), `the refusal printed a resolved value: ${no}`);
});

test("a blank variable is unset — a whitespace value is not a register", () => {
  const no = registerRefusal(scenario({ register: "clarivate" }), { [REGISTER_ENV]: "   " });
  assert.ok(no);
  assert.match(no, new RegExp(REGISTER_ENV), "it must take the unset branch, not compare against a blank");
});

test("a scenario measured on EITHER of two registers runs on either, and on neither of a third", () => {
  const sc = scenario({ register: ["clarivate", "signa"] });
  assert.equal(registerRefusal(sc, { [REGISTER_ENV]: "clarivate" }), null);
  assert.equal(registerRefusal(sc, { [REGISTER_ENV]: "signa" }), null);
  assert.ok(registerRefusal(sc, { [REGISTER_ENV]: "euipo" }));
});

test("THE RULE CARRIES NO DIRECTION — it is symmetric between the two registers", () => {
  // The arm that keeps an unmeasured cause out. The measurement says the registers DISAGREE; it does
  // not say which returns more. If this rule ever grew a preferred register, these two would differ.
  const a = registerRefusal(scenario({ register: "clarivate" }), { [REGISTER_ENV]: "signa" });
  const b = registerRefusal(scenario({ register: "signa" }), { [REGISTER_ENV]: "clarivate" });
  assert.ok(a && b, "both directions refuse");
  assert.equal(a.replace(/clarivate/g, "«A»").replace(/signa/g, "«B»"),
    b.replace(/signa/g, "«A»").replace(/clarivate/g, "«B»"),
    "the two refusals must differ only by which name is where");
});

// ── the reader of the configured value ───────────────────────────────────────────────────────────────

test("configuredRegister returns null for unset and blank, and never a default", () => {
  assert.equal(configuredRegister({}), null);
  assert.equal(configuredRegister({ [REGISTER_ENV]: "" }), null);
  assert.equal(configuredRegister({ [REGISTER_ENV]: "  " }), null);
  assert.equal(configuredRegister({ [REGISTER_ENV]: "Clarivate" }), "clarivate");
});

// ── the lint ─────────────────────────────────────────────────────────────────────────────────────────

const lintOf = (sc) => lintScenarios([{ __file: `${sc.id}.json`, cost: { wallMinutes: 1 }, ...sc }]);

test("a stated register that cannot be compared is refused before it can compare against nothing", () => {
  for (const bad of ["", "   ", 7, [], [""], [null]]) {
    const { wrong } = lintOf({ id: "RX", register: bad });
    assert.ok(wrong.some((w) => /`register`/.test(w)), `${JSON.stringify(bad)} must be refused: ${JSON.stringify(wrong)}`);
  }
});

test("CONTROL: a well-formed register, and no register at all, both lint clean on this rule", () => {
  // Without this the arm above passes just as well if the rule refused everything.
  for (const ok of [{ id: "RX", register: "clarivate" }, { id: "RX", register: ["clarivate", "signa"] }, { id: "RX" }]) {
    const { wrong } = lintOf(ok);
    assert.ok(!wrong.some((w) => /`register`/.test(w)), `${JSON.stringify(ok)} must lint clean: ${JSON.stringify(wrong)}`);
  }
});
