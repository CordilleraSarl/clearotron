// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// roster-verdict.test.mjs —.
//
// The roster check produced a FALSE REFUSAL twice, and both times the logic lived inside a top-level
// -await script where no test could reach it. This file is the reason there cannot be a third one
// silently.
//
// The property under test is not "the roster equals a list". It is: **no real client bundle reaches an
// instance that is allowed to break** — enforced by comparing the door against the CONFIGURED STORE where
// one exists, and against the bundled roster only where one does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rosterVerdict } from "../roster-verdict.mjs";

const DEMOS = ["aurora", "petcary", "zephyr"];          // as list_profiles reports them — no `generic`
// `stranger-co` / `other-co` below stand for "a customer that must never reach the test box". They are
// INVENTED. This repo is de-identified by design and carries no client identity; the guard in
// no-client-identifiers.test.mjs enforces it, and it correctly refused a first draft of this file that
// reached for two real account keys.
const v = (o) => rosterVerdict({ bundledDemos: DEMOS, ...o });

// ── the regression this issue exists for ─────────────────────────────────────────────────────────────

test("#327: a four-bundle store on a test box PASSES — it must not read as leaked client config", () => {
  // The store holds aurora/generic/petcary/zephyr; list_profiles reports the three clients.
  const r = v({ keys: ["aurora", "petcary", "zephyr"], onDisk: ["aurora", "petcary", "zephyr"], expectDemos: true });
  assert.equal(r.state, "pass", `a correctly configured test store must not fail: ${r.message}`);
  assert.match(r.message, /matching the configured store/);
});

test("#327: the pre-fix behaviour is what would have failed — expectDemos must not blanket-refuse a configured store", () => {
  // Exactly the state the test instance is in once CLEAROTRON_CUSTOMERS_DIR is set. Before the fix this
  // reported "real client config has reached an instance that must not have it", which was untrue.
  const r = v({ keys: ["aurora", "petcary", "zephyr"], onDisk: ["aurora", "petcary", "zephyr"], expectDemos: true });
  assert.doesNotMatch(r.message, /real client config has reached/);
});

// ── the property the guard actually protects ─────────────────────────────────────────────────────────

test("a real customer reaching the door FAILS, even on a box that declares itself a test box", () => {
  const r = v({ keys: ["aurora", "petcary", "stranger-co", "zephyr"], onDisk: ["aurora", "petcary", "zephyr"], expectDemos: true });
  assert.equal(r.state, "fail");
  assert.match(r.message, /disagree/);
});

test("a store holding a customer the door does not serve also FAILS — disagreement in either direction", () => {
  const r = v({ keys: ["aurora"], onDisk: ["aurora", "petcary", "zephyr"], expectDemos: true });
  assert.equal(r.state, "fail");
});

// ── #83 is not lost ──────────────────────────────────────────────────────────────────────────────────

test("#83 survives: a configured store the door is NOT serving fails, and says so by name", () => {
  // The door fell back to the bundled demos while a real store sits on disk.
  const r = v({ keys: DEMOS, onDisk: ["aurora", "petcary", "stranger-co", "zephyr"], expectDemos: false });
  assert.equal(r.state, "fail");
  assert.match(r.message, /#83/);
  assert.match(r.message, /not reaching the service/);
});

test("#83 unchanged where it was written for: no configured store, not a test box", () => {
  const r = v({ keys: DEMOS, onDisk: null, expectDemos: false });
  assert.equal(r.state, "fail");
  assert.match(r.message, /#83/);
});

test("no configured store on a test box: the bundled roster is the CORRECT answer", () => {
  const r = v({ keys: DEMOS, onDisk: null, expectDemos: true });
  assert.equal(r.state, "pass");
});

test("no configured store, non-demo customers, test box: still a real leak and still fails", () => {
  const r = v({ keys: ["stranger-co", "other-co"], onDisk: null, expectDemos: true });
  assert.equal(r.state, "fail");
  assert.match(r.message, /real client config has reached/);
});

// ── the zero-ish answers mean opposite things ────────────────────────────────────────────────────────

test("an unscoped probe is SKIPPED, never failed — it is a statement about the caller", () => {
  for (const onDisk of [null, ["aurora"]])
    for (const expectDemos of [true, false]) {
      const r = v({ keys: [], onDisk, expectDemos });
      assert.equal(r.state, "skip", "zero accounts is the caller being unscoped, not the deployment being wrong");
    }
});

// ── prod ─────────────────────────────────────────────────────────────────────────────────────────────

test("production: ten clients against a ten-client store passes, with no test-box wording", () => {
  const ten = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const r = v({ keys: ten, onDisk: ten, expectDemos: false });
  assert.equal(r.state, "pass");
  assert.doesNotMatch(r.message, /test box/);
});

// ── ordering is not part of the contract ─────────────────────────────────────────────────────────────

test("both sides are compared as SETS — the caller sorts, and equal sets in any input order agree", () => {
  const r = v({ keys: ["aurora", "petcary"].sort(), onDisk: ["petcary", "aurora"].sort(), expectDemos: true });
  assert.equal(r.state, "pass");
});
