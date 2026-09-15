// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — runs `doctor --check` against a settings file in a throwaway home
// Setup asks how Claude is paid for in the owner's words, with a third answer for a cloud account, and what
// checks an engine outside a run carries the cloud settings a run gets. A run takes every line of its
// settings file. Setup's proof turn and doctor took only the engine's own names, so a cloud answered in
// setup would never have reached the turn meant to prove it, and doctor would have refused a cloud file
// that runs.
//
// What the arms hold:
//   - Claude's pay question and its three answers are the owner's words, and Codex keeps its own two;
//   - each cloud's answers make settings the resolver takes as that cloud, and every name setup can write
//     is one the probe carries;
//   - the probe's turn sees the cloud settings its caller passed, and they are gone again after it;
//   - a successful probe names the model that served it and the provider the program reported;
//   - doctor reads a cloud from the settings file and names the account it charges, and reports a cloud
//     with no switch, and a switch beside subscription, as the refusals they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { resolveAuthMode, CLOUD_SETTINGS, CLOUD_SWITCH } from "../engine/auth.mjs";
import { probeEngineTurn, classifyProbe, engineEnvKeys } from "../engine/probe.mjs";
import { CLAUDE_PAY_QUESTION, CLOUD_CHOICES, payQuestion, cloudSettings, servedLine, cloudAccount } from "../../bin/onboard.mjs";
import { handRunEnv } from "./drive-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ONBOARD = join(HERE, "..", "..", "bin", "onboard.mjs");
const MOCK = join(HERE, "mock-claude.mjs");
const claude = (env) => resolveAuthMode({ engineName: "anthropic-agent", env });

test("Claude's pay question is the owner's wording with three answers, and Codex keeps its two", () => {
  const q = payQuestion({ engineId: "anthropic-agent", eng: ENGINE_BINARIES["anthropic-agent"], bin: null });
  assert.equal(q.question, "How is Claude paid for on this machine?");
  assert.equal(q.question, CLAUDE_PAY_QUESTION);
  assert.deepEqual(q.answers.map((a) => a.label), [
    "A Claude subscription (Pro, Max or Team): you sign in once",
    "An Anthropic API key: pay per use, paste the key",
    "Through your Google, Microsoft or Amazon cloud account: pay per use on that cloud's bill",
  ]);
  // Each answer is a billing word the resolver takes as itself.
  const needs = { subscription: {}, "api-key": { ANTHROPIC_API_KEY: "k" }, cloud: { CLAUDE_CODE_USE_VERTEX: "1" } };
  assert.deepEqual(q.answers.map((a) => a.id), Object.keys(needs));
  for (const a of q.answers) assert.equal(claude({ CLEAROTRON_AI_BILLING: a.id, ...needs[a.id] }).mode, a.id, a.id);

  // CONTROL: a cloud account bills Claude only, and the resolver refuses it on Codex, so Codex is never offered it.
  const codex = payQuestion({ engineId: "openai-agent", eng: ENGINE_BINARIES["openai-agent"], bin: null });
  assert.deepEqual(codex.answers.map((a) => a.id), ["subscription", "api-key"]);
  assert.doesNotMatch(codex.question, /Claude/);

  // Setup asks the question this returns. Read from the source because setup refuses a non-terminal input
  // (the wizard tests say why); if the call is renamed, re-point this rather than delete it.
  const src = readFileSync(ONBOARD, "utf8");
  assert.match(src, /await choose\(pay\.question, pay\.answers,/, "setup no longer asks the question payQuestion returns");
});

test("each cloud's answers make settings the resolver takes as that cloud, and every name setup writes is one the probe carries", () => {
  const carried = new Set(engineEnvKeys());
  assert.deepEqual(CLOUD_CHOICES.map((c) => c.id), ["vertex", "foundry", "bedrock"]);
  for (const c of CLOUD_CHOICES) {
    assert.ok(c.asks.length >= 1, `${c.id} asks nothing`);
    const settings = cloudSettings(c.id, Object.fromEntries(c.asks.map((a) => [a.env, a.def ?? "x"])));
    assert.equal(settings[CLOUD_SWITCH[c.id]], "1", `${c.id}: its own switch is written`);
    for (const k of Object.keys(settings)) {
      assert.ok(carried.has(k), `${c.id}: setup writes ${k} and the probe does not carry it, so the proof turn would run without it`);
      assert.ok(k === "CLEAROTRON_AI_BILLING" || CLOUD_SETTINGS.includes(k), `${k} is not one of the cloud settings`);
    }
    assert.deepEqual(claude(settings), { provider: "anthropic", mode: "cloud", apiBilled: true, cloud: c.id });
  }
  for (const sw of Object.values(CLOUD_SWITCH)) assert.ok(CLOUD_SETTINGS.includes(sw), `${sw} is not carried`);
  // A blank answer writes nothing, so the program uses the sign-in the machine already has.
  assert.deepEqual(cloudSettings("foundry", { ANTHROPIC_FOUNDRY_RESOURCE: " r ", ANTHROPIC_FOUNDRY_API_KEY: "" }),
    { CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_FOUNDRY_RESOURCE: "r" });
});

test("the cloud menu marks Amazon Bedrock as not yet tested, and only there", () => {
  // Nobody has run Claude through a Bedrock account with this yet, so setup keeps offering it and says so.
  const label = (id) => CLOUD_CHOICES.find((c) => c.id === id).label;
  assert.equal(label("bedrock"), "Amazon Bedrock (not yet tested)");
  // CONTROLS: the other two rows carry no mark, so the one above is not a suffix every row gets; and
  // doctor's account wording, which names the account and not our testing, is unchanged.
  assert.equal(label("vertex"), "Google Cloud (Vertex AI)");
  assert.equal(label("foundry"), "Microsoft Azure (Foundry)");
  assert.equal(cloudAccount("bedrock"), "your Amazon Bedrock account");
  // The menu is these labels as they stand: setup hands CLOUD_CHOICES to its chooser unchanged.
  assert.match(readFileSync(ONBOARD, "utf8"), /await choose\("Which cloud account pays\?", CLOUD_CHOICES,/);
});

test("the probe's turn sees the cloud settings its caller passed, they are gone again after it, and it names what served it", async () => {
  const env = { CLEAROTRON_AI: "anthropic-agent",
    ...cloudSettings("foundry", { ANTHROPIC_FOUNDRY_RESOURCE: "res-test", ANTHROPIC_DEFAULT_HAIKU_MODEL: "dep-haiku" }) };
  const before = { ...process.env };
  for (const k of Object.keys(env)) if (k !== "CLEAROTRON_AI")
    assert.notEqual(before[k], env[k], `${k} already holds that value in this process, so the arm would prove nothing`);
  let seen = null;
  const v = await probeEngineTurn({ env, runTurn: async () => {
    seen = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    return { code: 0, modelWire: "claude-haiku-4-5-20251001", providerWire: "foundry" };
  } });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual(seen, env, "the turn ran without the settings it was meant to prove");
  for (const k of Object.keys(env)) assert.equal(process.env[k], before[k], `${k} outlived the probe`);
  assert.equal(v.served, "claude-haiku-4-5-20251001");
  assert.equal(v.provider, "foundry");
  assert.equal(servedLine(v), `served by claude-haiku-4-5-20251001; the program names its provider "foundry".`);
  // CONTROL: a turn that named neither says so, and setup and doctor then print no line about it.
  const bare = classifyProbe({ engine: "anthropic-agent", tuple: { code: 0 } });
  assert.equal(bare.ok, true);
  assert.equal(bare.served, null);
  assert.equal(bare.provider, null);
  assert.equal(servedLine(bare), null);
});

const NODE_BIN = mkdtempSync(join(tmpdir(), "setup-pay-node-"));
symlinkSync(process.execPath, join(NODE_BIN, "node"));
/**
 * `doctor --check` in a throwaway home whose settings file holds `lines`; returns what it printed.
 *
 * Its environment is composed from nothing, through handRunEnv: neither the runner's no-env-file flag nor
 * a unit's invocation id can make doctor skip the file, and none of the runner's own settings can
 * override it. So a `billing: cloud` line can only have come from the file, which is the proof it was read.
 */
function doctor(lines) {
  const home = mkdtempSync(join(tmpdir(), "setup-pay-home-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"),
    ["CLEAROTRON_AI=anthropic-agent", `CLEAROTRON_CLAUDE_PATH=${MOCK}`, ...lines].join("\n") + "\n");
  try {
    return execFileSync(process.execPath, [ONBOARD, "--check"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000,
      env: handRunEnv({ HOME: home, PATH: `${NODE_BIN}:/usr/bin:/bin` }, {}) });
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

test("doctor reads a cloud from the settings file and names the account it charges", () => {
  const out = doctor(["CLEAROTRON_AI_BILLING=cloud", "CLAUDE_CODE_USE_FOUNDRY=1"]);
  assert.match(out, /billing: cloud — charged per use to your Microsoft Azure account \(Foundry\)/, out);
  assert.doesNotMatch(out, /none of CLAUDE_CODE_USE_VERTEX/, "the switch in the settings file was not read");
  assert.match(doctor(["CLEAROTRON_AI_BILLING=cloud", "ANTHROPIC_BASE_URL=https://gateway.test"]),
    /billing: cloud — charged per use through the gateway at ANTHROPIC_BASE_URL/);
  // CONTROL: without the switch the same file is refused, so the line above came from the file's switch;
  // and a switch beside subscription is the refusal a run meets.
  assert.match(doctor(["CLEAROTRON_AI_BILLING=cloud"]),
    /none of CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY, CLAUDE_CODE_USE_BEDROCK or ANTHROPIC_BASE_URL is set/);
  assert.match(doctor(["CLAUDE_CODE_USE_BEDROCK=1"]),
    /CLAUDE_CODE_USE_BEDROCK is on, which sends Claude to that cloud account, while CLEAROTRON_AI_BILLING says subscription/);
});
