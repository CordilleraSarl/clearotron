// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The delivery seam: the id an outbox marker/packet carries must be an id the ops MCP can resolve.
//
// Pre-2026-07-30 packets carried a dateless "<slug>-<codename>" runId, while the pool / enumerateRuns
// id is "<slug>-<date>-<codename>". resolveRun knew runId, codename and slug — not the delivery form —
// so every `get_delivery_packet` / `mark_sent` lookup answered "run not found" and the courier fell
// back to guessing the run from list_runs. Observed 2026-07-19: a 17-minute wake loop and a ~2-hour
// delivery delay on a finished report. As of 2026-07-30 the pipeline mints the DATED canonical form
// (charter P1 §3), and the dateless arm is kept for historical packets — this test pins that the
// legacy form STAYS resolvable.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildFixture, RUN_ID } from "./_fixture.mjs";

let runs;
before(async () => {
  buildFixture();
  runs = await import("../lib/runs.mjs");
});

test("the dateless delivery runId resolves to the same run as the dated pool id", () => {
  const dated = runs.resolveRun(RUN_ID);
  assert.ok(dated, "the dated pool id must resolve (pre-existing behaviour)");
  // exactly what pre-2026-07-30 pipelines wrote as packet.runId / the outbox marker filename (legacy)
  const delivery = `${dated.slug}-${dated.codename}`;
  assert.notEqual(delivery, RUN_ID, "the two forms genuinely differ — that is the whole bug");
  const viaDelivery = runs.resolveRun(delivery);
  assert.ok(viaDelivery, `the delivery form ${delivery} must resolve — the courier has nothing else to go on`);
  assert.equal(viaDelivery.runDir, dated.runDir, "and it must be the SAME run, not a lookalike");
});

test("resolution stays exact — a near-miss id still refuses rather than guessing", () => {
  const r = runs.resolveRun(RUN_ID);
  assert.equal(runs.resolveRun(`${r.slug}-not-a-codename`), null);
  assert.equal(runs.resolveRun("no-such-run-at-all"), null);
  assert.equal(runs.resolveRun(""), null);
  assert.equal(runs.resolveRun(null), null);
});
