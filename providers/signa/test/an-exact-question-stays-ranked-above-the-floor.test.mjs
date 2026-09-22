// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN EXACT QUESTION STAYS RANKED FROM THE REGISTER'S FLOOR UP; ONLY A SHORTER ONE GOES DETERMINISTIC.
//
// Two shapes answer an exact question on this register, and neither is right for every term. The ranked
// `exact` strategy also returns longer marks that contain the term, which is the recall an identical
// question relies on, but it takes a floor of two folded characters, so a one-letter question is refused.
// The deterministic `match: "exact"` takes one character, but "requires the whole mark to equal q". Sending
// every exact question deterministically cut one delivered run's identical question from 2,502 records to
// 260. Asserted on the request the connector builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchRequest, toSignaParams } from "../src/core.js";
import { CAPABILITIES } from "../src/capabilities.js";

const wire = (p) => buildSearchRequest(toSignaParams(p));

test("an exact question at or above the floor stays on the ranked lane", () => {
  assert.equal(CAPABILITIES.rankedMinLength, 2);
  for (const query of ["QZ", "Qé", "VELTRIN", "Q Z"]) {
    const body = wire({ query, match_mode: "exact", nice_classes: [9] });
    assert.deepEqual(body.strategies, ["exact"], `${query} lost the ranked recall`);
    assert.equal(body.match, undefined, "both shapes in one request is a refusal at the register");
  }
});

test("an exact question below the floor goes deterministic, where it is answered rather than refused", () => {
  for (const query of ["Q", "é", " Q "]) {
    const body = wire({ query, match_mode: "exact", nice_classes: [9] });
    assert.equal(body.match, "exact", `${JSON.stringify(query)} was sent where the register refuses it`);
    assert.equal(body.strategies, undefined);
  }
});

test("THE CONTROL: the other modes keep their shapes", () => {
  for (const mode of ["phonetic", "prefix"]) {
    const body = wire({ query: "Q", match_mode: mode });
    assert.deepEqual(body.strategies, [mode]);
    assert.equal(body.match, undefined);
  }
  assert.equal(wire({ query: "VELTRIN", match_mode: "contains" }).match, "contains");
});
