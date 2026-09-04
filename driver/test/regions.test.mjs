// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// regions.test.mjs — the single-source country/jurisdiction naming map (spec 49 T0, porting PR).
// The regression this guards: 'CL' displayed for common-law reads as Chile to a trademark lawyer, and a
// real Chilean registration collided with the common-law bucket. Any future key that shadows a real
// ISO-3166 country with a non-country meaning is caught here, not by downstream quality feedback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON_LAW, REGION_NAMES, REGION_ALIAS, normRegion, regionName } from "../publish/regions.mjs";

test("spec 47/49: the country table names the offices the pipeline actually searches", () => {
  for (const [code, name] of [
    ["US", "United States"], ["EU", "European Union"], ["UK", "United Kingdom"], ["CN", "China"],
    ["JP", "Japan"], ["TR", "Turkey"], ["NZ", "New Zealand"], ["PH", "Philippines"], ["IN", "India"],
    ["RU", "Russia"], ["ID", "Indonesia"], ["ZA", "South Africa"], ["WO", "WIPO (Madrid)"],
    ["CL", "Chile"], ["TK", "Tokelau"],
  ]) assert.equal(regionName(code), name, `${code} → ${name}`);
});

test("the common-law sentinel is C/L — never a real ISO code", () => {
  assert.equal(COMMON_LAW, "C/L");
  assert.equal(regionName(COMMON_LAW), "Common-law");
  assert.equal(regionName("CL"), "Chile", "CL stays Chile; the sentinel must not shadow it");
});

test("ISO-collision guard: every two-letter key carries a country/office meaning, never a pipeline concept", () => {
  // Non-ISO keys that legitimately carry a non-country meaning. Everything else that LOOKS like an
  // ISO alpha-2 code must not be repurposed (the CL=Common-law bug class).
  const SANCTIONED_NON_ISO = new Set(["C/L", "EU", "WO", "BX", "UK"]);   // EU/WO/BX/UK: offices, not ISO countries
  const CONCEPT_WORDS = /common-law|register|marketplace|pending|unknown|internal/i;
  for (const [code, name] of Object.entries(REGION_NAMES)) {
    if (SANCTIONED_NON_ISO.has(code)) continue;
    assert.ok(/^[A-Z]{2}$/.test(code), `key ${code} is a plain alpha-2 office code`);
    assert.ok(!CONCEPT_WORDS.test(name), `${code} ("${name}") must name a country/office, not a pipeline concept`);
  }
});

test("aliases normalize into the table (GB→UK, EM/EUTM/EUIPO→EU); unknown codes pass through uppercased", () => {
  for (const [alias, target] of Object.entries(REGION_ALIAS)) {
    assert.ok(REGION_NAMES[target], `alias target ${target} is named`);
    assert.equal(normRegion(alias), target);
  }
  assert.equal(normRegion("gb"), "UK");
  assert.equal(normRegion("xx"), "XX");
  assert.equal(regionName("XX"), "XX", "an unknown office keeps its raw code as its name");
});

test("doc-55 B: Madrid international 'INT' normalizes to WO; 'IR' stays Iran (ISO), never WO", () => {
  assert.equal(normRegion("INT"), "WO", "corsearch Madrid jurisdiction 'INT' (uri /mark/int/) reads as the WIPO/Madrid register");
  assert.equal(normRegion("int"), "WO", "case-insensitive");
  assert.equal(regionName("WO"), "WIPO (Madrid)", "WO names the international register");
  assert.notEqual(normRegion("IR"), "WO", "IR is ISO-3166 Iran, NOT 'international registration' — never collapse it into WO");
});
