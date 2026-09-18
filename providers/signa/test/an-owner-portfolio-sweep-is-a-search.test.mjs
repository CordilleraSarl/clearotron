// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// an-owner-portfolio-sweep-is-a-search.test.mjs — an owner with no term is an element, not a missing one.
//
// THE DEFECT. Two gates decided whether a plan entry had anything to search, and both answered on a
// free-text query or a names list alone. Neither counted an owner. An owner portfolio sweep carries an
// owner and no query — that is what the shape IS — so every one was refused before dispatch: the request
// gate answered "query is required" and the kernel's element gate answered the contract's missing-element
// error without calling the provider. The run continued and disclosed the slices as unsearched, so nothing
// failed, and a report told a reader the incumbent portfolios could not be reached when nothing had asked.
//
// WHY TWO ARMS AND NOT ONE. Either gate alone is sufficient to refuse, so an arm that stops at the element
// predicate passes while the request gate still refuses — the cheap close that would leave the defect live.
// These arms reach `doSearch` itself, through the mock path, which is the gate that used to answer first.
//
// DRIVEN IN THE KERNEL'S VOCABULARY, not the adapter's. The translator's own note records why: the kernel
// hands a provider the PLAN's words (`name`, `owner`, `regions`), the adapter speaks the vendor's, and a
// test that speaks the same dialect as the code under test cannot find a dialect mismatch. Every arm below
// builds its params the way the kernel does.
//
// NO VENDOR MEASUREMENTS AND NO REAL MARK OR OWNER live here. This directory is in the public repository
// and is scanned like any other file that publishes. The owner strings are invented; nothing here depends
// on which string is used, because these arms are about which requests are BUILT and which are REFUSED.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The fixture directory is read into a module-level constant AT IMPORT, so it must be set before the
// first import of the module under test — hence the dynamic import below rather than a static one.
const FIX = mkdtempSync(join(tmpdir(), "signa-owner-fixtures-"));
writeFileSync(join(FIX, "signa-search-owner.json"), JSON.stringify({
  data: [{ id: "x1", mark_text: "INVENTED", office: "us", status: { primary: "active", stage: "registered" } }],
  pagination: { total_count: 1, has_more: false },
}));
process.env.SIGNA_FIXTURES_DIR = FIX;

const { doSearch, doEnumerate, buildSearchRequest, toSignaParams, hasSearchElement, MISSING_ELEMENT_ERROR }
  = await import("../src/core.js");

const OWNER = "Invented Holdings Sarl";
const planEntry = (extra) => toSignaParams({ nice_classes: [9], regions: ["US"], ...extra });

test("the REQUEST GATE admits an owner with no term — this is the gate that answered first", async () => {
  const out = await doSearch("k", "https://example.invalid", planEntry({ owner: OWNER }), null, { mock: true });
  assert.doesNotMatch(out.text, /query is required/i,
    "an owner portfolio sweep has no query by definition; refusing it for that is refusing the shape itself");
  assert.doesNotMatch(out.text, /no fixture/i,
    "…and the mock must be able to serve the shape, or this arm cannot reach the gate it is named for");
  assert.match(out.text, /INVENTED/, "the search answered with rows rather than a refusal");
});

test("a genuinely empty entry still refuses, and the refusal names every element it would have taken", async () => {
  const out = await doSearch("k", "https://example.invalid", planEntry({}), null, { mock: true });
  assert.equal(out.text, MISSING_ELEMENT_ERROR, "nothing to search is still nothing to search");
  for (const word of ["query", "names", "owner"]) {
    assert.match(MISSING_ELEMENT_ERROR, new RegExp(word),
      `the refusal must name ${word}: a message that names only some of the accepted elements is how the `
      + "owner shape stayed unimplemented while the error read as correct");
  }
});

test("the KERNEL's element gate agrees with the request gate, because it is the same predicate", async () => {
  // The two gates disagreeing is the silent failure this closes: a shape one admits and the other refuses
  // surfaces as a provider error, which is exactly how the original defect was recorded in the runs.
  assert.equal(hasSearchElement(planEntry({ owner: OWNER })), true);
  assert.equal(hasSearchElement(planEntry({})), false);
  const out = await doEnumerate("k", "https://example.invalid", { owner: OWNER, nice_classes: [9] }, null, { mock: true });
  assert.notEqual(out.text, MISSING_ELEMENT_ERROR,
    "the kernel refused an owner-only entry without ever calling the provider");
});

test("the three populations stay distinct — term alone, owner alone, and both compose", () => {
  // Asserted on the REQUESTS, by member. Two of these can return the same number of rows, so a count
  // comparison would pass while one clause was being dropped.
  const term = buildSearchRequest(planEntry({ name: "ZYTHERMO" }));
  const owner = buildSearchRequest(planEntry({ owner: OWNER }));
  const both = buildSearchRequest(planEntry({ name: "ZYTHERMO", owner: OWNER }));

  assert.equal(term.query, "ZYTHERMO");
  assert.equal(term.filters?.owner_name, undefined, "a term-only search must not acquire an owner clause");

  assert.equal("query" in owner, false, "an owner-only request carries no query key at all");
  assert.equal(owner.filters?.owner_name, OWNER, "…and it does carry the owner clause, or it searches everything");

  assert.equal(both.query, "ZYTHERMO");
  assert.equal(both.filters?.owner_name, OWNER,
    "both clauses ride ONE request — the intersection is a real narrowing, not one clause silently ignored");

  assert.notDeepEqual(term, owner);
  assert.notDeepEqual(owner, both);
  assert.notDeepEqual(term, both);
});
