// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY SPELLING OF A TERRITORY SEARCHES THE SAME OFFICE ON EVERY REGISTER, AND EACH REGISTER IS SENT ITS OWN
// CODE FOR IT.
//
// An order can name the United Kingdom as "UK", "GB" or "United Kingdom", and the international register as
// "INT", "WO", "WIPO" or "Madrid". Each register spells the office its own way: Signa by an office key, and
// Corsearch and Clarivate by a code. The translate step in each register's adapter does that spelling, and
// it is where the registers used to differ by how the order was written:
//
//   · Signa had no office for "UK", or for "EM", the EUIPO's own code, so either order was disclosed as
//     unsearched there while the other registers searched it.
//   · Corsearch sent "UK" to the wire as a region of its own, where "GB" and "United Kingdom" sent GB.
//   · No register knew "INT", although the report already reads it as WO.
//   · Clarivate's tool path refused a territory's name its own aliases did not hold ("Singapore"), and its
//     aliases held names the engine did not ("England", "Holland"), which every register's plan refused.
//
// Each register is asked, without a register call, what the region resolver plans for a spelling and what
// the request builder then sends. Corsearch and Clarivate also take a region straight from a tool call, so
// their builders are asked about the spelling as typed too. Signa's tool takes office keys, so its regions
// only come from a plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegions } from "../register-plan.mjs";
import { canonicalJurisdictionCode, foldJurisdictionCodes } from "../jurisdiction-codes.mjs";
import { normalizeTerritory } from "../../providers/_shared/territory-codes.mjs";
import * as TABLES from "../../shared/jurisdiction-tables.mjs";
import { CAPABILITIES as signa, SIGNA_ISO_ALIASES } from "../../providers/signa/src/capabilities.js";
import { CAPABILITIES as corsearch, CORSEARCH_REGION_ALIASES } from "../../providers/corsearch/src/capabilities.js";
import { CAPABILITIES as clarivate, CLARIVATE_OFFICE_ALIASES } from "../../providers/clarivate/src/capabilities.js";
import { buildSearchRequest as signaRequest, toSignaParams } from "../../providers/signa/src/core.js";
import { assembleQuery as corsearchQuery } from "../../providers/corsearch/src/core.js";
import { buildSearchRequest as clarivateRequest } from "../../providers/clarivate/src/core.js";

const SPELLINGS = {
  GB: ["UK", "uk", "GB", "United Kingdom", "Great Britain", "England", "GBR"],
  WO: ["INT", "int", "WO", "WIPO", "Madrid", "International", "Madrid Protocol"],
};

const TERM = { name: "zorblat", match_mode: "exact" };

/**
 * What each register's request builder sends for a list of regions, reduced to the part that scopes it, and
 * what it plans for the EU register named by its office code. "EM" names that register, not the EU territory,
 * so it plans the EU register and its Madrid layer without the member states an "EU" order adds.
 */
const REGISTERS = {
  signa: { caps: signa, direct: false, euRegister: { plan: ["euipo"], sent: '{"jurisdictions":["EU"]}' },
    send: (regions) => JSON.stringify(signaRequest(toSignaParams({ ...TERM, regions })).filters) },
  corsearch: { caps: corsearch, direct: true, euRegister: { plan: ["EU", "WO"], sent: "region:`EU` region:`WO`" },
    send: (regions) => corsearchQuery({ ...TERM, regions }).split(" ").filter((c) => c.startsWith("region:")).join(" ") },
  clarivate: { caps: clarivate, direct: true, euRegister: { plan: ["EM", "WO"], sent: '["EM","WO"]' },
    send: (regions) => JSON.stringify(clarivateRequest({ ...TERM, regions }).registrationOfficeCodes) },
};

/** Every way a register plans a spelling differently from the plain code, one line each. */
function plannedMisses(name, caps, spellings = SPELLINGS) {
  const misses = [];
  for (const [code, list] of Object.entries(spellings)) {
    const plain = resolveRegions([code], caps);
    for (const s of list) {
      const { regions, deferred } = resolveRegions([s], caps);
      if (deferred.length && !plain.deferred.length) misses.push(`${name} skips "${s}"`);
      else if (JSON.stringify(regions) !== JSON.stringify(plain.regions)) {
        misses.push(`${name} plans "${s}" as ${JSON.stringify(regions)}, not ${JSON.stringify(plain.regions)}`);
      }
    }
  }
  return misses;
}

/**
 * Every spelling the engine or a register's own table holds, grouped by the code the engine reads it as. The
 * EU register's office code is left to its own arm below: it names the register, not the territory.
 */
function everySpelling() {
  const all = new Set([
    ...TABLES.KNOWN_JURISDICTION_CODES,
    ...Object.keys(TABLES.JURISDICTION_CODE_FOLD), ...Object.keys(TABLES.REGION_ALIAS), ...Object.keys(TABLES.TERRITORY_TO_CODE),
    ...Object.keys(SIGNA_ISO_ALIASES), ...Object.keys(CORSEARCH_REGION_ALIASES), ...Object.keys(CLARIVATE_OFFICE_ALIASES),
    ...Object.values(signa.officeCodes),
  ]);
  const groups = {};
  for (const s of all) {
    const code = normalizeTerritory(s);
    if (!code || code === TABLES.EU_OFFICE) continue;
    (groups[canonicalJurisdictionCode(code)] ??= []).push(s, s.toLowerCase());
  }
  return groups;
}

test("every spelling a register's own table holds is one the engine reads", () => {
  const unread = [...Object.keys(SIGNA_ISO_ALIASES), ...Object.keys(CORSEARCH_REGION_ALIASES), ...Object.keys(CLARIVATE_OFFICE_ALIASES)]
    .filter((s) => normalizeTerritory(s) === null);
  assert.deepEqual(unread, [], "a register reads these, and every register's plan refuses them as unrecognized");
});

for (const [name, { caps, direct, send, euRegister }] of Object.entries(REGISTERS)) {
  test(`${name}: every spelling is planned on the same offices as the plain code`, () => {
    assert.deepEqual(plannedMisses(name, caps), []);
    for (const code of Object.keys(SPELLINGS)) assert.deepEqual(resolveRegions([code], caps).deferred, [], `premise: ${name} covers ${code}`);
  });

  test(`${name}: every spelling the engine or a register holds is planned as its code is`, () => {
    assert.deepEqual(plannedMisses(name, caps, everySpelling()), []);
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

  test(`${name}: the EU register named by its office code is searched, in this register's own code`, () => {
    for (const s of [TABLES.EU_OFFICE, TABLES.EU_OFFICE.toLowerCase()]) {
      const { regions, deferred } = resolveRegions([s], caps);
      assert.deepEqual(deferred, [], `${name} skips "${s}"`);
      assert.deepEqual(regions, euRegister.plan, `${name} plans "${s}" as ${JSON.stringify(regions)}`);
      assert.equal(send(regions), euRegister.sent, `${name} sends "${s}" as ${send(regions)}`);
    }
  });

  if (direct) {
    test(`${name}: a territory's name on a tool call is sent as its code is`, () => {
      const misses = [];
      for (const [code, spellings] of Object.entries(everySpelling())) {
        let plain;
        try { plain = send([code]); } catch { continue; }   // a territory this register does not cover
        for (const s of spellings) {
          let sent;
          try { sent = send([s]); } catch (e) { sent = `a refusal: ${e.message.slice(0, 60)}`; }
          if (sent !== plain) misses.push(`"${s}" → ${sent}, not ${plain}`);
        }
      }
      assert.deepEqual(misses, []);
    });
  }
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
