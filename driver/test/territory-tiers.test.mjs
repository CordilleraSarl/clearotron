// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// territory-tiers — what KIND of place a territory entry names.
//
// This exists because two rules were counting list entries as if they were countries. The tests are
// written as the properties those rules depend on, not as a table read-back: a region must never be
// one country, and an entry the engine cannot place must never be one either.
import { test } from "node:test";
import assert from "node:assert/strict";
import { territoryTier, territoryKey, partitionTerritories, REGION_CODES, TERRITORY_TIERS } from "../territory-tiers.mjs";
import { KNOWN_JURISDICTION_CODES } from "../jurisdiction-codes.mjs";

test("a country is a country, by code or by the name a requester writes", () => {
  for (const v of ["US", "us", "United States", "USA", "FR", "France", "Japan", "GB", "United Kingdom"])
    assert.equal(territoryTier(v), "country", `${v} is a country`);
  // UK is an intake habit, not a code — the canonical fold turns it into GB before the lookup, so both
  // spellings answer the same. A country outside the 34-name display vocabulary still answers as one:
  // the tier reads the CODE universe, not the display bridge's shortlist.
  assert.equal(territoryTier("PT"), "country", "Portugal has no display name in the bridge and is still a country");
  assert.equal(territoryTier("UK"), territoryTier("GB"));
});

test("a REGION is never a country — this is the whole reason the module exists", () => {
  // ["European Union"] canonicalizes to ["EU"]: one list entry, twenty-seven countries. Counting it as
  // one country waved a regional full deep dive through the rule that exists to stop exactly that.
  for (const v of ["EU", "European Union", "EUIPO", "EUTM", "EM", "Benelux", "BX", "ARIPO", "AP",
    "African Regional (ARIPO)", "OA", "EA", "IB"])
    assert.equal(territoryTier(v), "region", `${v} names many countries, not one`);
  // Madrid is tiered a region MECHANICALLY: it covers many countries, so it must never count as one.
  // Whether an international registration is a valid geography for a given product is a separate
  // question this module does not answer.
  assert.equal(territoryTier("WO"), "region");
  assert.equal(territoryTier("Madrid"), "region");
  assert.equal(territoryTier("WIPO"), "region");
});

test("the worldwide tokens are a MODE, not a place — in every spelling the bridge accepts", () => {
  for (const v of ["Worldwide", "worldwide", "GLOBAL", "global", "all", "  All  "])
    assert.equal(territoryTier(v), "worldwide", `${v} restricts nothing`);
});

test("an entry the engine cannot place is UNRECOGNIZED, never a country", () => {
  // normalizeTerritory passes ANY two-letter input through uppercased, so without this a typo'd "QQ"
  // satisfies a one-country rule while naming nowhere at all — a zero that reads as a pass.
  for (const v of ["QQ", "ZQ", "J0", "Freedonia", "", null, undefined, "  ", "X".repeat(500)])
    assert.equal(territoryTier(v), "unrecognized", `${JSON.stringify(v)} names no place we know`);
});

test("every region code is inside the known universe — a region cannot ship as an unknown", () => {
  for (const code of REGION_CODES)
    assert.ok(KNOWN_JURISDICTION_CODES.has(code), `${code} is declared a region but is outside KNOWN_JURISDICTION_CODES`);
  // …and the reverse guard: the region set is the documented "register-world extras" and nothing else.
  // A new supranational code added to the known universe without a tier would silently become a country.
  assert.deepEqual([...REGION_CODES].sort(), ["AP", "BX", "EA", "EU", "IB", "OA", "WO"]);
});

test("the tier vocabulary is closed — a caller cannot compare against a value that does not exist", () => {
  for (const v of ["US", "EU", "Worldwide", "QQ"]) assert.ok(TERRITORY_TIERS.includes(territoryTier(v)));
});

test("partitionTerritories keeps the ORIGINAL entries, so a refusal quotes what was sent", () => {
  const p = partitionTerritories(["United States", "European Union", "Worldwide", "Freedonia"]);
  assert.deepEqual(p.countries, ["United States"], "not \"US\" — the requester never wrote that");
  assert.deepEqual(p.regions, ["European Union"]);
  assert.deepEqual(p.worldwide, ["Worldwide"]);
  assert.deepEqual(p.unrecognized, ["Freedonia"]);
  // `named` is everything that would actually restrict the search, in the order it arrived — what a
  // per-search cap counts, because a region is one register plan just as a country is.
  assert.deepEqual(p.named, ["United States", "European Union", "Freedonia"]);
});

test("partitionTerritories is callable with nothing, and answers empty rather than throwing", () => {
  for (const v of [undefined, null, []])
    assert.deepEqual(partitionTerritories(v), { worldwide: [], regions: [], countries: [], unrecognized: [], named: [] });
});

// ── the canonical identity: what makes two spellings the same place ─────────────────────────────────
test("territoryKey: every spelling of one place answers with one key", () => {
  // The property a rule that COUNTS places depends on. Without it a requester who wrote both the name and
  // the code named "two countries" and was refused a search they had described correctly.
  for (const group of [
    ["US", "us", " US ", "United States", "USA", "U.S.A.", "united states of america"],
    ["GB", "UK", "United Kingdom", "Great Britain"],
    ["EU", "EM", "EUTM", "EUIPO", "European Union"],
    ["BX", "Benelux"],
    ["WO", "Madrid", "WIPO", "International"],
  ]) {
    const keys = new Set(group.map(territoryKey));
    assert.equal(keys.size, 1, `${JSON.stringify(group)} answered ${JSON.stringify([...keys])}`);
  }
  // different places stay different
  assert.notEqual(territoryKey("US"), territoryKey("GB"));
  assert.notEqual(territoryKey("EU"), territoryKey("BX"));
});

test("territoryKey: an unrecognized entry keys on its own text, and worldwide keys on nothing", () => {
  // Two typos that differ are still two unknowns — folding them together would hide one of them.
  assert.equal(territoryKey("Freedonia"), "FREEDONIA");
  assert.equal(territoryKey(" freedonia "), "FREEDONIA", "spelling is folded, the place is not invented");
  assert.notEqual(territoryKey("Freedonia"), territoryKey("Ruritania"));
  assert.equal(territoryKey("QQ"), "QQ");
  // a mode is not a place: the worldwide family shares the empty key, and callers partition it out before
  // they ever count
  for (const t of ["Worldwide", "worldwide", "GLOBAL", "all"]) assert.equal(territoryKey(t), "");
  for (const v of [undefined, null, ""]) assert.equal(territoryKey(v), "", `${v} keys on nothing`);
});
