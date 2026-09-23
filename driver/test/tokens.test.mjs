// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for the per-run LLM token rollup (tokens.mjs — was cost.mjs; tokens-only directive,
// owner 2026-07-11: no price table, no USD anywhere in the rollup output).
// Pure offline: builds a synthetic _driver/*.jsonl tree in a temp dir — no network, no gateway.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { rollupTokens } from "../tokens.mjs";
import { MODELS } from "../driver.config.mjs";   // — what a tier is recorded as, rather than a second copy of it

// Build a temp runDir with _driver/<stage>.jsonl files (one record per line); caller cleans up.
function mkRun(stages) {
  const runDir = mkdtempSync(join(tmpdir(), "clearotron-tokens-"));
  mkdirSync(driverDir(runDir));
  for (const [stage, records] of Object.entries(stages)) {
    writeFileSync(driverDir(runDir, `${stage}.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return runDir;
}

test("rollupTokens: sums EVERY attempt (retries included) across stages; per-stage + per-model + total", () => {
  const runDir = mkRun({
    "register-digest": [
      { attempt: 1, model: "opus", usage: { input: 100, output: 1e6, cacheRead: 500, cacheWrite: 200 }, signals: { thought: true } },
      { attempt: 2, model: "opus", usage: { input: 0, output: 1e6 } },                              // retry counted
    ],
    "common-law": [
      { attempt: 1, model: "haiku", usage: { input: 1e6, output: 0 } },
    ],
    "run": [{ event: "stage", stage: "register-digest" }], // run.jsonl must be IGNORED
  });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.total.input, 1e6 + 100);
    assert.equal(r.total.output, 2e6);
    assert.equal(r.total.cacheRead, 500);
    assert.equal(r.total.cacheWrite, 200);
    assert.equal(r.total.reasoning, undefined, "the unfillable reasoning-token slot is GONE — no adapter ever populated it (no such count exists in the provider payload) and a permanent 0 read as 'no thinking'");
    assert.equal(r.total.thoughtTurns, 1, "replaced by the gauge: one of the three attempts actually engaged thinking");
    assert.equal(r.total.attempts, 3);
    assert.equal(r.byStage["register-digest"].attempts, 2);
    assert.equal(r.byStage["register-digest"].output, 2e6);
    assert.equal(r.byModel[MODELS.opus].output, 2e6);   // the alias resolved to what the catalog records
    assert.equal(r.byModel[MODELS.haiku].input, 1e6);
    assert.equal(r.byStage["run"], undefined); // run.jsonl excluded by name
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("rollupTokens: null-usage attempt → all-zero tokens but still counted; unknown model keyed as-is", () => {
  const runDir = mkRun({
    "narrative-refutation": [
      { attempt: 1, model: "deepseek-v4-pro", usage: null },                            // stall → 0 tokens, still counted
      { attempt: 2, model: "deepseek-v4-pro", usage: { input: 1e6, output: 0 } },
    ],
    "mystery": [
      { attempt: 1, model: "acme/unknown", usage: { input: 7 } },
    ],
  });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.total.input, 1e6 + 7);
    assert.equal(r.total.attempts, 3);
    assert.equal(r.byModel["together/deepseek-ai/DeepSeek-V4-Pro"].attempts, 2);
    assert.equal(r.byModel["acme/unknown"].input, 7);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("rollupTokens: legacy rows carrying costUsd are read for usage only — money never re-emitted", () => {
  const runDir = mkRun({
    "register-digest": [
      { attempt: 1, model: "opus", usage: { input: 10, output: 20 }, costUsd: 25.5, pricedModel: true }, // historical row
    ],
  });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.total.input, 10);
    assert.equal(r.total.output, 20);
    assert.doesNotMatch(JSON.stringify(r), /usd|price|[$]/i);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// Regression (owner directive 2026-07-11): the rollup output must contain NO currency-looking field,
// in keys or values — tokens only.
test("rollupTokens: output contains no currency-looking fields (/usd|price|$/i)", () => {
  const runDir = mkRun({
    "register-digest": [
      { attempt: 1, model: "opus", usage: { input: 100, output: 1e6, cacheRead: 500, cacheWrite: 200 } },
      { attempt: 2, model: "sonnet", usage: { input: 5, output: 5 } },
    ],
    "common-law": [{ attempt: 1, model: "haiku", usage: { input: 1e6, output: 0 } }],
  });
  try {
    const r = rollupTokens(runDir);
    assert.doesNotMatch(JSON.stringify(r), /usd|price|[$]/i);
    const keys = [];
    const walk = (o) => { for (const [k, v] of Object.entries(o)) { keys.push(k); if (v && typeof v === "object") walk(v); } };
    walk(r);
    for (const k of keys) assert.doesNotMatch(k, /usd|price|cost|[$]/i, `currency-looking key in rollup: ${k}`);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// Regression (2026-07-28): the jx lanes bypass the gateway and write their own per-call ledger. Their
// rows named the counts `tokens` and carried no `model`, so the model gate dropped every one and the
// lane's spend was counted nowhere — a whole native-language lane invisible to every per-run total.
test("rollupTokens: native-language jx-completions rows are counted, split out under their own stage", () => {
  const runDir = mkRun({
    "register-digest": [{ attempt: 1, model: "opus", usage: { input: 100, output: 200 } }],
    "jx-completions": [
      { ts: "t", lane: "zh", mark: "M", executor: "completions", ok: true, candidates: 3,
        model: "claude-haiku-4-5-20251001", usage: { input: 900, output: 40 } },
      { ts: "t", lane: "ko", mark: "M", unit: "nativeread", ok: false, cause: "truncated",
        model: "claude-haiku-4-5-20251001", usage: { input: 10, output: 5 } },   // a degrade still spent
      { ts: "t", lane: "ja", mark: "M", ok: false, cause: "executor threw" },     // no call made → no model, skipped
    ],
  });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.total.input, 100 + 900 + 10, "jx input tokens reach the run total");
    assert.equal(r.total.output, 200 + 40 + 5);
    assert.equal(r.byStage["jx-completions"].attempts, 2, "the throw row carries no model and is not a call");
    // TWO SPELLINGS OF THE MODEL THAT SERVED A NATIVE-LANGUAGE TURN FOLD TOGETHER — dated and undated are one key.
    assert.equal(r.byModel["anthropic/claude-haiku-4-5"].input, 910);
    assert.equal(r.byModel["claude-haiku-4-5-20251001"], undefined, "one model named two ways took two keys");
    // AND THE STAGE'S TIER KEYS APART FROM IT, WHICH IS RULED AND ACCEPTED, NOT A DEFECT. A stage's row is
    // keyed on the tier it asked for; a native-language row records the model that served it and is keyed
    // on that. One model reached both ways therefore lands in two buckets.
    // Pinned so the split reads as a decision to whoever finds it in a total, rather than as a bug.
    assert.equal(r.byModel[MODELS.opus].input, 100, "the stage's tier does not key under what the catalog records for it");
    assert.equal(r.byModel[MODELS.haiku], undefined, "no stage asked for that tier on this run, so nothing may account under it");
    assert.notEqual(MODELS.haiku, "anthropic/claude-haiku-4-5", "a tier resolves to a version again — the split this arm describes is no longer the shape of things");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// Tokens are not a portable unit of cost: a subscription turn appears on no API invoice, and two engines'
// tokens are not the same thing. A rollup that cannot say WHICH engine spent them cannot answer a margin
// question — so engine and billing mode are first-class axes beside model.
test("rollupTokens: splits by engine and billing mode; rows predating the stamp are not guessed at", () => {
  const runDir = mkRun({
    "synthesis": [
      { attempt: 1, model: "opus", engine: "anthropic-agent", authMode: "subscription", usage: { input: 10, output: 100 } },
      { attempt: 2, model: "opus", engine: "anthropic-agent", authMode: "api", usage: { input: 5, output: 50 } },
    ],
    "case-law": [
      { attempt: 1, model: "sonnet", engine: "openai-agent", authMode: "api", usage: { input: 1, output: 7 } },
      { attempt: 1, model: "sonnet", usage: { input: 1000, output: 2000 } },   // legacy row: no engine stamp
    ],
  });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.byEngine["anthropic-agent"].output, 150);
    assert.equal(r.byEngine["anthropic-agent"].attempts, 2);
    assert.equal(r.byEngine["openai-agent"].output, 7);
    assert.equal(r.byAuthMode["subscription"].output, 100, "subscription tokens are on no API invoice — kept separate");
    assert.equal(r.byAuthMode["api"].output, 57, "across both engines");
    assert.equal(r.byEngine["unknown"].output, 2000, "an unstamped row is bucketed VISIBLY, never dropped");
    assert.equal(r.total.output, 2157, "the legacy row still counts toward the run total");
    // the invariant that makes the split trustworthy: every token is attributed to some bucket
    const sum = (m, k) => Object.values(m).reduce((n, a) => n + a[k], 0);
    for (const k of ["input", "output", "cacheRead", "cacheWrite", "attempts"]) {
      assert.equal(sum(r.byEngine, k), r.total[k], `byEngine sums to total for ${k}`);
      assert.equal(sum(r.byAuthMode, k), r.total[k], `byAuthMode sums to total for ${k}`);
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// — the rollup relabelled every engine's tokens as Anthropic models, because it re-resolved the
// TIER ("opus") through the Anthropic catalog instead of reading the id the engine reported. A real R3
// codex run shipped `byEngine: {openai-agent}` beside `byModel: {anthropic/claude-opus-5}`, and the
// consumption ledger carries the second one.
test("rollupTokens: byModel names the model the ENGINE served, not the tier resolved through the Anthropic catalog", () => {
  const runDir = mkRun({
    "register-digest": [
      // a codex turn, stamped exactly as gateway.mjs stamps it
      { attempt: 1, model: "opus", modelUsed: "gpt-5.6-sol", engine: "openai-agent", authMode: "subscription",
        usage: { input: 55853, output: 10411, cacheRead: 280064 } },
    ],
    "synthesis": [
      // an anthropic turn in the same run — both must key honestly, in one rollup
      { attempt: 1, model: "opus", modelUsed: "anthropic/claude-opus-5", engine: "anthropic-agent", authMode: "api",
        usage: { input: 10, output: 20 } },
    ],
  });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.byModel["gpt-5.6-sol"].output, 10411, "the codex turn keys off the id codex actually ran");
    assert.equal(r.byModel["gpt-5.6-sol"].cacheRead, 280064);
    assert.equal(r.byModel["anthropic/claude-opus-5"].output, 20, "and the anthropic turn is untouched");
    assert.equal(r.byModel["anthropic/claude-opus-5"].input, 10);
    assert.equal(r.byModel["gpt-5.6-sol"].input, 55853);

    // THE CONTRADICTION THE ISSUE IS ABOUT: the codex engine's tokens and the codex model's tokens are
    // now the same tokens. Asserted as an equality between the two halves rather than on either alone,
    // because either alone was already "right" while the pair disagreed.
    for (const k of ["input", "output", "cacheRead"]) {
      assert.equal(r.byModel["gpt-5.6-sol"][k], r.byEngine["openai-agent"][k],
        `byModel and byEngine agree on the codex share of ${k}`);
    }
    // The literal here is the STAMP the row carries, not a resolution: a stamped row keys by what it
    // says served it, which is why changing what a tier resolves to does not touch this arm.
    assert.deepEqual(Object.keys(r.byModel).sort(), ["anthropic/claude-opus-5", "gpt-5.6-sol"],
      "two turns, two honestly-named models — and no third key invented by re-resolving a tier");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("rollupTokens: a non-anthropic row with NO modelUsed accounts under a named gap, never as an Anthropic id", () => {
  const runDir = mkRun({
    "case-law": [
      { attempt: 1, model: "opus", engine: "openai-agent", usage: { input: 3, output: 4 } },   // unstamped, non-anthropic
      { attempt: 2, model: "opus", engine: "anthropic-agent", usage: { input: 1, output: 2 } }, // unstamped, anthropic → resolved
      { attempt: 3, model: "opus", usage: { input: 100, output: 200 } },                        // legacy: no engine at all
    ],
  });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.byModel["openai-agent/unstamped:opus"].output, 4,
      "the tokens still account, under a key that says what is missing");
    // AND THEY KEY UNDER WHAT THE CATALOG RECORDS TODAY, which is the one visible cost of recording a
    // tier rather than a version. A row that carries no served stamp — a legacy row, or one of these —
    // is keyed by resolving its tier, so re-reading an archived run keys it as a tier where it once
    // read as a version. Nothing already published moves; what changes is how an old run reads when it
    // is read again. Ruled and accepted 2026-09-23, and pinned here so it is a decision on the record.
    assert.equal(r.byModel[MODELS.opus].output, 202,
      "an unstamped anthropic row and a legacy row with no engine both resolve through the catalog, as they always have");
    assert.equal(r.byModel[MODELS.opus].attempts, 2);

    // byModel must sum to total, exactly as byEngine and byAuthMode already do. Without this a future
    // 'drop the ones we cannot name' would look like a tidy-up and silently shrink the run's economics.
    const sum = (m, k) => Object.values(m).reduce((n, a) => n + a[k], 0);
    for (const k of ["input", "output", "cacheRead", "cacheWrite", "attempts"]) {
      assert.equal(sum(r.byModel, k), r.total[k], `byModel sums to total for ${k}`);
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("rollupTokens: missing _driver dir → all-zero, never throws", () => {
  const r = rollupTokens("/no/such/run/dir");
  assert.equal(r.total.input, 0);
  assert.equal(r.total.attempts, 0);
  assert.deepEqual(r.byStage, {});
});

test("rollupTokens: thoughtTurns counts === true strictly — null (engine does not report) and pre-gauge records never inflate it", () => {
  const runDir = mkRun({
    "synthesis": [
      { attempt: 1, model: "opus", usage: { input: 1, output: 1 }, signals: { thought: true } },
      { attempt: 2, model: "opus", usage: { input: 1, output: 1 }, signals: { thought: false } },
      { attempt: 3, model: "opus", usage: { input: 1, output: 1 }, signals: { thought: null } },   // openai-agent: does not report
      { attempt: 4, model: "opus", usage: { input: 1, output: 1 }, signals: {} },                  // pre-gauge record
      { attempt: 5, model: "opus", usage: { input: 1, output: 1 } },                               // no signals at all
    ],
  });
  try {
    const r = rollupTokens(runDir);
    assert.equal(r.byStage["synthesis"].attempts, 5);
    assert.equal(r.byStage["synthesis"].thoughtTurns, 1, "only the one true counts; null/absent are UNKNOWN, never a thinking turn");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
