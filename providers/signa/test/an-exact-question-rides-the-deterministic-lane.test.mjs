// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN EXACT QUESTION RIDES SIGNA'S DETERMINISTIC LANE.
//
// It went out as the ranked `strategies: ["exact"]`. This register documents a floor of two folded
// characters on that shape and one on its deterministic `match`, so a reading turn's one-letter exact
// question was refused, and it documents that ranked recall is not fixed, so a ranked total is not a count
// a crowd can be judged by. Asserted on the request the connector builds from the plan's own words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchRequest, toSignaParams } from "../src/core.js";

const wire = (p) => buildSearchRequest(toSignaParams(p));

test("an exact question, one letter or many, is the deterministic match", () => {
  for (const query of ["Q", "QZ", "VELTRIN"]) {
    const body = wire({ query, match_mode: "exact", nice_classes: [9] });
    assert.equal(body.match, "exact", `${query} did not go out on the deterministic lane`);
    assert.equal(body.strategies, undefined, "both shapes in one request is a refusal at the register");
  }
});

test("THE CONTROL: the modes that exist only as rankings stay rankings", () => {
  for (const mode of ["phonetic", "prefix"]) {
    const body = wire({ query: "VELTRIN", match_mode: mode });
    assert.deepEqual(body.strategies, [mode]);
    assert.equal(body.match, undefined);
  }
  assert.equal(wire({ query: "VELTRIN", match_mode: "contains" }).match, "contains");
});
