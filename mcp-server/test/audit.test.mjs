// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Audit-summary unit tests: the access log records method/tool/runId only — never request content/secrets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../lib/audit.mjs";

test("summarize keeps method + tool + runId, drops other args (no content leak)", () => {
  assert.deepEqual(
    summarize({ method: "tools/call", params: { name: "brief", arguments: { runId: "r1", secret: "x", note: "y" } } }),
    { method: "tools/call", tool: "brief", runId: "r1" },
  );
});

test("summarize keeps a short query for search tools", () => {
  assert.deepEqual(
    summarize({ method: "tools/call", params: { name: "search_runs", arguments: { query: "MYRK" } } }),
    { method: "tools/call", tool: "search_runs", query: "MYRK" },
  );
});

test("summarize keeps the resource uri", () => {
  assert.deepEqual(
    summarize({ method: "resources/read", params: { uri: "trademark://run/x/report" } }),
    { method: "resources/read", uri: "trademark://run/x/report" },
  );
});

test("summarize tolerates junk", () => {
  assert.equal(summarize(null).method, null);
  assert.equal(summarize(undefined).method, null);
  assert.equal(summarize({}).method, null);
});
