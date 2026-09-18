// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A coding agent that starts this server from a fresh clone, with nothing configured, used to be told
// there were no searches: the enumeration looked in a default workspace that does not exist, caught the
// error, and answered []. "No searches" and "not pointed at any" are different answers, and only the
// second was true. The rule is driven here as a table; the stdio drive is on the issue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unreadableRunsReason } from "../lib/runs.mjs";

const NONE = { workSet: false, workRoot: "/h/trademark/workspace", workExists: false, poolSet: false };

test("nothing configured and nothing at the default is named, not answered with an empty list", () => {
  const why = unreadableRunsReason(NONE);
  assert.match(why, /CLEAROTRON_WORK_DIR is unset/);
  assert.match(why, /\/h\/trademark\/workspace does not exist/);
  assert.match(why, /CLEAROTRON_REPORTS_DIR is unset/);
});

test("any one of the three means the server can read, and lists as before", () => {
  assert.equal(unreadableRunsReason({ ...NONE, workSet: true }), null, "a workspace was named");
  assert.equal(unreadableRunsReason({ ...NONE, workExists: true }), null, "an install running on the default workspace");
  assert.equal(unreadableRunsReason({ ...NONE, poolSet: true }), null, "a reports folder was named");
});
