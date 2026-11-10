// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A Knockout's email names the product the way its report page and the staff list do, from the run's frozen policy
// (owner's ruling, 2026-11-10). Invented names and an invented reference throughout.

import { test } from "node:test";
import assert from "node:assert/strict";

const { composeKnockoutEmail, knockoutName } = await import("../publish/knockout.mjs");

const FRAMEWORK = { framework_key: "house-triage", bands: [{ label: "Medium", tone: "amber" }, { label: "Low", tone: "green" }] };
const findings = { marks: [{ name: "BRIMWELD", rating: "Medium" }, { name: "QUORVANE", rating: "Low" }], batch: {} };
const firstLine = (html) => html.split("\n")[0];

test("a Knockout run's frozen policy names its email the way its report names it", () => {
  const name = knockoutName({ schema: 1, level: "knockout-search", pipeline: "knockout" });
  assert.equal(name, "Knockout search");
  const html = composeKnockoutEmail({ findings, framework: FRAMEWORK, overall: "Medium", job: { ref: "TMP9410" }, productName: name });
  assert.match(firstLine(html), /^<p [^>]*>Knockout search — TMP9410: <b>2 marks<\/b>, highest rating /);
  assert.doesNotMatch(html, /Knockout trademark review/, "the product's old name is gone from the email");
});

test("a run whose level the registry no longer names keeps the wording its email always had, never an empty name", () => {
  for (const policy of [null, undefined, { schema: 1, level: "a-level-no-registry-knows" }]) {
    assert.equal(knockoutName(policy), "Knockout trademark review", `policy ${JSON.stringify(policy)}`);
  }
  const html = composeKnockoutEmail({ findings, framework: FRAMEWORK, overall: "Medium", job: { ref: "TMP9410" } });
  assert.match(firstLine(html), /^<p [^>]*>Knockout trademark review — TMP9410: /, "a caller that names no product gets that wording too");
});
