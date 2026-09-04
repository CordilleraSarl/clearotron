// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-coverage.test.mjs —. What the WIRED register can be asked for, at every door.
//
// ── WHY THE RULES ARE DRIVEN OVER SYNTHETIC COVERED SETS ────────────────────────────────────────────
//
// taught this the hard way. Its predicate rule was pinned only against the two providers that
// exist, and those two happen to AGREE on every predicate — so inverting the rule from intersection to
// union reddened nothing at all. A test over the real providers proved the providers, not the rule.
//
// The same trap is live here and it is worse, because the four geography rules differ only on covered
// sets that no shipped provider has: nothing declares two countries and no region, and nothing declares
// an empty set. So the rules are driven over SYNTHETIC territory lists, and the real providers are
// asserted separately as the wiring check they actually are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coveredTerritoryNames, registerCoverageCause, KNOWN_GEOGRAPHIES } from "../register-coverage.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { PRODUCTS } from "../products.mjs";
import { PROMPT_TERRITORIES } from "../compose-read.mjs";
import { UNAVAILABLE_NOTE, coverageDisclosure } from "../search-policy.mjs";

const geo = (name) => PRODUCTS.find((p) => p.name === name).geography;
const KNOCKOUT = geo("Knockout search");
const GLOBAL = geo("Global preliminary search");
const MULTI = geo("Multi-country focus search");
const FULL = geo("Full country search");

// ── the closed set ──────────────────────────────────────────────────────────────────────────────────

test("every product's geography has a rule, and every rule has a product — a bijection", () => {
  // THE WALL for the fail-open in registerCoverageCause. An unknown geography phrase is treated as
  // offerable at runtime on purpose (a new product must not become an outage), which is only safe
  // because a product can never SHIP with a phrase no rule knows. This is that guarantee.
  const fromProducts = [...new Set(PRODUCTS.map((p) => p.geography))].sort();
  assert.deepEqual([...KNOWN_GEOGRAPHIES].sort(), fromProducts,
    "a product added with a new geography phrase, or a rule left behind by a deleted product");
});

// ── the rules, over synthetic covered sets ──────────────────────────────────────────────────────────

const offerable = (geography, territories) => registerCoverageCause(geography, territories) === null;

test("ONE REGION and nothing else — the EUIPO shape the issue rules on", () => {
  const t = ["European Union"];
  assert.equal(offerable(KNOCKOUT, t), true, "any set of territories will do");
  assert.equal(offerable(MULTI, t), true, "the EU IS a region, so 'a region, or two or more countries' is met");
  assert.equal(offerable(GLOBAL, t), false, "one office is not worldwide");
  // territory-tiers.mjs:4-8 records the incident this pins: ["European Union"] is length 1 and passed a
  // one-country rule unchallenged. A region is not a country, and an EU trade mark is not a substitute
  // for a national DPMA/INPI/BOIP right.
  assert.equal(offerable(FULL, t), false, "the EU is a REGION — it can never satisfy 'exactly one country'");
});

test("ONE COUNTRY and nothing else — the mirror shape, and it refuses the OTHER product", () => {
  const t = ["United States"];
  assert.equal(offerable(FULL, t), true, "exactly one country: satisfied");
  assert.equal(offerable(MULTI, t), false, "one country is neither a region nor two countries");
  assert.equal(offerable(GLOBAL, t), false);
  assert.equal(offerable(KNOCKOUT, t), true);
});

test("TWO COUNTRIES, no region — the set no shipped provider has, and the reason this file is synthetic", () => {
  const t = ["United States", "France"];
  assert.equal(offerable(MULTI, t), true, "'two or more countries' is the OTHER arm of that rule");
  assert.equal(offerable(FULL, t), true);
  assert.equal(offerable(GLOBAL, t), false);
});

test("a REGION plus a COUNTRY — the free tier's shape", () => {
  const t = ["European Union", "United States"];
  assert.equal(offerable(MULTI, t), true);
  assert.equal(offerable(FULL, t), true, "the US is a country even though the EU beside it is not");
  assert.equal(offerable(GLOBAL, t), false, "two offices are not the world");
  assert.equal(offerable(KNOCKOUT, t), true);
});

test("EVERY territory the form can name ⇒ worldwide is offerable", () => {
  // The line the issue did not draw, drawn: a worldwide search cannot be narrowed by the requester, so
  // the register must reach everywhere the requester could have named. This is what keeps a paid
  // aggregator that enumerates its offices — clarivate — offering the product it already runs.
  assert.equal(offerable(GLOBAL, [...PROMPT_TERRITORIES]), true);
  assert.equal(offerable(GLOBAL, PROMPT_TERRITORIES.slice(0, -1)), false, "one missing place and it is not worldwide");
});

test("an EMPTY covered set refuses even the loosest product", () => {
  // `[]` must never occur — a provider declaring it covers nothing is a misconfiguration, not a tier —
  // but if it ever does, the answer that matters is that NOTHING is offerable rather than everything.
  // This is the direction `covered ?? []` gets wrong, and it gets it wrong silently.
  assert.equal(offerable(KNOCKOUT, []), false);
  assert.equal(offerable(MULTI, []), false);
  assert.equal(offerable(FULL, []), false);
  assert.equal(offerable(GLOBAL, []), false);
});

// ── the two fail-open states, which are NOT the same state ──────────────────────────────────────────

test("null is UNRESTRICTED and undefined is UNKNOWN — both offer everything, and they are different facts", () => {
  for (const g of [KNOCKOUT, GLOBAL, MULTI, FULL]) {
    assert.equal(registerCoverageCause(g, null), null, `${g}: a provider with no declared restriction`);
    assert.equal(registerCoverageCause(g, undefined), null, `${g}: a snapshot written before this shipped`);
  }
});

// ── the causes are two, and they say different things ───────────────────────────────────────────────

test("2075 D6 — the two coverage causes stay APART, and NEITHER refuses", () => {
  // kept two causes because "worldwide" and "not enough places" are different facts and a client
  // asking why would get the wrong answer from the other sentence. Both halves of that survive the
  // 2026-08-31 ruling; what changed is which of them is a REFUSAL.
  assert.equal(registerCoverageCause(GLOBAL, ["European Union"]), "register-not-worldwide");
  assert.equal(registerCoverageCause(FULL, ["European Union"]), "register-coverage");

  // ── — THE WORLDWIDE CAUSE HAS NO REFUSAL SENTENCE, DELIBERATELY ──────────
  //
  // Every client-facing surface renders a product's refusal as `UNAVAILABLE_NOTE[cause]`. While a
  // sentence sat there for this cause, the owner's ruling held only as long as `productAvailability`
  // remembered not to return it — a filter one careless edit from being reversed, on the screen that
  // spends money. Deleting the sentence is what makes the ruling structural: there is nothing for a
  // door to render, so a coverage limit cannot become a refusal again without somebody writing the
  // sentence back, under the paragraph that says why not.
  assert.equal(UNAVAILABLE_NOTE["register-not-worldwide"], undefined,
    "the worldwide cause has a refusal sentence again, so any door can render it as one");
  // AND THE FACT IS NOT LOST — it moved to the sibling that discloses. An arm asserting only the
  // absence would pass on a build that dropped coverage altogether.
  const disclosed = coverageDisclosure(GLOBAL, ["European Union"]);
  assert.ok(disclosed && disclosed.note && disclosed.note !== UNAVAILABLE_NOTE["register-coverage"],
    "the worldwide coverage limit is neither refused nor disclosed, so it is simply gone");

  // ── D6 (owner ruling, 2026-09-02): "disclosure yes, in line with the picker" ──────────────────────
  //
  // The too-narrow cause was the last place a coverage fact could refuse a product, which is the
  // disagreement between the two controls this issue's ruling forbids — the picker offers a territory
  // the register cannot reach and says so. Its refusal sentence is deleted for the same structural
  // reason its sibling's was: with none there, no door can render one.
  assert.equal(UNAVAILABLE_NOTE["register-coverage"], undefined,
    "the too-narrow cause has a refusal sentence again, so a product can be removed for coverage");
  const b = coverageDisclosure(FULL, ["European Union"])?.note;
  assert.ok(b, "the too-narrow cause is neither refused nor disclosed, so the fact is simply gone");
  assert.notEqual(b, disclosed.note, "one sentence for both would give a client the wrong answer to 'why'");
  // AND IT WORKS WHEN THE REGISTER REACHES NONE OF THE PRODUCT'S VOCABULARY, which is exactly when this
  // cause fires: an EU-only register reaches no COUNTRY, and a list-building sentence with nothing after
  // its dash is the shape that fails there.
  assert.doesNotMatch(b, /—\s*\./, "the disclosure has a hole where its territory list should be");
  assert.match(b, /reaches none of the territories/, "the empty case has no sentence of its own");
  // The client-facing rule, restated as a property rather than trusted: no vendor name, no switch name.
  for (const s of [b, disclosed.note]) {
    assert.doesNotMatch(s, /CLEAROTRON_|corsearch|clarivate|signa|euipo|uspto|free-tier/i,
      "a client-facing sentence names no vendor and no variable");
  }
});

// ── the wiring: the real providers, which is a DIFFERENT question ───────────────────────────────────

test("the covered set is computed through the provider's OWN translate, not read off its covered list", async () => {
  // signa's `covered` is lowercase Signa keys and clarivate's is compumark office codes — neither is
  // ISO, so a display name can only be resolved by running that provider's translate. This asserts the
  // ANSWER is in composer display names whatever vocabulary the provider speaks.
  assert.deepEqual(await coveredTerritoryNames(capabilitiesFor("euipo")), ["European Union"]);
  assert.deepEqual(await coveredTerritoryNames(capabilitiesFor("uspto-local")), ["United States"]);
  assert.deepEqual(await coveredTerritoryNames(capabilitiesFor("free-tier")), ["European Union", "United States"]);
  const signa = await coveredTerritoryNames(capabilitiesFor("signa"));
  assert.ok(signa.includes("Switzerland") && signa.includes("United States"),
    "signa's covered set is its own key vocabulary and still resolves to display names");
  assert.ok(!signa.includes("Germany"), "and a place it does not hold does not appear");
});

test("EUIPO does not cover Germany — an EU trade mark is not a national register", async () => {
  // The issue is explicit: a request naming Germany is a deferred gap even on a fully configured EUIPO
  // instance. EUIPO holds EUTMs and IRs designating the EU; the DPMA is a different register.
  const t = await coveredTerritoryNames(capabilitiesFor("euipo"));
  for (const member of ["Germany", "France", "Spain", "Italy", "Netherlands", "Austria"]) {
    assert.ok(!t.includes(member), `${member} is an EU member state and NOT an EU trade mark register`);
  }
});

test("corsearch declares null and it must survive as null, all the way", async () => {
  // providers/corsearch/src/capabilities.js:66-68 — "Never read as 'covers nothing'". A global
  // aggregator has no enumerable covered set, and an enumeration invented here would silently drop any
  // territory added to the composer afterwards.
  assert.equal(await coveredTerritoryNames(capabilitiesFor("corsearch")), null);
  for (const g of [KNOCKOUT, GLOBAL, MULTI, FULL]) assert.equal(offerable(g, null), true);
});

test("clarivate reaches every territory the form offers, so it keeps all four products", async () => {
  // The regression guard for the rule chosen above: a paid aggregator that ENUMERATES its offices must
  // not lose the worldwide product it runs today by sweeping all of them (register-plan.mjs rules
  // exactly that).
  const t = await coveredTerritoryNames(capabilitiesFor("clarivate"));
  assert.deepEqual([...t], [...PROMPT_TERRITORIES]);
  for (const g of [KNOCKOUT, GLOBAL, MULTI, FULL]) assert.equal(offerable(g, t), true);
});
