// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PAGES SAY WHICH SEARCHES NEED THE RESEARCH KEY, AND IT IS THE ANSWER THE RUN DOOR GIVES.
//
// A newcomer on a beta read four answers to one question (measured 2026-11-04): the install guide's
// settings block said the research key was required "for all four products", its own first section and
// setup said a Knockout search runs without it, the quickstart listed it with no exception, and the README
// said "a clearance" refuses without it. The quickstart's own first run is a Knockout search.
//
// THE ANSWER IS READ FROM THE DOOR, NOT TYPED. Each orderable product's policy is put to the preflight
// that refuses a run over a missing research key, with an empty environment. The ones it refuses are the
// searches the pages must call required, and the one it lets through is the exception they must name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORDERABLE_PRODUCTS, policyFor } from "../search-policy.mjs";
import { preflightResearchCredential, RESEARCH_PROVIDERS } from "../driver.config.mjs";
import { productName } from "../products.mjs";
import { spell } from "../doc-constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const flat = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\s+/g, " ");
const PAGES = ["README.md", "QUICKSTART.md", "INSTALL.md", "providers/README.md"];

function refusedWithoutTheKey(product) {
  try { preflightResearchCredential(policyFor(product), {}); return false; } catch { return true; }
}

const needs = ORDERABLE_PRODUCTS.filter(refusedWithoutTheKey);
const runsWithout = ORDERABLE_PRODUCTS.filter((p) => !refusedWithoutTheKey(p));

test("the run door refuses some searches without the research key and lets at least one through", () => {
  // A FLOOR ON BOTH SIDES. A preflight that refused everything, or nothing, would make the page arms
  // below assert a sentence about an exception that no longer exists.
  assert.ok(needs.length >= 1, "no search needs the research key, so the pages have nothing to say");
  assert.ok(runsWithout.length >= 1, "every search needs the research key, so no page may name an exception");
  assert.equal(RESEARCH_PROVIDERS.perplexity.credEnv, "PERPLEXITY_API_KEY", "the research key is not the one the pages name");
});

test("every page that names the research key says how many searches need it and which one runs without it", () => {
  const count = `the ${spell(needs.length)} clearance searches`;
  for (const page of PAGES) {
    const text = flat(page);
    assert.ok(text.includes("PERPLEXITY_API_KEY") || /Perplexity/.test(text), `${page} no longer names the research key`);
    assert.ok(text.toLowerCase().includes(count), `${page} does not say "${count}" need the research key`);
    for (const p of runsWithout) {
      if (page === "providers/README.md") continue;   // its table says it in the "Without it" column, below
      assert.match(text, new RegExp(`${productName(p)} runs without it`, "i"), `${page} does not say a ${productName(p)} runs without the research key`);
    }
  }
});

test("no page says the research key is needed by every search", () => {
  for (const page of PAGES) {
    const text = flat(page);
    assert.doesNotMatch(text, /REQUIRED for all (?:four|\d+) products/i, `${page} says every search needs the research key`);
    assert.doesNotMatch(text, /on \*\*every\*\* product/, `${page} says every search needs the research key`);
  }
  const row = readFileSync(join(ROOT, "providers", "README.md"), "utf8").split("\n").find((l) => l.startsWith("| `perplexity` |"));
  assert.ok(row, "providers/README.md has no row for the research key");
  for (const p of runsWithout) assert.match(row, new RegExp(productName(p), "i"), `the research key's row does not say what a ${productName(p)} does without it`);
});
