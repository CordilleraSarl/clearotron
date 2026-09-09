// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// An installation nobody has branded names no organisation on its top bar.
//
// THE DEFECT THIS EXISTS FOR. The bar's identity corner read `BRAND.name`, which falls back to the
// product's own name so a sentence the product speaks always has something to call itself. The corner is
// not a sentence the product speaks — it answers WHO RUNS THIS INSTALLATION — so every install that had
// never been branded introduced its operator as "Organisation: Clearotron", which is both untrue and the
// first thing a new customer reads.
//
// Two values that differ only on an unconfigured box are exactly the pair a reviewer reads past, and the
// screen tests cannot see it: they supply `brand` in a fixture, so the corner renders a name whichever
// value the wire is built from. The wire is the only place the choice is visible.
//
// The module reads `process.env` at IMPORT time and an ES module graph evaluates a dependency before its
// importer, so the env has to be set before node starts rather than before the import statement. That is
// why each case is its own process.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const brandModule = fileURLToPath(new URL("../../shared/brand.mjs", import.meta.url));

/** Evaluate shared/brand.mjs in a fresh process under a given environment. */
function brandUnder(env) {
  const src =
    `import { BRAND, ORGANISATION_NAME } from ${JSON.stringify(brandModule)};` +
    `process.stdout.write(JSON.stringify({ product: BRAND.name, organisation: ORGANISATION_NAME }));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", src], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

test("AN INSTALLATION NOBODY BRANDED NAMES NO ORGANISATION", () => {
  const { product, organisation } = brandUnder({ CLEAROTRON_BRAND_NAME: undefined });

  // THE CONTROL, FIRST. If the module did not evaluate, or the env reached it in some other shape, both
  // values come back empty and the assertion below passes while measuring nothing.
  assert.equal(product, "Clearotron",
    "the product still calls itself something — this proves the module was read");

  assert.equal(organisation, null,
    'nobody is named as the operator, so the corner has nothing to render — never "Clearotron"');
});

test("AN INSTALLATION THAT NAMES ITS OPERATOR GETS THAT NAME, not the product's", () => {
  // The other direction. A seam hard-wired to null would satisfy the arm above and brand nothing.
  const { product, organisation } = brandUnder({ CLEAROTRON_BRAND_NAME: "Tolliver & Quillon" });
  assert.equal(organisation, "Tolliver & Quillon");
  assert.equal(product, "Tolliver & Quillon",
    "the product name follows the same variable — the two differ on absence, not on presence");
});

test("SURROUNDING WHITESPACE IS NOT AN ORGANISATION", () => {
  // An env file written as `CLEAROTRON_BRAND_NAME= ` is the commonest way to mean "unset", and a bare
  // truthiness check renders a blank name beside a label that promises one.
  assert.equal(brandUnder({ CLEAROTRON_BRAND_NAME: "   " }).organisation, null);
});

test("THE WIRE SENDS THE ORGANISATION, and has no path back to the product name", () => {
  // Pinned at the source because the value only differs on an unbranded box: a reviewer swapping this
  // back to `BRAND.name` sees every test stay green and every screenshot keep its name.
  const svc = execFileSync("grep", ["-n", "brand:", fileURLToPath(new URL("../portal-service.mjs", import.meta.url))],
    { encoding: "utf8" });
  assert.match(svc, /brand: ORGANISATION_NAME/, "the identity corner is fed the operator, not the product");
  assert.doesNotMatch(svc, /brand: BRAND\.name/,
    'the fallback-to-product value is what put "Organisation: Clearotron" on a fresh install');
});
