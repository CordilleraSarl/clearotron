// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-form-offers-what-the-registers-search.test.mjs — the list of places a clearance can be ordered for is
// the registers' own reach, by rule, not a hand-kept shortlist.
//
// THE DEFECT. The form offered 37 places with no rule behind them — Bulgaria and Greece, not Denmark,
// Portugal, Vietnam or Colombia — while a worldwide search on the wider register already swept every one of
// its 186 offices. The form was the only thing refusing those places.
//
// Run:  node --test driver/test/the-form-offers-what-the-registers-search.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { searchableTerritories, LABELS_OFFERED_BEFORE_THE_RULE } from "../register-coverage.mjs";
import { PROMPT_TERRITORIES } from "../compose-read.mjs";
import { normalizeTerritory } from "../../providers/_shared/territory-codes.mjs";
import { canonicalJurisdictionCode } from "../jurisdiction-codes.mjs";

const { offered, unnamed } = await searchableTerritories();
const byName = new Map(offered.map((o) => [o.name, o.code]));

test("Vietnam, Denmark and Colombia are offered, each under its own code", () => {
  const code = (name) => offered.find((o) => o.name === name)?.code;
  assert.equal(code("Vietnam"), "VN");
  assert.equal(code("Denmark"), "DK");
  assert.equal(code("Colombia"), "CO");
});

test("every offered name resolves back to its own code — the name the form sends reaches a door", () => {
  const broken = offered.filter((o) => canonicalJurisdictionCode(normalizeTerritory(o.name) ?? "") !== o.code)
    .map((o) => `${o.name} → ${normalizeTerritory(o.name)} (want ${o.code})`);
  assert.deepEqual(broken, []);
});

test("nothing the form offers today is taken away, and today's labels are kept", () => {
  const lost = LABELS_OFFERED_BEFORE_THE_RULE.filter((n) => !byName.has(n));
  assert.deepEqual(lost, [], "a place offered today must stay offered under the label it has");
});

test("no provider extension code, no duplicate, and no name composed in code", () => {
  assert.ok(!offered.some((o) => /^(X.|ZZ)$/.test(o.code)));
  assert.equal(new Set(offered.map((o) => o.code)).size, offered.length);
  assert.ok(unnamed.includes("OA") && unnamed.includes("WO"),
    "a regional system with no shipped label and no standard name is left out and listed, never named here");
  assert.ok(offered.length > 150, `the registers reach far more than the old shortlist; offered ${offered.length}`);
});

test("the form and the engine's copy read one minted file, and that file is what the rule yields", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const offeredFile = JSON.parse(readFileSync(new URL("../../shared/offered-territories.json", import.meta.url), "utf8"));
  const minted = [...offeredFile.regions, ...offeredFile.countries];
  assert.deepEqual(minted.map((t) => t.code), offered.map((t) => t.code), "the committed list is the rule's output (re-mint if not)");
  assert.deepEqual([...PROMPT_TERRITORIES], minted.map((t) => t.name), "the engine's copy is the minted list, name for name");
  const form = readFileSync(fileURLToPath(new URL("../../portal-ui/src/contract/composerProduct.ts", import.meta.url)), "utf8");
  assert.match(form, /from '\.\.\/\.\.\/\.\.\/shared\/offered-territories\.json'/, "the form reads the same file, not a copy of it");
  assert.doesNotMatch(form, /'Bulgaria', 'Greece'/, "no hand-kept list survives beside it");
});
