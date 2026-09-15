// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the real `doctor` command against a scratch home with the background units installed
//
// A MACHINE THAT PAYS FOR CLAUDE THROUGH A CLOUD ACCOUNT, STARTED AS BACKGROUND SERVICES, REFUSED EVERY SEARCH.
//
// `clearotron start --background` writes the services' settings file by copying the values of
// `runRequiredNames(process.env, runTables())` and nothing else. On a cloud-billed machine that list named
// CLEAROTRON_AI_BILLING and none of the cloud's own settings. Measured 2026-09-15 with a Microsoft Foundry
// configuration: the file received the billing word `cloud` and no switch, no resource, no key, and the run
// door refused over only what it had been given: "CLEAROTRON_AI_BILLING=cloud but none of
// CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY, CLAUDE_CODE_USE_BEDROCK or ANTHROPIC_BASE_URL is set".
//
// These arms compose the services' file the way start does — start's own tables, its carry loop, its add-only
// merge — and then ask the run door's own resolver about ONLY what the file holds. A composer checked against
// the environment it was composed from passes on exactly the machine that fails.
//
// BREAK MATRIX:
//   · each cloud and the gateway reach the services      → break: drop the cloud rows, the per-cloud arms go red
//   · a stray switch under subscription stays behind     → break: gate the rows on a switch, not the word, red
//   · Codex's list does not change                       → break: drop the engine's pay-ways gate, red
//   · a missing switch is refused at order time, named   → break: drop the unnamed-cloud row, red
//   · doctor reads a switch the services hold            → break: doctor's fill back to two passes, red
//   · no secret value is printed                          → break: put a value into a row's reason, red
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runRequirements, runRequiredNames, missingRequirements, orderTimeRefusal, ORDER } from "../run-requirements.mjs";
import { resolveAuthMode, CLOUD_SWITCH, CLOUD_SETTINGS } from "../engine/auth.mjs";
import { parseEnvFile } from "../../shared/env-file-merge.mjs";
import { runTables, homeEnvUpdate, BACKGROUND_UNITS } from "../../bin/start.mjs";
import { handRunEnv } from "./drive-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
// START'S OWN TABLES, as its --background path builds them: the register table, the engine table and the
// engine resolver. A copy here could drift from what start carries in the direction that passes.
const T = await runTables();
const REG = T.registers.find((p) => (p.credentials ?? []).length);
const CODEX = T.engines["openai-agent"];

// A value no reason, refusal or report may ever contain. Every setting holding a secret carries it.
const SECRET = "sentinel-not-a-real-key-7f3a";

/** The configuration `clearotron start` holds on a finished Claude install, before any cloud. */
const BASE = Object.freeze({
  CLEAROTRON_REPORTS_DIR: "/srv/example/trademark/pool",
  CLEAROTRON_DATABASE: REG.id, ...Object.fromEntries(REG.credentials.map((k) => [k, "fixture-credential"])),
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: "/usr/bin/true",
  PERPLEXITY_API_KEY: "fixture-research-key",
  // NOT A CLOUD SETTING, and a secret: it must stay in the shell. The carry copies named settings, never
  // the environment, and this is the arm's witness that it still does.
  UNRELATED_SHELL_TOKEN: SECRET,
});

/** Each cloud as setup writes it, and the gateway form. The resolver's answer is the key. */
const CLOUDS = Object.freeze({
  vertex: { CLAUDE_CODE_USE_VERTEX: "1", ANTHROPIC_VERTEX_PROJECT_ID: "example-project", CLOUD_ML_REGION: "europe-west1",
    GOOGLE_APPLICATION_CREDENTIALS: "/srv/example/google-key.json", ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-example" },
  foundry: { CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_FOUNDRY_RESOURCE: "example-resource", ANTHROPIC_FOUNDRY_API_KEY: SECRET,
    ANTHROPIC_DEFAULT_OPUS_MODEL: "opus-deployment", ANTHROPIC_DEFAULT_HAIKU_MODEL: "haiku-deployment" },
  bedrock: { CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "eu-central-1", AWS_ACCESS_KEY_ID: SECRET,
    AWS_SECRET_ACCESS_KEY: SECRET, AWS_SESSION_TOKEN: SECRET },
  gateway: { ANTHROPIC_BASE_URL: "https://gateway.example.test", ANTHROPIC_AUTH_TOKEN: SECRET,
    ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-through-gateway" },
});

/**
 * The services' settings file `start --background` writes from `supervisor`: its carry loop over the one
 * authority, then its add-only merge onto `existing`. Returned as the file's text and as what a unit reads.
 */
function servicesFile(supervisor, existing = "") {
  const union = {};
  for (const name of runRequiredNames(supervisor, T)) {
    const v = String(supervisor[name] ?? "").trim();
    if (v && union[name] === undefined) union[name] = v;
  }
  const { text } = homeEnvUpdate(existing, union);
  return { text, env: parseEnvFile(text) };
}

for (const [cloud, settings] of Object.entries(CLOUDS)) {
  test(`a machine paying through ${cloud} hands the services its switch and its settings, and the run door accepts it`, () => {
    const supervisor = { ...BASE, CLEAROTRON_AI_BILLING: "cloud", ...settings };
    // THE FLOOR: the configuration start holds is one the run door accepts, with this cloud. Without it the
    // arm below could pass over a fixture that never named a cloud.
    assert.equal(resolveAuthMode({ engineName: "anthropic-agent", env: supervisor }).cloud, cloud);
    const { text, env } = servicesFile(supervisor);
    for (const [k, v] of Object.entries(settings))
      assert.equal(env[k], v, `${k} is set in the configuration start holds and did not reach the services' file`);
    // THE RUN DOOR, over ONLY what the file holds — the drive that measured the defect.
    let auth;
    assert.doesNotThrow(() => { auth = resolveAuthMode({ engineName: "anthropic-agent", env }); },
      `the services' file refuses at the run door:\n${text.replaceAll(SECRET, "…")}`);
    assert.deepEqual({ mode: auth.mode, cloud: auth.cloud }, { mode: "cloud", cloud });
    // NOTHING ELSE OF THE SHELL, AND NO OTHER CLOUD. Names on CLOUD_SETTINGS only, and only the set ones.
    assert.equal(env.UNRELATED_SHELL_TOKEN, undefined, "a shell secret that is no cloud setting was written into the services' file");
    for (const k of CLOUD_SETTINGS) if (!(k in settings)) assert.equal(env[k], undefined, `${k} is not set and was written`);
    // AND THE GUARD START RUNS OVER THAT FILE REFUSES NOTHING a run needs.
    assert.deepEqual(missingRequirements(env, T).blocking.map((r) => r.name), [], "the composed file still cannot run a search");
  });
}

test("under subscription or api-key a switch left in the shell stays there, and the services bill as configured", () => {
  for (const [mode, extra] of [["subscription", {}], ["api-key", { ANTHROPIC_API_KEY: SECRET }]]) {
    const supervisor = { ...BASE, CLEAROTRON_AI_BILLING: mode, ...extra, ...CLOUDS.foundry };
    const { env } = servicesFile(supervisor);
    // THE FLOOR: the shell really does hold a switch the run door would refuse beside this word.
    assert.throws(() => resolveAuthMode({ engineName: "anthropic-agent", env: supervisor }), /CLAUDE_CODE_USE_FOUNDRY is on/);
    for (const k of CLOUD_SETTINGS) assert.equal(env[k], undefined, `${mode}: ${k} was written into the services' file`);
    assert.equal(env.CLEAROTRON_AI_BILLING, mode, `${mode}: the billing word did not travel`);
    // No cloud row at all, so nothing about a cloud is reported to a subscription machine.
    assert.deepEqual(runRequirements(supervisor, T).filter((r) => CLOUD_SETTINGS.includes(r.name) || r.anyOf), [], mode);
  }
});

test("Codex's list is what it was: a cloud billing word and a switch add nothing to it", () => {
  const codex = { ...BASE, CLEAROTRON_AI: "openai-agent", [CODEX.env]: "/usr/bin/true" };
  const asToday = runRequiredNames({ ...codex, CLEAROTRON_AI_BILLING: "subscription" }, T);
  const withCloud = runRequiredNames({ ...codex, CLEAROTRON_AI_BILLING: "cloud", ...CLOUDS.vertex }, T);
  assert.deepEqual(withCloud, asToday, "a cloud billing word changed which names a Codex install carries");
  assert.ok(!withCloud.some((n) => CLOUD_SETTINGS.includes(n)), "a cloud setting travels with Codex, which refuses a cloud account");
  assert.ok(asToday.includes(CODEX.env) && asToday.includes("CLEAROTRON_AI_BILLING"), "the Codex list lost its own names");
});

test("a cloud-billed configuration with no switch is refused at order time, never at start, naming every way to fix it", () => {
  const supervisor = { ...BASE, CLEAROTRON_AI_BILLING: "cloud", ANTHROPIC_FOUNDRY_RESOURCE: "example-resource", ANTHROPIC_FOUNDRY_API_KEY: SECRET };
  const miss = missingRequirements(supervisor, T);
  assert.deepEqual(miss.atStart.map((r) => r.name), [], "a missing cloud switch refused a start — an operator's value never bricks an install");
  const row = miss.atOrder.find((r) => r.anyOf);
  assert.ok(row, `nothing is refused at order time on a configuration the run door refuses: ${miss.atOrder.map((r) => r.name).join(", ")}`);
  assert.equal(row.at, ORDER);
  assert.deepEqual(row.anyOf, [...Object.values(CLOUD_SWITCH), "ANTHROPIC_BASE_URL"]);
  for (const n of row.anyOf) assert.ok(row.name.includes(n), `the refusal does not name ${n}`);
  assert.match(row.why, /Google Cloud.*Microsoft Azure.*Amazon Bedrock/, "the reason does not say which switch is whose");
  // THE RUN DOOR AGREES: this is the configuration it refuses, so a refusal here is not a stricter opinion.
  assert.throws(() => resolveAuthMode({ engineName: "anthropic-agent", env: supervisor }), /none of CLAUDE_CODE_USE_VERTEX/);
  // EVERY ALTERNATIVE IS A NAME TO READ, so doctor's view of the services looks for each.
  for (const n of row.anyOf) assert.ok(runRequiredNames(supervisor, T).includes(n), `${n} is not a name a reader is told to look for`);
  // What the set settings ride on is still carried, so the switch is the one thing left to add.
  assert.equal(servicesFile(supervisor).env.ANTHROPIC_FOUNDRY_RESOURCE, "example-resource");
  const r = orderTimeRefusal(supervisor, T, { envFile: "/srv/example/.env" });
  assert.ok(r?.operator.includes(row.name), "the order-time refusal does not name the missing switch");
  assert.doesNotMatch(r.client, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, "a variable name reached the client");
});

test("no secret's value appears in a row, a refusal, or start's announcement lines", () => {
  // Google's settings hold no secret (its key is a file, named by path), so there is nothing of it to leak.
  const withSecrets = Object.entries(CLOUDS).filter(([, s]) => Object.values(s).includes(SECRET));
  assert.deepEqual(withSecrets.map(([c]) => c), ["foundry", "bedrock", "gateway"], "the clouds this arm reaches changed");
  for (const [cloud, settings] of withSecrets) {
    for (const supervisor of [{ ...BASE, CLEAROTRON_AI_BILLING: "cloud", ...settings },
      // and with the switch missing, so the rows that ARE printed are reached
      Object.fromEntries(Object.entries({ ...BASE, CLEAROTRON_AI_BILLING: "cloud", ...settings }).filter(([k]) => !Object.values(CLOUD_SWITCH).includes(k) && k !== "ANTHROPIC_BASE_URL"))]) {
      const rows = runRequirements(supervisor, T);
      // THE FLOOR: the secret-holding settings were read into rows, so there was something to leak.
      assert.ok(rows.some((r) => supervisor[r.name] === SECRET), `${cloud}: no row carries a secret setting — this arm would prove nothing`);
      const printed = [...rows.map((r) => `${r.name} — ${r.why}`),
        ...Object.values(orderTimeRefusal(supervisor, T, { envFile: "/srv/example/.env" }) ?? {}).flat()].join("\n");
      assert.ok(!printed.includes(SECRET), `${cloud}: a secret's value is in what is printed:\n${printed.replaceAll(SECRET, "<SECRET>")}`);
    }
  }
});

// ── DOCTOR, AGAINST THE SERVICES' FILE ─────────────────────────────────────────────────────────────
//
// "Will a search run?" asks the order-time gate's own authority of the units' environment. It filled that
// view in two passes: the register and engine, then what they name. The billing word arrived in the
// second, so the pass that would have named a cloud's switch never ran, and the check read a cloud machine
// as a subscription one.

/** A home with the background units installed, all reading %h/.env, holding `lines`. */
function unitsHome(lines) {
  const home = mkdtempSync(join(tmpdir(), "cloud-units-"));
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  for (const u of BACKGROUND_UNITS) writeFileSync(join(unitDir, u), "[Service]\nEnvironmentFile=%h/.env\nExecStart=/bin/true\n");
  writeFileSync(join(home, ".env"), Object.entries(lines).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  return home;
}

const NODE_BIN = (() => { const d = mkdtempSync(join(tmpdir(), "cloud-node-")); symlinkSync(process.execPath, join(d, "node")); return d; })();

/** The real doctor, from a shell with NOTHING set: every value it judges must come from the units' file. */
function doctor(home) {
  let out;
  try {
    out = execFileSync(process.execPath, [join(REPO, "bin", "onboard.mjs"), "--check"], { encoding: "utf8", stdio: "pipe", timeout: 120_000,
      env: handRunEnv({ HOME: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}) });
  } catch (e) {
    if (e.status == null) throw new Error(`doctor did not come back (${e.signal ?? e.message}) — a could-not-look, not a verdict`);
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  return out;
}
const sectionOf = (out, heading) => (out.split(`\n  ${heading}\n`)[1] ?? "").split(/\n  (?=[A-Z])/)[0];
const willRun = (out) => sectionOf(out, "Will a search run?");

const UNITS_BASE = Object.fromEntries(Object.entries(BASE).filter(([k]) => k !== "UNRELATED_SHELL_TOKEN"));

test("doctor reports a cloud-billed machine whose services lack the switch, and passes one whose services hold it", () => {
  const lacking = unitsHome({ ...UNITS_BASE, CLEAROTRON_AI_BILLING: "cloud", ANTHROPIC_FOUNDRY_RESOURCE: "example-resource", ANTHROPIC_FOUNDRY_API_KEY: SECRET });
  const holding = unitsHome({ ...UNITS_BASE, CLEAROTRON_AI_BILLING: "cloud", ...CLOUDS.foundry });
  try {
    const a = doctor(lacking);
    // THE FLOOR: this doctor read the units, so its verdict is about the services and not about a file it found.
    assert.match(willRun(a), /the units' environment/, `the fixture did not reach the hosted path:\n${a.replaceAll(SECRET, "…")}`);
    assert.match(willRun(a), /a search is refused until[^\n]*CLAUDE_CODE_USE_FOUNDRY/, `the missing switch was not reported:\n${willRun(a)}`);
    const b = doctor(holding);
    assert.match(willRun(b), /nothing a search is refused for at order time is missing from the units' environment/,
      `a switch the services hold was reported missing:\n${willRun(b)}`);
    for (const out of [a, b]) assert.ok(!out.includes(SECRET), "doctor printed a secret's value");
  } finally { for (const h of [lacking, holding]) rmSync(h, { recursive: true, force: true }); }
});

test("THE CONTROL: a subscription machine's doctor verdict is unchanged", () => {
  const home = unitsHome({ ...UNITS_BASE, CLEAROTRON_AI_BILLING: "subscription" });
  try {
    assert.match(willRun(doctor(home)), /nothing a search is refused for at order time is missing from the units' environment/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
