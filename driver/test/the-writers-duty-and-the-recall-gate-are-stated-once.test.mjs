// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WRITER'S DUTY AND THE RECALL GATE, WHEN BOTH FIND RECORDS UNADDRESSED, ARE STATED ONCE.
//
// Both state the approved sentence for records neither addressed nor set aside, each out of its own population: the
// records the writer was owed, and the records the recall gate weighed. Stated twice, the same words would give two
// totals for "the register records this search surfaced". Stated once (ruled 2026-10-19), N is the records either names
// and M the records either required to be assessed, each counted once: never a sum of overlapping records, and never a
// record neither required. Where a population is unknown, each states its own count, as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jointUnaccounted, clauseForDefect } from "../terminal-clamp.mjs";

const id = (n) => `/mark/us/9100${n}`;

test("both gaps are counted once each, out of the records either required, with the populations' overlap counted once", () => {
  // owed: 1..6; weighed: 4..12 (4, 5, 6 are in both); the duty names 1 and 2, the recall gate 7 (it leaves the duty's to it)
  const joint = jointUnaccounted({ dutyIds: [id(1), id(2)], owedIds: [1, 2, 3, 4, 5, 6].map(id), recallIds: [id(7)], weighedIds: [4, 5, 6, 7, 8, 9, 10, 11, 12].map(id) });
  assert.deepEqual(joint, { n: 3, m: 12 }, "not 3 of the 12 records either required, each once");
  assert.equal(clauseForDefect("synthesis_unaccounted_delivered", joint.n, joint.m),
    "3 of the 12 register records this search surfaced are neither addressed as findings nor expressly set aside in this report — they remain open points a reader must weigh");
});

test("a record both name is counted once, and ids are matched without regard to case", () => {
  assert.deepEqual(jointUnaccounted({ dutyIds: [id(1)], owedIds: [id(1), id(2)], recallIds: [id(1).toUpperCase()], weighedIds: [id(1), id(3)] }), { n: 1, m: 3 });
});

test("each gap states its own count where either names nothing or either population is unknown", () => {
  const owed = [id(1), id(2)], weighed = [id(3), id(4)];
  for (const [why, args] of [
    ["the recall gate names nothing", { dutyIds: [id(1)], owedIds: owed, recallIds: [], weighedIds: weighed }],
    ["the duty names nothing", { dutyIds: [], owedIds: owed, recallIds: [id(3)], weighedIds: weighed }],
    ["the owed records are unknown", { dutyIds: [id(1)], owedIds: null, recallIds: [id(3)], weighedIds: weighed }],
    ["the weighed records are unknown", { dutyIds: [id(1)], owedIds: owed, recallIds: [id(3)], weighedIds: null }],
  ]) {
    assert.equal(jointUnaccounted(args), null, `${why}, and the two were stated as one`);
  }
});
