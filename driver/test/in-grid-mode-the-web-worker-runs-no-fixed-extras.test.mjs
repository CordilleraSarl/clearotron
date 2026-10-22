// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// IN GRID MODE THE WEB WORKER RUNS NO FIXED EXTRAS AND NO AUTOMATIC FOLLOW-UP.
//
// The web manual's grid mode told the worker it still runs the extras (competitor-intel, PR-risk and crowded-field
// probes) exactly as normal, that skipping them would hold the client export, and to fire a follow-up on any answer
// that was "no" or "unsure". The grid call runs the frame's meaning questions, so the worker judges their answers with
// every other candidate; no lint holds an export; and a follow-up is asked only where it could change the advice. This
// holds the ruled lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-common-law", "SKILL.md"), "utf8")
  .replace(/>\s/g, " ").replace(/\s+/g, " ");

test("grid mode runs the famous-mark check and judges the meaning answers with every other candidate", () => {
  assert.ok(manual.includes("You STILL run **Step 3 (the famous-mark check)**, then judge all candidates — the meaning questions' answers among "
    + "them — into the taxonomy (Step 4) and write the COMPLETE findings file with every section (Findings, famous-mark, Negative results matrix, "
    + "Coverage ledger, Audit trail). Skipping Step 3 leaves the deliverable missing a core search layer."));
  assert.ok(manual.includes("- The meaning questions the frame wrote, as the grid spec carries them."));
  for (const gone of ["the **extras** (competitor-intel / PR-risk / crowded-field)", "pre-delivery lint will HOLD client export",
    "competitor-intel probes from the manifest's watchlists"])
    assert.ok(!manual.includes(gone), `the web manual still says "${gone}"`);
});

test("a follow-up is asked only where closing the gap could change what the client is told", () => {
  assert.ok(manual.includes("If an answer is \"no\" or \"unsure\" and closing it could change what you tell the client, fire a targeted "
    + "`perplexity_research` follow-up"));
  assert.ok(!manual.includes("If any answer is \"no\" or \"unsure,\" fire"), "the web manual still fires a follow-up on any such answer");
});
