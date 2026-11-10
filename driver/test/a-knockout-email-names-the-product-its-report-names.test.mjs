// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A Knockout's email names the product the way its report page and the staff list do, from the run's frozen policy
// (owner's ruling, 2026-11-10), and says less where the product cannot be named. Invented names and an invented reference throughout.

import { test } from "node:test";
import assert from "node:assert/strict";

const { composeKnockoutEmail, knockoutName, knockoutRecordTitle } = await import("../publish/knockout.mjs");

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

test("a run whose level the registry no longer names says less, as a clearance does, and never prints a gap", () => {
  for (const policy of [null, undefined, { schema: 1, level: "a-level-no-registry-knows" }]) {
    assert.equal(knockoutName(policy), null, `policy ${JSON.stringify(policy)}`);
  }
  const withRef = composeKnockoutEmail({ findings, framework: FRAMEWORK, overall: "Medium", job: { ref: "TMP9410" } });
  assert.match(firstLine(withRef), /^<p [^>]*>TMP9410: <b>2 marks<\/b>, highest rating /, "the reference alone leads");
  const bare = composeKnockoutEmail({ findings, framework: FRAMEWORK, overall: "Medium", job: {} });
  assert.match(firstLine(bare), /^<p [^>]*><b>2 marks<\/b>, highest rating /, "with neither, the line begins at the count");
  for (const html of [withRef, bare]) {
    assert.doesNotMatch(firstLine(html), /null|undefined|Knockout trademark review|>\s*[—:]/, "no gap, no old name, nothing unset");
  }
});

test("the pool's record title names the product where it can, and says less where it cannot", () => {
  assert.equal(knockoutRecordTitle({ schema: 1, level: "knockout-search" }, "run-1"), "KNOCKOUT SEARCH REPORT — run-1");
  assert.equal(knockoutRecordTitle(null, "run-1"), "REPORT — run-1");
});
