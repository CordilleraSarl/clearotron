// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Which versions a deprecation sweep selects, and which it must never touch.
//
// WHAT CANNOT BE TESTED HERE, SAID FIRST. Nothing in this file talks to npm. The credential is CI-only by
// design, `npm whoami` is 401 anywhere else, and a test that mocked the registry would be asserting
// against a fixture of my own writing. What IS testable is the decision — which versions are below a
// named stable — and that is the half where a mistake is expensive and silent.
//
// THE SELECTION IS THE DANGEROUS PART. `npm deprecate` takes a RANGE, and one wrong range warns every
// version a project ever shipped, with an undo that is one command per version. The script enumerates and
// compares one at a time so that no range is ever handed to npm; this pins the comparison that decides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions } from "../../scripts/deprecate-below.mjs";

const below = (v, stable) => compareVersions(v, stable) < 0;

test("a pre-release sorts below its own release, which is what a beta IS", () => {
  // The whole sweep rests on this: 0.3.0-beta.2 is below 0.3.0, and 0.3.0 is below 0.3.1. Get it
  // backwards and the eleven betas are left alone while the stable everyone is on gets a warning.
  assert.equal(below("0.3.0-beta.2", "0.3.0"), true);
  assert.equal(below("0.3.0", "0.3.1"), true);
  assert.equal(below("0.3.1-beta.3", "0.3.1"), true);
  assert.equal(below("0.3.1", "0.3.1"), false, "the named stable is not below itself");
  assert.equal(below("0.3.2", "0.3.1"), false, "and nothing above it is");
  assert.equal(below("0.4.0-beta.0", "0.3.1"), false, "a later line's beta is ABOVE, not below");
});

test("beta.10 is above beta.2 — the comparison is numeric where the identifier is a number", () => {
  // Text comparison puts beta.10 below beta.2, which would leave the newest betas undeprecated and
  // deprecate older ones that were already fine. Eleven betas is more than ten, so this is not academic.
  assert.equal(compareVersions("0.3.0-beta.2", "0.3.0-beta.10") < 0, true);
  assert.equal(compareVersions("0.3.0-beta.10", "0.3.0-beta.9") > 0, true);
  assert.equal(below("0.3.0-beta.10", "0.3.1"), true, "and all of them are below the next stable");
});

test("THE SELECTION OVER A REAL SHAPE: eleven betas below, the stable and its successors untouched", () => {
  // The population this was written for, as the registry holds it.
  const published = [
    ...Array.from({ length: 11 }, (_, i) => `0.3.0-beta.${i}`),
    "0.3.0", "0.3.1-beta.0", "0.3.1-beta.1", "0.3.1-beta.2", "0.3.1-beta.3", "0.3.1", "0.3.2-beta.0",
  ];
  const selected = published.filter((v) => below(v, "0.3.1"));
  assert.ok(selected.length >= 11, `a selection of ${selected.length} is too small to be this population`);
  assert.ok(selected.includes("0.3.0-beta.10"), "the eleventh beta was missed — the numeric compare is not holding");
  assert.ok(selected.includes("0.3.0"), "the previous stable is below this one and is meant to be warned");
  assert.ok(!selected.includes("0.3.1"), "THE NAMED STABLE WAS SELECTED — readers would be told to upgrade to what they are on");
  assert.ok(!selected.includes("0.3.2-beta.0"), "a version ABOVE the stable was selected");
  assert.equal(selected.length, published.length - 2, "exactly the stable and the one above it are spared");
});

test("versions with different core numbers compare on the core, not on their text", () => {
  assert.equal(below("0.9.9", "0.10.0"), true, "9 against 10 as text reads the wrong way round");
  assert.equal(below("1.0.0", "0.10.0"), false);
  assert.equal(compareVersions("0.3.0", "0.3.0"), 0);
});
