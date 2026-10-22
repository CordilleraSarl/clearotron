// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SKEPTIC IS TOLD A LIMITED ROW IS A CROWD RECORDED WITH ITS COUNT.
//
// The skeptic's list of gaps it does not escalate gave four kinds of `coverage-limited` row: a budget overrun, a
// ring-fenced jurisdiction's yield, a sampled phonetic fringe and count-only saturation. The first three name
// mechanisms the method no longer has: no limit in anything the model reads, no ring-fenced allowance per market, no
// sampling in the unit manual. The one kind left is a crowd recorded with its count. This holds the ruled line and that
// the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const phase2 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-search", "phase2-execution.md"), "utf8")
  .replace(/\s+/g, " ");

test("the skeptic's non-trigger is a crowd recorded with its count, and names no budget, allowance or sample", () => {
  assert.ok(phase2.includes("- a gap the **Coverage ledger records as `coverage-limited`** — a crowd recorded with its count, which a warm "
    + "re-run cannot close;"));
  for (const gone of ["budget overrun", "ring-fenced jurisdiction yield", "phonetic-fringe sampled"])
    assert.ok(!phase2.includes(gone), `the skeptic is still told of "${gone}"`);
});
