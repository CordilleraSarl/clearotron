// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY SPELLING OF THE UNITED KINGDOM, AND OF WIPO'S INTERNATIONAL REGISTER, SEARCHES THE SAME OFFICE ON
// EVERY REGISTER, AND EACH REGISTER IS SENT ITS OWN CODE FOR IT.
//
// An order can name the United Kingdom as "UK", "GB" or "United Kingdom", and the international register as
// "INT", "WO", "WIPO" or "Madrid". Each register spells the office its own way: Signa by an office key, and
// Corsearch and Clarivate by a code, GB and WO. The translate step in each register's adapter does that
// spelling, and it is where two of them used to differ by how the order was written. Signa had no office for
// "UK", so a UK order was disclosed as unsearched there. Corsearch sent "UK" to the wire as a region of its
// own. And no register knew "INT", although the report already reads it as WO.
//
// Each register is asked two things per spelling, without a register call: what the region resolver plans
// (no deferral, the same offices the plain code plans), and what the request builder sends for that plan
// (the same body the plain code sends, carrying the register's code and never "UK" or "INT"). Corsearch and
// Clarivate also take a region straight from a tool call, with no plan before it, so their builders are
// asked about the spelling as typed too. Signa's tool takes office keys, so its regions only come from a plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegions } from "../register-plan.mjs";
import { canonicalJurisdictionCode, foldJurisdictionCodes } from "../jurisdiction-codes.mjs";
import { CAPABILITIES as signa } from "../../providers/signa/src/capabilities.js";
import { CAPABILITIES as corsearch } from "../../providers/corsearch/src/capabilities.js";
import { CAPABILITIES as clarivate } from "../../providers/clarivate/src/capabilities.js";
import { buildSearchRequest as signaRequest, toSignaParams } from "../../providers/signa/src/core.js";
import { assembleQuery as corsearchQuery } from "../../providers/corsearch/src/core.js";
import { buildSearchRequest as clarivateRequest } from "../../providers/clarivate/src/core.js";

const SPELLINGS = {
  GB: ["UK", "uk", "GB", "United Kingdom", "Great Britain"],
  WO: ["INT", "int", "WO", "WIPO", "Madrid", "International"],
};

const TERM = { name: "zorblat", match_mode: "exact" };

/** What each register's request builder sends for a list of regions, reduced to the part that scopes it. */
const REGISTERS = {
  signa: { caps: signa, direct: false,
    send: (regions) => JSON.stringify(signaRequest(toSignaParams({ ...TERM, regions })).filters) },
  corsearch: { caps: corsearch, direct: true,
    send: (regions) => corsearchQuery({ ...TERM, regions }).split(" ").filter((c) => c.startsWith("region:")).join(" ") },
  clarivate: { caps: clarivate, direct: true,
    send: (regions) => JSON.stringify(clarivateRequest({ ...TERM, regions }).registrationOfficeCodes) },
};

/** Every way a register plans a spelling differently from the plain code, one line each. */
function plannedMisses(name, caps) {
  const misses = [];
  for (const [code, spellings] of Object.entries(SPELLINGS)) {
    const plain = resolveRegions([code], caps);
    assert.deepEqual(plain.deferred, [], `premise: ${name} covers ${code}`);
    for (const s of spellings) {
      const { regions, deferred } = resolveRegions([s], caps);
      if (deferred.length) misses.push(`${name} skips "${s}"`);
      else if (JSON.stringify(regions) !== JSON.stringify(plain.regions)) {
        misses.push(`${name} plans "${s}" as ${JSON.stringify(regions)}, not ${JSON.stringify(plain.regions)}`);
      }
    }
  }
  return misses;
}

for (const [name, { caps, direct, send }] of Object.entries(REGISTERS)) {
  test(`${name}: every spelling is planned on the same offices as the plain code`, () => {
    assert.deepEqual(plannedMisses(name, caps), []);
  });

  test(`${name}: every spelling is sent in this register's own code, and never as UK or INT`, () => {
    const paths = { "the plan": (r) => send(resolveRegions([r], caps).regions), ...(direct ? { "a tool call": (r) => send([r]) } : {}) };
    for (const [path, wire] of Object.entries(paths)) {
      for (const [code, spellings] of Object.entries(SPELLINGS)) {
        const plain = wire(code);
        assert.match(plain, new RegExp(`\\b${code}\\b`), `premise: ${name} sends ${code} through ${path} as ${code}, and sent ${plain}`);
        for (const s of spellings) {
          const sent = wire(s);
          assert.equal(sent, plain, `${name} sends "${s}" through ${path} as ${sent}, not ${plain}`);
          assert.doesNotMatch(sent, /\bUK\b|\bINT\b/, `${name} sent a spelling it does not hold for "${s}" through ${path}: ${sent}`);
        }
      }
    }
  });
}

test("the engine reads INT as WIPO's international register, as the report does", () => {
  assert.equal(canonicalJurisdictionCode("INT"), "WO");
  assert.deepEqual(foldJurisdictionCodes(["INT", "WO", "UK", "GB"]), { codes: ["WO", "GB"], unknown: [] });
});

test("a register whose translate loses a spelling is named here, so the test fails when it should", () => {
  const without = (caps, lost) => ({ ...caps, offices: { ...caps.offices,
    translate: (c) => (String(c).trim().toUpperCase() === lost ? lost : caps.offices.translate(c)) } });
  // Signa holds no office keyed "UK": a translate that passes it through leaves it uncovered.
  assert.deepEqual(plannedMisses("signa", without(signa, "UK")), ['signa skips "UK"', 'signa skips "uk"']);
  // Corsearch covers every code, so a passed-through "UK" is planned as a region of its own.
  assert.deepEqual(plannedMisses("corsearch", without(corsearch, "UK")), [
    'corsearch plans "UK" as ["UK","WO"], not ["GB","WO"]',
    'corsearch plans "uk" as ["UK","WO"], not ["GB","WO"]',
  ]);
  // Clarivate checks its code list, so a passed-through "UK" is a gap.
  assert.deepEqual(plannedMisses("clarivate", without(clarivate, "UK")), ['clarivate skips "UK"', 'clarivate skips "uk"']);
});
