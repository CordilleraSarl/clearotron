// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The read map counted only manual bytes, and about 175 KB of model-read text is composed in stage code, beside the
// schema of each stage's own recording tool. Neither sits under `driver/skills/`, so nothing measured it. The map now
// reports all three per stage under the house default; this holds that every stage of both lanes is in it, with each
// figure a measurement. Composed in a temporary home; no model or register is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";
import { houseDefaultFigures, recordingToolBytes } from "./instruction-read-map.mjs";

test("every stage of both lanes appears once with its manual, message and own tool-schema bytes", () => {
  const rows = houseDefaultFigures();
  const names = rows.map((r) => r.stage);
  assert.deepEqual([...names].sort(), [...Object.keys(STAGES), ...Object.keys(KO_STAGES)].sort());
  for (const r of rows) {
    for (const k of ["manualBytes", "messageBytes", "toolSchemaBytes"]) assert.ok(Number.isInteger(r[k]) && r[k] >= 0, `${r.stage}: ${k} is ${r[k]}`);
    assert.ok(r.messageBytes > 0, `${r.stage}: an empty opening message was composed`);
    assert.equal(r.toolSchemaBytes > 0, r.tools.length > 0, `${r.stage}: tool bytes and its tool list disagree`);
  }
});

test("a stage's tool bytes are its own recording tools as the server lists them", () => {
  const bytes = recordingToolBytes();
  const synthesis = houseDefaultFigures(undefined, bytes).find((r) => r.stage === "synthesis");
  assert.ok(synthesis.tools.includes("record_synthesis"));
  assert.equal(synthesis.toolSchemaBytes, synthesis.tools.reduce((a, t) => a + bytes.get(t), 0));
  assert.throws(() => houseDefaultFigures(undefined, new Map()), /are not on the recording server/,
    "a tool the server does not list must not count as zero bytes");
});
