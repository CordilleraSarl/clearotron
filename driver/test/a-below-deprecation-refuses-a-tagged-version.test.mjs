// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The sweep below a stable refuses a version a dist-tag points at, as the range mode always did.
//
// The range mode refused a selection that took a tagged version, and the below mode did not check at all.
// After a stable cut, `--below <stable>` therefore swept in the last beta, which `beta` still pointed at, and
// `npm install clearotron@beta` began warning that the version it had just installed was unsupported. Both
// modes now pass their selection through one check, and read the tags from one place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectBelow, selectRange } from "../../scripts/deprecate-below.mjs";

const PUBLISHED = ["0.3.3", "0.4.0-beta.1", "0.4.0-beta.2", "0.4.0-beta.3", "0.4.0"];

test("the sweep below a stable refuses a version a dist-tag points at, and names it with its tag", () => {
  assert.throws(() => selectBelow(PUBLISHED, "0.4.0", { latest: "0.4.0", beta: "0.4.0-beta.3" }),
    /0\.4\.0-beta\.3 \(beta\), which a dist-tag points at/);
});

test("the same sweep with the tag moved goes through, so the refusal is about the tag and not the set", () => {
  assert.deepEqual(selectBelow(PUBLISHED, "0.4.0", { latest: "0.4.0", beta: "0.4.0" }),
    ["0.3.3", "0.4.0-beta.1", "0.4.0-beta.2", "0.4.0-beta.3"]);
});

test("a `latest` inside the sweep is refused too", () => {
  assert.throws(() => selectBelow(PUBLISHED, "0.4.0", { latest: "0.3.3" }), /0\.3\.3 \(latest\)/);
});

test("both modes read the tags from one place and refuse through one check", () => {
  const src = readFileSync(new URL("../../scripts/deprecate-below.mjs", import.meta.url), "utf8");
  assert.equal(src.match(/"dist-tags"/g)?.length, 1, "the registry's dist-tags are read in more than one place");
  assert.throws(
    () => selectRange(PUBLISHED, { from: "0.3.3", through: "0.4.0-beta.3", except: [] }, { beta: "0.4.0-beta.3" }),
    /the range takes 0\.4\.0-beta\.3 \(beta\), which a dist-tag points at/,
    "the range mode still refuses, with its own wording, through the same check");
});
