// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ROSTER LINE SAYS WHAT IS READ AND WHO IS REFUSED.
//
// Outside a demo, with no company store set, the engine door reads the companies in the folder that ships with the
// install. Its boot line said every real customer would be refused, which was not true on a new local install. It
// now names how many companies are read and from where, that a company absent from that folder is refused, and the
// remedy for a company whose profile is in a separate store. The words are design's (2026-11-11), whole.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundledRosterLine } from "../demo-posture.mjs";

test("the line is the approved one, with the count the door read", () => {
  assert.equal(bundledRosterLine(4),
    "CLEAROTRON_CUSTOMERS_DIR is unset, so start_run reads the 4 companies in the folder that ships with this install "
    + "(driver/profiles). A company absent from that folder is refused with \"names no known customer\". If its profile is in a "
    + "separate config store, set CLEAROTRON_CUSTOMERS_DIR to that store's profiles directory.");
});

test("it no longer says every real customer is refused", () => {
  assert.doesNotMatch(bundledRosterLine(4), /Every real customer|BUNDLED demo roster|WARNING/);
});
