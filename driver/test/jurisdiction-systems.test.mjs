// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WS3 C1 — first-to-use vs first-to-register as DATA. Conservative by construction: an
// unknown code is NULL and every consumer leaves it unlabeled — the system never guesses a legal
// system. (The table itself ships behind a senior-lawyer-confirmation checkbox on the PR.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationSystem, partitionBySystem, marketplaceScopeDirective, FIRST_TO_USE, FIRST_TO_REGISTER } from "../jurisdiction-systems.mjs";
import { pharmaMatter } from "../stages.mjs";

test("registrationSystem: spec-named systems classify; unknown codes are NULL (never guessed); case/alias tolerant", () => {
  for (const c of ["US", "CA", "AU", "NZ", "IN", "PH"]) assert.equal(registrationSystem(c), "first-to-use", c);
  for (const c of ["CH", "EU", "CN", "JP", "KR", "DE", "FR", "ES", "IT"]) assert.equal(registrationSystem(c), "first-to-register", c);
  assert.equal(registrationSystem("us"), "first-to-use", "case-insensitive");
  assert.equal(registrationSystem("GB"), registrationSystem("UK"), "GB/UK agree");
  assert.equal(registrationSystem("EM"), "first-to-register", "EUTM office code");
  // the conservative floor: codes we are not confident of stay UNLABELED
  for (const c of ["ZA", "SG", "HK", "AE", "WO", "CL", "XX", "", null]) assert.equal(registrationSystem(c), null, String(c));
  // no code appears in both lists
  for (const c of FIRST_TO_USE) assert.ok(!FIRST_TO_REGISTER.includes(c), `${c} in both lists`);
});

test("partitionBySystem carries unknowns; marketplaceScopeDirective derives from data and is EMPTY when nothing is known", () => {
  const p = partitionBySystem(["US", "ch", "XX", "EU"]);
  assert.deepEqual(p, { firstToUse: ["US"], firstToRegister: ["CH", "EU"], unknown: ["XX"] });
  const d = marketplaceScopeDirective(["US", "CH"]);
  assert.match(d, /US \(first-to-USE\)/);
  assert.match(d, /CH \(first-to-REGISTER\)/);
  assert.match(d, /unregistered marketplace use creates enforceable rights/);
  assert.match(d, /commercial context, never a rights conflict on its own/);
  assert.equal(marketplaceScopeDirective(["XX", "YY"]), "", "all-unknown = no directive, never a guess");
  assert.equal(marketplaceScopeDirective([]), "");
});

test("spec-48 C4: pharmaMatter — Nice 5 anywhere in scope, or pharma-shaped goods; plain matters stay off", () => {
  assert.equal(pharmaMatter({ classes: [5, 30] }), true);
  assert.equal(pharmaMatter({ classes: [9], marks: [{ name: "X", classes: ["5"] }] }), true);
  assert.equal(pharmaMatter({ classes: [9], goods: "veterinary anti-inflammatory preparations" }), true);
  assert.equal(pharmaMatter({ classes: [9, 41], goods: "downloadable video game software" }), false);
  assert.equal(pharmaMatter({}), false);
});
