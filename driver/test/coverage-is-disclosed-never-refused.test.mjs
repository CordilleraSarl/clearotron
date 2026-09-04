// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — OWNER RULING, 2026-08-31: coverage is disclosed, never refused ─────────
//
// The owner, ordering from the portal on his own fresh install with a partial register wired:
//
//   "i cannot press the button for Global prelim search. Why. it doesnt appear disabled, no message
//    etc - but i cant select it. The others i can."
//
// And the ruling: "we either need to enable it (with a caveat because of coverage — because a user
// could still run global and just be aware of the limitations) — I prefer that than switch it off."
//
// THE GATE WAS THE ONE PLACE THIS SYSTEM ANSWERED PARTIAL COVERAGE BY REMOVING THE PRODUCT. INSTALL.md
// states the opposite for every tier: "whatever the chosen register does not reach becomes a disclosed
// deferred coverage row rather than a silent gap". The engine already does exactly that, so the gate
// was refusing to SELL what the pipeline would happily RUN and disclose.
//
// BREAK MATRIX:
//   · a worldwide product is orderable on a partial register   → break: return the cause, arm 1 red
//   · register-cannot-count still refuses                      → break: fold it in, arm 2 red
//   · the disclosure names what IS covered                     → break: a fixed sentence, arm 3 red
//   · nothing to disclose where the register reaches all        → break: always disclose, arm 4 red
//   · the three coverage states stay apart                     → break: `covered ?? []`, arm 5 red
//   · the sentence is TRUE of the engine                       → break: nothing defers, arm 6 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { productAvailability, coverageDisclosure, UNAVAILABLE_NOTE, PRODUCT_POLICIES } from "../search-policy.mjs";
import { TURNAROUND_QUOTE, leversFromResolved, quoteEffort } from "../effort-model.mjs";
import { registerCoverageCause } from "../register-coverage.mjs";
import { PROMPT_TERRITORIES } from "../compose-read.mjs";
import { PRODUCTS } from "../products.mjs";

// A register reaching a real but partial set — the owner's case in shape if not in name.
const PARTIAL = ["United States", "European Union", "Germany", "France", "United Kingdom"];
const worldwide = PRODUCTS.find((p) => p.geography === "worldwide, and nothing else");
const oneCountry = PRODUCTS.find((p) => p.geography === "exactly one country");

test("2075 arm 1 — a worldwide search is ORDERABLE on a register that reaches part of the world", () => {
  assert.ok(worldwide, "no product declares the worldwide geography — the fixture has rotted");
  // The cause is still COMPUTED. It has to be: it is what the disclosure is keyed on. What changed is
  // that computing it no longer removes the product.
  assert.equal(registerCoverageCause(worldwide.geography, PARTIAL), "register-not-worldwide",
    "premise: this register does not reach everything a reader can name");

  assert.equal(productAvailability(PRODUCT_POLICIES[worldwide.id], {
    registerTerritories: PARTIAL, geography: worldwide.geography,
  }), null, "the worldwide product is still removed on a partial register");
});

test("2075 arm 2 — register-cannot-count is NOT covered by the ruling and still refuses", () => {
  // The issue rules it out in as many words: a register that cannot return counts cannot produce the
  // search's core output, which is a capability gap rather than a coverage one.
  const knockout = PRODUCTS.find((p) => PRODUCT_POLICIES[p.id]?.components?.registerProbe);
  assert.ok(knockout, "no product carries the register count probe — the fixture has rotted");
  assert.equal(productAvailability(PRODUCT_POLICIES[knockout.id], {
    registerCanCount: false, geography: knockout.geography,
  }), "register-cannot-count", "a capability gap was folded into the coverage ruling");
  assert.ok(UNAVAILABLE_NOTE["register-cannot-count"], "and it still has a sentence to say");
});

test("2075 arm 3 — the disclosure names what IS covered, not only what is not", () => {
  const d = coverageDisclosure(worldwide.geography, PARTIAL);
  assert.ok(d, "a partial register discloses nothing at all");
  assert.deepEqual([...d.reached].sort(), [...PARTIAL].sort(),
    "the reader is not told which territories the register does reach");
  for (const name of PARTIAL) {
    assert.ok(d.note.includes(name), `the sentence does not name ${name} — "a reader choosing Signa `
      + `should see the eleven offices, not a sentence about the world"`);
  }
  assert.ok(d.note.includes(String(PARTIAL.length)) && d.note.includes(String(PROMPT_TERRITORIES.length)),
    "the sentence states neither figure, so a reader cannot weigh the choice");
  // The two construction rules every client-facing sentence in this file follows.
  assert.doesNotMatch(d.note, /CLEAROTRON_/, "an environment name reached a client-facing sentence");
  assert.doesNotMatch(d.note, /signa|clarivate|corsearch|euipo|uspto/i, "a vendor name reached a client-facing sentence");
  // NOT in the refusal map: every caller of productAvailability reads a key found there as a refusal,
  // which is the behaviour this ruling removes.
  assert.equal(UNAVAILABLE_NOTE["register-not-worldwide"] === d.note, false,
    "the disclosure is the refusal's sentence, so the two have been collapsed back together");
});

test("2075 arm 4 — there is nothing to disclose where there is nothing to disclose", () => {
  assert.equal(coverageDisclosure(worldwide.geography, [...PROMPT_TERRITORIES]), null,
    "a register reaching everything a reader can name still carries a caveat");
  assert.equal(coverageDisclosure(oneCountry.geography, PARTIAL), null,
    "a one-country search carries the worldwide caveat");
});

test("2075 arm 5 — the three coverage states stay apart", () => {
  // `null` is a register declaring no restriction, `undefined` is a server that did not say. Neither is
  // "reaches nothing", and `covered ?? []` anywhere on this path puts a caveat on a production box that
  // deliberately declares null.
  assert.equal(coverageDisclosure(worldwide.geography, null), null);
  assert.equal(coverageDisclosure(worldwide.geography, undefined), null);
  assert.equal(productAvailability(PRODUCT_POLICIES[worldwide.id], { registerTerritories: null, geography: worldwide.geography }), null);
  assert.equal(productAvailability(PRODUCT_POLICIES[worldwide.id], { geography: worldwide.geography }), null);
});

test("2075 arm 6 — the promise the sentence makes is one the engine keeps", () => {
  // The lane rule: where a sentence changes MEANING, check it is TRUE of the
  // code before shipping it — a hint promising behaviour the engine lacks is worse than the old one.
  // The sentence promises that an unreached territory is DISCLOSED as deferred coverage rather than
  // reported as clear. Read at the two places that have to hold for that.
  const plan = readFileSync(fileURLToPath(new URL("../register-plan.mjs", import.meta.url)), "utf8");
  assert.match(plan, /deferred\.push\(\{\s*jurisdiction/,
    "resolveRegions no longer returns an uncovered jurisdiction as a deferred row, so the sentence is a lie");
  assert.match(plan, /uncoveredJurisdictionReason/, "and the deferred row no longer carries a reason");
  const ledger = readFileSync(fileURLToPath(new URL("../coverage-ledger.mjs", import.meta.url)), "utf8");
  assert.match(ledger, /deferred/, "the coverage ledger no longer knows the word the disclosure promises");
});

test("2075 arm 7 — every door that shows a product also shows what the register cannot reach", () => {
  // ONE PRODUCT, ONE ANSWER, WHICHEVER DOOR ASKED — the rule this file's neighbours already enforce for
  // availability, applied to the disclosure that replaced one of its causes. Three surfaces show a
  // client a product: the portal's menu, the MCP menu (describe_options), and the two review steps that
  // commit — the portal's plan route and plan_run. A door that stays silent lets an assistant walk a
  // client through the one act that spends without mentioning that most of the world will defer, which
  // is exactly the asymmetry the ruling exists to prevent.
  //
  // Read at source, because the failure is a door that never asks the question — there is nothing to
  // observe at runtime on a deployment whose register reaches everything.
  const sources = {
    "the portal's product menu": "../portal-service.mjs",
    "the MCP product menu": "../../mcp-server/lib/options.mjs",
    "the MCP plan door": "../../mcp-server/lib/plan.mjs",
  };
  for (const [door, rel] of Object.entries(sources)) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.match(src, /coverageDisclosure\(/, `${door} shows a product and never asks what the register reaches`);
  }
  // The portal's plan route is in portal-service too, and must ask SEPARATELY from the menu — one call
  // would mean the review step inherited the menu's answer about a different product.
  const portal = readFileSync(fileURLToPath(new URL("../portal-service.mjs", import.meta.url)), "utf8");
  assert.equal((portal.match(/coverageDisclosure\(/g) ?? []).length, 2,
    "the portal asks once, so either the menu or the review step is silent about coverage");

  // AND NO DOOR SMUGGLES IT BACK IN AS A REFUSAL. `UNAVAILABLE_NOTE[cause]` is what every door renders
  // for a product it will not sell; a coverage key reappearing there would undo the ruling at the one
  // place a client reads.
  assert.equal(UNAVAILABLE_NOTE["register-not-worldwide"], undefined,
    "the worldwide coverage cause is back in the refusal map, so every caller reads it as a refusal again");
});

// ── D6 — OWNER RULING 2026-09-02: disclosure yes, in line with the picker ────
//
// The 08-31 ruling named only the worldwide cause, and I left `register-coverage` refusing and raised it
// as a question. D6 answers it: a coverage fact refuses nowhere. The picker offers a territory the
// register cannot reach and says so at the control, and a product refused for the same fact was the last
// place the two controls on one screen could still disagree.
test("2075 D6 arm 1 — NO coverage cause refuses, on either gate, for any product", () => {
  // THE WHOLE MATRIX rather than the one product that happens to fire: this is a rule about a class of
  // cause, and an arm that checked one product would pass on a build that only fixed that one.
  const EU_ONLY = ["European Union"];
  for (const p of PRODUCTS) {
    assert.equal(productAvailability(PRODUCT_POLICIES[p.id], { registerTerritories: EU_ONLY, geography: p.geography }), null,
      `${p.name}: still refused for coverage on an EU-only register`);
  }
  // The causes are still COMPUTED and still two facts — what is gone is their power to remove a product.
  const oneCountry = PRODUCTS.find((p) => p.geography === "exactly one country");
  assert.equal(registerCoverageCause(oneCountry.geography, EU_ONLY), "register-coverage",
    "the cause stopped being computed, so the disclosure has nothing to key on");
});

test("2075 D6 arm 2 — and the fact moved to the disclosure rather than disappearing", () => {
  const EU_ONLY = ["European Union"];
  const oneCountry = PRODUCTS.find((p) => p.geography === "exactly one country");
  const d = coverageDisclosure(oneCountry.geography, EU_ONLY);
  assert.ok(d, "a product that used to be refused for coverage now says nothing at all about it");
  assert.equal(d.cause, "register-coverage");

  // TWO FACTS, TWO SENTENCES. kept them apart because a client asking "why" would get the wrong
  // answer from the other one, and that survives the ruling — only the refusal did not.
  const worldwide = PRODUCTS.find((p) => p.geography === "worldwide, and nothing else");
  assert.notEqual(d.note, coverageDisclosure(worldwide.geography, EU_ONLY).note);

  // COUNTED AGAINST THE PRODUCT'S OWN VOCABULARY. A one-country search offers no regions, so a
  // denominator of 37 counts territories it cannot be pointed at — and the reader is choosing against
  // the set the picker offers, not the set the form knows.
  assert.deepEqual([...d.reached], [], "an EU-only register reaches no COUNTRY, and this says it does");
  assert.ok(!d.missing.includes("European Union"),
    "a region is being counted as missing from a search that cannot take one");

  // AND NO DOOR CAN RENDER EITHER AS A REFUSAL, which is the structural half.
  assert.equal(UNAVAILABLE_NOTE["register-coverage"], undefined);
  assert.equal(UNAVAILABLE_NOTE["register-not-worldwide"], undefined);
});

// ── D7 — OWNER RULING 2026-09-02: the quote is a FLAT 1.5–2.5 hours ──────────
//
// Ruled after I reported that the turnaround was "sized from the territories asked for, not the ones the
// register will reach". THAT REPORT WAS WRONG, and this arm is the measurement that says so — inherited
// from an earlier comment on the same issue and repeated by me without checking the one link it turns
// on. `run-quote.mjs` does pass the resolved territories into `leversFromResolved`; those levers reach
// `units`, `costBand` and `raw`. They do not reach the turnaround, which is keyed on the PIPELINE alone
// and has been the flat ruled range since.
//
// So the ruling describes the shipped state and there was nothing to remove. What it changes is that the
// behaviour is now RULED rather than incidental — so it gets an arm, on both copies of the model, which
// is the difference between "true today" and "cannot drift".
test("2075 D7 — the turnaround is a flat ruled range and does not move with territories", () => {
  const bounds = TURNAROUND_QUOTE.clearance;
  assert.deepEqual({ ...bounds }, { lowHours: 1.5, highHours: 2.5 }, "the ruled clearance range moved");

  // THE PROPERTY, driven rather than read: same job, 1 territory to 37, one answer.
  const quotes = new Set();
  for (const n of [1, 2, 5, 12, 37]) {
    const territories = Array.from({ length: n }, (_, i) => `T${i}`);
    const levers = leversFromResolved({ pipeline: "clearance", components: { commonLawGrid: true }, caseLaw: false, territories });
    quotes.add(quoteEffort({ levers, names: 1, classes: 2, platforms: 4, density: "dense" }).turnaround);
  }
  assert.deepEqual([...quotes], ["1.5–2.5 hours"],
    `the turnaround varies with territory count: ${[...quotes].join(" | ")}`);

  // AND THE BROWSER'S COPY SAYS THE SAME NUMBER. The effort model exists twice and the parity test pins
  // the weights; this pins the one figure a client is quoted, because a browser that sized it from
  // territories would show a moving number beside a server that does not.
  const ui = readFileSync(fileURLToPath(new URL("../../portal-ui/src/contract/composerProduct.ts", import.meta.url)), "utf8");
  const block = ui.slice(ui.indexOf("export const TURNAROUND_QUOTE"), ui.indexOf("export const quoteBoundsFor"));
  assert.match(block, /clearance:\s*\{\s*lowHours:\s*1\.5,\s*highHours:\s*2\.5\s*\}/,
    "the browser quotes a different clearance range from the server");
  assert.match(ui, /quoteBoundsFor = \(m: Machinery\)[\s\S]{0,120}pipeline === 'knockout'/,
    "the browser's bounds are keyed on something other than the pipeline — territories can reach them again");
});
