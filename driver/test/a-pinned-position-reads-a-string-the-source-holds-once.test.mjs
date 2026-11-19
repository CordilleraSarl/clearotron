// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A POSITION PINNED IN THE ORCHESTRATOR'S SOURCE IS READ FROM A STRING THAT SOURCE HOLDS ONCE. `driverSource` reads the
// pipeline with every module carved out of it, so `indexOf` found the first copy of a string across many files, and a pin
// could order or window the wrong one and pass. `onlyAt` returns the position only when the string occurs exactly once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onlyAt, driverSource } from "./driver-source.mjs";

test("a string held once gives its position; one held twice, or not at all, fails and says how often it occurs", () => {
  const src = "alpha\nbeta();\ngamma\nbeta();\n";
  assert.equal(onlyAt(src, "gamma"), src.indexOf("gamma"));
  assert.throws(() => onlyAt(src, "beta();"), /"beta\(\);" occurs 2 time\(s\)/);
  assert.throws(() => onlyAt(src, "delta"), /occurs 0 time\(s\)/);
});

test("the orchestrator's source repeats strings across its modules, which is why a pin needs the helper", () => {
  // A name carved out of the pipeline appears in the pipeline and in the module that now holds it.
  const src = driverSource("pipeline.mjs");
  assert.throws(() => onlyAt(src, "import { readFileSync"), /occurs \d+ time\(s\)/, "a common string is unique, so this arm proves nothing");
});
