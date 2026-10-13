// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MARK THAT MEANS THE CLIENT'S MARK IS WEIGHED AS ITS FAMILY (ruled 2026-10-13).
//
// On a measured run, one register entry a reviewing lawyer listed was the client's dominant word in another
// language. Both engines read its line and left it to a group's row: the manual's family rule spoke of a
// shared-meaning family only where a look-alike cluster already existed, and no sentence asked the step to weigh
// a mark by its meaning. The ruled sentence now stands in the family rule, word for word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MANUAL = readFileSync(new URL("../skills/placement-inquiry/SKILL.md", import.meta.url), "utf8");
const MEANING = "A mark whose meaning is the client's mark or its dominant element, in any language, is weighed as a same-family mark whatever its spelling.";

test("the family rule weighs a mark that means the client's mark or its dominant element as a same-family mark, in the ruled words", () => {
  const family = MANUAL.split("\n").filter((l) => l.startsWith("- **Don't dump a look-alike or shared-meaning family when one member is in our field.**"));
  assert.equal(family.length, 1, "guard: the manual holds one family rule");
  assert.ok(family[0].includes(MEANING), "the family rule does not carry the meaning sentence word for word");
  assert.equal(MANUAL.split(MEANING).length - 1, 1, "the sentence stands once, in the family rule");
});
