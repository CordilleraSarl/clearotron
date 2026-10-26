// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN UNENDED POSITION IS DELIVERED STATED, AND PLACEMENT'S OWN SET-ASIDE ENDS A POSITION.
//
// The write-up's manual listed three endings for a position and said one with none blocks delivery. The driver already
// counts placement's own set-aside as an ending, and since the owner's ruling that a run is never held, a position still
// unended after the follow-up ships named and clamps the verdict. The manual and the write-up's message now say both;
// what they ask of the write-up is unchanged. This holds the ruled lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES, paths } from "../stages.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const digest = readFileSync(join(DRIVER, "skills", "clearance-register", "digest.md"), "utf8").replace(/\s+/g, " ");

test("placement's own set-aside is the fourth ending, counted by the driver", () => {
  assert.ok(digest.includes("4. **placement's own set-aside of that position** — by name, or, for a residual position, by its group's row. "
    + "The driver counts it; you add nothing."));
});

test("a position with no ending is delivered stated, in the manual and in the write-up's message", () => {
  assert.ok(digest.includes("A position with NO ending is a hard discrepancy: one warm follow-up, then the run delivers with the unended positions stated."));
  assert.ok(digest.includes("the crowd then covers no position, and the run delivers with those positions stated as unended, over a ruling you did make."));
  assert.ok(digest.includes("Drop it and the ruling covers nothing, and the run delivers with those positions stated as unended."));
  for (const gone of ["then the run **blocks delivery**", "and delivery blocks over a ruling you did make", "the ruling covers nothing and the run blocks delivery"])
    assert.ok(!digest.includes(gone), `the write-up's manual still says "${gone}"`);
  const stage = readFileSync(join(DRIVER, "stages.mjs"), "utf8");
  assert.ok(stage.includes("the driver's reconciliation gate re-checks after every rewrite, and the run delivers with any unended position stated."));
  assert.ok(!stage.includes("an unended position blocks delivery"), "the write-up's message still says an unended position blocks delivery");
  assert.ok(STAGES["register-digest"], "guard: the write-up stage is defined");
  assert.ok(typeof paths === "function");
});
