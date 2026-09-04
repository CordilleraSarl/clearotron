// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// territory-codes — the display-name → region-code bridge (copper-bastion incident, 2026-07-22).
// Pins the three-way contract: code passthrough / known name → code / worldwide sentinel / unknown → null.
// Run: node --test providers/_shared/test/territory-codes.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTerritory, TERRITORY_TO_CODE } from "../territory-codes.mjs";

test("2-letter codes pass through uppercased, untouched otherwise", () => {
  assert.equal(normalizeTerritory("US"), "US");
  assert.equal(normalizeTerritory("us"), "US");
  assert.equal(normalizeTerritory(" ch "), "CH");
  assert.equal(normalizeTerritory("UK"), "UK");   // provider translate owns code aliasing, not this map
});

test("the portal composer vocabulary that killed copper-bastion translates", () => {
  assert.equal(normalizeTerritory("United States"), "US");
  assert.equal(normalizeTerritory("UNITED STATES"), "US");
  assert.equal(normalizeTerritory("European Union"), "EU");
  assert.equal(normalizeTerritory("Switzerland"), "CH");
});

test("every PROMPT_TERRITORIES display name resolves (no silent vocabulary drift)", async () => {
  const { PROMPT_TERRITORIES } = await import("../../../driver/compose-read.mjs");
  for (const name of PROMPT_TERRITORIES) {
    const code = normalizeTerritory(name);
    assert.notEqual(code, null, `composer territory "${name}" has no code mapping — a portal job selecting it would defer the jurisdiction`);
  }
});

test("every composer territory resolves to a code the ENGINE knows — content, not count", async () => {
  // The vocabulary's only pin used to be a COUNT against the picker's list, and a count passes a swap.
  // The arm above proves each name resolves to SOME code; this one proves the code is one the engine's
  // own table recognises. Without it a name could map to a token no consumer knows, and the fold would
  // carry it as an unknown jurisdiction into a client's scope with every existing check still green.
  const { PROMPT_TERRITORIES } = await import("../../../driver/compose-read.mjs");
  const { isKnownJurisdictionCode, canonicalJurisdictionCode } = await import("../../../driver/jurisdiction-codes.mjs");

  assert.ok(PROMPT_TERRITORIES.length, "the composer vocabulary is empty — this arm would assert nothing");
  for (const name of PROMPT_TERRITORIES) {
    const code = normalizeTerritory(name);
    assert.ok(isKnownJurisdictionCode(code),
      `composer territory "${name}" maps to "${code}" (canonical "${canonicalJurisdictionCode(code)}"), which is `
      + "not in KNOWN_JURISDICTION_CODES — the composer and the engine disagree about what a territory is");
  }
});

test("worldwide is the empty-string sentinel (no region restriction), not a code and not unknown", () => {
  assert.equal(normalizeTerritory("Worldwide"), "");
  assert.equal(normalizeTerritory("WORLDWIDE"), "");
});

test("regional systems map to WIPO ST.3 codes", () => {
  assert.equal(normalizeTerritory("Benelux"), "BX");
  assert.equal(normalizeTerritory("African Regional (ARIPO)"), "AP");
  assert.equal(normalizeTerritory("International (Madrid)"), "WO");
});

test("aliases and diacritics fold", () => {
  assert.equal(normalizeTerritory("USA"), "US");
  assert.equal(normalizeTerritory("United Kingdom"), "GB");
  assert.equal(normalizeTerritory("Türkiye"), "TR");
  assert.equal(normalizeTerritory("South Korea"), "KR");
});

test("unknown values return null — never a guess, never passthrough to the wire", () => {
  assert.equal(normalizeTerritory("Latin America"), null);
  assert.equal(normalizeTerritory("Mars"), null);
  assert.equal(normalizeTerritory(""), null);
  assert.equal(normalizeTerritory(null), null);
});

test("map values are codes or the worldwide sentinel — nothing multi-word leaks", () => {
  for (const [name, code] of Object.entries(TERRITORY_TO_CODE)) {
    assert.ok(code === "" || /^[A-Z]{2}$/.test(code), `${name} → "${code}" is not a 2-letter code`);
  }
});
