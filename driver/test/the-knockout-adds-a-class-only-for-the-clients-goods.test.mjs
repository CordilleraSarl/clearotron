// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT ADDS A CLASS ONLY FOR THE CLIENT'S OWN GOODS, AND GROUNDS A GROUP ONCE.
//
// The knockout frame added closely-adjacent classes a prudent search would cover, such as retail beside goods or
// food classes for a food theme, and the knockout assessment asked a ground for every result put down. A class is
// added only for the client's own goods, with its reason; a put-down result that the reading took for a possible
// conflict is grounded once per owner's set or group of like results. This holds the ruled lines and that the old
// ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("the knockout frame adds a class only for the client's own goods, with its reason", () => {
  const frame = flat("knockout-frame/SKILL.md");
  assert.ok(frame.includes("3. **Added classes** per mark: add a class only for the client's own goods, never for what a competitor might "
    + "hold, with one sentence saying why."));
  assert.ok(frame.includes("household utensils (21); retail of the client's own goods (35, belt-and-braces)"),
    "the class-line example does not teach an added class of the client's own");
  for (const gone of ["a prudent search would cover", "food theme → 29/43", "retail services (35, belt-and-braces)"])
    assert.ok(!frame.includes(gone), `the knockout frame still says "${gone}"`);
});

test("the knockout assessment grounds a put-down group once, not every result", () => {
  const assess = flat("knockout-assess/SKILL.md");
  assert.ok(assess.includes("> **Optional, and omitting a row is always safe.** A result your reading took for a possible conflict and > then "
    + "put down gets a ground, one row per owner's set or group of like results, never one per result. > Never invent one to fill the list"));
  assert.ok(!assess.includes("a result you looked at and put down has a ground"), "the knockout assessment still grounds every result");
});
