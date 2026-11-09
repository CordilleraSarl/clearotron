// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// what-an-engine-stamp-means.test.mjs — what each `engine` word on a saved attempt row makes the readers say.
//
// The word on a row is not only a registered engine. A native-language row stamps its vendor, the older
// direct lanes stamp names no adapter carries now, and a row from before the stamp has none. The mock
// pipeline writes only the current engines' stamps, so the behaviour snapshot never reaches most of this
// table; a run's byModel keys, its receipt's vendors and the model names on its report all come through it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { modelKey } from "../attempt-rows.mjs";
import { vendorOf } from "../engine/stamps.mjs";
import { driverDir } from "../run-record.mjs";
import { servedModels } from "../tokens.mjs";

const NO_STAMP = null;
const SHAPES = {
  stageTier: { model: "opus" },
  claudeId: { model: "claude-haiku-4-5-20251001", modelActual: "claude-haiku-4-5-20251001" },
  deployment: { model: "acme-prod-opus", modelActual: "acme-prod-opus" },
  gptId: { model: "gpt-5.6-sol", modelActual: "gpt-5.6-sol" },
  noModel: { modelActual: null },
  stamped: { model: "opus", modelUsed: "anthropic/claude-opus-5", modelActual: "claude-opus-5" },
};

/** The names the report lists for a run holding this one row. */
function reportNames(rec) {
  const dir = mkdtempSync(join(tmpdir(), "engine-stamp-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(driverDir(dir), "stage-x.jsonl"), `${JSON.stringify(rec)}\n`);
    return servedModels(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// [stamp, vendor billed, { row shape: [byModel key, names on the report] }]
const EXPECTED = [
  [NO_STAMP, null, {
    stageTier: ["anthropic/claude-opus", []],
    claudeId: ["anthropic/claude-haiku-4-5", ["claude-haiku-4-5-20251001"]],
    deployment: ["acme-prod-opus", []],
    gptId: ["gpt-5.6-sol", ["gpt-5.6-sol"]],
    noModel: ["unknown/no-model-reported", []],
    stamped: ["anthropic/claude-opus-5", ["claude-opus-5"]],
  }],
  ["", null, {
    stageTier: ["anthropic/claude-opus", []],
    claudeId: ["anthropic/claude-haiku-4-5", ["claude-haiku-4-5-20251001"]],
    deployment: ["acme-prod-opus", []],
    gptId: ["gpt-5.6-sol", ["gpt-5.6-sol"]],
    noModel: ["unknown/no-model-reported", []],
    stamped: ["anthropic/claude-opus-5", ["claude-opus-5"]],
  }],
  ["anthropic-agent", "anthropic", {
    stageTier: ["anthropic/claude-opus", []],
    claudeId: ["anthropic/claude-haiku-4-5", ["claude-haiku-4-5-20251001"]],
    deployment: ["acme-prod-opus", []],
    gptId: ["gpt-5.6-sol", []],
    noModel: ["anthropic-agent/no-model-reported", []],
    stamped: ["anthropic/claude-opus-5", ["claude-opus-5"]],
  }],
  ["anthropic-direct", "anthropic", {
    stageTier: ["anthropic-direct/unstamped:opus", []],
    claudeId: ["anthropic-direct/unstamped:claude-haiku-4-5-20251001", ["claude-haiku-4-5-20251001"]],
    deployment: ["anthropic-direct/unstamped:acme-prod-opus", []],
    gptId: ["anthropic-direct/unstamped:gpt-5.6-sol", []],
    noModel: ["anthropic-direct/no-model-reported", []],
    stamped: ["anthropic/claude-opus-5", ["claude-opus-5"]],
  }],
  ["anthropic-completions", "anthropic", {
    stageTier: ["anthropic-completions/unstamped:opus", []],
    claudeId: ["anthropic-completions/unstamped:claude-haiku-4-5-20251001", ["claude-haiku-4-5-20251001"]],
    deployment: ["anthropic-completions/unstamped:acme-prod-opus", []],
    gptId: ["anthropic-completions/unstamped:gpt-5.6-sol", []],
    noModel: ["anthropic-completions/no-model-reported", []],
    stamped: ["anthropic/claude-opus-5", ["claude-opus-5"]],
  }],
  ["openai-agent", "openai", {
    stageTier: ["openai-agent/unstamped:opus", []],
    claudeId: ["openai-agent/unstamped:claude-haiku-4-5-20251001", ["claude-haiku-4-5-20251001"]],
    deployment: ["openai-agent/unstamped:acme-prod-opus", ["acme-prod-opus"]],
    gptId: ["openai-agent/unstamped:gpt-5.6-sol", ["gpt-5.6-sol"]],
    noModel: ["openai-agent/no-model-reported", []],
    stamped: ["anthropic/claude-opus-5", ["claude-opus-5"]],
  }],
  ["anthropic", "anthropic", {
    stageTier: ["anthropic/claude-opus", []],
    claudeId: ["anthropic/claude-haiku-4-5", ["claude-haiku-4-5-20251001"]],
    deployment: ["acme-prod-opus", ["Haiku"]],
    gptId: ["gpt-5.6-sol", ["Haiku"]],
    noModel: ["anthropic/no-model-reported", []],
    stamped: ["anthropic/claude-opus-5", ["claude-opus-5"]],
  }],
  ["openai", "openai", {
    stageTier: ["opus", []],
    claudeId: ["claude-haiku-4-5-20251001", ["claude-haiku-4-5-20251001"]],
    deployment: ["acme-prod-opus", ["acme-prod-opus"]],
    gptId: ["gpt-5.6-sol", ["gpt-5.6-sol"]],
    noModel: ["openai/no-model-reported", []],
    stamped: ["anthropic/claude-opus-5", ["claude-opus-5"]],
  }],
  ["mystery-engine", null, {
    stageTier: ["mystery-engine/unstamped:opus", []],
    claudeId: ["mystery-engine/unstamped:claude-haiku-4-5-20251001", ["claude-haiku-4-5-20251001"]],
    deployment: ["mystery-engine/unstamped:acme-prod-opus", []],
    gptId: ["mystery-engine/unstamped:gpt-5.6-sol", []],
    noModel: ["mystery-engine/no-model-reported", []],
    stamped: ["anthropic/claude-opus-5", ["claude-opus-5"]],
  }],
];

for (const [engine, vendor, rows] of EXPECTED) {
  const name = engine === NO_STAMP ? "a row with no stamp" : `the stamp ${JSON.stringify(engine)}`;
  test(`${name} keeps its byModel key, vendor and report names`, () => {
    if (engine !== NO_STAMP) assert.equal(vendorOf(engine), vendor);
    for (const [shape, [key, names]] of Object.entries(rows)) {
      const rec = { ...SHAPES[shape], ts: "2026-01-01T00:00:00Z", ...(engine === NO_STAMP ? {} : { engine }) };
      assert.equal(modelKey(rec), key, `${shape}: byModel key`);
      assert.deepEqual(reportNames(rec), names, `${shape}: report names`);
    }
  });
}
