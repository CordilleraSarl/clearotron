// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a real stage turn through the mock program and reads the rows it wrote
// A machine that pays for Claude through its own Google, Microsoft or Amazon account, or through a gateway
// in front of one, sets CLEAROTRON_AI_BILLING=cloud. Before that mode existed such a machine had two
// choices and both were wrong: `api-key` refused for want of an Anthropic key it does not have, and
// `subscription` ran and stamped every row as billed to a subscription nobody was paying (measured in
// testing on Azure Foundry, 2026-09-14).
//
// What the arms hold:
//   - resolveAuthMode names the cloud from the vendor's own switch, or `gateway` for ANTHROPIC_BASE_URL
//     alone; refuses with no cloud switched on and with two; refuses a word that is not a mode on either
//     engine; refuses cloud on the Codex engine; and keeps the subscription and api-key results as they were;
//   - spawnEnv drops ANTHROPIC_API_KEY under cloud, lets a gateway's own token through, and never throws;
//   - providerOf reads the program's own provider word, and names none when the models disagree;
//   - a real stage turn under cloud stamps the mode, the bill, the cloud and the reported provider on its
//     row and on the run log, and the CONTROL turn under subscription stamps no cloud;
//   - the jx runner and its ledger stamp carry the cloud too;
//   - the config inventory records each cloud refusal as itself, never as a missing API key;
//   - the probe refuses a cloud mode with no cloud switched on before it spends a turn.
//
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive, so the
// env is pinned before any product module is imported.
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "cloud-billing-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
delete process.env.CLEAROTRON_MCP_URL;
import { test } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";
const { resolveAuthMode, billingMode } = await import("../engine/auth.mjs");
const { spawnEnv, providerOf } = await import("../engine/anthropic-agent.mjs");
const { runStage } = await import("../gateway.mjs");
const { makeJxTurnRunner } = await import("../engine/jx-turn.mjs");
const { jxBillingStamp } = await import("../jx-lanes.mjs");
const { engineInventory } = await import("../config-inventory.mjs");
const { probeEngineTurn, classifyProbe } = await import("../engine/probe.mjs");

const MOCK = join(dirname(fileURLToPath(import.meta.url)), "mock-claude.mjs");
const claude = (env) => resolveAuthMode({ engineName: "anthropic-agent", env });
const NONE = /none of CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY, CLAUDE_CODE_USE_BEDROCK or ANTHROPIC_BASE_URL is set/;

test("cloud names the account from the vendor's own switch, and ANTHROPIC_BASE_URL alone is the gateway form", () => {
  const cloud = (env) => claude({ CLEAROTRON_AI_BILLING: "cloud", ...env });
  assert.deepEqual(cloud({ CLAUDE_CODE_USE_FOUNDRY: "1" }), { provider: "anthropic", mode: "cloud", apiBilled: true, cloud: "foundry" });
  assert.equal(cloud({ CLAUDE_CODE_USE_VERTEX: "true" }).cloud, "vertex");
  assert.equal(cloud({ CLAUDE_CODE_USE_BEDROCK: "Yes" }).cloud, "bedrock");
  assert.equal(cloud({ ANTHROPIC_BASE_URL: "https://gateway.test" }).cloud, "gateway");
  assert.equal(cloud({ CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_BASE_URL: "https://gateway.test" }).cloud, "foundry",
    "with a switch on, the switch is what the program routes on");
  assert.equal(claude({ CLEAROTRON_AI_BILLING: " Cloud ", CLAUDE_CODE_USE_FOUNDRY: "1" }).mode, "cloud",
    "the word is read the way the other two are");
});

test("cloud refuses by name: no cloud switched on, a switch set to off, and two switched on", () => {
  const cloud = (env) => () => claude({ CLEAROTRON_AI_BILLING: "cloud", ...env });
  assert.throws(cloud({}), NONE);
  assert.throws(cloud({ CLAUDE_CODE_USE_FOUNDRY: "0" }), NONE, "a switch set to 0 is off, as the program reads it");
  // An Anthropic key on the machine does not rescue it: that would be a quiet bill to the key.
  assert.throws(cloud({ ANTHROPIC_API_KEY: "sk-x" }), NONE);
  assert.throws(cloud({ CLAUDE_CODE_USE_FOUNDRY: "1", CLAUDE_CODE_USE_VERTEX: "1" }),
    /more than one cloud is switched on \(CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY\)/);
});

test("a word that is not a billing mode is refused on both engines, where it used to bill the subscription", () => {
  for (const engineName of ["anthropic-agent", "openai-agent"])
    assert.throws(() => resolveAuthMode({ engineName, env: { CLEAROTRON_AI_BILLING: "subscriptoin" } }),
      /CLEAROTRON_AI_BILLING=subscriptoin is not a billing mode/, engineName);
  // CONTROL: unset, blank and differently cased words still read as the mode they spell, and the two older
  // modes keep the exact shape every existing reader takes.
  for (const env of [{}, { CLEAROTRON_AI_BILLING: "  " }, { CLEAROTRON_AI_BILLING: "Subscription" }])
    assert.deepEqual(claude(env), { provider: "anthropic", mode: "subscription", apiBilled: false }, JSON.stringify(env));
  assert.deepEqual(claude({ CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk-x" }), { provider: "anthropic", mode: "api-key", apiBilled: true });
  assert.equal(billingMode({}), "subscription");
});

test("cloud on the Codex engine is refused, rather than billed to the ChatGPT subscription", () => {
  assert.throws(() => resolveAuthMode({ engineName: "openai-agent", env: { CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1" } }),
    /this machine runs the Codex engine/);
});

test("spawnEnv: cloud drops the Anthropic key, lets a gateway's own token through, and never throws", () => {
  const env = spawnEnv({ CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_AUTH_TOKEN: "gw-x" });
  assert.equal(env.ANTHROPIC_API_KEY, undefined, "a leftover key can never be what bills a cloud turn");
  assert.equal(env.CLAUDE_CODE_USE_FOUNDRY, "1", "the vendor's switch reaches the program");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, "gw-x", "a gateway's credential is its own token, and it rides through");
  // It never validates: the doors refuse a bad word before any turn spawns, and a spawn must not throw.
  for (const base of [{ CLEAROTRON_AI_BILLING: "cloud" }, { CLEAROTRON_AI_BILLING: "not-a-mode", ANTHROPIC_API_KEY: "sk-x" }])
    assert.doesNotThrow(() => spawnEnv(base), JSON.stringify(base));
  assert.equal(spawnEnv({ CLEAROTRON_AI_BILLING: "not-a-mode", ANTHROPIC_API_KEY: "sk-x" }).ANTHROPIC_API_KEY, undefined,
    "anything but api-key drops the key");
  // CONTROL: api-key keeps it.
  assert.equal(spawnEnv({ CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk-x" }).ANTHROPIC_API_KEY, "sk-x");
});

test("providerOf: the program's own provider word, one word or none", () => {
  assert.equal(providerOf({ modelUsage: { "claude-opus-5": { provider: "foundry" } } }), "foundry");
  assert.equal(providerOf({ modelUsage: { "claude-haiku-4-5-20251001": { provider: "firstParty" }, "claude-opus-5": { provider: "firstParty" } } }),
    "firstParty", "a turn that used two models on one provider names it once");
  assert.equal(providerOf({ modelUsage: { a: { provider: "foundry" }, b: { provider: "firstParty" } } }), null,
    "models that disagree name no one provider");
  for (const none of [null, undefined, {}, { modelUsage: {} }, { modelUsage: { a: {} } }, { modelUsage: { a: { provider: " " } } }])
    assert.equal(providerOf(none), null, JSON.stringify(none));
});

/** One real stage turn through the mock program, with `env` set for its duration; returns its rows. */
async function stageTurn(tag, env) {
  const runDir = mkdtempSync(join(ROOT, `run-${tag}-`));
  mkdirSync(driverDir(runDir), { recursive: true });
  const out = join(runDir, "out.md");
  const keys = ["CLEAROTRON_AI", "CLEAROTRON_AI_BILLING", "CLAUDE_CODE_USE_FOUNDRY", "MOCK_CLAUDE_PROVIDER"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const savedPath = envFrom(process.env, "CLEAROTRON_CLAUDE_PATH");
  for (const k of keys) { if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", MOCK);
  try {
    const r = await runStage(`cloud-${tag}`, {
      agent: "clawdi", sessionKey: `clearotron-test-cloud-${tag}`,
      message: `Do the task. Write to the ABSOLUTE path for the stage output: ${out}`,
      model: "opus", thinking: "medium", timeoutSec: 60, expectFile: out, validate: () => ({ ok: true }), runDir, maxRetries: 0,
    });
    assert.equal(r.ok, true, `the turn itself must succeed for its row to mean anything: ${JSON.stringify(r).slice(0, 300)}`);
    const read = (name) => readFileSync(driverDir(runDir, name), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    return { row: read(`cloud-${tag}.jsonl`).at(-1), spine: read("run.jsonl").filter((e) => e.event === "attempt").at(-1) };
  } finally {
    for (const k of keys) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", savedPath);
  }
}

test("a real stage turn under cloud stamps the mode, the bill, the cloud and the provider the program reported", async () => {
  const { row, spine } = await stageTurn("foundry",
    { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1", MOCK_CLAUDE_PROVIDER: "foundry" });
  assert.equal(row.authMode, "cloud");
  assert.equal(row.apiBilled, true, "a cloud account bills per use");
  assert.equal(row.cloud, "foundry");
  assert.equal(row.providerReported, "foundry", "the program's own word for who served it sits beside ours");
  assert.ok(spine, "the run log carries an attempt event");
  assert.equal(spine.authMode, "cloud");
  assert.equal(spine.cloud, "foundry");
  assert.equal(spine.providerReported, "foundry");
});

test("the CONTROL: the same turn under subscription stamps no cloud, and a program that names no provider records null", async () => {
  const { row, spine } = await stageTurn("subscription", { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "subscription" });
  assert.equal(row.authMode, "subscription");
  assert.equal(row.apiBilled, false);
  assert.ok("cloud" in row && "providerReported" in row, "written unconditionally, so 'none' reads differently from 'not recorded'");
  assert.equal(row.cloud, null);
  assert.equal(row.providerReported, null);
  assert.equal(spine.cloud, null);
});

test("the jx runner and its ledger stamp carry the cloud as well", async () => {
  const run = await makeJxTurnRunner({
    env: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1" },
    runTurn: async () => ({ code: 0, killed: false, json: { status: "ok", result: { payloads: [{ text: "ok" }] } }, usage: null, modelWire: "claude-opus-5" }),
  });
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.authMode, "cloud");
  assert.equal(run.cloud, "foundry");
  const t = await run.turn({ prompt: "x" });
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(t.cloud, "foundry");
  assert.deepEqual(jxBillingStamp("engine", t), { engine: "anthropic", authMode: "cloud", cloud: "foundry" });
  // CONTROL: a turn no provider served says so, and names no cloud.
  assert.deepEqual(jxBillingStamp("fixture", t), { engine: "not-provider-billed", authMode: "not-provider-billed", cloud: null });
});

test("the config inventory records each cloud refusal as itself, never as a missing API key", () => {
  const none = engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "cloud", PATH: "" });
  assert.equal(none.billing.mode, "cloud");
  assert.equal(none.billing.apiBilled, false, "a refused run bills nobody");
  assert.deepEqual(none.billing.missing, [], "the page reads `missing` as 'set this API key', which would be false here");
  assert.match(none.billing.refusal, NONE);
  const word = engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "subscriptoin", PATH: "" });
  assert.match(word.billing.refusal, /is not a billing mode/);
  assert.deepEqual(word.billing.missing, []);
  const ok = engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1", PATH: "" });
  assert.deepEqual(ok.billing, { mode: "cloud", apiBilled: true, missing: [] });
  // CONTROL: the API-key refusal keeps its own shape, naming the key.
  assert.deepEqual(engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "api-key", PATH: "" }).billing,
    { mode: "api-key", apiBilled: false, missing: ["ANTHROPIC_API_KEY"] });
});

test("the probe refuses a cloud mode with no cloud switched on before it spends a turn", async () => {
  let calls = 0;
  const v = await probeEngineTurn({
    env: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "cloud" },
    loadAdapter: () => { throw new Error("the adapter must not load for a refused configuration"); },
    runTurn: async () => { calls++; return { code: 0 }; },
  });
  assert.equal(calls, 0, "a configuration error must not cost a turn");
  assert.equal(v.ok, false);
  assert.equal(v.mode, "auth-misconfigured");
  assert.match(v.fix, NONE);
  // Every refusal auth.mjs makes is that one class to the probe, by what it is rather than by its wording.
  for (const env of [{ CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1", CLAUDE_CODE_USE_VERTEX: "1" }, { CLEAROTRON_AI_BILLING: "subscriptoin" }]) {
    let error = null;
    try { claude(env); } catch (e) { error = e; }
    assert.ok(error, `refused: ${JSON.stringify(env)}`);
    assert.equal(classifyProbe({ engine: "anthropic-agent", error }).mode, "auth-misconfigured", JSON.stringify(env));
  }
  // CONTROL: a sign-in failure whose message also names the setting is not taken for a billing refusal.
  const signedOut = new Error("CLEAROTRON_AI_BILLING=subscription but no auth.json at /x — run `codex login`");
  assert.notEqual(classifyProbe({ engine: "openai-agent", error: signedOut }).mode, "auth-misconfigured");
});
