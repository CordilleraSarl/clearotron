// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CONNECTOR'S KNOCKOUT STAGE LIST IS THE PIPELINE'S, AND ITS NOTES SAY NOTHING UNTRUE.
//
// The account connector answers a client's "how does a knockout search work" from its stage list and the note
// beside each stage. The list left out the reviewing pass, and the sweep's note said it makes two research calls
// per name where it makes one. The review is listed now, and the sweep carries no note rather than a wrong one:
// a note is a sentence a client reads, and a new one is the owner's to word. The list is pinned to the stages
// the pipeline dispatches, read from its own source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KNOCKOUT_STAGES, KNOCKOUT_STAGE_NOTES } from "../lib/knockout.mjs";

const PIPELINE = readFileSync(fileURLToPath(new URL("../../driver/pipeline-knockout.mjs", import.meta.url)), "utf8");

test("every stage the knockout pipeline dispatches is in the connector's list, the review included", () => {
  // The stages a run's event log records, each through `koStage`. The sweep and the register are steps the
  // pipeline runs in code, and the list carries them for the artifacts they write.
  const dispatched = new Set([...PIPELINE.matchAll(/koStage\(\s*"(knockout-[a-z-]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...dispatched].sort(), ["knockout-assess", "knockout-frame", "knockout-review"], "guard: the source read the stages it dispatches");
  for (const s of dispatched) assert.ok(KNOCKOUT_STAGES.includes(s), `the pipeline dispatches ${s}, and the connector does not list it`);
});

test("every note belongs to a listed stage, and none claims the sweep makes two research calls", () => {
  for (const k of Object.keys(KNOCKOUT_STAGE_NOTES)) assert.ok(KNOCKOUT_STAGES.includes(k), `a note for ${k}, which is not a stage`);
  assert.equal(KNOCKOUT_STAGE_NOTES["knockout-sweep"], undefined, "the sweep carries a note again: a new client sentence is the owner's");
  assert.ok(Object.values(KNOCKOUT_STAGE_NOTES).every((n) => !/two research calls/i.test(n)));
});
