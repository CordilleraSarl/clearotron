// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WEB WORKER IS GIVEN NO CALL COUNT AND NO PRICE.
//
// The web manual set five research calls per mark and fifteen per run, explained them by what a call costs, and
// called a coverage shortfall a budget one. Nothing the model reads names a price or a limit: it runs one grid call per
// mark, as dictated, and asks a follow-up when the answer could change what the client is told. This holds the ruled
// lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-common-law", "SKILL.md"), "utf8")
  .replace(/\s+/g, " ");

test("the web manual asks one grid call per mark and a follow-up only where it could change the advice", () => {
  assert.ok(manual.includes("One grid call per mark, as dictated. Ask a targeted follow-up when its answer could change what you tell the client, "
    + "and a famous-mark query when the manifest flags one."));
  for (const gone of ["calls: **5**", "Per workflow run total: **15**"])
    assert.ok(!manual.includes(gone), `the web manual still sets a call count: "${gone}"`);
});

test("the web manual names no price, and calls a shortfall a coverage one", () => {
  for (const gone of ["Budget rationale", "≈ $0.06", "API-key billed", "the budget/coverage is merely incomplete"])
    assert.ok(!manual.includes(gone), `the web manual still says "${gone}"`);
  assert.ok(manual.includes("3. If Perplexity worked for some calls and coverage is merely incomplete: that is NOT a failure"));
});
