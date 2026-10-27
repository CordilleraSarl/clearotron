// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CLASS IS ADDED ONLY FOR THE CLIENT'S OWN GOODS.
//
// The variants manual told a collaboration to search the gaming classes plus the direct class of the collaborated
// goods, and offered wider "belt-and-braces" classes (food, retail, delivery) as a side-glance. The ruled method adds a
// class only for the client's own goods, never for what a competitor might hold, with a sentence saying why. This holds
// the ruled lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-variants", "SKILL.md"), "utf8")
  .replace(/\s+/g, " ");

test("a collaboration proposes the collaborated goods' class, and adds a class only for the client's own goods", () => {
  assert.ok(manual.includes("For a **collaboration**, propose the direct class of the collaborated goods. Add a class only for the client's own goods, "
    + "never for what a competitor might hold, with one sentence saying why."));
  assert.ok(manual.includes("(collab direct-class proposed where applicable; a class added only for the client's own goods, with its reason)"));
  for (const gone of ["belt-and-braces", "side-glance", "search the gaming classes (9/28/41/42)"])
    assert.ok(!manual.includes(gone), `the variants manual still says "${gone}"`);
});
