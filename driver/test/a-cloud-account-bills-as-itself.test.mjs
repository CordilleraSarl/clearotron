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
//   - a cloud switch left on under subscription or api-key is refused, because the program bills that cloud
//     whatever the word says, and a missing key is still named first;
//   - spawnEnv drops ANTHROPIC_API_KEY under cloud, lets a gateway's own token through, and never throws;
//   - providerOf reads the program's own provider word, and names none when the models disagree;
//   - a real stage turn under cloud stamps the mode, the bill, the cloud and the reported provider on its
//     row and on the run log, and the CONTROL turn under subscription stamps no cloud;
//   - the native-language runner's own turn carries the cloud, and so does the record those steps write:
//     driven through the lane's real call (runJxTurn) into the ledger stamp, success and degrade alike, with
//     a subscription CONTROL that records no cloud;
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
const { resolveAuthMode, billingMode, CLOUD_SWITCH } = await import("../engine/auth.mjs");
const { spawnEnv, providerOf } = await import("../engine/anthropic-agent.mjs");
const { runStage } = await import("../gateway.mjs");
const { makeJxTurnRunner } = await import("../engine/jx-turn.mjs");
const { jxBillingStamp } = await import("../jx-lanes.mjs");
const { runJxTurn } = await import("../../providers/jx/src/turn-envelope.mjs");
const { engineInventory, cloudName } = await import("../config-inventory.mjs");
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

test("a cloud switch left on under subscription or api-key is refused, because the program bills that cloud whatever the word says", () => {
  // Measured on Foundry, 2026-09-14: the switch on and the word unset, the program reported Foundry as its
  // provider and the row said subscription.
  let refused = 0;
  for (const base of [{}, { CLEAROTRON_AI_BILLING: "subscription" }, { CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk-x" }])
    for (const sw of ["CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_BEDROCK"]) {
      const env = { ...base, [sw]: "1" };
      let error = null;
      try { claude(env); } catch (e) { error = e; }
      assert.ok(error, `refused: ${JSON.stringify(env)}`);
      assert.match(error.message,
        new RegExp(`^${sw} is on, which sends Claude to that cloud account, while CLEAROTRON_AI_BILLING says ${billingMode(env)} `));
      assert.equal(error.billingRefusal, true);
      const p = classifyProbe({ engine: "anthropic-agent", error });
      assert.equal(p.mode, "auth-misconfigured", JSON.stringify(env));
      assert.match(p.headline, /the billing setting this box declares is refused/, "a key that is set is not reported as absent");
      refused++;
    }
  assert.equal(refused, 9);
  assert.throws(() => claude({ CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_USE_BEDROCK: "on" }),
    { message: /^CLAUDE_CODE_USE_VERTEX and CLAUDE_CODE_USE_BEDROCK are on, .* or turn them off\.$/ });
  assert.throws(() => claude({ CLEAROTRON_AI_BILLING: "api-key", CLAUDE_CODE_USE_BEDROCK: "1" }),
    { message: /^CLEAROTRON_AI_BILLING=api-key but ANTHROPIC_API_KEY is not set/ }, "a missing key is named first, as the config page names it");
  // CONTROL: a switch that is off, and a gateway address alone, leave both modes as they were, and the
  // Codex engine does not read Claude's switches at all.
  for (const env of [{ CLAUDE_CODE_USE_FOUNDRY: "0" }, { CLAUDE_CODE_USE_FOUNDRY: "" }, { ANTHROPIC_BASE_URL: "https://gateway.test" }])
    assert.deepEqual(claude(env), { provider: "anthropic", mode: "subscription", apiBilled: false }, JSON.stringify(env));
  assert.deepEqual(claude({ CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_BASE_URL: "https://gateway.test" }),
    { provider: "anthropic", mode: "api-key", apiBilled: true });
  assert.deepEqual(resolveAuthMode({ engineName: "openai-agent", env: { CLAUDE_CODE_USE_FOUNDRY: "1" } }),
    { provider: "openai", mode: "subscription", apiBilled: false });
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

test("the native-language runner's own turn carries the cloud, and the stamp reads it from a turn handed to it", async () => {
  // This holds the runner and the stamp each on their own. It hands the stamp the runner's RAW turn, which
  // no record is written from, so on its own it cannot see a field dropped between the two; the arm below
  // drives the call the records are actually written from.
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

/**
 * One native-language call the way a lane makes it: the runner bound to `env`, then the lane's own call
 * (runJxTurn), whose return is what every native-language record is stamped from. `text` is what the
 * program answered; prose is an unreadable answer, which the lane records as a degrade.
 */
async function nativeLanguageCall(env, text) {
  const run = await makeJxTurnRunner({ env, runTurn: async () => ({
    code: 0, killed: false, signals: {}, usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, total: 12 },
    json: { status: "ok", stopReason: "end_turn", result: { payloads: [{ text }] } }, modelWire: "claude-haiku-4-5-20251001" }) });
  assert.equal(run.error, undefined, run.error);
  return runJxTurn({
    body: { messages: [{ content: "List the candidates." }], tools: [{ name: "emit_candidates", input_schema: { type: "object" } }] },
    turn: run.turn, kind: "jx-completions", started: Date.now(), truncatedCause: "truncated",
    parse: (envelope) => ({ candidates: envelope?.content?.[0]?.input?.candidates ?? [] }),
  });
}

test("a native-language record names the cloud that paid, on an answer and on a degrade", async () => {
  // Measured before this arm, 2026-09-14: the same run's main steps recorded `cloud: "foundry"` and every
  // native-language record `cloud: null`, because the lane's call dropped the field the runner handed it.
  const env = { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1" };
  const answered = await nativeLanguageCall(env, '{"candidates":[]}');
  assert.equal(answered.ok, true, JSON.stringify(answered));
  assert.equal(answered.cloud, "foundry", "the lane's call hands on the cloud the runner named");
  assert.deepEqual(jxBillingStamp("engine", answered), { engine: "anthropic", authMode: "cloud", cloud: "foundry" });
  const degraded = await nativeLanguageCall(env, "I could not find any.");
  assert.equal(degraded.ok, false, "prose is not an answer object");
  assert.deepEqual(jxBillingStamp("engine", degraded), { engine: "anthropic", authMode: "cloud", cloud: "foundry" },
    "a degrade still spent the cloud's tokens, so its record names the cloud too");
});

test("the CONTROL: a native-language record under subscription names no cloud", async () => {
  const r = await nativeLanguageCall({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "subscription" }, '{"candidates":[]}');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok("cloud" in r, "written unconditionally, so 'no cloud' reads differently from 'not recorded'");
  assert.equal(r.cloud, null);
  assert.deepEqual(jxBillingStamp("engine", r), { engine: "anthropic", authMode: "subscription", cloud: null });
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
  assert.deepEqual(ok.billing, { mode: "cloud", apiBilled: true, missing: [], cloud: "foundry", cloudName: "Microsoft Azure" });
  // CONTROL: the API-key refusal keeps its own shape, naming the key.
  assert.deepEqual(engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "api-key", PATH: "" }).billing,
    { mode: "api-key", apiBilled: false, missing: ["ANTHROPIC_API_KEY"], cloud: null, cloudName: null });
  // A cloud switch beside a key that IS set is a refusal, not a missing key; with the key absent too, the
  // page names the key first, as the run door does.
  const keyed = engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk-x", CLAUDE_CODE_USE_BEDROCK: "1", PATH: "" });
  assert.deepEqual(keyed.billing.missing, [], "the key is set; the page must not ask for it");
  assert.match(keyed.billing.refusal, /^CLAUDE_CODE_USE_BEDROCK is on/);
  assert.match(engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLAUDE_CODE_USE_FOUNDRY: "1", PATH: "" }).billing.refusal,
    /^CLAUDE_CODE_USE_FOUNDRY is on, .* says subscription /);
  assert.deepEqual(engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "api-key", CLAUDE_CODE_USE_BEDROCK: "1", PATH: "" }).billing,
    { mode: "api-key", apiBilled: false, missing: ["ANTHROPIC_API_KEY"], cloud: null, cloudName: null });
});

test("the config inventory names the cloud that pays, from the run's own resolution, and no cloud for the other two modes", () => {
  const billing = (env) => engineInventory({ CLEAROTRON_AI: "anthropic-agent", PATH: "", ...env }).billing;
  const cloud = { CLEAROTRON_AI_BILLING: "cloud" };
  // Each cloud by its switch, and the gateway by its address alone: the name is the one the credential
  // advice already uses for that cloud, so the page and that advice cannot call a cloud two things.
  for (const [env, id, name] of [
    [{ CLAUDE_CODE_USE_VERTEX: "1" }, "vertex", "Google Cloud"],
    [{ CLAUDE_CODE_USE_FOUNDRY: "1" }, "foundry", "Microsoft Azure"],
    [{ CLAUDE_CODE_USE_BEDROCK: "1" }, "bedrock", "Amazon Bedrock"],
    [{ ANTHROPIC_BASE_URL: "https://gateway.test" }, "gateway", "Gateway"],
  ]) {
    assert.deepEqual(billing({ ...cloud, ...env }), { mode: "cloud", apiBilled: true, missing: [], cloud: id, cloudName: name }, JSON.stringify(env));
    assert.equal(billing({ ...cloud, ...env }).cloud, claude({ ...cloud, ...env }).cloud, "the inventory and the run door name different clouds");
  }
  // CONTROL: subscription, and an API key that is set, name no cloud, and a gateway address beside them
  // changes neither; the Codex engine names none either.
  for (const env of [{}, { CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk-x" }, { ANTHROPIC_BASE_URL: "https://gateway.test" }]) {
    const b = billing(env);
    assert.equal(b.cloud, null, JSON.stringify(env));
    assert.equal(b.cloudName, null, JSON.stringify(env));
    assert.equal(b.reason, undefined, `a paying setting carries no refusal reason: ${JSON.stringify(env)}`);
  }
  assert.equal(engineInventory({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "k", PATH: "" }).billing.cloud, null);
});

test("every billing refusal carries its reason as a kind and the names in it, never the value of a setting", () => {
  const reason = (env, engine = "anthropic-agent") => engineInventory({ CLEAROTRON_AI: engine, PATH: "", ...env }).billing.reason;
  const cloudOf = (c) => ({ name: { vertex: "Google Cloud", foundry: "Microsoft Azure", bedrock: "Amazon Bedrock" }[c],
    setting: { vertex: "CLAUDE_CODE_USE_VERTEX", foundry: "CLAUDE_CODE_USE_FOUNDRY", bedrock: "CLAUDE_CODE_USE_BEDROCK" }[c] });
  const base = { setting: "CLEAROTRON_AI_BILLING", mode: null, defaulted: false, clouds: [], modes: [], gateway: null, engineSetting: null, engineChoice: null };

  assert.deepEqual(reason({ CLEAROTRON_AI_BILLING: "subscription", CLAUDE_CODE_USE_FOUNDRY: "1" }),
    { ...base, kind: "switch-beside-mode", mode: "subscription", clouds: [cloudOf("foundry")] });
  // AN UNSET WORD IS SUBSCRIPTION, AND SAYS SO: the page must not tell a reader the setting holds a word
  // their file does not have. Blank and whitespace are unset too, as billingMode reads them.
  for (const unset of [{}, { CLEAROTRON_AI_BILLING: "" }, { CLEAROTRON_AI_BILLING: "  " }]) {
    assert.deepEqual(reason({ ...unset, CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_USE_BEDROCK: "on" }),
      { ...base, kind: "switch-beside-mode", mode: "subscription", defaulted: true, clouds: [cloudOf("vertex"), cloudOf("bedrock")] },
      `an unset word is subscription, by default: ${JSON.stringify(unset)}`);
  }
  assert.deepEqual(reason({ CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk-x", CLAUDE_CODE_USE_BEDROCK: "1" }),
    { ...base, kind: "switch-beside-mode", mode: "api-key", clouds: [cloudOf("bedrock")] });
  assert.deepEqual(reason({ CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1", CLAUDE_CODE_USE_VERTEX: "1" }),
    { ...base, kind: "two-clouds", mode: "cloud", clouds: [cloudOf("vertex"), cloudOf("foundry")] });
  assert.deepEqual(reason({ CLEAROTRON_AI_BILLING: "cloud" }),
    { ...base, kind: "no-cloud", mode: "cloud", clouds: [cloudOf("vertex"), cloudOf("foundry"), cloudOf("bedrock")], gateway: "ANTHROPIC_BASE_URL" });
  assert.deepEqual(reason({ CLEAROTRON_AI_BILLING: "subscriptoin" }),
    { ...base, kind: "not-a-mode", modes: ["subscription", "api-key", "cloud"] });
  assert.deepEqual(reason({ CLEAROTRON_AI_BILLING: "subscriptoin" }, "openai-agent"),
    { ...base, kind: "not-a-mode", modes: ["subscription", "api-key"] }, "Codex takes two modes, and the reason names those two");
  assert.deepEqual(reason({ CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1" }, "openai-agent"),
    { ...base, kind: "cloud-on-codex", mode: "cloud", modes: ["subscription", "api-key"], engineSetting: "CLEAROTRON_AI", engineChoice: "anthropic-agent" });
  assert.equal(reason({ CLEAROTRON_AI_BILLING: "cloud", ANTHROPIC_BASE_URL: "https://gateway.test" }, "openai-agent").engineChoice, "anthropic-agent",
    "a gateway address alone is a cloud the Claude engine pays through");
  // MOVING TO THE CLAUDE ENGINE IS OFFERED ONLY WHERE IT WOULD PAY. With no cloud chosen, or two, that
  // engine refuses too, so the reason names no engine to move to.
  for (const env of [{}, { CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_USE_BEDROCK: "1" }, { CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_USE_FOUNDRY: "1", CLAUDE_CODE_USE_BEDROCK: "1" }]) {
    assert.deepEqual(reason({ CLEAROTRON_AI_BILLING: "cloud", ...env }, "openai-agent"),
      { ...base, kind: "cloud-on-codex", mode: "cloud", modes: ["subscription", "api-key"] }, JSON.stringify(env));
  }

  // A MISSING KEY IS NOT A REASON: it keeps its own shape, and the two never arrive together.
  for (const [env, engine] of [[{ CLEAROTRON_AI_BILLING: "api-key" }, "anthropic-agent"], [{ CLEAROTRON_AI_BILLING: "api-key", CLAUDE_CODE_USE_BEDROCK: "1" }, "anthropic-agent"], [{ CLEAROTRON_AI_BILLING: "api-key" }, "openai-agent"]]) {
    const b = engineInventory({ CLEAROTRON_AI: engine, PATH: "", ...env }).billing;
    assert.equal(b.missing.length, 1, JSON.stringify(env));
    assert.equal(b.reason, undefined, `a missing key also carried a refusal reason: ${JSON.stringify(env)}`);
  }

  // THE WORD THAT IS NOT A MODE IS WHATEVER WAS TYPED, and a key pasted into the setting is that word. It
  // reaches no field of what is written to the capture and served to the page: not the mode, not the
  // refusal's sentence, not the reason.
  // Each word carries a marker that must reach no field. The second and third CONTAIN the resolver's own
  // phrase, which a clean-up by pattern stops at, leaving the rest of the word behind; the fourth spans a line.
  const typed = [
    ["zz-a-key-pasted-into-the-billing-word-zz", "zz-a-key-pasted"],
    ["x is not a billing mode leaktail-one", "leaktail-one"],
    ["a=b is not a billing mode leaktail-two", "leaktail-two"],
    ["first-line\nleaktail-three", "leaktail-three"],
  ];
  for (const engine of ["anthropic-agent", "openai-agent"]) {
    for (const [word, marker] of typed) {
      const e = engineInventory({ CLEAROTRON_AI: engine, CLEAROTRON_AI_BILLING: word, PATH: "" });
      const at = `${engine}, ${JSON.stringify(word)}`;
      assert.equal(e.billing.reason.kind, "not-a-mode", at);
      assert.equal(e.billing.mode, "unknown", `${at}: the typed word was recorded as the mode`);
      assert.equal(e.billing.refusal, "CLEAROTRON_AI_BILLING is set to a word that is not a billing mode — refusing to guess, "
        + `because the guess would bill the subscription. One of: ${e.billing.reason.modes.join(", ")}.`, at);
      assert.ok(!JSON.stringify(e).toLowerCase().includes(marker), `${at}: the typed word reached the inventory: ${JSON.stringify(e)}`);
    }
  }
});

// ── THE CLASSIFIER HELD TO THE RESOLVER ─────────────────────────────────────────────────────────────
//
// billingRefusalReason reads a refusal's kind back from the environment, in the resolver's order, because
// the resolver throws a sentence and nothing else. Nothing else holds the two together: reorder the
// resolver's checks and the page names one refusal while the run door throws another, with every fixed
// case above still green. So this drives every combination of the settings the resolver reads, asks the
// resolver, and asks the inventory, and they must name the same refusal.
test("the reason's kind is the refusal the run door throws, over every combination of the billing settings", () => {
  // The resolver's sentences, by the words that tell them apart. A sentence none of these match is a
  // refusal this test does not know, and it fails rather than passing it by.
  const KINDS = [
    [/=api-key but (ANTHROPIC|CODEX)_API_KEY is not set/, "missing-key"],
    [/^CLAUDE_CODE_USE_\w+( and CLAUDE_CODE_USE_\w+)* (is|are) on, which sends Claude/, "switch-beside-mode"],
    [/more than one cloud is switched on/, "two-clouds"],
    [NONE, "no-cloud"],
    [/is not a billing mode/, "not-a-mode"],
    [/this machine runs the Codex engine/, "cloud-on-codex"],
  ];
  const words = [undefined, "", "subscription", "api-key", "cloud", " Cloud ", "subscriptoin"];
  let refusals = 0, combinations = 0;
  for (const engine of ["anthropic-agent", "openai-agent"]) {
    for (const word of words) {
      for (const keyed of [false, true]) {
        for (let switches = 0; switches < 8; switches++) {
          for (const gateway of [false, true]) {
            const env = {
              ...(word === undefined ? {} : { CLEAROTRON_AI_BILLING: word }),
              ...(keyed ? { ANTHROPIC_API_KEY: "k", CODEX_API_KEY: "k" } : {}),
              ...(switches & 1 ? { CLAUDE_CODE_USE_VERTEX: "1" } : {}),
              ...(switches & 2 ? { CLAUDE_CODE_USE_FOUNDRY: "1" } : {}),
              ...(switches & 4 ? { CLAUDE_CODE_USE_BEDROCK: "1" } : {}),
              ...(gateway ? { ANTHROPIC_BASE_URL: "https://gateway.test" } : {}),
            };
            combinations++;
            const at = `${engine} ${JSON.stringify(env)}`;
            let thrown = null;
            try { resolveAuthMode({ engineName: engine, env }); } catch (e) { thrown = e; }
            const b = engineInventory({ CLEAROTRON_AI: engine, PATH: "", ...env }).billing;
            if (!thrown) {
              assert.equal(b.reason, undefined, `${at}: the run door resolves, and the page names a refusal`);
              assert.deepEqual(b.missing, [], at);
              continue;
            }
            refusals++;
            const kind = KINDS.find(([re]) => re.test(thrown.message))?.[1];
            assert.ok(kind, `${at}: the resolver refuses in a way this test does not know: ${thrown.message}`);
            if (kind === "missing-key") {
              assert.equal(b.missing.length, 1, at);
              assert.equal(b.reason, undefined, at);
            } else {
              assert.equal(b.reason?.kind, kind, `${at}: the run door throws ${kind}, the page names ${b.reason?.kind}`);
            }
            // THE ENGINE THE PAGE OFFERS TO MOVE TO PAYS, in this same environment.
            if (b.reason?.engineChoice) {
              assert.doesNotThrow(() => resolveAuthMode({ engineName: b.reason.engineChoice, env }), `${at}: moving to ${b.reason.engineChoice} is refused too`);
            }
          }
        }
      }
    }
  }
  assert.equal(combinations, 448);
  assert.ok(refusals > 100, `too few refusals to have held anything: ${refusals}`);
});

test("every cloud the run door can bill has a name on the page", () => {
  // A cloud with a switch and no name draws a working cloud account as "API key", and a refusal naming it
  // as "the  switch ()". The name comes from the credential advice's table; this holds that every cloud
  // the resolver can return, and every switch it reads, has one.
  for (const c of [...Object.keys(CLOUD_SWITCH), "gateway"]) {
    const name = cloudName(c);
    assert.ok(typeof name === "string" && name.length > 0, `${c}: no name for this cloud`);
  }
  const r = engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "cloud", PATH: "" }).billing.reason;
  assert.deepEqual(r.clouds.map((c) => c.setting), Object.values(CLOUD_SWITCH), "the no-cloud reason lists another set of switches");
  for (const c of r.clouds) assert.ok(c.name, `${c.setting}: sent with no name`);
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
