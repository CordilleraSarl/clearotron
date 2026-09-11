// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Two defects of one shape: a check that reads the wrong thing and then reports a fault that is not there.
//
// ── THE DELIVERY ASSERTION READ THE PATH THE SCENARIO DECLARED ─────────────────────────────────────
//
// `delivery-settled` has only ever meant one file — its own error text said "status.json" while the read
// above it took whatever path the scenario had written. One scenario declared `_driver/delivery.json`,
// which parses cleanly and carries no `sendPending`, so the assertion read `undefined` and failed a run
// that had delivered correctly. It survived four rounds because that scenario had been reported once.
//
// ── AND THE ASYMMETRY RULE ASSUMED EVERY CASE EXPECTS A REFUSAL ────────────────────────────────────
//
// "The one that ACCEPTED is the defect" is sound for a case both doors should refuse. Eight of nine cases
// are, so the premise held by accident until the ninth could be measured. On the admit case the rule
// named the door that had met the case's own contract, while the door that refused was enforcing a
// cross-customer gate correctly. BOTH DOORS WERE RIGHT.
//
// The repair is not to invert the polarity — that blames a security gate for holding. It is to stop
// GUESSING on a case this comparison cannot decide, and to say what would decide it.
//
// These arms DRIVE both, and the negative arms matter as much: a refusal case must keep the old verdict,
// or the fix has traded one wrong answer for silence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evalAssertion, doorDisagreementLine, isAdmitCase, pathsAnOpDoesNotRead,
  DELIVERY_STATUS_FILE, FIXED_FILE_OPS,
} from "../../scripts/e2e.mjs";

/** A run dir whose status.json says delivered, and whose _driver/delivery.json is the packet it really is. */
function runDir() {
  const d = mkdtempSync(join(tmpdir(), "e2e-admit-"));
  mkdirSync(join(d, "_driver"), { recursive: true });
  writeFileSync(join(d, "status.json"), JSON.stringify({ state: "delivered", sendPending: true, runId: "r-1" }));
  // The real shape: a delivery packet, carrying no `sendPending` and never meant to.
  writeFileSync(join(d, "_driver", "delivery.json"), JSON.stringify({
    runId: "r-1", markName: "X", verdict: "Medium", reports: [], url: null, forwarder: "e2e",
  }));
  return d;
}

test("the delivery assertion reads the run's status, not the path a scenario declared", () => {
  const d = runDir();
  try {
    const declared = evalAssertion({ op: "delivery-settled", path: "_driver/delivery.json" }, d);
    assert.match(declared.saw, /sendPending=true/,
      "read the declared packet and reported sendPending=undefined — the defect this arm exists for");
    const plain = evalAssertion({ op: "delivery-settled", path: DELIVERY_STATUS_FILE }, d);
    assert.match(plain.saw, /sendPending=true/, "the ordinary declaration must read the same file");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a declared path this op does not read is ANSWERED FOR, not silently dropped", () => {
  const d = runDir();
  try {
    const declared = evalAssertion({ op: "delivery-settled", path: "_driver/delivery.json" }, d);
    assert.match(declared.saw, /_driver\/delivery\.json/, "the line never names the path it did not read");
    assert.match(declared.saw, /was not read/, "the line does not say the declared path went unread");
    // The control: a scenario that declared the right file gets no note at all.
    const plain = evalAssertion({ op: "delivery-settled", path: DELIVERY_STATUS_FILE }, d);
    assert.doesNotMatch(plain.saw, /was not read/, "a correct declaration is warned about anyway");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the mismatch is found by DERIVING it from the scenarios, never from a list of known names", () => {
  const scenarios = [
    { id: "RA", cases: [{ id: "RA-1", expect: { terminal: "delivered", assert: [{ op: "delivery-settled", path: "status.json" }] } }] },
    { id: "RB", cases: [{ id: "RB-1", expect: { terminal: "delivered", assert: [{ op: "delivery-settled", path: "_driver/delivery.json" }] } }] },
    { id: "RC", cases: [{ id: "RC-1", expect: { terminal: "delivered", assert: [{ op: "non-empty", path: "_driver/anything.json:x" }] } }] },
  ];
  const found = pathsAnOpDoesNotRead(scenarios);
  assert.equal(found.length, 1, "found something other than the one mismatch");
  assert.deepEqual(
    { scenario: found[0].scenario, op: found[0].op, declared: found[0].declared, reads: found[0].reads },
    { scenario: "RB", op: "delivery-settled", declared: "_driver/delivery.json", reads: "status.json" });
  assert.equal(FIXED_FILE_OPS["delivery-settled"], DELIVERY_STATUS_FILE,
    "the table the check derives from no longer agrees with the op");
});

test("a case both doors should REFUSE keeps the rule it was written for", () => {
  const line = doorDisagreementLine("RX-refusal", [{ door: "cli", ok: true }, { door: "ops-mcp", ok: false }],
    { expectTerminal: "refused" });
  assert.match(line, /the door that ACCEPTED is the defect/,
    "the rule stopped firing on the cases it is correct for — silence traded for a wrong answer");
  assert.match(line, /accepted by cli/);
  assert.match(line, /refused by ops-mcp/);
});

test("an ADMIT case does not name the door that met its contract", () => {
  const line = doorDisagreementLine("R0e-unknown-customer-falls-back-to-generic",
    [{ door: "cli", ok: true }, { door: "ops-mcp", ok: false }], { expectTerminal: "delivered" });
  assert.doesNotMatch(line, /the door that ACCEPTED is the defect/,
    "still blames the door that behaved");
  assert.match(line, /NOT DECIDED HERE/, "guesses instead of saying it cannot decide");
  assert.doesNotMatch(line, /the door that REFUSED is the defect/,
    "inverted the polarity, which blames a gate for holding");
  assert.match(line, /doors/, "does not say what would decide it");
});

test("both terminals that ADMIT are admit cases, and nothing else is", () => {
  assert.equal(isAdmitCase("delivered"), true);
  assert.equal(isAdmitCase("duplicate"), true, "a duplicate case admits at its first door and would be misread");
  for (const t of ["refused", "failed", "cancelled", "", null, undefined])
    assert.equal(isAdmitCase(t), false, `treated ${JSON.stringify(t)} as an admit case`);
});

test("a receipt written before the case's contract was carried reads as the old sentence, not a new guess", () => {
  const line = doorDisagreementLine("RY", [{ door: "cli", accepted: true }, { door: "ops-mcp", accepted: false }], {});
  assert.match(line, /the door that ACCEPTED is the defect/,
    "an old receipt got a retrospective reading it cannot support");
  assert.match(line, /accepted by cli/, "the receipt spelling `accepted` is not read; only run-time `ok` is");
});
