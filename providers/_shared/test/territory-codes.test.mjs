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

// ── A COUNTRY NAMED IN WORDS RESOLVES, INCLUDING THE TWO THAT DID NOT ─────────────────────────────
//
// "Belgium" and "Luxembourg" answered null while "BE", "NL" and "Netherlands" all answered — so a
// clearance ordered for Belgium by name was carried as an unrecognized territory. The table maps
// BENELUX to the office that stands in for those two countries' national register, which is easy to
// read as covering them; it does not, because this table answers "what did the requester type".
test("Belgium and Luxembourg resolve by name, exactly as their neighbours do", () => {
  assert.equal(normalizeTerritory("Belgium"), "BE");
  assert.equal(normalizeTerritory("Luxembourg"), "LU");
  assert.equal(normalizeTerritory("Netherlands"), "NL", "the neighbour that always worked — the asymmetry is the defect");
  // The Benelux office is a DIFFERENT question from the country, and both answers stay available.
  assert.equal(normalizeTerritory("Benelux"), "BX");
  assert.equal(normalizeTerritory("BE"), "BE", "the code was never the broken half");
});

test("the long tail resolves too, and the curated promises are not at the mercy of runtime data", () => {
  // MEASURED, not assumed: 224 of the 262 codes this engine holds had no display name in the curated
  // table. The tail is derived from the runtime's own region names, so a requester naming an ordinary
  // country in words is answered rather than dropped.
  assert.equal(normalizeTerritory("Denmark"), "DK");
  assert.equal(normalizeTerritory("Portugal"), "PT");
  assert.equal(normalizeTerritory("Czechia"), "CZ");

  // AND THE WIDENING CANNOT REACH THE SENTINELS. A runtime that does not know a code answers with the
  // code itself or with "Unknown Region"; read as a name, either would make the regional and worldwide
  // sentinels resolve as words and quietly change what a scope means.
  assert.equal(normalizeTerritory("Unknown Region"), null);
  assert.equal(normalizeTerritory("Narnia"), null, "an absence is still an absence");
  assert.equal(normalizeTerritory("Worldwide"), "", "the worldwide sentinel is the curated table's, not a region name");
  assert.equal(normalizeTerritory("European Union"), "EU", "and the curated entry still wins over any derived one");
  assert.equal(normalizeTerritory("International"), "WO");
});

// ── A NAME RESOLVES TO A CODE A REGISTER CAN ANSWER ────────────────────────────────────────────────
//
// The runtime still knows the codes ISO has retired and gives them the CURRENT country's name, so `VD`
// (North Vietnam, withdrawn 1977) and `VN` both answer "Vietnam". The derived scan runs AA to ZZ, so the
// dead code claimed the name and the live one found it taken. Seven territories resolved that way. None
// is a code this engine holds a jurisdiction for, so the name was pointed at a register that cannot
// answer it — and a requester who wrote BOTH the name and the code had two countries and was refused a
// search they had described correctly.
test("a territory NAME resolves to the code that is current, never to a withdrawn one", () => {
  for (const [name, code] of [
    ["Vietnam", "VN"], ["Yemen", "YE"], ["Serbia", "RS"], ["Zimbabwe", "ZW"],
    ["Vanuatu", "VU"], ["Myanmar (Burma)", "MM"], ["Curaçao", "CW"],
  ]) assert.equal(normalizeTerritory(name), code, `${name} resolved to a code no register can answer`);
});

test("a name and the country's own code are ONE place", () => {
  // The client-facing half, and the reason the codes matter rather than being a tidiness point: every
  // rule that counts territories counts these two as one or as two, and "two or more countries" is a
  // rule a multi-country search is accepted or refused on.
  //
  // WRITTEN AGAINST THE CODE A REQUESTER WOULD WRITE, not against whatever the name resolved to. The
  // first cut of this arm fed the name's own answer back in and asserted it was stable — which is
  // idempotence, true of every two-letter code including a withdrawn one, so it passed against the
  // defect it is named for. A plant is what said so.
  for (const [name, code] of [
    ["Vietnam", "VN"], ["Yemen", "YE"], ["Serbia", "RS"], ["Zimbabwe", "ZW"],
    ["Vanuatu", "VU"], ["Curaçao", "CW"],
  ]) assert.equal(normalizeTerritory(name), normalizeTerritory(code),
    `${name} and ${code} are two places to every rule that counts them`);
});

test("the canonicalisation is inert for every other name, and cannot empty the table", () => {
  // THE FLOOR, because a repair that pointed every name at nothing would satisfy the two arms above by
  // making the whole map unreachable. Asserted on the POPULATION before anything is asserted about a
  // member: the derived widening carries the long tail — measured at 200+ names beyond the curated
  // shortlist — and a build that loses it should say so here rather than in a client's scope.
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  let resolved = 0, moved = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    let name; try { name = names.of(code); } catch { continue; }
    if (!name || name === code || /^unknown/i.test(name)) continue;
    const got = normalizeTerritory(name);
    if (got) resolved += 1;
    // A code the runtime itself canonicalises elsewhere is a withdrawn one. NONE may survive as an answer.
    if (got && new Intl.Locale(`und-${got}`).region !== got) moved.push(`${name} -> ${got}`);
  }
  assert.ok(resolved > 200, `only ${resolved} region names resolve — the derived tail is gone, not narrowed`);
  assert.deepEqual(moved, [], "these names still answer with a code ISO has withdrawn");
});

test("UK is still UK, because that is an alias and not a withdrawal", () => {
  // `UK` canonicalises to `GB` and deliberately must not here: the direct-code branch hands aliasing to
  // the provider's translate step, which is where the decision belongs. The repair touches the DERIVED
  // name table only, so this is the arm that catches it reaching further than it should.
  assert.equal(normalizeTerritory("UK"), "UK");
  assert.equal(normalizeTerritory("uk"), "UK");
  assert.equal(normalizeTerritory("United Kingdom"), "GB", "the NAME still resolves as it always did");
});
