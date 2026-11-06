// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT'S SECOND LOOK READS THE DEFECTS, THE REPAIRS AND WHAT THEY COULD AFFECT, in design's approved words, and edits no
// accepted prose beyond them. The first look is not told it is a recheck. Names here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";

test("the recheck reads the defects and what their repairs could affect, and edits no accepted prose beyond them", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-recheck-scope-")));
  const recheck = KO_STAGES["knockout-review"].message({ K, evidenceLines: [], firstReadLines: [], recheckTable: "| 1 | band | QUILLBRAE | not answered |" });
  assert.match(recheck, /Recheck every material defect raised by the first review, every changed answer and summary, and any other conclusion that the changes could affect\. Unchanged text does not by itself establish that a conclusion is unaffected\./);
  assert.match(recheck, /if you cannot bound the effects of a change, check the full batch\. Keep unresolved defects visible/);
  assert.match(recheck, /Do not restart a prose edit of accepted text outside the affected scope\./);
  assert.match(recheck, /\| 1 \| band \| QUILLBRAE \| not answered \|/, "an unanswered defect is in the second look's input");
  assert.match(recheck, /There is no further correction after this one/);
  assert.doesNotMatch(KO_STAGES["knockout-review"].message({ K, evidenceLines: [], firstReadLines: [] }), /Recheck every material defect/, "the first look is not told it is a recheck");
});
