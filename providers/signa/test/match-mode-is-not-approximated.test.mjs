// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// match-mode-is-not-approximated.test.mjs — the seam between a predicate's name and the request sent.
//
// THE DEFECT. The count lane hands this provider `match_mode: "default"` — the word `COUNT_PREDICATES`
// gives the CONTAINING predicate, whose figure a client reads under "Filings containing the name". It
// matched no branch of the translator, so neither request shape was set, and the request builder's else
// branch sent `strategies: ["exact"]`. The containing column printed an exact count, on the axis that
// most signals how crowded a field is. Nothing failed and nothing was logged — a narrower query answers
// perfectly well, it just answers a different question.
//
// NO VENDOR MEASUREMENTS AND NO MARK LIVE HERE, and the omission is deliberate rather than an oversight
// for someone to helpfully repair. The counts that proved this, the date they were taken and the name
// they were taken on are on the tracker, which is private. This directory is in the public repository,
// so `no-vendor-provenance-in-the-public-cut` scans it like any other file that publishes — it used to
// exempt the provider test trees on the ground that they were withheld, which stopped being true the
// day this directory was created.
//
// THE MARK BELOW IS INVENTED for the same reason. Nothing here depends on which string is used: these
// arms are about the SHAPE of the request built, and that is the same whatever the term.
//
// WHY THESE ARMS ARE OVER THE REQUEST AND NOT OVER A COUNT. The live property is
// `containing > exact` on a crowded mark, and it needs the vendor. What can be settled offline is
// stronger as a regression: the two predicates must build DIFFERENT REQUESTS. The issue's own words —
// "the equality itself is the signal" — and an equality is visible here without spending a call.
import { test } from "node:test";
import assert from "node:assert/strict";

import { toSignaParams, buildSearchRequest } from "../src/core.js";
import { COUNT_PREDICATES } from "../../../driver/register-count.mjs";

const paramsFor = (matchMode) => toSignaParams({ name: "ZYTHERMO", match_mode: matchMode, nice_classes: [9], regions: ["EU", "US", "WO"] });

test("the CONTAINING predicate asks this register for a containing search", () => {
  const containing = COUNT_PREDICATES.find((p) => p.key === "containing");
  assert.equal(containing.matchMode, "default", "precondition: this is the word the count lane sends");

  const out = paramsFor(containing.matchMode);
  assert.equal(out.match, "contains",
    "the containing predicate must ride a mode this provider understands — `default` is not one of them");
  assert.equal(out.strategies, undefined,
    "and it must NOT fall through to the ranked lane, which is where the exact count came from");

  const body = buildSearchRequest({ ...out, query: "ZYTHERMO" });
  assert.equal(body.match, "contains");
  assert.equal(body.strategies, undefined, "`match` and `strategies` are mutually exclusive on the wire");
});

test("identical and containing build DIFFERENT requests — the equality is the defect", () => {
  // THE ARM THAT WOULD HAVE CAUGHT THIS, stated as the issue states it. Two predicates whose client
  // labels promise different populations must not compile to the same question. R12's two floors both
  // read 301 on this provider and both passed, so the pair measured one thing twice and the second
  // floor stopped being able to fail on its own.
  const identical = COUNT_PREDICATES.find((p) => p.key === "identical");
  const containing = COUNT_PREDICATES.find((p) => p.key === "containing");

  const a = buildSearchRequest({ ...paramsFor(identical.matchMode), query: "ZYTHERMO" });
  const b = buildSearchRequest({ ...paramsFor(containing.matchMode), query: "ZYTHERMO" });
  assert.notDeepEqual(a, b,
    `"${identical.column}" and "${containing.column}" compiled to the same request, so they will print `
    + "the same number whatever the register holds");
});

test("a mode this provider cannot express is NAMED, never approximated", () => {
  // THE CLASS, and it has bitten twice: this function's own header records `starts_with` falling
  // through to a plain exact search, and `default` then did it again for two months on a client-facing
  // figure. Both were fixed by adding the missing word. Adding words one defect at a time leaves the
  // next unmapped mode to do it a third time, silently.
  const out = paramsFor("sounds_like");
  assert.equal(out.unsupported_match_mode, "sounds_like", "the mode is named so the caller can refuse the cell");
  assert.equal(out.match, undefined, "it does not become some other deterministic mode");
  assert.equal(out.strategies, undefined,
    "and above all it does not become a narrower search that answers under the wider query's label");
});

test("every mode this provider DOES declare still compiles, and none is left unset", () => {
  // THE FLOOR ON THE POPULATION. Every arm above is about one mode; without this one they would all
  // pass against a translator that had started naming everything unsupported and refusing the lot.
  for (const mode of ["exact", "phonetic", "prefix", "starts_with", "ends_with", "contains", "default"]) {
    const out = paramsFor(mode);
    assert.equal(out.unsupported_match_mode, undefined, `${mode} is declared and must not be refused`);
    assert.ok(out.match || (Array.isArray(out.strategies) && out.strategies.length),
      `${mode} must select one of the two request shapes, never neither — neither is what sent an exact search`);
  }
});
