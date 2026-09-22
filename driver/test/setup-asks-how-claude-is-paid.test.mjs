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
//   - an Amazon machine whose keys are only in the settings file is proved by doctor and by setup's proof turn
//     with those keys, the proof turn takes the file in a run's order, reads the file at the old location on
//     an install still configured there, and a secret setup shows is shown as set, never with its value;
//   - doctor reads a cloud from the settings file and names the account it charges, and reports a cloud
//     with no switch, and a switch beside subscription, as the refusals they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { resolveAuthMode, CLOUD_SETTINGS, CLOUD_SECRETS, CLOUD_SWITCH } from "../engine/auth.mjs";
import { probeEngineTurn, classifyProbe, engineEnvKeys } from "../engine/probe.mjs";
import { CLAUDE_PAY_QUESTION, CLOUD_CHOICES, payQuestion, cloudSettings, servedLine, cloudAccount, shownSetting, signInHandOff,
  proofTurn, readEnvFile, settingsInForce } from "../../bin/onboard.mjs";
import { payWays } from "../run-requirements.mjs";
import { loadEnvLocal, envLocalPath } from "../../shared/env-local.mjs";
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
  // And `clearotron start`'s billing row names the same ways for each engine as this question offers.
  for (const [id, eng] of Object.entries(ENGINE_BINARIES))
    assert.deepEqual(payWays(id, eng), payQuestion({ engineId: id, eng, bin: null }).answers.map((a) => a.id), id);

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

test("setup's skip line for a Foundry deployment name says when skipping works", () => {
  // With no pin the program asks Foundry for a deployment named after the model. That resolves only where
  // the reader deployed the model under exactly that name; anywhere else every turn of the tier is refused.
  // The old line, "the program's own default name is used", was true and read as safe everywhere.
  const foundry = CLOUD_CHOICES.find((c) => c.id === "foundry");
  const pins = foundry.asks.filter((a) => /^ANTHROPIC_DEFAULT_[A-Z]+_MODEL$/.test(a.env));
  assert.equal(pins.length, 3, "the Foundry questions no longer ask three deployment names");
  for (const a of pins) {
    assert.equal(a.skippable, true, `${a.env} can no longer be skipped`);
    assert.equal(a.skipped, "Not set: the program asks for a deployment named after the model, which works only if you deployed it under that name.",
      `${a.env}: the skip line does not say when skipping works`);
  }
  // CONTROL: the key's skip line is about the Azure sign-in and keeps its own words.
  assert.equal(foundry.asks.find((a) => a.env === "ANTHROPIC_FOUNDRY_API_KEY").skipped, "No key: the Azure sign-in on this machine is used.");
});

test("setup's proof turn and doctor carry the fable tier's pin, and setup does not ask for it", () => {
  // A stage asks for fable only through the synthesis override, so setup's questions stay at the three
  // deployment names every run reaches. A reader who sets the override writes the fourth pin by hand, and
  // the checks must then prove the configuration a run would use, not a shell without it.
  const pin = "ANTHROPIC_DEFAULT_FABLE_MODEL";
  assert.ok(CLOUD_SETTINGS.includes(pin), `${pin} is not one of the cloud settings`);
  assert.ok(engineEnvKeys().includes(pin), `the probe does not carry ${pin}, so the proof turn would run without it`);
  const eng = ENGINE_BINARIES["anthropic-agent"];
  const { env } = proofTurn({ engineId: "anthropic-agent", eng, bin: { path: "/opt/claude" },
    authEnv: cloudSettings("foundry", { ANTHROPIC_FOUNDRY_RESOURCE: "res-test" }), env: { PATH: "/usr/bin:/bin" },
    settings: { [pin]: "fable-deployment", CLEAROTRON_DATABASE: "file-register" } });
  assert.equal(env[pin], "fable-deployment", "setup's proof turn left the settings file's fable pin behind");
  assert.equal(shownSetting(pin, "fable-deployment"), `${pin}=fable-deployment`, "a deployment name is not a secret, so it is shown as written");
  for (const c of CLOUD_CHOICES)
    assert.ok(!c.asks.some((a) => a.env === pin), `${c.id}: setup asks for ${pin}, which only the synthesis override reaches`);
  // CONTROLS: the Foundry questions still ask the three pins a stage reaches without the override, and a
  // setting that is no cloud setting stays in the file.
  const foundry = CLOUD_CHOICES.find((c) => c.id === "foundry").asks.map((a) => a.env);
  for (const tier of ["OPUS", "SONNET", "HAIKU"]) assert.ok(foundry.includes(`ANTHROPIC_DEFAULT_${tier}_MODEL`), `setup no longer asks the ${tier.toLowerCase()} deployment`);
  assert.equal(env.CLEAROTRON_DATABASE, undefined);
});

test("the probe's turn sees the cloud settings its caller passed, they are gone again after it, and it names what served it", async () => {
  const env = { CLEAROTRON_AI: "anthropic-agent",
    ...cloudSettings("foundry", { ANTHROPIC_FOUNDRY_RESOURCE: "res-test", ANTHROPIC_DEFAULT_HAIKU_MODEL: "dep-haiku" }) };
  const before = { ...process.env };
  for (const k of Object.keys(env)) if (k !== "CLEAROTRON_AI")
    assert.notEqual(before[k], env[k], `${k} already holds that value in this process, so the arm would prove nothing`);
  let seen = null;
  const v = await probeEngineTurn({ env, runTurn: async (a) => {
    seen = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    // A working engine answers with the word the probe's tool returned.
    const word = JSON.parse(a.mcpConfig).mcpServers.probe.args[1];
    return { code: 0, stdout: word, modelWire: "claude-haiku-4-5-20251001", providerWire: "foundry" };
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

/**
 * A stand-in for the Claude program on an Amazon machine: it completes the turn only when both standard AWS
 * key variables reach it, and otherwise answers the way Bedrock refuses a request without credentials. It
 * writes down which it saw, so the witness is the spawned process, not what doctor says about it.
 */
function amazonProgram(dir) {
  const log = join(dir, "program-saw.log");
  const bin = join(dir, "claude-on-amazon.sh");
  writeFileSync(bin, [
    "#!/bin/sh",
    `if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then echo present >> "${log}"; exec "${process.execPath}" "${MOCK}" "$@"; fi`,
    `echo absent >> "${log}"`,
    `echo "API Error: 403 The security token included in the request is invalid." >&2`,
    "exit 1",
  ].join("\n") + "\n");
  chmodSync(bin, 0o755);
  return { bin, saw: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

/** `doctor --check --probe-engine` with the settings file holding `lines`, the program set to `bin`. */
function doctorProves(bin, lines) {
  const home = mkdtempSync(join(tmpdir(), "setup-pay-probe-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"),
    ["CLEAROTRON_AI=anthropic-agent", `CLEAROTRON_CLAUDE_PATH=${bin}`, ...lines].join("\n") + "\n");
  try {
    return execFileSync(process.execPath, [ONBOARD, "--check", "--probe-engine"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 90000,
      env: handRunEnv({ HOME: home, PATH: `${NODE_BIN}:/usr/bin:/bin` }, {}) });
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

const AMAZON = ["CLEAROTRON_AI_BILLING=cloud", "CLAUDE_CODE_USE_BEDROCK=1", "AWS_REGION=eu-central-1"];
const AWS_KEYS = { AWS_ACCESS_KEY_ID: "AKIA-TEST-NOT-REAL", AWS_SECRET_ACCESS_KEY: "secret-test-not-real", AWS_SESSION_TOKEN: "session-test-not-real" };

test("an Amazon machine whose keys are only in the settings file is proved by doctor the way its searches run", () => {
  // Doctor's environment is composed from nothing (doctorProves), so a key can only reach the program from the file.
  const dir = mkdtempSync(join(tmpdir(), "setup-pay-amazon-"));
  const program = amazonProgram(dir);
  const out = doctorProves(program.bin, [...AMAZON, ...Object.entries(AWS_KEYS).map(([k, v]) => `${k}=${v}`)]);
  assert.deepEqual(program.saw(), ["present"], `the program ran without the keys the settings file holds:\n${out}`);
  assert.match(out, /billing: cloud — charged per use to your Amazon Bedrock account/, out);
  assert.match(out, /anthropic-agent completed a turn/, out);
  for (const v of Object.values(AWS_KEYS)) assert.ok(!out.includes(v), `doctor printed a key's value:\n${out}`);

  // CONTROL: the same machine with no keys anywhere. The program ran and saw none, so the pair above
  // measured the keys and not the stand-in, and nothing is claimed proven.
  const bare = amazonProgram(mkdtempSync(join(tmpdir(), "setup-pay-amazon-bare-")));
  const refused = doctorProves(bare.bin, AMAZON);
  assert.deepEqual(bare.saw(), ["absent"], refused);
  assert.doesNotMatch(refused, /completed a turn/, refused);
});

test("doctor on an Amazon machine whose credentials are refused names Amazon and what to check, not the subscription's sign-in", () => {
  const program = amazonProgram(mkdtempSync(join(tmpdir(), "setup-pay-amazon-refused-")));
  const out = doctorProves(program.bin, AMAZON);
  assert.deepEqual(program.saw(), ["absent"], out);
  assert.match(out, /Amazon Bedrock refused the credentials — check AWS_REGION and the AWS credentials on this machine/, out);
  assert.doesNotMatch(out, /run `claude` once|claude setup-token|is not signed in/, `a cloud machine was given the subscription's sign-in:\n${out}`);
  // CONTROL: the same refusal on a machine paying by subscription keeps the sign-in advice.
  const sub = amazonProgram(mkdtempSync(join(tmpdir(), "setup-pay-subscription-refused-")));
  const signedOut = doctorProves(sub.bin, []);
  assert.match(signedOut, /anthropic-agent is not signed in — Sign in: run `claude` once in a terminal/, signedOut);
  assert.doesNotMatch(signedOut, /refused the credentials/, signedOut);
});

test("setup's proof turn on an Amazon machine whose keys are only in the settings file runs with them, as a search does", async () => {
  const eng = ENGINE_BINARIES["anthropic-agent"];
  // The shell is composed from nothing and holds no Amazon credential of any kind, so a key can only reach the
  // program from the settings file. The answers are the ones setup takes for Amazon: the region.
  const shell = handRunEnv({ HOME: mkdtempSync(join(tmpdir(), "setup-pay-proof-home-")), PATH: `${NODE_BIN}:/usr/bin:/bin` }, {});
  const answers = cloudSettings("bedrock", { AWS_REGION: "eu-central-1" });
  const proves = async (lines) => {
    const dir = mkdtempSync(join(tmpdir(), "setup-pay-proof-amazon-"));
    const program = amazonProgram(dir);
    const file = join(dir, "settings.env");
    writeFileSync(file, lines.join("\n") + "\n");
    const v = await probeEngineTurn(proofTurn({ engineId: "anthropic-agent", eng, bin: { source: "explicit", path: program.bin },
      authEnv: answers, env: shell, settings: readEnvFile(file) }));
    return { v, saw: program.saw() };
  };
  const withKeys = await proves(Object.entries(AWS_KEYS).map(([k, v]) => `${k}=${v}`));
  assert.deepEqual(withKeys.saw, ["present"], `the program ran without the keys the settings file holds: ${JSON.stringify(withKeys.v)}`);
  assert.equal(withKeys.v.ok, true, JSON.stringify(withKeys.v));
  for (const val of Object.values(AWS_KEYS)) assert.ok(!JSON.stringify(withKeys.v).includes(val), "the verdict carries a key's value");
  // CONTROL: the same setup with no keys in the file. The program ran and saw none, so the pair above measured
  // the keys and not the stand-in, and nothing is proved.
  const without = await proves(["AWS_REGION=eu-central-1"]);
  assert.deepEqual(without.saw, ["absent"], JSON.stringify(without.v));
  assert.equal(without.v.ok, false);
  // And setup hands its proof turn the file a search reads. The turn runs only behind a terminal, so the call
  // is read from the source; the arm below drives what it is handed.
  assert.match(readFileSync(ONBOARD, "utf8"), /probeEngineTurn\(proofTurn\(\{ engineId: pick\.id, eng, bin, authEnv, settings: settingsInForce\(\) \}\)\)/);
});

test("setup's proof turn on an install still configured at the old location reads the file a search reads there", async () => {
  // An install configured before the settings file moved keeps it at the old location, in the install folder,
  // and the loader still reads it there. The proof turn read only the new location, so the keys every search
  // used never reached it. A throwaway install folder and home, so neither this checkout nor the suite's home
  // is read.
  const eng = ENGINE_BINARIES["anthropic-agent"];
  const shell = handRunEnv({ HOME: mkdtempSync(join(tmpdir(), "setup-pay-old-shell-")), PATH: `${NODE_BIN}:/usr/bin:/bin` }, {});
  const answers = cloudSettings("bedrock", { AWS_REGION: "eu-central-1" });
  const install = (lines) => {
    const at = { repoRoot: mkdtempSync(join(tmpdir(), "setup-pay-old-install-")), home: mkdtempSync(join(tmpdir(), "setup-pay-old-home-")) };
    writeFileSync(join(at.repoRoot, ".env"), [...AMAZON, ...lines].join("\n") + "\n");
    return at;
  };
  const proves = async (at) => {
    const program = amazonProgram(mkdtempSync(join(tmpdir(), "setup-pay-old-amazon-")));
    const v = await probeEngineTurn(proofTurn({ engineId: "anthropic-agent", eng, bin: { source: "explicit", path: program.bin },
      authEnv: answers, env: shell, settings: settingsInForce(at) }));
    return { v, saw: program.saw() };
  };
  const at = install(Object.entries(AWS_KEYS).map(([k, v]) => `${k}=${v}`));
  // Precondition: the file setup writes is somewhere else and absent, so only the old location can answer.
  assert.notEqual(envLocalPath(at), join(at.repoRoot, ".env"));
  assert.equal(existsSync(envLocalPath(at)), false);
  // THE RUN'S RESOLUTION, from the run's own loader rather than restated: what it applies on this install.
  const run = {};
  loadEnvLocal({ env: run, ...at, note: () => {} });
  const settings = settingsInForce(at);
  for (const k of CLOUD_SETTINGS) assert.equal(settings[k], run[k], `${k} is not what a search on this install reads`);
  const withKeys = await proves(at);
  assert.deepEqual(withKeys.saw, ["present"], `the program ran without the keys a search on this install reads: ${JSON.stringify(withKeys.v)}`);
  assert.equal(withKeys.v.ok, true, JSON.stringify(withKeys.v));
  // CONTROL: the same install with no keys in its file. The program ran and saw none, so nothing is proved.
  const without = await proves(install([]));
  assert.deepEqual(without.saw, ["absent"], JSON.stringify(without.v));
  assert.equal(without.v.ok, false);
});

test("setup's proof turn takes the file's cloud settings in a run's order: the shell over the file, an answer over both", () => {
  const eng = ENGINE_BINARIES["anthropic-agent"];
  const lines = ["AWS_REGION=file-region", "AWS_ACCESS_KEY_ID=file-id", "AWS_SECRET_ACCESS_KEY=file-secret", "AWS_PROFILE=file-profile",
    "CLEAROTRON_DATABASE=file-register"];
  const dir = mkdtempSync(join(tmpdir(), "setup-pay-order-"));
  const file = join(dir, "settings.env");
  writeFileSync(file, lines.join("\n") + "\n");
  const shell = { PATH: "/usr/bin:/bin", AWS_ACCESS_KEY_ID: "shell-id", AWS_PROFILE: "" };
  const answers = cloudSettings("bedrock", { AWS_REGION: "answer-region" });
  const { env } = proofTurn({ engineId: "anthropic-agent", eng, bin: { path: "/opt/claude" }, authEnv: answers, env: shell, settings: readEnvFile(file) });
  // THE RUN'S ORDER, from the run's own loader rather than restated: what it leaves in a copy of the shell.
  const run = { ...shell };
  loadEnvLocal({ env: run, file, note: () => {} });
  for (const k of CLOUD_SETTINGS) assert.equal(env[k], k in answers ? answers[k] : run[k], `${k} is not what a run after this setup reads`);
  assert.equal(env.AWS_ACCESS_KEY_ID, "shell-id", "the shell's value wins over the file's");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, "file-secret", "the file fills a name the shell does not hold");
  assert.equal(env.AWS_PROFILE, "", "a name the shell holds empty wins, as the loader keeps it");
  assert.equal(env.AWS_REGION, "answer-region", "an answer given in setup wins over the file");
  // Only the cloud settings are taken from the file.
  assert.equal(env.CLEAROTRON_DATABASE, undefined);
  // CONTROL: without the file, nothing but the shell and the answers.
  assert.equal(proofTurn({ engineId: "anthropic-agent", eng, bin: { path: "/opt/claude" }, authEnv: answers, env: shell }).env.AWS_SECRET_ACCESS_KEY, undefined);
});

test("after a failed proof turn setup hands off the sign-in only on a subscription, and says how to change the answers otherwise", () => {
  const eng = ENGINE_BINARIES["anthropic-agent"];
  const installed = { source: "installed", path: "/opt/engines/node_modules/@anthropic-ai/claude-code/bin/claude.exe" };
  const sub = signInHandOff(eng, installed, "subscription");
  assert.equal(sub.captureToken, true, "the subscription's token route is offered");
  assert.equal(sub.lines[0], `if it is signed out: run \`${installed.path}\` once in a terminal and complete the sign-in, then answer yes below.`);
  assert.match(sub.lines[1], /^on a machine you cannot complete a sign-in on: run `claude setup-token` \(from any machine you can sign in on; on this one the program is /);
  for (const [id, e] of Object.entries(ENGINE_BINARIES))
    for (const l of signInHandOff(e, installed, "subscription").lines) assert.doesNotMatch(l, /\bbox\b/, `${id}: ${l}`);
  for (const billing of ["cloud", "api-key"]) {
    const h = signInHandOff(eng, installed, billing);
    assert.equal(h.captureToken, false, `${billing}: a subscription token is offered where the turn would not use it`);
    assert.ok(h.lines.length > 0, `${billing}: nothing is said`);
    for (const l of h.lines) assert.doesNotMatch(l, /signed out|setup-token|once in a terminal/, `${billing}: "${l}" is the subscription's advice`);
    assert.match(h.lines.join(" "), /answer no below|answer no and pick the engine again/, `${billing}: no way to change what the turn ran on`);
  }
  // CONTROL: Codex declares no token to paste, so none is offered even on a subscription.
  assert.equal(signInHandOff(ENGINE_BINARIES["openai-agent"], null, "subscription").captureToken, false);
  // Setup prints what this returns and offers the token only when it says so.
  const src = readFileSync(ONBOARD, "utf8");
  assert.match(src, /const handOff = signInHandOff\(eng, bin, authPick\.id\);\n\s*for \(const line of handOff\.lines\) info\(line\);/);
  assert.match(src, /if \(handOff\.captureToken\) \{\n\s*\/\/ A TOKEN PASTED/);
});

test("where setup shows a cloud setting it wrote, a secret is shown as set and never with its value", () => {
  const secrets = new Set(["ANTHROPIC_FOUNDRY_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "ANTHROPIC_AUTH_TOKEN"]);
  assert.deepEqual(new Set(CLOUD_SECRETS), secrets);
  // Every secret is a setting the checks carry, so the walk below meets each one.
  for (const k of secrets) assert.ok(CLOUD_SETTINGS.includes(k), `${k} is not carried by setup's proof turn and doctor`);
  for (const k of CLOUD_SETTINGS) {
    const line = shownSetting(k, "value-test-not-real");
    if (secrets.has(k)) assert.equal(line, `${k}=…`, `${k} holds a credential and its value was shown`);
    else assert.equal(line, `${k}=value-test-not-real`, `${k} is not a credential, so the reader is shown what was written`);
  }
  // The setup screen that lists what it wrote goes through this, rather than a pattern of its own.
  assert.match(readFileSync(ONBOARD, "utf8"), /for \(const \[k, val\] of cloudLines\) info\(shownSetting\(k, val\)\);/);
});

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
