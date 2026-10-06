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
    // The ranked lane is expressed as similarity CHANNELS now, not as a strategy name: the register
    // retired `strategies`. `exact` is identical+lookalike, and the channels are written out here rather
    // than imported from the code under test, so a wrong mapping still fails this arm.
    assert.deepEqual(body.similarity, ["identical", "lookalike"], `${query} lost the ranked recall`);
    assert.equal(body.match, undefined, "both shapes in one request is a refusal at the register");
  }
});

test("an exact question below the floor goes deterministic, where it is answered rather than refused", () => {
  for (const query of ["Q", "é", " Q "]) {
    const body = wire({ query, match_mode: "exact", nice_classes: [9] });
    assert.deepEqual(body.filters?.mark_text, { is: [query] }, `${JSON.stringify(query)} was sent where the register refuses it`);
    assert.equal("q" in body, false, "a text filter on its own is the deterministic shape; a `q` would rank it");
    assert.equal(body.similarity, undefined, "a deterministic match carries no similarity channels");
    assert.equal(body.match, undefined, "the register retired `match`; the text filter replaces it");
  }
});

test("THE CONTROL: the other modes keep their shapes", () => {
  // Each mode keeps its OWN channels, and they are not the mode's name — `prefix` has no channel of its
  // own at all, which is exactly the case a rename-shaped migration would have got wrong.
  const CHANNELS = { phonetic: ["identical", "phonetic"], prefix: ["identical", "embedded"] };
  for (const mode of ["phonetic", "prefix"]) {
    const body = wire({ query: "Q", match_mode: mode });
    assert.deepEqual(body.similarity, CHANNELS[mode]);
    assert.equal(body.match, undefined);
  }
  assert.deepEqual(wire({ query: "VELTRIN", match_mode: "contains" }).filters?.mark_text, { contains: ["VELTRIN"] });
});
