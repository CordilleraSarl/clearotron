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
import { readFileSync } from "node:fs";
import { rosterVerdict } from "../roster-verdict.mjs";

const DEMOS = ["aurora", "petcary", "zephyr"];          // as list_profiles reports them — no `generic`
// `stranger-co` / `other-co` below stand for "a customer that must never reach the test box". They are
// INVENTED. This repo is de-identified by design and carries no client identity; the guard in
// no-client-identifiers.test.mjs enforces it, and it correctly refused a first draft of this file that
// reached for two real account keys.
const v = (o) => rosterVerdict({ bundledDemos: DEMOS, ...o });

// ── the regression this issue exists for ─────────────────────────────────────────────────────────────

test("a four-bundle store on a test box PASSES — it must not read as leaked client config", () => {
  // The store holds aurora/generic/petcary/zephyr; list_profiles reports the three clients.
  const r = v({ keys: ["aurora", "petcary", "zephyr"], onDisk: ["aurora", "petcary", "zephyr"], expectDemos: true });
  assert.equal(r.state, "pass", `a correctly configured test store must not fail: ${r.message}`);
  assert.match(r.message, /matching the configured store/);
});

test("the pre-fix behaviour is what would have failed — expectDemos must not blanket-refuse a configured store", () => {
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

test("a configured store the door is NOT serving fails, and reports BOTH lists", () => {
  // The door fell back to the bundled demos while a real store sits on disk.
  //
  // THIS ARM USED TO PIN A CAUSE THE COMPARISON CANNOT SEE. It required the message to say the customer
  // store variable was not reaching the service, and that is a set equality over NAMES — a configured
  // store ordinarily CONTAINS the bundled demo names, so the same evidence is equally consistent with a
  // door still holding a roster it read before the store changed. Measured 2026-09-09: a company added
  // minutes earlier, a door serving its boot roster, and this line reporting a variable that was fine.
  //
  // What it holds now is what the check actually measured: it fails, it prints both lists, and it offers
  // both readings instead of picking one.
  const r = v({ keys: DEMOS, onDisk: ["aurora", "petcary", "stranger-co", "zephyr"], expectDemos: false });
  assert.equal(r.state, "fail");
  assert.match(r.message, new RegExp(`${DEMOS.length}[^.]*4`),
    "the verdict no longer prints both counts — which is the only thing it measured");
  assert.match(r.message, /still holding a roster/i, "the stale-roster reading is gone, so a reader meets one cause where there are two");
  assert.match(r.message, /not reaching the service/i, "the missing-variable reading is gone — it is still one of the two");
  assert.doesNotMatch(r.message, /so this is #83/,
    "the verdict asserts one cause again, from a comparison that cannot distinguish them");
});

test("no configured store, not a test box: still fails, and names the likely cause as likely", () => {
  // Unlike the branch above there is no second list to print, so the fallback reading is the likeliest
  // one and the message may say so. It still may not present it as established: this process not holding
  // the variable is not proof the service does not either.
  const r = v({ keys: DEMOS, onDisk: null, expectDemos: false });
  assert.equal(r.state, "fail");
  assert.match(r.message, /most likely/i, "the reading is presented as established rather than probable");
  assert.match(r.message, /not reaching the service/i, "the likely cause is no longer named at all");
  assert.match(r.message, /would look identical here/i, "the message does not say what else would produce it");
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

// ── the door answers for the key that asked ─────────────────────────────────────────────────

test("a company outside the asking key's cap is not a disagreement — the store is narrowed by the same cap", () => {
  // Measured in testing, 2026-09-10: a company created after the portal's key was minted, a door that
  // listed only that key's companies — correctly — and this verdict reporting the door and the store
  // disagreeing, with a message that pointed at a stale roster.
  const r = v({ keys: DEMOS, onDisk: [...DEMOS, "newco"].sort(), expectDemos: true,
    caller: { readable: true, accounts: DEMOS } });
  assert.equal(r.state, "pass", `a key's cap was reported as a door fault: ${r.message}`);
  assert.match(r.message, /within the cap/);
  assert.match(r.message, /3 of 4/, "the pass no longer says how much of the store the key could see");
});

test("within the cap, a door that disagrees with its store still FAILS", () => {
  const r = v({ keys: ["aurora"], onDisk: [...DEMOS, "newco"].sort(), expectDemos: true,
    caller: { readable: true, accounts: DEMOS } });
  assert.equal(r.state, "fail");
  assert.match(r.message, /3 of them within the cap/);
});

test("a customer the store does not hold still FAILS, whatever the key's cap allows", () => {
  const r = v({ keys: [...DEMOS, "stranger-co"].sort(), onDisk: DEMOS, expectDemos: true,
    caller: { readable: true, accounts: [...DEMOS, "stranger-co"] } });
  assert.equal(r.state, "fail");
});

test("an uncapped key, and no key given at all, are compared against the whole store", () => {
  for (const caller of [undefined, { readable: true, accounts: null }]) {
    assert.equal(v({ keys: ["aurora", "petcary"], onDisk: DEMOS, expectDemos: true, caller }).state, "fail",
      "a door missing a company passed — an absent cap was read as a narrowing one");
    assert.equal(v({ keys: DEMOS, onDisk: DEMOS, expectDemos: true, caller }).state, "pass",
      "a door serving its whole store failed — an absent cap was read as an EMPTY one, the inversion trigger-cap.mjs warns about");
  }
});

test("a key whose claims cannot be read: a difference is NOT compared, and agreement still passes", () => {
  const unreadable = { readable: false, accounts: null };
  const r = v({ keys: ["aurora"], onDisk: DEMOS, expectDemos: true, caller: unreadable });
  assert.equal(r.state, "skip", "a difference that may be the key's own narrowing was judged as if the cap were known");
  assert.match(r.message, /could not be read/);
  assert.equal(v({ keys: DEMOS, onDisk: DEMOS, expectDemos: true, caller: unreadable }).state, "pass",
    "the door listed the whole store, which no cap can explain away");
});

test("the live surface check hands the verdict the claims of the key it asked with", () => {
  // The verdict can only narrow by a cap it is given, and its one caller is a top-level-await script no
  // test can run. So the wiring is held here: one call, passing the key's claims, and the key's gap
  // measured against the same store with the portal's own function.
  const src = readFileSync(new URL("../../scripts/live-surface-check.mjs", import.meta.url), "utf8");
  const calls = [...src.matchAll(/rosterVerdict\(\{([^}]*)\}\)/g)];
  assert.equal(calls.length, 1, "the surface check no longer calls the verdict exactly once");
  assert.match(calls[0][1], /\bcaller\b/,
    "the surface check calls the verdict without the key's claims, so every cap reads as a disagreement again");
  assert.match(src, /triggerCapGap\(\{\s*accounts:\s*caller\.accounts,\s*roster:\s*onDisk\s*\}\)/,
    "the key's gap is no longer measured against the store the roster was compared with");
});
