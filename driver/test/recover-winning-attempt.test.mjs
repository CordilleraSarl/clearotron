// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// 2026-07-29 hardening — recoverWinningAttempt vs the CODE-SIDE saturation-probe (PR-2 build note):
// the code-side member writes its stageLog row with `key: <minted string>` + modelUsed
// "code:execute-plan", but that key never existed as a model session. On a resume where the executor
// lane is unavailable, the AGENT member's idempotency skip recovered that phantom key and handed it to
// the warm escalation lane, which then tried to warm-resume a session no engine ever opened. A
// code-side winner must recover with key:null (the resumed-past-axis contract) while still reporting
// its TRUE model so the skip event stays honest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { recoverWinningAttempt } from "../pipeline.mjs";

const LABEL = "register-unit:saturation-probe";

function runDirWith(rows) {
  const dir = mkdtempSync(join(tmpdir(), "prelim-rwa-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, `${LABEL}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return dir;
}

test("a model-side winner recovers its key + served model (the warm-resume contract)", () => {
  const dir = runDirWith([
    { attempt: 1, key: "prelim-x-unit", model: "anthropic/claude-opus-5", modelUsed: "anthropic/claude-opus-5", fail: "timeout" },
    { attempt: 2, key: "prelim-x-unit-fb1", model: "anthropic/claude-opus-5", modelUsed: "anthropic/claude-sonnet-5", fail: null },
  ]);
  assert.deepEqual(recoverWinningAttempt(dir, LABEL), { key: "prelim-x-unit-fb1", model: "anthropic/claude-sonnet-5" });
});

test("a code-side winner recovers key:null — its minted string was never a model session", () => {
  const dir = runDirWith([
    { attempt: 1, key: "prelim-x-register-unit-saturation-probe", model: "code", modelUsed: "code:execute-plan", fail: null },
  ]);
  const won = recoverWinningAttempt(dir, LABEL);
  assert.equal(won.key, null, "the phantom key must not reach the warm escalation lane");
  assert.equal(won.model, "code:execute-plan", "the skip event still reports the true (code) winner");
});

test("no telemetry at all → null (caller defaults)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prelim-rwa-"));
  assert.equal(recoverWinningAttempt(dir, LABEL), null);
});

test("failed rows after the win are skipped — the last SUCCESS is the winner", () => {
  const dir = runDirWith([
    { attempt: 1, key: "prelim-x-unit", modelUsed: "anthropic/claude-opus-5", fail: null },
    { attempt: 2, key: "prelim-x-unit-retry", modelUsed: "anthropic/claude-opus-5", fail: "cut off" },
  ]);
  assert.deepEqual(recoverWinningAttempt(dir, LABEL), { key: "prelim-x-unit", model: "anthropic/claude-opus-5" });
});
